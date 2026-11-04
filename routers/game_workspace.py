"""工程文件 API；沿用游戏项目身份、锁和权限，不接受可执行命令。"""
from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import Field

from core.game_project_models import Contract, Digest, Identifier, Text
from core.game_workspace import Workspace
from core.game_content import GameContent
from core.game_web_builds import WebBuilds, PREVIEW_CSP
from typing import Literal
import importlib

projects = importlib.import_module('routers.game_projects')
router = APIRouter(prefix='/api/game-projects/{project_id}/workspace', tags=['game-workspace'])


class Change(Contract):
    path: str = Field(min_length=1, max_length=240)
    baseHash: Digest | None
    content: str | None = Field(max_length=1048576)


class MediaUpload(Contract):
    baseRevision: int = Field(ge=1)
    filename: str = Field(min_length=1, max_length=180)
    purpose: str = Field(min_length=1, max_length=1000)
    contentBase64: str = Field(min_length=1, max_length=140 * 1024 * 1024)
    assetId: Identifier | None = None
    sourceKey: str | None = Field(default=None, min_length=1, max_length=240)


class MediaBinding(Contract):
    baseRevision: int = Field(ge=1)
    enabled: bool
    purpose: str = Field(min_length=1, max_length=1000)


@router.post('/media-assets')
def upload_media(project_id: Identifier, request: MediaUpload, token: str = ''):
    import base64
    from pathlib import Path
    from fastapi import HTTPException
    from core.game_project_models import RuntimeAsset
    from core.game_projects import atomic_write, digest, safe_path, uid
    from core.game_media_assets import inspect_media, MAX_ASSETS_TOTAL
    try:
        raw = base64.b64decode(request.contentBase64, validate=True)
    except ValueError as exc:
        raise HTTPException(422, '文件编码无效') from exc
    kind, mime, metadata = inspect_media(request.filename, raw)
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token), request.baseRevision, writable=True)
        old = next((a for a in project.mediaAssets if a.id == request.assetId), None)
        if not request.assetId and request.sourceKey:
            old = next((a for a in project.mediaAssets if a.metadata.get('sourceKey') == request.sourceKey), None)
        if request.assetId and not old:
            raise HTTPException(404, '待替换资产不存在')
        if old and old.kind != kind:
            raise HTTPException(422, '替换资产必须保持相同类型')
        content_hash = digest(raw)
        if (old and old.contentHash == content_hash and old.name == Path(request.filename.replace('\\','/')).name
                and old.purpose == request.purpose and (old.enabled or not request.sourceKey)):
            from core.game_media_assets import media_content
            media_content(repository, project, old)
            return {**projects.payload(project, repository), 'reusedAssetId': old.id}
        if not old:
            duplicate = next((a for a in project.mediaAssets if a.contentHash == content_hash and a.kind == kind), None)
            if duplicate:
                from core.game_media_assets import media_content
                media_content(repository, project, duplicate)
                if not duplicate.enabled:
                    duplicate.enabled = True
                    duplicate.revision += 1
                    project = repository.save(project)
                return {**projects.payload(project, repository), 'reusedAssetId': duplicate.id}
            selected = next((a for a in project.assets if a.usage == 'runtime' and a.selected and a.selected.contentHash == content_hash), None)
            if selected:
                repository.selected_content(project, selected)
                return {**projects.payload(project, repository), 'reusedAssetId': selected.id}
        if sum(a.sizeBytes for a in project.mediaAssets if a is not old) + len(raw) > MAX_ASSETS_TOTAL or (not old and len(project.mediaAssets) >= 200):
            raise HTTPException(413, '项目资产超过 256 MiB 或 200 项')
        asset_id = old.id if old else uid('media')
        source_key = request.sourceKey or (old.metadata.get('sourceKey') if old else None)
        if source_key:
            metadata['sourceKey'] = source_key
        relative = f'assets/{asset_id}/{uid("revision")}{Path(request.filename).suffix.lower()}'
        asset = RuntimeAsset(id=asset_id, name=Path(request.filename.replace('\\','/')).name,
            kind=kind, purpose=request.purpose, enabled=(True if request.sourceKey else old.enabled) if old else True,
            revision=old.revision+1 if old else 1, relativePath=relative, contentHash=digest(raw),
            mime=mime, sizeBytes=len(raw), metadata=metadata)
        atomic_write(safe_path(repository.directory(project.id), relative), raw)
        project.mediaAssets = [a if a.id != asset_id else asset for a in project.mediaAssets] if old else [*project.mediaAssets,asset]
        project = repository.save(project)
        return projects.payload(project, repository)


@router.patch('/media-assets/{asset_id}')
def bind_media(project_id: Identifier, asset_id: Identifier, request: MediaBinding, token: str = ''):
    from fastapi import HTTPException
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token), request.baseRevision, writable=True)
        asset = next((a for a in project.mediaAssets if a.id == asset_id), None)
        if not asset:
            raise HTTPException(404, '资产不存在')
        asset.enabled, asset.purpose = request.enabled, request.purpose
        asset.revision += 1
        project = repository.save(project)
        return projects.payload(project, repository)


@router.get('/media-assets/{asset_id}/content')
def read_media(project_id: Identifier, asset_id: Identifier, token: str = ''):
    from fastapi import HTTPException
    from core.game_media_assets import media_content
    def read(workspace):
        asset = next((a for a in workspace.project.mediaAssets if a.id == asset_id), None)
        if not asset:
            raise HTTPException(404, '资产不存在')
        return Response(media_content(workspace.repository, workspace.project, asset), media_type=asset.mime,
            headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
    return operate(project_id, token, read)


class Patch(Contract):
    baseRevision: int = Field(ge=1)
    changes: list[Change] = Field(min_length=1, max_length=50)
    apply: bool = False


class Restore(Contract):
    baseRevision: int = Field(ge=1)
    snapshotId: Identifier
    fullProject: bool = False


class RestoreDecision(Contract):
    decision: Literal['continue', 'rollback']


class ContentWrite(Contract):
    baseRevision: int = Field(ge=1)
    baseHash: Digest
    content: GameContent
    apply: bool = False


class BuildWrite(Contract):
    baseRevision: int = Field(ge=1)
    releaseCandidate: bool = False
    licenses: dict[str, Text] = Field(default_factory=dict, max_length=201)


class ReleaseWrite(Contract):
    reportIds: list[Identifier] = Field(min_length=1, max_length=20)
    gameplayConfirmed: bool
    visualConfirmed: bool
    licensesConfirmed: bool
    knownLimitations: list[Text] = Field(default_factory=list, max_length=50)


class SessionWrite(Contract):
    buildId: Identifier


class BrowserAction(Contract):
    type: Literal['keydown', 'keyup', 'press', 'click', 'wait', 'viewport']
    key: str | None = Field(default=None, max_length=20)
    selector: str | None = Field(default=None, max_length=160)
    milliseconds: int | None = Field(default=None, ge=0, le=3000)
    width: int | None = Field(default=None, ge=320, le=2560)
    height: int | None = Field(default=None, ge=240, le=1440)


class ActionsWrite(Contract):
    actions: list[BrowserAction] = Field(min_length=1, max_length=20)


def operate(project_id, token, operation, writable=False):
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token), writable=writable)
        return operation(Workspace(repository, project))


@router.get('')
def overview(project_id: Identifier, token: str = ''):
    return operate(project_id, token, lambda w: w.overview())


@router.post('')
def create(project_id: Identifier, token: str = ''):
    return operate(project_id, token, lambda w: w.create(), True)


@router.get('/file')
def read_file(project_id: Identifier, path: str, token: str = ''):
    return operate(project_id, token, lambda w: w.read(path))


@router.post('/patches')
def patch(project_id: Identifier, request: Patch, token: str = ''):
    return operate(project_id, token, lambda w: w.patch(request.baseRevision,
                   [c.model_dump() for c in request.changes], request.apply), True)


@router.post('/restore')
def restore(project_id: Identifier, request: Restore, token: str = ''):
    return operate(project_id, token, lambda w: w.restore(request.baseRevision, request.snapshotId, request.fullProject), True)


@router.get('/restore-transaction')
def restore_transaction(project_id: Identifier, token: str = ''):
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token), allow_restore_recovery=True)
        return dict(pending=Workspace(repository, project).path('restore-pending.json').exists())


@router.post('/restore-transaction')
def resolve_restore(project_id: Identifier, request: RestoreDecision, token: str = ''):
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token), allow_restore_recovery=True)
        workspace = Workspace(repository, project)
        if not workspace.path('restore-pending.json').is_file():
            from fastapi import HTTPException
            raise HTTPException(409, '没有待处理的恢复事务')
        return workspace.resolve_restore(request.decision)


@router.get('/source.zip')
def export_source(project_id: Identifier, token: str = ''):
    content = operate(project_id, token, lambda w: w.export_source())
    return Response(content, media_type='application/zip',
                    headers={'Content-Disposition': 'attachment; filename="game-source-development.zip"'})


@router.get('/backup.zip')
def backup(project_id: Identifier, token: str = ''):
    from core.game_backups import export_backup
    content = operate(project_id, token, lambda w: export_backup(w.repository, w.project))
    return Response(content, media_type='application/zip', headers={
        'Content-Disposition': 'attachment; filename="game-project-backup.zip"'})


@router.get('/datasets')
def read_content(project_id: Identifier, token: str = ''):
    return operate(project_id, token, lambda w: w.read('content/game-data.json'))


@router.put('/datasets')
def write_content(project_id: Identifier, request: ContentWrite, token: str = ''):
    def update(workspace):
        _, files = workspace.current(request.baseRevision)
        old = workspace.validate_content(files)
        data = request.content.model_copy(deep=True)
        previous = {d.datasetId: d for d in old.datasets}
        for dataset in data.datasets:
            original = previous[dataset.datasetId]
            if dataset.revision != original.revision:
                from fastapi import HTTPException
                raise HTTPException(409, '数据集修订已变化')
            if dataset.model_dump(exclude={'revision'}) != original.model_dump(exclude={'revision'}):
                dataset.revision += 1
        return workspace.patch(request.baseRevision, [dict(path='content/game-data.json',
            baseHash=request.baseHash, content=data.model_dump_json(indent=2))], request.apply)
    return operate(project_id, token, update, True)


@router.post('/template')
def install_template(project_id: Identifier, request: BuildWrite, token: str = ''):
    return operate(project_id, token, lambda w: WebBuilds(w.repository, w.project).install_template(request.baseRevision), True)


@router.get('/builds')
def list_builds(project_id: Identifier, token: str = ''):
    return operate(project_id, token, lambda w: WebBuilds(w.repository, w.project).list())


@router.post('/template-3d')
def install_3d(project_id: Identifier, request: BuildWrite, token: str = ''):
    return operate(project_id, token, lambda w: WebBuilds(w.repository,w.project).install_3d_template(request.baseRevision), True)


@router.get('/build-diagnostic')
def build_diagnostic(project_id: Identifier, token: str = ''):
    def read(workspace):
        import json
        path = workspace.path('build-diagnostic.json')
        return json.loads(path.read_bytes()) if path.is_file() else None
    return operate(project_id, token, read)


@router.post('/builds')
def create_build(project_id: Identifier, request: BuildWrite, token: str = ''):
    return operate(project_id, token, lambda w: WebBuilds(w.repository, w.project).build(
        request.baseRevision, request.releaseCandidate, request.licenses), True)


@router.get('/builds/{build_id}/preview')
def preview_build(project_id: Identifier, build_id: Identifier, channel: Identifier = 'standalone', token: str = '', embedded: bool = False, fit: bool = False):
    def read(workspace):
        page = WebBuilds(workspace.repository, workspace.project).preview(build_id)
        import json
        monitor = ('<script>(()=>{const channel=' + json.dumps(channel) + ';const buildId=' + json.dumps(build_id)
            + ";let count=0;function send(kind,message){if(++count<=100)parent.postMessage({type:'game-preview-diagnostic',channel,buildId,kind,message:String(message).slice(0,1000)},'*');}"
            + "addEventListener('error',e=>send('error',e.message||'资源加载失败'),true);"
            + "addEventListener('unhandledrejection',e=>send('rejection',e.reason));})();</script>")
        page = page.replace(b'<script>window.GAME_CONFIG', monitor.encode() + b'<script>window.GAME_CONFIG', 1)
        if fit and not embedded:
            # ponytail: 只调整工作台预览尺寸，冻结产物与游戏坐标保持不变。
            fit_style = b'<style>body{padding:12px!important}main>canvas{width:auto!important;height:auto!important;max-width:100%!important;max-height:max(180px,calc(100dvh - 220px))!important;object-fit:contain}main>h1{font-size:18px!important}main>small{max-height:24px;overflow:hidden}main>#message{min-height:24px!important;margin:8px 0}main>#hud{margin:8px 0}main>nav{margin:4px 0}</style>'
            page = page.replace(b'</head>', fit_style + b'</head>', 1)
        if embedded:
            from core.game_web_template import node_preview
            page = page.replace(b'<script>window.GAME_CONFIG', node_preview(channel) + b'<script>window.GAME_CONFIG', 1)
        return Response(page, media_type='text/html', headers={
            'Content-Security-Policy': PREVIEW_CSP.replace("frame-src 'none'", "frame-src 'self' blob:") if b'window.SCENE_RUNTIME=' in page else PREVIEW_CSP,
            'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'})
    return operate(project_id, token, read)


@router.get('/builds/{build_id}/web.zip')
def export_build(project_id: Identifier, build_id: Identifier, token: str = ''):
    content = operate(project_id, token, lambda w: WebBuilds(w.repository, w.project).export(build_id))
    return Response(content, media_type='application/zip', headers={
        'Content-Disposition': 'attachment; filename="game-web-development.zip"'})


def session_workspace(project_id, token):
    return operate(project_id, token, lambda workspace: workspace)


@router.post('/sessions')
async def open_session(project_id: Identifier, request: SessionWrite, token: str = ''):
    from core.game_browser_sessions import sessions
    workspace = session_workspace(project_id, token)
    page = WebBuilds(workspace.repository, workspace.project).preview(request.buildId)
    return await sessions.open(workspace, request.buildId, page)


@router.get('/sessions')
def list_sessions(project_id: Identifier, token: str = ''):
    from core.game_browser_sessions import sessions
    workspace = session_workspace(project_id, token)
    records = []
    for path in workspace.path('runs').glob('preview_*/session.json'):
        import json
        record = json.loads(workspace.path(path.relative_to(workspace.root).as_posix()).read_bytes())
        if record['sessionId'] not in sessions.sessions and record['state'] != 'closed':
            record['state'] = 'interrupted'
        records.append(record)
    return records


@router.get('/sessions/{session_id}')
async def inspect_session(project_id: Identifier, session_id: Identifier, token: str = ''):
    from core.game_browser_sessions import sessions
    session = sessions.get(session_id, session_workspace(project_id, token))
    return await sessions.inspect(session)


@router.post('/sessions/{session_id}/actions')
async def act_session(project_id: Identifier, session_id: Identifier, request: ActionsWrite, token: str = ''):
    from core.game_browser_sessions import sessions
    session = sessions.get(session_id, session_workspace(project_id, token))
    return await sessions.act(session, [a.model_dump(exclude_none=True) for a in request.actions])


@router.post('/sessions/{session_id}/capture')
async def capture_session(project_id: Identifier, session_id: Identifier, token: str = ''):
    from core.game_browser_sessions import sessions
    session = sessions.get(session_id, session_workspace(project_id, token))
    return await sessions.capture(session)


@router.post('/sessions/{session_id}/frame-intervals')
async def measure_session(project_id: Identifier, session_id: Identifier, token: str = ''):
    from core.game_browser_sessions import sessions
    session = sessions.get(session_id, session_workspace(project_id, token))
    return await sessions.measure(session)


@router.delete('/sessions/{session_id}')
async def close_session(project_id: Identifier, session_id: Identifier, token: str = ''):
    from core.game_browser_sessions import sessions
    session = sessions.get(session_id, session_workspace(project_id, token), allow_stale=True)
    await sessions.close(session)
    return dict(sessionId=session_id, state=session.state)


@router.get('/captures/{capture_id}')
def read_capture(project_id: Identifier, capture_id: Identifier, token: str = ''):
    def read(workspace):
        import json
        from core.game_projects import digest
        for path in workspace.path('runs').glob('*/session.json'):
            record = json.loads(workspace.path(path.relative_to(workspace.root).as_posix()).read_bytes())
            evidence = next((e for e in record.get('evidence', []) if e['evidenceId'] == capture_id), None)
            if evidence:
                image = workspace.path(evidence['relativePath'])
                if not image.is_file() or digest(image.read_bytes()) != evidence['hash']:
                    from fastapi import HTTPException
                    raise HTTPException(409, '截图缺失或损坏')
                return Response(image.read_bytes(), media_type='image/png', headers={'X-Content-Type-Options': 'nosniff'})
        from fastapi import HTTPException
        raise HTTPException(404, '截图不存在')
    return operate(project_id, token, read)


@router.post('/builds/{build_id}/releases')
def create_release(project_id: Identifier, build_id: Identifier, request: ReleaseWrite, token: str = ''):
    from core.game_releases import release
    return operate(project_id, token, lambda w: release(w.repository, w.project, build_id,
        request.reportIds, request.gameplayConfirmed, request.visualConfirmed, request.licensesConfirmed,
        request.knownLimitations), True)


@router.get('/releases/{release_id}')
def download_release(project_id: Identifier, release_id: Identifier, token: str = ''):
    def read(workspace):
        import json
        from fastapi import HTTPException
        from core.game_projects import digest
        path = workspace.path('exports/releases/index.json')
        records = json.loads(path.read_bytes()) if path.exists() else []
        record = next((r for r in records if r['releaseId'] == release_id), None)
        if record is None:
            raise HTTPException(404, '交付记录不存在')
        package = workspace.path(f'exports/releases/{release_id}.zip')
        if not package.is_file() or digest(package.read_bytes()) != record['packageHash']:
            raise HTTPException(409, '交付包完整性校验失败')
        return Response(package.read_bytes(), media_type='application/zip', headers={
            'Content-Disposition': 'attachment; filename="game-web-release.zip"'})
    return operate(project_id, token, read)
