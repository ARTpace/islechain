"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/random-plan, /api/smart-tts, /api/ms/generate
"""
from typing import Any, Dict, Optional
from pydantic import BaseModel
from fastapi import HTTPException
import asyncio, httpx, json, os, time
from core import smart_tts as smart_tts_module
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.post("/api/random-plan/ai-generate")
async def ai_generate_random_plan(req: _main.AIGenPlanRequest, token: str = ""):
    """用 LLM 根据自然语言描述生成提示词方案结构 (角色 / 画师 / 预设)"""
    _main.require_valid_token(token)
    try:
        config = _main.load_config()
        if not config.get('api_key'):
            return {"success": False, "error": "未配置 API Key，请先在设置中配置 LLM API"}

        sys_prompt = (
            "你是一个 AI 绘画提示词方案生成助手。用户会用自然语言描述他想要的方案主题，你需要输出一个 JSON 对象。\n"
            "JSON 结构：\n"
            "{\n"
            '  "name": string,            // 方案名（简洁中文）\n'
            '  "characters": string[],    // 角色 tag 数组（英文，如 "nahida (genshin impact)"）\n'
            '  "artists": string[],       // 画师 tag 数组（英文，如 "wlop", \"ask\"）\n'
            '  "presets": string[],       // 预设词数组（英文画质 / 风格 tag，如 \"masterpiece, best quality\", \"detailed background\"）\n'
            '  "fixedPrompt": string      // 固定提示词（可选，其他需要每次都附加的词）\n'
            "}\n\n"
            "要求：\n"
            "1. 只输出 JSON，不要 markdown 代码块标记，不要任何解释文字\n"
            "2. 角色 / 画师都用英文 tag（与 stable diffusion 模型兼容）\n"
            "3. 角色至少给 1 个，如果用户描述的是原创 / 通用主题，可留空数组\n"
            "4. 画师给 1-3 个，符合主题风格\n"
            "5. 预设给 2-5 个常用画质 / 风格 tag\n"
            "6. 如果用户描述不明确，自行发挥创意填充合理内容\n"
        )

        raw = _main._sp_call_llm(req.description.strip(), sys_prompt, config)
        if isinstance(raw, str) and raw.startswith('ERROR'):
            return {"success": False, "error": raw}

        # 尝试解析 JSON（容错：去掉可能的 markdown 标记）
        import re as _re
        cleaned = raw.strip()
        # 去掉 ```json ... ``` 包裹
        m = _re.search(r'```(?:json)?\s*(.*?)```', cleaned, _re.DOTALL)
        if m:
            cleaned = m.group(1).strip()
        # 尝试截取第一个 { 到最后一个 }
        s = cleaned.find('{')
        e = cleaned.rfind('}')
        if s >= 0 and e > s:
            cleaned = cleaned[s:e+1]

        data = json.loads(cleaned)
        # 字段兼容性保证
        plan = {
            'name': str(data.get('name') or 'AI 方案')[:30],
            'characters': list(data.get('characters') or []),
            'artists': list(data.get('artists') or []),
            'presets': list(data.get('presets') or []),
            'fixedPrompt': str(data.get('fixedPrompt') or ''),
        }
        return {"success": True, "plan": plan, "raw": raw}
    except json.JSONDecodeError as e:
        return {"success": False, "error": f"AI 输出 JSON 解析失败: {e}", "raw": raw if 'raw' in dir() else ''}
    except Exception as e:
        return {"success": False, "error": str(e)}

# --- 智能 TTS 文本精修 ---
class SmartTTSRequest(BaseModel):
    text: str = ""
    config: Optional[Dict[str, Any]] = None

@router.post("/api/smart-tts")
async def smart_tts_enhance(req: SmartTTSRequest):
    """智能 TTS 文本精修"""
    try:
        config = _main.load_config()
        if req.config:
            config.update(req.config)
        if not config.get('api_key'):
            return {"success": False, "enhanced_text": "", "suggested_params": {}, "changes": [], "raw": "", "error": "未配置 API Key"}
        result = smart_tts_module.generate_smart_tts(req.text, config)
        return result
    except Exception as e:
        return {"success": False, "enhanced_text": "", "suggested_params": {}, "changes": [], "raw": "", "error": str(e)}

# --- 翻译模型 ---


# --- ModelScope 角度控制 ---


# --- ModelScope Z-Image 云端生图 ---


# --- ModelScope 通用图片生成(支持图生图) ---

@router.post("/api/ms/generate")
async def ms_generate(req: _main.MsGenerateRequest, token: str = ""):
    username = _main.get_username_by_token(token)
    base_url = 'https://api-inference.modelscope.cn/'
    clean_token = _main.sanitize_api_key(_main.MODELSCOPE_API_KEY.strip())
    if not clean_token:
        raise HTTPException(status_code=400, detail="未配置 MODELSCOPE_API_KEY,请在 API/.env 中填写。")

    headers = {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "X-ModelScope-Async-Mode": "true"
    }
    payload = {
        "model": req.model,
        "prompt": req.prompt.strip(),
    }
    if req.width and req.height:
        payload["width"] = req.width
        payload["height"] = req.height
        payload["size"] = req.size or f"{req.width}x{req.height}"
        payload["size"] = req.size or f"{req.width}x{req.height}"
    if req.image_urls:
        payload["image_url"] = req.image_urls
    if req.loras is not None:
        payload["loras"] = req.loras

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            submit_res = await client.post(
                f"{base_url}v1/images/generations",
                headers=headers,
                json=payload
            )
            if submit_res.status_code != 200:
                try:
                    detail = submit_res.json()
                except:
                    detail = submit_res.text
                raise HTTPException(status_code=submit_res.status_code, detail=detail)

            task_id = submit_res.json().get("task_id")
            print(f"MS Generate Task submitted ({req.model}), ID: {task_id}")

            TERMINAL_FAILED_STATUSES = {"FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"}

            for i in range(300):
                await asyncio.sleep(0.5)
                try:
                    result = await client.get(
                        f"{base_url}v1/tasks/{task_id}",
                        headers={**headers, "X-ModelScope-Task-Type": "image_generation"},
                    )
                    data = result.json()
                    status = data.get("task_status")
                    print(f"MS Task {task_id} poll {i}: status={status}")

                    if status == "SUCCEED":
                        img_url = data["output_images"][0]
                        local_path = ""
                        try:
                            async with httpx.AsyncClient() as dl_client:
                                img_res = await dl_client.get(img_url)
                                if img_res.status_code == 200:
                                    filename = f"ms_{req.model.replace('/', '_').replace(':', '_')}_{int(time.time())}.png"
                                    if username:
                                        user_dir, _ = _main.get_user_output_dir(username)
                                        file_path = os.path.join(user_dir, filename)
                                        local_path = _main.build_output_url(None, filename, username)
                                    else:
                                        file_path = os.path.join(_main.OUTPUT_DIR, filename)
                                        local_path = f"/output/{filename}"
                                    with open(file_path, "wb") as f:
                                        f.write(img_res.content)
                                else:
                                    local_path = img_url
                        except Exception:
                            local_path = img_url

                        record = {
                            "timestamp": time.time() * 1000,
                            "prompt": req.prompt,
                            "images": [local_path],
                            "type": "klein",
                            "model": req.model,
                            "user": username,
                        }
                        _main.save_to_history(record)
                        if _main.GLOBAL_LOOP:
                            asyncio.run_coroutine_threadsafe(_main.manager.broadcast_new_image(record), _main.GLOBAL_LOOP)
                        return {"url": local_path, "task_id": task_id}

                    elif status in TERMINAL_FAILED_STATUSES:
                        error_info = data.get("error_info") or data.get("message") or data.get("detail") or str(data)
                        raise HTTPException(status_code=502, detail=f"MS task {status}: {error_info}")

                except HTTPException:
                    raise
                except Exception as loop_e:
                    print(f"MS polling error: {loop_e}")
                    continue

            raise HTTPException(status_code=504, detail="MS 生图超时")

    except HTTPException:
        raise
    except Exception as e:
        print(f"MS generate error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
