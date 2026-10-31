#!/usr/bin/env python3
"""
Fooocus 官方风格包导入器
========================

从 6 个开源仓库拉取风格预设 JSON，合并到 data/style-presets.json。

源:
    fooocus         lllyasviel/Fooocus-styles
    sai             ali-vilab/SDXL_Prompt_Styles (sai 风格)
    diva            ComfyUI_Style_Align (diva 系列)
    marc_k3nt3l     marc-k3nt3l/ComfyUI-Styles
    twri            twri/sdxl_styles
    mre             M-r-r/Fooocus_styles

设计:
    - 每个源对应一个独立分类 (cat.id = "fooocus_<source>")
    - preset.id 形如 "fooocus_<source>_<original_id>" 避免冲突
    - 缩略图从 GitHub raw 拉取，存为 data/thumbnails/fooocus_<source>_<id>.jpg
    - 按 preset.id 去重（已存在跳过）
    - 支持 dry_run / skip_thumbs

用法:
    python tools/fooocus_importer.py
    python tools/fooocus_importer.py --sources fooocus sai
    python tools/fooocus_importer.py --dry-run
    python tools/fooocus_importer.py --skip-thumbs
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from urllib.parse import quote
from urllib.request import urlopen, Request
from urllib.error import HTTPError, URLError

# Windows UTF-8
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

TOOLS_DIR = Path(__file__).resolve().parent
ART_CANVAS_DIR = TOOLS_DIR.parent
DATA_DIR = ART_CANVAS_DIR / "data"
TARGET_FILE = DATA_DIR / "style-presets.json"
if str(ART_CANVAS_DIR) not in sys.path:
    sys.path.insert(0, str(ART_CANVAS_DIR))
from user_paths import user_data_dir
_USER_DATA = Path(user_data_dir())
THUMBS_DIR = _USER_DATA / "thumbnails"
BACKUP_DIR = _USER_DATA / "backups"

# 缩略图存放子目录（避免污染其他缩略图）
FOOOCUS_THUMBS_DIR = THUMBS_DIR  # 直接放 thumbnails 下

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) art-canvas/1.0"
HTTP_TIMEOUT = 30
HTTP_RETRIES = 3
THUMB_RETRY = 2

# ============================================================
# 源配置
# ============================================================
# 实际继承仓库: ehristoforu/DeFooocus (Fooocus 官方仓库已被 GitHub 删除)
# 6 个 SDXL 风格 JSON 都集中在 sdxl_styles/ 目录
# 缩略图统一在 sdxl_styles/samples/ 目录
REPO = "ehristoforu/DeFooocus"
BRANCH = "main"
SAMPLES_DIR = "sdxl_styles/samples"
STYLES_DIR = "sdxl_styles"

SOURCES: Dict[str, Dict[str, Any]] = {
    "fooocus": {
        "name": "Fooocus 官方",
        "cat_name": "Fooocus 官方",
        "files": [
            ("sdxl_styles_fooocus.json", f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{STYLES_DIR}/sdxl_styles_fooocus.json"),
        ],
        "format": "fooocus",
    },
    "sai": {
        "name": "SAI 风格",
        "cat_name": "SAI 风格",
        "files": [
            ("sdxl_styles_sai.json", f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{STYLES_DIR}/sdxl_styles_sai.json"),
        ],
        "format": "mre",
    },
    "diva": {
        "name": "DIVA 电影感",
        "cat_name": "DIVA 电影感",
        "files": [
            ("sdxl_styles_diva.json", f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{STYLES_DIR}/sdxl_styles_diva.json"),
        ],
        "format": "diva",
    },
    "marc_k3nt3l": {
        "name": "Marc K3nt3L",
        "cat_name": "Marc K3nt3L",
        "files": [
            ("sdxl_styles_marc_k3nt3l.json", f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{STYLES_DIR}/sdxl_styles_marc_k3nt3l.json"),
        ],
        "format": "mre",
    },
    "twri": {
        "name": "TWRI SDXL",
        "cat_name": "TWRI SDXL",
        "files": [
            ("sdxl_styles_twri.json", f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{STYLES_DIR}/sdxl_styles_twri.json"),
        ],
        "format": "twri",
    },
    "mre": {
        "name": "MRE 风格",
        "cat_name": "MRE 风格",
        "files": [
            ("sdxl_styles_mre.json", f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{STYLES_DIR}/sdxl_styles_mre.json"),
        ],
        "format": "mre",
    },
}

# ============================================================
# HTTP 工具
# ============================================================
def http_get(url: str, retries: int = HTTP_RETRIES, timeout: int = HTTP_TIMEOUT) -> Optional[bytes]:
    """带重试的 HTTP GET"""
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except (HTTPError, URLError) as e:
            last_err = e
            if attempt < retries:
                time.sleep(0.5 * attempt)
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(0.5 * attempt)
    print(f"  [HTTP] 失败 {url}: {last_err}")
    return None


# ============================================================
# 拉取 / 解析各源
# ============================================================
def fetch_source(source_key: str, cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """拉取源的所有 JSON 并解析为统一 preset 格式"""
    items: List[Dict[str, Any]] = []
    for label, url in cfg["files"]:
        raw = http_get(url)
        if raw is None:
            print(f"  [skip] {source_key}/{label}: 下载失败")
            continue
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception as e:
            print(f"  [skip] {source_key}/{label}: 解析失败 {e}")
            continue
        fmt = cfg["format"]
        if fmt == "fooocus":
            items.extend(_parse_fooocus(source_key, data, url))
        elif fmt == "mre":
            items.extend(_parse_mre(source_key, data, url))
        elif fmt == "diva":
            items.extend(_parse_diva(source_key, data, url))
        elif fmt == "twri":
            items.extend(_parse_twri(source_key, data, url))
        else:
            print(f"  [warn] 未知 format={fmt}")
    return items


def _slug(s: str) -> str:
    """生成 id 安全的 slug"""
    s = (s or "").strip().lower()
    s = re.sub(r"[\s/\\]+", "_", s)
    s = re.sub(r"[^a-z0-9_]+", "", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s or "x"


def _parse_fooocus(source_key: str, data: Any, url: str) -> List[Dict[str, Any]]:
    """Fooocus 官方格式: [{name, prompt, negative_prompt}, ...]"""
    out = []
    if not isinstance(data, list):
        return out
    for item in data:
        if not isinstance(item, dict):
            continue
        name = (item.get("name") or "").strip()
        prompt = (item.get("prompt") or "").strip()
        if not name and not prompt:
            continue
        nid = f"fooocus_{source_key}_{_slug(name)}"
        out.append({
            "id": nid,
            "name": name,
            "prompt": prompt,
            "negative_prompt": (item.get("negative_prompt") or "").strip(),
            "description": "Fooocus 官方风格",
            "source_url": url,
        })
    return out


def _parse_mre(source_key: str, data: Any, url: str) -> List[Dict[str, Any]]:
    """mrexposh / marc_k3nt3l 格式: [{name, prompt, negative_prompt, ...}, ...]"""
    out = []
    if not isinstance(data, list):
        return out
    for item in data:
        if not isinstance(item, dict):
            continue
        name = (item.get("name") or "").strip()
        prompt = (item.get("prompt") or "").strip()
        if not name and not prompt:
            continue
        nid = f"fooocus_{source_key}_{_slug(name)}"
        out.append({
            "id": nid,
            "name": name,
            "prompt": prompt,
            "negative_prompt": (item.get("negative_prompt") or "").strip(),
            "description": f"{SOURCES.get(source_key, {}).get('name', source_key)} 风格",
            "source_url": url,
        })
    return out


def _parse_diva(source_key: str, data: Any, url: str) -> List[Dict[str, Any]]:
    """DIVA 格式: [{name, prompt, negative_prompt, preview?: url}, ...]"""
    return _parse_mre(source_key, data, url)


def _parse_twri(source_key: str, data: Any, url: str) -> List[Dict[str, Any]]:
    """TWRI 格式: [{name, prompt, negative_prompt, ...}, ...]"""
    return _parse_mre(source_key, data, url)


# ============================================================
# 缩略图
# ============================================================
def get_sample_url(source_key: str, preset: Dict[str, Any], cfg: Dict[str, Any]) -> Optional[str]:
    """根据 preset.name 在 samples/ 目录推断缩略图 URL

    实际样本文件名规则: <name>.jpg (name 通常与 preset.name 相同或 slug)
    """
    name = (preset.get("name") or "").strip()
    if not name:
        return None
    # 候选: 原名 + slug 版
    candidates = [
        f"{name}.jpg",
        f"{_slug(name)}.jpg",
        f"{name.replace(' ', '_')}.jpg",
    ]
    # 去重保序
    seen, uniq = set(), []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq[0]  # 主 URL；备选由调用方 retry

# 缩略图 URL 候选（依次重试）
def get_sample_urls(source_key: str, preset: Dict[str, Any], cfg: Dict[str, Any]) -> List[str]:
    name = (preset.get("name") or "").strip()
    if not name:
        return []
    base = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{SAMPLES_DIR}"
    candidates = [
        f"{name}.jpg",
        f"{_slug(name)}.jpg",
        f"{name.replace(' ', '_')}.jpg",
        f"{name.replace(' ', '-')}.jpg",
    ]
    return [f"{base}/{c}" for c in candidates]


def download_thumbnails(
    source_key: str,
    presets: List[Dict[str, Any]],
    cfg: Dict[str, Any],
    skip: bool = False,
) -> int:
    """下载缩略图，返回写入磁盘的条数"""
    if skip:
        return 0
    FOOOCUS_THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    n = 0
    for p in presets:
        pid = p.get("id", "")
        thumb_name = f"{pid}.jpg"
        target = FOOOCUS_THUMBS_DIR / thumb_name
        if target.exists() and target.stat().st_size > 100:
            p["thumbnail"] = f"/api/thumbnails/{thumb_name}"
            continue
        urls = get_sample_urls(source_key, p, cfg)
        if not urls:
            continue
        ok = False
        for url in urls:
            raw = http_get(url, retries=1, timeout=10)
            if raw and len(raw) > 100:
                try:
                    target.write_bytes(raw)
                    p["thumbnail"] = f"/api/thumbnails/{thumb_name}"
                    n += 1
                    ok = True
                    break
                except Exception as e:
                    print(f"  [warn] 写 {thumb_name} 失败: {e}")
        if not ok and not p.get("thumbnail"):
            pass
    return n


# ============================================================
# 合并到 style-presets.json
# ============================================================
def backup_file(path: Path, label: str = "fooocus") -> Optional[Path]:
    """备份文件"""
    if not path.exists():
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    target = BACKUP_DIR / f"{path.stem}.bak.{label}.{ts}"
    target.write_bytes(path.read_bytes())
    # 轮转：仅保留最近 5 个同名 .bak
    _rotate(target)
    return target


def _rotate(target: Path):
    keep = 5
    pat = re.compile(rf"^{re.escape(target.stem)}\.bak\..+\.\d+$")
    olds = sorted(
        [p for p in target.parent.iterdir() if pat.match(p.name)],
        key=lambda p: p.name,
    )
    for p in olds[: max(0, len(olds) - keep)]:
        try:
            p.unlink()
        except Exception:
            pass


def _user_style_file() -> Path:
    """风格预设的用户写入位置（不动随包分发的基线）。"""
    return _USER_DATA / "data" / "style-presets.json"


def _read_style_file() -> Path:
    """读风格预设：用户目录优先，回退基线。"""
    user = _user_style_file()
    return user if user.is_file() else TARGET_FILE


def load_presets() -> Dict[str, Any]:
    source = _read_style_file()
    if not source.exists():
        return {"categories": []}
    with open(source, "r", encoding="utf-8") as f:
        return json.load(f)


def save_presets(data: Dict[str, Any]) -> None:
    target = _user_style_file()
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def find_or_create_category(data: Dict[str, Any], cat_id: str, cat_name: str) -> Dict[str, Any]:
    for cat in data.get("categories", []):
        if cat.get("id") == cat_id:
            return cat
    cat = {
        "id": cat_id,
        "name": cat_name,
        "subcategories": [
            {"id": cat_id, "name": cat_name, "presets": []}
        ],
    }
    data.setdefault("categories", []).append(cat)
    return cat


def collect_existing_ids(data: Dict[str, Any]) -> set:
    ids = set()
    for cat in data.get("categories", []):
        for sub in cat.get("subcategories", []):
            for p in sub.get("presets", []):
                pid = p.get("id")
                if pid:
                    ids.add(pid)
    return ids


def merge_into(
    data: Dict[str, Any],
    source_key: str,
    cfg: Dict[str, Any],
    presets: List[Dict[str, Any]],
) -> Tuple[int, int]:
    """返回 (新增, 跳过)"""
    cat_id = f"fooocus_{source_key}"
    cat_name = cfg["name"]
    cat = find_or_create_category(data, cat_id, cat_name)
    sub = cat["subcategories"][0]
    existing_ids = {p.get("id") for p in sub.get("presets", [])}
    added = 0
    skipped = 0
    for p in presets:
        pid = p.get("id", "")
        if not pid:
            continue
        if pid in existing_ids:
            skipped += 1
            continue
        sub.setdefault("presets", []).append(p)
        existing_ids.add(pid)
        added += 1
    return added, skipped


# ============================================================
# 主入口
# ============================================================
def import_fooocus_styles(
    sources: Optional[List[str]] = None,
    dry_run: bool = False,
    skip_thumbs: bool = False,
) -> Dict[str, Any]:
    """一键导入

    Returns:
        {
          success: bool,
          dry_run: bool,
          sources: {...},
          total_added: int,
          total_skipped: int,
          total_thumbs: int,
        }
    """
    sources = sources or list(SOURCES.keys())
    print(f"[fooocus-import] sources={sources}  dry_run={dry_run}  skip_thumbs={skip_thumbs}")
    data = load_presets() if not dry_run else {"categories": []}
    if not dry_run:
        backup_file(TARGET_FILE, label="fooocus")

    result: Dict[str, Any] = {
        "success": True,
        "dry_run": dry_run,
        "sources": {},
        "total_added": 0,
        "total_skipped": 0,
        "total_thumbs": 0,
    }

    for key in sources:
        if key not in SOURCES:
            print(f"  [warn] 未知源: {key}")
            continue
        cfg = SOURCES[key]
        print(f"\n[fetch] {key} ({REPO})")
        presets = fetch_source(key, cfg)
        print(f"  拉取预设: {len(presets)}")
        if not presets:
            result["sources"][key] = {"fetched": 0, "added": 0, "skipped": 0, "thumbs": 0}
            continue

        # 缩略图
        n_thumb = 0
        if not skip_thumbs:
            n_thumb = download_thumbnails(key, presets, cfg, skip=skip_thumbs)
            print(f"  缩略图: {n_thumb}")

        # 合并
        if dry_run:
            added = len(presets)
            skipped = 0
        else:
            added, skipped = merge_into(data, key, cfg, presets)
        print(f"  合并: 新增 {added}, 跳过 {skipped}")

        result["sources"][key] = {
            "fetched": len(presets),
            "added": added,
            "skipped": skipped,
            "thumbs": n_thumb,
        }
        result["total_added"] += added
        result["total_skipped"] += skipped
        result["total_thumbs"] += n_thumb

    if not dry_run:
        save_presets(data)
        print(f"\n[OK] 已写入 {TARGET_FILE}")
    else:
        print(f"\n[dry-run] 未写文件")

    return result


# ============================================================
# CLI
# ============================================================
def main(argv: Optional[List[str]] = None) -> int:
    import argparse
    p = argparse.ArgumentParser(description="Fooocus 风格包导入器")
    p.add_argument("--sources", nargs="+", help=f"要导入的源: {list(SOURCES.keys())}")
    p.add_argument("--dry-run", action="store_true", help="预览模式，不写文件")
    p.add_argument("--skip-thumbs", action="store_true", help="不下载缩略图")
    p.add_argument("--list", action="store_true", help="列出所有源")
    args = p.parse_args(argv)

    if args.list:
        print("可用源:")
        for k, v in SOURCES.items():
            print(f"  {k:15s}  {v['name']:20s}  {v['repo']}")
        return 0

    r = import_fooocus_styles(
        sources=args.sources,
        dry_run=args.dry_run,
        skip_thumbs=args.skip_thumbs,
    )
    return 0 if r["success"] else 1


if __name__ == "__main__":
    sys.exit(main())
