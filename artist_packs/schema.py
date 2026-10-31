"""画师数据的规范化：源条目 -> 索引条目。

两种来源都要能处理：
    1. 官方 search.json    slug / tag / imageId / postCount / hasImage
    2. 老单文件 artist_data.js   id / name / post_count / image_url / danbooru_tag

统一成四个字段，体积和语义都最小：
    id     稳定标识，等于源数据的 slug，同时是 Danbooru 的 tag 主体
    tag    画师提示词，形如 @dairi，直接粘进提示词即可生效
    posts  投稿数，用于分档与排序
    img    图片 id（不是完整 URL，前缀在 index.json 顶层统一给）

`name` 不再单独保存 —— 实测 100% 可以由 tag 去掉开头的 @ 得到，
而 name 和 tag 的差异只有少量下划线/空格的写法差别，展示时按 tag 处理即可。
"""

from typing import Dict, Iterable, List


def _to_int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def normalize_artist(raw: dict) -> dict:
    """任意来源的一条画师数据 -> 索引条目；无法识别返回空 dict。"""
    if not isinstance(raw, dict):
        return {}

    tag = str(raw.get("tag") or raw.get("danbooru_tag") or "").strip()
    slug = str(raw.get("slug") or raw.get("id") or "").strip()
    if not slug and tag:
        slug = tag.lstrip("@")
    if not slug:
        return {}

    entry = {
        "id": slug,
        "tag": tag or ("@" + slug),
        "posts": _to_int(raw.get("postCount") if "postCount" in raw else raw.get("post_count")),
    }

    # 官方数据给的是 imageId；老单文件给的是完整 image_url
    image_url = str(raw.get("image_url") or raw.get("imageUrl") or "").strip()
    image_id = str(raw.get("imageId") or "").strip()
    if image_id:
        entry["img"] = image_id
    elif image_url:
        entry["url"] = image_url  # 完整地址直接存，合并时原样下发

    if raw.get("hasImage") is False:
        entry.pop("img", None)
        entry.pop("url", None)
    return entry


def split_artists(artists: Iterable[dict]) -> List[dict]:
    """把一组画师规范化成索引条目，按 id 去重并保持首次出现的顺序。

    官方 search.json 里存在少量重复 slug（42197 条 / 42189 个唯一 id），
    重复的只留第一条，避免同一画师在选择器里出现两次。
    """
    items: List[dict] = []
    seen = set()
    for raw in artists or []:
        entry = normalize_artist(raw)
        aid = entry.get("id")
        if not aid or aid in seen:
            continue
        seen.add(aid)
        items.append(entry)
    return items


def dedupe_stats(artists: Iterable[dict]) -> Dict:
    """给拆包工具用的统计：原始条数、去重后条数、重复数。"""
    total = 0
    seen = set()
    for raw in artists or []:
        total += 1
        entry = normalize_artist(raw)
        if entry.get("id"):
            seen.add(entry["id"])
    return {"raw": total, "unique": len(seen), "duplicated": total - len(seen)}
