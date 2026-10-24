"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/smart-prompt
"""
from fastapi import HTTPException
import json, os, urllib.error, uuid
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/api/smart-prompt/config")
async def get_smart_prompt_config():
    """获取智能提示词的 provider 选择"""
    config_file = _config_file()
    try:
        if os.path.exists(config_file):
            with open(config_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # [2026-07-28] 返回 channel + provider_id + comfyui 工作流/模型
                return {
                    "provider_id": data.get("provider_id", ""),
                    "channel": data.get("channel", "api"),
                    "comfyui_workflow": data.get("comfyui_workflow", "提示词/文生提示词.json"),
                    "comfyui_model": data.get("comfyui_model", ""),
                }
    except Exception:
        pass
    return {"provider_id": "", "channel": "api", "comfyui_workflow": "提示词/文生提示词.json", "comfyui_model": ""}

@router.post("/api/smart-prompt/config")
async def save_smart_prompt_config(payload: dict):
    """保存智能提示词的 provider 选择"""
    config_file = _config_file()
    os.makedirs(os.path.dirname(config_file), exist_ok=True)
    data = {}
    if os.path.exists(config_file):
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            pass
    # [2026-07-28] 存 channel + provider_id + comfyui 工作流/模型
    data["provider_id"] = payload.get("provider_id", "")
    channel = payload.get("channel", "api")
    if channel not in ("api", "comfyui"):
        channel = "api"
    data["channel"] = channel
    data["comfyui_workflow"] = payload.get("comfyui_workflow", "提示词/文生提示词.json") or "提示词/文生提示词.json"
    data["comfyui_model"] = payload.get("comfyui_model", "") or ""
    _main.atomic_write_json(config_file, data, ensure_ascii=False, indent=2)
    return {"success": True, "channel": channel, "provider_id": data["provider_id"], "comfyui_workflow": data["comfyui_workflow"], "comfyui_model": data["comfyui_model"]}

@router.post("/api/smart-prompt/test")
async def smart_prompt_test(req: _main.SmartPromptRequest):
    """测试当前选中的模型/工作流是否可用 (轻量探针，不跑完整生成)

    - API 通道: 直接对选中 provider 发一次最小推理调用 (不走 provider 降级 fallback)，
      能真实发现过期 key / 地址错误 / 模型不存在等问题。
    - 本地 ComfyUI 通道: 校验 ComfyUI 连通性 + 工作流文件存在 + (若指定) llama 模型在可用列表。
      不实际跑工作流 (本地 LLM 推理约 18s，过重)。
    """
    if (req.channel or "api") == "comfyui":
        return await _smart_prompt_comfyui_test(req)

    # === API 通道: 直接测试选中 provider (无 fallback) ===
    provider_id = req.provider_id or ""
    try:
        from prompt.core import config as _sp_config
    except Exception:
        _sp_config = None
    try:
        if _sp_config is not None:
            config = dict(_sp_config.resolve(provider_id))
        else:
            config = dict(_main.load_config())
        config["max_tokens"] = 256
        config["temperature"] = 0.1
        raw = _main._sp_call_llm("ping", "你是提示词扩写助手，请只回复 ok。", config)
        if isinstance(raw, str) and raw.startswith("ERROR:"):
            return {"success": False, "channel": "api", "provider_id": provider_id,
                    "detail": raw[len("ERROR:"):].strip()}
        return {"success": True, "channel": "api", "provider_id": provider_id, "detail": "模型可用"}
    except Exception as e:
        return {"success": False, "channel": "api", "provider_id": provider_id,
                "detail": f"测试异常: {e}"}


async def _smart_prompt_comfyui_test(req: _main.SmartPromptRequest):
    """本地 ComfyUI 通道可用性探针 (不实际跑工作流)"""
    wf_rel = req.comfyui_workflow or "提示词/文生提示词.json"
    # 1) 连通性
    try:
        urllib.request.urlopen(f"http://{_main.COMFYUI_ADDRESS}/system_stats", timeout=8).read()
    except Exception as e:
        return {"success": False, "channel": "comfyui",
                "detail": f"ComfyUI 不可达 ({_main.COMFYUI_ADDRESS}): {e}"}
    # 2) 工作流文件存在 + 名称合法
    if not _main.WORKFLOW_NAME_RE.match(wf_rel):
        return {"success": False, "channel": "comfyui", "detail": f"工作流名称非法: {wf_rel}"}
    wf_path = os.path.join(_main.WORKFLOW_DIR, *wf_rel.split("/"))
    if not os.path.exists(wf_path):
        return {"success": False, "channel": "comfyui", "detail": f"工作流文件不存在: {wf_rel}"}
    # 3) (可选) llama 模型在 ComfyUI 可用列表
    if req.comfyui_model:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"http://{_main.COMFYUI_ADDRESS}/object_info/llama_cpp_model_loader")
                resp.raise_for_status()
                info = resp.json() or {}
            node_info = info.get("llama_cpp_model_loader", {}) or {}
            inputs = node_info.get("input", {}) or node_info.get("input_required", {}) or {}
            required = inputs.get("required", {}) if isinstance(inputs, dict) else {}
            model_input = required.get("model") or []
            avail = model_input[0] if (isinstance(model_input, (list, tuple)) and len(model_input) > 0 and isinstance(model_input[0], list)) else []
            avail = [str(m) for m in avail]
            if req.comfyui_model not in avail:
                return {"success": False, "channel": "comfyui",
                        "detail": f"模型不在 ComfyUI 可用列表: {req.comfyui_model}"}
        except Exception as e:
            return {"success": False, "channel": "comfyui", "detail": f"无法获取 ComfyUI 模型列表: {e}"}
    suffix = f"，模型[{req.comfyui_model}]可用" if req.comfyui_model else ""
    return {"success": True, "channel": "comfyui",
            "detail": f"ComfyUI 可达，工作流[{wf_rel}]可用{suffix}"}

# === 提示词预设 CRUD ===
def _presets_dir():
    return _main.smart_presets_dir()

def _config_file():
    return _main.smart_prompt_config_path()

def load_presets():
    presets = []
    presets_dir = _presets_dir()
    if os.path.exists(presets_dir):
        for f in sorted(os.listdir(presets_dir)):
            if f.endswith('.json'):
                try:
                    with open(os.path.join(presets_dir, f), 'r', encoding='utf-8') as fh:
                        presets.append(json.load(fh))
                except Exception:
                    pass
    return presets

def save_preset(preset):
    pid = preset.get('id', '')
    if not pid:
        pid = 'preset-' + uuid.uuid4().hex[:8]
        preset['id'] = pid
    path = os.path.join(_presets_dir(), f'{pid}.json')
    _main.atomic_write_json(path, preset, ensure_ascii=False, indent=2)
    return preset

@router.get("/api/smart-prompt/presets")
async def list_presets():
    return {"presets": load_presets()}

@router.post("/api/smart-prompt/presets")
async def create_preset(payload: dict):
    preset = {
        "id": payload.get('id', ''),
        "name": payload.get('name', '新预设'),
        "description": payload.get('description', ''),
        "provider_id": payload.get('provider_id', ''),
        "system_prompt": payload.get('system_prompt', ''),
        "temperature": payload.get('temperature', 0.3),
        "max_tokens": payload.get('max_tokens', 1024),
        "quality_tags": payload.get('quality_tags', 'masterpiece, best quality, ultra detailed, highres'),
        "negative_default": payload.get('negative_default', 'worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry'),
        "output_format": payload.get('output_format', 'tag_only'),
        "is_default": payload.get('is_default', False),
        "created_at": payload.get('created_at', ''),
    }
    saved = save_preset(preset)
    return {"success": True, "preset": saved}

@router.put("/api/smart-prompt/presets/{preset_id}")
async def update_preset(preset_id: str, payload: dict):
    payload['id'] = preset_id
    saved = save_preset(payload)
    return {"success": True, "preset": saved}

@router.delete("/api/smart-prompt/presets/{preset_id}")
async def delete_preset(preset_id: str):
    path = os.path.join(_presets_dir(), f'{preset_id}.json')
    if os.path.exists(path):
        os.remove(path)
    return {"success": True}

# === 提示词预设选择(文生图用) ===

@router.get("/api/smart-prompt/selected-preset")
async def get_selected_preset():
    select_file = _config_file()
    try:
        if os.path.exists(select_file):
            with open(select_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return {"preset_id": data.get('preset_id', 'default')}
    except Exception:
        pass
    return {"preset_id": "default"}

@router.post("/api/smart-prompt/selected-preset")
async def set_selected_preset(payload: dict):
    select_file = _config_file()
    os.makedirs(os.path.dirname(select_file), exist_ok=True)
    data = {}
    if os.path.exists(select_file):
        try:
            with open(select_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            pass
    data['preset_id'] = payload.get('preset_id', 'default')
    _main.atomic_write_json(select_file, data, ensure_ascii=False, indent=2)
    # [FIX 2026-07-28] 同步到新模块 index.json。
    # 否则 new-module 生成路径里 generate() -> get_selected_preset_id() 读的是
    # prompt/presets/index.json 的 selected_preset_id，而本端点只写 data/smart-prompt-config.json，
    # 导致用户在 UI 选中的带规则预设从未被加载，模型只按字面生成。
    try:
        from prompt.preset import set_selected_preset_id as _sp_set_selected
        _sp_set_selected(data['preset_id'])
    except Exception:
        pass
    return {"success": True}

@router.post("/api/smart-prompt")
async def smart_prompt(req: _main.SmartPromptRequest):
    """智能提示词生成: 中文描述 → 扩写后 prompt (支持 LLM 平台或本地 ComfyUI 工作流)"""
    # === Local ComfyUI workflow channel (added 2026-07-28) ===
    if (req.channel or "api") == "comfyui":
        try:
            return await _main._smart_prompt_comfyui(req)
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            return {"success": False, "prompt": "", "negative": "", "raw": "", "error": str(e), "traceback": traceback.format_exc()[-1500:]}
    try:
        if _main.USE_NEW_PROMPT_MODULE:
            # 新模块：内部处理预设加载 + 配置解析 + 知识库检索
            result = _main.generate_smart_prompt(
                req.prompt,
                preset_id=None,
                config_override=req.config,
                provider_id_override=req.provider_id,
            )
        else:
            # 旧版兼容路径
            preset_id = 'default'
            try:
                if os.path.exists(SMART_PRESET_SELECT_FILE):
                    with open(SMART_PRESET_SELECT_FILE, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        preset_id = data.get('preset_id', 'default')
            except Exception:
                pass
            preset = None
            for p in load_presets():
                if p.get('id') == preset_id:
                    preset = p
                    break
            config = _main.load_config()
            if req.config:
                config.update(req.config)
            if preset:
                if preset.get('provider_id'):
                    config['_preset_provider'] = preset['provider_id']
                if preset.get('temperature') is not None:
                    config['temperature'] = preset['temperature']
                if preset.get('max_tokens') is not None:
                    config['max_tokens'] = preset['max_tokens']
            result = _main.generate_smart_prompt(req.prompt, config, preset)
        return result
    except Exception as e:
        return {"success": False, "prompt": "", "negative": "", "raw": "", "error": str(e), "traceback": traceback.format_exc()[-1500:]}
