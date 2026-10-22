#!/usr/bin/env python3
"""routers/ 与 main.py 的引用契约回归测试（纯 AST，不导入 main）。

P1-3 拆分过程中反复踩到的坑：搬运脚本会把 helper 一起搬走，而其它 router
仍通过 `_main.NAME` 引用它 —— 函数签名上的注解在**模块加载时**求值，于是
`import main` 直接 AttributeError；运行期调用的则会变成 500。

本测试在拆模块后立刻能发现这类断裂：
1. routers/*.py 里出现的每个 `_main.NAME`，main.py 顶层必须绑定该名字
2. main.py 里 `from routers import x` 的变量名，必须与 routers/x.py 的文件名一致
   （test_route_inventory.py 的多重集统计依赖这个约定）
3. routers/ 下每个 .py（除 __init__）都必须被 main.py 显式接入，防止漏 include

运行：pytest tests/test_main_references.py -v
"""

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAIN = ROOT / "main.py"
ROUTERS = ROOT / "routers"


def _main_top_level_names(src: str) -> set:
    """main.py 顶层（含 if/try 块内）定义、赋值、导入得到的名字。"""
    names: set = set()

    def collect(nodes):
        for node in nodes:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(node.name)
            elif isinstance(node, ast.Assign):
                for t in node.targets:
                    if isinstance(t, ast.Name):
                        names.add(t.id)
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                names.add(node.target.id)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                for a in node.names:
                    names.add(a.asname or a.name.split(".")[0])
            elif isinstance(node, ast.If):
                collect(node.body)
                collect(node.orelse)
            elif isinstance(node, ast.Try):
                collect(node.body)
                collect(node.orelse)
                collect(node.finalbody)
                for h in node.handlers:
                    collect(h.body)
            elif isinstance(node, (ast.With, ast.AsyncWith)):
                collect(node.body)

    collect(ast.parse(src).body)
    return names


def _router_files():
    return sorted(p for p in ROUTERS.glob("*.py") if p.name != "__init__.py")


def test_main_reference_targets_exist():
    """routers 里所有 `_main.X` 都必须在 main.py 顶层存在。"""
    have = _main_top_level_names(MAIN.read_text(encoding="utf-8"))
    missing = {}
    for f in _router_files():
        refs = set(re.findall(r"_main\.([A-Za-z_][A-Za-z0-9_]*)", f.read_text(encoding="utf-8")))
        bad = sorted(refs - have)
        if bad:
            missing[f.name] = bad
    assert not missing, (
        "以下 router 引用了 main.py 不存在的符号（搬迁时被带走或改名）：%s" % missing
    )


def test_import_variable_matches_file_stem():
    """main.py 的 `from routers import x` 必须与 routers/x.py 同名。"""
    src = MAIN.read_text(encoding="utf-8")
    imported = set()
    for node in ast.parse(src).body:
        if isinstance(node, ast.ImportFrom) and node.module == "routers":
            for a in node.names:
                imported.add(a.asname or a.name)
    stems = {p.stem for p in _router_files()}
    assert imported <= stems, "main.py 导入了不存在的 router 模块：%s" % sorted(imported - stems)


def test_every_router_is_wired():
    """routers/ 下的每个模块都必须被 main.py 导入并 include_router。"""
    src = MAIN.read_text(encoding="utf-8")
    imported, included = set(), set()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.ImportFrom) and node.module == "routers":
            for a in node.names:
                imported.add(a.asname or a.name)
        elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
              and node.func.attr == "include_router" and node.args
              and isinstance(node.args[0], ast.Name)):
            included.add(node.args[0].id)
    stems = {p.stem for p in _router_files()}
    assert stems - imported == set(), "未被 main.py 导入的 router：%s" % sorted(stems - imported)
    assert stems - included == set(), "未被 include_router 的 router：%s" % sorted(stems - included)


def test_lazy_router_package_exports():
    """routers/__init__.py 的 _SUBROUTERS 必须覆盖全部子模块。"""
    src = (ROUTERS / "__init__.py").read_text(encoding="utf-8")
    declared = set(re.findall(r'^\s+"([a-z_][a-z0-9_]*)",\s*$', src, re.MULTILINE))
    stems = {p.stem for p in _router_files()}
    assert stems - declared == set(), "routers/__init__.py 缺少：%s" % sorted(stems - declared)
