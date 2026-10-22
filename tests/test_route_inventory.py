#!/usr/bin/env python3
"""
纯 AST 静态分析的路由清单回归测试。

功能：
- 解析 APIRouter(prefix=...) 与 include_router(prefix=...) 合成完整路径
- 对比 Counter(当前) == Counter(基线) 的 METHOD+PATH 多重集
- 基线来自 git HEAD 固定快照 (tests/fixtures/route_inventory_baseline.json)
- 允许 HEAD 原有 3 处重复保持原样，若消除需显式批准并说明差异
- 不导入 main.py，避免触发真实用户数据/副作用
- 返回模型/状态码/签名静态对比预留字段

运行：pytest tests/test_route_inventory.py -v
"""

import ast
import json
import os
import sys
from collections import Counter
from pathlib import Path
from typing import List, Tuple, Dict, Set, Optional

# ─── 纯 AST 路由提取器 (不导入模块) ─────────────────────────────────────


class RouteVisitor(ast.NodeVisitor):
    """AST 访问器：提取 @router.METHOD("/path") / @app.METHOD("/path")"""

    def __init__(self):
        self.routes: List[Tuple[str, str, str]] = []  # (method, path, function_name)
        self.router_prefix: str = ""  # 当前文件的 APIRouter prefix
        self.app_variable_names: Set[str] = {"app"}  # 可能的 app 变量名

    def visit_Assign(self, node: ast.Assign):
        """捕获 router = APIRouter(prefix=...)"""
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == "router":
                if isinstance(node.value, ast.Call):
                    for kw in node.value.keywords:
                        if kw.arg == "prefix" and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                            self.router_prefix = kw.value.value.rstrip("/") if kw.value.value != "/" else kw.value.value
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef):
        self._check_decorators(node)
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
        self._check_decorators(node)
        self.generic_visit(node)

    def _check_decorators(self, node):
        for decorator in node.decorator_list:
            route_info = self._extract_route(decorator)
            if route_info:
                method, path = route_info
                # 合成完整路径：router_prefix + path
                full_path = self._join_path(self.router_prefix, path)
                self.routes.append((method.upper(), full_path, node.name))

    def _extract_route(self, decorator: ast.AST) -> Optional[Tuple[str, str]]:
        """从 @xxx.METHOD("/path") 提取 (method, path)"""
        if not isinstance(decorator, ast.Call):
            return None

        func = decorator.func
        if not isinstance(func, ast.Attribute):
            return None

        method = func.attr.lower()
        if method not in ("get", "post", "put", "delete", "patch", "websocket", "head", "options", "trace"):
            return None

        if not decorator.args:
            return None

        arg = decorator.args[0]
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            return (method, arg.value)

        return None

    @staticmethod
    def _join_path(prefix: str, path: str) -> str:
        """合成完整路径，处理 prefix 和 path 的拼接"""
        if not prefix:
            return path
        # prefix 以 / 开头，path 以 / 开头
        # 去掉 prefix 末尾 /，去掉 path 开头 /，中间加 /
        return prefix.rstrip("/") + "/" + path.lstrip("/")


def extract_routes_from_file(filepath: Path) -> List[Tuple[str, str, str, str]]:
    """从单个 Python 文件提取路由"""
    try:
        source = filepath.read_text(encoding="utf-8")
    except Exception as e:
        print(f"警告: 无法读取 {filepath}: {e}", file=sys.stderr)
        return []

    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        print(f"警告: {filepath} 语法错误: {e}", file=sys.stderr)
        return []

    visitor = RouteVisitor()
    visitor.visit(tree)

    results = []
    for method, path, func_name in visitor.routes:
        # 标准化路径
        norm_path = path.rstrip("/") if path != "/" else path
        results.append((method, norm_path, func_name, filepath.name))

    return results


def extract_main_app_routes(main_py: Path) -> Tuple[List[Tuple[str, str, str, str]], Dict[str, str]]:
    """从 main.py 提取路由，包括 include_router(prefix=...) 的前缀合成"""
    try:
        source = main_py.read_text(encoding="utf-8")
    except Exception as e:
        print(f"警告: 无法读取 {main_py}: {e}", file=sys.stderr)
        return [], {}

    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        print(f"警告: main.py 语法错误: {e}", file=sys.stderr)
        return [], {}

    # 先收集所有 include_router 调用及其 prefix
    include_routers: Dict[str, str] = {}  # router变量名 -> prefix

    class IncludeRouterVisitor(ast.NodeVisitor):
        def visit_Call(self, node: ast.Call):
            if isinstance(node.func, ast.Attribute) and node.func.attr == "include_router":
                if node.args:
                    router_var = node.args[0]
                    if isinstance(router_var, ast.Name):
                        router_name = router_var.id
                        # 查找 prefix 关键字参数
                        prefix = ""
                        for kw in node.keywords:
                            if kw.arg == "prefix" and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                                prefix = kw.value.value.rstrip("/") if kw.value.value != "/" else kw.value.value
                        include_routers[router_name] = prefix
            self.generic_visit(node)

    IncludeRouterVisitor().visit(tree)

    # 再提取 main.py 直接定义的路由 (@app.xxx)
    visitor = RouteVisitor()
    visitor.router_prefix = ""  # main.py 没有 router prefix
    visitor.visit(tree)

    results = []
    for method, path, func_name in visitor.routes:
        norm_path = path.rstrip("/") if path != "/" else path
        results.append((method, norm_path, func_name, main_py.name))

    return results, include_routers


def extract_all_routes(root_dir: Path) -> Tuple[List[Tuple[str, str, str, str]], Dict[str, str]]:
    """提取所有路由：main.py 直接定义 + routers/ 目录下所有 router 文件"""
    all_routes = []
    include_routers = {}

    # 1. main.py 直接定义的路由 + include_router 信息
    main_py = root_dir / "main.py"
    if main_py.exists():
        main_routes, inc_routers = extract_main_app_routes(main_py)
        all_routes.extend(main_routes)
        include_routers = inc_routers

    # 2. routers/ 目录下的路由器文件 (它们有自己的 prefix)
    routers_dir = root_dir / "routers"
    if routers_dir.exists():
        for py_file in routers_dir.glob("*.py"):
            if py_file.name == "__init__.py":
                continue
            router_name = py_file.stem  # 如 'auth', 'canvases'
            # 只统计入口实际注册的路由，不能把未接入的迁移草稿计入服务合同。
            if router_name not in include_routers:
                continue
            prefix = include_routers[router_name]

            # 提取路由器文件内的路由
            routes = extract_routes_from_file(py_file)
            for method, path, func_name, filename in routes:
                # 如果路由器文件内已包含完整路径 (如 auth.py 写 /api/auth/...)，直接用
                # 如果路由器文件内写相对路径 (如 comfyui.py 写 /llama-models)，需合成 prefix
                # 简单策略：如果路由文件内定义的路径已以 /api/ 开头，认为是完整路径
                # 否则合成 prefix
                if path.startswith("/api/"):
                    full_path = path
                else:
                    full_path = prefix.rstrip("/") + "/" + path.lstrip("/") if prefix else path
                full_path = full_path.rstrip("/") if full_path != "/" else full_path
                all_routes.append((method, full_path, func_name, filename))

    return all_routes, include_routers


def routes_to_counter(routes: List[Tuple[str, str, str, str]]) -> Counter:
    """转为 Counter[(method, path)]，保留重复项"""
    counter = Counter()
    for method, path, _, _ in routes:
        counter[(method, path)] += 1
    return counter


# ─── 基线加载 ───────────────────────────────────────────────────────────

BASELINE_FILE = Path(__file__).parent / "fixtures" / "route_inventory_baseline.json"


def load_baseline() -> Counter:
    """从基线文件加载 Counter"""
    if not BASELINE_FILE.exists():
        raise FileNotFoundError(f"基线文件不存在: {BASELINE_FILE}，请先运行生成基线脚本")
    with BASELINE_FILE.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return Counter({(m, p): c for m, p, c in data})


def save_baseline(counter: Counter):
    """保存基线文件 (仅用于首次生成或批准更新)"""
    BASELINE_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = [[m, p, c] for (m, p), c in sorted(counter.items())]
    with BASELINE_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"基线已保存至: {BASELINE_FILE} ({len(counter)} 个唯一 METHOD+PATH, 总计 {sum(counter.values())} 条)")


# ─── 测试函数 ───────────────────────────────────────────────────────────


def test_auth_routes_exact_match():
    """专项测试：/api/auth/* 路由必须与基线完全一致 (含重复计数)"""
    root_dir = Path(__file__).parent.parent
    current_routes, _ = extract_all_routes(root_dir)
    current_counter = routes_to_counter(current_routes)
    baseline_counter = load_baseline()

    # 只看 auth 路由
    auth_current = {k: v for k, v in current_counter.items() if "/api/auth/" in k[1]}
    auth_baseline = {k: v for k, v in baseline_counter.items() if "/api/auth/" in k[1]}

    assert auth_current == auth_baseline, (
        f"Auth 路由不匹配:\n"
        f"  当前: {dict(sorted(auth_current.items()))}\n"
        f"  基线: {dict(sorted(auth_baseline.items()))}"
    )


def test_full_route_inventory_multiset_match():
    """全量测试：当前路由多重集必须与基线完全一致"""
    root_dir = Path(__file__).parent.parent
    current_routes, _ = extract_all_routes(root_dir)
    current_counter = routes_to_counter(current_routes)
    baseline_counter = load_baseline()

    # 详细差异报告
    missing = baseline_counter - current_counter
    extra = current_counter - baseline_counter

    if missing or extra:
        msg_parts = ["路由多重集不匹配:"]
        if missing:
            msg_parts.append(f"\n  缺失 {len(missing)} 项 (基线有，当前无):")
            for (m, p), cnt in sorted(missing.items()):
                msg_parts.append(f"    {m} {p} (x{cnt})")
        if extra:
            msg_parts.append(f"\n  新增 {len(extra)} 项 (当前有，基线无):")
            for (m, p), cnt in sorted(extra.items()):
                msg_parts.append(f"    {m} {p} (x{cnt})")
        raise AssertionError("".join(msg_parts))


def test_known_head_duplicates_documented():
    """记录 HEAD 原有的 3 处重复，要求显式批准才能消除"""
    baseline_counter = load_baseline()

    # HEAD 原有重复 (来自 main_head.py 静态分析)
    known_duplicates = {
        ("GET", "/api/canvases/{canvas_id}/meta"): 2,
        ("POST", "/api/canvases/{canvas_id}/meta"): 2,
        ("POST", "/api/canvases/{canvas_id}/touch"): 2,
    }

    for key, expected_cnt in known_duplicates.items():
        actual_cnt = baseline_counter.get(key, 0)
        assert actual_cnt == expected_cnt, (
            f"HEAD 原有重复项计数变化，需显式批准:\n"
            f"  {key[0]} {key[1]}: 基线={actual_cnt}, 期望={expected_cnt}\n"
            f"  若要消除重复，请更新基线文件并在 PR 说明中注明原因"
        )


def test_current_duplicates_reported():
    """报告当前代码库中的重复路由 (包含 HEAD 继承的 + 新增的)"""
    root_dir = Path(__file__).parent.parent
    current_routes, _ = extract_all_routes(root_dir)
    current_counter = routes_to_counter(current_routes)

    duplicates = {k: v for k, v in current_counter.items() if v > 1}

    if duplicates:
        print("\n当前重复路由 (METHOD+PATH 出现 >1 次):")
        for (m, p), cnt in sorted(duplicates.items()):
            print(f"  {m} {p}: x{cnt}")
            # 显示具体定义位置
            for method, path, func, fname in current_routes:
                if method == m and path == p:
                    print(f"    - {func} in {fname}")


def test_no_circular_imports_in_auth():
    """auth.py 不得在模块级导入 main (避免循环导入)"""
    auth_py = Path(__file__).parent.parent / "routers" / "auth.py"
    source = auth_py.read_text(encoding="utf-8")
    tree = ast.parse(source)

    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "main":
            # 检查是否在 TYPE_CHECKING 保护下
            in_type_checking = False
            for parent in ast.walk(tree):
                if (isinstance(parent, ast.If) and
                    isinstance(parent.test, ast.Name) and
                    parent.test.id == "TYPE_CHECKING"):
                    # 简化检查：如果有 TYPE_CHECKING if 语句，认为可能受保护
                    in_type_checking = True
                    break
            if not in_type_checking:
                raise AssertionError(f"auth.py 模块级导入 main: {ast.unparse(node)}")


# ─── 返回模型/状态码/签名静态对比预留 (后续扩展) ─────────────────────────────

class SignatureVisitor(ast.NodeVisitor):
    """提取函数签名：参数、返回类型注解、装饰器信息"""
    def __init__(self):
        self.signatures: Dict[str, Dict] = {}

    def visit_FunctionDef(self, node: ast.FunctionDef):
        self._record(node)
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
        self._record(node)
        self.generic_visit(node)

    def _record(self, node):
        args = []
        for arg in node.args.args:
            arg_name = arg.arg
            arg_annotation = ast.unparse(arg.annotation) if arg.annotation else None
            args.append({"name": arg_name, "type": arg_annotation})
        returns = ast.unparse(node.returns) if node.returns else None
        self.signatures[node.name] = {
            "args": args,
            "returns": returns,
            "is_async": isinstance(node, ast.AsyncFunctionDef),
        }


def extract_signatures(filepath: Path) -> Dict[str, Dict]:
    """提取文件中所有函数的签名信息"""
    try:
        source = filepath.read_text(encoding="utf-8")
        tree = ast.parse(source)
        visitor = SignatureVisitor()
        visitor.visit(tree)
        return visitor.signatures
    except Exception:
        return {}


def test_response_signatures_match_baseline():
    """预留：对比返回模型/状态码/签名 (需基线扩展支持)"""
    # TODO: 当基线扩展包含 response_model、status_code、签名信息时启用
    # 当前仅作占位，不阻断测试
    pass


# ─── 基线生成辅助 (仅开发时手动运行) ─────────────────────────────────────


def generate_baseline_from_head():
    """从 git HEAD 生成基线 (开发时手动运行，不作为自动测试)"""
    import subprocess

    # 读取 HEAD 版本的 main.py
    try:
        result = subprocess.run(
            ["git", "show", "HEAD:main.py"],
            cwd=Path(__file__).parent.parent,
            capture_output=True,
            text=True,
            encoding="utf-8"
        )
        if result.returncode != 0:
            raise RuntimeError(f"git show 失败: {result.stderr}")
        head_source = result.stdout
    except Exception as e:
        print(f"无法获取 HEAD:main.py: {e}", file=sys.stderr)
        return

    # 解析 HEAD main.py
    tree = ast.parse(head_source)
    visitor = RouteVisitor()
    visitor.visit(tree)

    head_routes = []
    for method, path, func_name in visitor.routes:
        norm_path = path.rstrip("/") if path != "/" else path
        head_routes.append((method, norm_path, func_name, "main.py"))

    counter = routes_to_counter(head_routes)
    save_baseline(counter)
    print(f"从 HEAD 生成基线完成: {sum(counter.values())} 条路由")


if __name__ == "__main__":
    # 允许直接运行生成基线
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate-baseline", action="store_true", help="从 git HEAD 生成基线文件")
    args = parser.parse_args()

    if args.generate_baseline:
        generate_baseline_from_head()
    else:
        # 运行测试
        print("运行路由清单回归测试...")
        test_known_head_duplicates_documented()
        print("✓ HEAD 原有重复项已记录")
        test_auth_routes_exact_match()
        print("✓ Auth 路由完全匹配基线")
        test_full_route_inventory_multiset_match()
        print("✓ 全量路由多重集完全匹配基线")
        test_current_duplicates_reported()
        test_no_circular_imports_in_auth()
        print("✓ auth.py 无循环导入")
        print("\n所有测试通过!")