"""官方可选风格包：清单读取、一键安装、导出下载。

仓库不存完整风格数据（44MB），仓库里只有 art-canvas-seed 精简包。
完整的平台包以 zip 形式放在：
    安装版：<app>/data/style-packs-official/
    开发版：<project>/dist/style-packs/
两处都有 catalog.json，由 tools/style_pack_split.py 生成。

安装后落在用户目录，成为普通用户包：可卸载、升级不丢、不进 git。
"""

import io
import json
from pathlib import Path
from typing import Dict, List, Optional

from content_packs.catalog import (
    official_dir as _official_dir,
    read_catalog as _read_catalog,
    zip_path_of as _zip_path_of,
)

from .manifest import load_manifest
from .packer import PackError, export_pack, import_pack
from .paths import (
    BASE_DIR,
    BUILTIN_PACKS_DIR,
    DIST_DIRNAME,
    OFFICIAL_DIRNAME,
    USER_PACKS_DIR,
    is_valid_pack_id,
)
from .store import discover_packs, load_categories

CATALOG_NAME = "catalog.json"


def official_dir() -> Optional[Path]:
    """官方包目录：安装版优先，开发版回退到 dist/。"""
    return _official_dir(BASE_DIR, official_dirname=OFFICIAL_DIRNAME, dist_dirname=DIST_DIRNAME)


def read_catalog() -> Dict:
    """读官方包清单；目录或清单缺失时返回空结构（前端据此隐藏下载区）。"""
    return _read_catalog(official_dir(), log_tag="style_packs")


def find_pack_dir(pack_id: str):
    """在用户层与内置层里定位一个已安装的包。"""
    if not is_valid_pack_id(pack_id):
        return None, False
    for root, builtin in ((BUILTIN_PACKS_DIR, True), (USER_PACKS_DIR, False)):
        target = root / pack_id
        if (target / "pack.json").is_file():
            return target, builtin
    return None, False


def zip_path_of(pack_id: str) -> Optional[Path]:
    """取官方包的 zip 路径（以 catalog 登记的 file 为准，找不到再按 id 兜底）。"""
    return _zip_path_of(pack_id, official_dir(), read_catalog())


def install_official(pack_id: str, replace: bool = False):
    """安装官方包：把 zip 装进用户目录，返回 PackManifest。"""
    path = zip_path_of(pack_id)
    if not path:
        raise PackError("找不到官方包 %s（可能未随包分发，请改用本地导入）" % pack_id)
    return import_pack(path, replace=replace)


def _entry_count(pack) -> int:
    """包内条目数：清单里带了就直接用，没带才真读一遍内容。"""
    if getattr(pack, "entry_count", 0):
        return pack.entry_count
    return sum(
        len(sub.get("presets") or [])
        for cat in load_categories(pack)
        for sub in cat.get("subcategories") or []
    )


def installed_packs() -> List[dict]:
    """已安装包的精简信息，供资产库列表展示。"""
    result = []
    for pack in discover_packs():
        result.append({
            "packId": pack.pack_id,
            "name": pack.name,
            "version": pack.version,
            "author": pack.author,
            "description": pack.description,
            "builtin": pack.builtin,
            "order": pack.order,
            "categoryCount": len(pack.categories),
            "entryCount": _entry_count(pack),
        })
    return result


def official_with_status() -> Dict:
    """官方可下载包 + 每个包的安装状态，供前端渲染"可安装"列表。"""
    catalog = read_catalog()
    installed = {p["packId"]: p for p in installed_packs()}
    packs = []
    for entry in catalog.get("packs") or []:
        pid = str(entry.get("packId") or "")
        if not is_valid_pack_id(pid):
            continue
        local = installed.get(pid)
        packs.append({
            "packId": pid,
            "name": entry.get("name") or pid,
            "version": entry.get("version") or "1.0.0",
            "author": entry.get("author") or "",
            "description": entry.get("description") or "",
            "order": entry.get("order") or 500,
            "entryCount": entry.get("entryCount") or 0,
            "categoryCount": entry.get("categoryCount") or 0,
            "sizeBytes": entry.get("sizeBytes") or 0,
            "url": entry.get("url") or "",
            "available": zip_path_of(pid) is not None,
            "installed": local is not None,
            "installedBuiltin": bool(local and local["builtin"]),
        })
    packs.sort(key=lambda p: (p["order"], p["packId"]))
    return {
        "packs": packs,
        "totalEntries": catalog.get("totalEntries") or 0,
        "generatedAt": catalog.get("generatedAt") or "",
        "source": catalog.get("source") or "",
    }


def export_pack_zip(pack_id: str, out_path) -> Path:
    """把已安装的包（内置或用户）导出成 zip，用于分发或备份。"""
    target, builtin = find_pack_dir(pack_id)
    if not target:
        raise PackError("包未安装：%s" % pack_id)
    return export_pack(pack_id, out_path, builtin=builtin)
