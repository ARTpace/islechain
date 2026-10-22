"""启动入口回归：脚本直跑（python main.py）与模块导入（import main）都必须成立。

背景（2026-10-22）：断循环改造后 routers/*.py 统一用 `import main as _main` 惰性依赖。
`python main.py` 启动时本模块名是 `__main__`，若 main.py 不把当前模块登记为 `main`，
routers 里的 `import main` 会重新执行一遍 main.py（表现为日志重复打印、路由重复注册），
第二遍执行到接线处时 routers 包仍半初始化，启动直接崩：
    AttributeError: partially initialized module 'routers.comfyui' has no attribute 'routes'

其余测试都走 `import main`（模块名本就是 main），覆盖不到这条路径，故单独锁定。
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 以 __main__ 身份执行 main.py（等价 `python main.py`），打桩 uvicorn.run 避免占端口
_SCRIPT = (
    "import runpy, uvicorn\n"
    "uvicorn.run = lambda *a, **k: None\n"
    "g = runpy.run_path('main.py', run_name='__main__')\n"
    "print('ROUTES', len(g['app'].routes))\n"
)


def test_script_entry_startup():
    """python main.py 直跑能完成导入并拿到完整路由表。"""
    r = subprocess.run(
        [sys.executable, "-c", _SCRIPT],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert r.returncode == 0, "脚本直跑失败:\n" + r.stderr[-2000:]
    assert "ROUTES 288" in r.stdout, "路由数与基线不符:\n" + r.stdout[-1000:]


def test_main_alias_registered_before_router_import():
    """main 模块别名必须早于 routers 导入（顺序错了就复发半初始化崩溃）。"""
    src = (ROOT / "main.py").read_text(encoding="utf-8")
    alias = src.index('_sys.modules.setdefault("main"')
    wiring = src.index("from routers import")
    assert alias < wiring, "sys.modules['main'] 别名必须在 from routers import 之前"
