"""恢复本轮误损的静态入口格式，只保留明确需要的安全与版本号变更。"""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def baseline(path):
    return subprocess.check_output(["git", "show", f"HEAD:{path}"], cwd=ROOT).decode("utf-8")


for name in ("static/index.html", "static/canvas.html", "static/canvas-list.html"):
    source = baseline(name)
    if name == "static/index.html":
        source = re.sub(r"(?<=\?v=)[^\"'<>\s]+", "20261022002", source)
    (ROOT / name).write_text(source, encoding="utf-8", newline="\n")

name = "static/modules/canvas-all.js"
source = baseline(name)
assert "${title}" in source and "${text}" in source
source = source.replace("${title}", "${escapeHtml(title)}").replace("${text}", "${escapeHtml(text)}")
(ROOT / name).write_text(source, encoding="utf-8", newline="\n")
print("已恢复入口换行及旧画布标题转义")
