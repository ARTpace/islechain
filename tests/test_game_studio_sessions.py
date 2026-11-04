import asyncio
import importlib
import json
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from core import game_native_runtime as native, game_studio_sessions as studio, game_engine_plugins as plugins
from core.game_projects import atomic_write, json_bytes
from test_game_workspace import env, create
from test_game_native_runtime import prepare


def test_agent_commands_keep_native_permissions_and_models(monkeypatch):
    monkeypatch.setattr(studio,'executable',lambda *args:['agent-exe'])
    assert studio.command('codex','gpt-model','owned') == ['agent-exe','exec','--json','--sandbox','workspace-write','--skip-git-repo-check','--model','gpt-model','resume','owned','-']
    assert studio.command('claude','sonnet','owned')[-2:] == ['--resume','owned']
    assert studio.command('opencode','provider/model','owned')[-2:] == ['--session','owned']
    assert all('--dangerously-skip-permissions' not in studio.command(agent) for agent in studio.AGENTS)
    assert studio.event_result('claude',dict(type='result',subtype='error',result='denied'))[1]=='failed'
    assert studio.event_result('opencode',dict(type='step_finish',part=dict(reason='tool-calls')))[1] is None


def test_native_claude_npm_layout_without_shell_shim(tmp_path,monkeypatch):
    monkeypatch.setattr(studio.shutil,'which',lambda name:None)
    monkeypatch.setattr(studio.Path,'home',lambda:tmp_path/'home')
    monkeypatch.setattr(studio.os,'get_exec_path',lambda:[str(tmp_path/'npm')])
    exe=tmp_path/'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'
    exe.parent.mkdir(parents=True);exe.write_bytes(b'fixture')
    assert studio.executable('claude')==[str(exe)]


def test_real_offline_agents_handoff_checkpoints_branch_and_restore(env,monkeypatch):
    _,session = prepare(env)
    workspace = env[1]
    fixture = str(Path(__file__).parent/'fixtures/native_agents.py')
    monkeypatch.setattr(studio,'executable',lambda agent,configured='':[sys.executable,fixture,agent])
    manager = native.NativeRuntime()
    async def scenario():
        for index,agent in enumerate(studio.AGENTS):
            session_now = native.read_session(workspace,session['sessionId'])
            run = manager.start(workspace,session_now,'agent',f'agent{index}',f'需求{index}',resume=True,agent=agent)
            await asyncio.wait_for(asyncio.gather(*manager.workers.values()),15)
            saved = next(r for r in manager.list(workspace) if r['runId']==run['runId'])
            assert saved['status']=='succeeded', saved
        updated = native.read_session(workspace,session['sessionId'])
        history = studio.rounds(workspace,updated)
        assert [r['agent'] for r in history]==list(studio.AGENTS)
        assert '移动已修复' in history[0]['answer']
        assert '增加冲刺' in studio.handoff(workspace,updated)
        assert '需求2' in studio.project_handoff(workspace)
        original = native.sources(workspace.path(f"native-sessions/{session['sessionId']}/project"))
        branch = studio.branch(workspace,updated,history[1]['roundId'])
        branch_files = native.sources(workspace.path(f"native-sessions/{branch['sessionId']}/project"))
        assert branch_files['agent-note.txt']==b'codex'
        assert len(branch['rounds'])==1 and 'agentSessionId' not in branch
        assert native.sources(workspace.path(f"native-sessions/{session['sessionId']}/project"))==original
        assert 'agent-note.txt' not in workspace.current()[1], '分支不能改已保存工程'
        with pytest.raises(HTTPException):
            studio.branch(workspace,branch,history[2]['roundId'])
        restored = studio.branch(workspace,updated,history[1]['roundId'],restore=True)
        assert workspace.current()[1]['agent-note.txt']==b'codex'
        assert restored['workspaceEpoch']>session['workspaceEpoch']
        assert studio.rounds(workspace,updated)==history, '撤销不能删原对话'
        inherited = native.create_session(workspace,restored['sessionId'])
        assert inherited['rounds']==restored['rounds']
        with pytest.raises(HTTPException):
            studio.branch(workspace,updated,history[0]['roundId'])
    asyncio.run(scenario())


def test_host_and_native_context_handoff_and_snapshot_tamper(env):
    _,session=prepare(env)
    workspace=env[1]
    atomic_write(workspace.path('code-candidates/host.json'),json_bytes(dict(instruction='宿主已实现移动',status='applied',changes=[dict(path='src/main.ts')],diagnostics=[])))
    assert '宿主已实现移动' in studio.handoff(workspace,session)
    files=native.sources(workspace.path(f"native-sessions/{session['sessionId']}/project"))
    rid=studio.begin_round(workspace,session,files,'增加冲刺','codex','','run1')
    atomic_write(workspace.path(f'native-rounds/{rid}/before/package.json'),b'{}')
    with pytest.raises(HTTPException) as error:studio.branch(workspace,session,rid)
    assert error.value.status_code==409


def test_failed_agent_cannot_resume_stale_native_context(env,monkeypatch):
    _,session=prepare(env)
    fixture=str(Path(__file__).parent/'fixtures/native_agents.py')
    monkeypatch.setattr(studio,'executable',lambda agent,configured='':[sys.executable,fixture,agent])
    manager=native.NativeRuntime()
    async def scenario():
        manager.start(env[1],session,'agent','failed','fixture-fail',agent='claude')
        await asyncio.wait_for(asyncio.gather(*manager.workers.values()),15)
        current=native.read_session(env[1],session['sessionId'])
        assert not current['agentReady']
        assert studio.rounds(env[1],current)[0]['status']=='failed'
        assert manager.list(env[1])[0]['status']=='failed'
    asyncio.run(scenario())


def test_native_engine_target_needs_no_web_template_and_cannot_claim_external_undo(env,tmp_path,monkeypatch):
    create(env)
    project=tmp_path/'project.godot';project.write_text('[application]')
    atomic_write(env[1].path('native-runtime.json'),json_bytes(dict(enabled=True,plugins={'godot':dict(enabled=True,executable=sys.executable,project=str(project))})))
    session=native.create_session(env[1])
    fixture=str(Path(__file__).parent/'fixtures/native_agents.py')
    monkeypatch.setattr(studio,'executable',lambda agent,configured='':[sys.executable,fixture,agent])
    manager=native.NativeRuntime()
    async def scenario():
        manager.start(env[1],session,'agent','native-target','修改Godot工程',plugin='godot')
        await asyncio.wait_for(asyncio.gather(*manager.workers.values()),15)
        current=native.read_session(env[1],session['sessionId'])
        assert manager.list(env[1])[0]['status']=='succeeded'
        assert 'package.json' not in env[1].current()[1]
        record=studio.rounds(env[1],current)[0]
        assert record['targetPlugin']=='godot'
        with pytest.raises(HTTPException) as error:studio.branch(env[1],current,record['roundId'],restore=True)
        assert error.value.status_code==409
        assert studio.branch(env[1],current,record['roundId'])['targetPlugin']=='godot'
    asyncio.run(scenario())


def test_plugins_validate_paths_actions_and_share_agent_context(env,tmp_path):
    prepare(env)
    project=tmp_path/'a project.godot';project.write_text('[application]')
    config=plugins.validate('godot',sys.executable,str(project))
    settings=native.settings(env[1]);settings['plugins']={'godot':config}
    atomic_write(env[1].path('native-runtime.json'),json_bytes(settings))
    args=plugins.command(env[1],'godot','check',tmp_path/'out')
    assert args==[sys.executable,'--path',str(tmp_path),'--headless','--editor','--quit']
    assert plugins.context(env[1])[0]['commands']['check']==args
    with pytest.raises(HTTPException):plugins.command(env[1],'godot','delete',tmp_path/'out')
    with pytest.raises(HTTPException):plugins.validate('godot','evil.cmd',str(project))
    with pytest.raises(HTTPException):plugins.validate('unity',sys.executable,str(project))
    config['enabled']=False;settings['plugins']['godot']=config
    atomic_write(env[1].path('native-runtime.json'),json_bytes(settings))
    assert plugins.context(env[1])==[]
    with pytest.raises(HTTPException):plugins.command(env[1],'godot','run',tmp_path/'out')


def test_studio_api_local_owner_gate_and_configuration_survives_toggle(env,monkeypatch):
    _,session=prepare(env)
    api=importlib.import_module('routers.game_native_runtime')
    env[0].app.include_router(api.router)
    monkeypatch.setattr(studio,'executable',lambda *args:[sys.executable])
    root='/api/game-projects/p1/native-runtime'
    with TestClient(env[0].app,base_url='http://127.0.0.1',client=('127.0.0.1',50000)) as client:
        assert client.put(root+'/agents/claude?token=alice',json={'executable':sys.executable}).status_code==403
        assert client.get(root+f"/sessions/{session['sessionId']}/conversation?token=bob").status_code==403
        headers={'X-Art-Runtime':'1'}
        assert client.put(root+'/agents/claude?token=alice',headers=headers,json={'executable':sys.executable}).status_code==200
        assert client.put(root+'?token=alice',headers=headers,json={'enabled':False}).status_code==200
        value=client.get(root+'?token=alice').json()
        assert value['agents']['claude']==sys.executable
        assert len(value['pluginCatalog'])==7
        assert client.post(root+f"/sessions/{session['sessionId']}/branch?token=alice",headers=headers,json={'roundId':'not-owned'}).status_code==403
