"""画师包接口：索引、详情、图片兜底、包管理。

数据全部来自 artist_packs（已装包合并后的索引），
不再像旧实现那样让前端去拉 8.6MB 的 artist_data.js。

接口约定：
    GET  /api/artists/index      合并索引，前端首屏一次拉取（带 ETag）
    GET  /api/artists/detail     单个画师（含完整图片地址）
    GET  /api/artists/thumb      图片兜底代理（CDN 直连失败时才走这里）
    GET  /api/artists/packs      已装/可装包状态
    POST /api/artists/packs/import            导入本地 zip
    POST /api/artists/packs/install-official  一键安装官方包
    GET  /api/artists/packs/{id}/download     导出已安装包
    DEL  /api/artists/packs/{id}              卸载用户包
"""

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response

import artist_packs as _artists
from artist_packs import thumbs
from routers.content_pack_routes import register_pack_routes

router = APIRouter()


@router.get("/api/artists/index")
def artists_index(request: Request):
    """合并所有已装画师包的索引。"""
    token = _artists.version_token()
    if request.headers.get("if-none-match") == token:
        return Response(status_code=304, headers={"ETag": token})
    return JSONResponse(
        _artists.merged_index(),
        headers={"ETag": token, "Cache-Control": "no-cache"},
    )


@router.get("/api/artists/detail")
def artist_detail(artist_id: str = Query("", alias="id")):
    """单个画师（含图片完整地址），供详情面板与「复制提示词」使用。"""
    entry = _artists.index_entry((artist_id or "").strip())
    if not entry:
        return JSONResponse({"error": "未找到画师", "id": artist_id}, status_code=404)
    payload = _artists.merged_index()
    merged = dict(entry)
    # 界面上显示的名字就是提示词去掉 @，补出来省得每个调用方各写一遍
    merged.setdefault("name", str(merged.get("tag") or "").lstrip("@"))
    merged["imageUrl"] = _artists.entry_image_url(entry, payload)
    merged["tier"] = _artists.tier_of(merged.get("posts"))
    return {"artist": merged}


@router.get("/api/artists/thumb")
def artists_thumb(slug: str = "", name: str = ""):
    """画师图片兜底代理。

    正常情况前端直接用 CDN 地址，浏览器自己缓存；只有直连失败才走这里。
    命中本地缓存直接返回，未命中则代取一次并落盘。
    """
    entry = _artists.find_artist(slug or name)
    if not entry:
        raise HTTPException(status_code=404, detail="未找到画师")
    payload = _artists.merged_index()
    image_url = _artists.entry_image_url(entry, payload)
    cache_key = entry.get("img") or image_url
    if not cache_key:
        raise HTTPException(status_code=404, detail="该画师没有图片")

    data = thumbs.read_cached(cache_key)
    if data is None:
        data = thumbs.download(image_url)
        if data:
            thumbs.write_cached(cache_key, data)
    if not data:
        raise HTTPException(status_code=404, detail="图片获取失败")

    return Response(
        content=data,
        media_type=thumbs.media_type_of(data),
        headers={"Cache-Control": "public, max-age=604800"},
    )


# 包管理（列表 / 导入 / 安装官方包 / 导出 / 卸载）与角色包同构，走同一个工厂
register_pack_routes(router, _artists, "/api/artists", "画师包")
