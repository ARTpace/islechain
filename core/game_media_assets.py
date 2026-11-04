"""Project-owned binary assets; metadata goes to the model, bytes stay on disk."""
import base64
import io
import json
import struct
import wave
from pathlib import Path

from fastapi import HTTPException
from PIL import Image

from core.game_projects import digest, json_bytes, safe_path

MAX_ASSET = 32 * 1024 * 1024
MAX_MODEL = 100 * 1024 * 1024
MAX_ASSETS_TOTAL = 256 * 1024 * 1024


def inspect_media(filename, raw):
    ext = Path(filename).suffix.lower()
    maximum = MAX_MODEL if ext == '.glb' else MAX_ASSET
    if not raw or len(raw) > maximum:
        raise HTTPException(413, '模型最大 100 MiB，图片/音频最大 32 MiB，文件不能为空')
    try:
        if ext in ('.png', '.jpg', '.jpeg', '.webp'):
            with Image.open(io.BytesIO(raw)) as image:
                if image.format not in ('PNG', 'JPEG', 'WEBP') or max(image.size) > 8192 or getattr(image, 'n_frames', 1) != 1:
                    raise ValueError('图片格式或尺寸不支持')
                image.verify()
                return 'image', 'image/' + {'PNG':'png','JPEG':'jpeg','WEBP':'webp'}[image.format], dict(width=image.width, height=image.height)
        if ext == '.wav':
            with wave.open(io.BytesIO(raw)) as audio:
                duration = audio.getnframes() / audio.getframerate()
                if not audio.readframes(audio.getnframes()):
                    raise ValueError('空音频')
                return 'audio', 'audio/wav', dict(duration=round(duration, 3), channels=audio.getnchannels())
        if ext == '.mp3':
            offset = 0
            if raw.startswith(b'ID3'):
                if len(raw) < 10 or raw[3] not in (2,3,4) or any(b > 127 for b in raw[6:10]):
                    raise ValueError('MP3 ID3 头无效')
                offset = 10 + sum(b << (7*(3-i)) for i,b in enumerate(raw[6:10]))
            for i in range(offset,min(len(raw)-3,offset+4096)):
                if raw[i] == 255 and raw[i+1] & 224 == 224 and raw[i+1] & 6 and raw[i+2] >> 4 not in (0,15) and (raw[i+2] >> 2) & 3 != 3:
                    return 'audio', 'audio/mpeg', {}
            raise ValueError('没有有效 MP3 音频帧')
        if ext == '.ogg' and raw.startswith(b'OggS') and (b'vorbis' in raw[:256] or b'OpusHead' in raw[:256]):
            return 'audio', 'audio/ogg', {}
        if ext == '.glb':
            if len(raw) < 20 or struct.unpack_from('<4sII', raw) != (b'glTF', 2, len(raw)):
                raise ValueError('需要完整的 GLB 2.0 文件')
            size, kind = struct.unpack_from('<II', raw, 12)
            if kind != 0x4e4f534a or size % 4 or size + 20 > len(raw):
                raise ValueError('GLB JSON 数据块无效')
            document = json.loads(raw[20:20+size])
            if document.get('asset', {}).get('version') != '2.0':
                raise ValueError('仅支持 glTF 2.0')
            for item in document.get('buffers', []) + document.get('images', []):
                uri = item.get('uri', '')
                if uri and not uri.startswith('data:'):
                    raise ValueError('GLB 必须自包含，不能引用外部贴图或文件')
            unsupported = set(document.get('extensionsUsed', [])) & {'KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'}
            if unsupported:
                raise ValueError('请导出未使用 Draco/Meshopt/KTX2 压缩的 GLB')
            offset = 20 + size
            while offset < len(raw):
                length, _ = struct.unpack_from('<II', raw, offset)
                offset += 8 + length
                if offset > len(raw) or length % 4:
                    raise ValueError('GLB 数据块不完整')
            triangles = 0
            for mesh in document.get('meshes', []):
                for primitive in mesh.get('primitives', []):
                    index = primitive.get('indices', primitive.get('attributes', {}).get('POSITION'))
                    if not isinstance(index, int) or index < 0:
                        raise ValueError('模型缺少几何数据')
                    count = document['accessors'][index]['count']
                    if not isinstance(count, int) or count < 0:
                        raise ValueError('模型顶点数量无效')
                    mode = primitive.get('mode', 4)
                    triangles += count // 3 if mode == 4 else max(0, count - 2) if mode in (5, 6) else 0
            if not triangles:
                raise ValueError('模型缺少三角面几何')
            return 'model', 'model/gltf-binary', dict(animations=[str(a.get('name') or f'clip_{i}')[:100] for i,a in enumerate(document.get('animations', [])[:100])], meshes=len(document.get('meshes', [])), triangles=triangles, textured=bool(document.get('textures')), rigged=bool(document.get('skins')))
    except (ValueError, OSError, KeyError, TypeError, AttributeError, IndexError, RecursionError, struct.error, wave.Error) as exc:
        raise HTTPException(422, '资产文件无效：' + str(exc)[:160]) from exc
    raise HTTPException(422, '支持 PNG/JPEG/WebP、MP3/WAV/OGG 和自包含 GLB 2.0')


def media_content(repository, project, asset):
    original = repository.directory(project.id) / asset.relativePath
    if any(p.is_symlink() or (hasattr(p,'is_junction') and p.is_junction()) for p in (original,*original.parents)):
        raise HTTPException(422, '资产不允许符号链接')
    path = safe_path(repository.directory(project.id), asset.relativePath)
    if not path.is_file() or path.stat().st_size != asset.sizeBytes:
        raise HTTPException(409, '资产文件缺失或大小已变化：' + asset.name)
    raw = path.read_bytes()
    if digest(raw) != asset.contentHash:
        raise HTTPException(409, '资产内容校验失败：' + asset.name)
    return raw


def asset_context(project):
    return [dict(id=a.id, name=a.name, kind='image', purpose=a.purpose, usage=a.usage,
                 selected=bool(a.selected), metadata=dict(width=a.spec.width, height=a.spec.height)) for a in project.assets] + [
        dict(id=a.id, name=a.name, kind=a.kind, purpose=a.purpose, usage='runtime', selected=a.enabled,
             revision=a.revision, bytes=a.sizeBytes, metadata=a.metadata) for a in project.mediaAssets] + file_context(project)


def file_context(project):
    remaining=32768
    result=[]
    for file in project.projectFiles:
        doc=next((d for d in project.documents if d.id==file.documentId),None)
        text=doc.lastSavedContent[:remaining] if doc else ''
        remaining-=len(text)
        result.append(dict(id=file.id,name=file.path,kind='file',usage='reference',selected=False,text=text))
    if project.playableGraph:
        result.append(dict(kind='scene-graph',usage='reference',selected=False,graph=dict(entryNodeId=project.playableGraph.entryNodeId,nodes=[dict(id=n.id,title=n.title,signals=n.signals) for n in project.playableGraph.nodes],edges=[e.model_dump() for e in project.playableGraph.edges]),api="GameScene.state; GameScene.setState(patch); GameScene.emit(signal,patch). Each scene has its own canvas and disposable sandbox."))
    return result


def runtime_resources(repository, project):
    resources, urls, metadata = {}, {}, {}
    for asset in project.mediaAssets:
        if not asset.enabled:
            continue
        name = 'resources/' + asset.id + Path(asset.relativePath).suffix.lower()
        raw = media_content(repository, project, asset)
        resources[name] = (raw, asset.mime)
        urls[asset.id] = name
        metadata[asset.id] = dict(kind=asset.kind, name=asset.name, purpose=asset.purpose, **asset.metadata)
    return resources, urls, metadata


def asset_image(repository, project, asset_id):
    imported = next((a for a in project.mediaAssets if a.id == asset_id and a.enabled and a.kind == 'image'), None)
    image_asset = next((a for a in project.assets if a.id == asset_id and a.selected), None)
    if not imported and not image_asset:
        raise HTTPException(422, '没有可读取的图片资产')
    raw = media_content(repository, project, imported) if imported else repository.selected_content(project, image_asset)
    with Image.open(io.BytesIO(raw)) as image:
        image.thumbnail((768,768))
        buffer = io.BytesIO()
        image.convert('RGB').save(buffer,format='JPEG',quality=85)
    return 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode()


def inline_resources(page, resources):
    # ponytail: only sandbox previews inline bytes; the frozen/exported artifact uses separate files.
    if not resources:
        return page
    encoded = {name:'data:'+mime+';base64,'+base64.b64encode(raw).decode() for name,(raw,mime) in resources.items()}
    bootstrap = '<script>(()=>{const r=' + json.dumps(encoded) + ';for(const [id,url] of Object.entries(window.GAME_CONFIG.assets))if(r[url])window.GAME_CONFIG.assets[id]=r[url];})();</script>'
    marker = b'</script><script>'
    return page.replace(marker, b'</script>'+bootstrap.encode()+b'<script>', 1)
