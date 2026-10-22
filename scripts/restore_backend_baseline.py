"""恢复未验收的路由拆分，保留已明确的止血函数；不修改用户数据。"""
import ast
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "main.py"
baseline = subprocess.check_output(["git", "show", "HEAD:main.py"], cwd=root).decode("utf-8")
current = path.read_text(encoding="utf-8-sig")

# 仅保留已经在本轮明确修改过、且签名调用链没有被拆到 router 的函数。
keep = {"hash_password", "verify_password", "save_to_history", "upload_image", "proxy_comfyui_upload_image", "view_image", "cancel_generate"}
old_tree = ast.parse(baseline)
new_tree = ast.parse(current)
new_lines = current.splitlines(keepends=True)
replacements = {node.name: "".join(new_lines[min([node.lineno] + [d.lineno for d in node.decorator_list])-1:node.end_lineno]) for node in new_tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in keep}
lines = baseline.splitlines(keepends=True)
changes = []
for node in old_tree.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in replacements:
        start = min([node.lineno] + [d.lineno for d in node.decorator_list])-1
        changes.append((start, node.end_lineno, replacements[node.name] + "\n"))
for start, end, text in sorted(changes, reverse=True):
    lines[start:end] = [text]
source = "".join(lines)
if "import bcrypt\n" not in source:
    source = "import bcrypt\nimport logging\nlogger = logging.getLogger(__name__)\n" + source
if "verify_password" in replacements and not any(isinstance(n, ast.FunctionDef) and n.name == "verify_password" for n in old_tree.body):
    marker = "def load_users():"
    source = source.replace(marker, replacements["verify_password"] + "\n\n" + marker, 1)
# 注册、登录、改密保持原来的接口，但登录须调用兼容校验而非比较随机盐哈希。
source = source.replace('user["password"] != hash_password(payload.password)', 'not verify_password(user["password"], payload.password)')
ast.parse(source)
path.write_text(source, encoding="utf-8", newline="\n")
print("已恢复单入口路由基线；保留函数:", ", ".join(sorted(replacements)))
