"""Account-bound image handles; workers only receive copies in their own scratch dir."""

import base64
import binascii
import hashlib
import io
import json
import uuid
import warnings
from pathlib import Path

from PIL import Image, ImageOps
from pydantic import BaseModel, ConfigDict, Field

from core import media_paths
from core.user_paths import user_data_dir

MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 16 * 1024 * 1024
MAX_IMAGES = 8


class ImageFixture(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    width: int = Field(ge=1, le=512)
    height: int = Field(ge=1, le=512)
    color: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')


class ImageExpectation(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    width: int = Field(ge=1, le=MAX_PIXELS)
    height: int = Field(ge=1, le=MAX_PIXELS)
    sha256: str | None = Field(default=None, pattern=r'^[0-9a-f]{64}$')


def fixture_image(value):
    fixture = ImageFixture.model_validate(value)
    with Image.new('RGB', (fixture.width, fixture.height), fixture.color) as image:
        stream = io.BytesIO()
        image.save(stream, 'PNG')
        return stream.getvalue()


def image_bytes(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_BYTES:
        raise ValueError('图片必须在 8 MiB 以内')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format not in ('PNG', 'JPEG', 'WEBP', 'BMP') or getattr(image, 'n_frames', 1) != 1:
                    raise ValueError('只支持静态 PNG/JPEG/WebP/BMP 图片')
                if image.width * image.height > MAX_PIXELS:
                    raise ValueError('图片不能超过 1600 万像素')
                image.load()
                normalized = ImageOps.exif_transpose(image).convert('RGBA')
        with normalized:
            stream = io.BytesIO()
            normalized.save(stream, format='PNG')
            encoded = stream.getvalue()
            if len(encoded) > MAX_BYTES:
                raise ValueError('标准化图片超过 8 MiB')
            return encoded, normalized.size
    except (OSError, SyntaxError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise ValueError('图片无法安全解码') from exc


class NodeMedia:
    def __init__(self, owner):
        if not isinstance(owner, str) or not owner:
            raise ValueError('图片资源需要登录账号')
        self.owner_key = hashlib.sha256(owner.encode()).hexdigest()
        self.root = Path(user_data_dir()) / 'node-plugins' / 'resources' / self.owner_key
        self.output_root = Path(media_paths.output_root()).resolve()
        self.folder = media_paths.sanitize_segment('node-' + self.owner_key)

    def metadata(self, resource_id):
        if not isinstance(resource_id, str) or len(resource_id) != 32 or any(c not in '0123456789abcdef' for c in resource_id):
            raise ValueError('图片资源 ID 无效')
        return self.root / (resource_id + '.json')

    def save(self, raw, *, audio=False, video=False):
        if video:
            from core.node_av import convert
            encoded, details = convert(raw, 'video')
        elif audio:
            from core.node_audio import audio_bytes
            encoded, details = audio_bytes(raw)
        else:
            encoded, (width, height) = image_bytes(raw)
            details = {'width': width, 'height': height}
        kind = 'video' if video else 'audio' if audio else 'image'
        resource_id = uuid.uuid4().hex
        directory, url = media_paths.resolve_media_dir(owner=self.folder, feature='node-plugins', kind=kind,
                                                       root=str(self.output_root), learn=False)
        path = Path(directory) / (resource_id + ('.mp4' if video else '.wav' if audio else '.png'))
        path.write_bytes(encoded)
        record = {'id': resource_id, 'kind': kind, **details,
                  'sha256': hashlib.sha256(encoded).hexdigest(), 'bytes': len(encoded),
                  'url': url + '/' + path.name, 'relativePath': path.relative_to(self.output_root).as_posix()}
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            self.metadata(resource_id).write_text(json.dumps(record), encoding='utf-8')
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return {key: value for key, value in record.items() if key != 'relativePath'}

    def import_data(self, data):
        if not isinstance(data, str) or len(data) > MAX_BYTES * 4 // 3 + 128:
            raise ValueError('图片数据超过 8 MiB')
        header, separator, encoded = data.partition(',')
        if not separator or header not in ('data:image/png;base64', 'data:image/jpeg;base64',
                                           'data:image/webp;base64', 'data:image/bmp;base64', 'data:audio/wav;base64', 'data:audio/x-wav;base64', 'data:audio/mpeg;base64', 'data:audio/mp3;base64', 'data:audio/aac;base64', 'data:audio/mp4;base64', 'data:audio/x-m4a;base64', 'data:video/mp4;base64'):
            raise ValueError('请提交静态图片 data URL，不接受远程 URL 或本机路径')
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError('图片 Base64 无效') from None
        return self.save(raw, audio=header.startswith('data:audio/'), video=header.startswith('data:video/'))

    def read(self, resource_id):
        metadata = self.metadata(resource_id)
        if not metadata.is_file():
            raise ValueError('图片资源不存在或不属于当前账号，请重新导入')
        record = json.loads(metadata.read_text(encoding='utf-8'))
        path = (self.output_root / record['relativePath']).resolve()
        if not path.is_relative_to(self.output_root / self.folder) or not path.is_file() or path.stat().st_size > MAX_BYTES:
            raise ValueError('图片资源已失效')
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != record['sha256']:
            raise ValueError('图片资源内容已变化，请重新导入')
        return raw, record

    def stage(self, resource_ids, directory):
        if not isinstance(resource_ids, list) or len(resource_ids) > MAX_IMAGES:
            raise ValueError('最多传入 8 张图片')
        inputs = Path(directory) / 'images-in'
        inputs.mkdir()
        result = []
        for index, resource_id in enumerate(resource_ids):
            raw, record = self.read(resource_id)
            path = inputs / (f'{index}.mp4' if record.get('kind') == 'video' else f'{index}.wav' if record.get('kind') == 'audio' else f'{index}.png')
            path.write_bytes(raw)
            result.append({'id': resource_id, 'path': path.relative_to(directory).as_posix(),
                           'kind': record.get('kind', 'image'),
                           **{key: record[key] for key in ('width', 'height', 'sha256', 'frames', 'sampleRate', 'channels', 'duration', 'frameRate', 'hasAudio') if key in record}})
        (Path(directory) / 'images-out').mkdir()
        return result

    def publish(self, outputs, directory, cancel_event=None, *, mask_paths=None, audio_paths=None, video_paths=None):
        if not isinstance(outputs, list) or not 1 <= len(outputs) <= MAX_IMAGES:
            raise ValueError('worker 必须返回 1—8 张图片')
        paths, raw_images, total = set(), [], 0
        root = Path(directory) / 'images-out'
        if root.is_symlink() or root.resolve() != Path(directory).resolve() / 'images-out':
            raise ValueError('图片输出目录不可替换为链接')
        for name in outputs:
            # ponytail: flat output names only; never open plugin-selected absolute or nested paths.
            if (not isinstance(name, str) or not name.startswith('images-out/') or len(name) > 100
                    or '\\' in name or ':' in name or len(Path(name).parts) != 2 or Path(name).name in ('.', '..')):
                raise ValueError('图片输出必须是 images-out/ 下的简单相对文件名，例如images-out/result.png；'
                                 'stdout不可返回绝对路径、裸文件名或Windows反斜杠路径。'
                                 '保存文件后单独返回"images-out/" + 文件名，不使用os.path.join构造协议路径。')
            path = Path(directory) / name
            if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()) or not path.is_file():
                raise ValueError('图片输出不存在、越界或是链接')
            if path.stat().st_nlink != 1 or path in paths or not 0 < path.stat().st_size <= MAX_BYTES:
                raise ValueError('图片输出重复、存在硬链接或大小超限')
            total += path.stat().st_size
            if total > 32 * 1024 * 1024:
                raise ValueError('图片输出总量超过 32 MiB')
            paths.add(path)
            is_audio = bool(audio_paths and name in audio_paths)
            is_video = bool(video_paths and name in video_paths)
            if is_video:
                from core.node_av import convert
                raw, _ = convert(path.read_bytes(), 'video')
            elif is_audio:
                from core.node_audio import audio_bytes
                raw, _ = audio_bytes(path.read_bytes())
            else:
                raw, _ = image_bytes(path.read_bytes())
            if mask_paths and name in mask_paths:
                from PIL import ImageChops
                with Image.open(io.BytesIO(raw)) as image:
                    red, green, blue, alpha = image.split()
                    if ImageChops.difference(red, green).getbbox() or ImageChops.difference(red, blue).getbbox():
                        raise ValueError('蒙版输出必须是灰度图片，不能发布彩色图片作为蒙版')
            raw_images.append((raw, is_audio, is_video))
        published = []
        try:
            for raw, is_audio, is_video in raw_images:
                if cancel_event is not None and cancel_event.is_set():
                    raise ValueError('worker 已取消，图片未发布')
                published.append(self.save(raw, video=True) if is_video else self.save(raw, audio=True) if is_audio else self.save(raw))
            if cancel_event is not None and cancel_event.is_set():
                raise ValueError('worker 已取消，图片未发布')
            return published
        except Exception:
            for record in published:
                self.remove(record['id'])
            raise

    def remove(self, resource_id):
        _, record = self.read(resource_id)
        (self.output_root / record['relativePath']).unlink(missing_ok=True)
        self.metadata(resource_id).unlink(missing_ok=True)
