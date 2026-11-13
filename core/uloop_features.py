"""自动检测 Unity 工程里 uloop 节点可用的功能与环境。

节点只让人填工程路径；CLI、插件类、自动化 API、文档、功能可用性全部在这里扫出来。
扫描范围限定 Assets/**/Editor/*.cs，最多 2000 个文件，结果缓存 30 秒。
"""
from __future__ import annotations

import re
import time
from pathlib import Path

_CACHE: dict[str, tuple[float, dict]] = {}
_TTL = 30.0
_MAX_FILES = 2000
_CLASS_RE = re.compile(r'public\s+static\s+class\s+(\w+)')
_JSON_API_RE = re.compile(r'public\s+static\s+string\s+(\w*Json)\s*\(')
_CLASS_HINT = ('Automation', 'Workflow', 'Tool', 'Window', 'Bridge', 'Generator', 'Controller')


def _cli_state() -> dict:
    from core import uloop_cli
    try:
        return {'found': True, 'path': uloop_cli.resolve_cli({})}
    except Exception as exc:
        return {'found': False, 'error': str(exc)[:300]}


def _scan(project: Path) -> dict:
    classes: dict[str, str] = {}
    apis: set[str] = set()
    docs: list[str] = []
    files = 0
    assets = project / 'Assets'
    if not assets.is_dir():
        return {'classes': {}, 'apis': [], 'docs': [], 'files': 0}
    for path in assets.rglob('*.cs'):
        if 'Editor' not in path.parts:
            continue
        files += 1
        if files > _MAX_FILES:
            break
        try:
            text = path.read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue
        rel = path.relative_to(project).as_posix()
        for match in _CLASS_RE.finditer(text):
            name = match.group(1)
            if any(hint in name for hint in _CLASS_HINT):
                classes.setdefault(name, rel)
        for match in _JSON_API_RE.finditer(text):
            apis.add(match.group(1))
    for path in assets.rglob('AI_USAGE.md'):
        docs.append(path.relative_to(project).as_posix())
        if len(docs) >= 20:
            break
    return {'classes': classes, 'apis': sorted(apis), 'docs': docs, 'files': files}


def discover(project: str = '') -> dict:
    from core import unity_projects
    raw = str(project or '').strip()
    if not raw:
        try:
            raw = unity_projects.best()
        except Exception:
            raw = ''
    path = Path(raw) if raw else None
    valid = bool(path and path.is_absolute() and (path / 'ProjectSettings' / 'ProjectVersion.txt').is_file())
    result: dict = {
        'project': path.as_posix() if valid and path else '',
        'projectValid': valid,
        'cli': _cli_state(),
        'plugins': [], 'apis': [], 'docs': [], 'scannedFiles': 0,
        'features': [],
    }
    if not valid:
        result['error'] = '请填写有效的 Unity 工程目录（需含 ProjectSettings/ProjectVersion.txt）'
        return result

    key = result['project']
    hit = _CACHE.get(key)
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    scanned = _scan(path)
    classes = scanned['classes']
    result.update({'plugins': [{'name': k, 'file': v} for k, v in sorted(classes.items())],
                   'apis': scanned['apis'], 'docs': scanned['docs'],
                   'scannedFiles': scanned['files']})
    has_ground = 'PlaneGeneratorAutomation' in classes
    result['features'] = [
        {'id': 'ground', 'label': '生成地表', 'available': has_ground,
         'description': '自动找参考对象、建目录、预检并生成。' if has_ground else '未检测到 PlaneGeneratorAutomation，无法使用。'},
        {'id': 'inspect', 'label': '查看当前场景与参考材质配色', 'available': True,
         'description': '只读：场景路径、可用参考对象、材质 / 配色 / 色档。'},
        {'id': 'scan', 'label': '列出场景对象层级', 'available': True,
         'description': '只读：把当前场景的对象树打印出来。'},
        {'id': 'custom', 'label': '自定义 C#（高级）', 'available': True,
         'description': '自己写代码，在编辑器主线程执行。'},
    ]
    _CACHE[key] = (time.time(), result)
    return result
