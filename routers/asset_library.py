"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/local-assets, /api/canvas-assets, /api/asset-library
"""
from fastapi import HTTPException, Request
import asyncio, os
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/api/local-assets")
async def list_local_assets():
    tree, items = _main._local_upload_tree_and_items()
    return {"items": items, "tree": tree}

@router.patch("/api/local-assets/folders")
async def rename_local_asset_folder(payload: _main.LocalAssetFolderRequest, request: Request):
    _main.ensure_same_origin_request(request)
    rel, abs_path = _main._local_upload_safe_folder(payload.path)
    if not rel:
        raise HTTPException(status_code=400, detail="根目录不能重命名")
    if not os.path.isdir(abs_path):
        raise HTTPException(status_code=404, detail="文件夹不存在")
    name = _main._local_upload_safe_folder_name(payload.name)
    parent = os.path.dirname(rel).replace("\\", "/")
    new_rel = f"{parent}/{name}".lstrip("/")
    _, new_abs = _main._local_upload_safe_folder(new_rel)
    if os.path.exists(new_abs):
        raise HTTPException(status_code=400, detail="同名文件夹已存在")
    os.rename(abs_path, new_abs)
    _main.update_unified_local_reference(rel, new_rel)
    tree, items = _main._local_upload_tree_and_items()
    return {"ok": True, "folder": {"path": new_rel, "name": name}, "tree": tree, "items": items}

@router.patch("/api/local-assets/items")
async def rename_local_asset_item(payload: _main.LocalAssetRenameRequest, request: Request):
    _main.ensure_same_origin_request(request)
    rel, abs_path = _main._local_upload_safe_path(payload.path)
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="本地素材不存在")
    kind, ext = _main._local_upload_kind_ext(rel, "")
    if kind is None:
        raise HTTPException(status_code=400, detail="不支持的素材类型")
    new_stem = _main._local_upload_safe_file_stem(payload.name)
    old_ext = os.path.splitext(rel)[1] or ext
    parent = os.path.dirname(rel).replace("\\", "/")
    new_rel = f"{parent}/{new_stem}{old_ext}".lstrip("/")
    if new_rel == rel:
        tree, items = _main._local_upload_tree_and_items()
        return {"ok": True, "item": _main._local_upload_item(rel), "tree": tree, "items": items}
    _, new_abs = _main._local_upload_abs(new_rel)
    if os.path.exists(new_abs):
        raise HTTPException(status_code=400, detail="同名素材已存在")
    os.rename(abs_path, new_abs)
    old_caption = _main._local_upload_caption_path(rel)
    new_caption = _main._local_upload_caption_path(new_rel)
    if os.path.isfile(old_caption) and not os.path.exists(new_caption):
        os.rename(old_caption, new_caption)
    old_classification = _main._local_upload_classification_path(rel)
    new_classification = _main._local_upload_classification_path(new_rel)
    if os.path.isfile(old_classification) and not os.path.exists(new_classification):
        os.rename(old_classification, new_classification)
    _main.update_unified_local_reference(rel, new_rel)
    tree, items = _main._local_upload_tree_and_items()
    return {"ok": True, "item": _main._local_upload_item(new_rel), "old_path": rel, "tree": tree, "items": items}

@router.patch("/api/local-assets/caption")
async def save_local_asset_caption(payload: _main.LocalAssetCaptionSaveRequest):
    filename, path = _main._local_upload_safe_path(payload.name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="文件不存在")
    kind, _ = _main._local_upload_kind_ext(filename, "")
    if kind != "image":
        raise HTTPException(status_code=400, detail="仅支持图片素材保存提示词")
    caption = str(payload.caption or "")[:100000]
    txt_path = _main._local_upload_caption_path(filename)
    with open(txt_path, "w", encoding="utf-8", newline="") as f:
        f.write(caption)
    return {"ok": True, "caption": caption, "caption_file": os.path.basename(txt_path)}

# --- 画布资产 API ---

@router.get("/api/canvas-assets")
async def list_canvas_assets():
    return await asyncio.to_thread(_main.canvas_assets_index)

# --- 资产库 API ---

@router.get("/api/asset-library")
def get_asset_library():
    lib = _main.load_asset_library()
    _annotate_asset_file_meta(lib)
    return {"library": lib}


def _annotate_asset_file_meta(lib):
    """给每条素材补上文件大小与是否还在，供前端排序、标记坏记录。

    每次都现算覆盖，所以这两个字段只当只读展示用，不参与业务判断。
    """
    for library in lib.get("libraries", []) or []:
        for cat in library.get("categories") or []:
            for item in cat.get("items") or []:
                if not isinstance(item, dict):
                    continue
                path = _main.asset_library_item_path(item.get("url"))
                size, exists = 0, False
                if path:
                    try:
                        size = int(os.path.getsize(path))
                        exists = True
                    except OSError:
                        exists = False
                item["size"] = size
                item["file_exists"] = exists

@router.patch("/api/asset-library/libraries/{library_id}")
async def rename_asset_library(library_id: str, payload: _main.AssetLibraryRenameRequest):
    lib = _main.load_asset_library()
    library = _main.find_asset_library(lib, library_id)
    if not library or library.get("id") != library_id:
        raise HTTPException(status_code=404, detail="资产库不存在")
    library["name"] = _main.sanitize_asset_name(payload.name, library.get("name") or "资产库")
    _main.save_asset_library(lib)
    return {"library": lib, "asset_library": library}

@router.patch("/api/asset-library/categories/{category_id}")
async def rename_asset_library_category(category_id: str, payload: _main.AssetLibraryRenameRequest):
    lib = _main.load_asset_library()
    _, cat = _main.find_asset_category_with_library(lib, category_id, payload.library_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    cat["name"] = _main.sanitize_asset_name(payload.name, cat.get("name") or "新文件夹")
    _main.save_asset_library(lib)
    return {"library": lib, "category": cat}

@router.patch("/api/asset-library/items/{item_id}")
async def rename_asset_library_item(item_id: str, payload: _main.AssetLibraryRenameRequest):
    lib = _main.load_asset_library()
    for library in lib.get("libraries", []):
        for cat in library.get("categories", []):
            for item in cat.get("items", []):
                if item.get("id") == item_id:
                    item["name"] = _main.sanitize_asset_name(payload.name, item.get("name") or "asset")
                    if payload.caption is not None:
                        _main.write_asset_caption(item, payload.caption)
                    _main.save_asset_library(lib)
                    return {"library": lib, "item": item}
    raise HTTPException(status_code=404, detail="资产不存在")
