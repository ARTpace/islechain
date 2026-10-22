"""只读比较入口顶层定义，定位迁移丢失的符号。"""
import ast
import subprocess
from collections import Counter
from pathlib import Path

root = Path(__file__).resolve().parents[1]
old = subprocess.check_output(["git", "show", "HEAD:main.py"], cwd=root).decode("utf-8")
new = (root / "main.py").read_text(encoding="utf-8-sig")

def definitions(source):
    return Counter(n.name for n in ast.parse(source).body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)))

missing = definitions(old) - definitions(new)
print("迁移后入口缺失的顶层定义:")
for name, count in missing.items():
    print(name, count)
