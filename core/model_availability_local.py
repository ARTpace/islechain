"""本地 ComfyUI 工作流可用性检测：比对节点类型与权重枚举。

性能前提：ComfyUI 全量 /object_info 有 28MB / 22s，绝不能每次检测都拉。
这里按工作流实际用到的 class_type **逐个查小接口**（实测 ~3ms/个、并发 16），
结果带 5 分钟内存缓存，节点类型清单变化很慢。

只看「值确实是权重文件名」的输入（.safetensors/.gguf/…），不碰 LoadImage
默认图、提示词、数值。请求失败的类型记为 UNKNOWN 并跳过该工作流，绝不误杀。
"""

import asyncio
import json
import os
import time
from typing import Any, Dict, Optional, Tuple
from urllib.parse import quote

import httpx
from core import model_availability_contract as contract

UNKNOWN = object()
_type_cache: Dict[str, Tuple[Any, float]] = {}  # class_type -> (spec | None, ts)


async def _fetch_type(ctx, kind: str, client, sem):
    cached = _type_cache.get(kind)
    if cached and time.time() - cached[1] < contract.SETTINGS["node_type_ttl"]:
        return kind, cached[0]
    target = str(getattr(ctx, "COMFYUI_ADDRESS", "") or "").strip()
    url = f"http://{target}/object_info/{quote(kind, safe='')}"
    try:
        async with sem:
            response = await client.get(url)
        if response.status_code >= 400:
            return kind, UNKNOWN
        data = response.json()
        spec = data.get(kind) if isinstance(data, dict) else None
        value = spec if isinstance(spec, dict) else None
        _type_cache[kind] = (value, time.time())
        return kind, value
    except Exception:
        return kind, UNKNOWN


async def fetch_type_specs(ctx, types: set):
    """返回 (known, unknown)：known[type]=spec 或 None（明确没装），unknown=请求失败。"""
    target = str(getattr(ctx, "COMFYUI_ADDRESS", "") or "").strip()
    if not target:
        return {}, set(types)
    sem = asyncio.Semaphore(max(1, int(contract.SETTINGS["type_parallel"])))
    try:
        async with httpx.AsyncClient(
                timeout=contract.SETTINGS["object_info_timeout"], trust_env=False) as client:
            results = await asyncio.gather(
                *[_fetch_type(ctx, kind, client, sem) for kind in sorted(types)])
    except Exception:
        return {}, set(types)
    known, unknown = {}, set()
    for kind, spec in results:
        if spec is UNKNOWN:
            unknown.add(kind)
        else:
            known[kind] = spec
    return known, unknown


def _graphs(ctx):
    """返回 [(rel, graph, types)]，只收 API 格式工作流（UI 格式不判）。"""
    result = []
    for rel in sorted(getattr(ctx, "BUILTIN_WORKFLOWS", set()) or []):
        path = os.path.join(ctx.WORKFLOW_DIR, *str(rel).split("/"))
        try:
            with open(path, "r", encoding="utf-8") as handle:
                graph = json.load(handle)
        except Exception:
            continue
        if not isinstance(graph, dict) or not graph:
            continue
        first = next(iter(graph.values()))
        if not isinstance(first, dict) or "class_type" not in first:
            continue
        types = {node.get("class_type") for node in graph.values()
                 if isinstance(node, dict) and isinstance(node.get("class_type"), str)}
        result.append((str(rel), graph, types))
    return result


def workflow_verdict(graph: dict, known: Dict[str, Any]) -> Tuple[list, list]:
    """返回 (missing_nodes, missing_models)。"""
    missing_nodes, missing_models = [], []
    for node in graph.values():
        if not isinstance(node, dict):
            continue
        kind = node.get("class_type")
        spec = known.get(kind)
        if spec is None:
            missing_nodes.append(str(kind))
            continue
        fields = {}
        for section in ("required", "optional"):
            part = (spec.get("input") or {}).get(section) or {}
            if isinstance(part, dict):
                fields.update(part)
        for name, value in (node.get("inputs") or {}).items():
            if not isinstance(value, str) or not contract.norm(value).endswith(contract.WEIGHT_EXT):
                continue
            options = contract.choices(fields.get(name))
            if not options or any(contract.norm(value) == contract.norm(o) for o in options):
                continue
            missing_models.append(f"{kind}.{name}={value}")
    return missing_nodes, missing_models


async def probe_workflows(ctx) -> Dict[str, Any]:
    if not contract.SETTINGS["local_probe"]:
        return {}
    graphs = _graphs(ctx)
    if not graphs:
        return {}
    all_types = set().union(*(types for _, _, types in graphs))
    known, unknown = await fetch_type_specs(ctx, all_types)
    entries: Dict[str, Any] = {}
    for rel, graph, types in graphs:
        if types & unknown:
            continue  # 有类型没查到结论 → 这个工作流保持 unknown，放行
        missing_nodes, missing_models = workflow_verdict(graph, known)
        parts = []
        if missing_nodes:
            parts.append("缺少节点 " + ", ".join(sorted(set(missing_nodes))[:3]))
        if missing_models:
            parts.append("缺少权重 " + ", ".join(sorted(set(missing_models))[:3]))
        entries["workflow:" + rel] = contract.entry(
            not parts, "；".join(parts), "object_info",
            missing_nodes=missing_nodes[:8], missing_models=missing_models[:8])
    return entries
