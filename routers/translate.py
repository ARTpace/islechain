"""路由模块（自 main.py 拆出，2026-10-22 P1-3 继续拆分）

前缀: /api/translate
"""
import hashlib, httpx, os, time, urllib.error
from fastapi import APIRouter

import main as _main

router = APIRouter()


@router.get("/api/translate/config")
async def get_translate_config():
    cfg = _main.load_translate_config()
    # 安全返回:隐藏 secret_key 中间部分
    safe = dict(cfg)
    if safe.get("baidu_secret_key"):
        sk = safe["baidu_secret_key"]
        safe["baidu_secret_key_preview"] = sk[:3] + "***" + sk[-3:] if len(sk) > 6 else "***"
    else:
        safe["baidu_secret_key_preview"] = ""
    return safe

@router.post("/api/translate/config")
async def save_translate_config_api(payload: dict):
    cfg = _main.load_translate_config()
    for key in ["provider_type", "baidu_app_id", "baidu_secret_key", "ai_provider_id", "ai_model", "ai_prompt_template", "source_lang", "target_lang"]:
        if key in payload:
            cfg[key] = payload[key]
    _main.save_translate_config(cfg)
    return {"success": True}

async def translate_with_baidu(text: str, from_lang: str, to_lang: str, app_id: str, secret_key: str) -> str:
    """百度通用翻译 API"""
    salt = str(int(time.time() * 1000))
    sign_str = app_id + text + salt + secret_key
    sign = hashlib.md5(sign_str.encode('utf-8')).hexdigest()
    lang_map = {"zh": "zh", "en": "en", "ja": "jp", "ko": "kor", "fr": "fra", "de": "de", "ru": "ru", "es": "spa", "pt": "pt", "it": "it", "ar": "ara", "th": "th", "vi": "vie"}
    from_lang_baidu = lang_map.get(from_lang, from_lang)
    to_lang_baidu = lang_map.get(to_lang, to_lang)
    params = urllib.parse.urlencode({
        "q": text, "from": from_lang_baidu, "to": to_lang_baidu,
        "appid": app_id, "salt": salt, "sign": sign
    })
    url = f"https://fanyi-api.baidu.com/api/trans/vip/translate?{params}"
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url)
        data = resp.json()
    if "error_code" in data:
        raise Exception(f"百度翻译错误 ({data['error_code']}): {data.get('error_msg', '')}")
    results = data.get("trans_result", [])
    return "\n".join(r.get("dst", "") for r in results)

async def translate_with_ai(text: str, from_lang: str, to_lang: str, provider_id: str, model: str, template: str) -> str:
    """用 AI 模型翻译"""
    providers = _main.load_api_providers()
    provider = next((p for p in providers if p.get("id") == provider_id), None)
    if not provider:
        raise Exception(f"未找到 provider: {provider_id}")
    base_url = (provider.get("base_url") or "").strip()
    if not base_url:
        raise Exception("provider 未配置 base_url")
    api_key = _main.get_provider_api_key(provider_id)
    if not api_key:
        raise Exception("未配置 API Key")
    if not model:
        chat_models = provider.get("chat_models") or []
        model = chat_models[0] if chat_models else "gpt-4o-mini"
    lang_names = {"zh": "中文", "en": "英文", "ja": "日文", "ko": "韩文", "fr": "法文", "de": "德文", "ru": "俄文", "es": "西班牙文", "pt": "葡萄牙文", "ar": "阿拉伯文", "th": "泰文", "vi": "越南文"}
    from_name = lang_names.get(from_lang, from_lang)
    to_name = lang_names.get(to_lang, to_lang)
    # 构建翻译 prompt,明确指定源语言和目标语言
    prompt = f"将以下{from_name}文本翻译成{to_name},只输出翻译结果,不要任何解释:\n\n{text}"
    url = _main.api_root(base_url) + "/chat/completions"
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {_main.sanitize_api_key(api_key)}"}
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 2048,
        "stream": False
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, json=body, headers=headers)
        if resp.status_code >= 400:
            raise Exception(f"AI API 错误 ({resp.status_code}): {resp.text[:200]}")
        data = resp.json()
    return data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

@router.post("/api/translate")
async def translate_text(payload: dict):
    text = (payload.get("text") or "").strip()
    direction = payload.get("direction", "zh2en")
    if not text:
        return {"success": False, "error": "请输入要翻译的文本"}
    cfg = _main.load_translate_config()
    # 解析方向:zh2en, en2ja, zh2fr 等
    lang_map = {
        'zh': '中文', 'en': '英语', 'ja': '日语', 'ko': '韩语',
        'fr': '法语', 'de': '德语', 'es': '西班牙语', 'pt': '葡萄牙语',
        'ru': '俄语', 'ar': '阿拉伯语', 'th': '泰语', 'vi': '越南语'
    }
    parts = direction.split('2')
    if len(parts) == 2 and parts[0] in lang_map and parts[1] in lang_map:
        from_lang, to_lang = parts[0], parts[1]
    elif direction == 'zh2en':
        from_lang, to_lang = cfg.get('source_lang', 'zh'), cfg.get('target_lang', 'en')
    else:
        from_lang, to_lang = 'zh', 'en'
    provider_type = cfg.get("provider_type", "ai")
    try:
        # 先查缓存
        cached = _main._translate_cache_get(text, direction)
        if cached is not None:
            return {"success": True, "result": cached, "_cached": True}

        if provider_type == "baidu":
            app_id = cfg.get("baidu_app_id", "")
            secret_key = cfg.get("baidu_secret_key", "")
            if not app_id or not secret_key:
                return {"success": False, "error": "未配置百度翻译 App ID 或 Secret Key"}
            result = await translate_with_baidu(text, from_lang, to_lang, app_id, secret_key)
        else:
            ai_pid = cfg.get("ai_provider_id", "")
            if not ai_pid:
                return {"success": False, "error": "未选择 AI 翻译模型"}
            result = await translate_with_ai(
                text, from_lang, to_lang, ai_pid,
                cfg.get("ai_model", ""),
                cfg.get("ai_prompt_template", "将以下提示词翻译成目标语言,只输出翻译结果:\n\n{text}")
            )
            # 写入缓存
            _main._translate_cache_set(text, direction, result)
        return _clean_translate_response({"success": True, "result": result})
    except Exception as e:
        return {"success": False, "error": str(e)}

# 缓存返回时清理内部字段
def _clean_translate_response(resp: dict) -> dict:
    """去掉 _cached 等内部字段，只暴露给前端"""
    if not isinstance(resp, dict):
        return resp
    return {k: v for k, v in resp.items() if not k.startswith('_')}

@router.post("/api/translate/test")
async def test_translate(payload: dict = None):
    cfg = dict(_main.load_translate_config())
    # 测试当前表单，不改写已保存配置；空密钥沿用已保存值。
    for key in ("provider_type", "baidu_app_id", "baidu_secret_key", "ai_provider_id", "ai_model", "ai_prompt_template"):
        if payload and key in payload and (key != "baidu_secret_key" or payload[key]):
            cfg[key] = payload[key]
    test_text = "一只粉色头发的女孩在夕阳下的海滩上微笑,穿着白色连衣裙"
    try:
        if cfg.get("provider_type") == "baidu":
            app_id = cfg.get("baidu_app_id", "")
            sk = cfg.get("baidu_secret_key", "")
            if not app_id or not sk:
                return {"success": False, "error": "未配置百度翻译 App ID 或 Secret Key"}
            result = await translate_with_baidu(test_text, "zh", "en", app_id, sk)
        else:
            ai_pid = cfg.get("ai_provider_id", "")
            if not ai_pid:
                return {"success": False, "error": "未选择 AI 翻译模型"}
            result = await translate_with_ai(
                test_text, "zh", "en", ai_pid,
                cfg.get("ai_model", ""),
                cfg.get("ai_prompt_template", "将以下提示词翻译成目标语言,只输出翻译结果:\n\n{text}")
            )
        return {"success": True, "result": result, "test_input": test_text}
    except Exception as e:
        return {"success": False, "error": str(e)}
