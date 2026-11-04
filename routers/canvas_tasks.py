"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/image-task-query, /api/canvas-image-tasks, /api/canvas-llm, /api/conversations
"""
from fastapi import HTTPException, Header, Request
import asyncio, httpx, os, time, uuid
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List

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

async def run_canvas_image_task(task_id: str, payload: _main.OnlineImageRequest, username: str = None, user_id: str = ""):
    with _main.CANVAS_TASK_LOCK:
        if task_id in _main.CANVAS_TASKS:
            _main.CANVAS_TASKS[task_id]["status"] = "running"
            _main.CANVAS_TASKS[task_id]["updated_at"] = time.time()
    def on_progress(progress):
        with _main.CANVAS_TASK_LOCK:
            task = _main.CANVAS_TASKS.get(task_id)
            if task and task['status'] == 'running':
                task['progress'] = progress
                task['updated_at'] = time.time()
    try:
        result = await _main.build_online_image_result(payload, username=username, on_progress=on_progress)
        with _main.CANVAS_TASK_LOCK:
            _main.CANVAS_TASKS[task_id].update({
                "status": "succeeded",
                "result": result,
                "error": "",
                "updated_at": time.time(),
            })
        _main.finish_chat_generation(payload.conversation_id, payload.message_id, (result or {}).get("images") or [], user_id=user_id)
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        status_code = getattr(exc, "status_code", 500)
        _main.finish_chat_generation(payload.conversation_id, payload.message_id, error=str(detail), user_id=user_id)
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
    username = _main.require_valid_token(token)
    user_id = _main.account_dirname(username)
    with _main.CANVAS_TASK_LOCK:
        _main.CANVAS_TASKS[task_id] = {
            "id": task_id,
            "owner": username,
            "type": "online-image",
            "status": "queued",
            "progress": {"source": "local", "stage": "queued", "progress": None},
            "created_at": time.time(),
            "updated_at": time.time(),
            "result": None,
            "error": "",
        }
    asyncio.create_task(run_canvas_image_task(task_id, payload, username=username, user_id=user_id))
    return {"task_id": task_id, "status": "queued"}

@router.get("/api/canvas-image-tasks/{task_id}")
async def get_canvas_image_task(task_id: str, token: str = ""):
    username = _main.require_valid_token(token)
    with _main.CANVAS_TASK_LOCK:
        task = dict(_main.CANVAS_TASKS.get(task_id) or {})
    if not task:
        raise HTTPException(status_code=404, detail="画布任务不存在,可能服务已重启或任务已过期")
    if task.get('owner') != username:
        raise HTTPException(status_code=403, detail="无权访问此图片任务")
    task['elapsed_ms'] = max(0, round(((task.get('updated_at') if task['status'] in ('succeeded', 'failed') else time.time()) - task['created_at']) * 1000))
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
    # 画布节点连过来的参考图（/assets/... 或 /output/...）转成 data URL，走多模态 content
    image_parts = []
    for url in (payload.images or [])[:6]:
        url = str(url or "")
        if url.startswith(("http://", "https://", "data:")):
            image_parts.append({"type": "image_url", "image_url": {"url": url}})
            continue
        path = _main.output_file_from_url(url)
        if not path:
            continue
        try:
            image_parts.append({"type": "image_url", "image_url": {"url": _main.image_path_to_data_url(path, max_size=1024)}})
        except Exception as exc:
            print(f"canvas-llm 参考图读取失败 {url}: {exc}")
    text = payload.message
    if payload.videos:
        names = [os.path.basename(str(url).split("?")[0]) for url in payload.videos[:6]]
        text = f"{text}\n\n（已连接的视频参考：{'、'.join(names)}；当前模型无法直接观看视频画面）"
    if image_parts:
        upstream_messages[-1]["content"] = [{"type": "text", "text": text}, *image_parts]
    elif text != payload.message:
        upstream_messages[-1]["content"] = text
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
async def conversations(request: Request, x_user_id: str = Header(default=""), offset: int = 0, limit: int = None):
    user_id = _main.account_dirname()
    records = _main.list_conversations(user_id)
    # ponytail: 不传分页参数的旧客户端仍返回完整列表。
    if limit is None:
        return {"user_id": user_id, "conversations": records}
    offset, limit = max(0, offset), max(1, min(100, limit))
    return {"user_id": user_id, "conversations": records[offset:offset + limit],
            "has_more": offset + limit < len(records), "total": len(records)}

@router.post("/api/conversations")
async def create_conversation(payload: _main.ConversationCreateRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _main.account_dirname()
    return {"conversation": _main.new_conversation(user_id, payload.title)}

@router.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, request: Request, x_user_id: str = Header(default="")):
    user_id = _main.account_dirname()
    return {"conversation": _main.load_conversation(user_id, conversation_id), "boot_id": _main.APP_BOOT_ID}

@router.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, request: Request, x_user_id: str = Header(default="")):
    user_id = _main.account_dirname()
    path = _main.conversation_path(user_id, conversation_id)
    if os.path.exists(path):
        os.remove(path)
    return {"ok": True}

class ConversationImagesRequest(BaseModel):
    image_urls: List[str] = []

class ConversationPendingRequest(BaseModel):
    message_id: str = ""
    clear: bool = False

@router.post("/api/conversations/{conversation_id}/pending")
async def mark_conversation_pending(conversation_id: str, payload: ConversationPendingRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _main.account_dirname()
    conversation = _main.load_conversation(user_id, conversation_id)
    message = next((item for item in conversation.get("messages") or [] if item.get("id") == payload.message_id), None)
    if message is None:
        raise HTTPException(status_code=404, detail="找不到这条对话消息")
    if payload.clear:
        message.pop("pending_generation", None)
        if not message.get("image_urls"):
            message["generation_error"] = "生成已中断"
    else:
        message.pop("generation_error", None)
        message["pending_generation"] = {"boot_id": _main.APP_BOOT_ID, "started_at": _main.now_ms()}
    conversation["updated_at"] = _main.now_ms()
    _main.save_conversation(user_id, conversation)
    return {"ok": True, "boot_id": _main.APP_BOOT_ID}

class ConversationTurnRequest(BaseModel):
    user: str = ""
    assistant: str = ""

@router.post("/api/conversations/{conversation_id}/turn")
async def append_conversation_turn(conversation_id: str, payload: ConversationTurnRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _main.account_dirname()
    conversation = _main.load_conversation(user_id, conversation_id)
    now = _main.now_ms()
    messages = conversation.setdefault("messages", [])
    user_text = (payload.user or "").strip()
    assistant_text = (payload.assistant or "").strip()
    if user_text:
        messages.append({"id": uuid.uuid4().hex, "role": "user", "content": user_text, "created_at": now})
    if assistant_text:
        messages.append({"id": uuid.uuid4().hex, "role": "assistant", "content": assistant_text, "created_at": now, "image_urls": []})
    if user_text and (not conversation.get("title") or conversation.get("title") in ("新对话", "对话生图")):
        conversation["title"] = user_text[:24]
    conversation["updated_at"] = now
    _main.save_conversation(user_id, conversation)
    return {"ok": True, "conversation": conversation}

@router.post("/api/conversations/{conversation_id}/images")
async def attach_conversation_images(conversation_id: str, payload: ConversationImagesRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _main.account_dirname()
    conversation = _main.load_conversation(user_id, conversation_id)
    target = next((item for item in reversed(conversation.get("messages") or []) if item.get("role") == "assistant"), None)
    if target is None:
        target = {"id": uuid.uuid4().hex, "role": "assistant", "content": "", "created_at": _main.now_ms(), "image_urls": []}
        conversation.setdefault("messages", []).append(target)
    urls = target.setdefault("image_urls", [])
    for url in payload.image_urls:
        if url and url not in urls:
            urls.append(url)
    conversation["updated_at"] = _main.now_ms()
    _main.save_conversation(user_id, conversation)
    return {"ok": True, "image_urls": urls}

class ConversationDeleteMessagesRequest(BaseModel):
    message_ids: List[str] = []

@router.post("/api/conversations/{conversation_id}/messages/delete")
async def delete_conversation_messages(conversation_id: str, payload: ConversationDeleteMessagesRequest, request: Request, x_user_id: str = Header(default="")):
    user_id = _main.account_dirname()
    conversation = _main.load_conversation(user_id, conversation_id)
    remove = {item for item in payload.message_ids if item}
    if remove:
        conversation["messages"] = [item for item in (conversation.get("messages") or []) if item.get("id") not in remove]
        conversation["updated_at"] = _main.now_ms()
        _main.save_conversation(user_id, conversation)
    return {"ok": True}
