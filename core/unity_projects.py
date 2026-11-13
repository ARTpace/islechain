"""自动发现本机 Unity 工程（官方 Unity CLI 的 Hub 注册表）。

官方 ``unity`` CLI 是全局二进制，不随工程安装。本模块同时标出两项：
- ``editorInstalled``：工程对应版本的编辑器是否已安装（决定了能否直接 ``unity run``）
- ``pipeline``：工程是否装了 ``com.unity.pipeline``（决定能否 ``unity run --command`` 复用已开 Editor）

命令输出为 ``--format json``，结果缓存 30 秒，避免每次打开节点都拉起 CLI。
"""
from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path

from core.unity_cli import resolve_cli, UnityCliError

CACHE_TTL = 30.0
_CACHE: dict = {'at': 0.0, 'value': None}
VERSION_LINE = re.compile(r'^\s*m_EditorVersion:\s*(\S+)', re.M)
CLI_PACKAGES = ('com.unity.pipeline', 'com.unity.agent', 'com.unity.cli')


def _cli_json(args: list[str], timeout: float = 20.0):
    argv = [resolve_cli({}), '--format', 'json', '--no-banner', '--no-pager',
            '--non-interactive', *args]
    proc = subprocess.run(argv, capture_output=True, text=True, encoding='utf-8',
                          errors='replace', timeout=timeout, shell=False,
                          creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    raw = (proc.stdout or '').strip()
    start = raw.find('{')
    if start < 0:
        raise UnityCliError('官方 Unity CLI 无 JSON 输出：' + ((proc.stderr or raw) or '')[:200])
    data = json.loads(raw[start:])
    if isinstance(data, dict):
        if data.get('success') is False:
            raise UnityCliError(str(data.get('errors') or '命令执行失败')[:200])
        return data.get('data') or []
    return data or []


def _project_detail(path: str) -> dict:
    root = Path(path)
    version_file = root / 'ProjectSettings' / 'ProjectVersion.txt'
    version = ''
    if version_file.is_file():
        try:
            match = VERSION_LINE.search(version_file.read_text(encoding='utf-8', errors='replace'))
            if match:
                version = match.group(1)
        except OSError:
            pass
    pipeline = False
    manifest = root / 'Packages' / 'manifest.json'
    if manifest.is_file():
        try:
            deps = json.loads(manifest.read_text(encoding='utf-8-sig')).get('dependencies') or {}
            pipeline = any(any(str(k).lower().startswith(pkg) for pkg in CLI_PACKAGES) for k in deps)
        except (OSError, ValueError):
            pass
    if not pipeline:
        cache = root / 'Library' / 'PackageCache'
        if cache.is_dir():
            try:
                pipeline = any(any(entry.name.lower().startswith(pkg) for pkg in CLI_PACKAGES)
                               for entry in cache.iterdir())
            except OSError:
                pass
    return {'valid': version_file.is_file(), 'version': version, 'pipeline': pipeline}


def discover(force: bool = False) -> dict:
    """返回 {'projects': [...], 'editors': [...], 'error': str}，失败不抛异常。"""
    now = time.monotonic()
    if not force and _CACHE['value'] is not None and now - _CACHE['at'] < CACHE_TTL:
        return dict(_CACHE['value'])
    result: dict = {'projects': [], 'editors': [], 'error': ''}
    try:
        editors = _cli_json(['editors', '--installed'])
        installed = {str(e.get('version') or '') for e in editors if isinstance(e, dict)}
        result['editors'] = sorted(v for v in installed if v)
        projects = []
        for row in _cli_json(['projects', 'list']):
            if not isinstance(row, dict):
                continue
            path = str(row.get('path') or '').strip()
            if not path:
                continue
            detail = _project_detail(path)
            version = str(row.get('version') or detail['version'] or '')
            projects.append({
                'title': str(row.get('title') or Path(path).name),
                'path': path,
                'version': version,
                'lastModified': float(row.get('lastModified') or 0),
                'valid': detail['valid'],
                'pipeline': detail['pipeline'],
                'editorInstalled': version in installed,
            })
        # 优先：装了工程级 CLI 包 > 编辑器已安装 > 工程结构有效 > 最近使用
        projects.sort(key=lambda p: (p['pipeline'], p['editorInstalled'], p['valid'], p['lastModified']),
                      reverse=True)
        result['projects'] = projects
    except Exception as exc:  # CLI 未安装 / 超时 / JSON 异常都给前端可读提示
        result['error'] = str(exc)[:300]
    _CACHE['value'] = dict(result)
    _CACHE['at'] = now
    return result


def best() -> str:
    """工程目录留空时自动选择：先挑「编辑器已装 + 结构有效」里排序最靠前的。"""
    data = discover()
    rows = [p for p in data['projects'] if p['valid'] and p['editorInstalled']]
    if not rows:
        rows = [p for p in data['projects'] if p['valid']]
    if not rows:
        raise UnityCliError('未在本机发现可用 Unity 工程：请在节点里手动填写工程目录，'
                            '或先在 Unity Hub 中注册工程' + (f'（{data["error"]}）' if data['error'] else ''))
    return rows[0]['path']


# ---- 工程内可执行编辑器方法（用于节点的方法下拉） ----
CS_BLOCK_COMMENT = re.compile(r'/\*.*?\*/', re.S)
CS_LINE_COMMENT = re.compile(r'//[^\n]*')
CS_NAMESPACE = re.compile(r'\bnamespace\s+([\w.]+)\s*[;{]')
CS_CLASS = re.compile(r'\b(?:public\s+|internal\s+|private\s+|protected\s+)?'
                      r'(?:static\s+|sealed\s+|partial\s+|abstract\s+)*class\s+(\w+)')
CS_METHOD = re.compile(r'\bpublic\s+static\s+(?:async\s+)?[\w<>,.\[\]?]+\s+(\w+)\s*\(\s*\)')
CS_MENU = re.compile(r'\[\s*MenuItem\s*\(\s*"([^"]+)"')
MAX_CS_FILES = 1200
MAX_CS_WALK = 20000
MAX_CS_BYTES = 400_000


def _allowed_project(project: str) -> str:
    """只允许扫描本机 Hub 已注册的工程，避免借端点读任意目录。"""
    wanted = str(project or '').strip()
    rows = discover()['projects']
    if not wanted:
        return best()
    target = Path(wanted).resolve()
    for row in rows:
        if Path(row['path']).resolve() == target:
            return row['path']
    raise UnityCliError('该工程不在本机 Unity Hub 注册列表中，拒绝扫描其脚本')


def editor_methods(project: str = '') -> dict:
    """扫描 Assets 下 Editor 目录里的静态无参方法，生成 -executeMethod 候选。"""
    result: dict = {'project': '', 'methods': [], 'error': ''}
    try:
        path = _allowed_project(project)
        result['project'] = path
        root = Path(path) / 'Assets'
        if not root.is_dir():
            raise UnityCliError('工程里没有 Assets 目录')
        files = []
        for index, entry in enumerate(root.rglob('*.cs')):
            if index >= MAX_CS_WALK or len(files) >= MAX_CS_FILES:
                break
            if not entry.is_file():
                continue
            relative = entry.relative_to(root)
            if any('editor' in part.lower() for part in relative.parts[:-1]) or 'editor' in entry.stem.lower():
                files.append(entry)
        found: dict = {}
        for file in files:
            try:
                if file.stat().st_size > MAX_CS_BYTES:
                    continue
                text = file.read_text(encoding='utf-8-sig', errors='replace')
            except OSError:
                continue
            clean = CS_LINE_COMMENT.sub('', CS_BLOCK_COMMENT.sub('', text))
            ns_match = CS_NAMESPACE.search(clean)
            ns = ns_match.group(1) if ns_match else ''
            classes = list(CS_CLASS.finditer(clean))
            for match in CS_METHOD.finditer(clean):
                preceding = [c for c in classes if c.start() < match.start()]
                cls = preceding[-1].group(1) if preceding else file.stem
                name = f'{ns}.{cls}.{match.group(1)}' if ns else f'{cls}.{match.group(1)}'
                before = clean[max(0, match.start() - 300):match.start()]
                menus = list(CS_MENU.finditer(before))
                menu = menus[-1].group(1) if menus else ''
                item = found.setdefault(name, {
                    'name': name, 'menu': menu, 'file': str(file.relative_to(root)),
                    'line': clean.count('\n', 0, match.start()) + 1,
                })
                if menu and not item['menu']:
                    item['menu'] = menu
        # 第三方插件会贡献几百个 [MenuItem]，大半在 -batchmode 下只会「打开一个窗口」。
        # 用户的自有编辑器扩展（RegionTool / PlaneGenerator / B-ControlTools 等）优先置顶。
        window_methods = ('showwindow', 'openwindow', 'getwindow', 'createwindow', 'showpanel',
                          'openpanel', 'showinspector', 'showpopup', 'openeditor')
        plain_methods = {'show', 'open', 'install', 'uninstall', 'about', 'help', 'settings', 'wizard'}
        window_menus = ('/window', '/settings', '/preferences', '/about', '/help',
                        '/documentation', '/wizard', '/install', '/uninstall', 'window/', 'inspector')
        action_words = ('build', 'generate', 'export', 'bake', 'refresh', 'convert', 'import',
                        'process', 'run', 'execute', 'create', 'migrate', 'verify', 'check',
                        'update', 'scan', 'save', 'compile', 'clean', 'apply', 'fix', 'collect',
                        'analyze', 'detect', 'measure', 'mask', 'scatter')
        # 自有工具目录名：按工程实际命名调整；另有一条通用的 Assets/Editor 规则见 own()。
        own_hints = ('regiontool', 'planegenerator', 'controltools', 'regionscatter',
                     'artcanvas', 'masktool', 'b-controltools')

        def usable(item):
            short = item['name'].split('.')[-1].lower()
            menu = (item['menu'] or '').lower()
            if short in plain_methods or any(word in short for word in window_methods):
                return False
            if any(word in menu for word in window_menus):
                return False
            return any(word in f'{short} {menu}' for word in action_words)

        def own(item):
            # 不能用「Assets/Editor/**」当规则：这个项目把游戏业务脚本也堆在 Editor 下，
            # 会把上百个第三方/业务菜单误判成自有工具。只按工具目录名精确识别。
            path = (item['file'] or '').replace('\\', '/').lower()
            return any(hint in path for hint in own_hints)

        def label_of(item):
            parts = item['name'].split('.')
            cls = parts[-2] if len(parts) > 1 else ''
            menu = (item['menu'] or '').replace('\\', '/')
            tail = re.sub(r'[^\w\u4e00-\u9fff .·()\-+/]', '', menu.split('/')[-1]).strip() if menu else ''
            readable = sum(c.isalnum() or '\u4e00' <= c <= '\u9fff' for c in tail)
            base = tail if 3 <= readable <= 36 else re.sub(r'(?<!^)(?=[A-Z])', ' ', parts[-1]).strip()
            return f'{base} · {cls}'[:80] if cls else base[:80]

        methods = []
        for item in found.values():
            item['label'] = label_of(item)
            item['usable'] = usable(item)
            item['own'] = own(item)
            methods.append(item)
        # 你的工具 > 可执行批处理 > 菜单项 > 名称；前端默认只展示前 14 条 + 最近使用。
        methods.sort(key=lambda m: (0 if m['own'] else 1, 0 if m['usable'] else 1,
                                    0 if m['menu'] else 1, m['name'].lower()))
        result['total'] = len(methods)
        result['usable'] = sum(1 for m in methods if m['usable'])
        result['own'] = sum(1 for m in methods if m['own'])
        result['methods'] = methods[:600]
    except Exception as exc:
        result['error'] = str(exc)[:300]
    return result
