"""Local-only bridge to the vendored, single-operator Tripo Studio."""
import asyncio
import json
import os
import secrets
import shutil
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

router = APIRouter()
_ROOT = Path(__file__).resolve().parents[1]
_DATA_DIRECTORY = _ROOT / 'data' / 'tripo-studio'
_lock = asyncio.Lock()
_process = None
_port = None
_token = secrets.token_hex(32)


def assert_local(request):
    host = request.url.hostname
    if (not request.client or request.client.host not in ('127.0.0.1', '::1', '::ffff:127.0.0.1')
            or host not in ('localhost', '127.0.0.1', '::1')
            or any(h in request.headers for h in ('forwarded', 'x-forwarded-for', 'x-forwarded-host', 'cf-connecting-ip'))):
        raise HTTPException(403, 'Tripo Studio 仅限本机直连使用')
    origin = request.headers.get('origin')
    if origin and origin != str(request.base_url).rstrip('/'):
        raise HTTPException(403, '请求来源不匹配')
    if request.headers.get('sec-fetch-site') not in (None, 'same-origin', 'none'):
        raise HTTPException(403, '拒绝跨站访问')


async def stop():
    global _process, _port
    if _process and _process.returncode is None:
        _process.terminate()
        try:
            await asyncio.wait_for(_process.wait(), 5)
        except asyncio.TimeoutError:
            _process.kill()
            await _process.wait()
    _process = _port = None


async def start():
    global _process, _port
    async with _lock:
        if _process and _process.returncode is None:
            return _port
        node = shutil.which('node')
        if not node:
            raise HTTPException(503, 'Tripo Studio 需要 Node.js 20 或更新版本')
        env = {**os.environ, 'ART_CANVAS_TRIPO_TOKEN': _token,
               'TRIPO_STUDIO_DATA_DIR': str(_DATA_DIRECTORY)}
        _process = await asyncio.create_subprocess_exec(
            node, str(_ROOT / 'tools/tripo-studio/art-canvas-server.mjs'),
            env=env, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            creationflags=0x08000000 if os.name == 'nt' else 0)
        try:
            ready = await asyncio.wait_for(_process.stdout.readline(), 15)
            _port = int(json.loads(ready)['port'])
        except Exception:
            await stop()
            raise HTTPException(503, 'Tripo Studio 启动失败，请检查 Node.js 与应用构建文件')
        return _port


@router.api_route('/tripo-studio/{path:path}', methods=['GET', 'HEAD'])
@router.api_route('/dsh-tripo-studio/{path:path}', methods=['GET', 'HEAD', 'POST', 'PUT', 'DELETE'])
async def bridge(request: Request, path: str):
    assert_local(request)
    if int(request.headers.get('content-length', '0')) > 30 * 1024 ** 2:
        raise HTTPException(413, '请求过大')
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > 30 * 1024 ** 2:
            raise HTTPException(413, '请求过大')
        chunks.append(chunk)
    port = await start()
    headers = {k: v for k, v in request.headers.items()
               if k.lower() in ('content-type', 'host', 'origin', 'sec-fetch-site', 'x-tripo-studio', 'x-tripo-csrf', 'x-tripo-site')}
    headers['x-art-canvas-tripo'] = _token
    client = httpx.AsyncClient(timeout=httpx.Timeout(180, connect=5), trust_env=False)
    try:
        url = f'http://127.0.0.1:{port}{request.url.path}'
        if request.url.query:
            url += '?' + request.url.query
        response = await client.send(client.build_request(request.method, url, headers=headers,
                                                          content=b''.join(chunks)), stream=True)
    except httpx.HTTPError:
        await client.aclose()
        raise HTTPException(502, 'Tripo Studio 请求失败；未自动重试，请检查原任务状态')

    async def close():
        await response.aclose()
        await client.aclose()

    allowed = ('content-type', 'content-length', 'content-disposition', 'cache-control',
               'x-content-type-options', 'content-security-policy')
    return StreamingResponse(response.aiter_raw(), status_code=response.status_code,
                             headers={k: v for k, v in response.headers.items() if k in allowed},
                             background=BackgroundTask(close))
