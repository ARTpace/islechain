"""本地项目备份包；导入到新身份，旧运行/构建/测试历史只保留作归档。"""
import io
import json
import os
import zipfile
from pathlib import Path

from fastapi import HTTPException

from core.game_project_models import Project, relative_path
from core.game_projects import ProjectStore, atomic_write, digest, json_bytes, safe_path, uid
from core.game_workspace import Workspace

MAX_BACKUP = 512 * 1024 * 1024
MAX_ENTRIES = 2000


def export_backup(repository, project):
    workspace = Workspace(repository, project)
    entries, excluded, total = {}, [], 0
    for parent, dirs, names in os.walk(workspace.root, followlinks=False):
        for name in list(dirs):
            relative = (Path(parent) / name).relative_to(workspace.root).as_posix()
            workspace.path(relative)
            if name in {'exports', 'node_modules', '.git', '__pycache__', '.cache', 'model3d-jobs', 'audio-jobs',
                        'native-sessions', 'native-runs', 'native-rounds', 'native-plugin-output', 'development-tasks'}:
                dirs.remove(name)
                excluded.append(relative)
        for name in names:
            relative = (Path(parent) / name).relative_to(workspace.root).as_posix()
            path = workspace.path(relative)
            if relative == 'native-runtime.json':
                excluded.append(relative)
                continue
            if name == '.env' or name.startswith('.env.'):
                raise HTTPException(422, '备份包含凭据文件，请移出后重试')
            if path.stat().st_size > 140 * 1024 * 1024:
                raise HTTPException(413, '备份单文件超过 140 MiB')
            content = path.read_bytes()
            total += len(content)
            if total > MAX_BACKUP or len(entries) >= MAX_ENTRIES:
                raise HTTPException(413, '备份超过 512 MiB 或 2000 文件')
            entries[relative] = content
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            archive.writestr('project/' + name, content)
        archive.writestr('backup.json', json_bytes(dict(schemaVersion=1, projectId=project.id,
            manifest={name: digest(content) for name, content in entries.items()}, excluded=excluded)))
    return stream.getvalue()


def read_backup(raw):
    if len(raw) > MAX_BACKUP:
        raise HTTPException(413, '压缩包超过 512 MiB')
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_ENTRIES + 1 or sum(i.file_size for i in infos) > MAX_BACKUP:
                raise ValueError('解压容量或条目数超限')
            names = [i.filename for i in infos]
            if len(set(n.casefold() for n in names)) != len(names):
                raise ValueError('包内路径重复或大小写冲突')
            for info in infos:
                relative_path(info.filename)
                if info.file_size > 140 * 1024 * 1024 or info.flag_bits & 1 or (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('不支持加密、符号链接或过大文件')
                if info.filename != 'backup.json' and not info.filename.startswith('project/'):
                    raise ValueError('未知包内路径')
            metadata = json.loads(archive.read('backup.json'))
            if metadata.get('schemaVersion') != 1 or not isinstance(metadata.get('manifest'), dict):
                raise ValueError('未知备份版本')
            entries = {name.removeprefix('project/'): archive.read(name) for name in names if name.startswith('project/')}
            if set(entries) != set(metadata['manifest']) or any(digest(c) != metadata['manifest'][n] for n, c in entries.items()):
                raise ValueError('备份清单或 hash 不一致')
            if 'project.json' not in entries:
                raise ValueError('备份缺少项目身份')
            for name in entries:
                if name == 'native-runtime.json' or name.split('/')[0] in (
                        'model3d-jobs', 'audio-jobs', 'native-sessions', 'native-runs', 'native-rounds', 'native-plugin-output', 'development-tasks'):
                    if name.split('/')[0] == 'model3d-jobs':
                        raise ValueError('备份不能包含 3D 任务凭据、付费任务记录或执行授权')
                    raise ValueError('备份不能包含执行授权、运行会话或付费任务凭据')
                if any(p == '.env' or p.startswith('.env.') for p in name.split('/')):
                    raise ValueError('包内包含凭据文件')
            return entries
    except (ValueError, KeyError, zipfile.BadZipFile, OSError) as exc:
        raise HTTPException(422, '备份包校验失败：' + str(exc)[:300]) from exc


def import_backup(repository, entries, owner, canvas_id, title):
    try:
        original = Project.model_validate_json(entries['project.json'])
    except ValueError as exc:
        raise HTTPException(422, '备份项目合同无效') from exc
    data = original.model_dump()
    data.update(id=uid('project'), owner=owner, canvasId=canvas_id, revision=1,
                title=title, archived=False, candidates=[], outputs=[])
    for asset in data['assets']:
        asset.update(generatorNodeId=None, promptNodeId=None, generatorNodeHistory=[])
    project = Project.model_validate(data)
    staging_root = safe_path(repository.root, f'imports/{uid("import")}')
    staging = ProjectStore(staging_root)
    staging.save(project, increment=False)
    workspace = Workspace(staging, project)
    for document in project.documents:
        name = f'documents/{document.id}.md'
        if name not in entries or digest(entries[name]) != document.contentHash:
            raise HTTPException(422, '备份正文与索引不匹配')
        atomic_write(workspace.path(name), entries[name])
    for name, content in entries.items():
        if name.startswith('assets/'):
            atomic_write(workspace.path(name), content)
        # 旧 ID 的记录不接入当前可写服务，防止历史证据冒充新项目通过。
        atomic_write(workspace.path('imported-history/' + name), content)
    for asset in project.assets:
        if asset.selected:
            staging.selected_content(project, asset)
    from core.game_media_assets import media_content
    for asset in project.mediaAssets:
        media_content(staging, project, asset)
    from core.game_project_files import file_content
    for file in project.projectFiles:
        file_content(staging, project, file)
    if 'workspace.json' in entries:
        try:
            state = json.loads(entries['workspace.json'])
            if state.get('schemaVersion') != 1:
                raise ValueError('未知工程版本')
            active = state['active']
            relative_path(active)
            prefix = active + '/'
            files = {name[len(prefix):]: content for name, content in entries.items() if name.startswith(prefix)}
            if files:
                workspace.commit(workspace.state(), files, '从备份恢复当前文件', restore=True)
        except (ValueError, KeyError, TypeError) as exc:
            raise HTTPException(422, '备份工程索引无效') from exc
    destination = repository.directory(project.id)
    if destination.exists():
        raise HTTPException(409, '新项目 ID 冲突')
    # 只把校验完成的完整目录发布到项目索引，不发布半个项目。
    os.replace(staging.directory(project.id), destination)
    return project
