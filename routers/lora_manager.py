"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/lora-manager
"""
from fastapi import HTTPException
from starlette.responses import Response
import hashlib, httpx, json, os
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/api/lora-manager/loras")
async def proxy_lora_manager_list():
    """代理 LoRA Manager 的 LoRA 列表,自动遍历所有分页返回完整数据。
    增强:对每条 LoRA 读取其 file_path 旁边的 .metadata.json 文件,
    把 civitai / preview_nsfw_level / trainedWords / model_name / tags
    合并到 item(这些是 ComfyUI 拖入 LoRA 时自动写入的本地元数据,权威性更高)"""
    target = _main.COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    def _enrich_with_metadata_json(items):
        """对每条 item,若 file_path 旁边有 .metadata.json,合并本地元数据"""
        for it in items:
            try:
                fp = it.get("file_path")
                if not fp or not os.path.isfile(fp):
                    continue
                meta_path = os.path.splitext(fp)[0] + ".metadata.json"
                if not os.path.isfile(meta_path):
                    continue
                with open(meta_path, 'r', encoding='utf-8') as f:
                    md = json.load(f)
                if md.get("civitai"):
                    it["civitai"] = md["civitai"]
                if md.get("preview_nsfw_level") is not None:
                    it["preview_nsfw_level"] = md["preview_nsfw_level"]
                if md.get("trainedWords") and not it.get("trainedWords"):
                    it["trainedWords"] = md["trainedWords"]
                if md.get("tags") and not it.get("tags"):
                    it["tags"] = md["tags"]
                # 后端已翻译的中文描述(modelDescription_zh 优先,translated_description 兼容)
                if md.get("modelDescription_zh"):
                    it["modelDescription_zh"] = md["modelDescription_zh"]
                elif md.get("translated_description"):
                    it["translated_description"] = md["translated_description"]
                # 英文描述(modelDescription 不为空时也转发,供前端备用)
                if md.get("modelDescription") and not it.get("model_name"):
                    # 只转发,不做覆盖
                    pass
                # 文件元数据(用于弹出详情面板)
                if md.get("size") and not it.get("size"):
                    it["size"] = md["size"]
                if md.get("modified") and not it.get("modified"):
                    it["modified"] = md["modified"]
                if md.get("sha256") and not it.get("sha256"):
                    it["sha256"] = md["sha256"]
                if md.get("file_name") and not it.get("file_name"):
                    it["file_name"] = md["file_name"]
                if not it.get("model_name"):
                    if md.get("model_name"):
                        it["model_name"] = md["model_name"]
                    elif md.get("civitai") and md["civitai"].get("model") and md["civitai"]["model"].get("name"):
                        it["model_name"] = md["civitai"]["model"]["name"]
                if not it.get("base_model") and md.get("base_model"):
                    it["base_model"] = md["base_model"]
            except Exception:
                continue
        return items
    try:
        all_items = []
        page = 1
        total_pages = 1
        async with httpx.AsyncClient(timeout=60) as client:
            while page <= total_pages and page <= 30:  # 最多 30 页 = 3000 个 LoRA
                url = f"http://{target}/api/lm/loras/list?page={page}&page_size=100"
                resp = await client.get(url)
                if resp.status_code != 200:
                    _enrich_with_metadata_json(all_items)
                    return {"items": all_items, "total": len(all_items), "error": f"LoRA Manager 返回 {resp.status_code}"}
                data = resp.json()
                items = data.get("items", [])
                all_items.extend(items)
                total_pages = data.get("total_pages", 1)
                if not items:
                    break
                page += 1
        _enrich_with_metadata_json(all_items)
        return {"items": all_items, "total": len(all_items), "page": 1, "page_size": len(all_items), "total_pages": 1}
    except Exception as e:
        return {"items": [], "error": str(e)}


@router.post("/api/lora-manager/fetch-all-civitai")
async def proxy_lora_manager_fetch_all_civitai():
    """触发 LoRA Manager 批量从 civitai 拉取元数据(用于补全 tags)"""
    target = _main.COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        url = f"http://{target}/api/lm/loras/fetch-all-civitai"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={})
        return Response(content=resp.content, media_type="application/json", status_code=resp.status_code)
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/api/lora-manager/tags-stats")
async def proxy_lora_manager_tags_stats():
    """统计 LoRA Manager 中各 tag 大类的 LoRA 数量"""
    target = _main.COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        all_items = []
        page = 1
        total_pages = 1
        async with httpx.AsyncClient(timeout=60) as client:
            while page <= total_pages and page <= 30:
                url = f"http://{target}/api/lm/loras/list?page={page}&page_size=100"
                resp = await client.get(url)
                if resp.status_code != 200:
                    return {"tags": {}, "total": 0, "error": f"LoRA Manager 返回 {resp.status_code}"}
                data = resp.json()
                items = data.get("items", [])
                all_items.extend(items)
                total_pages = data.get("total_pages", 1)
                if not items:
                    break
                page += 1
        # 统计每个 tag 的 LoRA 数量
        tag_count = {}
        for it in all_items:
            for t in (it.get("tags") or []):
                if isinstance(t, str):
                    tag_count[t] = tag_count.get(t, 0) + 1
        # 排序返回 top 200
        top_tags = sorted(tag_count.items(), key=lambda x: -x[1])[:200]
        return {"tags": dict(top_tags), "total_loras": len(all_items), "tagged_loras": sum(1 for it in all_items if it.get("tags"))}
    except Exception as e:
        return {"tags": {}, "total": 0, "error": str(e)}

@router.get("/api/lora-manager/preview")
async def proxy_lora_manager_preview(name: str):
    """获取 LoRA 封面图"""
    target = _main.COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        url = f"http://{target}/api/lm/loras/preview-url"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params={"name": name})
        if resp.status_code == 200:
            data = resp.json()
            preview_url = data.get("url", "")
            if preview_url:
                # 如果是相对路径,拼上 ComfyUI 地址
                if preview_url.startswith("/"):
                    preview_url = f"http://{target}{preview_url}"
                return {"url": preview_url}
        return {"url": ""}
    except Exception as e:
        return {"url": "", "error": str(e)}

@router.get("/api/lora-manager/proxy-preview")
async def proxy_lora_manager_preview_proxy(url: str):
    """代理 LoRA Manager 的预览图请求(转发到 ComfyUI)"""
    target = _main.COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        # url 是相对路径如 /api/lm/previews?path=...
        full_url = f"http://{target}{url}" if url.startswith("/") else url
        # 生成 ETag 基于 URL
        etag = hashlib.md5(full_url.encode()).hexdigest()
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(full_url)
        if resp.status_code == 200:
            ct = resp.headers.get("content-type", "image/jpeg")
            return Response(
                content=resp.content,
                media_type=ct,
                headers={
                    "Cache-Control": "public, max-age=604800, immutable",
                    "ETag": f'"{etag}"',
                }
            )
        raise HTTPException(status_code=resp.status_code, detail="预览图获取失败")
    except httpx.HTTPStatusError:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"代理预览图失败: {str(e)}")

@router.get("/api/lora-manager/metadata")
async def proxy_lora_manager_metadata(name: str):
    """获取 LoRA 元数据(触发词、基础模型、描述等)"""
    target = _main.COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        url = f"http://{target}/api/lm/loras/metadata"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params={"name": name})
        if resp.status_code == 200:
            return Response(content=resp.content, media_type="application/json")
        return {"metadata": {}}
    except Exception as e:
        return {"metadata": {}, "error": str(e)}

@router.get("/api/lora-manager/trigger-words")
async def proxy_lora_manager_trigger_words(name: str):
    """获取 LoRA 触发词"""
    target = _main.COMFYUI_ADDRESS
    if not target:
        raise HTTPException(status_code=503, detail="未配置 ComfyUI 地址")
    try:
        url = f"http://{target}/api/lm/loras/get-trigger-words"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params={"name": name})
        if resp.status_code == 200:
            return Response(content=resp.content, media_type="application/json")
        return {"triggerWords": []}
    except Exception as e:
        return {"triggerWords": [], "error": str(e)}
