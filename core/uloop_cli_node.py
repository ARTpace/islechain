"""内置「Unity 场景工具（uloop）」扩展节点定义，首次读取节点目录时幂等安装。

极简交互：只填 Unity 工程路径 → 功能下拉由后端扫描工程自动生成 → 点运行。
uloop CLI、当前场景、参考对象、输出目录、预检流程全部自动，无需手填。
功能项由 core/uloop_features.py 检测，功能代码由 core/uloop_wizard.py 生成。

注意：node_catalog.install() 不允许覆盖同版本定义，修改 DEFINITION 必须提升 VERSION。
"""
import logging

from core import node_catalog

TYPE_ID = 'uloop.cli'
VERSION = '3.0.0'

DEFAULT_CODE = '''// 在「已打开的 Unity 编辑器」主线程执行 C#。
var scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
return "当前场景=" + scene.path;
'''

DEFINITION = {
    'schemaVersion': 1,
    'componentVersion': '1.0.0',
    'typeId': TYPE_ID,
    'version': VERSION,
    'title': 'Unity 场景工具（uloop）',
    'description': '只填工程路径，功能由工程自动检测；选一个功能点运行，其余全部自动。',
    'keywords': ['unity', 'uloop', 'PlaneGenerator', '场景制作', '地表', '图形化', '自动检测'],
    'fields': [
        {'id': 'project', 'label': 'Unity 工程目录', 'component': 'text', 'default': ''},
        {'id': 'feature', 'label': '功能', 'component': 'dropdown',
         'options': ['ground', 'inspect', 'scan', 'custom'], 'default': 'ground'},
        {'id': 'code', 'label': 'C# 代码（仅「自定义 C#」功能）',
         'component': 'textarea', 'default': DEFAULT_CODE},
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
        _log.warning('uloop 节点定义未安装：%s（如修改了定义请提升 VERSION）', exc)
