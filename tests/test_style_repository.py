import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from style_packs import repository as repo, packer
from style_packs.packer import PackError


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for target, name, value in ((repo, 'STATE_FILE', self.root / 'state.json'),
                                    (packer, 'USER_PACKS_DIR', self.root / 'installed')):
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(repo, 'installed_packs', return_value=[])
        patcher.start()
        self.addCleanup(patcher.stop)
        self.url = 'https://raw.githubusercontent.com/example/styles/main/catalog.json'
        self.manifest = {'schema': 1, 'kind': 'styles', 'packId': 'test-pack', 'name': '测试', 'version': '1.0.0',
                         'entryCount': 1, 'categories': [{'id': 'painting', 'name': '绘画', 'file': 'painting.json'}]}
        self.content = {'categories': [{'id': 'painting', 'subcategories': [{'id': 'painting_watercolor', 'presets': [
            {'id': 'one', 'name': '水彩', 'prompt': 'Original prompt', 'custom': {'preserved': True}}]}]}]}
        self.files = {'pack.json': json.dumps(self.manifest).encode(), 'painting.json': json.dumps(self.content).encode()}
        self.entry = {'packId': 'test-pack', 'name': '测试', 'version': '1.0.0', 'entryCount': 1,
                      'path': 'packs/test-pack', 'sha256': {k: hashlib.sha256(v).hexdigest() for k, v in self.files.items()}}
        self.catalog = {'schema': 1, 'packs': [self.entry]}

    def fetch(self, url, limit):
        data = json.dumps(self.catalog).encode() if url == self.url else self.files[url.rsplit('/', 1)[1]]
        self.assertLessEqual(len(data), limit)
        return data

    def test_artist_and_character_repository_install_update_and_integrity(self):
        for kind in ('artists', 'characters'):
            with self.subTest(kind=kind):
                module = repo._content_module(kind)
                catalog_module = __import__(kind.replace('artists', 'artist_packs').replace('characters', 'character_packs') + '.catalog', fromlist=['catalog'])
                manifest = {'schema':1, 'kind':kind, 'packId':'test-' + kind, 'name':kind, 'version':'1.0.0', 'entryCount':1, 'files':{'index':'index.json'}}
                files = {'pack.json':json.dumps(manifest).encode(), 'index.json':json.dumps({'items':[{'id':'a', 'name':'A', 'tag':'@a', 'trigger':'a'}]}).encode()}
                if kind == 'characters':
                    files['detail-a.json'] = b'{"a":{"tags":[],"img_url":"","danbooru_url":""}}'
                self.files = files
                self.entry = {key:manifest[key] for key in ('packId','name','kind','version','entryCount')}
                self.entry.update(path='libraries/' + kind + '/' + manifest['packId'], sha256={k:hashlib.sha256(v).hexdigest() for k,v in files.items()})
                self.catalog = {'schema':1, 'packs':[self.entry]}
                dest = self.root / kind
                with patch.object(catalog_module, 'USER_PACKS_DIR', dest), patch.object(repo, '_fetch', side_effect=self.fetch):
                    repo.refresh_repository(self.url)
                    installed = repo.install_repository_pack(manifest['packId'])
                    self.assertEqual(installed.kind, kind)
                    index = dest / manifest['packId'] / 'index.json'
                    before = index.read_bytes()
                    with patch.object(repo, '_installed', return_value=[{'packId':manifest['packId'], 'version':'1.0.0'}]), patch.object(repo, '_pack_root', return_value=index.parent):
                        self.assertFalse(repo.repository_status()['packs'][0]['updateAvailable'])
                        self.files['index.json'] = b'{"items":[]}'
                        with self.assertRaisesRegex(PackError, '摘要不匹配'):
                            repo.install_repository_pack(manifest['packId'], replace=True)
                        self.assertEqual(index.read_bytes(), before)
                        self.entry['version'] = '1.0.1'
                        self.files['pack.json'] = json.dumps({**manifest, 'version':'1.0.1'}).encode()
                        self.files['index.json'] = before
                        self.entry['sha256'] = {k:hashlib.sha256(v).hexdigest() for k,v in self.files.items()}
                        repo.refresh_repository(self.url)
                        self.assertTrue(repo.repository_status()['packs'][0]['updateAvailable'])
                        repo.install_repository_pack(manifest['packId'], replace=True)
                        self.assertEqual(json.loads((index.parent / 'pack.json').read_text())['version'], '1.0.1')

    def test_rejects_unknown_content_kind(self):
        self.entry['kind'] = 'unknown'
        with self.assertRaises(PackError):
            repo._validate_catalog(self.catalog)

    def test_urls_and_unsafe_sources(self):
        self.assertEqual(repo.catalog_url('https://github.com/example/styles.git'), self.url)
        self.assertEqual(repo.catalog_url('https://github.com/example/styles/tree/master/data'),
                         'https://raw.githubusercontent.com/example/styles/master/data/catalog.json')
        for value in ['http://localhost/catalog.json', 'https://github.com.evil/a/b',
                      'https://raw.githubusercontent.com/a/b/main/../catalog.json', 'file:///catalog.json']:
            with self.subTest(value=value), self.assertRaises(PackError):
                repo.catalog_url(value)

    def test_refresh_install_roundtrip_disconnect_keeps_data(self):
        with patch.object(repo, '_fetch', side_effect=self.fetch):
            repo.refresh_repository(self.url)
            self.assertEqual(len(repo.repository_status()['packs']), 1)
            installed = repo.install_repository_pack('test-pack')
            self.assertEqual(installed.pack_id, 'test-pack')
            target = self.root / 'installed/test-pack/painting.json'
            self.assertEqual(json.loads(target.read_text(encoding='utf-8')), self.content)
            with self.assertRaises(PackError):
                repo.install_repository_pack('test-pack')
            repo.disconnect_repository()
            self.assertTrue(target.is_file())
            self.assertEqual(repo.repository_status()['packs'], [])

    def test_hash_mismatch_does_not_replace_installed(self):
        with patch.object(repo, '_fetch', side_effect=self.fetch):
            repo.refresh_repository(self.url)
            repo.install_repository_pack('test-pack')
            target = self.root / 'installed/test-pack/painting.json'
            before = target.read_bytes()
            self.files['painting.json'] = b'{}'
            with self.assertRaisesRegex(PackError, '摘要不匹配'):
                repo.install_repository_pack('test-pack', replace=True)
            self.assertEqual(target.read_bytes(), before)

    def test_invalid_catalog_keeps_previous_source(self):
        with patch.object(repo, '_fetch', side_effect=self.fetch):
            repo.refresh_repository(self.url)
            before = repo.STATE_FILE.read_bytes()
            self.entry['path'] = '../escape'
            with self.assertRaises(PackError):
                repo.refresh_repository(self.url)
            self.assertEqual(repo.STATE_FILE.read_bytes(), before)

    def test_update_status_compares_versions_and_file_hashes(self):
        local = self.root / 'installed/test-pack'
        with patch.object(repo, '_fetch', side_effect=self.fetch):
            repo.refresh_repository(self.url)
            repo.install_repository_pack('test-pack')
            with patch.object(repo, 'installed_packs', return_value=[{'packId': 'test-pack', 'version': '1.0.0'}]), \
                 patch.object(repo, 'find_pack_dir', return_value=(local, False)):
                self.assertFalse(repo.repository_status()['packs'][0]['updateAvailable'])
                self.entry['version'] = '1.0.1'
                repo.refresh_repository(self.url)
                status = repo.repository_status()
                self.assertTrue(status['packs'][0]['updateAvailable'])
                self.assertEqual(status['updateCount'], 1)
                self.assertEqual(status['packs'][0]['installedVersion'], '1.0.0')
                self.entry['version'] = '0.9.0'
                repo.refresh_repository(self.url)
                self.assertFalse(repo.repository_status()['packs'][0]['updateAvailable'])
                self.entry['version'] = '1.0.0'
                self.entry['sha256']['painting.json'] = '0' * 64
                repo.refresh_repository(self.url)
                self.assertTrue(repo.repository_status()['packs'][0]['updateAvailable'])

    def test_check_interval_and_network_failure_keep_cached_catalog(self):
        with patch.object(repo, '_fetch', side_effect=self.fetch) as fetch:
            repo.refresh_repository(self.url)
            repo.check_repository()
            self.assertEqual(fetch.call_count, 1)
            state = json.loads(repo.STATE_FILE.read_text(encoding='utf-8'))
            state['checkedAt'] = 0
            repo.STATE_FILE.write_text(json.dumps(state), encoding='utf-8')
            repo.check_repository()
            self.assertEqual(fetch.call_count, 2)
            repo.STATE_FILE.write_text(json.dumps(state), encoding='utf-8')
            with patch.object(repo, '_fetch', side_effect=PackError('offline')):
                status = repo.check_repository()
                self.assertEqual(status['packs'][0]['packId'], 'test-pack')
                self.assertEqual(status['checkError'], 'offline')

    def test_old_full_library_blocks_platform_install_without_touching_files(self):
        self.entry['replaces'] = ['art-canvas-core']
        with patch.object(repo, '_fetch', side_effect=self.fetch):
            repo.refresh_repository(self.url)
        with patch.object(repo, 'installed_packs', return_value=[{'packId': 'art-canvas-core', 'version': '1.0.1'}]):
            self.assertEqual(repo.repository_status()['packs'][0]['blockedBy'], ['art-canvas-core'])
            with patch.object(repo, '_fetch') as fetch, self.assertRaisesRegex(PackError, '旧整库包'):
                repo.install_repository_pack('test-pack')
            fetch.assert_not_called()

    def test_updating_one_platform_keeps_other_platform_unchanged(self):
        other = self.root / 'installed/another-platform/pack.json'
        other.parent.mkdir(parents=True)
        other.write_bytes(b'{"untouched":true}')
        with patch.object(repo, '_fetch', side_effect=self.fetch):
            repo.refresh_repository(self.url)
            repo.install_repository_pack('test-pack')
            self.manifest['version'] = self.entry['version'] = '1.0.1'
            self.content['categories'][0]['subcategories'][0]['presets'][0]['prompt'] = 'New prompt'
            self.files['pack.json'] = json.dumps(self.manifest).encode()
            self.files['painting.json'] = json.dumps(self.content).encode()
            self.entry['sha256'] = {k: hashlib.sha256(v).hexdigest() for k, v in self.files.items()}
            repo.refresh_repository(self.url)
            repo.install_repository_pack('test-pack', replace=True)
        self.assertEqual(other.read_bytes(), b'{"untouched":true}')
        data = json.loads((self.root / 'installed/test-pack/painting.json').read_text(encoding='utf-8'))
        self.assertEqual(data, self.content)

    def test_manifest_identity_and_counts_validated_before_import(self):
        for kind in ('identity', 'count', 'duplicate'):
            with self.subTest(kind=kind):
                manifest = dict(self.manifest)
                if kind == 'identity':
                    manifest['packId'] = 'another-pack'
                elif kind == 'count':
                    manifest['entryCount'] = 2
                else:
                    self.content['categories'][0]['subcategories'][0]['presets'] *= 2
                    self.files['painting.json'] = json.dumps(self.content).encode()
                self.files['pack.json'] = json.dumps(manifest).encode()
                self.entry['sha256'] = {k: hashlib.sha256(v).hexdigest() for k, v in self.files.items()}
                with patch.object(repo, '_fetch', side_effect=self.fetch):
                    repo.refresh_repository(self.url)
                    with self.assertRaises(PackError):
                        repo.install_repository_pack('test-pack')
                self.assertFalse((self.root / 'installed/test-pack').exists())


if __name__ == '__main__':
    unittest.main()
