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
from core import image_cutout as cutout


def png():
    stream = io.BytesIO()
    Image.new('RGBA', (32, 32), (255, 255, 255, 128)).save(stream, 'PNG')
    return stream.getvalue()


class CutoutTests(unittest.IsolatedAsyncioTestCase):
    def test_new_still_image_methods_have_isolated_local_graphs(self):
        import json
        from core.cutout_workflow import WORKFLOW_PATH, load_branch
        canvas = json.loads(WORKFLOW_PATH.read_text(encoding='utf-8'))
        expected = {'segment-anything-ultra-v2', 'segment-anything-ultra-v3',
                    'auto-sdmatte', 'transparent-material-sdmatte', 'birefnet-ultra-v2'}
        for branch in expected:
            graph = load_branch(branch)
            types = [n['class_type'] for n in graph.values()]
            self.assertNotIn('RH_Translator', types)
            self.assertNotIn('ChinesePrompt_Mix', types)
            self.assertEqual(types.count('LoadImage'), 1)
            self.assertEqual(types.count('SaveImage'), 1)
        for branch in ('transparent-background-ultra', 'birefnet-hugo-refine',
                       'birefnet-zho', 'birefnet-rembg'):
            self.assertIn('tool', canvas['extra']['cutout']['branches'][branch])
            self.assertTrue(load_branch(branch))
        self.assertFalse(any(n['type'].startswith('VHS_') or 'Video' in n['type']
                             for n in canvas['nodes']))
        self.assertEqual(sum(n['type'] == 'SaveImage' and n['mode'] == 0
                             for n in canvas['nodes']), 1)

    def test_tool_method_sets_uploaded_image_and_target(self):
        graph = cutout.workflow('upload/photo.png', 'auto-sdmatte', {}, 'workflow', 'person')
        image = next(n for n in graph.values() if n['class_type'] == 'LoadImage')
        segment = next(n for n in graph.values() if n['class_type'] == 'LayerMask: SegmentAnythingUltra V2')
        self.assertEqual(image['inputs']['image'], 'upload/photo.png')
        self.assertEqual(segment['inputs']['prompt'], 'person')
        with self.assertRaises(HTTPException):
            cutout.workflow('photo.png', 'auto-sdmatte', {}, 'workflow')

    def test_method_catalog_rejects_missing_or_incompatible_nodes(self):
        node = {'class_type': 'Example', 'inputs': {'model': 'missing'}}
        self.assertFalse(cutout._compatible_node(node, None))
        schema = {'input': {'required': {'model': [['installed']]}}}
        self.assertFalse(cutout._compatible_node(node, schema))
        node['inputs']['model'] = 'installed'
        self.assertTrue(cutout._compatible_node(node, schema))

    def test_encrypted_qwen_branch_is_inert_and_not_callable(self):
        import json
        from core.cutout_workflow import WORKFLOW_PATH, load_branch
        canvas = json.loads(WORKFLOW_PATH.read_text(encoding='utf-8'))
        spec = canvas['extra']['cutout']['pending_branches']['qwen-image-2.1']
        self.assertEqual(spec['status'], 'requires_decryption')
        with self.assertRaises(KeyError):
            load_branch('qwen-image-2.1')
        nodes = {n['id']: n for n in canvas['nodes']}
        members = [nodes[nid] for old, nid in spec['nodes'].items() if old != '7']
        self.assertTrue(all(n['mode'] == 2 for n in members))
        self.assertEqual(sum(n['type'] == 'RHHiddenNodes' for n in members), 2)
        for link_id, source, slot, target, socket, kind in canvas['links']:
            self.assertIn(link_id, nodes[source]['outputs'][slot]['links'])
            self.assertEqual(nodes[target]['inputs'][socket]['link'], link_id)

    def test_comfyui_widget_order_matches_installed_rmbg_schema(self):
        import json
        from core.cutout_workflow import WORKFLOW_PATH
        canvas = json.loads(WORKFLOW_PATH.read_text(encoding='utf-8'))
        expected = {
            'RMBG': ['model', 'sensitivity', 'process_res', 'mask_blur', 'mask_offset',
                     'invert_output', 'refine_foreground', 'unload_model', 'background', 'background_color'],
            'BiRefNetRMBG': ['model', 'sensitivity', 'mask_blur', 'mask_offset',
                           'invert_output', 'refine_foreground', 'unload_model', 'background', 'background_color'],
            'SAM3Segment': ['model_name', 'prompt', 'output_mode', 'confidence_threshold',
                            'max_segments', 'segment_pick', 'mask_blur', 'mask_offset', 'device',
                            'invert_output', 'unload_model', 'background', 'background_color'],
        }
        for node in canvas['nodes']:
            if node['type'] not in expected:
                continue
            names = node['properties']['widget_names']
            self.assertEqual(names, expected[node['type']])
            self.assertEqual(len(names), len(node['widgets_values']))
            self.assertEqual(node['widgets_values'][names.index('background')], 'Alpha')

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
        from core.cutout_workflow import load_branch
        expected = {'Lucida': 'BiRefNetRMBG', 'BiRefNet-general': 'BiRefNetRMBG',
                    'BiRefNet-HR-matting': 'BiRefNetRMBG', 'BiRefNet_toonout': 'BiRefNetRMBG',
                    'FeyNoBg': 'ArtCanvasFeyNoBg', 'SAM3': 'SAM3Segment'}
        for name, node_type in expected.items():
            graph = load_branch(name)
            self.assertEqual(graph['1']['class_type'], node_type)
            self.assertEqual(graph['1']['inputs']['background'], 'Alpha')
            self.assertEqual(graph['5']['inputs']['images'], ['1', 0])
        sam = load_branch('SAM3')
        self.assertEqual(sam['1']['inputs']['model_name'], 'sam3.1_multiplex_fp16')
        with self.assertRaises(HTTPException):
            cutout.workflow('x.png', 'SAM3', {'required': {'image': ['IMAGE']}}, 'SAM3Segment')

    def test_exported_workflows_are_registered(self):
        import os
        root = Path(__file__).parents[1]
        source = (root / 'main.py').read_text(encoding='utf-8')
        registration = source[source.index('BUILTIN_WORKFLOW_DIRS ='):source.index('\ndef update_env_values(')]
        namespace = {'os': os, 'BUILTIN_WORKFLOW_DIR': str(root / 'workflows')}
        exec(registration, namespace)
        exports = {str(path.relative_to(root / 'workflows')).replace('\\', '/') for path in (root / 'workflows' / 'cutout').glob('*.json') if not path.name.endswith('.config.json')}
        self.assertIn('cutout/matting.json', exports)
        self.assertTrue(exports <= namespace['BUILTIN_WORKFLOWS'])

    def test_integrated_branches_are_isolated_and_preserve_parameters(self):
        import json
        from core.cutout_workflow import load_branch, WORKFLOW_PATH
        canvas = json.loads(WORKFLOW_PATH.read_text(encoding='utf-8'))
        for branch in canvas['extra']['cutout']['branches']:
            graph = load_branch(branch)
            self.assertEqual(sum(n['class_type'] == 'SaveImage' for n in graph.values()), 1)
            self.assertEqual(sum(n['class_type'] == 'LoadImage' for n in graph.values()), 1)
            self.assertFalse(any(n['class_type'] == 'Note' for n in graph.values()))
            for node in graph.values():
                for value in node['inputs'].values():
                    if isinstance(value, list):
                        self.assertIn(value[0], graph)
        self.assertEqual(load_branch('RMBG-2.0')['1']['inputs']['model'], 'RMBG-2.0')
        self.assertEqual(load_branch('BiRefNet-general')['1']['class_type'], 'BiRefNetRMBG')
        self.assertEqual(load_branch('textmatting')['8']['inputs']['prompt'], 'person')
        self.assertEqual(load_branch('sdmatte')['54']['inputs']['ckpt_name'], 'SDMatte_plus.safetensors')
        # Changes to the managed canvas, including widget values, reach callers.
        with tempfile.TemporaryDirectory() as directory:
            spec = canvas['extra']['cutout']['branches']['BEN2']
            node = next(n for n in canvas['nodes'] if n['id'] == spec['nodes']['1'])
            node['widgets_values'][node['properties']['widget_names'].index('process_res')] = 2048
            path = Path(directory) / 'matting.json'
            path.write_text(json.dumps(canvas), encoding='utf-8')
            self.assertEqual(load_branch('BEN2', path)['1']['inputs']['process_res'], 2048)

    async def test_prepare_workflow_overrides_and_image_mask(self):
        main = types.SimpleNamespace(account_dirname=lambda: 'owner')
        with patch.dict(sys.modules, main=main):
            result = await cutout.prepare_workflow(cutout.WorkflowRequest(
                branch='sdmatte', params={'1': {'image': 'photo.png'}, '54': {'inference_size': 1536}},
                use_image_mask=True))
            graph = result['workflow']
            self.assertEqual(graph['1']['inputs']['image'], 'photo.png')
            self.assertEqual(graph['54']['inputs']['inference_size'], 1536)
            self.assertEqual(graph['73']['inputs']['masks'], ['1', 1])
            with self.assertRaises(HTTPException):
                await cutout.prepare_workflow(cutout.WorkflowRequest(branch='missing'))

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
        from core.feature_access import required_modules
        request = types.SimpleNamespace(url=types.SimpleNamespace(path='/api/image-cutout/task'))
        self.assertEqual(await required_modules(request), {'rmbg'})

    async def test_branch_loader_keeps_feature_permissions(self):
        from core.feature_access import required_modules
        async def body():
            return {'branch': 'textmatting'}
        request = types.SimpleNamespace(url=types.SimpleNamespace(path='/api/image-cutout/workflow'), json=body)
        self.assertEqual(await required_modules(request), {'textmatting'})


if __name__ == '__main__':
    unittest.main()
