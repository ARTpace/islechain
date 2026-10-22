"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/restart
"""
import asyncio, os, sys
from fastapi import APIRouter


router = APIRouter()


@router.post("/api/restart")
async def restart_server():
    """重启后端服务(同窗口)"""
    async def _restart():
        await asyncio.sleep(1)
        os.execv(sys.executable, [sys.executable] + sys.argv)
    asyncio.create_task(_restart())
    return {"message": "restarting", "status": "ok"}
