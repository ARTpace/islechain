"""验证 i18n 映射结果"""
import json
import random

with open("data/style-i18n.json", "r", encoding="utf-8") as f:
    i18n = json.load(f)
with open("data/style-presets.json", "r", encoding="utf-8") as f:
    data = json.load(f)

all_ids = []
for c in data["categories"]:
    for s in c.get("subcategories", []):
        for p in s.get("presets", []):
            all_ids.append(p["id"])

mapped = [pid for pid in all_ids if pid in i18n["presets"]]
print(f"i18n.presets 总数: {len(i18n['presets'])}")
print(f"全部 preset: {len(all_ids)}")
print(f"已映射: {len(mapped)} ({len(mapped)/len(all_ids)*100:.1f}%)")
print(f"未映射: {len(all_ids) - len(mapped)}")

fooocus_ids = [pid for pid in all_ids if pid.startswith("fooocus_")]
fooocus_mapped = [pid for pid in fooocus_ids if pid in i18n["presets"]]
print(f"fooocus: {len(fooocus_mapped)}/{len(fooocus_ids)}")

random.seed(42)
sample = random.sample(fooocus_mapped, 20)
print("\nFooocus 抽样 20 条:")
for pid in sample:
    print(f"  {pid:55s}  {i18n['presets'][pid]}")
