"""
dedupe_styles.config
====================

整理工具配置：默认值、用户规则、字段权重。
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional


# ============================================================
# 默认值
# ============================================================
TOOLS_DIR = Path(__file__).resolve().parent
ART_CANVAS_DIR = TOOLS_DIR.parent
DATA_DIR = ART_CANVAS_DIR / "data"
TARGET_FILE = DATA_DIR / "style-presets.json"
import sys
_project = str(ART_CANVAS_DIR.parent)
if _project not in sys.path:
    sys.path.insert(0, _project)
from core.user_paths import user_data_dir
THUMBS_DIR = Path(user_data_dir()) / "thumbnails"
CONFIG_FILE = DATA_DIR / "dedupe-config.json"

DEFAULT_BACKUP_KEEP = 5
DEFAULT_REPORT_MAX_ITEMS = 20

# 字段评分权重（高分 = 信息更全）
DEFAULT_FIELD_WEIGHTS: Dict[str, float] = {
    "thumbnail": 5.0,
    "description": 2.0,
    "negative_prompt": 1.5,
    "name": 1.0,
    "prompt": 1.0,
}

# 按 prompt 去重时移除的占位符
DEFAULT_PROMPT_PLACEHOLDERS = (
    "{prompt}",
    "[prompt]",
    "<prompt>",
    "{0}",
    "{1}",
    "{subject}",
)


# ============================================================
# Config
# ============================================================
@dataclass
class DedupeConfig:
    """整理工具配置"""

    # 文件路径
    target_file: Path = TARGET_FILE
    thumbs_dir: Path = THUMBS_DIR
    backup_dir: Path = field(default_factory=lambda: DATA_DIR / "backups")

    # 字段评分权重
    field_weights: Dict[str, float] = field(
        default_factory=lambda: dict(DEFAULT_FIELD_WEIGHTS)
    )

    # 保留策略：first | best
    default_strategy: str = "best"

    # 备份
    backup_keep: int = DEFAULT_BACKUP_KEEP
    auto_backup: bool = True

    # 报告
    report_max_items_per_section: int = DEFAULT_REPORT_MAX_ITEMS

    # 启发式
    prompt_placeholders: tuple = field(default_factory=lambda: DEFAULT_PROMPT_PLACEHOLDERS)

    # 缩略图引用前缀（用于 orphan 扫描）
    thumbnail_prefixes: tuple = ("/api/thumbnails/", "/thumbnails/", "thumbnails/")

    # 用户忽略列表
    ignore_cat_ids: tuple = ()
    ignore_preset_ids: tuple = ()


def load_config(path: Optional[Path] = None) -> DedupeConfig:
    """加载配置：默认 + 用户覆盖"""
    cfg = DedupeConfig()
    cfg_path = path or CONFIG_FILE
    if not cfg_path.exists():
        return cfg
    try:
        user = json.loads(cfg_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[config] 读取 {cfg_path} 失败: {e}, 使用默认")
        return cfg

    if "field_weights" in user and isinstance(user["field_weights"], dict):
        cfg.field_weights.update(user["field_weights"])
    if "default_strategy" in user:
        cfg.default_strategy = user["default_strategy"]
    if "backup_keep" in user:
        cfg.backup_keep = int(user["backup_keep"])
    if "auto_backup" in user:
        cfg.auto_backup = bool(user["auto_backup"])
    if "report_max_items_per_section" in user:
        cfg.report_max_items_per_section = int(user["report_max_items_per_section"])
    if "prompt_placeholders" in user and isinstance(user["prompt_placeholders"], list):
        cfg.prompt_placeholders = tuple(user["prompt_placeholders"])
    if "ignore_cat_ids" in user and isinstance(user["ignore_cat_ids"], list):
        cfg.ignore_cat_ids = tuple(user["ignore_cat_ids"])
    if "ignore_preset_ids" in user and isinstance(user["ignore_preset_ids"], list):
        cfg.ignore_preset_ids = tuple(user["ignore_preset_ids"])
    return cfg


def save_default_config(path: Path) -> Path:
    """导出默认配置到 JSON"""
    path.parent.mkdir(parents=True, exist_ok=True)
    cfg = DedupeConfig()
    payload = asdict(cfg)
    # tuple -> list (JSON 不可序列化)
    payload["prompt_placeholders"] = list(payload["prompt_placeholders"])
    payload["ignore_cat_ids"] = list(payload["ignore_cat_ids"])
    payload["ignore_preset_ids"] = list(payload["ignore_preset_ids"])
    payload["target_file"] = str(payload["target_file"])
    payload["thumbs_dir"] = str(payload["thumbs_dir"])
    payload["backup_dir"] = str(payload["backup_dir"])
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return path
