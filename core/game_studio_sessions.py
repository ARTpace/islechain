"""编程 Agent、跨 Agent 对话与不可变逐轮工程检查点。"""
import json
import os
import re
import shutil
import time
from pathlib import Path

from fastapi import HTTPException
from core.game_projects import atomic_write, digest, json_bytes, uid

AGENTS = ('codex', 'claude', 'opencode')


def executable(name, configured=''):
    if name not in AGENTS:
        raise HTTPException(422, '不支持的编程 Agent')
    if configured:
        path = Path(configured)
        if not path.is_absolute() or not path.is_file() or path.suffix.lower() in ('.cmd', '.ps1', '.bat'):
            raise HTTPException(422, '请选择实际可执行文件，不能使用 shell 包装脚本')
        return [str(path)]
    if name == 'codex':
        from core.game_native_runtime import node_tool
        return node_tool('codex')
    found = shutil.which(name)
    if found and Path(found).suffix.lower() not in ('.cmd', '.ps1', '.bat'):
        return [found]
    roots = list(map(Path,os.get_exec_path()))
    roots += [Path.home()/'.local/bin',Path.home()/'AppData/Roaming/npm']
    candidates = [Path.home()/'.local/bin'/f'{name}.exe']
    if name == 'claude':
        candidates += [root/'node_modules/@anthropic-ai/claude-code/bin/claude.exe' for root in roots]
    else:
        candidates += [root/f'node_modules/opencode-ai/node_modules/{package}/bin/opencode.exe'
                       for root in roots for package in ('opencode-windows-x64','opencode-windows-arm64')]
    for path in candidates:
        if path.is_file():
            return [str(path)]
    # Claude 的 npm 包提供 Node 入口；OpenCode 请使用原生可执行文件。
    if name == 'claude' and shutil.which('node'):
        for folder in roots:
            entry = folder / 'node_modules/@anthropic-ai/claude-code/cli.js'
            if entry.is_file():
                return [shutil.which('node'), str(entry)]
    raise HTTPException(409, f'未找到 {name}，请安装登录或配置可执行文件')


def command(agent, model='', thread=None, configured=''):
    args = executable(agent, configured)
    if agent == 'codex':
        args += ['exec', '--json', '--sandbox', 'workspace-write', '--skip-git-repo-check']
        if model:
            args += ['--model', model]
        if thread:
            args += ['resume', thread]
        return args + ['-']
    if agent == 'claude':
        args += ['-p', '--output-format', 'stream-json', '--verbose']
        if model:
            args += ['--model', model]
        if thread:
            args += ['--resume', thread]
        return args
    args += ['run', '--format', 'json']
    if model:
        args += ['--model', model]
    if thread:
        args += ['--session', thread]
    return args


def event_result(agent, event):
    """仅正式终结事件代表成功，进程退出不等于模型完成。"""
    kind = event.get('type')
    thread, status, answer = None, None, ''
    if agent == 'codex':
        if kind == 'thread.started':
            thread = event.get('thread_id')
        if kind in ('turn.completed', 'turn.failed', 'error'):
            status = 'completed' if kind == 'turn.completed' else 'failed'
        item = event.get('item', {})
        if kind == 'item.completed' and item.get('type') == 'agent_message':
            answer = item.get('text', '')
    elif agent == 'claude':
        thread = event.get('session_id')
        if kind == 'result':
            status = 'completed' if event.get('subtype') == 'success' and not event.get('is_error') else 'failed'
            answer = event.get('result', '')
    elif agent == 'opencode':
        thread = event.get('sessionID')
        part = event.get('part', {})
        if kind == 'text':
            answer = part.get('text', '')
        if kind == 'step_finish' and part.get('reason') == 'stop':
            status = 'completed'
        if kind == 'error':
            status = 'failed'
    if not isinstance(thread, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', thread):
        thread = None
    return thread, status, answer if isinstance(answer, str) else ''


def rounds(workspace, session):
    result = []
    for rid in session.get('rounds', []):
        path = workspace.path(f'native-rounds/{rid}/round.json')
        if path.is_file():
            result.append(json.loads(path.read_bytes()))
    return result


def begin_round(workspace, session, files, prompt, agent, model, run_id, target_plugin=''):
    if len(session.get('rounds', [])) >= 100:
        raise HTTPException(413, '对话达到100轮，请从历史分支继续')
    rid = uid('round')
    for name, raw in files.items():
        atomic_write(workspace.path(f'native-rounds/{rid}/before/{name}'), raw)
    record = dict(roundId=rid, runId=run_id, sessionId=session['sessionId'], agent=agent, model=model,
                  prompt=prompt, answer='', status='starting', createdAt=time.time(),
                  beforeManifest={name:digest(raw) for name,raw in files.items()},targetPlugin=target_plugin)
    atomic_write(workspace.path(f'native-rounds/{rid}/round.json'), json_bytes(record))
    session.setdefault('rounds', []).append(rid)
    return rid


def finish_round(workspace, run):
    if not run.get('roundId'):
        return
    path = workspace.path(f"native-rounds/{run['roundId']}/round.json")
    record = json.loads(path.read_bytes())
    record.update(status=run['status'], answer=run.get('answer', ''), finishedAt=time.time(),
                  message=run.get('message', ''))
    atomic_write(path, json_bytes(record))


def handoff(workspace, session):
    # ponytail: 有界、无额外模型调用的交接；原生会话只续接相同 Agent 的成功轮次。
    history = sorted(host_history(workspace) + rounds(workspace, session),key=lambda r:r.get('createdAt',0))[-12:]
    return '\n'.join(json.dumps({k:r.get(k) for k in ('agent','prompt','answer','status','targetPlugin')}, ensure_ascii=False)
                     for r in history)[-24000:]


def host_history(workspace):
    """宿主工程任务只交接结构化结果；不重放历史工具调用。"""
    result = []
    for path in sorted(workspace.path('code-candidates').glob('*.json'),key=lambda p:p.stat().st_mtime)[-12:]:
        item = json.loads(path.read_bytes())
        if not item.get('instruction'):
            continue
        result.append(dict(agent='宿主模型', prompt=item['instruction'], status=item['status'],createdAt=path.stat().st_mtime,
                           answer=json.dumps(dict(changedFiles=[c['path'] for c in item.get('changes',[])],
                                                  diagnostics=item.get('diagnostics',[])),ensure_ascii=False)[-4000:]))
    return result


def project_handoff(workspace):
    from core import game_native_runtime as native
    sid = native.settings(workspace).get('activeSessionId')
    return handoff(workspace,native.read_session(workspace,sid)) if sid else ''


def branch(workspace, session, round_id, restore=False):
    from core import game_native_runtime as native
    native.require_enabled(workspace)
    native.check_session(workspace, session)
    history = rounds(workspace, session)
    index = next((i for i,r in enumerate(history) if r['roundId'] == round_id), None)
    if index is None:
        raise HTTPException(404, '该轮不属于当前对话')
    record = history[index]
    if restore and record.get('targetPlugin'):
        raise HTTPException(409,'外部引擎工程请通过引擎或Git撤销；可以分支对话，但不会回退外部文件')
    files = native.sources(workspace.path(f'native-rounds/{round_id}/before'), skip=set())
    if workspace.manifest(files) != record['beforeManifest']:
        raise HTTPException(409, '检查点内容校验失败')
    if len(list(workspace.path('native-sessions').glob('*/session.json'))) >= 20:
        raise HTTPException(413, '本机工程会话达到20个')
    if restore:
        state, current = workspace.current()
        if current != files:
            if len(state['snapshots'])>98:
                raise HTTPException(413,'恢复点不足以安全撤销；保留当前项目')
            workspace.commit(state, current, '撤销前保护点')
            state = workspace.state()
            workspace.commit(state, files, '撤销至本轮开始前', restore=True)
    state, current = workspace.current()
    sid = uid('native')
    for name, raw in {**files, **native.project_context(workspace)}.items():
        atomic_write(workspace.path(f'native-sessions/{sid}/project/{name}'), raw)
    result = dict(sessionId=sid, workspaceRevision=state['revision'], workspaceEpoch=state['workspaceEpoch'],
                  projectRevision=workspace.project.revision, inputManifest=workspace.manifest(current),
                  createdAt=time.time(), parentSessionId=session['sessionId'], forkRoundId=round_id,
                  rounds=session.get('rounds', [])[:index], branchLabel=('撤销' if restore else '分支'),
                  targetPlugin=record.get('targetPlugin',''))
    atomic_write(native.session_path(workspace,sid), json_bytes(result))
    config = native.settings(workspace)
    config['activeSessionId'] = sid
    atomic_write(workspace.path('native-runtime.json'),json_bytes(config))
    return result
