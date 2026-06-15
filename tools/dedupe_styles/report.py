"""
dedupe_styles.report
====================

报告输出：控制台 / JSON / Markdown 三种格式。
"""
from __future__ import annotations

import io
import json
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, List, Any, Optional, TextIO

from .config import DedupeConfig
from .analyze import Report, analyze_all
from .operations import ChangeTracker


@contextmanager
def _safe_stdout(stream: TextIO):
    """Windows 控制台 GBK 编码兼容包装"""
    try:
        yield stream
    except UnicodeEncodeError:
        # 退回到纯 ASCII 输出
        out = io.StringIO()
        yield out


def _check_str(s: str) -> str:
    """Windows console 安全的字符串转换"""
    try:
        s.encode("ascii")
        return s
    except UnicodeEncodeError:
        return s.encode("ascii", "replace").decode("ascii")


def print_console_report(
    report: Report,
    cfg: DedupeConfig,
    title: str = "风格预设重复 / 异常分析报告",
    stream: Optional[TextIO] = None,
) -> None:
    """打印控制台报告"""
    out = stream or _ConsoleWriter()

    def w(s: str = ""):
        out.write(s + "\n")

    w("=" * 70)
    w(f"  {title}")
    w("=" * 70)

    s = report.stats
    w("\n[总览]")
    w(f"  分类数:      {s.cat_count:4d}")
    w(f"  子分类数:    {s.subcat_count:4d}")
    w(f"  预设条目数:  {s.preset_count:4d}")
    w(f"  带缩略图:    {s.with_thumb:4d}  ({s.thumb_coverage:.1f}%)")

    n = cfg.report_max_items_per_section

    def section(title: str, items, formatter, empty_msg="[OK] 无"):
        if not items:
            w(f"\n[{title}]  {empty_msg}")
            return
        w(f"\n[{title}]  {len(items)} 项")
        for d in items[:n]:
            w("    " + formatter(d))
        if len(items) > n:
            w(f"    ... 还有 {len(items)-n} 项")

    section(
        "1] 重复的分类 ID",
        report.dup_cat_ids,
        lambda d: f"id={d['id']:30s}  [{d['first_name']}]({d['first_count']}) vs [{d['dup_name']}]({d['dup_count']})",
    )
    section(
        "2] 同名分类（id 不同）",
        report.dup_cat_names,
        lambda t: f"name='{t[2]}'  index #{t[0]} vs #{t[1]}",
    )
    section(
        "3] 重复的预设 ID",
        report.dup_preset_ids,
        lambda d: f"id={d['id']:35s}  '{d['first_name']}' vs '{d['dup_name']}'",
    )
    section(
        "4] 同子分类内同名预设",
        report.dup_preset_names,
        lambda d: f"'{d['name']}'  in {d['sub_loc']}  ({d['first_id']} vs {d['dup_id']})",
    )

    if report.dup_prompts:
        w(f"\n[5] 完全相同的 prompt:  {len(report.dup_prompts)} 组")
        for d in report.dup_prompts[:5]:
            w(f"    hash={d['hash']}  出现 {len(d['refs'])} 次:")
            for r in d["refs"][:3]:
                w(f"      - {r['id']:30s}  {r['name']}")
        if len(report.dup_prompts) > 5:
            w(f"    ... 还有 {len(report.dup_prompts)-5} 组")
    else:
        w("\n[5] 重复的 prompt:  [OK] 无")

    section(
        "6] 空分类/空子分类/缺 ID",
        report.empty_issues,
        lambda d: f"[{d['type']}] {d.get('id','?')}  {d.get('name','')}",
    )
    if report.orphan_thumbs:
        total_size = sum(f.stat().st_size for f in report.orphan_thumbs)
        w(f"\n[7] 孤立缩略图（未被引用）:  {len(report.orphan_thumbs)} 个, {total_size/1024:.1f} KB")
        for f in report.orphan_thumbs[:5]:
            w(f"    - {f.name}  ({f.stat().st_size/1024:.1f} KB)")
        if len(report.orphan_thumbs) > 5:
            w(f"    ... 还有 {len(report.orphan_thumbs)-5} 个")
    else:
        w("\n[7] 孤立缩略图:  [OK] 无")

    w("\n" + "=" * 70)
    w(f"  总问题数: {report.total_issues}")
    w("=" * 70)


class _ConsoleWriter:
    """支持 Windows GBK 编码的输出包装"""
    def __init__(self):
        import sys
        self._stream = sys.stdout
        # 强制 UTF-8
        if hasattr(self._stream, "reconfigure"):
            try:
                self._stream.reconfigure(encoding="utf-8")
            except Exception:
                pass

    def write(self, s: str):
        try:
            self._stream.write(s)
        except UnicodeEncodeError:
            # 退到 ASCII 安全版本
            self._stream.write(s.encode("ascii", "replace").decode("ascii"))
        self._stream.flush()


# ============================================================
# JSON / Markdown 报告
# ============================================================
def export_json_report(report: Report, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report.to_dict(), f, ensure_ascii=False, indent=2, default=str)
    return path


def export_markdown_report(
    report: Report,
    path: Path,
    cfg: DedupeConfig,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    s = report.stats
    lines = [
        f"# 风格预设整理报告",
        f"",
        f"## 总览",
        f"",
        f"| 指标 | 数值 |",
        f"|---|---|",
        f"| 分类数 | {s.cat_count} |",
        f"| 子分类数 | {s.subcat_count} |",
        f"| 预设条目数 | {s.preset_count} |",
        f"| 带缩略图 | {s.with_thumb} ({s.thumb_coverage:.1f}%) |",
        f"| 总问题数 | {report.total_issues} |",
        f"",
        f"## 检查项",
        f"",
    ]
    items = [
        ("重复分类 ID", report.dup_cat_ids),
        ("同名分类", report.dup_cat_names),
        ("重复预设 ID", report.dup_preset_ids),
        ("同名预设（子分类内）", report.dup_preset_names),
        ("完全相同的 prompt", report.dup_prompts),
        ("空分类 / 空子分类", report.empty_issues),
        ("孤立缩略图", report.orphan_thumbs),
    ]
    for name, lst in items:
        if lst:
            lines.append(f"- ❌ **{name}**: {len(lst)}")
        else:
            lines.append(f"- ✅ {name}: 无")
    lines.append("")
    lines.append("---")
    lines.append(f"*生成时间: {report.stats.cat_count} 分类 / {s.preset_count} 预设*")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return path


# ============================================================
# 变更摘要
# ============================================================
def print_change_summary(tracker: ChangeTracker, stream: Optional[TextIO] = None) -> None:
    out = stream or _ConsoleWriter()
    out.write("\n[apply] 清理结果:\n")
    out.write(f"  合并重复分类:        {tracker.dup_cats_merged}\n")
    out.write(f"  去除重复预设(id):    {tracker.dup_presets_removed}\n")
    out.write(f"  去除重复 prompt:     {tracker.dup_prompts_removed}\n")
    out.write(f"  合并 negative_prompt: {tracker.preset_merged_neg_prompts}\n")
    out.write(f"  去除空子分类:        {tracker.empty_subs_removed}\n")
    out.write(f"  去除空分类:          {tracker.empty_cats_removed}\n")
    out.write(f"  删除孤立缩略图:      {tracker.orphans_removed}\n")
    out.write(f"  详细变更记录:        {len(tracker.details)}\n")
