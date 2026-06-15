"""translate_styles CLI 入口

用法
----
    # 仅预览，不写文件
    python -m tools.translate_styles --dry-run

    # 实际写入（默认会备份）
    python -m tools.translate_styles

    # 仅处理 fooocus 系列
    python -m tools.translate_styles --filter fooocus_

    # 未知名写入为空字符串（前端会显示空）
    python -m tools.translate_styles --unknown drop
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Tuple

# 包路径
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT))

from tools.translate_styles.config import TranslateConfig, load_config
from tools.translate_styles.i18n_utils import (
    create_backup,
    load_i18n,
    merge_mappings,
    save_i18n,
)
from tools.translate_styles.translator import (
    build_report,
    translate_many,
    translate_one,
)


def collect_presets(presets_file: Path) -> List[Tuple[str, str]]:
    """收集所有 (preset_id, name)"""
    with open(presets_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    out: List[Tuple[str, str]] = []
    for c in data.get("categories", []):
        for s in c.get("subcategories", []):
            for p in s.get("presets", []):
                out.append((p.get("id", ""), p.get("name", "")))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="为风格预设生成中文映射")
    parser.add_argument("--dry-run", action="store_true", help="仅预览，不写文件")
    parser.add_argument(
        "--no-backup", action="store_true", help="不备份（仅在非 dry-run 时生效）"
    )
    parser.add_argument(
        "--filter",
        dest="id_prefix",
        action="append",
        default=[],
        help="仅处理匹配前缀的 preset.id（可多次指定）",
    )
    parser.add_argument(
        "--unknown",
        choices=["leave", "drop", "raw"],
        default="leave",
        help="未知名处理策略",
    )
    parser.add_argument(
        "--report", type=str, default="", help="报告输出路径（默认 tools/translate_styles/report.txt）"
    )
    parser.add_argument(
        "--force", action="store_true", help="覆盖已存在的映射（默认尊重现有）"
    )
    args = parser.parse_args()

    cfg = load_config()
    cfg.unknown_policy = args.unknown
    cfg.id_prefix_filter = tuple(args.id_prefix)
    if args.force:
        cfg.respect_existing = False
    if args.report:
        cfg.report_path = Path(args.report)

    # 1. 收集所有 preset
    items = collect_presets(cfg.presets_file)
    if cfg.id_prefix_filter:
        items = [
            (pid, name)
            for pid, name in items
            if any(pid.startswith(p) for p in cfg.id_prefix_filter)
        ]
    print(f"[collect] 总数: {len(items)}", file=sys.stderr)
    if cfg.id_prefix_filter:
        print(f"[collect] 过滤前缀: {cfg.id_prefix_filter}", file=sys.stderr)

    # 2. 加载 i18n，标记已存在
    i18n = load_i18n(cfg.i18n_file)
    existing = set(i18n.get("presets", {}).keys())
    print(f"[i18n] 已映射: {len(existing)}", file=sys.stderr)

    # 3. 只对未映射的（除非 --force）
    todo = items if not cfg.respect_existing else [
        (pid, name) for pid, name in items if pid not in existing
    ]
    print(f"[todo] 待翻译: {len(todo)}", file=sys.stderr)

    # 4. 批量翻译
    results = translate_many(todo)
    # 统计
    n_ok = sum(1 for r in results if r[3] == "ok")
    n_partial = sum(1 for r in results if r[3] == "ok_partial")
    n_unknown = sum(1 for r in results if r[3] == "unknown")
    n_raw = sum(1 for r in results if r[3] == "raw")
    print(
        f"[translate] ok={n_ok} partial={n_partial} unknown={n_unknown} raw={n_raw}",
        file=sys.stderr,
    )

    # 5. 组装新映射
    new_mappings: Dict[str, str] = {}
    for pid, name, zh, status in results:
        if status == "unknown":
            if cfg.unknown_policy == "leave":
                continue
            elif cfg.unknown_policy == "drop":
                new_mappings[pid] = ""
            elif cfg.unknown_policy == "raw":
                new_mappings[pid] = name
        else:
            new_mappings[pid] = zh
    print(f"[merge] 待写入: {len(new_mappings)}", file=sys.stderr)

    # 6. 报告
    report = build_report(results, cfg)
    cfg.report_path.parent.mkdir(parents=True, exist_ok=True)
    cfg.report_path.write_text(report, encoding="utf-8")
    print(f"[report] 写入: {cfg.report_path}", file=sys.stderr)

    if args.dry_run:
        print("[dry-run] 不写 i18n 文件", file=sys.stderr)
        return 0

    # 7. 备份 + 写
    if cfg.auto_backup and not args.no_backup:
        bp = create_backup(cfg)
        print(f"[backup] 备份: {bp}", file=sys.stderr)

    added, skipped, total = merge_mappings(i18n, new_mappings, cfg)
    save_i18n(cfg.i18n_file, i18n)
    print(
        f"[write] 新增: {added}, 跳过(已存在): {skipped}, 总计: {total}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
