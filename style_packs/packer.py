"""风格包的导入、导出与卸载。

zip 安全校验、体积上限、空包拒绝等机制都在 content_packs.packer，
这里只提供风格包的目录与提示语。目录在调用时才读取模块级常量，
便于测试注入临时目录。
"""

from content_packs.packer import (
    PackError,
    export_pack_dir,
    import_pack as _import_pack,
    uninstall_pack as _uninstall_pack,
)

from .paths import BUILTIN_PACKS_DIR, KIND, USER_PACKS_DIR, is_valid_pack_id


def import_pack(zip_path, replace: bool = False):
    """导入一个风格包 zip，返回导入后的 PackManifest。"""
    return _import_pack(
        zip_path,
        dest_root=USER_PACKS_DIR,
        kind=KIND,
        display_name="风格包",
        replace=replace,
        log_tag="style_packs",
    )


def export_pack(pack_id: str, out_path, builtin: bool = False):
    """把一个包（含内置包）导出成 zip，方便分享或另存。"""
    if not is_valid_pack_id(pack_id):
        raise PackError("packId 非法：%r" % pack_id)
    root = BUILTIN_PACKS_DIR if builtin else USER_PACKS_DIR
    return export_pack_dir(root / pack_id, pack_id, out_path)


def uninstall_pack(pack_id: str) -> bool:
    """卸载用户包（内置包不可卸载）。"""
    return _uninstall_pack(pack_id, dest_root=USER_PACKS_DIR)
