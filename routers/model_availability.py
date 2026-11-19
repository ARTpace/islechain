"""模型可用性：统一快照、强制刷新、强制显示 override。

前端各菜单只读 GET 快照并按 key 过滤；设置页用 POST override 把误判项加回菜单。
"""

import main as _main
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from core import model_availability as availability

router = APIRouter()


class OverridePayload(BaseModel):
    key: str
    forced: bool = True


@router.get("/api/models/availability")
async def models_availability(refresh: bool = False):
    if refresh:
        availability.invalidate()
    return await availability.get_snapshot(_main, force=refresh)


@router.post("/api/models/availability/refresh")
async def refresh_models_availability():
    availability.invalidate()
    return await availability.get_snapshot(_main, force=True)


@router.post("/api/models/availability/override")
async def override_model_availability(payload: OverridePayload):
    key = (payload.key or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="缺少模型 key")
    keys = availability.set_override(_main, key, payload.forced)
    return {"overrides": sorted(keys)}
