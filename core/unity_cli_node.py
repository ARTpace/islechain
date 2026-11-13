"""内置「Unity CLI（官方）」扩展节点定义，首次读取节点目录时幂等安装。

走 host.cli 执行器：不需要 HTTPS、不需要 trusted hash、不受 30 秒 worker 上限约束。
执行层 core/unity_cli.py 调用官方 ``unity run``（不再是直接 spawn Unity.exe）。

注意：node_catalog.install() 不允许覆盖同版本定义，修改 DEFINITION 必须提升 VERSION。
"""
import logging

from core import node_catalog

TYPE_ID = 'unity.cli'
VERSION = '1.1.0'

DEFINITION = {
    'schemaVersion': 1,
    'componentVersion': '1.0.0',
    'typeId': TYPE_ID,
    'version': VERSION,
    'title': 'Unity CLI（官方）',
    'description': '调用官方 Unity CLI 的 unity run，在 batchmode 下执行静态编辑器方法（-executeMethod），回显 Unity 日志与 JSON 输出。',
    'keywords': ['unity', 'cli', '官方CLI', 'unity run', '编辑器', 'executeMethod', '批处理'],
    'fields': [
        {'id': 'project', 'label': 'Unity 工程目录（含 ProjectSettings）', 'component': 'text', 'default': ''},
        {'id': 'method', 'label': '编辑器方法 Namespace.Class.Method', 'component': 'text', 'default': ''},
        {'id': 'executable', 'label': 'Unity 编辑器路径（可选，留空按 ProjectVersion.txt 自动匹配）', 'component': 'text', 'default': ''},
        {'id': 'cli', 'label': '官方 unity CLI 路径（可选，留空自动探测 PATH）', 'component': 'text', 'default': ''},
        {'id': 'args', 'label': '额外参数（可选，-Key Value 成对）', 'component': 'text', 'default': ''},
        {'id': 'timeout', 'label': '超时（秒，10–1800）', 'component': 'number',
         'default': 600, 'minimum': 10, 'maximum': 1800, 'step': 30},
    ],
    'execution': {'kind': 'host.cli'},
}

_ensured = False
_log = logging.getLogger(__name__)


def ensure_installed():
    """幂等安装。同版本定义内容变化时不可覆盖（install 会拒绝），此时提升 VERSION 即可。"""
    global _ensured
    if _ensured:
        return
    _ensured = True
    try:
        node_catalog.install(DEFINITION)
    except ValueError as exc:
        _log.warning('Unity CLI 节点定义未安装：%s（如修改了定义请提升 VERSION）', exc)
