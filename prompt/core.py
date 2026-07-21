"""
core.py — 核心生成流程编排
===========================
职责：串联 config → preset → knowledge → builder → LLM → parse 的完整流程。

这是 prompt 模块的核心入口，外部调用通过 __init__.py 暴露的 generate() 访问。

与旧版 smart_prompt.py 的关键区别：
  - 不再在生成函数内部拼接 system prompt（交给 builder）
  - 不再在生成函数内部找 provider 和 API key（交给 config）
  - 不再全量嵌入知识库（交给 knowledge.search 只取匹配片段）
  - 输出解析独立为 parse_output()，便于单测
"""

import json
import re
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional, Dict, Any

from . import config as cfg
from . import preset as pst
from . import knowledge as kn
from . import builder as bld


# ═══════════════════════════════════════════════════════════════════════
#  LLM 调用
# ═══════════════════════════════════════════════════════════════════════

def call_llm(
    user_input: str,
    system_prompt: str,
    config: Dict[str, Any]
) -> str:
    """
    调用 LLM API。

    Args:
        user_input: 用户输入文本
        system_prompt: 渲染后的 system prompt
        config: 包含 base_url, api_key, model, temperature, max_tokens

    Returns:
        LLM 返回的文本，或 "ERROR: ..." 错误信息
    """
    # ── 参数提取 ──
    base_url = config.get("base_url", "").rstrip("/")
    api_key = config.get("api_key", "")
    model = config.get("model", "deepseek-chat")
    temperature = config.get("temperature", 0.3)
    max_tokens = config.get("max_tokens", 1024)

    # ── 校验 ──
    if not api_key:
        return "ERROR: 未配置 API Key，请在设置中配置"
    if not base_url:
        return "ERROR: 未配置 API 地址"

    # API Key 非 ASCII 字符过滤（防止 latin-1 编码错误）
    ascii_key = api_key.encode('ascii', 'ignore').decode('ascii')
    if ascii_key != api_key:
        api_key = ascii_key
        if not api_key:
            return "ERROR: API Key 包含非 ASCII 字符，请检查配置"

    # ── 请求构建 ──
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
        "stream": False,
    }

    # ── 发送请求 ──
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode('utf-8'),
            headers=headers,
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            return result.get("choices", [{}])[0].get("message", {}).get("content", "")
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8', errors='ignore')
        return f"ERROR: API 调用失败 ({e.code}): {error_body[:200]}"
    except Exception as e:
        return f"ERROR: {str(e)}"


# ═══════════════════════════════════════════════════════════════════════
#  输出解析
# ═══════════════════════════════════════════════════════════════════════

def parse_output(raw_output: str, output_format: str = "tag") -> Dict[str, str]:
    """
    解析 LLM 原始输出，提取正向和负向提示词。

    Args:
        raw_output: LLM 返回的原始文本
        output_format: 输出格式
            "tag"  — 标签模式，按 [NEG]/[NEGATIVE] 行分割
            "json" — JSON 模式，尝试解析为 JSON 对象

    Returns:
        {"prompt": str, "negative": str}
    """
    # 错误信息直接返回
    if raw_output.startswith("ERROR:"):
        return {"prompt": raw_output, "negative": ""}

    if output_format == "json":
        return _parse_json_output(raw_output)

    # 默认 tag 模式
    return _parse_tag_output(raw_output)


def _parse_tag_output(raw: str) -> Dict[str, str]:
    """标签模式解析：按 [NEG] / [NEGATIVE] 分割正向和负向"""
    lines = raw.strip().split('\n')
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

    # 没解析出负向？用默认值
    if not negative:
        negative = "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry"

    return {"prompt": positive, "negative": negative}


def _parse_json_output(raw: str) -> Dict[str, str]:
    """JSON 模式解析：尝试从原始输出中提取 JSON 对象"""
    cleaned = raw.strip()
    # 去掉可能的 markdown 代码块标记
    cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
    cleaned = re.sub(r'\s*```\s*$', '', cleaned)
    # 提取第一个 JSON 对象
    first_brace = cleaned.find('{')
    last_brace = cleaned.rfind('}')
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        cleaned = cleaned[first_brace:last_brace + 1]

    try:
        parsed = json.loads(cleaned)
        return {
            "prompt": parsed.get("prompt", ""),
            "negative": parsed.get("negative", ""),
        }
    except json.JSONDecodeError:
        # 解析失败，返回原始文本
        return {"prompt": cleaned, "negative": ""}


# ═══════════════════════════════════════════════════════════════════════
#  迁移兼容：load_config 保持与旧版 smart_prompt 相同的函数签名
# ═══════════════════════════════════════════════════════════════════════

def load_config() -> Dict[str, Any]:
    """兼容旧版 smart_prompt.load_config() 的签名"""
    return cfg.resolve()


# ═══════════════════════════════════════════════════════════════════════
#  核心生成函数
# ═══════════════════════════════════════════════════════════════════════

def generate(
    user_input: str,
    preset_id: Optional[str] = None,
    config_override: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    智能提示词生成主函数 — prompt 模块的唯一外部入口。

    流程：
        1. 加载预设 → 确定 provider、quality tags、temperature 等参数
        2. 解析 provider 配置 → 获取 base_url、API key、model
        3. 搜索知识库 → 匹配用户输入相关的片段（取代全量嵌入）
        4. 渲染 system prompt 模板 → 注入变量
        5. 调用 LLM
        6. 解析输出

    Args:
        user_input: 用户的中文/英文描述
        preset_id: 预设 ID。None 表示使用当前选中的预设。
        config_override: 可选配置覆盖

    Returns:
        {
            "success": bool,       # 是否成功
            "prompt": str,         # 生成的正向提示词
            "negative": str,       # 生成的负向提示词
            "raw": str,            # LLM 原始输出（用于调试）
            "error": str,          # 错误信息（success=False 时）
            "preset_used": str,    # 实际使用的预设 ID
        }
    """
    try:
        # ── 步骤 1：确定预设 ──────────────────────────────────────
        if preset_id is None:
            preset_id = pst.get_selected_preset_id()
        preset = pst.get_preset(preset_id) if preset_id else None
        if preset is None:
            preset = pst.get_preset("default")

        # ── 步骤 2：解析配置 ──────────────────────────────────────
        # 预设中指定的 provider 优先
        preset_provider = preset.get("provider_id", "") if preset else ""
        config = cfg.resolve(preset_provider)
        if config_override:
            config.update(config_override)
        # 预设的参数覆盖
        if preset:
            if preset.get("temperature") is not None:
                config["temperature"] = preset["temperature"]
            if preset.get("max_tokens") is not None:
                config["max_tokens"] = preset["max_tokens"]

        # ── 步骤 3：知识库检索 ──────────────────────────────────────
        # 只用匹配的片段，不再全量嵌入
        knowledge_fragment = kn.search(user_input, limit=30)

        # ── 步骤 4：构建 system prompt ────────────────────────────
        quality_tags = preset.get("quality_tags", "") if preset else ""
        negative_default = preset.get("negative_default", "") if preset else ""
        custom_rules = preset.get("system_prompt", "") if preset else ""

        output_format = preset.get("output_format", "tag") if preset else "tag"
        template_name = "json" if output_format == "json" else "default"

        system_prompt = bld.render(
            template_name,
            quality_tags=quality_tags,
            negative=negative_default,
            knowledge=knowledge_fragment,
            custom_rules=custom_rules,
        )

        # ── 步骤 5：调用 LLM ──────────────────────────────────────
        raw_output = call_llm(user_input, system_prompt, config)

        # ── 步骤 6：解析输出 ──────────────────────────────────────
        if raw_output.startswith("ERROR:"):
            return {
                "success": False,
                "prompt": "",
                "negative": "",
                "raw": raw_output,
                "error": raw_output,
                "preset_used": preset.get("id", "") if preset else "",
            }

        parsed = parse_output(raw_output, output_format)

        return {
            "success": True,
            "prompt": parsed["prompt"],
            "negative": parsed["negative"],
            "raw": raw_output,
            "error": "",
            "preset_used": preset.get("id", "") if preset else "",
        }

    except Exception as e:
        return {
            "success": False,
            "prompt": "",
            "negative": "",
            "raw": "",
            "error": str(e),
            "preset_used": "",
        }
