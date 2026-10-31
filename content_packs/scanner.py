"""扫描若干个根目录，找出所有合法内容包。

调用方传入根目录列表（内置目录在前、用户目录在后），目录由谁决定
不在本模块 —— 这样风格包、角色包、画师包可以各用各的目录，
测试也能自由注入临时目录。
"""

from pathlib import Path
from typing import Iterable, List, Tuple

from .manifest import ContentManifest, load_manifest


def discover(roots: Iterable[Tuple], *, kind="", log_tag="content_packs",
             required_files=()) -> List[ContentManifest]:
    """扫描 (目录, 是否内置) 序列，返回按优先级排好序的包清单。"""
    packs: List[ContentManifest] = []
    for root, builtin in roots:
        root = Path(root)
        if not root.is_dir():
            continue
        for child in sorted(root.iterdir(), key=lambda p: p.name):
            if not child.is_dir():
                continue
            manifest = load_manifest(
                child,
                kind=kind,
                builtin=builtin,
                log_tag=log_tag,
                required_files=required_files,
            )
            if manifest:
                packs.append(manifest)
    packs.sort(key=lambda m: m.sort_key())
    return packs


def find_pack(pack_id: str, roots: Iterable[Tuple], **kwargs):
    """在多个根目录里定位一个包，返回 (ContentManifest, 是否内置)。"""
    for root, builtin in roots:
        target = Path(root) / pack_id
        if not target.is_dir():
            continue
        manifest = load_manifest(target, builtin=builtin, **kwargs)
        if manifest:
            return manifest, builtin
    return None, False
