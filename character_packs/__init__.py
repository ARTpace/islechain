"""角色包：把 21MB 的角色数据拆成「索引 + 详情」两层，按包分发。

对外只需要三个概念：
    index      所有已装包合并后的轻索引（3.6 万条约 5.6MB），前端一次拉取
    detail     点开某个角色时按 id 读一个分片，不加载全量
    pack       一个可独立分发的目录（pack.json + index.json + detail-*.json）

拆包与官方包生成见 ../Art-prompt-library/tools/character_pack_split.py。
"""

from .catalog import (
    export_pack_zip,
    import_pack,
    install_official,
    installed_packs,
    official_dir,
    official_with_status,
    read_catalog,
    uninstall_pack,
    zip_path_of,
)
from .paths import (
    BUILTIN_PACKS_DIR,
    INDEX_FILE,
    KIND,
    REQUIRED_FILES,
    USER_PACKS_DIR,
    detail_filename,
    detail_shard_of,
    thumb_url_of,
)
from .schema import merge_back, normalize_id, split_characters, to_detail_entry, to_index_entry
from .store import discover_packs, get_detail, index_entry, merged_index, stats, version_token

__all__ = [
    "BUILTIN_PACKS_DIR",
    "INDEX_FILE",
    "KIND",
    "REQUIRED_FILES",
    "USER_PACKS_DIR",
    "detail_filename",
    "detail_shard_of",
    "discover_packs",
    "export_pack_zip",
    "get_detail",
    "import_pack",
    "index_entry",
    "install_official",
    "installed_packs",
    "merge_back",
    "merged_index",
    "normalize_id",
    "official_dir",
    "official_with_status",
    "read_catalog",
    "split_characters",
    "stats",
    "thumb_url_of",
    "to_detail_entry",
    "to_index_entry",
    "uninstall_pack",
    "version_token",
    "zip_path_of",
]
