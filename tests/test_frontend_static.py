"""静态页面验收：检查内联脚本语法和核心脚本加载，不访问真实服务。"""
import re
import shutil
import subprocess
from html.parser import HTMLParser
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PAGES = ("index.html", "canvas.html", "canvas-list.html", "smart-canvas.html")


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inline = []
        self.sources = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        if tag != "script":
            return
        attrs = dict(attrs)
        if "src" in attrs:
            self.sources.append(attrs["src"])
        elif attrs.get("type", "") not in ("application/json", "application/ld+json"):
            self.current = []

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.current is not None:
            self.inline.append("".join(self.current))
            self.current = None


@pytest.mark.parametrize("page", PAGES)
def test_inline_scripts_parse(page, tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("需要 Node.js 执行脚本语法检查")
    parser = Scripts()
    parser.feed((ROOT / "static" / page).read_text(encoding="utf-8-sig"))
    for index, script in enumerate(parser.inline):
        target = tmp_path / f"script-{index}.js"
        target.write_text(script, encoding="utf-8")
        result = subprocess.run([node, "--check", str(target)], capture_output=True, text=True)
        assert result.returncode == 0, f"{page} 内联脚本 {index}: {result.stderr}"
    for source in parser.sources:
        if source.startswith("/static/"):
            assert (ROOT / source.split("?", 1)[0].lstrip("/")).is_file(), source
    assert not any("canvas-engine.js" in source for source in parser.sources)


def test_legacy_canvas_titles_are_escaped():
    source = (ROOT / "static/modules/canvas-all.js").read_text(encoding="utf-8-sig")
    assert "${escapeHtml(title)}" in source
    assert "${escapeHtml(text)}" in source
    assert len(source.splitlines()) > 4000, "禁止将含行注释的旧脚本压成单行"


def test_index_preserves_line_comments():
    source = (ROOT / "static/index.html").read_text(encoding="utf-8-sig")
    assert len(source.splitlines()) > 1000
    assert re.search(r"20261022\d{3}", source)
