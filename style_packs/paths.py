"""风格包的路径常量与安全校验。

目录约定（命名与排序解耦）：
    data/style-packs/<packId>/pack.json          清单：包元信息 + 分类顺序
    data/style-packs/<packId>/<category_id>.json  一个分类一个文件，文件名恒等于分类 id

内置包放在安装目录下（只读基线），用户包放在用户数据目录（可写、不进 git）。
校验规则本身在 content_packs.paths，这里只是带路径的风格包专用入口。
"""

from pathlib import Path

from content_packs.paths import (
    KIND_STYLES,
    MANIFEST_NAME,
    MAX_PACK_BYTES,
    PACK_ID_PATTERN,
    SAFE_FILENAME_PATTERN as CATEGORY_FILE_PATTERN,
    SCHEMA_VERSION,
    is_safe_filename,
    is_valid_pack_id,
)
from core.user_paths import user_data_dir

KIND = KIND_STYLES

# style_packs/paths.py -> 工程根（或安装目录的 app/）
BASE_DIR = Path(__file__).resolve().parent.parent

# 随包分发：只读基线
BUILTIN_PACKS_DIR = BASE_DIR / "data" / "style-packs"
# 官方 zip 的目录名（安装版 data/style-packs-official，开发版 dist/style-packs）
OFFICIAL_DIRNAME = "style-packs-official"
DIST_DIRNAME = "style-packs"

# 用户可写层
USER_ROOT = Path(user_data_dir())
USER_PACKS_DIR = USER_ROOT / "style-packs"
OVERLAY_FILE = USER_ROOT / "data" / "style-overlay.json"
# 老版本单文件（仅在包目录缺失时回退读取）
LEGACY_PRESETS_FILE = BASE_DIR / "data" / "style-presets.json"
# 老版本的"用户全量快照"：新体系不读它，启动时换算成增量层后归档
LEGACY_USER_SNAPSHOT = USER_ROOT / "data" / "style-presets.json"


def pack_dir_of(pack_id, builtin=False):
    """取包目录；packId 非法直接抛错，绝不拼出越界路径。"""
    if not is_valid_pack_id(pack_id):
        raise ValueError("非法的 packId：%r" % pack_id)
    root = BUILTIN_PACKS_DIR if builtin else USER_PACKS_DIR
    return root / pack_id
