"""Exercise the real canvas LLM route without contacting an AI provider."""
import importlib
import json
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI

import main


class CanvasLLMTests(unittest.IsolatedAsyncioTestCase):
    async def test_text_and_reference_requests_reach_upstream(self):
        route = importlib.import_module('routers.canvas_tasks')
        app = FastAPI()
        app.include_router(route.router)
        real_client = httpx.AsyncClient
        requests = []

        def upstream(request):
            requests.append(json.loads(request.content))
            return httpx.Response(200, json={'choices': [{'message': {'content': 'plan'}}]})

        def fake_client(**kwargs):
            return real_client(transport=httpx.MockTransport(upstream))

        async with real_client(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            with patch.object(main, 'resolve_chat_provider', return_value=('https://fixture.invalid', {}, 'test-model')), patch.object(route.httpx, 'AsyncClient', side_effect=fake_client):
                for extra in ({}, {'images': ['data:image/png;base64,AA=='], 'videos': ['/output/sample.mp4']}):
                    response = await client.post('/api/canvas-llm', json={'message': 'material', **extra})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()['text'], 'plan')
        self.assertEqual(requests[0]['messages'][-1]['content'], 'material')
        content = requests[1]['messages'][-1]['content']
        self.assertEqual(content[1]['image_url']['url'], 'data:image/png;base64,AA==')
        self.assertIn('sample.mp4', content[0]['text'])


if __name__ == '__main__':
    unittest.main()
