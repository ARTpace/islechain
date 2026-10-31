"""把"前端传回的完整列表"换算成用户增量层。

老接口 POST /api/style-presets 是整包覆盖语义，直接写文件会留下一份全量快照，
把随包内置的风格永久挡在外面。这里改成：与基线逐条比对，只把差异写进 overlay。

这样即便调用方仍然传 22,248 条，落盘的也只是一串差异（通常几十条）。
"""

from typing import Dict, List, Tuple

from .merge import base_categories
from .store import read_overlay, write_overlay
from .paths import SCHEMA_VERSION

_COMPARE_SKIP = ("_pack", "_order", "_seq")


def _index(categories: List[dict]) -> Dict[str, Tuple[dict, dict, dict]]:
    """{preset_id: (preset, category_meta, subcategory_meta)}"""
    out: Dict[str, Tuple[dict, dict, dict]] = {}
    for cat in categories or []:
        cat_meta = {"id": cat.get("id"), "name": cat.get("name")}
        for sub in cat.get("subcategories") or []:
            sub_meta = {"id": sub.get("id"), "name": sub.get("name")}
            for preset in sub.get("presets") or []:
                pid = preset.get("id")
                if pid:
                    out[pid] = (preset, cat_meta, sub_meta)
    return out


def _clean(preset: dict) -> dict:
    return {k: v for k, v in (preset or {}).items() if k not in _COMPARE_SKIP}


def diff_overlay(snapshot: dict) -> dict:
    """算出 snapshot 相对基线的差异，返回 overlay 结构。"""
    base = _index(base_categories())
    current = _index((snapshot or {}).get("categories") or [])

    items, patches, removed = {}, {}, []

    for pid, (preset, cat_meta, sub_meta) in current.items():
        clean = _clean(preset)
        if pid not in base:
            items[pid] = {"preset": clean, "category": cat_meta, "subcategory": sub_meta}
            continue
        base_preset, base_cat, base_sub = base[pid]
        changed = {
            key: value
            for key, value in clean.items()
            if key != "id" and _clean(base_preset).get(key) != value
        }
        if changed:
            patches[pid] = changed
        # 归属分类被移动过也记一条，避免"改了分类却看不出来"
        if cat_meta.get("id") != base_cat.get("id") or sub_meta.get("id") != base_sub.get("id"):
            if pid not in items:
                items[pid] = {
                    "preset": clean,
                    "category": cat_meta,
                    "subcategory": sub_meta,
                }

    for pid in base:
        if pid not in current:
            removed.append(pid)

    return {
        "schema": SCHEMA_VERSION,
        "items": items,
        "patches": patches,
        "removed": removed,
    }


def replace_from_snapshot(snapshot: dict) -> bool:
    """用一次全量快照替换 overlay（只落差异，不写基线副本）。"""
    return write_overlay(diff_overlay(snapshot))


def migrate_legacy_snapshot() -> bool:
    """把老版本留下的"用户全量快照"换算成增量层，然后归档原文件。

    老版本 save_style_presets 会把整份 40MB 列表写进用户目录，新体系不再读它，
    不迁移的话老用户自己的改动会凭空消失。幂等：文件归档后不会再触发。
    """
    import io
    import json
    import time

    from .paths import LEGACY_USER_SNAPSHOT

    if not LEGACY_USER_SNAPSHOT.is_file():
        return False

    try:
        with io.open(LEGACY_USER_SNAPSHOT, "r", encoding="utf-8") as f:
            snapshot = json.load(f)
    except Exception as exc:
        print("[style_packs] 旧快照无法解析，保留原文件：%s" % exc)
        return False

    current = read_overlay()
    has_overlay = bool(current.get("items") or current.get("patches") or current.get("removed"))

    if not has_overlay:
        overlay = diff_overlay(snapshot)
        if not write_overlay(overlay):
            print("[style_packs] 旧快照迁移失败，保留原文件")
            return False
        print("[style_packs] 已把旧快照换算成增量层：新增 %d / 修改 %d / 删除 %d"
              % (len(overlay["items"]), len(overlay["patches"]), len(overlay["removed"])))

    # 归档而不是删除，万一换算有偏差还能取回
    stamp = time.strftime("%Y%m%d%H%M%S")
    archived = LEGACY_USER_SNAPSHOT.with_name("style-presets.json.legacy-%s" % stamp)
    try:
        LEGACY_USER_SNAPSHOT.rename(archived)
        print("[style_packs] 旧快照已归档：%s" % archived.name)
    except OSError as exc:
        print("[style_packs] 旧快照归档失败（不影响使用）：%s" % exc)
    return True
