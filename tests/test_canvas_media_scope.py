"""Exercise production collection logic without loading the application server."""
import ast
import json
import re
import unittest
from pathlib import Path
from types import SimpleNamespace


class CanvasMediaScopeTest(unittest.TestCase):
    def collect(self, canvas, published=False):
        scans = []
        source = ast.parse(Path('routers/canvases.py').read_text(encoding='utf-8'))
        names = {'_canvas_media_items', 'collect_local_media_urls'}
        module = ast.Module(body=[node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in names], type_ignores=[])
        scope = {
            'Any': object, 'List': list, 'json': json,
            'CANVAS_DIR': '', 'CANVAS_OUTPUT_REF_RE': re.compile(r'/output/([^" ]+\.png)'),
            'store_for': lambda _: SimpleNamespace(published=lambda _: published),
            'get_canvas_output_dir': lambda c: '/canvas-a/outputs',
            'get_canvas_asset_dir': lambda c: '/canvas-a/assets',
            '_scan_media_dir': lambda root, items, seen: scans.append(root),
            'local_media_path_from_url': lambda url: url,
            '_media_entry': lambda path: {'path': path, 'mtime': 1},
        }
        exec(compile(module, 'routers/canvases.py', 'exec'), scope)
        return scope['_canvas_media_items'](canvas), scans

    def test_canvas_directories_and_explicit_references(self):
        result, scans = self.collect({'id': 'a', 'owner': 'alice', 'output_folder': 'a', 'nodes': [
            {'image': '/assets/alice/shared.png', 'result': '/output/a/result.png'}]})
        self.assertEqual(scans, ['/canvas-a/outputs', '/canvas-a/assets'])
        self.assertEqual({item['path'] for item in result}, {'/assets/alice/shared.png', '/output/a/result.png'})
        self.assertEqual(len(result), 2)

    def test_no_folder_does_not_scan_shared_root(self):
        self.assertEqual(self.collect({'id': 'b', 'owner': 'alice', 'nodes': []}), ([], []))

    def test_published_canvas_without_legacy_folder(self):
        result, scans = self.collect({'id': 'c', 'nodes': []}, published=True)
        self.assertEqual(scans, ['/canvas-a/outputs', '/canvas-a/assets'])


if __name__ == '__main__':
    unittest.main()
