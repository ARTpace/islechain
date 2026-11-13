"""GLB 面数统计的回归检查：只读 JSON chunk，不依赖 Blender 或三方库。"""
import json
import struct
import tempfile
import unittest
from pathlib import Path

from core import glb_stats


def glb(gltf, binary=b''):
    """拼一个最小合法 GLB，用来验证统计口径。"""
    payload = json.dumps(gltf).encode('utf-8')
    payload += b' ' * ((4 - len(payload) % 4) % 4)
    binary += b'\x00' * ((4 - len(binary) % 4) % 4)
    chunks = struct.pack('<II', len(payload), 0x4E4F534A) + payload
    if binary:
        chunks += struct.pack('<II', len(binary), 0x004E4942) + binary
    return b'glTF' + struct.pack('<II', 2, 12 + len(chunks)) + chunks


def indexed_gltf(indices=36, position=8, mode=None, materials=1):
    prim = {'attributes': {'POSITION': 0, 'TEXCOORD_0': 1}, 'indices': 2}
    if mode is not None:
        prim['mode'] = mode
    return {
        'asset': {'version': '2.0'},
        'accessors': [{'count': position}, {'count': position * 2}, {'count': indices}],
        'meshes': [{'primitives': [prim]}],
        'materials': [{} for _ in range(materials)],
        'images': [{'uri': 'a.png'}],
        'nodes': [{'mesh': 0}],
    }


class GlbStatsTests(unittest.TestCase):
    def test_counts_indexed_triangles(self):
        stats = glb_stats.summarize(glb(indexed_gltf()))
        self.assertEqual(stats['triangles'], 12)
        self.assertEqual(stats['vertices'], 8)
        self.assertEqual(stats['primitives'], 1)
        self.assertEqual(stats['materials'], 1)
        self.assertEqual(stats['images'], 1)
        self.assertEqual(stats['nodes'], 1)

    def test_counts_non_indexed_primitive(self):
        gltf = {'asset': {'version': '2.0'}, 'accessors': [{'count': 9}],
                'meshes': [{'primitives': [{'attributes': {'POSITION': 0}}]}]}
        self.assertEqual(glb_stats.summarize(glb(gltf))['triangles'], 3)

    def test_strip_and_fan_modes(self):
        for mode in (5, 6):
            gltf = indexed_gltf(indices=6, mode=mode)
            self.assertEqual(glb_stats.summarize(glb(gltf))['triangles'], 4, mode)

    def test_points_and_lines_are_ignored(self):
        for mode in (0, 1, 2, 3):
            gltf = indexed_gltf(mode=mode)
            self.assertEqual(glb_stats.summarize(glb(gltf))['triangles'], 0, mode)

    def test_multi_mesh_sums(self):
        gltf = indexed_gltf()
        gltf['meshes'].append(gltf['meshes'][0])
        stats = glb_stats.summarize(glb(gltf))
        self.assertEqual(stats['triangles'], 24)
        self.assertEqual(stats['meshes'], 2)
        self.assertEqual(stats['primitives'], 2)

    def test_rejects_non_glb_and_truncated(self):
        self.assertIsNone(glb_stats.summarize(b'glTF' + b'\x00' * 40))
        good = glb(indexed_gltf())
        self.assertIsNone(glb_stats.summarize(good[:24]))
        self.assertIsNone(glb_stats.summarize(b'not a glb at all'))
        self.assertIsNone(glb_stats.summarize(b''))

    def test_accepts_bin_chunk_before_json(self):
        gltf = indexed_gltf()
        payload = json.dumps(gltf).encode('utf-8')
        payload += b' ' * ((4 - len(payload) % 4) % 4)
        binary = b'\x00' * 8
        chunks = struct.pack('<II', len(binary), 0x004E4942) + binary
        chunks += struct.pack('<II', len(payload), 0x4E4F534A) + payload
        raw = b'glTF' + struct.pack('<II', 2, 12 + len(chunks)) + chunks
        self.assertEqual(glb_stats.summarize(raw)['triangles'], 12)

    def test_inspect_file_and_describe(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'model.glb'
            path.write_bytes(glb(indexed_gltf()))
            stats = glb_stats.inspect_file(path)
            self.assertEqual(stats['triangles'], 12)
            self.assertIn('12 三角面', glb_stats.describe(stats))
            self.assertEqual(glb_stats.describe(None), '面数未知')
            self.assertIsNone(glb_stats.inspect_file(Path(temp) / 'missing.glb'))


if __name__ == '__main__':
    unittest.main()
