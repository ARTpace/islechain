"""OpenAI 兼容地址与 Cloudflare 模型目录差异。"""
import re
from urllib.parse import urlsplit


def api_root(base_url):
    base = str(base_url or '').strip().rstrip('/')
    if re.search(r'/v\d+(?:beta)?$', base) or base.endswith('/openai'):
        return base
    return base + '/v1'


def is_cloudflare(base_url):
    parsed = urlsplit(base_url)
    return parsed.hostname == 'api.cloudflare.com' and re.fullmatch(
        r'/client/v4/accounts/[A-Za-z0-9_-]+/ai/v1/?', parsed.path) is not None


def models_endpoint(base_url):
    root = api_root(base_url)
    if is_cloudflare(root):
        return root[:-3] + '/models/search?task=Text%20Generation&per_page=50'
    return root + '/models'


def model_items(raw, cloudflare=False):
    if not isinstance(raw, dict):
        return []
    items = raw.get('data') or raw.get('models') or raw.get('list') or raw.get('result') or []
    if not isinstance(items, list):
        return []
    if cloudflare:
        return [{'id': item['name'], 'type': 'text'} for item in items
                if isinstance(item, dict) and item.get('name')]
    return items
