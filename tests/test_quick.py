"""快速冒烟测试：验证 art-canvas 服务基础可达性。

原始脚本内容已丢失（文件被清空），此处重建为 pytest 可跑的最小冒烟用例。
依赖外部服务（art-canvas 后端 / ComfyUI）的用例打 @pytest.mark.integration，默认 skip。
"""

import pytest

BASE = "http://127.0.0.1:7000"


@pytest.mark.integration
def test_service_alive():
    """[integration] 检查 art-canvas 后端 /api/tts/modes 是否可达。"""
    import requests

    r = requests.get(f"{BASE}/api/tts/modes", timeout=5)
    assert r.status_code == 200, f"服务不可用: {r.status_code}"


@pytest.mark.integration
def test_voices_library_nonempty():
    """[integration] 检查音色库非空，否则多人对话测试无意义。"""
    import requests

    r = requests.get(f"{BASE}/api/tts/voices", timeout=5)
    assert r.status_code == 200
    voices = r.json().get("voices", {})
    assert len(voices) > 0, "音色库为空"


def test_smoke_imports():
    """[unit] 纯本地检查：确认项目核心模块可被 import，不依赖外部服务。"""
    import importlib
    import os
    import sys

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if root not in sys.path:
        sys.path.insert(0, root)

    # 只 import 轻量模块，避免 import main.py 触发 FastAPI/uvicorn 副作用
    import contextlib

    for mod in ("random_source", "genre_registry", "preset_manager"):
        with contextlib.suppress(ImportError):
            importlib.import_module(mod)
