"""pack.json 清单的解析与校验。

一个包 = 一个清单 + 若干分类文件。清单只描述"有哪些分类、叫什么、排第几"，
不存任何预设内容，所以调整顺序永远不需要改数据文件。
"""

import io
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from .paths import (
    MANIFEST_NAME,
    SCHEMA_VERSION,
    is_safe_filename,
    is_valid_pack_id,
)

DEFAULT_PACK_ORDER = 500


@dataclass
class PackCategory:
    """清单里的一个分类：指向一个文件，并声明显示顺序。"""

    id: str
    name: str
    file: str
    order: int = 0


@dataclass
class PackManifest:
    pack_id: str
    name: str
    version: str = "0.0.0"
    author: str = ""
    description: str = ""
    order: int = DEFAULT_PACK_ORDER
    builtin: bool = False
    path: Optional[Path] = None
    categories: List[PackCategory] = field(default_factory=list)
    # 清单可预存条目数，避免列表页为了显示数字去解析几十 MB 内容；0 表示未登记
    entry_count: int = 0

    def sort_key(self):
        """包优先级：内置永远在前，其余按 order，再按 packId 保证稳定。"""
        return (0 if self.builtin else 1, self.order, self.pack_id)


def _as_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def parse_manifest(data, *, pack_id, pack_dir, builtin=False):
    """把清单 dict 转成 PackManifest，非法条目跳过并记录。"""
    if not isinstance(data, dict):
        raise ValueError("pack.json 顶层必须是对象")

    schema = _as_int(data.get("schema"), SCHEMA_VERSION)
    if schema > SCHEMA_VERSION:
        raise ValueError("pack.json schema=%s 高于当前支持的 %s，请升级程序" % (schema, SCHEMA_VERSION))

    declared_id = str(data.get("packId") or pack_id)
    if not is_valid_pack_id(declared_id):
        raise ValueError("pack.json 的 packId 非法：%r" % declared_id)
    # 以实际目录名为准，避免"清单说 A、目录是 B"造成的加载歧义
    resolved_id = pack_id

    categories: List[PackCategory] = []
    seen = set()
    for index, item in enumerate(data.get("categories") or []):
        if not isinstance(item, dict):
            continue
        cid = str(item.get("id") or "").strip()
        fname = str(item.get("file") or "").strip()
        if not cid or cid in seen:
            continue
        if not is_safe_filename(fname):
            print("[style_packs] 跳过非法文件名：%s/%s" % (resolved_id, fname))
            continue
        seen.add(cid)
        categories.append(PackCategory(
            id=cid,
            name=str(item.get("name") or cid),
            file=fname,
            order=_as_int(item.get("order"), index * 10),
        ))

    categories.sort(key=lambda c: (c.order, c.id))
    return PackManifest(
        pack_id=resolved_id,
        name=str(data.get("name") or resolved_id),
        version=str(data.get("version") or "0.0.0"),
        author=str(data.get("author") or ""),
        description=str(data.get("description") or ""),
        order=_as_int(data.get("order"), DEFAULT_PACK_ORDER),
        builtin=builtin,
        path=Path(pack_dir),
        categories=categories,
        entry_count=_as_int(data.get("entryCount"), 0),
    )


def load_manifest(pack_dir, builtin=False):
    """读取包目录下的 pack.json；不存在或损坏返回 None（不抛，避免影响启动）。"""
    pack_dir = Path(pack_dir)
    manifest_path = pack_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        return None
    try:
        with io.open(manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return parse_manifest(data, pack_id=pack_dir.name, pack_dir=pack_dir, builtin=builtin)
    except Exception as exc:  # 单个包坏了不拖垮其他包
        print("[style_packs] 加载清单失败 %s：%s" % (manifest_path, exc))
        return None
