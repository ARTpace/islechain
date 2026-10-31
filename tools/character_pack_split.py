"""角色包拆分工具：把 21MB 的 characters.json 拆成种子包 + 官方 zip + catalog。

用法：
    python tools/character_pack_split.py split      # 生成种子包 / 官方 zip / catalog
    python tools/character_pack_split.py verify     # 校验拆包可逆、装齐等于全量

产物：
    data/character-packs/characters-seed/          进 git、进安装包（只读种子）
    dist/character-packs/<packId>.zip              不进 git、进安装包（用户按需安装）
    dist/character-packs/catalog.json              官方包清单

分档规则（按 post_count，源自实际分布）：
    seed      >= 1000                2215 条   开箱即用
    popular   100 ~ 999             13115 条
    longtail  < 100                 21162 条
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

from character_packs.paths import (  # noqa: E402
    BASE_DIR,
    DETAIL_PREFIX,
    INDEX_FILE,
    LEGACY_CHARACTERS_FILE,
    detail_filename,
)
from character_packs.schema import merge_back, split_characters  # noqa: E402

SEED_DIR = BASE_DIR / "data" / "character-packs" / "characters-seed"
OUT_DIR = ROOT / "dist" / "character-packs"
SOURCE = LEGACY_CHARACTERS_FILE
FEATURES_FILE = BASE_DIR / "data" / "character-features.json"

SEED_MIN = 1000
POPULAR_MIN = 100

BANDS = [
    ("characters-seed", "角色包 · 精华", 100, "开箱即用：post_count ≥ %d 的角色"),
    ("characters-popular", "角色包 · 热门", 200, "post_count 100 ~ 999 的角色"),
    ("characters-longtail", "角色包 · 长尾", 300, "post_count < 100 的角色"),
]


def load_source():
    with open(SOURCE, "r", encoding="utf-8") as f:
        data = json.load(f)
    characters = data.get("characters") if isinstance(data, dict) else data
    version = data.get("version", "") if isinstance(data, dict) else ""
    return characters or [], version


def load_features():
    """特征映射表（tag -> 中文名），前后端共用，新增特征只改配置。"""
    if not FEATURES_FILE.is_file():
        print("警告：缺少 %s，索引里不会有 feat 字段" % FEATURES_FILE)
        return {}
    with open(FEATURES_FILE, "r", encoding="utf-8") as f:
        return (json.load(f) or {}).get("features") or {}


def band_of(char):
    count = int(char.get("post_count") or 0)
    if count >= SEED_MIN:
        return "characters-seed"
    if count >= POPULAR_MIN:
        return "characters-popular"
    return "characters-longtail"


def dump(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


def write_pack(pack_dir: Path, pack_id: str, name: str, order: int, desc: str,
               items, shards, data_version: str):
    if pack_dir.exists():
        shutil.rmtree(pack_dir)
    pack_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "schema": 1,
        "packId": pack_id,
        "kind": "characters",
        "name": name,
        "version": "1.0.0",
        "author": "art-canvas",
        "description": desc,
        "order": order,
        "entryCount": len(items),
        "dataVersion": data_version,
        "files": {"index": INDEX_FILE},
    }
    dump(pack_dir / "pack.json", manifest)
    dump(pack_dir / INDEX_FILE, {"schema": 1, "count": len(items), "items": items})
    for shard, entries in sorted(shards.items()):
        dump(pack_dir / detail_filename(shard), entries)
    return manifest


def split(data_version=""):
    characters, version = load_source()
    data_version = data_version or version
    features = load_features()
    print("源数据 %d 条（版本 %s，特征映射 %d 项）" % (
        len(characters), data_version, len(features)))

    buckets = {pack_id: [] for pack_id, _, _, _ in BANDS}
    for char in characters:
        buckets[band_of(char)].append(char)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    catalog_packs = []

    for pack_id, name, order, desc in BANDS:
        subset = buckets[pack_id]
        items, shards = split_characters(subset, feature_map=features)
        target = SEED_DIR if pack_id == "characters-seed" else Path(tempfile.mkdtemp(prefix=pack_id + "-"))
        manifest = write_pack(
            target, pack_id, name, order, desc, items, shards, data_version,
        )
        size = sum(p.stat().st_size for p in target.rglob("*") if p.is_file())
        print("  %-22s %6d 条  %7.1f MB" % (pack_id, len(items), size / 1048576))

        if pack_id != "characters-seed":
            zip_path = OUT_DIR / (pack_id + ".zip")
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for path in sorted(target.rglob("*.json")):
                    zf.write(path, "%s/%s" % (pack_id, path.relative_to(target).as_posix()))
            shutil.rmtree(target, ignore_errors=True)
            catalog_packs.append({
                "packId": pack_id,
                "name": name,
                "version": manifest["version"],
                "description": desc,
                "order": order,
                "entryCount": len(items),
                "sizeBytes": zip_path.stat().st_size,
                "file": zip_path.name,
            })
        else:
            catalog_packs.append({
                "packId": pack_id,
                "name": name,
                "version": manifest["version"],
                "description": desc,
                "order": order,
                "entryCount": len(items),
                "sizeBytes": 0,
                "file": "",
            })

    catalog = {
        "schema": 1,
        "generatedAt": datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "totalEntries": len(characters),
        "packs": catalog_packs,
    }
    dump(OUT_DIR / "catalog.json", catalog)
    print("catalog: %s" % (OUT_DIR / "catalog.json"))
    print("种子包: %s" % SEED_DIR)
    return 0


def verify():
    characters, _ = load_source()
    origin = {c.get("slug") or c.get("name"): c for c in characters}

    total = 0
    per_band = {}
    for pack_id, _, _, _ in BANDS:
        target = SEED_DIR if pack_id == "characters-seed" else None
        if target is None:
            zip_path = OUT_DIR / (pack_id + ".zip")
            if not zip_path.is_file():
                print("缺少 %s，请先执行 split" % zip_path)
                return 1
            with tempfile.TemporaryDirectory() as tmp:
                with zipfile.ZipFile(zip_path) as zf:
                    zf.extractall(tmp)
                idx = json.load(open(Path(tmp) / pack_id / INDEX_FILE, encoding="utf-8"))
                shards = _read_shards(Path(tmp) / pack_id)
        else:
            idx = json.load(open(target / INDEX_FILE, encoding="utf-8"))
            shards = _read_shards(target)

        items = idx.get("items") or []
        per_band[pack_id] = len(items)
        total += len(items)

        merged = merge_back(items, shards)
        for row in merged:
            src = origin.get(row["slug"])
            if not src:
                print("  还原失败：找不到 %s" % row["slug"])
                return 1
            for key in ("name", "copyright", "post_count", "gender", "hair", "eye",
                        "trigger", "tags", "img_url", "danbooru_url", "thumb_url"):
                if row.get(key) != src.get(key):
                    print("  字段不一致 %s.%s" % (row["slug"], key))
                    return 1
        print("  %-22s %6d 条  还原校验通过" % (pack_id, len(items)))

    print("合计 %d / 源 %d" % (total, len(characters)))
    if total != len(characters):
        print("条目数不一致，拆分有丢失")
        return 1
    print("OK：三包装齐等于全量，字段逐一还原无损")
    return 0


def _read_shards(pack_dir: Path):
    shards = {}
    for path in pack_dir.glob(DETAIL_PREFIX + "*.json"):
        shard = path.stem[len(DETAIL_PREFIX):]
        shards[shard] = json.load(open(path, encoding="utf-8"))
    return shards


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "split"
    if cmd == "split":
        sys.exit(split())
    elif cmd == "verify":
        sys.exit(verify())
    else:
        print(__doc__)
        sys.exit(2)
