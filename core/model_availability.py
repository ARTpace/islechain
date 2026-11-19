"""模型可用性服务门面 —— 把「配置里写了」和「实际能用」分开。

分层（依赖单向向下）：
    contract.py  —— 配置 / 常量 / 小工具
    cloud.py     —— 云端平台探测      local.py —— 本地工作流探测
    本文件       —— 缓存编排 + 强制显示 override + 对外 API

路由只 import 本文件；ctx（main 模块）由路由注入，便于单测换假实现。
统一快照结构 version=1：`entries[key] = {available, reason, stage, ...}`，
**缺失的 key 一律视为 unknown 放行**，这是「绝不误杀」的契约。
"""

import asyncio
import json
import os
import time
from typing import Any, Dict

from core import model_availability_contract as contract
from core import model_availability_cloud as cloud
from core import model_availability_local as local

_cache: Dict[str, Any] = {"data": None, "ts": 0.0, "running": None}


def configure(**kwargs):
    """运行期覆盖检测阈值并让缓存失效。"""
    changed = contract.configure(**kwargs)
    invalidate()
    return changed


def invalidate():
    _cache["ts"] = 0.0


def register_probe(protocol, fn=None):
    """注册/替换某协议的探测器（策略缝）。"""
    cloud.register_probe(protocol, fn)
    invalidate()


def _override_path(ctx) -> str:
    return os.path.join(ctx.USER_DATA_DIR, contract.OVERRIDE_FILE)


def load_overrides(ctx) -> set:
    try:
        with open(_override_path(ctx), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        keys = data.get("keys") if isinstance(data, dict) else data
        return {str(k) for k in (keys or []) if k}
    except Exception:
        return set()


def set_override(ctx, key: str, forced: bool = True) -> set:
    keys = load_overrides(ctx)
    if forced:
        keys.add(str(key))
    else:
        keys.discard(str(key))
    try:
        ctx.atomic_write_json(_override_path(ctx), {"keys": sorted(keys)},
                              ensure_ascii=False, indent=2)
    except Exception as exc:
        raise RuntimeError(f"保存强制显示设置失败: {exc}")
    # 让「还没过期的缓存快照」立刻带上新的 override，否则设置页/菜单要等下一次
    # 请求才生效。override 只影响 overrides 清单，不改变各条目检测结果，原地更新即可。
    if _cache.get("data") and isinstance(_cache["data"], dict):
        _cache["data"]["overrides"] = sorted(keys)
    else:
        invalidate()
    return keys


def _empty_snapshot(error: str = "") -> Dict[str, Any]:
    return {"version": 1, "checked_at": time.time(), "complete": False,
            "ttl": contract.SETTINGS["cache_ttl"], "entries": {}, "overrides": [],
            "summary": {"total": 0, "unavailable": 0}, "error": error}


async def _compute(ctx) -> Dict[str, Any]:
    try:
        providers = [ctx.public_provider(p) for p in ctx.load_api_providers()]
        entries = await cloud.probe_providers(ctx, providers)
        workflows = await local.probe_workflows(ctx)
        entries.update(workflows)
        unavailable = sum(1 for item in entries.values() if not item.get("available"))
        data = {
            "version": 1,
            "checked_at": time.time(),
            "complete": bool(workflows) or not contract.SETTINGS["local_probe"],
            "ttl": contract.SETTINGS["cache_ttl"],
            "entries": entries,
            "overrides": sorted(load_overrides(ctx)),
            "summary": {"total": len(entries), "unavailable": unavailable},
        }
        _cache["data"] = data
        _cache["ts"] = time.time()
        return data
    except Exception as exc:
        return _empty_snapshot(str(exc)[:200])


async def get_snapshot(ctx, force: bool = False) -> Dict[str, Any]:
    now = time.time()
    if not force and _cache["data"] and now - _cache["ts"] < contract.SETTINGS["cache_ttl"]:
        return _cache["data"]
    task = _cache.get("running")
    if task is None or task.done():
        task = asyncio.create_task(_compute(ctx))
        _cache["running"] = task
    # 有旧快照时先返回旧的，新检测在后台跑完即可，不拖住前端首屏。
    if not force and _cache["data"]:
        return _cache["data"]
    return await asyncio.shield(task)
