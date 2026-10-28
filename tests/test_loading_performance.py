"""页面资源重校验和目录扫描线程隔离，不启动真实主服务。"""
import ast
import asyncio
import os
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest

from fastapi import FastAPI, HTTPException
import httpx
from starlette.staticfiles import StaticFiles


def load_node(file, name, context):
    tree = ast.parse(Path(file).read_text(encoding='utf-8'))
    node = next(node for node in tree.body if getattr(node, 'name', '') == name)
    if hasattr(node, 'decorator_list'):
        node.decorator_list = []
    exec(compile(ast.Module(body=[node], type_ignores=[]), file, 'exec'), context)
    return context[name]


class LoadingPerformanceTests(unittest.TestCase):
    def test_static_revalidation_and_changed_file(self):
        static = load_node('main.py', 'NoCacheStaticFiles', {'StarletteStaticFiles': StaticFiles})
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / 'app.js'
            script.write_text('first', encoding='utf-8')
            (Path(directory) / 'index.html').write_text('page', encoding='utf-8')
            app = FastAPI()
            app.mount('/static', static(directory=directory))

            async def check():
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
                    first = await client.get('/static/app.js')
                    self.assertEqual(first.headers['cache-control'], 'no-cache')
                    headers = {'If-None-Match': first.headers['etag']}
                    cached = await client.get('/static/app.js', headers=headers)
                    self.assertEqual(cached.status_code, 304)
                    self.assertEqual(cached.content, b'')
                    script.write_text('changed script', encoding='utf-8')
                    changed = await client.get('/static/app.js', headers=headers)
                    self.assertEqual(changed.status_code, 200)
                    self.assertEqual(changed.text, 'changed script')
                    page = await client.get('/static/index.html')
                    self.assertEqual(page.headers['cache-control'], 'no-store')
            asyncio.run(check())

    def test_lora_scan_runs_outside_event_loop(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'models' / 'loras'
            folder.mkdir(parents=True)
            (folder / 'example_v2.safetensors').write_bytes(b'model')
            (folder / 'example_v2.preview.png').write_bytes(b'preview')
            threads = []

            def walk(path):
                threads.append(threading.get_ident())
                return os.walk(path)

            context = {'HTTPException': HTTPException,
                       '_main': SimpleNamespace(COMFYUI_BASE_PATH=directory),
                       'os': SimpleNamespace(path=os.path, walk=walk)}
            scan = load_node('routers/lora_scan.py', 'scan_lora_folder', context)
            app = FastAPI()
            app.get('/scan')(scan)

            async def check():
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
                    response = await client.get('/scan')
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()['count'], 1)
                    self.assertEqual(response.json()['entries'][0]['versionLabel'], 'v2')
                    self.assertNotEqual(threads[0], threading.get_ident())
            asyncio.run(check())


if __name__ == '__main__':
    unittest.main()
