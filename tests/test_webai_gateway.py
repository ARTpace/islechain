"""网关适配回归：模型类型、参考图限制、多图落盘输入，不调用真实平台。"""
import ast
import asyncio
from pathlib import Path
import re
import unittest

import httpx
from fastapi import HTTPException
from tools.webai_gateway import image_results, model_catalog, validate_generation_params, read_progress_stream
from tools.api_compat import api_root


class WebaiGatewayTests(unittest.TestCase):
    def test_parameter_sync_preserves_user_model_selection(self):
        from types import SimpleNamespace
        source = ast.parse(Path('routers/config.py').read_text(encoding='utf-8'))
        node = next(n for n in source.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'webai2api_status')
        node.decorator_list = []
        provider = {'id': 'webapi', 'base_url': 'http://localhost:3005',
                    'image_models': ['selected'], 'chat_models': ['chat'], 'video_models': [],
                    'model_labels': {'selected': 'My image'}}
        async def upstream(*args, **kwargs):
            if kwargs:
                self.assertEqual(kwargs, {'refresh': True, 'model': 'selected'})
            return {'image_models': ['selected', 'unselected'], 'chat_models': ['chat', 'extra-chat'],
                    'model_capabilities': {'selected': {'generation_params': {'status': 'ready'}}, 'unselected': {}}}
        saved = []
        context = {'Request': object, 'HTTPException': HTTPException, '_main': SimpleNamespace(
            get_api_provider=lambda _: provider, provider_protocol=lambda _: 'webai2api',
            get_provider_api_key=lambda _: 'test', fetch_models_from_upstream=upstream,
            load_api_providers=lambda: [provider], save_api_providers=lambda items: saved.append(items))}
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<sync>', 'exec'), context)
        result = asyncio.run(context['webai2api_status'](SimpleNamespace(method='GET'), 'webapi', refresh=True, model='selected'))
        self.assertTrue(result['online'])
        self.assertEqual(result['model_capabilities']['selected']['generation_params']['status'], 'ready')
        self.assertEqual(saved, [])
        self.assertNotIn('model_capabilities', provider)
        for _ in range(2):
            result = asyncio.run(context['webai2api_status'](SimpleNamespace(method='POST'), 'webapi'))
            self.assertEqual(result['image_models'], ['selected'])
            self.assertEqual(provider['chat_models'], ['chat'])
            self.assertEqual(provider['video_models'], [])
            self.assertNotIn('unselected', result['model_capabilities'])
            self.assertEqual(provider['model_labels'], {'selected': 'My image'})
        self.assertEqual(provider['model_capabilities']['selected']['generation_params']['status'], 'ready')
        self.assertEqual(len(saved), 2)

    def test_guest_can_read_parameters_but_cannot_change_providers(self):
        source = ast.parse(Path('core/lan_sharing.py').read_text(encoding='utf-8'))
        node = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == '_host_only')
        context = {}
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<permissions>', 'exec'), context)
        host_only = context['_host_only']
        self.assertFalse(host_only('/api/providers/webai2api/status', 'GET'))
        self.assertTrue(host_only('/api/providers/webai2api/sync', 'POST'))
        self.assertTrue(host_only('/api/providers', 'POST'))
        self.assertTrue(host_only('/api/providers/webapi', 'DELETE'))

    def test_closed_parameter_contract_and_channel_dependencies(self):
        schema = {'source': 'website', 'status': 'ready', 'max_reference_images': 2,
                  'params': [{'key': 'ratio', 'options': [{'value': 'auto'}]},
                             {'key': 'count', 'options': [{'value': 1}, {'value': 2}]}]}
        self.assertEqual(validate_generation_params(schema, {'ratio': 'auto', 'count': 2}), {'ratio': 'auto', 'count': 2})
        for values in [{'ratio': '16:9'}, {'size': '4K'}, {'count': 3}, {'count': '2'}, {'count': True}, {'unknown': 1}]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                validate_generation_params(schema, values)
        with self.assertRaises(ValueError):
            validate_generation_params(schema, {}, 3)
        with self.assertRaises(ValueError):
            validate_generation_params({**schema, 'status': 'unavailable'}, {})
        with self.assertRaises(ValueError):
            validate_generation_params({**schema, 'params': []}, {})
        child = {**schema, 'params': [{'key': 'provider', 'options': [{'value': 'official'}]}, {'key': 'ratio', 'options': [{'value': '1:1'}]}]}
        routes = {**schema, 'byProvider': {'official': child}}
        with self.assertRaises(ValueError):
            validate_generation_params(routes, {'provider': 'removed'})
        with self.assertRaises(ValueError):
            validate_generation_params(routes, {'provider': 'official', 'ratio': 'auto'})
        self.assertEqual(validate_generation_params(routes, {'provider': 'official', 'ratio': '1:1'})['ratio'], '1:1')

    def test_progress_stream_handles_real_events_errors_and_disconnects(self):
        events = []
        response = httpx.Response(200, text=':keepalive\n\ndata: {"object":"webai.progress","source":"website","stage":"running","progress":37}\n\ndata: {"choices":[{"delta":{"content":"https://a.test/image.png"}}]}\n\ndata: [DONE]\n\n')
        raw = asyncio.run(read_progress_stream(response, events.append))
        self.assertEqual(events[0]['progress'], 37)
        self.assertEqual(image_results(raw, 'http://localhost:3005')[0]['value'], 'https://a.test/image.png')
        for text in ['data: {"error":{"message":"网站任务失败"}}\n\n', 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']:
            with self.assertRaises(ValueError):
                asyncio.run(read_progress_stream(httpx.Response(200, text=text), events.append))

    def test_canvas_task_persists_reported_progress(self):
        from types import SimpleNamespace
        from threading import Lock
        source = ast.parse(Path('routers/canvas_tasks.py').read_text(encoding='utf-8'))
        node = next(n for n in source.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'run_canvas_image_task')
        task = {'id': 't', 'status': 'queued'}
        seen = []
        async def build(payload, username=None, on_progress=None):
            on_progress({'source': 'website', 'stage': 'running', 'progress': 37})
            seen.append(dict(task['progress']))
            on_progress({'source': 'local', 'stage': 'saving', 'progress': None})
            return {'images': ['saved.png']}
        context = {'_main': SimpleNamespace(CANVAS_TASK_LOCK=Lock(), CANVAS_TASKS={'t': task},
                    OnlineImageRequest=object, build_online_image_result=build), 'time': __import__('time')}
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<canvas-task>', 'exec'), context)
        asyncio.run(context['run_canvas_image_task']('t', object()))
        self.assertEqual(seen[0]['progress'], 37)
        self.assertEqual(task['progress']['stage'], 'saving')
        self.assertEqual(task['status'], 'succeeded')

    def test_chat_uses_saved_gateway_credentials(self):
        source = ast.parse(Path('main.py').read_text(encoding='utf-8'))
        node = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == 'resolve_chat_provider')
        context = dict(load_api_providers=lambda: [{'id': 'webai2api', 'base_url': 'http://localhost:3005/v1',
                                                   'chat_models': ['kimi_text/kimi']}],
                       get_provider_api_key=lambda _: 'test-key', sanitize_api_key=lambda key: key,
                       selected_model=lambda requested, fallback: requested or fallback, HTTPException=HTTPException, api_root=api_root)
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<chat-provider>', 'exec'), context)
        base, headers, model = context['resolve_chat_provider']('webai2api', '', '')
        self.assertEqual(base, 'http://localhost:3005/v1')
        self.assertEqual(model, 'kimi_text/kimi')
        self.assertEqual(headers['Authorization'], 'Bearer test-key')

    def test_explicit_model_types(self):
        data = model_catalog([{'id': 'seedream-5.0', 'type': 'image', 'image_policy': 'optional', 'owned_by': 'doubao'},
                              {'id': 'gemini-image-chat', 'type': 'text', 'image_policy': 'forbidden'}])
        self.assertEqual(data['seedream-5.0']['type'], 'image')
        self.assertEqual(data['gemini-image-chat']['type'], 'chat')
        self.assertEqual(data['seedream-5.0']['platform'], 'doubao')

    def test_image_formats_and_multiple_results(self):
        def extract(content):
            return image_results({'choices': [{'message': {'content': content}}]}, 'http://localhost:3005')
        self.assertEqual(extract('![one](https://a.test/1.png)\n![two](/images/2.png)'),
                         [{'type': 'url', 'value': 'https://a.test/1.png'}, {'type': 'url', 'value': 'http://localhost:3005/images/2.png'}])
        self.assertEqual(extract('data:image/png;base64,YQ==')[0], {'type': 'b64', 'value': 'YQ=='})
        self.assertEqual(len(extract('https://a.test/1.png\nhttps://a.test/2.png')), 2)
        self.assertEqual(extract('请登录账号'), [])

    def test_request_and_reference_policy(self):
        source = ast.parse(Path('main.py').read_text(encoding='utf-8'))
        node = next(n for n in source.body if isinstance(n, ast.AsyncFunctionDef) and n.name == '_gen_webai2api')
        calls = []
        upstream_schema = None
        class Client:
            from contextlib import asynccontextmanager
            @asynccontextmanager
            async def stream(self, method, url, **kwargs):
                self.test_body = kwargs['json']
                calls.append((url, kwargs))
                assert self.test_body['stream'] and self.test_body['progress']
                yield httpx.Response(200, request=httpx.Request(method, url), text='data: {"object":"webai.progress","source":"website","stage":"running","progress":42}\n\ndata: {"choices":[{"delta":{"content":"https://a.test/stream.png"}}]}\n\ndata: [DONE]\n\n')
            async def get(self, url, **kwargs):
                return httpx.Response(200, request=httpx.Request('GET', url), json={'data': [
                    {'id': 'test', **provider['model_capabilities']['test'], **({'generation_params': upstream_schema} if upstream_schema else {})}]})
            async def post(self, url, **kwargs):
                calls.append((url, kwargs))
                return httpx.Response(200, request=httpx.Request('POST', url), json={
                    'choices': [{'message': {'content': '![image](https://a.test/1.png)'}}]})
        context = dict(re=re, httpx=httpx, HTTPException=HTTPException,
                       reference_to_data_url=lambda ref: ref['url'], _openai_headers=lambda *args: {})
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<webai>', 'exec'), context)
        provider = {'base_url': 'http://localhost:3005', 'api_key': 'test',
                    'model_capabilities': {'test': {'image_policy': 'forbidden'}}}
        fn = context['_gen_webai2api']
        with self.assertRaises(HTTPException):
            asyncio.run(fn(Client(), provider, 'test', 'prompt', '1024x1024', [{'url': 'data:image/png;base64,YQ=='}]))
        self.assertEqual(calls, [])
        image, raw = asyncio.run(fn(Client(), provider, 'test', 'prompt', '1536x1024', []))
        self.assertEqual(calls[0][0], 'http://localhost:3005/v1/chat/completions')
        self.assertEqual(calls[0][1]['json']['ratio'], '3:2')
        self.assertEqual(image, raw['_webai_images'][0])
        schema = {'source': 'website', 'status': 'ready', 'max_reference_images': 8, 'params': [{'key': 'ratio', 'options': ['auto', '1:1']},
                             {'key': 'size', 'options': ['1K', '2K', '4K']}]}
        provider['model_capabilities']['test']['generation_params'] = schema
        asyncio.run(fn(Client(), provider, 'test', 'prompt', '4096x4096', [], {'ratio': 'auto', 'size': '4K'}))
        self.assertEqual(calls[-1][1]['json']['params'], {'ratio': 'auto', 'size': '4K'})
        asyncio.run(fn(Client(), provider, 'test', 'prompt', '8192x8192', []))
        self.assertNotIn('size', calls[-1][1]['json'])
        self.assertNotIn('ratio', calls[-1][1]['json'])
        schema['params'] += [{'key': 'count', 'options': [3]}, {'key': 'quality', 'options': ['high']}]
        asyncio.run(fn(Client(), provider, 'test', 'prompt', '1024x1024', [], {'count': 3, 'quality': 'high'}))
        self.assertEqual(calls[-1][1]['json']['params'], {'count': 3, 'quality': 'high'})
        self.assertEqual(calls[-1][1]['json']['n'], 3)

        schema['params'] = [{'key': 'ratio', 'options': ['auto']}]
        asyncio.run(fn(Client(), provider, 'test', 'prompt', '1024x1024', [], {'ratio': 'auto'}))
        self.assertNotIn('size', calls[-1][1]['json']['params'])
        with self.assertRaises(HTTPException):
            asyncio.run(fn(Client(), provider, 'test', 'prompt', '1024x1024', [], {'ratio': '1:1'}))
        self.assertEqual(model_catalog([{'id': 'test', 'generation_params': schema}])['test']['generation_params'], schema)
        upstream_schema = {**schema, 'params': [{'key': 'ratio', 'options': ['auto']}]}
        before = len(calls)
        with self.assertRaises(HTTPException):
            asyncio.run(fn(Client(), provider, 'test', 'prompt', '1024x1024', [], {'size': '4K'}))
        self.assertEqual(len(calls), before, '旧参数在真实提交前被拦截')
        progress = []
        image, raw = asyncio.run(fn(Client(), provider, 'test', 'prompt', '1024x1024', [], {'ratio': 'auto'}, progress.append))
        self.assertEqual(image['value'], 'https://a.test/stream.png')
        self.assertEqual(progress[0]['progress'], 42)





if __name__ == '__main__':
    unittest.main()
