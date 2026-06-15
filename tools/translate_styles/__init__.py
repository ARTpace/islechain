"""translate_styles 工具包

为风格预设生成中文映射（写入 style-i18n.json），基于：
1. 大型静态词典（Fooocus/Sai/MRE/Marc/TWRI 等风格包常见术语）
2. 启发式分词 + 多段拼接
3. 保留用户已写过的映射（respect_existing）
4. 备份 + dry-run
"""
from .config import TranslateConfig, load_config
from .dictionary import DICT, get_dict
from .i18n_utils import load_i18n, save_i18n, merge_mappings
from .translator import translate_one, translate_many, build_report

__all__ = [
    "TranslateConfig",
    "load_config",
    "DICT",
    "get_dict",
    "load_i18n",
    "save_i18n",
    "merge_mappings",
    "translate_one",
    "translate_many",
    "build_report",
]
