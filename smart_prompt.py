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
    """从 API 平台配置中读取，支持用户指定 provider"""
    import re
    config = DEFAULT_CONFIG.copy()
    # 先读取用户选择的 provider
    selected_provider_id = ''
    config_file = Path(__file__).resolve().parent / "data" / "smart-prompt-config.json"
    try:
        if config_file.exists():
            with open(config_file, 'r', encoding='utf-8') as f:
                sc = json.load(f)
                selected_provider_id = sc.get('provider_id', '')
    except Exception:
        pass

    if API_PROVIDERS_FILE.exists():
        try:
            with open(API_PROVIDERS_FILE, 'r', encoding='utf-8') as f:
                providers = json.load(f)
            for p in providers:
                if not isinstance(p, dict):
                    continue
                pid = p.get("id", "")
                base_url = (p.get("base_url") or "").strip()
                env_key = f"{pid.upper()}_API_KEY"
                api_key = os.environ.get(env_key, "").strip()
                # 回退：从 API/.env 文件读取
                if not api_key:
                    try:
                        api_env = Path(__file__).resolve().parent / "API" / ".env"
                        if api_env.exists():
                            with open(api_env, 'r', encoding='utf-8-sig') as f:
                                for line in f.read().splitlines():
                                    line = line.strip()
                                    if not line or line.startswith('#') or '=' not in line:
                                        continue
                                    k, v = line.split('=', 1)
                                    if k.strip().upper() == env_key.upper():
                                        api_key = v.strip().strip('"').strip("'")
                                        break
                    except Exception:
                        pass
                chat_models = p.get("chat_models") or []
                if not api_key or not base_url:
                    continue
                # 如果用户指定了 provider，只用那个
                if selected_provider_id:
                    if '::' in selected_provider_id:
                        spid, smodel = selected_provider_id.split('::', 1)
                    else:
                        spid, smodel = selected_provider_id, ''
                    if pid == spid:
                        config["base_url"] = base_url
                        config["api_key"] = api_key
                        if smodel:
                            config["model"] = smodel
                        elif chat_models:
                            config["model"] = chat_models[0]
                        return config
                else:
                    # 无指定，用第一个有 key 的
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


def build_system_prompt(knowledge: str, preset: Optional[Dict[str, Any]] = None) -> str:
    """构建系统提示词，支持预设覆盖"""
    # 预设覆盖
    quality = "masterpiece, best quality, ultra detailed, highres"
    negative = "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry"
    custom_rules = ""
    if preset:
        if preset.get('quality_tags'):
            quality = preset['quality_tags']
        if preset.get('negative_default'):
            negative = preset['negative_default']
        if preset.get('system_prompt'):
            custom_rules = preset['system_prompt']
    # LoRA 触发词保护规则（始终注入，无论是否自定义预设）
    lora_protection = """
## LoRA 触发词保护（强制规则，不可覆盖）
- 用户输入中所有以 `@` 开头的标签，**必须原样保留在输出中，不做任何修改、合并、重写或删除**
- 这些是 LoRA 模型的触发词（trigger word），如果丢失或被改写，LoRA 效果会完全失效
- 即使 `@xxx` 看起来像画师标签，只要它出现在用户输入中，就视为 LoRA 触发词，必须原样保留
- 输出时将它们放在标签列表的末尾，与其他标签用逗号分隔
"""
    # 如果预设有自定义 system_prompt，直接使用
    if custom_rules:
        return f"""{custom_rules}
{lora_protection}
## 质量词
{quality}

## 负向提示词
{negative}

---

## 参考知识库

以下是 Anima 模型的标签知识库，请参考其中的画师风格、标签用法：

{knowledge}
"""
    return f"""# Role: Anima Prompt Engineer

你是一个专门为 Anima 模型生成提示词的专家。你的核心任务是根据用户的中文描述，生成标准的 Anima/Danbooru 标签格式提示词。

## 输出规则

1. **只输出标签**：不要输出解释、说明、编号或其他文字
2. **英文标签**：所有标签必须是英文
3. **逗号分隔**：标签之间用逗号+空格分隔
4. **标签顺序**：质量词在前，然后是角色特征、服装、姿势、场景、光影、构图，**LoRA 触发词放最后**
5. **不要重复**：不要重复相同的标签
6. **不要用句子**：用短语标签，不要用完整句子
7. **LoRA 触发词必须原样保留**：用户输入中以 `@` 开头的标签是 LoRA 触发词，绝对不能修改、删除或替换

## 标签规范

### 质量词（必须包含）
- `{quality}`

### 负向提示词（单独一行，以 [NEG] 开头）
- `{negative}`

### LoRA 触发词保护（最重要）
- 用户输入中所有以 `@` 开头的标签，**必须原样保留在输出中，不做任何修改、合并、重写或删除**
- 这些是 LoRA 模型的触发词（trigger word），如果丢失或被改写，LoRA 效果会完全失效
- 即使 `@xxx` 看起来像画师标签，只要它出现在用户输入中，就视为 LoRA 触发词，必须原样保留
- 输出时将它们放在标签列表的末尾，与其他标签用逗号分隔

## 示例

用户输入：一个粉色头发的女孩在夕阳下的海滩上微笑，穿着白色连衣裙
输出：
masterpiece, best quality, ultra detailed, highres, 1girl, pink hair, long hair, smile, white dress, beach, sunset, golden hour, sand, ocean, waves, from side, upper body, wind, hair flowing

[NEG] worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry

用户输入：一个蓝发少女，酷酷的表情，穿着黑色皮衣，使用了 @748cmstyle 风格
输出：
masterpiece, best quality, ultra detailed, highres, 1girl, blue hair, short hair, cool expression, black leather jacket, standing, upper body, @748cmstyle

[NEG] worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry

注意：上面的 @748cmstyle 是 LoRA 触发词，必须原样保留在输出中。

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

    # 过滤 API Key 中的非 ASCII 字符（防止 latin-1 编码错误）
    api_key_ascii = api_key.encode('ascii', 'ignore').decode('ascii')
    if api_key_ascii != api_key:
        api_key = api_key_ascii
        if not api_key:
            return "ERROR: API Key 包含非 ASCII 字符，请检查配置"

    # 构建请求：如果 base_url 已经以 /v1 结尾，不再重复加 /v1
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


def generate_smart_prompt(user_input: str, config: Optional[Dict[str, Any]] = None, preset: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
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
    system_prompt = build_system_prompt(knowledge, preset)

    # 预设指定的 provider 优先
    if preset and preset.get('provider_id'):
        pid = preset['provider_id']
        if '::' in pid:
            spid, smodel = pid.split('::', 1)
        else:
            spid, smodel = pid, ''
        import re
        env_key = f"{spid.upper()}_API_KEY"
        api_key = os.environ.get(env_key, "").strip()
        if not api_key:
            # 回退从 API/.env 读取
            try:
                api_env = Path(__file__).resolve().parent / "API" / ".env"
                if api_env.exists():
                    with open(api_env, 'r', encoding='utf-8-sig') as f:
                        for line in f.read().splitlines():
                            line = line.strip()
                            if not line or line.startswith('#') or '=' not in line:
                                continue
                            k, v = line.split('=', 1)
                            if k.strip().upper() == env_key.upper():
                                api_key = v.strip().strip('"').strip("'")
                                break
            except Exception:
                pass
        # 从 api_providers.json 读取 base_url
        try:
            with open(Path(__file__).resolve().parent / 'api_providers.json', 'r', encoding='utf-8') as f:
                providers = json.load(f)
            for p in providers:
                if p.get('id') == spid:
                    config['base_url'] = p.get('base_url', config.get('base_url', ''))
                    if api_key:
                        config['api_key'] = api_key
                    if smodel:
                        config['model'] = smodel
                    elif p.get('chat_models'):
                        config['model'] = p['chat_models'][0]
                    break
        except Exception:
            pass

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
