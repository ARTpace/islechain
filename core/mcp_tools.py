"""Explicitly configured MCP tools, using the official SDK (no shell command strings)."""
import asyncio
from contextlib import AsyncExitStack, asynccontextmanager
from datetime import timedelta
import hashlib
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator

from tools.training_bridge import load_settings, save_settings


class MCPError(ValueError):
    pass


class Server(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,64}$')
    transport: str = 'http'
    url: str = Field(default='', max_length=2048)
    command: str = Field(default='', max_length=2048)
    args: list[str] = Field(default_factory=list, max_length=64)
    env: dict[str, str] = Field(default_factory=dict)
    headers: dict[str, str] = Field(default_factory=dict)
    cwd: str | None = None
    enabled: bool = True
    enabledTools: list[str] = Field(default_factory=list, max_length=128)
    gameEnabled: bool = False
    # The user explicitly trusts this service; skip per-call approval for its tools.
    trustTools: bool = False

    @model_validator(mode='after')
    def validate_transport(self):
        if self.transport not in ('http', 'sse', 'stdio'):
            raise ValueError('transport 仅支持 http、sse、stdio')
        if self.transport == 'stdio':
            if not self.command.strip() or '\n' in self.command or '\r' in self.command:
                raise ValueError('stdio 需要可执行文件 command；参数单独放入 args')
            if self.cwd and not Path(self.cwd).is_dir():
                raise ValueError('cwd 目录不存在')
        else:
            url = urlsplit(self.url)
            if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.fragment:
                raise ValueError('需要有效的 HTTP(S) 地址；认证请使用 headers')
        if any(re.search(r'[\r\n]', key + value) for key, value in self.headers.items()):
            raise ValueError('请求头包含非法换行')
        return self


def settings_path():
    from core.user_paths import user_data_dir
    return Path(user_data_dir()) / 'mcp-servers.json'


def servers():
    import os
    from core.node_credentials import unprotect
    items, legacy = [], False
    for stored in load_settings(settings_path()).get('servers', []):
        item = dict(stored)
        credentials = item.pop('credentials', None)
        if credentials:
            item.update(json.loads(unprotect(credentials, 'mcp-server:' + item['id'])))
        elif item.get('headers') or item.get('env'):
            legacy = True
        items.append(Server.model_validate(item))
    if legacy and os.name == 'nt':
        _save_servers(items)
    return items


def _save_servers(items):
    from core.node_credentials import protect
    records = []
    for item in items:
        record = item.model_dump(exclude={'headers', 'env'})
        if item.headers or item.env:
            record['credentials'] = protect(json.dumps({'headers': item.headers, 'env': item.env}),
                                            'mcp-server:' + item.id)
        records.append(record)
    save_settings(settings_path(), {'servers': records})


def public(server):
    data = server.model_dump(exclude={'headers', 'env'})
    data.update(hasHeaders=bool(server.headers), hasEnv=bool(server.env))
    return data


def save_server(value):
    current = servers()
    previous = next((item for item in current if item.id == value.get('id')), None)
    # Omitted credentials preserve saved values; explicit {} clears them.
    merged = {**(previous.model_dump() if previous else {}), **value}
    item = Server.model_validate(merged)
    current = [entry for entry in current if entry.id != item.id] + [item]
    if len(current) > 16:
        raise MCPError('最多配置 16 个 MCP 服务')
    _save_servers(current)
    return item


def remove_server(server_id):
    _save_servers([s for s in servers() if s.id != server_id])


# Variables a child process needs to start at all. Everything else is withheld:
# api.env holds provider keys, and a third-party stdio server reads the whole
# environment in one line. Servers that need more declare it in their own env.
ENV_ALLOWLIST = frozenset({
    'PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SYSTEMDRIVE', 'TEMP', 'TMP', 'TMPDIR',
    'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'SHELL',
    'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
    'COMMONPROGRAMFILES', 'PROGRAMW6432', 'COMSPEC', 'PATHEXT',
    'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
    'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USERDOMAIN',
    'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
})

def safe_env(server):
    """Allowlisted host variables plus the server's own declared values."""
    import os
    env = {key: value for key, value in os.environ.items() if key.upper() in ENV_ALLOWLIST}
    env.update(server.env or {})
    return env


LOG_LIMIT = 2 * 1024 * 1024


def stderr_log(server, stack):
    """Capture stderr to a size-capped file. It is a third-party author's only
    debugging channel, and it never travels back to the model."""
    from core.user_paths import user_data_dir
    folder = Path(user_data_dir()) / 'mcp-logs'
    try:
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / ('%s.log' % re.sub(r'[^\w.-]', '_', server.id))
        if path.exists() and path.stat().st_size > LOG_LIMIT:
            path.replace(path.with_suffix('.log.1'))
    except OSError:
        return stack.enter_context(open(os.devnull, 'w'))
    try:
        return stack.enter_context(open(path, 'a', encoding='utf-8', errors='replace'))
    except OSError:
        return stack.enter_context(open(os.devnull, 'w'))


async def _connect(server, stack):
    """Open one MCP session on a caller-owned stack; the stack owns the lifetime."""
    try:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        from mcp.client.sse import sse_client
        from mcp.client.streamable_http import streamablehttp_client
    except ImportError:
        raise MCPError('缺少 MCP SDK，请安装更新后的 requirements.txt') from None
    if server.transport == 'stdio':
        # SDK launches argv directly, without shell=True.
        streams = await stack.enter_async_context(stdio_client(StdioServerParameters(
            command=server.command, args=server.args, env=safe_env(server), cwd=server.cwd),
            errlog=stderr_log(server, stack)))
    elif server.transport == 'sse':
        streams = await stack.enter_async_context(sse_client(server.url, headers=server.headers,
            timeout=20, sse_read_timeout=90))
    else:
        streams = await stack.enter_async_context(streamablehttp_client(server.url,
            headers=server.headers, timeout=timedelta(seconds=20), sse_read_timeout=timedelta(seconds=90)))
    client = await stack.enter_async_context(ClientSession(streams[0], streams[1],
        read_timeout_seconds=timedelta(seconds=90)))
    await client.initialize()
    return client


@asynccontextmanager
async def session(server):
    """One-shot session: connect, hand over the client, close everything afterwards."""
    try:
        async with AsyncExitStack() as stack:
            try:
                client = await _connect(server, stack)
            except asyncio.CancelledError:
                raise
            except MCPError:
                raise
            except Exception:
                # Do not return SDK exception groups / URLs / headers containing saved secrets.
                raise MCPError(f'MCP 服务 {server.id} 连接或调用失败，请检查服务、认证和超时') from None
            yield client
    except asyncio.CancelledError:
        raise
    except MCPError:
        raise
    except Exception:
        raise MCPError(f'MCP 服务 {server.id} 连接或调用失败，请检查服务、认证和超时') from None


# --- pooled connections -------------------------------------------------------
# stdio servers cost a process start per call; keep them warm between tasks.

POOL_IDLE_SECONDS = 300
_POOL: dict[str, '_Pooled'] = {}
_POOL_LOCK = None


def _pool_lock():
    global _POOL_LOCK
    if _POOL_LOCK is None:
        _POOL_LOCK = asyncio.Lock()
    return _POOL_LOCK


class _Pooled:
    __slots__ = ('server', 'fingerprint', 'client', 'ready', 'stop', 'task', 'refs', 'last_used', 'broken')

    def __init__(self, server, fingerprint):
        self.server = server
        self.fingerprint = fingerprint
        self.client = None
        self.ready = asyncio.get_running_loop().create_future()
        self.stop = asyncio.Event()
        self.task = None
        self.refs = 0
        self.last_used = time.monotonic()
        self.broken = False


def _fingerprint(server):
    payload = json.dumps({'transport': server.transport, 'url': server.url, 'command': server.command,
        'args': server.args, 'cwd': server.cwd, 'env': server.env, 'headers': server.headers},
        sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()


async def _run_pooled(server, entry):
    try:
        async with AsyncExitStack() as stack:
            client = await _connect(server, stack)
            entry.client = client
            if not entry.ready.done():
                entry.ready.set_result(client)
            while not entry.stop.is_set():
                try:
                    await asyncio.wait_for(entry.stop.wait(), POOL_IDLE_SECONDS)
                except asyncio.TimeoutError:
                    if not entry.refs and time.monotonic() - entry.last_used >= POOL_IDLE_SECONDS:
                        break
    except asyncio.CancelledError:
        raise
    except Exception:
        entry.broken = True
        if not entry.ready.done():
            entry.ready.set_exception(MCPError(f'MCP 服务 {server.id} 连接或调用失败，请检查服务、认证和超时'))
    finally:
        if not entry.ready.done():
            entry.ready.set_exception(MCPError(f'MCP 服务 {server.id} 连接失败'))


async def _close_entry(entry):
    entry.stop.set()
    if entry.task and not entry.task.done():
        entry.task.cancel()
        try:
            await entry.task
        except (asyncio.CancelledError, Exception):
            pass


async def acquire(server):
    """Return a live pooled client for a server; reuses warm connections."""
    fingerprint = _fingerprint(server)
    lock = _pool_lock()
    async with lock:
        entry = _POOL.get(server.id)
        if entry is not None and (entry.fingerprint != fingerprint or entry.broken or entry.task.done()):
            _POOL.pop(server.id, None)
            await _close_entry(entry)
            entry = None
        if entry is None:
            entry = _Pooled(server, fingerprint)
            _POOL[server.id] = entry
            entry.task = asyncio.create_task(_run_pooled(server, entry))
        entry.refs += 1
        entry.last_used = time.monotonic()
        now = time.monotonic()
        for key, other in list(_POOL.items()):
            if other is entry or other.refs or now - other.last_used < POOL_IDLE_SECONDS:
                continue
            _POOL.pop(key, None)
            await _close_entry(other)
    try:
        client = await asyncio.wait_for(asyncio.shield(entry.ready), 40)
    except asyncio.CancelledError:
        async with lock:
            entry.refs = max(0, entry.refs - 1)
        raise
    except Exception:
        async with lock:
            entry.refs = max(0, entry.refs - 1)
        raise MCPError(f'MCP 服务 {server.id} 连接或调用失败，请检查服务、认证和超时') from None
    return entry


async def release(entry):
    if entry is None:
        return
    async with _pool_lock():
        entry.refs = max(0, entry.refs - 1)
        entry.last_used = time.monotonic()


async def close_pool():
    async with _pool_lock():
        entries = list(_POOL.values())
        _POOL.clear()
    for entry in entries:
        await _close_entry(entry)


@asynccontextmanager
async def pooled_session(server):
    entry = await acquire(server)
    try:
        yield entry.client
    except asyncio.CancelledError:
        entry.broken = True
        raise
    except Exception:
        entry.broken = True
        raise
    finally:
        await release(entry)


# --- tool discovery and risk --------------------------------------------------

async def catalog(client):
    result, cursor, seen = [], None, set()
    for _ in range(8):
        page = await client.list_tools(cursor=cursor)
        result.extend(page.tools)
        if len(result) > 128:
            raise MCPError('服务工具超过 128 个，请拆分服务')
        cursor = page.nextCursor
        if not cursor:
            return result
        if cursor in seen:
            break
        seen.add(cursor)
    raise MCPError('服务工具分页异常或过多')


def annotations_of(tool):
    annotations = getattr(tool, 'annotations', None)
    if annotations is None:
        return {}
    if isinstance(annotations, dict):
        return annotations
    try:
        return annotations.model_dump(exclude_none=True)
    except Exception:
        return {}


READONLY_PREFIXES = ('get_', 'list_', 'search_', 'read_', 'describe_', 'status', 'look')


def tool_risk(annotations, name=''):
    """readonly / mutating / destructive. Servers that declare no hints fall back
    to a read-only name heuristic; anything unrecognised stays destructive."""
    if annotations:
        if annotations.get('readOnlyHint') is True:
            return 'readonly'
        if annotations.get('destructiveHint') is False:
            return 'mutating'
        return 'destructive'
    return 'readonly' if name.lower().startswith(READONLY_PREFIXES) else 'destructive'


def tool_alias(server_id, name):
    return 'mcp_' + hashlib.sha256(f'{server_id}:{name}'.encode()).hexdigest()[:24]


# --- media --------------------------------------------------------------------

MEDIA_MAX_IMAGES = 4
MEDIA_MAX_EDGE = 1024
MEDIA_MAX_RAW = 1500000


def _image_data_url(data, mime=''):
    """Compress an MCP image payload into a data URL; empty string when unusable."""
    if not data:
        return ''
    try:
        import base64
        import io
        from PIL import Image
        raw = base64.b64decode(data, validate=False)
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception:
        return ''
    keep_png = image.mode in ('RGBA', 'LA') or 'transparency' in image.info
    for edge in (MEDIA_MAX_EDGE, 768, 512):
        if max(image.size) > edge:
            image.thumbnail((edge, edge))
        buffer = io.BytesIO()
        try:
            if keep_png:
                image.save(buffer, format='PNG', optimize=True)
            else:
                image.convert('RGB').save(buffer, format='JPEG', quality=85)
        except Exception:
            return ''
        blob = buffer.getvalue()
        if len(blob) <= MEDIA_MAX_RAW:
            import base64 as _b64
            encoded = _b64.b64encode(blob).decode('ascii')
            return f'data:{"image/png" if keep_png else "image/jpeg"};base64,{encoded}'
    return ''


def media_from_result(result):
    """Data URLs for image payloads of a tool result; binary never enters text context."""
    try:
        value = result.model_dump(mode='json', exclude_none=True)
    except Exception:
        return []
    urls = []
    for block in value.get('content', []) or []:
        if not isinstance(block, dict):
            continue
        kind = block.get('type')
        if kind == 'image':
            url = _image_data_url(block.get('data'), block.get('mimeType') or '')
            if url:
                urls.append(url)
        elif kind == 'resource':
            resource = block.get('resource') or {}
            blob = resource.get('blob')
            if blob and str(resource.get('mimeType') or '').startswith('image/'):
                url = _image_data_url(blob, resource.get('mimeType'))
                if url:
                    urls.append(url)
        if len(urls) >= MEDIA_MAX_IMAGES:
            break
    return urls


def bounded_result(result):
    value = result.model_dump(mode='json', exclude_none=True)
    # Binary media is deliberately not copied into the model context.
    value['content'] = [block if block.get('type') == 'text' else
        {'type': 'text', 'text': '[媒体结果已省略，请由工具返回文件路径或 URL]'} for block in value.get('content', [])]
    text = json.dumps(value, ensure_ascii=False)
    if len(text.encode()) > 24000:
        return json.dumps({'truncated': True, 'preview': text[:6000]}, ensure_ascii=False)
    return text


def tool_error(result, limit=1200):
    detail = '\n'.join(str(getattr(block, 'text', ''))[:limit]
                       for block in (getattr(result, 'content', []) or [])[:8])
    try:
        secrets = [value for server in servers() for value in (*server.headers.values(), *server.env.values()) if value]
    except Exception:
        secrets = []
    for secret in sorted(secrets, key=len, reverse=True):
        detail = detail.replace(secret, '[已隐藏]')
        if secret.lower().startswith('bearer '):
            detail = detail.replace(secret[7:], '[已隐藏]')
    detail = re.sub(r'(?i)(Bearer\s+)[^\s\"\'<>]+|(?:sk-|ghp-)[a-zA-Z0-9_-]+', '[已隐藏]', detail)
    return ('工具返回失败：' + detail.strip())[:limit] if detail.strip() else '工具返回失败，服务未提供错误详情'


async def call_once(client, name, arguments, progress=None):
    """Never retry execution to discover SDK compatibility or recover a connection."""
    import inspect
    options = {'progress_callback': progress} if progress is not None and 'progress_callback' in inspect.signature(client.call_tool).parameters else {}
    try:
        return await client.call_tool(name, arguments, **options)
    except BaseException as exc:
        for entry in list(_POOL.values()):
            if entry.client is client:
                entry.broken = True
        if isinstance(exc, asyncio.CancelledError):
            raise
        if not isinstance(exc, Exception):
            raise
        raise MCPError('MCP 工具调用中断；操作可能已经执行，请核查外部状态后再决定是否重试') from None


@asynccontextmanager
async def tool_pool(server_ids, on_error=None):
    configured = {item.id: item for item in servers()}
    if len(set(server_ids)) > 8:
        raise MCPError('一次最多使用 8 个 MCP 服务')
    entries, tools, calls = [], [], {}
    async def discover(server_id):
        server = configured.get(server_id)
        if not server or not server.enabled:
            raise MCPError(f'MCP 服务 {server_id} 不存在或已停用')
        entry = await acquire(server)
        entries.append(entry)
        try:
            return server, entry, await catalog(entry.client)
        except BaseException:
            entry.broken = True
            raise
    try:
        ids = list(dict.fromkeys(server_ids))
        results = await asyncio.gather(*(discover(server_id) for server_id in ids), return_exceptions=True)
        for server_id, result in zip(ids, results):
            if isinstance(result, BaseException):
                if isinstance(result, asyncio.CancelledError):
                    raise result
                if on_error is None:
                    raise MCPError(f'MCP 服务 {server_id} 连接或工具发现失败') from None
                await on_error({'type': 'tool', 'name': server_id, 'status': 'failed',
                                'error': 'MCP 服务连接或工具发现失败，其他可用服务继续运行'})
                continue
            server, entry, available = result
            for tool in available:
                if tool.name not in server.enabledTools:
                    continue
                alias = tool_alias(server.id, tool.name)
                tools.append({'type': 'function', 'function': {'name': alias,
                    'description': f'{server.id} / {tool.name}: {tool.description or ""}'[:1500],
                    'parameters': tool.inputSchema}})
                risk = 'trusted' if server.trustTools else tool_risk(annotations_of(tool), tool.name)
                calls[alias] = (entry.client, tool.name, server.id, risk)
        if len(tools) > 128 or len(json.dumps(tools).encode()) > 160000:
            raise MCPError('已启用工具过多，请减少选择')
        yield tools, calls
    finally:
        for entry in entries:
            await release(entry)


# --- resources and prompts ----------------------------------------------------

async def _pages(client, method, attribute, capability):
    capabilities = client.get_server_capabilities() if hasattr(client, 'get_server_capabilities') else None
    if capabilities is not None and getattr(capabilities, capability, None) is None:
        return []
    items, cursor, seen = [], None, set()
    try:
        for _ in range(8):
            page = await getattr(client, method)(cursor=cursor)
            items.extend(getattr(page, attribute))
            if len(items) > 128:
                raise MCPError('MCP 列表超过 128 项')
            cursor = page.nextCursor
            if not cursor:
                return items
            if cursor in seen:
                break
            seen.add(cursor)
        raise MCPError('MCP 列表分页异常或过多')
    except asyncio.CancelledError:
        raise
    except MCPError:
        raise
    except Exception:
        raise MCPError('MCP 列表读取失败，请检查服务状态；此结果不代表列表为空') from None


async def list_resources(client):
    return (await _pages(client, 'list_resources', 'resources', 'resources'),
            await _pages(client, 'list_resource_templates', 'resourceTemplates', 'resources'))


async def read_resource(client, uri):
    try:
        result = await client.read_resource(uri)
    except asyncio.CancelledError:
        raise
    except Exception:
        raise MCPError('读取 MCP 资源失败，请检查 URI 与服务状态') from None
    return list(result.contents)


async def list_prompts(client):
    return await _pages(client, 'list_prompts', 'prompts', 'prompts')


async def get_prompt(client, name, arguments=None):
    try:
        result = await client.get_prompt(name, arguments or {})
    except asyncio.CancelledError:
        raise
    except Exception:
        raise MCPError(f'获取 MCP 提示词 {name} 失败，请检查名称与参数') from None
    return list(result.messages)


def resource_to_text(contents, limit=8000):
    parts = []
    for item in contents:
        text = getattr(item, 'text', None)
        if text:
            parts.append(text)
            continue
        blob = getattr(item, 'blob', None)
        if blob:
            uri = getattr(item, 'uri', '')
            parts.append(f'[二进制资源 {uri}（{len(blob)} 字节）已省略]')
    return '\n\n'.join(part for part in parts if part)[:limit]


def prompt_to_messages(messages):
    """Convert MCP prompt messages into chat messages the model can consume."""
    out = []
    for item in messages:
        content = getattr(item, 'content', None)
        role = getattr(item, 'role', 'user')
        text = getattr(content, 'text', None)
        if text is not None:
            out.append({'role': role, 'content': text})
            continue
        if getattr(content, 'type', '') == 'image':
            url = _image_data_url(getattr(content, 'data', ''), getattr(content, 'mimeType', ''))
            if url:
                out.append({'role': role, 'content': [{'type': 'image_url', 'image_url': {'url': url}}]})
    return out


def game_servers():
    return [item.id for item in servers() if item.enabled and item.gameEnabled and item.enabledTools]
