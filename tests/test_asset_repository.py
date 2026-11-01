import copy
import ast
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from PIL import Image
from core.asset_repository import build_libraries, cache_thumbnail, merge_libraries, normalize_repository_title, costume_title
from style_packs.packer import PackError
from fastapi import HTTPException, Request


class AssetRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.data = {
            'poses': {'poses': [{'id': 'p1', 'category': '站姿', 'names': {'zh': '站立'},
                'variants': [{'angle': 'front', 'thumb': 'thumbs/p1.jpg', 'full': 'img/p1.png'},
                             {'angle': 'side', 'thumb': 'thumbs/p1_side.jpg', 'full': 'img/p1_side.png'}]}]},
            'costumes': {'costumes': [{'id': 'c1', 'cat': 'spring', 'tags': ['white'],
                'thumb': 'costume/thumbs/c1.webp', 'image': 'costume/img/c1.webp'}]},
            'faces': {'images': [{'id': 'f1', 'sec': 'face', 'hair': 'short',
                'thumb': 'portrait/thumbs/f1.webp', 'full': 'portrait/img/f1.png',
                'full_remote': 'https://ai-portrait-gallery.pages.dev/img/full/f1.png'}]},
        }
        self.requests = []

    def fetch(self, url, limit):
        self.requests.append(url)
        kind = Path(url).stem
        return json.dumps(self.data[kind]).encode()

    def build(self):
        return build_libraries('https://github.com/example/atlas', self.fetch)

    def test_connection_only_fetches_three_indexes_and_preserves_original_urls(self):
        libraries = self.build()
        self.assertEqual(len(self.requests), 3)
        self.assertTrue(all(url.endswith('.json') for url in self.requests))
        items = [i for lib in libraries for cat in lib['categories'] for i in cat['items']]
        self.assertEqual(len(items), 4)
        self.assertEqual(items[0]['pose_id'], items[1]['pose_id'])
        self.assertNotEqual(items[0]['id'], items[1]['id'])
        self.assertTrue(all(i['thumbnail'].startswith('/api/asset-library/repository/thumb/') for i in items))
        self.assertTrue(items[-1]['url'].startswith('https://ai-portrait-gallery.pages.dev/'))

    def test_update_preserves_user_edits_moves_and_deleted_items(self):
        incoming = self.build()
        index = {'libraries': []}
        self.assertEqual(merge_libraries(index, incoming), 4)
        first = index['libraries'][0]['categories'][0]['items']
        first[0]['name'] = '我的名称'
        moved = first.pop(0)
        index['libraries'].append({'id': 'custom', 'categories': [{'id': 'custom', 'items': [moved]}]})
        first.pop()
        self.assertEqual(merge_libraries(index, self.build()), 0)
        self.assertEqual(moved['name'], '我的名称')
        self.assertEqual(first, [])
        self.data['costumes']['costumes'].append({**self.data['costumes']['costumes'][0], 'id': 'c2'})
        self.assertEqual(merge_libraries(index, self.build()), 1)

    def test_descriptive_titles_replace_legacy_codes_but_preserve_user_names(self):
        self.assertEqual(costume_title('ribbon', 'yellow'), '蝴蝶结 · 黄色')
        item = {'repository_source':'source', 'repository_id':'SPR-0001', 'name':'SPR-0001',
                'classification':{'tags':['春', 'top', 'ivory', 'ivory', 'frill', 'knit', 'denim']}}
        normalize_repository_title(item)
        self.assertEqual(item['name'], '针织 · 象牙白')
        item['name'] = '我的搭配'
        normalize_repository_title(item)
        self.assertEqual(item['name'], '我的搭配')
        self.data['costumes']['costumes'][0].update(main='ribbon', color='yellow')
        libraries = self.build()
        self.assertEqual(libraries[1]['categories'][0]['items'][0]['name'], '蝴蝶结 · 黄色')

    def test_invalid_image_path_and_remote_host_are_rejected(self):
        original = copy.deepcopy(self.data)
        self.data['poses']['poses'][0]['variants'][0]['thumb'] = '../secret'
        with self.assertRaises(PackError):
            self.build()
        self.data = original
        self.data['faces']['images'][0]['full_remote'] = 'http://127.0.0.1/private'
        with self.assertRaises(ValueError):
            self.build()

    def test_thumbnail_cache_fetches_only_thumbnail_once_and_never_falls_back(self):
        stream = BytesIO()
        Image.new('RGB', (600, 800), 'white').save(stream, 'JPEG')
        calls = []
        def fetch(url, limit):
            calls.append(url)
            return stream.getvalue()
        source = 'https://raw.githubusercontent.com/example/atlas/main/thumbs/p1.jpg'
        with tempfile.TemporaryDirectory() as directory:
            path = cache_thumbnail(source, directory, fetch)
            self.assertEqual(cache_thumbnail(source, directory, fetch), path)
            self.assertEqual(calls, [source])
            with Image.open(path) as image:
                self.assertEqual(image.size, (480, 640))
            def broken(url, limit):
                calls.append(url)
                raise OSError('offline')
            with self.assertRaises(OSError):
                cache_thumbnail(source.replace('p1', 'p2'), directory, broken)
            self.assertTrue(all('/thumbs/' in url for url in calls))
            self.assertEqual(len(list(Path(directory).glob('*.tmp'))), 0)


class AssetRepositoryRouteTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.index = {'libraries': [{'id': 'local', 'categories': [{'id': 'images', 'items': [
            {'id': 'remote', 'url': 'https://example.com/full.png', 'repository_source': 'source'},
        ]}]}]}
        self.main = SimpleNamespace(load_asset_library=Mock(return_value=self.index),
            save_asset_library=Mock(), ensure_same_origin_request=Mock(),
            now_ms=lambda: 123,
            asset_library_item_path=Mock(side_effect=AssertionError('remote must not be checked as a local file')))

    def load(self, filename, name):
        path = Path(__file__).parents[1] / 'routers' / filename
        tree = ast.parse(path.read_text('utf-8'))
        node = next(n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
        node.decorator_list = []
        namespace = {'_main': self.main, 'HTTPException': HTTPException, 'Request': Request}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), namespace)
        return namespace[name]

    def test_failed_connection_does_not_load_or_save_index(self):
        route = self.load('asset_library.py', 'connect_asset_repository')
        with patch('core.asset_repository.build_libraries', side_effect=ValueError('offline')):
            with self.assertRaises(HTTPException) as error:
                route({'url': 'https://github.com/example/atlas'}, object())
        self.assertEqual(error.exception.status_code, 400)
        self.main.load_asset_library.assert_not_called()
        self.main.save_asset_library.assert_not_called()

    async def test_maintenance_does_not_mark_remote_assets_missing(self):
        self.main.AssetLibraryMaintenanceScanRequest = object
        route = self.load('assets.py', 'scan_asset_library_maintenance')
        result = await route(SimpleNamespace(library_id=''))
        self.assertEqual(result['total'], 0)
        self.assertEqual(result['missing'], [])


if __name__ == '__main__':
    unittest.main()
