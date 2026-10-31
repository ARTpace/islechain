"""
预设管理模块 - 统一管理标签预设和风格预设

支持两套预设体系：
  1. 标签预设（tag）：单个 Danbooru 标签，点击追加到提示词
  2. 风格预设（prompt）：完整自然语言提示词，点击替换或追加

数据文件：
  - data/presets/*.json            → 标签预设（按大类分文件）
  - data/style-packs/<packId>/     → 风格预设包（pack.json 清单 + 每分类一个 json）
  - data/preset-i18n.json          → 中文名映射
  - data/prompt-presets.yaml       → YAML 标签预设（可选，优先级低于 JSON）

读写分层（2026-10-31）：
  工程 data/ 下的是**随包分发的只读基线**，用户编辑一律落到用户数据目录，
  避免装在 Program Files 时保存失败、以及覆盖升级把用户改动冲掉。

风格预设的读取走 style_packs（内置包 + 用户包 + 用户增量层合并），
用户自己新增/修改的条目只写增量层，升级安装包后新的内置风格依然可见。
"""

import os
import json
import time
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field, asdict
from enum import Enum

from .user_paths import user_data_dir
import style_packs

# === 路径配置 ===
# 本模块位于 core/，项目根在其上一层
BASE_DIR = Path(__file__).resolve().parents[1]

# 内置基线：随安装包分发，只读
BASE_DATA_DIR = BASE_DIR / "data"
# 用户覆盖层：可写，优先于基线
USER_PRESET_DATA_DIR = Path(user_data_dir()) / "data"

DATA_DIR = BASE_DATA_DIR
PROMPT_PRESETS_JSON = DATA_DIR / "prompt-presets.json"
PROMPT_PRESETS_YAML = DATA_DIR / "prompt-presets.yaml"
STYLE_PRESETS_FILE = DATA_DIR / "style-presets.json"      # 基线（读兜底）
PRESET_I18N_FILE = DATA_DIR / "preset-i18n.json"
PRESETS_DIR = DATA_DIR / "presets"  # 拆分后的多文件目录（基线）


# === 读写分层 ===
def user_style_presets_file() -> Path:
    """风格预设的用户写入位置。"""
    return USER_PRESET_DATA_DIR / "style-presets.json"


def user_presets_dir() -> Path:
    """标签预设的用户写入目录。"""
    return USER_PRESET_DATA_DIR / "presets"


def read_style_presets_file() -> Path:
    """读风格预设：用户目录有就用用户的，否则回退内置基线。"""
    user = user_style_presets_file()
    if user.is_file():
        return user
    return STYLE_PRESETS_FILE


def read_preset_files() -> List[Path]:
    """读标签预设文件列表：用户目录的文件覆盖同名基线文件。

    返回按 PRESET_FILE_ORDER 排好序的路径列表。同名时用户版本胜出，
    这样用户只改了一个分类，其余分类仍然来自基线。
    """
    merged: Dict[str, Path] = {}
    if PRESETS_DIR.is_dir():
        for path in PRESETS_DIR.glob("*.json"):
            merged[path.name] = path
    user_dir = user_presets_dir()
    if user_dir.is_dir():
        for path in user_dir.glob("*.json"):
            merged[path.name] = path
    order_map = {name: i for i, name in enumerate(PRESET_FILE_ORDER)}
    files = list(merged.values())
    files.sort(key=lambda p: (order_map.get(p.stem, 999), p.stem))
    return files


def presets_signature() -> Tuple[float, ...]:
    """两个目录及其文件的 mtime 签名，用于缓存失效判断。"""
    stamps: List[float] = []
    for folder in (PRESETS_DIR, user_presets_dir()):
        if not folder.is_dir():
            continue
        try:
            stamps.append(os.path.getmtime(folder))
        except OSError:
            pass
        for path in folder.glob("*.json"):
            try:
                stamps.append(os.path.getmtime(path))
            except OSError:
                pass
    return tuple(sorted(stamps))


# === 文件顺序（控制侧边栏分类排列） ===
PRESET_FILE_ORDER = [
    "quality", "animals", "character", "clothing", "pose", "photography", "scene",
    "lighting", "effects", "objects", "misc",
    "celebrity", "game_anime", "nsfw",
]


# === 预设类型枚举 ===
class PresetType(str, Enum):
    TAG = "tag"          # 标签预设：单个标签，追加到提示词
    PROMPT = "prompt"    # 风格预设：完整提示词，替换或追加


# === 预设数据类 ===
@dataclass
class PresetItem:
    """单个预设条目"""
    id: str
    name: str
    prompt: str
    type: PresetType = PresetType.TAG
    negative_prompt: str = ""
    description: str = ""  # 预设说明

    def to_dict(self) -> dict:
        d = asdict(self)
        d["type"] = self.type.value
        return d

    @classmethod
    def from_dict(cls, data: dict) -> "PresetItem":
        preset_type = data.get("type", "tag")
        if isinstance(preset_type, PresetType):
            preset_type = preset_type.value
        return cls(
            id=data.get("id", ""),
            name=data.get("name", ""),
            prompt=data.get("prompt", ""),
            type=PresetType(preset_type) if preset_type in ("tag", "prompt") else PresetType.TAG,
            negative_prompt=data.get("negative_prompt", ""),
            description=data.get("description", ""),
        )


@dataclass
class SubCategory:
    """子分类"""
    id: str
    name: str
    presets: List[PresetItem] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "presets": [p.to_dict() for p in self.presets],
        }


@dataclass
class Category:
    """分类"""
    id: str
    name: str
    type: PresetType = PresetType.TAG
    subcategories: List[SubCategory] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "type": self.type.value,
            "subcategories": [s.to_dict() for s in self.subcategories],
        }


# === 缓存管理 ===
class PresetCache:
    """预设缓存，带 mtime 检测（多文件版）"""
    def __init__(self):
        self.categories: list = []          # 全部 categories 列表
        self.file_mtimes: dict = {}          # {filename: mtime}
        self.signature: tuple = ()           # 两目录及文件的 mtime 签名（检测增删改）
        self.i18n: Dict[str, str] = {}
        self.i18n_mtime: float = 0.0
        self.bidir: Tuple[Dict, Dict] = ({}, {})
        self.bidir_mtime: float = 0.0

    def get_dir_files(self) -> list:
        """获取用户层与基线合并后的 JSON 文件列表（用户同名覆盖基线）"""
        return read_preset_files()

    def is_fresh(self) -> bool:
        """检查是否有任何文件发生变化"""
        if not self.categories:
            return False
        try:
            if presets_signature() != self.signature:
                return False
            for fpath in self.get_dir_files():
                current_mtime = os.path.getmtime(fpath)
                if self.file_mtimes.get(str(fpath)) != current_mtime:
                    return False
            return True
        except OSError:
            return False

    def refresh(self):
        """刷新缓存的 categories"""
        self.categories = []
        self.file_mtimes = {}
        self.signature = presets_signature()
        files = self.get_dir_files()
        if not files:
            return

        for fpath in files:
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for cat in data.get("categories", []):
                    self.categories.append(cat)
                self.file_mtimes[str(fpath)] = os.path.getmtime(fpath)
            except Exception as e:
                print(f"[preset_manager] load {fpath.name} error: {e}")

    def invalidate(self):
        self.categories = []
        self.file_mtimes = {}
        self.signature = ()


# 全局缓存实例
_cache = PresetCache()


# === i18n 映射（直接从各预设文件构建，无需独立 i18n 文件）===
def _get_presets_i18n_dir_mtime() -> float:
    """标签预设目录 + 风格包目录 + 用户增量层的最新 mtime"""
    stamps = list(presets_signature())
    stamps.extend(style_packs.signature())
    return max(stamps) if stamps else 0.0


def load_preset_i18n() -> Dict[str, str]:
    """加载预设中文名映射表（直接从 presets/*.json + style-presets.json 构建）"""
    mtime = _get_presets_i18n_dir_mtime()
    if _cache.i18n and _cache.i18n_mtime == mtime:
        return _cache.i18n

    i18n = {}

    # 从 presets/*.json 收集中文名（用户层覆盖基线）
    preset_files = read_preset_files()
    if preset_files:
        for fpath in preset_files:
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                _walk_and_merge(data, i18n)
            except Exception:
                pass
    elif PROMPT_PRESETS_JSON.exists():
        # 向后兼容：旧单文件
        try:
            with open(PROMPT_PRESETS_JSON, "r", encoding="utf-8") as f:
                data = json.load(f)
            _walk_and_merge(data, i18n)
        except Exception:
            pass

    # 从风格包（内置 + 用户包 + 用户增量）收集中文名
    for cat in get_style_presets().get("categories") or []:
        _walk_and_merge(cat, i18n)

    _cache.i18n = i18n
    _cache.i18n_mtime = mtime
    return i18n


def _walk_and_merge(node, i18n: Dict[str, str]):
    """递归遍历预设结构，收集 id→中文名"""
    if isinstance(node, list):
        for item in node:
            _walk_and_merge(item, i18n)
    elif isinstance(node, dict):
        if "id" in node and "name" in node and isinstance(node["name"], str):
            name = node["name"]
            if any("\u4e00" <= c <= "\u9fa5" for c in name):
                key = _normalize_key(node["id"])
                if key and key not in i18n:
                    i18n[key] = name
        for v in node.values():
            _walk_and_merge(v, i18n)


def _normalize_key(raw_id: str) -> str:
    """归一化 key：小写字母数字保留，其他替换为 _"""
    raw = str(raw_id).lower()
    result = []
    prev_us = False
    for ch in raw:
        if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9"):
            result.append(ch)
            prev_us = False
        else:
            if not prev_us:
                result.append("_")
            prev_us = True
    return "".join(result).strip("_")


# === 标签预设（原有体系）===

def _parse_yaml_presets() -> Dict[str, Any]:
    """解析 YAML 标签预设文件"""
    try:
        import yaml
    except ImportError:
        print("[preset_manager] PyYAML not installed")
        return {"categories": []}

    if not PROMPT_PRESETS_YAML.exists():
        return {"categories": []}

    if _cache.is_fresh(PROMPT_PRESETS_YAML) and _cache.data:
        return _cache.data

    try:
        with open(PROMPT_PRESETS_YAML, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except Exception as e:
        print(f"[preset_manager] YAML parse error: {e}")
        return {"categories": []}

    if not data:
        return {"categories": []}

    i18n = load_preset_i18n()
    categories = []

    for cat_key, cat_value in data.items():
        if not isinstance(cat_value, dict):
            continue
        cat_name = cat_value.pop("_name", None) or cat_key.replace("_", " ").title()
        category = Category(id=cat_key, name=cat_name, type=PresetType.TAG)

        for sub_key, sub_value in cat_value.items():
            if not isinstance(sub_value, dict):
                continue
            sub_name = sub_value.pop("_name", None) or sub_key.replace("_", " ").title()
            sub = SubCategory(id=sub_key, name=sub_name)

            for preset_key, preset_value in sub_value.items():
                yaml_name = None
                prompt_text = None
                if isinstance(preset_value, str):
                    prompt_text = preset_value
                elif isinstance(preset_value, dict):
                    yaml_name = preset_value.get("name")
                    prompt_text = preset_value.get("tag") or preset_value.get("prompt")

                if prompt_text is None:
                    continue

                display_name = yaml_name or i18n.get(preset_key) or preset_key.replace("_", " ").title()
                sub.presets.append(PresetItem(
                    id=preset_key,
                    name=display_name,
                    prompt=prompt_text,
                    type=PresetType.TAG,
                ))

            if sub.presets:
                category.subcategories.append(sub)

        if category.subcategories:
            categories.append(category)

    result = {"categories": [c.to_dict() for c in categories]}
    _cache.data = result
    try:
        _cache.mtime = os.path.getmtime(PROMPT_PRESETS_YAML)
    except OSError:
        pass
    return result


def _load_json_presets() -> Dict[str, Any]:
    """从 presets/*.json 加载所有标签预设（多文件版，用户层覆盖基线）"""
    # 多文件目录优先
    if read_preset_files():
        if _cache.is_fresh():
            return {"categories": _cache.categories}
        _cache.refresh()
        return {"categories": _cache.categories}

    # 向后兼容：旧单文件
    if not PROMPT_PRESETS_JSON.exists():
        return {"categories": []}
    try:
        with open(PROMPT_PRESETS_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        print(f"[preset_manager] JSON load error: {e}")
        return {"categories": []}


def get_tag_presets() -> Dict[str, Any]:
    """获取标签预设（多文件 presets/ 优先，JSON 单文件次之，YAML 为废弃备用）"""
    if read_preset_files() or PROMPT_PRESETS_JSON.exists():
        return _load_json_presets()
    if PROMPT_PRESETS_YAML.exists():
        return _parse_yaml_presets()
    return {"categories": []}


# === 风格预设（风格包体系）===

_STYLE_PRESETS_CACHE: Dict[str, Any] = {"signature": (), "mtime": 0.0, "data": None}


def get_style_presets() -> Dict[str, Any]:
    """获取风格预设（完整提示词）。

    数据来源按优先级：
      1. 风格包目录（data/style-packs/ 内置包 + 用户包 + 用户增量层）
      2. 老版本单文件 data/style-presets.json（仅在没有可用包时回退）

    合并结果按所有相关文件的 mtime 签名缓存，避免每次打开风格选择器都重算。
    """
    sig = style_packs.signature()
    cached = _STYLE_PRESETS_CACHE.get("data")
    if cached is not None and _STYLE_PRESETS_CACHE.get("signature") == sig:
        return cached

    if style_packs.has_packs():
        try:
            data = {"categories": style_packs.merged_categories()}
            _STYLE_PRESETS_CACHE["signature"] = sig
            _STYLE_PRESETS_CACHE["mtime"] = 0.0
            _STYLE_PRESETS_CACHE["data"] = data
            return data
        except Exception as e:
            print(f"[preset_manager] style packs merge error: {e}")
            return {"categories": []}

    # 回退：老单文件
    style_file = read_style_presets_file()
    if not style_file.is_file():
        return {"categories": []}

    try:
        mtime = os.path.getmtime(style_file)
    except OSError:
        mtime = 0.0
    if cached is not None and _STYLE_PRESETS_CACHE.get("mtime") == mtime:
        return cached

    try:
        with open(style_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        _STYLE_PRESETS_CACHE["signature"] = sig
        _STYLE_PRESETS_CACHE["mtime"] = mtime
        _STYLE_PRESETS_CACHE["data"] = data
        return data
    except Exception as e:
        print(f"[preset_manager] style presets load error: {e}")
        return {"categories": []}


def save_style_presets(data: Dict[str, Any]) -> bool:
    """保存风格预设。

    兼容老接口的"整包覆盖"语义，但落盘内容改成**相对基线的差异**（用户增量层），
    不再写一份全量快照 —— 否则升级后新内置风格会被自己的快照永久挡住。
    """
    try:
        if style_packs.has_packs():
            ok = style_packs.replace_from_snapshot(data or {})
        else:
            target = user_style_presets_file()
            target.parent.mkdir(parents=True, exist_ok=True)
            with open(target, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            ok = True
        _STYLE_PRESETS_CACHE["signature"] = ()
        _STYLE_PRESETS_CACHE["mtime"] = 0.0
        _STYLE_PRESETS_CACHE["data"] = None
        return ok
    except Exception as e:
        print(f"[preset_manager] style presets save error: {e}")
        return False


# === 统一 API ===

def get_all_presets() -> Dict[str, Any]:
    """获取所有预设（标签 + 风格），统一格式输出"""
    tag = get_tag_presets()
    style = get_style_presets()

    return {
        "tag_presets": tag.get("categories", []),
        "style_presets": style.get("categories", []),
    }


def save_tag_presets(data: Dict[str, Any]) -> bool:
    """保存标签预设（多文件版：按大类拆分保存，写用户目录）"""
    try:
        target_dir = user_presets_dir()
        target_dir.mkdir(parents=True, exist_ok=True)

        categories = data.get("categories", [])
        for cat in categories:
            cid = cat.get("id", "")
            if not cid:
                continue
            fpath = target_dir / f"{cid}.json"
            with open(fpath, "w", encoding="utf-8") as f:
                json.dump({"categories": [cat]}, f, ensure_ascii=False, indent=2)

        _cache.invalidate()
        return True
    except Exception as e:
        print(f"[preset_manager] tag presets save error: {e}")
        return False


# === 双向映射（兼容旧接口）===

def get_preset_bidir() -> Tuple[Dict[str, str], Dict[str, str]]:
    """获取 id↔name 双向映射（多文件版）"""
    id_to_name, name_to_id = {}, {}

    def walk(node):
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            if "id" in node and "name" in node and isinstance(node["name"], str):
                if any("\u4e00" <= c <= "\u9fa5" for c in node["name"]):
                    pid = str(node["id"])
                    pname = node["name"]
                    id_to_name[pid] = pname
                    name_to_id[pname] = pid
            for v in node.values():
                walk(v)

    # 多文件版（用户层覆盖基线）
    preset_files = read_preset_files()
    if preset_files:
        try:
            for fpath in preset_files:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for cat in data.get("categories", []):
                    walk(cat)
        except Exception as e:
            print(f"[preset_manager] bidir load error: {e}")
    elif PROMPT_PRESETS_JSON.exists():
        # 向后兼容
        try:
            with open(PROMPT_PRESETS_JSON, "r", encoding="utf-8") as f:
                data = json.load(f)
            for cat in data.get("categories", []):
                walk(cat)
        except Exception as e:
            print(f"[preset_manager] bidir load error: {e}")

    return id_to_name, name_to_id
