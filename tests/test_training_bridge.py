"""MCP handshake, credentials, write replay, and local-only route checks; no real trainer run."""
import importlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
import httpx

from tools.training_bridge import TrainingClient, TrainingError, load_settings, local_url, save_settings


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    def test_local_endpoint_and_atomic_settings(self):
        self.assertEqual(local_url('http://localhost:19366/mcp'), 'http://127.0.0.1:19366/mcp')
        for address in ('https://127.0.0.1:19366/mcp', 'http://example.com:19366/mcp',
                        'http://127.0.0.1:19366/mcp?token=secret', 'http://a:b@127.0.0.1:19366/mcp',
                        'http://127.0.0.1:19366/other', 'http://127.0.0.1/mcp', 'http://[::1]:19366/mcp'):
            with self.assertRaises(TrainingError):
                local_url(address)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'settings.json'
            save_settings(path, {'token': 'private'})
            self.assertEqual(load_settings(path)['token'], 'private')
            self.assertEqual(len(list(Path(directory).iterdir())), 1)

    async def test_handshake_catalog_and_single_session(self):
        seen = []
        def handler(request):
            data = json.loads(request.content)
            seen.append(data['method'])
            self.assertEqual(request.headers['authorization'], 'Bearer test-secret')
            if data['method'] == 'initialize':
                return httpx.Response(200, headers={'Mcp-Session-Id': 'session1'}, json={'id': data['id'], 'result': {
                    'serverInfo': {'name': 'kohya-lora'}, 'protocolVersion': '2025-11-25'}})
            self.assertEqual(request.headers['Mcp-Session-Id'], 'session1')
            if data['method'] == 'notifications/initialized':
                return httpx.Response(202)
            if data['method'] == 'tools/list':
                result = {'tools': [{'name': 'list_projects'}, {'name': 'arbitrary_shell'}]}
            else:
                result = {'structuredContent': {'ok': True, 'note': 'echo test-secret'}}
            return httpx.Response(200, json={'id': data['id'], 'result': result})
        client = TrainingClient('http://localhost:19366/mcp', 'test-secret', httpx.MockTransport(handler))
        self.assertEqual(await client.call('get_environment', {}), {'ok': True, 'note': 'echo <REDACTED>'})
        self.assertEqual(await client.catalog(), [{'name': 'list_projects'}])
        self.assertEqual(seen, ['initialize', 'notifications/initialized', 'tools/call', 'tools/list'])
        with self.assertRaises(TrainingError):
            await client.call('arbitrary_shell', {})

    async def test_timed_out_mutation_is_not_replayed(self):
        calls = []
        def handler(request):
            calls.append(json.loads(request.content))
            raise httpx.ReadTimeout('timeout', request=request)
        client = TrainingClient('http://127.0.0.1:19366/mcp', 'secret', httpx.MockTransport(handler))
        client.session = 'existing'
        with self.assertRaisesRegex(TrainingError, '不要重复启动'):
            await client.call('start_training', {'project': 'test'})
        self.assertEqual(len(calls), 1)

    async def test_expired_session_and_application_error(self):
        client = TrainingClient('http://127.0.0.1:19366/mcp', 'secret',
            httpx.MockTransport(lambda _: httpx.Response(404)))
        client.session = 'expired'
        with self.assertRaises(TrainingError):
            await client.call('start_training', {'project': 'test'})
        self.assertEqual(client.session, '')
        def handler(request):
            return httpx.Response(200, json={'id': json.loads(request.content)['id'], 'result': {
                'structuredContent': {'ok': False, 'code': 'READ_ONLY', 'error': '只读'}}})
        client.transport = httpx.MockTransport(handler)
        client.session = 'new'
        self.assertEqual((await client.call('create_project', {}))['code'], 'READ_ONLY')

    async def test_route_keeps_token_private_and_blocks_cross_site(self):
        module = importlib.import_module('routers.training')
        app = FastAPI()
        app.include_router(module.router)
        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'settings_path', return_value=Path(directory)/'connection.json'):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost') as client:
                payload = {'token': 'private-key', 'url': 'http://127.0.0.1:19366/mcp', 'install_dir': directory}
                response = await client.post('/api/training/connection', json=payload, headers={'X-Art-Training': '1', 'Origin': 'http://evil.test'})
                self.assertEqual(response.status_code, 403)
                response = await client.post('/api/training/connection', json=payload)
                self.assertEqual(response.status_code, 403)
                response = await client.post('/api/training/connection', json=payload, headers={'X-Art-Training': '1'})
                self.assertEqual(response.status_code, 200)
                response = await client.get('/api/training/connection')
                self.assertTrue(response.json()['has_token'])
                self.assertNotIn('private-key', response.text)
                await client.post('/api/training/connection', json={'url': payload['url'], 'install_dir': directory}, headers={'X-Art-Training': '1'})
                self.assertEqual(module.settings()['token'], 'private-key', 'blank token must retain saved credentials')
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=('10.0.0.2', 1234)),base_url='http://localhost') as remote:
                self.assertEqual((await remote.get('/api/training/connection')).status_code, 403)


if __name__ == '__main__':
    unittest.main()
