"""新增/删除/移动进入同一快照；真实 headed 浏览器验证运行故障→修复→原用例重放。"""
import json
import os

import pytest

from core.game_code_tools import WorkAction, run_action, working_files
from core.game_candidate_runtime import RegressionCase
from test_game_workspace import env
from test_game_code_maintenance import setup, start, step, ROOT, routes


@pytest.mark.parametrize('tampered', [False, True])
def test_actual_screenshot_is_sent_to_next_model_step(env, monkeypatch, tampered):
    import io
    from PIL import Image
    from core.game_projects import atomic_write, digest
    state, calls = setup(env, monkeypatch, [dict(action='playtest'), dict(action='finish', summary='已观察')])
    buffer = io.BytesIO()
    Image.new('RGB', (32, 32), (20, 40, 60)).save(buffer, format='PNG')
    raw = buffer.getvalue()
    relative = 'runs/preview_vision/evidence/capture_vision.png'
    atomic_write(env[1].path(relative), raw)
    async def runtime(workspace, project, staged, candidate):
        return dict(passed=True, available=True, runId='vision',
            snapshotHash=routes.runtime_identity(workspace, project, staged, candidate['regressionCases']),
            cases=[dict(name='画布', passed=True, screenshot=dict(relativePath=relative, buildId='vision',
                workspaceEpoch=workspace.state()['workspaceEpoch'], hash=digest(raw)))])
    monkeypatch.setattr(routes, 'run_regression', runtime)
    candidate = step(env, start(env, state).json(), 0)
    if tampered:
        env[1].path(relative).write_bytes(b'corrupted')
    candidate = step(env, candidate, 1)
    if tampered:
        assert candidate['status'] == 'failed' and len(calls) == 1
        assert '截图校验失败' in candidate['diagnostics'][0]
    else:
        assert calls[-1]['visionImages'][0].startswith('data:image/jpeg;base64,')
        assert 'visualObservation' in calls[-1]
        assert 'visionImages' not in json.dumps(candidate)


def test_agent_plays_observes_images_and_closes_only_own_session(env, monkeypatch):
    import io
    from types import SimpleNamespace
    from PIL import Image
    from core import game_candidate_runtime as runtime
    from core.game_projects import atomic_write, digest
    buffer = io.BytesIO()
    Image.new('RGB', (32, 32)).save(buffer, format='PNG')
    raw = buffer.getvalue()
    live, closed, inputs = {}, [], []
    async def open_game(workspace, build_id, page):
        sid = 'owned_' + str(len(closed))
        live[sid] = SimpleNamespace(sessionId=sid, buildId=build_id, workspace=workspace)
        return dict(sessionId=sid)
    def get(sid, workspace, **kwargs):
        return live[sid]
    async def inspect(session):
        return dict(sessionId=session.sessionId, text='游戏已启动', capabilities=['keyboard','screenshot'])
    async def capture(session):
        relative = f'runs/{session.sessionId}/evidence/capture_view.png'
        atomic_write(session.workspace.path(relative), raw)
        return dict(relativePath=relative, hash=digest(raw), buildId=session.buildId,
                    workspaceEpoch=session.workspace.state()['workspaceEpoch'])
    async def act(session, actions):
        inputs.extend(actions)
    async def close(session):
        closed.append(session.sessionId)
        live.pop(session.sessionId)
    monkeypatch.setattr(runtime, 'runtime_sessions', SimpleNamespace(
        open=open_game, get=get, inspect=inspect, capture=capture, act=act, close=close))
    monkeypatch.setattr(runtime, 'candidate_page', lambda *args: b'fixture')
    actions = [dict(action='game_use', operation='open'),
        dict(action='game_use', operation='act', actions=[dict(type='press',key='ArrowRight')]),
        dict(action='read',path='game.js'), dict(action='edit',path='game.js',old='count:0',new='count:1'),
        dict(action='game_use',operation='act',actions=[dict(type='press',key='ArrowRight')]),
        dict(action='game_use',operation='open'), dict(action='finish',summary='完成')]
    state, calls = setup(env, monkeypatch, actions)
    candidate = start(env, state).json()
    for index in range(7):
        candidate = step(env, candidate, index)
        if index == 1:
            assert calls[-1]['visionImages'][0].startswith('data:image/jpeg;base64,')
        if index == 4:
            assert '源码已变化' in candidate['observations'][-1]['error']
    assert candidate['status'] == 'ready'
    assert len(inputs) == 1, '修改后的旧会话不能再接受输入'
    assert len(closed) == 2 and not live
    assert 'agentSession' not in candidate and 'base64' not in json.dumps(candidate)


def test_file_operations_keep_order_and_atomic_adoption(env,monkeypatch):
    actions=[dict(action='create',path='src/state.js',content='window.Game={count:1};'),
        dict(action='read',path='game.js'),dict(action='move',path='game.js',destination='src/main.js'),
        dict(action='create',path='unused.js',content='// unused'),dict(action='read',path='unused.js'),
        dict(action='delete',path='unused.js'),dict(action='read',path='style.css'),
        dict(action='delete',path='style.css'),dict(action='create',path='src/style.css',content='canvas{color:red}'),
        dict(action='finish')]
    state,_=setup(env,monkeypatch,actions)
    c=start(env,state).json()
    for n in range(len(actions)): c=step(env,c,n)
    assert c['status']=='ready',c
    changes={x['path']:x for x in c['changes']}
    assert changes['game.js']['content'] is None and changes['style.css']['content'] is None
    assert 'unused.js' not in changes
    manifest=json.loads(changes['game-project.json']['content'])
    assert manifest['scripts']==['src/state.js','src/main.js'] and manifest['entry']=='src/main.js'
    assert manifest['styles']==['src/style.css']
    assert env[1].read('game.js')['content']=='window.Game={count:0};'
    adopted=env[0].post(ROOT+'/'+c['candidateId']+'/apply?token=alice',json={'baseRevision':state['revision']})
    assert adopted.status_code==200,adopted.text
    _,files=env[1].current()
    assert 'game.js' not in files and 'style.css' not in files
    assert files['src/main.js']==b'window.Game={count:0};'


@pytest.mark.parametrize('action', [
    dict(action='create',path='Game.js',content='bad'),
    dict(action='create',path='../escape.js',content='bad'),
    dict(action='create',path='CON.js',content='bad'),
    dict(action='create',path='Content/new.js',content='bad'),
    dict(action='delete',path='content/game-data.json'),
    dict(action='delete',path='game.js'),
    dict(action='move',path='game.js',destination='style.css'),
])
def test_unsafe_operations_leave_candidate_and_active_source_unchanged(env,monkeypatch,action):
    state,_=setup(env,monkeypatch,[action])
    c=step(env,start(env,state).json(),0)
    assert c['changes']==[] and c['observations'][-1].get('error')
    assert env[1].read('game.js')['content']=='window.Game={count:0};'


def test_moving_entry_to_occupied_path_and_late_edit_cannot_overwrite(env,monkeypatch):
    actions=[dict(action='read',path='game.js'),dict(action='move',path='game.js',destination='style.css')]
    state,_=setup(env,monkeypatch,actions)
    c=start(env,state).json()
    c=step(env,c,0);c=step(env,c,1)
    assert c['changes']==[] and c['observations'][-1].get('error')


def test_cannot_weaken_suite_or_adopt_unverified_snapshot(env,monkeypatch):
    actions=[dict(action='read',path='game.js'),dict(action='edit',path='game.js',old='count:0',new='count:1'),
        dict(action='playtest',tests=[dict(name='weaker',assertions=[dict(kind='visible',selector='body')])]),dict(action='finish')]
    state,_=setup(env,monkeypatch,actions)
    c=start(env,state).json()
    for n in range(3): c=step(env,c,n)
    assert c['observations'][-1].get('error')
    assert c['regressionCases'][0]['name']=='画布可见'
    c=step(env,c,3)
    assert c['status']=='ready'
    # Simulate an accidentally stale persisted runtime receipt: apply must independently reject it.
    path=routes.path_for(env[1],c['candidateId'])
    c['changes'][0]['content']='window.Game={count:99};'
    path.write_text(json.dumps(c),encoding='utf-8')
    assert env[0].post(ROOT+'/'+c['candidateId']+'/apply?token=alice',json={'baseRevision':state['revision']}).status_code==409


def test_runtime_failure_evidence_reaches_next_model_step(env,monkeypatch):
    actions=[dict(action='playtest'),dict(action='read',path='game.js')]
    state,calls=setup(env,monkeypatch,actions)
    async def runtime(workspace,project,staged,candidate):
        return dict(passed=False,available=True,snapshotHash=routes.runtime_identity(workspace,project,staged,candidate['regressionCases']),
            cases=[dict(name='restart',passed=False,log=[dict(kind='pageerror',message='missingCounter is not defined')])])
    monkeypatch.setattr(routes,'run_regression',runtime)
    c=start(env,state).json();c=step(env,c,0);c=step(env,c,1)
    assert 'missingCounter' in json.dumps(calls[-1]['observations'])
    assert c['runtimeFailures']==1 and c['status']=='working'


def test_missing_runtime_environment_does_not_claim_pass(env,monkeypatch):
    state,_=setup(env,monkeypatch,[dict(action='playtest')])
    async def unavailable(*args): return dict(passed=False,available=False,diagnostic='Chromium 未安装')
    monkeypatch.setattr(routes,'run_regression',unavailable)
    c=step(env,start(env,state).json(),0)
    assert c['status']=='failed' and not c['runtimeValidation']['passed']
    assert c['diagnostics']==['Chromium 未安装']


@pytest.mark.skipif(os.environ.get('ART_GAME_BROWSER_TEST') != '1',reason='显式开启真实 headed 浏览器回归')
def test_real_runtime_error_fix_create_move_delete_and_regression_replay(env,monkeypatch):
    from core.game_candidate_runtime import run_regression
    broken="(()=>{const h=document.querySelector('#hud');h.textContent='count 0';document.querySelector('#restart').onclick=()=>{h.textContent='count '+missingCounter;};})();"
    actions=[dict(action='read',path='game.js'),dict(action='playtest'),
        dict(action='create',path='src/state.js',content='window.Game={count:1};'),
        dict(action='edit',path='game.js',old='missingCounter',new='window.Game.count'),
        dict(action='read',path='game.js'),dict(action='move',path='game.js',destination='src/main.js'),
        dict(action='create',path='unused.js',content='// unused'),dict(action='read',path='unused.js'),
        dict(action='delete',path='unused.js'),dict(action='finish',summary='修复重开并拆分模块')]
    state,_=setup(env,monkeypatch,actions,broken)
    monkeypatch.setattr(routes,'run_regression',run_regression)
    suite=[dict(name='重开显示正确计数',actions=[dict(type='click',selector='#restart')],
        assertions=[dict(kind='contains',selector='#hud',text='count 1')])]
    response=env[0].post(ROOT+'/maintenance?token=alice',json=dict(baseRevision=state['revision'],requestId='real1',
        instruction='修复重开错误并拆分状态模块',regressionCases=suite))
    c=response.json()
    for n in range(len(actions)):
        c=step(env,c,n)
        if n==1:
            assert not c['runtimeValidation']['passed'],c
            assert 'missingCounter' in json.dumps(c['runtimeValidation'])
            assert c['runtimeValidation']['cases'][0]['screenshot']
    assert c['status']=='ready',c
    assert c['runtimeValidation']['passed'] and len(c['runtimeReports'])==2
    assert c['runtimeReports'][0]['tests']==c['runtimeReports'][1]['tests']
    assert env[1].read('game.js')['content']==broken
    applied=env[0].post(ROOT+'/'+c['candidateId']+'/apply?token=alice',json={'baseRevision':state['revision']})
    assert applied.status_code==200,applied.text
    assert 'game.js' not in env[1].current()[1] and env[1].read('src/state.js')['content']


def test_runtime_failures_stop_and_changed_bytes_invalidate_previous_pass(env,monkeypatch):
    actions=[dict(action='playtest')]*3
    state,_=setup(env,monkeypatch,actions)
    async def failed(*args): return dict(passed=False,available=True,diagnostic='断言未通过')
    monkeypatch.setattr(routes,'run_regression',failed)
    c=start(env,state).json()
    for n in range(3): c=step(env,c,n)
    assert c['status']=='failed' and c['runtimeFailures']==3
    assert env[0].post(ROOT+'/'+c['candidateId']+'/work?token=alice',json={'step':3}).status_code==409


def test_edit_after_runtime_pass_requires_replay(env,monkeypatch):
    actions=[dict(action='playtest'),dict(action='read',path='game.js'),
        dict(action='edit',path='game.js',old='count:0',new='count:2'),dict(action='finish')]
    state,_=setup(env,monkeypatch,actions)
    c=start(env,state).json(); c=step(env,c,0)
    assert c['runtimeValidation']['passed']
    c=step(env,c,1);c=step(env,c,2)
    assert 'runtimeValidation' not in c
    c=step(env,c,3)
    assert c['status']=='ready' and len(c['runtimeReports'])==2
    assert c['runtimeReports'][0]['snapshotHash']!=c['runtimeReports'][1]['snapshotHash']
