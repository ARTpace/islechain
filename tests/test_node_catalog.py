import copy
import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from core import node_catalog as catalog
from core.canvas_agent import run_model, validate_proposal


def sample():
    return {'typeId': 'test.text', 'version': '1.0.0', 'title': '文本转换',
            'fields': [{'id': 'text', 'label': '文本', 'component': 'textarea', 'default': ''},
                       {'id': 'prefix', 'label': '前缀', 'component': 'text', 'default': '['},
                       {'id': 'suffix', 'label': '后缀', 'component': 'text', 'default': ']'}],
            'execution': {'kind': 'host.text', 'operation': 'uppercase', 'textField': 'text',
                          'prefixField': 'prefix', 'suffixField': 'suffix'}}


class CatalogTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        replacement = patch.object(catalog, 'catalog_path', return_value=Path(directory.name) / 'catalog.json')
        replacement.start()
        self.addCleanup(replacement.stop)

    def test_menu_groups_migrate_without_replacing_custom_groups(self):
        custom = {'id': 'tools', 'title': '工具', 'members': ['prompt']}
        catalog.catalog_path().write_text(json.dumps({'definitions': [], 'groups': [custom], 'revision': 0}))
        result = catalog.read_catalog()
        self.assertEqual(result['groups'][0], custom)
        self.assertEqual([g['title'] for g in result['groups'][1:]], ['基础', '生成', '工作流', '游戏'])
        catalog.save_groups([custom], 0)
        self.assertEqual(catalog.read_catalog()['groups'], [custom], 'saved group changes are not reinserted on reload')

    def test_immutable_versions_persist_and_groups_do_not_delete_nodes(self):
        first = catalog.install(sample())
        catalog.install(sample())
        self.assertEqual(catalog.read_catalog()['revision'], 1)
        changed = sample()
        changed['title'] = '不能覆盖'
        with self.assertRaises(ValueError):
            catalog.install(changed)
        changed['version'] = '2.0.0'
        catalog.install(changed)
        catalog.save_groups([{'id': 'text', 'title': '文本', 'members': ['extension:test.text', 'prompt']}], 2)
        with self.assertRaises(ValueError):
            catalog.save_groups([], 2)
        catalog.save_groups([], 3)
        restored = catalog.public_catalog()
        self.assertEqual(len(restored['definitions']), 2)
        self.assertEqual(restored['hashes']['test.text@1.0.0'], catalog.digest(first))

    def test_real_text_execution_without_comfy_or_network(self):
        item = catalog.definition(sample())
        result = catalog.execute(item, {'text': 'world'}, ['hello'])
        self.assertEqual(result['outputs']['text'], '[HELLO\nWORLD]')
        with self.assertRaises(ValueError):
            catalog.execute(item, {'unknown': 'bad'}, [])
        with self.assertRaises(ValueError):
            catalog.execute(item, {'text': 123}, [])

    def test_schema_rejects_code_unknown_components_and_broken_bindings(self):
        cases = []
        code = sample()
        code['execution']['kind'] = 'shell'
        cases.append(code)
        component = sample()
        component['fields'][0]['component'] = 'script'
        cases.append(component)
        binding = sample()
        binding['execution']['textField'] = 'missing'
        cases.append(binding)
        duplicate = sample()
        duplicate['fields'].append(copy.deepcopy(duplicate['fields'][0]))
        cases.append(duplicate)
        for item in cases:
            with self.subTest(item=item), self.assertRaises(ValueError):
                catalog.definition(item)

    def test_all_component_defaults_and_runtime_values_are_validated(self):
        fields = [
            {'id': 'n', 'label': '数字', 'component': 'number', 'default': 2, 'minimum': 1, 'maximum': 3},
            {'id': 's', 'label': '滑块', 'component': 'slider', 'default': 0.5, 'minimum': 0, 'maximum': 1},
            {'id': 'd', 'label': '选项', 'component': 'dropdown', 'default': 'a', 'options': ['a', 'b']},
            {'id': 'b', 'label': '开关', 'component': 'boolean', 'default': False},
        ]
        item = sample()
        item['fields'].extend(fields)
        valid = catalog.definition(item)
        for params in ({'n': 4}, {'n': True}, {'s': float('nan')}, {'d': 'c'}, {'b': 'false'}):
            with self.subTest(params=params), self.assertRaises(ValueError):
                catalog.execute(valid, params, [])

    def test_replace_has_an_output_budget_before_allocating(self):
        item = sample()
        item['execution'].update(operation='replace', findField='prefix', replaceField='suffix')
        with self.assertRaises(ValueError):
            catalog.execute(item, {'text': 'a' * 16000, 'prefix': 'a', 'suffix': 'b' * 16000}, [])

    def test_ai_proposal_validates_definition_without_installing(self):
        proposal = {'summary': '创建文本节点', 'nodes': [{'id': 'new', 'type': 'extension',
                    'fields': {'nodeDefinition': json.dumps(sample())}}], 'connections': []}
        result = validate_proposal(proposal, {'nodes': [], 'connections': []})
        self.assertEqual(json.loads(result['nodes'][0]['fields']['nodeDefinition'])['componentVersion'], '1.0.0')
        self.assertEqual(catalog.read_catalog()['definitions'], [])
        proposal['nodes'][0]['type'] = 'prompt'
        with self.assertRaises(ValueError):
            validate_proposal(proposal, {'nodes': [], 'connections': []})


class CatalogAPITests(unittest.IsolatedAsyncioTestCase):
    async def test_ai_queries_sdk_tests_and_proposes_without_installing(self):
        calls = []
        proposal = {'summary': '文本转换', 'nodes': [{'id': 'new', 'type': 'extension',
                    'fields': {'nodeDefinition': json.dumps(sample())}}], 'connections': []}

        def handler(request):
            body = json.loads(request.content)
            calls.append(body)
            tool = [
                ('canvas_list_components', {}),
                ('canvas_test_config_node', {'nodeDefinition': json.dumps(sample()), 'params': {'text': 'hi'}}),
                ('canvas_propose_workflow', proposal),
            ]
            message = {'role': 'assistant', 'content': '完成'}
            if len(calls) <= len(tool):
                name, arguments = tool[len(calls) - 1]
                message = {'role': 'assistant', 'content': None, 'tool_calls': [{'id': str(len(calls)),
                           'type': 'function', 'function': {'name': name, 'arguments': json.dumps(arguments)}}]}
            return httpx.Response(200, json={'choices': [{'message': message}]})

        original = httpx.AsyncClient
        with patch('core.canvas_agent.httpx.AsyncClient', side_effect=lambda **kw: original(transport=httpx.MockTransport(handler), **kw)):
            result = await run_model('https://model.test/v1', {}, 'model', [{'role': 'user', 'content': '创建节点'}],
                                     [], snapshot={'nodes': [], 'connections': []})
        self.assertEqual(len(result['proposal']['nodes']), 1)
        test_results = [json.loads(message['content']) for message in calls[-1]['messages']
                        if message['role'] == 'tool']
        self.assertEqual(test_results[1]['outputs']['text'], '[HI]')

    async def test_install_list_run_and_hash_mismatch(self):
        routes = importlib.import_module('routers.mcp_tools')
        app = FastAPI()
        app.include_router(routes.router)
        app.dependency_overrides[routes.local_request] = lambda: None
        with tempfile.TemporaryDirectory() as directory, patch.object(catalog, 'catalog_path', return_value=Path(directory) / 'catalog.json'):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1') as client:
                installed = await client.post('/api/mcp/node-catalog', json={'action': 'install', 'definition': sample()})
                self.assertEqual(installed.status_code, 200, installed.text)
                result = (await client.get('/api/mcp/node-catalog')).json()
                self.assertIn('host.text', result['sdk']['executors'])
                self.assertTrue(any(node['typeId'] == 'prompt' for node in result['sdk']['builtinNodes']))
                request = {'typeId': 'test.text', 'version': '1.0.0', 'definitionHash': result['hashes']['test.text@1.0.0'],
                           'params': {'text': 'hello'}, 'inputs': []}
                run = await client.post('/api/mcp/node-run', json=request)
                self.assertEqual(run.json()['outputs']['text'], '[HELLO]')
                request['definitionHash'] = 'wrong'
                self.assertEqual((await client.post('/api/mcp/node-run', json=request)).status_code, 400)
                self.assertEqual((await client.post('/api/mcp/node-catalog', json={'action': 'groups', 'groups': [], 'revision': 0})).status_code, 400)
                disabled = await client.post('/api/mcp/node-catalog', json={'action': 'enabled', 'typeId': 'test.text',
                    'version': '1.0.0', 'enabled': False, 'revision': 1})
                self.assertEqual(disabled.status_code, 200)
                request['definitionHash'] = result['hashes']['test.text@1.0.0']
                self.assertEqual((await client.post('/api/mcp/node-run', json=request)).status_code, 400)

    async def test_remote_requests_cannot_install_or_run(self):
        routes = importlib.import_module('routers.mcp_tools')
        app = FastAPI()
        app.include_router(routes.router)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=('192.168.1.2', 3000)), base_url='http://127.0.0.1') as client:
            for path in ('node-catalog', 'node-run'):
                response = await client.post('/api/mcp/' + path, json={})
                self.assertEqual(response.status_code, 403)


if __name__ == '__main__':
    unittest.main()
