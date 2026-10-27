"""Only local, same-origin clients can control the separately installed trainer."""
import asyncio
from pathlib import Path
import subprocess

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from tools.training_bridge import TrainingClient, TrainingError, load_settings, local_url, save_settings


def local_request(request: Request):
    host = request.url.hostname
    if not request.client or request.client.host not in ('127.0.0.1', '::1') or host not in ('127.0.0.1', 'localhost'):
        raise HTTPException(403, '模型训练仅允许本机访问')
    origin = request.headers.get('origin')
    expected = f'{request.url.scheme}://{request.url.netloc}'
    if origin and origin != expected:
        raise HTTPException(403, '训练操作不允许跨站请求')
    if request.headers.get('sec-fetch-site') == 'cross-site':
        raise HTTPException(403, '训练操作不允许跨站请求')
    if request.method != 'GET' and request.headers.get('x-art-training') != '1':
        raise HTTPException(403, '请通过模型训练页面操作')


router = APIRouter(prefix='/api/training', dependencies=[Depends(local_request)])
_client = None
_client_config = None
_process = None
_launch_lock = asyncio.Lock()


def settings_path():
    import main
    return Path(main.USER_DATA_DIR) / 'training-connection.json'


def defaults():
    return {'url': 'http://127.0.0.1:19366/mcp', 'token': '',
            'install_dir': str(Path(__file__).resolve().parents[2] / 'Kohya-LoRA-Tool')}


def settings():
    return {**defaults(), **load_settings(settings_path())}


def get_client():
    global _client, _client_config
    config = settings()
    if not config['token']:
        raise TrainingError('请在训练器中开启本机 MCP，将连接地址和密钥保存到这里。')
    identity = (config['url'], config['token'])
    if _client is None or identity != _client_config:
        _client = TrainingClient(*identity)
        _client_config = identity
    return _client


@router.get('/connection')
async def connection():
    config = settings()
    return {'url': config['url'], 'has_token': bool(config['token']), 'install_dir': config['install_dir']}


class Connection(BaseModel):
    url: str = Field(default='http://127.0.0.1:19366/mcp', max_length=256)
    token: str | None = Field(default=None, max_length=512)
    install_dir: str = Field(default='', max_length=2048)


@router.post('/connection')
async def configure(payload: Connection):
    global _client, _client_config
    config = settings()
    try:
        config['url'] = local_url(payload.url)
    except TrainingError as exc:
        raise HTTPException(400, str(exc)) from None
    if payload.token is not None:
        config['token'] = payload.token.strip().removeprefix('Bearer ').strip()
        if any(ord(char) < 32 or ord(char) > 126 for char in config['token']):
            raise HTTPException(400, '连接密钥格式无效，请从训练器重新复制')
    config['install_dir'] = payload.install_dir.strip() or defaults()['install_dir']
    save_settings(settings_path(), config)
    _client = _client_config = None
    return {'ok': True, 'has_token': bool(config['token'])}


@router.post('/connect')
async def connect():
    try:
        client = get_client()
        environment = await client.call('get_environment', {})
        catalog = await client.catalog()
        return {'online': environment.get('ok') is not False, 'environment': environment, 'tools': catalog}
    except TrainingError as exc:
        return {'online': False, 'message': str(exc)}


class Operation(BaseModel):
    name: str = Field(max_length=80)
    arguments: dict = Field(default_factory=dict)


@router.post('/call')
async def call(payload: Operation):
    try:
        return await get_client().call(payload.name, payload.arguments)
    except TrainingError as exc:
        raise HTTPException(502, str(exc)) from None


@router.post('/launch')
async def launch():
    global _process
    async with _launch_lock:
        if _process and _process.poll() is None:
            return {'ok': True, 'message': '训练器已经启动，请在桌面查看。'}
        directory = Path(settings()['install_dir']).expanduser().resolve()
        # Only the official desktop launcher; never accept shell commands or script arguments.
        candidates = [directory / name for name in ('Kohya一键工具.exe', 'Kohya一键启动.exe', 'KohyaLoraTool.exe', 'Kohya-LoRA-Tool.exe')]
        executable = next((path for path in candidates if path.is_file()), None)
        if not executable:
            raise HTTPException(400, '未找到训练器启动程序，请选择解压后的便携版目录。')
        try:
            _process = subprocess.Popen([str(executable)], cwd=str(directory), shell=False,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except OSError:
            raise HTTPException(500, '启动失败，请从训练器目录手动启动。') from None
        return {'ok': True, 'message': '已启动独立训练器。请在训练器的“外部 Agent · MCP”中开启接口并复制连接配置。'}
