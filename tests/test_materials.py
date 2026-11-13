"""Material geometry, ownership, persistence and ambiguous Designer submission tests."""
import asyncio
import importlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException
from PIL import Image

from core.material_maps import CHANNELS, prepare


class MapTests(unittest.TestCase):
    def test_color_only_relief_is_registered_and_constant_color_is_flat(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            y, x = np.mgrid[:128, :128]
            color = np.uint8(128+60*np.cos(2*np.pi*x/16))
            Image.fromarray(np.repeat(color[:, :, None], 3, axis=2)).save(root/'color.png')
            result = prepare(root/'color.png', None, root/'maps')
            self.assertEqual(result['method'], 'color')
            with Image.open(root/'maps/height.png') as im:
                height = np.asarray(im).copy()
            with Image.open(root/'maps/normal.png') as im:
                normal = np.asarray(im).astype(float)/127.5-1
            self.assertGreater(np.corrcoef(height.ravel(), color.ravel())[0, 1], .99)
            slope = np.roll(height.astype(float), -1, axis=1)-np.roll(height.astype(float), 1, axis=1)
            self.assertLess(np.corrcoef(slope.ravel(), normal[:, :, 0].ravel())[0, 1], -.98)
            for name in CHANNELS:
                with Image.open(root/'maps'/(name+'.png')) as im:
                    self.assertEqual(im.size, (128, 128))
            Image.new('RGB', (64, 32), 'tan').save(root/'flat.png')
            prepare(root/'flat.png', None, root/'flat')
            with Image.open(root/'flat/normal.png') as im:
                np.testing.assert_array_equal(np.asarray(im), np.broadcast_to([128, 128, 255], (32, 64, 3)))

    def test_flat_surface_preserves_color_and_neutral_height(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            color = np.arange(64*64*3, dtype=np.uint8).reshape(64, 64, 3)
            Image.fromarray(color).save(root/'color.png')
            Image.new('RGB', (64, 64), (128, 128, 255)).save(root/'normal.png')
            result = prepare(root/'color.png', root/'normal.png', root/'maps', size=512)
            np.testing.assert_array_equal(np.asarray(Image.open(root/'maps/basecolor.png')), color)
            height = np.asarray(Image.open(root/'maps/height.png'))
            self.assertLessEqual(int(height.max())-int(height.min()), 1)
            self.assertAlmostEqual(float(height.mean())/65535, .5, places=4)
            self.assertEqual(result['size'], [64, 64])
            for name in CHANNELS:
                with Image.open(root/'maps'/(name+'.png')) as image:
                    self.assertEqual(image.size, (64, 64))

    def test_periodic_slope_recovers_height_and_directx_matches(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            y, x = np.mgrid[:128, :128]
            target = np.sin(2*np.pi*x/128)+.6*np.cos(2*np.pi*y/128)
            p = .5*np.cos(2*np.pi*x/128)
            q = -.3*np.sin(2*np.pi*y/128)
            vectors = np.stack([-p, q, np.ones_like(p)], axis=2)
            vectors /= np.linalg.norm(vectors, axis=2, keepdims=True)
            normal = np.uint8((vectors*.5+.5)*255+.5)
            Image.new('RGB', (128, 128), 'tan').save(root/'color.png')
            Image.fromarray(normal).save(root/'gl.png')
            dx = normal.copy(); dx[:, :, 1] = 255-dx[:, :, 1]
            Image.fromarray(dx).save(root/'dx.png')
            prepare(root/'color.png', root/'gl.png', root/'gl')
            prepare(root/'color.png', root/'dx.png', root/'dx', normal_format='directx')
            gl = np.asarray(Image.open(root/'gl/height.png'))
            self.assertGreater(np.corrcoef(gl.ravel(), target.ravel())[0, 1], .99)
            np.testing.assert_array_equal(np.asarray(Image.open(root/'dx/normal.png')), np.asarray(Image.open(root/'gl/normal.png')))
            Image.new('RGB', (64, 32)).save(root/'bad.png')
            with self.assertRaisesRegex(ValueError, '宽高比'):
                prepare(root/'color.png', root/'bad.png', root/'bad')


class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        importlib.import_module('main')
        self.module = importlib.import_module('routers.materials')
        self.canvases = importlib.import_module('routers.canvases')
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.assets = self.root/'input'/'alice'; self.assets.mkdir(parents=True)
        Image.new('RGB', (64, 64), 'tan').save(self.assets/'color.png')
        Image.new('RGB', (64, 64), (128, 128, 255)).save(self.assets/'normal.png')
        self.canvas = {'id': 'test-material', 'owner': 'alice', 'nodes': [{'url': '/assets/alice/color.png'}, {'url': '/assets/alice/normal.png'}]}
        self.patches = [patch.object(self.module, 'user_data_dir', return_value=str(self.root)),
                        patch.object(self.canvases, 'INPUT_DIR', str(self.root/'input')),
                        patch.object(self.canvases, 'OUTPUT_DIR', str(self.root/'output')),
                        patch.object(self.canvases, 'get_canvas_asset_dir', return_value=str(self.assets)),
                        patch.object(self.canvases, 'build_asset_url', side_effect=lambda c, f: '/assets/alice/'+f),
                        patch.object(self.canvases, 'local_media_path_from_url', side_effect=lambda u: str(self.root/'input'/u.removeprefix('/assets/')) if u.startswith('/assets/') and '..' not in u else None),
                        patch.object(self.canvases, 'load_canvas_any', return_value=self.canvas)]
        bridge = importlib.import_module('routers.dcc_bridge')
        def require(token):
            if token not in ('alice', 'bob'):
                raise HTTPException(401, '请登录')
            return token
        self.patches.append(patch.object(bridge._main, 'require_valid_token', side_effect=require))
        for item in self.patches: item.start()
        self.app = FastAPI(); self.app.include_router(self.module.router)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://localhost', headers={'Authorization': 'Bearer alice', 'Origin': 'http://localhost'})
        self.payload = {'requestId': 'a'*32, 'colorUrl': '/assets/alice/color.png', 'normalUrl': '/assets/alice/normal.png', 'size': 512}

    async def asyncTearDown(self):
        if self.module._tasks:
            await asyncio.gather(*list(self.module._tasks))
        await self.client.aclose()
        for item in reversed(self.patches): item.stop()
        self.temp.cleanup()

    async def create_job(self):
        response = await self.client.post('/api/materials/test-material/jobs', json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        await asyncio.gather(*list(self.module._tasks))
        response = await self.client.get('/api/materials/test-material/jobs/'+'a'*32)
        self.assertEqual(response.json()['status'], 'succeeded', response.text)
        return response.json()

    async def test_material_presets_require_login_and_include_manuals(self):
        response = await self.client.get('/api/materials/presets')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()['presets']), 4)
        self.assertTrue(all(p['skill'] and p['persona'] for p in response.json()['presets']))
        response = await self.client.get('/api/materials/presets', headers={'Authorization': 'Bearer invalid'})
        self.assertEqual(response.status_code, 401)

    async def test_color_only_job_without_normal(self):
        del self.payload['normalUrl']
        state = await self.create_job()
        self.assertEqual(state['result']['method'], 'color')
        self.assertEqual(len(state['result']['maps']), 6)
        replay = await self.client.post('/api/materials/test-material/jobs', json=self.payload)
        self.assertEqual(replay.json()['id'], state['id'])

    async def test_job_replay_conflict_and_owner(self):
        state = await self.create_job()
        replay = await self.client.post('/api/materials/test-material/jobs', json=self.payload)
        self.assertEqual(replay.json()['id'], state['id'])
        self.assertEqual(replay.json()['status'], 'succeeded')
        changed = {**self.payload, 'roughness': .9}
        self.assertEqual((await self.client.post('/api/materials/test-material/jobs', json=changed)).status_code, 409)
        self.assertEqual((await self.client.get('/api/materials/test-material/jobs/'+'a'*32, headers={'Authorization': 'Bearer bob'})).status_code, 403)
        self.assertEqual((await self.client.post('/api/materials/test-material/jobs', json=self.payload, headers={'Origin': 'http://evil.test'})).status_code, 403)
        self.assertEqual((await self.client.get('/api/materials/designer/status', headers={'Authorization': ''})).status_code, 401)

    async def test_foreign_asset_injected_into_owned_canvas_is_rejected(self):
        other = self.root/'input'/'bob'; other.mkdir()
        Image.new('RGB', (64, 64)).save(other/'secret.png')
        self.canvas['nodes'].append({'url': '/assets/bob/secret.png'})
        payload = {**self.payload, 'colorUrl': '/assets/bob/secret.png'}
        self.assertEqual((await self.client.post('/api/materials/test-material/jobs', json=payload)).status_code, 403)

    async def test_uncertain_designer_is_never_replayed(self):
        await self.create_job()
        endpoint = '/api/materials/test-material/jobs/'+'a'*32+'/designer'
        with patch.object(self.module.Designer, 'connect', return_value='instance'), patch.object(self.module.Designer, 'create', side_effect=TimeoutError('ambiguous')) as create:
            await self.client.post(endpoint, json={})
            await asyncio.gather(*list(self.module._tasks))
            result = await self.client.post(endpoint, json={})
            self.assertEqual(result.json()['designer']['status'], 'unknown')
            self.assertEqual(create.call_count, 1)
        # Re-read from disk (as after a process/browser restart), not just memory.
        status = await self.client.get(endpoint.removesuffix('/designer'))
        self.assertEqual(status.json()['designer']['status'], 'unknown')


if __name__ == '__main__':
    unittest.main()
