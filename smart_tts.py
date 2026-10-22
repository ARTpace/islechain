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
import logging
logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """你是一个 TTS 文本精修师。分析用户输入的中文文本，完成：

1. 在合适位置添加情绪标签（如 [laughter] [sigh] [surprise-wa] 等）
2. 修正多音字，格式：汉字+拼音大写+声调数字（如 银HANG2行）
3. 根据文本内容选择最合适的参数预设

严格输出 JSON，不要其他文字：

{"enhanced_text":"优化后文本","recommended_preset":"预设ID","changes":["修改说明"]}

可选预设（选一个最匹配的）：
- fast_preview: 极速预览，快速试听用
- balanced: 均衡推荐，通用默认
- high_quality: 高质量，追求音质
- clone_focused: 克隆相似度优先，尽量还原参考音色
- emotion_focused: 情绪表现优先，对话/情感类文本
- longtext_stable: 长文本稳定，长句/段落
- broadcast: 新闻播报，正式/资讯类，语速略快
- storytelling: 有声书，叙事/朗读类，节奏沉稳
- whisper: 耳语，亲密/ASMR 类，极慢极柔
- advertising: 广告配音，宣传/推广类，有力度
- meditation: 冥想放松，舒缓/引导类，极慢极稳
- low_vram: 低显存模式，显卡吃紧时用

选择规则：
- 带对话感、情感丰富的文本 → emotion_focused
- 长段落、叙述性文字 → longtext_stable
- 需要精确还原参考音色 → clone_focused
- 新闻/资讯/正式场合 → broadcast
- 讲故事/小说朗读 → storytelling
- 耳语/ASMR/亲密感 → whisper
- 广告/宣传/推广 → advertising
- 冥想/放松/引导 → meditation
- 普通文本 → balanced
- 追求最佳音质 → high_quality
- 只是快速试听 → fast_preview
- 显卡显存不够 → low_vram

可用标签（每个标签后必须加逗号，否则可能不生效）：
[laughter],笑 [sigh],叹 [dissatisfaction-hnn],不满 [confirmation-en],英文确认 [question-en],英文疑问 [question-ah],疑问 [surprise-wa],惊讶 [surprise-ah],啊 [surprise-oh],哦 [surprise-yo],哟 [question-oh],哦？ [question-ei],诶？ [question-yi],咦？

示例：太好[laughter],了 算[question-ah],了吧 [surprise-wa],这么厉害

多音字常见修正：
银行→银HANG2行 重要→重YAO4要 音乐→音YUE4乐 觉得→觉DE2得 行为→行WEI2为 还是→还SHI4是 对话→对HUA4话 模样→模YANG4样 尽量→尽LIANG4量 处理→处LI3理 角色→角SE4色 折腾→折TENG1腾"""


def call_llm_direct(user_input: str, system_prompt: str, config: Dict[str, Any]) -> str:
    """直接调用 LLM API"""
    base_url = config.get("base_url", "").rstrip("/")
    api_key = config.get("api_key", "")
    model = config.get("model", "")
    
    _kp = (api_key[:3] + "***") if api_key else "None"
    print(f"[LLM] base_url={base_url}, model={model}, api_key={_kp}...")

    if not base_url:
        return "ERROR: 未配置 API base_url"
    
    if not api_key:
        return "ERROR: 未配置 API Key"

    if base_url.endswith('/v1'):
        url = f"{base_url}/chat/completions"
    else:
        url = f"{base_url}/v1/chat/completions"
    
    print(f"[LLM] url={url}")

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
        with urllib.request.urlopen(req, timeout=120) as resp:
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
            "recommended_preset": "",
            "changes": [],
            "raw": raw_output,
            "error": raw_output
        }

    if not raw_output or not raw_output.strip():
        return {
            "success": False,
            "enhanced_text": "",
            "recommended_preset": "",
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
            "recommended_preset": result.get("recommended_preset", "balanced"),
            "changes": result.get("changes", []),
            "raw": raw_output,
            "error": ""
        }
    except json.JSONDecodeError as e:
        return {
            "success": False,
            "enhanced_text": "",
            "recommended_preset": "",
            "changes": [],
            "raw": raw_output,
            "error": "AI 输出格式错误，请重试"
        }
    except Exception as e:
        return {
            "success": False,
            "enhanced_text": "",
            "recommended_preset": "",
            "changes": [],
            "raw": raw_output,
            "error": str(e)
        }
