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
import base64
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional, Dict, Any, List

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
    config: Dict[str, Any],
    images: Optional[List[str]] = None,
) -> str:
    """
    调用 LLM API。

    Args:
        user_input: 用户输入文本
        system_prompt: 渲染后的 system prompt
        config: 包含 base_url, api_key, model, temperature, max_tokens
        images: 可选，base64 data URL 列表（如 "data:image/jpeg;base64,..."），
                非空时以 OpenAI 多模态消息格式（content 数组 + image_url）发送。
                用于视频页「看图生成提示词」：直接把参考图交给多模态模型，一次调用完成。

    Returns:
        LLM 返回的文本，或 "ERROR: ..." 错误信息
    """
    # ── 参数提取 ──
    base_url = config.get("base_url", "").rstrip("/")
    api_key = config.get("api_key", "")
    model = config.get("model", "deepseek-chat")
    temperature = config.get("temperature", 0.3)
    max_tokens = config.get("max_tokens", 1024)
    images = images or []

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
    # ── 组装 user 消息：有图则用多模态 content 数组，否则纯文本 ──
    if images:
        user_content = [{"type": "text", "text": user_input}]
        for img in images:
            user_content.append({"type": "image_url", "image_url": {"url": img}})
        user_message = {"role": "user", "content": user_content}
    else:
        user_message = {"role": "user", "content": user_input}
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            user_message
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
            msg = result.get("choices", [{}])[0].get("message", {})
            content = msg.get("content", "")
            # [2026-08-13] 思考型模型（如 agnes-2.0-flash）可能把正文留在 content，
            # 但当 max_tokens 不足时 content 为空、内容全在 reasoning_content。
            # 若 content 为空，回退读取 reasoning_content，避免误判为空/超时。
            if not content:
                content = msg.get("reasoning_content", "")
            return content
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
    provider_id_override: Optional[str] = None,
    images: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    智能提示词生成主函数 — prompt 模块的唯一外部入口。

    流程：
        1. 加载预设 → 取 quality_tags / negative_default / temperature / max_tokens / system_prompt
        2. 解析 provider 配置：provider_id_override > 旧 preset.provider_id（向后兼容） > 全局 > 第一个可用
        3. 搜索知识库 → 匹配用户输入相关的片段
        4. 渲染 system prompt 模板 → 注入变量
        5. 调用 LLM
        6. 解析输出

    Args:
        user_input: 用户的中文/英文描述
        preset_id: 预设 ID。None 表示使用当前选中的预设。
        config_override: 可选配置覆盖
        provider_id_override: [2026-07-28] 全局 provider 覆盖 (e.g. "agnes::agnes-2.0-flash").
            优先级高于 preset 内旧字段。None/空 = 走全局。

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
        # [2026-07-28] provider 优先级: provider_id_override (前端全局) > preset 内旧字段 (向后兼容) > 全局
        legacy_preset_provider = preset.get("provider_id", "") if preset else ""
        provider_id = provider_id_override or legacy_preset_provider
        config = cfg.resolve(provider_id)
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
        if output_format == "json":
            template_name = "json"
        elif output_format == "h3":
            template_name = "h3"
        else:
            template_name = "default"

        system_prompt = bld.render(
            template_name,
            quality_tags=quality_tags,
            negative=negative_default,
            knowledge=knowledge_fragment,
            custom_rules=custom_rules,
        )

        # ── 步骤 5：调用 LLM（带 provider 降级 fallback）───────────
        raw_output = call_llm(user_input, system_prompt, config, images)
        # 记录第一次（用户真正选中的预设）错误，避免被 fallback 错误覆盖
        first_error = raw_output if raw_output.startswith("ERROR:") else ""

        # [2026-07-28] 如果 preset/provider 指定导致失败，降级到全局第一个可用 provider 重试
        if raw_output.startswith("ERROR:") and provider_id:
            # 不指定 provider_id → config.resolve() 自动选择第一个可用的 provider
            fallback_config = cfg.resolve()
            if config_override:
                fallback_config.update(config_override)
            # 保留预设的温度、max_tokens 等参数
            if preset:
                if preset.get("temperature") is not None:
                    fallback_config["temperature"] = preset["temperature"]
                if preset.get("max_tokens") is not None:
                    fallback_config["max_tokens"] = preset["max_tokens"]

            # 仅在 fallback 配置与原始配置确实不同时才重试，避免重复请求同一家
            if (
                fallback_config.get("base_url") != config.get("base_url")
                or fallback_config.get("api_key") != config.get("api_key")
                or fallback_config.get("model") != config.get("model")
            ):
                fb_raw = call_llm(user_input, system_prompt, fallback_config, images)
                if not fb_raw.startswith("ERROR:"):
                    # 兜底成功，使用兜底结果
                    raw_output = fb_raw
                elif first_error:
                    # 两次都失败：优先展示用户选中的预设模型错误，并附上兜底失败信息
                    raw_output = (
                        first_error
                        + " ｜ 已尝试全局兜底模型("
                        + str(fallback_config.get("model", ""))
                        + ")仍失败："
                        + fb_raw
                    )

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

        if output_format == "h3":
            # H3 视频：结构化纯文本（integrated_multimodal_description 等字段），原样返回
            parsed = {"prompt": raw_output.strip(), "negative": ""}
        else:
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


# ═════════════════════════════════════════════════════════════════════
#  导演台整条脚本生成
# ═════════════════════════════════════════════════════════════════════

# 追加在 H3 规则之后的「整条脚本生成」指令，要求输出严格 JSON 分镜脚本。
_SCRIPT_JSON_INSTRUCTION = """

## 整条视频脚本生成任务
你现在要为一个【导演台多片段视频】一次性生成 {segment_count} 个连贯片段的分镜提示词，最终剪接成一条完整视频。整条视频画面比例固定为 **{aspect_ratio}**，每段时长不同：**片段1={seg_durations_csv} 秒**（其中第 N 段为 seg_durations_csv 中第 N 个值）。

### 必须遵守
1. 先定义一个统一的【主角/关键元素清单】：至少包含主要人物（外观、服装、发色、声音、说话风格）、贯穿全片的关键场景或道具。每个元素配一个稳定 ID，人物用 (S1)/(S2)/(S3)...，场景/道具用 <Subject 1>/<Subject 2>...。
2. 所有片段的提示词里，同一人物必须使用【完全一致的外观描述 + 同一个 (Sx) ID】；同一场景/道具用同一个 <Subject N> 标签。这是人物保持一致的关键，绝不能每个片段重新描述成不同长相。
3. 每个片段都是一段完整、可直接提交给 H3 视频模型的提示词（含该片段所需的三大核心字段或对齐指令），但【不要】在每段重复整份主角清单——只在第一个片段完整写出主角定义，后续片段用 (Sx)/<Subject N> 简洁引用即可（引用时沿用同一个 ID，不新增编号）。
4. 片段之间按时间顺序自然连贯：上一段的结尾状态衔接下一段的开头（画面、人物动作、环境连续）。

### 时长与画面比例约束（务必严格遵循）
- 每段时长不同：**片段 N 的时长 = seg_durations_csv 中第 N 个值**（如 [5, 7, 4, 6] 表示片段1=5秒/片段2=7秒/片段3=4秒/片段4=6秒）。请逐段严格按各自时长安排镜头节奏与动作密度，运镜变化、人物动作推进、场景切换至少要有 2~3 个阶段变化，避免“静态动作拍完全部时间”的空洞。
- 整条画面比例固定为 {aspect_ratio}。请在 integrated_multimodal_description 中明确写上“aspect ratio {aspect_ratio}”或“framed in {aspect_ratio}”。同时调整镜头语言：横屏（16:9 / 3:2 / 21:9）多用「wide/horizontal composition」；竖屏（9:16 / 3:4 / 9:21）多用「vertical/portrait composition / close-up framing」；方形（1:1）多用「centered composition」。镜头运动描述也要适配比例：竖屏优先推近/侑仰/上下推拉；横屏可平移/横移/跟踪。

### 输出 JSON 结构（务必严格遵循）
{
  "subjects": ["主角/元素定义，如：S1: a young woman, long crimson hair, white silk dress, soft gentle voice", "..."],
  "segments": [
    {"prompt": "片段 1 的完整 H3 提示词"},
    {"prompt": "片段 2 的完整 H3 提示词"},
    ...共 {segment_count} 段
  ]
}
"""


def generate_script(
    story: str,
    segment_count: int = 3,
    preset_id: Optional[str] = None,
    provider_id_override: Optional[str] = None,
    images: Optional[List[str]] = None,
    seg_durations: Optional[List[Any]] = None,
    aspect_ratio: Optional[str] = None,
) -> Dict[str, Any]:
    """导演台整条脚本生成：一次生成 N 个连贯片段的分镜提示词。

    与 generate() 的区别：输出是一整条视频的分镜脚本（JSON），不是单段提示词。
    复用 H3 视频预设的规则（若指定 h3 相关预设），并在其基础上追加「整条脚本生成」指令，
    要求 LLM 统一定义主角、逐段产出、保持人物一致。

    Args:
        story: 故事创意概述或逐段剧情点（按 mode 语义）
        segment_count: 片段数量
        preset_id: 预设 ID（缺省用 h3-video，保证视频提示词规范）
        provider_id_override: provider 覆盖
        images: 参考图 base64 data URL 列表（可选）

    Returns:
        {"success", "subjects": [...], "segments": [{"prompt": ...}], "raw", "error"}
    """
    try:
        segment_count = max(1, min(int(segment_count), 30))

        # ── 预设：默认走 H3 视频规则 ──
        if preset_id is None:
            preset = pst.get_preset("h3-video") or pst.get_preset("default")
            preset_id = preset.get("id") if preset else "default"
        else:
            preset = pst.get_preset(preset_id)
            if preset is None:
                preset = pst.get_preset("default")

        # ── 解析 provider 配置 ──
        legacy_provider = preset.get("provider_id", "") if preset else ""
        provider_id = provider_id_override or legacy_provider
        config = cfg.resolve(provider_id)
        if preset:
            if preset.get("temperature") is not None:
                config["temperature"] = preset["temperature"]
            if preset.get("max_tokens") is not None:
                config["max_tokens"] = preset["max_tokens"]
        # 脚本生成需要更长输出，强制放大 max_tokens
        config["max_tokens"] = max(int(config.get("max_tokens", 2048)), 4096)

        # ── 组装 system prompt：H3 规则 + 脚本生成指令 ──
        h3_rules = preset.get("system_prompt", "") if preset else ""
        # 每段时长（可以是数组，每段不一样）与画面比例
        durs_in = seg_durations if isinstance(seg_durations, list) and seg_durations else None
        seg_dur_list: List[int] = []
        for i in range(segment_count):
            v = None
            if durs_in and i < len(durs_in):
                try:
                    v = int(round(float(durs_in[i])))
                except Exception:
                    v = None
            if v is None or v <= 0:
                v = 5
            v = max(1, min(15, v))
            seg_dur_list.append(v)
        # 占位符：{seg_duration} 同时反映“默认段时长”（多段不同时取中位数）；{seg_durations_list} 为逐段列表
        try:
            import statistics
            median_dur = int(round(statistics.median(seg_dur_list)))
        except Exception:
            median_dur = seg_dur_list[0] if seg_dur_list else 5
        seg_dur_str = str(max(1, min(15, median_dur)))
        aspect_str = (aspect_ratio or "16:9").strip() or "16:9"
        seg_durations_csv = ", ".join(str(x) for x in seg_dur_list)
        instruction = _SCRIPT_JSON_INSTRUCTION.replace(
            "{segment_count}", str(segment_count)
        ).replace("{seg_duration}", seg_dur_str).replace("{aspect_ratio}", aspect_str).replace("{seg_durations_csv}", seg_dur_csv)
        system_prompt = (h3_rules + instruction) if h3_rules else instruction

        # ── 调用 LLM（带降级 fallback）──
        raw_output = call_llm(story, system_prompt, config, images)
        if raw_output.startswith("ERROR:") and provider_id:
            fb = cfg.resolve()
            if preset and preset.get("max_tokens") is not None:
                fb["max_tokens"] = max(int(preset["max_tokens"]), 4096)
            else:
                fb["max_tokens"] = 4096
            if (
                fb.get("base_url") != config.get("base_url")
                or fb.get("api_key") != config.get("api_key")
                or fb.get("model") != config.get("model")
            ):
                fb_raw = call_llm(story, system_prompt, fb, images)
                if not fb_raw.startswith("ERROR:"):
                    raw_output = fb_raw

        if raw_output.startswith("ERROR:"):
            return {"success": False, "subjects": [], "segments": [], "raw": raw_output, "error": raw_output}

        # ── 解析 JSON ──
        parsed = _parse_script_json(raw_output)
        if parsed is None:
            return {
                "success": False,
                "subjects": [],
                "segments": [],
                "raw": raw_output,
                "error": "模型输出不是有效 JSON 分镜脚本，请重试或减少片段数",
            }
        return {
            "success": True,
            "subjects": parsed.get("subjects", []),
            "segments": parsed.get("segments", []),
            "raw": raw_output,
            "error": "",
        }
    except Exception as e:
        return {"success": False, "subjects": [], "segments": [], "raw": "", "error": str(e)}


def _parse_script_json(raw: str) -> Optional[Dict[str, Any]]:
    """从 LLM 输出中提取脚本 JSON 对象（容错：去 markdown 包裹、截取首尾花括号）。"""
    cleaned = raw.strip()
    cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
    cleaned = re.sub(r'\s*```\s*$', '', cleaned)
    first = cleaned.find('{')
    last = cleaned.rfind('}')
    if first == -1 or last == -1 or last <= first:
        return None
    cleaned = cleaned[first:last + 1]
    try:
        data = json.loads(cleaned)
        segs = data.get("segments")
        if not isinstance(segs, list):
            return None
        # 规整：segments 里的每项可能是 str 或 {"prompt": str}
        normalized = []
        for s in segs:
            if isinstance(s, str):
                normalized.append({"prompt": s})
            elif isinstance(s, dict) and s.get("prompt"):
                normalized.append({"prompt": str(s["prompt"])})
            else:
                normalized.append({"prompt": ""})
        return {"subjects": data.get("subjects", []), "segments": normalized}
    except json.JSONDecodeError:
        return None
