"""角色包接口：索引、详情、包状态。

数据全部来自 character_packs（已装包合并后的索引），
不再像旧实现那样把 21MB 单文件整份读进内存常驻。

接口约定：
    GET /api/characters/index      轻索引，前端首屏一次拉取（带 ETag，二次走 304）
    GET /api/characters/detail?id= 单角色详情，按分片读取
    GET /api/characters/packs      已装/可装包状态，供资产库展示
"""

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response

import character_packs as _chars
from routers.content_pack_routes import register_pack_routes

router = APIRouter()


@router.get("/api/characters/index")
def characters_index(request: Request):
    """合并所有已装角色包的索引。"""
    token = _chars.version_token()
    if request.headers.get("if-none-match") == token:
        return Response(status_code=304, headers={"ETag": token})
    payload = _chars.merged_index()
    return JSONResponse(
        payload,
        headers={"ETag": token, "Cache-Control": "no-cache"},
    )


@router.get("/api/characters/detail")
def character_detail(character_id: str = Query("", alias="id")):
    """取单个角色的详情；用 query 传 id 是因为有 73 个 slug 含 "/"。"""
    cid = (character_id or "").strip()
    if not cid:
        return JSONResponse({"error": "缺少 id"}, status_code=400)
    detail = _chars.get_detail(cid)
    if not detail:
        return JSONResponse({"error": "未找到角色", "id": cid}, status_code=404)
    merged = dict(_chars.index_entry(cid) or {})
    merged.update(detail)
    if not merged.get("thumb_url"):
        merged["thumb_url"] = merged.get("thumb") or _chars.thumb_url_of(
            merged.get("trigger", "")
        )
    return {"character": merged}


@router.post("/api/characters/details")
def characters_details(payload: dict):
    """批量取详情。

    「全部」应用模式需要把每个角色的 tags 一起写进提示词，逐个请求太碎，
    这里一次拿回（上限 800 条，超出部分前端会退回只用 trigger）。
    """
    ids = payload.get("ids") or []
    details = {}
    for cid in list(ids)[:800]:
        detail = _chars.get_detail(str(cid))
        if detail:
            details[str(cid)] = detail
    return {"details": details, "count": len(details)}


# 包管理（列表 / 导入 / 安装官方包 / 导出 / 卸载）与画师包同构，走同一个工厂
register_pack_routes(router, _chars, "/api/characters", "角色包")
