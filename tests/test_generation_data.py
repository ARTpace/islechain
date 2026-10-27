import asyncio
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import generation_data as gd
from routers.generation_dashboard import router


class GenerationDataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = gd.GenerationStore(Path(self.temp.name) / 'records.sqlite3')
        self.main = types.SimpleNamespace(
            get_username_by_token=lambda token: {'a':'alice', 'b':'bob', 'admin':'admin'}.get(token),
            request_auth_token=lambda request, token='': token or request.headers.get('authorization','').removeprefix('Bearer '),
            is_admin_by_token=lambda token: token == 'admin',
        )
        def require(token):
            user = self.main.get_username_by_token(token)
            if not user:
                raise HTTPException(401, '请登录')
            return user
        self.main.require_valid_token = require
        self.module_patch = patch.dict(sys.modules, {'main':self.main})
        self.store_patch = patch.object(gd, '_store', self.store)
        self.module_patch.start(); self.store_patch.start()
        app = FastAPI(); app.include_router(router)
        self.client = TestClient(app)

    def tearDown(self):
        self.store_patch.stop(); self.module_patch.stop(); self.temp.cleanup()

    def record(self, user='alice', error=None):
        rid = self.store.start(user, 'image', {'model':'nano', 'generation_params':{'ratio':'16:9','count':2}, 'api_key':'PRIVATE'})
        self.store.finish(rid, {'images':['one','two']}, error=error)
        return rid

    def test_counts_parameters_and_idempotent_completion(self):
        rid = self.record(); self.store.finish(rid, error='should not overwrite')
        self.record(error='provider failed')
        data = self.store.query()
        self.assertEqual((data['summary']['total'], data['summary']['succeeded'], data['summary']['failed']), (2,1,1))
        self.assertEqual(data['summary']['success_rate'],50)
        self.assertNotIn('PRIVATE', json.dumps(data))
        self.assertEqual(data['records'][0]['params']['generation_params']['ratio'],'16:9')

    def test_permissions_filters_and_export(self):
        self.record(); self.record('bob', error='failure')
        self.assertEqual(self.client.get('/api/generation-data').status_code,401)
        alice = {'Authorization':'Bearer a'}
        self.assertEqual(self.client.get('/api/generation-data',headers=alice).json()['summary']['total'],1)
        self.assertEqual(self.client.get('/api/generation-data?user=bob',headers=alice).json()['records'],[])
        admin = {'Authorization':'Bearer admin'}
        data = self.client.get('/api/generation-data',headers=admin).json()
        self.assertEqual(data['summary']['total'],2)
        self.assertEqual(data['scope'],'all')
        self.assertEqual(self.client.get('/api/generation-data?status=failed',headers=admin).json()['summary']['total'],1)
        export = self.client.get('/api/generation-data?export=true',headers=alice)
        self.assertNotIn('bob',export.text)
        self.assertIn('16:9',export.text)
        self.assertEqual(self.client.get('/api/generation-data?start=bad',headers=admin).status_code,400)

    def test_nested_tracking_and_failures(self):
        class Payload:
            def model_dump(self): return {'model':'test', 'seed':42}
        @gd.tracked('image')
        async def inner(payload, token=''):
            return {'images':['a']}
        @gd.tracked('image')
        async def outer(payload, token=''):
            return await inner(payload, token)
        asyncio.run(outer(Payload(), 'a'))
        @gd.tracked('comfy')
        def fail(req, token=''):
            return {'error':'node failed'}
        fail(Payload(),'b')
        @gd.tracked('video')
        async def raises(payload, token=''):
            raise HTTPException(502,'upstream failed')
        with self.assertRaises(HTTPException): asyncio.run(raises(Payload(),'a'))
        result = self.store.query()
        self.assertEqual(result['summary']['total'],3)
        self.assertEqual(result['summary']['failed'],2)
        self.assertEqual({r['user'] for r in result['records']},{'alice','bob'})

    def test_restart_unknown_and_csv_formula(self):
        self.store.start('alice','image',{'prompt':'=formula'})
        self.store = gd.GenerationStore(self.store.path)
        gd._store = self.store
        data = self.store.query()
        self.assertEqual(data['summary']['interrupted'],1)
        self.assertIsNone(data['summary']['success_rate'])
        self.assertIsNone(data['records'][0]['elapsed_ms'])
        self.record('=formula')
        export = self.client.get('/api/generation-data?export=true',headers={'Authorization':'Bearer admin'})
        self.assertIn("'=formula",export.text)

    def test_installed_routes_capture_execution_identity(self):
        from pydantic import BaseModel
        class Payload(BaseModel):
            model: str = 'nano'
        async def image(payload, username=None):
            return {'images':['one'], 'model':'resolved-nano', 'params':{'seed':7}}
        self.main.build_online_image_result = image
        self.main._run_comfy_generate_sync = lambda req, token='': {'error':'node failed'}
        app = FastAPI()
        @app.post('/api/online-image')
        async def image_route(payload: Payload):
            return await self.main.build_online_image_result(payload)
        @app.post('/api/online-video')
        async def video_route(payload: Payload):
            raise HTTPException(502,'upstream failed')
        gd.install(app)
        client = TestClient(app)
        self.assertEqual(client.post('/api/online-image',json={},headers={'Authorization':'Bearer a'}).status_code,200)
        self.assertEqual(client.post('/api/online-video?token=b',json={}).status_code,502)
        records = self.store.query()['records']
        self.assertEqual({r['user'] for r in records},{'alice','bob'})
        image_record = next(r for r in records if r['kind']=='image')
        self.assertEqual(image_record['model'],'resolved-nano')
        self.assertEqual(image_record['params']['resolved']['params']['seed'],7)

    def test_unconfirmed_results_are_not_successes(self):
        rid = self.store.start('alice','image',{})
        self.store.finish(rid, {'status':'timeout', 'task_id':'remote'})
        data = self.store.query()
        self.assertEqual(data['summary']['interrupted'],1)
        self.assertEqual(data['summary']['succeeded'],0)
        self.assertIsNone(data['summary']['success_rate'])
        self.assertNotIn('private-value',gd.sanitize('upstream: {"api_key":"private-value"}'))


if __name__ == '__main__':
    unittest.main()
