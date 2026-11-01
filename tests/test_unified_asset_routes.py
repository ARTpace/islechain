"""统一素材接口：上传直达归档目录、反推保存、错误逐项返回。"""
import ast
import io
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock
import urllib.parse
import uuid
from typing import List

from fastapi import Form, File, UploadFile, HTTPException


def load_functions(path, names, namespace):
    tree=ast.parse(path.read_text('utf-8'))
    functions=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in names]
    for n in functions:n.decorator_list=[]
    exec(compile(ast.Module(body=functions,type_ignores=[]),str(path),'exec'),namespace)
    return namespace


class UnifiedAssetRouteTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.category={'id':'images','type':'image','name':'素材','items':[]}
        self.library={'libraries':[{'id':'default','categories':[self.category]}]}
        self.save_count=0
        def save(_):self.save_count+=1
        def resolve(url):
            path=self.root/urllib.parse.unquote(url.removeprefix('/assets/library/'))
            return str(path) if path.is_file() else None
        self.main=SimpleNamespace(
            ASSET_LIBRARY_DIR=str(self.root), account_dirname=lambda:'alice', now_ms=lambda:123456,
            load_asset_library=lambda:self.library, save_asset_library=save,
            find_asset_category_with_library=lambda *a:(self.library['libraries'][0],self.category),
            unique_asset_category_dir=lambda *a:'images', sanitize_asset_name=lambda name,default:name or default,
            output_file_from_url=resolve, find_asset_item_in_library=lambda lib,id,owner:next((x for x in self.category['items'] if x['id']==id),None),
            AssetLibraryClassifyRequest=object, caption_image_with_provider=AsyncMock(return_value=('测试提示词','test-model')),
        )
        main_path=Path(__file__).parents[1]/'main.py'
        funcs=load_functions(main_path,{'_local_upload_kind_ext','write_asset_caption'},dict(os=os,HTTPException=HTTPException,output_file_from_url=resolve))
        self.main._local_upload_kind_ext=funcs['_local_upload_kind_ext'];self.main.write_asset_caption=funcs['write_asset_caption']
        ns=dict(_main=self.main,List=List,UploadFile=UploadFile,File=File,Form=Form,os=os,uuid=uuid,urllib=urllib,HTTPException=HTTPException)
        self.routes=load_functions(Path(__file__).parents[1]/'routers/assets.py',{'upload_asset_library_files','caption_asset_library_items'},ns)

    async def upload(self):
        file=UploadFile(filename='测试.png',file=io.BytesIO(b'PNG'))
        return await self.routes['upload_asset_library_files']([file],'default','images')

    async def test_upload_archives_directly_and_registers_once(self):
        response=await self.upload();item=response['items'][0]
        self.assertTrue(item['url'].startswith('/assets/library/alice/'))
        self.assertEqual(Path(self.main.output_file_from_url(item['url'])).read_bytes(),b'PNG')
        self.assertEqual(len(self.category['items']),1);self.assertEqual(self.save_count,1)
        self.assertFalse((self.root/'uploads').exists())

    async def test_caption_saved_with_media_and_partial_failure_reported(self):
        response=await self.upload();item=response['items'][0]
        request=SimpleNamespace(ids=[item['id'],'missing'],library_id='default',provider='test',model='test',ms_model='',prompt='描述图片')
        result=await self.routes['caption_asset_library_items'](request)
        self.assertEqual(result['count'],1)
        self.assertFalse(result['items'][1]['ok'])
        self.assertEqual(item['caption'],'测试提示词')
        self.assertEqual(Path(self.main.output_file_from_url(item['url'])).with_suffix('.txt').read_text('utf-8'),'测试提示词')

    async def test_invalid_directory_rejected_without_creating_file(self):
        self.category['dir']='../../escape'
        with self.assertRaises(HTTPException):await self.upload()
        self.assertFalse(self.category['items'])
        self.assertEqual(self.save_count,0)


if __name__=='__main__':unittest.main()
