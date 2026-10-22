"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/ideogram4/generate-json
"""
from fastapi import HTTPException
import httpx, json, re
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.post("/api/ideogram4/generate-json")
async def generate_ideogram4_json(req: _main.Ideogram4JsonRequest, token: str = ""):
    """调用 LLM 将中文创意描述转换为 Ideogram4 结构化 JSON 提示词"""
    _main.require_valid_token(token)
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="提示词不能为空")

    user_message = (
        f"Please generate the JSON caption for the user idea below.\n\n"
        f"TARGET IMAGE ASPECT RATIO: {req.width}:{req.height} (width:height).\n"
        f"User idea: {req.prompt.strip()}"
    )

    try:
        chat_base, chat_hdrs, model = _main.resolve_chat_provider(req.provider, req.model, "")
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{chat_base}/chat/completions",
                headers=chat_hdrs,
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": _main.IDEOGRAM4_JSON_SYSTEM_PROMPT},
                        {"role": "user", "content": user_message}
                    ],
                    "temperature": 0.7,
                    "max_tokens": 2000
                },
            )
            response.raise_for_status()
            raw = response.json()
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=f"上游接口错误: {exc.response.text}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游接口失败: {exc}") from exc

    result_text = _main.text_from_chat_response(raw).strip()
    if not result_text:
        raise HTTPException(status_code=502, detail="LLM 返回为空")

    # 清理可能的 markdown 代码块
    cleaned = re.sub(r'^```(?:json)?\s*', '', result_text)
    cleaned = re.sub(r'\s*```\s*$', '', cleaned)
    first_brace = cleaned.find('{')
    last_brace = cleaned.rfind('}')
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        cleaned = cleaned[first_brace:last_brace + 1]
    cleaned = re.sub(r',\s*([}\]])', r'\1', cleaned)

    # 验证 JSON 格式
    try:
        json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"LLM 返回的 JSON 无效: {str(e)[:100]}")

    return {"json": cleaned, "model": model}
