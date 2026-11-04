import copy
import json
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from core import node_catalog, node_http
from core.comfy_workflow_builds import ComfyBuilds
from core.node_plugin_builds import NodePluginBuilds
from core.node_plugin_package import export_package, import_package


def sample():
    return {'typeId': 'api.translate', 'version': '1.0.0', 'title': 'API翻译',
            'fields': [{'id': 'text', 'label': '文本', 'component': 'text', 'default': 'hello'},
                       {'id': 'language', 'label': '语言', 'component': 'text', 'default': 'zh'}],
            'execution': {'kind': 'host.http', 'textField': 'text', 'url': 'https://api.example.test/translate',
                          'credentialRef': 'translation', 'bodyFields': {'query': 'text', 'target': 'language'},
                          'responsePath': ['result', 'text']}}


class HTTPNodeTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        for target, value in [('core.node_http.user_data_dir', str(self.root)),
                              ('core.node_catalog.catalog_path', self.root / 'catalog.json')]:
            mock = patch(target, return_value=value);mock.start();self.addCleanup(mock.stop)
        self.item = node_catalog.definition(sample())
        self.hash = node_catalog.digest(self.item)
        self.token = 'test-private-token-12345'

    def client(self, handler):
        original = httpx.Client
        return patch('core.node_http.httpx.Client', side_effect=lambda **kw: original(transport=httpx.MockTransport(handler), **kw))

    def run_node(self, **kwargs):
        return node_catalog.execute(self.item, {}, ['upstream'], worker_owner='alice', **kwargs)

    def test_fixed_destination_and_field_validation(self):
        for url in ['http://example.test/api', 'https://u:p@example.test/api', 'https://example.test/?key=x',
                    'https://example.test/#key', 'https://example.test/\n']:
            value = sample();value['execution']['url'] = url
            with self.subTest(url=url), self.assertRaises(ValueError):
                node_catalog.definition(value)
        value = sample();value['execution']['bodyFields']['query'] = 'missing'
        with self.assertRaisesRegex(ValueError, '已声明参数'):
            node_catalog.definition(value)

    def test_credential_scope_request_and_package(self):
        with self.assertRaisesRegex(ValueError, '绑定API凭据'):
            self.run_node()
        node_http.save_credential('alice', self.item, self.token)
        self.assertTrue(node_http.has_credential('alice', self.hash))
        self.assertFalse(node_http.has_credential('bob', self.hash))
        altered = copy.deepcopy(self.item);altered['execution']['url'] += '/changed'
        with self.assertRaisesRegex(ValueError, '绑定API凭据'):
            node_catalog.execute(altered, {}, [], worker_owner='alice')
        calls = []
        def handler(request):
            calls.append(request)
            self.assertEqual(request.headers['Authorization'], 'Bearer ' + self.token)
            self.assertEqual(json.loads(request.content), {'query': 'upstream\nhello', 'target': 'zh'})
            return httpx.Response(200, json={'result': {'text': '你好'}})
        with self.client(handler):
            self.assertEqual(self.run_node()['outputs']['text'], '你好')
        self.assertEqual(len(calls), 1)
        package = export_package(self.item, [{'httpResponse': {'result': {'text': '你好'}}, 'expectedText': '你好'}])
        self.assertNotIn(self.token.encode(), package)
        restored, tests = import_package(package)
        self.assertEqual(restored, self.item)
        self.assertNotIn(self.token, json.dumps(restored) + json.dumps(tests))
        self.assertEqual(node_catalog.permissions(restored), ['http-post', 'credential-reference'])
        node_http.save_credential('alice', self.item, '')
        self.assertFalse(node_http.has_credential('alice', self.hash))

    def test_failures_do_not_retry_or_expose_secrets(self):
        node_http.save_credential('alice', self.item, self.token)
        for response, message in [(httpx.Response(302, headers={'location': 'https://other.test'}), '302'),
                                  (httpx.Response(401, text=self.token), '401'),
                                  (httpx.Response(200, text='not json'), '有效JSON'),
                                  (httpx.Response(200, json={'result': {'text': self.token}}), '包含凭据'),
                                  (httpx.Response(200, json={'missing': 1}), '文本路径'),
                                  (httpx.Response(200, content=b'x' * (1024 * 1024 + 1)), '1MiB')]:
            calls = []
            def handler(request):
                calls.append(request);return response
            with self.subTest(message=message), self.client(handler):
                with self.assertRaisesRegex(ValueError, message) as caught:
                    self.run_node()
                self.assertNotIn(self.token, str(caught.exception))
                self.assertEqual(len(calls), 1)
        with self.client(lambda request: (_ for _ in ()).throw(httpx.ReadTimeout(self.token))):
            with self.assertRaisesRegex(ValueError, '未自动重试') as caught:
                self.run_node()
            self.assertNotIn(self.token, str(caught.exception))

    def test_candidates_use_fixtures_without_network_or_credentials(self):
        service = NodePluginBuilds(ComfyBuilds(self.root / 'builds', self.root, 'alice', 'canvas', 'localhost:8188'))
        with self.assertRaisesRegex(ValueError, 'httpResponse'):
            service.create(self.item, [{'expectedText': '你好'}])
        with patch('core.node_http.httpx.Client', side_effect=AssertionError('candidate attempted network')):
            record = service.create(self.item, [{'httpResponse': {'result': {'text': '你好'}}, 'expectedText': '你好'}])
            record = service.test(record['id'])
        self.assertEqual(record['status'], 'passed')
        self.assertIn('未调用真实服务', record['report']['scope'])
        self.assertIn('httpContract', node_catalog.sdk())
        proposal = service.call('canvas_propose_plugin', {'candidate_id': record['id'], 'revision': record['revision']})
        self.assertIn('未联网', proposal['proposal']['summary'])
        service.install(record['id'], record['revision'])
        node_http.save_credential('alice', self.item, self.token)
        with self.client(lambda request: httpx.Response(200, json={'result': {'text': '真实执行路径'}})):
            self.assertEqual(self.run_node()['outputs']['text'], '真实执行路径')

    def test_durable_sync_results_and_ambiguous_submit_never_reposts(self):
        node_http.save_credential('alice', self.item, self.token)
        calls = []
        def handler(request):
            calls.append(request)
            return httpx.Response(200, json={'result': {'text': 'cached'}})
        with self.client(handler):
            self.assertEqual(self.run_node(run_id='a'*32)['outputs']['text'], 'cached')
            self.assertEqual(self.run_node(run_id='a'*32)['outputs']['text'], 'cached')
        self.assertEqual(len(calls), 1)
        with self.assertRaisesRegex(ValueError, '参数已变化'):
            node_catalog.execute(self.item, {'text':'changed'}, ['upstream'], worker_owner='alice', run_id='a'*32)
        with self.client(lambda request: (_ for _ in ()).throw(httpx.ReadTimeout('lost response'))):
            with self.assertRaisesRegex(ValueError, '未自动重试'):
                self.run_node(run_id='b'*32)
        with patch('core.node_http.httpx.Client', side_effect=AssertionError('must not repost')):
            with self.assertRaisesRegex(ValueError, '不明确'):
                self.run_node(run_id='b'*32)

    def test_async_resume_only_polls_and_enforces_request_budget(self):
        item = copy.deepcopy(self.item)
        item['execution']['polling'] = {'url':'https://api.example.test/jobs/{jobId}', 'jobIdPath':['id'],
                                        'statusPath':['status'], 'success':['done'], 'maxPolls':3}
        node_http.save_credential('alice', item, self.token)
        calls = []
        def first(request):
            calls.append(request.method)
            if request.method == 'POST':
                return httpx.Response(202, json={'id':'job-1'})
            raise httpx.ReadTimeout('poll interrupted')
        with self.client(first), self.assertRaises(ValueError):
            node_catalog.execute(item, {}, [], worker_owner='alice', run_id='c'*32)
        def second(request):
            calls.append(request.method)
            self.assertTrue(str(request.url).endswith('/jobs/job-1'))
            return httpx.Response(200, json={'status':'done','result':{'text':'complete'}})
        with self.client(second):
            result = node_catalog.execute(item, {}, [], worker_owner='alice', run_id='c'*32)
            self.assertEqual(result['outputs']['text'], 'complete')
            node_catalog.execute(item, {}, [], worker_owner='alice', run_id='c'*32)
        self.assertEqual(calls, ['POST','GET','GET'])
        bad = copy.deepcopy(item);bad['execution']['polling']['url'] = 'https://other.test/jobs/{jobId}'
        with self.assertRaisesRegex(ValueError, '同源'):
            node_catalog.definition(bad)


class HTTPCredentialRoutes(unittest.IsolatedAsyncioTestCase):
    async def test_routes_mask_credentials_and_require_local_session(self):
        from routers.mcp_tools import router
        app = FastAPI();app.include_router(router)
        temp = tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        item = node_catalog.definition(sample());digest = node_catalog.digest(item)
        fake = types.SimpleNamespace(get_username_by_token=lambda token: 'alice')
        with patch.dict('sys.modules', {'main': fake}), patch('core.node_http.user_data_dir', return_value=temp.name), patch.object(node_catalog, 'read_catalog', return_value={'definitions': [item]}):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=('127.0.0.1', 1234)), base_url='http://localhost') as client:
                url = '/api/mcp/node-http-credential'
                response = await client.post(url, json={'definitionHash': digest, 'token': 'private-key'})
                self.assertEqual(response.status_code, 403)
                response = await client.post(url, headers={'X-Art-MCP': '1'}, json={'definitionHash': digest, 'token': 'private-key'})
                self.assertEqual(response.json(), {'configured': True})
                response = await client.get(url, params={'definitionHash': digest})
                self.assertEqual(response.json(), {'configured': True})
                self.assertNotIn('private-key', response.text)
                response = await client.post(url, headers={'X-Art-MCP': '1'}, json={'definitionHash': 'x'*64, 'token': 'private-key'})
                self.assertEqual(response.status_code, 400)
                response = await client.post(url, headers={'X-Art-MCP': '1'}, json={'definitionHash': digest, 'token': ''})
                self.assertEqual(response.json(), {'configured': False})


if __name__ == '__main__':
    unittest.main()
