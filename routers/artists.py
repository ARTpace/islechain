"""画师包接口：索引、包管理、图片兜底。

数据全部来自 artist_packs（已装包合并后的索引），
不再像旧实现那样让前端去拉 8.6MB 的 artist_data.js。

接口约定：
    GET  /api/artists/index                合并索引，前端首屏一次拉取（带 ETag）
    GET  /api/artists/packs                已装/可装包状态
    POST /api/artists/packs/import         导入本地 zip
    POST /api/artists/packs/install-official  一键安装官方包
    GET  /api/artists/packs/{id}/download  导出已安装包
    DEL  /api/artists/packs/{id}           卸载用户包
"""

import os
import shutil
import tempfile

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

import artist_packs as _artists
from artist_packs import thumbs
from content_packs.packer import PackError

router = APIRouter()


def _pack_to_dict(pack) -> dict:
    return {
        "packId": pack.pack_id,
        "name": pack.name,
        "version": pack.version,
        "builtin": pack.builtin,
        "entryCount": pack.entry_count,
    }


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


@router.get("/api/artists/packs")
def artists_packs():
    """已装包 + 官方可下载包 + 目录位置。"""
    return {
        "installed": _artists.installed_packs(),
        "official": _artists.official_with_status(),
        "stats": _artists.stats(),
    }


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


@router.post("/api/artists/packs/import")
async def import_artist_pack(file: UploadFile = File(...), replace: bool = False):
    """导入画师包 zip。包结构：<packId>/pack.json + <packId>/index.json"""
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=".zip")
        os.close(fd)
        with open(tmp_path, "wb") as out:
            shutil.copyfileobj(file.file, out)
        pack = _artists.import_pack(tmp_path, replace=replace)
        return {"success": True, "pack": _pack_to_dict(pack)}
    except PackError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@router.post("/api/artists/packs/install-official")
def install_official_artist_pack(payload: dict = None):
    """安装随程序分发的官方画师包。"""
    pack_id = str((payload or {}).get("packId") or "").strip()
    replace = bool((payload or {}).get("replace"))
    if not pack_id:
        raise HTTPException(status_code=400, detail="缺少 packId")
    try:
        pack = _artists.install_official(pack_id, replace=replace)
        return {"success": True, "pack": _pack_to_dict(pack)}
    except PackError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/artists/packs/{pack_id}/download")
def download_artist_pack(pack_id: str):
    """导出已安装的包（内置或用户），用于分发或备份。"""
    tmp_dir = tempfile.mkdtemp(prefix="artist-pack-export-")
    out_path = os.path.join(tmp_dir, pack_id + ".zip")
    try:
        _artists.export_pack_zip(pack_id, out_path)
    except PackError as exc:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=404, detail=str(exc))
    return FileResponse(out_path, media_type="application/zip", filename=pack_id + ".zip")


@router.delete("/api/artists/packs/{pack_id}")
def uninstall_artist_pack(pack_id: str):
    """卸载用户导入的画师包（内置包不可卸载）。"""
    from content_packs.paths import is_valid_pack_id

    if not is_valid_pack_id(pack_id):
        raise HTTPException(status_code=400, detail="packId 非法")
    try:
        ok = _artists.uninstall_pack(pack_id)
    except PackError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"success": ok}
