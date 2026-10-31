"""风格包的路径常量与安全校验。

目录约定（命名与排序解耦）：
    data/style-packs/<packId>/pack.json         清单：包元信息 + 分类顺序
    data/style-packs/<packId>/<category_id>.json 一个分类一个文件，文件名恒等于分类 id

内置包放在安装目录下（只读基线），用户包放在用户数据目录（可写、不进 git）。
"""

import re
from pathlib import Path

from user_paths import user_data_dir

# style_packs/paths.py -> 工程根（或安装目录的 app/）
BASE_DIR = Path(__file__).resolve().parent.parent

# 随包分发：只读基线
BUILTIN_PACKS_DIR = BASE_DIR / "data" / "style-packs"

# 用户可写层
USER_ROOT = Path(user_data_dir())
USER_PACKS_DIR = USER_ROOT / "style-packs"
OVERLAY_FILE = USER_ROOT / "data" / "style-overlay.json"
# 老版本单文件（仅在包目录缺失时回退读取）
LEGACY_PRESETS_FILE = BASE_DIR / "data" / "style-presets.json"
# 老版本的"用户全量快照"：新体系不读它，启动时换算成增量层后归档
LEGACY_USER_SNAPSHOT = USER_ROOT / "data" / "style-presets.json"

# packId：小写字母数字与连字符，2~40 字符，必须以字母数字开头
PACK_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")
# 分类文件只允许"名字.json"，禁止任何路径分隔符
CATEGORY_FILE_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,80}\.json$")

MANIFEST_NAME = "pack.json"
SCHEMA_VERSION = 1

# 单个包解压后的体积上限，防止恶意 zip 撑爆磁盘
MAX_PACK_BYTES = 256 * 1024 * 1024


def is_valid_pack_id(value):
    """packId 是否合法（同时用于防目录穿越）。"""
    return bool(value) and bool(PACK_ID_PATTERN.match(str(value)))


def is_safe_filename(value):
    """分类文件名是否安全：只允许单层文件名、必须 .json、不得含 ..。"""
    text = str(value or "")
    if not CATEGORY_FILE_PATTERN.match(text):
        return False
    return ".." not in text and "/" not in text and "\\" not in text


def pack_dir_of(pack_id, builtin=False):
    """取包目录；packId 非法直接抛错，绝不拼出越界路径。"""
    if not is_valid_pack_id(pack_id):
        raise ValueError("非法的 packId：%r" % pack_id)
    root = BUILTIN_PACKS_DIR if builtin else USER_PACKS_DIR
    return root / pack_id
