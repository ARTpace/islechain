"""素材统一归档的迁移、幂等与旧接口兼容检查。"""
from pathlib import Path
import tempfile
import unittest
from urllib.parse import unquote

from core.unified_asset_storage import (
    migrate_upload_directory, import_local_entries, canonicalize_items, update_local_reference,
)


class UnifiedAssetStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.library = {'libraries':[{'id':'default', 'categories':[{'id':'pictures', 'type':'image', 'items':[]}]}]}

    def entry(self, name='人物/样图.png', **extra):
        return {'file':name, 'id':name, 'name':'样图', 'url':'/assets/library/_local/' + name,
                'kind':'image', 'folder':name.rsplit('/',1)[0] if '/' in name else '',
                'created_at':1234, 'caption':'提示词', 'classification':{'tags':['人像']}, 'sidecar_mtime':100, **extra}

    def test_copy_media_and_sidecars_without_removing_originals(self):
        legacy = self.root/'uploads'
        source = legacy/'人物'
        source.mkdir(parents=True)
        files = {'样图.png':b'PNG', '样图.txt':'中文提示词'.encode(), '样图.classification.json':b'{"tags":["portrait"]}'}
        for name, data in files.items(): (source/name).write_bytes(data)
        target = self.root/'library'/'_local'
        migrate_upload_directory(legacy, target)
        for name, data in files.items():
            self.assertEqual((target/'人物'/name).read_bytes(), data)
            self.assertTrue((source/name).is_file())
        # 已迁移后的正常编辑不会被备份目录中的旧内容覆盖。
        (target/'人物'/'样图.txt').write_text('updated')
        migrate_upload_directory(legacy, target)
        self.assertEqual((target/'人物'/'样图.txt').read_text(), 'updated')

    def test_conflict_does_not_overwrite_or_mark_completed(self):
        source, target = self.root/'old', self.root/'new'
        source.mkdir(); target.mkdir()
        (source/'x.png').write_bytes(b'original')
        (target/'x.png').write_bytes(b'different')
        with self.assertRaises(RuntimeError): migrate_upload_directory(source,target)
        self.assertEqual((target/'x.png').read_bytes(),b'different')
        self.assertFalse((target/'.legacy-imported').exists())

    def test_import_preserves_caption_and_classification_and_is_idempotent(self):
        entry = self.entry()
        self.assertTrue(import_local_entries(self.library,[entry]))
        category = self.library['libraries'][0]['categories'][-1]
        item = category['items'][0]
        self.assertEqual(item['created_at'],1234000)
        self.assertEqual(item['caption'],'提示词')
        self.assertEqual(item['classification'],entry['classification'])
        self.assertFalse(import_local_entries(self.library,[entry]))
        self.assertEqual(len(category['items']),1)

    def test_existing_registration_not_duplicated_and_deleted_group_not_resurrected(self):
        entry=self.entry()
        self.library['libraries'][0]['categories'][0]['items'].append({**entry,'id':'keep-this-id'})
        import_local_entries(self.library,[entry])
        self.assertEqual(len(self.library['libraries'][0]['categories']),1)
        self.library['libraries'][0]['categories'][0]['items'].clear()
        self.assertFalse(import_local_entries(self.library,[entry]))
        self.assertFalse(self.library['libraries'][0]['categories'][0]['items'])

    def test_legacy_rename_and_delete_keep_index_in_sync(self):
        import_local_entries(self.library,[self.entry()])
        category=self.library['libraries'][0]['categories'][-1]
        old_id=category['items'][0]['id']
        self.assertTrue(update_local_reference(self.library,'人物','新文件夹'))
        item=category['items'][0]
        self.assertEqual(item['id'],old_id)
        self.assertEqual(unquote(item['url']),'/assets/library/_local/新文件夹/样图.png')
        self.assertTrue(update_local_reference(self.library,'新文件夹/样图.png'))
        self.assertFalse(category['items'])
        self.assertFalse(import_local_entries(self.library,[self.entry(name='新文件夹/样图.png')]))

    def test_archive_existing_files_and_keep_original_links(self):
        source=self.root/'output.png';source.write_bytes(b'image')
        item={'id':'../../bad', 'url':'/output/source.png', 'caption':'keep caption'}
        self.library['libraries'][0]['categories'][0]['items'].append(item)
        storage=self.root/'library'
        self.assertTrue(canonicalize_items(self.library,storage,lambda _:str(source)))
        self.assertTrue(item['url'].startswith('/assets/library/'))
        archived=storage/unquote(item['url'][len('/assets/library/'):])
        self.assertEqual(archived.read_bytes(),b'image')
        self.assertEqual(item['caption'],'keep caption')
        self.assertTrue(source.exists())
        self.assertFalse(canonicalize_items(self.library,storage,lambda _:str(source)))

    def test_old_upload_urls_resolve_to_same_imported_entry(self):
        old={'id':'old', 'url':'/assets/uploads/人物/样图.png'}
        self.library['libraries'][0]['categories'][0]['items'].append(old)
        canonicalize_items(self.library,self.root,lambda _:None)
        import_local_entries(self.library,[self.entry()])
        self.assertEqual(len(self.library['libraries'][0]['categories']),1)
        self.assertEqual(old['id'],'old')

    def test_updated_sidecar_reflected_but_older_sidecar_not_overwritten(self):
        import_local_entries(self.library,[self.entry()])
        item=self.library['libraries'][0]['categories'][-1]['items'][0]
        self.assertTrue(import_local_entries(self.library,[self.entry(caption='new',sidecar_mtime=200)]))
        self.assertEqual(item['caption'],'new')
        self.assertFalse(import_local_entries(self.library,[self.entry()]))
        self.assertEqual(item['caption'],'new')

    def test_archive_preserves_account_namespace(self):
        source=self.root/'a.png';source.write_bytes(b'image')
        item={'id':'x','url':'/assets/alice/a.png'}
        self.library['libraries'][0]['categories'][0]['items'].append(item)
        canonicalize_items(self.library,self.root/'library',lambda _:str(source),namespace='alice')
        self.assertTrue(item['url'].startswith('/assets/library/alice/'))
        with self.assertRaises(ValueError):
            canonicalize_items(self.library,self.root/'library',lambda _:str(source),namespace='../escape')



if __name__ == '__main__': unittest.main()
