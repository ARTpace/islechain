"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/image-task-query, /api/canvas-image-tasks, /api/canvas-llm, /api/conversations
"""
from fastapi import HTTPException, Header, Request
import asyncio, httpx, os, time, uuid
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.post("/api/image-task-query")
async def query_image_task(payload: _main.ImageTaskQueryRequest):
    provider_id = payload.provider_id or ""
    if str(provider_id).lower() == "runninghub":
        cfg = _main.load_api_providers()
        provider = next((p for p in cfg if p.get("id") == "runninghub"), None)
        if not isinstance(provider, dict):
            raise HTTPException(status_code=400, detail="RunningHub 未配置")
        base = str(provider.get("base_url") or "https://www.runninghub.ai").rstrip("/")
        api_key = str(provider.get("api_key") or "")
        import httpx
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(f"{base}/task/openapi/outputs",
                headers={"Content-Type": "application/json"},
                json={"apiKey": api_key, "taskId": payload.task_id})
            resp.raise_for_status()
            data = resp.json()
            code = data.get("code") if isinstance(data, dict) else None
            if code in (0, "0"):
                outputs = data.get("data", {}).get("outputs", data.get("data", []))
                urls = [o.get("url", o) if isinstance(o, dict) else o for o in (outputs or [])]
                return {"status": "succeeded", "images": urls, "task_id": payload.task_id}
            raise HTTPException(status_code=502, detail=f"RunningHub 查询失败: {data}")
    else:
        raise HTTPException(status_code=400, detail=f"不支持的 provider: {provider_id}")

async def run_canvas_image_task(task_id: str, payload: _main.OnlineImageRequest, username: str = None):
    with _main.CANVAS_TASK_LOCK:
        if task_id in _main.CANVAS_TASKS:
            _main.CANVAS_TASKS[task_id]["status"] = "running"
            _main.CANVAS_TASKS[task_id]["updated_at"] = time.time()
    try:
        result = await _main.build_online_image_result(payload, username=username)
        with _main.CANVAS_TASK_LOCK:
            _main.CANVAS_TASKS[task_id].update({
                "status": "succeeded",
                "result": result,
                "error": "",
                "updated_at": time.time(),
            })
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        status_code = getattr(exc, "status_code", 500)
        with _main.CANVAS_TASK_LOCK:
            _main.CANVAS_TASKS[task_id].update({
                "status": "failed",
                "error": str(detail),
                "status_code": status_code,
                "updated_at": time.time(),
            })

@router.post("/api/canvas-image-tasks")
async def create_canvas_image_task(payload: _main.OnlineImageRequest, token: str = ""):
    task_id = f"canvas_img_{uuid.uuid4().hex}"
    username = _main.require_valid_token(token) if token else None
    with _main.CANVAS_TASK_LOCK:
        _main.CANVAS_TASKS[task_id] = {
            "id": task_id,
            "type": "online-image",
            "status": "queued",
            "created_at": time.time(),
            "updated_at": time.time(),
            "result": None,
            "error": "",
        }
    asyncio.create_task(run_canvas_image_task(task_id, payload, username=username))
    return {"task_id": task_id, "status": "queued"}

@router.get("/api/canvas-image-tasks/{task_id}")
async def get_canvas_image_task(task_id: str):
    with _main.CANVAS_TASK_LOCK:
        task = dict(_main.CANVAS_TASKS.get(task_id) or {})
    if not task:
        raise HTTPException(status_code=404, detail="画布任务不存在,可能服务已重启或任务已过期")
    return task

# --- Canvas LLM ---

@router.post("/api/canvas-llm")
async def canvas_llm(payload: _main.CanvasLLMRequest):
    chat_base, chat_hdrs, model = _main.resolve_chat_provider(payload.provider, payload.model, payload.ms_model)
    upstream_messages = [{"role": "system", "content": payload.system_prompt or _main.SYSTEM_PROMPT}]
    for item in payload.messages[-_main.MAX_HISTORY_MESSAGES:]:
        role = item.get("role")
        content = item.get("content")
        if role in {"user", "assistant"} and content:
            upstream_messages.append({"role": role, "content": content})
    upstream_messages.append({"role": "user", "content": payload.message})
    try:
        async with httpx.AsyncClient(timeout=_main.AI_REQUEST_TIMEOUT) as client:
            response = await client.post(
                f"{chat_base}/chat/completions",
                headers=chat_hdrs,
                json={"model": model, "messages": upstream_messages},
            )
            response.raise_for_status()
            if not response.content:
                raise HTTPException(status_code=502, detail="上游接口返回了空响应")
            raw = response.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=f"上游接口错误:{exc.response.text}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"请求上游接口失败:{exc}") from exc
    text = _main.text_from_chat_response(raw).strip() or "接口返回了空回复。"
    return {"text": text, "model": model, "raw_usage": raw.get("usage") if isinstance(raw, dict) else None}

# --- 对话管理 ---

@router.get("/api/conversations")
async def conversations(request: Request, x_user_id: str = Header(default="")):
    user_id = _main.safe_user_id(x_user_id, request)
    return {"user_id": user_id, "conversations": _main.list_conversations(user_id)}

@router.post("/api/conversations")
async def create_conversation(payload: _main.ConversationCreateRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _main.safe_user_id(x_user_id, request)
    return {"conversation": _main.new_conversation(user_id, payload.title)}

@router.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, request: Request, x_user_id: str = Header(default="")):
    user_id = _main.safe_user_id(x_user_id, request)
    return {"conversation": _main.load_conversation(user_id, conversation_id)}

@router.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, request: Request, x_user_id: str = Header(default="")):
    user_id = _main.safe_user_id(x_user_id, request)
    path = _main.conversation_path(user_id, conversation_id)
    if os.path.exists(path):
        os.remove(path)
    return {"ok": True}
