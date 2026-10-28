#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把采集来的平台提示词（promptimageatlas / opennana 导出的 JSONL）灌进 art-canvas 系统提示词库。

2026-10-28 首次运行做的事：
  1. 备份 data/prompt_libraries.json 到 artifacts/prompt-library-backup-<日期>/
  2. 分类体系从「用途维度」换成「题材维度」（与 main.py 的 PROMPT_LIBRARY_BUILTIN_CATEGORIES 对齐）
  3. 原有条目（多机位/三视图那批工作流模板）全部归入 template 分类
  4. 采集数据按分类映射灌入，id 前缀 pia_ / oan_，正文归一化指纹去重

用法：
  python import.py --source "H:/AI-Tools/提示词数据_promptimageatlas/精选提示词.jsonl"
  python import.py --source a.jsonl --source b.jsonl --dry-run
  python import.py --source a.jsonl --prefix pia --limit 500
"""
import argparse
import json
import os
import re
import shutil
import sys
import time
import uuid

CANVAS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LIBRARY_PATH = os.path.join(CANVAS_DIR, "data", "prompt_libraries.json")
ARTIFACTS_DIR = os.path.join(CANVAS_DIR, "artifacts")

# 与 main.py 的 PROMPT_LIBRARY_BUILTIN_CATEGORIES 保持一致
CATEGORIES = [
    {"id": "portrait", "name": "人像摄影"},
    {"id": "anime", "name": "动漫二次元"},
    {"id": "design", "name": "平面设计"},
    {"id": "illustration", "name": "插画艺术"},
    {"id": "scene", "name": "场景建筑"},
    {"id": "sci3d", "name": "3D 科幻"},
    {"id": "template", "name": "版式模板"},
    {"id": "misc", "name": "其他"},
    {"id": "custom", "name": "我的"},
]
VALID_CATEGORY_IDS = {c["id"] for c in CATEGORIES}

# 来源分类（promptimageatlas 的 17 类中文）→ 目标分类
SOURCE_CATEGORY_MAP = {
    "真人/写实人物": "portrait",
    "动漫/二次元人物": "anime",
    "漫画/分镜/故事板": "anime",
    "字体/排版/标题": "design",
    "Logo/品牌/VI": "design",
    "UI/App/网页/SaaS": "design",
    "海报/广告/社媒": "design",
    "产品/电商/包装": "design",
    "信息图/教育图解": "design",
    "插画/艺术/概念": "illustration",
    "抽象/纹理/背景": "illustration",
    "风景/自然": "scene",
    "建筑/室内/空间": "scene",
    "动物/宠物": "scene",
    "3D/游戏/像素/等距": "sci3d",
    "车辆/机械/科幻": "sci3d",
    "其他/未归类": "misc",
}


# 采集数据的缩略图是相对路径（images/originals/x.jpg），拼上来源站域名才能直接显示
THUMB_BASE = "https://promptimageatlas.com"


def fingerprint(text):
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def sanitize_name(name, fallback="提示词"):
    name = re.sub(r'[\\/:*?"<>|]+', "_", str(name or fallback)).strip()
    return name[:120] or fallback


def sanitize_id(raw, prefix):
    """id 只允许 [A-Za-z0-9_-]，与 main.normalize_prompt_library_item 的规则一致。"""
    body = re.sub(r"[^A-Za-z0-9_-]+", "_", str(raw or "")).strip("_")
    if not body:
        body = uuid.uuid4().hex[:10]
    return f"{prefix}_{body}"[:60]


def map_category(source_category, extra_map=None):
    if extra_map and source_category in extra_map:
        return extra_map[source_category]
    if source_category in SOURCE_CATEGORY_MAP:
        return SOURCE_CATEGORY_MAP[source_category]
    if source_category in VALID_CATEGORY_IDS:
        return source_category
    return "misc"


def load_jsonl(paths):
    rows = []
    for path in paths:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(obj, dict) and (obj.get("prompt") or obj.get("positive")):
                    rows.append(obj)
    return rows


def build_item(raw, prefix, extra_map, forced_category=""):
    positive = str(raw.get("prompt") or raw.get("positive") or "").strip()
    title = raw.get("title") or raw.get("name") or positive[:40]
    author = str(raw.get("author") or "").strip()
    likes = raw.get("likes")
    scene_bits = []
    if author:
        scene_bits.append(author)
    if isinstance(likes, (int, float)) and likes:
        scene_bits.append(f"{int(likes)} 赞")
    source = str(raw.get("source") or "promptimageatlas").strip()
    thumb = str(raw.get("thumb") or raw.get("image") or "").strip()
    if thumb and not thumb.startswith(("http://", "https://")):
        thumb = f"{THUMB_BASE}/{thumb.lstrip('/')}"
    now = int(time.time() * 1000)
    return {
        "id": sanitize_id(raw.get("slug") or raw.get("id") or "", prefix),
        "name": sanitize_name(title),
        "category": forced_category or map_category(raw.get("category") or "", extra_map),
        "scene": " · ".join(scene_bits)[:500],
        "positive": positive,
        "negative": str(raw.get("negative") or raw.get("negative_prompt") or "").strip(),
        "thumbnail": thumb,
        "params": {"来源": source},
        "created_at": now,
        "updated_at": now,
    }


def main():
    parser = argparse.ArgumentParser(description="把采集的提示词导入 art-canvas 系统提示词库")
    parser.add_argument("--source", action="append", required=True, help="JSONL 源文件，可重复")
    parser.add_argument("--prefix", default="pia", help="id 前缀（默认 pia）")
    parser.add_argument("--category-map", default="", help="额外的来源分类映射 JSON 文件 {源分类:目标id}")
    parser.add_argument("--force-category", default="", help="强制所有条目落到指定分类")
    parser.add_argument("--limit", type=int, default=0, help="最多导入多少条，0=不限")
    parser.add_argument("--keep-existing", action="store_true", help="保留现有条目原分类，不归入 template")
    parser.add_argument("--dry-run", action="store_true", help="只统计，不写文件")
    parser.add_argument("--refresh-meta", action="store_true", help="给库里已存在的同 id 条目补缩略图/名称（不新增）")
    args = parser.parse_args()

    if not os.path.exists(LIBRARY_PATH):
        sys.exit(f"找不到 {LIBRARY_PATH}")

    extra_map = {}
    if args.category_map:
        with open(args.category_map, encoding="utf-8") as handle:
            extra_map = json.load(handle)

    with open(LIBRARY_PATH, encoding="utf-8") as handle:
        data = json.load(handle)

    system = next((lib for lib in data.get("libraries") or [] if lib.get("id") == "system"), None)
    if not system:
        sys.exit("data/prompt_libraries.json 里没有 system 库")

    # 1) 老条目：工作流模板统一归 template
    touched = 0
    for item in system.get("items") or []:
        if args.keep_existing:
            break
        if item.get("category") in {"view", "storyboard", "character", "product", "lighting"}:
            item["category"] = "template"
            touched += 1

    # 2) 换分类体系
    system["categories"] = [dict(c) for c in CATEGORIES]

    # 3) 灌入采集数据
    existing_ids = {item.get("id") for item in system.get("items") or []}
    existing_fp = {fingerprint(item.get("positive")) for item in system.get("items") or []}
    existing_ids.discard(None)
    existing_fp.discard("")

    raws = load_jsonl(args.source)
    if args.limit:
        raws = raws[: args.limit]
    added, skipped_dup, skipped_empty = [], 0, 0
    for raw in raws:
        item = build_item(raw, args.prefix, extra_map, args.force_category)
        if not item["positive"]:
            skipped_empty += 1
            continue
        fp = fingerprint(item["positive"])
        if item["id"] in existing_ids or fp in existing_fp:
            skipped_dup += 1
            continue
        base_id, seq = item["id"], 2
        while item["id"] in existing_ids:
            item["id"] = f"{base_id[:56]}_{seq}"
            seq += 1
        existing_ids.add(item["id"])
        existing_fp.add(fp)
        added.append(item)

    system["items"] = added + (system.get("items") or [])

    # 4) 刷新已有条目的缩略图等元信息（之前导入时没带图）
    refreshed = 0
    if args.refresh_meta:
        by_id = {}
        for raw in raws:
            built = build_item(raw, args.prefix, extra_map, args.force_category)
            by_id[built["id"]] = built
        for existing in system["items"]:
            fresh = by_id.get(existing.get("id"))
            if not fresh:
                continue
            changed = False
            for field in ("thumbnail", "scene", "name"):
                if fresh.get(field) and existing.get(field) != fresh[field]:
                    existing[field] = fresh[field]
                    changed = True
            if changed:
                existing["updated_at"] = int(time.time() * 1000)
                refreshed += 1
        print(f"刷新已有条目元信息：{refreshed} 条")

    system["readonly"] = False
    system["system"] = True
    system["type"] = "prompt"
    data["active_library_id"] = "system"

    counts = {}
    for item in system["items"]:
        counts[item.get("category") or "custom"] = counts.get(item.get("category") or "custom", 0) + 1

    print(f"源文件 {len(args.source)} 个，读到 {len(raws)} 条")
    print(f"新增 {len(added)} 条 | 重复跳过 {skipped_dup} | 空正文跳过 {skipped_empty}")
    print(f"老条目改判为 template：{touched} 条")
    print(f"库内合计 {len(system['items'])} 条")
    label = {c["id"]: c["name"] for c in CATEGORIES}
    for cat_id, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {count:5}  {label.get(cat_id, cat_id)}")

    if args.dry_run:
        print("\n[dry-run] 未写入文件")
        return

    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup_dir = os.path.join(ARTIFACTS_DIR, f"prompt-library-backup-{stamp}")
    os.makedirs(backup_dir, exist_ok=True)
    shutil.copy2(LIBRARY_PATH, os.path.join(backup_dir, "prompt_libraries.json"))
    print(f"\n已备份原文件 -> {backup_dir}")

    tmp_path = f"{LIBRARY_PATH}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    os.replace(tmp_path, LIBRARY_PATH)
    print(f"已写入 {LIBRARY_PATH}")


if __name__ == "__main__":
    main()
