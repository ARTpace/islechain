"""Codex image bridge: per-turn artifacts, reference inputs, dispatch and failures."""
import ast
import asyncio
import base64
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from PIL import Image
from fastapi import HTTPException
from tools.codex_image import generate_image


THREAD = "01a17718-a5ea-7b30-aef2-787cd8e65e71"


class CodexImageTests(unittest.IsolatedAsyncioTestCase):
    async def test_chat_history_forwards_all_five_references(self):
        tree = ast.parse(Path('main.py').read_text(encoding='utf-8'))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'upstream_message_from_record')
        context = dict(reference_to_data_url=lambda ref: ref['url'])
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<chat-references>', 'exec'), context)
        refs = [{'url': f'image-{i}.png'} for i in range(5)]
        result = context['upstream_message_from_record']({'role': 'user', 'attachments': refs})
        self.assertEqual([item['image_url']['url'] for item in result['content'][1:]], [ref['url'] for ref in refs])

    async def run_cli(self, home, *, image=True, code=0, refs=(), timeout=False):
        root = Path(home) / 'generated_images' / THREAD
        root.mkdir(parents=True)
        if image:
            Image.new('RGB', (12, 8), 'blue').save(root / 'result.png')
        proc = AsyncMock()
        proc.returncode = code
        proc.pid = 12345
        events = [dict(type='thread.started', thread_id=THREAD),
                  dict(type='turn.completed', usage={'input_tokens': 10})]
        proc.communicate.return_value = ('\n'.join(map(json.dumps, events)).encode(), None)
        if timeout:
            proc.returncode = None
            proc.communicate.side_effect = asyncio.TimeoutError()
        calls = []

        async def launch(*args, **kwargs):
            calls.append(args)
            if len(calls) == 1:
                self.assertIn('--sandbox', args)
                self.assertIn('read-only', args)
                self.assertIn('shell_tool', args)
                if refs:
                    path = Path(args[args.index('--image') + 1])
                    self.assertEqual(path.read_bytes(), refs[0][1])
                else:
                    self.assertNotIn('--image', args)
            return proc

        with patch.dict(os.environ, CODEX_HOME=home), \
             patch('tools.codex_image.shutil.which', return_value='codex'), \
             patch('tools.codex_image.asyncio.create_subprocess_exec', side_effect=launch):
            result = await generate_image('test image', '1024x1024', 'high', 'gpt-image-2', refs)
        return result, proc

    async def test_image_and_reference_use_current_turn(self):
        with tempfile.TemporaryDirectory() as home:
            (image, raw), proc = await self.run_cli(home, refs=[('ref.png', b'reference-bytes', 'image/png')])
        self.assertEqual(image['type'], 'b64')
        self.assertTrue(base64.b64decode(image['value']).startswith(b'\x89PNG'))
        self.assertEqual(raw['usage']['input_tokens'], 10)
        prompt = proc.communicate.call_args.args[0].decode()
        self.assertIn('built-in image_gen', prompt)
        self.assertIn('1024x1024', prompt)
        self.assertIn('Exactly 1 reference images', prompt)
        self.assertNotIn('zero attached images', prompt)

    async def test_text_to_image_never_requests_attachment_identifiers(self):
        with tempfile.TemporaryDirectory() as home:
            _, proc = await self.run_cli(home)
        prompt = proc.communicate.call_args.args[0].decode()
        self.assertIn('zero attached images', prompt)
        self.assertIn('generation mode without any reference image identifiers', prompt)
        self.assertNotIn('already visible', prompt)

    async def test_no_artifact_does_not_accept_agent_file_paths(self):
        with tempfile.TemporaryDirectory() as home:
            Image.new('RGB', (2, 2)).save(Path(home) / 'unrelated.png')
            with self.assertRaisesRegex(ValueError, '未生成图片'):
                await self.run_cli(home, image=False)

    async def test_failed_cli_does_not_return_artifacts(self):
        with tempfile.TemporaryDirectory() as home:
            with self.assertRaisesRegex(ValueError, '执行失败'):
                await self.run_cli(home, code=1)

    async def test_timeout_stops_process(self):
        with tempfile.TemporaryDirectory() as home:
            with self.assertRaisesRegex(ValueError, '已停止本地任务'):
                await self.run_cli(home, timeout=True)

    async def test_invalid_model_does_not_start_cli(self):
        with self.assertRaisesRegex(ValueError, '仅支持 gpt-image-2'):
            await generate_image('test', '1024x1024', 'auto', 'not-an-image-model')

    async def test_online_dispatch_routes_codex_without_http(self):
        tree = ast.parse(Path('main.py').read_text(encoding='utf-8'))
        node = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'generate_ai_image')
        context = dict(asyncio=asyncio, provider_protocol=lambda p: p['protocol'],
                       normalize_image_request_mode=lambda mode: mode,
                       reference_file_part=lambda ref: ('ref.png', b'bytes', 'image/png'),
                       HTTPException=HTTPException)
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<image-dispatch>', 'exec'), context)
        bridge = AsyncMock(return_value=({'type': 'b64', 'value': 'test'}, {}))
        with patch('tools.codex_image.generate_image', bridge):
            result = await context['generate_ai_image']('cat', '1024x1024', 'high', 'gpt-image-2',
                                                       [{'url': '/output/ref.png'}], provider={'protocol': 'codex'})
        self.assertEqual(result[0]['value'], 'test')
        self.assertEqual(bridge.call_args.args[-1], [('ref.png', b'bytes', 'image/png')])


if __name__ == '__main__':
    unittest.main()
