"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/animadex
"""
import json

from fastapi import APIRouter

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


@router.get("/api/animadex/artist-thumb")
def artist_thumb(name: str = "", slug: str = ""):
    """画师图片（旧路径，保留兼容）。

    2026-10-31 起不再逐个请求 safebooru —— 那种做法对 4 万画师等于必然失败。
    现在按 slug/tag 从画师包索引里取 imageId，拼官方 CDN 地址，
    直连失败时由本地缓存兜底。实现见 routers/artists.py。
    """
    from routers.artists import artists_thumb

    return artists_thumb(slug=slug, name=name)
