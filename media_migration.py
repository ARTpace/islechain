"""把旧的三层 output 结构搬迁到 output/{owner}/{type}/{feature}/{date}/。

旧结构（2026-10 之前）：
    output/{owner}/{feature}/{date}/file      ← 图片、视频
    output/{owner}/tts/file                   ← 音频，没有日期层
    output/{feature}/{owner}/...              ← 少数无 owner 分支

新结构：
    output/{owner}/{type}/{feature}/{date}/file   type ∈ image|video|audio

原则：
- 幂等：已经处于 {type} 层的目录直接跳过，可反复执行
- 安全：先备份 history.json，再按「目录前缀」改写 URL，不改文件名
- 只搬不删：目标已存在同名文件时跳过并计数，绝不覆盖
"""

import json
import os
import re
import shutil
import time
from typing import Any, Dict, List, Optional, Tuple

MEDIA_TYPE_NAMES = ("image", "video", "audio")
SKIP_DIRS = {"smart-groups"}
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _is_date(name: str) -> bool:
    return bool(_DATE_RE.match(str(name or "")))


def _mtime_date(path: str) -> str:
    try:
        return time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(path)))
    except OSError:
        return time.strftime("%Y-%m-%d")


def _listdir(path: str) -> List[str]:
    try:
        return sorted(os.listdir(path))
    except OSError:
        return []


def plan_moves(media_paths, output_dir: str) -> Tuple[List[Tuple[str, str]], List[Tuple[str, str]]]:
    """返回 (整目录搬迁计划, 单文件搬迁计划)，元素均为 (源, 目标目录)。"""
    dir_plans: List[Tuple[str, str]] = []
    file_plans: List[Tuple[str, str]] = []
    if not os.path.isdir(output_dir):
        return dir_plans, file_plans

    for entry in _listdir(output_dir):
        path = os.path.join(output_dir, entry)
        if os.path.isfile(path):
            target, _ = media_paths.resolve_media_dir(
                owner="", feature="other", ext=entry, date=_mtime_date(path),
                root=output_dir, learn=False)
            file_plans.append((path, target))
            continue
        if entry in MEDIA_TYPE_NAMES:
            continue  # 已经是新结构
        for feature in _listdir(path):
            fpath = os.path.join(path, feature)
            if not os.path.isdir(fpath) or feature in MEDIA_TYPE_NAMES or feature in SKIP_DIRS:
                continue
            date_dirs = [d for d in _listdir(fpath) if _is_date(d) and os.path.isdir(os.path.join(fpath, d))]
            loose_files = [f for f in _listdir(fpath) if os.path.isfile(os.path.join(fpath, f))]
            for day in date_dirs:
                src = os.path.join(fpath, day)
                dst, _ = media_paths.resolve_media_dir(
                    owner=entry, feature=feature, date=day, root=output_dir, learn=False)
                dir_plans.append((src, dst))
            for name in loose_files:
                src = os.path.join(fpath, name)
                dst, _ = media_paths.resolve_media_dir(
                    owner=entry, feature=feature, ext=name, date=_mtime_date(src),
                    root=output_dir, learn=False)
                file_plans.append((src, dst))
    return dir_plans, file_plans


def _move_files(src_dir: str, dst_dir: str, stats: Dict[str, int]) -> None:
    os.makedirs(dst_dir, exist_ok=True)
    for name in _listdir(src_dir):
        src = os.path.join(src_dir, name)
        if not os.path.isfile(src):
            continue
        dst = os.path.join(dst_dir, name)
        if os.path.exists(dst):
            stats["skipped"] += 1
            continue
        shutil.move(src, dst)
        stats["moved"] += 1


def _prune_empty(path: str) -> None:
    """自底向上删空目录，失败静默（Windows 上可能被占用）。"""
    for root, dirs, files in os.walk(path, topdown=False):
        if dirs or files:
            continue
        try:
            os.rmdir(root)
        except OSError:
            pass


def _url_prefix_map(output_dir: str, dir_plans, file_plans) -> List[Tuple[str, str]]:
    """构造 URL 替换表：旧目录前缀 → 新目录前缀。"""
    mapping: List[Tuple[str, str]] = []
    for src, dst in dir_plans:
        old = "/output/" + os.path.relpath(src, output_dir).replace("\\", "/") + "/"
        new = "/output/" + os.path.relpath(dst, output_dir).replace("\\", "/") + "/"
        if old != new:
            mapping.append((old, new))
    for src, dst in file_plans:
        old = "/output/" + os.path.relpath(src, output_dir).replace("\\", "/")
        new = "/output/" + os.path.relpath(os.path.join(dst, os.path.basename(src)), output_dir).replace("\\", "/")
        if old != new:
            mapping.append((old, new))
    # 长前缀优先，避免短前缀先替换掉长前缀的一部分
    mapping.sort(key=lambda pair: len(pair[0]), reverse=True)
    return mapping


def _rewrite_value(value: Any, mapping: List[Tuple[str, str]], counter: List[int]) -> Any:
    if isinstance(value, dict):
        return {k: _rewrite_value(v, mapping, counter) for k, v in value.items()}
    if isinstance(value, list):
        return [_rewrite_value(v, mapping, counter) for v in value]
    if isinstance(value, str) and "/output/" in value:
        original = value
        for old, new in mapping:
            if old in value:
                value = value.replace(old, new)
        if value != original:
            counter[0] += 1
        return value
    return value


def _rewrite_json_file(path: str, mapping: List[Tuple[str, str]], stats: Dict[str, int], backup: bool) -> None:
    if not mapping or not os.path.isfile(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return
    counter = [0]
    updated = _rewrite_value(data, mapping, counter)
    if not counter[0]:
        return
    if backup:
        try:
            shutil.copy2(path, path + ".bak-" + time.strftime("%Y%m%d%H%M%S"))
        except OSError:
            pass
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(updated, handle, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    stats["urls_rewritten"] += counter[0]


def migrate(media_paths, output_dir: str, history_file: Optional[str] = None,
            canvas_dir: Optional[str] = None, dry_run: bool = False) -> Dict[str, int]:
    """执行搬迁 + URL 改写。返回统计，全部为 0 表示无需迁移。"""
    stats = {"dirs": 0, "files": 0, "moved": 0, "skipped": 0, "urls_rewritten": 0, "json_files": 0}
    dir_plans, file_plans = plan_moves(media_paths, output_dir)
    stats["dirs"] = len(dir_plans)
    stats["files"] = len(file_plans)
    if not dir_plans and not file_plans:
        return stats
    if dry_run:
        for src, dst in dir_plans + file_plans:
            print(f"[media-migrate] {src} -> {dst}")
        return stats

    for src, dst in dir_plans:
        _move_files(src, dst, stats)
        _prune_empty(src)
        # 日期层搬空后，旧的 feature 目录也要清掉，否则留下空壳
        _prune_empty(os.path.dirname(src))
    for src, dst in file_plans:
        os.makedirs(dst, exist_ok=True)
        target = os.path.join(dst, os.path.basename(src))
        if os.path.exists(target):
            stats["skipped"] += 1
        elif os.path.isfile(src):
            shutil.move(src, target)
            stats["moved"] += 1

    mapping = _url_prefix_map(output_dir, dir_plans, file_plans)
    if mapping:
        if history_file:
            _rewrite_json_file(history_file, mapping, stats, backup=True)
        if canvas_dir and os.path.isdir(canvas_dir):
            for name in _listdir(canvas_dir):
                if name.lower().endswith(".json"):
                    _rewrite_json_file(os.path.join(canvas_dir, name), mapping, stats, backup=False)
                    stats["json_files"] += 1
    print(f"[media-migrate] 目录 {stats['dirs']} 个、文件 {stats['moved']} 个已搬迁，"
          f"URL 改写 {stats['urls_rewritten']} 处，跳过 {stats['skipped']} 个同名文件")
    return stats
