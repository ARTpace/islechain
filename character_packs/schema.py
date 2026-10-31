"""角色数据在「索引层 / 详情层」之间的拆分与还原。

索引层只留搜索与列表要用的字段，详情层留重字段。两层按 id 一一对应，
merge_back() 可以把它们还原成接近原始结构，用于校验拆分无损。
"""

from typing import Dict, Iterable, List, Tuple

from .paths import (
    DETAIL_FIELDS,
    detail_shard_of,
    thumb_url_of,
)


def normalize_id(char: dict) -> str:
    """角色唯一 id：优先用源数据的 slug，缺失时由 name 规范化生成。"""
    cid = str(char.get("id") or char.get("slug") or "").strip()
    if cid:
        return cid
    name = str(char.get("name") or "").strip().lower()
    return name.replace(" ", "_")


def feature_labels(tags, feature_map) -> List[str]:
    """把 tags 按映射表折成中文特征名（去重保序）。

    映射表来自 data/character-features.json，前后端共用一份，
    所以新增特征只需要改配置，不用改代码。
    """
    if not feature_map:
        return []
    labels: List[str] = []
    seen = set()
    for tag in tags or []:
        label = feature_map.get(str(tag).lower().strip())
        if label and label not in seen:
            seen.add(label)
            labels.append(label)
    return labels


def to_index_entry(char: dict, feature_map=None) -> dict:
    """源条目 -> 索引条目（薄）。"""
    cid = normalize_id(char)
    trigger = str(char.get("trigger") or "")
    entry = {
        "id": cid,
        "name": str(char.get("name") or cid),
        "copyright": str(char.get("copyright") or ""),
        "post_count": int(char.get("post_count") or 0),
        "gender": str(char.get("gender") or ""),
        "hair": str(char.get("hair") or ""),
        "eye": str(char.get("eye") or ""),
        "trigger": trigger,
    }
    # 绝大多数缩略图可由 trigger 推导；对不上的少数才落一个覆盖值
    thumb = str(char.get("thumb_url") or "")
    if thumb and thumb != thumb_url_of(trigger):
        entry["thumb"] = thumb
    # 预计算特征，索引层因此不必保留完整 tags
    labels = feature_labels(char.get("tags"), feature_map)
    if labels:
        entry["feat"] = labels
    return entry


def to_detail_entry(char: dict) -> dict:
    """源条目 -> 详情条目（重）。"""
    return {
        "tags": list(char.get("tags") or []),
        "img_url": str(char.get("img_url") or ""),
        "danbooru_url": str(char.get("danbooru_url") or ""),
    }


def split_characters(characters: Iterable[dict], feature_map=None):
    """把一组角色拆成 (索引条目列表, {分片名: {id: 详情}})。

    同 id 只保留第一次出现，避免不同数据集重叠时重复计数。
    """
    items: List[dict] = []
    shards: Dict[str, Dict[str, dict]] = {}
    seen = set()
    for char in characters:
        if not isinstance(char, dict):
            continue
        cid = normalize_id(char)
        if not cid or cid in seen:
            continue
        seen.add(cid)
        items.append(to_index_entry(char, feature_map))
        shard = detail_shard_of(cid)
        shards.setdefault(shard, {})[cid] = to_detail_entry(char)
    return items, shards


def merge_back(items: Iterable[dict], shards: Dict[str, Dict[str, dict]]) -> List[dict]:
    """索引 + 详情还原成完整条目，用于校验拆分可逆。"""
    merged: List[dict] = []
    for entry in items:
        cid = entry.get("id")
        detail = shards.get(detail_shard_of(cid), {}).get(cid) or {}
        head = {key: entry.get(key) for key in
                ("name", "copyright", "post_count", "gender", "hair", "eye", "trigger")}
        head["slug"] = cid
        head["thumb_url"] = entry.get("thumb") or thumb_url_of(entry.get("trigger"))
        for key in DETAIL_FIELDS:
            head[key] = detail.get(key)
        merged.append(head)
    return merged
