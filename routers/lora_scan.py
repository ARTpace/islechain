"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/_dbug, /api/loras
"""
from fastapi.responses import FileResponse
from fastapi import HTTPException, Request
from starlette.responses import Response
import socket as _sock, httpx, os
from datetime import datetime, timezone
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/api/_dbug")
async def _dbug():
    import traceback as _tb_
    r = {}
    # 0) COMFYUI_ADDRESS 的真面目
    r["address_repr"] = repr(_main.COMFYUI_ADDRESS)
    # 1) 原生 socket
    try:
        s = _sock.create_connection(("127.0.0.1", 8188), timeout=5); s.close()
        r["raw"] = "OK"
    except Exception as e:
        r["raw"] = f"{type(e).__name__}: {e}"; r["raw_tb"] = _tb_.format_exc()
    # 2) httpx GET system_stats
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            resp = await c.get(f"http://{_main.COMFYUI_ADDRESS}/system_stats")
        r["httpx_get"] = f"OK {resp.status_code}"
    except Exception as e:
        r["httpx_get"] = f"{type(e).__name__}: {e}"; r["httpx_get_tb"] = _tb_.format_exc()
    # 3) httpx POST prompt (同生成)
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            resp = await c.post(f"http://{_main.COMFYUI_ADDRESS}/prompt", json={"prompt":{},"client_id":"_dbug"})
        r["httpx_post"] = f"OK {resp.status_code}"
    except Exception as e:
        r["httpx_post"] = f"{type(e).__name__}: {e}"; r["httpx_post_tb"] = _tb_.format_exc()
    return r

@router.get("/api/loras/scan")
def scan_lora_folder(subfolder: str = ""):
    # 同步路由由 FastAPI 在线程池运行，目录扫描不阻塞其他页面和对话请求。
    """直接扫描本地 LoRA 文件夹获取完整列表(不依赖 ComfyUI 节点枚举)"""
    if not _main.COMFYUI_BASE_PATH:
        raise HTTPException(status_code=400, detail="未配置 COMFYUI_BASE_PATH")
    # 兼容两种路径:ComfyUI 根目录 或 已经是 loras 文件夹
    normalized = _main.COMFYUI_BASE_PATH.lower().replace("\\", "/").rstrip("/")
    if normalized.endswith("/models/loras"):
        lora_dir = _main.COMFYUI_BASE_PATH
    else:
        lora_dir = os.path.join(_main.COMFYUI_BASE_PATH, "models", "loras")
    if subfolder:
        lora_dir = os.path.join(lora_dir, subfolder)
    if not os.path.isdir(lora_dir):
        return {"loras": [], "error": f"目录不存在: {lora_dir}"}
    extensions = {".safetensors", ".pt", ".pth", ".ckpt", ".bin"}
    loras = []
    previews = {}  # rel_path -> preview_url
    # entries: 每条 LoRA 的完整信息(含 modelRoot / versionLabel,用于前端版本合并)
    entries = []

    # 版本号识别:剥掉文件 basename 末尾的「下划线或连字符」接版本号,剩余部分即"模型根名"
    # 覆盖:xxx_v1 / xxx-v11 / xxx_v0.1 / xxx-v2.3
    import re as _re
    _VERSION_TAIL_RE = _re.compile(r'[-_][vV](\d+(?:\.\d+)*)$')

    def _split_model_root(base_name: str):
        m = _VERSION_TAIL_RE.search(base_name)
        if m:
            return base_name[: m.start()], m.group(0).lstrip('_-')  # 根名 + 标签如 v11
        return base_name, ''

    for root, dirs, files in os.walk(lora_dir):
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in extensions:
                # 计算相对于 loras 目录的路径
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, lora_dir)
                # 统一用反斜杠(ComfyUI 格式)
                rel_path_bs = rel_path.replace("/", "\\")
                loras.append(rel_path_bs)
                # 检查是否有预览(同名的图片或视频)
                # 视频后缀也作为"预览"返回,对齐 ComfyUI-Lora-Manager 的 find_preview_file 行为
                base = os.path.splitext(full_path)[0]
                # 顺序:长后缀优先(.preview.png 优先于 .png),视频后缀与图片后缀混排
                for preview_ext in [
                    ".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp",
                    ".preview.mp4", ".preview.webm",
                    ".png", ".jpg", ".jpeg", ".webp",
                    ".mp4", ".webm", ".gif"
                ]:
                    preview_path = base + preview_ext
                    if os.path.isfile(preview_path):
                        # 返回相对于 ComfyUI 根目录的路径
                        preview_rel = os.path.relpath(preview_path, _main.COMFYUI_BASE_PATH).replace("\\", "/")
                        previews[rel_path_bs] = f"/api/loras/preview?path={preview_rel}"
                        break
                # 拆分 modelRoot + versionLabel,用于前端合并多版本
                file_stem = os.path.splitext(f)[0]
                model_root, version_label = _split_model_root(file_stem)
                try:
                    _mtime = os.path.getmtime(full_path)
                except OSError:
                    _mtime = 0
                entries.append({
                    "name": rel_path_bs,
                    "modelRoot": model_root,
                    "versionLabel": version_label,
                    # 文件修改时间(秒,浮点),供前端 "按 LoRA 添加时间" 排序使用
                    "mtime": _mtime,
                })
    return {
        "loras": sorted(loras),
        "count": len(loras),
        "path": lora_dir,
        "previews": previews,
        "entries": entries,  # 含 modelRoot/versionLabel,供前端版本合并
    }

@router.get("/api/loras/preview")
async def get_lora_preview(path: str, request: Request):
    """获取 LoRA 预览图"""
    if not _main.COMFYUI_BASE_PATH:
        raise HTTPException(status_code=400, detail="未配置 COMFYUI_BASE_PATH")
    # 安全校验:防止路径遍历
    if ".." in path:
        raise HTTPException(status_code=400, detail="无效路径")
    full_path = os.path.join(_main.COMFYUI_BASE_PATH, path)
    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="预览图不存在")
    # ETag + Last-Modified 走条件请求,重复访问秒返 304
    try:
        st = os.stat(full_path)
        mtime_ts = int(st.st_mtime)
        size = st.st_size
        etag = f'W/"lora-{mtime_ts}-{size}"'
        last_modified = datetime.fromtimestamp(mtime_ts, tz=timezone.utc).strftime('%a, %d %b %Y %H:%M:%S GMT')
    except OSError:
        etag = None
        last_modified = None
    if etag and request.headers.get('if-none-match') == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=604800, immutable"})
    if last_modified and request.headers.get('if-modified-since') == last_modified:
        return Response(status_code=304, headers={"Last-Modified": last_modified, "Cache-Control": "public, max-age=604800, immutable"})
    ext = os.path.splitext(full_path)[1].lower()
    media_type = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
        ".gif": "image/gif",
        ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime"
    }.get(ext, "image/png")
    # 视频走分块传输 + 接受 Range 请求,便于 <video> 拖动进度
    resp = FileResponse(
        full_path,
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=604800, immutable",
            "Accept-Ranges": "bytes",
        }
    )
    if etag: resp.headers["ETag"] = etag
    if last_modified: resp.headers["Last-Modified"] = last_modified
    return resp
