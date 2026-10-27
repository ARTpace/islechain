"""Local Kohya MCP client. No trainer dependency is imported into art-canvas."""
import asyncio
import json
from pathlib import Path
import secrets
from urllib.parse import urlsplit

import httpx


class TrainingError(Exception):
    pass


TOOLS = frozenset((
    'get_environment', 'list_projects', 'get_project', 'inspect_dataset', 'prepare_training',
    'get_task', 'inspect_task_dataset', 'list_samples', 'training_history', 'get_diagnostics',
    'list_models', 'create_project', 'update_project', 'prepare_data', 'start_training',
    'continue_training', 'cancel_task', 'prepare_environment', 'download_model',
))


def local_url(value):
    try:
        url = urlsplit(value)
        if (url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost') or
                url.username or url.password or url.path != '/mcp' or url.query or url.fragment or not url.port):
            raise ValueError()
        return f'http://127.0.0.1:{url.port}/mcp'
    except (ValueError, TypeError, AttributeError):
        raise TrainingError('训练器地址仅支持 http://127.0.0.1:端口/mcp') from None


def save_settings(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + secrets.token_hex(4) + '.tmp')
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def load_settings(path):
    try:
        result = json.loads(Path(path).read_text(encoding='utf-8'))
        return result if isinstance(result, dict) else {}
    except (OSError, ValueError):
        return {}


class TrainingClient:
    def __init__(self, url, token, transport=None):
        self.url = local_url(url)
        self.token = token
        self.transport = transport
        self.session = ''
        self.version = '2025-11-25'
        self.lock = asyncio.Lock()

    def redact(self, value):
        if isinstance(value, str):
            return value.replace(self.token, '<REDACTED>') if self.token else value
        if isinstance(value, dict):
            return {key: self.redact(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self.redact(item) for item in value]
        return value

    async def _rpc(self, client, method, params=None, notification=False):
        headers = {'Authorization': 'Bearer ' + self.token, 'Accept': 'application/json'}
        if self.session:
            headers.update({'Mcp-Session-Id': self.session, 'MCP-Protocol-Version': self.version})
        body = {'jsonrpc': '2.0', 'method': method, 'params': params or {}}
        if not notification:
            body['id'] = secrets.token_hex(8)
        try:
            response = await client.post(self.url, json=body, headers=headers)
        except httpx.TimeoutException:
            raise TrainingError('训练器响应超时。若刚执行启动操作，请先查询任务状态，不要重复启动。') from None
        except httpx.HTTPError:
            self.session = ''
            raise TrainingError('无法连接训练器，请确认程序已运行且本机 MCP 已开启。') from None
        if response.status_code in (401, 403):
            self.session = ''
            raise TrainingError('训练器拒绝连接，请重新复制 MCP 配置并检查接口开关。')
        if response.status_code == 404:
            self.session = ''
            raise TrainingError('训练器连接已失效或地址不正确，请重新检测连接；修改操作不会自动重发。')
        if not response.is_success:
            raise TrainingError(f'训练器返回 HTTP {response.status_code}，请查看训练器日志。')
        if notification:
            return {}
        try:
            data = response.json()
            if not isinstance(data, dict) or data.get('id') != body['id']:
                raise ValueError()
            if data.get('error'):
                raise TrainingError('训练器协议错误：' + str(self.redact(data['error'].get('message', '未知错误'))))
            result = data['result']
            if not isinstance(result, dict):
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise TrainingError('训练器返回格式不兼容，请更新训练器后重试。') from None
        if method == 'initialize':
            self.session = response.headers.get('Mcp-Session-Id', '')
            self.version = result.get('protocolVersion', '')
            if not self.session or self.version not in ('2025-03-26', '2025-06-18', '2025-11-25') or result.get('serverInfo', {}).get('name') != 'kohya-lora':
                self.session = ''
                raise TrainingError('此地址不是兼容的 Kohya-LoRA Tool MCP 服务。')
        return self.redact(result)

    async def request(self, method, params=None):
        # ponytail: one session per configured trainer; serialized calls, no automatic mutation replay.
        async with self.lock:
            async with httpx.AsyncClient(timeout=45, trust_env=False, follow_redirects=False, transport=self.transport) as client:
                if not self.session:
                    await self._rpc(client, 'initialize', {'protocolVersion': '2025-11-25', 'capabilities': {},
                        'clientInfo': {'name': 'art-canvas-training', 'version': '1.0'}})
                    await self._rpc(client, 'notifications/initialized', notification=True)
                return await self._rpc(client, method, params)

    async def catalog(self):
        result = await self.request('tools/list')
        return [entry for entry in result.get('tools', []) if isinstance(entry, dict) and entry.get('name') in TOOLS]

    async def call(self, name, arguments):
        if name not in TOOLS or not isinstance(arguments, dict):
            raise TrainingError('不支持的训练操作')
        result = await self.request('tools/call', {'name': name, 'arguments': arguments})
        data = result.get('structuredContent')
        if data is None:
            try:
                data = json.loads(next(item['text'] for item in result.get('content', []) if item.get('type') == 'text'))
            except (StopIteration, ValueError, KeyError, TypeError):
                raise TrainingError('训练器未返回结构化结果') from None
        if not isinstance(data, dict):
            raise TrainingError('训练器返回了无效结果')
        return data
