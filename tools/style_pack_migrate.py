"""风格预设单文件 <-> 风格包目录 的双向迁移工具。

用法（在工程根执行）：
    python tools/style_pack_migrate.py split      # data/style-presets.json -> data/style-packs/<pack>/
    python tools/style_pack_migrate.py merge      # data/style-packs/<pack>/ -> data/style-presets.json
    python tools/style_pack_migrate.py verify     # 比对两边条目是否完全一致

拆分规则：
    一个分类一个文件，文件名 = 分类 id（纯语义，永不因排序调整而改名）；
    显示顺序只由 pack.json 里每个分类的 order 决定，命名与排序解耦。
"""

import argparse
import io
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = ROOT / "data" / "style-presets.json"
PACKS_DIR = ROOT / "data" / "style-packs"

SCHEMA = 1
# 内置包分类从 100 起、步长 10，留出 0~99 给"置顶分类"，中间可插 105 这类值
ORDER_BASE = 100
ORDER_STEP = 10
# 包级顺序：内置包 100，用户包默认 500（见 style_packs.manifest.DEFAULT_PACK_ORDER）
PACK_ORDER = 100


def _read_json(path):
    with io.open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _count(categories):
    return sum(len(sub.get("presets", [])) for cat in categories for sub in cat.get("subcategories", []))


def _ids(categories):
    out = set()
    for cat in categories:
        for sub in cat.get("subcategories", []):
            for p in sub.get("presets", []):
                if p.get("id"):
                    out.add(p["id"])
    return out


def split(src=DEFAULT_SRC, out_dir=None, pack_id="art-canvas-core",
          name="内置风格库", version="1.0.0", author="art-canvas",
          description="随安装包分发的基础风格提示词库"):
    """单文件拆成包目录。返回 (包目录, 分类数, 条目数)。"""
    src = Path(src)
    if not src.is_file():
        raise SystemExit("源文件不存在：%s" % src)

    data = _read_json(src)
    categories = data.get("categories", [])
    if not categories:
        raise SystemExit("源文件没有 categories，拒绝拆分")

    pack_dir = Path(out_dir) / pack_id if out_dir else PACKS_DIR / pack_id
    pack_dir.mkdir(parents=True, exist_ok=True)

    manifest_cats = []
    for index, cat in enumerate(categories):
        cid = str(cat.get("id") or "").strip()
        if not cid:
            raise SystemExit("第 %d 个分类缺少 id，拒绝拆分" % (index + 1))
        # 文件名 = 分类 id，必须本身是安全文件名
        if not cid.replace("_", "").replace("-", "").isalnum():
            raise SystemExit("分类 id 含有不安全字符，无法直接作为文件名：%r" % cid)

        fname = cid + ".json"
        _write_json(pack_dir / fname, {"categories": [cat]})
        manifest_cats.append({
            "id": cid,
            "name": cat.get("name", cid),
            "file": fname,
            "order": ORDER_BASE + index * ORDER_STEP,
        })

    manifest = {
        "schema": SCHEMA,
        "packId": pack_id,
        "name": name,
        "version": version,
        "author": author,
        "description": description,
        "order": PACK_ORDER,
        "categories": manifest_cats,
    }
    _write_json(pack_dir / "pack.json", manifest)

    total = _count(categories)
    print("拆分完成：%s" % pack_dir)
    print("  分类 %d 个，条目 %d 条" % (len(categories), total))
    print("  清单 pack.json 已生成（order 从 %d 起，步长 %d）" % (ORDER_BASE, ORDER_STEP))
    return pack_dir, len(categories), total


def merge(pack_dir, out=DEFAULT_SRC):
    """包目录合回单文件（按 order 排序）。返回 (输出路径, 分类数, 条目数)。"""
    pack_dir = Path(pack_dir)
    manifest = _read_json(pack_dir / "pack.json")
    entries = sorted(manifest.get("categories", []), key=lambda c: (c.get("order") or 0, c.get("id") or ""))

    categories = []
    for item in entries:
        path = pack_dir / item["file"]
        if not path.is_file():
            raise SystemExit("清单声明的文件不存在：%s" % path)
        categories.extend(_read_json(path).get("categories", []))

    _write_json(Path(out), {"categories": categories})
    total = _count(categories)
    print("合并完成：%s（%d 个分类 / %d 条）" % (out, len(categories), total))
    return Path(out), len(categories), total


def verify(src=DEFAULT_SRC, pack_dir=None):
    """比对单文件与包目录的条目集合，返回是否一致。"""
    pack_dir = Path(pack_dir) if pack_dir else PACKS_DIR / "art-canvas-core"
    manifest = _read_json(pack_dir / "pack.json")
    pack_categories = []
    for item in sorted(manifest["categories"], key=lambda c: c.get("order") or 0):
        pack_categories.extend(_read_json(pack_dir / item["file"]).get("categories", []))

    pack_ids, pack_n = _ids(pack_categories), _count(pack_categories)
    print("包目录：%d 分类 / %d 条 / %d 个唯一 id" % (len(pack_categories), pack_n, len(pack_ids)))

    if not Path(src).is_file():
        # 拆分稳定后单文件会被删除，此时只能做包内自检
        print("单文件不存在（%s），跳过比对，仅做包内自检" % src)
        dup = pack_n - len(pack_ids)
        print("重复 id：%d 个" % dup)
        return dup == 0

    src_categories = _read_json(src).get("categories", [])
    src_ids, src_n = _ids(src_categories), _count(src_categories)
    ok = src_ids == pack_ids and src_n == pack_n

    print("单文件：%d 分类 / %d 条 / %d 个唯一 id" % (len(src_categories), src_n, len(src_ids)))
    if ok:
        print("结果：一致 OK")
    else:
        print("结果：不一致")
        print("  仅单文件有：%s" % sorted(src_ids - pack_ids)[:10])
        print("  仅包目录有：%s" % sorted(pack_ids - src_ids)[:10])
    return ok


def main(argv=None):
    parser = argparse.ArgumentParser(description="风格预设单文件与风格包目录互转")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_split = sub.add_parser("split", help="单文件拆成包目录")
    p_split.add_argument("--src", default=str(DEFAULT_SRC))
    p_split.add_argument("--out", default=None, help="输出根目录，默认 data/style-packs")
    p_split.add_argument("--pack-id", default="art-canvas-core")
    p_split.add_argument("--name", default="内置风格库")
    p_split.add_argument("--version", default="1.0.0")
    p_split.add_argument("--author", default="art-canvas")
    p_split.add_argument("--description", default="随安装包分发的基础风格提示词库")

    p_merge = sub.add_parser("merge", help="包目录合回单文件")
    p_merge.add_argument("--pack-dir", default=str(PACKS_DIR / "art-canvas-core"))
    p_merge.add_argument("--out", default=str(DEFAULT_SRC))

    p_verify = sub.add_parser("verify", help="校验两边一致")
    p_verify.add_argument("--src", default=str(DEFAULT_SRC))
    p_verify.add_argument("--pack-dir", default=None)

    args = parser.parse_args(argv)

    if args.cmd == "split":
        split(args.src, args.out, args.pack_id, args.name, args.version, args.author, args.description)
    elif args.cmd == "merge":
        merge(args.pack_dir, args.out)
    elif args.cmd == "verify":
        sys.exit(0 if verify(args.src, args.pack_dir) else 1)


if __name__ == "__main__":
    main()
