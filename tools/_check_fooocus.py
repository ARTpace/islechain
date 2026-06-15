import json
from pathlib import Path

with open("data/style-presets.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# fooocus 系列
fooocus_cats = [c for c in data["categories"] if c.get("id", "").startswith("fooocus_")]
print(f"=== fooocus 系列分类: {len(fooocus_cats)} ===")
for c in fooocus_cats:
    n = sum(len(s.get("presets", [])) for s in c.get("subcategories", []))
    n_thumb = sum(1 for s in c.get("subcategories", []) for p in s.get("presets", []) if p.get("thumbnail"))
    print(f"  {c['id']:25s}  {c.get('name')!r:15s}  presets={n:4d}  with_thumb={n_thumb}")

# 全部分类汇总
print(f"\n=== 全部分类: {len(data['categories'])} ===")
for c in data["categories"]:
    n = sum(len(s.get("presets", [])) for s in c.get("subcategories", []))
    print(f"  {c['id']:30s}  {c.get('name')!r:20s}  {n} presets")

# 缩略图总数
thumbs = list(Path("data/thumbnails").glob("fooocus_*.jpg"))
print(f"\n=== Fooocus 缩略图: {len(thumbs)} ===")
