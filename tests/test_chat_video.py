"""Video submit/poll/persistence tests; no real provider requests or paid generation."""
import ast
import asyncio
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException
from core.video_generation import generate_openai_video, video_size


class VideoApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_submit_once_poll_and_download_with_reference(self):
        calls = []
        def handle(request):
            calls.append(request)
            if request.method == 'POST':
                return httpx.Response(200, json={'id': 'job', 'status': 'queued'})
            if request.url.path.endswith('/content'):
                return httpx.Response(200, content=b'fake-video', headers={'Content-Type': 'video/mp4'})
            return httpx.Response(200, json={'id': 'job', 'status': 'completed'})
        factory = httpx.AsyncClient
        provider = {'base_url': 'https://provider.test', 'api_key': 'test'}
        payload = SimpleNamespace(model='video-model', prompt='cat running', duration=8, size='', aspect_ratio='9:16', resolution='720p')
        progress = []
        with patch('core.video_generation.httpx.AsyncClient', lambda **kw: factory(transport=httpx.MockTransport(handle), **kw)), patch('core.video_generation.asyncio.sleep', AsyncMock()):
            result = await generate_openai_video(provider, payload, ('ref.png', b'image', 'image/png'), progress.append)
        self.assertEqual(result['content'], b'fake-video')
        self.assertEqual(sum(r.method == 'POST' for r in calls), 1)
        self.assertEqual(str(calls[0].url), 'https://provider.test/v1/videos')
        self.assertIn(b'name="input_reference"', calls[0].content)
        self.assertIn(b'720x1280', calls[0].content)
        self.assertEqual(progress[-1]['stage'], 'completed')

    async def test_failure_does_not_resubmit(self):
        calls=[]
        def handle(request):
            calls.append(request)
            return httpx.Response(200,json={'id':'j','status':'failed','error':{'message':'quota exceeded'}})
        factory=httpx.AsyncClient
        with patch('core.video_generation.httpx.AsyncClient',lambda **kw:factory(transport=httpx.MockTransport(handle),**kw)):
            with self.assertRaisesRegex(HTTPException,'quota exceeded'):
                await generate_openai_video({'base_url':'https://test/v1','api_key':'test'},SimpleNamespace(model='m',prompt='p',duration=5,size='',aspect_ratio='16:9',resolution='720p'))
        self.assertEqual(len(calls),1)

    def test_sizes(self):
        self.assertEqual(video_size('16:9','1080p'),'1920x1080')
        self.assertEqual(video_size('9:16','720p'),'720x1280')


def load_functions(path, names, scope):
    source=ast.parse(Path(path).read_text(encoding='utf-8'))
    nodes=[n for n in source.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in names]
    for node in nodes: node.decorator_list=[]
    exec(compile(ast.Module(body=nodes,type_ignores=[]),path,'exec'),scope)
    return scope


class VideoTaskTests(unittest.IsolatedAsyncioTestCase):
    async def test_task_owner_and_persistence(self):
        calls=[]
        main=SimpleNamespace(CANVAS_TASK_LOCK=threading.Lock(),CANVAS_TASKS={'j':{'owner':'alice','type':'video'}},
            require_valid_token=lambda token:token,finish_chat_generation=lambda *a,**kw:calls.append((a,kw)))
        scope=load_functions('routers/online_gen.py',{'run_chat_video_task','get_chat_video_task'},dict(_main=main,time=time,HTTPException=HTTPException,build_canvas_video_result=AsyncMock(return_value={'videos':['/output/a.mp4']})))
        payload=SimpleNamespace(conversation_id='c',message_id='m')
        await scope['run_chat_video_task']('j',payload,'alice','alice-dir')
        self.assertEqual(main.CANVAS_TASKS['j']['status'],'succeeded')
        self.assertEqual(calls[0][1]['videos'],['/output/a.mp4'])
        with self.assertRaises(HTTPException) as caught:
            await scope['get_chat_video_task']('j','bob')
        self.assertEqual(caught.exception.status_code,403)
        scope['build_canvas_video_result']=AsyncMock(side_effect=HTTPException(502,'provider failed'))
        await scope['run_chat_video_task']('j',payload,'alice','alice-dir')
        self.assertEqual(main.CANVAS_TASKS['j']['status'],'failed')
        self.assertEqual(calls[-1][1]['error'],'provider failed')

    def test_finish_keeps_image_and_video_urls_separate(self):
        conversation={'messages':[{'id':'m','image_urls':['/output/image.png'],'pending_generation':{}}]}
        saved=[]
        scope=load_functions('main.py',{'finish_chat_generation'},dict(account_dirname=lambda:'alice',load_conversation=lambda *a:conversation,save_conversation=lambda *a:saved.append(a),now_ms=lambda:1))
        scope['finish_chat_generation']('c','m',videos=['/output/video.mp4'],user_id='alice')
        message=conversation['messages'][0]
        self.assertEqual(message['image_urls'],['/output/image.png'])
        self.assertEqual(message['video_urls'],['/output/video.mp4'])
        self.assertNotIn('pending_generation',message)
        self.assertEqual(len(saved),1)


if __name__=='__main__': unittest.main()
