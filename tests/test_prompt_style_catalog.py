"""验证风格包变化后目录、分页和详情共用的缓存随真源失效。"""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
import re


class PromptStyleCatalogTests(unittest.TestCase):
    def test_multiple_subcategory_filters_do_not_duplicate_items(self):
        path = Path(__file__).parents[1] / 'routers' / 'prompt_libraries.py'
        tree = ast.parse(path.read_text(encoding='utf-8'))
        names = {'_style_source', '_slim_style_item', '_style_catalog', '_system_library_payload', '_display_style_subcategory', 'list_style_prompt_items'}
        functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
        for fn in functions:
            fn.decorator_list = []
        groups = next(n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == '_PHOTO_GROUPS' for t in n.targets))
        item = {'id':'one', 'name':'时尚人像摄影', 'prompt':'unchanged', 'classification':{'stage':'title', 'subcategories':[{'id':'photography_portrait','name':'人物肖像'},{'id':'photography_fashion','name':'时尚摄影'},{'id':'photography_fashion','name':'时尚摄影'}]}}
        source = {'categories':[{'id':'photography','name':'摄影','subcategories':[{'id':'photography_portrait','name':'人物肖像','presets':[item]}]}]}
        env = {'preset_manager':SimpleNamespace(get_style_presets=lambda:source),'re':re,'_STYLE_CATALOG_CACHE':{'source':None,'catalog':None}}
        exec(compile(ast.Module(body=[groups]+functions,type_ignores=[]),str(path),'exec'),env)
        catalog=env['_style_catalog']()
        self.assertEqual(catalog['total'],1)
        self.assertEqual(catalog['categories'][0]['count'],1)
        self.assertEqual({s['id']:s['count'] for s in catalog['categories'][0]['subcategories']},{'photography_portrait':1,'photography_fashion':1})
        for sub in ['photography_portrait','photography_fashion']:
            result=env['list_style_prompt_items'](category='photography',subcategory=sub,sort='name')
            self.assertEqual(result['total'],1)
            self.assertEqual(result['items'][0]['positive'],'unchanged')
        self.assertEqual(env['list_style_prompt_items'](category='photography',sort='name')['total'],1)
        self.assertEqual(env['list_style_prompt_items'](subcategory='photography_macro')['total'],0)

    def test_catalog_tracks_preset_source_instead_of_legacy_file(self):
        path = Path(__file__).parents[1] / 'routers' / 'prompt_libraries.py'
        tree = ast.parse(path.read_text(encoding='utf-8'))
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name in {'_style_source', '_slim_style_item', '_style_catalog', '_system_library_payload', '_display_style_subcategory', 'list_style_prompt_items', 'get_style_prompt_item'}]
        groups = next(node for node in tree.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == '_PHOTO_GROUPS' for target in node.targets))
        for function in functions:
            function.decorator_list = []
        def source(ids):
            return {'categories': [{'id': 'art', 'name': '艺术', 'subcategories': [
                {'id': 'styles', 'presets': [{'id': id, 'name': id, 'prompt': id} for id in ids]}]}]}
        manager = SimpleNamespace(data=source(['core']))
        manager.get_style_presets = lambda: manager.data
        env = {'preset_manager': manager, 're': re, '_STYLE_CATALOG_CACHE': {'source': None, 'catalog': None}}
        exec(compile(ast.Module(body=[groups] + functions, type_ignores=[]), str(path), 'exec'), env)
        catalog = env['_style_catalog']()
        self.assertIs(catalog, env['_style_catalog']())
        self.assertEqual(catalog['total'], 1)
        manager.data = source(['core', 'imported'])
        updated = env['_style_catalog']()
        self.assertIsNot(catalog, updated)
        self.assertEqual(updated['total'], 2)
        self.assertIn('imported', updated['by_id'])
        self.assertEqual(updated['categories'][0]['count'], 2)
        self.assertEqual(env['_system_library_payload']()['total'], 2)
        manager.data = source(['core'])
        self.assertEqual(env['_style_catalog']()['total'], 1)
        manager.data = {'categories': [{'id': 'photography', 'subcategories': [{'id': 'photography', 'presets': [
            {'id': 'a', 'name': '人像写真'}, {'id': 'b', 'name': '咖啡美食'}, {'id': 'c', 'name': '未分类示例'}]}]}]}
        photo = env['_style_catalog']()
        self.assertEqual(sum(group['count'] for group in photo['categories'][0]['subcategories']), 3)
        result = env['list_style_prompt_items'](category='photography', subcategory='photography-portrait', sort='name')
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['items'][0]['id'], 'a')
        self.assertEqual(env['list_style_prompt_items'](category='photography', subcategory='photography-portrait', q='咖啡')['total'], 0)
        self.assertEqual(env['list_style_prompt_items'](category='photography')['total'], 3)
        originals = [
            {'id': 'y1', 'description': '腾讯元宝 · 图生图 · 建议上传一张人像照片'},
            {'id': 'y2', 'description': '腾讯元宝 · 文生图'},
            {'id': 'n1', 'description': 'Nano banana pro'},
            {'id': 'n2', 'description': 'Nano Banana 2'},
            {'id': 'p1', 'description': 'PromptImageAtlas · promptsref'},
            {'id': 'p2', 'description': 'PromptImageAtlas · promptimageatlas'},
            {'id': 's', 'description': 'TWRI SDXL 风格'},
            {'id': 'u', 'description': ''},
            {'id': 'o', 'description': '未识别平台 · 上传说明'},
            {'id': 'structured', 'description': '详细使用说明', 'source': {'provider': 'yuanbao'}},
        ]
        manager.data = {'categories': [{'id': 'art', 'subcategories': [{'id': 'art', 'presets': originals}]}]}
        grouped = env['_style_catalog']()
        self.assertEqual(dict(grouped['sources']), {'腾讯元宝': 3, 'Nano Banana': 2, 'PromptImageAtlas': 2,
                                                  '风格预设': 1, '未标注来源': 1, '其他来源': 1})
        self.assertEqual(sum(count for _, count in grouped['sources']), len(originals))
        for label, count in grouped['sources']:
            self.assertEqual(env['list_style_prompt_items'](source=label)['total'], count)
        self.assertEqual(env['list_style_prompt_items'](source='Nano banana pro')['total'], 2)
        self.assertEqual(env['list_style_prompt_items'](source='腾讯元宝', q='上传')['total'], 1)
        self.assertEqual(env['get_style_prompt_item']('y1')['source'], '腾讯元宝')
        self.assertEqual(env['get_style_prompt_item']('y1')['source_description'], originals[0]['description'])
        self.assertEqual(grouped['by_id']['structured']['source'], {'provider': 'yuanbao'})


if __name__ == '__main__':
    unittest.main()
