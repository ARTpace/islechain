"""OpenAI-compatible video jobs. Submit once; polling never resubmits a paid job."""
import asyncio
import time
from urllib.parse import quote

import httpx
from fastapi import HTTPException


def video_size(ratio, resolution="720p"):
    long_edge = {"480p": 854, "720p": 1280, "1080p": 1920}.get(resolution or "720p", 1280)
    width, height = map(int, ratio.split(":"))
    if width >= height:
        return f"{long_edge}x{round(long_edge * height / width / 2) * 2}"
    return f"{round(long_edge * width / height / 2) * 2}x{long_edge}"


async def generate_openai_video(provider, payload, reference_file=None, on_progress=None):
    base = str(provider.get("base_url") or "").rstrip("/")
    if not base.endswith("/v1"):
        base += "/v1"
    headers = {"Authorization": "Bearer " + provider["api_key"]}
    fields = {"model": payload.model, "prompt": payload.prompt, "seconds": str(payload.duration),
              "size": payload.size or video_size(payload.aspect_ratio, payload.resolution)}
    # Multipart is the OpenAI Videos contract, including text-only requests.
    files = {key: (None, value) for key, value in fields.items()}
    if reference_file:
        files["input_reference"] = reference_file
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        response = await client.post(base + "/videos", headers=headers, files=files)
        response.raise_for_status()
        state = response.json()
        deadline = time.monotonic() + 1800
        while True:
            data = state.get("data") if isinstance(state.get("data"), dict) else state
            status = str(data.get("status") or "").lower()
            if on_progress:
                on_progress({"stage": status or "queued", "progress": data.get("progress")})
            if status in {"failed", "error", "cancelled", "canceled"}:
                error = data.get("error") or "视频任务失败"
                if isinstance(error, dict):
                    error = error.get("message") or "视频任务失败"
                raise HTTPException(502, str(error)[:500])
            url = data.get("video_url") or data.get("url")
            if url and (not status or status in {"completed", "succeeded", "success"}):
                return {"url": url}
            task_id = str(data.get("id") or data.get("task_id") or "")
            if not task_id:
                raise HTTPException(502, "视频接口没有返回任务 ID 或视频地址，请检查该通道是否兼容 OpenAI Videos API")
            task_url = base + "/videos/" + quote(task_id, safe="")
            if status in {"completed", "succeeded", "success"}:
                content = await client.get(task_url + "/content", headers=headers)
                content.raise_for_status()
                if not content.headers.get("content-type", "").lower().startswith(("video/", "application/octet-stream")):
                    raise HTTPException(502, "视频下载接口没有返回视频文件")
                return {"content": content.content}
            if time.monotonic() >= deadline:
                raise HTTPException(504, "视频生成超时，未重复提交任务")
            await asyncio.sleep(3)
            response = await client.get(task_url, headers=headers)
            response.raise_for_status()
            state = response.json()
