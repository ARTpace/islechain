"""受控工程工具：只读当前快照，修改仅进入候选，不接受 shell 或文件系统工具调用。"""
import difflib
import json
from typing import Literal

from fastapi import HTTPException
from pydantic import Field

from core.game_multifile import source_path, MANIFEST
from core.game_project_models import Contract
from core.game_projects import digest
from core.game_web_builds import check_sources
from core.game_candidate_runtime import RegressionCase, GameInput

MAX_STEPS = 96


class WorkAction(Contract):
    action: Literal['search', 'read', 'edit', 'create', 'delete', 'move', 'check', 'playtest', 'game_use', 'inspect_asset', 'finish']
    operation: Literal['open', 'inspect', 'act', 'capture', 'close'] = 'inspect'
    actions: list[GameInput] = Field(default_factory=list, max_length=12)
    path: str = Field(default='', max_length=180)
    destination: str = Field(default='', max_length=180)
    content: str = Field(default='', max_length=204800)
    entry: bool = False
    tests: list[RegressionCase] = Field(default_factory=list, max_length=4)
    query: str = Field(default='', max_length=200)
    start: int = Field(default=1, ge=1, le=100000)
    limit: int = Field(default=100, ge=1, le=200)
    old: str = Field(default='', max_length=65536)
    new: str = Field(default='', max_length=65536)
    summary: str = Field(default='', max_length=2000)


def readable(name):
    if name in ('game-project.json', 'content/game-data.json', 'README.md'):
        return True
    try:
        source_path(name)
        return True
    except ValueError:
        return False


def working_files(files, candidate):
    staged = dict(files)
    for change in candidate['changes']:
        if change['content'] is None:
            staged.pop(change['path'], None)
        else:
            staged[change['path']] = change['content'].encode('utf-8')
    return staged


def save_changes(files, staged, candidate):
    names = sorted(set(files) | set(staged))
    changed = [name for name in names if files.get(name) != staged.get(name)]
    if len(changed) > 40:
        raise ValueError('候选超过40个变更路径，请拆分任务')
    if len(staged) > 500 or sum(map(len, staged.values())) > 40 * 1024 * 1024:
        raise ValueError('候选工程超过文件或容量限制')
    changes, diffs, truncated = [], {}, []
    for name in changed:
        before, after = files.get(name), staged.get(name)
        changes.append(dict(path=name, content=after.decode('utf-8') if after is not None else None,
            baseHash=digest(before) if before is not None else None,
            changeType='delete' if after is None else 'create' if before is None else 'edit'))
        diff = ''.join(difflib.unified_diff((before or b'').decode('utf-8').splitlines(keepends=True),
            (after or b'').decode('utf-8').splitlines(keepends=True), fromfile='before/' + name, tofile='after/' + name))
        diffs[name] = diff[:65536]
        if len(diff) > 65536:
            truncated.append(name)
    candidate.update(changes=changes, diffs=diffs, diffTruncated=truncated)
    candidate.pop('runtimeValidation', None)


def unused_destination(staged, destination):
    source_path(destination)
    target_parts = destination.split('/')
    for name in staged:
        parts = name.split('/')
        if name.casefold() == destination.casefold():
            raise ValueError('目标已存在或存在大小写冲突，不覆盖文件')
        shared = min(len(parts), len(target_parts))
        for count in range(1, shared):
            old_prefix, new_prefix = '/'.join(parts[:count]), '/'.join(target_parts[:count])
            if old_prefix.casefold() == new_prefix.casefold() and old_prefix != new_prefix:
                raise ValueError('目标目录与已有目录存在大小写冲突')
        if destination.casefold().startswith(name.casefold() + '/') or name.casefold().startswith(destination.casefold() + '/'):
            raise ValueError('目标文件与已有目录或文件路径冲突')


def update_loading(staged, action):
    if MANIFEST in staged:
        manifest = json.loads(staged[MANIFEST])
        scripts, styles, entry = manifest['scripts'][:], manifest['styles'][:], manifest['entry']
        for name in scripts + styles:
            source_path(name)
    else:
        scripts = ['game.js'] if 'game.js' in staged else []
        styles = ['style.css'] if 'style.css' in staged else []
        entry = scripts[-1] if scripts else ''
    # 清单只由服务端根据文件操作维护，模型不能任意写入路径。
    if action.action == 'move':
        scripts = [action.destination if p == action.path else p for p in scripts]
        styles = [action.destination if p == action.path else p for p in styles]
        if entry == action.path:
            entry = action.destination
    elif action.action == 'delete':
        scripts = [p for p in scripts if p != action.path]
        styles = [p for p in styles if p != action.path]
        if entry == action.path:
            entry = scripts[-1] if scripts else ''
    elif action.action == 'create':
        if action.path.endswith('.css'):
            styles.append(action.path)
        elif action.entry or not entry:
            scripts.append(action.path)
            entry = action.path
        else:
            scripts.insert(len(scripts) - 1, action.path)
    staged[MANIFEST] = json.dumps(dict(schemaVersion=1, runtime='native-canvas-multifile-v1',
        entry=entry, scripts=scripts, styles=styles), ensure_ascii=False, indent=2).encode()


def check_candidate(files, candidate):
    staged = working_files(files, candidate)
    try:
        scripts, styles, _, _ = check_sources(staged)
        return dict(passed=True, scripts=scripts, styles=styles,
            note='仅清单和 JavaScript 语法检查；未运行游戏，不代表玩法正确')
    except HTTPException as exc:
        return dict(passed=False, diagnostic=exc.detail)


def run_action(action, files, candidate):
    staged = working_files(files, candidate)
    observations = candidate.setdefault('observations', [])
    if action.action == 'search':
        if not action.query.strip():
            raise ValueError('搜索词不能为空')
        matches = []
        truncated = False
        for name, raw in sorted(staged.items()):
            if not readable(name):
                continue
            for number, line in enumerate(raw.decode('utf-8').splitlines(), 1):
                if action.query.casefold() in line.casefold() or action.query.casefold() in name.casefold():
                    if len(matches) == 40:
                        truncated = True
                        break
                    matches.append(dict(path=name, line=number, text=line[:300]))
            if truncated:
                break
        return dict(matches=matches, truncated=truncated)
    if action.action == 'read':
        if not readable(action.path) or action.path not in staged:
            raise ValueError('只能读取工程中已有的 JS/CSS、清单、运行数据和 README')
        lines = staged[action.path].decode('utf-8').splitlines(keepends=True)
        content = ''.join(lines[action.start - 1:action.start - 1 + action.limit])
        if len(content.encode()) > 16384:
            raise ValueError('读取片段超过 16 KiB，请减小行范围')
        candidate.setdefault('readHashes', {})[action.path] = digest(staged[action.path])
        return dict(path=action.path, start=action.start, content=content, totalLines=len(lines))
    if action.action == 'edit':
        source_path(action.path)
        if action.path not in staged:
            raise ValueError('文件不存在，请先创建或读取正确路径')
        if not action.old or not any(o.get('action') == 'read' and o.get('path') == action.path
                and action.old in o.get('content', '') for o in observations):
            raise ValueError('修改前必须读取包含 old 原文的片段；旧片段失效后须重新读取')
        text = staged[action.path].decode('utf-8')
        if text.count(action.old) != 1:
            raise ValueError('old 必须在当前文件中精确匹配一次，请重新读取并扩大定位片段')
        replacement = text.replace(action.old, action.new, 1)
        if len(replacement.encode()) > 200 * 1024:
            raise ValueError('修改后的单个模块超过 200 KiB')
        staged[action.path] = replacement.encode('utf-8')
        save_changes(files, staged, candidate)
        # ponytail: 编辑后使该文件读取凭据失效，避免继续使用旧片段。
        candidate['observations'] = [o for o in observations if o.get('path') != action.path]
        return dict(path=action.path, changed=replacement != text)
    if action.action in ('create', 'delete', 'move'):
        source_path(action.path)
        if action.action == 'create':
            unused_destination(staged, action.path)
            if len(action.content.encode()) > 200 * 1024:
                raise ValueError('新文件超过200 KiB')
        else:
            if action.path not in staged:
                raise ValueError('源文件不存在')
            if candidate.get('readHashes', {}).get(action.path) != digest(staged[action.path]):
                raise ValueError('删除或移动前必须读取当前源文件')
        if action.action == 'move':
            source_path(action.destination)
            if action.path.rsplit('.', 1)[-1] != action.destination.rsplit('.', 1)[-1]:
                raise ValueError('移动不能改变文件类型')
            unused_destination(staged, action.destination)
        update_loading(staged, action)
        if action.action == 'create':
            staged[action.path] = action.content.encode()
        elif action.action == 'delete':
            staged.pop(action.path)
        else:
            staged[action.destination] = staged.pop(action.path)
        save_changes(files, staged, candidate)
        candidate['observations'] = [o for o in observations if o.get('path') not in (action.path, action.destination)]
        candidate.setdefault('fileOperations', []).append(dict(action=action.action, path=action.path, destination=action.destination))
        return dict(path=action.path, destination=action.destination, changed=True)
    if action.action in ('check', 'finish'):
        result = check_candidate(files, candidate)
        candidate['validation'] = result
        if not result['passed']:
            candidate['failedChecks'] = candidate.get('failedChecks', 0) + 1
            if candidate['failedChecks'] >= 3:
                candidate['status'] = 'failed'
                candidate['diagnostics'] = ['累计三次检查失败，已停止；候选保留，请调整任务后重新开始']
        elif action.action == 'finish':
            candidate['summary'] = action.summary
            if not candidate['changes']:
                candidate['status'] = 'unchanged'
            else:
                result['needsRuntime'] = True
        return result
    raise ValueError('不支持的工具')
