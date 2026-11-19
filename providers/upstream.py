"""OpenAI-compatible model discovery without importing the application entry point."""
import re

import httpx
from fastapi import HTTPException

from tools.api_compat import api_root, is_cloudflare, model_items, models_endpoint, sanitize_api_key


def group_models(items):
    """Prefer declared capabilities, falling back to legacy model-name inference."""
    ids = []
    for it in items:
        if isinstance(it, str):
            ids.append(it)
        elif isinstance(it, dict):
            mid = it.get("id") or it.get("name") or it.get("model")
            if mid:
                ids.append(str(mid))

    ids = sorted(set(ids))

    from tools.webai_gateway import model_catalog
    capabilities = model_catalog(items)
    # 优先使用上游声明的类型，兼容没有类型的普通 OpenAI 平台。
    def classify(mid):
        explicit = capabilities.get(mid, {}).get("type")
        if explicit:
            return explicit
        lc = mid.lower()
        video_keys = ["veo", "sora", "wan2", "wanx", "doubao-seedance", "doubao-1", "kling", "hailuo", "video", "t2v-", "i2v-", "s2v"]
        if any(k in lc for k in video_keys):
            return "video"
        image_keys = ["image", "dalle", "dall-e", "imagen", "flux", "stable", "sdxl", "midjourney", "nano-banana", "ideogram", "fal-ai", "z-image", "qwen-image", "klein"]
        if any(k in lc for k in image_keys):
            return "image"
        return "chat"

    grouped = {"image": [], "chat": [], "video": []}
    for mid in ids:
        grouped[classify(mid)].append(mid)

    return {
        "total": len(ids),
        "model_capabilities": capabilities,
        "image_models": grouped["image"],
        "chat_models": grouped["chat"],
        "video_models": grouped["video"],
        "all": ids
    }


async def fetch_models_from_upstream(base_url: str, api_key: str, refresh: bool = False, model: str = ""):
    """从 OpenAI 兼容 /v1/models 端点拉取模型"""
    base_url = (base_url or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=400, detail="请先填写请求地址")

    if not re.match(r"^https?://", base_url):
        raise HTTPException(status_code=400, detail="请求地址必须以 http:// 或 https:// 开头")

    api_key = (api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写或保存 API Key")

    url = models_endpoint(base_url)
    if refresh:
        from urllib.parse import urlencode
        url += ("&" if "?" in url else "?") + urlencode({"refresh": "true", "model": model})

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers={
                "Authorization": f"Bearer {sanitize_api_key(api_key)}",
                "Accept": "application/json"
            })
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=f"上游 /v1/models 失败:{resp.text[:300]}")
            raw = resp.json()
            if is_cloudflare(api_root(base_url)):
                collected = model_items(raw, cloudflare=True)
                pages = int((raw.get("result_info") or {}).get("total_pages") or 1)
                for page in range(2, pages + 1):
                    next_resp = await client.get(url + f"&page={page}", headers={
                        "Authorization": f"Bearer {sanitize_api_key(api_key)}", "Accept": "application/json"})
                    next_resp.raise_for_status()
                    collected.extend(model_items(next_resp.json(), cloudflare=True))
                raw = {"data": collected}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"请求上游模型列表失败:{e}") from e

    items = model_items(raw)

    return group_models(items)


