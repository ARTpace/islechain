"""Project-owned speech, sound-effect, music and audio-scene jobs."""
import importlib
import time
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import Field
from core import game_model3d as engine
from core.game_projects import atomic_write, digest, json_bytes, safe_path
from core.game_project_models import Contract, Identifier, RuntimeAsset
from core.game_media_assets import inspect_media, MAX_ASSETS_TOTAL
projects = importlib.import_module('routers.game_projects')
router = APIRouter(prefix='/api/game-projects/{project_id}/audio', tags=['game-audio'])
WORKER = Path(__file__).resolve().parents[1] / 'tools/audio/worker.cjs'
ENDPOINTS = {'volcengine-tts':'https://openspeech.bytedance.com/api/v3/tts/unidirectional','volcengine-seed-audio':'https://openspeech.bytedance.com/api/v3/tts/create'}

def config_path(repository, owner):
    return safe_path(repository.root, 'audio-connections/' + digest(owner.encode()) + '.json')

def connections(repository, owner):
    import json
    path=config_path(repository, owner)
    return json.loads(path.read_bytes()) if path.is_file() else []

class Connection(Contract):
    id: Identifier
    name: str = Field(min_length=1,max_length=100)
    protocol: Literal['volcengine-tts','volcengine-seed-audio']
    baseUrl: str = Field(default='',max_length=500)
    apiKey: str | None = Field(default=None,max_length=2000)
    enabled: bool = True

class Generate(Contract):
    baseRevision: int = Field(ge=1)
    requestId: Identifier
    nodeId: Identifier
    connectionId: Identifier
    operation: Literal['speech','sound-effect','music','audio-scene']
    prompt: str = Field(min_length=1,max_length=2744)
    voiceId: str = Field(default='',max_length=256,pattern=r'^[A-Za-z0-9_-]*$')
    durationSeconds: float | None = Field(default=None,gt=0,le=120)
    style: str = Field(default='',max_length=100)
    speed: int = Field(default=0,ge=-50,le=100)
    pitch: int = Field(default=0,ge=-12,le=12)
    volume: int = Field(default=0,ge=-50,le=100)
    format: Literal['mp3','wav','ogg_opus'] = 'mp3'

class Adopt(Contract):
    baseRevision: int = Field(ge=1)
    name: str = Field(min_length=1,max_length=150)
    purpose: str = Field(min_length=1,max_length=1000)

@router.get('/connections')
def list_connections(project_id:Identifier,token:str=''):
    repository=projects.store()
    with repository.locked():
        project=repository.read(project_id,projects.identity(token))
        return dict(connections=[engine.public_connection(c) for c in connections(repository,project.owner)],catalog=engine.execute({'command':'catalog'},20,worker=WORKER))

@router.put('/connections')
def save_connection(project_id:Identifier,request:Connection,token:str=''):
    repository=projects.store()
    with repository.locked():
        project=repository.read(project_id,projects.identity(token),writable=True)
        values=connections(repository,project.owner);old=next((c for c in values if c['id']==request.id),{})
        value=request.model_dump();value['baseUrl']=value['baseUrl'] or ENDPOINTS[request.protocol]
        url=urlsplit(value['baseUrl'])
        if url.scheme not in ('http','https') or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise HTTPException(422,'音频接口地址无效')
        value['apiKey']=request.apiKey if request.apiKey is not None else old.get('apiKey','')
        if len(values)>=20 and not old: raise HTTPException(413,'连接最多20项')
        atomic_write(config_path(repository,project.owner),json_bytes([c for c in values if c['id']!=request.id]+[value]))
        return engine.public_connection(value)

@router.post('/jobs')
def generate(project_id:Identifier,request:Generate,token:str=''):
    repository=projects.store()
    with repository.locked():
        project=repository.read(project_id,projects.identity(token),writable=True)
        job_id='audio-'+digest(request.requestId.encode())[:32]
        directory=engine.job_directory(repository,project,job_id)
        request_hash=digest(json_bytes(request.model_dump()))
        if (directory/'job.json').is_file():
            job=engine.read_job(repository,project,job_id)
            if job['requestHash']!=request_hash: raise HTTPException(409,'请求ID已用于不同输入')
            return engine.public_job(job)
        if project.revision!=request.baseRevision: raise HTTPException(409,'项目已变化，请刷新')
        connection=next((c for c in connections(repository,project.owner) if c['id']==request.connectionId and c['enabled'] and c.get('apiKey')),None)
        if not connection: raise HTTPException(409,'请先配置音频服务和API Key')
        if connection['protocol']=='volcengine-tts' and request.operation!='speech': raise HTTPException(422,'此服务仅支持语音')
        if connection['protocol']=='volcengine-tts' and (request.format=='wav' or not request.voiceId): raise HTTPException(422,'语音服务需选择音色，仅支持MP3/OGG')
        if len(list(safe_path(repository.directory(project.id),'audio-jobs').glob('*/job.json')))>=100: raise HTTPException(413,'音频任务最多100项')
        args={k:v for k,v in request.model_dump(exclude_none=True).items() if k in ('operation','voiceId','style','speed','pitch','volume','durationSeconds') and v!=''}
        args['text' if request.operation=='speech' else 'prompt']=request.prompt
        args['output']={'format':request.format,'sampleRate':48000}
        if request.operation=='music':args['instrumental']=True
        extension={'mp3':'mp3','wav':'wav','ogg_opus':'ogg'}[request.format]
        job=dict(jobId=job_id,nodeId=request.nodeId,connectionId=request.connectionId,connectionHash=digest(json_bytes(connection)),requestHash=request_hash,createdAt=time.time(),outputName='output.'+extension,payload={'command':'generate','input':args},status='queued')
        return engine.launch(repository,project,job,connection)

@router.get('/jobs')
def list_jobs(project_id:Identifier,token:str=''):
    repository=projects.store()
    with repository.locked():
        project=repository.read(project_id,projects.identity(token))
        return sorted([engine.public_job(engine.read_job(repository,project,p.parent.name)) for p in safe_path(repository.directory(project.id),'audio-jobs').glob('*/job.json')],key=lambda j:j['createdAt'],reverse=True)

def owned_job(repository, project, job_id):
    if not job_id.startswith('audio-'):raise HTTPException(404,'音频任务不存在')
    return engine.read_job(repository,project,job_id)

@router.get('/jobs/{job_id}')
def read_job(project_id:Identifier,job_id:Identifier,token:str=''):
    repository=projects.store()
    with repository.locked():
        project=repository.read(project_id,projects.identity(token))
        return engine.public_job(owned_job(repository,project,job_id))

@router.post('/jobs/{job_id}/cancel')
def cancel(project_id:Identifier,job_id:Identifier,token:str=''):
    repository=projects.store()
    with repository.locked():
        project=repository.read(project_id,projects.identity(token),writable=True)
        return engine.cancel(repository,project,owned_job(repository,project,job_id))

@router.get('/jobs/{job_id}/content')
def content(project_id:Identifier,job_id:Identifier,token:str=''):
    repository=projects.store()
    with repository.locked():
        project=repository.read(project_id,projects.identity(token));job=owned_job(repository,project,job_id)
        if job['status'] not in ('succeeded','adopted'):raise HTTPException(409,'音频尚未生成')
        raw=(engine.job_directory(repository,project,job_id)/job['outputName']).read_bytes()
        _,mime,_=inspect_media(job['outputName'],raw)
        return Response(raw,media_type=mime,headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})

@router.post('/jobs/{job_id}/adopt')
def adopt(project_id:Identifier,job_id:Identifier,request:Adopt,token:str=''):
    repository=projects.store()
    with repository.locked():
        project=repository.read(project_id,projects.identity(token),request.baseRevision,writable=True);job=owned_job(repository,project,job_id)
        if job['status'] not in ('succeeded','adopted'):raise HTTPException(409,'任务尚未成功')
        asset_id='media-'+job_id
        if any(a.id==asset_id for a in project.mediaAssets):return {**projects.payload(project,repository),'assetId':asset_id}
        raw=(engine.job_directory(repository,project,job_id)/job['outputName']).read_bytes();kind,mime,metadata=inspect_media(job['outputName'],raw)
        if sum(a.sizeBytes for a in project.mediaAssets)+len(raw)>MAX_ASSETS_TOTAL or len(project.mediaAssets)>=200:raise HTTPException(413,'项目素材容量不足')
        suffix=Path(job['outputName']).suffix;relative=f'assets/{asset_id}/generated{suffix}'
        asset=RuntimeAsset(id=asset_id,name=request.name+suffix,kind=kind,mime=mime,purpose=request.purpose,enabled=True,revision=1,relativePath=relative,contentHash=digest(raw),sizeBytes=len(raw),sourceNodeId=job['nodeId'],metadata={**metadata,**job.get('metadata',{})})
        atomic_write(safe_path(repository.directory(project.id),relative),raw);project.mediaAssets.append(asset);project=repository.save(project)
        job.update(status='adopted',assetId=asset_id);atomic_write(engine.job_directory(repository,project,job_id)/'job.json',json_bytes(job))
        return {**projects.payload(project,repository),'assetId':asset_id}
