"""画师包：把 8.6MB 的画师数据拆成可分发扩展包，图片走官方 CDN。

对外只需要三个概念：
    index      所有已装包合并后的索引（4.2 万条约 3.3MB），前端一次拉取
    image      图片不入库，按 imageId 拼 CDN 地址，浏览器直接缓存
    pack       一个可独立分发的目录（pack.json + index.json）

没有详情层：每个画师只有 id/tag/posts/img 四个字段，拆层反而多一次请求。

数据抓取见 ../Art-prompt-library/tools/artist_pack_fetch.py，拆包见 ../Art-prompt-library/tools/artist_pack_split.py。
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
    DEFAULT_IMAGE_BASE,
    DEFAULT_IMAGE_EXT,
    INDEX_FILE,
    KIND,
    LEGACY_ARTISTS_FILE,
    REQUIRED_FILES,
    USER_PACKS_DIR,
    image_url_of,
    tier_of,
)
from .schema import dedupe_stats, normalize_artist, split_artists
from .store import (
    discover_packs,
    entry_image_url,
    find_artist,
    index_entry,
    merged_index,
    stats,
    version_token,
)

__all__ = [
    "BUILTIN_PACKS_DIR",
    "DEFAULT_IMAGE_BASE",
    "DEFAULT_IMAGE_EXT",
    "INDEX_FILE",
    "KIND",
    "LEGACY_ARTISTS_FILE",
    "REQUIRED_FILES",
    "USER_PACKS_DIR",
    "dedupe_stats",
    "discover_packs",
    "entry_image_url",
    "export_pack_zip",
    "find_artist",
    "image_url_of",
    "import_pack",
    "index_entry",
    "install_official",
    "installed_packs",
    "merged_index",
    "normalize_artist",
    "official_dir",
    "official_with_status",
    "read_catalog",
    "split_artists",
    "stats",
    "tier_of",
    "uninstall_pack",
    "version_token",
    "zip_path_of",
]
