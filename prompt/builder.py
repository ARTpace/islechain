"""
builder.py — System Prompt 模板引擎
====================================
职责：将外部模板文件 + 变量注入 → 渲染最终的 system prompt。

核心思路：
  - 模板使用 Markdown 格式 + {{variable}} 变量占位
  - 不依赖外部模板引擎（如 Jinja2），自建轻量渲染
  - 用户可在 templates/custom/ 下创建自定义模板
  - LoRA 触发词保护规则始终注入，不可被模板覆盖

使用方式：
    from prompt.builder import render
    system_prompt = render("default", knowledge="...", quality_tags="...")
"""

from pathlib import Path
from typing import Optional, Dict, Any

MODULE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = MODULE_DIR / "templates"
CUSTOM_TEMPLATES_DIR = TEMPLATES_DIR / "custom"


# ── 模板变量默认值 ────────────────────────────────────────────────────
_DEFAULT_VARS = {
    "quality_tags": "masterpiece, best quality, ultra detailed, highres",
    "negative": "worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry",
    "knowledge": "",
    "custom_rules": "",
}

# LoRA 触发词保护 — 始终注入，模板中引用 {{lora_protection}} 即可
LORA_PROTECTION_BLOCK = """
## LoRA 触发词保护（强制规则，不可覆盖）
- 用户输入中所有以 `@` 开头的标签，**必须原样保留在输出中，不做任何修改、合并、重写或删除**
- 这些是 LoRA 模型的触发词（trigger word），如果丢失或被改写，LoRA 效果会完全失效
- 即使 `@xxx` 看起来像画师标签，只要它出现在用户输入中，就视为 LoRA 触发词，必须原样保留
- 输出时将它们放在标签列表的末尾，与其他标签用逗号分隔

"""


def render(template_name: str = "default", **variables) -> str:
    """
    渲染 system prompt 模板。

    Args:
        template_name: 模板文件名（不含 .md 后缀）
            内置： "default" — 默认 Anima 标签生成模板
                    "json"   — JSON 输出模板
            自定义：templates/custom/{template_name}.md
        **variables: 注入模板的变量
            quality_tags   — 质量词
            negative       — 负向提示词
            knowledge      — 知识库片段
            custom_rules   — 用户自定义规则
            lora_protection — LoRA 保护规则（传 None 将使用默认）

    Returns:
        渲染后的 system prompt 字符串
    """
    # 1. 加载模板内容
    content = _load_template(template_name)
    if content is None:
        # 模板不存在，回退到 default
        content = _load_template("default")
    if content is None:
        raise FileNotFoundError(f"默认模板 templates/default.md 不存在")

    # 2. 合并变量
    vars_dict = _DEFAULT_VARS.copy()
    vars_dict.update(variables)
    # LoRA 保护规则：如果调用方没传，使用默认的；如果传了空字符串，则不注入
    if "lora_protection" not in vars_dict:
        vars_dict["lora_protection"] = LORA_PROTECTION_BLOCK

    # 3. 简单变量替换
    result = content
    for key, value in vars_dict.items():
        result = result.replace("{{" + key + "}}", str(value))

    return result


def list_templates() -> list:
    """列出所有可用模板"""
    templates = []

    # 内置模板
    builtin_files = [
        "default.md",
        "json.md",
    ]
    for fname in builtin_files:
        path = TEMPLATES_DIR / fname
        if path.exists():
            templates.append({
                "name": fname.replace(".md", ""),
                "path": str(path),
                "builtin": True,
                "title": _extract_title(path),
            })

    # 自定义模板
    if CUSTOM_TEMPLATES_DIR.exists():
        for path in sorted(CUSTOM_TEMPLATES_DIR.glob("*.md")):
            templates.append({
                "name": path.stem,
                "path": str(path),
                "builtin": False,
                "title": _extract_title(path),
            })

    return templates


def save_custom_template(name: str, content: str):
    """
    保存自定义模板。

    如果同名模板已存在则覆盖。
    模板名称只允许字母、数字、下划线、连字符。
    """
    import re
    if not re.match(r'^[a-zA-Z0-9_-]+$', name):
        raise ValueError("模板名称只允许字母、数字、下划线和连字符")

    CUSTOM_TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    path = CUSTOM_TEMPLATES_DIR / f"{name}.md"
    path.write_text(content, encoding='utf-8')


def delete_custom_template(name: str) -> bool:
    """删除自定义模板。不能删除内置模板。"""
    path = CUSTOM_TEMPLATES_DIR / f"{name}.md"
    if not path.exists():
        return False
    path.unlink()
    return True


def _load_template(template_name: str) -> Optional[str]:
    """从文件系统加载模板内容"""
    # 1. 先查自定义模板
    custom_path = CUSTOM_TEMPLATES_DIR / f"{template_name}.md"
    if custom_path.exists():
        return custom_path.read_text(encoding='utf-8')

    # 2. 再查内置模板
    builtin_path = TEMPLATES_DIR / f"{template_name}.md"
    if builtin_path.exists():
        return builtin_path.read_text(encoding='utf-8')

    return None


def _extract_title(path: Path) -> str:
    """从模板文件中提取标题（第一个 # 行）"""
    try:
        content = path.read_text(encoding='utf-8')
        for line in content.split('\n'):
            line = line.strip()
            if line.startswith('# '):
                return line[2:].strip()
    except Exception:
        pass
    return path.stem
