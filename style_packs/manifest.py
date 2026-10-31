"""风格包清单（pack.json）的解析入口。

解析与校验逻辑在 content_packs.manifest，本模块只固定两件事：
    kind = styles
    日志前缀 = style_packs
这样调用方与既有测试仍然只认 style_packs 里的这几个名字。
"""

from content_packs.manifest import (
    DEFAULT_PACK_ORDER,
    ContentManifest,
    PackCategory,
    load_manifest as _load_manifest,
    parse_manifest as _parse_manifest,
)

from .paths import KIND

# 风格包的清单对象就是通用清单，字段完全一致（含 categories）
PackManifest = ContentManifest


def parse_manifest(data, *, pack_id, pack_dir, builtin=False):
    """把清单 dict 转成 PackManifest，非法条目跳过并记录。"""
    return _parse_manifest(
        data,
        pack_id=pack_id,
        pack_dir=pack_dir,
        kind=KIND,
        builtin=builtin,
        log_tag="style_packs",
    )


def load_manifest(pack_dir, builtin=False):
    """读取包目录下的 pack.json；不存在或损坏返回 None（不抛，避免影响启动）。"""
    return _load_manifest(pack_dir, kind=KIND, builtin=builtin, log_tag="style_packs")
