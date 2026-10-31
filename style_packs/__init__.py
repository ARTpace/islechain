"""风格包系统：内置包 + 用户包 + 用户增量层，合并后交给前端。

对外只需三个概念：
  pack      一个可独立分发的目录（pack.json + 每分类一个 json）
  overlay   用户自己加/改/删的条目，几 KB，不进 git，升级不丢
  merged    两者合并后的分类列表，前端直接渲染，顺序稳定
"""

import os

from .manifest import PackCategory, PackManifest, load_manifest, parse_manifest
from .merge import base_categories, category_total, merged_categories
from .packer import PackError, export_pack, import_pack, uninstall_pack
from .catalog import (
    export_pack_zip,
    find_pack_dir,
    install_official,
    installed_packs,
    official_with_status,
    read_catalog,
    zip_path_of,
)
from .snapshot import diff_overlay, migrate_legacy_snapshot, replace_from_snapshot
from .paths import (
    BUILTIN_PACKS_DIR,
    LEGACY_PRESETS_FILE,
    OVERLAY_FILE,
    USER_PACKS_DIR,
    is_valid_pack_id,
)
from .store import (
    add_item,
    discover_packs,
    load_categories,
    overlay_summary,
    patch_item,
    read_overlay,
    remove_item,
    write_overlay,
)


def signature():
    """所有相关文件的 mtime 签名，任何增删改都会让它变化。"""
    stamps = []
    for root in (BUILTIN_PACKS_DIR, USER_PACKS_DIR):
        if not root.is_dir():
            continue
        try:
            stamps.append(os.path.getmtime(root))
        except OSError:
            pass
        for child in sorted(root.iterdir()):
            if not child.is_dir():
                continue
            try:
                stamps.append(os.path.getmtime(child))
            except OSError:
                pass
            for path in sorted(child.glob("*.json")):
                try:
                    stamps.append(os.path.getmtime(path))
                except OSError:
                    pass
    for extra in (OVERLAY_FILE, LEGACY_PRESETS_FILE):
        if extra.is_file():
            try:
                stamps.append(os.path.getmtime(extra))
            except OSError:
                pass
    return tuple(sorted(stamps))


def has_packs():
    """是否至少有一个可用包（用于决定要不要回退老单文件）。"""
    return bool(discover_packs())


__all__ = [
    "PackCategory",
    "PackManifest",
    "PackError",
    "BUILTIN_PACKS_DIR",
    "USER_PACKS_DIR",
    "OVERLAY_FILE",
    "LEGACY_PRESETS_FILE",
    "add_item",
    "base_categories",
    "category_total",
    "diff_overlay",
    "discover_packs",
    "export_pack",
    "export_pack_zip",
    "find_pack_dir",
    "has_packs",
    "import_pack",
    "install_official",
    "installed_packs",
    "is_valid_pack_id",
    "load_categories",
    "load_manifest",
    "merged_categories",
    "migrate_legacy_snapshot",
    "official_with_status",
    "overlay_summary",
    "parse_manifest",
    "patch_item",
    "read_catalog",
    "read_overlay",
    "remove_item",
    "replace_from_snapshot",
    "signature",
    "uninstall_pack",
    "write_overlay",
]
