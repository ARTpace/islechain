"""云端平台可用性探测：静态门槛 + 上游 /models 真实清单。

判定纪律：只有「401 / 上游清单里确实没有」才判不可用；
探测没结论一律 unknown 放行，避免误杀免 Key 的本地网关和特殊命名平台。
"""

import asyncio
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx
from tools.api_compat import is_cloudflare, model_items, models_endpoint
from core import model_availability_contract as contract
from core.model_availability_cli import cli_probe_for

Verdict = Tuple[str, str, List[str]]  # (available|unavailable|unknown, reason, model_ids)
PROBE_REGISTRY: Dict[str, Optional[Callable[..., Any]]] = {}
_UNSET = object()


def register_probe(protocol: str, fn: Optional[Callable[..., Any]]):
    """注册/替换某协议的探测器；传 None 表示显式跳过探测（策略缝）。"""
    PROBE_REGISTRY[str(protocol or "").strip().lower()] = fn


def probe_for(protocol: str, base_url: str = ""):
    value = PROBE_REGISTRY.get(str(protocol or "").strip().lower(), _UNSET)
    if value is not _UNSET:
        return value
    if protocol in contract.CLI_PROTOCOLS:
        # 配了 HTTP 地址就用更准的 HTTP 探测；否则走 CLI 二进制 / 登录态探测。
        if str(base_url or "").strip():
            return default_probe
        return cli_probe_for(protocol)
    return default_probe


async def default_probe(ctx, provider: dict) -> Verdict:
    base = str(provider.get("base_url") or "").strip().rstrip("/")
    if not base:
        return "unknown", "", []
    url = models_endpoint(base)
    headers = {"Accept": "application/json"}
    key = ctx.get_provider_api_key(provider.get("id", ""))
    if key:
        headers["Authorization"] = "Bearer " + str(key).strip()
    try:
        async with httpx.AsyncClient(timeout=contract.SETTINGS["probe_timeout"], trust_env=False) as client:
            response = await client.get(url, headers=headers)
    except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError):
        # 探测不是生成请求：短超时、网关重启或临时断网不能撤销用户启用的模型。
        return "unknown", "", []
    except Exception:
        return "unknown", "", []
    if response.status_code in (401, 403):
        return "unavailable", "API Key 被平台拒绝", []
    if response.status_code >= 400:
        return "unknown", "", []
    try:
        raw = response.json()
    except Exception:
        return "available", "", []
    ids = [str(item.get("id") or item.get("name") or "")
           for item in model_items(raw, cloudflare=is_cloudflare(str(provider.get("base_url") or "")))
           if isinstance(item, dict)]
    return "available", "", [i for i in ids if i]


def _matched_ids(configured: List[str], ids: List[str]) -> set:
    """命中规则：全等、或任一方是另一方的 `/` 后缀（webai2api 带平台前缀）。"""
    result = set()
    for model in configured:
        target = contract.norm(model)
        if any(target == contract.norm(i)
               or target.endswith("/" + contract.norm(i))
               or contract.norm(i).endswith("/" + target)
               for i in ids):
            result.add(target)
    return result


async def probe_provider(ctx, provider: dict, sem: asyncio.Semaphore) -> Dict[str, Any]:
    pid = str(provider.get("id") or "")
    proto = str(provider.get("protocol") or "openai").strip().lower()
    models = {
        "image": list(provider.get("image_models") or []),
        "chat": list(provider.get("chat_models") or []),
        "video": list(provider.get("video_models") or []),
    }
    configured = [str(m) for group in models.values() for m in group if m]

    hard_block = provider.get("enabled") is False
    if hard_block:
        static_block = "平台已禁用"
    elif proto not in contract.CLI_PROTOCOLS and not str(provider.get("base_url") or "").strip():
        static_block = "未配置请求地址"
    elif not provider.get("has_key") and proto not in contract.KEYLESS_PROTOCOLS:
        # 后端 _resolve_image_provider 对这类平台会直接拒绝，即使上游 /models
        # 不校验 Key 也不能放行。免 Key 网关请走 KEYLESS_PROTOCOLS 或强制显示。
        static_block = "未配置 API Key"
    else:
        static_block = ""
    verdict = "unavailable" if static_block else "available"
    reason, stage = static_block, "config"

    ids: List[str] = []
    probe = probe_for(proto, str(provider.get("base_url") or "")) if (
        contract.SETTINGS["cloud_probe"] and not hard_block
        and (configured or proto in contract.CLI_PROTOCOLS)
    ) else None
    if probe is not None:
        async with sem:
            try:
                probed, probe_reason, ids = await probe(ctx, provider)
            except Exception:
                probed, probe_reason, ids = "unknown", "", []
        if probed == "unavailable":
            verdict, reason, stage = "unavailable", probe_reason, "probe"
        elif probed == "available" and not static_block:
            verdict, reason, stage = "available", "", "probe"

    entries = {"provider:" + pid: contract.entry(verdict == "available", reason, stage)}
    inherited = reason if verdict != "available" else ""
    # 清单非空且至少命中一个配置模型，才启用逐模型比对；零命中说明上游用了另一套命名。
    matched = _matched_ids(configured, ids) if ids else set()
    strict_ids = bool(ids) and bool(matched)
    for kind, group in models.items():
        for model in group:
            model = str(model)
            if not model:
                continue
            key = f"{kind}:{pid}/{model}"
            if inherited:
                entries[key] = contract.entry(False, inherited, stage)
                continue
            cap = (provider.get("model_capabilities") or {}).get(model)
            if isinstance(cap, dict) and cap.get("available") is False:
                entries[key] = contract.entry(False, "上游已移除该模型", "capability")
            elif strict_ids and contract.norm(model) not in matched:
                entries[key] = contract.entry(False, "上游模型清单里已没有该模型", "probe")
            else:
                entries[key] = contract.entry(True, "", "probe" if ids else "config")
    return entries


async def probe_providers(ctx, providers: List[dict]) -> Dict[str, Any]:
    sem = asyncio.Semaphore(max(1, int(contract.SETTINGS["max_parallel"])))
    groups = await asyncio.gather(
        *[probe_provider(ctx, p, sem) for p in providers], return_exceptions=True)
    entries: Dict[str, Any] = {}
    for group in groups:
        if isinstance(group, dict):
            entries.update(group)
    return entries
