"""
preset.py — 预设管理
====================
职责：预设的 CRUD、分组、排序、复制、导入导出。

存储结构：
    prompt/presets/index.json      — 预设索引（分组信息 + 排序顺序）
    prompt/presets/{id}.json       — 每个预设一个文件（与旧格式兼容）

与旧版 smart-prompt-config.json 的关系：
    preset_id 不再混在 config 文件中，统一由本模块的 index.json 维护。

新旧数据迁移：
    首次运行时自动读取 data/smart-prompt-presets/*.json，合并到 index.json 格式。
"""

import json
import uuid
import shutil
from pathlib import Path
from typing import Optional, List, Dict, Any

# ── 路径 ──────────────────────────────────────────────────────────────
MODULE_DIR = Path(__file__).resolve().parent
PRESETS_DIR = MODULE_DIR / "presets"
INDEX_PATH = PRESETS_DIR / "index.json"
# 旧版预设目录（用于首次自动迁移）
OLD_PRESETS_DIR = MODULE_DIR.parent / "data" / "smart-prompt-presets"
# 旧版 config 文件（preset_id 在此，迁移后不再使用）
OLD_CONFIG_PATH = MODULE_DIR.parent / "data" / "smart-prompt-config.json"


# ═══════════════════════════════════════════════════════════════════════
#  内部工具函数
# ═══════════════════════════════════════════════════════════════════════

def _ensure_index():
    """确保 index.json 存在，首次使用时自动迁移旧数据"""
    PRESETS_DIR.mkdir(parents=True, exist_ok=True)

    if INDEX_PATH.exists():
        return

    # 首次运行：检测旧版预设目录
    index = {"groups": [], "preset_order": [], "selected_preset_id": ""}

    if OLD_PRESETS_DIR.exists():
        _migrate_old_presets(index)
    else:
        # 没有任何预设，创建一个默认预设
        default_preset = _create_default_preset()
        preset_path = PRESETS_DIR / f"{default_preset['id']}.json"
        with open(preset_path, 'w', encoding='utf-8') as f:
            json.dump(default_preset, f, ensure_ascii=False, indent=2)
        index["preset_order"].append(default_preset["id"])

    # 读取旧版 config 中的 selected_preset_id
    try:
        if OLD_CONFIG_PATH.exists():
            with open(OLD_CONFIG_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                index["selected_preset_id"] = data.get("preset_id", "")
    except Exception:
        pass

    _write_index(index)


def _migrate_old_presets(index: dict):
    """从 data/smart-prompt-presets/*.json 迁移预设"""
    for f in sorted(OLD_PRESETS_DIR.glob("*.json")):
        try:
            preset = json.loads(f.read_text(encoding='utf-8'))
            # 补充新字段
            preset.setdefault("tags", ["迁移（旧版）"])
            preset.setdefault("sort_order", len(index["preset_order"]))
            preset.setdefault("updated_at", preset.get("created_at", ""))
            # 写入新目录
            new_path = PRESETS_DIR / f.name
            with open(new_path, 'w', encoding='utf-8') as wf:
                json.dump(preset, wf, ensure_ascii=False, indent=2)
            index["preset_order"].append(preset.get("id", f.stem))
        except Exception:
            continue


def _read_index() -> dict:
    """读取索引文件"""
    _ensure_index()
    try:
        with open(INDEX_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {"groups": [], "preset_order": [], "selected_preset_id": ""}


def _write_index(index: dict):
    """写入索引文件"""
    PRESETS_DIR.mkdir(parents=True, exist_ok=True)
    with open(INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=2)


def _read_preset(preset_id: str) -> Optional[dict]:
    """读取单个预设文件"""
    path = PRESETS_DIR / f"{preset_id}.json"
    if not path.exists():
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _write_preset(preset: dict):
    """写入单个预设文件"""
    path = PRESETS_DIR / f"{preset['id']}.json"
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(preset, f, ensure_ascii=False, indent=2)


def _create_default_preset() -> dict:
    """创建默认预设"""
    return {
        "id": "default",
        "name": "Anima",
        "description": "默认的 Anima 标签生成预设",
        "tags": [],
        "sort_order": 0,
        "provider_id": "",
        "output_format": "tag",
        "temperature": 0.3,
        "max_tokens": 1024,
        "quality_tags": "masterpiece, best quality, ultra detailed, highres",
        "negative_default": "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry",
        "system_prompt": "",
        "is_default": True,
        "created_at": "",
        "updated_at": "",
    }


# ═══════════════════════════════════════════════════════════════════════
#  公开 API
# ═══════════════════════════════════════════════════════════════════════

def list_presets() -> List[dict]:
    """
    获取预设列表（含分组信息，按 sort_order 排序）。

    Returns:
        [
            {
                "id": "...", "name": "...", "tags": [...], "sort_order": 0,
                "groups": ["组名1", ...],  # 该预设所在的分组名
                ...
            },
            ...
        ]
    """
    _ensure_index()
    index = _read_index()
    groups = {g["id"]: g["name"] for g in index.get("groups", [])}

    presets = []
    for pid in index.get("preset_order", []):
        p = _read_preset(pid)
        if p:
            # 补充分组名称
            p["groups"] = [groups.get(t, t) for t in p.get("tags", [])]
            presets.append(p)

    # 补上未在 order 中的预设（异常情况）
    for path in sorted(PRESETS_DIR.glob("*.json")):
        pid = path.stem
        if pid == "index":
            continue
        if not any(p["id"] == pid for p in presets):
            p = _read_preset(pid)
            if p:
                presets.append(p)

    # 按 sort_order 排序
    presets.sort(key=lambda x: x.get("sort_order", 999))
    return presets


def get_preset(preset_id: str) -> Optional[dict]:
    """获取单个预设"""
    return _read_preset(preset_id)


def create_preset(data: dict) -> dict:
    """
    创建预设。

    Args:
        data: 预设数据。至少需要 name，其他字段可选，都有默认值。

    Returns:
        创建后的预设 dict（含生成的 id）
    """
    _ensure_index()
    index = _read_index()

    preset = {
        "id": data.get("id", "preset-" + uuid.uuid4().hex[:8]),
        "name": data.get("name", "新预设"),
        "description": data.get("description", ""),
        "tags": data.get("tags", []),
        "sort_order": data.get("sort_order", len(index["preset_order"])),
        "provider_id": data.get("provider_id", ""),
        "output_format": data.get("output_format", "tag"),
        "temperature": data.get("temperature", 0.3),
        "max_tokens": data.get("max_tokens", 1024),
        "quality_tags": data.get("quality_tags", "masterpiece, best quality, ultra detailed, highres"),
        "negative_default": data.get("negative_default", "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry"),
        "system_prompt": data.get("system_prompt", ""),
        "is_default": data.get("is_default", False),
        "created_at": data.get("created_at", ""),
        "updated_at": data.get("updated_at", ""),
    }

    _write_preset(preset)

    # 追加到索引 order
    if preset["id"] not in index["preset_order"]:
        index["preset_order"].append(preset["id"])
        _write_index(index)

    return preset


def update_preset(preset_id: str, data: dict) -> Optional[dict]:
    """
    更新预设。

    Args:
        preset_id: 预设 ID
        data: 要更新的字段（只更新提供的字段，不覆盖其他）

    Returns:
        更新后的预设，或 None（预设不存在）
    """
    preset = _read_preset(preset_id)
    if not preset:
        return None

    # 只更新提供的字段
    for key in ("name", "description", "tags", "sort_order", "provider_id",
                 "output_format", "temperature", "max_tokens", "quality_tags",
                 "negative_default", "system_prompt", "is_default"):
        if key in data:
            preset[key] = data[key]

    preset["updated_at"] = data.get("updated_at", preset.get("updated_at", ""))

    _write_preset(preset)
    return preset


def delete_preset(preset_id: str) -> bool:
    """
    删除预设。不允许删除 default 预设。

    Returns:
        True 删除成功，False 删除失败（预设不存在 或 不允许删除）
    """
    if preset_id == "default":
        return False

    path = PRESETS_DIR / f"{preset_id}.json"
    if not path.exists():
        return False

    path.unlink()

    # 从索引中移除
    index = _read_index()
    if preset_id in index["preset_order"]:
        index["preset_order"].remove(preset_id)
        _write_index(index)

    return True


def duplicate_preset(preset_id: str, new_name: Optional[str] = None) -> Optional[dict]:
    """
    复制预设。

    Args:
        preset_id: 被复制的预设 ID
        new_name: 新预设名称（自动生成如果未提供）

    Returns:
        新建的预设，或 None（源预设不存在）
    """
    source = _read_preset(preset_id)
    if not source:
        return None

    new_id = "preset-" + uuid.uuid4().hex[:8]
    new_preset = {k: v for k, v in source.items()}
    new_preset["id"] = new_id
    new_preset["name"] = new_name or f"{source.get('name', '预设')}（副本）"
    new_preset["sort_order"] = source.get("sort_order", 0) + 1
    new_preset["is_default"] = False
    new_preset["created_at"] = ""
    new_preset["updated_at"] = ""

    return create_preset(new_preset)


def export_presets(filter_tags: Optional[List[str]] = None) -> dict:
    """
    导出预设。

    Args:
        filter_tags: 可选，只导出包含指定标签的预设。None 表示全部导出。

    Returns:
        {"presets": [...], "groups": [...]}
    """
    _ensure_index()
    presets = list_presets()

    if filter_tags:
        presets = [p for p in presets if any(t in p.get("tags", []) for t in filter_tags)]

    index = _read_index()
    return {
        "presets": presets,
        "groups": index.get("groups", []),
    }


def import_presets(data: dict, mode: str = "merge") -> int:
    """
    导入预设。

    Args:
        data: 导出的预设数据（export_presets 的输出格式）
        mode: "merge" — 合并（同名 ID 覆盖）
              "replace" — 替换（清空全部后导入）

    Returns:
        导入的预设数量
    """
    imported = data.get("presets", [])
    if not imported:
        return 0

    _ensure_index()
    index = _read_index()

    if mode == "replace":
        # 清空现有预设（保留 default）
        for pid in list(index["preset_order"]):
            if pid != "default":
                path = PRESETS_DIR / f"{pid}.json"
                if path.exists():
                    path.unlink()
        index["preset_order"] = ["default"]
        index["groups"] = []

    count = 0
    for preset_data in imported:
        preset_id = preset_data.get("id", "")
        if not preset_id:
            continue

        # 同 ID 覆盖 / 新建
        _write_preset(preset_data)
        if preset_id not in index["preset_order"]:
            index["preset_order"].append(preset_id)
        count += 1

    # 合并分组
    imported_groups = data.get("groups", [])
    for g in imported_groups:
        if g not in index.get("groups", []):
            index.setdefault("groups", []).append(g)

    _write_index(index)
    return count


def reorder_presets(preset_ids: List[str]):
    """
    批量更新预设排序。

    Args:
        preset_ids: 排序后的预设 ID 列表
    """
    _ensure_index()
    index = _read_index()
    index["preset_order"] = preset_ids

    # 同步更新每个预设的 sort_order
    for idx, pid in enumerate(preset_ids):
        p = _read_preset(pid)
        if p:
            p["sort_order"] = idx
            _write_preset(p)

    _write_index(index)


def get_selected_preset_id() -> str:
    """获取当前选中的预设 ID"""
    index = _read_index()
    return index.get("selected_preset_id", "")


def set_selected_preset_id(preset_id: str):
    """设置当前选中的预设 ID"""
    index = _read_index()
    index["selected_preset_id"] = preset_id
    _write_index(index)
