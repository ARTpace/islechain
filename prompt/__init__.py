"""
prompt 模块 — AI 提示词生成
============================
统一出口，所有外部调用通过此模块导入。

使用方式：
    from prompt import generate, list_presets
    result = generate("一个粉色头发的女孩", preset_id="preset-xxx")

子模块：
    core.py      — 核心生成流程编排
    config.py    — 配置管理（provider 发现、API key 解析）
    preset.py    — 预设管理（CRUD、分组、导入导出）
    knowledge.py — 知识库管理（增删查、片段检索）
    builder.py   — System Prompt 模板引擎
"""

from .core import generate, call_llm, load_config, generate_script
from .preset import (
    list_presets, get_preset, create_preset, update_preset,
    delete_preset, duplicate_preset, export_presets, import_presets,
    reorder_presets, get_selected_preset_id, set_selected_preset_id,
    create_group, delete_group, update_group, reorder_groups,
)
from .knowledge import search as search_knowledge, add_entry as add_knowledge_entry, remove_entry as remove_knowledge_entry, list_entries as list_knowledge_entries

__all__ = [
    # 核心生成
    "generate", "call_llm", "load_config", "generate_script",
    # 预设管理
    "list_presets", "get_preset", "create_preset", "update_preset",
    "delete_preset", "duplicate_preset", "export_presets", "import_presets",
    "reorder_presets", "get_selected_preset_id", "set_selected_preset_id",
    "create_group", "delete_group", "update_group", "reorder_groups",
    # 知识库
    "search_knowledge", "add_knowledge_entry", "remove_knowledge_entry", "list_knowledge_entries",
]
