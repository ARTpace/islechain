"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /assets/uploads, /assets/library
"""
from fastapi import HTTPException
from starlette.responses import FileResponse as StarletteFileResponse
import os
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/assets/uploads/{path:path}")
async def serve_local_upload(path: str):
    clean_path = path.replace("\\", "/")
    if ".." in clean_path:
        raise HTTPException(status_code=404, detail="File not found")
    full_path = os.path.abspath(os.path.join(_main.LOCAL_UPLOAD_DIR, clean_path))
    root = os.path.abspath(_main.LOCAL_UPLOAD_DIR)
    if not full_path.startswith(root):
        raise HTTPException(status_code=404, detail="File not found")
    if not os.path.exists(full_path) or not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    ext = os.path.splitext(full_path)[1].lower()
    media_type = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif",
        ".mp4": "video/mp4", ".webm": "video/webm",
    }.get(ext, "application/octet-stream")
    return StarletteFileResponse(full_path, media_type=media_type)

@router.get("/assets/library/{path:path}")
async def serve_asset_library(path: str):
    clean_path = path.replace("\\", "/")
    if ".." in clean_path:
        raise HTTPException(status_code=404, detail="File not found")
    full_path = os.path.abspath(os.path.join(_main.ASSET_LIBRARY_DIR, clean_path))
    root = os.path.abspath(_main.ASSET_LIBRARY_DIR)
    if not full_path.startswith(root):
        raise HTTPException(status_code=404, detail="File not found")
    if not os.path.exists(full_path) or not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    ext = os.path.splitext(full_path)[1].lower()
    media_type = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif",
        ".json": "application/json",
        ".zip": "application/zip",
    }.get(ext, "application/octet-stream")
    return StarletteFileResponse(full_path, media_type=media_type)
