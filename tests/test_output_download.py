"""下载接口回归测试，不导入会启动服务的 main 模块。"""
import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import unquote

from fastapi import HTTPException
from fastapi.responses import FileResponse
from starlette.responses import Response


def load_download(main):
    source = Path(__file__).parents[1] / 'routers' / 'output_ops.py'
    tree = ast.parse(source.read_text(encoding='utf-8'))
    functions = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                 and node.name in ('download_disposition', 'download_output')]
    for node in functions:
        node.decorator_list = []
    from urllib.parse import quote
    import os
    namespace = dict(_main=main, os=os, quote=quote, FileResponse=FileResponse,
                     Response=Response, HTTPException=HTTPException)
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), 'exec'), namespace)
    return namespace['download_output']


def test_local_chinese_download(tmp_path):
    image = tmp_path / 'image.png'
    image.write_bytes(b'png')
    download = load_download(SimpleNamespace(output_file_from_url=lambda url: str(image),
                                            content_type_for_path=lambda path: 'image/png'))
    for inline in (False, True):
        response = asyncio.run(download('/output/image.png', '抠图 · 选区编辑.png', inline))
        header = response.headers['content-disposition']
        assert header.startswith('inline;' if inline else 'attachment;')
        assert unquote(header.split("UTF-8''")[1]) == '抠图 · 选区编辑.png'
        assert response.headers['content-type'] == 'image/png'


def test_remote_chinese_download():
    download = load_download(SimpleNamespace(output_file_from_url=lambda url: None))
    remote = SimpleNamespace(content=b'png', headers={'content-type': 'image/png'},
                             raise_for_status=lambda: None)
    client = AsyncMock()
    client.__aenter__.return_value.get.return_value = remote
    with patch('httpx.AsyncClient', return_value=client):
        response = asyncio.run(download('https://example.com/image.png', '抠图.png'))
    assert response.status_code == 200
    assert response.body == b'png'
    assert unquote(response.headers['content-disposition'].split("UTF-8''")[1]) == '抠图.png'
