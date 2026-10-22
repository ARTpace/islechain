"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/preset-i18n, /api/style-i18n, /api/preset-bidir, /api/reload-presets, /api/prompt-presets, /api/style-presets, /api/import/fooocus-styles, /api/all-presets, /api/thumbnails
"""
from fastapi.responses import FileResponse
from fastapi import HTTPException
from preset_manager import get_all_presets, get_preset_bidir, get_style_presets, get_tag_presets, load_preset_i18n, save_style_presets, save_tag_presets
import json, os, preset_manager
import logging
from fastapi import APIRouter

import main as _main

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
    thumb_path = os.path.join(_main.DATA_DIR, "thumbnails", filename)
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
