"""Card cutouts: reuse ComfyUI RMBG; keep results separate from originals."""
import asyncio
import hashlib
import io
import json
import re
import time
import uuid
from pathlib import Path
from urllib.parse import unquote, urlsplit, parse_qs

import httpx
from fastapi import APIRouter, HTTPException, Request
from PIL import Image, ImageOps
from pydantic import BaseModel, Field
from core.cutout_workflow import load_branch, workflow_methods

router = APIRouter(prefix='/api/image-cutout')
_locks = {}
EXTRA_MODELS = {
    'BiRefNetRMBG': ['Lucida', 'BiRefNet-general', 'BiRefNet-HR-matting', 'BiRefNet_toonout'],
    'SAM3Segment': ['SAM3'],
    'ArtCanvasFeyNoBg': ['FeyNoBg'],
}


class CutoutRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4096)
    prompt: str = Field(default='', max_length=20000)
    model: str = Field(default='auto', max_length=100)
    retry: bool = False
    client_id: str = Field(default='', max_length=100)
    target: str = Field(default='', max_length=2000)


def choose_model(image_bytes, prompt, available):
    """Heuristic only: metadata and plain-background pixels, no vision service."""
    with Image.open(io.BytesIO(image_bytes)) as image:
        if image.width * image.height > 40_000_000:
            raise HTTPException(413, '请将原图缩小到 4000 万像素以内后再抠图')
        image = ImageOps.exif_transpose(image).convert('RGB')
        image.thumbnail((96, 96))
        pixels = image.load()
        w, h = image.size
        edges = [pixels[x, y] for x in range(w) for y in (0, h - 1)]
        edges += [pixels[x, y] for y in range(h) for x in (0, w - 1)]
        mean = [sum(p[c] for p in edges) / len(edges) for c in range(3)]
        plain = sum(sum(abs(p[c] - mean[c]) for c in range(3)) < 65 for p in edges) / len(edges) > .8
    portrait = bool(re.search(r'portrait|person|woman|man\b|girl|boy|hair|fur|人像|人物|女孩|男孩|头发|毛发|宠物', prompt, re.I))
    graphic = bool(re.search(r'icon|logo|product|sticker|illustration|图标|商品|产品|贴纸|插画', prompt, re.I))
    kind = '人物 / 毛发' if portrait else '商品 / 图形 / 简洁背景' if graphic or plain else '通用 / 复杂背景'
    preferred = ['BEN2', 'FeyNoBg', 'INSPYRENET', 'RMBG-2.0', 'BiRefNet-general', 'BEN'] if portrait else (['Lucida', 'BiRefNet_toonout', 'RMBG-2.0', 'BEN2', 'BiRefNet-general', 'BEN'] if graphic else ['RMBG-2.0', 'BiRefNet-general', 'BEN2', 'FeyNoBg', 'BEN'])
    model = next((name for name in preferred if name in available), None)
    if not model:
        model = next((name for name in available if isinstance(name, str) and name != 'SAM3'), None)
    if not model:
        raise HTTPException(503, 'ComfyUI RMBG 节点没有可用模型')
    return model, kind


def workflow(name, model, schema, node_type='RMBG', target=''):
    if node_type == 'workflow':
        graph = load_branch(model)
        method = workflow_methods()[model]
        if method.get('requires_target') and not target.strip():
            raise HTTPException(400, '请填写要保留的目标，例如 person、cat、product')
        for node in graph.values():
            if node['class_type'] == 'LoadImage':
                node['inputs']['image'] = name
            if 'prompt' in node['inputs'] and method.get('requires_target'):
                node['inputs']['prompt'] = target.strip()
        return graph
    branch = model if node_type != 'RMBG' or model == 'RMBG-2.0' else 'BEN2'
    graph = load_branch(branch)
    values = {**graph['1']['inputs'], 'model': model}
    if node_type == 'SAM3Segment':
        if not target.strip():
            raise HTTPException(400, 'SAM3 需要填写要保留的目标，例如 person、cat、logo')
        spec = schema.get('required', {}).get('model_name', [[]])[0]
        values.update(model_name='sam3.1_multiplex_fp16' if 'sam3.1_multiplex_fp16' in spec else spec[0],
                      prompt=target.strip(), output_mode='Merged', confidence_threshold=0.5, device='Auto')
    inputs = {}
    for key, spec in schema.get('required', {}).items():
        if key in values:
            inputs[key] = values[key]
        elif len(spec) > 1 and isinstance(spec[1], dict) and 'default' in spec[1]:
            inputs[key] = spec[1]['default']
        elif isinstance(spec[0], list) and spec[0]:
            inputs[key] = spec[0][0]
        else:
            raise HTTPException(503, f'当前 RMBG 节点有不兼容的必填参数：{key}')
    for key in schema.get('optional', {}):
        if key in values:
            inputs[key] = values[key]
    if (node_type in ('RMBG', 'BiRefNetRMBG') and 'model' not in inputs) or 'image' not in inputs or inputs.get('background') != 'Alpha':
        raise HTTPException(503, '当前 RMBG 节点不支持此透明背景工作流，请更新节点')
    graph['1']['inputs'] = inputs
    graph['3']['inputs']['image'] = name
    return graph


class WorkflowRequest(BaseModel):
    branch: str = 'BEN2'
    params: dict[str, dict] = Field(default_factory=dict)
    use_image_mask: bool = False
    model: str = ''
    image: str = ''
    target: str = ''
    background: str = 'Alpha'
    mask_blur: int = 0
    mask_offset: int = 0
    invert_output: bool = False
    refine_foreground: bool = False


@router.post('/workflow')
async def prepare_workflow(payload: WorkflowRequest):
    """Load only the requested branch; preserve legacy node IDs for callers."""
    import main
    main.account_dirname()
    if payload.model:
        async with httpx.AsyncClient(timeout=20, trust_env=False) as client:
            catalog, _ = await _models(client, 'http://' + main.COMFYUI_ADDRESS)
        selected = catalog.get(payload.model)
        if not selected:
            raise HTTPException(400, '所选抠图方案当前不可用，请检查节点与模型')
        graph = workflow(payload.image, payload.model, selected['schema'], selected['node_type'], payload.target)
        if selected['node_type'] == 'workflow':
            if payload.background != 'Alpha':
                raise HTTPException(400, '此精修方案输出透明 PNG，请选择透明背景')
        else:
            inputs = graph['1']['inputs']
            for key in ('mask_blur', 'mask_offset', 'invert_output', 'refine_foreground'):
                if key in inputs:
                    inputs[key] = getattr(payload, key)
            inputs['background'] = 'Alpha' if payload.background == 'Alpha' else 'Color'
            inputs['background_color'] = '#fbfaf9' if payload.background == 'White' else '#0b0b0a'
        return {'workflow': graph}
    try:
        graph = load_branch(payload.branch)
    except KeyError as exc:
        raise HTTPException(400, '抠图工作流分支不存在') from exc
    for node_id, values in payload.params.items():
        if node_id not in graph or any(key not in graph[node_id]['inputs'] for key in values):
            raise HTTPException(400, '抠图参数不存在')
        if any(isinstance(value, (dict, list)) for value in values.values()):
            raise HTTPException(400, '抠图参数只支持普通值')
        graph[node_id]['inputs'].update(values)
    if payload.branch == 'sdmatte' and payload.use_image_mask:
        graph['73'] = {'class_type': 'Mask Fill Holes', 'inputs': {'masks': ['1', 1]}}
    return {'workflow': graph}


def _paths(main, source):
    key = hashlib.sha256(source.encode()).hexdigest()
    directory = Path(main.account_data_dir()) / 'cutouts'
    directory.mkdir(parents=True, exist_ok=True)
    return key, directory / (key + '.json')


def _read(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def _versions(result):
    versions = list((result or {}).get('versions', []))
    if result and result.get('status') == 'done' and not any(v['url'] == result['url'] for v in versions):
        versions.append({**{key: result[key] for key in ('url', 'model', 'kind', 'created_at')},
                         'selection': result.get('selection', 'auto'), 'target': result.get('target', '')})
    return versions


async def _models(client, base):
    node_types = ['RMBG', *EXTRA_MODELS]
    responses = await asyncio.gather(*(_json(client, 'GET', base + '/object_info/' + node) for node in node_types))
    catalog = {}
    for node_type, info in zip(node_types, responses):
        if node_type not in info:
            continue
        schema = info[node_type].get('input', {})
        spec = schema.get('required', {}).get('model') or schema.get('optional', {}).get('model') or [[]]
        choices = spec[0] if isinstance(spec[0], list) else []
        names = choices if node_type == 'RMBG' else EXTRA_MODELS[node_type]
        for name in names:
            if node_type == 'BiRefNetRMBG' and name not in choices:
                continue
            catalog[name] = {'node_type': node_type, 'schema': schema, 'requires_target': name == 'SAM3'}
    methods = workflow_methods()
    needed = sorted({node['class_type'] for key in methods for node in load_branch(key).values()})
    extra = await asyncio.gather(*(_json(client, 'GET', base + '/object_info/' + node) for node in needed))
    available = {key: value for info in extra for key, value in info.items()}
    for key, method in methods.items():
        graph = load_branch(key)
        if all(_compatible_node(node, available.get(node['class_type'])) for node in graph.values()):
            catalog[key] = {'node_type': 'workflow', 'schema': {}, **method}
    if not catalog:
        raise HTTPException(503, '未检测到支持的抠图节点，请安装 ComfyUI-RMBG')
    return catalog, list(catalog)


def _compatible_node(node, info):
    if not info:
        return False
    schema = info.get('input', {})
    specs = {**schema.get('required', {}), **schema.get('optional', {})}
    if not set(schema.get('required', {})) <= node['inputs'].keys():
        return False
    for name, value in node['inputs'].items():
        spec = specs.get(name)
        if not spec:
            return False
        if node['class_type'] == 'LoadImage' and name == 'image':
            continue
        options = spec[0] if isinstance(spec[0], list) else (spec[1].get('options') if len(spec) > 1 else None)
        if options is not None and value not in options:
            return False
    return True


def _task_progress(queue, prompt_id):
    for position, task in enumerate(queue.get('queue_pending', []), 1):
        if task[1] == prompt_id:
            return {'label': f'等待 ComfyUI，队列第 {position} 位', 'stage': 'queued'}
    if any(task[1] == prompt_id for task in queue.get('queue_running', [])):
        return {'label': '正在抠图（加载模型 / 推理处理中）', 'stage': 'running'}
    return {'label': '等待 ComfyUI 返回结果', 'stage': 'processing'}


def _source(main, url):
    parsed = urlsplit(url)
    if parsed.scheme or parsed.netloc:
        raise HTTPException(400, '请先将图片保存到本工具，再进行抠图')
    clean = unquote(parsed.path).replace('\\', '/')
    if clean.startswith(('/output/', '/assets/')):
        path = main.output_file_from_url(parsed.path)
        if not path or not Path(path).is_file():
            raise HTTPException(404, '原图不存在')
        root = main.OUTPUT_DIR if clean.startswith('/output/') else (main.ASSETS_DIR if Path(main.ASSETS_DIR).is_dir() else main.INPUT_DIR)
        main.assert_account_media(Path(path).resolve().relative_to(Path(root).resolve()).as_posix())
        stat = Path(path).stat()
        return path, f'{clean}:{stat.st_mtime_ns}:{stat.st_size}'
    if parsed.path == '/api/comfyui/view':
        return None, url
    raise HTTPException(400, '此图片来源暂不支持一键抠图')


async def _json(client, method, url, **kwargs):
    response = await client.request(method, url, **kwargs)
    if response.is_error:
        raise HTTPException(502, 'ComfyUI 请求失败，请检查服务与 RMBG 节点：' + response.text[:400])
    return response.json()


@router.post('')
async def start_cutout(payload: CutoutRequest, request: Request):
    import main
    main.ensure_same_origin_request(request)
    path, source = _source(main, payload.url)
    key, manifest = _paths(main, source)
    # One lock per account/source prevents double clicks across tabs from submitting twice.
    lock = _locks.setdefault(str(manifest), asyncio.Lock())
    async with lock:
        existing = _read(manifest)
        if not payload.retry and existing and existing['status'] == 'done' and main.output_file_from_url(existing['url']):
            return existing
        if existing and existing['status'] == 'processing' and time.time() - existing['created_at'] < 1800:
            if payload.retry:
                raise HTTPException(409, '这张图片正在抠图，请等待当前任务完成后再换模型')
            return existing
        versions = _versions(existing)
        if not payload.retry and versions and main.output_file_from_url(versions[-1]['url']):
            return {**existing, **versions[-1], 'status': 'done', 'versions': versions}
        if not main.COMFYUI_ADDRESS:
            raise HTTPException(503, '请先启动并配置 ComfyUI')
        base = 'http://' + main.COMFYUI_ADDRESS
        try:
            async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
                catalog, models = await _models(client, base)
                if payload.model != 'auto' and payload.model not in models:
                    raise HTTPException(400, '所选模型当前不可用，请刷新模型列表后重试')
                if path:
                    if Path(path).stat().st_size > 40 * 1024 * 1024:
                        raise HTTPException(413, '抠图原图不能超过 40 MB')
                    data = await asyncio.to_thread(Path(path).read_bytes)
                else:
                    params = {k: v[0] for k, v in parse_qs(urlsplit(payload.url).query).items() if k in ('filename', 'subfolder', 'type')}
                    response = await client.get(base + '/view', params=params)
                    response.raise_for_status()
                    data = response.content
                if len(data) > 40 * 1024 * 1024:
                    raise HTTPException(413, '抠图原图不能超过 40 MB')
                if payload.model == 'auto':
                    automatic = [name for name in models if not catalog[name].get('requires_target')]
                    model, kind = await asyncio.to_thread(choose_model, data, payload.prompt, automatic)
                else:
                    model, kind = payload.model, '指定目标' if catalog[payload.model].get('requires_target') else '手动抠图'
                selected = catalog[model]
                graph = workflow('pending.png', model, selected['schema'], selected['node_type'], payload.target)
                uploaded = await _json(client, 'POST', base + '/upload/image', files={'image': ('cutout_' + key + '.png', data, 'application/octet-stream')}, data={'overwrite': 'true'})
                name = '/'.join(filter(None, [uploaded.get('subfolder'), uploaded['name']]))
                for node in graph.values():
                    if node['class_type'] == 'LoadImage':
                        node['inputs']['image'] = name
                task = await _json(client, 'POST', base + '/prompt', json={'prompt': graph, 'client_id': payload.client_id or uuid.uuid4().hex})
                if not task.get('prompt_id') or task.get('node_errors'):
                    raise HTTPException(502, 'ComfyUI 拒绝了抠图工作流：' + str(task.get('node_errors', '无任务 ID'))[:400])
                result = {'id': key, 'status': 'processing', 'prompt_id': task['prompt_id'],
                          'model': model, 'kind': kind, 'created_at': time.time(), 'server': base,
                          'selection': 'auto' if payload.model == 'auto' else 'manual',
                          'attempt': uuid.uuid4().hex, 'versions': versions, 'available_models': models,
                          'target': payload.target.strip() if selected.get('requires_target') else '',
                          'progress': {'stage': 'queued', 'label': '已提交，等待 ComfyUI 处理'}}
                main.atomic_write_json(str(manifest), result, ensure_ascii=False)
                return result
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(502, f'无法提交抠图，请检查 ComfyUI：{exc}') from exc


@router.get('/models')
async def cutout_models():
    import main
    main.account_dirname()
    if not main.COMFYUI_ADDRESS:
        raise HTTPException(503, '请先启动并配置 ComfyUI')
    try:
        async with httpx.AsyncClient(timeout=15, trust_env=False) as client:
            catalog, models = await _models(client, 'http://' + main.COMFYUI_ADDRESS)
            return {'models': models, 'labels': {name: item.get('label', name) for name, item in catalog.items()},
                    'target_models': [name for name, item in catalog.items() if item.get('requires_target')],
                    'workflow_models': [name for name, item in catalog.items() if item['node_type'] == 'workflow']}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f'读取抠图模型失败：{exc}') from exc


@router.get('/{key}')
async def cutout_status(key: str):
    import main
    if not re.fullmatch(r'[0-9a-f]{64}', key):
        raise HTTPException(404, '抠图任务不存在')
    manifest = Path(main.account_data_dir()) / 'cutouts' / (key + '.json')
    async with _locks.setdefault(str(manifest), asyncio.Lock()):
        result = _read(manifest)
        if not result:
            raise HTTPException(404, '抠图任务不存在')
        if result['status'] != 'processing':
            return result
        try:
            async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
                history = await _json(client, 'GET', result['server'] + '/history/' + result['prompt_id'])
                task = history.get(result['prompt_id'])
                if not task:
                    # ponytail: RMBG may emit no numerical progress; show real queue state, never an invented percentage.
                    try:
                        queue = await _json(client, 'GET', result['server'] + '/queue')
                        result['progress'] = _task_progress(queue, result['prompt_id'])
                    except (HTTPException, httpx.HTTPError):
                        result['progress'] = {'stage': 'processing', 'label': '正在等待抠图结果'}
                if task and task.get('status', {}).get('status_str') == 'error':
                    result.update(status='error', error='ComfyUI 抠图执行失败，请检查模型文件、显存与节点日志')
                elif task and task.get('outputs', {}).get('5', {}).get('images'):
                    image = task['outputs']['5']['images'][0]
                    response = await client.get(result['server'] + '/view', params={k: image.get(k, '') for k in ('filename', 'subfolder', 'type')})
                    response.raise_for_status()
                    # Re-encode as PNG to guarantee a persistent transparent image.
                    def save():
                        directory = Path(main.OUTPUT_DIR) / main.account_dirname() / '抠图'
                        directory.mkdir(parents=True, exist_ok=True)
                        filename = key + '_' + result.get('attempt', 'original') + '.png'
                        with Image.open(io.BytesIO(response.content)) as img:
                            img.convert('RGBA').save(directory / filename, 'PNG')
                        return '/output/' + main.account_dirname() + '/抠图/' + filename
                    result.update(status='done', url=await asyncio.to_thread(save))
                    result['progress'] = {'stage': 'done', 'label': '抠图完成', 'value': 100}
                    result['versions'] = _versions(result)
                elif time.time() - result['created_at'] >= 1800:
                    result.update(status='error', error='任务等待超过 30 分钟，可能已被取消或 ComfyUI 已重启，请重试')
                main.atomic_write_json(str(manifest), result, ensure_ascii=False)
                return result
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(502, f'读取抠图结果失败：{exc}') from exc
