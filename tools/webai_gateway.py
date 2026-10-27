"""WebAI2API 的模型分类与图片响应适配，不依赖浏览器或账号文件。"""
import re
import json
from urllib.parse import urljoin


def model_catalog(items):
    catalog = {}
    for item in items:
        if isinstance(item, dict) and item.get('id'):
            kind = {'text': 'chat', 'image': 'image', 'video': 'video', 'chat': 'chat'}.get(item.get('type'))
            catalog[str(item['id'])] = {
                'type': kind, 'image_policy': item.get('image_policy', 'optional'),
                'platform': item.get('owned_by', ''),
                'generation_params': item.get('generation_params'),
                'available': item.get('available', True),
            }
    return catalog


def validate_generation_params(schema, values, reference_count=0):
    """闭合参数声明：未开放、已移除或类型不匹配的值均不提交。"""
    schema = schema or {}
    if not isinstance(values, dict):
        raise ValueError('生成参数格式错误')
    website = schema.get('source') == 'website'
    if website and (schema.get('status') != 'ready' or not schema.get('params')):
        raise ValueError('尚未获取该模型的有效网站参数，请登录工作窗口并刷新模型')
    if schema.get('byProvider'):
        declared = next((p for p in schema.get('params', []) if p.get('key') == 'provider'), {})
        channel = values.get('provider', declared.get('default'))
        schema = schema['byProvider'].get(channel)
        if not schema or schema.get('status') != 'ready':
            raise ValueError('网站当前未开放该渠道，请重新选择')
    options = {p['key']: p.get('options', []) for p in schema.get('params', []) if p.get('key')}
    result = {}
    for key, value in values.items():
        allowed = [o.get('value') if isinstance(o, dict) else o for o in options.get(key, [])]
        if not any(type(value) is type(option) and value == option for option in allowed):
            raise ValueError(f'当前模型不支持 {key}={value}，请刷新参数后重新选择')
        result[key] = value
    if website and reference_count:
        limit = schema.get('max_reference_images')
        if not isinstance(limit, int) or reference_count > limit:
            raise ValueError('未获取参考图限制或参考图数量超限')
    return result


def image_results(raw, base_url):
    content = ((raw.get('choices') or [{}])[0].get('message') or {}).get('content', '')
    urls = []
    if isinstance(content, str):
        urls = re.findall(r'!\[[^\]]*\]\(([^\s)]+)\)', content)
        if not urls:
            urls = [line.strip() for line in content.splitlines()
                    if line.strip().startswith(('https://', 'http://', 'data:image/', '/'))]
    elif isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get('type') == 'image_url':
                value = part.get('image_url', {})
                urls.append(value.get('url', '') if isinstance(value, dict) else value)
    images = []
    for url in dict.fromkeys(urls):
        if url.startswith('data:image/') and ';base64,' in url:
            images.append({'type': 'b64', 'value': url.split(',', 1)[1]})
        elif url.startswith(('https://', 'http://', '/')):
            images.append({'type': 'url', 'value': urljoin(base_url + '/', url)})
    return images


async def read_progress_stream(response, on_progress):
    """读取网关显式进度扩展，心跳和文本增量不当作百分比。"""
    content = []
    completed = False
    async for line in response.aiter_lines():
        if not line.startswith('data:'):
            continue
        text = line[5:].strip()
        if text == '[DONE]':
            completed = True
            break
        event = json.loads(text)
        if event.get('error'):
            raise ValueError(event['error'].get('message') or '网关生成失败')
        if event.get('object') == 'webai.progress':
            on_progress({key: event.get(key) for key in ('source', 'stage', 'progress', 'job_id')})
        else:
            for choice in event.get('choices', []):
                delta = choice.get('delta', {}).get('content')
                if delta:
                    content.append(delta)
    if not completed:
        raise ValueError('网关进度连接中断，任务可能仍在运行，请勿重复提交')
    return {'choices': [{'message': {'content': ''.join(content)}}]}
