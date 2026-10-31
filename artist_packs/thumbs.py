"""画师图片的本地缓存与下载。

图片本身不随包分发（4.2 万张约 4.8GB），默认由浏览器直连官方 CDN ——
CDN 已声明 `Cache-Control: immutable, max-age=1年`，二次访问零延迟。

本模块只负责兜底：浏览器直连失败时（断网、CDN 被墙、某个域名解析不了），
由后端代为取回并落盘缓存，下次直接读本地文件。

缓存策略：
    目录   <用户数据目录>/artist-thumbs/
    命名   sha1(imageId).bin，内容类型靠嗅探，不依赖扩展名
    上限   800 个文件（约 90MB），超出按访问时间淘汰最旧的
"""

import hashlib
import os
import time
from pathlib import Path
from typing import Optional

from core.user_paths import user_data_dir

MAX_CACHE_FILES = 800
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) art-canvas"


def cache_dir() -> Path:
    folder = Path(user_data_dir()) / "artist-thumbs"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def cache_path(image_id: str) -> Path:
    digest = hashlib.sha1(str(image_id).encode("utf-8")).hexdigest()
    return cache_dir() / (digest + ".bin")


def read_cached(image_id: str) -> Optional[bytes]:
    path = cache_path(image_id)
    try:
        if path.is_file() and path.stat().st_size > 100:
            # 触碰一下 mtime，让淘汰策略按"最近使用"而不是"最近写入"
            os.utime(path, None)
            return path.read_bytes()
    except OSError:
        return None
    return None


def write_cached(image_id: str, data: bytes) -> None:
    if not data or len(data) < 100:
        return
    path = cache_path(image_id)
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    except OSError:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        return
    prune()


def prune(max_files: int = MAX_CACHE_FILES) -> None:
    """超过上限时删除最久未使用的文件。"""
    folder = cache_dir()
    try:
        files = [p for p in folder.glob("*.bin") if p.is_file()]
    except OSError:
        return
    if len(files) <= max_files:
        return
    files.sort(key=lambda p: p.stat().st_mtime)
    for path in files[: len(files) - max_files]:
        try:
            path.unlink()
        except OSError:
            pass


def media_type_of(data: bytes) -> str:
    """按文件头判断图片类型，避免缓存文件名丢掉扩展名后返回错类型。"""
    if data[:4] == b"\x89PNG":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[4:8] == b"ftyp":
        brand = data[8:12]
        if brand in (b"avif", b"avis"):
            return "image/avif"
        if brand in (b"heic", b"heix", b"mif1"):
            return "image/heic"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return "image/webp"


def download(url: str, timeout: float = 15.0) -> Optional[bytes]:
    """同步取一张图；失败返回 None（调用方据此回 404，前端退化成首字母头像）。"""
    if not url:
        return None
    try:
        import httpx

        with httpx.Client(timeout=timeout, follow_redirects=True,
                          headers={"User-Agent": UA}) as client:
            resp = client.get(url)
        if resp.status_code != 200 or len(resp.content) < 100:
            return None
        media = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        if media and not media.startswith("image/"):
            return None
        return resp.content
    except Exception:
        return None
