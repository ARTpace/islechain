"""pack.json 清单的通用解析与校验。

清单描述"这个包是什么、里面有哪些内容文件、按什么顺序排"，
不存内容本身，所以调整顺序永远不需要改数据文件。

各包类型的差异集中在两处，由调用方传入：
    1. kind       包类型标记（styles / characters / artists）
    2. 额外文件   例如角色包要求必须有 index.json，用 required_files 声明
"""

import io
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from .paths import (
    MANIFEST_NAME,
    SCHEMA_VERSION,
    as_int,
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
class ContentManifest:
    """一个内容包的清单。内容结构随 kind 不同，公共部分是这些。"""

    pack_id: str
    kind: str = ""
    name: str = ""
    version: str = "0.0.0"
    author: str = ""
    description: str = ""
    order: int = DEFAULT_PACK_ORDER
    builtin: bool = False
    path: Optional[Path] = None
    categories: List[PackCategory] = field(default_factory=list)
    # 清单可预存条目数，避免列表页为了显示数字去解析几十 MB 内容；0 表示未登记
    entry_count: int = 0
    # 数据文件登记表，例如 {"index": "index.json", "detail": "detail.json"}
    files: Dict[str, str] = field(default_factory=dict)
    # 包声明的数据版本（原始数据集版本，与包自身 version 不同）
    data_version: str = ""

    def sort_key(self):
        """包优先级：内置永远在前，其余按 order，再按 packId 保证稳定。"""
        return (0 if self.builtin else 1, self.order, self.pack_id)

    def file_of(self, key: str) -> Optional[Path]:
        """取登记过的数据文件路径；未登记或文件不存在时返回 None。"""
        name = self.files.get(key)
        if not name or not self.path:
            return None
        path = Path(self.path) / name
        return path if path.is_file() else None


def _parse_categories(items, pack_id: str, log_tag: str) -> List[PackCategory]:
    categories: List[PackCategory] = []
    seen = set()
    for index, item in enumerate(items or []):
        if not isinstance(item, dict):
            continue
        cid = str(item.get("id") or "").strip()
        fname = str(item.get("file") or "").strip()
        if not cid or cid in seen:
            continue
        if not is_safe_filename(fname):
            print("[%s] 跳过非法文件名：%s/%s" % (log_tag, pack_id, fname))
            continue
        seen.add(cid)
        categories.append(PackCategory(
            id=cid,
            name=str(item.get("name") or cid),
            file=fname,
            order=as_int(item.get("order"), index * 10),
        ))
    categories.sort(key=lambda c: (c.order, c.id))
    return categories


def _parse_files(raw, pack_id: str, log_tag: str) -> Dict[str, str]:
    """解析 files 登记表：键任意，值必须是安全的单层 json 文件名。"""
    result: Dict[str, str] = {}
    if not isinstance(raw, dict):
        return result
    for key, value in raw.items():
        name = str(value or "").strip()
        if not is_safe_filename(name):
            print("[%s] 跳过非法数据文件登记：%s/%s=%r" % (log_tag, pack_id, key, value))
            continue
        result[str(key)] = name
    return result


def parse_manifest(data, *, pack_id, pack_dir, kind="", builtin=False,
                   log_tag="content_packs", required_files=()):
    """把清单 dict 转成 ContentManifest，非法条目跳过并记录。"""
    if not isinstance(data, dict):
        raise ValueError("pack.json 顶层必须是对象")

    schema = as_int(data.get("schema"), SCHEMA_VERSION)
    if schema > SCHEMA_VERSION:
        raise ValueError(
            "pack.json schema=%s 高于当前支持的 %s，请升级程序" % (schema, SCHEMA_VERSION)
        )

    declared_id = str(data.get("packId") or pack_id)
    if not is_valid_pack_id(declared_id):
        raise ValueError("pack.json 的 packId 非法：%r" % declared_id)
    # 以实际目录名为准，避免"清单说 A、目录是 B"造成的加载歧义
    resolved_id = pack_id

    files = _parse_files(data.get("files"), resolved_id, log_tag)
    missing = [name for name in required_files if name not in files.values()]
    if missing:
        raise ValueError(
            "pack.json 缺少必需的数据文件登记：%s（应在 files 里声明）" % ", ".join(missing)
        )

    return ContentManifest(
        pack_id=resolved_id,
        kind=kind,
        name=str(data.get("name") or resolved_id),
        version=str(data.get("version") or "0.0.0"),
        author=str(data.get("author") or ""),
        description=str(data.get("description") or ""),
        order=as_int(data.get("order"), DEFAULT_PACK_ORDER),
        builtin=builtin,
        path=Path(pack_dir),
        categories=_parse_categories(data.get("categories"), resolved_id, log_tag),
        entry_count=as_int(data.get("entryCount"), 0),
        files=files,
        data_version=str(data.get("dataVersion") or ""),
    )


def load_manifest(pack_dir, *, kind="", builtin=False, log_tag="content_packs",
                  required_files=()):
    """读取包目录下的 pack.json；不存在或损坏返回 None（不抛，避免影响启动）。"""
    pack_dir = Path(pack_dir)
    manifest_path = pack_dir / MANIFEST_NAME
    if not manifest_path.is_file():
        return None
    try:
        with io.open(manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return parse_manifest(
            data,
            pack_id=pack_dir.name,
            pack_dir=pack_dir,
            kind=kind,
            builtin=builtin,
            log_tag=log_tag,
            required_files=required_files,
        )
    except Exception as exc:  # 单个包坏了不拖垮其他包
        print("[%s] 加载清单失败 %s：%s" % (log_tag, manifest_path, exc))
        return None
