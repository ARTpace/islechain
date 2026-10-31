"""画师包的路径常量与图片地址规则。

与前两个包最大的不同：**画师包没有详情层**。
每个画师的全部信息只有四个字段（id / tag / posts / img），加起来几十字节，
拆成"索引 + 详情"反而多一次请求，所以只有一个 index.json。

图片不落本地，直接从官方 CDN 取：
    <imageBase><imageId><imageExt>
例：
    https://cdn.mooshieblob.com/20260425_anima_all_artists/images/dairi-1cf6814da2-p1.avif

imageBase 写在 index.json 顶层而不是每个条目里 —— 4 万条 URL 前缀重复
会白白多出 3MB。换 release 时只改顶层一处。

一个画师包的结构：
    <packId>/pack.json     清单（files 里登记 index.json）
    <packId>/index.json    {imageBase, imageExt, dataVersion, items:[...]}
"""

from pathlib import Path

from content_packs.paths import KIND_ARTISTS

KIND = KIND_ARTISTS

BASE_DIR = Path(__file__).resolve().parent.parent

# 随包分发：只读种子
BUILTIN_PACKS_DIR = BASE_DIR / "data" / "artist-packs"
# 官方 zip 目录（安装版 data/artist-packs-official，开发版 dist/artist-packs）
OFFICIAL_DIRNAME = "artist-packs-official"
DIST_DIRNAME = "artist-packs"
# 拆包原料（全量 release，只在本机，不进 git 也不进安装包）
SOURCE_DIRNAME = "artist-packs-source"

# 用户可写层
from core.user_paths import user_data_dir  # noqa: E402

USER_ROOT = Path(user_data_dir())
USER_PACKS_DIR = USER_ROOT / "artist-packs"

# 老版本单文件（JS 变量形式）：包目录缺失时回退读取
LEGACY_ARTISTS_FILE = BASE_DIR / "static" / "app" / "artist_data.js"

INDEX_FILE = "index.json"
REQUIRED_FILES = (INDEX_FILE,)

# 官方数据源兜底：index.json 没写 imageBase 时用它拼图片地址
DEFAULT_IMAGE_BASE = "https://cdn.mooshieblob.com/20260425_anima_all_artists/images/"
DEFAULT_IMAGE_EXT = ".avif"

# 分档阈值（与前端 UI 的「传奇/知名/活跃/新锐」一致）
TIER_LEGEND = 5000
TIER_FAMOUS = 1000
TIER_ACTIVE = 100
TIER_RISING = 10


def tier_of(post_count) -> str:
    """按投稿数归入前端用的分档标识。"""
    try:
        count = int(post_count or 0)
    except (TypeError, ValueError):
        count = 0
    if count >= TIER_LEGEND:
        return "legend"
    if count >= TIER_FAMOUS:
        return "famous"
    if count >= TIER_ACTIVE:
        return "active"
    if count >= TIER_RISING:
        return "rising"
    return "newbie"


def image_url_of(image_base: str, image_id: str, image_ext: str = DEFAULT_IMAGE_EXT) -> str:
    """把 imageId 拼成完整图片地址；已带协议的原样返回。"""
    text = str(image_id or "").strip()
    if not text:
        return ""
    if text.startswith("http://") or text.startswith("https://"):
        return text
    base = str(image_base or DEFAULT_IMAGE_BASE)
    if not base.endswith("/"):
        base += "/"
    ext = str(image_ext or DEFAULT_IMAGE_EXT)
    if not ext.startswith("."):
        ext = "." + ext
    return base + text + ext
