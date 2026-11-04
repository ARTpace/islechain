"""真实维护路由：按需上下文、精确编辑、诊断闭环、并发和计费边界。"""
import json

import pytest

from test_game_workspace import env, call
from test_game_code_candidates import prepare, routes

ROOT = '/api/game-projects/p1/code-candidates'


def test_imported_image_inspection_and_asset_change_invalidates_candidate(env,monkeypatch):
    import io
    from PIL import Image
    from test_game_media_assets import upload
    state,calls=setup(env,monkeypatch,[])
    image=io.BytesIO();Image.new('RGB',(8,8),(10,20,30)).save(image,format='PNG')
    asset=upload(env,'hero.png',image.getvalue()).json()['project']['mediaAssets'][0]
    actions=[dict(action='inspect_asset',path=asset['id']),dict(action='finish',summary='无需修改')]
    async def model(candidate,system,data):
        calls.append(data);return actions.pop(0),{}
    monkeypatch.setattr(routes,'engineering_model',model)
    c=start(env,state).json();c=step(env,c,0)
    assert c['observations'][-1]['imageAssetId']==asset['id']
    assert calls[0]['assets'][0]['kind']=='image' and 'visionImages' not in calls[0]
    c=step(env,c,1)
    assert calls[1]['visionImages'][0].startswith('data:image/jpeg;base64,')
    fresh=start(env,state,request_id='asset-change').json()
    replaced=upload(env,'hero.png',image.getvalue(),asset['id']);assert replaced.status_code==200
    rejected=env[0].post(ROOT+'/'+fresh['candidateId']+'/work?token=alice',json={'step':0})
    assert rejected.status_code==409,'替换素材使旧候选输入失效'


@pytest.mark.parametrize('body', [
    '{"action":"search","query":"Game"}\n<result>{"matches":["fake"]}</result>',
    '{"action":"read","path":"game.js"}\n{"action":"delete","path":"game.js"}',
])
def test_model_only_accepts_first_action_not_simulated_results(env, monkeypatch, body):
    import asyncio
    _, calls = prepare(env, monkeypatch, body)
    raw, _ = asyncio.run(routes.engineering_model({'kind':'maintenance','provider':'mock','model':'mock'}, 'JSON', {}))
    assert raw == json.JSONDecoder().raw_decode(body)[0]
    assert 'matches' not in raw
    assert calls[0]['response_format'] == {'type':'json_object'}


@pytest.mark.parametrize('body', ['{"action":"edit","new":"broken', '<invoke>search</invoke>', 'Explanation {"action":"finish"}'])
def test_model_does_not_repair_or_scan_invalid_action(env, monkeypatch, body):
    import asyncio
    prepare(env, monkeypatch, body)
    with pytest.raises((json.JSONDecodeError, routes.EngineeringResponseError)):
        asyncio.run(routes.engineering_model({'kind':'maintenance','provider':'mock','model':'mock'}, 'JSON', {}))


@pytest.mark.parametrize('failure,expected', [
    (routes.EngineeringResponseError('模型渠道 HTTP 502'), 'HTTP 502'),
    (json.JSONDecodeError('secret.invalid hidden', '', 0), 'JSON'),
])
def test_channel_failure_is_persistent_specific_and_safe(env, monkeypatch, failure, expected):
    state, calls = setup(env, monkeypatch, [])
    async def fail(*args):
        raise failure
    monkeypatch.setattr(routes, 'engineering_model', fail)
    c = step(env, start(env, state).json(), 0)
    assert c['status'] == 'failed' and c['stepCount'] == 0
    assert expected in c['diagnostics'][0]
    saved = env[0].get(ROOT+'/'+c['candidateId']+'?token=alice').json()
    assert saved['diagnostics'] == c['diagnostics']
    assert 'hidden' not in json.dumps(saved) and 'secret.invalid' not in json.dumps(saved)
    assert not calls and env[1].read('game.js')['content'] == 'window.Game={count:0};'


def setup(env, monkeypatch, actions, script='window.Game={count:0};'):
    state, _ = prepare(env, monkeypatch)
    state = env[1].patch(state['revision'], [dict(path='game.js', content=script, baseHash=None),
        dict(path='style.css', content='canvas{}', baseHash=None)], True)
    calls = []
    async def model(candidate, system, data):
        calls.append(data)
        output = actions.pop(0)
        if callable(output):
            output = output(candidate, data)
        return output, {'prompt_tokens': 10, 'completion_tokens': 5}
    monkeypatch.setattr(routes, 'engineering_model', model)
    async def runtime(workspace, project, staged, candidate):
        return dict(passed=True, available=True, snapshotHash=routes.runtime_identity(workspace, project, staged, candidate['regressionCases']),
            cases=[dict(name='mocked behavior',passed=True)], tests=candidate['regressionCases'])
    monkeypatch.setattr(routes, 'run_regression', runtime)
    return state, calls


def start(env, state, mode='edit', request_id='maintain1'):
    return env[0].post(ROOT+'/maintenance?token=alice', json=dict(baseRevision=state['revision'],
        requestId=request_id,instruction='只修改计数',mode=mode,regressionCases=[dict(name='画布可见',assertions=[dict(kind='visible',selector='canvas')])]))


def step(env, candidate, n):
    response=env[0].post(ROOT+'/'+candidate['candidateId']+'/work?token=alice',json={'step':n})
    assert response.status_code==200,response.text
    return response.json()


def test_search_read_exact_edit_check_then_apply(env,monkeypatch):
    original='// preserve user code\nwindow.Game={count:0};\n'
    actions=[dict(action='search',query='count'),dict(action='read',path='game.js',start=2,limit=1),
        dict(action='edit',path='game.js',old='count:0',new='count:3'),
        dict(action='finish',summary='计数初始值改为3，其他保持')]
    state,calls=setup(env,monkeypatch,actions,original)
    candidate=start(env,state).json()
    assert start(env,state).json()['candidateId']==candidate['candidateId']
    assert not calls
    candidate=step(env,candidate,0)
    assert candidate['observations'][-1]['matches'][0]['path']=='game.js'
    assert original not in json.dumps(calls[0])
    candidate=step(env,candidate,1)
    assert candidate['observations'][-1]['content']=='window.Game={count:0};\n'
    candidate=step(env,candidate,2)
    assert env[1].read('game.js')['content']==original
    assert step(env,candidate,2)['stepCount']==3 and len(calls)==3
    candidate=step(env,candidate,3)
    assert candidate['status']=='ready' and candidate['validation']['passed']
    assert candidate['changes'][0]['content']=='// preserve user code\nwindow.Game={count:3};\n'
    assert '-window.Game={count:0};' in candidate['diffs']['game.js']
    assert '+window.Game={count:3};' in candidate['diffs']['game.js']
    assert candidate['usage']==[{'prompt_tokens':10,'completion_tokens':5}]*4
    applied=env[0].post(ROOT+'/'+candidate['candidateId']+'/apply?token=alice',json={'baseRevision':state['revision']})
    assert applied.status_code==200,applied.text
    built=call(env,'POST','/builds',dict(baseRevision=applied.json()['revision']))
    assert built.status_code==200,built.text


def test_build_failure_is_authoritative_and_repaired_without_apply_until_review(env,monkeypatch):
    actions=[dict(action='read',path='game.js'),dict(action='edit',path='game.js',old='count:}',new='count:2}'),
        dict(action='finish',summary='修复初始化语法')]
    state,calls=setup(env,monkeypatch,actions,'window.Game={count:};')
    assert start(env,state,'repair').status_code==409
    assert call(env,'POST','/builds',dict(baseRevision=state['revision'])).status_code==422
    failure=call(env,'GET','/build-diagnostic').json()
    assert failure['repairable'] and '语法' in failure['diagnostic']
    candidate=start(env,state,'repair').json()
    for n in range(3): candidate=step(env,candidate,n)
    assert candidate['status']=='ready',candidate
    assert calls[0]['buildFailure']==failure
    assert env[1].read('game.js')['content']=='window.Game={count:};'
    applied=env[0].post(ROOT+'/'+candidate['candidateId']+'/apply?token=alice',json={'baseRevision':state['revision']})
    assert call(env,'POST','/builds',dict(baseRevision=applied.json()['revision'])).status_code==200
    assert call(env,'GET','/build-diagnostic').json()['status']=='passed'


def test_syntax_feedback_is_available_to_next_action(env,monkeypatch):
    actions=[dict(action='read',path='game.js'),dict(action='edit',path='game.js',old='count:0',new='count:'),
        dict(action='finish'),dict(action='read',path='game.js'),
        dict(action='edit',path='game.js',old='count:',new='count:2'),dict(action='finish')]
    state,calls=setup(env,monkeypatch,actions)
    c=start(env,state).json()
    for n in range(6):
        c=step(env,c,n)
        if n==2: assert c['status']=='working' and not c['validation']['passed']
    assert c['status']=='ready'
    assert any('diagnostic' in o for o in calls[3]['observations'])


@pytest.mark.parametrize('action',[
    dict(action='read',path='../secret.js'),
    dict(action='read',path='.env'),
    dict(action='edit',path='game.js',old='count:0',new='count:9'),
    dict(action='edit',path='../secret.js',old='x',new='y'),
    dict(action='edit',path='missing.js',old='x',new='y'),
])
def test_unread_or_unsafe_tool_actions_do_not_modify(env,monkeypatch,action):
    state,calls=setup(env,monkeypatch,[action])
    c=step(env,start(env,state).json(),0)
    assert c['changes']==[] and 'error' in c['observations'][-1]
    assert env[1].read('game.js')['content']=='window.Game={count:0};'


def test_ambiguous_or_outdated_read_requires_reread(env,monkeypatch):
    actions=[dict(action='read',path='game.js'),dict(action='edit',path='game.js',old='0',new='1'),
        dict(action='edit',path='game.js',old='count:0',new='count:2'),
        dict(action='edit',path='game.js',old='count:2',new='count:4')]
    state,_=setup(env,monkeypatch,actions,'window.Game={count:0,other:0};')
    c=start(env,state).json()
    for n in range(4): c=step(env,c,n)
    assert len(c['changes'])==1 and 'count:2' in c['changes'][0]['content']
    assert 'error' in c['observations'][-1]


def test_late_network_result_and_diagnostic_rejected_after_hand_edit(env,monkeypatch):
    def mutate(candidate,data):
        (env[1].root/env[1].state()['active']/'game.js').write_text('window.user=1;',encoding='utf-8')
        return dict(action='read',path='game.js')
    state,_=setup(env,monkeypatch,[mutate],'function {')
    call(env,'POST','/builds',dict(baseRevision=state['revision']))
    c=step(env,start(env,state).json(),0)
    assert c['status']=='stale'
    assert start(env,state,'repair','repair1').status_code==409
    assert env[0].post(ROOT+'/'+c['candidateId']+'/apply?token=alice',json={'baseRevision':state['revision']}).status_code==409


def test_step_and_failed_check_limits_stop_model_calls(env,monkeypatch):
    state,calls=setup(env,monkeypatch,[dict(action='search',query='count')]*16)
    c=start(env,state).json()
    for n in range(16): c=step(env,c,n)
    assert c['status']=='failed' and c['stepCount']==16
    assert env[0].post(ROOT+'/'+c['candidateId']+'/work?token=alice',json={'step':16}).status_code==409
    assert len(calls)==16


def test_three_checks_stop_and_noop_is_not_applicable(env,monkeypatch):
    state,calls=setup(env,monkeypatch,[dict(action='check')]*3,'function {')
    c=start(env,state).json()
    for n in range(3): c=step(env,c,n)
    assert c['status']=='failed' and c['failedChecks']==3
    assert env[0].post(ROOT+'/'+c['candidateId']+'/work?token=alice',json={'step':3}).status_code==409


def test_noop_finish_and_permissions(env,monkeypatch):
    state,calls=setup(env,monkeypatch,[dict(action='finish',summary='无需修改')])
    c=start(env,state).json()
    assert env[0].post(ROOT+'/'+c['candidateId']+'/work?token=bob',json={'step':0}).status_code==403
    c=step(env,c,0)
    assert c['status']=='unchanged'
    assert env[0].post(ROOT+'/'+c['candidateId']+'/apply?token=alice',json={'baseRevision':state['revision']}).status_code==409


def test_maintenance_lease_and_network_failure_preserve_progress(env,monkeypatch):
    import httpx
    state,calls=setup(env,monkeypatch,[dict(action='read',path='game.js')])
    c=start(env,state).json()
    c=step(env,c,0)
    path=routes.path_for(env[1],c['candidateId'])
    saved=json.loads(path.read_bytes()); saved.update(status='generating',leaseUntil=routes.time.time()+180)
    path.write_text(json.dumps(saved),encoding='utf-8')
    endpoint=ROOT+'/'+c['candidateId']+'/work?token=alice'
    assert env[0].post(endpoint,json={'step':1}).status_code==409
    assert len(calls)==1
    saved['leaseUntil']=0;path.write_text(json.dumps(saved),encoding='utf-8')
    async def fail(*args): raise httpx.ReadTimeout('https://secret.invalid?key=hidden')
    monkeypatch.setattr(routes,'engineering_model',fail)
    c=step(env,c,1)
    assert c['status']=='failed' and c['stepCount']==1
    assert c['observations'][0]['action']=='read'
    assert 'hidden' not in json.dumps(c) and 'secret.invalid' not in json.dumps(c)


def test_bounded_read_and_forbidden_shell_action(env,monkeypatch):
    state,calls=setup(env,monkeypatch,[dict(action='read',path='game.js'),dict(action='bash',query='echo bad')],'a'*20000)
    c=step(env,start(env,state).json(),0)
    assert '16 KiB' in c['observations'][-1]['error']
    c=step(env,c,1)
    assert c['status']=='failed' and c['changes']==[]
