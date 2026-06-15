"""
dedupe_styles.operations
========================

实际修改数据的清理操作。所有操作都返回 ChangeTracker 用于报告。

操作:
  - merge_duplicate_categories()
  - dedupe_presets_by_id()
  - dedupe_presets_by_prompt()
  - remove_empty_subcats()
  - remove_empty_categories()
  - apply_all()                  # 编排所有操作
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Tuple

from .config import DedupeConfig
from .scoring import choose_winner, score_preset


# ============================================================
# 变更跟踪
# ============================================================
@dataclass
class ChangeTracker:
    dup_cats_merged: int = 0
    dup_presets_removed: int = 0
    dup_prompts_removed: int = 0
    empty_subs_removed: int = 0
    empty_cats_removed: int = 0
    orphans_removed: int = 0
    preset_merged_neg_prompts: int = 0
    # 详细变更日志
    details: List[Dict[str, Any]] = field(default_factory=list)

    def add(self, action: str, **kwargs):
        self.details.append({"action": action, **kwargs})

    def to_dict(self) -> Dict[str, Any]:
        return {
            "dup_cats_merged": self.dup_cats_merged,
            "dup_presets_removed": self.dup_presets_removed,
            "dup_prompts_removed": self.dup_prompts_removed,
            "empty_subs_removed": self.empty_subs_removed,
            "empty_cats_removed": self.empty_cats_removed,
            "orphans_removed": self.orphans_removed,
            "preset_merged_neg_prompts": self.preset_merged_neg_prompts,
            "details_count": len(self.details),
        }


# ============================================================
# 合并重复分类（按 id）
# ============================================================
def merge_duplicate_categories(
    data: Dict[str, Any],
    cfg: DedupeConfig,
    tracker: Optional[ChangeTracker] = None,
) -> int:
    """合并 id 重复的分类（保留更完整的 name 与更多 presets）"""
    seen: Dict[str, Dict[str, Any]] = {}
    new_cats: List[Dict[str, Any]] = []
    removed = 0
    for cat in data.get("categories", []):
        cid = cat.get("id", "")
        if not cid or cid in cfg.ignore_cat_ids:
            new_cats.append(cat)
            continue
        if cid in seen:
            existing = seen[cid]
            # 合并子分类
            existing["subcategories"].extend(cat.get("subcategories", []))
            # name 取更长的
            if len(cat.get("name", "")) > len(existing.get("name", "")):
                existing["name"] = cat["name"]
            removed += 1
            if tracker:
                tracker.add("merge_cat", id=cid, dup_name=cat.get("name"))
        else:
            seen[cid] = cat
            new_cats.append(cat)
    data["categories"] = new_cats
    if tracker:
        tracker.dup_cats_merged = removed
    return removed


# ============================================================
# 按 id 去重 preset
# ============================================================
def dedupe_presets_by_id(
    data: Dict[str, Any],
    cfg: DedupeConfig,
    strategy: str = "best",
    tracker: Optional[ChangeTracker] = None,
) -> int:
    """跨子分类按 id 去重，best 策略保留字段最全的版本"""
    seen: Dict[str, Dict[str, Any]] = {}
    removed = 0
    for cat in data.get("categories", []):
        for sub in cat.get("subcategories", []):
            new_presets: List[Dict[str, Any]] = []
            for p in sub.get("presets", []):
                pid = p.get("id", "")
                if not pid or pid in cfg.ignore_preset_ids:
                    new_presets.append(p)
                    continue
                if pid in seen:
                    # 决策
                    if strategy == "best" and score_preset(p, cfg) > score_preset(seen[pid], cfg):
                        for i, q in enumerate(new_presets):
                            if q.get("id") == pid:
                                new_presets[i] = p
                                seen[pid] = p
                                break
                    removed += 1
                    if tracker:
                        tracker.add("dedupe_preset_id", id=pid)
                else:
                    seen[pid] = p
                    new_presets.append(p)
            sub["presets"] = new_presets
    if tracker:
        tracker.dup_presets_removed = removed
    return removed


# ============================================================
# 按 prompt 去重 preset
# ============================================================
def dedupe_presets_by_prompt(
    data: Dict[str, Any],
    cfg: DedupeConfig,
    strategy: str = "best",
    tracker: Optional[ChangeTracker] = None,
    merge_negative_prompt: bool = True,
) -> int:
    """
    按 (prompt + negative_prompt) 联合 hash 去重。
    可选: 合并时把多条的 negative_prompt 取并集（应对微小差异）。
    """
    # 第一遍：分组
    groups: Dict[str, List[Tuple[str, str, int, Dict[str, Any]]]] = defaultdict(list)
    for cat in data.get("categories", []):
        for sub in cat.get("subcategories", []):
            for p_idx, p in enumerate(sub.get("presets", [])):
                prompt = (p.get("prompt") or "").strip()
                # 归一化
                norm = prompt
                for ph in cfg.prompt_placeholders:
                    norm = norm.replace(ph, "")
                norm = norm.strip()
                if not norm:
                    continue
                neg = (p.get("negative_prompt") or "").strip()
                key = hashlib.md5(f"{norm}|{neg}".encode("utf-8")).hexdigest()
                groups[key].append((cat["id"], sub["id"], p_idx, p))

    duplicates = [(k, refs) for k, refs in groups.items() if len(refs) > 1]
    if not duplicates:
        if tracker:
            tracker.dup_prompts_removed = 0
        return 0

    # 决策保留
    keep_map: Dict[Tuple[str, str, int], bool] = {}
    merge_negs: Dict[Tuple[str, str, int], List[str]] = {}  # 胜出者 -> 所有 neg_prompts
    for key, refs in duplicates:
        winner_idx = choose_winner([r[3] for r in refs], cfg, strategy)
        winner_ref = refs[winner_idx]
        # 记录所有 negative_prompt 用于合并
        if merge_negative_prompt:
            all_negs = [
                (r[3].get("negative_prompt") or "").strip()
                for r in refs
                if (r[3].get("negative_prompt") or "").strip()
            ]
            if len(set(all_negs)) > 1:
                merge_negs[(winner_ref[0], winner_ref[1], winner_ref[2])] = all_negs
        for i, ref in enumerate(refs):
            keep_map[(ref[0], ref[1], ref[2])] = (i == winner_idx)

    # 第二遍：重建
    removed = 0
    for cat in data.get("categories", []):
        for sub in cat.get("subcategories", []):
            new_presets: List[Dict[str, Any]] = []
            for p_idx, p in enumerate(sub.get("presets", [])):
                key = (cat["id"], sub["id"], p_idx)
                if keep_map.get(key, True):
                    # 合并 negative_prompt
                    if merge_negative_prompt and key in merge_negs:
                        union_tokens = set()
                        for neg in merge_negs[key]:
                            for tok in neg.split(","):
                                t = tok.strip()
                                if t:
                                    union_tokens.add(t)
                        if union_tokens:
                            p["negative_prompt"] = ", ".join(sorted(union_tokens))
                            if tracker:
                                tracker.preset_merged_neg_prompts += 1
                                tracker.add(
                                    "merge_neg_prompt",
                                    cat=cat["id"],
                                    sub=sub["id"],
                                    preset_id=p.get("id"),
                                )
                    new_presets.append(p)
                else:
                    removed += 1
                    if tracker:
                        tracker.add(
                            "dedupe_preset_prompt",
                            id=p.get("id"),
                            cat=cat["id"],
                            sub=sub["id"],
                        )
            sub["presets"] = new_presets
    if tracker:
        tracker.dup_prompts_removed = removed
    return removed


# ============================================================
# 移除空子分类 / 空分类
# ============================================================
def remove_empty_subcats(
    data: Dict[str, Any],
    cfg: DedupeConfig,
    tracker: Optional[ChangeTracker] = None,
) -> int:
    removed = 0
    for cat in data.get("categories", []):
        new_subs: List[Dict[str, Any]] = []
        for sub in cat.get("subcategories", []):
            if sub.get("presets"):
                new_subs.append(sub)
            else:
                removed += 1
                if tracker:
                    tracker.add("remove_empty_sub", id=f"{cat.get('id')}/{sub.get('id')}")
        cat["subcategories"] = new_subs
    if tracker:
        tracker.empty_subs_removed = removed
    return removed


def remove_empty_categories(
    data: Dict[str, Any],
    cfg: DedupeConfig,
    tracker: Optional[ChangeTracker] = None,
) -> int:
    removed = 0
    new_cats: List[Dict[str, Any]] = []
    for cat in data.get("categories", []):
        if cat.get("subcategories"):
            new_cats.append(cat)
        else:
            removed += 1
            if tracker:
                tracker.add("remove_empty_cat", id=cat.get("id"))
    data["categories"] = new_cats
    if tracker:
        tracker.empty_cats_removed = removed
    return removed


# ============================================================
# 编排
# ============================================================
def apply_all(
    data: Dict[str, Any],
    cfg: DedupeConfig,
    strategy: str = "best",
    dedupe_prompts: bool = False,
    tracker: Optional[ChangeTracker] = None,
) -> ChangeTracker:
    """按推荐顺序执行所有清理操作"""
    tracker = tracker or ChangeTracker()
    # 1. 合并重复分类
    merge_duplicate_categories(data, cfg, tracker)
    # 2. 按 id 去重 preset
    dedupe_presets_by_id(data, cfg, strategy, tracker)
    # 3. 按 prompt 去重（可选）
    if dedupe_prompts:
        dedupe_presets_by_prompt(data, cfg, strategy, tracker)
    # 4. 移除空子分类
    remove_empty_subcats(data, cfg, tracker)
    # 5. 移除空分类
    remove_empty_categories(data, cfg, tracker)
    return tracker
