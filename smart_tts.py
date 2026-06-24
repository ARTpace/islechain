"""
智能 TTS 文本精修模块
用户输入原始文本 → LLM → 输出带情绪标签、拼音纠错、推荐参数的优化文本
"""

import json
import urllib.request
import urllib.error
from typing import Optional, Dict, Any
from pathlib import Path
from smart_prompt import load_config


SYSTEM_PROMPT = """你是一个 TTS 文本精修师。分析用户输入的中文文本，完成：

1. 在合适位置添加情绪标签（如 [laughter] [sigh] [surprise-wa] 等）
2. 修正多音字，格式：汉字+拼音大写+声调数字（如 银HANG2行）
3. 推荐生成参数

严格输出 JSON，不要其他文字：

{"enhanced_text":"优化后文本","suggested_params":{"speed":1.0,"steps":32,"cfg":2.0},"changes":["修改说明"]}

参数规则：
- 情感强/对话：speed 0.85-0.95, cfg 2.2-2.8
- 平稳叙述：speed 1.0, cfg 2.0
- 新闻播报：speed 1.05-1.15
- 轻松闲聊：speed 0.95-1.05, cfg 1.8-2.2

可用标签：[laughter]笑 [sigh]叹 [dissatisfaction-hnn]不满 [question-ah]疑问 [surprise-wa]惊讶 [surprise-ah]啊 [surprise-oh]哦 [surprise-yo]哟 [question-oh]哦？ [question-ei]诶？ [question-yi]咦？

多音字常见修正：
银行→银HANG2行 重要→重YAO4要 音乐→音YUE4乐 觉得→觉DE2得 行为→行WEI2为 还是→还SHI4是 对话→对HUA4话 模样→模YANG4样 尽量→尽LIANG4量 处理→处LI3理 角色→角SE4色 折腾→折TENG1腾"""


def call_llm_direct(user_input: str, system_prompt: str, config: Dict[str, Any]) -> str:
    """直接调用 LLM API"""
    base_url = config.get("base_url", "").rstrip("/")
    api_key = config.get("api_key", "")
    model = config.get("model", "")

    if base_url.endswith('/v1'):
        url = f"{base_url}/chat/completions"
    else:
        url = f"{base_url}/v1/chat/completions"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_input}
        ],
        "temperature": 0.3,
        "max_tokens": 4096,
        "stream": False
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode('utf-8'),
            headers=headers,
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode('utf-8')
            result = json.loads(raw)
            content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            # 推理模型可能把内容放在 reasoning_content 里
            if not content:
                content = result.get("choices", [{}])[0].get("message", {}).get("reasoning_content", "")
            return content
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8', errors='ignore')
        return f"ERROR: API 调用失败 ({e.code}): {error_body[:200]}"
    except Exception as e:
        return f"ERROR: {str(e)}"


def generate_smart_tts(user_input: str, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    智能 TTS 文本精修主函数
    """
    if config is None:
        config = load_config()
    else:
        merged = load_config()
        merged.update(config)
        config = merged

    # 调用 LLM
    raw_output = call_llm_direct(user_input, SYSTEM_PROMPT, config)

    if raw_output.startswith("ERROR:"):
        return {
            "success": False,
            "enhanced_text": "",
            "suggested_params": {},
            "changes": [],
            "raw": raw_output,
            "error": raw_output
        }

    if not raw_output or not raw_output.strip():
        return {
            "success": False,
            "enhanced_text": "",
            "suggested_params": {},
            "changes": [],
            "raw": raw_output,
            "error": "AI 返回为空"
        }

    # 解析 JSON 输出
    try:
        text = raw_output.strip()

        # 尝试多种方式提取 JSON
        json_text = None

        # 方式1: ```json ... ```
        if '```json' in text:
            start = text.find('```json') + 7
            end = text.find('```', start)
            if end > start:
                json_text = text[start:end].strip()

        # 方式2: ``` ... ```
        if not json_text and '```' in text:
            start = text.find('```') + 3
            end = text.find('```', start)
            if end > start:
                json_text = text[start:end].strip()

        # 方式3: 找 { ... }
        if not json_text:
            start = text.find('{')
            end = text.rfind('}')
            if start >= 0 and end > start:
                json_text = text[start:end + 1]

        if not json_text:
            json_text = text

        result = json.loads(json_text)

        return {
            "success": True,
            "enhanced_text": result.get("enhanced_text", user_input),
            "suggested_params": result.get("suggested_params", {}),
            "changes": result.get("changes", []),
            "raw": raw_output,
            "error": ""
        }
    except json.JSONDecodeError as e:
        return {
            "success": False,
            "enhanced_text": "",
            "suggested_params": {},
            "changes": [],
            "raw": raw_output,
            "error": "AI 输出格式错误，请重试"
        }
    except Exception as e:
        return {
            "success": False,
            "enhanced_text": "",
            "suggested_params": {},
            "changes": [],
            "raw": raw_output,
            "error": str(e)
        }
