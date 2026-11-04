"""本机可信执行只对主机本地项目owner开放，绝不将cwd称为隔离。"""
import importlib
import io
import json
import zipfile
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import Field

from core import game_native_runtime as native
from core.game_development_tasks import assert_idle, project_lock, unlock
from core.game_project_models import Contract, Identifier
from core.game_projects import atomic_write, digest, json_bytes
from routers.game_development_tasks import workspace_for

code = importlib.import_module('routers.game_code_candidates')

router = APIRouter(prefix='/api/game-projects/{project_id}/native-runtime', tags=['game-native-runtime'])


def local(request):
    if (not request.client or request.client.host not in ('127.0.0.1','::1')
            or request.url.hostname not in ('127.0.0.1','localhost','::1')):
        raise HTTPException(403, '本机执行仅允许主机本地访问')
    origin = request.headers.get('origin')
    if ((origin and origin != f'{request.url.scheme}://{request.url.netloc}')
            or request.headers.get('sec-fetch-site') == 'cross-site'
            or (request.method != 'GET' and request.headers.get('x-art-runtime') != '1')):
        raise HTTPException(403, '请通过本项目本机执行面板操作')


class Enable(Contract):
    enabled: bool


class Base(Contract):
    baseRevision: int = Field(ge=1)


class Start(Contract):
    sessionId: Identifier
    requestId: Identifier
    operation: Literal['install','build','dev','preview','agent','plugin']
    agent: Literal['codex','claude','opencode'] = 'codex'
    plugin: str = Field(default='',max_length=40)
    pluginAction: str = Field(default='',max_length=40)
    prompt: str = Field(default='',max_length=32768)
    model: str = Field(default='',max_length=200,pattern=r'^(?:[A-Za-z0-9][A-Za-z0-9._/:+-]*)?$')
    resume: bool = False


class Adopt(Contract):
    apply: bool = False


class AgentConfig(Contract):
    executable: str = Field(default='',max_length=1000)


class PluginConfig(AgentConfig):
    project: str = Field(max_length=1000)
    enabled: bool = True


class Fork(Contract):
    roundId: Identifier
    restore: bool = False


class NewSession(Contract):
    parentSessionId: Identifier | None = None


@router.get('')
async def overview(project_id: Identifier, http_request: Request, token: str = ''):
    local(http_request)
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id,token)
        tools = {}
        for tool in ('npm','codex','claude','opencode'):
            try:
                if tool == 'npm':
                    native.node_tool(tool)
                else:
                    native.studio.executable(tool,native.settings(workspace).get('agents',{}).get(tool,''))
                tools[tool] = True
            except HTTPException:
                tools[tool] = False
        from core.game_engine_plugins import catalog
        return dict(**native.settings(workspace),tools=tools,pluginCatalog=catalog(workspace),
            runs=[{k:v for k,v in run.items() if k!='log'} for run in native.native_runtime.list(workspace)],
            sessions=[json.loads(p.read_bytes()) for p in workspace.path('native-sessions').glob('*/session.json')])


@router.put('')
async def configure(project_id: Identifier, request: Enable, http_request: Request, token: str = ''):
    local(http_request)
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id,token,True)
    if not request.enabled and any(key.startswith(str(workspace.root)+'#') for key in native.native_runtime.workers):
        await native.native_runtime.stop(workspace)
    with repository.locked():
        lock = project_lock_ready(workspace)
        try:
            value = dict(native.settings(workspace),enabled=request.enabled,mode='local-trusted')
            atomic_write(workspace.path('native-runtime.json'),json_bytes(value))
            return value
        finally:
            unlock(lock)


def project_lock_ready(workspace):
    workspace.path('development-tasks').mkdir(parents=True,exist_ok=True)
    return project_lock(workspace)


@router.post('/template')
async def template(project_id: Identifier, request: Base, http_request: Request, token: str = ''):
    local(http_request)
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id,token,True)
        assert_idle(workspace)
        return native.install_template(workspace,request.baseRevision)


@router.post('/sessions')
async def create_session(project_id: Identifier, http_request: Request, request: NewSession | None = None, token: str = ''):
    local(http_request)
    repository = code.projects.store()
    with repository.locked():
        return native.create_session(workspace_for(project_id,token,True),request.parentSessionId if request else None)


@router.post('/runs')
async def start_run(project_id: Identifier, request: Start, http_request: Request, token: str = ''):
    local(http_request)
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id,token,True)
        return native.native_runtime.start(workspace,native.read_session(workspace,request.sessionId),
            request.operation,request.requestId,request.prompt,request.model,request.resume,
            request.agent,request.plugin,request.pluginAction)


@router.put('/agents/{agent}')
async def configure_agent(project_id: Identifier, agent: str, request: AgentConfig, http_request: Request, token: str = ''):
    local(http_request)
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id,token,True)
        native.require_enabled(workspace)
        native.studio.executable(agent,request.executable)
        lock = project_lock_ready(workspace)
        try:
            value = native.settings(workspace)
            value.setdefault('agents',{})[agent] = request.executable
            atomic_write(workspace.path('native-runtime.json'),json_bytes(value))
            return dict(saved=True)
        finally:
            unlock(lock)


@router.put('/plugins/{plugin}')
async def configure_plugin(project_id: Identifier, plugin: str, request: PluginConfig, http_request: Request, token: str = ''):
    local(http_request)
    from core.game_engine_plugins import PLUGINS, validate
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id,token,True)
        native.require_enabled(workspace)
        if plugin not in PLUGINS:
            raise HTTPException(422,'未知插件')
        config = validate(plugin,request.executable,request.project) if request.enabled else dict(enabled=False)
        lock = project_lock_ready(workspace)
        try:
            value = native.settings(workspace)
            value.setdefault('plugins',{})[plugin] = config
            atomic_write(workspace.path('native-runtime.json'),json_bytes(value))
            return dict(saved=True)
        finally:
            unlock(lock)


@router.get('/sessions/{session_id}/conversation')
async def conversation(project_id: Identifier, session_id: Identifier, http_request: Request, token: str = ''):
    local(http_request)
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id,token)
        return dict(rounds=native.studio.rounds(workspace,native.read_session(workspace,session_id)),
                    hostHistory=native.studio.host_history(workspace))


@router.post('/sessions/{session_id}/branch')
async def branch(project_id: Identifier, session_id: Identifier, request: Fork, http_request: Request, token: str = ''):
    local(http_request)
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id,token,True)
        assert_idle(workspace)
        # 试玩也停止后才能恢复，避免运行中的旧副本继续展示失效内容。
        if any(r['status'] in ('starting','running','stopping') for r in native.native_runtime.list(workspace)):
            raise HTTPException(409,'请先停止运行任务再撤销或分支')
        lock = project_lock_ready(workspace)
        try:
            return native.studio.branch(workspace,native.read_session(workspace,session_id),request.roundId,request.restore)
        finally:
            unlock(lock)


@router.post('/stop')
async def stop_run(project_id: Identifier, http_request: Request, token: str = ''):
    local(http_request)
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id,token,True)
    await native.native_runtime.stop(workspace)
    return dict(stopped=True)


@router.get('/runs/{run_id}')
async def read_run(project_id: Identifier, run_id: Identifier, http_request: Request, token: str = ''):
    local(http_request)
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id,token)
        run = next((r for r in native.native_runtime.list(workspace) if r['runId']==run_id),None)
        if not run:
            raise HTTPException(404,'运行记录不存在')
        return run


@router.post('/sessions/{session_id}/changes')
async def changes(project_id: Identifier, session_id: Identifier, request: Adopt, http_request: Request, token: str = ''):
    local(http_request)
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id,token,True)
        native.require_enabled(workspace)
        lock = project_lock_ready(workspace)
        try:
            session = native.read_session(workspace,session_id)
            files = native.check_session(workspace,session)
            updated = native.sources(workspace.path(f'native-sessions/{session_id}/project'))
            differences = []
            for name in sorted(set(files)|set(updated)):
                if files.get(name) == updated.get(name):
                    continue
                try:
                    content = updated[name].decode('utf-8') if name in updated else None
                except UnicodeDecodeError:
                    raise HTTPException(415, '本次差异含二进制，请通过素材导入处理') from None
                differences.append(dict(path=name,content=content,baseHash=digest(files[name]) if name in files else None))
            if not differences:
                return dict(changes=[],message='无源码变化')
            result = workspace.patch(session['workspaceRevision'],differences,request.apply)
            if request.apply:
                session.update(workspaceRevision=result['revision'],workspaceEpoch=result['workspaceEpoch'],inputManifest=workspace.manifest(updated))
                atomic_write(native.session_path(workspace,session_id),json_bytes(session))
            return result
        finally:
            unlock(lock)


@router.post('/import')
async def import_source(project_id: Identifier, http_request: Request, baseRevision: int = Form(...),
                        file: UploadFile = File(...), token: str = ''):
    local(http_request)
    raw = await file.read(40*1024*1024+1)
    if len(raw)>40*1024*1024:
        raise HTTPException(413,'源码ZIP超过40MiB')
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id,token,True)
        native.require_enabled(workspace)
        assert_idle(workspace)
        _, current = workspace.current(baseRevision)
        files,total = {},0
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                if len(archive.infolist())>1000:
                    raise HTTPException(413,'ZIP条目过多')
                for item in archive.infolist():
                    if item.is_dir():
                        continue
                    workspace.path('source-import/'+item.filename)
                    if any(part in native.SKIP or part.startswith('.env') for part in item.filename.split('/')):
                        raise HTTPException(422,'请移除依赖缓存、凭据和构建产物后导入')
                    if (item.external_attr>>16)&0o170000==0o120000:
                        raise HTTPException(422,'源码ZIP不接受符号链接')
                    total += item.file_size
                    if item.file_size>native.MAX_FILE or total>native.MAX_TOTAL or len(files)>=50:
                        raise HTTPException(413,'首版源码导入限50个文件，单文件1MiB，总计40MiB')
                    if item.filename.casefold() in {name.casefold() for name in files}:
                        raise HTTPException(422,'ZIP路径重复')
                    files[item.filename] = archive.read(item).decode('utf-8')
        except (zipfile.BadZipFile,UnicodeDecodeError,RuntimeError):
            raise HTTPException(422,'请导入合法UTF-8源码ZIP；二进制资源使用素材导入') from None
        if 'package.json' not in files:
            raise HTTPException(422,'ZIP根目录须包含package.json')
        return workspace.patch(baseRevision,[dict(path=name,content=text,baseHash=digest(current[name]) if name in current else None)
                                             for name,text in files.items()],True)


@router.get('/runs/{run_id}/web.zip')
async def export_web(project_id: Identifier, run_id: Identifier, http_request: Request, token: str = ''):
    local(http_request)
    repository = code.projects.store()
    with repository.locked():
        workspace = workspace_for(project_id,token)
        run = next((r for r in native.native_runtime.list(workspace) if r['runId']==run_id),None)
        if not run or run['status']!='succeeded' or not run.get('artifactManifest'):
            raise HTTPException(409,'没有成功且冻结的Web构建产物')
        files = native.sources(workspace.path(f'native-runs/{run_id}/dist'),max_file=100*1024*1024,max_total=256*1024*1024,skip=set())
        if workspace.manifest(files)!=run['artifactManifest']:
            raise HTTPException(409,'构建产物已变化，拒绝导出')
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
            for name,raw in files.items():
                archive.writestr(name,raw)
            archive.writestr('art-canvas-build.json',json_bytes(dict(runId=run_id,sourceManifest=run['sourceManifest'],
                note='本机Web构建产物；构建成功不代表玩法、视觉或正式发布通过')))
        return Response(buffer.getvalue(),media_type='application/zip',headers={'Content-Disposition':'attachment; filename="game-web.zip"'})


@router.get('/source.zip')
async def export_source(project_id: Identifier, http_request: Request, token: str = ''):
    local(http_request)
    repository=code.projects.store()
    with repository.locked():
        return Response(native.export_source(workspace_for(project_id,token)),media_type='application/zip',
            headers={'Content-Disposition':'attachment; filename="game-source.zip"'})
