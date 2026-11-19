"""系统配置相关路由"""
import json
import os
import re
from typing import List

import httpx
from fastapi import APIRouter, HTTPException, Request

import main as _main  # P2 惰性依赖（2026-10-22 断循环）：见本文件 __getattr__
from providers.catalog import (
    CODEX_DEFAULT_IMAGE_MODELS,
    builtin_default_models,
)
from providers.catalog import (
    GEMINI_CLI_DEFAULT_IMAGE_MODELS as GEMINI_CLI_DEFAULT_IMAGE_MODELS,
)
from providers.catalog import (
    JIMENG_DEFAULT_IMAGE_MODELS as JIMENG_DEFAULT_IMAGE_MODELS,
)
from providers.catalog import (
    JIMENG_DEFAULT_VIDEO_MODELS as JIMENG_DEFAULT_VIDEO_MODELS,
)
from providers.catalog import (
    MODELSCOPE_DEFAULT_IMAGE_MODELS as MODELSCOPE_DEFAULT_IMAGE_MODELS,
)
from providers.catalog import (
    RUNNINGHUB_DEFAULT_IMAGE_MODELS as RUNNINGHUB_DEFAULT_IMAGE_MODELS,
)
from providers.config import ProviderStore, normalize_provider, provider_key_env, public_provider
from providers.schemas import ApiProviderPayload, TestConnectionPayload
from providers.upstream import fetch_models_from_upstream, group_models
from tools.api_compat import api_root, is_cloudflare, models_endpoint, sanitize_api_key

# No prefix - use full paths
router = APIRouter()


@router.get("/api/providers/webai2api/status")
@router.post("/api/providers/webai2api/sync")
async def webai2api_status(request: Request, provider_id: str = "webai2api", refresh: bool = False, model: str = ""):
    provider = _main.get_api_provider(provider_id)
    if not provider or _main.provider_protocol(provider) != "webai2api":
        raise HTTPException(status_code=404, detail="请先添加并保存 WebAI2API 平台")
    base = provider.get("base_url", "").rstrip("/")
    management_url = base[:-3] if base.endswith('/v1') else base
    try:
        if refresh:
            result = await fetch_models_from_upstream(base, _main.get_provider_api_key(provider_id), refresh=True, model=model)
        else:
            result = await fetch_models_from_upstream(base, _main.get_provider_api_key(provider_id))
    except Exception as exc:
        return {"online": False, "management_url": management_url,
                "message": str(getattr(exc, 'detail', exc))[:250]}
    if request.method == 'POST':
        providers = provider_store().load()
        for item in providers:
            if item['id'] == provider_id:
                # 参数同步仅更新用户已添加的模型，模型目录不等于已选列表。
                selected = set(item.get('image_models', []) + item.get('chat_models', []) + item.get('video_models', []))
                previous = item.get('model_capabilities') or {}
                item['model_capabilities'] = {
                    model: result['model_capabilities'].get(model, {**previous.get(model, {}), 'available': False,
                        'generation_params': {'source': 'website', 'status': 'unavailable', 'params': [], 'message': '上游已移除该模型'}})
                    for model in selected
                }
                result = {**result, **{key: item.get(key, []) for key in ('image_models', 'chat_models', 'video_models')},
                          'model_capabilities': item['model_capabilities']}
        provider_store().save(providers)
    return {"online": True, "management_url": management_url, **result}


@router.get("/api/config")
async def ai_config():
    preferred_chat_model = next((m for m in _main.CHAT_MODELS if m == "gpt-5.5"), _main.CHAT_MODELS[0] if _main.CHAT_MODELS else _main.CHAT_MODEL)
    all_chat_providers = []
    all_api_providers = []
    providers = provider_store().load()
    for p in providers:
        if p.get("chat_models"):
            all_chat_providers.append({
                "id": p["id"],
                "name": p.get("name", p["id"]),
                "base_url": p.get("base_url", ""),
                "chat_models": p["chat_models"],
            })
        all_api_providers.append(p)
    return {
        "base_url": _main.AI_BASE_URL,
        "chat_model": preferred_chat_model,
        "image_model": _main.IMAGE_MODEL,
        "chat_models": _main.CHAT_MODELS,
        "image_models": _main.IMAGE_MODELS,
        "has_api_key": bool(_main.AI_API_KEY),
        "ms_chat_models": _main.MODELSCOPE_CHAT_MODELS,
        "has_ms_key": bool(_main.MODELSCOPE_API_KEY),
        "chat_providers": all_chat_providers,
        "api_providers": all_api_providers,
    }


@router.get("/api/models")
async def ai_models():
    return {"chat_models": _main.CHAT_MODELS, "image_models": _main.IMAGE_MODELS}


# 内置平台默认模型（按 provider_id 区分）


def provider_store():
    return ProviderStore()


def visible_provider(provider):
    return public_provider(provider, read_key=_main.read_api_env_value, visitor=_main.LAN_VISITOR.get())


@router.get("/api/providers/models")
async def provider_models(provider_id: str = ""):
    """Fetch available models for a specific provider."""
    if not provider_id:
        return {"provider_id": provider_id, "image_models": _main.IMAGE_MODELS, "chat_models": _main.CHAT_MODELS, "video_models": []}

    prov = _main.get_api_provider(provider_id)
    builtin_img, builtin_chat, builtin_video = builtin_default_models(provider_id)
    if prov and _main.provider_protocol(prov) == "codex":
        builtin_img = list(CODEX_DEFAULT_IMAGE_MODELS)

    if prov:
        img = list(prov.get("image_models") or [])
        chat = list(prov.get("chat_models") or [])
        vid = list(prov.get("video_models") or [])
        if not img and builtin_img:
            img = builtin_img
        if not chat and builtin_chat:
            chat = builtin_chat
        if not vid and builtin_video:
            vid = builtin_video
        pk = _main.get_provider_api_key(prov["id"])
        if not (img or chat or vid) and pk and prov.get("base_url") and provider_id not in ("comfly", "modelscope", "jimeng", "codex", "gemini-cli"):
            try:
                result = await fetch_models_from_upstream(prov["base_url"], pk)
                img = result.get("image_models") or img
                chat = result.get("chat_models") or chat
                vid = result.get("video_models") or vid
            except Exception as e:
                return {"provider_id": provider_id, "error": str(e)[:300],
                        "image_models": img, "video_models": vid, "chat_models": chat}
        return {"provider_id": provider_id, "image_models": img, "chat_models": chat, "video_models": vid}

    if builtin_img or builtin_chat or builtin_video:
        return {"provider_id": provider_id, "image_models": builtin_img, "chat_models": builtin_chat, "video_models": builtin_video}
    return {"provider_id": provider_id, "image_models": _main.IMAGE_MODELS, "chat_models": _main.CHAT_MODELS, "video_models": []}


@router.get("/api/config/token")
async def get_global_token():
    if _main.MODELSCOPE_API_KEY:
        return {"token": _main.MODELSCOPE_API_KEY}
    if os.path.exists(_main.GLOBAL_CONFIG_FILE):
        try:
            with open(_main.GLOBAL_CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
                return {"token": config.get("modelscope_token", "")}
        except:
            pass
    return {"token": ""}


# 注：POST /api/config/update 的 router 版实现与 main.py HEAD 版行为不一致
# （rich 版 vs comfly 三键版，且前端无调用方）。为保持路由合同不变，此处不迁移该路由，
# 由 main.py 原版继续提供服务；rich 版实现已存于 2026-10-22 备份，如需启用须显式评审。


@router.get("/api/providers")
async def api_providers():
    """获取 API 提供商列表"""
    return {"providers": [visible_provider(p) for p in provider_store().load()]}


@router.put("/api/providers")
async def save_providers(payload: List[ApiProviderPayload]):
    """保存 API 提供商列表"""
    providers = []
    env_updates = {}

    raw_primary_flags = [bool(getattr(item, "primary", False)) for item in payload]
    existing = {p.get("id"): p for p in provider_store().load()}

    for item in payload:
        provider = normalize_provider(item.dict(exclude={"api_key"}))
        old = existing.get(provider["id"]) or {}
        for key in ("ms_loras", "rh_apps", "rh_workflows", "image_generation_endpoint", "image_edit_endpoint", "model_capabilities"):
            if key in old and not provider.get(key):
                provider[key] = old[key]
        if provider["id"] == "runninghub":
            provider["protocol"] = "runninghub"
        elif provider["id"] == "volcengine":
            provider["protocol"] = "volcengine"

        if any(existing["id"] == provider["id"] for existing in providers):
            raise HTTPException(status_code=400, detail=f"API 平台 ID 重复:{provider['id']}")

        providers.append(provider)

        if item.api_key is not None:
            env_updates[provider_key_env(provider["id"])] = item.api_key.strip()

        if provider["id"] == "comfly":
            env_updates["COMFLY_BASE_URL"] = provider["base_url"]
            env_updates["IMAGE_MODELS"] = ",".join(provider["image_models"])
            env_updates["CHAT_MODELS"] = ",".join(provider["chat_models"])
            env_updates["VIDEO_MODELS"] = ",".join(provider.get("video_models") or [])

        if provider["id"] == "modelscope":
            env_updates["MODELSCOPE_CHAT_MODELS"] = ",".join(provider["chat_models"])

    primary_indices = [i for i, flag in enumerate(raw_primary_flags) if flag]
    if primary_indices:
        winner = primary_indices[-1]
        for i, p in enumerate(providers):
            p["primary"] = (i == winner)

    provider_store().save(providers)

    if env_updates:
        _main.update_env_values(env_updates)
        _main.reload_env_globals()

    # 平台/Key/模型清单刚变过，下一次菜单读取必须重新检测
    try:
        from core import model_availability as _availability
        _availability.invalidate()
    except Exception:
        pass

    return {"providers": [visible_provider(p) for p in providers]}


@router.post("/api/providers/test-connection")
async def test_provider_connection(payload: TestConnectionPayload):
    """测试请求地址是否可用:调用上游 /v1/models"""
    base_url = (payload.base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")

    if not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="请求地址必须以 http:// 或 https:// 开头")

    api_key = (payload.api_key or "").strip()
    if any(ch in api_key for ch in ("•", "…", "****")):
        api_key = ""
    if not api_key and payload.provider_id:
        api_key = _main.read_api_env_value(provider_key_env(payload.provider_id))

    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")

    if is_cloudflare(api_root(base_url)):
        result = await fetch_models_from_upstream(base_url, api_key)
        return {"ok": True, "status": 200, "model_count": result["total"], **result}
    url = models_endpoint(base_url)

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers={
                "Authorization": f"Bearer {sanitize_api_key(api_key)}",
                "Accept": "application/json"
            })

        if resp.status_code >= 400:
            return {"ok": False, "status": resp.status_code, "message": resp.text[:300]}

        data = resp.json() if resp.text else {}
        items = (data.get("data") if isinstance(data, dict) else None) or []

        catalog = group_models(items)
        ids = catalog['all']
        grouped = {kind: catalog[kind + '_models'] for kind in ('chat', 'image', 'video')}

        # /models 不校验 Token 的平台（ModelScope 不带 Key 也返回 200）
        # 再用列表里的真实模型打一次对话接口，确认 Key 能通过鉴权。
        try:
            async with httpx.AsyncClient(timeout=12) as bare_client:
                bare = await bare_client.get(url, headers={"Accept": "application/json"})
            if bare.status_code < 400 and ids:
                probe_model = (grouped["chat"] or ids)[0]
                chat_url = api_root(base_url) + "/chat/completions"
                async with httpx.AsyncClient(timeout=20) as probe_client:
                    probe = await probe_client.post(
                        chat_url,
                        headers={
                            "Authorization": f"Bearer {sanitize_api_key(api_key)}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": probe_model,
                            "messages": [{"role": "user", "content": "ping"}],
                            "max_tokens": 1,
                        },
                    )
                probe_text = (probe.text or "").lower()
                if probe.status_code in (401, 403) or "authentication failed" in probe_text or "invalid api key" in probe_text or "incorrect api key" in probe_text:
                    return {
                        "ok": False,
                        "status": probe.status_code,
                        "message": "请求地址可以打开，模型列表也不检查 Key。当前这把 Key 被上游拒绝了，请重新复制 Access Token，粘贴后保存再验证。",
                        "model_count": len(ids),
                    }
        except httpx.HTTPError:
            pass

        return {
            "ok": True,
            "status": resp.status_code,
            "model_count": len(ids),
            "image_models": grouped["image"],
            "chat_models": grouped["chat"],
            "video_models": grouped["video"],
            "all": ids
        }
    except httpx.HTTPError as e:
        return {"ok": False, "status": 0, "message": str(e)[:300]}


@router.post("/api/providers/probe-async")
async def probe_async_endpoint(payload: TestConnectionPayload):
    """验证异步协议:用假 task_id 请求 GET /v1/tasks/{fake_id}"""
    base_url = (payload.base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")

    api_key = (payload.api_key or "").strip()
    if any(ch in api_key for ch in ("•", "…", "****")):
        api_key = ""
    if not api_key and payload.provider_id:
        api_key = _main.read_api_env_value(provider_key_env(payload.provider_id))

    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")

    tasks_base = base_url if base_url.endswith("/v1") else f"{base_url}/v1"
    probe_url = f"{tasks_base}/tasks/healthcheck_probe_do_not_submit"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(probe_url, headers={
                "Authorization": f"Bearer {sanitize_api_key(api_key)}",
                "Accept": "application/json"
            })

        try:
            body = resp.json()
        except Exception:
            body = resp.text[:500]

        sc = resp.status_code
        err_msg = ""
        if isinstance(body, dict):
            err = body.get("error") or {}
            if isinstance(err, dict):
                err_msg = str(err.get("message") or "").lower()
            else:
                err_msg = str(err).lower()

        if sc == 400 and "invalid task id" in err_msg:
            return {"ok": True, "status_code": sc, "message": "异步任务端点可用,API Key 已通过认证", "raw": body}

        if sc in (401, 403):
            return {"ok": False, "status_code": sc, "message": "API Key 无效或无权限", "raw": body}

        if sc == 404:
            return {"ok": False, "status_code": sc, "message": "平台不支持 /v1/tasks/ 端点,可能不是 APIMart 异步协议", "raw": body}

        if 400 <= sc < 500:
            return {"ok": None, "status_code": sc, "message": f"端点返回 {sc},请查看原始响应判断", "raw": body}

        if sc < 300:
            return {"ok": True, "status_code": sc, "message": f"端点返回 {sc}(意外成功)", "raw": body}

        return {"ok": False, "status_code": sc, "message": f"服务端错误 {sc}", "raw": body}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e)[:300])


@router.post("/api/providers/fetch-models")
async def fetch_upstream_models_from_payload(payload: TestConnectionPayload):
    """按页面当前表单值拉取模型"""
    api_key = (payload.api_key or "").strip()
    if any(ch in api_key for ch in ("•", "…", "****")):
        api_key = ""
    if not api_key and payload.provider_id:
        api_key = _main.read_api_env_value(provider_key_env(payload.provider_id))
    return await fetch_models_from_upstream(payload.base_url, api_key)


@router.get("/api/providers/{provider_id}/fetch-models")
async def fetch_upstream_models(provider_id: str):
    """从已保存的上游接口拉取模型列表"""
    provider = _main.get_api_provider_exact(provider_id)
    api_key = _main.read_api_env_value(provider_key_env(provider["id"]))
    if not api_key:
        raise HTTPException(status_code=400, detail=f"{provider.get('name') or provider_id} 未配置 API Key")
    return await fetch_models_from_upstream(provider.get("base_url") or "", api_key)


@router.get("/api/cache/info")
async def api_cache_info():
    """获取缩略图缓存信息"""
    if not os.path.isdir(_main.MEDIA_PREVIEW_DIR):
        return {"count": 0, "size": 0}
    total_size = 0
    count = 0
    for f in os.listdir(_main.MEDIA_PREVIEW_DIR):
        fp = os.path.join(_main.MEDIA_PREVIEW_DIR, f)
        if os.path.isfile(fp):
            total_size += os.path.getsize(fp)
            count += 1
    return {"count": count, "size": total_size}


@router.post("/api/cache/clear")
async def api_cache_clear():
    """清理缩略图缓存"""
    if not os.path.isdir(_main.MEDIA_PREVIEW_DIR):
        return {"message": "缓存目录不存在,无需清理", "cleared": 0}
    count = 0
    for f in os.listdir(_main.MEDIA_PREVIEW_DIR):
        fp = os.path.join(_main.MEDIA_PREVIEW_DIR, f)
        try:
            if os.path.isfile(fp):
                os.remove(fp)
                count += 1
        except OSError:
            pass
    return {"message": f"已清理 {count} 个缓存文件", "cleared": count}


@router.get("/api/media-registry")
async def media_registry():
    """生成物落盘的目录注册表：类型列表 + 每个 feature 的展示信息。

    前端据此决定落盘 feature、画廊分类与筛选项，新增模型不必再改三元链。
    """
    from core import media_paths
    return media_paths.public_registry()
