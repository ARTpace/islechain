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

    path = _main.output_file_from_url(url)
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="媒体文件不存在")

    width = max(64, min(2048, int(w or 512)))
    webp_path, png_path = _main.media_preview_cache_paths(path, width)

    if os.path.exists(webp_path):
        return FileResponse(webp_path, media_type="image/webp")
    if os.path.exists(png_path):
        return FileResponse(png_path, media_type="image/png")

    try:
        os.makedirs(_main.MEDIA_PREVIEW_DIR, exist_ok=True)
        if _main.is_video_preview_file(path):
            img = await asyncio.to_thread(_main.generate_video_preview_image, path, width)
        else:
            def _process_image():
                with Image.open(path) as source:
                    img = ImageOps.exif_transpose(source)
                    img.thumbnail((width, width), Image.BILINEAR)
                    return img.convert("RGBA" if _main.image_has_alpha(img) else "RGB")
            img = await asyncio.to_thread(_process_image)

        def _save_preview():
            try:
                img.save(webp_path, format="WEBP", quality=88)
                return webp_path, "image/webp"
            except Exception:
                img.save(png_path, format="PNG", optimize=True)
                return png_path, "image/png"
        saved_path, saved_type = await asyncio.to_thread(_save_preview)
        # 浏览器缓存:文件名含 mtime+size 哈希,内容变了 key 就变,可以安全长缓存
        etag = _main._etag_for(saved_path)
        headers = {
            "Cache-Control": "public, max-age=2592000, immutable",
            "ETag": f'"{etag}"',
        }
        return FileResponse(saved_path, media_type=saved_type, headers=headers)
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
