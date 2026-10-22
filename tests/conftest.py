"""pytest 公共配置。

提供 pytest-asyncio 需要的 event_loop fixture，以及 integration marker 的默认行为：
未指定 -m 时 integration 用例自动 skip，保证 CI 只跑纯单元逻辑。
"""

import asyncio

import pytest


@pytest.fixture
def event_loop():
    """为 pytest-asyncio 提供事件循环，避免 DeprecationWarning。"""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


def pytest_configure(config):
    """注册自定义 marker，避免 pytest 未知 marker 警告。"""
    config.addinivalue_line(
        "markers", "integration: 需要外部服务（art-canvas 后端 / ComfyUI）的集成测试"
    )


def pytest_collection_modifyitems(config, items):
    """默认跳过 integration 用例，除非命令行显式传 -m integration。"""
    if config.getoption("-m") == "integration":
        return

    skip_integration = pytest.mark.skip(
        reason="integration 用例需外部服务，默认跳过；加 -m integration 运行"
    )
    for item in items:
        # item.keywords 中既有 str 也有 Mark 对象，统一取名字
        names = []
        for kw in item.keywords:
            names.append(kw if isinstance(kw, str) else getattr(kw, "name", str(kw)))
        if "integration" in names:
            item.add_marker(skip_integration)
