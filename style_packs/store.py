"""风格包的发现、内容加载，以及用户增量层（overlay）的读写。

overlay 只存"用户自己加/改/删的条目"，通常只有几 KB，永远不进 git。
它不复制基线内容，所以升级安装包后，新的内置风格依然会出现在列表里。
"""

import io
import json
import os
import tempfile
from pathlib import Path
from typing import Dict, List

from content_packs.scanner import discover as _discover

from .manifest import PackManifest
from .paths import BUILTIN_PACKS_DIR, KIND, OVERLAY_FILE, SCHEMA_VERSION, USER_PACKS_DIR


# === 包发现 ===

def discover_packs() -> List[PackManifest]:
    """扫描内置与用户两个目录，返回排好序的包清单（内置优先）。

    目录在调用时才读取模块级常量，便于测试注入临时目录。
    """
    return _discover(
        ((BUILTIN_PACKS_DIR, True), (USER_PACKS_DIR, False)),
        kind=KIND,
        log_tag="style_packs",
    )


def load_categories(pack: PackManifest) -> List[dict]:
    """读出包内所有分类内容，按清单顺序返回。缺文件只跳过，不影响其他分类。"""
    result: List[dict] = []
    for item in pack.categories:
        path = Path(pack.path or "") / item.file
        if not path.is_file():
            print("[style_packs] 分类文件缺失：%s" % path)
            continue
        try:
            with io.open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:
            print("[style_packs] 分类文件解析失败 %s：%s" % (path, exc))
            continue
        for cat in data.get("categories") or []:
            if not isinstance(cat, dict):
                continue
            # 清单是分类元信息的权威来源，文件里缺 name 就用清单补齐
            cat.setdefault("id", item.id)
            if not cat.get("name"):
                cat["name"] = item.name
            cat["_pack"] = pack.pack_id
            cat["_order"] = item.order
            result.append(cat)
    return result


# === overlay 增量层 ===

def _empty_overlay() -> Dict:
    return {"schema": SCHEMA_VERSION, "items": {}, "patches": {}, "removed": []}


def read_overlay() -> Dict:
    """读用户增量层；不存在或损坏时返回空结构。"""
    if not OVERLAY_FILE.is_file():
        return _empty_overlay()
    try:
        with io.open(OVERLAY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        print("[style_packs] overlay 读取失败：%s" % exc)
        return _empty_overlay()
    if not isinstance(data, dict):
        return _empty_overlay()
    data.setdefault("schema", SCHEMA_VERSION)
    data.setdefault("items", {})
    data.setdefault("patches", {})
    data.setdefault("removed", [])
    return data


def write_overlay(data: Dict) -> bool:
    """原子写入增量层，避免中断时留下半个文件。"""
    try:
        OVERLAY_FILE.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(OVERLAY_FILE.parent), suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp, OVERLAY_FILE)
        return True
    except Exception as exc:
        print("[style_packs] overlay 写入失败：%s" % exc)
        return False


def _clean_id(value) -> str:
    return str(value or "").strip()


def add_item(preset: dict, category: dict = None, subcategory: dict = None) -> bool:
    """新增或替换一条用户条目（同 id 覆盖）。"""
    pid = _clean_id(preset.get("id"))
    if not pid:
        return False
    data = read_overlay()
    data["items"][pid] = {
        "preset": dict(preset),
        "category": {"id": _clean_id((category or {}).get("id") or "my_styles"),
                     "name": (category or {}).get("name") or "我的风格"},
        "subcategory": {"id": _clean_id((subcategory or {}).get("id") or "my_styles"),
                        "name": (subcategory or {}).get("name") or "我的风格"},
    }
    # 之前被标记删除的，加回来时要撤销标记
    if pid in data["removed"]:
        data["removed"] = [x for x in data["removed"] if x != pid]
    return write_overlay(data)


def patch_item(preset_id: str, fields: dict) -> bool:
    """局部修改一条（只覆盖传入的字段），用于改名、改 prompt。"""
    pid = _clean_id(preset_id)
    if not pid or not isinstance(fields, dict):
        return False
    data = read_overlay()
    patch = dict(data["patches"].get(pid) or {})
    patch.update({k: v for k, v in fields.items() if k != "id"})
    data["patches"][pid] = patch
    return write_overlay(data)


def remove_item(preset_id: str) -> bool:
    """删除一条：基线里的用 removed 标记，用户自己加的直接移除。"""
    pid = _clean_id(preset_id)
    if not pid:
        return False
    data = read_overlay()
    was_mine = pid in (data.get("items") or {})
    data["items"].pop(pid, None)
    data["patches"].pop(pid, None)
    # 自建条目本来就不在基线里，删掉即可，不留无意义的删除标记
    if not was_mine and pid not in data["removed"]:
        data["removed"].append(pid)
    return write_overlay(data)


def overlay_summary() -> Dict:
    """给前端看的统计：加了几条、删了几条。"""
    data = read_overlay()
    return {
        "added": len(data.get("items") or {}),
        "patched": len(data.get("patches") or {}),
        "removed": len(data.get("removed") or []),
        "file": str(OVERLAY_FILE),
    }
