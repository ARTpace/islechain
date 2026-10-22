"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/animadex
"""
import json, os
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/api/animadex/characters")
async def get_animadex_characters(
    copyright: str = "",
    limit: int = 200
):
    """获取 animadex 角色数据(用于头像映射)"""
    global _animadex_cache, _animadex_cache_time
    import time

    # 缓存 10 分钟
    if _main._animadex_cache is None or (time.time() - _main._animadex_cache_time) > 600:
        try:
            animadex_path = os.path.join(_main.DATA_DIR, "animadex-characters.json")
            if os.path.exists(animadex_path):
                with open(animadex_path, 'r', encoding='utf-8') as f:
                    _animadex_cache = json.load(f)
                    _animadex_cache_time = time.time()
        except Exception as e:
            print(f"加载 animadex 数据失败: {e}")
            _animadex_cache = {"characters": []}

    characters = _main._animadex_cache.get("characters", []) if _main._animadex_cache else []

    # 按 copyright 过滤
    if copyright:
        characters = [c for c in characters if c.get("copyright") == copyright]

    # 限制数量
    characters = characters[:limit]

    return {"characters": characters, "count": len(characters)}
