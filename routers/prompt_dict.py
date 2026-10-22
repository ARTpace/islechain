"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/prompt-dict
"""
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/api/prompt-dict")
async def get_prompt_dict():
    return {"success": True, "dict": _main.load_user_prompt_dict()}

@router.post("/api/prompt-dict/learn")
async def learn_prompt_dict(payload: dict):
    """自动学习:将翻译结果的词条对写入用户字典"""
    entries = payload.get("entries", {})
    if not entries:
        return {"success": False, "error": "无词条数据"}
    user_dict = _main.load_user_prompt_dict()
    added = 0
    skipped = 0
    for direction in ["zh2en", "en2zh"]:
        pairs = entries.get(direction, {})
        if not pairs:
            continue
        if direction not in user_dict:
            user_dict[direction] = {}
        for src, tgt in pairs.items():
            src = src.strip()
            tgt = tgt.strip()
            if not src or not tgt:
                skipped += 1
                continue
            if src in user_dict[direction]:
                skipped += 1
                continue
            user_dict[direction][src] = tgt
            added += 1
    _main.save_user_prompt_dict(user_dict)
    return {"success": True, "added": added, "skipped": skipped}
