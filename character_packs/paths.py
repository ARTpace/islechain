"""角色包的路径常量与字段推导规则。

一个角色包的结构：
    <packId>/pack.json        清单（files 里登记 index.json）
    <packId>/index.json       索引层：搜索与列表所需，前端全量拉取
    <packId>/detail-a.json    详情层：按 id 首字符分片，点开某个角色才加载

为什么分两层：索引 5.6MB 就能支撑 3.6 万条角色的搜索与列表，
而完整数据 21MB。详情（tags / 大图 / 出处）只在点开时读一个分片。

thumb_url 不存储 —— 实测 36492/36492 条都能由 trigger 精确推导，
公式：trigger 里的 `:` `/` 替换成 `_`，再按 URL 规则编码（保留括号）。
"""

from pathlib import Path

from content_packs.paths import KIND_CHARACTERS
from content_packs.paths import is_safe_filename as _is_safe_filename
from user_paths import user_data_dir

KIND = KIND_CHARACTERS

BASE_DIR = Path(__file__).resolve().parent.parent

# 随包分发：只读种子
BUILTIN_PACKS_DIR = BASE_DIR / "data" / "character-packs"
# 官方 zip 目录（安装版 data/character-packs-official，开发版 dist/character-packs）
OFFICIAL_DIRNAME = "character-packs-official"
DIST_DIRNAME = "character-packs"

# 用户可写层
USER_ROOT = Path(user_data_dir())
USER_PACKS_DIR = USER_ROOT / "character-packs"

# 老版本单文件：包目录缺失时回退读取，保证升级不丢数据
LEGACY_CHARACTERS_FILE = BASE_DIR / "static" / "app" / "characters.json"

INDEX_FILE = "index.json"
DETAIL_PREFIX = "detail-"
# 清单 files 里必须登记索引文件，否则不算角色包
REQUIRED_FILES = (INDEX_FILE,)

THUMB_BASE = "https://blobs.animadex.net/Outputs/thumbs/"

# 索引层包含的字段（顺序即写盘顺序，便于 diff）
INDEX_FIELDS = ("id", "name", "copyright", "post_count", "gender", "hair", "eye", "trigger")
# 详情层包含的字段（thumb_url 由 trigger 推导，不必存）
DETAIL_FIELDS = ("tags", "img_url", "danbooru_url")


def detail_shard_of(char_id: str) -> str:
    """按 id 首字符分片，只允许 a-z0-9 与下划线，其余归到 other。

    分片后单片约 300~500KB，用户点开详情时只读一片。
    """
    text = str(char_id or "").strip().lower()
    head = text[:1]
    if head and (head.isascii() and (head.isalnum() or head == "_")):
        return head
    return "other"


def detail_filename(shard: str) -> str:
    """分片的文件名（单层 json，符合包内文件规范）。"""
    if not _is_safe_filename(DETAIL_PREFIX + shard + ".json"):
        return DETAIL_PREFIX + "other.json"
    return DETAIL_PREFIX + shard + ".json"


def thumb_url_of(trigger: str) -> str:
    """由 trigger 推导缩略图 URL，与源数据 100% 一致。"""
    from urllib.parse import quote

    text = str(trigger or "").replace(":", "_").replace("/", "_")
    return THUMB_BASE + quote(text, safe="()") + ".webp"
