"""Small self-contained .artnode ZIPs; validate in memory, never extract paths."""

import hashlib
import io
import json
import stat
import zipfile
import zlib

from core import node_catalog

ALLOWED = {'manifest.json', 'node.json', 'tests.json', 'ui/index.html', 'ui/style.css', 'ui/worker.js', 'worker/main.py'}
MAX_BYTES = 1024 * 1024


def export_package(definition, tests):
    item = node_catalog.definition(definition)
    files = {'node.json': json.dumps(item, ensure_ascii=False).encode(),
             'tests.json': json.dumps(tests, ensure_ascii=False).encode()}
    manifest = {'apiVersion': 1, 'id': item['typeId'], 'version': item['version'],
                'componentVersion': item['componentVersion'], 'definitionHash': node_catalog.digest(item),
                'permissions': node_catalog.permissions(item),
                'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    files['manifest.json'] = json.dumps(manifest, ensure_ascii=False).encode()
    if len(files['tests.json']) > 524288 or sum(map(len, files.values())) > MAX_BYTES:
        raise ValueError('测试数据过大，无法导出自包含节点包')
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    data = stream.getvalue()
    if len(data) > 262144:
        raise ValueError('节点包超过 256 KiB，请减少内嵌测试数据')
    return data


def import_package(data):
    if not isinstance(data, bytes) or not 1 <= len(data) <= 262144:
        raise ValueError('节点包大小必须在 256 KiB 以内')
    files, total = {}, 0
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if not 3 <= len(entries) <= 9:
                raise ValueError('节点包文件数量无效')
            for entry in entries:
                mode = stat.S_IFMT(entry.external_attr >> 16)
                if mode == stat.S_IFLNK:
                    raise ValueError('节点包不接受符号链接')
                if entry.filename in ('ui/', 'worker/') and entry.is_dir():
                    continue
                if (entry.filename not in ALLOWED or entry.filename in files or mode not in (0, stat.S_IFREG)
                        or entry.flag_bits & 1 or entry.file_size > (524288 if entry.filename == 'tests.json' else 65536)):
                    raise ValueError('节点包存在不支持路径、重复文件、链接、加密或超大文件')
                total += entry.file_size
                if total > MAX_BYTES:
                    raise ValueError('节点包解压内容超过 1 MiB')
                files[entry.filename] = archive.read(entry)
        if not {'manifest.json', 'node.json', 'tests.json'} <= set(files):
            raise ValueError('节点包缺少 manifest.json、node.json 或 tests.json')
        manifest = json.loads(files['manifest.json'])
        if not isinstance(manifest, dict) or manifest.get('apiVersion') != 1 or manifest.get('componentVersion') != '1.0.0':
            raise ValueError('节点包宿主 API 或组件版本不兼容')
        hashes = manifest.get('files')
        if not isinstance(hashes, dict) or set(hashes) != set(files) - {'manifest.json'}:
            raise ValueError('节点包文件清单不完整')
        if any(hashes[name] != hashlib.sha256(files[name]).hexdigest() for name in hashes):
            raise ValueError('节点包文件哈希不匹配')
        item = json.loads(files['node.json'])
        if not isinstance(item, dict):
            raise ValueError('节点定义必须为对象')
        if 'worker/main.py' in files:
            if not isinstance(item.get('execution'), dict) or item['execution'].get('kind') != 'worker.python':
                raise ValueError('worker 文件没有对应执行器声明')
            code = files['worker/main.py'].decode('utf-8')
            if 'code' in item['execution'] and item['execution']['code'] != code:
                raise ValueError('worker 文件与内联代码不一致')
            item['execution']['code'] = code
        for name, key in (('ui/index.html', 'html'), ('ui/style.css', 'css'), ('ui/worker.js', 'script')):
            if name in files:
                if not isinstance(item.get('ui'), dict):
                    raise ValueError('UI 文件没有对应界面声明')
                source = files[name].decode('utf-8')
                if key in item['ui'] and item['ui'][key] != source:
                    raise ValueError('UI 文件与内联内容不一致')
                item['ui'][key] = source
        normalized = node_catalog.definition(item)
        if (manifest.get('id') != normalized['typeId'] or manifest.get('version') != normalized['version']
                or manifest.get('definitionHash') != node_catalog.digest(normalized)):
            raise ValueError('节点包身份、版本或定义哈希不匹配')
        required = node_catalog.permissions(normalized)
        if manifest.get('permissions') != required:
            raise ValueError('节点包权限声明与执行器不一致')
        return normalized, json.loads(files['tests.json'])
    except (zipfile.BadZipFile, UnicodeError, KeyError, RecursionError, NotImplementedError, zlib.error):
        raise ValueError('节点包损坏或包含不支持的编码/压缩格式') from None
