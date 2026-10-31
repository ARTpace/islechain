"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/animadex
"""
import json, os
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/api/animadex/characters")
async def get_animadex_characters(
    copyright: str = "",
    limit: int = 200
):
    """获取角色数据(用于头像映射)。

    2026-10-31 起改走 character_packs 索引：不再整份加载 21MB 单文件，
    也不再在内存里常驻整份 dict。字段名对前端保持兼容（补 slug / thumb_url）。
    """
    import character_packs as _chars

    items = _chars.merged_index().get("items") or []

    # 按 copyright 过滤
    if copyright:
        items = [c for c in items if c.get("copyright") == copyright]

    characters = []
    for item in items[:max(0, int(limit))]:
        row = dict(item)
        row.setdefault("slug", item.get("id"))
        if not row.get("thumb_url"):
            row["thumb_url"] = item.get("thumb") or _chars.thumb_url_of(item.get("trigger", ""))
        characters.append(row)

    return {"characters": characters, "count": len(characters)}


_artist_thumb_cache = {}
_artist_thumb_sem = None


def _artist_thumb_dir():
    folder = os.path.join(_main.USER_DATA_DIR, "artist-thumbs")
    os.makedirs(folder, exist_ok=True)
    return folder


def _artist_thumb_path(name: str):
    import hashlib
    digest = hashlib.sha1(name.encode("utf-8")).hexdigest()
    return os.path.join(_artist_thumb_dir(), digest + ".img")


def _thumb_semaphore():
    global _artist_thumb_sem
    if _artist_thumb_sem is None:
        import asyncio
        _artist_thumb_sem = asyncio.Semaphore(6)
    return _artist_thumb_sem


@router.get("/api/animadex/artist-thumb")
async def artist_thumb(name: str = ""):
    """画师图床已失效时，改由本机取一张作品预览并缓存。"""
    from urllib.parse import quote
    from fastapi import HTTPException
    from fastapi.responses import Response
    import httpx

    name = (name or "").strip()
    if not name or len(name) > 120:
        raise HTTPException(status_code=404, detail="未找到画师缩略图")
    path = _artist_thumb_path(name)
    if os.path.isfile(path) and os.path.getsize(path) > 100:
        with open(path, "rb") as handle:
            body = handle.read()
        return Response(content=body, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800"})

    headers = {"User-Agent": "art-canvas"}
    async with _thumb_semaphore():
        if os.path.isfile(path) and os.path.getsize(path) > 100:
            with open(path, "rb") as handle:
                body = handle.read()
            return Response(content=body, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800"})
        preview = _artist_thumb_cache.get(name)
        if preview is None:
            tag = name.replace(" ", "_")
            api = "https://safebooru.org/index.php?page=dapi&s=post&q=index&limit=1&json=1&tags=" + quote(tag)
            preview = ""
            try:
                async with httpx.AsyncClient(timeout=12, follow_redirects=True, headers=headers) as client:
                    resp = await client.get(api)
                data = resp.json() if resp.status_code == 200 else []
                if isinstance(data, list) and data:
                    preview = (data[0].get("preview_url") or data[0].get("sample_url") or "").replace("\\/", "/")
                    if preview.startswith("//"):
                        preview = "https:" + preview
            except Exception:
                preview = ""
            _artist_thumb_cache[name] = preview
        if not preview:
            raise HTTPException(status_code=404, detail="未找到画师缩略图")
        try:
            async with httpx.AsyncClient(timeout=12, follow_redirects=True, headers=headers) as client:
                image = await client.get(preview)
        except Exception:
            raise HTTPException(status_code=404, detail="未找到画师缩略图")
        media = (image.headers.get("content-type") or "").split(";")[0].strip().lower()
        if image.status_code != 200 or not media.startswith("image/") or len(image.content) < 100:
            raise HTTPException(status_code=404, detail="未找到画师缩略图")
        try:
            with open(path, "wb") as handle:
                handle.write(image.content)
        except Exception:
            pass
        return Response(content=image.content, media_type=media, headers={"Cache-Control": "public, max-age=604800"})
