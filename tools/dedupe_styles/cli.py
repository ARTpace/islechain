"""
dedupe_styles.cli
=================

命令行入口。提供:
  analyze   仅分析
  apply     分析 + 清理
  restore   从备份恢复
  backups   列出备份
  stats     仅打印统计
  config    导出默认配置
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List, Optional

from .config import load_config, save_default_config, CONFIG_FILE, DEFAULT_FIELD_WEIGHTS
from .io_utils import load_data, save_data, create_backup, list_backups, restore_backup, delete_files
from .analyze import analyze_all
from .operations import apply_all, ChangeTracker
from .report import (
    print_console_report,
    print_change_summary,
    export_json_report,
    export_markdown_report,
)


def cmd_analyze(cfg, args) -> int:
    data = load_data(cfg)
    report = analyze_all(data, cfg)
    print_console_report(report, cfg, title=args.title)

    if args.report:
        path = Path(args.report)
        if args.format == "json":
            export_json_report(report, path)
            print(f"\n[export] JSON 报告: {path}")
        else:
            export_markdown_report(report, path, cfg)
            print(f"\n[export] Markdown 报告: {path}")

    return 0 if report.is_clean else 1


def cmd_apply(cfg, args) -> int:
    data = load_data(cfg)

    print(f"[analyze] {cfg.target_file}")
    report_before = analyze_all(data, cfg)
    print_console_report(report_before, cfg, title="清理前分析")

    if report_before.is_clean and not args.force:
        print("\n[skip] 已经是干净状态，无需清理")
        return 0

    if args.interactive and not _confirm("确认执行清理?"):
        print("已取消")
        return 0

    print("\n[apply] 开始清理...")
    tracker = apply_all(
        data, cfg,
        strategy=args.keep,
        dedupe_prompts=args.dedupe_prompts,
    )
    save_data(cfg, data, backup=True, label="apply")

    # 处理孤立缩略图
    if args.remove_orphans:
        from .io_utils import find_orphan_thumbnails
        orphans = find_orphan_thumbnails(cfg, data)
        if args.dry_run:
            print(f"\n[dry-run] 将删除 {len(orphans)} 个孤立缩略图（未实际删除）")
        else:
            tracker.orphans_removed = delete_files(orphans)
            print(f"  删除孤立缩略图: {len(orphans)}")

    print_change_summary(tracker)

    if args.dry_run:
        # dry-run 模式下不写文件，需要 reload
        print("\n[dry-run] 未写入文件")
    else:
        print("\n[verify] 重新分析...")
        report_after = analyze_all(load_data(cfg), cfg)
        print_console_report(report_after, cfg, title="清理后验证")

    if args.report:
        path = Path(args.report)
        if args.format == "json":
            export_json_report(report_after, path)
        else:
            export_markdown_report(report_after, path, cfg)
        print(f"\n[export] 报告: {path}")

    return 0


def cmd_restore(cfg, args) -> int:
    if not args.name:
        # 显示列表并要求选择
        backups = list_backups(cfg)
        if not backups:
            print("无备份")
            return 1
        print("可用备份:")
        for i, b in enumerate(backups[:20]):
            print(f"  [{i}] {b.name}  ({b.size//1024} KB, {b.label})")
        try:
            idx = int(input("选择备份编号: "))
            backup = backups[idx]
        except (ValueError, IndexError):
            print("无效选择")
            return 1
        name = backup.name
    else:
        name = args.name

    if not _confirm(f"确认从 {name} 恢复?  当前文件将自动备份。"):
        print("已取消")
        return 0

    try:
        restore_backup(cfg, name)
        print(f"[OK] 已恢复到 {cfg.target_file}")
        return 0
    except FileNotFoundError as e:
        print(f"[ERR] {e}")
        return 1


def cmd_backups(cfg, args) -> int:
    backups = list_backups(cfg)
    if not backups:
        print("无备份")
        return 0
    print(f"共 {len(backups)} 个备份（保留最近 {cfg.backup_keep} 个）:")
    print(f"  位置: {cfg.backup_dir}")
    for i, b in enumerate(backups):
        import datetime
        ts = datetime.datetime.fromtimestamp(b.mtime).strftime("%Y-%m-%d %H:%M:%S")
        print(f"  [{i}] {b.name}")
        print(f"       时间={ts}  大小={b.size//1024}KB  标签={b.label}")
    return 0


def cmd_stats(cfg, args) -> int:
    data = load_data(cfg)
    report = analyze_all(data, cfg)
    s = report.stats
    print(f"分类数:    {s.cat_count}")
    print(f"子分类数:  {s.subcat_count}")
    print(f"预设条目:  {s.preset_count}")
    print(f"带缩略图:  {s.with_thumb} ({s.thumb_coverage:.1f}%)")
    print(f"总问题数:  {report.total_issues}")
    return 0


def cmd_config(cfg, args) -> int:
    if args.export:
        target = Path(args.export)
        save_default_config(target)
        print(f"[export] 默认配置已写入: {target}")
    else:
        print(f"当前配置:")
        print(f"  配置文件: {CONFIG_FILE} (存在: {CONFIG_FILE.exists()})")
        print(f"  目标文件: {cfg.target_file}")
        print(f"  缩略图目录: {cfg.thumbs_dir}")
        print(f"  备份目录:   {cfg.backup_dir}")
        print(f"  备份保留:   {cfg.backup_keep} 个")
        print(f"  字段权重:   {cfg.field_weights}")
        print(f"  默认策略:   {cfg.default_strategy}")
    return 0


def _confirm(prompt: str) -> bool:
    try:
        r = input(f"{prompt} [y/N] ").strip().lower()
        return r in ("y", "yes")
    except EOFError:
        return False


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="dedupe_styles",
        description="风格预设去重 / 整理工具",
    )
    sub = p.add_subparsers(dest="cmd", required=False)

    # analyze
    pa = sub.add_parser("analyze", help="仅分析")
    pa.add_argument("--report", help="导出报告到文件")
    pa.add_argument("--format", choices=["json", "markdown"], default="markdown")
    pa.add_argument("--title", default="风格预设重复 / 异常分析报告")
    pa.set_defaults(func=cmd_analyze)

    # apply
    pb = sub.add_parser("apply", help="分析 + 清理")
    pb.add_argument("--keep", choices=["first", "best"], default="best")
    pb.add_argument("--dedupe-prompts", action="store_true", help="按 prompt 去重")
    pb.add_argument("--remove-orphans", action="store_true", help="删除孤立缩略图")
    pb.add_argument("--dry-run", action="store_true", help="不写文件")
    pb.add_argument("--force", action="store_true", help="无问题时也执行")
    pb.add_argument("--interactive", action="store_true", help="操作前确认")
    pb.add_argument("--report", help="导出报告")
    pb.add_argument("--format", choices=["json", "markdown"], default="markdown")
    pb.set_defaults(func=cmd_apply)

    # restore
    pc = sub.add_parser("restore", help="从备份恢复")
    pc.add_argument("name", nargs="?", help="备份文件名（不指定则交互选择）")
    pc.set_defaults(func=cmd_restore)

    # backups
    pd = sub.add_parser("backups", help="列出备份")
    pd.set_defaults(func=cmd_backups)

    # stats
    pe = sub.add_parser("stats", help="仅打印统计")
    pe.set_defaults(func=cmd_stats)

    # config
    pf = sub.add_parser("config", help="显示/导出配置")
    pf.add_argument("--export", help="导出默认配置到文件")
    pf.set_defaults(func=cmd_config)

    return p


def main(argv: Optional[List[str]] = None) -> int:
    # Windows 编码
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass

    parser = build_parser()
    args = parser.parse_args(argv)
    cfg = load_config()

    if not args.cmd:
        # 默认行为（向后兼容旧 CLI）
        args = parser.parse_args(["analyze"])
    return args.func(cfg, args)


if __name__ == "__main__":
    sys.exit(main())
