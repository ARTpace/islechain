"""画师包的发现、索引合并与图片地址解析。

前端的调用路径只有两条：
    merged_index()   一次拿到所有已装包的索引（带缓存，包有变动才重算）
    image_url_of()   把条目里的 img 拼成完整图片地址

没有任何画师包时回退读老单文件 static/app/artist_data.js，
保证升级瞬间不会出现"画师全没了"。

图片地址的合并规则：以排在最前的包（内置种子优先）的 imageBase 为准；
若某个包的 imageBase 与之不同（例如用户自建包用了别的图床），
就把该包的条目从"img 后缀"降级成"url 完整地址"，保证地址始终正确。
"""

import io
import json
import os
from pathlib import Path
from typing import Dict, List, Optional

from content_packs.manifest import ContentManifest
from content_packs.scanner import discover as _discover

from .paths import (
    BUILTIN_PACKS_DIR,
    DEFAULT_IMAGE_BASE,
    DEFAULT_IMAGE_EXT,
    INDEX_FILE,
    KIND,
    LEGACY_ARTISTS_FILE,
    REQUIRED_FILES,
    USER_PACKS_DIR,
    image_url_of,
    tier_of,
)
from .schema import split_artists

_index_cache: Dict = {"sig": None, "payload": None}
_index_by_id: Dict[str, dict] = {}
_index_by_tag: Dict[str, dict] = {}


def _read_json(path) -> Optional[dict]:
    try:
        with io.open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        print("[artist_packs] 读取失败 %s：%s" % (path, exc))
        return None


def discover_packs() -> List[ContentManifest]:
    """扫描内置与用户两个目录（内置优先）。"""
    return _discover(
        ((BUILTIN_PACKS_DIR, True), (USER_PACKS_DIR, False)),
        kind=KIND,
        log_tag="artist_packs",
        required_files=REQUIRED_FILES,
    )


def _signature():
    """包目录与索引文件的 mtime 快照，任何增删改都会让它变化。"""
    stamps = []
    for root in (BUILTIN_PACKS_DIR, USER_PACKS_DIR):
        if not root.is_dir():
            continue
        try:
            stamps.append((str(root), os.path.getmtime(root)))
        except OSError:
            pass
        for child in sorted(root.iterdir()):
            if not child.is_dir():
                continue
            try:
                stamps.append((child.name, os.path.getmtime(child)))
            except OSError:
                continue
            index = child / INDEX_FILE
            if index.is_file():
                stamps.append((child.name + "/index", os.path.getmtime(index)))
    if LEGACY_ARTISTS_FILE.is_file():
        stamps.append(("legacy", os.path.getmtime(LEGACY_ARTISTS_FILE)))
    return tuple(stamps)


def _load_legacy() -> List[dict]:
    """老单文件是 JS 变量形式，取出其中的 JSON 数组再规范化。"""
    try:
        text = LEGACY_ARTISTS_FILE.read_text(encoding="utf-8")
    except Exception as exc:
        print("[artist_packs] 读取老画师文件失败：%s" % exc)
        return []
    start, end = text.find("["), text.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        raw = json.loads(text[start:end + 1])
    except Exception as exc:
        print("[artist_packs] 解析老画师文件失败：%s" % exc)
        return []
    return split_artists(raw)


def _load_pack_index(pack: ContentManifest) -> Optional[dict]:
    path = pack.file_of("index")
    if not path:
        print("[artist_packs] 包 %s 缺少索引文件，已跳过" % pack.pack_id)
        return None
    return _read_json(path) or {}


def merged_index(force: bool = False) -> Dict:
    """合并所有已装包的索引，返回给前端。"""
    global _index_by_id, _index_by_tag

    sig = _signature()
    if not force and _index_cache["sig"] == sig and _index_cache["payload"] is not None:
        return _index_cache["payload"]

    packs = discover_packs()
    items: List[dict] = []
    seen = set()
    pack_info = []
    image_base = ""
    image_ext = DEFAULT_IMAGE_EXT

    for pack in packs:
        data = _load_pack_index(pack)
        if data is None:
            continue
        base = str(data.get("imageBase") or "").strip()
        ext = str(data.get("imageExt") or DEFAULT_IMAGE_EXT).strip()
        if not image_base:
            # 第一个包（内置种子）决定整体地址前缀
            image_base, image_ext = base or DEFAULT_IMAGE_BASE, ext
        same_base = (base or DEFAULT_IMAGE_BASE) == image_base and ext == image_ext

        got = 0
        for entry in data.get("items") or []:
            aid = entry.get("id")
            if not aid or aid in seen:
                continue
            seen.add(aid)
            row = dict(entry)
            if not same_base and row.get("img"):
                # 图床与主前缀不同：降级成完整地址，保证不拼错
                row["url"] = image_url_of(base, row.pop("img"), ext)
            items.append(row)
            got += 1
        pack_info.append({
            "packId": pack.pack_id,
            "name": pack.name,
            "version": pack.version,
            "builtin": pack.builtin,
            "order": pack.order,
            "count": got,
            "imageBase": base or DEFAULT_IMAGE_BASE,
            "dataVersion": pack.data_version,
        })

    legacy = False
    if not items and LEGACY_ARTISTS_FILE.is_file():
        items = _load_legacy()
        legacy = bool(items)
        if items:
            print("[artist_packs] 未发现画师包，回退读取老单文件（%d 条）" % len(items))

    tiers: Dict[str, int] = {}
    for entry in items:
        key = tier_of(entry.get("posts"))
        tiers[key] = tiers.get(key, 0) + 1

    payload = {
        "items": items,
        "count": len(items),
        "packs": pack_info,
        "legacy": legacy,
        "imageBase": image_base or DEFAULT_IMAGE_BASE,
        "imageExt": image_ext,
        "tiers": tiers,
    }
    _index_cache["sig"] = sig
    _index_cache["payload"] = payload
    _index_by_id = {e["id"]: e for e in items if e.get("id")}
    _index_by_tag = {str(e.get("tag") or "").lower(): e for e in items if e.get("tag")}
    return payload


def index_entry(artist_id: str) -> Optional[dict]:
    """按 id 取索引条目。"""
    merged_index()
    return _index_by_id.get(str(artist_id or "").strip())


def find_artist(key: str) -> Optional[dict]:
    """按 id 或 tag 查画师。

    前端可能传 slug（dairi）也可能传提示词（@dairi），两者都要能命中；
    带 @ 的走 tag 索引，不带的先当 id，再补一次 tag 查询兜底。
    """
    text = str(key or "").strip()
    if not text:
        return None
    merged_index()
    entry = _index_by_id.get(text)
    if entry:
        return entry
    entry = _index_by_tag.get(text.lower())
    if entry:
        return entry
    if not text.startswith("@"):
        return _index_by_tag.get("@" + text.lower())
    return None


def entry_image_url(entry: Optional[dict], payload: Optional[dict] = None) -> str:
    """条目的完整图片地址：优先用条目自带 url，否则按包前缀拼。"""
    if not entry:
        return ""
    if entry.get("url"):
        return str(entry["url"])
    data = payload or merged_index()
    return image_url_of(
        data.get("imageBase") or DEFAULT_IMAGE_BASE,
        entry.get("img") or "",
        data.get("imageExt") or DEFAULT_IMAGE_EXT,
    )


def stats() -> Dict:
    """给资产库/自检用的概览。"""
    payload = merged_index()
    return {
        "count": payload["count"],
        "packs": payload["packs"],
        "legacy": payload["legacy"],
        "tiers": payload["tiers"],
        "imageBase": payload["imageBase"],
        "userDir": str(USER_PACKS_DIR),
        "builtinDir": str(BUILTIN_PACKS_DIR),
    }


def version_token() -> str:
    """索引版本令牌（ETag 用）：包有变动就变，前端据此走 304。"""
    import hashlib

    raw = repr(_signature()).encode("utf-8", "ignore")
    return '"' + hashlib.sha1(raw).hexdigest()[:16] + '"'
