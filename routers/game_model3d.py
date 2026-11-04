"""3D asset, generation and animation nodes. Paid work starts only on explicit POST."""
import base64
import importlib
import json
import time
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import Field

from core import game_model3d as engine
from core.game_media_assets import media_content, inspect_media, MAX_ASSETS_TOTAL
from core.game_project_models import Contract, Identifier, RuntimeAsset
from core.game_projects import atomic_write, digest, json_bytes, safe_path, uid

projects = importlib.import_module('routers.game_projects')
router = APIRouter(prefix='/api/game-projects/{project_id}/model3d', tags=['game-model3d'])


class Connection(Contract):
    id: Identifier
    name: str = Field(min_length=1, max_length=100)
    protocol: Literal['meshy', 'tripo', 'hyper3d']
    baseUrl: str = Field(default='', max_length=500)
    apiKey: str | None = Field(default=None, max_length=2000)
    enabled: bool = True
    authentication: Literal['api_key', 'none'] = 'api_key'
    models: list[dict] | None = Field(default=None, max_length=50)
    headers: dict[str, str] = Field(default_factory=dict, max_length=10)


class Options(Contract):
    pose: Literal['a-pose', 't-pose'] | None = None
    textureModel: str | None = Field(default=None, max_length=120)
    textureQuality: Literal['fast', 'standard', 'detailed', 'extreme'] | None = None
    rigModel: Literal['v1.0-20240301', 'v2.5-20260210', 'v3.0-20260909'] | None = None
    rigType: Literal['biped', 'quadruped', 'hexapod', 'octopod', 'serpentine', 'aquatic'] | None = None
    animateInPlace: bool | None = None


class Operation(Contract):
    connectionId: Identifier
    model: str = Field(min_length=1, max_length=200)
    options: Options = Field(default_factory=Options)


class NodeImageRef(Contract):
    nodeId: Identifier
    url: str = Field(min_length=1, max_length=2000)


class Generate(Operation):
    baseRevision: int = Field(ge=1)
    requestId: Identifier
    nodeId: Identifier
    operation: Literal['image', 'text', 'retexture', 'remesh', 'animate']
    prompt: str = Field(default='', max_length=4000)
    sourceAssetId: Identifier | None = None
    imageAssetIds: list[Identifier] = Field(default_factory=list, max_length=9)
    imageNodeIds: list[Identifier] = Field(default_factory=list, max_length=9)
    imageNodeRefs: list[NodeImageRef] = Field(default_factory=list, max_length=9)
    targetPolycount: int | None = Field(default=None, ge=48, le=2000000)
    texture: bool = True
    pbr: bool = False
    heightMeters: float = Field(default=1.7, gt=0, le=100)
    actionIds: list[int | str] = Field(default_factory=list, max_length=30)


class Adopt(Contract):
    baseRevision: int = Field(ge=1)
    purpose: str = Field(min_length=1, max_length=1000)
    name: str = Field(default='3D 模型', min_length=1, max_length=150)


def connection_for(repository, owner, connection_id):
    value = next((c for c in engine.connections(repository, owner) if c['id'] == connection_id and c['enabled']), None)
    if not value or (value['authentication'] != 'none' and not value.get('apiKey')):
        raise HTTPException(409, '请先配置并启用 3D 服务及 API Key')
    return value


@router.get('/connections')
def list_connections(project_id: Identifier, token: str = ''):
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token))
        return dict(connections=[engine.public_connection(c) for c in engine.connections(repository, project.owner)], catalog=engine.catalog())


@router.put('/connections')
def save_connection(project_id: Identifier, request: Connection, token: str = ''):
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token), writable=True)
        values = engine.connections(repository, project.owner)
        old = next((c for c in values if c['id'] == request.id), None)
        value = request.model_dump()
        value['baseUrl'] = value['baseUrl'].rstrip('/') or engine.ENDPOINTS[request.protocol]
        url = urlsplit(value['baseUrl'])
        if url.scheme not in ('https', 'http') or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise HTTPException(422, '3D 接口地址需为有效 HTTP(S) 地址，不能包含凭证或查询参数')
        if any(len(k) > 100 or len(v) > 2000 or '\n' in k+v or '\r' in k+v or k.lower() in ('authorization', 'host', 'cookie') for k, v in request.headers.items()):
            raise HTTPException(422, '自定义请求头无效，认证请使用 API Key')
        value['apiKey'] = request.apiKey if request.apiKey is not None else (old or {}).get('apiKey', '')
        if request.models is not None:
            if not request.models or len(json_bytes(request.models)) > 100000:
                raise HTTPException(422, '模型列表无效或过大')
            value['models'] = engine.execute(dict(command='validate', protocol=request.protocol, models=request.models), timeout=20)
            if len({m['id'] for m in value['models']}) != len(value['models']):
                raise HTTPException(422, '模型版本 ID 不能重复')
        if len(values) >= 20 and not old:
            raise HTTPException(413, '3D 连接最多 20 项')
        values = [c for c in values if c['id'] != request.id] + [value]
        atomic_write(engine.config_path(repository, project.owner), json_bytes(values))
        return engine.public_connection(value)


@router.post('/animations')
def animation_library(project_id: Identifier, request: Operation, token: str = ''):
    return provider_operation(project_id, request, token, 'animations')


@router.post('/balance')
def balance(project_id: Identifier, request: Operation, token: str = ''):
    return provider_operation(project_id, request, token, 'balance')


def provider_operation(project_id, request, token, command):
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token))
        connection = connection_for(repository, project.owner, request.connectionId)
    return engine.execute(dict(command=command, connection=connection, model=request.model, input=dict(options=request.options.model_dump(exclude_none=True))))


@router.post('/jobs')
def generate(project_id: Identifier, request: Generate, token: str = ''):
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token), writable=True)
        job_id = 'model-' + digest(request.requestId.encode())[:32]
        directory = engine.job_directory(repository, project, job_id)
        request_hash = digest(json_bytes(request.model_dump()))
        if (directory / 'job.json').is_file():
            job = engine.read_job(repository, project, job_id)
            if job['requestHash'] != request_hash:
                raise HTTPException(409, '请求 ID 已用于不同输入')
            return engine.public_job(job)
        if project.revision != request.baseRevision:
            raise HTTPException(409, '项目已变化，请刷新后再生成')
        connection = connection_for(repository, project.owner, request.connectionId)
        if request.operation == 'animate' and connection['protocol'] == 'hyper3d' or request.operation == 'remesh' and connection['protocol'] == 'hyper3d':
            raise HTTPException(422, 'Hyper3D 不支持此操作')
        models = connection.get('models') or next(c['models'] for c in engine.catalog() if c['id'] == connection['protocol'])
        selected = next((m for m in models if m['id'] == request.model), None)
        if not selected:
            raise HTTPException(422, '模型版本不可用')
        supported = selected['settings'].get('operations')
        if supported is not None and request.operation not in supported:
            raise HTTPException(422, '所选版本不支持此操作，请更换模型或修改自定义版本能力')
        if len(list(safe_path(repository.directory(project.id), 'model3d-jobs').glob('*/job.json'))) >= 100:
            raise HTTPException(413, '项目 3D 任务已达 100 项')
        payload = dict(command='animate' if request.operation == 'animate' else 'generate', model=request.model,
                       input={k: v for k, v in request.model_dump(exclude_none=True).items() if k in ('operation', 'prompt', 'targetPolycount', 'texture', 'pbr', 'heightMeters', 'actionIds')}, images=[])
        payload['input']['options'] = request.options.model_dump(exclude_none=True)
        frozen = []
        if request.sourceAssetId:
            source = next((a for a in project.mediaAssets if a.id == request.sourceAssetId and a.kind == 'model'), None)
            if not source:
                raise HTTPException(422, '源模型不存在')
            frozen.append(('source.glb', media_content(repository, project, source)))
            payload['source'] = 'source.glb'
            if source.metadata.get('forwardAxis'):
                payload['input']['forwardAxis'] = source.metadata['forwardAxis']
        if request.operation in ('retexture', 'remesh', 'animate') and not request.sourceAssetId:
            raise HTTPException(422, '请连接或选择源模型')
        for asset_id in dict.fromkeys(request.imageAssetIds):
            asset = next((a for a in project.mediaAssets if a.id == asset_id and a.kind == 'image'), None)
            old = next((a for a in project.assets if a.id == asset_id and a.selected), None)
            if not asset and not old:
                raise HTTPException(422, '参考图片不存在')
            raw = media_content(repository, project, asset) if asset else repository.selected_content(project, old)
            mime = asset.mime if asset else 'image/' + old.spec.format
            if mime not in ('image/png', 'image/jpeg'):
                from PIL import Image
                import io
                with Image.open(io.BytesIO(raw)) as image:
                    buffer = io.BytesIO(); image.save(buffer, format='PNG')
                raw, mime = buffer.getvalue(), 'image/png'
            frozen.append(('image-' + str(len(payload['images'])) + '.bin', raw))
            payload['images'].append(dict(path=frozen[-1][0], mime=mime))
        if request.imageNodeIds or request.imageNodeRefs:
            canvas = projects.canvas_for(project, token)
            references = [(node_id, None) for node_id in dict.fromkeys(request.imageNodeIds)] + [(r.nodeId, r.url) for r in request.imageNodeRefs]
            for node_id, selected_url in references:
                node = next((n for n in canvas['nodes'] if n['id'] == node_id), None)
                urls = node_image_urls(canvas, node)
                url = selected_url or (urls[0] if urls else None)
                if not url or url not in urls:
                    raise HTTPException(422, '图片节点不存在或尚无图片，请先保存画布')
                raw = Path(projects.owned_source(project, url, token)).read_bytes()
                # Convert reference formats for Hyper3D, which only accepts PNG/JPEG.
                from PIL import Image
                import io
                try:
                    with Image.open(io.BytesIO(raw)) as image:
                        if max(image.size) > 8192:
                            raise ValueError('参考图最大边不能超过 8192')
                        buffer = io.BytesIO(); image.save(buffer, format='PNG')
                except (ValueError, OSError) as exc:
                    raise HTTPException(422, '连接的输出不是有效参考图片') from exc
                raw = buffer.getvalue()
                frozen.append(('image-' + str(len(payload['images'])) + '.bin', raw))
                payload['images'].append(dict(path=frozen[-1][0], mime='image/png'))
        if sum(len(raw) for _, raw in frozen) > 160 * 1024 * 1024:
            raise HTTPException(413, '3D 输入总计超过 160 MiB')
        if len(payload['images']) > 9:
            raise HTTPException(422, '参考图最多 9 张')
        for name, raw in frozen:
            atomic_write(directory / name, raw)
        job = dict(jobId=job_id, requestHash=request_hash, nodeId=request.nodeId, connectionId=request.connectionId,
                   model=request.model, operation=request.operation, payload=payload, connectionHash=digest(json_bytes(connection)),
                   status='queued', message='准备中', createdAt=time.time(), updatedAt=time.time())
        return engine.launch(repository, project, job, connection)


def node_image_urls(canvas, node):
    if not node:
        return []
    if node['type'] == 'image':
        values = [node.get('url')]
    elif node['type'] == 'group':
        values = [n.get('url') for n in canvas['nodes'] if n['id'] in node.get('items', []) and n['type'] == 'image']
    elif node['type'] == 'output':
        values = node.get('images', [])
    elif node['type'] in ('generator', 'msgen', 'comfy', 'ltxDirector', 'rh', 'minimax'):
        values = node.get('generatedOutputs', [])
    else:
        return []
    return list(dict.fromkeys(url for item in values if (url := item if isinstance(item, str) else item.get('url') if isinstance(item, dict) else None)))


@router.get('/jobs')
def list_jobs(project_id: Identifier, token: str = ''):
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token))
        root = safe_path(repository.directory(project.id), 'model3d-jobs')
        jobs = [engine.public_job(engine.read_job(repository, project, p.parent.name)) for p in root.glob('*/job.json')]
        return sorted(jobs, key=lambda j: j['createdAt'], reverse=True)


@router.get('/jobs/{job_id}')
def read_job(project_id: Identifier, job_id: Identifier, token: str = ''):
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token))
        return engine.public_job(engine.read_job(repository, project, job_id))


@router.post('/jobs/{job_id}/control/{action}')
def control_job(project_id: Identifier, job_id: Identifier, action: Literal['resume', 'cancel'], token: str = ''):
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token), writable=True)
        job = engine.read_job(repository, project, job_id)
        if action == 'cancel':
            return engine.cancel(repository, project, job)
        if job['status'] in ('succeeded', 'adopted'):
            return engine.public_job(job)
        connection = connection_for(repository, project.owner, job['connectionId'])
        if digest(json_bytes(connection)) != job['connectionHash']:
            raise HTTPException(409, '连接配置已变化，请恢复原配置后继续同一任务')
        return engine.launch(repository, project, job, connection)


@router.post('/jobs/{job_id}/adopt')
def adopt(project_id: Identifier, job_id: Identifier, request: Adopt, token: str = ''):
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token), request.baseRevision, writable=True)
        job = engine.read_job(repository, project, job_id)
        if job['status'] not in ('succeeded', 'adopted'):
            raise HTTPException(409, '任务尚未成功')
        asset_id = 'media-' + job_id
        if any(a.id == asset_id for a in project.mediaAssets):
            return {**projects.payload(project, repository), 'assetId': asset_id}
        raw = (engine.job_directory(repository, project, job_id) / 'output.glb').read_bytes()
        kind, mime, metadata = inspect_media('output.glb', raw)
        if sum(a.sizeBytes for a in project.mediaAssets) + len(raw) > MAX_ASSETS_TOTAL or len(project.mediaAssets) >= 200:
            raise HTTPException(413, '项目素材容量不足，请先移除不需要的素材')
        relative = f'assets/{asset_id}/generated.glb'
        asset = RuntimeAsset(id=asset_id, name=request.name + '.glb', kind=kind, mime=mime, purpose=request.purpose,
                             enabled=True, revision=1, relativePath=relative, contentHash=digest(raw), sizeBytes=len(raw),
                             sourceNodeId=job['nodeId'], metadata={**metadata, **job.get('metadata', {})})
        atomic_write(safe_path(repository.directory(project.id), relative), raw)
        project.mediaAssets.append(asset)
        project = repository.save(project)
        job.update(status='adopted', assetId=asset_id)
        atomic_write(engine.job_directory(repository, project, job_id) / 'job.json', json_bytes(job))
        return {**projects.payload(project, repository), 'assetId': asset_id}


@router.get('/preview/{asset_id}')
def preview(project_id: Identifier, asset_id: Identifier, token: str = ''):
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token))
        asset = next((a for a in project.mediaAssets if a.id == asset_id and a.kind == 'model'), None)
        if not asset:
            raise HTTPException(404, '模型资产不存在')
        raw = media_content(repository, project, asset)
    return preview_response(raw)


@router.get('/jobs/{job_id}/preview')
def preview_job(project_id: Identifier, job_id: Identifier, token: str = ''):
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token))
        job = engine.read_job(repository, project, job_id)
        if job['status'] not in ('succeeded', 'adopted'):
            raise HTTPException(409, '模型尚未生成完成')
        raw = (engine.job_directory(repository, project, job_id) / 'output.glb').read_bytes()
        inspect_media('output.glb', raw)
    return preview_response(raw)


def preview_response(raw):
    root = Path(__file__).resolve().parents[1]
    page = (root / 'templates/model3d/viewer.html').read_text('utf-8')
    page = page.replace('/*__ENGINE__*/', (root / 'templates/game-web-3d/three-runtime.js').read_text('utf-8'))
    page = page.replace('__MODEL_BASE64__', base64.b64encode(raw).decode())
    return Response(page, media_type='text/html', headers={'Cache-Control': 'private, no-store',
                    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:; worker-src blob:; frame-ancestors 'self'", 'X-Content-Type-Options': 'nosniff'})
