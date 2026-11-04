"""Bounded, hash-verified downloads for the exact local managed ComfyUI instance."""
import asyncio
import hashlib
import os
import re
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

import httpx


def managed_root(target):
    from routers import comfyui
    launch = comfyui._comfyui_launch
    if (target not in ('localhost:8188', '127.0.0.1:8188', '[::1]:8188') or not launch
            or launch['process'] is not comfyui._comfyui_process or launch['process'].poll() is not None):
        raise ValueError('受管下载只支持当前工具启动的本机ComfyUI实例')
    root = Path(launch['cwd']).resolve()
    if not (root / 'main.py').is_file():
        raise ValueError('受管ComfyUI目录无效')
    return root


def destination(root, model, *, existing=False):
    # ponytail: only the standard models/<category> layout; no arbitrary path mapping.
    category, filename = model['save_path'], model['filename']
    if category == 'default':
        category = {'checkpoint': 'checkpoints', 'checkpoints': 'checkpoints', 'lora': 'loras',
                    'loras': 'loras', 'vae': 'vae', 'controlnet': 'controlnet',
                    'embedding': 'embeddings', 'embeddings': 'embeddings'}.get(model.get('type', '').lower())
        if category is None:
            raise ValueError('模型类型没有明确的标准目录映射')
    if (not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', category)
            or not re.fullmatch(r'[\w .-]{1,160}\.safetensors', filename) or '..' in filename):
        raise ValueError('模型保存路径无效')
    root = Path(root).resolve()
    folder = root / 'models' / category
    if not folder.resolve().is_relative_to(root):
        raise ValueError('模型目录不能指向受管目录之外')
    if not existing:
        folder.mkdir(parents=True, exist_ok=True)
    target = folder / filename
    if target.is_symlink() or not existing and target.exists():
        raise ValueError('模型目标已经存在，不覆盖已有文件')
    return target


async def verify_existing(root, model, sha256, max_bytes):
    """Recover only a complete published file; never restart a network request."""
    validate_limits(sha256, max_bytes)
    target = destination(root, model, existing=True)
    if not target.is_file():
        raise ValueError('模型文件不存在，不能恢复成功状态；未重新下载')
    size, digest = 0, hashlib.sha256()
    path_before = target.stat()
    with target.open('rb') as stream:
        before = os.fstat(stream.fileno())
        if not 0 < before.st_size <= max_bytes:
            raise ValueError('模型文件大小超过预算或为空')
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            if size > max_bytes:
                raise ValueError('模型文件大小超过预算')
            digest.update(chunk)
            await asyncio.sleep(0)
        after = os.fstat(stream.fileno())
        current = target.stat()
    signature = lambda stat: (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    if signature(before) != signature(after) or signature(path_before) != signature(current):
        raise ValueError('校验期间模型文件发生变化，请重新核对')
    if digest.hexdigest() != sha256:
        raise ValueError('现有模型SHA256不匹配，保留原文件，不认定成功')
    return {'sha256': sha256, 'bytes': size, 'maxBytes': max_bytes, 'verified': True}


def validate_limits(sha256, max_bytes):
    if not isinstance(sha256, str) or not re.fullmatch(r'[a-f0-9]{64}', sha256):
        raise ValueError('受管下载必须提供可核对来源的SHA256')
    if type(max_bytes) is not int or not 1 <= max_bytes <= 100 * 1024**3:
        raise ValueError('下载容量预算必须为1字节至100GiB')


def check_url(url):
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.fragment
            or parsed.port not in (None, 443) or parsed.hostname not in (
                'huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.hf.co',
                'cas-bridge.xethub.hf.co', 'civitai.com', 'github.com', 'raw.githubusercontent.com',
                'release-assets.githubusercontent.com')):
        raise ValueError('模型下载或重定向地址不在支持的HTTPS来源中')


async def download(root, model, sha256, max_bytes):
    validate_limits(sha256, max_bytes)
    target = destination(root, model)
    if shutil.disk_usage(target.parent).free < max_bytes + 64 * 1024**2:
        raise ValueError('磁盘空间不足以容纳批准预算及64MiB余量')
    handle, temporary = tempfile.mkstemp(prefix='.art-model-', suffix='.part', dir=target.parent)
    os.close(handle)
    temporary = Path(temporary)
    try:
        async with asyncio.timeout(1200), httpx.AsyncClient(timeout=30, trust_env=False, follow_redirects=False) as client:
            url = model['url']
            for _ in range(6):
                check_url(url)
                async with client.stream('GET', url, headers={'Accept-Encoding': 'identity'}) as response:
                    if response.status_code in (301, 302, 303, 307, 308):
                        url = str(response.url.join(response.headers.get('location', '')))
                        continue
                    if response.status_code != 200:
                        raise ValueError(f'模型下载HTTP {response.status_code}，未自动重试')
                    if response.headers.get('content-encoding', 'identity') != 'identity':
                        raise ValueError('模型下载不接受压缩传输')
                    length = response.headers.get('content-length')
                    if length is not None and (not length.isdigit() or int(length) > max_bytes):
                        raise ValueError('模型声明大小超过下载预算或格式无效')
                    size, digest = 0, hashlib.sha256()
                    with temporary.open('wb') as stream:
                        async for chunk in response.aiter_raw():
                            size += len(chunk)
                            if size > max_bytes:
                                raise ValueError('模型实际大小超过下载预算')
                            digest.update(chunk)
                            stream.write(chunk)
                        stream.flush()
                        os.fsync(stream.fileno())
                    if length is not None and size != int(length):
                        raise ValueError('模型下载长度与响应声明不符')
                    if not size or digest.hexdigest() != sha256:
                        raise ValueError('模型SHA256不匹配，文件未发布')
                    # Hard link is an atomic no-overwrite publication on the same volume.
                    if not target.parent.resolve().is_relative_to(Path(root).resolve()):
                        raise ValueError('模型目录在下载期间发生变化')
                    os.link(temporary, target)
                    return {'sha256': sha256, 'bytes': size, 'maxBytes': max_bytes, 'verified': True}
            raise ValueError('模型下载重定向次数超过上限')
    except httpx.HTTPError:
        raise ValueError('模型下载网络错误；未发布文件，未自动重试') from None
    finally:
        temporary.unlink(missing_ok=True)
