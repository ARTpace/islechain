import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('opennana_import', Path(__file__).parents[1] / 'tools/opennana-import/import.py')
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class ImportTests(unittest.TestCase):
    def test_corrupt_cache_refetches_with_reused_ssl(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder)
            (cache / 'example.json').write_text('{', encoding='utf-8')
            response = io.BytesIO(json.dumps({'status': 200, 'data': {'title': 'recovered'}}).encode())
            with patch.object(importer, 'CACHE_DIR', cache), patch.object(importer.urllib.request, 'urlopen', return_value=response) as request:
                self.assertEqual(importer.get_detail('example')['title'], 'recovered')
                self.assertIs(request.call_args.kwargs['context'], importer.SSL_CONTEXT)
                self.assertEqual(json.loads((cache / 'example.json').read_text('utf-8'))['title'], 'recovered')

    def test_offline_preview_preserves_library_and_skips_existing(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            cache = root / 'cache'
            cache.mkdir()
            library = root / 'styles.json'
            names = root / 'names.json'
            original = {'categories': [{'id': 'misc', 'name': '综合', 'subcategories': [
                {'id': 'misc', 'name': '综合', 'presets': [{'id': 'opennana_old', 'name': '自定义', 'prompt': '保留'}]}
            ]}]}
            library.write_text(json.dumps(original), encoding='utf-8')
            (cache / 'old.json').write_text('broken cache', encoding='utf-8')
            (cache / 'new.json').write_text(json.dumps({'title': '新模板', 'prompts': [
                {'type': 'zh', 'text': '这是一条足够长的中文生图提示词，用来验证增量导入与备份。'}
            ]}), encoding='utf-8')
            with patch.multiple(importer, BASE=root, CACHE_DIR=cache, OUT_FILE=library, I18N_FILE=names), patch.object(importer, 'api', side_effect=AssertionError('不得联网')):
                before = library.read_bytes()
                self.assertEqual(importer.main(['--offline', '--dry-run']), 0)
                self.assertEqual(library.read_bytes(), before)
                self.assertFalse(names.exists())
                report = json.loads((root / 'last-update-report.json').read_text('utf-8'))
                self.assertEqual(report['processed'], 1)
                self.assertEqual(report['added'], 1)
                self.assertEqual(importer.main(['--offline']), 0)
                after = json.loads(library.read_text('utf-8'))
                self.assertEqual(after['categories'][0]['subcategories'][0]['presets'][0], original['categories'][0]['subcategories'][0]['presets'][0])
                backups = list((root / 'artifacts').glob('*/styles.json'))
                self.assertEqual(len(backups), 1)
                self.assertEqual(backups[0].read_bytes(), before)
                current = library.read_bytes()
                self.assertEqual(importer.main(['--offline']), 0)
                self.assertEqual(library.read_bytes(), current)

    def test_bad_offline_cache_is_reported(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            cache = root / 'cache'
            cache.mkdir()
            (cache / 'broken.json').write_text('{', encoding='utf-8')
            with patch.multiple(importer, BASE=root, CACHE_DIR=cache, OUT_FILE=root / 'styles.json', I18N_FILE=root / 'names.json'):
                self.assertEqual(importer.main(['--offline']), 1)
                report = json.loads((root / 'last-update-report.json').read_text('utf-8'))
                self.assertEqual(report['failures'][0]['slug'], 'broken')
                self.assertFalse((root / 'styles.json').exists())

    def test_atomic_write_keeps_previous_file_on_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'data.json'
            target.write_text('original', encoding='utf-8')
            with patch.object(importer.os, 'replace', side_effect=OSError('write failed')):
                with self.assertRaises(OSError):
                    importer.write_json(target, {'new': True})
            self.assertEqual(target.read_text('utf-8'), 'original')
            self.assertEqual(list(Path(folder).glob('*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
