"""Named, typed worker ports; legacy aggregate canvas sockets remain compatible."""

import json
import math

from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.node_media import ImageExpectation, ImageFixture, fixture_image
from core.node_audio import AudioExpectation, AudioFixture, fixture_audio
from core.node_video import VideoExpectation, VideoFixture, fixture_video

MEDIA_TYPES = ('image', 'mask', 'audio', 'video')


class NodePort(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(pattern=r'^[a-z][a-z0-9_.-]{0,79}$')
    label: str = Field(min_length=1, max_length=60)
    type: str = Field(pattern=r'^(text|number|boolean|json|image|mask|audio|video)$')
    multiple: bool = False
    required: bool = True


class NodePorts(BaseModel):
    model_config = ConfigDict(extra='forbid')
    inputs: list[NodePort] = Field(default_factory=list, max_length=12)
    outputs: list[NodePort] = Field(min_length=1, max_length=12)

    @model_validator(mode='after')
    def unique(self):
        for ports in (self.inputs, self.outputs):
            if len({port.id for port in ports}) != len(ports):
                raise ValueError('同方向端口ID不可重复')
        return self


def _bounded_json(value, maximum=48000):
    try:
        if len(json.dumps(value, ensure_ascii=False, allow_nan=False)) > maximum:
            raise ValueError('端口数据超过大小上限')
    except (TypeError, RecursionError):
        raise ValueError('端口数据不是受支持的有限JSON') from None


def validate_values(ports, values, mode='input'):
    if not isinstance(values, dict) or set(values) - {port.id for port in ports}:
        raise ValueError('端口数据必须是只包含声明端口ID的对象')
    _bounded_json(values)
    image_count = 0
    for port in ports:
        if port.id not in values:
            if port.required:
                raise ValueError(f'必填端口缺失：{port.id}')
            continue
        value = values[port.id]
        if port.multiple and (not isinstance(value, list) or len(value) > 8 or port.required and not value):
            raise ValueError(f'{port.id}: 集合端口需要1—8项（可选端口可为空）')
        items = value if port.multiple else [value]
        for item in items:
            if port.type in MEDIA_TYPES:
                image_count += 1
                if mode == 'fixture':
                    (VideoFixture if port.type == 'video' else AudioFixture if port.type == 'audio' else ImageFixture).model_validate(item)
                elif mode == 'expected':
                    (VideoExpectation if port.type == 'video' else AudioExpectation if port.type == 'audio' else ImageExpectation).model_validate(item)
                elif not isinstance(item, str) or not item or len(item) > (100 if mode == 'output' else 32):
                    raise ValueError(f'{port.id}: 需要图片资源ID或输出相对文件名')
            elif port.type == 'text' and (not isinstance(item, str) or len(item) > 16000):
                raise ValueError(f'{port.id}: 需要16000字符以内的文本')
            elif port.type == 'number' and (type(item) not in (int, float) or not math.isfinite(item)):
                raise ValueError(f'{port.id}: 需要有限数值，不接受布尔值')
            elif port.type == 'boolean' and type(item) is not bool:
                raise ValueError(f'{port.id}: 需要布尔值')
            elif port.type == 'json':
                _bounded_json(item, 16000)
    if image_count > 8:
        raise ValueError('所有图片/蒙版端口合计最多8项')
    return values


def test_inputs(ports, values, media, cleanup):
    validate_values(ports.inputs, values, 'fixture')
    result = dict(values)
    for port in ports.inputs:
        if port.type not in MEDIA_TYPES or port.id not in values:
            continue
        fixtures = values[port.id] if port.multiple else [values[port.id]]
        handles = []
        for fixture in fixtures:
            handle = (media.save(fixture_video(fixture), video=True) if port.type == 'video' else media.save(fixture_audio(fixture), audio=True) if port.type == 'audio' else media.save(fixture_image(fixture)))['id']
            cleanup.callback(media.remove, handle)
            handles.append(handle)
        result[port.id] = handles if port.multiple else handles[0]
    return result


def prepare_inputs(ports, values, media, directory):
    validate_values(ports.inputs, values)
    result, locations, handles = dict(values), [], []
    for port in ports.inputs:
        if port.type not in MEDIA_TYPES or port.id not in values:
            continue
        items = values[port.id] if port.multiple else [values[port.id]]
        locations.append((port, len(handles), len(items)))
        handles.extend(items)
    if media is not None:
        staged = media.stage(handles, directory)
        for port, offset, count in locations:
            items = staged[offset:offset + count]
            for item in items:
                if item.get('kind', 'image') != ('image' if port.type == 'mask' else port.type):
                    raise ValueError('端口媒体类型与资源不匹配')
                item['type'] = port.type
                if port.type == 'mask':
                    from PIL import Image
                    from pathlib import Path
                    import hashlib
                    path = Path(directory) / item['path']
                    with Image.open(path) as image:
                        mask = image.convert('L')
                    with mask:
                        mask.save(path, 'PNG')
                    item['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            result[port.id] = items if port.multiple else items[0]
    elif handles:
        raise ValueError('图片端口需要账号资源上下文')
    return result


def finish_outputs(ports, values, media, directory, cancel):
    validate_values(ports.outputs, values, 'output')
    files, masks, audios, videos, pictures, text = [], set(), set(), set(), set(), []
    for port in ports.outputs:
        if port.id not in values:
            continue
        items = values[port.id] if port.multiple else [values[port.id]]
        if port.type in MEDIA_TYPES:
            files.extend(items)
            if port.type not in ('audio', 'video'):
                pictures.update(items)
            if port.type == 'mask':
                masks.update(items)
            if port.type == 'audio':
                audios.update(items)
            if port.type == 'video':
                videos.update(items)
        else:
            text.extend(item if isinstance(item, str) else json.dumps(item, ensure_ascii=False, allow_nan=False) for item in items)
    combined = '\n'.join(text)
    if len(combined) > 16000:
        raise ValueError('端口合并文本超过16000字符')
    paths = list(dict.fromkeys(files))
    if paths and media is None:
        raise ValueError('图片输出需要账号资源上下文')
    if audios.intersection(pictures | videos) or videos.intersection(pictures):
        raise ValueError('同一输出文件不能同时声明图片和音频')
    kwargs = {'mask_paths': masks}
    if audios:
        kwargs['audio_paths'] = audios
    if videos:
        kwargs['video_paths'] = videos
    published = media.publish(paths, directory, cancel, **kwargs) if paths else []
    references, result, images = dict(zip(paths, published, strict=True)), dict(values), []
    for port in ports.outputs:
        if port.type not in MEDIA_TYPES or port.id not in values:
            continue
        items = values[port.id] if port.multiple else [values[port.id]]
        refs = [{**references[item], 'portId': port.id, 'portType': port.type} for item in items]
        result[port.id] = refs if port.multiple else refs[0]
        if port.type not in ('audio', 'video'):
            images.extend(refs)
    return {'ports': result, 'text': combined, 'images': images}


def compare_outputs(ports, actual, expected):
    validate_values(ports.outputs, expected, 'expected')
    if set(actual) != set(expected):
        return False
    for port in ports.outputs:
        if port.id not in expected:
            continue
        found = actual[port.id] if port.multiple else [actual[port.id]]
        wanted = expected[port.id] if port.multiple else [expected[port.id]]
        if len(found) != len(wanted):
            return False
        for item, target in zip(found, wanted, strict=True):
            if port.type in MEDIA_TYPES:
                if any(item.get(key) != value for key, value in target.items() if value is not None):
                    return False
            elif type(item) is not type(target) and port.type != 'number' or item != target:
                return False
    return True


def canvas_ports(node, direction):
    if node.get('type') == 'extension':
        raw = node.get('fields', {}).get('nodeDefinition', node.get('nodeDefinition', 'null'))
        try:
            definition = json.loads(raw)
        except (ValueError, TypeError):
            definition = None
        if isinstance(definition, dict) and definition.get('ports'):
            return NodePorts.model_validate(definition['ports']).model_dump()[direction]
        media = isinstance(definition, dict) and definition.get('execution', {}).get('media')
        return [{'id': 'text', 'type': 'text', 'multiple': True}] + ([{'id': 'images', 'type': 'image', 'multiple': True}] if media else [])
    if node.get('type') in ('prompt', 'llm'):
        return [{'id': 'text', 'type': 'text', 'multiple': False}]
    if direction == 'outputs' and (node.get('type') in ('gameSpeech', 'gameSoundEffect', 'gameMusic', 'gameAudioScene')
                                  or node.get('type') == 'image' and node.get('mediaKind') == 'audio'):
        return [{'id': 'audio', 'type': 'audio', 'multiple': False}]
    if direction == 'outputs' and node.get('type') == 'image' and node.get('mediaKind') == 'video':
        return [{'id': 'video', 'type': 'video', 'multiple': False}]
    if direction == 'outputs' and node.get('type') in ('video', 'ltxDirector', 'minimax', 'output', 'comfy', 'rh', 'group'):
        return [{'id': name, 'type': kind, 'multiple': True} for name, kind in [('images', 'image'), ('video', 'video'), ('audio', 'audio')]]
    if direction == 'outputs':
        return [{'id': 'images', 'type': 'image', 'multiple': node.get('type') != 'image'}]
    return [{'id': 'text', 'type': 'text', 'multiple': True}, {'id': 'images', 'type': 'image', 'multiple': True}]


def validate_bindings(source, target, bindings):
    if not isinstance(bindings, list) or not 1 <= len(bindings) <= 24:
        raise ValueError('端口映射需要1—24项')
    outputs = {port['id']: port for port in canvas_ports(source, 'outputs')}
    inputs = {port['id']: port for port in canvas_ports(target, 'inputs')}
    seen, singles = set(), set()
    for binding in bindings:
        if (not isinstance(binding, dict) or set(binding) - {'source', 'target', 'index'}
                or not {'source', 'target'} <= set(binding) or not isinstance(binding['source'], str)
                or not isinstance(binding['target'], str)):
            raise ValueError('端口映射格式无效')
        origin, destination = outputs.get(binding['source']), inputs.get(binding['target'])
        if origin is None or destination is None:
            raise ValueError('端口ID缺失或版本已变化，请重新映射')
        if not (origin['type'] == destination['type'] or origin['type'] in ('image', 'mask') and destination['type'] in ('image', 'mask')):
            raise ValueError('端口类型不兼容，不隐式转换文本/数字/JSON')
        index = binding.get('index')
        if index is not None and (type(index) is not int or not 0 <= index < 8 or not origin.get('multiple')):
            raise ValueError('集合索引需要0—7且源端口必须是集合')
        if origin.get('multiple') and not destination.get('multiple') and index is None:
            raise ValueError('集合到单值端口需要显式选择索引')
        key = (binding['source'], binding['target'], index)
        if key in seen or not destination.get('multiple') and binding['target'] in singles:
            raise ValueError('映射重复或单值端口被多次绑定')
        seen.add(key)
        singles.add(binding['target'])
