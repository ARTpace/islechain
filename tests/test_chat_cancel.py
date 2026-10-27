"""任务取消的隔离验证，不连接真实 ComfyUI。"""
import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
import unittest


class CancelTaskTests(unittest.TestCase):
    def run_cancel(self, queue, payload):
        calls = []
        class Response:
            def raise_for_status(self): pass
            def json(self): return queue
        class Client:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def get(self, url): return Response()
            async def post(self, url, json):
                calls.append((url, json))
                return Response()
        class Request:
            async def json(self): return payload
        class HTTPException(Exception):
            def __init__(self, **kwargs): super().__init__(kwargs)
        source = ast.parse(Path('routers/comfyui.py').read_text(encoding='utf-8'))
        node = next(n for n in source.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'cancel_comfyui_task')
        node.decorator_list = []
        context = dict(_main=SimpleNamespace(COMFYUI_ADDRESS='localhost:8188'),
                       httpx=SimpleNamespace(AsyncClient=Client), Request=Request, HTTPException=HTTPException)
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<cancel>', 'exec'), context)
        result = asyncio.run(context['cancel_comfyui_task'](Request()))
        return calls, result

    def test_pending_deletes_only_requested_id(self):
        calls, _ = self.run_cancel({'queue_pending':[[1,'mine',{}, {'client_id':'client'}], [2,'other',{}, {'client_id':'client'}]]},
                                  {'prompt_id':'mine','client_id':'client'})
        self.assertEqual(calls, [('http://localhost:8188/queue', {'delete':['mine']}), ('http://localhost:8188/interrupt', {'prompt_id':'mine'})])

    def test_running_interrupts_requested_id(self):
        calls, _ = self.run_cancel({'queue_running':[[1,'mine',{}, {'client_id':'client'}]]}, {'prompt_id':'mine','client_id':'client'})
        self.assertEqual(calls, [('http://localhost:8188/queue', {'delete':['mine']}), ('http://localhost:8188/interrupt', {'prompt_id':'mine'})])

    def test_other_client_or_finished_does_not_interrupt(self):
        for queue in ({'queue_running':[[1,'mine',{}, {'client_id':'other'}]]}, {}):
            calls, _ = self.run_cancel(queue, {'prompt_id':'mine','client_id':'client'})
            self.assertEqual(calls, [])


if __name__ == '__main__': unittest.main()
