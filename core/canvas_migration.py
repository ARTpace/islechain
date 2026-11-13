"""Offline copy-only migration. Never run while application writers are active."""
import json
import re
import shutil
import uuid
from pathlib import Path
from urllib.parse import unquote, urlsplit

from fastapi import HTTPException

from core.canvas_bundle import digest
from core.canvas_paths import rewrite_media_urls, owner_directory, media_url_parts
from core.canvas_schema import check_version, validate_canvas
from core.game_projects import atomic_write, json_bytes, safe_path


def plan(store, canvas_id):
    if store.published(canvas_id):
        raise HTTPException(409, '画布已发布，不能重复迁移')
    source = store.legacy_file(canvas_id)
    canvas = json.loads(source.read_text(encoding='utf-8-sig'))
    check_version(canvas)
    if canvas.get('id') != canvas_id or not canvas.get('output_folder'):
        raise HTTPException(422, '源 ID 或素材目录不明确，请先人工核对')
    alias = {'owner': owner_directory(canvas.get('owner')), 'folder': canvas['output_folder']}
    for other in store.documents():
        if other['id'] != canvas_id and owner_directory(other.get('owner')) == alias['owner'] and other.get('output_folder') == alias['folder']:
            raise HTTPException(409, '源画布存在地址别名冲突')
    relative = '/'.join(part for part in alias.values() if part)
    files = []
    for old, new in (('input', 'assets'), ('output', 'outputs')):
        root = safe_path(store.home / old, relative)
        if root.is_symlink():
            raise HTTPException(422, '迁移源不允许链接')
        for path in root.rglob('*') if root.exists() else []:
            if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
                raise HTTPException(422, '迁移源包含链接或越界路径')
            if path.is_file():
                name = path.relative_to(root).as_posix()
                files.append({'source': path.relative_to(store.home).as_posix(),
                              'path': new + '/' + name, 'size': path.stat().st_size, 'sha256': digest(path)})
    dependencies = []
    available = {entry['path'] for entry in files}

    def collect(url):
        parts = media_url_parts(url)
        if parts is None:
            return url
        decoded = unquote(parts.path)
        kind = 'external' if parts.scheme in ('http', 'https') else None
        if not parts.scheme and not parts.netloc:
            for old, new in (('/assets/', 'assets/'), ('/output/', 'outputs/')):
                if decoded.startswith(old):
                    own = old + relative + '/'
                    kind = 'shared' if not decoded.startswith(own) else ('missing' if new + decoded[len(own):] not in available else None)
        if kind and {'kind': kind, 'url': url} not in dependencies:
            dependencies.append({'kind': kind, 'url': url})
        return url

    rewrite_media_urls(canvas, collect)
    if any(item['kind'] == 'missing' for item in dependencies):
        raise HTTPException(422, '画布自身素材缺失，不能迁移')
    required = sum(entry['size'] for entry in files) + source.stat().st_size * 2 + 1024 * 1024
    if shutil.disk_usage(store.home).free < required:
        raise HTTPException(507, '磁盘空间不足')
    return {'schemaVersion': 1, 'operation': uuid.uuid4().hex, 'canvasId': canvas_id,
            'sourceHash': digest(source), 'aliases': [alias], 'files': files,
            'bytes': required, 'dependencies': dependencies, 'warnings': validate_canvas(canvas), 'state': 'planned'}


def _log_path(store, operation):
    if not re.fullmatch('[a-f0-9]{32}', operation):
        raise HTTPException(422, '无效迁移操作 ID')
    return store.root / '.migration' / (operation + '.json')


def _write_log(store, record):
    atomic_write(_log_path(store, record['operation']), json_bytes(record))


def _verify_sources(store, record):
    if digest(store.legacy_file(record['canvasId'])) != record['sourceHash']:
        raise HTTPException(409, '迁移后源画布已变化')
    actual = set()
    for alias in record['aliases']:
        relative = '/'.join(part for part in alias.values() if part)
        for kind in ('input', 'output'):
            root = safe_path(store.home / kind, relative)
            if root.is_symlink():
                raise HTTPException(409, '迁移源目录已变化')
            for path in root.rglob('*') if root.exists() else []:
                if path.is_symlink():
                    raise HTTPException(409, '迁移源包含链接')
                if path.is_file():
                    actual.add(path.relative_to(store.home).as_posix())
    if actual != {entry['source'] for entry in record['files']}:
        raise HTTPException(409, '迁移源出现新增或缺失文件')
    for entry in record['files']:
        source = safe_path(store.home, entry['source'])
        if not source.is_file() or source.stat().st_size != entry['size'] or digest(source) != entry['sha256']:
            raise HTTPException(409, '迁移源素材已变化')


def verify(store, record):
    snapshot = store._envelope(record['canvasId'])
    if not snapshot or snapshot.get('migrationOperation') != record['operation']:
        raise HTTPException(409, '迁移发布记录不匹配')
    root = store.directory(record['canvasId'])
    if digest(root / 'project.json') != record['projectHash'] or snapshot['revision'] != 1:
        raise HTTPException(409, '画布已接收新写入，不能按旧快照恢复或回滚')
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
    if actual != {'project.json', *(entry['path'] for entry in record['files'])}:
        raise HTTPException(409, '迁移项目出现新增或缺失文件')
    for entry in record['files']:
        target = safe_path(root, entry['path'])
        if target.stat().st_size != entry['size'] or digest(target) != entry['sha256']:
            raise HTTPException(409, '迁移目标素材已变化')
    if snapshot['legacyAliases'] != record['aliases']:
        raise HTTPException(409, '迁移别名发生变化')
    return True


def apply(store, record):
    """Caller guarantees a maintenance window; source files are never changed."""
    operation = record['operation']
    _log_path(store, operation)
    if store.published(record['canvasId']):
        verify(store, record)
        store.rebuild_index()
        record['state'] = 'published'
        _write_log(store, record)
        return record
    if record.get('state') == 'rolled_back':
        raise HTTPException(409, '该操作已回滚，请重新盘点')
    _verify_sources(store, record)
    record['state'] = 'copying'
    _write_log(store, record)
    staging = store.root / '.staging' / operation
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    for entry in record['files']:
        source = safe_path(store.home, entry['source'])
        target = safe_path(staging, entry['path'])
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        if digest(target) != entry['sha256']:
            raise HTTPException(409, '迁移复制校验失败')
    _verify_sources(store, record)
    canvas = json.loads(store.legacy_file(record['canvasId']).read_text(encoding='utf-8-sig'))
    canvas.update(schema_version=1, revision=1)
    expected = {'schemaVersion': 1, 'revision': 1, 'storageOrigin': 'migrated',
                'legacyAliases': record['aliases'], 'canvas': canvas, 'migrationOperation': operation}
    atomic_write(staging / 'project.json', json_bytes(expected))
    record.update(state='prepared', projectHash=digest(staging / 'project.json'))
    _write_log(store, record)
    store.publish(canvas, record['aliases'], origin='migrated', prepared=staging, operation_id=operation)
    verify(store, record)
    record['state'] = 'published'
    _write_log(store, record)
    return record


def rollback(store, record):
    destination = store.root / '.rollback' / record['operation']
    if record.get('state') == 'rolled_back':
        return record
    _verify_sources(store, record)
    # Recover a crash after quarantine rename but before index/log update.
    if not store.published(record['canvasId']) and destination.is_dir():
        if digest(destination / 'project.json') != record['projectHash']:
            raise HTTPException(409, '隔离副本不匹配')
    else:
        verify(store, record)
        destination.parent.mkdir(parents=True, exist_ok=True)
        store.directory(record['canvasId']).rename(destination)
    store.rebuild_index()
    record['state'] = 'rolled_back'
    _write_log(store, record)
    return record


def load_log(store, path):
    path = Path(path).resolve()
    if not path.is_relative_to((store.root / '.migration').resolve()):
        raise HTTPException(422, '只能使用服务端迁移日志')
    return json.loads(path.read_text(encoding='utf-8'))
