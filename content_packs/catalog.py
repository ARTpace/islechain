"""官方可选包的目录定位与清单读取（与包类型无关）。

官方包以 zip 形式随程序分发，占位两处：
    安装版：<app>/data/<official_dirname>/
    开发版：<project>/dist/<dist_dirname>/
两处都有 catalog.json，由各自的 tools/split 脚本生成。

安装后落在用户目录，成为普通用户包：可卸载、升级不丢、不进 git。
"""

import io
import json
from pathlib import Path
from typing import Dict, Optional

from .paths import is_valid_pack_id

CATALOG_NAME = "catalog.json"


def official_dir(base_dir, *, official_dirname: str, dist_dirname: str) -> Optional[Path]:
    """官方包目录：安装版优先，开发版回退到 dist/。"""
    for candidate in (
        Path(base_dir) / "data" / official_dirname,
        Path(base_dir) / "dist" / dist_dirname,
    ):
        if (candidate / CATALOG_NAME).is_file():
            return candidate
    return None


def read_catalog(root: Optional[Path], *, log_tag="content_packs") -> Dict:
    """读官方包清单；目录或清单缺失时返回空结构（前端据此隐藏下载区）。"""
    if not root:
        return {"packs": [], "totalEntries": 0, "source": ""}
    try:
        with io.open(Path(root) / CATALOG_NAME, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        print("[%s] catalog 读取失败：%s" % (log_tag, exc))
        return {"packs": [], "totalEntries": 0, "source": str(root)}
    data["source"] = str(root)
    data.setdefault("packs", [])
    return data


def zip_path_of(pack_id: str, root: Optional[Path], catalog: Dict = None) -> Optional[Path]:
    """取官方包的 zip 路径（以 catalog 登记的 file 为准，找不到再按 id 兜底）。"""
    if not root or not is_valid_pack_id(pack_id):
        return None
    catalog = read_catalog(root) if catalog is None else catalog
    for entry in catalog.get("packs") or []:
        if str(entry.get("packId")) != pack_id:
            continue
        name = str(entry.get("file") or "")
        # catalog 里的 file 只允许单层文件名，防止被改造成越界路径
        if name and "/" not in name and "\\" not in name and ".." not in name:
            candidate = Path(root) / name
            if candidate.is_file():
                return candidate
    fallback = Path(root) / (pack_id + ".zip")
    return fallback if fallback.is_file() else None
