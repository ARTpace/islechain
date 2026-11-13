"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/media-preview, /api/cloud-video/upload, /api/ai/import-local-image
"""
from fastapi.responses import FileResponse
from fastapi import HTTPException, Request
from PIL import Image, ImageOps
import asyncio, os
from fastapi import APIRouter

import main as _main

router = APIRouter()
from core.image_cutout import router as cutout_router
router.include_router(cutout_router)


def _preview_cache_headers(path: str) -> dict:
    # 预览文件名含原图路径、修改时间和尺寸的哈希，内容变了地址就变，可以长期缓存。
    return {
        "Cache-Control": "public, max-age=2592000, immutable",
        "ETag": f'"{_main._etag_for(path)}"',
    }


@router.get("/api/media-preview")
async def media_preview(url: str, w: int = 512):
    # ComfyUI 图片(如 /api/comfyui/view?filename=...)直接走 ComfyUI 代理缩略图
    if url.startswith("/api/comfyui/view"):
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        filename = qs.get("filename", [""])[0]
        subfolder = qs.get("subfolder", [""])[0]
        ctype = qs.get("type", ["output"])[0]
        return await _main.proxy_comfyui_view(filename=filename, subfolder=subfolder, type=ctype, w=w)

    if url.startswith("/output/"):
        _main.assert_account_media(url[len("/output/"):])
    elif url.startswith("/assets/"):
        _main.assert_account_media(url[len("/assets/"):])
    path = _main.output_file_from_url(url)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="媒体文件不存在")

    width = max(64, min(2048, int(w or 512)))
    webp_path, png_path = _main.media_preview_cache_paths(path, width)

    if os.path.exists(webp_path):
        return FileResponse(webp_path, media_type="image/webp", headers=_preview_cache_headers(webp_path))
    if os.path.exists(png_path):
        return FileResponse(png_path, media_type="image/png", headers=_preview_cache_headers(png_path))

    try:
        os.makedirs(_main.MEDIA_PREVIEW_DIR, exist_ok=True)
        if _main.is_video_preview_file(path):
            img = await asyncio.to_thread(_main.generate_video_preview_image, path, width)
        else:
            await asyncio.to_thread(_main._prewarm_thumbnails, path, (width,))
            if os.path.exists(webp_path):
                return FileResponse(webp_path, media_type="image/webp", headers=_preview_cache_headers(webp_path))
            if os.path.exists(png_path):
                return FileResponse(png_path, media_type="image/png", headers=_preview_cache_headers(png_path))
            raise HTTPException(status_code=415, detail="无法生成图片预览")

        def _save_preview():
            try:
                img.save(webp_path, format="WEBP", quality=88)
                return webp_path, "image/webp"
            except Exception:
                img.save(png_path, format="PNG", optimize=True)
                return png_path, "image/png"
        saved_path, saved_type = await asyncio.to_thread(_save_preview)
        return FileResponse(saved_path, media_type=saved_type, headers=_preview_cache_headers(saved_path))
    except Exception as exc:
        raise HTTPException(status_code=415, detail=f"无法生成预览图:{exc}") from exc

# --- 缓存管理 API ---

# --- 云视频上传 API ---

@router.post("/api/cloud-video/upload")
async def cloud_video_upload(payload: _main.CloudVideoUploadRequest, request: Request):
    _main.ensure_same_origin_request(request)
    return await _main.upload_local_video_to_cloud(payload.url, payload.service)

# --- 本地图片导入 API ---

@router.post("/api/ai/import-local-image")
async def import_local_ai_reference(payload: _main.LocalImageImportRequest, request: Request):
    _main.ensure_same_origin_request(request)
    requested = [payload.path] if payload.path else []
    requested.extend(payload.paths or [])
    requested = [p for p in requested if str(p or "").strip()][:20]
    if not requested:
        raise HTTPException(status_code=400, detail="没有可导入的本地图片")
    return {"files": [_main.import_local_image_file(_main.normalize_local_image_path(path)) for path in requested]}

# --- 视频裁剪 API ---
# 画布双击视频节点走这里；以后任何需要「取一段视频」的节点/面板都复用该端点，
# 前端统一用 static/modules/video-trimmer.js。

class MediaTrimRequest(_main.BaseModel):
    url: str = ""
    start: float = 0
    end: float = 0
    filename: str = ""


@router.post("/api/media/trim")
async def trim_media(payload: MediaTrimRequest):
    """按时间区间裁剪本地素材，输出到 output 目录并返回新 url。"""
    import shutil, subprocess, time

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise HTTPException(status_code=500, detail="未找到 ffmpeg，无法裁剪视频")
    source = _main.output_file_from_url(payload.url)
    if not source:
        raise HTTPException(status_code=400, detail="裁剪只支持本地素材（/output 或 /assets 下的文件）")
    start = max(0.0, float(payload.start or 0))
    end = float(payload.end or 0)
    if end and end - start < 0.05:
        raise HTTPException(status_code=400, detail="选区太短，请重新选择起止时间")
    stem = os.path.splitext(os.path.basename(source))[0]
    default_name = f"{stem}-trim-{int(start)}-{int(end) if end else 0}.mp4"
    filename = _main.sanitize_export_filename(payload.filename or default_name, default_name)
    if not filename.lower().endswith(".mp4"):
        filename += ".mp4"
    output_path = _main.output_path_for(filename, "output")
    if os.path.exists(output_path):
        filename = _main.sanitize_export_filename(
            f"{os.path.splitext(filename)[0]}-{time.strftime('%H%M%S')}.mp4", default_name
        )
        output_path = _main.output_path_for(filename, "output")
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-i", source]
    if end > start:
        cmd += ["-t", f"{end - start:.3f}"]
    cmd += [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart", output_path,
    ]
    proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=(proc.stderr or "视频裁剪失败").strip()[:300])
    return {
        "url": _main.output_url_for(filename, "output"),
        "name": filename,
        "kind": "video",
        "start": start,
        "end": end,
        "duration": max(0.0, end - start) if end else None,
    }
