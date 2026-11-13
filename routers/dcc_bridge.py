"""DCC 桥路由：投递画布资产、查看作业、回收外部软件产物。

不启动外部软件，也不假设任何软件在运行。只负责两件事：把画布上的文件放进作业
目录，以及把作业目录里的产物搬回画布。画布与用户校验都在这一层做，core 只碰文件。
"""

import os
import shutil
import time
import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import main as _main
from core import blender_modeller, dcc_bridge

router = APIRouter(prefix='/api/dcc', tags=['dcc'])


class SendRequest(BaseModel):
    canvasId: str = Field(min_length=1, max_length=80)
    target: str = 'blender'
    urls: list[str] = Field(default_factory=list, max_length=32)
    nodeIds: list[str] = Field(default_factory=list, max_length=32)
    note: str = ''


class ImportRequest(BaseModel):
    names: list[str] = Field(default_factory=list, max_length=32)


class BuildRequest(BaseModel):
    canvasId: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=4000)
    nodeIds: list[str] = Field(default_factory=list, max_length=16)
    urls: list[str] = Field(default_factory=list, max_length=16)
    # 改造模式：上游模型资产的内容地址，落盘后作为 Blender 里的改造基准
    modelUrl: str = Field(default='', max_length=600)
    modelName: str = ''
    blockoutOnly: bool = False
    # 建模人设：决定用哪套 skill（packs/blender-skills/<presetId>/SKILL.md）
    presetId: str = Field(default='default', max_length=40)
    # 作业手册可单独指定，留空则跟随人设；减面就是「人设 + optimizer 手册」的组合
    skillId: str = Field(default='', max_length=40)
    # 目标三角面数，0 表示不限；改造模式下等同于减面目标
    targetTris: int = Field(default=0, ge=0, le=2_000_000)
    provider: str = ''
    model: str = ''


def _username(request: Request):
    _main.ensure_same_origin_request(request)
    return _main.require_valid_token(_main.request_auth_token(request))


def owned_canvas(canvas_id, username):
    from routers.canvases import load_canvas_any
    canvas = load_canvas_any(canvas_id)
    owner = canvas.get('owner') or ''
    if owner and owner != username:
        raise HTTPException(status_code=403, detail='无权访问该画布')
    return canvas


def _next_position(canvas):
    nodes = canvas.get('nodes') or []
    if not nodes:
        return 120, 120
    rights = [float(node.get('x') or 0) for node in nodes]
    tops = [float(node.get('y') or 0) for node in nodes]
    return int(max(rights) + 360), int(min(tops))


def _urls_from_nodes(canvas, node_ids):
    wanted = set(node_ids or [])
    urls = []
    for node in canvas.get('nodes') or []:
        if wanted:
            if node.get('id') not in wanted:
                continue
        elif node.get('type') not in ('image', 'video', 'audio'):
            continue
        if node.get('url'):
            urls.append(node['url'])
        for item in node.get('images') or []:
            if isinstance(item, dict) and item.get('url'):
                urls.append(item['url'])
    return urls


def _local_game_asset_path(url, username):
    """游戏项目的模型资产不在 /assets/ 下，得按 workspace 的 relativePath 定位。
    归属校验复用 repository.read：project.owner 必须等于当前用户。"""
    import re
    import urllib.parse
    import importlib
    from core.game_projects import safe_path
    # routers 包把子模块名重绑定成 router 对象，这里必须取真正的模块
    projects = importlib.import_module('routers.game_projects')

    clean = urllib.parse.unquote(str(url or '').split('?', 1)[0])
    match = re.match(r'^/api/game-projects/([^/]+)/workspace/media-assets/([^/]+)/content$', clean)
    if not match:
        return None
    repository = projects.store()
    try:
        project = repository.read(match.group(1), username)
    except HTTPException:
        return None
    asset = next((item for item in project.mediaAssets if item.id == match.group(2)), None)
    if not asset:
        return None
    try:
        path = safe_path(repository.directory(project.id), asset.relativePath)
    except HTTPException:
        return None
    return str(path) if path.is_file() else None


def _resolve_source(url, username):
    from routers.canvases import local_media_path_from_url
    return local_media_path_from_url(url) or _local_game_asset_path(url, username)


def deliver(canvas, username, target, *, node_ids=None, urls=None, note='', allow_empty=False):
    """把画布资产复制进一个新作业的 in/。返回 (job, 未解析的 URL)。"""
    candidate = [url for url in (urls or []) if url]
    if not candidate and node_ids:
        candidate = _urls_from_nodes(canvas, node_ids)
    if not candidate:
        if allow_empty:
            # A pure prompt build has no input files; the job still needs a home.
            return dcc_bridge.create(canvas['id'], username, target, note), []
        raise ValueError('没有可投递的资产：请先选中带文件的节点')
    sources, missing = [], []
    for url in candidate:
        path = _resolve_source(url, username)
        if not path:
            missing.append(url)
            continue
        sources.append((path, os.path.basename(path)))
    if not sources:
        raise ValueError('资产文件不在本地：' + ', '.join(missing[:3]))
    job = dcc_bridge.create(canvas['id'], username, target, note)
    dcc_bridge.stage(job, sources)
    return dcc_bridge.load(job['id']), missing


def collect_into_canvas(canvas, job, names=None):
    """把 out/ 里的产物复制进画布资产目录；图片额外生成画布节点。"""
    from routers.canvases import build_asset_url, get_canvas_asset_dir, save_canvas
    folder = get_canvas_asset_dir(canvas)
    os.makedirs(folder, exist_ok=True)
    wanted = set(names or [])
    products = [item for item in dcc_bridge.refresh(job) if not wanted or item['name'] in wanted]
    if not products:
        raise ValueError('out/ 里还没有产物')

    x, y = _next_position(canvas)
    imported = []
    for index, item in enumerate(products):
        if not os.path.isfile(item['path']):
            continue
        ext = os.path.splitext(item['name'])[1].lower()
        filename = f'dcc_{job["id"]}_{uuid.uuid4().hex[:8]}{ext}'
        try:
            shutil.copy2(item['path'], os.path.join(folder, filename))
        except OSError as error:
            imported.append({'name': item['name'], 'ok': False, 'error': str(error)})
            continue
        url = build_asset_url(canvas, filename)
        entry = {'name': item['name'], 'kind': item['kind'], 'url': url, 'file': filename, 'ok': True}
        if item['kind'] == 'image':
            node = {'id': f'img_{uuid.uuid4().hex[:8]}', 'type': 'image', 'x': x, 'y': y + index * 340,
                    'url': url, 'title': item['name'], 'dccJobId': job['id'], 'dccTarget': job.get('target')}
            canvas.setdefault('nodes', []).append(node)
            entry['nodeId'] = node['id']
            entry['node'] = node
        elif item['kind'] == 'model':
            try:
                size = os.path.getsize(os.path.join(folder, filename))
            except OSError:
                size = 0
            node = {'id': f'model3d_{uuid.uuid4().hex[:8]}', 'type': 'model3d', 'x': x, 'y': y + index * 320,
                    'url': url, 'name': item['name'], 'size': size, 'created_at': int(time.time() * 1000),
                    'dccJobId': job['id'], 'dccTarget': job.get('target')}
            canvas.setdefault('nodes', []).append(node)
            entry['nodeId'] = node['id']
            entry['node'] = node
        imported.append(entry)

    if any(item.get('nodeId') for item in imported):
        save_canvas(canvas)
    job['imported'] = (job.get('imported') or []) + imported
    job['status'] = 'imported'
    dcc_bridge.save(job)
    return imported


@router.get('/targets')
async def dcc_targets():
    return {'targets': [
        {'id': key, 'label': spec['label'], 'accepts': list(spec['accepts']),
         'produces': list(spec['produces']), 'instruction': spec['instruction']}
        for key, spec in dcc_bridge.TARGETS.items()
    ]}


@router.post('/jobs')
async def dcc_send(payload: SendRequest, request: Request):
    username = _username(request)
    canvas = owned_canvas(payload.canvasId, username)
    try:
        job, missing = deliver(canvas, username, payload.target,
                               node_ids=payload.nodeIds, urls=payload.urls, note=payload.note)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    data = dcc_bridge.public(job, include_paths=True)
    data['missing'] = missing
    return data


@router.get('/jobs')
async def dcc_list(request: Request, canvasId: str = ''):
    username = _username(request)
    jobs = dcc_bridge.list_jobs(canvas_id=canvasId or None, owner=username)
    for job in jobs:
        try:
            dcc_bridge.refresh(job)
        except (OSError, ValueError):
            pass
    return {'jobs': [dcc_bridge.public(job) for job in jobs]}


@router.get('/jobs/{job_id}')
async def dcc_detail(job_id: str, request: Request):
    username = _username(request)
    try:
        job = dcc_bridge.load(job_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    if job.get('owner') and job['owner'] != username:
        raise HTTPException(status_code=403, detail='无权访问该作业')
    dcc_bridge.refresh(job)
    return dcc_bridge.public(dcc_bridge.load(job_id), include_paths=True)


@router.get('/jobs/{job_id}/products/{name}')
async def dcc_product(job_id: str, name: str, request: Request):
    """按需取 out/ 里的单个产物。改造模式要把结果直接回写原资产，不必在画布资产目录留副本。"""
    username = _username(request)
    try:
        job = dcc_bridge.load(job_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    if job.get('owner') and job['owner'] != username:
        raise HTTPException(status_code=403, detail='无权访问该作业')
    for item in dcc_bridge.refresh(job):
        # name 必须精确命中 scan_out 扫到的文件名，不接受任何路径片段
        if item['name'] == name and os.path.isfile(item['path']):
            from fastapi.responses import FileResponse
            return FileResponse(item['path'], media_type='application/octet-stream', filename=name)
    raise HTTPException(status_code=404, detail='产物不存在')


@router.post('/jobs/{job_id}/import')
async def dcc_import(job_id: str, payload: ImportRequest, request: Request):
    username = _username(request)
    try:
        job = dcc_bridge.load(job_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    if job.get('owner') and job['owner'] != username:
        raise HTTPException(status_code=403, detail='无权访问该作业')
    canvas = owned_canvas(job['canvasId'], username)
    try:
        items = collect_into_canvas(canvas, job, payload.names)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    return {'job': dcc_bridge.public(dcc_bridge.load(job_id)), 'items': items}


@router.post('/build-model')
async def dcc_build_model(payload: BuildRequest, request: Request):
    """让 AI 在 Blender 里现场建模。立即返回 jobId，前端轮询 /jobs/{id} 看进度。"""
    username = _username(request)
    canvas = owned_canvas(payload.canvasId, username)
    # 手册先校验再建作业，免得留一个跑不起来的空作业目录
    try:
        job, missing = deliver(canvas, username, 'blender', node_ids=payload.nodeIds,
                               urls=payload.urls, note=payload.prompt, allow_empty=True)
        if payload.modelUrl:
            base_path = _resolve_source(payload.modelUrl, username)
            if not base_path:
                raise HTTPException(status_code=400, detail='基准模型读不到：请重新选择模型资产后再试')
            ext = os.path.splitext(base_path)[1].lower() or '.glb'
            placed = dcc_bridge.stage(dcc_bridge.load(job['id']), [(base_path, 'base_model' + ext)])
            if not placed:
                raise HTTPException(status_code=400, detail='基准模型复制失败，可能文件过大或为空')
            job = dcc_bridge.load(job['id'])
            job['mode'] = 'edit'
            job['baseModel'] = placed[0]['name']
            job['baseModelLabel'] = (payload.modelName or '模型资产')[:80]
            dcc_bridge.save(job)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from None
    try:
        base, headers, model = _main.resolve_chat_provider(payload.provider, payload.model, '')
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=400, detail='模型渠道不可用：%s' % error) from None
    from core.game_role_presets import PRESETS
    preset_id = (payload.presetId or 'default').strip()
    preset = next((p for p in PRESETS if p['id'] == preset_id and 'model' in p['kinds']), None)
    if preset is None:
        preset = next((p for p in PRESETS if p['id'] == 'default'), {'id': 'default', 'name': '通用助手', 'prompt': ''})
    job = dcc_bridge.load(job['id'])
    job['blockoutOnly'] = payload.blockoutOnly
    job['targetTris'] = payload.targetTris
    job['skillId'] = preset['id']
    dcc_bridge.save(job)
    blender_modeller.start(job['id'], payload.prompt, base, headers, model, preset,
                           skill_id=preset['id'], target_tris=payload.targetTris)
    return {'jobId': job['id'], 'status': job['status'], 'missing': missing,
            'preset': {'id': preset['id'], 'name': preset.get('name', '')},
            'targetTris': payload.targetTris}


class ApproveStageRequest(BaseModel):
    # 放行后进入细化阶段；prompt 留空时用固定的续作要求
    prompt: str = Field(default='', max_length=4000)
    provider: str = ''
    model: str = ''
    action: str = Field(default='continue', pattern='^(continue|discard)$')


@router.post('/jobs/{job_id}/approve-stage')
async def dcc_approve_stage(job_id: str, payload: ApproveStageRequest, request: Request):
    """灰模人工放行：从同一作业的检查点续跑，不新建作业、不重传参考、不丢 source.blend。

    上游四节点「停等用户明确通过」在画布异步节点里的等价物：AI 不阻塞等待，
    用户随时放行，未放行前状态一直是 awaiting_approval 且不会自动导入资产卡片。
    """
    username = _username(request)
    try:
        job = dcc_bridge.load(job_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error))
    if job.get('owner') and job['owner'] != username:
        raise HTTPException(status_code=403, detail='无权访问该作业')
    if job.get('status') not in (blender_modeller.STATUS_AWAITING, blender_modeller.STATUS_DONE):
        raise HTTPException(status_code=409, detail='当前作业不在待审核状态')
    if job.get('running'):
        raise HTTPException(status_code=409, detail='作业仍在运行')

    work = job['dir']
    source = os.path.join(work, 'checkpoints', '01-blockout.glb')
    if not os.path.isfile(source) or os.path.getsize(source) <= 0:
        source = os.path.join(work, 'out', 'model.glb')
    if not os.path.isfile(source) or os.path.getsize(source) <= 0:
        raise HTTPException(status_code=404, detail='灰模检查点不存在')

    if payload.action == 'discard':
        job.update({'status': blender_modeller.STATUS_FAILED, 'stage': '灰模被否决',
                    'error': '用户否决灰模，未进入细化'})
        dcc_bridge.save(job)
        return {'jobId': job_id, 'status': job['status'], 'action': 'discard'}

    staged = os.path.join(work, 'in', '_stage_base.glb')
    os.makedirs(os.path.dirname(staged), exist_ok=True)
    shutil.copy2(source, staged)

    detail = (payload.prompt or '').strip() or (
        '在这个灰模检查点上完成结构、厚度、开口、UV、必要烘焙与材质，'
        '保持已确认的大比例、轮廓与部件位置，不重建整件。')
    # 检查点不是用户既有资产，EDIT_BRIEF 的「保留原材质、只在明确要求时改色」需要显式解绑
    prompt = ('这是本作业刚生成的灰模检查点，不是用户既有资产；允许在保留已确认大比例、'
              '轮廓与部件位置的前提下补齐结构、UV 与材质。\n' + detail)
    try:
        base, headers, model = _main.resolve_chat_provider(payload.provider, payload.model, '')
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=400, detail='模型渠道不可用：%s' % error) from None

    from core.game_role_presets import PRESETS
    preset_id = str(job.get('presetId') or 'default').strip()
    preset = next((item for item in PRESETS
                   if item['id'] == preset_id and 'model' in item['kinds']), None)
    if preset is None:
        preset = next((item for item in PRESETS if item['id'] == 'default'),
                      {'id': 'default', 'name': '通用助手', 'prompt': ''})

    job.update({
        'status': blender_modeller.STATUS_BUILDING,
        'stage': '细化中',
        'mode': 'edit',
        'baseModel': '_stage_base.glb',
        'baseModelLabel': '灰模检查点',
        'blockoutOnly': False,
        'pipelineStage': 'refine',
        'approvedStage': 'blockout',
        'imported': [],
        'error': '',
    })
    job.pop('partial', None)
    blender_modeller.resolve_difference(job, 'stage0_pending')
    dcc_bridge.save(job)
    blender_modeller.start(job_id, prompt, base, headers, model, preset,
                           skill_id=preset['id'],
                           target_tris=int(job.get('targetTris') or 0))
    return {'jobId': job_id, 'status': job['status'], 'action': 'continue',
            'pipelineStage': 'refine'}


def dcc_service(canvas_id, token=''):
    """给画布助手用的工具入口。校验归属，返回一个 duck-typed 的 tools/call 对象。"""
    import main
    username = main.get_username_by_token(token)
    if not username:
        raise HTTPException(status_code=401, detail='请先登录')
    from routers.canvases import load_canvas_any
    canvas = load_canvas_any(canvas_id)
    owner = canvas.get('owner') or ''
    if owner and owner != username:
        raise HTTPException(status_code=403, detail='无权访问该画布')
    return DccService(canvas_id, username)


class DccService:
    """只暴露三个动作：列作业、投递、回收。所有落盘都在 core.dcc_bridge。"""

    def __init__(self, canvas_id, username):
        self.canvas_id = canvas_id
        self.username = username

    def tools(self):
        specs = [
            ('dcc_list_jobs', '列出当前画布的投递作业和已有产物。',
             {'type': 'object', 'properties': {}, 'additionalProperties': False}),
            ('dcc_send_assets', '把画布节点上的本地文件复制到外部软件的作业目录；不会启动软件，节点也不会被修改。',
             {'type': 'object', 'properties': {
                 'target': {'type': 'string', 'enum': list(dcc_bridge.TARGETS)},
                 'nodeIds': {'type': 'array', 'items': {'type': 'string'}, 'maxItems': 32},
                 'note': {'type': 'string'}},
              'required': ['target'], 'additionalProperties': False}),
            ('dcc_import_products', '把作业 out/ 里已存在的产物搬回画布；图片会生成画布节点，模型只进资产目录。',
             {'type': 'object', 'properties': {
                 'jobId': {'type': 'string'},
                 'names': {'type': 'array', 'items': {'type': 'string'}, 'maxItems': 32}},
              'required': ['jobId'], 'additionalProperties': False}),
        ]
        return [{'type': 'function', 'function': {'name': name, 'description': description, 'parameters': schema}}
                for name, description, schema in specs]

    async def call(self, name, arguments):
        canvas = owned_canvas(self.canvas_id, self.username)
        if name == 'dcc_list_jobs':
            jobs = dcc_bridge.list_jobs(canvas_id=self.canvas_id, owner=self.username)
            for job in jobs:
                dcc_bridge.refresh(job)
            return {'jobs': [dcc_bridge.public(job, include_paths=True) for job in jobs]}
        if name == 'dcc_send_assets':
            job, missing = deliver(canvas, self.username, arguments.get('target') or 'blender',
                                   node_ids=arguments.get('nodeIds') or [],
                                   note=arguments.get('note') or '')
            data = dcc_bridge.public(job, include_paths=True)
            data['missing'] = missing
            return data
        if name == 'dcc_import_products':
            try:
                job = dcc_bridge.load(arguments.get('jobId') or '')
            except ValueError as error:
                raise ValueError(str(error))
            if job.get('canvasId') != self.canvas_id:
                raise ValueError('作业不属于当前画布')
            items = collect_into_canvas(canvas, job, arguments.get('names') or [])
            return {'job': dcc_bridge.public(dcc_bridge.load(job['id'])), 'items': items}
        raise ValueError('未知的 DCC 工具')
