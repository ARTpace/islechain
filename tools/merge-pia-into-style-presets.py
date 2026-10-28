# -*- coding: utf-8 -*-
"""把 prompt_libraries.json 里的 PIA 采集条目合并进 style-presets.json。

目的：让「资产库 → 提示词库」和生成页「风格预设」共用同一份真源，
使两处看到的风格提示词完全一致。

- 按 id 去重，再按 prompt 正文指纹去重
- PIA 九类分类映射到 style-presets 的 17 类
- description 写入来源（PromptImageAtlas · xxx），与现有来源维度对齐
- 原文件先备份，重复执行幂等

用法：
    python tools/merge-pia-into-style-presets.py            # 执行合并
    python tools/merge-pia-into-style-presets.py --dry-run  # 只看统计
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STYLE_PATH = os.path.join(BASE, "data", "style-presets.json")
LIB_PATH = os.path.join(BASE, "data", "prompt_libraries.json")

# PIA 九类 → style-presets 17 类
CATEGORY_MAP = {
    "portrait": "photography",
    "anime": "anime_manga",
    "design": "commercial",
    "illustration": "painting",
    "scene": "misc",
    "sci3d": "digital_3d",
    "template": "commercial",
    "misc": "misc",
    "custom": "misc",
}


def norm(text: str) -> str:
    """正文归一化：去标点空白、转小写，用于去重。"""
    return re.sub(r"[\s\W_]+", "", (text or "").lower())


def fingerprint(text: str) -> str:
    return hashlib.md5(norm(text).encode("utf-8")).hexdigest()[:16]


def main() -> int:
    dry = "--dry-run" in sys.argv

    with open(STYLE_PATH, encoding="utf-8") as f:
        style = json.load(f)
    with open(LIB_PATH, encoding="utf-8") as f:
        lib = json.load(f)

    categories = style.get("categories") or []
    cat_by_id = {c.get("id"): c for c in categories}

    # 现有 id 集合 + 正文指纹集合
    seen_ids: set[str] = set()
    seen_fp: set[str] = set()
    before = 0
    for cat in categories:
        for sub in cat.get("subcategories") or []:
            for p in sub.get("presets") or []:
                before += 1
                if p.get("id"):
                    seen_ids.add(p["id"])
                if p.get("prompt"):
                    seen_fp.add(fingerprint(p["prompt"]))

    added = 0
    skipped_dup = 0
    by_cat: dict[str, int] = {}

    for library in lib.get("libraries") or []:
        if library.get("id") != "system":
            continue
        for item in library.get("items") or []:
            pid = str(item.get("id") or "").strip()
            body = str(item.get("positive") or "").strip()
            if not pid or not body:
                continue
            if pid in seen_ids or fingerprint(body) in seen_fp:
                skipped_dup += 1
                continue

            target_id = CATEGORY_MAP.get(item.get("category") or "misc", "misc")
            target = cat_by_id.get(target_id) or cat_by_id.get("misc")
            if not target:
                continue
            subs = target.get("subcategories") or []
            if not subs:
                subs = [{"id": f"{target_id}_all", "name": target.get("name") or target_id, "presets": []}]
                target["subcategories"] = subs

            origin = ""
            params = item.get("params") if isinstance(item.get("params"), dict) else {}
            if isinstance(params, dict):
                origin = str(params.get("来源") or params.get("source") or "").strip()
            source_label = f"PromptImageAtlas · {origin}" if origin else "PromptImageAtlas"

            preset = {
                "id": pid,
                "name": item.get("name") or item.get("scene") or pid,
                "type": "prompt",
                "prompt": body,
                "negative_prompt": str(item.get("negative") or ""),
                "description": source_label,
                "thumbnail": str(item.get("thumbnail") or ""),
            }
            subs[0].setdefault("presets", []).append(preset)
            seen_ids.add(pid)
            seen_fp.add(fingerprint(body))
            added += 1
            by_cat[target_id] = by_cat.get(target_id, 0) + 1

    total = before + added
    print(f"合并前 {before} 条，新增 {added} 条，跳过重复 {skipped_dup} 条 → 合计 {total} 条")
    for cid, n in sorted(by_cat.items(), key=lambda kv: -kv[1]):
        print(f"  → {cid}: +{n}")

    if dry:
        print("[dry-run] 未写入文件")
        return 0
    if added == 0:
        print("没有新增条目，未写入文件")
        return 0

    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = f"{STYLE_PATH}.bak-{stamp}"
    shutil.copy2(STYLE_PATH, backup)
    print(f"已备份原文件 → {os.path.basename(backup)}")

    tmp = STYLE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(style, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, STYLE_PATH)
    print(f"写入完成：{os.path.getsize(STYLE_PATH) / 1024 / 1024:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
