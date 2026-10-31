"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/online-image, /api/online-video, /api/canvas-video
"""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from fastapi import HTTPException
import asyncio, httpx, time
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.post("/api/online-image")
async def online_image(payload: _main.OnlineImageRequest, token: str = ""):
    username = _main.get_username_by_token(token)
    return await _main.build_online_image_result(payload, username=username)


@router.post("/api/online-video")
async def online_video(payload: _main.OnlineVideoRequest, token: str = ""):
    # 之前误把 token 当 username 传下去，会让落盘目录名变成一段令牌
    return await build_online_video_result(payload, username=_main.get_username_by_token(token))

async def build_online_video_result(payload: _main.OnlineVideoRequest, username: str = None):
    provider_id = payload.provider_id or "jimeng"
    prov = _main._resolve_image_provider(provider_id)
    model = payload.model or (prov.get("video_models") or [""])[0] or payload.model
    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    try:
        result = await generate_video(payload.prompt, payload.size, model, refs, protocol=payload.protocol, provider_id=provider_id, provider=prov, duration=payload.duration)
        local_url = await _main.save_remote_video_to_output(
            result.get("value", ""), prefix="video_",
            owner=_main.get_user_dirname(username) or "",
            feature=(getattr(payload, "feature", "") or "").strip() or "视频")
    except httpx.HTTPStatusError as exc:
        text = exc.response.text or ''
        friendly = "视频生成接口返回错误"
        if "rate limit" in text.lower():
            friendly = "请求过于频繁，已被上游限流，请稍后重试。"
        elif "Unauthorized" in text or "401" in text:
            friendly = "API Key 无效或已过期，请到「API 设置」检查 Key。"
        raise HTTPException(status_code=exc.response.status_code, detail=friendly) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"上游视频接口异常:{exc}") from exc
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        raise HTTPException(status_code=getattr(exc, "status_code", 500), detail=str(detail)) from exc
    return {
        "prompt": payload.prompt,
        "videos": [local_url],
        "timestamp": time.time() * 1000,
        "type": "video",
        "model": model,
        "provider_id": provider_id,
        "protocol": prov["protocol"],
        "params": {"model": model, "size": payload.size, "duration": payload.duration, "reference_images": refs, "provider_id": provider_id},
    }

async def generate_video(prompt, size, model, refs, protocol="jimeng", provider_id="", provider=None, duration=5):
    """视频生成分发器"""
    actual_proto = _main.provider_protocol(provider) if isinstance(provider, dict) else (protocol or PROTOCOL_JIMENG)
    
    if actual_proto == PROTOCOL_JIMENG or str(provider_id).lower() == "jimeng":
        return await _main.generate_jimeng_video({"prompt": prompt, "model": model, "resolution": size, "duration_seconds": duration}, provider)
    elif actual_proto == _main.PROTOCOL_RUNNINGHUB or str(provider_id).lower() == "runninghub":
        return await _gen_runninghub_video(provider, model, prompt, size, refs)
    elif actual_proto == _main.PROTOCOL_VOLCENGINE or str(provider_id).lower() == "volcengine":
        return await _gen_volcengine_video(provider, model, prompt, size, refs)
    else:
        raise HTTPException(status_code=400, detail=f"协议 {actual_proto} 暂不支持视频生成")

PROTOCOL_JIMENG = "jimeng"

async def _gen_runninghub_video(provider_cfg, model, prompt, size, refs):
    """RunningHub 视频生成"""
    base = str((provider_cfg or {}).get("base_url") or "").rstrip("/")
    api_key = str((provider_cfg or {}).get("api_key") or "")
    if not base or not api_key:
        raise HTTPException(status_code=400, detail="RunningHub 未配置请求地址或 API Key")
    import uuid
    workflow_id = str(uuid.uuid4())
    body = {
        "workflow_id": workflow_id,
        "model": model,
        "prompt": prompt,
        "size": size,
        "output_type": "video",
        "params": {},
    }
    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(f"{base}/api/v1/workflows/submit", headers={"Authorization": f"Bearer {api_key}"}, json=body)
        resp.raise_for_status()
        data = resp.json()
        task_id = data.get("task_id") or data.get("id", "")
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            await asyncio.sleep(5)
            poll = await client.get(f"{base}/api/v1/workflows/{task_id}", headers={"Authorization": f"Bearer {api_key}"})
            poll.raise_for_status()
            status = poll.json()
            s = str(status.get("status") or "").lower()
            if s in ("succeeded", "completed", "success", "done"):
                video_url = status.get("output") or status.get("video_url") or status.get("result", {}).get("video", "")
                if video_url:
                    return {"type": "url", "value": video_url}
                raise HTTPException(status_code=502, detail=f"RunningHub 视频结果无 URL: {status}")
            if s in ("failed", "error", "cancelled", "timeout"):
                raise HTTPException(status_code=502, detail=f"RunningHub 视频任务失败: {status.get('error', '')}")
        raise HTTPException(status_code=504, detail="RunningHub 视频任务超时")
    return {"type": "url", "value": ""}

async def _gen_volcengine_video(provider_cfg, model, prompt, size, refs):
    """火山引擎方舟视频生成（Seedance/豆包视频模型）"""
    base = str((provider_cfg or {}).get("base_url") or "").rstrip("/").replace("/v1", "").replace("/api/v3", "")
    api_key = str((provider_cfg or {}).get("api_key") or "")
    if not base or not api_key:
        raise HTTPException(status_code=400, detail="火山引擎未配置请求地址或 API Key")
    body = {"model": model, "prompt": prompt, "size": size}
    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(f"{base}/api/v3/video/generations", headers={"Authorization": f"Bearer {api_key}"}, json=body)
        resp.raise_for_status()
        data = resp.json()
        result = data.get("result", {})
        video_url = result.get("video_url") or result.get("url") or ""
        if video_url:
            return {"type": "url", "value": video_url}
        task_id = result.get("id") or result.get("task_id") or data.get("id", "")
        if task_id:
            deadline = time.monotonic() + 600
            while time.monotonic() < deadline:
                await asyncio.sleep(5)
                poll = await client.get(f"{base}/api/v3/video/tasks/{task_id}", headers={"Authorization": f"Bearer {api_key}"})
                if poll.status_code != 200:
                    await asyncio.sleep(5)
                    continue
                ps = poll.json()
                s = str(ps.get("status") or "").lower()
                if s in ("succeeded", "completed", "success"):
                    vid_url = ps.get("result", {}).get("video_url") or ps.get("video_url") or ""
                    if vid_url:
                        return {"type": "url", "value": vid_url}
                    raise HTTPException(status_code=502, detail=f"火山视频成功但无URL: {ps}")
                if s in ("failed", "error"):
                    raise HTTPException(status_code=502, detail=f"火山视频失败: {ps.get('error', '')}")
            raise HTTPException(status_code=504, detail="火山视频生成超时")
        raise HTTPException(status_code=502, detail=f"火山视频未返回 task_id: {data}")
    return {"type": "url", "value": ""}

class CanvasVideoRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    provider_id: str = "jimeng"
    model: str = "veo3-fast"
    duration: int = 5
    aspect_ratio: str = "16:9"
    resolution: str = ""
    size: str = ""
    images: List[Dict[str, Any]] = []
    videos: List[str] = []
    audios: List[str] = []
    enhance_prompt: bool = False
    enable_upsample: bool = False
    watermark: bool = False
    seed: Optional[int] = None
    camerafixed: bool = False


PROTOCOL_JIMENG = "jimeng"

@router.post("/api/canvas-video")
async def canvas_video_route(payload: CanvasVideoRequest):
    provider_id = payload.provider_id or "jimeng"
    size = payload.size or payload.resolution or "1920x1080"
    refs = [r for r in payload.images if isinstance(r, dict)]
    return await generate_video(
        prompt=payload.prompt, size=size, model=payload.model or "veo3-fast",
        refs=refs, protocol=PROTOCOL_JIMENG, provider_id=provider_id,
        provider={"id": provider_id}, duration=payload.duration or 5,
    )
