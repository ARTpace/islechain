"""真实本机Node/npm进程；不调用付费模型，不操作用户工程。"""
import asyncio
import importlib
import io
import json
import os
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from core import game_native_runtime as native
from core.game_projects import atomic_write, digest, json_bytes
# routers.game_native_runtime 已在 _SUBROUTERS 中，`from routers import X`
# 会拿到 APIRouter；这里需要模块对象（api.router）。
api = importlib.import_module('routers.game_native_runtime')
from test_game_workspace import env, create

ROOT='/api/game-projects/p1/native-runtime'


def prepare(env, script='require("fs").mkdirSync("dist",{recursive:true});require("fs").writeFileSync("dist/index.html","<h1>built</h1>");'):
    state=create(env)
    state=env[1].patch(state['revision'],[
        dict(path='package.json',baseHash=None,content=json.dumps(dict(name='fixture',version='1.0.0',private=True,
            scripts=dict(build='node build.cjs',dev='node server.cjs')))),
        dict(path='build.cjs',baseHash=None,content=script),
        dict(path='server.cjs',baseHash=None,content='const http=require("http");const p=Number(process.argv[process.argv.indexOf("--port")+1]);http.createServer((q,s)=>s.end("fixture")).listen(p,"127.0.0.1",()=>console.log("Local: http://127.0.0.1:"+p));')],True)
    atomic_write(env[1].path('native-runtime.json'),json_bytes(dict(enabled=True,mode='local-trusted')))
    return state,native.create_session(env[1])


def test_real_npm_install_build_and_recover_source_lock(env):
    if not shutil.which('node'):
        pytest.skip('需要Node')
    state,session=prepare(env)
    manager=native.NativeRuntime()
    async def scenario():
        run=manager.start(env[1],session,'install','install1')
        await asyncio.wait_for(asyncio.gather(*manager.workers.values()),30)
        installed=manager.list(env[1])[0]
        assert installed['status']=='succeeded',installed
        assert manager.start(env[1],session,'install','install1')['runId']==run['runId']
        run=manager.start(env[1],session,'build','build1')
        await asyncio.wait_for(asyncio.gather(*manager.workers.values()),15)
        saved=next(r for r in manager.list(env[1]) if r['runId']==run['runId'])
        assert saved['status']=='succeeded',saved
        assert saved['artifactManifest']['index.html']==digest(b'<h1>built</h1>')
        assert 'package-lock.json' in native.sources(env[1].path(f"native-sessions/{session['sessionId']}/project"))
        env[1].patch(state['revision'],[dict(path='README.md',baseHash=digest(env[1].read('README.md')['content'].encode()),content='manual')],True)
        with pytest.raises(HTTPException) as error:
            manager.start(env[1],session,'build','stale')
        assert error.value.status_code==409
    asyncio.run(scenario())


def test_owned_tree_reaps_descendant_when_parent_has_exited(env):
    # The child inherits stdout and would otherwise keep the runner waiting forever.
    script='const {spawn}=require("child_process");spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});require("fs").mkdirSync("dist",{recursive:true});require("fs").writeFileSync("dist/index.html","ok");process.exit(0);'
    _,session=prepare(env,script)
    manager=native.NativeRuntime()
    async def scenario():
        run=manager.start(env[1],session,'build','tree1')
        await asyncio.wait_for(asyncio.gather(*manager.workers.values()),15)
        saved=manager.list(env[1])[0]
        assert saved['runId']==run['runId'] and saved['status']=='succeeded',saved
    asyncio.run(scenario())


def test_native_api_host_gate_changes_and_frozen_export(env):
    _,session=prepare(env)
    env[0].app.include_router(api.router)
    assert env[0].get(ROOT+'?token=alice').status_code==403
    with TestClient(env[0].app,base_url='http://127.0.0.1',client=('127.0.0.1',50000)) as client:
        headers={'X-Art-Runtime':'1'}
        assert client.get(ROOT+'?token=bob').status_code==403
        assert client.put(ROOT+'?token=alice',json={'enabled':True}).status_code==403
        assert client.put(ROOT+'?token=alice',headers={**headers,'Origin':'https://evil.invalid'},json={'enabled':True}).status_code==403
        result=client.post(ROOT+'/runs?token=alice',headers=headers,json=dict(sessionId=session['sessionId'],requestId='api_build',operation='build'))
        assert result.status_code==200,result.text
        rid=result.json()['runId']
        for _ in range(300):
            run=client.get(ROOT+'/runs/'+rid+'?token=alice').json()
            if run['status'] not in ('starting','running'):break
            time.sleep(.02)
        assert run['status']=='succeeded',run
        exported=client.get(ROOT+'/runs/'+rid+'/web.zip?token=alice')
        assert exported.status_code==200,exported.text
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            assert archive.read('index.html')==b'<h1>built</h1>'
        path=env[1].path(f"native-sessions/{session['sessionId']}/project/build.cjs")
        path.write_text('// externally edited',encoding='utf-8')
        diff=client.post(ROOT+'/sessions/'+session['sessionId']+'/changes?token=alice',headers=headers,json={})
        assert diff.status_code==200 and '+// externally edited' in diff.json()['changes'][0]['diff']
        adopted=client.post(ROOT+'/sessions/'+session['sessionId']+'/changes?token=alice',headers=headers,json={'apply':True})
        assert adopted.status_code==200,adopted.text
        assert env[1].read('build.cjs')['content']=='// externally edited'
        env[1].path(f'native-runs/{rid}/dist/index.html').write_bytes(b'corrupt')
        assert client.get(ROOT+'/runs/'+rid+'/web.zip?token=alice').status_code==409


def test_dev_stops_without_killing_another_project_and_can_be_restarted(env):
    _,session=prepare(env)
    manager=native.NativeRuntime()
    async def scenario():
        run=manager.start(env[1],session,'dev','dev1')
        for _ in range(200):
            saved=manager.list(env[1])[0]
            if saved['serverReady'] or saved['status']=='failed':break
            await asyncio.sleep(.02)
        assert saved['serverReady'],saved
        build=manager.start(env[1],session,'build','alongside-dev')
        await asyncio.wait_for(manager.workers[str(env[1].root)+'#writer'],15)
        assert next(r for r in manager.list(env[1]) if r['runId']==build['runId'])['status']=='succeeded'
        assert next(r for r in manager.list(env[1]) if r['runId']==run['runId'])['serverReady']
        await manager.stop(env[1])
        saved=next(r for r in manager.list(env[1]) if r['runId']==run['runId'])
        assert saved['status']=='cancelled' and not saved['serverReady']
        assert sentinel.poll() is None,'不能按进程名结束其他Node任务'
        retry=manager.start(env[1],session,'build','after-stop')
        await asyncio.wait_for(asyncio.gather(*manager.workers.values()),15)
        assert manager.list(env[1])[0]['runId']==retry['runId']
        assert manager.list(env[1])[0]['status']=='succeeded'
    sentinel=subprocess.Popen([shutil.which('node'),'-e','setInterval(()=>{},1000)'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        asyncio.run(scenario())
    finally:
        sentinel.kill();sentinel.wait(timeout=5)


def test_codex_adapter_uses_owned_session_and_safe_arguments_without_inference(env,monkeypatch):
    _,session=prepare(env)
    calls=[]
    async def fake_run(workspace,root,run,args,prompt,lock):
        calls.append((args,prompt))
        run.update(status='succeeded',agentSessionId='owned-session')
        native.NativeRuntime.save(workspace,run)
        native.unlock(lock)
    manager=native.NativeRuntime()
    monkeypatch.setattr(manager,'run',fake_run)
    monkeypatch.setattr(native,'node_tool',lambda name:[sys.executable,'fake-codex.py'])
    async def scenario():
        manager.start(env[1],session,'agent','agent1','修复移动')
        await asyncio.gather(*manager.workers.values())
        args,prompt=calls[0]
        assert ['--sandbox','workspace-write']==args[args.index('--sandbox'):args.index('--sandbox')+2]
        assert '--dangerously-bypass-approvals-and-sandbox' not in args and args[-1]=='-'
        assert '修复移动' in prompt
        session['agentSessionId']='owned-session'
        session['agentReady']=True
        manager.start(env[1],session,'agent','agent2','继续',resume=True)
        await asyncio.gather(*manager.workers.values())
        assert calls[-1][0][-3:]==['resume','owned-session','-']
    asyncio.run(scenario())


@pytest.mark.parametrize('failed',[False,True])
def test_real_process_codex_protocol_requires_completed_turn_and_keeps_patch_unadopted(env,monkeypatch,failed):
    _,session=prepare(env)
    manager=native.NativeRuntime()
    monkeypatch.setattr(native,'node_tool',lambda name:[sys.executable,str(Path(__file__).parent/'fixtures/native_codex.py')])
    async def scenario():
        run=manager.start(env[1],session,'agent','fixture-agent','fixture-fail' if failed else '修改得分')
        await asyncio.wait_for(asyncio.gather(*manager.workers.values()),15)
        saved=manager.list(env[1])[0]
        assert saved['exitCode']==0
        assert saved['status']==('failed' if failed else 'succeeded'),saved
        assert native.read_session(env[1],session['sessionId'])['agentSessionId']=='fixture-session'
        assert 'src/agent.ts' not in env[1].current()[1]
        assert env[1].path(f"native-sessions/{session['sessionId']}/project/src/agent.ts").is_file()
    asyncio.run(scenario())


def test_backup_excludes_execution_permission_and_runtime_copies(env):
    from core.game_backups import export_backup,read_backup
    _,session=prepare(env)
    raw=export_backup(env[1].repository,env[1].project)
    entries=read_backup(raw)
    assert 'native-runtime.json' not in entries
    assert not any(name.startswith(('native-sessions/','native-runs/','development-tasks/')) for name in entries)


def test_source_export_includes_context_without_runtime_authorization(env):
    _,session=prepare(env)
    root=env[1].path(f"native-sessions/{session['sessionId']}/project")
    files=native.sources(root)
    assert 'ART_CANVAS_CONTEXT.json' not in files
    assert not any('__art_canvas_assets' in name for name in files)
    for raw in (native.export_source(env[1]),env[1].export_source()):
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names=archive.namelist()
            assert 'package.json' in names and 'ART_CANVAS_CONTEXT.json' in names
            context=json.loads(archive.read('ART_CANVAS_CONTEXT.json'))
            assert context['projectId']=='p1'
            assert json.loads(archive.read(context['assetManifest']))=={}
            assert 'native-runtime.json' not in names
            assert not any(name.startswith(('native-sessions/','node_modules/')) for name in names)


@pytest.mark.skipif(os.environ.get('ART_GAME_NATIVE_NETWORK_TEST')!='1',reason='显式启用隔离样例的真实npm下载和Vite构建')
def test_real_vite_typescript_template_install_build_and_hmr_server(env):
    import httpx
    state=create(env)
    atomic_write(env[1].path('native-runtime.json'),json_bytes(dict(enabled=True,mode='local-trusted')))
    native.install_template(env[1],state['revision'])
    session=native.create_session(env[1])
    manager=native.NativeRuntime()
    async def scenario():
        install=manager.start(env[1],session,'install','vite-install')
        await asyncio.wait_for(asyncio.gather(*manager.workers.values()),180)
        saved=next(r for r in manager.list(env[1]) if r['runId']==install['runId'])
        assert saved['status']=='succeeded',saved
        build=manager.start(env[1],session,'build','vite-build')
        await asyncio.wait_for(asyncio.gather(*manager.workers.values()),60)
        saved=next(r for r in manager.list(env[1]) if r['runId']==build['runId'])
        assert saved['status']=='succeeded' and 'index.html' in saved['artifactManifest'],saved
        dev=manager.start(env[1],session,'dev','vite-dev')
        try:
            for _ in range(200):
                saved=next(r for r in manager.list(env[1]) if r['runId']==dev['runId'])
                if saved['serverReady'] or saved['status']=='failed':break
                await asyncio.sleep(.05)
            assert saved['serverReady'],saved
            async with httpx.AsyncClient(timeout=10) as client:
                page=await client.get(f"http://127.0.0.1:{dev['port']}/")
                assert page.status_code==200 and '/@vite/client' in page.text
                source=await client.get(f"http://127.0.0.1:{dev['port']}/src/main.ts")
                assert source.status_code==200 and 'draw()' in source.text
        finally:
            await manager.stop(env[1])
    asyncio.run(scenario())
