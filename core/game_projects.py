"""项目持久化与交付文件。所有路径相对项目根，所有写入受跨进程锁保护。"""
import hashlib
import io
import json
import os
import threading
import time
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError
from pydantic import ValidationError

from core.game_project_models import Project, Review, Selection, relative_path

_LOCK = threading.RLock()
MAX_IMAGE_BYTES = 40 * 1024 * 1024


def uid(prefix):
    return prefix + '_' + uuid.uuid4().hex


def digest(content):
    return hashlib.sha256(content).hexdigest()


def source_hashes(project):
    return {**{doc.id: doc.contentHash for doc in project.documents},
            **{'table:' + table.id: digest(table.model_dump_json().encode()) for table in project.tables}}


def plan_sources_changed(project):
    current = source_hashes(project)
    # Added working documents do not modify the sources of an already adopted plan.
    return any(current.get(key) != value for key, value in project.planSourceHashes.items())


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name('.' + path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def json_bytes(data):
    return json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')


def safe_path(root, relative):
    relative_path(relative)
    root = Path(root).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise HTTPException(422, '路径超出项目目录')
    return path


def inspect_image(content, spec):
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(413, '图片超过 40 MiB')
    try:
        with Image.open(io.BytesIO(content)) as image:
            if image.width > 8192 or image.height > 8192 or getattr(image, 'n_frames', 1) != 1:
                raise HTTPException(422, '仅支持每边不超过 8192 的静态图片')
            image.load()
            fmt = (image.format or '').lower()
            if fmt not in ('png', 'jpeg', 'webp'):
                raise HTTPException(422, '仅支持 PNG/JPEG/WebP')
            alpha = 'A' in image.getbands() or 'transparency' in image.info
            transparent = alpha and image.convert('RGBA').getchannel('A').getextrema()[0] < 255
            info = dict(format=fmt, width=image.width, height=image.height,
                        hasAlpha=alpha, hasTransparentPixels=bool(transparent))
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(422, '图片不可读或格式无效') from exc
    issues = []
    if (info['width'], info['height']) != (spec.width, spec.height):
        issues.append(f"尺寸不符：实际 {info['width']}×{info['height']}，要求 {spec.width}×{spec.height}")
    if info['format'] != spec.format:
        issues.append('实际格式与规格不符')
    if spec.alphaRequired and not info['hasTransparentPixels']:
        issues.append('要求透明背景，但未发现透明像素；实际背景效果仍须人工确认')
    return info, issues


def project_image_path(root, url, owner):
    """只解析已认证账号的不可变项目图片，不接受 URL 中的任意磁盘路径。"""
    import re
    match = re.fullmatch(r'/api/game-projects/([A-Za-z0-9_-]{1,80})/files/([A-Za-z0-9_-]{1,80})/([A-Za-z0-9_-]{1,80})\.(png|jpeg|webp)', url or '')
    if not match:
        raise HTTPException(422, '项目图片地址无效')
    project_id, asset_id, selection_id, ext = match.groups()
    repository = ProjectStore(root)
    project = repository.read(project_id, owner)
    path = safe_path(repository.directory(project.id), f'assets/{asset_id}/{selection_id}.{ext}')
    if not path.is_file():
        raise HTTPException(404, '项目图片缺失')
    return path


def initial_game_workflow(project_id):
    nodes = [dict(id=uid('node'), type=kind, projectId=project_id, x=80 + index * 500, y=100)
             for index, kind in enumerate(('gameIdea', 'gamePlan', 'gameAssets'))]
    connections = [dict(id=uid('c'), **{'from': first['id'], 'to': second['id']})
                   for first, second in zip(nodes, nodes[1:])]
    return nodes, connections


def validate_document_nodes(repository, canvas, nodes):
    projects = {}
    previous = {node.get('id'): node for node in canvas.get('nodes', [])}
    for node in nodes:
        if node.get('type') not in ('document', 'gameTable', 'gameIdea', 'gamePlan', 'gameAssets', 'gameDevelop', 'gamePlay', 'gameTest', 'gameRelease', 'gameModelAsset', 'gameModel3d', 'gameAnimate3d', 'gameSpeech', 'gameSoundEffect', 'gameMusic', 'gameAudioScene', 'gameFile', 'gameFolder', 'gameScene'):
            continue
        project_id = node.get('projectId', '')
        if project_id not in projects:
            projects[project_id] = repository.read(project_id, canvas.get('owner'))
        project = projects[project_id]
        if project.canvasId != canvas['id'] or (node.get('type') == 'document' and not any(d.id == node.get('docId') for d in project.documents)):
            raise HTTPException(422, '拒绝跨项目或失效的文档节点引用')
        if node.get('type') == 'gameTable' and not any(t.id == node.get('tableId') for t in project.tables):
            raise HTTPException(422, '表格节点引用已失效')
        if project.archived:
            old = previous.get(node.get('id'), {})
            if (old.get('projectId'), old.get('docId'), old.get('tableId')) != (project.id, node.get('docId'), node.get('tableId')):
                raise HTTPException(409, '归档文档只允许保留既有节点')


class ProjectStore:
    def __init__(self, root):
        self.root = Path(root)

    @contextmanager
    def locked(self):
        # ponytail: 项目规模有限，单根目录锁同时保护关联唯一性和 revision；不建任务/数据库平台。
        self.root.mkdir(parents=True, exist_ok=True)
        with _LOCK, (self.root / '.write.lock').open('a+b') as stream:
            stream.seek(0, 2)
            if stream.tell() == 0:
                stream.write(b'0')
                stream.flush()
            deadline = time.monotonic() + 10
            while True:
                try:
                    stream.seek(0)
                    if os.name == 'nt':
                        import msvcrt
                        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise HTTPException(503, '项目正在保存，请稍后重试')
                    time.sleep(.02)
            try:
                yield
            finally:
                stream.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream, fcntl.LOCK_UN)

    def directory(self, project_id):
        import re
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', project_id):
            raise HTTPException(422, '项目 ID 无效')
        return safe_path(self.root, project_id)

    def read(self, project_id, owner, base=None, writable=False, allow_restore_recovery=False):
        path = self.directory(project_id) / 'project.json'
        if not path.is_file():
            raise HTTPException(404, '项目不存在')
        project = Project.model_validate_json(path.read_bytes())
        if project.owner != owner:
            raise HTTPException(403, '无权访问此项目')
        if not allow_restore_recovery and (self.directory(project_id) / 'restore-pending.json').exists():
            raise HTTPException(409, dict(message='完整恢复尚未完成，请明确继续或回滚恢复事务', restorePending=True))
        if base is not None and base != project.revision:
            raise HTTPException(409, dict(message='项目已被更新，请保留草稿并选择重新载入版本', revision=project.revision))
        if writable and project.archived:
            raise HTTPException(409, '项目已归档，请新建项目')
        if project.plan:
            project.planSourceChanged = plan_sources_changed(project)
        return project

    def save(self, project, increment=True):
        data = project.model_dump()
        if increment:
            data['revision'] += 1
        try:
            validated = Project.model_validate(data)
        except ValidationError as exc:
            raise HTTPException(422, str(exc)) from exc
        atomic_write(self.directory(project.id) / 'project.json', validated.model_dump_json(indent=2).encode())
        return validated

    def remember_content(self, project, kind, item):
        """每份资料保留最近 30 个旧版本；当前版本仍以 project.json 为准。"""
        path = safe_path(self.directory(project.id), f'history/{kind}/{item.id}/{item.revision}.json')
        atomic_write(path, json_bytes(item.model_dump()))
        versions = sorted((p for p in path.parent.glob('*.json') if p.stem.isdigit()), key=lambda p: int(p.stem), reverse=True)
        for old in versions[30:]:
            old.unlink()

    def content_history(self, project, kind, item):
        directory = safe_path(self.directory(project.id), f'history/{kind}/{item.id}')
        versions = [int(path.stem) for path in directory.glob('*.json') if path.stem.isdigit()]
        return sorted(set(versions + [item.revision]), reverse=True)

    def list(self, owner, canvas_id=None):
        result = []
        for path in self.root.glob('*/project.json'):
            # 损坏项目不能被当成不存在而重新关联同一画布。
            data = Project.model_validate_json(path.read_bytes())
            if data.owner == owner and (canvas_id is None or data.canvasId == canvas_id):
                result.append(dict(id=data.id, title=data.title, revision=data.revision,
                                   canvasId=data.canvasId, archived=data.archived))
        return result

    def recovery(self, project):
        problems = []
        for doc in project.documents:
            path = safe_path(self.directory(project.id), f'documents/{doc.id}.md')
            if not path.is_file() or digest(path.read_bytes()) != doc.contentHash:
                problems.append(dict(docId=doc.id, message='正文文件与项目索引不一致，可从上次已保存正文恢复'))
        return problems

    def write_document_file(self, project, doc):
        atomic_write(safe_path(self.directory(project.id), f'documents/{doc.id}.md'), doc.lastSavedContent.encode())

    def asset(self, project, asset_id):
        asset = next((a for a in project.assets if a.id == asset_id), None)
        if asset is None:
            raise HTTPException(404, '资产不存在')
        return asset

    def selected_content(self, project, asset):
        if not asset.selected:
            raise HTTPException(409, '尚未选用文件')
        path = safe_path(self.directory(project.id), asset.selected.relativePath)
        if not path.is_file():
            raise HTTPException(409, '选用文件缺失，请重新选用')
        content = path.read_bytes()
        if digest(content) != asset.selected.contentHash:
            raise HTTPException(409, '选用文件 hash 不符，请重新选用')
        return content

    def select(self, project, asset, content, source_node, output_id, source_revision):
        info, _ = inspect_image(content, asset.spec)
        selection_id = uid('selection')
        relative = f'assets/{asset.id}/{selection_id}.{info["format"]}'
        atomic_write(safe_path(self.directory(project.id), relative), content)
        asset.selected = Selection(selectionId=selection_id, relativePath=relative,
                                   sourceNodeId=source_node, sourceOutputId=output_id,
                                   contentHash=digest(content), sourceAssetRevision=source_revision)
        asset.review = Review()
        asset.needsUpdate = source_revision != asset.revision
        self.invalidate_dependents(project, {asset.id})
        return self.save(project)

    def invalidate_dependents(self, project, changed):
        visited = set(changed)
        while True:
            added = set()
            for item in project.assets:
                refs = set(item.referenceAssetIds)
                if item.visualOverride:
                    refs.update(item.visualOverride.referenceAssetIds)
                elif project.plan:
                    refs.update(r for r in project.plan.visualDirection.referenceAssetIds if r != item.id)
                if item.id not in visited and refs & visited:
                    item.revision += 1
                    item.needsUpdate = True
                    item.review = Review()
                    added.add(item.id)
            if not added:
                return
            visited.update(added)

    def review(self, project, asset, human_confirmed, accept_current):
        content = self.selected_content(project, asset)
        info, issues = inspect_image(content, asset.spec)
        if asset.needsUpdate and not accept_current:
            issues.append('资产已有修改，请重新选用或显式确认旧图仍适用')
        if not human_confirmed:
            issues.append('尚未人工确认语义、裁切、风格及透明效果')
        asset.review = Review(status='failed' if issues else 'passed', issues=issues,
                              humanConfirmed=human_confirmed, assetRevision=asset.revision,
                              selectionId=asset.selected.selectionId, imageInfo=info)
        if not issues and accept_current:
            asset.needsUpdate = False
        return self.save(project)

    def export(self, project, draft):
        issues, entries, files = [], [], {}
        if not project.planConfirmed or project.planSourceChanged:
            issues.append('策划尚未确认或来源已变化')
        if not project.artConfirmed:
            issues.append('美术方向尚未确认')
        for asset in project.assets:
            failures = []
            content = None
            info = None
            try:
                content = self.selected_content(project, asset)
                info, failures = inspect_image(content, asset.spec)
            except HTTPException as exc:
                failures.append(str(exc.detail))
            if (not asset.selected or asset.needsUpdate or asset.review.status != 'passed'
                    or not asset.review.humanConfirmed or asset.review.assetRevision != asset.revision
                    or (asset.selected and asset.review.selectionId != asset.selected.selectionId)):
                failures.append('待更新或检查未通过')
            if asset.required and failures:
                issues.append(asset.name + '：' + '；'.join(failures))
            if content is not None:
                destination = relative_path(asset.runtimeDestination)
                # format 不符的草稿资源仍保留真实扩展名，manifest 记录问题，避免伪装格式。
                if info['format'] != asset.spec.format:
                    destination = str(Path(destination).with_suffix('.' + info['format'])).replace('\\', '/')
                if destination.casefold() in {p.casefold() for p in files}:
                    raise HTTPException(422, '导出路径冲突')
                files[destination] = content
                entries.append(dict(assetId=asset.id, revision=asset.revision, usage=asset.usage,
                                    required=asset.required, path=destination, contentHash=digest(content),
                                    sourceAssetRevision=asset.selected.sourceAssetRevision,
                                    review=dict(status=asset.review.status, humanConfirmed=asset.review.humanConfirmed,
                                                assetRevision=asset.review.assetRevision),
                                    **info, issues=failures))
        from core.game_media_assets import media_content
        for asset in project.mediaAssets:
            if not asset.enabled:
                continue
            try:
                content = media_content(self, project, asset)
            except HTTPException as exc:
                issues.append(asset.name + '：' + str(exc.detail))
                continue
            destination = 'resources/' + asset.id + Path(asset.relativePath).suffix.lower()
            if destination.casefold() in {p.casefold() for p in files}:
                raise HTTPException(422, '导出路径冲突')
            files[destination] = content
            entries.append(dict(assetId=asset.id, revision=asset.revision, usage='runtime',
                                kind=asset.kind, path=destination, contentHash=digest(content),
                                mime=asset.mime, metadata=asset.metadata, issues=[]))
        if not any(a.usage == 'runtime' and a.required for a in project.assets) and not any(a.enabled for a in project.mediaAssets):
            issues.append('清单中没有必需运行时资源')
        if issues and not draft:
            raise HTTPException(409, dict(message='尚不能正式完成，可显式导出草稿', issues=issues))
        export_id = uid('export')
        manifest = dict(schemaVersion=1, projectId=project.id, projectRevision=project.revision,
                        planRevision=project.plan.revision if project.plan else None,
                        draft=draft, incomplete=issues, assets=entries)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('manifest.json', json_bytes(manifest))
            archive.writestr('plan.json', json_bytes(project.plan.model_dump() if project.plan else None))
            for doc in project.documents:
                archive.writestr(f'documents/{doc.id}.md', doc.lastSavedContent.encode('utf-8'))
            for table in project.tables:
                archive.writestr(f'tables/{table.id}.json', json_bytes(table.model_dump()))
            archive.writestr('checks.json', json_bytes(dict(incomplete=issues, assets=entries)))
            for path, content in files.items():
                archive.writestr(path, content)
        atomic_write(safe_path(self.directory(project.id), f'exports/{export_id}.zip'), buffer.getvalue())
        return dict(exportId=export_id, projectRevision=project.revision, draft=draft, issues=issues)
