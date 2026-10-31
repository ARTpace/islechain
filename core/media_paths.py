"""生成物落盘路径的唯一入口。

目录规范：
    {root}/{owner}/{type}/{feature}/{YYYY-MM-DD}/{filename}

    owner   用户隔离目录名，空串表示不分用户
    type    image | video | audio，由注册表决定；未登记时按文件扩展名兜底
    feature 模型/功能标识，注册表可为其指定目录名(folder)与展示名(label/group)

注册表：
    data/media-folders.json          随包只读基线
    {用户数据目录}/data/media-folders.json   覆盖层（改标签/分组/新增模型，升级不丢）

新增模型不需要改代码：首次落盘时未登记的 feature 会自动登记进覆盖层（带 auto 标记），
之后可在注册表里补 label / group，或直接留空用 id 当展示名。
"""

import json
import os
import re
import threading
import time
from typing import Any, Dict, Optional, Tuple

from .user_paths import user_data_dir

MEDIA_TYPES = ("image", "video", "audio")
DEFAULT_FEATURE = "other"
DEFAULT_TYPE = "image"

REGISTRY_NAME = "media-folders.json"
REGISTRY_VERSION = 1

_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif", ".tiff"}
_VIDEO_EXT = {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv", ".flv", ".wmv"}
_AUDIO_EXT = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus"}

_ILLEGAL = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_SPACES = re.compile(r"\s+")

_lock = threading.RLock()
_cache: Dict[str, Any] = {"stamp": None, "data": None}


# --- 路径 ---

def project_root() -> str:
    # 本模块位于 core/，项目根在其上一层
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def output_root() -> str:
    return os.path.join(user_data_dir(), "output")


def builtin_registry_path() -> str:
    return os.path.join(project_root(), "data", REGISTRY_NAME)


def user_registry_path() -> str:
    return os.path.join(user_data_dir(), "data", REGISTRY_NAME)


# --- 净化 ---

def sanitize_segment(value: Any, fallback: str = DEFAULT_FEATURE) -> str:
    """把任意字符串变成安全的单层目录名：去掉路径分隔符、控制字符、前后点号。"""
    text = str(value or "").strip()
    text = _ILLEGAL.sub("_", text)
    text = _SPACES.sub(" ", text).strip(". ")
    if not text or text in {".", ".."}:
        return fallback
    return text[:48]


def guess_type_from_ext(name: Any) -> str:
    text = str(name or "").strip().lower()
    # 允许直接传纯扩展名（调用方常传 ".mp4"）。注意 os.path.splitext(".mp4")
    # 会把它当成隐藏文件、返回空扩展名，导致兜底彻底失效，这里先兜一层。
    ext = text if text.startswith(".") and "/" not in text and "\\" not in text else os.path.splitext(text)[1]
    ext = ext.lower()
    if ext in _IMAGE_EXT:
        return "image"
    if ext in _VIDEO_EXT:
        return "video"
    if ext in _AUDIO_EXT:
        return "audio"
    return ""


def normalize_type(value: Any) -> str:
    text = str(value or "").strip().lower()
    return text if text in MEDIA_TYPES else ""


# --- 注册表 ---

def _read_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _registry_stamp() -> Tuple[float, float]:
    def _mtime(path: str) -> float:
        try:
            return os.path.getmtime(path)
        except OSError:
            return 0.0
    return (_mtime(builtin_registry_path()), _mtime(user_registry_path()))


def registry() -> Dict[str, Any]:
    """返回合并后的注册表 {types, features, auto}；按文件 mtime 缓存。"""
    stamp = _registry_stamp()
    with _lock:
        if _cache["data"] is not None and _cache["stamp"] == stamp:
            return _cache["data"]

    builtin = _read_json(builtin_registry_path())
    user = _read_json(user_registry_path())

    features: Dict[str, Dict[str, Any]] = {}
    auto = set()
    for source in (builtin, user):
        raw = source.get("features")
        if not isinstance(raw, dict):
            continue
        for key, entry in raw.items():
            name = str(key or "").strip()
            if not name:
                continue
            merged = features.setdefault(name, {})
            if isinstance(entry, dict):
                merged.update(entry)
                if entry.get("auto"):
                    auto.add(name)
                else:
                    auto.discard(name)

    types = list(MEDIA_TYPES)
    for source in (builtin, user):
        extra = source.get("types")
        if isinstance(extra, list):
            for item in extra:
                kind = normalize_type(item)
                if kind and kind not in types:
                    types.append(kind)

    data = {"version": REGISTRY_VERSION, "types": types, "features": features, "auto": auto}
    with _lock:
        _cache["stamp"] = stamp
        _cache["data"] = data
    return data


def _entry(name: str) -> Dict[str, Any]:
    entry = registry()["features"].get(name)
    return entry if isinstance(entry, dict) else {}


def canonical_feature(name: Any) -> str:
    """把前端传来的名字映射到注册表 key（大小写不敏感）；未登记时返回净化后的原样。"""
    raw = str(name or "").strip()
    if not raw:
        return DEFAULT_FEATURE
    features = registry()["features"]
    if raw in features:
        return raw
    lowered = raw.lower()
    for key in features:
        if key.lower() == lowered:
            return key
    return sanitize_segment(raw)


def folder_of(name: Any) -> str:
    """feature 的目录名：注册表 folder 优先，否则用 key 本身。"""
    key = canonical_feature(name)
    entry = _entry(key)
    folder = entry.get("folder")
    return sanitize_segment(folder, sanitize_segment(key))


def type_of(name: Any, kind: Optional[str] = None, ext: str = "") -> str:
    """媒体类型优先级：

    1. 人工登记（auto=false）—— 权威，不允许被调用方误传覆盖
    2. 调用方显式传入 kind
    3. 自动登记（auto=true）—— 只是首次落盘猜的，允许被显式 kind 纠正
    4. 文件扩展名
    5. 默认 image

    第 3 条排在显式之后，是为了让「同一模型既出图又出视频」能被正确分流：
    首次落盘自动登记的 type 不应把后续其它媒体的落盘也锁死。
    """
    key = canonical_feature(name)
    entry = _entry(key)
    registered = normalize_type(entry.get("type"))
    if registered and not entry.get("auto"):
        return registered
    explicit = normalize_type(kind)
    if explicit:
        return explicit
    return registered or guess_type_from_ext(ext) or DEFAULT_TYPE


def learn_feature(name: Any, mtype: str, sample: str = "") -> bool:
    """未登记的 feature 自动登记到用户覆盖层，让新模型零配置可用。

    只记录 type 与首次出现的样本文件名，label/group 留空由人后补。
    返回 True 表示本次新增了登记项。
    """
    key = canonical_feature(name)
    if not key or key in registry()["features"]:
        return False
    kind = normalize_type(mtype) or DEFAULT_TYPE
    path = user_registry_path()
    with _lock:
        current = _read_json(path)
        if not current:
            current = {"version": REGISTRY_VERSION, "types": list(MEDIA_TYPES), "features": {}}
        features = current.setdefault("features", {})
        if not isinstance(features, dict):
            features = {}
            current["features"] = features
        if key in features:
            return False
        features[key] = {
            "type": kind,
            "label": key,
            "group": "未分类",
            "auto": True,
            "first_seen": time.strftime("%Y-%m-%d %H:%M:%S"),
            "sample": str(sample or "")[:80],
        }
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(current, handle, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
        _cache["data"] = None
    print(f"[media] 自动登记新 feature={key} type={kind}（可在注册表补 label/group）")
    return True


# --- 落盘 ---

def _is_plausible_feature(name: Any) -> bool:
    """只有干净的 feature 才允许自动登记，避免恶意输入往注册表里塞垃圾项。"""
    raw = str(name or "").strip()
    if not raw or len(raw) > 48:
        return False
    return ".." not in raw and "/" not in raw and "\\" not in raw


def resolve_media_dir(
    owner: str = "",
    feature: Any = "",
    kind: Optional[str] = None,
    ext: str = "",
    date: Optional[str] = None,
    root: Optional[str] = None,
    learn: bool = True,
) -> Tuple[str, str]:
    """返回 (绝对目录, URL 前缀)，目录已创建。

    url_prefix 形如 /output/{owner}/{type}/{feature}/{date}，拼接文件名即成完整 URL。
    """
    base = root or output_root()
    key = canonical_feature(feature)
    folder = folder_of(key)
    mtype = type_of(key, kind=kind, ext=ext)
    day = date or time.strftime("%Y-%m-%d")

    parts = [base]
    safe_owner = sanitize_segment(owner, "") if owner else ""
    if safe_owner:
        parts.append(safe_owner)
    parts.extend([mtype, folder, day])
    directory = os.path.join(*parts)
    os.makedirs(directory, exist_ok=True)

    if learn and _is_plausible_feature(feature):
        try:
            learn_feature(key, mtype, sample=folder)
        except OSError as exc:
            print(f"[media] 注册表写入失败: {exc}")

    url_prefix = "/output/" + "/".join(
        ([] if not safe_owner else [safe_owner]) + [mtype, folder, day]
    )
    return directory, url_prefix


def public_registry() -> Dict[str, Any]:
    """给前端的注册表视图：类型列表 + 每个 feature 的展示信息。"""
    data = registry()
    items = []
    for key, entry in data["features"].items():
        items.append({
            "id": key,
            "type": normalize_type(entry.get("type")) or DEFAULT_TYPE,
            "label": entry.get("label") or key,
            "group": entry.get("group") or "未分类",
            "folder": folder_of(key),
            "auto": bool(entry.get("auto")),
        })
    items.sort(key=lambda item: (item["type"], item["group"], item["id"]))
    return {"version": data["version"], "types": data["types"], "features": items}
