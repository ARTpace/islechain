"""共享缓存的并发、过期与配置切换回归。"""
import asyncio
import os
import tempfile
import threading
from types import SimpleNamespace
import unittest

from tests.test_loading_performance import load_node


class RefreshPerformanceTests(unittest.TestCase):
    def test_lora_cache_single_flight_expiry_and_errors(self):
        async def check():
            clock = [0]
            calls = []
            result = {'items': [{'file_name': 'example'}], 'total': 1}
            async def upstream():
                calls.append(True)
                await asyncio.sleep(0)
                return result
            main = SimpleNamespace(COMFYUI_ADDRESS='first')
            context = dict(_main=main, _list_cache=None, _list_lock=asyncio.Lock(),
                           time=SimpleNamespace(monotonic=lambda: clock[0]), _fetch_lora_manager_list=upstream)
            route = load_node('routers/lora_manager.py', 'proxy_lora_manager_list', context)
            responses = await asyncio.gather(route(), route(), route())
            self.assertEqual(len(calls), 1)
            self.assertTrue(all(row == result for row in responses))
            clock[0] = 31
            await route()
            self.assertEqual(len(calls), 2)
            main.COMFYUI_ADDRESS = 'second'
            await route()
            self.assertEqual(len(calls), 3)
            clock[0] = 62
            result = {'items': [], 'error': 'upstream offline'}
            await route()
            await route()
            self.assertEqual(len(calls), 5, '失败不能进入成功缓存')
        asyncio.run(check())

    def test_health_single_flight_expiry_and_address_change(self):
        async def check():
            clock = [0]
            calls = []
            client_options = []
            class Client:
                def __init__(self, **kwargs):
                    client_options.append(kwargs)
                async def __aenter__(self):
                    return self
                async def __aexit__(self, *args):
                    pass
                async def get(self, url):
                    calls.append(url)
                    await asyncio.sleep(0)
                    return SimpleNamespace(status_code=200)
            ssl_context = object()
            context = dict(_comfy_health_cache=None, _comfy_health_lock=asyncio.Lock(), COMFY_HTTP_SSL_CONTEXT=ssl_context,
                           COMFYUI_INSTANCES=['first:8188'], httpx=SimpleNamespace(AsyncClient=Client),
                           time=SimpleNamespace(monotonic=lambda: clock[0]))
            health = load_node('main.py', 'get_comfyui_health', context)
            self.assertEqual(await asyncio.gather(health(), health()), [True, True])
            self.assertEqual(len(calls), 1)
            self.assertIs(client_options[0]['verify'], ssl_context)
            self.assertFalse(client_options[0]['trust_env'])
            clock[0] = 4
            await health()
            self.assertEqual(len(calls), 2)
            context['COMFYUI_INSTANCES'] = ['second:8188']
            await health()
            self.assertIn('second:8188', calls[-1])
            context['COMFYUI_INSTANCES'] = []
            self.assertFalse(await health())
        asyncio.run(check())

    def test_startup_file_reads_do_not_run_on_event_loop(self):
        from fastapi import FastAPI
        import httpx
        async def check():
            with tempfile.TemporaryDirectory() as directory:
                workers = []
                def library():
                    workers.append(threading.get_ident())
                    return {'items': []}
                main = SimpleNamespace(WORKFLOW_DIR=directory, BUILTIN_WORKFLOWS=[], load_asset_library=library)
                app = FastAPI()
                for file, name, path in [
                    ('routers/workflows.py', 'list_builtin_workflows', '/workflows'),
                    ('routers/asset_library.py', 'get_asset_library', '/assets')
                ]:
                    route = load_node(file, name, {'_main': main, 'os': os})
                    self.assertFalse(asyncio.iscoroutinefunction(route))
                    app.get(path)(route)
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
                    self.assertEqual((await client.get('/workflows')).json(), {'workflows': []})
                    self.assertEqual((await client.get('/assets')).json(), {'library': {'items': []}})
                self.assertNotEqual(workers[0], threading.get_ident())
        asyncio.run(check())


if __name__ == '__main__':
    unittest.main()
