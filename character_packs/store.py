"""角色包的发现、索引合并与详情读取。

前端的调用路径只有两条：
    merged_index()   一次拿到所有已装包的索引（默认缓存，包有变动才重算）
    get_detail(id)   点开某个角色时读一个分片，分片内容按文件缓存

没有任何角色包时回退读老单文件（static/app/characters.json），
保证升级瞬间不会出现"角色全没了"。
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
    INDEX_FILE,
    KIND,
    LEGACY_CHARACTERS_FILE,
    REQUIRED_FILES,
    USER_PACKS_DIR,
    detail_filename,
    detail_shard_of,
)
from .schema import split_characters

_index_cache: Dict = {"sig": None, "payload": None}
_index_by_id: Dict[str, dict] = {}
_detail_cache: Dict = {"sig": None, "files": {}, "legacy": {}}


def _read_json(path) -> Optional[dict]:
    try:
        with io.open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        print("[character_packs] 读取失败 %s：%s" % (path, exc))
        return None


def discover_packs() -> List[ContentManifest]:
    """扫描内置与用户两个目录（内置优先）。"""
    return _discover(
        ((BUILTIN_PACKS_DIR, True), (USER_PACKS_DIR, False)),
        kind=KIND,
        log_tag="character_packs",
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
    if LEGACY_CHARACTERS_FILE.is_file():
        stamps.append(("legacy", os.path.getmtime(LEGACY_CHARACTERS_FILE)))
    return tuple(stamps)


def _load_legacy() -> Dict:
    """老单文件：整份读进来拆成索引与详情，仅在没有任何包时使用。"""
    data = _read_json(LEGACY_CHARACTERS_FILE) or {}
    characters = data.get("characters") if isinstance(data, dict) else data
    items, shards = split_characters(characters or [])
    return {"items": items, "shards": shards, "version": (data or {}).get("version", "")}


def merged_index(force: bool = False) -> Dict:
    """合并所有已装包的索引，返回给前端。"""
    global _index_by_id

    sig = _signature()
    if not force and _index_cache["sig"] == sig and _index_cache["payload"] is not None:
        return _index_cache["payload"]

    packs = discover_packs()
    items: List[dict] = []
    seen = set()
    pack_info = []
    for pack in packs:
        path = pack.file_of("index")
        if not path:
            print("[character_packs] 包 %s 缺少索引文件，已跳过" % pack.pack_id)
            continue
        data = _read_json(path) or {}
        got = 0
        for entry in data.get("items") or []:
            cid = entry.get("id")
            if not cid or cid in seen:
                continue
            seen.add(cid)
            items.append(entry)
            got += 1
        pack_info.append({
            "packId": pack.pack_id,
            "name": pack.name,
            "version": pack.version,
            "builtin": pack.builtin,
            "order": pack.order,
            "count": got,
        })

    legacy = False
    if not packs and LEGACY_CHARACTERS_FILE.is_file():
        items = _load_legacy()["items"]
        legacy = True
        print("[character_packs] 未发现角色包，回退读取老单文件（%d 条）" % len(items))

    payload = {
        "items": items,
        "count": len(items),
        "packs": pack_info,
        "legacy": legacy,
    }
    _index_cache["sig"] = sig
    _index_cache["payload"] = payload
    _index_by_id = {e["id"]: e for e in items if e.get("id")}
    return payload


def index_entry(char_id: str) -> Optional[dict]:
    """按 id 取索引条目（详情接口用来补齐名称等信息）。"""
    merged_index()
    return _index_by_id.get(str(char_id or "").strip())


def get_detail(char_id: str) -> Optional[dict]:
    """按 id 取详情（tags / 大图 / 出处）。找不到返回 None。"""
    cid = str(char_id or "").strip()
    if not cid:
        return None

    sig = _signature()
    if _detail_cache["sig"] != sig:
        _detail_cache["sig"] = sig
        _detail_cache["files"].clear()
        _detail_cache["legacy"] = {}

    shard = detail_shard_of(cid)
    for pack in discover_packs():
        path = Path(pack.path or "") / detail_filename(shard)
        if not path.is_file():
            continue
        key = str(path)
        data = _detail_cache["files"].get(key)
        if data is None:
            data = _read_json(path) or {}
            _detail_cache["files"][key] = data
        entry = data.get(cid)
        if entry:
            return dict(entry, id=cid)

    # 回退：老单文件
    if not discover_packs() and LEGACY_CHARACTERS_FILE.is_file():
        legacy = _detail_cache["legacy"]
        if not legacy:
            legacy.update(_load_legacy()["shards"].get(shard) or {})
        entry = legacy.get(cid)
        if entry:
            return dict(entry, id=cid)
    return None


def stats() -> Dict:
    """给资产库/自检用的概览。"""
    payload = merged_index()
    return {
        "count": payload["count"],
        "packs": payload["packs"],
        "legacy": payload["legacy"],
        "userDir": str(USER_PACKS_DIR),
        "builtinDir": str(BUILTIN_PACKS_DIR),
    }


def version_token() -> str:
    """索引版本令牌（ETag 用）：包有变动就变，前端据此走 304。"""
    import hashlib

    raw = repr(_signature()).encode("utf-8", "ignore")
    return '"' + hashlib.sha1(raw).hexdigest()[:16] + '"'
