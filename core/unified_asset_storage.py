"""统一素材存储；旧上传目录仅保留为迁移备份。"""
import hashlib
from pathlib import Path
import shutil
import threading
from urllib.parse import quote, unquote

_LOCK = threading.RLock()


def migrate_upload_directory(legacy, destination):
    """只复制一次，不覆盖冲突文件；成功后写标记，保留旧目录可恢复。"""
    legacy, destination = Path(legacy), Path(destination)
    marker = destination / '.legacy-imported'
    with _LOCK:
        if marker.exists():
            return
        destination.mkdir(parents=True, exist_ok=True)
        if legacy.is_dir():
            for source in legacy.rglob('*'):
                if source.is_symlink():
                    continue
                target = destination / source.relative_to(legacy)
                if source.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                elif source.is_file():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if target.exists():
                        with source.open('rb') as a, target.open('rb') as b:
                            if hashlib.file_digest(a, 'sha256').digest() != hashlib.file_digest(b, 'sha256').digest():
                                raise RuntimeError(f'素材迁移存在同名冲突: {source.name}')
                    else:
                        temporary = target.with_name(target.name + '.migrating')
                        shutil.copy2(source, temporary)
                        temporary.replace(target)
        marker.write_text('Original uploads retained as backup.\n', encoding='utf-8')


def import_local_entries(library, entries):
    """将旧目录扫描结果并入同一索引；删除过的素材/分组不会重新导入。"""
    changed = False
    libraries = library.setdefault('libraries', [])
    target = next((x for x in libraries if x.get('id') == 'default'), libraries[0] if libraries else None)
    if target is None:
        return False
    known = set(library.get('local_asset_imports') or [])
    indexed = {}
    for lib in libraries:
        for category in lib.get('categories', []):
            for item in category.get('items', []):
                indexed[item.get('url')] = item
    for entry in entries:
        rel = entry['file']
        url = entry['url']
        existing = indexed.get(url)
        if existing:
            # 兼容旧画布编辑侧写文件，只有侧写实际更新才刷新索引元数据。
            if entry.get('sidecar_mtime', 0) > existing.get('sidecar_mtime', 0):
                for field in ('caption', 'classification', 'sidecar_mtime'):
                    if field in entry:
                        existing[field] = entry[field]
                changed = True
        elif rel not in known:
            folder = entry.get('folder') or ''
            category_id = 'local_' + hashlib.sha1(folder.encode()).hexdigest()[:12]
            categories = target.setdefault('categories', [])
            category = next((x for x in categories if x.get('id') == category_id), None)
            if category is None:
                category = {'id':category_id, 'name':folder or '本地导入', 'type':'image',
                            'dir':'_local/' + folder if folder else '_local', 'items':[]}
                categories.append(category)
            item = {**entry, 'id':'asset_local_' + hashlib.sha1(rel.encode()).hexdigest()[:16],
                    'created_at':int(entry.get('created_at', 0) * 1000), 'local_file':rel}
            category['items'].append(item)
            indexed[url] = item
            changed = True
        if rel not in known:
            known.add(rel)
            changed = True
    if changed:
        library['local_asset_imports'] = sorted(known)
    return changed


def update_local_reference(library, old, new=None):
    """旧画布仍按文件路径操作时，同步统一索引，保留素材 ID。"""
    prefix = '/assets/library/_local/'
    changed = False
    known = set(library.get('local_asset_imports') or [])
    for lib in library.get('libraries', []):
        for category in lib.get('categories', []):
            kept = []
            for item in category.get('items', []):
                url = str(item.get('url') or '')
                rel = unquote(url[len(prefix):]) if url.startswith(prefix) else ''
                if rel and (rel == old or rel.startswith(old + '/')):
                    changed = True
                    known.add(rel)
                    if new is None:
                        continue
                    destination = new + rel[len(old):]
                    if Path(destination).name != Path(rel).name:
                        item['name'] = Path(destination).stem
                    item.update(url=prefix + quote(destination, safe='/'), file=destination, local_file=destination,
                                folder=destination.rsplit('/', 1)[0] if '/' in destination else '')
                    known.add(destination)
                kept.append(item)
            category['items'] = kept
    if changed:
        library['local_asset_imports'] = sorted(known)
    return changed


def canonicalize_items(library, storage_root, resolve_path, namespace=""):
    """将已登记的本地文件归档至 library；保留原文件，避免破坏旧画布链接。"""
    base = Path(storage_root).resolve()
    root = (base / namespace).resolve()
    if not root.is_relative_to(base):
        raise ValueError("非法素材存储命名空间")
    changed = False
    for lib in library.get('libraries', []):
        for category in lib.get('categories', []):
            for item in category.get('items', []):
                url = str(item.get('url') or '')
                if url.startswith('/assets/uploads/'):
                    item['url'] = '/assets/library/_local/' + url[len('/assets/uploads/'):]
                    changed = True
                    continue
                if url.startswith('/assets/library/'):
                    continue
                source = resolve_path(url)
                if not source or not Path(source).is_file():
                    continue
                source = Path(source)
                # 索引中的 ID 不参与目录构造，避免不可信数据形成路径穿越。
                folder = hashlib.sha1((lib.get('id','') + '/' + category.get('id','')).encode()).hexdigest()[:16]
                filename = hashlib.sha1((item.get('id','') + url).encode()).hexdigest()[:20] + source.suffix.lower()
                target = root / folder / filename
                target.parent.mkdir(parents=True, exist_ok=True)
                with _LOCK:
                    if not target.exists():
                        temporary = target.with_name(target.name + '.migrating')
                        shutil.copy2(source, temporary)
                        temporary.replace(target)
                item['url'] = '/assets/library/' + quote(target.relative_to(base).as_posix(), safe='/')
                changed = True
    return changed
