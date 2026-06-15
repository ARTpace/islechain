"""
dedupe_styles.io_utils
======================

读写、备份轮转、恢复、缩略图扫描等 I/O 工具。
"""
from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Set

from .config import DedupeConfig


# ============================================================
# 数据读写
# ============================================================
def load_data(cfg: DedupeConfig) -> Dict[str, Any]:
    if not cfg.target_file.exists():
        return {"categories": []}
    with open(cfg.target_file, "r", encoding="utf-8") as f:
        return json.load(f)


def save_data(
    cfg: DedupeConfig,
    data: Dict[str, Any],
    backup: bool = True,
    label: str = "manual",
) -> Optional[Path]:
    """保存并按需备份"""
    backup_path: Optional[Path] = None
    if backup and cfg.auto_backup:
        backup_path = create_backup(cfg, label=label)
    cfg.target_file.parent.mkdir(parents=True, exist_ok=True)
    with open(cfg.target_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return backup_path


# ============================================================
# 备份管理
# ============================================================
@dataclass
class BackupEntry:
    name: str
    path: Path
    size: int
    mtime: float
    label: str


def _ensure_backup_dir(cfg: DedupeConfig) -> Path:
    cfg.backup_dir.mkdir(parents=True, exist_ok=True)
    return cfg.backup_dir


def create_backup(cfg: DedupeConfig, label: str = "manual") -> Optional[Path]:
    """创建带时间戳的备份，自动轮转旧版本"""
    if not cfg.target_file.exists():
        return None
    backup_dir = _ensure_backup_dir(cfg)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    # 文件名: style-presets__<label>__<timestamp>.json
    safe_label = "".join(c if c.isalnum() or c in "-_" else "_" for c in label)
    backup_path = backup_dir / f"style-presets__{safe_label}__{ts}.json"
    shutil.copy2(cfg.target_file, backup_path)
    rotate_backups(cfg)
    return backup_path


def list_backups(cfg: DedupeConfig) -> List[BackupEntry]:
    if not cfg.backup_dir.exists():
        return []
    entries = []
    for p in cfg.backup_dir.glob("style-presets__*.json"):
        # 解析: style-presets__<label>__<timestamp>.json
        stem = p.stem
        parts = stem.split("__")
        label = parts[1] if len(parts) >= 3 else "unknown"
        try:
            ts = datetime.strptime(parts[-1], "%Y%m%d_%H%M%S").timestamp()
        except ValueError:
            ts = p.stat().st_mtime
        entries.append(BackupEntry(
            name=p.name,
            path=p,
            size=p.stat().st_size,
            mtime=ts,
            label=label,
        ))
    entries.sort(key=lambda e: e.mtime, reverse=True)
    return entries


def rotate_backups(cfg: DedupeConfig) -> int:
    """保留最近 N 个备份，删除更早的，返回删除数"""
    if cfg.backup_keep <= 0:
        return 0
    entries = list_backups(cfg)
    removed = 0
    for e in entries[cfg.backup_keep:]:
        try:
            e.path.unlink()
            removed += 1
        except Exception:
            pass
    return removed


def restore_backup(cfg: DedupeConfig, name: str) -> Path:
    """从备份恢复"""
    backup_path = cfg.backup_dir / name
    if not backup_path.exists():
        raise FileNotFoundError(f"备份不存在: {backup_path}")
    # 恢复前先备份当前
    create_backup(cfg, label="pre_restore")
    shutil.copy2(backup_path, cfg.target_file)
    return backup_path


# ============================================================
# 缩略图扫描
# ============================================================
def collect_referenced_thumbnails(cfg: DedupeConfig, data: Dict[str, Any]) -> Set[str]:
    """收集所有 preset 引用到的缩略图文件名"""
    referenced: Set[str] = set()
    for cat in data.get("categories", []):
        for sub in cat.get("subcategories", []):
            for p in sub.get("presets", []):
                t = (p.get("thumbnail") or "").strip()
                if not t:
                    continue
                for prefix in cfg.thumbnail_prefixes:
                    if t.startswith(prefix):
                        referenced.add(t[len(prefix):])
                        break
                else:
                    # 绝对 URL: 取最后的 path 部分
                    if "/" in t:
                        referenced.add(t.rsplit("/", 1)[-1].split("?")[0])
    return referenced


def scan_thumbnail_files(cfg: DedupeConfig) -> List[Path]:
    """扫描缩略图目录所有文件"""
    if not cfg.thumbs_dir.exists():
        return []
    return [f for f in cfg.thumbs_dir.iterdir() if f.is_file()]


def find_orphan_thumbnails(cfg: DedupeConfig, data: Dict[str, Any]) -> List[Path]:
    """找出未被引用的缩略图文件"""
    referenced = collect_referenced_thumbnails(cfg, data)
    orphans = []
    for f in scan_thumbnail_files(cfg):
        if f.name not in referenced:
            orphans.append(f)
    return orphans


def delete_files(files: List[Path]) -> int:
    """删除文件列表，返回成功数"""
    removed = 0
    for f in files:
        try:
            f.unlink()
            removed += 1
        except Exception as e:
            import sys
            print(f"  [warn] 删除 {f.name} 失败: {e}", file=sys.stderr)
    return removed
