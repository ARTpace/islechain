"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/preset-i18n, /api/style-i18n, /api/preset-bidir, /api/reload-presets, /api/prompt-presets, /api/style-presets, /api/import/fooocus-styles, /api/all-presets, /api/thumbnails
"""
from fastapi.responses import FileResponse
from fastapi import HTTPException, File, UploadFile
from starlette.background import BackgroundTask
from core.preset_manager import get_all_presets, get_preset_bidir, get_style_presets, get_tag_presets, load_preset_i18n, save_style_presets, save_tag_presets
import json, os, shutil, tempfile, uuid
from core import preset_manager
import logging
from fastapi import APIRouter

import main as _main
import style_packs
from style_packs import repository as style_repository

router = APIRouter()


@router.get("/api/preset-i18n")
def api_preset_i18n():
    """返回预设中文名映射表(兼容旧接口)"""
    return load_preset_i18n()

STYLE_I18N_FILE = os.path.join(_main.DATA_DIR, "style-i18n.json")

@router.get("/api/style-i18n")
def api_style_i18n():
    """名称直接来自已安装包，不读取旧风格翻译数据。"""
    data = get_style_presets()
    return {
        'categories': {cat['id']: cat.get('name', cat['id']) for cat in data.get('categories', [])},
        'subcategories': {sub['id']: sub.get('name', sub['id']) for cat in data.get('categories', []) for sub in cat.get('subcategories', [])},
        'presets': {item['id']: item.get('name', item['id']) for cat in data.get('categories', []) for sub in cat.get('subcategories', []) for item in sub.get('presets', [])},
    }

@router.get("/api/preset-bidir")
def api_preset_bidir():
    """返回 {id_to_name, name_to_id}(兼容旧接口)"""
    id_to_name, name_to_id = get_preset_bidir()
    return {"id_to_name": id_to_name, "name_to_id": name_to_id}

@router.get("/api/reload-presets")
async def api_reload_presets():
    """强制刷新预设缓存并返回最新数据"""
    preset_manager._cache.invalidate()
    return get_all_presets()

@router.get("/api/prompt-presets")
async def get_prompt_presets():
    """获取标签预设(兼容旧接口,YAML 优先回退 JSON)"""
    return get_tag_presets()

@router.post("/api/prompt-presets")
async def api_save_prompt_presets(data: dict):
    """保存标签预设"""
    ok = save_tag_presets(data)
    return {"success": ok}

@router.get("/api/style-presets")
async def api_get_style_presets():
    """获取风格预设(完整提示词)"""
    return get_style_presets()

@router.post("/api/style-presets")
async def api_save_style_presets(data: dict):
    """保存风格预设"""
    ok = save_style_presets(data)
    return {"success": ok}


@router.post("/api/import/fooocus-styles")
async def api_import_fooocus_styles(payload: dict = None):
    """旧采集入口已迁至独立仓库；主工具通过包管理安装发布资产。"""
    raise HTTPException(status_code=410, detail="提示词采集已迁至 https://github.com/ARTpace/Art-prompt-library 。请在风格包管理中检查仓库并安装平台包。")

@router.get("/api/all-presets")
async def api_get_all_presets():
    """获取所有预设(标签 + 风格),统一输出"""
    return get_all_presets()

@router.get("/api/thumbnails/{filename}")
async def api_get_thumbnail(filename: str):
    """获取风格预设缩略图"""
    import re
    # 安全校验:只允许字母数字下划线和点
    if not re.match(r'^[a-zA-Z0-9_.-]+$', filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    thumb_path = os.path.join(_main.THUMBNAIL_DIR, filename)
    if not os.path.exists(thumb_path):
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    # 根据扩展名返回正确的 content-type
    ext = os.path.splitext(filename)[1].lower()
    content_type = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(ext, "image/png")
    stat = os.stat(thumb_path)
    etag = _main._etag_for(thumb_path, stat)
    return FileResponse(thumb_path, media_type=content_type, headers={
        "Cache-Control": "public, max-age=2592000, immutable",
        "ETag": f'"{etag}"',
    })


# === 风格包：可独立分发的扩展包 ===

def _invalidate_style_cache():
    """任何写入后都要让合并缓存失效，否则界面看不到刚才的改动。"""
    preset_manager._STYLE_PRESETS_CACHE["signature"] = ()
    preset_manager._STYLE_PRESETS_CACHE["mtime"] = 0.0
    preset_manager._STYLE_PRESETS_CACHE["data"] = None
    preset_manager._cache.invalidate()


def _pack_to_dict(pack):
    return {
        "packId": pack.pack_id,
        "name": pack.name,
        "version": pack.version,
        "author": pack.author,
        "description": pack.description,
        "builtin": pack.builtin,
        "order": pack.order,
        "categoryCount": len(pack.categories),
        # 清单里预存了条目数就直接用，老包没存才真读一遍（避免列表页解析几十 MB）
        "entryCount": pack.entry_count or sum(
            len(sub.get("presets") or [])
            for cat in style_packs.load_categories(pack)
            for sub in cat.get("subcategories") or []
        ),
        "categories": [{"id": c.id, "name": c.name, "order": c.order} for c in pack.categories],
    }


@router.get("/api/style-packs")
async def api_list_style_packs():
    """列出所有风格包（内置 + 用户）与用户增量层统计。"""
    packs = [_pack_to_dict(p) for p in style_packs.discover_packs()]
    total = sum(len(p["categories"]) for p in packs)
    return {
        "packs": packs,
        "categoryTotal": total,
        "overlay": style_packs.overlay_summary(),
    }


@router.get("/api/style-packs/catalog")
async def api_style_pack_catalog():
    """官方可选风格包清单（含是否已安装）。仓库不含完整数据，这里列出可一键装的包。"""
    return style_packs.official_with_status()


@router.get("/api/content-packs/repository")
@router.get("/api/style-packs/repository")
def api_style_repository(check: bool = False):
    try:
        return style_repository.check_repository() if check else style_repository.repository_status()
    except style_packs.PackError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/content-packs/repository")
@router.post("/api/style-packs/repository")
def api_refresh_style_repository(data: dict):
    try:
        return style_repository.refresh_repository(str(data.get('url') or ''))
    except (style_packs.PackError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/api/content-packs/repository")
@router.delete("/api/style-packs/repository")
def api_disconnect_style_repository():
    return style_repository.disconnect_repository()


@router.post("/api/content-packs/repository/install")
@router.post("/api/style-packs/repository/install")
def api_install_repository_style_pack(data: dict):
    try:
        pack = style_repository.install_repository_pack(
            str(data.get('packId') or ''),
            replace=bool(data.get('replace')),
            repo_id=str(data.get('repoId') or ''),
        )
    except style_packs.PackError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _invalidate_style_cache()
    return {'success': True, 'pack': _pack_to_dict(pack)}


# === 多仓库：可以同时挂多个 GitHub 内容仓库 ===

@router.get("/api/content-repositories")
def api_list_content_repositories(check: bool = False):
    try:
        return style_repository.check_repository() if check else style_repository.repository_status()
    except style_packs.PackError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/content-repositories")
def api_add_content_repository(data: dict):
    try:
        return style_repository.add_repository(str(data.get('url') or ''))
    except (style_packs.PackError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/content-repositories/{repo_id}/refresh")
def api_refresh_content_repository(repo_id: str):
    try:
        return style_repository.refresh_repository(repo_id=repo_id)
    except (style_packs.PackError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/content-repositories/{repo_id}/enabled")
def api_toggle_content_repository(repo_id: str, data: dict):
    try:
        return style_repository.set_repository_enabled(repo_id, bool((data or {}).get('enabled', True)))
    except (style_packs.PackError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/api/content-repositories/{repo_id}")
def api_remove_content_repository(repo_id: str):
    try:
        return style_repository.remove_repository(repo_id)
    except (style_packs.PackError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/api/style-packs/install-official")
async def api_install_official_style_pack(data: dict):
    """一键安装官方风格包：从随包分发的 zip 装进用户目录。"""
    payload = data or {}
    pack_id = str(payload.get("packId") or "").strip()
    if not style_packs.is_valid_pack_id(pack_id):
        raise HTTPException(status_code=400, detail="packId 非法")
    try:
        pack = style_packs.install_official(pack_id, replace=bool(payload.get("replace")))
    except style_packs.PackError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logging.getLogger(__name__).exception("官方风格包安装失败")
        raise HTTPException(status_code=500, detail=str(exc))
    _invalidate_style_cache()
    return {"success": True, "pack": _pack_to_dict(pack)}


@router.get("/api/style-packs/{pack_id}/download")
async def api_download_style_pack(pack_id: str):
    """导出已安装的包为 zip，用于分发或备份。"""
    if not style_packs.is_valid_pack_id(pack_id):
        raise HTTPException(status_code=400, detail="packId 非法")
    fd, tmp_path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    try:
        style_packs.export_pack_zip(pack_id, tmp_path)
    except style_packs.PackError as exc:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        logging.getLogger(__name__).exception("风格包导出失败")
        raise HTTPException(status_code=500, detail=str(exc))
    return FileResponse(
        tmp_path,
        media_type="application/zip",
        filename="%s.zip" % pack_id,
        background=BackgroundTask(lambda: os.path.exists(tmp_path) and os.unlink(tmp_path)),
    )


@router.post("/api/style-packs/import")
async def api_import_style_pack(file: UploadFile = File(...), replace: bool = False):
    """导入风格包 zip。包结构：<packId>/pack.json + <packId>/<category_id>.json"""
    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=".zip")
        os.close(fd)
        with open(tmp_path, "wb") as out:
            shutil.copyfileobj(file.file, out)
        pack = style_packs.import_pack(tmp_path, replace=replace)
        _invalidate_style_cache()
        return {"success": True, "pack": _pack_to_dict(pack)}
    except style_packs.PackError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logging.getLogger(__name__).exception("风格包导入失败")
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@router.delete("/api/style-packs/{pack_id}")
async def api_uninstall_style_pack(pack_id: str):
    """卸载用户导入的风格包（内置包不可卸载）。"""
    if not style_packs.is_valid_pack_id(pack_id):
        raise HTTPException(status_code=400, detail="packId 非法")
    builtin_ids = {p.pack_id for p in style_packs.discover_packs() if p.builtin}
    if pack_id in builtin_ids:
        raise HTTPException(status_code=400, detail="内置风格包不可卸载")
    ok = style_packs.uninstall_pack(pack_id)
    if not ok:
        raise HTTPException(status_code=404, detail="风格包不存在")
    _invalidate_style_cache()
    return {"success": True, "packId": pack_id}


# === 单条扩展：用户自己加/改/删一条风格 ===

@router.post("/api/style-presets/items")
async def api_add_style_item(data: dict):
    """新增（或覆盖）一条用户风格，落在增量层，不进 git、升级不丢。"""
    preset = dict(data or {})
    prompt = str(preset.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt 不能为空")
    if not preset.get("id"):
        preset["id"] = "my_%s" % uuid.uuid4().hex[:12]
    preset.setdefault("name", preset["id"])
    preset.setdefault("type", "prompt")
    preset.setdefault("negative_prompt", "")
    preset.setdefault("description", "")
    preset.setdefault("thumbnail", "")

    category = {
        "id": str(preset.pop("category_id", "") or "my_styles"),
        "name": str(preset.pop("category_name", "") or "我的风格"),
    }
    subcategory = {
        "id": str(preset.pop("subcategory_id", "") or category["id"]),
        "name": str(preset.pop("subcategory_name", "") or category["name"]),
    }
    if not style_packs.add_item(preset, category, subcategory):
        raise HTTPException(status_code=500, detail="写入用户增量层失败")
    _invalidate_style_cache()
    return {"success": True, "preset": preset, "category": category}


@router.patch("/api/style-presets/items/{preset_id}")
async def api_patch_style_item(preset_id: str, data: dict):
    """修改一条（只覆盖传入字段），改名/改提示词都走这里。"""
    fields = dict(data or {})
    fields.pop("id", None)
    if not fields:
        raise HTTPException(status_code=400, detail="没有需要修改的字段")
    if not style_packs.patch_item(preset_id, fields):
        raise HTTPException(status_code=500, detail="写入用户增量层失败")
    _invalidate_style_cache()
    return {"success": True, "id": preset_id, "patched": list(fields)}


@router.delete("/api/style-presets/items/{preset_id}")
async def api_remove_style_item(preset_id: str):
    """删除一条：基线里的打删除标记，用户自建的直接移除。"""
    if not style_packs.remove_item(preset_id):
        raise HTTPException(status_code=500, detail="写入用户增量层失败")
    _invalidate_style_cache()
    return {"success": True, "id": preset_id}


@router.get('/api/tag-packs')
def api_tag_packs():
    import tag_packs
    return {'packs': tag_packs.installed_packs()}


@router.delete('/api/tag-packs/{pack_id}')
def api_uninstall_tag_pack(pack_id: str):
    import tag_packs
    try:
        return {'success': tag_packs.uninstall_pack(pack_id)}
    except style_packs.PackError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
