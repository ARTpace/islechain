import asyncio
import io
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import HTTPException
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import image_cutout as cutout


def png():
    stream = io.BytesIO()
    Image.new('RGBA', (32, 32), (255, 255, 255, 128)).save(stream, 'PNG')
    return stream.getvalue()


class CutoutTests(unittest.IsolatedAsyncioTestCase):
    def test_progress_reports_actual_queue_state(self):
        queue = {'queue_pending': [[1, 'other'], [2, 'mine']], 'queue_running': [[0, 'running']]}
        waiting = cutout._task_progress(queue, 'mine')
        self.assertEqual(waiting['stage'], 'queued')
        self.assertIn('2', waiting['label'])
        self.assertNotIn('value', waiting)
        self.assertEqual(cutout._task_progress(queue, 'running')['stage'], 'running')
        self.assertEqual(cutout._task_progress(queue, 'unknown')['stage'], 'processing')

    def test_selection_uses_available_models(self):
        self.assertEqual(cutout.choose_model(png(), '人像头发', ['BEN2', 'RMBG-2.0'])[0], 'BEN2')
        self.assertEqual(cutout.choose_model(png(), '商品图标', ['BEN2', 'RMBG-2.0'])[0], 'RMBG-2.0')
        self.assertEqual(cutout.choose_model(png(), 'portrait', ['INSPYRENET'])[0], 'INSPYRENET')
        with self.assertRaises(HTTPException):
            cutout.choose_model(png(), '', [])

    async def test_dedup_save_and_reopen(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / 'output'
            output.mkdir()
            source = output / 'original.png'
            source.write_bytes(png())
            account = root / 'account'
            account.mkdir()
            main = types.SimpleNamespace(
                OUTPUT_DIR=str(output), COMFYUI_ADDRESS='localhost:8188',
                account_data_dir=lambda: str(account), account_dirname=lambda: 'owner',
                ensure_same_origin_request=lambda request: None,
                assert_account_media=lambda relative: None,
                output_file_from_url=lambda url: str(output / url[len('/output/'):]) if (output / url[len('/output/'):]).is_file() else None,
                atomic_write_json=lambda path, data, **kwargs: Path(path).write_text(cutout.json.dumps(data), encoding='utf-8'))
            submitted = []
            uploaded = []
            fail_history = False
            schema = {'required': {'model': [['BEN2', 'RMBG-2.0']], 'image': ['IMAGE'], 'background': [['Alpha', 'White']]}}
            def respond(request):
                if request.url.path == '/object_info/RMBG':
                    return httpx.Response(200, json={'RMBG': {'input': schema}})
                if request.url.path.startswith('/object_info/'):
                    return httpx.Response(200, json={})
                if request.url.path == '/upload/image':
                    uploaded.append(request.content)
                    return httpx.Response(200, json={'name': 'uploaded.png'})
                if request.url.path == '/prompt':
                    submitted.append(cutout.json.loads(request.content))
                    return httpx.Response(200, json={'prompt_id': 'test-task', 'node_errors': {}})
                if request.url.path == '/history/test-task':
                    if fail_history:
                        return httpx.Response(200, json={'test-task': {'status': {'status_str': 'error'}}})
                    return httpx.Response(200, json={'test-task': {'outputs': {'5': {'images': [{'filename': 'result.png', 'type': 'temp'}]}}}})
                if request.url.path == '/view':
                    return httpx.Response(200, content=png())
                raise AssertionError(request.url)
            client_type = httpx.AsyncClient
            def client(**kwargs):
                return client_type(transport=httpx.MockTransport(respond), **kwargs)
            payload = cutout.CutoutRequest(url='/output/original.png', prompt='图标')
            with patch.dict(sys.modules, {'main': main}), patch.object(cutout.httpx, 'AsyncClient', client):
                a, b = await asyncio.gather(cutout.start_cutout(payload, None), cutout.start_cutout(payload, None))
                self.assertEqual(a['id'], b['id'])
                self.assertEqual(len(submitted), 1)
                self.assertEqual(submitted[0]['prompt']['1']['inputs']['background'], 'Alpha')
                result = await cutout.cutout_status(a['id'])
                self.assertEqual(result['status'], 'done')
                with Image.open(main.output_file_from_url(result['url'])) as image:
                    self.assertEqual(image.getpixel((0, 0))[3], 128)
                reopened = await cutout.start_cutout(payload, None)
                self.assertEqual(reopened['url'], result['url'])
                self.assertEqual(len(submitted), 1)
                self.assertEqual(source.read_bytes(), png())
                self.assertEqual((await cutout.cutout_models())['models'], ['BEN2', 'RMBG-2.0'])
                with self.assertRaises(HTTPException) as exc:
                    await cutout.start_cutout(cutout.CutoutRequest(url=payload.url, model='missing', retry=True), None)
                self.assertEqual(exc.exception.status_code, 400)
                self.assertEqual(len(submitted), 1)
                manual = cutout.CutoutRequest(url=payload.url, model='BEN2', retry=True)
                retry = await cutout.start_cutout(manual, None)
                self.assertEqual(submitted[-1]['prompt']['1']['inputs']['model'], 'BEN2')
                self.assertEqual(len(retry['versions']), 1)
                with self.assertRaises(HTTPException) as exc:
                    await cutout.start_cutout(manual, None)
                self.assertEqual(exc.exception.status_code, 409)
                second = await cutout.cutout_status(retry['id'])
                self.assertEqual(len(second['versions']), 2)
                self.assertNotEqual(second['url'], result['url'])
                self.assertTrue(Path(main.output_file_from_url(result['url'])).is_file())
                self.assertEqual(second['versions'][-1]['selection'], 'manual')
                self.assertTrue(all(png() in body for body in uploaded), '重试必须重新上传原图')
                self.assertEqual(len((await cutout.start_cutout(payload, None))['versions']), 2)
                fail_history = True
                await cutout.start_cutout(manual, None)
                failed = await cutout.cutout_status(retry['id'])
                self.assertEqual(failed['status'], 'error')
                self.assertEqual(len(failed['versions']), 2)
                preserved = await cutout.start_cutout(payload, None)
                self.assertEqual(preserved['url'], second['url'])
                self.assertEqual(preserved['status'], 'done')
                self.assertEqual(len(submitted), 3)
                # Another account cannot read the saved task by ID.
                other = root / 'other'
                other.mkdir()
                main.account_data_dir = lambda: str(other)
                with self.assertRaises(HTTPException) as exc:
                    await cutout.cutout_status(a['id'])
                self.assertEqual(exc.exception.status_code, 404)

    def test_incompatible_node_fails_before_submit(self):
        with self.assertRaises(HTTPException):
            cutout.workflow('image.png', 'BEN2', {'required': {'image': ['IMAGE'], 'model': [['BEN2']]}})

    def test_old_result_becomes_first_version(self):
        old = {'status': 'done', 'url': '/output/old.png', 'model': 'BEN2', 'kind': '人物', 'created_at': 1}
        versions = cutout._versions(old)
        self.assertEqual(versions[0]['url'], old['url'])
        self.assertEqual(len(cutout._versions({**old, 'versions': versions})), 1)

    def test_new_model_workflows(self):
        import json
        root = Path(__file__).parents[1] / 'workflows' / 'cutout'
        expected = {'lucida': 'BiRefNetRMBG', 'birefnet-general': 'BiRefNetRMBG',
                    'birefnet-hr-matting': 'BiRefNetRMBG', 'birefnet-toonout': 'BiRefNetRMBG',
                    'fey-no-bg': 'ArtCanvasFeyNoBg', 'sam3': 'SAM3Segment'}
        for name, node_type in expected.items():
            graph = json.loads((root / (name + '.json')).read_text(encoding='utf-8'))
            self.assertEqual(graph['1']['class_type'], node_type)
            self.assertEqual(graph['1']['inputs']['background'], 'Alpha')
            self.assertEqual(graph['5']['inputs']['images'], ['1', 0])
        sam = json.loads((root / 'sam3.json').read_text(encoding='utf-8'))
        self.assertEqual(sam['1']['inputs']['model_name'], 'sam3.1_multiplex_fp16')
        with self.assertRaises(HTTPException):
            cutout.workflow('x.png', 'SAM3', {'required': {'image': ['IMAGE']}}, 'SAM3Segment')

    def test_exported_workflows_are_registered(self):
        import os
        root = Path(__file__).parents[1]
        source = (root / 'main.py').read_text(encoding='utf-8')
        registration = source[source.index('BUILTIN_WORKFLOW_DIRS ='):source.index('\ndef update_env_values(')]
        namespace = {'os': os, 'WORKFLOW_DIR': str(root / 'workflows')}
        exec(registration, namespace)
        exports = {str(path.relative_to(root / 'workflows')).replace('\\', '/') for path in (root / 'workflows' / 'cutout').glob('*.json') if not path.name.endswith('.config.json')}
        self.assertEqual(len(exports), 6)
        self.assertTrue(exports <= namespace['BUILTIN_WORKFLOWS'])

    async def test_catalog_combines_actual_nodes(self):
        async def info(client, method, url, **kwargs):
            node = url.rsplit('/', 1)[-1]
            if node == 'RMBG':
                return {node: {'input': {'required': {'model': [['BEN2']]}}}}
            if node == 'BiRefNetRMBG':
                return {node: {'input': {'required': {'model': [['Lucida', 'BiRefNet-general', 'BiRefNet-HR-matting', 'BiRefNet_toonout']]}}}}
            return {node: {'input': {'required': {'image': ['IMAGE']}}}}
        with patch.object(cutout, '_json', side_effect=info):
            catalog, models = await cutout._models(None, 'http://comfy')
        self.assertIn('Lucida', models)
        self.assertIn('SAM3', models)
        self.assertEqual(catalog['FeyNoBg']['node_type'], 'ArtCanvasFeyNoBg')
        self.assertEqual(cutout.choose_model(png(), '插画图标', models)[0], 'Lucida')

    def test_external_sources_rejected(self):
        with self.assertRaises(HTTPException) as exc:
            cutout._source(None, 'http://127.0.0.1/private')
        self.assertEqual(exc.exception.status_code, 400)

    async def test_guest_route_requires_cutout_permission(self):
        from feature_access import required_modules
        request = types.SimpleNamespace(url=types.SimpleNamespace(path='/api/image-cutout/task'))
        self.assertEqual(await required_modules(request), {'rmbg'})


if __name__ == '__main__':
    unittest.main()
