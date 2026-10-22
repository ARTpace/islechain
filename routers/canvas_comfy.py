"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/canvas-comfy-tasks
"""
from fastapi import HTTPException
import asyncio, time, uuid
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.post("/api/canvas-comfy-tasks")
async def create_canvas_comfy_task(payload: _main.GenerateRequest, token: str = ""):
    """Create an async ComfyUI task. Returns task_id immediately."""
    task_id = f"canvas_comfy_{uuid.uuid4().hex}"
    with _main.CANVAS_TASK_LOCK:
        _main.CANVAS_TASKS[task_id] = {
            "id": task_id,
            "type": "comfy-generate",
            "status": "queued",
            "created_at": time.time(),
            "updated_at": time.time(),
            "result": None,
            "error": "",
        }
    asyncio.create_task(_main.run_canvas_comfy_task(task_id, payload, token))
    return {"task_id": task_id, "status": "queued"}


@router.get("/api/canvas-comfy-tasks/{task_id}")
async def get_canvas_comfy_task(task_id: str):
    with _main.CANVAS_TASK_LOCK:
        task = dict(_main.CANVAS_TASKS.get(task_id) or {})
    if not task:
        raise HTTPException(status_code=404, detail="画布任务不存在,可能服务已重启或任务已过期")
    return task
