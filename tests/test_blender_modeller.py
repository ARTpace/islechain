"""阶段回收与灰模策略的最小回归检查，无需启动 Blender。"""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import blender_modeller as modeller, dcc_bridge
from tests.test_glb_stats import glb, indexed_gltf


class ModellerTests(unittest.TestCase):
    def test_reads_eight_reference_images(self):
        with tempfile.TemporaryDirectory() as temp:
            from PIL import Image
            for i in range(9):
                Image.new('RGB', (2, 2), (i, 0, 0)).save(Path(temp) / f'{i}.png')
            (Path(temp) / 'base_model.glb').write_bytes(b'model')
            self.assertEqual(len(modeller._ref_images(temp)), 8)


    def test_recovers_latest_checkpoint_and_marks_partial(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'out').mkdir()
            (root / 'checkpoints').mkdir()
            (root / 'checkpoints/01-blockout.glb').write_bytes(b'blockout')
            (root / 'checkpoints/02-structure.glb').write_bytes(b'structure')
            (root / 'checkpoints/03-material.glb').write_bytes(b'')
            job = {'id': 'test', 'dir': temp, 'status': 'building'}
            with patch.object(dcc_bridge, 'save'):
                result = modeller._salvage(job, 'network')
            self.assertTrue(result['recovered'])
            self.assertTrue(job['partial'])
            self.assertEqual((root / 'out/model.glb').read_bytes(), b'structure')
            self.assertEqual(len(result['products']), 1)
            self.assertTrue(dcc_bridge.public(job)['partial'])

    def test_final_model_is_not_replaced_by_checkpoint(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'out').mkdir()
            (root / 'out/model.glb').write_bytes(b'final')
            (root / 'checkpoints').mkdir()
            (root / 'checkpoints/03-material.glb').write_bytes(b'checkpoint')
            job = {'id': 'test', 'dir': temp, 'status': 'building'}
            with patch.object(dcc_bridge, 'save'):
                self.assertTrue(modeller._salvage(job, 'network')['ok'])
            self.assertEqual((root / 'out/model.glb').read_bytes(), b'final')
            self.assertFalse(job.get('partial', False))

    def test_no_products_remains_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(dcc_bridge, 'save'):
                self.assertIsNone(modeller._salvage({'id': 'test', 'dir': temp}, 'network'))

    def test_role_manuals_do_not_inject_toy_crate_scripts(self):
        for preset in ('default', 'stylized', 'hard-surface', 'realistic', 'missing'):
            with self.subTest(preset=preset):
                text, source = modeller._skill_text(preset, Path('model.glb'))
                self.assertNotIn('crate_body', text)
                self.assertNotIn('## 标杆脚本', text)
        code = modeller.SHAPE_BRIEF.split('```python', 1)[1].split('```', 1)[0]
        compile(code, '<shape-api-reference>', 'exec')

    def test_blockout_scope_and_checkpoint_folder(self):
        with tempfile.TemporaryDirectory() as temp:
            self.assertIn('本次只做灰模', modeller._quality_brief(temp, True))
            self.assertIn('本次完成完整模型', modeller._quality_brief(temp))
            self.assertTrue((Path(temp) / 'checkpoints').is_dir())

    def test_decimate_manual_is_available_and_keeps_ratio_formula(self):
        text, source = modeller._skill_text('optimizer', Path('model.glb'))
        self.assertEqual(source, 'optimizer')
        self.assertIn('DECIMATE', text)
        self.assertIn('ratio', text)
        self.assertIn('TARGET / max(before, 1)', text)
        # 手册里的配方必须是能直接跑的真代码
        code = text.split('```python', 1)[1].split('```', 1)[0]
        compile(code, '<optimizer-recipe>', 'exec')

    def test_target_block_is_a_hard_budget(self):
        self.assertEqual(modeller._target_block(0, True), '')
        edit = modeller._target_block(5000, True)
        self.assertIn('目标 5,000 三角面', edit)
        self.assertIn('硬预算', edit)
        self.assertIn('before_tris', edit)
        build = modeller._target_block(5000, False)
        self.assertIn('目标 5,000 三角面', build)
        self.assertNotIn('before_tris', build)

    def test_record_tris_writes_real_counts(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'model.glb'
            path.write_bytes(glb(indexed_gltf(indices=36)))
            job = {'id': 'test', 'dir': temp, 'targetTris': 10}
            with patch.object(dcc_bridge, 'save'):
                stats = modeller._record_tris(job, [{'path': str(path)}])
            self.assertEqual(stats['triangles'], 12)
            self.assertEqual(job['tris'], 12)
            self.assertEqual(job['trisDelta'], 20.0)
            self.assertIn('目标 10', job['logs'][-1]['line'])

    def test_record_tris_survives_missing_product(self):
        with tempfile.TemporaryDirectory() as temp:
            job = {'id': 'test', 'dir': temp}
            with patch.object(dcc_bridge, 'save'):
                self.assertIsNone(modeller._record_tris(job, [{'path': str(Path(temp) / 'none.glb')}]))
            self.assertNotIn('tris', job)


def _uv_glb():
    """两个三角形铺满 0–1 方块的左半边：UV 覆盖真值约 0.5。"""
    import json
    import struct
    uvs = [0.0, 0.0, 0.5, 0.0, 0.5, 1.0, 0.0, 1.0]
    positions = [0.0, 0.0, 0.0] * 4
    indices = [0, 1, 2, 0, 2, 3]
    binary = (struct.pack('<8f', *uvs) + struct.pack('<12f', *positions)
              + struct.pack('<6H', *indices))
    doc = {
        'asset': {'version': '2.0'},
        'buffers': [{'byteLength': len(binary)}],
        'bufferViews': [
            {'buffer': 0, 'byteOffset': 0, 'byteLength': 32},
            {'buffer': 0, 'byteOffset': 32, 'byteLength': 48},
            {'buffer': 0, 'byteOffset': 80, 'byteLength': 12},
        ],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': 4, 'type': 'VEC2'},
            {'bufferView': 1, 'componentType': 5126, 'count': 4, 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5123, 'count': 6, 'type': 'SCALAR'},
        ],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 1, 'TEXCOORD_0': 0},
                                    'indices': 2}]}],
    }
    payload = json.dumps(doc, separators=(',', ':')).encode('utf-8')
    payload += b' ' * (-len(payload) % 4)
    total = 12 + 8 + len(payload) + 8 + len(binary)
    return (struct.pack('<4sII', b'glTF', 2, total)
            + struct.pack('<II', len(payload), 0x4E4F534A) + payload
            + struct.pack('<II', len(binary), 0x004E4942) + binary)


class StageApprovalTests(unittest.TestCase):
    def test_inspect_uv_measures_real_coverage(self):
        from core import glb_stats
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'model.glb'
            path.write_bytes(_uv_glb())
            report = glb_stats.inspect_uv_file(path)
            self.assertTrue(report['hasUv'])
            self.assertEqual(report['grid'], 256)
            self.assertEqual(report['method'], glb_stats.UV_METHOD)
            self.assertEqual(report['triangles'], 2)
            self.assertTrue(0.45 < report['coverage'] < 0.55, report)
            self.assertIn('低于 80% 预设', glb_stats.describe_uv(report))

    def test_missing_texcoord_is_not_reported_as_zero(self):
        from core import glb_stats
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'model.glb'
            path.write_bytes(glb(indexed_gltf(indices=36)))
            report = glb_stats.inspect_uv_file(path)
            self.assertFalse(report['hasUv'])
            self.assertIsNone(report['coverage'])
            self.assertIn('未测', glb_stats.describe_uv(report))

    def test_record_uv_flags_unmet_target(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'model.glb'
            path.write_bytes(_uv_glb())
            job = {'id': 'test', 'dir': temp}
            with patch.object(dcc_bridge, 'save'):
                report = modeller._record_uv(job, [{'path': str(path)}])
            self.assertAlmostEqual(job['uvCoverage'], report['coverage'], places=4)
            self.assertTrue(any(item['code'] == 'uv_coverage_below_target'
                                for item in job['openDifferences']))

    def test_differences_are_deduplicated_and_resolvable(self):
        job = {'id': 'test', 'dir': ''}
        modeller.flag_difference(job, 'stage0_pending', '灰模待审')
        modeller.flag_difference(job, 'stage0_pending', '重复')
        self.assertEqual(len(job['openDifferences']), 1)
        modeller.resolve_difference(job, 'stage0_pending')
        self.assertTrue(job['openDifferences'][0]['resolved'])
        with tempfile.TemporaryDirectory() as temp:
            job['dir'] = temp
            view = dcc_bridge.public(job)
            self.assertIn('uvCoverage', view)
            self.assertIn('openDifferences', view)
            self.assertIn('checkpoints', view)
            self.assertEqual(view['openDifferences'][0]['code'], 'stage0_pending')

    def test_tris_over_budget_is_recorded_as_difference(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'model.glb'
            path.write_bytes(glb(indexed_gltf(indices=36)))
            job = {'id': 'test', 'dir': temp, 'targetTris': 5}
            with patch.object(dcc_bridge, 'save'):
                modeller._record_tris(job, [{'path': str(path)}])
            self.assertTrue(any(item['code'] == 'tris_out_of_budget'
                                for item in job['openDifferences']))


if __name__ == '__main__':
    unittest.main()
