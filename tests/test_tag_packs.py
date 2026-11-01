import ast
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import tag_packs
from core import preset_manager as pm
from core.random_source import PresetSource
from style_packs import repository as repo

class TagPackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for module, name, value in [(tag_packs,'USER_PACKS_DIR',self.root/'installed'), (repo,'STATE_FILE',self.root/'state.json')]:
            patcher=patch.object(module,name,value);patcher.start();self.addCleanup(patcher.stop)
        self.categories=[{'id':'quality','name':'质量词','type':'tag','subcategories':[{'id':'level','name':'画质','presets':[{'id':'sharp','name':'清晰','prompt':'sharp focus','type':'tag'}]}]}]
        self.manifest={'schema':1,'kind':'tags','packId':'tags-quality','name':'质量标签','version':'1.0.0','entryCount':1,'categories':[{'id':'quality','name':'质量词','file':'quality.json'}]}
        self.files={'pack.json':json.dumps(self.manifest).encode(),'quality.json':json.dumps({'categories':self.categories}).encode()}
        self.entry={**{k:self.manifest[k] for k in ('packId','name','kind','version','entryCount')},'path':'libraries/tags/tags-quality','sha256':{k:hashlib.sha256(v).hexdigest() for k,v in self.files.items()}}
        self.url='https://raw.githubusercontent.com/example/assets/main/catalog.json'
    def fetch(self,url,limit):
        return json.dumps({'schema':1,'packs':[self.entry]}).encode() if url==self.url else self.files[url.rsplit('/',1)[1]]
    def test_repository_install_update_and_uninstall(self):
        with patch.object(repo,'_fetch',side_effect=self.fetch):
            repo.refresh_repository(self.url)
            self.assertFalse(repo.repository_status()['packs'][0]['installed'])
            repo.install_repository_pack('tags-quality')
            self.assertEqual(pm.get_tag_presets()['categories'][0]['subcategories'][0]['presets'][0]['prompt'],'sharp focus')
            self.assertTrue(repo.repository_status()['packs'][0]['installed'])
            self.entry['version']='1.0.1'
            self.manifest['version']='1.0.1'
            self.files['pack.json']=json.dumps(self.manifest).encode()
            self.entry['sha256']['pack.json']=hashlib.sha256(self.files['pack.json']).hexdigest()
            repo.refresh_repository(self.url)
            self.assertTrue(repo.repository_status()['packs'][0]['updateAvailable'])
            repo.install_repository_pack('tags-quality',replace=True)
            self.assertFalse(repo.repository_status()['packs'][0]['updateAvailable'])
            before=(self.root/'installed/tags-quality/quality.json').read_bytes()
            self.files['quality.json']=b'{}'
            with self.assertRaisesRegex(repo.PackError,'摘要不匹配'):
                repo.install_repository_pack('tags-quality',replace=True)
            self.assertEqual((self.root/'installed/tags-quality/quality.json').read_bytes(),before)
            self.assertTrue(tag_packs.uninstall_pack('tags-quality'))
            self.assertEqual(pm.get_tag_presets(),{'categories':[]})
            self.assertFalse(repo.repository_status()['packs'][0]['installed'])
    def test_random_and_poster_sources_use_installed_content(self):
        with patch.object(pm,'get_tag_presets',return_value={'categories':self.categories}), patch.object(pm,'get_style_presets',return_value={'categories':[]}):
            source=PresetSource();source.load()
            self.assertEqual([x['prompt'] for x in source.items],['sharp focus'])
        path=Path(__file__).parents[1]/'main.py'
        fn=next(n for n in ast.parse(path.read_text(encoding='utf-8')).body if isinstance(n,ast.FunctionDef) and n.name=='_load_poster_styles')
        env={};exec(compile(ast.Module(body=[fn],type_ignores=[]),str(path),'exec'),env)
        with patch.object(pm,'get_style_presets',return_value={'categories':self.categories}):
            self.assertEqual(env['_load_poster_styles']()[0]['prompt'],'sharp focus')
    def test_custom_tags_remain_separate_from_style_data(self):
        self.assertTrue(pm.save_tag_presets({'categories':self.categories}))
        self.assertEqual(tag_packs.installed_packs()[0]['packId'],'custom-tags')
        self.assertEqual(len(pm.get_tag_presets()['categories']),1)
        self.assertTrue(tag_packs.uninstall_pack('custom-tags'))
        self.assertEqual(pm.get_tag_presets()['categories'],[])

if __name__=='__main__': unittest.main()
