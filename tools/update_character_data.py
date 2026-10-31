#!/usr/bin/env python3
"""
AnimaDex 角色数据更新脚本
从 animadex.net 导出 API 下载全量角色数据，生成本地离线数据集。

用法：
  python tools/update_character_data.py              # 下载并生成数据
  python tools/update_character_data.py --check      # 仅检查版本，不下载
  python tools/update_character_data.py --force       # 强制重新下载

输出：
  static/app/characters.json          — 完整数据（前后端单一数据源）
"""

import csv
import io
import json
import sys
import time
from pathlib import Path
from urllib.parse import quote

# ── 配置 ──────────────────────────────────────────────────────────────
BASE_URL = "https://animadex.net"
EXPORT_TOKEN = "IPpCh4IE4iMAVaeuREs4WqiXynSti60pWAxpcd-nXRQ"
VERSION_FILE = Path(__file__).resolve().parent.parent / "data" / "animadex-version.json"
# 单一数据源：前端 anima-character-picker.js 与后端 random_source.py / routers/animadex.py 共用
JSON_OUTPUT = Path(__file__).resolve().parent.parent / "static" / "app" / "characters.json"

# 从 core_tags 提取性别/发色/瞳色的映射
GENDER_MAP = {"1girl": "1girl", "1boy": "1boy"}
HAIR_COLORS = [
    "black", "blonde", "white", "brown", "blue", "pink",
    "red", "purple", "green", "grey", "aqua", "orange",
]
EYE_COLORS = [
    "blue", "red", "brown", "green", "yellow", "purple",
    "pink", "aqua", "orange", "grey", "black", "gold",
]


def _derive_gender(tags: list[str]) -> str:
    for t in tags:
        t_lower = t.strip().lower()
        if t_lower in GENDER_MAP:
            return GENDER_MAP[t_lower]
    return ""


def _derive_hair(tags: list[str]) -> str:
    for t in tags:
        t_lower = t.strip().lower()
        # 匹配 "xxx hair" 模式
        if t_lower.endswith(" hair") and not t_lower.startswith(("multicolored",)):
            color = t_lower.replace(" hair", "").strip()
            if color in HAIR_COLORS:
                return color
    return ""


def _derive_eye(tags: list[str]) -> str:
    for t in tags:
        t_lower = t.strip().lower()
        # 匹配 "xxx eyes" 模式
        if t_lower.endswith(" eyes"):
            color = t_lower.replace(" eyes", "").strip()
            if color in EYE_COLORS:
                return color
    return ""


def _build_thumb_url(trigger: str) -> str:
    """构建缩略图 URL（animadex CDN，特殊字符替换为下划线）"""
    # CDN 文件名中 / 和 : 替换为 _
    fixed = trigger.replace('/', '_').replace(':', '_')
    enc = quote(fixed, safe="()")
    return f"https://blobs.animadex.net/Outputs/thumbs/{enc}.webp"


def _build_img_url(trigger: str) -> str:
    """构建高清图 URL（animadex CDN，特殊字符替换为下划线）"""
    fixed = trigger.replace('/', '_').replace(':', '_')
    enc = quote(fixed, safe="()")
    return f"https://blobs.animadex.net/Outputs/{enc}.png"


def fetch_manifest() -> dict:
    """获取导出清单"""
    import httpx
    r = httpx.get(
        f"{BASE_URL}/api/export/manifest",
        headers={"X-Export-Token": EXPORT_TOKEN},
        timeout=30,
        verify=False,
    )
    r.raise_for_status()
    return r.json()


def check_version(manifest: dict) -> bool:
    """检查版本是否需要更新，返回 True 表示需要更新"""
    new_version = str(manifest.get("version", ""))
    # 版本号相同不代表数据还在：characters.json 已移出版本库，换机器 clone、清理磁盘
    # 都可能让「版本文件在、数据文件没了」。只比版本号会导致永远跳过、数据永远补不回来。
    if not JSON_OUTPUT.exists():
        print("[miss] 本地数据文件不存在，将重新下载")
        return True
    if JSON_OUTPUT.stat().st_size < 1024 * 1024:
        print("[miss] 本地数据文件不完整（<1MB），将重新下载")
        return True
    if VERSION_FILE.exists():
        try:
            with open(VERSION_FILE, "r", encoding="utf-8") as f:
                old = json.load(f)
            if old.get("version") == new_version:
                print(f"[skip] 数据已是最新 (version={new_version})")
                return False
        except Exception:
            pass
    print(f"[update] 发现新版本: {new_version}")
    return True


def save_version(manifest: dict, char_count: int):
    """保存版本信息"""
    VERSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(VERSION_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "version": manifest.get("version"),
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "char_count": char_count,
        }, f, indent=2, ensure_ascii=False)


def download_and_parse() -> list[dict]:
    """下载 CSV 并解析为角色列表"""
    import httpx

    manifest = fetch_manifest()
    csv_url = manifest["csv"]["characters"]
    print(f"[download] 正在下载 {csv_url} ...")

    r = httpx.get(csv_url, timeout=120, verify=False)
    r.raise_for_status()

    reader = csv.DictReader(io.StringIO(r.text))
    characters = []

    for row in reader:
        slug = (row.get("character") or "").strip()
        if not slug:
            continue

        trigger = (row.get("trigger") or "").strip()
        tags_raw = (row.get("core_tags") or "").strip()
        tags = [t.strip() for t in tags_raw.split(",") if t.strip()] if tags_raw else []
        copyright_name = (row.get("copyright") or "").strip()
        count = int(row.get("count") or 0)
        danbooru_url = (row.get("url") or "").strip()

        # 推导字段
        gender = _derive_gender(tags)
        hair = _derive_hair(tags)
        eye = _derive_eye(tags)
        name = slug.replace("_", " ").title()

        # 生成 URL
        thumb_url = _build_thumb_url(trigger) if trigger else ""
        img_url = _build_img_url(trigger) if trigger else ""

        characters.append({
            # 基础字段（兼容现有 picker）
            "name": name,
            "slug": slug,
            "copyright": copyright_name,
            "post_count": count,
            "gender": gender,
            "hair": hair,
            "eye": eye,
            # 新增字段
            "trigger": trigger,
            "tags": tags,
            "thumb_url": thumb_url,
            "img_url": img_url,
            "danbooru_url": danbooru_url,
        })

    print(f"[parse] 共解析 {len(characters)} 个角色")
    return characters


def write_json(characters: list[dict]):
    """写入完整 JSON 数据文件"""
    JSON_OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    with open(JSON_OUTPUT, "w", encoding="utf-8") as f:
        json.dump({
            "version": time.strftime("%Y-%m-%d"),
            "count": len(characters),
            "characters": characters,
        }, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = JSON_OUTPUT.stat().st_size // 1024
    print(f"[write] {JSON_OUTPUT.name} — {len(characters)} chars, {size_kb} KB")


def main():
    force = "--force" in sys.argv
    check_only = "--check" in sys.argv

    try:
        manifest = fetch_manifest()
    except Exception as e:
        print(f"[error] 无法获取导出清单: {e}")
        sys.exit(1)

    if check_only:
        print(f"当前远程版本: {manifest.get('version')}")
        if VERSION_FILE.exists():
            with open(VERSION_FILE, "r", encoding="utf-8") as f:
                local = json.load(f)
            print(f"本地版本: {local.get('version')}")
            print(f"本地角色数: {local.get('char_count')}")
            print(f"更新时间: {local.get('updated_at')}")
            if not JSON_OUTPUT.exists():
                print(f"数据文件: 缺失（{JSON_OUTPUT}）→ 需要下载")
            else:
                print(f"数据文件: 存在 {JSON_OUTPUT.stat().st_size / 1024 / 1024:.1f} MB")
        else:
            print("本地无数据，需要下载")
        return

    if not force and not check_version(manifest):
        return

    characters = download_and_parse()
    if not characters:
        print("[error] 未解析到任何角色数据")
        sys.exit(1)

    write_json(characters)
    save_version(manifest, len(characters))
    print("[done] 数据更新完成 ✓")


if __name__ == "__main__":
    main()
