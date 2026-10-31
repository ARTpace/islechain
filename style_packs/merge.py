"""把多个风格包 + 用户增量层合并成一份给前端的分类列表。

合并规则（全部按 id，顺序稳定）：
  1. 包优先级：内置包 > 用户包（各自按 order，再按 packId）
  2. 分类按 order 升序；同 id 只出现一次，位置由最先定义它的包决定
  3. 子分类按 id 合并，预设按 id 去重 —— 后出现的同 id 条目覆盖先出现的字段，
     但保留首次出现的位置，所以"改一条 prompt"不会让它在界面上跳位置
  4. 用户 overlay 最后应用：先删、再改、后加；overlay 新建的分类排在末尾
"""

from typing import Dict, List

from .manifest import PackManifest
from .store import discover_packs, load_categories, read_overlay

# 内部字段，输出前必须剥掉
_INTERNAL_KEYS = ("_pack", "_order")


def _strip_internal(node):
    if isinstance(node, dict):
        for key in _INTERNAL_KEYS:
            node.pop(key, None)
        for value in node.values():
            _strip_internal(value)
    elif isinstance(node, list):
        for item in node:
            _strip_internal(item)
    return node


def _upsert_presets(target: List[dict], incoming: List[dict]) -> None:
    """按 id 合并预设：同 id 覆盖非空字段并保留原位置，新 id 追加。"""
    position = {p.get("id"): i for i, p in enumerate(target) if p.get("id")}
    for preset in incoming:
        if not isinstance(preset, dict):
            continue
        pid = preset.get("id")
        if pid and pid in position:
            base = target[position[pid]]
            for key, value in preset.items():
                # 空值不覆盖，避免不同包里字段不全时把已有内容抹掉
                if value not in (None, "", [], {}):
                    base[key] = value
        else:
            target.append(dict(preset))
            if pid:
                position[pid] = len(target) - 1


def _merge_subcategories(target: List[dict], incoming: List[dict]) -> None:
    index = {s.get("id"): s for s in target if s.get("id")}
    for sub in incoming:
        if not isinstance(sub, dict):
            continue
        sid = sub.get("id")
        existing = index.get(sid) if sid else None
        if existing is None:
            created = {
                "id": sid,
                "name": sub.get("name") or sid,
                "presets": list(sub.get("presets") or []),
            }
            target.append(created)
            if sid:
                index[sid] = created
        else:
            if not existing.get("name") and sub.get("name"):
                existing["name"] = sub["name"]
            existing.setdefault("presets", [])
            _upsert_presets(existing["presets"], sub.get("presets") or [])


def _merge_from_packs(packs: List[PackManifest]) -> List[dict]:
    order: Dict[str, int] = {}
    index: Dict[str, dict] = {}
    sequence = 0

    for pack in packs:
        for cat in load_categories(pack):
            cid = cat.get("id")
            if not cid:
                continue
            existing = index.get(cid)
            if existing is None:
                created = {
                    "id": cid,
                    "name": cat.get("name") or cid,
                    "subcategories": [],
                    "_order": cat.get("_order", sequence * 10),
                    "_seq": sequence,
                }
                sequence += 1
                index[cid] = created
                order[cid] = created["_order"]
                _merge_subcategories(created["subcategories"], cat.get("subcategories") or [])
            else:
                if not existing.get("name") and cat.get("name"):
                    existing["name"] = cat["name"]
                _merge_subcategories(existing["subcategories"], cat.get("subcategories") or [])

    return sorted(index.values(), key=lambda c: (c.get("_order") or 0, c.get("_seq") or 0))


def _apply_overlay(categories: List[dict], overlay: Dict) -> List[dict]:
    """先删、再改、后加。overlay 新建的分类追加到末尾，不会打乱内置顺序。"""
    removed = set(overlay.get("removed") or [])
    patches = overlay.get("patches") or {}

    for cat in categories:
        for sub in cat.get("subcategories") or []:
            presets = sub.get("presets") or []
            if removed:
                sub["presets"] = [p for p in presets if p.get("id") not in removed]
            for preset in sub.get("presets") or []:
                pid = preset.get("id")
                if pid in patches:
                    preset.update(patches[pid])

    by_id = {cat.get("id"): cat for cat in categories}
    for pid, entry in (overlay.get("items") or {}).items():
        if not isinstance(entry, dict):
            continue
        preset = dict(entry.get("preset") or {})
        preset["id"] = pid
        if pid in patches:
            preset.update(patches[pid])

        cat_meta = entry.get("category") or {}
        sub_meta = entry.get("subcategory") or {}
        cat_id = cat_meta.get("id") or "my_styles"
        cat = by_id.get(cat_id)
        if cat is None:
            cat = {
                "id": cat_id,
                "name": cat_meta.get("name") or "我的风格",
                "subcategories": [],
                "_order": 9999,
            }
            categories.append(cat)
            by_id[cat_id] = cat

        sub_id = sub_meta.get("id") or cat_id
        sub = next((s for s in cat.get("subcategories") or [] if s.get("id") == sub_id), None)
        if sub is None:
            sub = {"id": sub_id, "name": sub_meta.get("name") or "我的风格", "presets": []}
            cat.setdefault("subcategories", []).append(sub)

        _upsert_presets(sub.setdefault("presets", []), [preset])

    return categories


def merged_categories(packs: List[PackManifest] = None) -> List[dict]:
    """权威入口：返回合并后的分类列表（已去除内部字段）。"""
    categories = base_categories(packs)
    categories = _apply_overlay(categories, read_overlay())
    for cat in categories:
        cat.pop("_seq", None)
    _strip_internal(categories)
    return categories


def base_categories(packs: List[PackManifest] = None) -> List[dict]:
    """只合并各包、不叠加 overlay 的基线视图。用于把全量快照换算成增量。"""
    packs = discover_packs() if packs is None else packs
    return _merge_from_packs(packs)


def category_total(categories: List[dict]) -> int:
    """统计条目总数，用于自检与日志。"""
    return sum(
        len(sub.get("presets") or [])
        for cat in categories
        for sub in cat.get("subcategories") or []
    )
