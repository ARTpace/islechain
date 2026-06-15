"""列出所有 fooocus 唯一 name 以便制定词典"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
audit = json.loads((ROOT / "_translate_audit.json").read_text(encoding="utf-8"))

names = audit["fooocus_unique_names"]
# 排序便于看
names_sorted = sorted(names, key=lambda x: x.lower())
for i, n in enumerate(names_sorted):
    print(f"{i+1:3d}  {n}")
