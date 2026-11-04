import base64
import importlib
import io
import json
import time
import zipfile
from pathlib import Path
import pytest
from pydantic import ValidationError
from test_game_workspace import env
from test_game_web_builds import install
from core.game_project_models import PlayableGraph
from core.game_media_assets import asset_context
from core.game_web_builds import WebBuilds
from core import game_model3d as engine
from core.game_projects import atomic_write,json_bytes
ROOT=Path(__file__).parents[1]
audio=importlib.import_module('routers.game_audio')
assets=importlib.import_module('routers.game_node_assets')

@pytest.fixture
def extra_env(env,monkeypatch,tmp_path):
    env[0].app.include_router(audio.router);env[0].app.include_router(assets.router)
    monkeypatch.setenv('NODE_OPTIONS','--require='+str(ROOT/'tests/audio-provider-fixture.cjs'))
    monkeypatch.setenv('ART_AUDIO_FIXTURE_LOG',str(tmp_path/'audio-requests.jsonl'))
    return env

def call(env,method,path,data=None,owner='alice'):
    return env[0].request(method,'/api/game-projects/p1'+path,params={'token':owner},json=data)

def connect(env):
    response=call(env,'PUT','/audio/connections',dict(id='audio1',name='Offline Seed',protocol='volcengine-seed-audio',apiKey='offline-audio-key',baseUrl='https://audio-fixture.invalid/create'))
    assert response.status_code==200,response.text
    assert 'offline-audio-key' not in response.text

def finish(env,job):
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
        job=call(env,'GET','/audio/jobs/'+job['jobId']).json()
        if job['status'] not in ('running','queued'):return job
        time.sleep(.05)
    pytest.fail('audio job timed out')

@pytest.mark.parametrize('operation',['speech','sound-effect','music','audio-scene'])
def test_native_audio_generation_adoption_and_idempotency(extra_env,operation):
    env=extra_env;connect(env)
    catalog=call(env,'GET','/audio/connections').json()['catalog']
    assert len(catalog['models'])==2 and catalog['voices']
    body=dict(baseRevision=1,requestId='request1',nodeId='audio-node',connectionId='audio1',operation=operation,prompt='forest wind',format='wav',durationSeconds=2.0)
    response=call(env,'POST','/audio/jobs',body);assert response.status_code==200,response.text
    job=finish(env,response.json());assert job['status']=='succeeded',job
    assert 'payload' not in job and job['metadata']['durationMs']>0
    assert call(env,'POST','/audio/jobs',body).json()['jobId']==job['jobId']
    assert call(env,'GET','/audio/jobs/'+job['jobId'],owner='bob').status_code==403
    assert call(env,'GET','/audio/jobs/'+job['jobId']+'/content').content.startswith(b'RIFF')
    adopted=call(env,'POST',f"/audio/jobs/{job['jobId']}/adopt",dict(baseRevision=1,name='Forest',purpose='ambience'))
    assert adopted.status_code==200,adopted.text
    result=adopted.json();asset=result['project']['mediaAssets'][0]
    assert asset['kind']=='audio' and asset['sourceNodeId']=='audio-node'
    again=call(env,'POST',f"/audio/jobs/{job['jobId']}/adopt",dict(baseRevision=2,name='Forest',purpose='ambience'))
    assert len(again.json()['project']['mediaAssets'])==1
    from core.game_backups import export_backup
    project=env[1].repository.read('p1','alice')
    with zipfile.ZipFile(io.BytesIO(export_backup(env[1].repository,project))) as z:
        assert not any('audio-jobs' in n for n in z.namelist())
    log=Path(__import__('os').environ['ART_AUDIO_FIXTURE_LOG']).read_text().splitlines()
    assert len(log)==1
    prompt=json.loads(log[0])['body']['text_prompt']
    if operation=='music':assert 'instrumental' in prompt
    if operation=='sound-effect':assert 'standalone game sound effect' in prompt

def test_audio_ambiguous_submission_never_retries(extra_env,monkeypatch):
    env=extra_env;connect(env);monkeypatch.setenv('ART_AUDIO_FIXTURE_ERROR','1')
    body=dict(baseRevision=1,requestId='uncertain',nodeId='node1',connectionId='audio1',operation='music',prompt='music',format='wav')
    job=finish(env,call(env,'POST','/audio/jobs',body).json())
    assert job['status']=='failed' and job['submissionUncertain']
    assert 'offline-audio-key' not in json.dumps(job)
    assert call(env,'POST','/audio/jobs',body).json()['jobId']==job['jobId']
    assert len(Path(__import__('os').environ['ART_AUDIO_FIXTURE_LOG']).read_text().splitlines())==1
    assert call(env,'GET','/audio/jobs/model-other').status_code==404

def graph():
    return dict(version=1,entryNodeId='scene-a',initialState={'score':0},nodes=[dict(id='scene-a',title='First',source="GameScene.emit('next',{score:1});",signals=['next']),dict(id='scene-b',title='Second',source="document.querySelector('#hud').textContent=GameScene.state.score;",signals=['back'])],edges=[dict(source='scene-a',signal='next',target='scene-b'),dict(source='scene-b',signal='back',target='scene-a')])

def test_scene_graph_validation_preview_frozen_build_and_export(extra_env,tmp_path):
    env=extra_env;g=graph()
    response=call(env,'PUT','/node-assets/graph',dict(baseRevision=1,graph=g));assert response.status_code==200,response.text
    assert call(env,'GET','/node-assets/graph/preview',owner='bob').status_code==403
    preview=call(env,'GET','/node-assets/graph/preview');assert preview.status_code==200
    assert 'sandbox="allow-scripts"' in preview.text and 'allow-same-origin' not in preview.text
    assert 'scene-exit' in preview.text and 'scene-storage' in preview.text
    invalid=graph();invalid['edges'].append(invalid['edges'][0]);assert call(env,'PUT','/node-assets/graph',dict(baseRevision=2,graph=invalid)).status_code==422
    invalid=graph();invalid['nodes'][0]['source']='const x=;';assert call(env,'PUT','/node-assets/graph',dict(baseRevision=2,graph=invalid)).status_code==422
    assert call(env,'PUT','/node-assets/graph',dict(baseRevision=1,graph=g)).status_code==409
    state=install(env);project=env[1].repository.read('p1','alice');builds=WebBuilds(env[1].repository,project);built=builds.build(state['revision'])
    assert built['playableGraph']==g
    response=env[0].get(f"/api/game-projects/p1/workspace/builds/{built['buildId']}/preview",params={'token':'alice'})
    assert response.status_code==200,response.text
    assert "frame-src 'self' blob:" in response.headers['content-security-policy']
    with zipfile.ZipFile(io.BytesIO(builds.export(built['buildId']))) as z:
        assert 'scene-exit' in z.read('index.html').decode()
    source=builds.workspace.export_source()
    with zipfile.ZipFile(io.BytesIO(source)) as z:
        assert 'game/scenes/scene-a.js' in z.namelist()
        z.extractall(tmp_path/'export')
    import subprocess,sys
    result=subprocess.run([sys.executable,'build.py'],cwd=tmp_path/'export',capture_output=True,timeout=15)
    assert result.returncode==0,result.stderr.decode(errors='replace')
    assert 'scene-exit' in (tmp_path/'export/dist/index.html').read_text('utf-8')
    project.playableGraph.nodes[0].source='window.changed=true;'
    assert 'window.changed=true' not in builds.artifact(built['buildId'])[1].decode()

def test_file_folder_import_reference_paths_and_backup_restore(extra_env):
    env=extra_env
    body=dict(baseRevision=1,files=[dict(path='design/rules.md',contentBase64=base64.b64encode('规则：跳跃收集金币'.encode()).decode()),dict(path='design/opaque.bin',contentBase64='AAEC')])
    response=call(env,'POST','/node-assets/files',body);assert response.status_code==200,response.text
    result=response.json();project=env[1].repository.read('p1','alice');files=project.projectFiles
    assert len(files)==2 and files[0].documentId and not files[1].documentId
    assert any('规则' in item.get('text','') for item in asset_context(project))
    assert call(env,'GET','/node-assets/files/'+files[0].id,owner='bob').status_code==403
    assert call(env,'GET','/node-assets/files/'+files[1].id).content==b'\0\1\2'
    zipped=env[0].get('/api/game-projects/p1/node-assets/folder',params={'token':'alice','ids':','.join(f.id for f in files)})
    with zipfile.ZipFile(io.BytesIO(zipped.content)) as z:assert set(z.namelist())=={'design/rules.md','design/opaque.bin'}
    for path in ['../escape','C:/escape','.env','folder/.env.local']:
        bad=call(env,'POST','/node-assets/files',dict(baseRevision=2,files=[dict(path=path,contentBase64='AA==')]))
        assert bad.status_code==422,bad.text
    assert call(env,'POST','/node-assets/files',dict(baseRevision=2,files=body['files'])).status_code==409
    from core.game_backups import export_backup,read_backup,import_backup
    restored=import_backup(env[1].repository,read_backup(export_backup(env[1].repository,project)),'alice','c2','Restored')
    assert assets.file_content(env[1].repository,restored,restored.projectFiles[1])==b'\0\1\2'
