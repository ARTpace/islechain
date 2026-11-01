"""PoseAtlas 索引适配；连接时只请求 JSON，不下载图片。"""
import hashlib
import json
import re
from io import BytesIO
from pathlib import Path
import threading
import uuid
from urllib.parse import urlsplit

from style_packs.repository import catalog_url, _fetch, _json, _relative

_THUMB_LOCKS = [threading.Lock() for _ in range(16)]
_THUMB_SEM = threading.BoundedSemaphore(4)
_VOCABULARY = json.loads(Path(__file__).with_name('poseatlas_vocabulary.json').read_text('utf-8'))


def costume_title(main, color):
    tags = _VOCABULARY['tags']
    return ' · '.join(tags.get(x, x) for x in (main, color) if x)


def normalize_repository_title(item):
    """兼容旧索引中误用编号的衣装名称，保留用户自定义名称。"""
    if not isinstance(item, dict):
        return
    code = str(item.get('repository_id') or '')
    tags = (item.get('classification') or {}).get('tags') or []
    if item.get('repository_source') and re.fullmatch(r'[a-f0-9]{11}', code):
        old_name = ' · '.join([*tags[:2], code])
        if item.get('name') == old_name:
            item['name'] = ' · '.join(tags[:2]) or '人像参考'
        return
    if not item.get('repository_source') or not re.fullmatch(r'[A-Z]{3}-\d+', code):
        return
    if item.get('name') != code:
        return
    main = next((tag for tag in tags[3:] if tag in _VOCABULARY['primary_tags']), '')
    color = tags[2] if len(tags) > 2 else ''
    title = item.get('repository_title') or (costume_title(main, color) if main else '')
    if title:
        item['name'] = title


def cache_thumbnail(source, directory, fetch=_fetch):
    from PIL import Image, ImageOps
    parsed = urlsplit(source)
    if parsed.scheme != 'https' or parsed.netloc != 'raw.githubusercontent.com':
        raise ValueError('缩略图来源不支持')
    digest = hashlib.sha256(source.encode()).hexdigest()
    directory = Path(directory)
    path = directory / (digest + '.webp')
    with _THUMB_LOCKS[int(digest[:2], 16) % len(_THUMB_LOCKS)]:
        if path.is_file():
            return path
        with _THUMB_SEM:
            raw = fetch(source, 8 * 1024 * 1024)
            with Image.open(BytesIO(raw)) as image:
                image = ImageOps.exif_transpose(image).convert('RGB')
                image.thumbnail((480, 640))
                directory.mkdir(parents=True, exist_ok=True)
                temporary = directory / (digest + '.' + uuid.uuid4().hex + '.tmp')
                try:
                    image.save(temporary, 'WEBP', quality=78)
                    temporary.replace(path)
                finally:
                    temporary.unlink(missing_ok=True)
    return path


def repository_base(url):
    return catalog_url(url).removesuffix('catalog.json')


def build_libraries(url, fetch=_fetch):
    # ponytail: 仅适配 PoseAtlas 三份既有清单，不新增通用插件协议。
    base = repository_base(url)
    source_id = hashlib.sha256(base.encode()).hexdigest()[:16]
    libraries = []
    for kind, field, title in [('poses', 'poses', '姿势'), ('costumes', 'costumes', '衣装'), ('faces', 'images', '人像')]:
        data = _json(fetch(base + 'data/' + kind + '.json', 4 * 1024 * 1024))
        if not isinstance(data, dict) or not isinstance(data.get(field), list) or not data[field]:
            raise ValueError('仓库不是受支持的 PoseAtlas 格式：' + kind)
        if len(data[field]) > 10000:
            raise ValueError('仓库条目超过上限')
        labels = {x['key']: x.get('names', {}).get('zh', x['key'])
                  for group in ('categories', 'sections', 'hairs', 'angles', 'series')
                  for x in data.get(group, [])}
        categories = {}
        seen = set()
        for row in data[field]:
            category = str(row.get('category') or row.get('cat') or row.get('sec') or '未分类')
            category_id = 'repo_' + hashlib.sha256((source_id + kind + category).encode()).hexdigest()[:20]
            cat = categories.setdefault(category, {'id': category_id, 'name': labels.get(category, category), 'type': 'image', 'items': []})
            variants = row.get('variants', []) if kind == 'poses' else [row]
            for variant in variants:
                original_id = str(row['id']) + (':' + str(variant['angle']) if kind == 'poses' else '')
                if original_id in seen:
                    raise ValueError('仓库包含重复条目')
                seen.add(original_id)
                thumb = base + _relative(variant['thumb'])
                full = base + _relative(variant.get('image') or variant['full'])
                if kind == 'faces':
                    remote = str(row.get('full_remote') or '')
                    if remote:
                        parsed = urlsplit(remote)
                        if parsed.scheme != 'https' or parsed.netloc != 'ai-portrait-gallery.pages.dev':
                            raise ValueError('人像原图来源不支持')
                        full = remote
                item_id = 'repo_' + hashlib.sha256((source_id + kind + original_id).encode()).hexdigest()[:24]
                name = row.get('names', {}).get('zh') or str(row['id'])
                terms = [category, row.get('series'), row.get('group'), row.get('color'), row.get('hair'), row.get('style'), *row.get('tags', [])]
                terms = [labels.get(str(x), str(x)) for x in terms if x]
                if kind == 'poses':
                    name += ' · ' + labels.get(variant['angle'], variant['angle'])
                elif kind == 'costumes':
                    name = costume_title(row.get('main', ''), row.get('color', '')) or name
                elif kind == 'faces':
                    name = ' · '.join(terms[:2]) or '人像参考'
                cat['items'].append({'id': item_id, 'name': name, 'repository_title': name, 'kind': 'image', 'url': full,
                    'thumbnail': '/api/asset-library/repository/thumb/' + item_id,
                    'repository_thumb': thumb, 'repository_source': base, 'repository_id': original_id,
                    'pose_id': str(row['id']) if kind == 'poses' else '',
                    'repository_series': labels.get(row.get('series'), row.get('series', '')) if kind == 'poses' else '',
                    'repository_angle': variant.get('angle', '') if kind == 'poses' else '',
                    'classification': {'summary': ' '.join(terms), 'tags': terms,
                        'flat': [{'dimension': 'tags', 'label': '标签', 'tag': term} for term in dict.fromkeys(terms)]}, 'created_at': 0})
        libraries.append({'id': 'repo_' + source_id + '_' + kind, 'name': 'PoseAtlas · ' + title,
                          'type': 'asset', 'repository_url': url, 'repository_source': base,
                          'categories': list(categories.values())})
    return libraries


def merge_libraries(index, incoming):
    """重复接入只补新条目，保留用户改名、移动、删除；更新已有项的远程地址。"""
    known = {item['id']: item for lib in index.get('libraries', []) for cat in lib.get('categories', []) for item in cat.get('items', [])}
    added = 0
    for remote in incoming:
        local = next((x for x in index['libraries'] if x['id'] == remote['id']), None)
        if local is None:
            local = {**remote, 'categories': []}
            index['libraries'].append(local)
        seen = set(local.get('repository_seen', []))
        for category in remote['categories']:
            target = next((x for x in local['categories'] if x['id'] == category['id']), None)
            for item in category['items']:
                old = known.get(item['id'])
                if old:
                    if old.get('name') == old.get('repository_id'):
                        old['name'] = item['name']
                    for key in ('url', 'thumbnail', 'repository_thumb', 'repository_series', 'repository_angle'):
                        old[key] = item[key]
                elif item['id'] not in seen:
                    if target is None:
                        target = {**category, 'items': []}
                        local['categories'].append(target)
                    target['items'].append(item)
                    known[item['id']] = item
                    added += 1
                seen.add(item['id'])
        local['repository_seen'] = sorted(seen)
    return added
