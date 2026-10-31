"""画师包官方分发：官方 zip 目录、一键安装、导出下载。

官方包以 zip 随程序分发：
    安装版：<app>/data/artist-packs-official/
    开发版：<project>/dist/artist-packs/
两处都有 catalog.json，由 tools/artist_pack_split.py 生成。

安装后落在用户目录，成为普通用户包：可卸载、升级不丢、不进 git。
"""

import shutil
from pathlib import Path
from typing import Dict, List, Optional

from content_packs.catalog import (
    official_dir as _official_dir,
    read_catalog as _read_catalog,
    zip_path_of as _zip_path_of,
)
from content_packs.packer import PackError, export_pack_dir
from content_packs.packer import import_pack as _import_pack

from .paths import (
    BASE_DIR,
    BUILTIN_PACKS_DIR,
    DIST_DIRNAME,
    KIND,
    OFFICIAL_DIRNAME,
    REQUIRED_FILES,
    USER_PACKS_DIR,
)
from .store import discover_packs


def official_dir() -> Optional[Path]:
    return _official_dir(BASE_DIR, official_dirname=OFFICIAL_DIRNAME, dist_dirname=DIST_DIRNAME)


def read_catalog() -> Dict:
    return _read_catalog(official_dir(), log_tag="artist_packs")


def zip_path_of(pack_id: str) -> Optional[Path]:
    return _zip_path_of(pack_id, official_dir(), read_catalog())


def install_official(pack_id: str, replace: bool = False):
    """把官方画师包装进用户目录，返回装好后的清单。"""
    path = zip_path_of(pack_id)
    if not path:
        raise PackError("找不到官方画师包 %s（可能未随包分发，请改用本地导入）" % pack_id)
    return import_pack(path, replace=replace)


def import_pack(zip_path, replace: bool = False):
    """导入本地画师包 zip。"""
    return _import_pack(
        zip_path,
        dest_root=USER_PACKS_DIR,
        kind=KIND,
        display_name="画师包",
        required_files=REQUIRED_FILES,
        replace=replace,
        log_tag="artist_packs",
    )


def export_pack_zip(pack_id: str, out_path) -> Path:
    """导出已安装的包（内置或用户），用于分发或备份。"""
    for root in (USER_PACKS_DIR, BUILTIN_PACKS_DIR):
        src = root / pack_id
        if (src / "pack.json").is_file():
            return export_pack_dir(src, pack_id, out_path)
    raise PackError("画师包未安装：%s" % pack_id)


def uninstall_pack(pack_id: str) -> bool:
    """卸载用户包（内置包不可卸载）。"""
    if (BUILTIN_PACKS_DIR / pack_id).is_dir():
        raise PackError("内置画师包不可卸载：%s" % pack_id)
    target = USER_PACKS_DIR / pack_id
    if not target.is_dir():
        return False
    shutil.rmtree(target, ignore_errors=True)
    return not target.exists()


def installed_packs() -> List[dict]:
    """已安装包的精简信息，供资产库列表展示。"""
    return [{
        "packId": pack.pack_id,
        "name": pack.name,
        "version": pack.version,
        "author": pack.author,
        "description": pack.description,
        "builtin": pack.builtin,
        "order": pack.order,
        "entryCount": pack.entry_count,
        "dataVersion": pack.data_version,
    } for pack in discover_packs()]


def official_with_status() -> Dict:
    """官方可下载包 + 每个包的安装状态。"""
    catalog = read_catalog()
    installed = {p["packId"]: p for p in installed_packs()}
    packs = []
    for entry in catalog.get("packs") or []:
        pid = str(entry.get("packId") or "")
        if not pid:
            continue
        local = installed.get(pid)
        packs.append({
            "packId": pid,
            "name": entry.get("name") or pid,
            "version": entry.get("version") or "1.0.0",
            "description": entry.get("description") or "",
            "order": entry.get("order") or 500,
            "entryCount": entry.get("entryCount") or 0,
            "sizeBytes": entry.get("sizeBytes") or 0,
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
