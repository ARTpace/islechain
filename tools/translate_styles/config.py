"""翻译工具配置

集中管理 i18n 文件、风格预设文件、备份目录，以及翻译行为开关。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Tuple


# 包所在目录：tools/translate_styles/
TOOLS_DIR = Path(__file__).resolve().parent
# 项目根目录：art-canvas/
ART_CANVAS_DIR = TOOLS_DIR.parent.parent
# 数据目录：art-canvas/data/
DATA_DIR = ART_CANVAS_DIR / "data"

I18N_FILE = DATA_DIR / "style-i18n.json"
PRESETS_FILE = DATA_DIR / "style-presets.json"
BACKUP_DIR = DATA_DIR / "backups"

# 默认行为开关
RESPECT_EXISTING = True  # 不动用户已写过的映射（即使启发式给出不同结果）
AUTO_BACKUP = True
BACKUP_LABEL = "translate"


@dataclass
class TranslateConfig:
    """翻译工具配置

    属性
    ----
    i18n_file: style-i18n.json 路径
    presets_file: style-presets.json 路径
    backup_dir: 备份目录
    respect_existing: 保留用户已写入的翻译（不会覆盖）
    auto_backup: 修改 i18n 文件前自动备份
    backup_label: 备份文件后缀

    unknown_policy: 未命中词典/启发式时的处理策略
        - "leave": 不写入 i18n，前端回退到原 name
        - "drop": 写入 i18n 但值为空字符串（前端会显示空）
        - "raw": 写入 i18n 为原 name（仅作占位）
    """

    i18n_file: Path = I18N_FILE
    presets_file: Path = PRESETS_FILE
    backup_dir: Path = BACKUP_DIR

    respect_existing: bool = RESPECT_EXISTING
    auto_backup: bool = AUTO_BACKUP
    backup_label: str = BACKUP_LABEL

    # 仅做覆盖范围过滤
    # 哪些 preset.id 前缀要处理；空 = 处理所有未映射
    id_prefix_filter: Tuple[str, ...] = field(default_factory=tuple)

    # 未知名处理
    unknown_policy: str = "leave"  # leave | drop | raw

    # 报告输出路径
    report_path: Path = TOOLS_DIR / "report.txt"


def load_config() -> TranslateConfig:
    return TranslateConfig()
