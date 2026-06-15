"""i18n 文件读写 + 合并工具

提供对 style-i18n.json 的安全读写、备份、合并支持。
"""
from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from .config import TranslateConfig


def load_i18n(path: Path) -> Dict[str, Any]:
    """加载 i18n 文件，若不存在则返回初始结构"""
    if not path.exists():
        return {
            "categories": {},
            "subcategories": {},
            "presets": {},
        }
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_i18n(path: Path, data: Dict[str, Any]) -> None:
    """写回 i18n 文件（原子：先写 .tmp 再 rename）"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


def create_backup(cfg: TranslateConfig) -> Path:
    """备份 i18n 文件到 backup_dir"""
    if not cfg.i18n_file.exists():
        raise FileNotFoundError(f"i18n 文件不存在: {cfg.i18n_file}")
    cfg.backup_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dst = cfg.backup_dir / f"{cfg.i18n_file.stem}.bak.{cfg.backup_label}.{ts}"
    shutil.copy2(cfg.i18n_file, dst)
    return dst


def merge_mappings(
    i18n: Dict[str, Any],
    new_presets: Dict[str, str],
    cfg: TranslateConfig,
) -> Tuple[int, int, int]:
    """合并新的 preset 映射到 i18n

    尊重 cfg.respect_existing：已存在的不会覆盖。

    返回: (新增, 跳过_已存在, 共输入)
    """
    presets = i18n.setdefault("presets", {})
    added = 0
    skipped = 0
    for pid, zh in new_presets.items():
        if cfg.respect_existing and pid in presets:
            skipped += 1
            continue
        presets[pid] = zh
        added += 1
    return added, skipped, len(new_presets)


def get_existing_preset_map(i18n: Dict[str, Any]) -> Dict[str, str]:
    return dict(i18n.get("presets", {}))
