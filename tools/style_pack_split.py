"""把内置风格包拆成「仓库种子包」+「按平台分发的扩展包」。

背景：完整风格数据 44MB / 22248 条，放进 git 会让每次改一条都要重存几十 MB。
所以仓库只保留精简种子包，完整数据按来源平台打成 zip，由用户在资产库自行导入。

用法：
    python tools/style_pack_split.py split     # 生成种子包 + 平台包 + catalog
    python tools/style_pack_split.py verify    # 校验拆包后条目与原包完全一致

归属规则全部来自 data/style-packs-config.json，改配置即可调整，不需要改代码。
"""

import argparse
import io
import json
import shutil
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = ROOT / "data" / "style-packs-config.json"
# 源包不进分发目录，也永远不进 git：只放在 style-packs-source 下作为切料
CORE_DIR = ROOT / "data" / "style-packs-source" / "art-canvas-core"
SEED_DIR = ROOT / "data" / "style-packs" / "art-canvas-seed"
OUT_DIR = ROOT / "dist" / "style-packs"

CATEGORY_ORDER_BASE = 100
CATEGORY_ORDER_STEP = 10


def read_json(path):
    with io.open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def load_pack_categories(pack_dir):
    """按清单顺序读出包内所有分类。"""
    manifest = read_json(Path(pack_dir) / "pack.json")
    result = []
    for item in sorted(manifest.get("categories") or [], key=lambda c: (c.get("order") or 0, c.get("id") or "")):
        for cat in read_json(Path(pack_dir) / item["file"]).get("categories") or []:
            result.append(cat)
    return result


def count_presets(categories):
    return sum(len(sub.get("presets") or []) for cat in categories for sub in cat.get("subcategories") or [])


def collect_ids(categories):
    return {p.get("id") for cat in categories for sub in cat.get("subcategories") or [] for p in sub.get("presets") or []}


def platform_matcher(config):
    """返回 description -> platformId 的判定函数（顺序优先，子串匹配）。"""
    rules = [(p["id"], [str(m).lower() for m in (p.get("match") or []) if m]) for p in config.get("platforms") or []]
    fallback = str(config.get("defaultPlatform") or "other")

    def match(description):
        text = str(description or "").lower()
        for pack_id, keys in rules:
            if any(key in text for key in keys):
                return pack_id
        return fallback

    return match


def write_pack(pack_dir, meta, categories, order_map):
    """落盘一个包：pack.json 只记顺序，分类内容各自一个文件。"""
    pack_dir = Path(pack_dir)
    if pack_dir.exists():
        shutil.rmtree(pack_dir)
    pack_dir.mkdir(parents=True)

    entries = []
    for cat in categories:
        cid = str(cat.get("id") or "").strip()
        if not cid:
            continue
        filename = cid + ".json"
        write_json(pack_dir / filename, {"categories": [cat]})
        entries.append({
            "id": cid,
            "name": cat.get("name") or cid,
            "file": filename,
            "order": order_map.get(cid, CATEGORY_ORDER_BASE),
        })

    manifest = {
        "schema": 1,
        "packId": meta["packId"],
        "name": meta["name"],
        "version": meta.get("version") or "1.0.0",
        "author": meta.get("author") or "",
        "description": meta.get("description") or "",
        "order": meta.get("order") or 500,
        # 预存条目数：列表页不用解析内容就能显示数量
        "entryCount": count_presets(categories),
        "categories": entries,
    }
    write_json(pack_dir / "pack.json", manifest)
    return entries


def zip_pack(pack_dir, out_zip):
    out_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in sorted(Path(pack_dir).rglob("*.json")):
            arc = "%s/%s" % (Path(pack_dir).name, path.relative_to(pack_dir).as_posix())
            zf.write(path, arc)
    return out_zip


def filter_by_platform(categories, match, platform_id):
    """只保留归属该平台的条目，空子分类与空分类丢弃。"""
    result = []
    for cat in categories:
        kept_subs = []
        for sub in cat.get("subcategories") or []:
            kept = [p for p in sub.get("presets") or [] if match(p.get("description")) == platform_id]
            if kept:
                kept_subs.append({"id": sub.get("id"), "name": sub.get("name") or sub.get("id"), "presets": kept})
        if kept_subs:
            result.append({
                "id": cat.get("id"),
                "name": cat.get("name") or cat.get("id"),
                "subcategories": kept_subs,
            })
    return result


def cmd_split(config):
    if not (CORE_DIR / "pack.json").is_file():
        print("找不到源包：%s" % CORE_DIR)
        return 1

    core_categories = load_pack_categories(CORE_DIR)
    order_map = {c["id"]: CATEGORY_ORDER_BASE + i * CATEGORY_ORDER_STEP for i, c in enumerate(core_categories) if c.get("id")}
    total = count_presets(core_categories)
    print("源包：%d 分类 / %d 条" % (len(core_categories), total))

    # 1) 种子包（进仓库）
    seed_meta = dict(config.get("seed") or {})
    wanted = seed_meta.get("categories") or []
    seed_categories = [c for c in core_categories if c.get("id") in wanted]
    missing = [cid for cid in wanted if cid not in {c.get("id") for c in seed_categories}]
    if missing:
        print("种子配置里这些分类在源包中不存在，已忽略：%s" % ", ".join(missing))
    write_pack(SEED_DIR, seed_meta, seed_categories, order_map)
    seed_count = count_presets(seed_categories)
    print("种子包：%s  %d 分类 / %d 条" % (SEED_DIR.name, len(seed_categories), seed_count))

    # 2) 平台包（分布到 dist，不进仓库）
    match = platform_matcher(config)
    # 打包目录是中间产物，用系统临时目录，避免 dist/ 里多留一份未压缩副本
    build_root = Path(tempfile.mkdtemp(prefix="style-packs-"))
    catalog_packs = []
    for platform in config.get("platforms") or []:
        pid = platform["id"]
        pack_id = "platform-" + pid
        categories = filter_by_platform(core_categories, match, pid)
        count = count_presets(categories)
        if not count:
            continue
        meta = {
            "packId": pack_id,
            "name": "%s 风格包" % (platform.get("name") or pid),
            "version": platform.get("version") or "1.0.0",
            "author": platform.get("author") or "Art Canvas",
            "description": platform.get("description") or "",
            "order": platform.get("order") or 500,
        }
        pack_dir = build_root / pack_id
        write_pack(pack_dir, meta, categories, order_map)
        zip_path = zip_pack(pack_dir, OUT_DIR / (pack_id + ".zip"))
        catalog_packs.append({
            "packId": pack_id,
            "name": meta["name"],
            "version": meta["version"],
            "author": meta["author"],
            "description": meta["description"],
            "order": meta["order"],
            "entryCount": count,
            "categoryCount": len(categories),
            "sizeBytes": zip_path.stat().st_size,
            "file": zip_path.name,
            "url": platform.get("url") or "",
        })
        print("平台包：%-24s %6d 条  %5.2f MB" % (pack_id, count, zip_path.stat().st_size / 1024 / 1024))

    shutil.rmtree(build_root, ignore_errors=True)
    shutil.rmtree(build_root, ignore_errors=True)
    catalog = {
        "schema": 1,
        "generatedAt": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "source": CORE_DIR.name,
        "totalEntries": total,
        "packs": sorted(catalog_packs, key=lambda p: (p["order"], p["packId"])),
    }
    write_json(OUT_DIR / "catalog.json", catalog)
    print("目录：%s（%d 个可分发包）" % (OUT_DIR / "catalog.json", len(catalog_packs)))
    return 0


def cmd_verify(config):
    core_categories = load_pack_categories(CORE_DIR)
    core_ids = collect_ids(core_categories)
    core_total = count_presets(core_categories)

    seed_ids = collect_ids(load_pack_categories(SEED_DIR)) if (SEED_DIR / "pack.json").is_file() else set()
    platform_ids = set()
    # 平台包以 zip 为最终产物：直接读 zip 校验，不依赖中间目录是否还在
    for platform in config.get("platforms") or []:
        zip_path = OUT_DIR / ("platform-" + platform["id"] + ".zip")
        if not zip_path.is_file():
            continue
        with zipfile.ZipFile(zip_path) as zf:
            for name in zf.namelist():
                if not name.endswith(".json") or name.endswith("pack.json"):
                    continue
                data = json.loads(zf.read(name).decode("utf-8"))
                platform_ids |= collect_ids(data.get("categories") or [])

    union = seed_ids | platform_ids
    print("源包      ：%d 条 / %d 个唯一 id" % (core_total, len(core_ids)))
    print("种子+平台 ：%d 个唯一 id" % len(union))
    print("  种子独有：%d" % len(seed_ids - platform_ids))
    print("  平台覆盖：%d" % len(platform_ids))

    missing = core_ids - union
    extra = union - core_ids
    ok = not missing and not extra
    if missing:
        print("  缺失 %d 条，示例：%s" % (len(missing), sorted(missing)[:5]))
    if extra:
        print("  多余 %d 条，示例：%s" % (len(extra), sorted(extra)[:5]))
    print("结果：%s" % ("一致 OK" if ok else "不一致"))
    return 0 if ok else 1


def main(argv=None):
    parser = argparse.ArgumentParser(description="拆分内置风格包")
    parser.add_argument("action", choices=["split", "verify"])
    args = parser.parse_args(argv)
    config = read_json(CONFIG_FILE)
    return cmd_split(config) if args.action == "split" else cmd_verify(config)


if __name__ == "__main__":
    sys.exit(main())
