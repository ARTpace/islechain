"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/prompt-libraries
"""
from fastapi import HTTPException
import os
import re
import threading
import uuid
from fastapi import APIRouter

import main as _main
from core import preset_manager

router = APIRouter()


# === 系统提示词库（只读真源）===
# 数据来自已安装风格包及用户增量层 —— 与生成页「风格预设」同一份数据，
# 保证两处看到的风格提示词完全一致。2.2 万条不可能一次性下发，
# 这里产出精简索引 + 服务端分页查询。
_STYLE_CATALOG_CACHE = {"source": None, "catalog": None}

# 旧风格包把摄影全放在同名子类；仅在展示索引中按标题补充分组，不改包内容。
_PHOTO_GROUPS = [
    ("food", "美食饮品", r"美食|食物|饮品|咖啡|甜品|蛋糕|菜肴|餐饮|水果|food|drink|cuisine"),
    ("product", "产品静物", r"产品|商品|静物|香水|化妆品|护肤|珠宝|首饰|手表|腕表|瓶|product|still.life|jewelry"),
    ("architecture", "建筑空间", r"建筑|室内|家居|客厅|卧室|酒店|空间|architecture|interior"),
    ("nature", "自然风景", r"风景|山水|雪山|山川|森林|海滩|海岸|日落|日出|星空|landscape|scenery|nature"),
    ("animal", "动物宠物", r"宠物|动物|猫|狗|鸟|狐狸|熊猫|animal|pet\b|cat\b|dog\b"),
    ("fashion", "时尚服饰", r"时尚|服饰|穿搭|服装|汉服|礼服|婚纱|杂志|fashion|editorial"),
    ("sport", "运动汽车", r"运动|体育|足球|篮球|赛车|汽车|跑车|摩托|sport|automotive|car\b"),
    ("street", "街头旅行", r"街头|街拍|旅行|旅游|城市|纪实|street|travel|documentary"),
    ("portrait", "人物肖像", r"人像|人物|肖像|写真|自拍|女孩|少女|美女|女性|男孩|男性|情侣|夫妻|儿童|宝宝|portrait|woman|girl|man\b|boy"),
];


def _display_style_subcategory(preset, category, subcategory):
    if category != "photography" or subcategory != category:
        return subcategory, ""
    title = str(preset.get("name") or "")
    for key, label, pattern in _PHOTO_GROUPS:
        if re.search(pattern, title, re.I):
            return "photography-" + key, label
    return "photography-other", "其他摄影"


def _style_source(preset):
    """来源只表达平台/预设集合；使用说明仍保留在原 description 中。"""
    structured = preset.get('source')
    provider = structured.get('provider') if isinstance(structured, dict) else ''
    value = str(provider or preset.get('description') or '').strip()
    if not value:
        return '未标注来源'
    head = re.split(r'\s*[·｜|]\s*', value, maxsplit=1)[0].strip().casefold()
    aliases = {
        'chatgpt': 'ChatGPT', 'openai': 'ChatGPT',
        'nano banana': 'Nano Banana', 'nano banana pro': 'Nano Banana', 'nano banana 2': 'Nano Banana',
        'promptimageatlas': 'PromptImageAtlas', 'pia': 'PromptImageAtlas',
        '腾讯元宝': '腾讯元宝', 'yuanbao': '腾讯元宝',
        'comfyui style': 'ComfyUI', 'comfyui': 'ComfyUI',
        'grok': 'Grok', '即梦': '即梦', '通义z-image-turbo': '通义 Z-Image',
        'fooocus 官方风格': 'Fooocus', 'fooocus': 'Fooocus',
        'opennana': 'OpenNana', 'ccprompt': 'CCPrompt', 'promptsref': 'PromptsRef',
        'manual': '手动创建', 'self': '手动创建',
        'sai 风格 风格': '风格预设', 'diva 电影感 风格': '风格预设',
        'marc k3nt3l 风格': '风格预设', 'twri sdxl 风格': '风格预设', 'mre 风格 风格': '风格预设',
    }
    return aliases.get(head, '其他来源')


def _slim_style_item(preset, cat_id, sub_id, index):
    # 正文给全文：一页 150 条约 400KB，本地访问无压力；
    # 截断过会导致「搜索命中不到长尾词 + 弹窗要二次补全文」两个麻烦。
    return {
        "id": preset.get("id") or "",
        "name": preset.get("name") or "",
        "category": cat_id,
        "subcategory": sub_id,
        "scene": "",
        "positive": preset.get("prompt") or "",
        "negative": preset.get("negative_prompt") or "",
        "params": {"来源": _style_source(preset), "来源说明": preset.get("description") or ""},
        "thumbnail": preset.get("thumbnail") or "",
        "readonly": True,
        "created_at": index,
        "updated_at": 0,
    }


def _style_catalog():
    """构建（并缓存）系统库索引：分类树 + 精简条目 + id→原文映射。"""
    # preset_manager 已按风格包及增量层签名缓存；复用其数据身份，避免只监测旧单文件。
    data = preset_manager.get_style_presets()
    cached = _STYLE_CATALOG_CACHE.get("catalog")
    if cached is not None and _STYLE_CATALOG_CACHE.get("source") is data:
        return cached

    items = []
    by_id = {}
    categories = []
    source_counts = {}
    index = 0
    for cat in data.get("categories") or []:
        cat_id = str(cat.get("id") or "")
        if not cat_id:
            continue
        cat_count = 0
        subcategories = {}
        for sub in cat.get("subcategories") or []:
            sub_id = str(sub.get("id") or "")
            for preset in sub.get("presets") or []:
                pid = str(preset.get("id") or "")
                if not pid:
                    continue
                display_sub_id, display_sub_name = _display_style_subcategory(preset, cat_id, sub_id)
                slim = _slim_style_item(preset, cat_id, display_sub_id, index)
                items.append(slim)
                by_id[pid] = preset
                index += 1
                cat_count += 1
                if display_sub_id:
                    group = subcategories.setdefault(display_sub_id, {"id": display_sub_id, "name": display_sub_name or sub.get("name") or display_sub_id, "count": 0})
                    group["count"] += 1
                src = slim["params"]["来源"]
                if src:
                    source_counts[src] = source_counts.get(src, 0) + 1
        categories.append({"id": cat_id, "name": cat.get("name") or cat_id, "count": cat_count, "subcategories": list(subcategories.values())})

    catalog = {
        "items": items,
        "by_id": by_id,
        "categories": categories,
        "sources": sorted(source_counts.items(), key=lambda kv: -kv[1]),
        "total": len(items),
    }
    _STYLE_CATALOG_CACHE["source"] = data
    _STYLE_CATALOG_CACHE["catalog"] = catalog
    return catalog


def _system_library_payload():
    catalog = _style_catalog()
    return {
        "id": "system",
        "name": "系统提示词库",
        "system": True,
        "readonly": True,
        "type": "prompt",
        "paged": True,
        "categories": catalog["categories"],
        "items": [],
        "total": catalog["total"],
        "sources": [{"id": name, "count": count} for name, count in catalog["sources"]],
    }


def _apply_style_catalog(data):
    """用真源替换 system 库（其余个人库原样保留）。"""
    libraries = data.get("libraries") or []
    replaced = False
    out = []
    for lib in libraries:
        if isinstance(lib, dict) and lib.get("id") == "system":
            replaced = True
            out.append(_system_library_payload())
        else:
            out.append(lib)
    if not replaced:
        out.insert(0, _system_library_payload())
    data["libraries"] = out
    return data


@router.get("/api/prompt-libraries")
async def get_prompt_libraries():
    return {"library": _apply_style_catalog(_main.public_prompt_libraries())}


@router.get("/api/prompt-libraries/items")
def list_style_prompt_items(category: str = "", source: str = "", q: str = "", sort: str = "random", seed: str = "", offset: int = 0, limit: int = 120, subcategory: str = ""):
    """系统库分页查询：分类 / 来源 / 关键词 / 排序。"""
    import hashlib

    catalog = _style_catalog()
    pool = catalog["items"]
    if category and category != "all":
        pool = [item for item in pool if item["category"] == category]
    if subcategory:
        pool = [item for item in pool if item["subcategory"] == subcategory]
    if source:
        normalized_source = source if source in {'其他来源', '未标注来源', '风格预设', '通义 Z-Image', '手动创建'} else _style_source({'description': source})
        pool = [item for item in pool if item["params"]["来源"] == normalized_source]
    tokens = [token for token in (q or "").lower().split() if token]
    if tokens:
        def match(item):
            hay = " ".join([
                item.get("name") or "", item.get("positive") or "",
                item.get("negative") or "", item["params"]["来源"] or "",
                item["params"].get("来源说明") or "",
            ]).lower()
            return all(token in hay for token in tokens)
        pool = [item for item in pool if match(item)]

    if sort == "name":
        pool = sorted(pool, key=lambda item: item.get("name") or "")
    elif sort == "newest":
        pool = list(reversed(pool))
    elif sort == "random":
        # 用 seed 做确定性散列，保证翻页时顺序稳定、不漏不重
        key = (seed or "0").encode("utf-8")

        def weight(item):
            return hashlib.md5(item["id"].encode("utf-8") + key).hexdigest()

        pool = sorted(pool, key=weight)

    total = len(pool)
    offset = max(0, offset)
    limit = max(1, min(500, limit))
    return {
        "items": pool[offset:offset + limit],
        "total": total,
        "offset": offset,
        "limit": limit,
        "has_more": offset + limit < total,
    }


@router.get("/api/prompt-libraries/item/{item_id}")
def get_style_prompt_item(item_id: str):
    """取单条全文（列表下发的是截断版本）。"""
    preset = _style_catalog()["by_id"].get(item_id)
    if not preset:
        raise HTTPException(status_code=404, detail="提示词不存在")
    return {
        "id": preset.get("id"),
        "name": preset.get("name") or "",
        "positive": preset.get("prompt") or "",
        "negative": preset.get("negative_prompt") or "",
        "source": _style_source(preset),
        "source_description": preset.get("description") or "",
        "thumbnail": preset.get("thumbnail") or "",
    }


@router.post("/api/prompt-libraries")
async def create_prompt_library(payload: _main.PromptLibraryRequest):
    data = _main.load_prompt_libraries()
    library = {
        "id": f"lib_{uuid.uuid4().hex[:12]}",
        "name": _main.sanitize_asset_name(payload.name, "提示词库"),
        "type": "prompt",
        "categories": [],
        "items": [],
    }
    data.setdefault("libraries", []).append(library)
    data["active_library_id"] = library["id"]
    data = _main.save_prompt_libraries(data)
    new_lib = next((lib for lib in data.get("libraries", []) if lib.get("id") == library["id"]), library)
    return {"library": _main.public_prompt_libraries(data), "prompt_library": new_lib}

@router.patch("/api/prompt-libraries/{library_id}")
async def rename_prompt_library(library_id: str, payload: _main.PromptLibraryRequest):
    data = _main.load_prompt_libraries()
    library = _main.find_prompt_library(data, library_id)
    if not library or library.get("id") != library_id:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    library["name"] = _main.sanitize_asset_name(payload.name, library.get("name") or "提示词库")
    data = _main.save_prompt_libraries(data)
    return {"library": _main.public_prompt_libraries(data), "prompt_library": library}

@router.delete("/api/prompt-libraries/{library_id}")
async def delete_prompt_library(library_id: str):
    if library_id == "system":
        raise HTTPException(status_code=400, detail="系统提示词库不能删除,可以删除其中的提示词")
    data = _main.load_prompt_libraries()
    libraries = data.get("libraries", []) or []
    kept = [lib for lib in libraries if lib.get("id") != library_id]
    if len(kept) == len(libraries):
        raise HTTPException(status_code=404, detail="提示词库不存在")
    data["libraries"] = kept
    if data.get("active_library_id") == library_id:
        data["active_library_id"] = "system"
    data = _main.save_prompt_libraries(data)
    return {"library": _main.public_prompt_libraries(data)}

@router.post("/api/prompt-libraries/items")
async def add_prompt_library_item(payload: _main.PromptLibraryItemRequest):
    data = _main.load_prompt_libraries()
    library = _main.find_prompt_library(data, payload.library_id)
    if not library:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    if not str(payload.positive or "").strip():
        raise HTTPException(status_code=400, detail="提示词内容不能为空")
    item = _main.normalize_prompt_library_item({
        "id": f"tpl_{uuid.uuid4().hex[:12]}",
        "name": payload.name,
        "category": payload.category,
        "positive": payload.positive,
        "negative": payload.negative,
        "scene": payload.scene,
        "created_at": _main.now_ms(),
        "updated_at": _main.now_ms(),
    })
    library.setdefault("items", []).insert(0, item)
    data["active_library_id"] = library.get("id") or data.get("active_library_id")
    data = _main.save_prompt_libraries(data)
    return {"library": _main.public_prompt_libraries(data), "item": item}

@router.patch("/api/prompt-libraries/items/{item_id}")
async def update_prompt_library_item(item_id: str, payload: _main.PromptLibraryItemRequest):
    data = _main.load_prompt_libraries()
    for library in data.get("libraries", []) or []:
        if payload.library_id and library.get("id") != payload.library_id:
            continue
        for index, item in enumerate(library.get("items", []) or []):
            if item.get("id") == item_id:
                next_item = _main.normalize_prompt_library_item({
                    **item,
                    "name": payload.name or item.get("name"),
                    "category": payload.category or item.get("category"),
                    "positive": payload.positive or item.get("positive"),
                    "negative": payload.negative,
                    "scene": payload.scene,
                    "updated_at": _main.now_ms(),
                })
                library["items"][index] = next_item
                data = _main.save_prompt_libraries(data)
                return {"library": _main.public_prompt_libraries(data), "item": next_item}
    raise HTTPException(status_code=404, detail="提示词不存在")

@router.delete("/api/prompt-libraries/items/{item_id}")
async def delete_prompt_library_item(item_id: str):
    data = _main.load_prompt_libraries()
    removed = None
    for library in data.get("libraries", []) or []:
        keep = []
        for item in library.get("items", []) or []:
            if item.get("id") == item_id:
                removed = item
            else:
                keep.append(item)
        library["items"] = keep
    if not removed:
        raise HTTPException(status_code=404, detail="提示词不存在")
    data = _main.save_prompt_libraries(data)
    return {"library": _main.public_prompt_libraries(data), "removed": 1}

@router.post("/api/prompt-libraries/items/delete")
async def batch_delete_prompt_library_items(payload: _main.PromptLibraryBatchDeleteRequest):
    ids = {str(item) for item in (payload.ids or []) if str(item)}
    if not ids:
        raise HTTPException(status_code=400, detail="没有选择提示词")
    data = _main.load_prompt_libraries()
    removed = 0
    for library in data.get("libraries", []) or []:
        keep = []
        for item in library.get("items", []) or []:
            if item.get("id") in ids:
                removed += 1
            else:
                keep.append(item)
        library["items"] = keep
    data = _main.save_prompt_libraries(data)
    return {"library": _main.public_prompt_libraries(data), "removed": removed}

PROMPT_BUILTIN_CATEGORY_IDS = {category["id"] for category in _main.PROMPT_LIBRARY_BUILTIN_CATEGORIES}

def _prompt_fingerprint(text):
    """批量导入的去重指纹：只做空白压缩 + 小写，保证「改标点/改空格」不被当成新条目。"""
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()

@router.post("/api/prompt-libraries/items/import")
async def import_prompt_library_items(payload: _main.PromptLibraryImportRequest):
    raw_items = [item for item in (payload.items or []) if isinstance(item, dict)]
    if not raw_items:
        raise HTTPException(status_code=400, detail="没有可导入的提示词")
    if len(raw_items) > 20000:
        raise HTTPException(status_code=400, detail="单次最多导入 20000 条")
    data = _main.load_prompt_libraries()
    library = _main.find_prompt_library(data, payload.library_id)
    if not library:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    existing_ids = {item.get("id") for item in (library.get("items") or [])}
    existing_fp = {_prompt_fingerprint(item.get("positive")) for item in (library.get("items") or [])}
    existing_ids.discard(None)
    existing_fp.discard("")
    added, skipped_empty, skipped_dup = [], 0, 0
    for raw in raw_items:
        positive = str(raw.get("positive") or raw.get("prompt") or raw.get("text") or "").strip()
        if not positive:
            skipped_empty += 1
            continue
        item_id = str(raw.get("id") or "").strip()
        fingerprint = _prompt_fingerprint(positive)
        if payload.dedupe and ((item_id and item_id in existing_ids) or (fingerprint and fingerprint in existing_fp)):
            skipped_dup += 1
            continue
        category = payload.category or raw.get("category") or "custom"
        item = _main.normalize_prompt_library_item({
            "id": item_id or None,
            "name": raw.get("name") or raw.get("title") or "提示词",
            "category": category,
            "scene": raw.get("scene") or raw.get("description") or "",
            "positive": positive,
            "negative": raw.get("negative") or raw.get("negative_prompt") or "",
            "thumbnail": raw.get("thumbnail") or raw.get("thumb") or "",
            "params": raw.get("params") if isinstance(raw.get("params"), dict) else {},
            "created_at": _main.now_ms(),
            "updated_at": _main.now_ms(),
        })
        # 同批内 id 撞车时补后缀，避免 normalize 阶段被去重吞掉
        base_id, seq = item["id"], 2
        while item["id"] in existing_ids:
            item["id"] = f"{base_id[:56]}_{seq}"
            seq += 1
        existing_ids.add(item["id"])
        if fingerprint:
            existing_fp.add(fingerprint)
        added.append(item)
    if payload.dry_run:
        return {"dry_run": True, "library": _main.public_prompt_libraries(data),
                "added": len(added), "skipped_empty": skipped_empty, "skipped_dup": skipped_dup}
    library.setdefault("items", [])[0:0] = added
    data["active_library_id"] = library.get("id") or data.get("active_library_id")
    data = _main.save_prompt_libraries(data)
    return {"library": _main.public_prompt_libraries(data), "added": len(added),
            "skipped_empty": skipped_empty, "skipped_dup": skipped_dup}

@router.get("/api/prompt-libraries/{library_id}/export")
async def export_prompt_library(library_id: str):
    data = _main.load_prompt_libraries()
    library = _main.find_prompt_library(data, library_id)
    if not library:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    items = library.get("items") or []
    return {
        "library": {"id": library.get("id"), "name": library.get("name")},
        "categories": library.get("categories") or [],
        "count": len(items),
        "items": [
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "category": item.get("category"),
                "scene": item.get("scene"),
                "positive": item.get("positive"),
                "negative": item.get("negative"),
                "thumbnail": item.get("thumbnail") or "",
                "params": item.get("params") or {},
                "updated_at": item.get("updated_at"),
            }
            for item in items
        ],
    }

@router.post("/api/prompt-libraries/categories")
async def add_prompt_library_category(payload: _main.PromptLibraryCategoryRequest):
    data = _main.load_prompt_libraries()
    library = _main.find_prompt_library(data, payload.library_id) or _main.find_prompt_library(data, "system")
    if not library:
        raise HTTPException(status_code=404, detail="提示词库不存在")
    name = _main.sanitize_asset_name(payload.name, "新分组")
    existing = {str(c.get("id")) for c in (library.get("categories") or []) if isinstance(c, dict)} | PROMPT_BUILTIN_CATEGORY_IDS
    cat_id = f"pcat_{uuid.uuid4().hex[:10]}"
    while cat_id in existing:
        cat_id = f"pcat_{uuid.uuid4().hex[:10]}"
    category = {"id": cat_id, "name": name}
    library.setdefault("categories", []).append(category)
    data = _main.save_prompt_libraries(data)
    return {"library": _main.public_prompt_libraries(data), "category": category}

@router.patch("/api/prompt-libraries/categories/{category_id}")
async def rename_prompt_library_category(category_id: str, payload: _main.PromptLibraryCategoryRequest):
    name = _main.sanitize_asset_name(payload.name, "")
    if not name:
        raise HTTPException(status_code=400, detail="分组名称不能为空")
    data = _main.load_prompt_libraries()
    updated = False
    for library in data.get("libraries", []) or []:
        for cat in library.get("categories") or []:
            if isinstance(cat, dict) and cat.get("id") == category_id:
                cat["name"] = name
                updated = True
    if not updated:
        raise HTTPException(status_code=404, detail="分组不存在")
    data = _main.save_prompt_libraries(data)
    return {"library": _main.public_prompt_libraries(data)}

@router.delete("/api/prompt-libraries/categories/{category_id}")
async def delete_prompt_library_category(category_id: str):
    data = _main.load_prompt_libraries()
    found = False
    for library in data.get("libraries", []) or []:
        cats = library.get("categories") or []
        kept = [c for c in cats if not (isinstance(c, dict) and c.get("id") == category_id)]
        if len(kept) != len(cats):
            found = True
            library["categories"] = kept
            fallback = next((str(c.get("id")) for c in kept if isinstance(c, dict) and c.get("id")), "")
            for item in library.get("items", []) or []:
                if isinstance(item, dict) and item.get("category") == category_id:
                    item["category"] = fallback
    if not found:
        raise HTTPException(status_code=404, detail="分组不存在")
    data = _main.save_prompt_libraries(data)
    return {"library": _main.public_prompt_libraries(data)}


_THUMB_SOURCE_CACHE = {"key": None, "map": {}}
_THUMB_SOURCE_LOCK = threading.Lock()
# 一屏会并发拉几十张缩略图，这里限制同时下载转码的数量，
# 否则几十个线程各自下载 4~5MB 原图 + PIL 解码，会把服务端 CPU 打满，
# 连带把 /items 等接口拖到超时。
_THUMB_FETCH_SEM = threading.BoundedSemaphore(6)
_THUMB_INFLIGHT = {}
_THUMB_INFLIGHT_LOCK = threading.Lock()


def _prompt_thumbnail_sources():
    """id → 原图地址映射，按数据文件 mtime 缓存。

    一屏几十张卡片会并发打这个接口，每次都重解析库文件太浪费；
    并发首次命中时还要加锁，避免几十个线程各建一遍 2 万条映射。
    """
    import os
    try:
        mtime = os.path.getmtime(_main.PROMPT_LIBRARY_PATH)
    except OSError:
        mtime = 0.0
    catalog = _style_catalog()
    key = (mtime, _STYLE_CATALOG_CACHE.get("mtime"))
    if _THUMB_SOURCE_CACHE.get("key") == key and _THUMB_SOURCE_CACHE["map"]:
        return _THUMB_SOURCE_CACHE["map"]
    with _THUMB_SOURCE_LOCK:
        if _THUMB_SOURCE_CACHE.get("key") == key and _THUMB_SOURCE_CACHE["map"]:
            return _THUMB_SOURCE_CACHE["map"]
        mapping = {item["id"]: item["thumbnail"] for item in catalog["items"]}
        data = _main.load_prompt_libraries()
        for lib in data.get("libraries", []) or []:
            for entry in lib.get("items") or []:
                if isinstance(entry, dict) and entry.get("id"):
                    mapping[entry["id"]] = entry.get("thumbnail") or ""
        _THUMB_SOURCE_CACHE["key"] = key
        _THUMB_SOURCE_CACHE["map"] = mapping
        return mapping


@router.get("/api/prompt-libraries/thumb/{item_id}")
def get_prompt_thumbnail(item_id: str, width: int = 480):
    """按需生成提示词缩略图并落本地缓存。

    采集源给的是原图（动辄 4~5MB），一屏几十张就是几百 MB。
    这里首次请求下载原图、缩到指定宽度存 webp，之后直接读缓存；
    失败则 302 回原图地址，保证图不会白框。
    """
    import hashlib
    import io
    import os
    import requests
    from PIL import Image
    from fastapi.responses import FileResponse, RedirectResponse

    source = str(_prompt_thumbnail_sources().get(item_id) or "").strip()
    if not source.startswith(("http://", "https://")):
        raise HTTPException(status_code=404, detail="这条提示词没有可用的配图")

    try:
        target_w = max(120, min(int(width), 1200))
    except (TypeError, ValueError):
        target_w = 480

    cache_dir = os.path.join(getattr(_main, "MEDIA_PREVIEW_DIR", os.path.join(_main.DATA_DIR, "cache")), "prompt_thumbs")
    os.makedirs(cache_dir, exist_ok=True)
    digest = hashlib.sha1(f"{source}|{target_w}".encode("utf-8")).hexdigest()[:20]
    cache_path = os.path.join(cache_dir, f"{digest}_{target_w}.webp")
    headers = {"Cache-Control": "public, max-age=2592000"}
    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
        return FileResponse(cache_path, media_type="image/webp", headers=headers)

    # 同一张图被多个卡位同时请求时只下载一次，其余等它出结果
    with _THUMB_INFLIGHT_LOCK:
        waiter = _THUMB_INFLIGHT.get(cache_path)
        owner = waiter is None
        if owner:
            waiter = threading.Event()
            _THUMB_INFLIGHT[cache_path] = waiter
    if not owner:
        waiter.wait(timeout=40)
        if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
            return FileResponse(cache_path, media_type="image/webp", headers=headers)
        return RedirectResponse(source, status_code=302)

    try:
        with _THUMB_FETCH_SEM:
            session = requests.Session()
            session.trust_env = False  # 本机挂了 127.0.0.1:2953 代理，直连
            resp = session.get(source, timeout=25, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            with Image.open(io.BytesIO(resp.content)) as img:
                img = img.convert("RGB")
                if img.width > target_w:
                    height = max(1, round(img.height * target_w / img.width))
                    img = img.resize((target_w, height), Image.LANCZOS)
                img.save(cache_path, "WEBP", quality=78, method=4)
    except Exception:
        return RedirectResponse(source, status_code=302)
    finally:
        with _THUMB_INFLIGHT_LOCK:
            _THUMB_INFLIGHT.pop(cache_path, None)
        waiter.set()

    return FileResponse(cache_path, media_type="image/webp", headers=headers)
