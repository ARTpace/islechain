import importlib
import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest

from test_game_workspace import env, create

routes = importlib.import_module('routers.game_code_candidates')


def prepare(env, monkeypatch, output=None, finish_reason='stop'):
    state = create(env)
    env[0].app.include_router(routes.router)
    calls = []
    output = output or {'changes': [{'path': 'README.md', 'content': '候选正文'}]}
    class Client:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        @asynccontextmanager
        async def stream(self, *args, **kwargs):
            calls.append(kwargs['json'])
            yield httpx.Response(200, json={'choices': [{'finish_reason': finish_reason, 'message': {'content': output if isinstance(output, str) else json.dumps(output)}}]})
    monkeypatch.setattr(routes.httpx, 'AsyncClient', Client)
    monkeypatch.setattr(routes.projects, 'main', lambda: SimpleNamespace(
        resolve_chat_provider=lambda *args: ('https://mock.invalid/v1', {}, 'mock'),
        text_from_chat_response=lambda raw: raw['choices'][0]['message']['content']))
    return state, calls


def generate(env, state, **changes):
    raw = dict(baseRevision=state['revision'], requestId='request1', instruction='修改正文', paths=['README.md'])
    raw.update(changes)
    return env[0].post('/api/game-projects/p1/code-candidates?token=alice', json=raw)


@pytest.mark.parametrize('output,finish,expected', [
    ('not json', 'stop', '不是完整有效的 JSON'),
    ({'other': 'invalid'}, 'stop', '需要 changes 数组'),
    ({'changes': [{'path': 'README.md', 'content': 'partial'}]}, 'length', '长度上限'),
])
def test_failure_has_specific_safe_diagnostic(env, monkeypatch, output, finish, expected):
    state, _ = prepare(env, monkeypatch, output, finish)
    candidate = generate(env, state).json()
    assert candidate['status'] == 'failed'
    assert expected in candidate['diagnostics'][0]
    assert candidate['changes'] == []


def test_json_code_fence_is_accepted(env, monkeypatch):
    state, _ = prepare(env, monkeypatch, '```json\n' + json.dumps({'changes': [{'path': 'README.md', 'content': '候选'}]}) + '\n```')
    assert generate(env, state).json()['status'] == 'ready'


def test_candidate_is_explicit_and_idempotent_then_apply(env, monkeypatch):
    state, calls = prepare(env, monkeypatch)
    response = generate(env, state)
    assert response.status_code == 200, response.text
    candidate = response.json()
    assert candidate['status'] == 'ready'
    assert generate(env, state).json()['candidateId'] == candidate['candidateId']
    assert len(calls) == 1
    assert env[1].read('README.md')['content'] != '候选正文'
    endpoint = f"/api/game-projects/p1/code-candidates/{candidate['candidateId']}/apply?token=alice"
    result = env[0].post(endpoint, json={'baseRevision': state['revision']})
    assert result.status_code == 200, result.text
    assert env[1].read('README.md')['content'] == '候选正文'
    assert env[0].post(endpoint, json={'baseRevision': result.json()['revision']}).status_code == 409


def test_hand_edit_is_not_overwritten(env, monkeypatch):
    state, _ = prepare(env, monkeypatch)
    candidate = generate(env, state).json()
    (env[1].root / state['active'] / 'README.md').write_text('手工改动', encoding='utf-8')
    response = env[0].post(f"/api/game-projects/p1/code-candidates/{candidate['candidateId']}/apply?token=alice",
                           json={'baseRevision': state['revision']})
    assert response.status_code == 409
    assert env[1].read('README.md')['content'] == '手工改动'


@pytest.mark.parametrize('output', [dict(changes=[dict(path='../secret', content='bad')]),
    dict(changes=[dict(path='README.md', content='a'), dict(path='README.md', content='b')]), dict(other='invalid')])
def test_invalid_output_stays_failed_without_write(env, monkeypatch, output):
    state, _ = prepare(env, monkeypatch, output)
    before = env[1].read('README.md')['hash']
    response = generate(env, state)
    assert response.json()['status'] == 'failed'
    assert env[1].read('README.md')['hash'] == before


def test_owner_and_idempotency_payload_conflict(env, monkeypatch):
    state, calls = prepare(env, monkeypatch)
    candidate = generate(env, state).json()
    assert generate(env, state, instruction='不同请求').status_code == 409
    assert env[0].get(f"/api/game-projects/p1/code-candidates/{candidate['candidateId']}?token=bob").status_code == 403
    assert len(calls) == 1

PLAN = dict(summary='模块游戏', entry='src/main.js', files=[
    dict(path='style.css', purpose='样式', interface='页面样式', dependsOn=[]),
    dict(path='src/state.js', purpose='状态', interface='window.Game.count', dependsOn=[]),
    dict(path='src/main.js', purpose='入口', interface='更新 HUD', dependsOn=['src/state.js'])])


def test_multifile_plan_resume_apply_and_conflict(env, monkeypatch):
    state, calls = prepare(env, monkeypatch, PLAN)
    responses = [PLAN, {'changes':[{'path':'style.css','content':'canvas{background:#123}'}]},
        'not json', {'changes':[{'path':'src/state.js','content':'window.Game={count:1};'}]},
        {'changes':[{'path':'src/main.js','content':'document.querySelector("#hud").textContent=Game.count;'}]}]
    original = routes.engineering_model
    async def model(candidate, system, data):
        # Use the real streaming/JSON decoder with a changing mock output.
        return await original(candidate, system, data)
    from contextlib import asynccontextmanager
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        @asynccontextmanager
        async def stream(self, *args, **kwargs):
            calls.append(kwargs['json'])
            output = responses.pop(0)
            yield httpx.Response(200,json={'choices':[{'message':{'content':output if isinstance(output,str) else json.dumps(output)}}]})
    monkeypatch.setattr(routes.httpx, 'AsyncClient', Client)
    root='/api/game-projects/p1/code-candidates'
    body=dict(baseRevision=state['revision'],requestId='plan1',instruction='生成游戏')
    c=env[0].post(root+'/engineering-plan?token=alice',json=body).json()
    assert c['status']=='planned', c
    assert env[0].post(root+'/engineering-plan?token=alice',json=body).json()['candidateId']==c['candidateId']
    endpoint=root+'/'+c['candidateId']
    def step(n):
        result=env[0].post(endpoint+'/next?token=alice',json={'completed':n})
        assert result.status_code==200,result.text
        return result.json()
    assert step(0)['completedFiles']==1
    before=len(calls)
    assert step(0)['completedFiles']==1
    assert len(calls)==before, '重发已完成步骤不能再次计费'
    assert step(1)['status']=='failed'
    assert step(1)['completedFiles']==2
    c=step(2)
    assert c['status']=='working' and c['kind']=='maintenance' and len(c['changes'])==4
    data=json.loads(calls[-1]['messages'][1]['content'])
    assert data['dependencies']=={'src/state.js':'window.Game={count:1};'}
    assert not (env[1].root/state['active']/'src/main.js').exists()
    assert env[0].post(endpoint+'/apply?token=alice',json={'baseRevision':state['revision']}).status_code==409
    async def runtime(workspace, project, staged, candidate):
        return dict(passed=True,available=True,snapshotHash=routes.runtime_identity(workspace,project,staged,candidate['regressionCases']))
    async def finish(candidate, system, data):
        return (dict(action='playtest',tests=[dict(name='HUD loaded',assertions=[dict(kind='contains',selector='#hud',text='1')])]) if candidate['stepCount']==0 else dict(action='finish')), {}
    monkeypatch.setattr(routes,'run_regression',runtime)
    monkeypatch.setattr(routes,'engineering_model',finish)
    finished=env[0].post(endpoint+'/work?token=alice',json={'step':0})
    assert finished.json()['status']=='working',finished.text
    finished=env[0].post(endpoint+'/work?token=alice',json={'step':1})
    assert finished.json()['status']=='ready',finished.text
    result=env[0].post(endpoint+'/apply?token=alice',json={'baseRevision':state['revision']})
    assert result.status_code==200,result.text
    assert env[1].read('game-project.json')['content']
    from test_game_workspace import call
    built=call(env,'POST','/builds',dict(baseRevision=result.json()['revision']))
    assert built.status_code==200,built.text
    assert built.json()['scriptFiles']==['src/state.js','src/main.js']
    assert env[0].post(endpoint+'/apply?token=alice',json={'baseRevision':result.json()['revision']}).status_code==409


@pytest.mark.parametrize('mutate', [
    lambda p: p['files'][2].update(path='../bad.js'),
    lambda p: p['files'][2].update(dependsOn=['missing.js']),
    lambda p: p['files'][1].update(path='style.css'),
])
def test_bad_engineering_plan_does_not_write(env, monkeypatch, mutate):
    plan=json.loads(json.dumps(PLAN)); mutate(plan)
    state,_=prepare(env,monkeypatch,plan)
    result=env[0].post('/api/game-projects/p1/code-candidates/engineering-plan?token=alice',json=dict(
        baseRevision=state['revision'],requestId='badplan',instruction='生成'))
    assert result.json()['status']=='failed', result.text
    assert result.json()['changes']==[]


def test_engineering_step_refuses_changed_source(env,monkeypatch):
    state,calls=prepare(env,monkeypatch,PLAN)
    root='/api/game-projects/p1/code-candidates'
    c=env[0].post(root+'/engineering-plan?token=alice',json=dict(baseRevision=state['revision'],requestId='staleplan',instruction='生成')).json()
    (env[1].root/state['active']/'README.md').write_text('手动编辑',encoding='utf-8')
    result=env[0].post(root+'/'+c['candidateId']+'/next?token=alice',json={'completed':0})
    assert result.status_code==409
    assert len(calls)==1


def test_engineering_lease_blocks_duplicate_and_late_result_is_stale(env,monkeypatch):
    state,_=prepare(env,monkeypatch,PLAN)
    root='/api/game-projects/p1/code-candidates'
    c=env[0].post(root+'/engineering-plan?token=alice',json=dict(baseRevision=state['revision'],requestId='leaseplan',instruction='生成')).json()
    endpoint=root+'/'+c['candidateId']+'/next?token=alice'
    path=routes.path_for(env[1],c['candidateId'])
    saved=json.loads(path.read_bytes()); saved.update(status='generating',leaseUntil=routes.time.time()+180)
    path.write_text(json.dumps(saved),encoding='utf-8')
    assert env[0].post(endpoint,json={'completed':0}).status_code==409
    saved['leaseUntil']=0;path.write_text(json.dumps(saved),encoding='utf-8')
    async def late(*args):
        (env[1].root/state['active']/'README.md').write_text('调用期间外部修改',encoding='utf-8')
        return {'changes':[{'path':'style.css','content':'body{}'}]},{}
    monkeypatch.setattr(routes,'engineering_model',late)
    response=env[0].post(endpoint,json={'completed':0})
    assert response.json()['status']=='stale',response.text
    assert response.json()['completedFiles']==1
    assert env[0].post(root+'/'+c['candidateId']+'/apply?token=alice',json={'baseRevision':state['revision']}).status_code==409
