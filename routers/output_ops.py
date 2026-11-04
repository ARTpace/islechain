"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/view, /api/download-output, /api/open-output-folder, /api/delete-output-file, /api/scan-output, /api/upload, /api/ai/upload
"""
from fastapi import File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from typing import List
from urllib.parse import quote
from starlette.responses import Response
import asyncio, os, requests, subprocess, uuid
import mimetypes
from fastapi import APIRouter
from pydantic import BaseModel, Field

import main as _main
from core import image_stitch

router = APIRouter()


def download_disposition(filename: str, inline: bool = False) -> str:
    # 中文文件名使用 RFC 5987 编码，避免响应头的 Latin-1 编码失败。
    return f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{quote(filename, safe='')}"


def download_filename(name: str, source: str, content_type: str = '') -> str:
    filename = os.path.basename(name or source) or 'image'
    # ponytail: display names (including model names ending in .0) are not file extensions.
    if not mimetypes.guess_type(filename)[0]:
        extension = os.path.splitext(source)[1] if mimetypes.guess_type(source)[0] else ''
        extension = extension or mimetypes.guess_extension(content_type.split(';')[0].strip()) or ''
        filename += extension
    return filename


@router.get("/api/view")
def view_image(filename: str, type: str = "input", subfolder: str = ""):
    for addr in _main.COMFYUI_INSTANCES:
        try:
            url = f"http://{addr}/view"
            params = {"filename": filename, "type": type, "subfolder": subfolder}
            r = requests.get(url, params=params, timeout=1)
            if r.status_code == 200:
                return Response(content=r.content, media_type=r.headers.get('Content-Type'))
        except Exception:
            continue
    raise HTTPException(status_code=404, detail="Image not found on any available backend")

@router.get("/api/download-output")
async def download_output(url: str, name: str = "", inline: bool = False):
    path = _main.output_file_from_url(url)
    if path:
        filename = download_filename(name, path, _main.content_type_for_path(path))
        return FileResponse(path, media_type=_main.content_type_for_path(path), filename=filename,
            headers={"Content-Disposition": download_disposition(filename, inline)})
    # 远程 URL：proxy 下载
    if url and (url.startswith("http://") or url.startswith("https://")):
        import httpx
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                content = resp.content
            filename = download_filename(name, url.split("?")[0], resp.headers.get('content-type', 'image/png'))
            return Response(content=content, media_type=resp.headers.get("content-type", "image/png"),
                headers={"Content-Disposition": download_disposition(filename, inline)})
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"下载远程图片失败: {e}")
    raise HTTPException(status_code=404, detail="文件不存在")


@router.get("/api/open-output-folder")
async def open_output_folder(path: str = ""):
    """在资源管理器中打开 output 目录中的图片所在文件夹"""
    safe_path = os.path.normpath(path).lstrip("\\/").lstrip("/")
    full_path = os.path.join(_main.OUTPUT_DIR, safe_path)
    folder = os.path.dirname(full_path) if os.path.isfile(full_path) else full_path
    if not os.path.exists(folder):
        raise HTTPException(status_code=404, detail=f"目录不存在: {folder}")
    try:
        if os.path.isfile(full_path):
            subprocess.Popen(["explorer", "/select,", full_path])
        else:
            subprocess.Popen(["explorer", folder])
        return {"ok": True, "path": full_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"打开文件夹失败: {str(e)}")


@router.get("/api/delete-output-file")
async def delete_output_file(path: str = ""):
    """删除 output 目录中的图片文件"""
    safe_path = os.path.normpath(path).lstrip("\\/").lstrip("/")
    full_path = os.path.join(_main.OUTPUT_DIR, safe_path)
    output_root = os.path.abspath(_main.OUTPUT_DIR)
    if not os.path.abspath(full_path).startswith(output_root):
        raise HTTPException(status_code=403, detail="不允许删除 output 目录之外")
    if not os.path.isfile(full_path):
        return {"ok": False, "error": "文件不存在", "path": full_path}
    try:
        os.remove(full_path)
        return {"ok": True, "path": full_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")


@router.get("/api/scan-output")
async def scan_output_folder(token: str = ""):
    """扫描当前登录用户的 rmbg output 目录下的图片"""
    username = _main.get_username_by_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="未登录")
    user_dir = _main.get_user_dirname(username)
    # 目录名由注册表决定，不要在路由里写死中文目录
    scan_root = os.path.join(
        _main.OUTPUT_DIR, user_dir,
        _main.media_paths.type_of("抠图"), _main.media_paths.folder_of("抠图"))
    if not os.path.isdir(scan_root):
        return {"images": []}
    images = []
    exts = {".png", ".jpg", ".jpeg", ".webp"}
    for root, dirs, files in os.walk(scan_root):
        for f in sorted(files, reverse=True):
            ext = os.path.splitext(f)[1].lower()
            if ext in exts:
                rel = os.path.relpath(os.path.join(root, f), _main.OUTPUT_DIR)
                url_path = "/output/" + rel.replace("\\", "/")
                mtime = os.path.getmtime(os.path.join(root, f))
                images.append({"url": url_path, "filename": f, "path": rel, "mtime": int(mtime * 1000)})
    images.sort(key=lambda x: x["mtime"], reverse=True)
    return {"images": images[:500]}


@router.post("/api/upload")
async def upload_image(files: List[UploadFile] = File(...)):
    uploaded_files = []
    files_content = []
    for file in files:
        content = await file.read()
        files_content.append((file, content))

    for file, content in files_content:
        success_count = 0
        last_result = None
        for addr in _main.COMFYUI_INSTANCES:
            try:
                files_data = {'image': (file.filename, content, file.content_type)}
                response = requests.post(f"http://{addr}/upload/image", files=files_data, timeout=5)
                if response.status_code == 200:
                    last_result = response.json()
                    success_count += 1
            except Exception as e:
                print(f"Upload error for {addr}: {e}")

        if success_count > 0 and last_result:
            uploaded_files.append({"comfy_name": last_result.get("name", file.filename)})
        else:
            raise HTTPException(status_code=500, detail="Failed to upload to any backend")

    return {"files": uploaded_files}

@router.post("/api/ai/upload")
async def upload_ai_reference(files: List[UploadFile] = File(...), canvas_id: str = Form(None), token: str = Form("")):
    username = _main.get_username_by_token(token)
    canvas = None
    if canvas_id:
        try:
            canvas = _main.load_canvas(canvas_id)
        except:
            pass

    if canvas:
        canvas_output_dir = _main.get_canvas_output_dir(canvas)
    elif username:
        canvas_output_dir, _ = _main.get_user_output_dir(username)
    else:
        canvas_output_dir = _main.OUTPUT_DIR
    os.makedirs(canvas_output_dir, exist_ok=True)

    uploaded = []
    for file in files:
        content = await file.read()
        if not content:
            continue
        ext = os.path.splitext(file.filename or "")[1].lower()
        _IMG_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}
        _VID_EXTS = {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"}
        _AUD_EXTS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}
        if ext not in (_IMG_EXTS | _VID_EXTS | _AUD_EXTS):
            content_type = (file.content_type or "").lower()
            if content_type.startswith("video/"):
                ext = {"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "video/x-matroska": ".mkv"}.get(content_type, ".mp4")
            elif content_type.startswith("audio/"):
                ext = {"audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/flac": ".flac", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/aac": ".aac"}.get(content_type, ".mp3")
            else:
                ext = ".jpg" if "jpeg" in content_type else ".webp" if "webp" in content_type else ".png"
        filename = f"ai_ref_{uuid.uuid4().hex[:12]}{ext}"
        path = os.path.join(canvas_output_dir, filename)
        with open(path, "wb") as f:
            f.write(content)
        url_path = _main.build_output_url(canvas, filename, username)
        uploaded.append({"url": url_path, "name": file.filename or filename})
    return {"files": uploaded}


class MergeHorizontalRequest(BaseModel):
    """横向拼接请求：urls 必须是已落盘的 /output/ 或 /assets/ 路径。"""
    urls: List[str] = Field(default_factory=list)
    feature: str = Field(default='拼图', max_length=40)
    token: str = Field(default='', max_length=2000)
    gap: int = Field(default=0, ge=0, le=200)
    background: str = Field(default='', max_length=20)


@router.post("/api/output/merge-horizontal")
async def merge_horizontal_images(request: MergeHorizontalRequest):
    """把多张 output 图横向拼成一张，返回新图 URL。

    三视图这类「同一物体多视角」出图后走这里合成一条横图，下游直接吃一张。
    落盘沿用 media_paths（output/{owner}/image/{feature}/{date}/），和单图同目录。
    """
    if not 2 <= len(request.urls) <= 12:
        raise HTTPException(status_code=400, detail='需要 2~12 张图片才能横向拼接')

    paths = []
    for url in request.urls:
        path = _main.output_file_from_url(url)
        if not path or not os.path.isfile(path):
            raise HTTPException(status_code=400, detail=f'图片不存在: {url}')
        paths.append(path)

    flatten = image_stitch.parse_color(request.background)
    try:
        merged = image_stitch.stitch_files(paths, gap=request.gap, flatten=flatten)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'拼接失败: {str(e)}')

    feature = (request.feature or '拼图').strip()
    username = _main.get_username_by_token(request.token)
    owner = _main.get_user_dirname(username) or ''
    save_dir, url_prefix = _main.media_paths.resolve_media_dir(
        owner=owner, feature=feature, kind='image', ext='.png', root=_main.OUTPUT_DIR)
    name = f"{_main.media_paths.sanitize_segment(feature)}_merge_{uuid.uuid4().hex[:10]}.png"
    local_path = os.path.join(save_dir, name)
    try:
        merged.save(local_path, 'PNG', optimize=True)
        size = merged.size
    finally:
        merged.close()

    asyncio.create_task(asyncio.to_thread(_main._prewarm_thumbnails, local_path, (600, 768, 1536)))
    return {"url": f"{url_prefix}/{name}", "path": local_path,
            "width": size[0], "height": size[1]}
