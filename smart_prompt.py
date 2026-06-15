"""
智能提示词生成模块
用户输入中文描述 → LLM + Anima 知识库 → 输出标准 Anima 标签
"""

import os
import json
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional, Dict, Any

# 知识库路径
KNOWLEDGE_DIR = Path(__file__).resolve().parent / "data"
KNOWLEDGE_FILE = KNOWLEDGE_DIR / "anima-knowledge.txt"
# API 平台配置路径
API_PROVIDERS_FILE = Path(__file__).resolve().parent / "api_providers.json"

# 默认配置
DEFAULT_CONFIG = {
    "base_url": "https://api.deepseek.com",
    "api_key": "",
    "model": "deepseek-chat",
    "temperature": 0.3,
    "max_tokens": 1024,
}

# 配置文件路径
CONFIG_FILE = KNOWLEDGE_DIR / "smart-prompt-config.json"


def load_config() -> Dict[str, Any]:
    """从 API 平台配置中读取，不再使用独立配置文件"""
    import re
    config = DEFAULT_CONFIG.copy()
    # 读取 api_providers.json，找第一个有 key 的平台
    if API_PROVIDERS_FILE.exists():
        try:
            with open(API_PROVIDERS_FILE, 'r', encoding='utf-8') as f:
                providers = json.load(f)
            # 遍历平台，找有 key 的 chat 平台
            for p in providers:
                if not isinstance(p, dict):
                    continue
                pid = p.get("id", "")
                base_url = (p.get("base_url") or "").strip()
                # 从 env 读 key（与 main-1.py 的 provider_key_env 逻辑一致）
                if pid == "comfly":
                    env_key = "COMFLY_API_KEY"
                elif pid == "modelscope":
                    env_key = "MODELSCOPE_API_KEY"
                else:
                    env_key = f"API_PROVIDER_{re.sub(r'[^A-Za-z0-9]', '_', pid).upper()}_KEY"
                api_key = os.environ.get(env_key, "").strip()
                chat_models = p.get("chat_models") or []
                if api_key and base_url:
                    config["base_url"] = base_url
                    config["api_key"] = api_key
                    if chat_models:
                        config["model"] = chat_models[0]
                    return config
        except Exception:
            pass
    return config


def save_config(config: Dict[str, Any]):
    """不再使用独立配置文件，配置由 API 设置页面管理"""
    pass


def load_knowledge() -> str:
    """加载 Anima 知识库"""
    if KNOWLEDGE_FILE.exists():
        return KNOWLEDGE_FILE.read_text(encoding='utf-8')
    return ""


def build_system_prompt(knowledge: str) -> str:
    """构建系统提示词"""
    return f"""# Role: Anima Prompt Engineer

你是一个专门为 Anima 模型生成提示词的专家。你的核心任务是根据用户的中文描述，生成标准的 Anima/Danbooru 标签格式提示词。

## 输出规则

1. **只输出标签**：不要输出解释、说明、编号或其他文字
2. **英文标签**：所有标签必须是英文
3. **逗号分隔**：标签之间用逗号+空格分隔
4. **标签顺序**：质量词在前，然后是角色特征、服装、姿势、场景、光影、构图
5. **不要重复**：不要重复相同的标签
6. **不要用句子**：用短语标签，不要用完整句子

## 标签规范

### 质量词（必须包含）
- `masterpiece, best quality, ultra detailed, highres`
- 或 `score_9, score_8_up, score_7_up`

### 负向提示词（单独一行，以 [NEG] 开头）
- `worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry`

## 示例

用户输入：一个粉色头发的女孩在夕阳下的海滩上微笑，穿着白色连衣裙
输出：
masterpiece, best quality, ultra detailed, highres, 1girl, pink hair, long hair, smile, white dress, beach, sunset, golden hour, sand, ocean, waves, from side, upper body, wind, hair flowing

[NEG] worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry

---

## 参考知识库

以下是 Anima 模型的标签知识库，请参考其中的画师风格、标签用法：

{knowledge}
"""


def call_llm(
    user_input: str,
    system_prompt: str,
    config: Dict[str, Any]
) -> str:
    """调用 LLM API"""
    base_url = config.get("base_url", DEFAULT_CONFIG["base_url"]).rstrip("/")
    api_key = config.get("api_key", "")
    model = config.get("model", DEFAULT_CONFIG["model"])
    temperature = config.get("temperature", DEFAULT_CONFIG["temperature"])
    max_tokens = config.get("max_tokens", DEFAULT_CONFIG["max_tokens"])

    if not api_key:
        return "ERROR: 未配置 API Key，请在设置中配置"

    # 构建请求
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
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode('utf-8'),
            headers=headers,
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            return result.get("choices", [{}])[0].get("message", {}).get("content", "")
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8', errors='ignore')
        return f"ERROR: API 调用失败 ({e.code}): {error_body[:200]}"
    except Exception as e:
        return f"ERROR: {str(e)}"


def generate_smart_prompt(user_input: str, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    智能提示词生成主函数
    
    Args:
        user_input: 用户的中文描述
        config: 可选配置覆盖
    
    Returns:
        {
            "success": bool,
            "prompt": str,  # 生成的正向提示词
            "negative": str,  # 生成的负向提示词
            "raw": str,  # LLM 原始输出
            "error": str  # 错误信息
        }
    """
    if config is None:
        config = load_config()
    else:
        merged = load_config()
        merged.update(config)
        config = merged

    # 加载知识库
    knowledge = load_knowledge()
    system_prompt = build_system_prompt(knowledge)

    # 调用 LLM
    raw_output = call_llm(user_input, system_prompt, config)

    if raw_output.startswith("ERROR:"):
        return {
            "success": False,
            "prompt": "",
            "negative": "",
            "raw": raw_output,
            "error": raw_output
        }

    # 解析输出：分离正向和负向提示词
    lines = raw_output.strip().split('\n')
    positive_lines = []
    negative_lines = []
    in_negative = False

    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith('[NEG]') or line.startswith('[NEGATIVE]'):
            in_negative = True
            line = line.replace('[NEG]', '').replace('[NEGATIVE]', '').strip()
            if line:
                negative_lines.append(line)
        elif in_negative:
            negative_lines.append(line)
        else:
            positive_lines.append(line)

    positive = ', '.join(positive_lines).strip(', ')
    negative = ', '.join(negative_lines).strip(', ')

    # 如果没有解析出负向提示词，使用默认的
    if not negative:
        negative = "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry"

    return {
        "success": True,
        "prompt": positive,
        "negative": negative,
        "raw": raw_output,
        "error": ""
    }
