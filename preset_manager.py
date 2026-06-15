"""
预设管理模块 - 统一管理标签预设和风格预设

支持两套预设体系：
  1. 标签预设（tag）：单个 Danbooru 标签，点击追加到提示词
  2. 风格预设（prompt）：完整自然语言提示词，点击替换或追加

数据文件：
  - data/prompt-presets.json  → 标签预设（原有）
  - data/style-presets.json   → 风格预设（新增）
  - data/preset-i18n.json     → 中文名映射
  - data/prompt-presets.yaml  → YAML 标签预设（可选，优先级高于 JSON）
"""

import os
import json
import time
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field, asdict
from enum import Enum

# === 路径配置 ===
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"

PROMPT_PRESETS_JSON = DATA_DIR / "prompt-presets.json"
PROMPT_PRESETS_YAML = DATA_DIR / "prompt-presets.yaml"
STYLE_PRESETS_FILE = DATA_DIR / "style-presets.json"
PRESET_I18N_FILE = DATA_DIR / "preset-i18n.json"


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
    """预设缓存，带 mtime 检测"""
    def __init__(self):
        self.data: Any = None
        self.mtime: float = 0.0
        self.i18n: Dict[str, str] = {}
        self.i18n_mtime: float = 0.0
        self.bidir: Tuple[Dict, Dict] = ({}, {})
        self.bidir_mtime: float = 0.0

    def is_fresh(self, file_path: Path) -> bool:
        try:
            return self.data is not None and self.mtime == os.path.getmtime(file_path)
        except OSError:
            return False

    def invalidate(self):
        self.data = None
        self.mtime = 0.0


# 全局缓存实例
_cache = PresetCache()


# === i18n 映射 ===
def load_preset_i18n() -> Dict[str, str]:
    """加载预设中文名映射表"""
    try:
        mtime = os.path.getmtime(PRESET_I18N_FILE)
        if _cache.i18n and _cache.i18n_mtime == mtime:
            return _cache.i18n
    except OSError:
        pass

    i18n = {}
    if PRESET_I18N_FILE.exists():
        try:
            with open(PRESET_I18N_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                i18n = data
        except Exception as e:
            print(f"[preset_manager] load i18n error: {e}")

    # 合并 prompt-presets.json 中的 id→name
    _merge_presets_i18n(i18n)
    # 合并 style-presets.json 中的 id→name
    _merge_style_presets_i18n(i18n)

    _cache.i18n = i18n
    _cache.i18n_mtime = mtime if PRESET_I18N_FILE.exists() else 0.0
    return i18n


def _merge_presets_i18n(i18n: Dict[str, str]):
    """从 prompt-presets.json 合并中文名"""
    if not PROMPT_PRESETS_JSON.exists():
        return
    try:
        with open(PROMPT_PRESETS_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        _walk_and_merge(data, i18n)
    except Exception:
        pass


def _merge_style_presets_i18n(i18n: Dict[str, str]):
    """从 style-presets.json 合并中文名"""
    if not STYLE_PRESETS_FILE.exists():
        return
    try:
        with open(STYLE_PRESETS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        _walk_and_merge(data, i18n)
    except Exception:
        pass


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
    """从 JSON 文件加载标签预设"""
    if not PROMPT_PRESETS_JSON.exists():
        return {"categories": []}

    if _cache.is_fresh(PROMPT_PRESETS_JSON) and _cache.data:
        return _cache.data

    try:
        with open(PROMPT_PRESETS_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)
        _cache.data = data
        _cache.mtime = os.path.getmtime(PROMPT_PRESETS_JSON)
        return data
    except Exception as e:
        print(f"[preset_manager] JSON load error: {e}")
        return {"categories": []}


def get_tag_presets() -> Dict[str, Any]:
    """获取标签预设（JSON 优先，YAML 为废弃备用）"""
    if PROMPT_PRESETS_JSON.exists():
        return _load_json_presets()
    if PROMPT_PRESETS_YAML.exists():
        return _parse_yaml_presets()
    return {"categories": []}


# === 风格预设（新增体系）===

def get_style_presets() -> Dict[str, Any]:
    """获取风格预设（完整提示词）"""
    if not STYLE_PRESETS_FILE.exists():
        return {"categories": []}

    try:
        with open(STYLE_PRESETS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        print(f"[preset_manager] style presets load error: {e}")
        return {"categories": []}


def save_style_presets(data: Dict[str, Any]) -> bool:
    """保存风格预设"""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(STYLE_PRESETS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
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
    """保存标签预设"""
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(PROMPT_PRESETS_JSON, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        _cache.invalidate()
        return True
    except Exception as e:
        print(f"[preset_manager] tag presets save error: {e}")
        return False


# === 双向映射（兼容旧接口）===

def get_preset_bidir() -> Tuple[Dict[str, str], Dict[str, str]]:
    """获取 id↔name 双向映射"""
    try:
        mtime = os.path.getmtime(PROMPT_PRESETS_JSON)
        if _cache.bidir[0] and _cache.bidir_mtime == mtime:
            return _cache.bidir
    except OSError:
        pass

    id_to_name, name_to_id = {}, {}
    if PROMPT_PRESETS_JSON.exists():
        try:
            with open(PROMPT_PRESETS_JSON, "r", encoding="utf-8") as f:
                data = json.load(f)

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

            for cat in data.get("categories", []):
                walk(cat)

            _cache.bidir = (id_to_name, name_to_id)
            _cache.bidir_mtime = mtime
        except Exception as e:
            print(f"[preset_manager] bidir load error: {e}")

    return _cache.bidir or ({}, {})
