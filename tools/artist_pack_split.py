"""画师包拆分工具：把全量画师数据拆成种子包 + 官方 zip + catalog。

用法：
    python tools/artist_pack_split.py split      # 生成种子包 / 官方 zip / catalog
    python tools/artist_pack_split.py verify     # 校验装齐等于全量、字段无损

前置：先跑 python tools/artist_pack_fetch.py fetch 把源数据下到
      data/artist-packs-source/<release>/

产物：
    data/artist-packs/artists-seed/          进 git、进安装包（只读种子）
    dist/artist-packs/<packId>.zip           不进 git、进安装包（用户按需安装）
    dist/artist-packs/catalog.json           官方包清单

分档规则（按投稿数，与前端 UI 的「传奇/知名/活跃/新锐」对齐）：
    seed      >= 1000            开箱即用（传奇 + 知名）
    active    100 ~ 999          活跃画师
    rising    < 100              新锐画师
"""

import datetime
import json
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))

from artist_packs.paths import (  # noqa: E402
    BASE_DIR,
    DEFAULT_IMAGE_EXT,
    INDEX_FILE,
    TIER_FAMOUS,
    TIER_ACTIVE,
)
from artist_packs.schema import dedupe_stats, split_artists  # noqa: E402

SEED_DIR = BASE_DIR / "data" / "artist-packs" / "artists-seed"
OUT_DIR = ROOT / "dist" / "artist-packs"
SOURCE_ROOT = BASE_DIR / "data" / "artist-packs-source"

BANDS = [
    ("artists-seed", "画师包 · 精华", 100, "开箱即用：%d 投稿以上的画师" % TIER_FAMOUS),
    ("artists-active", "画师包 · 活跃", 200, "投稿 %d ~ %d 的活跃画师" % (TIER_ACTIVE, TIER_FAMOUS - 1)),
    ("artists-rising", "画师包 · 新锐", 300, "投稿少于 %d 的新锐画师" % TIER_ACTIVE),
]


def latest_source_dir() -> Path:
    if not SOURCE_ROOT.is_dir():
        raise SystemExit("尚未下载画师源数据，请先执行：python tools/artist_pack_fetch.py fetch")
    dirs = [p for p in SOURCE_ROOT.iterdir() if p.is_dir() and (p / "search.json").is_file()]
    if not dirs:
        raise SystemExit("源数据目录里没有 search.json，请重新执行 fetch")
    return sorted(dirs, key=lambda p: p.name)[-1]


def load_source():
    """读源数据，返回 (原始条目列表, release, imageBase)。"""
    src = latest_source_dir()
    with open(src / "search.json", "r", encoding="utf-8") as f:
        raw = json.load(f)
    manifest = {}
    if (src / "manifest.json").is_file():
        with open(src / "manifest.json", "r", encoding="utf-8") as f:
            manifest = json.load(f)
    release = manifest.get("releasePrefix") or src.name
    image_base = manifest.get("imageBase") or (
        "https://cdn.mooshieblob.com/%s/images/" % release)
    return raw or [], release, image_base


def band_of(entry) -> str:
    posts = int(entry.get("posts") or 0)
    if posts >= TIER_FAMOUS:
        return "artists-seed"
    if posts >= TIER_ACTIVE:
        return "artists-active"
    return "artists-rising"


def dump(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


def write_pack(pack_dir: Path, pack_id: str, name: str, order: int, desc: str,
               items, release: str, image_base: str):
    if pack_dir.exists():
        shutil.rmtree(pack_dir)
    pack_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "schema": 1,
        "packId": pack_id,
        "kind": "artists",
        "name": name,
        "version": "1.0.0",
        "author": "art-canvas",
        "description": desc,
        "order": order,
        "entryCount": len(items),
        "dataVersion": release,
        "files": {"index": INDEX_FILE},
    }
    dump(pack_dir / "pack.json", manifest)
    dump(pack_dir / INDEX_FILE, {
        "schema": 1,
        "kind": "artists",
        "count": len(items),
        "dataVersion": release,
        "imageBase": image_base,
        "imageExt": DEFAULT_IMAGE_EXT,
        "items": items,
    })
    return manifest


def split():
    raw, release, image_base = load_source()
    stat = dedupe_stats(raw)
    items = split_artists(raw)
    print("源数据 %d 条 -> 去重后 %d 条（重复 %d，release %s）" % (
        stat["raw"], stat["unique"], stat["duplicated"], release))

    buckets = {pack_id: [] for pack_id, _, _, _ in BANDS}
    for entry in items:
        buckets[band_of(entry)].append(entry)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    catalog_packs = []

    for pack_id, name, order, desc in BANDS:
        subset = buckets[pack_id]
        if not subset:
            print("  %-22s 跳过（无条目）" % pack_id)
            continue
        target = SEED_DIR if pack_id == "artists-seed" else Path(tempfile.mkdtemp(prefix=pack_id + "-"))
        manifest = write_pack(target, pack_id, name, order, desc, subset, release, image_base)
        size = sum(p.stat().st_size for p in target.rglob("*") if p.is_file())
        print("  %-22s %6d 条  %6.2f MB" % (pack_id, len(subset), size / 1048576))

        if pack_id == "artists-seed":
            catalog_packs.append({
                "packId": pack_id, "name": name, "version": manifest["version"],
                "description": desc, "order": order, "entryCount": len(subset),
                "sizeBytes": 0, "file": "",
            })
            continue

        zip_path = OUT_DIR / (pack_id + ".zip")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in sorted(target.rglob("*.json")):
                zf.write(path, "%s/%s" % (pack_id, path.relative_to(target).as_posix()))
        shutil.rmtree(target, ignore_errors=True)
        catalog_packs.append({
            "packId": pack_id, "name": name, "version": manifest["version"],
            "description": desc, "order": order, "entryCount": len(subset),
            "sizeBytes": zip_path.stat().st_size, "file": zip_path.name,
        })

    catalog = {
        "schema": 1,
        "generatedAt": datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "dataVersion": release,
        "totalEntries": len(items),
        "packs": catalog_packs,
    }
    dump(OUT_DIR / "catalog.json", catalog)
    print("catalog: %s" % (OUT_DIR / "catalog.json"))
    print("种子包: %s" % SEED_DIR)
    return 0


def _read_pack_index(pack_dir: Path):
    with open(pack_dir / INDEX_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def verify():
    raw, release, _ = load_source()
    origin = {}
    for entry in split_artists(raw):
        origin[entry["id"]] = entry

    total = 0
    for pack_id, _, _, _ in BANDS:
        if pack_id == "artists-seed":
            src_dir, cleanup = SEED_DIR, None
        else:
            zip_path = OUT_DIR / (pack_id + ".zip")
            if not zip_path.is_file():
                print("缺少 %s，请先执行 split" % zip_path)
                return 1
            cleanup = tempfile.TemporaryDirectory()
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(cleanup.name)
            src_dir = Path(cleanup.name) / pack_id

        try:
            data = _read_pack_index(src_dir)
            items = data.get("items") or []
            total += len(items)
            for row in items:
                src = origin.get(row.get("id"))
                if not src:
                    print("  还原失败：找不到 %s" % row.get("id"))
                    return 1
                for key in ("id", "tag", "posts", "img", "url"):
                    if row.get(key) != src.get(key):
                        print("  字段不一致 %s.%s：%r != %r" % (
                            row.get("id"), key, row.get(key), src.get(key)))
                        return 1
            print("  %-22s %6d 条  还原校验通过" % (pack_id, len(items)))
        finally:
            if cleanup is not None:
                cleanup.cleanup()

    print("合计 %d / 源 %d" % (total, len(origin)))
    if total != len(origin):
        print("条目数不一致，拆分有丢失")
        return 1
    print("OK：所有包装齐等于全量，字段逐一还原无损")
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "split"
    if cmd == "split":
        sys.exit(split())
    elif cmd == "verify":
        sys.exit(verify())
    else:
        print(__doc__)
        sys.exit(2)
