"""资产管理相关路由（资产库、本地资产、画布资产）"""
import main as _main  # P2 惰性依赖（2026-10-22 断循环）：见本文件 __getattr__
from fastapi import APIRouter, HTTPException, Request, File, UploadFile, Form, Response
from typing import List
import os, re, uuid, base64, httpx
from io import BytesIO
import zipfile
import urllib.parse


router = APIRouter()


@router.post("/api/user/assets/save-from-url")
async def save_user_asset_from_url(payload: _main.UserAssetSaveRequest, token: str = "", request: Request = None):
    """保存在线图片到用户级别的资产文件夹 input/{username}/"""
    username = _main.get_username_by_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="请先登录")

    asset_dir, dirname = _main.get_user_input_dir(username)
    os.makedirs(asset_dir, exist_ok=True)

    download_url = payload.url
    if download_url.startswith("/"):
        base = str(request.base_url).rstrip("/")
        download_url = base + download_url

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(download_url)
            response.raise_for_status()
            content = response.content
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"下载图片失败: {str(e)}")

    ext = ".png"
    content_type = ""
    for key, val in response.headers.items():
        if key.lower() == "content-type":
            content_type = val
            break
    if "jpeg" in content_type or "jpg" in content_type:
        ext = ".jpg"
    elif "webp" in content_type:
        ext = ".webp"
    elif "gif" in content_type:
        ext = ".gif"

    content_hash = _main.hashlib.md5(content).hexdigest()
    # 检查是否已存在相同内容的文件（去重）
    if os.path.isdir(asset_dir):
        for existing in os.listdir(asset_dir):
            existing_path = os.path.join(asset_dir, existing)
            if os.path.isfile(existing_path):
                try:
                    with open(existing_path, "rb") as ef:
                        existing_hash = _main.hashlib.md5(ef.read()).hexdigest()
                    if existing_hash == content_hash:
                        url_path = f"/assets/{dirname}/{existing}"
                        # 读取已有提示词元数据（若有），去重命中时一并带出
                        existing_txt = os.path.splitext(existing_path)[0] + ".txt"
                        existing_prompt = ""
                        if os.path.isfile(existing_txt):
                            try:
                                with open(existing_txt, "r", encoding="utf-8") as etf:
                                    existing_prompt = etf.read()
                            except Exception:
                                pass
                        return {"url": url_path, "name": payload.name or existing, "dedup": True, "prompt": existing_prompt}
                except Exception:
                    pass
    filename = f"asset_{uuid.uuid4().hex[:12]}{ext}"
    filepath = os.path.join(asset_dir, filename)
    with open(filepath, "wb") as f:
        f.write(content)
    # 保存提示词元数据（同名 .txt），供资产库按提示词搜索
    if payload.prompt:
        try:
            with open(os.path.splitext(filepath)[0] + ".txt", "w", encoding="utf-8") as tf:
                tf.write(payload.prompt)
        except Exception:
            pass

    url_path = f"/assets/{dirname}/{filename}"
    return {"url": url_path, "name": payload.name or filename, "prompt": payload.prompt or ""}
@router.post("/api/user/assets/delete")
async def delete_user_asset_from_url(payload: dict = None, token: str = ""):
    """删除用户级资产文件夹 input/{username}/ 中的图片（与 save-from-url 配套，用于取消收藏时同步移除）"""
    username = _main.get_username_by_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="请先登录")
    if not payload or not payload.get("url"):
        raise HTTPException(status_code=400, detail="缺少 url")
    asset_dir, dirname = _main.get_user_input_dir(username)
    raw = payload["url"].lstrip("/")
    # 仅接受 /assets/... 形式
    if not raw.startswith("assets/"):
        raise HTTPException(status_code=400, detail="无效的资产地址")
    # 去掉 assets/ 前缀，剩余为 {dirname}/{rest}
    rel = raw[len("assets/"):]
    parts = rel.split("/")
    if not parts or parts[0] != dirname:
        raise HTTPException(status_code=403, detail="无权删除该资产")
    target = os.path.join(asset_dir, *parts[1:])
    # 安全校验：target 必须位于 asset_dir 内，防止路径穿越
    abs_asset = os.path.abspath(asset_dir)
    abs_target = os.path.abspath(target)
    if abs_target != abs_asset and not abs_target.startswith(abs_asset + os.sep):
        raise HTTPException(status_code=403, detail="无权删除该资产")
    if os.path.isfile(target):
        try:
            os.remove(target)
            # 一并删除提示词元数据（同名 .txt）
            txt = os.path.splitext(target)[0] + ".txt"
            if os.path.isfile(txt):
                try:
                    os.remove(txt)
                except Exception:
                    pass
            return {"ok": True, "deleted": True}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"删除失败: {e}")
    return {"ok": True, "deleted": False}
@router.post("/api/user/assets/dedup")
async def dedup_user_assets(token: str = ""):
    """删除资产库中的重复图片（基于 MD5 内容去重）"""
    username = _main.get_username_by_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="请先登录")
    asset_dir, dirname = _main.get_user_input_dir(username)
    if not os.path.exists(asset_dir):
        return {"removed": 0, "kept": 0}
    image_exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    hash_map = {}  # md5 → [(filepath, mtime)]
    for filename in os.listdir(asset_dir):
        filepath = os.path.join(asset_dir, filename)
        if os.path.isfile(filepath) and os.path.splitext(filename)[1].lower() in image_exts:
            try:
                with open(filepath, "rb") as f:
                    h = _main.hashlib.md5(f.read()).hexdigest()
                mtime = os.path.getmtime(filepath)
                hash_map.setdefault(h, []).append((filepath, mtime))
            except Exception:
                pass
    removed = 0
    kept = 0
    for h, files in hash_map.items():
        if len(files) > 1:
            # 保留最新的，删除旧的
            files.sort(key=lambda x: x[1], reverse=True)
            for path, _ in files[1:]:
                try:
                    os.remove(path)
                    removed += 1
                except Exception:
                    pass
            kept += 1
        else:
            kept += 1
    # 删除空目录
    for root, dirs, files in os.walk(asset_dir, topdown=False):
        for d in dirs:
            try:
                os.rmdir(os.path.join(root, d))
            except Exception:
                pass
    return {"removed": removed, "kept": kept}

# --- GPT 对话 ---
@router.post("/api/local-assets/upload")
async def upload_local_assets(files: List[UploadFile] = File(...), folder: str = Form("")):
    uploaded = []
    folder_rel, folder_abs = _main._local_upload_safe_folder(folder)
    os.makedirs(folder_abs, exist_ok=True)
    for file in files:
        content = await file.read()
        if not content:
            continue
        kind, ext = _main._local_upload_kind_ext(file.filename, file.content_type)
        if kind is None:
            continue
        base = os.path.splitext(os.path.basename(file.filename or "file"))[0]
        base = re.sub(r"[^0-9A-Za-z一-鿿._-]+", "_", base).strip("_") or "file"
        base = base[:60]
        filename = f"up_{uuid.uuid4().hex[:12]}_{base}{ext}"
        rel_name = f"{folder_rel}/{filename}".lstrip("/")
        path = os.path.join(folder_abs, filename)
        with open(path, "wb") as f:
            f.write(content)
        if kind == "image":
            classification = await _main.classify_asset_image_best_effort(path)
            if classification:
                _main._write_local_upload_classification(rel_name, classification)
        uploaded.append(_main._local_upload_item(rel_name))
    return {"files": uploaded}
@router.post("/api/local-assets/import-urls")
async def import_local_assets_from_urls(payload: _main.LocalAssetUrlImportRequest):
    uploaded = []
    results = []
    folder_rel, folder_abs = _main._local_upload_safe_folder(payload.folder)
    os.makedirs(folder_abs, exist_ok=True)
    timeout = httpx.Timeout(connect=20.0, read=120.0, write=30.0, pool=20.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers={"User-Agent": "art-canvas-Asset-Importer/1.0"}) as client:
        for entry in (payload.items or [])[:200]:
            src_url = str(entry.url or "").strip()
            inline_data = str(entry.data or "").strip()
            result = {"url": src_url, "ok": False, "file": "", "error": ""}
            if not inline_data and not src_url.startswith(("http://", "https://")):
                result["error"] = "仅支持 http(s) 素材地址"
                results.append(result)
                continue
            try:
                if inline_data:
                    content_type = str(entry.content_type or "").split(";", 1)[0].strip().lower()
                    b64 = inline_data
                    if inline_data.startswith("data:"):
                        header, _, b64 = inline_data.partition(",")
                        if not content_type:
                            content_type = header[5:].split(";", 1)[0].strip().lower()
                    try:
                        content = base64.b64decode(b64, validate=False)
                    except Exception:
                        raise HTTPException(status_code=400, detail="素材数据无法解码")
                    name_path = urllib.parse.urlparse(src_url).path
                else:
                    response = await client.get(src_url)
                    response.raise_for_status()
                    content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                    content = response.content
                    name_path = urllib.parse.urlparse(src_url).path
                kind, ext = _main._local_upload_kind_ext(name_path, content_type)
                if kind not in ("image", "video"):
                    raise HTTPException(status_code=400, detail=f"不是图片或视频资源:{content_type or src_url}")
                if not content:
                    raise HTTPException(status_code=400, detail="素材内容为空")
                if entry.name:
                    base = os.path.splitext(entry.name)[0]
                else:
                    base = os.path.splitext(os.path.basename(urllib.parse.unquote(name_path)))[0]
                base = base or ("web-video" if kind == "video" else "web-image")
                base = re.sub(r"[^0-9A-Za-z一-鿿._-]+", "_", base).strip("_") or ("web-video" if kind == "video" else "web-image")
                base = base[:60]
                if ext and base.lower().endswith(ext.lower()):
                    base = base[:-len(ext)].rstrip(".") or ("web-video" if kind == "video" else "web-image")
                filename = f"up_{uuid.uuid4().hex[:12]}_{base}{ext}"
                rel_name = f"{folder_rel}/{filename}".lstrip("/")
                path = os.path.join(folder_abs, filename)
                with open(path, "wb") as f:
                    f.write(content)
                if payload.classify and kind == "image":
                    classification = await _main.classify_asset_image_best_effort(path, payload.provider, payload.model, payload.ms_model, payload.prompt)
                    if classification:
                        _main._write_local_upload_classification(rel_name, classification)
                item = _main._local_upload_item(rel_name)
                uploaded.append(item)
                result.update({"ok": True, "file": rel_name, "item": item})
            except HTTPException as exc:
                result["error"] = str(exc.detail or "导入失败")
            except Exception as exc:
                result["error"] = str(exc) or "导入失败"
            results.append(result)
    return {"ok": True, "count": len(uploaded), "files": uploaded, "items": results}
@router.post("/api/local-assets/folders")
async def create_local_asset_folder(payload: _main.LocalAssetFolderRequest, request: Request):
    _main.ensure_same_origin_request(request)
    parent_rel, parent_abs = _main._local_upload_safe_folder(payload.parent)
    if not os.path.isdir(parent_abs):
        raise HTTPException(status_code=404, detail="父文件夹不存在")
    name = _main._local_upload_safe_folder_name(payload.name)
    rel = f"{parent_rel}/{name}".lstrip("/")
    _, abs_path = _main._local_upload_safe_folder(rel)
    if os.path.exists(abs_path):
        raise HTTPException(status_code=400, detail="同名文件夹已存在")
    os.makedirs(abs_path, exist_ok=False)
    tree, items = _main._local_upload_tree_and_items()
    return {"ok": True, "folder": {"path": rel, "name": name}, "tree": tree, "items": items}
@router.post("/api/local-assets/delete")
async def delete_local_assets(payload: dict, request: Request):
    _main.ensure_same_origin_request(request)
    names = payload.get("names") if isinstance(payload, dict) else None
    if not isinstance(names, list):
        names = []
    deleted = []
    for name in names:
        try:
            rel, path = _main._local_upload_safe_path(name)
        except HTTPException:
            continue
        if os.path.isfile(path):
            try:
                os.remove(path)
                txt_path = _main._local_upload_caption_path(rel)
                if os.path.isfile(txt_path):
                    os.remove(txt_path)
                cls_path = _main._local_upload_classification_path(rel)
                if os.path.isfile(cls_path):
                    os.remove(cls_path)
                deleted.append(rel)
            except OSError:
                pass
    return {"deleted": deleted}
@router.post("/api/local-assets/move")
async def move_local_assets(payload: dict, request: Request):
    _main.ensure_same_origin_request(request)
    names = payload.get("names") if isinstance(payload, dict) else None
    if not isinstance(names, list) or not names:
        raise HTTPException(status_code=400, detail="没有选择素材")
    folder_value = str(payload.get("folder") or "").strip() if isinstance(payload, dict) else ""
    target_rel, target_abs = _main._local_upload_safe_folder(folder_value)
    if target_rel and not os.path.isdir(target_abs):
        raise HTTPException(status_code=404, detail="目标文件夹不存在")
    moved = 0
    for name in names:
        try:
            rel, abs_path = _main._local_upload_safe_path(name)
        except HTTPException:
            continue
        if not os.path.isfile(abs_path):
            continue
        base = os.path.basename(rel)
        new_rel = f"{target_rel}/{base}".lstrip("/") if target_rel else base
        if new_rel == rel:
            continue
        _, new_abs = _main._local_upload_abs(new_rel)
        if os.path.exists(new_abs):
            stem, ext = os.path.splitext(base)
            base = f"{stem}_{uuid.uuid4().hex[:6]}{ext}"
            new_rel = f"{target_rel}/{base}".lstrip("/") if target_rel else base
            _, new_abs = _main._local_upload_abs(new_rel)
        try:
            os.makedirs(os.path.dirname(new_abs), exist_ok=True)
            os.rename(abs_path, new_abs)
            for src_sib, dst_sib in (
                (_main._local_upload_caption_path(rel), _main._local_upload_caption_path(new_rel)),
                (_main._local_upload_classification_path(rel), _main._local_upload_classification_path(new_rel)),
            ):
                if os.path.isfile(src_sib) and not os.path.exists(dst_sib):
                    os.rename(src_sib, dst_sib)
            moved += 1
        except OSError:
            continue
    tree, items = _main._local_upload_tree_and_items()
    return {"ok": True, "moved": moved, "items": items, "tree": tree}
@router.post("/api/local-assets/caption")
async def caption_local_assets(payload: _main.LocalAssetCaptionRequest):
    prompt = (payload.prompt or "描述图片").strip() or "描述图片"
    items = []
    ok_count = 0
    for name in (payload.names or [])[:100]:
        item = {"name": name, "ok": False, "caption": "", "caption_file": "", "error": ""}
        try:
            filename, path = _main._local_upload_safe_path(name)
            if not os.path.isfile(path):
                raise HTTPException(status_code=404, detail="文件不存在")
            kind, _ = _main._local_upload_kind_ext(filename, "")
            if kind != "image":
                raise HTTPException(status_code=400, detail="仅支持图片素材反推提示词")
            caption, resolved_model = await _main.caption_image_with_provider(
                path, prompt, payload.provider, payload.model, payload.ms_model,
            )
            txt_path = _main._local_upload_caption_path(filename)
            with open(txt_path, "w", encoding="utf-8", newline="") as f:
                f.write(caption)
            item.update({
                "ok": True, "name": filename, "caption": caption,
                "caption_file": os.path.basename(txt_path), "model": resolved_model,
            })
            ok_count += 1
        except HTTPException as exc:
            item["error"] = str(exc.detail or "反推失败")
        except Exception as exc:
            item["error"] = str(exc) or "反推失败"
        items.append(item)
    return {"ok": True, "count": ok_count, "items": items}
@router.post("/api/local-assets/classify")
async def classify_local_assets(payload: _main.LocalAssetClassifyRequest):
    items = []
    ok_count = 0
    for name in (payload.names or [])[:80]:
        item = {"name": name, "ok": False, "classification": None, "classification_file": "", "error": ""}
        try:
            filename, path = _main._local_upload_safe_path(name)
            if not os.path.isfile(path):
                raise HTTPException(status_code=404, detail="文件不存在")
            kind, _ = _main._local_upload_kind_ext(filename, "")
            if kind != "image":
                raise HTTPException(status_code=400, detail="仅支持图片素材智能分类")
            classification = await _main.classify_image_with_provider(path, payload.provider, payload.model, payload.ms_model, payload.prompt)
            _main._write_local_upload_classification(filename, classification)
            item.update({
                "ok": True, "name": filename, "classification": classification,
                "classification_file": os.path.basename(_main._local_upload_classification_path(filename)),
                "model": classification.get("model") or "",
            })
            ok_count += 1
        except HTTPException as exc:
            item["error"] = str(exc.detail or "智能分类失败")
        except Exception as exc:
            item["error"] = str(exc) or "智能分类失败"
        items.append(item)
    return {"ok": True, "count": ok_count, "items": items}
@router.post("/api/canvas-assets/check")
async def check_canvas_assets(payload: _main.CanvasAssetCheckRequest):
    result = {}
    for url in payload.urls[:3000]:
        text = str(url or "").strip()
        if not text:
            continue
        if text.startswith("/output/") or text.startswith("/assets/"):
            result[text] = bool(_main.output_file_from_url(text))
        else:
            result[text] = True
    return {"exists": result}
@router.post("/api/canvas-assets/download")
async def download_canvas_assets(payload: _main.CanvasAssetDownloadRequest):
    buffer = BytesIO()
    used_names = set()
    count = 0
    raw_items = payload.items or [{"url": url} for url in payload.urls]
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for raw in raw_items[:1000]:
            if isinstance(raw, dict):
                text = str(raw.get("url") or "").strip()
                requested_name = str(raw.get("name") or "").strip()
            else:
                text = str(raw or "").strip()
                requested_name = ""
            if not text:
                continue
            path = _main.output_file_from_url(text)
            content = None
            content_type = ""
            if path and os.path.isfile(path):
                base = _main.sanitize_export_filename(requested_name or os.path.basename(path), os.path.basename(path) or f"image-{count + 1}.png")
            else:
                local_by_name = _main.local_media_file_by_basename(_main.filename_from_media_url(text, ""))
                if local_by_name and os.path.isfile(local_by_name):
                    path = local_by_name
                    base = _main.sanitize_export_filename(requested_name or os.path.basename(path), os.path.basename(path) or f"image-{count + 1}.png")
                else:
                    try:
                        remote = _main.fetch_remote_media_bytes(text)
                    except Exception:
                        remote = None
                    if not remote:
                        continue
                    content, content_type = remote
                    base = _main.sanitize_export_filename(requested_name or _main.filename_from_media_url(text, f"image-{count + 1}.bin"), f"image-{count + 1}.bin")
            name, ext = os.path.splitext(base)
            archive_name = base
            suffix = 2
            while archive_name in used_names:
                archive_name = f"{name}-{suffix}{ext}"
                suffix += 1
            used_names.add(archive_name)
            if path and os.path.isfile(path):
                zf.write(path, archive_name)
            elif content:
                zf.writestr(archive_name, content)
            count += 1
    if count <= 0:
        raise HTTPException(status_code=404, detail="没有可下载的内容")
    buffer.seek(0)
    filename = _main.sanitize_export_filename(payload.filename or "canvas-output-images.zip", "canvas-output-images.zip")
    if not filename.lower().endswith(".zip"):
        filename += ".zip"
    encoded = urllib.parse.quote(filename)
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"}
    return Response(buffer.getvalue(), media_type="application/zip", headers=headers)

# --- 资产库 API ---
@router.post("/api/asset-library/libraries")
async def create_asset_library(payload: _main.AssetLibraryRequest):
    lib = _main.load_asset_library()
    library = {"id": f"lib_{uuid.uuid4().hex[:12]}", "name": _main.sanitize_asset_name(payload.name, "资产库"), "type": "asset", "categories": []}
    library["categories"].append({"id": f"cat_{uuid.uuid4().hex[:12]}", "name": "默认分组", "type": "image", "items": []})
    library["categories"].append({"id": f"wf_{uuid.uuid4().hex[:12]}", "name": "工作流", "type": "workflow", "items": []})
    lib.setdefault("libraries", []).append(library)
    lib["active_library_id"] = library["id"]
    _main.save_asset_library(lib)
    return {"library": lib, "asset_library": library}
@router.delete("/api/asset-library/libraries/{library_id}")
async def delete_asset_library(library_id: str):
    lib = _main.load_asset_library()
    libraries = lib.get("libraries") or []
    if len(libraries) <= 1:
        raise HTTPException(status_code=400, detail="至少保留一个资产库")
    if not any(item.get("id") == library_id for item in libraries):
        raise HTTPException(status_code=404, detail="资产库不存在")
    lib["libraries"] = [item for item in libraries if item.get("id") != library_id]
    if lib.get("active_library_id") == library_id:
        lib["active_library_id"] = lib["libraries"][0].get("id")
    _main.save_asset_library(lib)
    return {"library": lib}
@router.post("/api/asset-library/categories")
async def create_asset_library_category(payload: _main.AssetLibraryCategoryRequest):
    lib = _main.load_asset_library()
    library = _main.find_asset_library(lib, payload.library_id)
    if not library:
        raise HTTPException(status_code=404, detail="资产库不存在")
    cat_type = "workflow" if str(payload.type or "").lower() == "workflow" else "image"
    category = {"id": f"cat_{uuid.uuid4().hex[:12]}", "name": _main.sanitize_asset_name(payload.name, "新文件夹"), "type": cat_type, "items": []}
    if cat_type == "image":
        category["dir"] = _main.unique_asset_category_dir(library, payload.name)
        try:
            os.makedirs(os.path.join(_main.ASSET_LIBRARY_DIR, category["dir"]), exist_ok=True)
        except Exception as exc:
            print(f"创建分组文件夹失败: {exc}")
    library.setdefault("categories", []).append(category)
    lib["active_library_id"] = library.get("id") or lib.get("active_library_id")
    _main.save_asset_library(lib)
    return {"library": lib, "category": category}
@router.delete("/api/asset-library/categories/{category_id}")
async def delete_asset_library_category(category_id: str, library_id: str = ""):
    lib = _main.load_asset_library()
    library, cat = _main.find_asset_category_with_library(lib, category_id, library_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    cat_items = cat.get("items") or []
    categories = library.get("categories") or []
    remaining = [c for c in categories if c.get("id") != category_id]
    if remaining:
        fallback_cat = remaining[0]
        fallback_cat.setdefault("items", []).extend(cat_items)
    else:
        default_cat = library.get("categories", [{}])[0] if library.get("categories") else None
        if default_cat and default_cat.get("id") != category_id:
            default_cat.setdefault("items", []).extend(cat_items)
    library["categories"] = remaining
    _main.save_asset_library(lib)
    return {"library": lib}
@router.post("/api/asset-library/items")
async def add_asset_library_item(payload: _main.AssetLibraryAddRequest):
    lib = _main.load_asset_library()
    _, cat = _main.find_asset_category_with_library(lib, payload.category_id, payload.library_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    url = str(payload.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="素材 URL 不能为空")
    item = {
        "id": f"asset_{uuid.uuid4().hex[:12]}",
        "name": _main.sanitize_asset_name(payload.name, "asset"),
        "url": url,
        "kind": _main.asset_library_media_kind(url),
        "created_at": _main.now_ms(),
    }
    cat.setdefault("items", []).append(item)
    lib["active_library_id"] = lib.get("active_library_id") or (_main.find_asset_library(lib, "") or {}).get("id")
    _main.save_asset_library(lib)
    return {"library": lib, "item": item}
@router.post("/api/asset-library/items/batch")
async def batch_add_asset_library_items(payload: _main.AssetLibraryBatchAddRequest):
    lib = _main.load_asset_library()
    _, cat = _main.find_asset_category_with_library(lib, payload.category_id, payload.library_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    added = []
    for entry in (payload.items or [])[:200]:
        url = str(entry.url or "").strip()
        if not url:
            continue
        item = {
            "id": f"asset_{uuid.uuid4().hex[:12]}",
            "name": _main.sanitize_asset_name(entry.name, "asset"),
            "url": url,
            "kind": _main.asset_library_media_kind(url),
            "created_at": _main.now_ms(),
        }
        cat.setdefault("items", []).append(item)
        added.append(item)
    _main.save_asset_library(lib)
    return {"library": lib, "items": added}
@router.post("/api/asset-library/items/classify")
async def classify_asset_library_items(payload: _main.AssetLibraryClassifyRequest):
    lib = _main.load_asset_library()
    results = []
    changed = False
    for item_id in (payload.ids or [])[:80]:
        item = _main.find_asset_item_in_library(lib, item_id, payload.library_id)
        result = {"id": item_id, "ok": False, "classification": None, "error": ""}
        if not item:
            result["error"] = "资产不存在"
            results.append(result)
            continue
        if _main.asset_library_media_kind(item.get("url") or "") != "image" and item.get("kind") != "image":
            result["error"] = "仅支持图片素材智能分类"
            results.append(result)
            continue
        path = _main.output_file_from_url(item.get("url") or "")
        if not path or not os.path.isfile(path):
            result["error"] = "文件不存在"
            results.append(result)
            continue
        try:
            classification = await _main.classify_image_with_provider(path, payload.provider, payload.model, payload.ms_model, payload.prompt)
            item["classification"] = classification
            changed = True
            result.update({"ok": True, "classification": classification})
        except Exception as exc:
            result["error"] = str(getattr(exc, "detail", "") or exc)
        results.append(result)
    if changed:
        _main.save_asset_library(lib)
    return {"library": lib, "count": sum(1 for item in results if item.get("ok")), "items": results}
@router.delete("/api/asset-library/items/{item_id}")
async def delete_asset_library_item(item_id: str):
    lib = _main.load_asset_library()
    removed = None
    for library in lib.get("libraries", []):
        for cat in library.get("categories", []):
            keep = []
            for item in cat.get("items", []):
                if item.get("id") == item_id:
                    removed = item
                else:
                    keep.append(item)
            cat["items"] = keep
    if not removed:
        raise HTTPException(status_code=404, detail="资产不存在")
    _main.remove_asset_library_file(removed)
    _main.save_asset_library(lib)
    return {"library": lib}
@router.post("/api/asset-library/items/delete")
async def batch_delete_asset_library_items(payload: _main.AssetLibraryBatchDeleteRequest):
    ids = {str(item) for item in (payload.ids or []) if str(item)}
    if not ids:
        raise HTTPException(status_code=400, detail="没有选择资产")
    lib = _main.load_asset_library()
    removed = 0
    removed_items = []
    for library in lib.get("libraries", []):
        if payload.library_id and library.get("id") != payload.library_id:
            continue
        for cat in library.get("categories", []):
            keep = []
            for item in cat.get("items", []):
                if item.get("id") in ids:
                    removed += 1
                    removed_items.append(item)
                else:
                    keep.append(item)
            cat["items"] = keep
    for item in removed_items:
        _main.remove_asset_library_file(item)
    _main.save_asset_library(lib)
    return {"library": lib, "removed": removed}
@router.post("/api/asset-library/items/move")
async def batch_move_asset_library_items(payload: _main.AssetLibraryBatchMoveRequest):
    ids = {str(item) for item in (payload.ids or []) if str(item)}
    if not ids:
        raise HTTPException(status_code=400, detail="没有选择资产")
    lib = _main.load_asset_library()
    target_cat = _main.find_asset_category_in_library(lib, payload.target_category_id, payload.target_library_id)
    if not target_cat:
        raise HTTPException(status_code=404, detail="目标分组不存在")
    target_type = target_cat.get("type") or "image"
    moved = []
    for library in lib.get("libraries", []):
        if payload.library_id and library.get("id") != payload.library_id:
            continue
        for cat in library.get("categories", []):
            if (cat.get("type") or "image") != target_type:
                continue
            keep = []
            for item in cat.get("items", []):
                if item.get("id") in ids:
                    moved.append(item)
                else:
                    keep.append(item)
            cat["items"] = keep
    existing_ids = {item.get("id") for item in target_cat.get("items", [])}
    for item in moved:
        if item.get("id") not in existing_ids:
            target_cat.setdefault("items", []).append(item)
            existing_ids.add(item.get("id"))
    _main.save_asset_library(lib)
    return {"library": lib, "moved": len(moved)}
@router.post("/api/asset-library/categories/reorder")
async def reorder_asset_library_categories(payload: _main.AssetLibraryCategoryReorderRequest):
    order = [str(item) for item in (payload.order or []) if str(item)]
    if not order:
        raise HTTPException(status_code=400, detail="排序列表为空")
    lib = _main.load_asset_library()
    library = _main.find_asset_library(lib, payload.library_id)
    if not library:
        raise HTTPException(status_code=404, detail="资产库不存在")
    cats = library.get("categories") or []
    known = {cat.get("id") for cat in cats}
    unknown = [cid for cid in order if cid not in known]
    if unknown:
        raise HTTPException(status_code=400, detail="排序列表含未知分组")
    ranked = {cid: pos for pos, cid in enumerate(order)}
    keep_index = {cat.get("id"): pos for pos, cat in enumerate(cats)}
    cats.sort(key=lambda cat: ranked.get(cat.get("id"), len(ranked) + keep_index.get(cat.get("id"), 0)))
    library["categories"] = cats
    if lib.get("active_library_id") == library.get("id"):
        lib["categories"] = cats
    _main.save_asset_library(lib)
    return {"library": lib, "categories": cats}

@router.post("/api/asset-library/maintenance/scan")
async def scan_asset_library_maintenance(payload: _main.AssetLibraryMaintenanceScanRequest):
    lib = _main.load_asset_library()
    entries = []
    for library in lib.get("libraries", []):
        if payload.library_id and library.get("id") != payload.library_id:
            continue
        for cat in library.get("categories") or []:
            for item in cat.get("items") or []:
                if not isinstance(item, dict):
                    continue
                path = _main.asset_library_item_path(item.get("url"))
                exists = bool(path) and os.path.isfile(path)
                size = 0
                if exists:
                    try:
                        size = os.path.getsize(path)
                    except OSError:
                        size = 0
                try:
                    created_at = int(float(item.get("created_at") or 0))
                except (TypeError, ValueError):
                    created_at = 0
                entries.append({
                    "id": item.get("id") or "",
                    "name": item.get("name") or "",
                    "url": item.get("url") or "",
                    "kind": item.get("kind") or "",
                    "library_id": library.get("id") or "",
                    "category_id": cat.get("id") or "",
                    "category_name": cat.get("name") or "",
                    "path": path or "",
                    "exists": exists,
                    "size": size,
                    "created_at": created_at,
                })
    missing = [row for row in entries if not row["exists"]]
    buckets = {}
    for row in entries:
        if not row["exists"]:
            continue
        fingerprint = _main.asset_file_fingerprint(row["path"], row["size"])
        if not fingerprint:
            continue
        buckets.setdefault((row["size"], fingerprint), []).append(row)
    duplicate_groups = []
    for rows in buckets.values():
        if len(rows) < 2:
            continue
        rows.sort(key=lambda row: row["created_at"] or row["id"])
        duplicate_groups.append({"keep": rows[0], "items": rows[1:], "size": rows[0]["size"]})
    duplicate_groups.sort(key=lambda group: group["size"] * len(group["items"]), reverse=True)
    duplicate_count = sum(len(group["items"]) for group in duplicate_groups)
    reclaim = sum(row["size"] for row in missing) + sum(group["size"] * len(group["items"]) for group in duplicate_groups)
    return {
        "total": len(entries),
        "missing": missing,
        "duplicate_groups": duplicate_groups,
        "duplicate_count": duplicate_count,
        "reclaim_bytes": reclaim,
        "scanned_at": _main.now_ms(),
    }
@router.post("/api/asset-library/items/crop")
async def batch_crop_asset_library_items(payload: _main.AssetLibraryBatchCropRequest):
    ids = {str(item) for item in (payload.ids or []) if str(item)}
    if not ids:
        raise HTTPException(status_code=400, detail="没有选择资产")
    lib = _main.load_asset_library()
    target_cat = None
    if payload.target_category_id:
        target_cat = _main.find_asset_category_in_library(lib, payload.target_category_id, payload.target_library_id)
        if not target_cat:
            raise HTTPException(status_code=404, detail="目标分组不存在")
        if target_cat.get("type") != "image":
            raise HTTPException(status_code=400, detail="目标分组不支持媒体")
    added = []
    for library in lib.get("libraries", []):
        if payload.library_id and library.get("id") != payload.library_id:
            continue
        for cat in library.get("categories", []):
            if cat.get("type") != "image":
                continue
            cat_items = cat.get("items") or []
            target_items = []
            remaining = []
            for item in cat_items:
                if item.get("id") in ids:
                    target_items.append(item)
                else:
                    remaining.append(item)
            cat["items"] = remaining
            if not target_cat:
                target_cat = cat
            for item in target_items:
                existing_ids = {i.get("id") for i in target_cat.get("items", [])}
                if item.get("id") not in existing_ids:
                    target_cat.setdefault("items", []).append(item)
                    added.append(item)
    _main.save_asset_library(lib)
    return {"library": lib, "items": added}

# --- 提示词库 API ---
