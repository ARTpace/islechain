import asyncio
import contextvars
import importlib.util
import json
import re
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import feature_access as features


class FeatureAccessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'feature-access.json'
        fake = types.SimpleNamespace(USER_DATA_DIR=self.temp.name, LAN_VISITOR=contextvars.ContextVar('test_visitor',default=False),
            atomic_write_json=lambda path,data,**kwargs:Path(path).write_text(json.dumps(data),encoding='utf-8'),
            ensure_same_origin_request=lambda request:None)
        self.main_patch=patch.dict(sys.modules,{'main':fake});self.main_patch.start()
        spec=importlib.util.spec_from_file_location('test_lan_guard','lan_sharing.py')
        self.lan=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.lan)
        self.lan_patch=patch.dict(sys.modules,{'lan_sharing':self.lan});self.lan_patch.start()
        self.policy_patch=patch.object(features,'policy_path',lambda:self.path);self.policy_patch.start()
        self.lan.load_config=lambda:{'enabled':True}
        self.lan._clients=lambda:{}
        self.lan._save_clients=lambda data:None
        self.app=FastAPI()
        self.app.middleware('http')(self.lan.guard)
        self.app.include_router(features.router)
        @self.app.get('/static/app/generation-dashboard.html')
        @self.app.get('/api/generation-data')
        @self.app.get('/static/app/zimage.html')
        async def page():return {'ok':True}
        @self.app.post('/api/generate')
        async def generate(request:features.Request):return await request.json()

    def tearDown(self):
        self.policy_patch.stop();self.lan_patch.stop();self.main_patch.stop();self.temp.cleanup()

    def call(self,path,method='GET',payload=None,guest=False):
        async def run():
            transport=httpx.ASGITransport(app=self.app,client=('192.168.1.50' if guest else '127.0.0.1',12345))
            async with httpx.AsyncClient(transport=transport,base_url='http://192.168.1.2:7001' if guest else 'http://127.0.0.1:7000') as client:
                return await client.request(method,path,json=payload)
        return asyncio.run(run())

    def test_guest_cannot_edit_and_host_stays_enabled(self):
        result=self.call('/api/feature-access','POST',{'guest_disabled':['generation-dashboard','chat-gen']})
        self.assertEqual(result.status_code,200)
        self.assertEqual(self.call('/api/feature-access',guest=True).json()['visitor'],True)
        for path in ('/static/app/generation-dashboard.html','/api/generation-data','/static/app/zimage.html?chat=1'):
            self.assertEqual(self.call(path,guest=True).status_code,403)
            self.assertEqual(self.call(path).status_code,200)
        self.assertEqual(self.call('/static/app/zimage.html',guest=True).status_code,200)
        self.assertEqual(self.call('/api/feature-access','POST',{'guest_disabled':[]},guest=True).status_code,403)
        self.assertIn('chat-gen',features.guest_disabled())

    def test_shared_api_body_is_replayed_and_disabled_when_no_consumer(self):
        self.call('/api/feature-access','POST',{'guest_disabled':['zimage','chat-gen','canvas']})
        self.assertEqual(self.call('/api/generate','POST',{'type':'zimage'},guest=True).status_code,403)
        allowed=self.call('/api/generate','POST',{'type':'rmbg','prompt':'preserved'},guest=True)
        self.assertEqual(allowed.status_code,200)
        self.assertEqual(allowed.json()['prompt'],'preserved')

    def test_validation_and_persistence(self):
        self.assertEqual(self.call('/api/feature-access','POST',{'guest_disabled':['invalid']}).status_code,400)
        self.call('/api/feature-access','POST',{'guest_disabled':[]})
        self.assertIn('training',features.guest_disabled())
        self.assertEqual(json.loads(self.path.read_text())['guest_disabled'],['training'])
        self.path.write_text('invalid json')
        self.assertEqual(features.guest_disabled(),set(features.MODULES))

    def test_module_catalog_matches_menu(self):
        source=Path('static/index.html').read_text(encoding='utf-8')
        catalog=source[source.index('            groups: ['):source.index('            map: function')]
        self.assertEqual(set(re.findall(r"id: '([^']+)'",catalog)),set(features.MODULES))


if __name__=='__main__':unittest.main()
