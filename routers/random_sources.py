"""随机源路由（自 main.py 拆出，2026-10-22 P1-3）

依赖 main.random_manager（main.py 模块级单例，接线时已就绪）；
用 `_main.random_manager` 而非 from-import，保证读到当前值。
"""
import random
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException

import main as _main

router = APIRouter()


@router.get("/api/random/sources")
async def random_sources():
    """列出所有随机源"""
    if not _main.random_manager:
        raise HTTPException(status_code=500, detail="随机源管理器未加载")
    return _main.random_manager.list_sources()


@router.get("/api/random/categories/{source_id}")
async def random_categories(source_id: str):
    """获取指定随机源的所有类别"""
    if not _main.random_manager:
        raise HTTPException(status_code=500, detail="随机源管理器未加载")
    categories = _main.random_manager.get_categories(source_id)
    return {"categories": categories}


@router.get("/api/random/{source_id}")
async def random_get(source_id: str, category: Optional[str] = None, count: int = 1):
    """随机获取指定源的元素"""
    if not _main.random_manager:
        raise HTTPException(status_code=500, detail="随机源管理器未加载")
    
    source = _main.random_manager.get_source(source_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"随机源不存在: {source_id}")
    
    filters = {}
    if category:
        filters['category'] = category
    
    if count == 1:
        item = source.random(filters)
        return item or {}
    else:
        items = source.random_multi(filters, count)
        return {"items": items}


@router.post("/api/random/all")
async def random_all(config: Dict[str, Dict]):
    """根据配置随机选择所有源"""
    if not _main.random_manager:
        raise HTTPException(status_code=500, detail="随机源管理器未加载")
    return _main.random_manager.random_all(config)


@router.post("/api/random/apply-plan")
async def random_apply_plan(config: Dict[str, Any]):
    """根据方案配置随机选择"""
    if not _main.random_manager:
        raise HTTPException(status_code=500, detail="随机源管理器未加载")
    
    result = {}
    
    # 处理角色
    char_config = config.get('character', {})
    if char_config.get('enabled'):
        names = char_config.get('names', [])
        count = char_config.get('count', 1)
        if names:
            source = _main.random_manager.get_source('character')
            if source:
                filtered = [item for item in source.items if item.get('name') in names]
                if filtered:
                    actual_count = min(count, len(filtered))
                    if actual_count == 1:
                        result['character'] = random.choice(filtered)
                    else:
                        result['character'] = random.sample(filtered, actual_count)
    
    # 处理画师
    artist_config = config.get('artist', {})
    if artist_config.get('enabled'):
        names = artist_config.get('names', [])
        count = artist_config.get('count', 1)
        if names:
            source = _main.random_manager.get_source('artist')
            if source:
                filtered = [item for item in source.items if item.get('name') in names]
                if filtered:
                    actual_count = min(count, len(filtered))
                    if actual_count == 1:
                        result['artist'] = [random.choice(filtered)]
                    else:
                        result['artist'] = random.sample(filtered, actual_count)
    
    # 处理预设
    preset_config = config.get('preset', {})
    if preset_config.get('enabled'):
        names = preset_config.get('names', [])
        count = preset_config.get('count', 1)
        if names:
            source = _main.random_manager.get_source('preset')
            if source:
                # 跨分类同名时用 name_key(category_id::id)严格匹配;
                # 旧方案可能存的是短 name,这里用 name 再兜底一次保持兼容
                name_set = set(names)
                def _preset_match(item):
                    if item.get('name_key') in name_set:
                        return True
                    if item.get('name') in name_set:
                        return True
                    return False
                filtered = [item for item in source.items if _preset_match(item)]
                if filtered:
                    actual_count = min(count, len(filtered))
                    if actual_count == 1:
                        result['preset'] = random.choice(filtered)
                    else:
                        result['preset'] = random.sample(filtered, actual_count)
    
    return result
