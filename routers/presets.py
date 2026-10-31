"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/preset-i18n, /api/style-i18n, /api/preset-bidir, /api/reload-presets, /api/prompt-presets, /api/style-presets, /api/import/fooocus-styles, /api/all-presets, /api/thumbnails
"""
from fastapi.responses import FileResponse
from fastapi import HTTPException, File, UploadFile
from starlette.background import BackgroundTask
from preset_manager import get_all_presets, get_preset_bidir, get_style_presets, get_tag_presets, load_preset_i18n, save_style_presets, save_tag_presets
import json, os, preset_manager, shutil, tempfile, uuid
import logging
from fastapi import APIRouter

import main as _main
import style_packs

router = APIRouter()


@router.get("/api/preset-i18n")
def api_preset_i18n():
    """返回预设中文名映射表(兼容旧接口)"""
    return load_preset_i18n()

STYLE_I18N_FILE = os.path.join(_main.DATA_DIR, "style-i18n.json")

@router.get("/api/style-i18n")
def api_style_i18n():
    """返回风格预设中文名映射表"""
    if os.path.exists(STYLE_I18N_FILE):
        try:
            with open(STYLE_I18N_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"categories": {}, "subcategories": {}, "presets": {}}

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
    """
    一键导入 Fooocus 官方风格包到 style-presets.json

    Body 参数:
      - sources: List[str]  要导入的源 key,默认全部
        可选: fooocus, sai, diva, marc_k3nt3l, twri, mre
      - dry_run: bool       预览模式,不写文件
      - skip_thumbs: bool   不下载缩略图
    """
    payload = payload or {}
    try:
        from tools.fooocus_importer import import_fooocus_styles
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"fooocus_importer 加载失败: {e}")

    sources = payload.get("sources")  # None=全部
    dry_run = bool(payload.get("dry_run", False))
    skip_thumbs = bool(payload.get("skip_thumbs", False))

    try:
        result = import_fooocus_styles(
            sources=sources,
            dry_run=dry_run,
            skip_thumbs=skip_thumbs,
        )
        return result
    except Exception as e:
        logging.getLogger(__name__).exception("Fooocus 导入失败: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

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
