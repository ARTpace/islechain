import asyncio
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from core.comfy_model_download import download, validate_limits, check_url, destination, verify_existing


class Chunks(httpx.AsyncByteStream):
    def __init__(self, chunks):self.chunks = chunks
    async def __aiter__(self):
        for chunk in self.chunks:yield chunk


class ModelDownloadTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temp = tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.model = {'save_path': 'default', 'type': 'checkpoints', 'filename': 'fixture.safetensors', 'url': 'https://huggingface.co/example/model'}
        self.payload = b'fixture-model-bytes'
        self.sha = hashlib.sha256(self.payload).hexdigest()

    def client(self, handler):
        original = httpx.AsyncClient
        return patch('core.comfy_model_download.httpx.AsyncClient', side_effect=lambda **kw: original(transport=httpx.MockTransport(handler), **kw))

    async def test_publish_receipt_and_never_overwrite(self):
        with self.client(lambda request: httpx.Response(200, stream=Chunks([self.payload[:5], self.payload[5:]]))):
            receipt = await download(self.root, self.model, self.sha, 100)
        target = self.root / 'models/checkpoints/fixture.safetensors'
        self.assertEqual(target.read_bytes(), self.payload)
        self.assertEqual(receipt, {'sha256': self.sha, 'bytes': len(self.payload), 'maxBytes': 100, 'verified': True})
        with self.assertRaisesRegex(ValueError, '不覆盖'):
            await download(self.root, self.model, self.sha, 100)
        self.assertEqual(target.read_bytes(), self.payload)
        self.assertFalse(list(self.root.rglob('*.part')))

    async def test_budget_hash_encoding_redirect_and_cleanup(self):
        cases = [(lambda r: httpx.Response(200, stream=Chunks([self.payload])), 'SHA256', 'a'*64, 100),
                 (lambda r: httpx.Response(200, stream=Chunks([self.payload])), '实际大小', self.sha, 2),
                 (lambda r: httpx.Response(200, headers={'content-length':'1000'}, stream=Chunks([])), '声明大小', self.sha, 100),
                 (lambda r: httpx.Response(200, headers={'content-encoding':'gzip'}, stream=Chunks([])), '压缩', self.sha, 100),
                 (lambda r: httpx.Response(302, headers={'location':'https://evil.test/model'}), '来源', self.sha, 100)]
        for handler, message, sha, limit in cases:
            with self.subTest(message=message), self.client(handler):
                with self.assertRaisesRegex(ValueError, message):await download(self.root, self.model, sha, limit)
                self.assertFalse(list(self.root.rglob('*.part')))
                self.assertFalse(list(self.root.rglob('*.safetensors')))

    async def test_cancellation_removes_partial(self):
        async def handler(request):raise asyncio.CancelledError()
        with self.client(handler), self.assertRaises(asyncio.CancelledError):
            await download(self.root, self.model, self.sha, 100)
        self.assertFalse(list(self.root.rglob('*.part')))

    async def test_verify_existing_without_network_and_reject_modified_files(self):
        target = destination(self.root, self.model)
        target.write_bytes(self.payload)
        with patch('core.comfy_model_download.httpx.AsyncClient', side_effect=AssertionError('must not download')):
            receipt = await verify_existing(self.root, self.model, self.sha, 100)
            self.assertEqual(receipt['bytes'], len(self.payload))
            target.write_bytes(b'x' * len(self.payload))
            with self.assertRaisesRegex(ValueError, 'SHA256不匹配'):
                await verify_existing(self.root, self.model, self.sha, 100)
            self.assertEqual(target.read_bytes(), b'x' * len(self.payload))
            with self.assertRaisesRegex(ValueError, '大小超过预算'):
                await verify_existing(self.root, self.model, self.sha, 1)
            target.unlink()
            with self.assertRaisesRegex(ValueError, '不存在'):
                await verify_existing(self.root, self.model, self.sha, 100)

    def test_paths_and_limits(self):
        for sha, count in [('x', 100), (self.sha, True), (self.sha, 0), (self.sha, 101*1024**3)]:
            with self.assertRaises(ValueError):validate_limits(sha, count)
        for url in ['http://huggingface.co/a','https://huggingface.co:444/a','https://u:p@huggingface.co/a']:
            with self.assertRaises(ValueError):check_url(url)
        bad = {**self.model, 'save_path':'../outside'}
        with self.assertRaises(ValueError):destination(self.root, bad)


if __name__ == '__main__':unittest.main()
