"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/lora-manager
"""
from fastapi import HTTPException
from starlette.responses import Response
from starlette.concurrency import run_in_threadpool
import hashlib, httpx, json, os, asyncio, time
from collections import OrderedDict
from fastapi import APIRouter

import main as _main

router = APIRouter()
_list_cache = None
_list_lock = asyncio.Lock()


@router.get("/api/lora-manager/loras")
async def proxy_lora_manager_list():
    # ponytail: 主机共用短缓存，访客同时刷新只拉取一次；不缓存错误或不完整结果。
    global _list_cache
    target = _main.COMFYUI_ADDRESS
    async with _list_lock:
        if _list_cache and _list_cache[0] == target and time.monotonic() < _list_cache[1]:
            return _list_cache[2]
        result = await _fetch_lora_manager_list()
        if not result.get('error'):
            _list_cache = (target, time.monotonic() + 30, result)
        return result


async def _fetch_lora_manager_list():
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
        async with httpx.AsyncClient(timeout=60, verify=_main.COMFY_HTTP_SSL_CONTEXT, trust_env=False) as client:
            while page <= total_pages and page <= 30:  # 最多 30 页 = 3000 个 LoRA
                url = f"http://{target}/api/lm/loras/list?page={page}&page_size=100"
                resp = await client.get(url)
                if resp.status_code != 200:
                    await run_in_threadpool(_enrich_with_metadata_json, all_items)
                    return {"items": all_items, "total": len(all_items), "error": f"LoRA Manager 返回 {resp.status_code}"}
                data = resp.json()
                items = data.get("items", [])
                all_items.extend(items)
                total_pages = data.get("total_pages", 1)
                if not items:
                    break
                page += 1
        await run_in_threadpool(_enrich_with_metadata_json, all_items)
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


# ─────────────────────────────────────────────────────────────
# Civitai 例图（showcase images）
# 卡片上的「例图」按钮 → 右侧抽屉瀑布流展示该 LoRA 的官方示例图
# ─────────────────────────────────────────────────────────────
import re as _re

_CIVITAI_IMG_RE = _re.compile(
    r"^(https://image\.civitai\.com/[^/]+/[^/]+)/.*?/([^/]+?)\.([A-Za-z0-9]+)$"
)
_examples_cache: dict = {}      # model_id -> (expire_ts, payload)
_EXAMPLES_TTL = 600             # 10 分钟
_NSFW_LEVEL_MAP = {"none": 1, "pg": 1, "pg13": 2, "soft": 2, "mature": 4, "m": 4, "r": 8, "x": 16, "xxx": 32}
_model_cache: dict = {}         # model_id -> (expire_ts, {name, versions})


def _civitai_thumb(url: str, width: int = 450) -> str:
    """把 Civitai 原始图/视频 URL 转成指定宽度的 jpeg 缩略图 URL。
    注意：扩展名必须保持原样（视频保留 .mp4），CDN 会按 anim=false 转成 jpeg，
    若把视频扩展名改写成 .jpeg 反而会回退返回原始 mp4。"""
    m = _CIVITAI_IMG_RE.match(url or "")
    if not m:
        return url or ""
    return f"{m.group(1)}/anim=false,width={width},optimized=true/{m.group(2)}.{m.group(3)}"


def _nsfw_to_num(v) -> int:
    """Civitai 的 nsfwLevel 有时是数字（PG=1/Soft=2/M=4/X=16），有时是字符串（Soft/Mature/X）"""
    if isinstance(v, int):
        return v
    s = str(v or "").strip()
    if s.isdigit():
        return int(s)
    return _NSFW_LEVEL_MAP.get(s.lower(), 0)


async def _civitai_model_info(model_id: int):
    """取 Civitai 模型基础信息（名称 + 版本列表），10 分钟缓存"""
    now = time.time()
    hit = _model_cache.get(model_id)
    if hit and hit[0] > now:
        return hit[1]
    try:
        async with httpx.AsyncClient(timeout=25, trust_env=False, follow_redirects=True) as client:
            resp = await client.get(f"https://civitai.com/api/v1/models/{model_id}")
        if resp.status_code != 200:
            return None
        data = resp.json()
    except Exception:
        return None
    info = {
        "name": data.get("name") or "",
        "versions": [
            {"id": v.get("id") or 0, "name": v.get("name") or "", "baseModel": v.get("baseModel") or ""}
            for v in (data.get("modelVersions") or [])
        ],
    }
    _model_cache[model_id] = (now + _EXAMPLES_TTL, info)
    if len(_model_cache) > 500:
        for k in list(_model_cache.keys())[:200]:
            _model_cache.pop(k, None)
    return info


@router.get("/api/lora-manager/examples")
async def lora_manager_examples(model_id: int, version_id: int = 0, allow_nsfw: int = 0, limit: int = 60):
    """返回某个 LoRA 版本的例图（走 Civitai images 端点，官方图 + 社区生成图，按点赞排序）
    allow_nsfw=0 时只取 Soft 及以下级别；结果 10 分钟缓存。"""
    if not model_id:
        raise HTTPException(status_code=400, detail="缺少 model_id")

    info = await _civitai_model_info(model_id)
    if not info:
        return {"images": [], "total": 0, "error": "Civitai 模型信息获取失败"}
    versions = info["versions"]
    vid = int(version_id or 0) or (versions[0]["id"] if versions else 0)
    vname = next((v["name"] for v in versions if v["id"] == vid), "")

    key = (vid, 1 if allow_nsfw else 0)
    now = time.time()
    hit = _examples_cache.get(key)
    if hit and hit[0] > now:
        images = hit[1]
    else:
        params = {
            "modelVersionId": vid,
            "limit": max(1, min(int(limit or 60), 100)),
            "sort": "Most Reactions",
            "nsfw": "X" if allow_nsfw else "Soft",
        }
        try:
            async with httpx.AsyncClient(timeout=25, trust_env=False, follow_redirects=True) as client:
                resp = await client.get("https://civitai.com/api/v1/images", params=params)
            if resp.status_code != 200:
                return {"images": [], "total": 0, "error": f"Civitai 返回 {resp.status_code}"}
            items = resp.json().get("items") or []
        except Exception as e:
            return {"images": [], "total": 0, "error": str(e)}

        images, seen = [], set()
        for im in items:
            u = im.get("url") or ""
            if not u or u in seen:
                continue
            seen.add(u)
            images.append({
                "id": im.get("id"),
                "thumb": _civitai_thumb(u, 450),
                "full": _civitai_thumb(u, 1200),
                "w": im.get("width") or 0,
                "h": im.get("height") or 0,
                "type": im.get("type") or "image",
                "nsfw": _nsfw_to_num(im.get("nsfwLevel")),
                "user": im.get("username") or "",
                "likes": int((im.get("stats") or {}).get("likeCount") or 0),
            })
        if not allow_nsfw:
            images = [i for i in images if i["nsfw"] < 4]
        _examples_cache[key] = (now + _EXAMPLES_TTL, images)
        if len(_examples_cache) > 500:
            for k in list(_examples_cache.keys())[:200]:
                _examples_cache.pop(k, None)

    return {
        "modelId": model_id,
        "name": info["name"],
        "versionId": vid,
        "version": vname,
        "total": len(images),
        "images": images,
        "source": "civitai-images",
        "versions": [{"id": v["id"], "name": v["name"]} for v in versions],
    }


# ── 图片代理：内存 LRU + 磁盘缓存 + WebP 二次压缩 ──────────────
_IMG_CACHE_DIR = os.path.join(_main.USER_DATA_DIR, "cache", "civitai-img")
_IMG_MEM: "OrderedDict[str, tuple[bytes, str]]" = OrderedDict()
_IMG_MEM_MAX = 300                     # 最多 300 张（约 10~15MB）
_IMG_FETCH_SEM = asyncio.Semaphore(8)  # 限制对 Civitai 的并发下载
_IMG_INFLIGHT: dict = {}               # key -> asyncio.Future，避免同一张图重复下载
_IMG_CLIENT: "httpx.AsyncClient | None" = None


def _get_img_client() -> httpx.AsyncClient:
    global _IMG_CLIENT
    if _IMG_CLIENT is None or _IMG_CLIENT.is_closed:
        _IMG_CLIENT = httpx.AsyncClient(
            timeout=30,
            trust_env=False,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=16, max_keepalive_connections=16),
        )
    return _IMG_CLIENT


def _img_mem_put(key: str, content: bytes, media_type: str) -> None:
    _IMG_MEM[key] = (content, media_type)
    _IMG_MEM.move_to_end(key)
    while len(_IMG_MEM) > _IMG_MEM_MAX:
        _IMG_MEM.popitem(last=False)


def _img_cache_path(key: str) -> str:
    return os.path.join(_IMG_CACHE_DIR, key[:2], key + ".bin")


def _shrink_to_webp(raw: bytes, max_w: int) -> tuple[bytes, str]:
    """把原图缩到 max_w 宽并转 WebP（体积通常只有原图 1/6）。
    失败时原样返回，不影响可用性。"""
    try:
        import io
        from PIL import Image
        img = Image.open(io.BytesIO(raw))
        if img.width > max_w:
            nh = max(1, round(img.height * max_w / img.width))
            img = img.resize((max_w, nh), Image.LANCZOS)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")
        out = io.BytesIO()
        img.save(out, format="WEBP", quality=78, method=4)
        data = out.getvalue()
        return (data, "image/webp") if data else (raw, "image/jpeg")
    except Exception:
        return raw, "image/jpeg"


@router.get("/api/lora-manager/civitai-img")
async def proxy_civitai_image(u: str, w: int = 360):
    """代理 Civitai 图片：内存 LRU → 磁盘缓存 → 回源（并发限流 + 去重 + WebP 压缩）"""
    if not u.startswith("https://image.civitai.com/"):
        raise HTTPException(status_code=400, detail="非法图片地址")
    w = max(80, min(int(w or 360), 1600))
    target_url = _civitai_thumb(u, w) if w else u
    key = hashlib.md5(target_url.encode()).hexdigest()
    headers = {
        "Cache-Control": "public, max-age=2592000, immutable",
        "ETag": f'"{key}"',
    }

    # 1) 内存
    hit = _IMG_MEM.get(key)
    if hit:
        _IMG_MEM.move_to_end(key)
        return Response(content=hit[0], media_type=hit[1], headers=headers)

    # 2) 磁盘
    path = _img_cache_path(key)
    if os.path.isfile(path):
        try:
            with open(path, "rb") as f:
                content = f.read()
            if content:
                _img_mem_put(key, content, "image/webp")
                return Response(content=content, media_type="image/webp", headers=headers)
        except Exception:
            pass

    # 3) 回源（同一 key 并发只下载一次）
    fut = _IMG_INFLIGHT.get(key)
    if fut is None:
        fut = asyncio.get_running_loop().create_future()
        _IMG_INFLIGHT[key] = fut
        try:
            async with _IMG_FETCH_SEM:
                resp = await _get_img_client().get(target_url)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="图片获取失败")
            content, mt = await run_in_threadpool(_shrink_to_webp, resp.content, w)
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "wb") as f:
                    f.write(content)
            except Exception:
                pass
            _img_mem_put(key, content, mt)
            fut.set_result((content, mt))
        except Exception as e:
            fut.set_exception(e)
        finally:
            _IMG_INFLIGHT.pop(key, None)

    try:
        content, mt = await fut
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"代理图片失败: {e}")
    return Response(content=content, media_type=mt, headers=headers)
