"""通配符管理路由（自 main.py 拆出，2026-10-22 P1-3）

只依赖 wildcard_engine（独立模块），不依赖 main。
注：原 main.py 中 `log` 从未定义，`log.exception` 在错误分支会二次抛 NameError，
   此处补上模块级 logger 一并修正。
"""
import logging

from fastapi import APIRouter, HTTPException

router = APIRouter()
log = logging.getLogger("uvicorn.error")


# ============================================================
# 通配符管理 API
# - 列出内置 / 导入的通配符
# - 创建 / 更新 / 删除用户通配符（每行一条提示词）
# - 随机组合：选多个类型，每个类型随机抽一条拼接
# ============================================================
from wildcard_engine import get_engine as _wc_engine

@router.get("/api/wildcards")
async def api_wildcards_list():
    """列出所有通配符（builtin + imported），附带条目数"""
    try:
        return _wc_engine().list_wildcards()
    except Exception as e:
        log.exception(f"列出通配符失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/wildcards/{name}")
async def api_wildcards_get(name: str):
    """获取指定通配符的原始文本（每行一条，# 为注释）"""
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name 不能为空")
    text = _wc_engine().get_wildcard_text(name)
    if not text:
        raise HTTPException(status_code=404, detail=f"通配符 {name} 不存在")
    options = _wc_engine().get_wildcard(name)
    return {"name": name, "text": text, "count": len(options)}


@router.post("/api/wildcards")
async def api_wildcards_create(payload: dict):
    """创建新的用户通配符（写入 data/wildcards/imported/）

    Body: { "name": "my_pack", "text": "line1\\nline2\\n..." , "overwrite": false }
    """
    name = (payload.get("name") or "").strip()
    text = payload.get("text") or ""
    overwrite = bool(payload.get("overwrite", False))
    if not name:
        raise HTTPException(status_code=400, detail="name 不能为空")
    result = _wc_engine().save_wildcard(name, text, overwrite=overwrite)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.put("/api/wildcards/{name}")
async def api_wildcards_update(name: str, payload: dict):
    """更新一个已存在的用户通配符（不能覆盖内置）"""
    name = (name or "").strip()
    text = payload.get("text") or ""
    if not name:
        raise HTTPException(status_code=400, detail="name 不能为空")
    result = _wc_engine().save_wildcard(name, text, overwrite=True)
    if not result["success"]:
        # 当类型不存在时退化为创建
        if "已存在" not in result["error"]:
            result = _wc_engine().save_wildcard(name, text, overwrite=False)
        if not result["success"]:
            raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.delete("/api/wildcards/{name}")
async def api_wildcards_delete(name: str):
    """删除一个导入的通配符（内置不可删）"""
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name 不能为空")
    result = _wc_engine().delete_wildcard(name)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/api/wildcards/roll")
async def api_wildcards_roll(payload: dict):
    """随机组合：从所选类型中各抽一条拼接

    Body: { "names": ["clothing","background","pose"], "seed": 42(可选) }
    """
    names = payload.get("names") or []
    if not isinstance(names, list) or not names:
        raise HTTPException(status_code=400, detail="names 不能为空")
    seed = payload.get("seed")
    try:
        seed = int(seed) if seed is not None and str(seed) != "" else None
    except (ValueError, TypeError):
        seed = None
    return _wc_engine().roll_combo([str(n).strip() for n in names if str(n).strip()], seed=seed)


@router.post("/api/wildcards/resolve")
async def api_wildcards_resolve(payload: dict):
    """解析一段带通配符的文本（{a|b|c} / __name__ / [opt]）"""
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text 不能为空")
    seed = payload.get("seed")
    try:
        seed = int(seed) if seed is not None and str(seed) != "" else None
    except (ValueError, TypeError):
        seed = None
    return _wc_engine().preview(text, seed=seed) if hasattr(_wc_engine(), 'preview') else {
        "resolved": _wc_engine().resolve(text, seed=seed)
    }


@router.post("/api/wildcards/validate")
async def api_wildcards_validate(payload: dict):
    """校验一段提示词的通配符语法"""
    text = (payload.get("text") or "").strip()
    return {"warnings": _wc_engine().validate(text)}
