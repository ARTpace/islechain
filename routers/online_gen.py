"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/online-image, /api/online-video, /api/canvas-video
"""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from fastapi import HTTPException
import asyncio, httpx, time, os, uuid
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
    duration: int = Field(default=5, ge=1, le=60)
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
    multimodal: bool = False
    generate_audio: bool = False
    conversation_id: str = ""
    message_id: str = ""


PROTOCOL_JIMENG = "jimeng"

@router.post("/api/canvas-video")
async def canvas_video_route(payload: CanvasVideoRequest, token: str = ""):
    return await build_canvas_video_result(payload, _main.require_valid_token(token))


def resolve_video_provider(payload):
    provider = _main.get_api_provider(payload.provider_id)
    if not provider or provider.get("enabled") is False:
        raise HTTPException(400, "所选视频平台未启用")
    if payload.model not in (provider.get("video_models") or []):
        raise HTTPException(400, "所选视频模型未启用，请在 API 设置中添加视频模型")
    if payload.aspect_ratio not in {"16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21", "keep_ratio", "adaptive"}:
        raise HTTPException(400, "视频比例无效")
    if payload.resolution not in {"", "480p", "720p", "1080p", "780P"}:
        raise HTTPException(400, "视频分辨率无效")
    return provider


async def build_canvas_video_result(payload, username, on_progress=None):
    from core.video_generation import generate_openai_video
    provider = resolve_video_provider(payload)
    protocol = _main.provider_protocol(provider)
    if protocol == "jimeng" or provider["id"] == "jimeng":
        result = await _main.generate_jimeng_video(payload, provider)
        urls = result.get("videos") or []
    else:
        provider = _main._resolve_image_provider(provider["id"])
        if protocol == "openai":
            if len(payload.images) > 1 or payload.videos or payload.audios:
                raise HTTPException(400, "OpenAI 视频接口支持一张参考图，暂不支持参考视频或音频")
            if payload.aspect_ratio in {"keep_ratio", "adaptive"}:
                raise HTTPException(400, "此视频通道需要明确的画面比例")
            reference = _main.reference_file_part(payload.images[0]) if payload.images else None
            if payload.images and not reference:
                raise HTTPException(400, "无法读取参考图，请使用工具中的图片或重新上传")
            result = await generate_openai_video(provider, payload, reference, on_progress)
            if result.get("content"):
                name = "chat_video_" + uuid.uuid4().hex + ".mp4"
                directory, prefix = _main.media_paths.resolve_media_dir(owner=_main.get_user_dirname(username) or "", feature="chat-video", kind="video", ext=name, root=_main.OUTPUT_DIR)
                with open(os.path.join(directory, name), "wb") as handle:
                    handle.write(result["content"])
                urls = [prefix + "/" + name]
            else:
                urls = [await _main.save_remote_video_to_output(result.get("url", ""), owner=_main.get_user_dirname(username) or "", feature="chat-video")]
        else:
            if payload.images:
                raise HTTPException(400, "此视频通道尚未接入图生视频，请选择 OpenAI 视频通道或即梦")
            result = await generate_video(payload.prompt, payload.size or payload.resolution or "1920x1080", payload.model, [], protocol=protocol, provider_id=provider["id"], provider=provider, duration=payload.duration)
            urls = [await _main.save_remote_video_to_output(result.get("value", ""), owner=_main.get_user_dirname(username) or "", feature="chat-video")]
    urls = [url for url in urls if url]
    if not urls:
        raise HTTPException(502, "视频模型没有返回视频")
    result = {"videos": urls, "model": payload.model, "provider_id": payload.provider_id, "prompt": payload.prompt, "timestamp": time.time()*1000, "type": "video"}
    _main.save_to_history({**result, "images": urls, "owner": username, "genParams": {"engine": "cloud", "model": payload.model, "provider": payload.provider_id, "duration": payload.duration, "ratio": payload.aspect_ratio, "resolution": payload.resolution}})
    return result


@router.get("/api/chat-video/models")
async def chat_video_models():
    providers = []
    for provider in _main.load_api_providers():
        if provider.get("enabled") is False or not provider.get("video_models"):
            continue
        protocol = _main.provider_protocol(provider)
        if protocol not in {"openai", "jimeng", "runninghub", "volcengine"}:
            continue
        public = _main.public_provider(provider)
        if protocol not in {"jimeng", "volcengine"} and not public.get("has_key"):
            continue
        providers.append({"id": provider["id"], "name": provider.get("name") or provider["id"], "models": provider["video_models"], "protocol": protocol, "image_to_video": protocol in {"openai", "jimeng"}})
    return {"providers": providers}


async def run_chat_video_task(task_id, payload, username, user_id):
    def progress(value):
        with _main.CANVAS_TASK_LOCK:
            _main.CANVAS_TASKS[task_id].update(progress=value, updated_at=time.time())
    with _main.CANVAS_TASK_LOCK:
        _main.CANVAS_TASKS[task_id]["status"] = "running"
    try:
        result = await build_canvas_video_result(payload, username, progress)
        _main.finish_chat_generation(payload.conversation_id, payload.message_id, user_id=user_id, videos=result["videos"])
        with _main.CANVAS_TASK_LOCK:
            _main.CANVAS_TASKS[task_id].update(status="succeeded", result=result, updated_at=time.time())
    except Exception as exc:
        detail = str(getattr(exc, "detail", None) or exc)[:500]
        _main.finish_chat_generation(payload.conversation_id, payload.message_id, user_id=user_id, error=detail)
        with _main.CANVAS_TASK_LOCK:
            _main.CANVAS_TASKS[task_id].update(status="failed", error=detail, updated_at=time.time())


@router.post("/api/chat-video/tasks")
async def create_chat_video_task(payload: CanvasVideoRequest, token: str = ""):
    username = _main.require_valid_token(token)
    user_id = _main.account_dirname(username)
    resolve_video_provider(payload)
    if payload.conversation_id or payload.message_id:
        conversation = _main.load_conversation(user_id, payload.conversation_id)
        message = next((item for item in conversation.get("messages", []) if item.get("id") == payload.message_id and item.get("role") == "assistant"), None)
        if not message:
            raise HTTPException(404, "找不到这条对话消息")
        message["pending_generation"] = {"boot_id": _main.APP_BOOT_ID, "kind": "video", "created_at": _main.now_ms()}
        message.pop("generation_error", None)
        _main.save_conversation(user_id, conversation)
    task_id = "chat_video_" + uuid.uuid4().hex
    with _main.CANVAS_TASK_LOCK:
        _main.CANVAS_TASKS[task_id] = {"id": task_id, "owner": username, "type": "video", "status": "queued", "progress": {}, "created_at": time.time(), "updated_at": time.time(), "error": "", "result": None}
    asyncio.create_task(run_chat_video_task(task_id, payload, username, user_id))
    return {"task_id": task_id, "status": "queued"}


@router.get("/api/chat-video/tasks/{task_id}")
async def get_chat_video_task(task_id: str, token: str = ""):
    username = _main.require_valid_token(token)
    with _main.CANVAS_TASK_LOCK:
        task = dict(_main.CANVAS_TASKS.get(task_id) or {})
    if not task or task.get("type") != "video":
        raise HTTPException(404, "视频任务不存在，服务可能已重启")
    if task.get("owner") != username:
        raise HTTPException(403, "无权访问此视频任务")
    return task
