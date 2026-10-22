"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/chat
"""
from fastapi import HTTPException, Header, Request
from fastapi.responses import StreamingResponse
import httpx, json, uuid
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.post("/api/chat")
async def chat(payload: _main.ChatRequest, request: Request, x_user_id: str = Header(default=""), token: str = ""):
    username = _main.get_username_by_token(token)
    user_id = _main.safe_user_id(x_user_id, request)
    conversation = (
        _main.load_conversation(user_id, payload.conversation_id)
        if payload.conversation_id
        else _main.new_conversation(user_id, _main.display_title(payload.message))
    )
    if not conversation.get("messages"):
        conversation["title"] = _main.display_title(payload.message)

    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    user_message = {
        "id": uuid.uuid4().hex,
        "role": "user",
        "content": payload.message,
        "created_at": _main.now_ms(),
        "attachments": refs,
        "mode": payload.mode,
    }
    conversation["messages"].append(user_message)
    conversation["updated_at"] = _main.now_ms()
    _main.save_conversation(user_id, conversation)

    if payload.mode == "image":
        model = _main.selected_model(payload.image_model or payload.model, _main.IMAGE_MODEL)
        try:
            image_data, raw = await _main.generate_ai_image(payload.message, payload.size, payload.quality, model, refs)
            local_url = await _main.save_ai_image_to_output(image_data, prefix="chat_", username=username)
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=f"上游生图接口错误:{exc.response.text}") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"请求上游生图接口失败:{exc}") from exc
        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "type": "image",
            "content": payload.message,
            "image_url": local_url,
            "created_at": _main.now_ms(),
            "model": model,
            "raw_usage": raw.get("usage") if isinstance(raw, dict) else None,
        }
    else:
        chat_base, chat_hdrs, model = _main.resolve_chat_provider(payload.provider, payload.model, payload.ms_model)
        history = conversation["messages"][-_main.MAX_HISTORY_MESSAGES:]
        system_prompt = (payload.system_prompt or "").strip() or _main.SYSTEM_PROMPT
        upstream_messages = [{"role": "system", "content": system_prompt}]
        for item in history:
            msg = _main.upstream_message_from_record(item)
            if msg:
                upstream_messages.append(msg)
        try:
            async with httpx.AsyncClient(timeout=_main.AI_REQUEST_TIMEOUT) as client:
                response = await client.post(
                    f"{chat_base}/chat/completions",
                    headers=chat_hdrs,
                    json={"model": model, "messages": upstream_messages},
                )
                response.raise_for_status()
                raw = response.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=exc.response.status_code, detail=f"上游接口错误:{exc.response.text}") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"请求上游接口失败:{exc}") from exc
        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "content": _main.text_from_chat_response(raw).strip() or "接口返回了空回复。",
            "created_at": _main.now_ms(),
            "model": model,
            "raw_usage": raw.get("usage") if isinstance(raw, dict) else None,
        }

    conversation["messages"].append(assistant_message)
    conversation["updated_at"] = _main.now_ms()
    _main.save_conversation(user_id, conversation)
    return {"conversation": conversation, "message": assistant_message}

@router.post("/api/chat/stream")
async def chat_stream(payload: _main.ChatRequest, request: Request, x_user_id: str = Header(default="")):
    if payload.mode == "image":
        raise HTTPException(status_code=400, detail="图片模式请使用 /api/chat")

    user_id = _main.safe_user_id(x_user_id, request)
    conversation = (
        _main.load_conversation(user_id, payload.conversation_id)
        if payload.conversation_id
        else _main.new_conversation(user_id, _main.display_title(payload.message))
    )
    if not conversation.get("messages"):
        conversation["title"] = _main.display_title(payload.message)

    refs = [ref.dict() for ref in payload.reference_images if ref.url]
    user_message = {
        "id": uuid.uuid4().hex,
        "role": "user",
        "content": payload.message,
        "created_at": _main.now_ms(),
        "attachments": refs,
        "mode": payload.mode,
    }
    conversation["messages"].append(user_message)
    conversation["updated_at"] = _main.now_ms()
    _main.save_conversation(user_id, conversation)

    chat_base, chat_hdrs, model = _main.resolve_chat_provider(payload.provider, payload.model, payload.ms_model)
    history = conversation["messages"][-_main.MAX_HISTORY_MESSAGES:]
    system_prompt = (payload.system_prompt or "").strip() or _main.SYSTEM_PROMPT
    upstream_messages = [{"role": "system", "content": system_prompt}]
    for item in history:
        msg = _main.upstream_message_from_record(item)
        if msg:
            upstream_messages.append(msg)

    async def stream():
        content_parts = []
        raw_usage = None
        yield _main.sse_event({"type": "meta", "conversation": conversation})
        try:
            async with httpx.AsyncClient(timeout=_main.AI_REQUEST_TIMEOUT) as client:
                async with client.stream(
                    "POST",
                    f"{chat_base}/chat/completions",
                    headers=chat_hdrs,
                    json={"model": model, "messages": upstream_messages, "stream": True},
                ) as response:
                    if response.status_code >= 400:
                        detail = await response.aread()
                        yield _main.sse_event({"type": "error", "detail": f"上游接口错误:{detail.decode('utf-8', errors='ignore')}"})
                        return
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("data:"):
                            line = line[5:].strip()
                        if line == "[DONE]":
                            break
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if isinstance(chunk, dict) and chunk.get("usage"):
                            raw_usage = chunk.get("usage")
                        delta = _main.text_delta_from_chat_chunk(chunk)
                        if delta:
                            content_parts.append(delta)
                            yield _main.sse_event({"type": "delta", "delta": delta})
        except httpx.HTTPError as exc:
            yield _main.sse_event({"type": "error", "detail": f"请求上游接口失败:{exc}"})
            return

        assistant_message = {
            "id": uuid.uuid4().hex,
            "role": "assistant",
            "content": "".join(content_parts).strip() or "接口返回了空回复。",
            "created_at": _main.now_ms(),
            "model": model,
            "raw_usage": raw_usage,
        }
        conversation["messages"].append(assistant_message)
        conversation["updated_at"] = _main.now_ms()
        _main.save_conversation(user_id, conversation)
        yield _main.sse_event({"type": "done", "conversation": conversation, "message": assistant_message})

    return StreamingResponse(stream(), media_type="text/event-stream")
