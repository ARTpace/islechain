"""Real Node bridge checks; temporary storage, no provider calls or spending."""
import tempfile
import unittest
from importlib import import_module
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
studio = import_module('routers.tripo_studio')


class TripoBridgeTests(unittest.TestCase):
    def test_workbench_project_and_local_boundary(self):
        @asynccontextmanager
        async def lifespan(app):
            yield
            await studio.stop()

        app = FastAPI(lifespan=lifespan)
        app.include_router(studio.router)
        with tempfile.TemporaryDirectory() as directory, patch.object(studio, '_DATA_DIRECTORY', Path(directory)), \
                TestClient(app, base_url='http://127.0.0.1', client=('127.0.0.1', 1234)) as client:
            self.assertEqual(client.get('/tripo-studio/').status_code, 200)
            self.assertIn('createElement', client.get('/tripo-studio/app.js').text)
            # Browser modules must resolve their actual transitive imports; server
            # internals stay private even behind the localhost bridge.
            for module in ('contracts.js', 'prompt-policy.js', 'image-models.js', 'site.js',
                           'local-api.js', 'credit-estimate.js', 'model-pricing.js'):
                path = '/tripo-studio/shared/' + module
                response = client.get(path)
                self.assertEqual(response.status_code, 200, module)
                self.assertIn('javascript', response.headers['content-type'])
                self.assertTrue(response.text)
                self.assertEqual(client.head(path).content, b'')
            self.assertEqual(client.get('/tripo-studio/shared/service.js').status_code, 404)
            self.assertEqual(client.get('/tripo-studio/shared/../server/service.js').status_code, 404)
            headers = {'x-tripo-studio': '1'}
            status = client.get('/dsh-tripo-studio/status', headers=headers)
            self.assertEqual(status.status_code, 200, status.text)
            data = status.json()
            self.assertFalse(data['keyConfigured'])
            self.assertFalse(data['paidEnabled'])
            self.assertEqual(client.post('/dsh-tripo-studio/projects', headers=headers, json={'name':'test'}).status_code, 403)
            headers['x-tripo-csrf'] = data['csrfToken']
            created = client.post('/dsh-tripo-studio/projects', headers=headers, json={'name':'bridge test'})
            self.assertEqual(created.status_code, 201, created.text)
            projects = client.get('/dsh-tripo-studio/projects', headers=headers).json()
            self.assertEqual(projects[0]['name'], 'bridge test')
            self.assertEqual(client.get('/dsh-tripo-studio/status', headers={'x-forwarded-for':'127.0.0.1'}).status_code, 403)
            self.assertEqual(client.get('/tripo-studio/', headers={'origin':'https://evil.example'}).status_code, 403)
            self.assertEqual(client.get('/tripo-studio/', headers={'host':'evil.example'}).status_code, 403)
            self.assertEqual(client.get('/dsh-tripo-studio/status').status_code, 403)
            port = studio._port
            import httpx
            self.assertEqual(httpx.get(f'http://127.0.0.1:{port}/tripo-studio/', trust_env=False).status_code, 403)
        self.assertIsNone(studio._process)
        with TestClient(app, base_url='http://127.0.0.1', client=('192.168.1.2', 1234)) as client:
            self.assertEqual(client.get('/tripo-studio/').status_code, 403)


if __name__ == '__main__':
    unittest.main()
