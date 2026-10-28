import json
import os
import re
import time
import uuid
import urllib.parse
import hashlib
import asyncio
from typing import List, Dict, Any, Optional
from threading import Lock

from fastapi import APIRouter, HTTPException, File, UploadFile
from pydantic import BaseModel

# 实例化 APIRouter
router = APIRouter()

# 静态变量与路径常量定义。个人数据跟 main 一样走系统用户目录。
from user_paths import user_data_dir
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USER_DATA_DIR = user_data_dir()
DATA_DIR = os.path.join(BASE_DIR, "data")
CANVAS_DIR = os.path.join(USER_DATA_DIR, "canvases")
CONVERSATION_DIR = os.path.join(USER_DATA_DIR, "conversations")
OUTPUT_DIR = os.path.join(USER_DATA_DIR, "output")
INPUT_DIR = os.path.join(USER_DATA_DIR, "input")
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
OUTPUT_OUTPUT_DIR = os.path.join(ASSETS_DIR, "output")
HISTORY_FILE = os.path.join(USER_DATA_DIR, "history.json")
ASSET_LIBRARY_PATH = os.path.join(USER_DATA_DIR, "asset_library.json")
MEDIA_PREVIEW_DIR = os.path.join(USER_DATA_DIR, "media_previews")
CANVAS_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

# 线程锁定义
CANVAS_LOCK = Lock()
HISTORY_LOCK = Lock()

# ----------------------------------------------------------------------
# Pydantic 数据模型定义
# ----------------------------------------------------------------------

class CanvasCreateRequest(BaseModel):
    title: str = "未命名画布"
    icon: str = "🧩"
    kind: str = "classic"

class CanvasSaveRequest(BaseModel):
    title: str = "未命名画布"
    icon: str = "🧩"
    nodes: List[Dict[str, Any]] = []
    connections: List[Dict[str, Any]] = []
    viewport: Dict[str, Any] = {}
    logs: List[Dict[str, Any]] = []

class DeleteCanvasLogRequest(BaseModel):
    log_id: str = ""
    delete_unreferenced_media: bool = False
    reset_referencing_nodes: bool = False
    base_updated_at: int = 0

class CanvasMetaUpdate(BaseModel):
    title: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    pinned: Optional[bool] = None

# ----------------------------------------------------------------------
# 外部逻辑依赖导入（来自 main.py）— 使用延迟导入避免循环依赖
# ----------------------------------------------------------------------
# 以下函数在路由执行时按需从 main 模块导入，避免启动时循环导入
def _get_main_deps():
    import main as _m
    return {
        "find_user_by_token": _m.find_user_by_token,
        "get_username_by_token": _m.get_username_by_token,
        "validate_canvas_owner": _m.validate_canvas_owner,
        "get_user_dirname": _m.get_user_dirname,
        "safe_user_id": _m.safe_user_id,
        "now_ms": _m.now_ms,
        "atomic_write_json": _m.atomic_write_json,
    }

# ----------------------------------------------------------------------
# 辅助函数定义
# ----------------------------------------------------------------------

def sanitize_folder_name(title, canvas_id):
    """生成安全的文件夹名称"""
    name = re.sub(r'[\/\:*?"<>|]', '_', title or '未命名')
    name = name[:60].strip()
    suffix = canvas_id[:8]
    return f"{name}_{suffix}" if name else suffix

def get_canvas_output_dir(canvas):
    """获取画布的输出目录路径(含用户隔离)"""
    deps = _get_main_deps()
    get_user_dirname = deps["get_user_dirname"]
    owner = get_user_dirname(canvas.get("owner")) if canvas.get("owner") else ""
    folder = canvas.get("output_folder", "")
    if owner and folder:
        return os.path.join(OUTPUT_DIR, owner, folder)
    elif folder:
        return os.path.join(OUTPUT_DIR, folder)
    elif owner:
        path = os.path.join(OUTPUT_DIR, owner)
        os.makedirs(path, exist_ok=True)
        return path
    return OUTPUT_DIR

def get_canvas_asset_dir(canvas):
    """获取画布的资产目录路径(含用户隔离)"""
    deps = _get_main_deps()
    get_user_dirname = deps["get_user_dirname"]
    owner = get_user_dirname(canvas.get("owner")) if canvas.get("owner") else ""
    folder = canvas.get("output_folder", "")
    if owner and folder:
        return os.path.join(INPUT_DIR, owner, folder)
    elif folder:
        return os.path.join(INPUT_DIR, folder)
    elif owner:
        path = os.path.join(INPUT_DIR, owner)
        os.makedirs(path, exist_ok=True)
        return path
    return INPUT_DIR

def build_asset_url(canvas, filename):
    """构建 asset 文件的 URL 路径(含用户隔离)"""
    deps = _get_main_deps()
    get_user_dirname = deps["get_user_dirname"]
    if canvas:
        owner = get_user_dirname(canvas.get("owner")) if canvas.get("owner") else ""
        folder = canvas.get("output_folder", "")
        if owner and folder:
            return f"/assets/{owner}/{folder}/{filename}"
        elif folder:
            return f"/assets/{folder}/{filename}"
        elif owner:
            return f"/assets/{owner}/{filename}"
        else:
            return f"/assets/{filename}"
    return f"/assets/{filename}"

def canvas_path(canvas_id):
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "", canvas_id or "")
    if not cleaned:
        raise HTTPException(status_code=400, detail="无效的画布 ID")
    return os.path.join(CANVAS_DIR, f"{cleaned}.json")

def save_canvas(canvas):
    deps = _get_main_deps()
    now_ms = deps["now_ms"]
    canvas["updated_at"] = now_ms()
    with CANVAS_LOCK:
        deps["atomic_write_json"](canvas_path(canvas["id"]), canvas)

def new_canvas(title="未命名画布", icon="layers", owner=None):
    deps = _get_main_deps()
    now_ms = deps["now_ms"]
    get_user_dirname = deps["get_user_dirname"]
    timestamp = now_ms()
    canvas_id = uuid.uuid4().hex
    folder_name = sanitize_folder_name(title, canvas_id)

    # 创建画布专属输出文件夹(含用户目录嵌套)
    user_dirname = get_user_dirname(owner) if owner else ""
    canvas_dir = os.path.join(OUTPUT_DIR, user_dirname, folder_name) if user_dirname else os.path.join(OUTPUT_DIR, folder_name)
    os.makedirs(canvas_dir, exist_ok=True)

    canvas = {
        "id": canvas_id,
        "title": (title or "未命名画布")[:80],
        "icon": (icon or "🧩")[:4],
        "owner": owner,
        "output_folder": folder_name,
        "created_at": timestamp,
        "updated_at": timestamp,
        "nodes": [],
        "connections": [],
        "viewport": {"x": 0, "y": 0, "scale": 1},
    }
    save_canvas(canvas)
    return canvas

def load_canvas(canvas_id):
    path = canvas_path(canvas_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="画布不存在")
    with open(path, 'r', encoding='utf-8') as f:
        canvas = json.load(f)
    if canvas.get("deleted_at"):
        raise HTTPException(status_code=404, detail="画布已在回收站")
    return canvas

def load_canvas_any(canvas_id):
    path = canvas_path(canvas_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="画布不存在")
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def canvas_record(data):
    image_source = None
    if data.get("title", "").startswith("图片编辑"):
        source = next((node for node in data.get("nodes", []) if node.get("type") == "image"), None)
        if source:
            versions = source.get("imageVersions") or []
            image_source = versions[0].get("url") if versions else source.get("url")
    return {
        "image_edit_source": image_source,
        "id": data.get("id"),
        "title": data.get("title", "未命名画布"),
        "icon": data.get("icon", "🧩"),
        "kind": data.get("kind", "classic"),
        "created_at": data.get("created_at", 0),
        "updated_at": data.get("updated_at", 0),
        "deleted_at": data.get("deleted_at", 0),
        "node_count": len(data.get("nodes", [])),
    }

def cleanup_expired_canvas_trash():
    deps = _get_main_deps()
    now_ms = deps["now_ms"]
    cutoff = now_ms() - CANVAS_TRASH_RETENTION_MS
    with CANVAS_LOCK:
        if not os.path.exists(CANVAS_DIR):
            return
        for filename in os.listdir(CANVAS_DIR):
            if not filename.endswith(".json"):
                continue
            path = os.path.join(CANVAS_DIR, filename)
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                deleted_at = int(data.get("deleted_at") or 0)
                if deleted_at and deleted_at < cutoff:
                    os.remove(path)
            except Exception:
                continue

def iter_canvas_records(include_deleted=False, owner_filter=None):
    cleanup_expired_canvas_trash()
    records = []
    if not os.path.exists(CANVAS_DIR):
        return records
    for filename in os.listdir(CANVAS_DIR):
        if not filename.endswith(".json"):
            continue
        try:
            with open(os.path.join(CANVAS_DIR, filename), 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            continue
        is_deleted = bool(data.get("deleted_at"))
        if include_deleted != is_deleted:
            continue
        if owner_filter is not None and data.get("owner") != owner_filter:
            continue
        records.append(canvas_record(data))
    return records

def list_canvases(owner_filter=None):
    records = iter_canvas_records(include_deleted=False, owner_filter=owner_filter)
    return sorted(records, key=lambda item: item["updated_at"], reverse=True)

def list_deleted_canvases(owner_filter=None):
    records = iter_canvas_records(include_deleted=True, owner_filter=owner_filter)
    return sorted(records, key=lambda item: item["deleted_at"], reverse=True)

# --- 画布生成日志辅助函数（移植自 Infinite-Canvas，用于 logs/delete 端点） ---

def collect_local_media_urls(value: Any) -> List[str]:
    """Collect local /assets and /output URLs from nested canvas log payloads."""
    urls: List[str] = []
    if isinstance(value, str):
        text = value.strip()
        if text.startswith(("/assets/", "/output/", "/api/storage-files/")):
            urls.append(text)
    elif isinstance(value, dict):
        for item in value.values():
            urls.extend(collect_local_media_urls(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            urls.extend(collect_local_media_urls(item))
    return urls

def local_media_path_from_url(url: str) -> Optional[str]:
    """Resolve a local media URL using the same one-to-one mapping as app mounts."""
    if not url:
        return None
    clean = urllib.parse.unquote(str(url).split("?", 1)[0]).replace("\\", "/")
    if clean.startswith("/api/storage-files/"):
        # 注: main.py 无 storage_file_path 函数也无 /api/storage-files 路由(HEAD 潜在
        # NameError 死分支)。此处安全降级为 None, 与"无法解析"语义一致。
        return None
    if clean.startswith("/assets/"):
        root = ASSETS_DIR
        rel = clean[len("/assets/"):]
    elif clean.startswith("/output/"):
        root = OUTPUT_DIR
        rel = clean[len("/output/"):]
    else:
        return None
    rel = rel.lstrip("/")
    if not rel:
        return None
    root_abs = os.path.abspath(root)
    path = os.path.abspath(os.path.join(root_abs, rel))
    try:
        return path if os.path.commonpath([root_abs, path]) == root_abs and os.path.exists(path) else None
    except ValueError:
        return None

def generated_media_path_from_url(url: str) -> Optional[str]:
    """Resolve a URL only when it points inside a generated-output directory."""
    try:
        path = local_media_path_from_url(url)
    except (HTTPException, OSError, ValueError):
        return None
    if not path or not os.path.isfile(path):
        return None
    path = os.path.realpath(path)
    for root in (OUTPUT_OUTPUT_DIR, OUTPUT_DIR):
        root_abs = os.path.realpath(root)
        try:
            if os.path.commonpath([root_abs, path]) == root_abs:
                return path
        except ValueError:
            continue
    return None

def json_references_media_path(value: Any, target_path: str) -> bool:
    """Return True when a JSON-compatible value references the local media file."""
    target = os.path.normcase(os.path.realpath(target_path))
    if isinstance(value, str):
        try:
            resolved = local_media_path_from_url(value.strip())
        except (HTTPException, OSError, ValueError):
            return False
        return bool(resolved and os.path.normcase(os.path.realpath(resolved)) == target)
    if isinstance(value, dict):
        return any(json_references_media_path(item, target) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(json_references_media_path(item, target) for item in value)
    return False

def persisted_json_references_media_path(target_path: str) -> bool:
    """Scan persisted user documents before deleting generated media."""
    candidates = [ASSET_LIBRARY_PATH]
    for root in (CANVAS_DIR, CONVERSATION_DIR):
        if os.path.isdir(root):
            for current, _, files in os.walk(root):
                candidates.extend(os.path.join(current, name) for name in files if name.lower().endswith(".json"))
    seen: set = set()
    for path in candidates:
        path = os.path.abspath(path)
        if path in seen or not os.path.isfile(path):
            continue
        seen.add(path)
        try:
            with open(path, "r", encoding="utf-8-sig") as handle:
                value = json.load(handle)
        except (OSError, UnicodeError, json.JSONDecodeError):
            return True
        if json_references_media_path(value, target_path):
            return True
    return False

def prune_generation_history_for_media(paths: List[str]) -> int:
    """Remove history cards that would otherwise point at deleted media."""
    if not paths or not os.path.isfile(HISTORY_FILE):
        return 0
    try:
        with HISTORY_LOCK:
            with open(HISTORY_FILE, "r", encoding="utf-8-sig") as handle:
                history = json.load(handle)
            if not isinstance(history, list):
                return 0
            kept = [
                record for record in history
                if not any(json_references_media_path(record, path) for path in paths)
            ]
            removed = len(history) - len(kept)
            if removed:
                import main as _m
                _m.atomic_write_json(HISTORY_FILE, kept, indent=4)
            return removed
    except (OSError, UnicodeError, json.JSONDecodeError):
        return 0

def smart_owned_result_items(images: List[Any], paths: List[str]) -> List[Any]:
    """Return generated results, including legacy results without the marker."""
    return [
        item for item in images
        if isinstance(item, dict)
        and item.get("loopInputPreview") is not True
        and (
            item.get("generatedResult") is True
            or any(json_references_media_path(item, path) for path in paths)
        )
    ]

def expand_canvas_generated_media_paths(canvas: Dict[str, Any], paths: List[str]) -> List[str]:
    """Include every generated result owned by a result node touched by the log."""
    expanded = list(paths)
    for node in list(canvas.get("nodes") or []):
        node_type = str(node.get("type") or "").strip().lower()
        images = list(node.get("images") or [])
        if node_type == "output":
            owned_items = images
        elif node_type == "smart-image":
            owned_items = smart_owned_result_items(images, paths)
        else:
            owned_items = []
        if not any(json_references_media_path(item, path) for item in owned_items for path in paths):
            continue
        for item in owned_items:
            for url in collect_local_media_urls(item):
                candidate = generated_media_path_from_url(url)
                if candidate and candidate not in expanded:
                    expanded.append(candidate)
    return expanded

def reset_canvas_result_nodes_for_media(canvas: Dict[str, Any], paths: List[str]) -> List[str]:
    """Clear generated media while preserving prompts, references, settings and links."""
    reset_ids: List[str] = []
    updated_nodes: List[Dict[str, Any]] = []
    for node in list(canvas.get("nodes") or []):
        node = dict(node)
        node_type = str(node.get("type") or "").strip().lower()
        changed = False
        if isinstance(node.get("generatedOutputs"), list):
            outputs = list(node.get("generatedOutputs") or [])
            kept_outputs = [
                item for item in outputs
                if not any(json_references_media_path(item, path) for path in paths)
            ]
            if len(kept_outputs) != len(outputs):
                node["generatedOutputs"] = kept_outputs
                changed = True
        if node_type in {"smart-image", "output"} and isinstance(node.get("images"), list):
            images = list(node.get("images") or [])
            if node_type == "smart-image":
                owned_items = smart_owned_result_items(images, paths)
            else:
                owned_items = images
            owns_target = any(
                json_references_media_path(item, path) for item in owned_items for path in paths
            )
            kept_images = [
                item for item in images
                if not (
                    owns_target
                    and item in owned_items
                    and any(json_references_media_path(item, path) for path in paths)
                )
            ]
            if len(kept_images) != len(images):
                node["images"] = kept_images
                changed = True
                if node_type == "output":
                    node["_pending"] = []
                    node["imageComparisons"] = {}
                if node_type == "smart-image":
                    node["pending"] = 0
                    node["running"] = False
                    node["queued"] = False
                    for key in (
                        "jimengPending", "pendingTasks", "runStartedAt", "runFinishedAt",
                        "runElapsedMs", "runTimerHidden", "outputKind", "w", "h",
                    ):
                        node.pop(key, None)
        elif node_type == "image" and any(json_references_media_path(node.get("url"), path) for path in paths):
            node["url"] = ""
            node["mediaKind"] = "image"
            node["name"] = "空白图片"
            changed = True
        if changed and node.get("id"):
            reset_ids.append(str(node["id"]))
        updated_nodes.append(node)

    if reset_ids:
        canvas["nodes"] = updated_nodes
    return reset_ids

def delete_media_preview_cache(path: str) -> int:
    """Delete derived previews for a source file before the source disappears."""
    try:
        stat = os.stat(path)
    except OSError:
        return 0
    source = os.path.realpath(path)
    removed = 0
    for width in range(0, 4097):
        keys = [hashlib.sha1(f"{source}|{stat.st_mtime_ns}|{stat.st_size}|{width}|jpg".encode("utf-8", "ignore")).hexdigest() + ".jpg"]
        if 64 <= width <= 2048:
            preview_key = hashlib.sha1(f"{source}|{stat.st_mtime_ns}|{stat.st_size}|{width}".encode("utf-8", "ignore")).hexdigest()
            keys.extend((preview_key + ".webp", preview_key + ".png"))
        for name in keys:
            cache_path = os.path.join(MEDIA_PREVIEW_DIR, name)
            try:
                if os.path.isfile(cache_path):
                    os.remove(cache_path)
                    removed += 1
            except OSError:
                pass
    return removed


def _owned_canvas(canvas_id):
    canvas = load_canvas(canvas_id)
    _get_main_deps()["validate_canvas_owner"](canvas, "")
    return canvas

# ----------------------------------------------------------------------
# 路由函数定义
# ----------------------------------------------------------------------

@router.get("/api/canvases")
async def canvases(token: str = ""):
    deps = _get_main_deps()
    find_user_by_token = deps["find_user_by_token"]
    username, user = find_user_by_token(token)
    is_admin = bool(user and user.get("is_admin", False)) if user else False
    if not is_admin and not username:
        return {"canvases": []}
    owner_filter = None if is_admin else username
    return {"canvases": list_canvases(owner_filter=owner_filter)}

@router.get("/api/canvases/trash")
async def trashed_canvases(token: str = ""):
    deps = _get_main_deps()
    find_user_by_token = deps["find_user_by_token"]
    username, user = find_user_by_token(token)
    is_admin = bool(user and user.get("is_admin", False)) if user else False
    if not is_admin and not username:
        return {"canvases": [], "retention_days": 30}
    owner_filter = None if is_admin else username
    return {"canvases": list_deleted_canvases(owner_filter=owner_filter), "retention_days": 30}

@router.post("/api/canvases")
async def create_canvas(payload: CanvasCreateRequest, token: str = ""):
    deps = _get_main_deps()
    get_username_by_token = deps["get_username_by_token"]
    username = get_username_by_token(token)
    canvas = new_canvas(payload.title, payload.icon, owner=username)
    canvas["kind"] = payload.kind or "classic"
    save_canvas(canvas)
    return {"canvas": canvas}

@router.get("/api/canvases/{canvas_id}")
async def get_canvas(canvas_id: str, token: str = ""):
    deps = _get_main_deps()
    validate_canvas_owner = deps["validate_canvas_owner"]
    canvas = _owned_canvas(canvas_id)
    validate_canvas_owner(canvas, token)
    return {"canvas": canvas}

@router.put("/api/canvases/{canvas_id}")
async def update_canvas(canvas_id: str, payload: CanvasSaveRequest, token: str = ""):
    deps = _get_main_deps()
    validate_canvas_owner = deps["validate_canvas_owner"]
    canvas = _owned_canvas(canvas_id)
    validate_canvas_owner(canvas, token)
    canvas["title"] = (payload.title or canvas.get("title") or "未命名画布")[:80]
    canvas["icon"] = (payload.icon or canvas.get("icon") or "layers")[:32]
    canvas["nodes"] = payload.nodes
    canvas["connections"] = payload.connections
    canvas["viewport"] = payload.viewport
    # 保存生成日志（最多 500 条；从 Infinite-Canvas 移植：画布层独立日志管理）
    canvas["logs"] = list(payload.logs or [])[-500:]
    save_canvas(canvas)
    return {"canvas": canvas}

@router.delete("/api/canvases/{canvas_id}")
async def delete_canvas(canvas_id: str, token: str = ""):
    deps = _get_main_deps()
    validate_canvas_owner = deps["validate_canvas_owner"]
    now_ms = deps["now_ms"]
    canvas = load_canvas_any(canvas_id)
    validate_canvas_owner(canvas, token)
    if not canvas.get("deleted_at"):
        canvas["deleted_at"] = now_ms()
        save_canvas(canvas)
    return {"ok": True}

@router.post("/api/canvases/{canvas_id}/logs/delete")
async def delete_canvas_log(canvas_id: str, payload: DeleteCanvasLogRequest, token: str = ""):
    """删除画布的一条生成日志（移植自 Infinite-Canvas）。

    可选副作用：
    - delete_unreferenced_media=True：删除该日志产出的本地媒体文件（其他画布/会话还在引用则跳过）
    - reset_referencing_nodes=True：清空画布上引用这些媒体的节点的 generatedOutputs / images
    """
    deps = _get_main_deps()
    validate_canvas_owner = deps["validate_canvas_owner"]
    log_id = str(payload.log_id or "").strip()
    if not log_id:
        raise HTTPException(status_code=400, detail="缺少日志 ID")

    def remove_log_record():
        with CANVAS_LOCK:
            canvas = _owned_canvas(canvas_id)
            validate_canvas_owner(canvas, token)
            current_updated_at = int(canvas.get("updated_at") or 0)
            if payload.base_updated_at and current_updated_at and int(payload.base_updated_at) < current_updated_at:
                raise HTTPException(status_code=409, detail={
                    "message": "画布已被其他页面更新，请刷新后重试。",
                    "canvas": canvas,
                    "updated_at": current_updated_at,
                })
            logs = list(canvas.get("logs") or [])
            target = next((item for item in logs if str(item.get("id") or "") == log_id), None)
            if not target:
                raise HTTPException(status_code=404, detail="生成日志不存在")

            candidate_paths: List[str] = []
            if payload.delete_unreferenced_media:
                for url in collect_local_media_urls(target.get("outputs") or []):
                    path = generated_media_path_from_url(url)
                    if path and path not in candidate_paths:
                        candidate_paths.append(path)

            reset_node_ids: List[str] = []
            if payload.reset_referencing_nodes and candidate_paths:
                candidate_paths = expand_canvas_generated_media_paths(canvas, candidate_paths)
                reset_node_ids = reset_canvas_result_nodes_for_media(canvas, candidate_paths)

            canvas["logs"] = [item for item in logs if str(item.get("id") or "") != log_id]
            save_canvas(canvas)
            return canvas, candidate_paths, reset_node_ids

    canvas, candidate_paths, reset_node_ids = await asyncio.to_thread(remove_log_record)

    removed_files: List[str] = []
    skipped_referenced: List[str] = []
    removed_previews = 0
    if payload.delete_unreferenced_media:
        def cleanup_unreferenced_media():
            removed: List[str] = []
            skipped: List[str] = []
            previews = 0
            deletable: List[str] = []
            for path in candidate_paths:
                if persisted_json_references_media_path(path):
                    skipped.append(os.path.basename(path))
                    continue
                deletable.append(path)
            prune_generation_history_for_media(deletable)
            for path in deletable:
                try:
                    previews += delete_media_preview_cache(path)
                    os.remove(path)
                    removed.append(os.path.basename(path))
                except OSError:
                    skipped.append(os.path.basename(path))
            return removed, skipped, previews

        def locked_cleanup():
            with CANVAS_LOCK:
                return cleanup_unreferenced_media()

        removed_files, skipped_referenced, removed_previews = await asyncio.to_thread(locked_cleanup)

    return {
        "ok": True,
        "canvas": canvas,
        "removed_files": removed_files,
        "removed_previews": removed_previews,
        "reset_node_ids": reset_node_ids,
        "skipped_referenced": skipped_referenced,
    }

@router.post("/api/canvases/{canvas_id}/restore")
async def restore_canvas(canvas_id: str, token: str = ""):
    deps = _get_main_deps()
    validate_canvas_owner = deps["validate_canvas_owner"]
    canvas = load_canvas_any(canvas_id)
    validate_canvas_owner(canvas, token)
    if canvas.get("deleted_at"):
        canvas.pop("deleted_at", None)
        save_canvas(canvas)
    return {"canvas": canvas}

@router.delete("/api/canvases/{canvas_id}/purge")
async def purge_canvas(canvas_id: str, token: str = ""):
    deps = _get_main_deps()
    validate_canvas_owner = deps["validate_canvas_owner"]
    canvas = load_canvas_any(canvas_id)
    validate_canvas_owner(canvas, token)
    path = canvas_path(canvas_id)
    if os.path.exists(path):
        os.remove(path)
    return {"ok": True}

@router.get("/api/canvases/{canvas_id}/files")
async def list_canvas_files(canvas_id: str):
    canvas = _owned_canvas(canvas_id)
    canvas_output_dir = get_canvas_output_dir(canvas)
    if not os.path.exists(canvas_output_dir):
        return {"files": []}

    files = []
    try:
        for filename in sorted(os.listdir(canvas_output_dir), key=lambda f: os.path.getmtime(os.path.join(canvas_output_dir, f)), reverse=True):
            filepath = os.path.join(canvas_output_dir, filename)
            if os.path.isfile(filepath):
                stat = os.stat(filepath)
                files.append({
                    "name": filename,
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                    "url": f"/output/{canvas['output_folder']}/{filename}"
                })
    except Exception as e:
        print(f"读取画布文件列表失败: {e}")
        return {"files": [], "error": str(e)}
    return {"files": files}

@router.post("/api/canvases/{canvas_id}/asset-folder")
async def create_asset_folder(canvas_id: str):
    """创建或确认画布资产文件夹存在"""
    deps = _get_main_deps()
    get_user_dirname = deps["get_user_dirname"]
    canvas = _owned_canvas(canvas_id)
    asset_dir = get_canvas_asset_dir(canvas)
    os.makedirs(asset_dir, exist_ok=True)
    folder_name = canvas.get("output_folder", "")
    owner = get_user_dirname(canvas.get("owner")) if canvas.get("owner") else ""
    path = f"/assets/{owner}/{folder_name}" if owner and folder_name else (f"/assets/{folder_name}" if folder_name else "/assets")
    return {"folder": folder_name, "path": path}

@router.get("/api/canvases/{canvas_id}/assets")
async def list_assets(canvas_id: str):
    """获取画布资产文件列表(含用户级资产,互通在线生图保存的文件)"""
    canvas = _owned_canvas(canvas_id)
    asset_dir = get_canvas_asset_dir(canvas)

    seen = set()
    files = []

    def collect_from(dir_path, url_builder):
        if not os.path.exists(dir_path):
            return
        for filename in sorted(os.listdir(dir_path), key=lambda f: os.path.getmtime(os.path.join(dir_path, f)), reverse=True):
            filepath = os.path.join(dir_path, filename)
            if os.path.isfile(filepath) and filename not in seen:
                seen.add(filename)
                stat = os.stat(filepath)
                ext = os.path.splitext(filename)[1].lower()
                files.append({
                    "name": filename,
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                    "url": url_builder(filename),
                    "type": "image" if ext in [".png", ".jpg", ".jpeg", ".webp", ".gif"] else "video" if ext in [".mp4", ".webm", ".mov", ".avi", ".mkv"] else "audio" if ext in [".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a"] else "text" if ext == ".txt" else "other"
                })

    try:
        # 1. 画布专属资产文件夹
        collect_from(asset_dir, lambda fn: build_asset_url(canvas, fn))

        # 2. 用户级资产文件夹(在线生图等保存的资产),使其互通
        owner = canvas.get("owner", "")
        if owner:
            deps = _get_main_deps()
            get_user_dirname = deps["get_user_dirname"]
            user_dirname = get_user_dirname(owner)
            user_asset_dir = os.path.join(INPUT_DIR, user_dirname)
            collect_from(user_asset_dir, lambda fn: f"/assets/{user_dirname}/{fn}")

        # 按修改时间倒序
        files.sort(key=lambda f: f["modified"], reverse=True)
    except Exception as e:
        print(f"读取资产文件列表失败: {e}")
        return {"files": [], "error": str(e)}
    return {"files": files}

@router.post("/api/canvases/{canvas_id}/assets/upload")
async def upload_assets(canvas_id: str, files: List[UploadFile] = File(...)):
    """上传图片到画布资产文件夹"""
    canvas = _owned_canvas(canvas_id)
    asset_dir = get_canvas_asset_dir(canvas)
    os.makedirs(asset_dir, exist_ok=True)

    uploaded = []
    for file in files:
        content = await file.read()
        if not content:
            continue
        ext = os.path.splitext(file.filename or "")[1].lower()
        allowed_exts = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt", ".mp4", ".webm", ".mov", ".avi", ".mkv", ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a"]
        if ext not in allowed_exts:
            ext = ".bin"
        filename = f"asset_{uuid.uuid4().hex[:12]}{ext}"
        path = os.path.join(asset_dir, filename)
        with open(path, "wb") as f:
            f.write(content)
        url_path = build_asset_url(canvas, filename)
        uploaded.append({"url": url_path, "name": file.filename or filename})
    return {"files": uploaded}

@router.post("/api/canvases/{canvas_id}/assets/copy-from-canvas")
async def copy_asset_from_canvas(canvas_id: str, payload: dict = None):
    """从画布的 Output 节点复制图片到资产文件夹"""
    canvas = _owned_canvas(canvas_id)
    asset_dir = get_canvas_asset_dir(canvas)
    os.makedirs(asset_dir, exist_ok=True)

    urls = (payload or {}).get("urls", [])
    copied = []
    for url in urls:
        if not url or not url.startswith("/output/"):
            continue
        clean_url = url.split("?")[0]
        relative = clean_url[len("/output/"):]
        source_path = os.path.join(OUTPUT_DIR, relative)
        if not os.path.exists(source_path):
            continue
        ext = os.path.splitext(relative)[1].lower() or ".png"
        filename = f"asset_{uuid.uuid4().hex[:12]}{ext}"
        dest_path = os.path.join(asset_dir, filename)
        try:
            import shutil
            shutil.copy2(source_path, dest_path)
            url_path = build_asset_url(canvas, filename)
            copied.append({"url": url_path, "name": filename, "original": url})
        except Exception as e:
            print(f"复制资产失败: {e}")
    return {"files": copied}

@router.get("/api/canvases/{canvas_id}/meta")
async def get_canvas_meta(canvas_id: str):
    canvas = _owned_canvas(canvas_id)
    return {"meta": {"title": canvas.get("title"), "icon": canvas.get("icon"), "color": canvas.get("color"), "pinned": canvas.get("pinned", False)}}

@router.post("/api/canvases/{canvas_id}/meta")
async def update_canvas_meta(canvas_id: str, payload: CanvasMetaUpdate = None):
    """更新画布元数据（标题/图标/颜色等）"""
    canvas = _owned_canvas(canvas_id)
    if not payload:
        return {"meta": {}}
    if payload.title is not None:
        canvas["title"] = payload.title[:80]
    if payload.icon is not None:
        canvas["icon"] = payload.icon[:32]
    if payload.color is not None:
        canvas["color"] = payload.color.strip()
    if payload.pinned is not None:
        canvas["pinned"] = payload.pinned
    save_canvas(canvas)
    return {"meta": {"title": canvas.get("title"), "icon": canvas.get("icon"), "color": canvas.get("color")}}

@router.post("/api/canvases/{canvas_id}/touch")
async def touch_canvas(canvas_id: str):
    """更新画布最后打开时间"""
    canvas = _owned_canvas(canvas_id)
    canvas["updated_at"] = int(time.time())
    save_canvas(canvas)
    return {"touched": True}

@router.post("/api/canvases/{canvas_id}/assets/delete")
async def delete_asset(canvas_id: str, payload: dict = None):
    """删除资产文件夹中的指定文件"""
    canvas = _owned_canvas(canvas_id)
    asset_dir = get_canvas_asset_dir(canvas)
    filename = (payload or {}).get("filename", "")
    if not filename:
        raise HTTPException(status_code=400, detail="缺少文件名")
    safe_name = os.path.basename(filename.replace("\\", "/"))
    filepath = os.path.join(asset_dir, safe_name)
    if not filepath.startswith(os.path.abspath(asset_dir)):
        raise HTTPException(status_code=400, detail="无效的文件名")
    if os.path.exists(filepath) and os.path.isfile(filepath):
        os.remove(filepath)
        return {"ok": True}
    raise HTTPException(status_code=404, detail="文件不存在")
