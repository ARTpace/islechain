"""能力包路由：包目录、软件侦察、包校验。

P1 只读：没有任何端点会下载、安装或启动进程。安装执行器在 P2 接入。
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import main as _main
from core import ability_packs

router = APIRouter(prefix='/api/packs', tags=['packs'])


class ValidateRequest(BaseModel):
    folder: str = Field(min_length=1, max_length=1024)


def _username(request: Request):
    _main.ensure_same_origin_request(request)
    return _main.require_valid_token(_main.request_auth_token(request))


@router.get('')
async def list_packs(request: Request):
    _username(request)
    rows = [ability_packs.summary(entry) for entry in ability_packs.catalog()]
    return {
        'packs': rows,
        'counts': {
            'installed': sum(1 for row in rows if row['status'] == 'installed'),
            'installable': sum(1 for row in rows if row['status'] == 'installable'),
            'blocked': sum(1 for row in rows if row['status'] == 'blocked'),
            'invalid': sum(1 for row in rows if row['status'] == 'invalid'),
        },
    }


@router.get('/discover')
async def discover(request: Request):
    """软件与包的合并视图：只读探测，不执行任何应用代码。"""
    _username(request)
    return ability_packs.discover()


@router.post('/validate')
async def validate(payload: ValidateRequest, request: Request):
    """第三方作者用：校验一个包目录，逐条回显将被执行的 argv。"""
    _username(request)
    folder = Path(payload.folder).expanduser()
    if not folder.is_dir():
        raise HTTPException(status_code=400, detail='目录不存在：%s' % payload.folder)
    result = ability_packs.validate_folder(folder)
    if not result.get('ok'):
        raise HTTPException(status_code=400, detail=result.get('error') or '校验失败')
    return result
