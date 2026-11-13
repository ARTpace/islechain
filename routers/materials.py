"""Canvas-owned PBR jobs and explicit, at-most-once Designer imports."""
import asyncio
import hashlib
import json
import os
import threading
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from core import material_maps
from core.material_designer import Designer
from core.node_media import image_bytes
from core.user_paths import user_data_dir

router = APIRouter(prefix='/api/materials', tags=['materials'])
_lock = threading.RLock()
_active = set()
_designer_active = set()
_tasks = set()


@router.get('/presets')
async def material_presets(request: Request):
    _username(request)
    from core.material_presets import presets
    return {'presets': presets()}


def _username(request):
    from routers.dcc_bridge import _username as authenticate
    return authenticate(request)


def owned_canvas(canvas_id, username):
    from routers.dcc_bridge import owned_canvas as resolve
    return resolve(canvas_id, username)


class PrepareRequest(BaseModel):
    requestId: str = Field(pattern=r'^[a-f0-9]{32}$')
    colorUrl: str = Field(min_length=1, max_length=4096)
    normalUrl: str = Field(default='', max_length=4096)
    size: Literal[512, 1024] = 1024
    normalFormat: Literal['opengl', 'directx'] = 'opengl'
    roughness: float = Field(default=.66, ge=0, le=1, allow_inf_nan=False)
    metallic: float = Field(default=0, ge=0, le=1, allow_inf_nan=False)


def _state_file(canvas, job_id):
    if len(job_id) != 32 or any(c not in '0123456789abcdef' for c in job_id):
        raise HTTPException(400, '无效材质任务 ID')
    key = hashlib.sha256((str(canvas.get('owner', ''))+'\0'+str(canvas['id'])).encode()).hexdigest()
    return Path(user_data_dir())/'material-jobs'/key/(job_id+'.json')


def _write(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(state, ensure_ascii=False), encoding='utf-8')
    os.replace(temp, path)


def _read(path):
    if not path.exists():
        raise HTTPException(404, '材质任务不存在')
    return json.loads(path.read_text(encoding='utf-8'))


def _locations(canvas, job_id):
    from routers.canvases import get_canvas_asset_dir, build_asset_url
    relative = 'materials/'+job_id
    return Path(get_canvas_asset_dir(canvas))/relative, build_asset_url(canvas, relative)


def _source(canvas, url):
    from routers.canvases import local_media_path_from_url, json_references_media_path, INPUT_DIR, OUTPUT_DIR, OUTPUT_OUTPUT_DIR
    from routers.dcc_bridge import _main
    path = local_media_path_from_url(url)
    if not path or not json_references_media_path(canvas, path):
        raise HTTPException(403, '请选择已保存在当前画布中的本地图片')
    path = Path(path).resolve()
    owner = canvas.get('owner')
    if not owner:
        raise HTTPException(403, '请先保存为自己的画布')
    folder = _main.get_user_dirname(owner)
    roots = [Path(root)/folder for root in (INPUT_DIR, OUTPUT_DIR, OUTPUT_OUTPUT_DIR)]
    roots.append(Path(OUTPUT_DIR)/('node-'+hashlib.sha256(owner.encode()).hexdigest()))
    if not any(path.is_relative_to(root.resolve()) for root in roots):
        raise HTTPException(403, '图片不属于当前账号，请先导入到当前画布')
    if not path.is_file() or path.stat().st_size > 8*1024*1024:
        raise HTTPException(400, '图片不存在或超过 8 MiB')
    try:
        return image_bytes(path.read_bytes())[0]
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _launch(coroutine):
    task = asyncio.create_task(coroutine)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _prepare(path, directory, url, payload):
    try:
        result = await asyncio.to_thread(material_maps.prepare, directory/'color_input.png', directory/'normal_input.png' if payload.normalUrl else None,
                                         directory/'maps', size=payload.size, normal_format=payload.normalFormat,
                                         roughness=payload.roughness, metallic=payload.metallic)
        result['maps'] = {name: url+'/maps/'+name+'.png' for name in material_maps.CHANNELS}
        result['previews'] = {name: url+'/maps/'+name for name in ('basecolor_2x2.jpg', 'normal_2x2.jpg', 'basecolor_offset.png', 'normal_offset.png')}
        with _lock:
            state = _read(path)
            state.update(status='succeeded', result=result, updatedAt=time.time())
            _write(path, state)
    except Exception as exc:
        with _lock:
            state = _read(path)
            state.update(status='failed', error=str(exc)[:400], updatedAt=time.time())
            _write(path, state)
    finally:
        with _lock:
            _active.discard(str(path))


@router.get('/designer/status')
async def designer_status(request: Request):
    _username(request)
    try:
        slug = await asyncio.to_thread(Designer().connect)
        return {'connected': True, 'instance': slug.split('.')[1]}
    except Exception:
        return {'connected': False, 'message': '请启动 Designer、启用 MCP 插件并启动本机 9765 网关'}


@router.post('/{canvas_id}/jobs')
async def prepare(canvas_id: str, payload: PrepareRequest, request: Request):
    canvas = owned_canvas(canvas_id, _username(request))
    path = _state_file(canvas, payload.requestId)
    fingerprint = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
    with _lock:
        if path.exists():
            state = _read(path)
            if state['fingerprint'] != fingerprint:
                raise HTTPException(409, '该任务 ID 已绑定其他输入，请创建新的计算任务')
            return state
        if sum(1 for task in _active) >= 2:
            raise HTTPException(429, '材质计算繁忙，请等待当前任务完成')
        color = _source(canvas, payload.colorUrl)
        normal = _source(canvas, payload.normalUrl) if payload.normalUrl else None
        directory, url = _locations(canvas, payload.requestId)
        directory.mkdir(parents=True, exist_ok=False)
        (directory/'color_input.png').write_bytes(color)
        if normal is not None:
            (directory/'normal_input.png').write_bytes(normal)
        state = {'id': payload.requestId, 'fingerprint': fingerprint, 'inputs': payload.model_dump(),
                 'status': 'running', 'createdAt': time.time(), 'designer': {'status': 'not_sent'}}
        _write(path, state)
        _active.add(str(path))
        _launch(_prepare(path, directory, url, payload))
        return state


def _refresh_designer(state, directory, url):
    designer = state['designer']
    if designer['status'] not in ('submitting', 'pending', 'unknown'):
        return False
    rendered = directory/'designer_render'
    names = ['BaseColor', 'Normal', 'Height', 'AmbientOcclusion', 'Roughness', 'Metallic']
    if (directory/'material.sbs').is_file() and all((rendered/('canvas_material_'+name+'.png')).is_file() for name in names):
        from PIL import Image
        try:
            for name in names:
                with Image.open(rendered/('canvas_material_'+name+'.png')) as im:
                    im.load()
                    if list(im.size) != state['result']['size']:
                        return False
        except OSError:
            return False
        designer.update(status='completed', packageUrl=url+'/material.sbs', message='工程已保存且六张贴图已计算导出；请在 Designer 查看实际预览')
        return True
    return False


@router.get('/{canvas_id}/jobs/{job_id}')
async def job_status(canvas_id: str, job_id: str, request: Request):
    canvas = owned_canvas(canvas_id, _username(request))
    path = _state_file(canvas, job_id)
    with _lock:
        state = _read(path)
        if state['status'] == 'running' and str(path) not in _active:
            state.update(status='interrupted', error='服务已重启，原计算中断；可创建新任务重新计算')
        directory, url = _locations(canvas, job_id)
        if state['designer']['status'] == 'connecting' and str(path) not in _designer_active:
            state['designer'] = {'status': 'unavailable', 'message': '连接时服务已重启，尚未提交，可重试导入'}
            _write(path, state)
        if _refresh_designer(state, directory, url):
            _write(path, state)
        return state


async def _send_designer(path, directory):
    try:
        client = Designer()
        await asyncio.to_thread(client.connect)
        # Persist intent BEFORE crossing the mutating boundary. A crash/timeout is not a retry.
        with _lock:
            state = _read(path)
            state['designer'] = {'status': 'submitting', 'message': '正在提交到 Designer，请勿重复导入'}
            _write(path, state)
        result = await asyncio.to_thread(client.create, directory, directory/'maps')
        with _lock:
            state = _read(path)
            state['designer'] = {'status': 'pending', 'jobId': result.get('output', {}).get('job_id'),
                                 'message': 'Designer 已接收，等待工程与导出文件；不会自动重复提交'}
            _write(path, state)
    except Exception:
        with _lock:
            state = _read(path)
            uncertain = state['designer']['status'] == 'submitting'
            state['designer'] = {'status': 'unknown' if uncertain else 'unavailable',
                                 'message': '提交结果未知，请先检查 Designer；禁止重复导入此任务' if uncertain else '未提交：请检查 Designer 和 MCP 网关连接后重试'}
            _write(path, state)
    finally:
        with _lock:
            _designer_active.discard(str(path))


@router.post('/{canvas_id}/jobs/{job_id}/designer')
async def import_designer(canvas_id: str, job_id: str, request: Request):
    canvas = owned_canvas(canvas_id, _username(request))
    path = _state_file(canvas, job_id)
    with _lock:
        state = _read(path)
        if state['status'] != 'succeeded':
            raise HTTPException(409, '请先完成 PBR 计算')
        if state['designer']['status'] not in ('not_sent', 'unavailable'):
            return state
        state['designer'] = {'status': 'connecting', 'message': '正在连接 Designer'}
        _write(path, state)
        directory, _ = _locations(canvas, job_id)
        _designer_active.add(str(path))
        _launch(_send_designer(path, directory))
        return state
