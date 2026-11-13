"""Portable canvas snapshots with bounded, verified ZIP extraction."""
import copy
import hashlib
import json
import re
import shutil
import stat
import tempfile
import time
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from fastapi import HTTPException

from core.canvas_paths import rewrite_media_urls, media_url_parts
from core.canvas_schema import check_version, validate_canvas
from core.game_projects import atomic_write, json_bytes, safe_path

MAX_COMPRESSED = 512 * 1024 * 1024
MAX_TOTAL = 2 * 1024 * 1024 * 1024
MAX_FILE = 512 * 1024 * 1024
MAX_FILES = 10000
MAX_JSON = 32 * 1024 * 1024


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def _public(value):
    if isinstance(value, dict):
        return {key: _public(item) for key, item in value.items()
                if key.lower().replace('_', '') not in
                {'token', 'apikey', 'password', 'secret', 'authorization', 'accesstoken', 'refreshtoken'}}
    if isinstance(value, list):
        return [_public(item) for item in value]
    if isinstance(value, str) and (re.match(r'^[A-Za-z]:[\\/]', value) or value.startswith('\\\\')):
        return ''
    return value


def export_bundle(store, canvas_id, resolve, strict=False):
    """Return a temporary ZIP; caller removes it after the response completes."""
    temporary = Path(tempfile.mkdtemp(prefix='canvas-export-'))
    try:
        with store.lock(canvas_id):
            canvas = _public(copy.deepcopy(dict(store.read(canvas_id))))
            before = store.read(canvas_id).get('revision', 0)
            references, dependencies, files = {}, [], {}
            total = 0

            def collect(url):
                nonlocal total
                parsed = media_url_parts(url)
                if parsed is None:
                    return url
                if parsed.scheme in ('http', 'https'):
                    dependency = {'url': url, 'kind': 'external'}
                    if dependency not in dependencies:
                        dependencies.append(dependency)
                    return url
                if parsed.scheme or parsed.netloc or not parsed.path.startswith(('/assets/', '/output/')):
                    return url
                key = unquote(parsed.path)
                if key in references:
                    return url
                try:
                    source = resolve(url)  # Includes actual project authorization.
                except HTTPException as error:
                    if error.status_code != 403:
                        raise
                    dependencies.append({'url': url, 'kind': 'unauthorized'})
                    return url
                if not source or not Path(source).is_file():
                    dependencies.append({'url': url, 'kind': 'missing'})
                    return url
                source = Path(source)
                size = source.stat().st_size
                if size > MAX_FILE or total + size > MAX_TOTAL or len(files) >= MAX_FILES - 2:
                    raise HTTPException(413, '画布资源超过导出配额')
                member = ('assets/' if key.startswith('/assets/') else 'outputs/') + hashlib.sha256(key.encode()).hexdigest() + source.suffix[:16]
                target = safe_path(temporary, member)
                target.parent.mkdir(parents=True, exist_ok=True)
                original_hash = digest(source)
                shutil.copyfile(source, target)
                copied_hash = digest(target)
                if (copied_hash != original_hash or digest(source) != original_hash
                        or target.stat().st_size != size):
                    raise HTTPException(409, '导出期间素材发生变化，请重试')
                references[key] = member
                files[member] = {'path': member, 'size': size, 'sha256': copied_hash}
                total += size
                return url

            rewrite_media_urls(canvas, collect)
            if strict and dependencies:
                raise HTTPException(422, '存在外部或缺失依赖，不能导出自包含包')
            if store.read(canvas_id).get('revision', 0) != before:
                raise HTTPException(409, '导出期间画布发生变化，请重试')
            atomic_write(temporary / 'canvas.json', json_bytes(canvas))
            files['canvas.json'] = {'path': 'canvas.json', 'size': (temporary / 'canvas.json').stat().st_size,
                                    'sha256': digest(temporary / 'canvas.json')}
            manifest = {'schemaVersion': 1, 'canvasId': canvas_id, 'revision': before,
                        'selfContained': not dependencies, 'dependencies': dependencies,
                        'references': references, 'files': list(files.values())}
            atomic_write(temporary / 'manifest.json', json_bytes(manifest))
            if any((temporary / name).stat().st_size > MAX_JSON for name in ('canvas.json', 'manifest.json')):
                raise HTTPException(413, '画布 JSON 超过归档配额')
            if total + sum((temporary / name).stat().st_size for name in ('canvas.json', 'manifest.json')) > MAX_TOTAL:
                raise HTTPException(413, '画布资源超过导出配额')
            archive = temporary / 'canvas.zip'
            with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as output:
                for member in ['manifest.json', *files]:
                    output.write(temporary / member, member)
            if archive.stat().st_size > MAX_COMPRESSED:
                raise HTTPException(413, '压缩包超过配额')
            return archive, manifest
    except BaseException:
        shutil.rmtree(temporary)
        raise


def _member(name):
    path = PurePosixPath(name)
    if (not name or '\\' in name or ':' in name or name.startswith('/')
            or any(part in ('', '.', '..') for part in name.split('/'))
            or any(part.rstrip(' .') != part for part in name.split('/'))
            or any(part.split('.')[0].upper() in {'CON', 'PRN', 'AUX', 'NUL',
                 *('COM' + str(i) for i in range(1, 10)), *('LPT' + str(i) for i in range(1, 10))}
                   for part in path.parts)):
        raise HTTPException(422, '不安全的归档路径')
    if name not in ('manifest.json', 'canvas.json') and path.parts[0] not in ('assets', 'outputs', 'thumbnails'):
        raise HTTPException(422, '归档包含不支持的文件')
    return name


def import_bundle(store, archive, owner, owner_dir, folder_for):
    if Path(archive).stat().st_size > MAX_COMPRESSED:
        raise HTTPException(413, '压缩包超过配额')
    staging = store.root / '.staging' / uuid.uuid4().hex
    staging.mkdir(parents=True)
    try:
        with zipfile.ZipFile(archive) as source:
            members, total = {}, 0
            entries = source.infolist()
            if len(entries) > MAX_FILES:
                raise HTTPException(413, '归档文件数超过配额')
            for item in entries:
                name = _member(item.filename)
                if item.orig_filename != item.filename:
                    raise HTTPException(422, '归档文件名包含空字符')
                mode = item.external_attr >> 16
                if (name.casefold() in members or item.is_dir() or item.flag_bits & 1
                        or stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                    raise HTTPException(422, '归档存在重复、链接或不支持的成员')
                members[name.casefold()] = name
                if item.file_size > MAX_FILE:
                    raise HTTPException(413, '归档单文件超过配额')
                if name in ('canvas.json', 'manifest.json') and item.file_size > MAX_JSON:
                    raise HTTPException(413, '归档 JSON 超过配额')
                target = safe_path(staging, name)
                target.parent.mkdir(parents=True, exist_ok=True)
                size = 0
                with source.open(item) as reader, target.open('xb') as writer:
                    for chunk in iter(lambda: reader.read(1024 * 1024), b''):
                        size += len(chunk)
                        total += len(chunk)
                        if size > MAX_FILE or total > MAX_TOTAL:
                            raise HTTPException(413, '归档展开大小超过配额')
                        writer.write(chunk)
            if 'manifest.json' not in members.values() or 'canvas.json' not in members.values():
                raise HTTPException(422, '缺少画布或清单')
        manifest = json.loads((staging / 'manifest.json').read_text(encoding='utf-8'))
        if manifest.get('schemaVersion') != 1:
            raise HTTPException(422, '归档清单版本不支持')
        check_version(manifest)
        listed = {}
        for entry in manifest['files']:
            name = _member(entry['path'])
            if name == 'manifest.json' or name in listed:
                raise HTTPException(422, '清单文件重复或无效')
            target = safe_path(staging, name)
            if not target.is_file() or target.stat().st_size != entry['size'] or digest(target) != entry['sha256']:
                raise HTTPException(422, '归档文件缺失或校验失败')
            listed[name] = entry
        if set(listed) != set(members.values()) - {'manifest.json'}:
            raise HTTPException(422, '清单与归档成员不一致')
        canvas = json.loads((staging / 'canvas.json').read_text(encoding='utf-8'))
        check_version(canvas)
        canvas_id = uuid.uuid4().hex
        folder = folder_for(canvas.get('title'), canvas_id)
        prefix = '/'.join(part for part in (owner_dir, folder) if part)
        references = manifest.get('references', {})
        for path in references.values():
            if path not in listed or not path.startswith(('assets/', 'outputs/')):
                raise HTTPException(422, '素材引用不在清单中')

        def rewrite(url):
            parts = media_url_parts(url)
            if parts is None:
                return url
            member = references.get(unquote(parts.path)) if not parts.scheme and not parts.netloc else None
            if member:
                kind, relative = member.split('/', 1)
                path = ('/assets/' if kind == 'assets' else '/output/') + prefix + '/' + relative
                return urlunsplit(('', '', quote(path, safe='/'), parts.query, parts.fragment))
            return url

        canvas = rewrite_media_urls(canvas, rewrite)
        canvas.update(id=canvas_id, owner=owner, output_folder=folder, schema_version=1,
                      project='default', revision=1, created_at=int(time.time() * 1000), updated_at=int(time.time() * 1000))
        canvas.pop('deleted_at', None)
        canvas.pop('_schema_warnings', None)
        errors = validate_canvas(canvas)
        if errors:
            raise HTTPException(422, {'message': '导入画布结构无效', 'errors': errors})
        (staging / 'canvas.json').unlink()
        (staging / 'manifest.json').unlink()
        return store.publish(canvas, [{'owner': owner_dir, 'folder': folder}], origin='imported', prepared=staging), manifest
    except (zipfile.BadZipFile, KeyError, TypeError, ValueError, OSError) as error:
        raise HTTPException(422, '归档格式或内容无效') from error
    finally:
        if staging.exists():
            shutil.rmtree(staging)
