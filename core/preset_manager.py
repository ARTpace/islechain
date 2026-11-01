"""预设统一入口：风格与标签均来自显式安装的内容包，编辑写用户层。"""

import os
import json
import time
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field, asdict
from enum import Enum

from .user_paths import user_data_dir
import style_packs
import tag_packs

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
    for folder in (user_presets_dir(),):
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
    """从当前已安装提示词构建名称映射，不加载旧翻译表。"""
    result = {}
    _walk_and_merge(get_style_presets(), result)
    _walk_and_merge(get_tag_presets(), result)
    return result


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

def get_tag_presets() -> Dict[str, Any]:
    """标签选择器仅消费已安装标签包，不再读取旧工程预设。"""
    return tag_packs.get_presets()


# === 风格预设（风格包体系）===

_STYLE_PRESETS_CACHE: Dict[str, Any] = {"signature": (), "mtime": 0.0, "data": None}


def get_style_presets() -> Dict[str, Any]:
    """仅合并已安装风格包与用户增量；无包时不回退旧文件。"""
    sig = style_packs.signature()
    cached = _STYLE_PRESETS_CACHE.get("data")
    if cached is not None and _STYLE_PRESETS_CACHE.get("signature") == sig:
        return cached
    data = {"categories": style_packs.merged_categories()}
    _STYLE_PRESETS_CACHE.update(signature=sig, mtime=0.0, data=data)
    return data


def save_style_presets(data: Dict[str, Any]) -> bool:
    """编辑统一写入用户增量层，不再生成旧全量文件。"""
    try:
        ok = style_packs.replace_from_snapshot(data or {})
        _STYLE_PRESETS_CACHE.update(signature=(), mtime=0.0, data=None)
        return ok
    except Exception as exc:
        print(f"[preset_manager] style presets save error: {exc}")
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
    return tag_packs.save_presets(data)


# === 双向映射（兼容旧接口）===

def get_preset_bidir() -> Tuple[Dict[str, str], Dict[str, str]]:
    id_to_name = load_preset_i18n()
    return id_to_name, {name: pid for pid, name in id_to_name.items()}
