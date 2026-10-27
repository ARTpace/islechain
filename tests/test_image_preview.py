"""Preview cache concurrency checks without starting ComfyUI or loading main."""
import ast
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import tempfile
import threading
import unittest
import uuid
from unittest.mock import patch

from PIL import Image


class ImagePreviewTests(unittest.TestCase):
    def test_shared_cache_decodes_once_and_preserves_original(self):
        tree = ast.parse(Path('main.py').read_text(encoding='utf-8'))
        nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('media_preview_cache_paths', '_prewarm_thumbnails')]
        with tempfile.TemporaryDirectory() as directory:
            context = dict(os=os, hashlib=hashlib, uuid=uuid, MEDIA_PREVIEW_DIR=directory,
                           _PREVIEW_LOCKS=tuple(threading.Lock() for _ in range(32)))
            exec(compile(ast.Module(body=nodes, type_ignores=[]), 'main.py', 'exec'), context)
            original = Path(directory) / 'original.png'
            Image.new('RGB', (2048, 1536), '#37b89a').save(original)
            before = original.read_bytes()
            with patch('PIL.Image.open', wraps=Image.open) as opened:
                with ThreadPoolExecutor(max_workers=3) as pool:
                    jobs = [pool.submit(context['_prewarm_thumbnails'], str(original), widths) for widths in ((768,600),(768,),(600,))]
                    for job in jobs:
                        job.result()
                self.assertEqual(opened.call_count, 1)
            for width in (768,600):
                preview, _ = context['media_preview_cache_paths'](str(original), width)
                with Image.open(preview) as image:
                    image.load()
                    self.assertEqual(max(image.size), width)
            self.assertEqual(original.read_bytes(), before)
            self.assertFalse(list(Path(directory).glob('*.tmp')))


if __name__ == '__main__':
    unittest.main()
