"""Canvas snapshots with legacy dual reads, atomic publication and per-ID locks."""
import copy
import json
import re
import time
import uuid
from contextlib import contextmanager, ExitStack
from pathlib import Path
from threading import RLock

from fastapi import HTTPException

from core.canvas_schema import canvas_lock, check_write, check_version
from core.game_projects import atomic_write, json_bytes, safe_path

_index_lock = RLock()


class CanvasDocument(dict):
    """Remember the loaded snapshot so metadata edits do not replace a newer graph."""
    def __init__(self, data):
        super().__init__(data)
        self.original = copy.deepcopy(data)


class CanvasStore:
    def __init__(self, home, legacy=None):
        self.home = Path(home)
        self.root = self.home / 'projects'
        self.legacy = Path(legacy) if legacy else self.home / 'canvases'

    def directory(self, canvas_id):
        if not isinstance(canvas_id, str) or not re.fullmatch(r'[a-zA-Z0-9_-]+', canvas_id):
            raise HTTPException(400, '无效的画布 ID')
        try:
            return safe_path(self.root, canvas_id)
        except ValueError as error:
            raise HTTPException(400, '无效的画布 ID') from error

    def lock(self, canvas_id):
        self.directory(canvas_id)
        return canvas_lock(self.root, canvas_id)

    def legacy_file(self, canvas_id):
        self.directory(canvas_id)
        return safe_path(self.legacy, canvas_id + '.json')

    def published(self, canvas_id):
        # A directory without its snapshot is damaged, never a legacy fallback.
        return self.directory(canvas_id).exists()

    def _envelope(self, canvas_id):
        directory = self.directory(canvas_id)
        if directory.exists():
            try:
                value = json.loads((directory / 'project.json').read_text(encoding='utf-8'))
                if value['canvas']['id'] != canvas_id:
                    raise ValueError('ID mismatch')
                return value
            except (OSError, ValueError, KeyError, TypeError) as error:
                raise HTTPException(503, '画布项目损坏，已停止旧副本回退') from error
        return None

    def read(self, canvas_id, include_deleted=False):
        with self.lock(canvas_id):
            envelope = self._envelope(canvas_id)
            if envelope:
                if envelope.get('purgedAt'):
                    raise HTTPException(404, '画布已永久删除')
                data = envelope['canvas']
                data['revision'] = envelope['revision']
            else:
                try:
                    data = json.loads(self.legacy_file(canvas_id).read_text(encoding='utf-8-sig'))
                except FileNotFoundError:
                    raise HTTPException(404, '画布不存在')
            if data.get('deleted_at') and not include_deleted:
                raise HTTPException(404, '画布已在回收站')
            return CanvasDocument(data)

    def documents(self):
        ids = {p.stem for p in self.legacy.glob('*.json') if not p.name.startswith('.')}
        ids.update(p.name for p in self.root.glob('*') if p.is_dir() and not p.name.startswith('.'))
        for canvas_id in sorted(ids):
            if self.published(canvas_id) and self._envelope(canvas_id).get('purgedAt'):
                continue
            try:
                yield self.read(canvas_id, include_deleted=True)
            except HTTPException as error:
                if error.status_code != 404:
                    raise

    @contextmanager
    def media_cleanup_lock(self):
        # Only destructive reference cleanup freezes all canvas writers briefly.
        # Normal saves and media copies retain independent per-project locks.
        with _index_lock, ExitStack() as locks:
            ids = {p.stem for p in self.legacy.glob('*.json')}
            ids.update(p.name for p in self.root.glob('*') if p.is_dir() and not p.name.startswith('.'))
            for canvas_id in sorted(ids):
                locks.enter_context(self.lock(canvas_id))
            yield

    def save(self, canvas, base_revision=None, new=False, origin='new', aliases=None, fields=None):
        canvas_id = canvas['id']
        with self.lock(canvas_id):
            envelope = self._envelope(canvas_id)
            try:
                current = self.read(canvas_id, include_deleted=True)
            except HTTPException as error:
                if error.status_code != 404:
                    raise
                current = None
            if new and current is not None:
                raise HTTPException(409, '画布 ID 已存在')
            if envelope:
                if envelope.get('purgedAt'):
                    raise HTTPException(404, '画布已永久删除')
                check_version(envelope)
            if current is None:
                raise HTTPException(404, '画布不存在，禁止重建旧副本')
            revision = int((current or {}).get('revision', 0))
            if base_revision is not None and base_revision != revision:
                raise HTTPException(409, {'message': '画布已在别处修改，请刷新后重试', 'revision': revision})
            candidate = copy.deepcopy(dict(canvas))
            if isinstance(canvas, CanvasDocument) and current:
                # Apply only caller changes, retaining unrelated concurrent metadata.
                candidate = dict(current)
                for key in canvas.original.keys() - canvas.keys():
                    candidate.pop(key, None)
                candidate.update({k: copy.deepcopy(v) for k, v in canvas.items()
                                  if k in (fields or ()) or k not in canvas.original or v != canvas.original[k]})
            if current:
                for key in ('id', 'owner', 'output_folder', 'created_at', 'schema_version'):
                    if key in current:
                        candidate[key] = current[key]
            candidate.pop('_schema_warnings', None)
            candidate['schema_version'] = (current or {}).get('schema_version', 1)
            candidate['revision'] = revision + 1
            candidate['updated_at'] = max(int(time.time() * 1000), int((current or {}).get('updated_at', 0)) + 1)
            # Also check the submitted version before server-controlled metadata is restored.
            check_version(canvas)
            warnings = check_write(candidate, current, self.home)
            if new or envelope:
                snapshot = {**(envelope or {}), 'schemaVersion': 1, 'revision': revision + 1,
                            'storageOrigin': (envelope or {}).get('storageOrigin', origin),
                            'legacyAliases': (envelope or {}).get('legacyAliases', aliases or []),
                            'canvas': candidate}
                if new:
                    raise RuntimeError('Use create() for atomic project publication')
                atomic_write(self.directory(canvas_id) / 'project.json', json_bytes(snapshot))
            else:
                atomic_write(self.legacy_file(canvas_id), json_bytes(candidate))
            canvas.clear()
            canvas.update(candidate)
            if isinstance(canvas, CanvasDocument):
                canvas.original = copy.deepcopy(candidate)
            return warnings

    def publish(self, canvas, aliases, origin='new', prepared=None, operation_id=None):
        """Publish a validated staging directory; index is derived, never the commit point."""
        canvas = copy.deepcopy(dict(canvas))
        canvas_id = canvas['id']
        with _index_lock, self.lock(canvas_id):
            if self.published(canvas_id):
                raise HTTPException(409, '画布 ID 已存在')
            for directory in self.root.glob('*'):
                if directory.is_dir() and not directory.name.startswith('.'):
                    existing = self._envelope(directory.name)
                    if any(alias in existing.get('legacyAliases', []) for alias in aliases):
                        raise HTTPException(409, '画布地址别名冲突')
            for document in self.documents():
                if document['id'] == canvas_id:
                    if origin != 'migrated':
                        raise HTTPException(409, '画布 ID 已存在')
                    continue
                existing = self._envelope(document['id'])
                if existing and any(alias in existing.get('legacyAliases', []) for alias in aliases):
                    raise HTTPException(409, '画布地址别名冲突')
                if not existing:
                    from core.canvas_paths import owner_directory
                    old_alias = {'owner': owner_directory(document.get('owner')), 'folder': document.get('output_folder')}
                    if old_alias in aliases:
                        raise HTTPException(409, '画布旧地址别名冲突')
            check_write(canvas, None, self.home)
            canvas['schema_version'] = 1
            canvas['revision'] = 1
            staging = Path(prepared) if prepared else self.root / '.staging' / uuid.uuid4().hex
            staging.mkdir(parents=True, exist_ok=True)
            for name in ('assets', 'outputs', 'thumbnails'):
                (staging / name).mkdir(exist_ok=True)
            snapshot = {'schemaVersion': 1, 'revision': 1, 'storageOrigin': origin,
                        'legacyAliases': aliases, 'canvas': canvas}
            if operation_id:
                snapshot['migrationOperation'] = operation_id
            atomic_write(staging / 'project.json', json_bytes(snapshot))
            staging.rename(self.directory(canvas_id))
            self.rebuild_index()
            return CanvasDocument(canvas)

    def rebuild_index(self):
        with _index_lock:
            entries, aliases = {}, {}
            for directory in self.root.glob('*'):
                if not directory.is_dir() or directory.name.startswith('.'):
                    continue
                snapshot = self._envelope(directory.name)
                entries[directory.name] = snapshot.get('legacyAliases', [])
                for alias in snapshot.get('legacyAliases', []):
                    key = json.dumps(alias, sort_keys=True, ensure_ascii=False)
                    if key in aliases:
                        raise HTTPException(409, '画布地址别名冲突')
                    aliases[key] = directory.name
            atomic_write(self.root / 'index.json', json_bytes({'schemaVersion': 1, 'projects': entries}))
            return entries

    def purge(self, canvas_id):
        with _index_lock, self.lock(canvas_id):
            self.read(canvas_id, include_deleted=True)
            if self.published(canvas_id):
                snapshot = self._envelope(canvas_id)
                check_version(snapshot)
                check_version(snapshot['canvas'])
                # Keep a published tombstone so a retained legacy copy cannot reappear.
                snapshot['canvas']['deleted_at'] = snapshot['canvas'].get('deleted_at') or int(time.time() * 1000)
                snapshot['purgedAt'] = int(time.time() * 1000)
                destination = self.root / '.trash' / (canvas_id + '-' + uuid.uuid4().hex)
                destination.parent.mkdir(parents=True, exist_ok=True)
                atomic_write(self.directory(canvas_id) / 'project.json', json_bytes(snapshot))
                destination.mkdir()
                atomic_write(destination / 'project.json', json_bytes(snapshot))
                # Retain media conservatively: other canvases may still reference it.
                self.rebuild_index()
            else:
                check_version(self.read(canvas_id, include_deleted=True))
                destination = self.root / '.trash' / (canvas_id + '-' + uuid.uuid4().hex)
                destination.mkdir(parents=True)
                self.legacy_file(canvas_id).rename(destination / 'legacy.json')


def store_for(legacy_directory):
    return CanvasStore(Path(legacy_directory).parent, legacy_directory)
