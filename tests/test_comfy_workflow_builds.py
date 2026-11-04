import asyncio
import copy
import importlib
import io
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from PIL import Image

from core.canvas_agent import run_model
from core.comfy_node_index import NodeIndex
from core.comfy_workflow_builds import ComfyBuilds, pinned_instance
from core.comfy_workflow_validation import validate_build

INFO = {
    'EmptyImage': {'input': {'required': {'width': ['INT', {'min': 1, 'max': 4096}],
                                        'height': ['INT', {'min': 1, 'max': 4096}],
                                        'batch_size': ['INT', {'min': 1, 'max': 8}], 'color': ['INT', {}]}},
                   'output': ['IMAGE'], 'output_node': False},
    'SaveImage': {'input': {'required': {'images': ['IMAGE'], 'filename_prefix': ['STRING']}},
                  'output': [], 'output_node': True},
}


def candidate():
    return {'title': '图片输出测试', 'workflow': {
        '1': {'class_type': 'EmptyImage', 'inputs': {'width': 64, 'height': 64, 'batch_size': 1, 'color': 0}},
        '2': {'class_type': 'SaveImage', 'inputs': {'images': ['1', 0], 'filename_prefix': 'ArtCanvas-tests/sdk'}},
    }, 'fields': [{'id': 'width', 'name': '宽度', 'node': '1', 'input': 'width', 'type': 'number',
                   'default': 64, 'min': 1, 'max': 4096}]}


def png():
    stream = io.BytesIO()
    Image.new('RGB', (64, 64), 'red').save(stream, format='PNG')
    return stream.getvalue()


class GraphTests(unittest.TestCase):
    def test_combo_schema_validates_constants_and_dropdowns(self):
        for schema in ([['normal', 'multiply']], ['COMBO', {'options': ['normal', 'multiply'], 'multiselect': False}]):
            info = copy.deepcopy(INFO)
            info['EmptyImage']['input']['optional'] = {'mode': schema}
            value = candidate()
            value['workflow']['1']['inputs']['mode'] = 'normal'
            value['fields'].append({'id': 'mode', 'name': '模式', 'node': '1', 'input': 'mode',
                                    'type': 'dropdown', 'default': 'normal', 'options': ['normal', 'multiply']})
            validate_build(value, info)
            value['fields'][-1]['default'] = 'missing'
            with self.assertRaisesRegex(ValueError, '枚举'):
                validate_build(value, info)

    def test_streamed_index_handles_utf8_escaped_keys_and_braces_in_values(self):
        data = json.dumps({'中文节点': {'description': 'quote " and braces {} []', 'input': {'a': ['STRING']}},
                           'quoted"name': {}, 'SaveImage': {}}, ensure_ascii=False).encode()
        parser = NodeIndex()
        for char in data:
            parser.feed(bytes([char]))
        self.assertEqual(parser.feed(b'', final=True), ['中文节点', 'quoted"name', 'SaveImage'])
        self.assertLess(len(parser.key), 512)

    def test_real_schema_fields_and_defaults(self):
        value = candidate()
        value['fields'][0]['default'] = 128
        normalized, fingerprint = validate_build(value, INFO)
        self.assertEqual(normalized['workflow']['1']['inputs']['width'], 128)
        self.assertEqual(len(fingerprint), 64)
        self.assertTrue(normalized['fields'][0]['standalone'])

    def test_rejects_missing_plugins_invalid_links_types_and_fields(self):
        cases = []
        value = candidate()
        value['workflow']['1']['class_type'] = 'MissingPlugin'
        cases.append(value)
        value = candidate()
        value['workflow']['2']['inputs']['images'] = ['missing', 0]
        cases.append(value)
        value = candidate()
        value['workflow']['2']['inputs']['images'] = ['1', 5]
        cases.append(value)
        value = candidate()
        value['workflow']['2']['inputs']['filename_prefix'] = ['1', 0]
        cases.append(value)
        value = candidate()
        value['workflow']['1']['inputs']['width'] = True
        cases.append(value)
        value = candidate()
        del value['workflow']['1']['inputs']['height']
        cases.append(value)
        value = candidate()
        value['fields'][0]['type'] = 'text'
        cases.append(value)
        value = candidate()
        value['fields'][0]['input'] = 'missing'
        cases.append(value)
        value = candidate()
        value['fields'].append(copy.deepcopy(value['fields'][0]))
        cases.append(value)
        for value in cases:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_build(value, INFO)

    def test_cycle_is_rejected(self):
        info = copy.deepcopy(INFO)
        info['EmptyImage']['input']['required']['source'] = ['IMAGE']
        value = candidate()
        value['workflow']['1']['inputs']['source'] = ['2', 0]
        info['SaveImage']['output'] = ['IMAGE']
        with self.assertRaisesRegex(ValueError, '循环'):
            validate_build(value, info)

    def test_numeric_controls_and_model_choices_match_backend(self):
        value = candidate()
        value['fields'][0]['max'] = 8192
        with self.assertRaisesRegex(ValueError, '控件范围'):
            validate_build(value, INFO)
        value = candidate()
        value['fields'][0]['step'] = 0.5
        with self.assertRaisesRegex(ValueError, '整数'):
            validate_build(value, INFO)
        value = candidate()
        info = copy.deepcopy(INFO)
        info['EmptyImage']['input']['optional'] = {'model': [['installed.safetensors']]}
        value['workflow']['1']['inputs']['model'] = 'missing.safetensors'
        with self.assertRaisesRegex(ValueError, '模型'):
            validate_build(value, info)


class BuildTests(unittest.IsolatedAsyncioTestCase):
    async def test_repairs_require_failure_changes_and_share_three_attempt_budget(self):
        first = await self.service.create(candidate())
        with self.assertRaises(ValueError):
            await self.service.create(candidate(), repair_parent=first['id'], hypothesis='尚无失败证据')
        root = self.service.read(first['id'])
        root['status'], root['error'] = 'failed', '真实测试报告：尺寸不匹配'
        self.service.save(root)
        with self.assertRaises(ValueError):
            await self.service.create(candidate(), repair_parent=first['id'], hypothesis='不改图重复运行')
        for attempt in range(3):
            value = candidate()
            value['fields'][0]['default'] = 128 + attempt * 64
            repaired = await self.service.create(value, repair_parent=first['id'], hypothesis='根据尺寸错误调整宽度')
            detail = self.service.read_candidate(repaired['id'])
            self.assertEqual(detail['repair']['repairAttempt'], attempt + 1)
            self.assertEqual(detail['remainingRepairs'], 2 - attempt)
            self.assertEqual(detail['repair']['sourceError'], root['error'])
        value = candidate()
        value['fields'][0]['default'] = 512
        with self.assertRaisesRegex(ValueError, '3 次'):
            await self.service.create(value, repair_parent=first['id'], hypothesis='超过预算')
        self.assertEqual(self.service.read(first['id'])['candidate']['fields'][0]['default'], 64)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.service = ComfyBuilds(Path(self.temp.name) / 'builds', Path(self.temp.name) / 'workflows',
                                   'owner', 'canvas-1', '127.0.0.1:8188', timeout=10)
        self.requests = []

        async def request(method, path, **kwargs):
            self.requests.append((method, path, kwargs))
            if path.startswith('/object_info/'):
                kind = path.removeprefix('/object_info/')
                return {kind: copy.deepcopy(INFO[kind])} if kind in INFO else {}
            if path == '/prompt':
                return {'prompt_id': 'prompt-1', 'node_errors': {}}
            if path.startswith('/history/'):
                return {'prompt-1': {'status': {'completed': True, 'status_str': 'success'},
                                     'outputs': {'2': {'images': [{'filename': 'test.png', 'type': 'output'}]}}}}
            if path == '/view':
                return png()
            if path == '/queue':
                return {}
            raise AssertionError(path)

        self.request = request
        self.service.request = AsyncMock(side_effect=request)

    async def complete(self):
        draft = await self.service.create(candidate())
        await self.service.start(draft['id'])
        return await self.service.get(draft['id'], 8)

    def test_templates_are_reusable_but_paths_and_credentials_are_not_exposed(self):
        root = self.service.workflow_root
        root.mkdir(parents=True)
        path = root / 'image.json'
        path.write_text(json.dumps(candidate()['workflow']), encoding='utf-8')
        (root / 'image.config.json').write_text('{}', encoding='utf-8')
        self.assertEqual(self.service.templates()['templates'], ['image.json'])
        self.assertEqual(self.service.templates('image.json')['workflow']['1']['class_type'], 'EmptyImage')
        with self.assertRaises(ValueError):
            self.service.templates('../outside.json')
        private = candidate()['workflow']
        private['1']['inputs']['api_key'] = 'secret-value'
        path.write_text(json.dumps(private), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, '凭据'):
            self.service.templates('image.json')

    async def test_create_test_publish_and_pin_without_duplicate_submits(self):
        draft = await self.service.create(candidate())
        self.assertEqual((await self.service.create(candidate()))['id'], draft['id'])
        with self.assertRaises(ValueError):
            await self.service.publish(draft['id'], draft['revision'])
        await self.service.start(draft['id'])
        await self.service.start(draft['id'])
        tested = await self.service.get(draft['id'], 8)
        self.assertEqual(tested['status'], 'succeeded', tested)
        self.assertEqual(tested['report']['outputs'][0]['width'], 64)
        self.assertEqual(sum(path == '/prompt' for _, path, _ in self.requests), 1)
        published = await self.service.publish(tested['id'], tested['revision'])
        self.assertTrue((self.service.workflow_root / published['workflowName']).exists())
        self.assertEqual(pinned_instance(self.service.workflow_root, published['workflowName'], ['127.0.0.1:8188']), '127.0.0.1:8188')
        with self.assertRaises(ValueError):
            pinned_instance(self.service.workflow_root, published['workflowName'], ['other:8188'])
        self.assertIsNone(pinned_instance(self.service.workflow_root, 'custom/old.json', []))
        self.assertIsNone(pinned_instance(self.service.workflow_root, 'custom/ai-user-workflow.json', []))
        self.assertEqual((await self.service.publish(tested['id'], tested['revision']))['workflowName'], published['workflowName'])

    async def test_cross_canvas_owner_and_environment_changes_are_rejected(self):
        done = await self.complete()
        other = ComfyBuilds(Path(self.temp.name) / 'builds', self.service.workflow_root, 'owner', 'canvas-2', self.service.target)
        with self.assertRaises(ValueError):
            other.read(done['id'])
        other = ComfyBuilds(Path(self.temp.name) / 'builds', self.service.workflow_root, 'other', 'canvas-1', self.service.target)
        with self.assertRaises(ValueError):
            other.read(done['id'])
        changed = copy.deepcopy(INFO)
        changed['EmptyImage']['input']['required']['width'][1]['max'] = 8192
        self.service.request = AsyncMock(return_value=changed)
        with self.assertRaisesRegex(ValueError, '变化'):
            await self.service.publish(done['id'], done['revision'])

    async def test_restart_resumes_history_without_submitting_again(self):
        draft = await self.service.create(candidate())
        record = self.service.read(draft['id'])
        record.update(status='running', promptId='prompt-1', startedAt=time.time())
        self.service.save(record)
        restored = await self.service.get(draft['id'], 8)
        self.assertEqual(restored['status'], 'succeeded')
        self.assertFalse(any(path == '/prompt' for _, path, _ in self.requests))

    async def test_uncertain_submission_is_not_retried(self):
        async def fail(method, path, **kwargs):
            if path == '/prompt':
                raise ValueError('连接中断')
            return await self.request(method, path, **kwargs)

        self.service.request = AsyncMock(side_effect=fail)
        draft = await self.service.create(candidate())
        await self.service.start(draft['id'])
        result = await self.service.get(draft['id'], 8)
        self.assertEqual(result['status'], 'uncertain')
        self.assertEqual((await self.service.start(draft['id']))['status'], 'uncertain')

    async def test_cancel_during_submission_preserves_cancel_and_never_interrupts_other_tasks(self):
        submitted, release = asyncio.Event(), asyncio.Event()

        async def delayed(method, path, **kwargs):
            if path == '/prompt':
                submitted.set()
                await release.wait()
            return await self.request(method, path, **kwargs)

        self.service.request = AsyncMock(side_effect=delayed)
        draft = await self.service.create(candidate())
        await self.service.start(draft['id'])
        await asyncio.wait_for(submitted.wait(), 2)
        await self.service.cancel(draft['id'])
        release.set()
        result = await self.service.get(draft['id'], 8)
        self.assertEqual(result['status'], 'cancelled')
        self.assertEqual(result['promptId'], 'prompt-1')
        self.assertTrue(any(path == '/queue' for _, path, _ in self.requests))
        self.assertFalse(any(path == '/interrupt' for _, path, _ in self.requests))

    async def test_invalid_output_and_backend_errors_cannot_publish(self):
        original = self.request

        async def bad_image(method, path, **kwargs):
            return b'not an image' if path == '/view' else await original(method, path, **kwargs)

        self.service.request = AsyncMock(side_effect=bad_image)
        result = await self.complete()
        self.assertEqual(result['status'], 'failed')
        with self.assertRaises(ValueError):
            await self.service.publish(result['id'], result['revision'])

    async def test_uncovered_output_branch_cannot_pass(self):
        value = candidate()
        value['workflow']['3'] = copy.deepcopy(value['workflow']['2'])
        draft = await self.service.create(value)
        await self.service.start(draft['id'])
        result = await self.service.get(draft['id'], 8)
        self.assertEqual(result['status'], 'failed')
        self.assertIn('部分输出', result['error'])

    async def test_partial_backend_validation_errors_delete_only_own_queued_task(self):
        original = self.request

        async def partial(method, path, **kwargs):
            if path == '/prompt':
                return {'prompt_id': 'prompt-1', 'node_errors': {'3': {'errors': ['invalid custom input']}}}
            return await original(method, path, **kwargs)

        self.service.request = AsyncMock(side_effect=partial)
        draft = await self.service.create(candidate())
        await self.service.start(draft['id'])
        result = await self.service.get(draft['id'], 8)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['promptId'], 'prompt-1')
        self.assertTrue(any(path == '/queue' and kw['value']['delete'] == ['prompt-1'] for _, path, kw in self.requests))
        self.assertFalse(any(path == '/interrupt' for _, path, _ in self.requests))

    async def test_model_tools_return_only_tested_comfy_node_candidates(self):
        calls = []
        draft = await self.service.create(candidate())

        def handler(request):
            calls.append(json.loads(request.content))
            tools = [('comfy_start_test', {'build_id': draft['id']}),
                     ('comfy_get_build', {'build_id': draft['id'], 'wait_seconds': 8}),
                     ('comfy_propose_node', {'build_id': draft['id']})]
            message = {'role': 'assistant', 'content': '测试通过，请采用节点'}
            if len(calls) <= len(tools):
                name, arguments = tools[len(calls) - 1]
                message = {'role': 'assistant', 'content': None, 'tool_calls': [{'id': str(len(calls)), 'type': 'function',
                           'function': {'name': name, 'arguments': json.dumps(arguments)}}]}
            return httpx.Response(200, json={'choices': [{'message': message}]})

        original = httpx.AsyncClient
        with patch('core.canvas_agent.httpx.AsyncClient', side_effect=lambda **kw: original(transport=httpx.MockTransport(handler), **kw)):
            result = await run_model('https://model.test/v1', {}, 'test', [], [], snapshot={'nodes': [], 'connections': []}, comfy=self.service)
        self.assertEqual(result['proposal']['nodes'][0]['type'], 'comfy')
        self.assertEqual(result['proposal']['nodes'][0]['fields']['comfyBuildId'], draft['id'])
        self.assertFalse(any(self.service.workflow_root.rglob('*.json')), 'proposal does not publish until adopted')

    async def test_http_build_list_and_publish_require_a_passed_revision(self):
        routes = importlib.import_module('routers.mcp_tools')
        app = FastAPI()
        app.include_router(routes.router)
        app.dependency_overrides[routes.local_request] = lambda: None
        draft = await self.service.create(candidate())
        with patch.object(routes, 'comfy_context', return_value=self.service):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1') as client:
                listed = await client.get('/api/mcp/comfy-builds', params={'canvas_id': 'canvas-1'})
                self.assertEqual(listed.json()['builds'][0]['id'], draft['id'])
                request = {'action': 'publish', 'canvasId': 'canvas-1', 'buildId': draft['id'], 'revision': draft['revision']}
                self.assertEqual((await client.post('/api/mcp/comfy-builds', json=request)).status_code, 400)
                await self.service.start(draft['id'])
                await self.service.get(draft['id'], 8)
                published = await client.post('/api/mcp/comfy-builds', json=request)
                self.assertEqual(published.status_code, 200, published.text)
                self.assertTrue(published.json()['workflowName'].startswith('custom/ai-'))


class LiveComfyTests(unittest.IsolatedAsyncioTestCase):
    @unittest.skipUnless(os.environ.get('ART_CANVAS_TEST_COMFY'), 'opt-in real local ComfyUI test')
    async def test_real_branched_processing_graph(self):
        with tempfile.TemporaryDirectory() as directory:
            service = ComfyBuilds(Path(directory) / 'builds', Path(directory) / 'workflows', 'test-owner',
                                  'test-canvas', os.environ['ART_CANVAS_TEST_COMFY'], timeout=60)
            queue = await service.request('GET', '/queue')
            if queue.get('queue_running') or queue.get('queue_pending'):
                self.skipTest('ComfyUI busy; do not interfere with existing tasks')
            image = {'class_type': 'EmptyImage', 'inputs': {'width': 64, 'height': 64, 'batch_size': 1, 'color': 16777215}}
            scale = {'class_type': 'ImageScale', 'inputs': {'image': ['2', 0], 'upscale_method': 'bilinear',
                                                          'width': 128, 'height': 96, 'crop': 'disabled'}}
            graph = {'1': image, '2': {'class_type': 'ImageInvert', 'inputs': {'image': ['1', 0]}},
                     '3': scale, '4': {**copy.deepcopy(scale), 'inputs': {**scale['inputs'], 'image': ['1', 0]}},
                     '5': {'class_type': 'ImageBlend', 'inputs': {'image1': ['3', 0], 'image2': ['4', 0],
                                                               'blend_factor': 0.5, 'blend_mode': 'normal'}},
                     '6': {'class_type': 'SaveImage', 'inputs': {'images': ['5', 0], 'filename_prefix': 'ArtCanvas-tests/branched-mix'}},
                     '7': {'class_type': 'SaveImage', 'inputs': {'images': ['4', 0], 'filename_prefix': 'ArtCanvas-tests/branched-source'}}}
            created = await service.create({'title': '分支图像处理验证', 'workflow': graph, 'fields': []})
            await service.start(created['id'])
            async with asyncio.timeout(65):
                while True:
                    result = await service.get(created['id'], 8)
                    if result['status'] not in ('queued', 'submitting', 'running'):
                        break
            self.assertEqual(result['status'], 'succeeded', result)
            outputs = result['report']['outputs']
            self.assertEqual({item['node'] for item in outputs}, {'6', '7'})
            self.assertTrue(all((item['width'], item['height']) == (128, 96) for item in outputs))

    @unittest.skipUnless(os.environ.get('ART_CANVAS_TEST_COMFY'), 'opt-in real local ComfyUI test')
    async def test_real_image_graph_decode_and_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            service = ComfyBuilds(Path(directory) / 'builds', Path(directory) / 'workflows', 'test-owner',
                                  'test-canvas', os.environ['ART_CANVAS_TEST_COMFY'], timeout=60)
            queue = await service.request('GET', '/queue')
            if queue.get('queue_running') or queue.get('queue_pending'):
                self.skipTest('ComfyUI busy; do not interfere with existing tasks')
            draft = await service.create(candidate())
            await service.start(draft['id'])
            async with asyncio.timeout(65):
                while True:
                    result = await service.get(draft['id'], 8)
                    if result['status'] not in ('queued', 'submitting', 'running'):
                        break
            self.assertEqual(result['status'], 'succeeded', result)
            self.assertEqual(result['report']['outputs'][0]['width'], 64)
            published = await service.publish(draft['id'], draft['revision'])
            self.assertEqual(published['params']['width'], 64)


if __name__ == '__main__':
    unittest.main()
