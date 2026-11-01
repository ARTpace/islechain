"""公开 GitHub 内容仓库：缓存清单，按需下载 JSON，复用现有安全导入器。"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import urlopen
import zipfile

from content_packs.paths import MAX_PACK_BYTES, is_safe_filename
from .catalog import installed_packs, find_pack_dir
from .packer import PackError, import_pack
from .paths import USER_ROOT, is_valid_pack_id

STATE_FILE = USER_ROOT / 'data' / 'style-repository.json'
CHECK_INTERVAL = 15 * 60


def catalog_url(value):
    parsed = urlsplit(str(value).strip())
    parts = parsed.path.strip('/').split('/')
    if parsed.scheme != 'https' or parsed.query or parsed.fragment or parsed.port:
        raise PackError('请输入公开 GitHub 仓库地址或 raw.githubusercontent.com 的 catalog.json 地址')
    if parsed.netloc == 'github.com' and len(parts) >= 2:
        owner, repo = parts[:2]
        repo = repo.removesuffix('.git')
        if len(parts) == 2:
            tail = ['main', 'catalog.json']
        elif parts[2] == 'tree' and len(parts) >= 4:
            tail = parts[3:] + ['catalog.json']
        elif parts[2] == 'blob' and len(parts) >= 5 and parts[-1] == 'catalog.json':
            tail = parts[3:]
        else:
            raise PackError('仓库地址格式不支持，请使用仓库首页、tree 分支地址或 catalog.json 原始地址')
        parsed = urlsplit('https://raw.githubusercontent.com/' + '/'.join([owner, repo, *tail]))
    if parsed.netloc != 'raw.githubusercontent.com' or not parsed.path.endswith('/catalog.json'):
        raise PackError('目前仅支持公开 GitHub 仓库')
    if not re.fullmatch(r'/[A-Za-z0-9_.\-/]+', parsed.path) or any(p in ('.', '..', '') for p in parsed.path[1:].split('/')):
        raise PackError('仓库路径非法')
    return parsed.geturl()


def _fetch(url, limit):
    try:
        with urlopen(url, timeout=30) as response:
            if urlsplit(response.geturl()).netloc != 'raw.githubusercontent.com':
                raise PackError('仓库请求跳转到了不支持的地址')
            data = response.read(limit + 1)
    except (OSError, ValueError) as exc:
        raise PackError('仓库下载失败：%s' % exc) from exc
    if len(data) > limit:
        raise PackError('仓库文件超过大小上限')
    return data


def _json(data):
    try:
        return json.loads(data)
    except (ValueError, UnicodeError) as exc:
        raise PackError('仓库返回的内容不是有效 JSON') from exc


def _relative(path):
    if not isinstance(path, str) or not re.fullmatch(r'[A-Za-z0-9_.\-/]+', path) or any(p in ('', '.', '..') for p in path.split('/')):
        raise PackError('仓库包路径非法')
    if PurePosixPath(path).is_absolute():
        raise PackError('仓库包路径非法')
    return path


def _validate_catalog(data):
    if not isinstance(data, dict) or data.get('schema') != 1 or not isinstance(data.get('packs'), list):
        raise PackError('仓库需要 schema: 1 和 packs 数组')
    seen = set()
    for entry in data['packs']:
        if not isinstance(entry, dict) or not isinstance(entry.get('packId'), str) or not is_valid_pack_id(entry['packId']) or entry['packId'] in seen:
            raise PackError('仓库包含非法或重复的 packId')
        seen.add(entry['packId'])
        if entry.get('kind', 'styles') not in ('styles', 'artists', 'characters', 'tags'):
            raise PackError('仓库包含不支持的内容包类型')
        if not isinstance(entry.get('version'), str) or not isinstance(entry.get('entryCount'), int) or entry['entryCount'] <= 0:
            raise PackError('仓库包需要有效 version 和 entryCount')
        _relative(entry.get('path'))
        replaces = entry.get('replaces', [])
        if not isinstance(replaces, list) or any(not isinstance(pid, str) or not is_valid_pack_id(pid) or pid == entry['packId'] for pid in replaces):
            raise PackError('仓库替代包标识非法')
        hashes = entry.get('sha256')
        if not isinstance(hashes, dict) or 'pack.json' not in hashes or any(
            not is_safe_filename(name) or not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value)
            for name, value in hashes.items()
        ):
            raise PackError('仓库包需要逐文件 sha256（含 pack.json）')
    return data


def _read_state():
    if not STATE_FILE.exists():
        return {}
    try:
        data = json.loads(STATE_FILE.read_text(encoding='utf-8'))
        data['url'] = catalog_url(data['url'])
        _validate_catalog(data['catalog'])
        return data
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise PackError('仓库配置损坏，请重新设置仓库来源') from exc


def _content_module(kind):
    if kind == 'tags':
        import tag_packs
        return tag_packs
    if kind == 'artists':
        import artist_packs
        return artist_packs
    if kind == 'characters':
        import character_packs
        return character_packs
    raise PackError('不支持的内容包类型')


def _installed(kind):
    return installed_packs() if kind == 'styles' else _content_module(kind).installed_packs()


def _pack_root(kind, pack_id):
    if kind == 'styles':
        return find_pack_dir(pack_id)[0]
    return next((p.path for p in _content_module(kind).discover_packs() if p.pack_id == pack_id), None)


def repository_status():
    state = _read_state()
    local_by_kind = {kind: {p['packId']: p for p in _installed(kind)} for kind in {e.get('kind', 'styles') for e in state.get('catalog', {}).get('packs', [])}}
    packs = []
    for entry in state.get('catalog', {}).get('packs', []):
        kind = entry.get('kind', 'styles')
        local = local_by_kind[kind]
        installed = local.get(entry['packId'])
        update = False
        if installed:
            remote_version, local_version = entry['version'], installed['version']
            semver = r'(\d+)\.(\d+)\.(\d+)'
            remote_match, local_match = re.fullmatch(semver, remote_version), re.fullmatch(semver, local_version)
            if remote_match and local_match:
                update = tuple(map(int, remote_match.groups())) > tuple(map(int, local_match.groups()))
            else:
                update = remote_version != local_version
            if remote_version == local_version:
                root = _pack_root(kind, entry['packId'])
                update = root is None or any(
                    not (root / name).is_file() or hashlib.sha256((root / name).read_bytes()).hexdigest() != expected
                    for name, expected in entry['sha256'].items())
        packs.append({**entry, 'kind': kind, 'builtin': bool(installed and installed.get('builtin')), 'available': True, 'installed': bool(installed),
                      'installedVersion': installed['version'] if installed else '',
                      'blockedBy': [pid for pid in entry.get('replaces', []) if pid in local],
                      'updateAvailable': update})
    return {'url': state.get('url', ''), 'packs': packs, 'checkedAt': state.get('checkedAt', 0),
            'updateCount': sum(p['updateAvailable'] for p in packs)}


def check_repository():
    state = _read_state()
    if state and time.time() - state.get('checkedAt', 0) >= CHECK_INTERVAL:
        try:
            return refresh_repository(state['url'])
        except PackError as exc:
            return {**repository_status(), 'checkError': str(exc)}
    return repository_status()


def refresh_repository(url):
    url = catalog_url(url)
    catalog = _validate_catalog(_json(_fetch(url, 4 * 1024 * 1024)))
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp = STATE_FILE.with_suffix('.tmp')
    temp.write_text(json.dumps({'url': url, 'catalog': catalog, 'checkedAt': time.time()}, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(STATE_FILE)
    return repository_status()


def disconnect_repository():
    STATE_FILE.unlink(missing_ok=True)
    return {'url': '', 'packs': []}


def install_repository_pack(pack_id, replace=False):
    state = _read_state()
    entry = next((p for p in state.get('catalog', {}).get('packs', []) if p['packId'] == pack_id), None)
    if not entry:
        raise PackError('仓库清单中找不到此包，请先加载仓库')
    kind = entry.get('kind', 'styles')
    installed_ids = {p['packId'] for p in _installed(kind)}
    blocked = [pid for pid in entry.get('replaces', []) if pid in installed_ids]
    if blocked:
        raise PackError('请先导出备份并卸载旧整库包 %s，再按需安装平台包，避免重复加载' % '、'.join(blocked))
    base = state['url'].rsplit('/', 1)[0] + '/' + entry['path'] + '/'
    used = 0

    def fetch_file(name):
        nonlocal used
        if not is_safe_filename(name) or name not in entry['sha256']:
            raise PackError('清单缺少安全文件名或文件摘要：' + str(name))
        data = _fetch(base + name, MAX_PACK_BYTES - used)
        used += len(data)
        if hashlib.sha256(data).hexdigest() != entry['sha256'][name]:
            raise PackError('文件摘要不匹配，请刷新仓库后重试：' + name)
        return data

    manifest_bytes = fetch_file('pack.json')
    manifest = _json(manifest_bytes)
    if not isinstance(manifest, dict) or manifest.get('packId') != pack_id or manifest.get('version') != entry.get('version') or manifest.get('kind', 'styles') != kind:
        raise PackError('包标识或版本与仓库清单不一致')
    if kind not in ('styles', 'tags'):
        files = entry['sha256']
        if 'index.json' not in files:
            raise PackError('内容包缺少 index.json')
        contents = {'pack.json': manifest_bytes}
        for name in files:
            if name != 'pack.json':
                contents[name] = fetch_file(name)
        index = _json(contents['index.json'])
        items = index.get('items') if isinstance(index, dict) else None
        if not isinstance(items, list) or len(items) != entry['entryCount'] or manifest.get('entryCount') != len(items):
            raise PackError('实际条数与清单不一致')
        ids = set()
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id'] or item['id'] in ids:
                raise PackError('内容包包含缺失或重复的条目 ID')
            ids.add(item['id'])
        if kind == 'characters':
            from character_packs.paths import detail_filename, detail_shard_of
            shards = {}
            for item in items:
                name = detail_filename(detail_shard_of(item['id']))
                if name not in contents:
                    raise PackError('角色包缺少详情分片：' + name)
                if name not in shards:
                    shards[name] = _json(contents[name])
                if not isinstance(shards[name], dict) or not isinstance(shards[name].get(item['id']), dict):
                    raise PackError('角色包缺少条目详情：' + item['id'])
        with tempfile.TemporaryDirectory(prefix='content-repository-') as temp:
            target = Path(temp) / 'pack.zip'
            with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
                for name, data in contents.items():
                    archive.writestr(name, data)
            return _content_module(kind).import_pack(target, replace=replace)
    categories = manifest.get('categories')
    if not isinstance(categories, list) or not categories or len(categories) > 256:
        raise PackError('包分类清单无效')
    files = [c.get('file') if isinstance(c, dict) else None for c in categories]
    if any(not is_safe_filename(f) or f == 'pack.json' for f in files) or len(set(files)) != len(files):
        raise PackError('包分类文件名非法或重复')
    # ponytail: 只在临时目录中组装 ZIP，沿用统一导入校验；仓库本身不必保存 ZIP。
    with tempfile.TemporaryDirectory(prefix='style-repository-') as temp:
        target = Path(temp) / 'pack.zip'
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('pack.json', manifest_bytes)
            ids = set()
            for category, name in zip(categories, files):
                data = fetch_file(name)
                content = _json(data)
                if not isinstance(content, dict) or not isinstance(content.get('categories'), list) or len(content['categories']) != 1:
                    raise PackError('分类文件结构错误：' + name)
                cat = content['categories'][0]
                if not isinstance(cat, dict) or cat.get('id') != category.get('id') or not isinstance(cat.get('subcategories'), list):
                    raise PackError('分类文件与清单不一致：' + name)
                for sub in cat['subcategories']:
                    if not isinstance(sub, dict) or not isinstance(sub.get('presets'), list):
                        raise PackError('子分类结构错误：' + name)
                    for item in sub['presets']:
                        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id'] or item['id'] in ids or not isinstance(item.get('prompt'), str):
                            raise PackError('包包含缺失、重复的条目 ID 或非法正文')
                        ids.add(item['id'])
                archive.writestr(name, data)
        if not ids or manifest.get('entryCount') != len(ids) or entry.get('entryCount') != len(ids):
            raise PackError('实际条数与清单不一致')
        return (_content_module('tags').import_pack(target, replace=replace) if kind == 'tags' else import_pack(target, replace=replace))
