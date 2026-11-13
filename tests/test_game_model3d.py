import importlib
import io
import json
import time
import zipfile
from pathlib import Path

import pytest

from test_game_workspace import env
from core import game_model3d as engine
from core.game_projects import validate_document_nodes

routes=importlib.import_module('routers.game_model3d')
ROOT=Path(__file__).resolve().parents[1]


@pytest.fixture
def model_env(env,monkeypatch,tmp_path):
    env[0].app.include_router(routes.router)
    monkeypatch.setenv('NODE_OPTIONS','--require='+str(ROOT/'tests/model3d-provider-fixture.cjs'))
    monkeypatch.setenv('ART_MODEL3D_FIXTURE_FILE',str(ROOT/'docs/examples/model3d/robot.glb'))
    monkeypatch.setenv('ART_MODEL3D_FIXTURE_LOG',str(tmp_path/'requests.jsonl'))
    return env


def call(env,method,path,data=None,owner='alice'):
    return env[0].request(method,'/api/game-projects/p1/model3d'+path,params={'token':owner},json=data)


def connect(env,protocol='meshy'):
    result=call(env,'PUT','/connections',dict(id='connection',name='Offline '+protocol,protocol=protocol,apiKey='offline-key',baseUrl='https://3d-fixture.invalid/'+protocol+('/v1' if protocol=='meshy' else '')))
    assert result.status_code==200,result.text
    assert 'offline-key' not in result.text
    return result.json()


def submit(env,operation='text',model='meshy-t2',**extra):
    result=call(env,'POST','/jobs',dict(baseRevision=env[1].repository.read('p1','alice').revision,requestId='request-1',nodeId='node3d',connectionId='connection',model=model,operation=operation,prompt='small robot',texture=False,**extra))
    assert result.status_code==200,result.text
    return result.json()


def finished(env,job):
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
        job=call(env,'GET','/jobs/'+job['jobId']).json()
        if job['status'] not in ('queued','running'):return job
        time.sleep(.05)
    pytest.fail('3D job did not finish: '+str(job))


def test_connections_catalog_permissions_and_key_retention(model_env):
    env=model_env
    assert call(env,'GET','/connections',owner='bob').status_code==403
    connect(env)
    response=call(env,'GET','/connections');assert response.status_code==200,response.text
    data=response.json();assert {c['id'] for c in data['catalog']}=={'meshy','tripo','hyper3d'}
    assert data['connections'][0]['hasKey'] and 'offline-key' not in response.text
    updated=call(env,'PUT','/connections',dict(id='connection',name='updated',protocol='meshy',apiKey=None))
    assert updated.json()['hasKey']
    assert engine.connections(env[1].repository,'alice')[0]['apiKey']=='offline-key'
    bad=call(env,'PUT','/connections',dict(id='bad',name='bad',protocol='meshy',baseUrl='https://secret@host/'))
    assert bad.status_code==422


def test_material_preview_reuses_the_same_viewer(model_env):
    """只有 PBR 材质、还没有模型时也走同一个预览页：预设按键与平铺滑条长在预览器里。"""
    env=model_env
    page=call(env,'GET','/material-preview')
    assert page.status_code==200,page.text
    assert call(env,'GET','/material-preview',owner='bob').status_code==403
    # 引擎必须原样内联。压缩代码里会出现 `$&`（minified 变量名 `$` 紧跟 `&&`），
    # 字符串式 replace 会把它当成「整段匹配」展开，把脚本改坏——这里直接比对整段源码。
    engine_source=(Path(__file__).resolve().parents[1]/'templates/game-web-3d/three-runtime.js').read_text('utf-8')
    assert engine_source in page.text
    assert '/*__ENGINE__*/' not in page.text and '__MODEL_BASE64__' not in page.text
    for marker in ('id="viewer-material"','data-geometry="sphere"','data-geometry="plane"',
                   'id="vm-repeat"','id="viewer-channels-btn"','id="viewer-help-btn"','id="full"'):
        assert marker in page.text,marker


@pytest.mark.parametrize('protocol,model',[('meshy','meshy-t2'),('tripo','P1-20260311'),('hyper3d','Gen-2')])
def test_provider_generation_adoption_preview_and_recovery(model_env,protocol,model):
    env=model_env;connect(env,protocol)
    if protocol=='hyper3d':model=next(c['models'][0]['id'] for c in engine.catalog() if c['id']=='hyper3d')
    job=finished(env,submit(env,model=model))
    assert job['status']=='succeeded',job
    assert call(env,'GET',f"/jobs/{job['jobId']}/preview").status_code==200
    assert job['metadata']['animations']==['Idle','Turn']
    assert call(env,'GET','/jobs/'+job['jobId'],owner='bob').status_code==403
    assert 'payload' not in job and 'connectionHash' not in job
    # Resume uses the same journal and must not submit another paid task.
    directory=engine.job_directory(env[1].repository,env[1].project,job['jobId'])
    saved=json.loads((directory/'job.json').read_bytes());saved['status']='interrupted'
    from core.game_projects import atomic_write,json_bytes
    atomic_write(directory/'job.json',json_bytes(saved))
    before=Path(__import__('os').environ['ART_MODEL3D_FIXTURE_LOG']).read_text().splitlines()
    resumed=call(env,'POST',f"/jobs/{job['jobId']}/control/resume");assert resumed.status_code==200,resumed.text
    assert finished(env,resumed.json())['status']=='succeeded'
    after=[json.loads(line) for line in Path(__import__('os').environ['ART_MODEL3D_FIXTURE_LOG']).read_text().splitlines()[len(before):]]
    assert not any(item['method']=='POST' and not item['path'].endswith(('/status','/download')) for item in after)
    result=call(env,'POST',f"/jobs/{job['jobId']}/adopt",dict(baseRevision=1,purpose='主角',name='Robot'))
    assert result.status_code==200,result.text
    asset=result.json()['project']['mediaAssets'][0]
    assert asset['sourceNodeId']=='node3d' and asset['metadata']['animations']==['Idle','Turn']
    page=call(env,'GET','/preview/'+asset['id']);assert page.status_code==200
    assert 'GameOrbitControls' in page.text and '__MODEL_BASE64__' not in page.text
    assert call(env,'GET','/preview/'+asset['id'],owner='bob').status_code==403
    result=call(env,'POST',f"/jobs/{job['jobId']}/adopt",dict(baseRevision=2,purpose='主角',name='Robot'))
    assert result.status_code==200 and len(result.json()['project']['mediaAssets'])==1
    from core.game_backups import export_backup
    with zipfile.ZipFile(io.BytesIO(export_backup(env[1].repository,env[1].repository.read('p1','alice')))) as archive:
        assert not any('model3d-jobs' in name for name in archive.namelist())
    requests=[json.loads(line) for line in Path(__import__('os').environ['ART_MODEL3D_FIXTURE_LOG']).read_text().splitlines()]
    assert all(not item['authorized'] for item in requests if item['path']=='/artifact.glb')


def test_ambiguous_paid_submission_is_not_repeated(model_env,monkeypatch):
    env=model_env;connect(env);monkeypatch.setenv('ART_MODEL3D_FIXTURE_AMBIGUOUS','1')
    job=finished(env,submit(env));assert job['status']=='failed'
    assert job['submissionUncertain']
    resumed=call(env,'POST',f"/jobs/{job['jobId']}/control/resume")
    job=finished(env,resumed.json());assert job['status']=='failed' and 'Submission could not be confirmed' in job['message']
    requests=[json.loads(line) for line in Path(__import__('os').environ['ART_MODEL3D_FIXTURE_LOG']).read_text().splitlines()]
    assert len([item for item in requests if item['method']=='POST'])==1


@pytest.mark.parametrize('protocol,model,actions',[('meshy','meshy-t2',list(range(11))),('tripo','P1-20260311',['preset:biped:idle'])])
def test_rigging_animation_and_meshy_clip_merge(model_env,protocol,model,actions):
    env=model_env;connect(env,protocol)
    from test_game_media_assets import upload
    result=upload(env,'robot.glb',(ROOT/'docs/examples/model3d/robot.glb').read_bytes())
    source=result.json()['project']['mediaAssets'][0]['id']
    library=call(env,'POST','/animations',dict(connectionId='connection',model=model));assert library.status_code==200,library.text
    assert library.json()
    job=finished(env,submit(env,'animate',model=model,sourceAssetId=source,actionIds=actions))
    assert job['status']=='succeeded',job
    assert len(job['metadata']['animations'])>=2
    requests=[json.loads(line) for line in Path(__import__('os').environ['ART_MODEL3D_FIXTURE_LOG']).read_text().splitlines()]
    assert any('/rig' in item['path'] for item in requests)
    if protocol=='meshy':assert len([item for item in requests if item['method']=='POST' and item['path'].endswith('/animations')])==2


def test_task_idempotency_stale_inputs_and_canvas_ownership(model_env):
    env=model_env;connect(env)
    job=submit(env)
    assert submit(env)['jobId']==job['jobId']
    conflict=call(env,'POST','/jobs',dict(baseRevision=1,requestId='request-1',nodeId='node3d',connectionId='connection',model='meshy-t2',operation='text',prompt='different'))
    assert conflict.status_code==409
    finished(env,job)
    repository=env[1].repository
    valid=dict(id='n',type='gameModel3d',projectId='p1')
    validate_document_nodes(repository,dict(id='c1',owner='alice'),[valid])
    with pytest.raises(Exception):validate_document_nodes(repository,dict(id='other',owner='alice'),[valid])
    with pytest.raises(Exception):validate_document_nodes(repository,dict(id='c1',owner='bob'),[valid])


@pytest.mark.parametrize('protocol,model,operation',[('meshy','meshy-t2','image'),('meshy','meshy-t2','retexture'),('meshy','meshy-t2','remesh'),('tripo','P1-20260311','image'),('tripo','P1-20260311','retexture'),('tripo','P1-20260311','remesh'),('hyper3d',None,'image'),('hyper3d',None,'retexture')])
def test_image_retexture_and_remesh_protocols(model_env,protocol,model,operation):
    env=model_env;connect(env,protocol)
    if model is None:model=next(c['models'][0]['id'] for c in engine.catalog() if c['id']==protocol)
    from test_game_media_assets import upload
    from PIL import Image
    raw=io.BytesIO();Image.new('RGB',(8,8),'red').save(raw,format='WEBP')
    image=upload(env,'reference.webp',raw.getvalue()).json()['project']['mediaAssets'][-1]['id']
    source=upload(env,'source.glb',(ROOT/'docs/examples/model3d/robot.glb').read_bytes()).json()['project']['mediaAssets'][-1]['id']
    # Direct payload: references and source must be compatible before the paid adapter runs.
    body=dict(baseRevision=env[1].repository.read('p1','alice').revision,requestId='image-op',nodeId='model-node',connectionId='connection',model=model,operation=operation,prompt='',imageAssetIds=[image] if operation!='remesh' else [],targetPolycount=4000,texture=True,pbr=True)
    if operation!='image':body['sourceAssetId']=source
    result=call(env,'POST','/jobs',body);assert result.status_code==200,result.text
    job=finished(env,result.json());assert job['status']=='succeeded',job
    saved=engine.read_job(env[1].repository,env[1].project,job['jobId'])
    if saved['payload']['images']:assert saved['payload']['images'][0]['mime']=='image/png'


def test_cancel_and_resume_paid_job(model_env,monkeypatch):
    env=model_env;connect(env);monkeypatch.setenv('ART_MODEL3D_FIXTURE_WAIT','1')
    job=submit(env)
    deadline=time.monotonic()+10
    log=Path(__import__('os').environ['ART_MODEL3D_FIXTURE_LOG'])
    while time.monotonic()<deadline:
        if log.is_file() and any(json.loads(line)['method']=='GET' for line in log.read_text().splitlines()):break
        time.sleep(.05)
    else:pytest.fail('Provider task not submitted')
    assert call(env,'POST',f"/jobs/{job['jobId']}/control/cancel").status_code==200
    assert finished(env,job)['status']=='cancelled'
    monkeypatch.delenv('ART_MODEL3D_FIXTURE_WAIT')
    result=call(env,'POST',f"/jobs/{job['jobId']}/control/resume");assert result.status_code==200,result.text
    assert finished(env,result.json())['status']=='succeeded'
    assert sum(json.loads(line)['method']=='POST' for line in log.read_text().splitlines())==1


def test_portable_backup_rejects_private_paid_task_journal(model_env):
    from core.game_backups import read_backup
    from core.game_projects import digest,json_bytes
    entries={'project.json':model_env[1].project.model_dump_json().encode(),'model3d-jobs/forged/job.json':b'{"payload":{}}'}
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as archive:
        for name,raw in entries.items():archive.writestr('project/'+name,raw)
        archive.writestr('backup.json',json_bytes(dict(schemaVersion=1,manifest={n:digest(raw) for n,raw in entries.items()})))
    with pytest.raises(Exception,match='3D'):
        read_backup(stream.getvalue())


def test_connected_generated_output_reference_is_owned_and_frozen(model_env,monkeypatch,tmp_path):
    from PIL import Image
    env=model_env;connect(env)
    image=tmp_path/'reference.png';Image.new('RGB',(8,8),'blue').save(image)
    monkeypatch.setattr(routes.projects,'canvas_for',lambda *args:dict(nodes=[dict(id='output',type='output',images=[dict(url='/output/reference.png')])]))
    monkeypatch.setattr(routes.projects,'owned_source',lambda project,url,token:image)
    body=dict(baseRevision=1,requestId='connected-output',nodeId='model',connectionId='connection',model='meshy-t2',operation='image',imageNodeRefs=[dict(nodeId='output',url='/output/reference.png')])
    response=call(env,'POST','/jobs',body);assert response.status_code==200,response.text
    job=finished(env,response.json());assert job['status']=='succeeded',job
    saved=engine.read_job(env[1].repository,env[1].project,job['jobId'])
    frozen=engine.job_directory(env[1].repository,env[1].project,job['jobId'])/saved['payload']['images'][0]['path']
    assert frozen.read_bytes()==image.read_bytes()
    bad={**body,'requestId':'forged-url','imageNodeRefs':[dict(nodeId='output',url='/output/not-in-node.png')]}
    assert call(env,'POST','/jobs',bad).status_code==422
