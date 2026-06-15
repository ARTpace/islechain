"""
dedupe_styles
=============

风格预设去重 / 整理工具包。

子模块:
  - config      配置与默认值
  - io_utils    读写 / 备份 / 缩略图
  - scoring     字段加权评分
  - analyze     7 类分析
  - operations  实际清理操作
  - report      报告输出
  - cli         命令行入口

公共 API（可直接在 Python 中调用）:
  from dedupe_styles import analyze_and_report, apply_cleanup
  analyze_and_report(config)  -> Report
  apply_cleanup(config, strategy='best', dedupe_prompts=True, remove_orphans=True) -> ChangeTracker
"""
from .config import DedupeConfig, load_config
from .analyze import (
    Report,
    StyleStats,
    analyze_all,
    compute_stats,
    find_duplicate_categories,
    find_duplicate_presets,
    find_duplicate_prompts,
    find_empty_categories,
    find_orphan_thumbnails_in,
    find_duplicate_preset_names_within_subcat,
    find_same_name_categories,
)
from .operations import (
    ChangeTracker,
    apply_all,
    dedupe_presets_by_id,
    dedupe_presets_by_prompt,
    merge_duplicate_categories,
    remove_empty_categories,
    remove_empty_subcats,
)
from .io_utils import (
    load_data,
    save_data,
    create_backup,
    list_backups,
    restore_backup,
    find_orphan_thumbnails,
    delete_files,
)
from .scoring import score_preset, choose_winner
from .report import (
    print_console_report,
    export_json_report,
    export_markdown_report,
    print_change_summary,
)

__all__ = [
    # 配置
    "DedupeConfig",
    "load_config",
    # 数据
    "load_data",
    "save_data",
    # 备份
    "create_backup",
    "list_backups",
    "restore_backup",
    "delete_files",
    "find_orphan_thumbnails",
    # 分析
    "analyze_all",
    "compute_stats",
    "find_duplicate_categories",
    "find_duplicate_presets",
    "find_duplicate_prompts",
    "find_empty_categories",
    "find_orphan_thumbnails_in",
    "find_duplicate_preset_names_within_subcat",
    "find_same_name_categories",
    "Report",
    "StyleStats",
    # 清理
    "ChangeTracker",
    "apply_all",
    "dedupe_presets_by_id",
    "dedupe_presets_by_prompt",
    "merge_duplicate_categories",
    "remove_empty_categories",
    "remove_empty_subcats",
    # 评分
    "score_preset",
    "choose_winner",
    # 报告
    "print_console_report",
    "print_change_summary",
    "export_json_report",
    "export_markdown_report",
]

__version__ = "2.0.0"
