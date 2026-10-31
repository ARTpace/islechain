"""内容包通用层：一套机制管理多种可分发内容包。

设计分工：
    content_packs  与内容无关的机制 —— 清单校验、zip 导入导出、扫描、官方目录
    style_packs    提示词风格包的内容语义 —— 分类 / 子分类 / 预设 / 增量层
    character_packs 角色包的内容语义 —— 索引层 / 详情层

加一种新包类型只需：
    1. 在 paths.py 里加一个 KIND_*
    2. 写一个内容模块，声明自己的目录、必需文件、条目统计方式
    3. 复用本层的 packer / scanner / catalog
"""

from .catalog import official_dir, read_catalog, zip_path_of
from .manifest import (
    DEFAULT_PACK_ORDER,
    ContentManifest,
    PackCategory,
    load_manifest,
    parse_manifest,
)
from .packer import PackError, export_pack_dir, import_pack, uninstall_pack
from .paths import (
    KIND_ARTISTS,
    KIND_CHARACTERS,
    KIND_STYLES,
    MANIFEST_NAME,
    MAX_PACK_BYTES,
    SCHEMA_VERSION,
    as_int,
    is_safe_filename,
    is_valid_pack_id,
)
from .scanner import discover, find_pack

__all__ = [
    "DEFAULT_PACK_ORDER",
    "ContentManifest",
    "KIND_ARTISTS",
    "KIND_CHARACTERS",
    "KIND_STYLES",
    "MANIFEST_NAME",
    "MAX_PACK_BYTES",
    "PackCategory",
    "PackError",
    "SCHEMA_VERSION",
    "as_int",
    "discover",
    "export_pack_dir",
    "find_pack",
    "import_pack",
    "is_safe_filename",
    "is_valid_pack_id",
    "load_manifest",
    "official_dir",
    "parse_manifest",
    "read_catalog",
    "uninstall_pack",
    "zip_path_of",
]
