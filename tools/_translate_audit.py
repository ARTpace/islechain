"""快速查看 i18n 覆盖情况 + 收集所有预设名做翻译基线"""
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

with open(DATA / "style-i18n.json", "r", encoding="utf-8") as f:
    i18n = json.load(f)
with open(DATA / "style-presets.json", "r", encoding="utf-8") as f:
    data = json.load(f)

print("=== i18n 概览 ===")
print(f"  categories: {len(i18n.get('categories', {}))}")
print(f"  subcategories: {len(i18n.get('subcategories', {}))}")
print(f"  presets: {len(i18n.get('presets', {}))}")

# 收集所有 preset.id 和 name
all_ids = []
all_names = []
id_to_name = {}
for c in data["categories"]:
    for s in c.get("subcategories", []):
        for p in s.get("presets", []):
            all_ids.append(p["id"])
            all_names.append(p.get("name", ""))
            id_to_name[p["id"]] = p.get("name", "")

print(f"\n=== 全部 preset ===")
print(f"  总数: {len(all_ids)}")

# Fooocus 分类
fooocus_ids = [pid for pid in all_ids if pid.startswith("fooocus_")]
print(f"  fooocus 系列: {len(fooocus_ids)}")

# 未映射统计
mapped = [pid for pid in all_ids if pid in i18n.get("presets", {})]
unmapped = [pid for pid in all_ids if pid not in i18n.get("presets", {})]
unmapped_fooocus = [pid for pid in fooocus_ids if pid not in i18n.get("presets", {})]
print(f"\n=== 映射统计 ===")
print(f"  已映射: {len(mapped)} / {len(all_ids)} ({len(mapped)/len(all_ids)*100:.1f}%)")
print(f"  未映射: {len(unmapped)}")
print(f"  Fooocus 未映射: {len(unmapped_fooocus)}")

# 收集所有 fooocus preset 的 name 列表（去重）
fooocus_names = []
seen = set()
for c in data["categories"]:
    if not c.get("id", "").startswith("fooocus_"):
        continue
    for s in c.get("subcategories", []):
        for p in s.get("presets", []):
            n = (p.get("name") or "").strip()
            if n and n.lower() not in seen:
                seen.add(n.lower())
                fooocus_names.append(n)
print(f"\n=== Fooocus 唯一 name 数: {len(fooocus_names)} ===")

# 写到 JSON 备用
out = {
    "all_preset_ids": all_ids,
    "fooocus_preset_ids": fooocus_ids,
    "fooocus_unique_names": fooocus_names,
    "unmapped_fooocus_ids": unmapped_fooocus,
}
with open(ROOT / "_translate_audit.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print(f"\n已写入 _translate_audit.json")
