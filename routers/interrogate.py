"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/interrogate
"""
from fastapi import File, Form, UploadFile
from fastapi.responses import StreamingResponse
import asyncio, json, os, uuid
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.post("/api/interrogate")
async def api_interrogate_stream(
    file: UploadFile = File(...),
    mode: str = Form("caption"),
    target_style: str = Form(""),
    provider: str = Form("auto"),
    vision_provider_id: str = Form(""),
    custom_rule: str = Form(""),
):
    """通用反推提示词接口(真实进度,SSE 流式)。
    provider: auto | comfyui | vision
    vision_provider_id: 可选,指定走 vision 路线时用哪个 chat provider(复用「AI 提示词」的 API)。
    事件格式(SSE, 每行 `data: {json}`):
      {"type":"progress","value":N,"stage":"..."}   实时进度(ComfyUI 走真实采样进度)
      {"type":"result","text":...,"format":...,"tags":...,"raw":...,"provider":...}
      {"type":"error","message":"..."}
    """
    suffix = os.path.splitext(file.filename or "x.png")[1] or ".png"
    tmp_dir = os.path.join(_main.USER_DATA_DIR, "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_path = os.path.join(tmp_dir, f".interrogate_{uuid.uuid4().hex}{suffix}")
    content = await file.read()
    with open(tmp_path, 'wb') as f:
        f.write(content)

    q: "asyncio.Queue" = asyncio.Queue()   # type: ignore
    sentinel = object()

    async def emit(pct, stage):
        await q.put({"type": "progress", "value": int(pct), "stage": stage})

    async def run():
        try:
            await emit(8, "图片已就绪,准备推理…")
            text = None
            errs = []
            if provider in ("auto", "comfyui"):
                try:
                    text = await _main._interrogate_via_comfyui(tmp_path, mode, target_style, emit, custom_rule)
                except Exception as e:
                    errs.append(f"comfyui:{e}")
            if not text and provider in ("auto", "vision"):
                # auto 模式下,仅在存在可用多模态 provider(已配 key)时才尝试云端兜底,
                # 避免 ComfyUI 偶发失败时错误信息被「未配置 key」污染,掩盖真实原因。
                vision_enabled = (provider == "vision") or _main.has_usable_vision_provider()
                if vision_enabled:
                    try:
                        text = await _main._interrogate_via_vision(
                            tmp_path, mode, target_style, emit,
                            provider_id=(vision_provider_id or None),
                            custom_rule=custom_rule,
                        )
                    except Exception as e:
                        errs.append(f"vision:{e}")
            if not text:
                raise RuntimeError("反推失败: " + "; ".join(errs))
            tags = []
            if mode == "tags":
                tags = [t.strip() for t in text.split(',') if t.strip()]
            await q.put({
                "type": "result",
                "text": text,
                "format": mode,
                "tags": tags,
                "raw": text,
                "provider": provider,
            })
        except Exception as e:
            await q.put({"type": "error", "message": str(e)})
        finally:
            try:
                os.remove(tmp_path)
            except Exception:
                pass
            await q.put(sentinel)

    async def stream():
        asyncio.create_task(run())
        while True:
            ev = await q.get()
            if ev is sentinel:
                break
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
