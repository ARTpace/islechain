"""GLB 面数统计：只读文件头与 glTF JSON，不解码二进制缓冲。

用途是给减面一个可验证的出口：AI 说"已减到 5k"不算数，读一遍 accessor 的
count 才知道真实三角面数。纯标准库实现，不引入 trimesh / pygltflib。
"""

import json
import struct
from pathlib import Path

MAGIC = b'glTF'
CHUNK_JSON = 0x4E4F534A  # 'JSON'
CHUNK_BIN = 0x004E4942   # 'BIN\0'

# glTF primitive.mode，缺省是 4（TRIANGLES）
MODE_TRIANGLES = 4
MODE_STRIP = 5
MODE_FAN = 6


def _json_chunk(raw):
    """定位 JSON chunk。GLB 允许 BIN 在 JSON 前面，所以按 chunk 遍历而不是写死偏移。"""
    if len(raw) < 20 or raw[:4] != MAGIC:
        return None
    try:
        version, length = struct.unpack_from('<II', raw, 4)
    except struct.error:
        return None
    if version != 2:
        return None
    offset, end = 12, min(length, len(raw))
    while offset + 8 <= end:
        try:
            size, kind = struct.unpack_from('<II', raw, offset)
        except struct.error:
            return None
        offset += 8
        if offset + size > end:
            return None
        if kind == CHUNK_JSON:
            return raw[offset:offset + size]
        offset += size
    return None


def _count(accessors, index):
    if not isinstance(index, int) or index < 0 or index >= len(accessors):
        return 0
    try:
        return max(0, int(accessors[index].get('count') or 0))
    except (AttributeError, TypeError, ValueError):
        return 0


def summarize(raw):
    """把 GLB 字节统计成面数指标。不是合法 GLB 时返回 None，调用方按"未知"处理。"""
    chunk = _json_chunk(raw)
    if not chunk:
        return None
    try:
        gltf = json.loads(chunk.decode('utf-8').rstrip('\x00 '))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(gltf, dict):
        return None

    accessors = gltf.get('accessors') or []
    triangles = vertices = primitives = 0
    for mesh in gltf.get('meshes') or []:
        for prim in (mesh or {}).get('primitives') or []:
            if not isinstance(prim, dict):
                continue
            primitives += 1
            attributes = prim.get('attributes') or {}
            vertices += _count(accessors, attributes.get('POSITION'))
            indices = prim.get('indices')
            # 没有索引时按顶点顺序解释，这也是 glTF 的合法写法
            total = _count(accessors, indices) if indices is not None else _count(accessors, attributes.get('POSITION'))
            mode = prim.get('mode', MODE_TRIANGLES)
            if mode == MODE_TRIANGLES:
                triangles += total // 3
            elif mode in (MODE_STRIP, MODE_FAN):
                triangles += max(0, total - 2)

    return {
        'triangles': triangles,
        'vertices': vertices,
        'primitives': primitives,
        'meshes': len(gltf.get('meshes') or []),
        'materials': len(gltf.get('materials') or []),
        'images': len(gltf.get('images') or []),
        'nodes': len(gltf.get('nodes') or []),
        'bytes': len(raw),
        'extensions': [str(item) for item in (gltf.get('extensionsRequired') or [])][:8],
    }


def inspect_file(path):
    """读盘统计。文件不存在、被截断、是 .gltf 而不是 .glb 时都返回 None。"""
    try:
        raw = Path(path).read_bytes()
    except OSError:
        return None
    return summarize(raw)


def describe(stats):
    """给日志和节点状态用的一行中文描述。"""
    if not stats:
        return '面数未知'
    size = stats['bytes'] / 1024.0 / 1024.0
    return '%s 三角面 · %s 顶点 · %s 材质 · %.1f MB' % (
        format(stats['triangles'], ','), format(stats['vertices'], ','),
        stats['materials'], size)


# ---- UV 有效去重覆盖 ----------------------------------------------------
# 上游 hard-surface-pbr 的 uv-seams-smoothing.md:63-73 要求「从保存后实际低模的
# UV 三角形计算 0–1 内去重覆盖，注明算法和栅格分辨率；重叠只算一次，padding、
# 岛包围框和空白不计面积」。这里对最终 GLB 做一次只读实测，不采信 AI 自述。

_FMT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
_WIDTH = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
_NORM = {5121: 255.0, 5122: 32767.0, 5123: 65535.0, 5125: 4294967295.0}
UV_METHOD = 'clamped-barycentric-dedup'


def _bin_chunk(raw):
    """取 BIN chunk 字节。GLB 允许 BIN 在 JSON 前，按 chunk 遍历。"""
    if len(raw) < 20 or raw[:4] != MAGIC:
        return b''
    try:
        version, length = struct.unpack_from('<II', raw, 4)
    except struct.error:
        return b''
    if version != 2:
        return b''
    offset, end = 12, min(length, len(raw))
    while offset + 8 <= end:
        try:
            size, kind = struct.unpack_from('<II', raw, offset)
        except struct.error:
            return b''
        offset += 8
        if offset + size > end:
            return b''
        if kind == CHUNK_BIN:
            return raw[offset:offset + size]
        offset += size
    return b''


def _accessor(gltf, binary, index, components):
    """解一个 accessor 为标量元组列表。bufferView.byteStride 与 normalized 都处理。"""
    accessors = gltf.get('accessors') or []
    views = gltf.get('bufferViews') or []
    if not isinstance(index, int) or index < 0 or index >= len(accessors):
        return []
    acc = accessors[index] or {}
    view_index = acc.get('bufferView')
    if not isinstance(view_index, int) or view_index < 0 or view_index >= len(views):
        return []
    view = views[view_index] or {}
    comp_type = int(acc.get('componentType') or 5126)
    fmt = _FMT.get(comp_type)
    if not fmt:
        return []
    width = _WIDTH[comp_type]
    base = int(view.get('byteOffset') or 0) + int(acc.get('byteOffset') or 0)
    stride = int(view.get('byteStride') or 0) or width * components
    count = max(0, int(acc.get('count') or 0))
    scale = _NORM.get(comp_type) if acc.get('normalized') else None
    pattern = '<' + fmt * components
    values = []
    for i in range(count):
        offset = base + i * stride
        if offset + width * components > len(binary):
            break
        try:
            item = struct.unpack_from(pattern, binary, offset)
        except struct.error:
            break
        if scale:
            item = tuple(min(1.0, max(0.0, float(value) / scale)) for value in item)
        values.append(item)
    return values


def _uv_triangles(gltf, binary):
    """收集所有带 TEXCOORD_0 的 primitive 的 UV 三角形。"""
    accessors = gltf.get('accessors') or []
    triangles = []
    scope = {'primitives': 0, 'uvPrimitives': 0}
    for mesh in gltf.get('meshes') or []:
        for prim in (mesh or {}).get('primitives') or []:
            if not isinstance(prim, dict):
                continue
            scope['primitives'] += 1
            attributes = prim.get('attributes') or {}
            uv_index = attributes.get('TEXCOORD_0')
            if uv_index is None:
                continue
            uvs = _accessor(gltf, binary, uv_index, 2)
            if not uvs:
                continue
            scope['uvPrimitives'] += 1
            idx_index = prim.get('indices')
            if idx_index is not None:
                indices = [int(row[0]) for row in _accessor(gltf, binary, idx_index, 1) if row]
            else:
                indices = list(range(_count(accessors, attributes.get('POSITION')) or len(uvs)))
            mode = prim.get('mode', MODE_TRIANGLES)
            if mode == MODE_TRIANGLES:
                groups = (indices[i:i + 3] for i in range(0, len(indices) - 2, 3))
            elif mode == MODE_STRIP:
                groups = ([indices[i], indices[i + 1], indices[i + 2]]
                          for i in range(len(indices) - 2))
            elif mode == MODE_FAN:
                groups = ([indices[0], indices[i], indices[i + 1]]
                          for i in range(1, len(indices) - 1))
            else:
                continue
            for tri in groups:
                if len(tri) != 3 or any(i < 0 or i >= len(uvs) for i in tri):
                    continue
                triangles.append((uvs[tri[0]], uvs[tri[1]], uvs[tri[2]]))
    return triangles, scope


def _rasterize(triangles, grid):
    """重心坐标光栅化到布尔网格；重叠只置一次，越界 UV 按 clamp 计入。"""
    covered = bytearray(grid * grid)
    for a, b, c in triangles:
        p = [(min(1.0, max(0.0, u)) * grid, min(1.0, max(0.0, v)) * grid)
             for u, v in (a, b, c)]
        x0 = max(0, int(min(q[0] for q in p)))
        y0 = max(0, int(min(q[1] for q in p)))
        x1 = min(grid - 1, int(max(q[0] for q in p)))
        y1 = min(grid - 1, int(max(q[1] for q in p)))
        if x1 < x0 or y1 < y0:
            continue
        d = (p[1][1] - p[2][1]) * (p[0][0] - p[2][0]) + (p[2][0] - p[1][0]) * (p[0][1] - p[2][1])
        if abs(d) < 1e-9:
            continue
        for y in range(y0, y1 + 1):
            py = y + 0.5
            row = y * grid
            for x in range(x0, x1 + 1):
                px = x + 0.5
                l1 = ((p[1][1] - p[2][1]) * (px - p[2][0]) +
                      (p[2][0] - p[1][0]) * (py - p[2][1])) / d
                l2 = ((p[2][1] - p[0][1]) * (px - p[2][0]) +
                      (p[0][0] - p[2][0]) * (py - p[2][1])) / d
                if l1 >= -0.001 and l2 >= -0.001 and 1.0 - l1 - l2 >= -0.001:
                    covered[row + x] = 1
    return covered


def inspect_uv(path, grid=256):
    """读盘算 UV 覆盖。没有 TEXCOORD_0 时返回 hasUv=False，不伪造 0% 或 100%。"""
    try:
        raw = Path(path).read_bytes()
    except OSError:
        return None
    chunk = _json_chunk(raw)
    if not chunk:
        return None
    try:
        gltf = json.loads(chunk.decode('utf-8').rstrip('\x00 '))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(gltf, dict):
        return None
    triangles, scope = _uv_triangles(gltf, _bin_chunk(raw))
    result = dict(scope, grid=grid, method=UV_METHOD,
                  triangles=len(triangles), hasUv=bool(scope['uvPrimitives']))
    if not result['hasUv']:
        result['coverage'] = None
        return result
    covered = _rasterize(triangles, grid)
    result['coverage'] = round(sum(covered) / float(grid * grid), 4)
    return result


def inspect_uv_file(path, grid=256):
    return inspect_uv(path, grid)


def describe_uv(stats, target=0.80):
    """一行中文描述，达标与否如实标注，不把未达标写成通过。"""
    if not stats:
        return 'UV 未测（无法读取 GLB）'
    if not stats.get('hasUv'):
        return 'UV 未测：产物不含 TEXCOORD_0'
    text = 'UV 有效去重覆盖 %.2f%%（%d² 栅格 · %s）' % (
        stats['coverage'] * 100, stats['grid'], UV_METHOD)
    if stats['coverage'] < target:
        text += ' · 低于 %.0f%% 预设，记为质量失败项' % (target * 100)
    return text

