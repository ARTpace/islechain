"""Host-only MCP configuration and streamed canvas assistant."""
import asyncio
import base64
from contextlib import suppress
import importlib
import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError

from core import mcp_tools, node_catalog
from core.canvas_agent import EDIT_FIELDS, run_agent
from core.comfy_workflow_builds import ComfyBuilds
from core.comfy_installs import ComfyInstalls
from core.node_plugin_builds import NodePluginBuilds


def local_request(request: Request, token: str = ''):
    if not request.client or request.client.host not in ('127.0.0.1', '::1') or request.url.hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise HTTPException(403, 'MCP 工具仅允许主机本地使用')
    origin = request.headers.get('origin')
    if (origin and origin != f'{request.url.scheme}://{request.url.netloc}') or request.headers.get('sec-fetch-site') == 'cross-site':
        raise HTTPException(403, 'MCP 不允许跨站请求')
    if request.method != 'GET' and request.headers.get('x-art-mcp') != '1':
        raise HTTPException(403, '请通过 MCP 工具面板操作')
    import main
    username = main.get_username_by_token(token)
    if not username:
        raise HTTPException(401, '请先登录')
    return username


router = APIRouter(prefix='/api/mcp', tags=['mcp'], dependencies=[Depends(local_request)])

# Pending tool approvals: id -> future resolved by /agent/approval.
_APPROVALS: dict[str, asyncio.Future] = {}
APPROVAL_TIMEOUT = 180


@router.get('/servers')
async def list_servers():
    return {'servers': [mcp_tools.public(server) for server in mcp_tools.servers()]}


@router.get('/unity-projects')
async def list_unity_projects(refresh: bool = False):
    """画布「Unity CLI」节点用：列出本机 Hub 注册的 Unity 工程与已安装编辑器。"""
    from core import unity_projects
    return unity_projects.discover(force=refresh)


@router.get('/unity-editor-methods')
async def list_unity_editor_methods(project: str = ''):
    """扫描指定 Unity 工程里的静态无参编辑器方法，标注是否适合批处理。"""
    from core import unity_projects
    return unity_projects.editor_methods(project)


@router.get('/uloop-features')
async def list_uloop_features(project: str = '', refresh: bool = False):
    """uloop 节点用：按工程路径自动检测 uloop CLI、插件能力与可用功能。"""
    from core import uloop_features
    if refresh:
        uloop_features._CACHE.clear()
    return uloop_features.discover(project)


@router.get('/node-catalog')
async def get_node_catalog():
    # 内置 CLI 节点：首次打开画布/节点目录时幂等安装，之后走用户自己的 catalog。
    from core import unity_cli_node, uloop_cli_node
    unity_cli_node.ensure_installed()
    uloop_cli_node.ensure_installed()
    return {**node_catalog.public_catalog(), 'sdk': node_catalog.sdk()}


@router.post('/node-catalog')
async def update_node_catalog(value: dict):
    try:
        action = value.get('action')
        if action == 'install':
            node_catalog.install(value.get('definition'))
        elif action == 'groups':
            node_catalog.save_groups(value.get('groups'), value.get('revision'))
        elif action == 'enabled':
            node_catalog.set_enabled(value.get('typeId'), value.get('version'), value.get('enabled'), value.get('revision'))
        elif action == 'migrate':
            target = next((item for item in node_catalog.read_catalog()['definitions']
                           if (item['typeId'], item['version']) == (value.get('typeId'), value.get('version'))), None)
            if target is None or f"{target['typeId']}@{target['version']}" not in node_catalog.public_catalog()['hashes']:
                raise ValueError('目标版本缺失或已停用')
            return {'definition': target, 'params': node_catalog.migrate_params(target, value.get('params', {}))}
        else:
            raise ValueError('不支持的目录操作')
        return node_catalog.public_catalog()
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc)[:500]) from None


@router.get('/node-http-credential')
async def http_credential_status(definitionHash: str, owner: str = Depends(local_request)):
    from core.node_http import has_credential
    try:
        return {'configured': has_credential(owner, definitionHash)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.post('/node-http-credential')
async def update_http_credential(value: dict, owner: str = Depends(local_request)):
    from core.node_http import save_credential
    try:
        item = next((item for item in node_catalog.read_catalog()['definitions']
                     if node_catalog.digest(item) == value.get('definitionHash')), None)
        if item is None:
            raise ValueError('节点定义缺失或版本已变化')
        await asyncio.to_thread(save_credential, owner, item, value.get('token'))
        return {'configured': bool(value.get('token'))}
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc)[:500]) from None


@router.post('/node-run')
async def run_config_node(value: dict, owner: str = Depends(local_request)):
    try:
        from core import node_worker
        from core.node_media import NodeMedia
        if value.get('action') == 'cancel':
            node_worker.cancel(owner, value.get('runId'))
            return {'status': 'cancelling'}
        if value.get('action') in ('import-image', 'import-media'):
            return await asyncio.to_thread(NodeMedia(owner).import_data, value.get('data'))
        item = next((item for item in node_catalog.read_catalog()['definitions']
                     if (item['typeId'], item['version']) == (value.get('typeId'), value.get('version'))), None)
        if not item or node_catalog.digest(item) != value.get('definitionHash'):
            raise ValueError('节点版本缺失或定义已变化，请恢复对应版本')
        if f"{item['typeId']}@{item['version']}" not in node_catalog.public_catalog()['hashes']:
            raise ValueError('该节点版本已停用；数据与连线仍然保留')
        event, run_id = None, value.get('runId')
        if item['execution']['kind'] in ('worker.python', 'host.http', 'host.cli'):
            event = node_worker.register(owner, run_id)
        try:
            return await asyncio.to_thread(node_catalog.execute, item, value.get('params', {}),
                                           value.get('inputs', []), cancel_event=event,
                                           media=NodeMedia(owner) if item['execution'].get('media') else None,
                                           media_inputs=value.get('imageInputs', []), worker_owner=owner,
                                           port_inputs=value.get('portInputs'), run_id=run_id)
        except asyncio.CancelledError:
            if event is not None:
                event.set()
            raise
        finally:
            if event is not None:
                node_worker.unregister(owner, run_id)
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc)[:500]) from None


def comfy_context(canvas_id, token=''):
    import main
    from routers.canvases import _owned_canvas
    if not isinstance(canvas_id, str) or not canvas_id or len(canvas_id) > 120:
        raise HTTPException(400, '画布 ID 无效')
    main.validate_canvas_owner(_owned_canvas(canvas_id), token)
    return ComfyBuilds(main.USER_DATA_DIR + '/comfy-builds', main.WORKFLOW_DIR,
                      main.get_username_by_token(token), canvas_id, main.COMFYUI_ADDRESS)


def dcc_context(canvas_id, token=''):
    from routers.dcc_bridge import dcc_service
    return dcc_service(canvas_id, token)


@router.get('/comfy-builds')
async def list_comfy_builds(canvas_id: str, token: str = ''):
    service = comfy_context(canvas_id, token)
    builds = service.list()
    for record in builds:
        if record['status'] in ('queued', 'submitting', 'running', 'paused'):
            await service.get(record['id'])
    installs = ComfyInstalls(service)
    installation_records = []
    for record in installs.list():
        installation_records.append(await installs.get(record['id']))
    plugins = NodePluginBuilds(service)
    return {'builds': service.list(), 'installs': installation_records,
            'plugins': plugins.list()}


@router.post('/comfy-builds')
async def operate_comfy_build(value: dict, token: str = ''):
    service = comfy_context(value.get('canvasId'), token)
    try:
        action, build_id = value.get('action'), value.get('buildId')
        installs, plugins = ComfyInstalls(service), NodePluginBuilds(service)
        if action == 'plugin-import':
            from core.node_plugin_package import import_package
            encoded = value.get('package')
            if not isinstance(encoded, str) or len(encoded) > 350000:
                raise ValueError('节点包超过大小限制')
            definition, tests = import_package(base64.b64decode(encoded, validate=True))
            return plugins.create(definition, tests)
        if action == 'plugin-export':
            from core.node_plugin_package import export_package
            record = plugins.checked(value.get('candidateId'), value.get('revision'))
            data = export_package(record['definition'], record['tests'])
            return {'filename': record['definition']['typeId'] + '-' + record['definition']['version'] + '.artnode',
                    'package': base64.b64encode(data).decode()}
        if action == 'install-prepare':
            return await installs.prepare(value.get('planId'))
        if action == 'install-get':
            return await installs.get(value.get('installId'))
        if action == 'install-start':
            if value.get('trustedCode') is not True:
                raise ValueError('必须明确授权固定清单的第三方可执行代码')
            return await installs.start(value.get('installId'), value.get('revision'), allow_scripts=True)
        if action == 'install-reconcile':
            return await installs.reconcile(value.get('installId'))
        if action == 'install-retry':
            return await installs.retry_failed(value.get('installId'))
        if action == 'install-restart':
            return await installs.restart(value.get('installId'))
        if action == 'install-cancel':
            return await installs.cancel_monitoring(value.get('installId'))
        if action == 'plugin-get':
            return plugins.read(value.get('candidateId'))
        if action == 'plugin-environment':
            return await asyncio.to_thread(plugins.environment, value.get('candidateId'))
        if action == 'plugin-test':
            record = plugins.read(value.get('candidateId'))
            if record['definition']['execution']['kind'] == 'worker.python' and record.get('trustedRevision') != record['revision']:
                if value.get('trustedCode') is not True:
                    raise ValueError('测试 worker 前必须明确授权可信代码，可访问当前用户文件和网络')
                plugins.approve_worker(record['id'], record['revision'])
            return await plugins.call_async('canvas_test_plugin', {'candidate_id': record['id']})
        if action == 'plugin-cancel':
            return plugins.cancel(value.get('candidateId'))
        if action == 'plugin-install':
            return plugins.install(value.get('candidateId'), value.get('revision'))
        if action == 'plugin-propose':
            return plugins.call('canvas_propose_plugin', {'candidate_id': value.get('candidateId'),
                                                        'revision': value.get('revision')})
        if action == 'get':
            return await service.get(build_id)
        if action == 'cancel':
            return await service.cancel(build_id)
        if action == 'publish':
            return await service.publish(build_id, value.get('revision'))
        raise ValueError('不支持的构建操作')
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc)[:2200]) from None


@router.post('/servers')
async def configure(value: dict):
    try:
        return {'server': mcp_tools.public(mcp_tools.save_server(value))}
    except (ValidationError, ValueError, TypeError):
        raise HTTPException(400, 'MCP 配置无效：检查 ID、传输类型、地址、command/args 和 cwd') from None


@router.delete('/servers/{server_id}')
async def remove(server_id: str):
    mcp_tools.remove_server(server_id)
    return {'ok': True}


def get_server(server_id):
    server = next((server for server in mcp_tools.servers() if server.id == server_id), None)
    if not server or not server.enabled:
        raise HTTPException(404, 'MCP 服务不存在或已停用')
    return server


@router.post('/servers/{server_id}/tools')
async def list_tools(server_id: str):
    try:
        async with mcp_tools.pooled_session(get_server(server_id)) as client:
            tools = await mcp_tools.catalog(client)
            return {'tools': [dict(tool.model_dump(mode='json', exclude_none=True),
                risk=mcp_tools.tool_risk(mcp_tools.annotations_of(tool), tool.name)) for tool in tools]}
    except mcp_tools.MCPError as exc:
        raise HTTPException(502, str(exc)) from None


@router.post('/servers/{server_id}/resources')
async def list_resources(server_id: str):
    try:
        async with mcp_tools.pooled_session(get_server(server_id)) as client:
            resources, templates = await mcp_tools.list_resources(client)
            return {'resources': [item.model_dump(mode='json', exclude_none=True) for item in resources],
                'templates': [item.model_dump(mode='json', exclude_none=True) for item in templates]}
    except mcp_tools.MCPError as exc:
        raise HTTPException(502, str(exc)) from None


class ResourceRead(BaseModel):
    uri: str = Field(min_length=1, max_length=2048)


@router.post('/servers/{server_id}/resource')
async def read_resource(server_id: str, payload: ResourceRead):
    try:
        async with mcp_tools.pooled_session(get_server(server_id)) as client:
            contents = await mcp_tools.read_resource(client, payload.uri)
            return {'text': mcp_tools.resource_to_text(contents),
                'items': [item.model_dump(mode='json', exclude_none=True) for item in contents]}
    except mcp_tools.MCPError as exc:
        raise HTTPException(502, str(exc)) from None


@router.post('/servers/{server_id}/prompts')
async def list_prompts(server_id: str):
    try:
        async with mcp_tools.pooled_session(get_server(server_id)) as client:
            prompts = await mcp_tools.list_prompts(client)
            return {'prompts': [item.model_dump(mode='json', exclude_none=True) for item in prompts]}
    except mcp_tools.MCPError as exc:
        raise HTTPException(502, str(exc)) from None


class PromptGet(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    arguments: dict = Field(default_factory=dict)


@router.post('/servers/{server_id}/prompt')
async def get_prompt(server_id: str, payload: PromptGet):
    try:
        async with mcp_tools.pooled_session(get_server(server_id)) as client:
            messages = await mcp_tools.get_prompt(client, payload.name, payload.arguments)
            return {'messages': mcp_tools.prompt_to_messages(messages)}
    except mcp_tools.MCPError as exc:
        raise HTTPException(502, str(exc)) from None


class ToolCall(BaseModel):
    name: str = Field(max_length=200)
    arguments: dict = Field(default_factory=dict)


@router.post('/servers/{server_id}/call')
async def call_tool(server_id: str, payload: ToolCall):
    server = get_server(server_id)
    if payload.name not in server.enabledTools:
        raise HTTPException(403, '请先勾选启用此工具')
    if len(json.dumps(payload.arguments).encode()) > 64000:
        raise HTTPException(400, '工具参数过大')
    try:
        async with mcp_tools.pooled_session(server) as client:
            if payload.name not in {tool.name for tool in await mcp_tools.catalog(client)}:
                raise HTTPException(404, '工具已不可用，请刷新工具列表')
            result = await mcp_tools.call_once(client, payload.name, payload.arguments)
            if getattr(result, 'isError', False):
                raise mcp_tools.MCPError(mcp_tools.tool_error(result))
            return json.loads(mcp_tools.bounded_result(result))
    except mcp_tools.MCPError as exc:
        raise HTTPException(502, str(exc)) from None


class HistoryMessage(BaseModel):
    role: Literal['user', 'assistant']
    content: str = Field(max_length=16000)


class ResourceRef(BaseModel):
    server: str = Field(min_length=1, max_length=64)
    uri: str = Field(min_length=1, max_length=2048)


class PromptRef(BaseModel):
    server: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    arguments: dict = Field(default_factory=dict)


class AgentRequest(BaseModel):
    canvasId: str = Field(min_length=1, max_length=100)
    prompt: str = Field(min_length=1, max_length=16000)
    provider: str = Field(default='comfly', max_length=100)
    model: str = Field(default='', max_length=200)
    serverIds: list[str] = Field(default_factory=list, max_length=8)
    snapshot: dict
    history: list[HistoryMessage] = Field(default_factory=list, max_length=12)
    preapproved: list[str] = Field(default_factory=list, max_length=64)
    resources: list[ResourceRef] = Field(default_factory=list, max_length=8)
    prompts: list[PromptRef] = Field(default_factory=list, max_length=8)
    includeMedia: bool = True


class ApprovalDecision(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    granted: bool
    remember: bool = False


@router.post('/agent/approval')
async def resolve_approval(payload: ApprovalDecision):
    future = _APPROVALS.get(payload.id)
    if future is None or future.done():
        raise HTTPException(404, '审批请求已结束')
    future.set_result({'granted': payload.granted, 'remember': payload.remember})
    return {'ok': True}


async def _collect_context(resources, prompts):
    """Resolve requested MCP resources and prompts into chat context messages."""
    messages = []
    for ref in resources:
        try:
            async with mcp_tools.pooled_session(_server(ref.server)) as client:
                contents = await mcp_tools.read_resource(client, ref.uri)
                text = mcp_tools.resource_to_text(contents)
        except (mcp_tools.MCPError, IndexError, ValueError):
            text = ''
        if text:
            messages.append({'role': 'user', 'content': f'[MCP 资源 {ref.server} · {ref.uri}]\n{text}'})
    for ref in prompts:
        try:
            async with mcp_tools.pooled_session(_server(ref.server)) as client:
                items = await mcp_tools.get_prompt(client, ref.name, ref.arguments)
                messages.extend(mcp_tools.prompt_to_messages(items))
        except (mcp_tools.MCPError, IndexError, ValueError):
            continue
    return messages


def _server(server_id):
    server = next((item for item in mcp_tools.servers() if item.id == server_id), None)
    if not server or not server.enabled:
        raise mcp_tools.MCPError('MCP 服务不存在或已停用')
    return server


@router.post('/agent')
async def agent(payload: AgentRequest, token: str = ''):
    import main
    from routers.canvases import _owned_canvas
    stored = _owned_canvas(payload.canvasId)
    main.validate_canvas_owner(stored, token)
    if len(json.dumps(payload.snapshot, ensure_ascii=False).encode()) > 160000:
        raise HTTPException(400, '画布上下文过大，请减少节点文本')
    raw_nodes = payload.snapshot.get('nodes', [])
    raw_connections = payload.snapshot.get('connections', [])
    if not isinstance(raw_nodes, list) or len(raw_nodes) > 300 or not isinstance(raw_connections, list) or len(raw_connections) > 1000:
        raise HTTPException(400, '画布节点或连线数量超限')
    try:
        nodes = [{key: node[key] for key in {'id', 'type', 'x', 'y', *EDIT_FIELDS} if key in node} for node in raw_nodes]
        ids = [node['id'] for node in nodes]
        if any(not isinstance(item, str) for item in ids) or len(set(ids)) != len(ids):
            raise ValueError()
        links = [{'from': edge['from'], 'to': edge['to']} for edge in raw_connections]
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, '画布上下文格式无效') from None
    # Game project ownership is checked against the stored canvas, not a model-supplied ID.
    project_ids = {node.get('projectId') for node in stored.get('nodes', []) if node.get('projectId')}
    project_id = payload.snapshot.get('projectId')
    if project_id and project_id not in project_ids:
        game_projects = importlib.import_module('routers.game_projects')
        project = game_projects.store().read(project_id, game_projects.identity(token))
        if project.canvasId != payload.canvasId:
            raise HTTPException(403, '工程不属于当前画布')
    selected_ids = payload.snapshot.get('selectedNodeIds', [])
    if not isinstance(selected_ids, list) or len(selected_ids) > 24:
        raise HTTPException(400, '引用节点数量或格式无效')
    snapshot = {'nodes': nodes, 'connections': links, 'projectId': project_id,
        'connectionRules': payload.snapshot.get('connectionRules', []),
        'selectedNodeIds': [item for item in selected_ids
            if isinstance(item, str) and item in ids][:24]}
    base, headers, model = main.resolve_chat_provider(payload.provider, payload.model, '')
    queue = asyncio.Queue(maxsize=32)

    async def work():
        try:
            context = await _collect_context(payload.resources, payload.prompts)
            result = await run_agent(base, headers, model, payload.prompt, snapshot, payload.serverIds, emit=queue.put,
                history=[item.model_dump() for item in payload.history],
                preapproved=payload.preapproved,
                include_media=payload.includeMedia,
                approve=make_approver(queue),
                context=context,
                comfy=comfy_context(payload.canvasId, token),
                dcc=dcc_context(payload.canvasId, token))
            await queue.put({'type': 'result', **result})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await queue.put({'type': 'error', 'message': str(exc) if isinstance(exc, mcp_tools.MCPError) else 'AI 工具任务失败或超时；请查看渠道及 MCP 服务状态，外部操作不会自动重试'})
        finally:
            if not asyncio.current_task().cancelling():
                await queue.put(None)

    async def stream():
        task = asyncio.create_task(work())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield json.dumps(event, ensure_ascii=False) + '\n'
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            for future in list(_APPROVALS.values()):
                if not future.done():
                    future.set_result({'granted': False, 'remember': False})
            _APPROVALS.clear()

    return StreamingResponse(stream(), media_type='application/x-ndjson', headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})


def make_approver(queue):
    """Build the tool approval callback; it blocks the agent until the user decides."""
    import secrets

    async def approve(request):
        approval_id = secrets.token_hex(16)
        future = asyncio.get_running_loop().create_future()
        _APPROVALS[approval_id] = future
        await queue.put({'type': 'approval', 'id': approval_id, 'name': request['name'],
            'tool': request['tool'], 'risk': request['risk'], 'arguments': request['arguments']})
        try:
            decision = await asyncio.wait_for(future, APPROVAL_TIMEOUT)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            return {'granted': False, 'remember': False}
        finally:
            _APPROVALS.pop(approval_id, None)
        return decision
    return approve
