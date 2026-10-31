"""内容包的通用常量与安全校验（与具体包类型无关）。

包类型（kind）由各内容模块自己声明：
    styles      提示词风格包    style_packs
    characters  角色包          character_packs
    artists     画师包          artist_packs

本模块只回答"什么算合法的包"，**不决定包放在哪** —— 目录由调用方传入，
测试因此可以随时注入临时目录，不需要 monkeypatch 全局常量。
"""

import re

MANIFEST_NAME = "pack.json"
SCHEMA_VERSION = 1

# 单个包解压后的体积上限，防止恶意 zip 撑爆磁盘
MAX_PACK_BYTES = 256 * 1024 * 1024

# packId：小写字母数字与连字符，2~40 字符，必须以字母数字开头
PACK_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")

# 包内数据文件只允许"名字.json"，禁止任何路径分隔符
SAFE_FILENAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,80}\.json$")

KIND_STYLES = "styles"
KIND_CHARACTERS = "characters"
KIND_ARTISTS = "artists"


def is_valid_pack_id(value) -> bool:
    """packId 是否合法（同时用于防目录穿越）。"""
    return bool(value) and bool(PACK_ID_PATTERN.match(str(value)))


def is_safe_filename(value) -> bool:
    """数据文件名是否安全：只允许单层文件名、必须 .json、不得含 ..。"""
    text = str(value or "")
    if not SAFE_FILENAME_PATTERN.match(text):
        return False
    return ".." not in text and "/" not in text and "\\" not in text


def as_int(value, default=0) -> int:
    """宽松取整：前端/清单里可能传来字符串或 None。"""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
