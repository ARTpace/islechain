"""
dedupe_styles.analyze
=====================

7 类重复 / 异常 / 完整性分析。所有函数纯函数，不修改原数据。
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Any, Tuple, Optional

from .config import DedupeConfig
from .io_utils import find_orphan_thumbnails, collect_referenced_thumbnails, scan_thumbnail_files


# ============================================================
# 内部工具
# ============================================================
def _normalize_prompt(prompt: str, placeholders: tuple) -> str:
    """去掉占位符并 strip"""
    p = (prompt or "").strip()
    for ph in placeholders:
        p = p.replace(ph, "")
    return p.strip()


def _preset_hash_key(preset: Dict[str, Any], placeholders: tuple) -> str:
    """计算 preset 的 (prompt + neg_prompt) 归一化 hash"""
    p = _normalize_prompt(preset.get("prompt", ""), placeholders)
    n = (preset.get("negative_prompt") or "").strip()
    raw = f"{p}|{n}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def _count_presets(cat: Dict[str, Any]) -> int:
    return sum(len(s.get("presets", [])) for s in cat.get("subcategories", []))


def _iter_presets(data: Dict[str, Any]):
    """(cat, sub, p_idx, preset) 生成器"""
    for cat in data.get("categories", []):
        for sub in cat.get("subcategories", []):
            for p_idx, p in enumerate(sub.get("presets", [])):
                yield cat, sub, p_idx, p


# ============================================================
# 各类分析
# ============================================================
def find_duplicate_categories(data: Dict[str, Any], cfg: DedupeConfig) -> List[Dict[str, Any]]:
    """按 id 找出重复分类"""
    seen: Dict[str, int] = {}
    duplicates: List[Dict[str, Any]] = []
    for idx, cat in enumerate(data.get("categories", [])):
        cid = cat.get("id", "")
        if not cid or cid in cfg.ignore_cat_ids:
            continue
        if cid in seen:
            duplicates.append({
                "id": cid,
                "first_index": seen[cid],
                "first_name": data["categories"][seen[cid]].get("name"),
                "dup_index": idx,
                "dup_name": cat.get("name"),
                "first_count": _count_presets(data["categories"][seen[cid]]),
                "dup_count": _count_presets(cat),
            })
        else:
            seen[cid] = idx
    return duplicates


def find_same_name_categories(data: Dict[str, Any], cfg: DedupeConfig) -> List[Tuple[int, int, str]]:
    """id 不同但 name 相同的分类"""
    name_to_idx: Dict[str, int] = {}
    duplicates: List[Tuple[int, int, str]] = []
    for idx, cat in enumerate(data.get("categories", [])):
        name = (cat.get("name") or "").strip()
        if not name:
            continue
        if name in name_to_idx:
            duplicates.append((name_to_idx[name], idx, name))
        else:
            name_to_idx[name] = idx
    return duplicates


def find_duplicate_presets(data: Dict[str, Any], cfg: DedupeConfig) -> List[Dict[str, Any]]:
    """按 id 找出重复 preset（可能跨分类）"""
    seen: Dict[str, Dict[str, Any]] = {}
    duplicates: List[Dict[str, Any]] = []
    for cat, sub, p_idx, p in _iter_presets(data):
        pid = p.get("id", "")
        if not pid or pid in cfg.ignore_preset_ids:
            continue
        loc = f"{cat.get('id')}/{sub.get('id')}#{p_idx}"
        if pid in seen:
            duplicates.append({
                "id": pid,
                "first_loc": seen[pid]["loc"],
                "dup_loc": loc,
                "first_name": seen[pid]["name"],
                "dup_name": p.get("name"),
            })
        else:
            seen[pid] = {"name": p.get("name"), "loc": loc}
    return duplicates


def find_duplicate_preset_names_within_subcat(
    data: Dict[str, Any], cfg: DedupeConfig
) -> List[Dict[str, Any]]:
    """同一子分类内 name 重复的 preset"""
    duplicates: List[Dict[str, Any]] = []
    for cat in data.get("categories", []):
        for sub in cat.get("subcategories", []):
            name_to_idx: Dict[str, int] = {}
            for p_idx, p in enumerate(sub.get("presets", [])):
                name = (p.get("name") or "").strip()
                if not name:
                    continue
                if name in name_to_idx:
                    duplicates.append({
                        "name": name,
                        "sub_loc": f"{cat.get('id')}/{sub.get('id')}",
                        "first_idx": name_to_idx[name],
                        "dup_idx": p_idx,
                        "first_id": sub["presets"][name_to_idx[name]].get("id"),
                        "dup_id": p.get("id"),
                    })
                else:
                    name_to_idx[name] = p_idx
    return duplicates


def find_duplicate_prompts(data: Dict[str, Any], cfg: DedupeConfig) -> List[Dict[str, Any]]:
    """prompt + negative_prompt 联合归一化 hash 相同的 preset"""
    groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for cat, sub, p_idx, p in _iter_presets(data):
        key = _preset_hash_key(p, cfg.prompt_placeholders)
        if not _normalize_prompt(p.get("prompt", ""), cfg.prompt_placeholders):
            continue
        groups[key].append({
            "loc": f"{cat.get('id')}/{sub.get('id')}#{p_idx}",
            "name": p.get("name"),
            "id": p.get("id"),
            "prompt_preview": _normalize_prompt(p.get("prompt", ""), cfg.prompt_placeholders)[:60],
        })
    return [
        {"hash": h, "refs": refs}
        for h, refs in groups.items()
        if len(refs) > 1
    ]


def find_empty_categories(data: Dict[str, Any], cfg: DedupeConfig) -> List[Dict[str, Any]]:
    """空分类 / 空子分类 / 缺 ID"""
    issues: List[Dict[str, Any]] = []
    for cat in data.get("categories", []):
        subs = cat.get("subcategories", [])
        if not subs:
            issues.append({
                "type": "empty_cat_no_sub",
                "id": cat.get("id"),
                "name": cat.get("name"),
            })
            continue
        if not cat.get("id"):
            issues.append({"type": "cat_no_id", "id": "?", "name": cat.get("name")})
        for sub in subs:
            if not sub.get("presets"):
                issues.append({
                    "type": "empty_subcat",
                    "id": f"{cat.get('id')}/{sub.get('id')}",
                    "name": sub.get("name"),
                })
            if not sub.get("id"):
                issues.append({
                    "type": "subcat_no_id",
                    "id": f"{cat.get('id')}/?",
                    "name": sub.get("name"),
                })
    return issues


def find_orphan_thumbnails_in(data: Dict[str, Any], cfg: DedupeConfig) -> List[Path]:
    """未被 preset 缩略图引用的文件"""
    return find_orphan_thumbnails(cfg, data)


# ============================================================
# 总体统计
# ============================================================
@dataclass
class StyleStats:
    cat_count: int = 0
    subcat_count: int = 0
    preset_count: int = 0
    with_thumb: int = 0

    @property
    def thumb_coverage(self) -> float:
        if self.preset_count == 0:
            return 0.0
        return self.with_thumb * 100.0 / self.preset_count


def compute_stats(data: Dict[str, Any]) -> StyleStats:
    stats = StyleStats(cat_count=len(data.get("categories", [])))
    for cat in data.get("categories", []):
        for sub in cat.get("subcategories", []):
            stats.subcat_count += 1
            for p in sub.get("presets", []):
                stats.preset_count += 1
                if p.get("thumbnail"):
                    stats.with_thumb += 1
    return stats


# ============================================================
# 报告数据
# ============================================================
@dataclass
class Report:
    stats: StyleStats = field(default_factory=StyleStats)
    dup_cat_ids: List[Dict[str, Any]] = field(default_factory=list)
    dup_cat_names: List[Tuple[int, int, str]] = field(default_factory=list)
    dup_preset_ids: List[Dict[str, Any]] = field(default_factory=list)
    dup_preset_names: List[Dict[str, Any]] = field(default_factory=list)
    dup_prompts: List[Dict[str, Any]] = field(default_factory=list)
    empty_issues: List[Dict[str, Any]] = field(default_factory=list)
    orphan_thumbs: List[Path] = field(default_factory=list)

    @property
    def total_issues(self) -> int:
        return (
            len(self.dup_cat_ids)
            + len(self.dup_cat_names)
            + len(self.dup_preset_ids)
            + len(self.dup_preset_names)
            + len(self.dup_prompts)
            + len(self.empty_issues)
            + len(self.orphan_thumbs)
        )

    @property
    def is_clean(self) -> bool:
        return self.total_issues == 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stats": {
                "cat_count": self.stats.cat_count,
                "subcat_count": self.stats.subcat_count,
                "preset_count": self.stats.preset_count,
                "with_thumb": self.stats.with_thumb,
                "thumb_coverage_pct": round(self.stats.thumb_coverage, 1),
            },
            "dup_cat_ids": self.dup_cat_ids,
            "dup_cat_names": [list(t) for t in self.dup_cat_names],
            "dup_preset_ids": self.dup_preset_ids,
            "dup_preset_names": self.dup_preset_names,
            "dup_prompts": self.dup_prompts,
            "empty_issues": self.empty_issues,
            "orphan_thumbs": [str(p) for p in self.orphan_thumbs],
            "total_issues": self.total_issues,
            "is_clean": self.is_clean,
        }


def analyze_all(data: Dict[str, Any], cfg: DedupeConfig) -> Report:
    """一次性收集所有分析结果"""
    return Report(
        stats=compute_stats(data),
        dup_cat_ids=find_duplicate_categories(data, cfg),
        dup_cat_names=find_same_name_categories(data, cfg),
        dup_preset_ids=find_duplicate_presets(data, cfg),
        dup_preset_names=find_duplicate_preset_names_within_subcat(data, cfg),
        dup_prompts=find_duplicate_prompts(data, cfg),
        empty_issues=find_empty_categories(data, cfg),
        orphan_thumbs=find_orphan_thumbnails_in(data, cfg),
    )
