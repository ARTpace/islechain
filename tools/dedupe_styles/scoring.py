"""
dedupe_styles.scoring
=====================

字段加权评分与最佳条目选择。
"""
from __future__ import annotations

from typing import Dict, List, Any

from .config import DedupeConfig


def score_preset(preset: Dict[str, Any], cfg: DedupeConfig) -> float:
    """
    根据配置的字段权重计算 preset 完整度得分。
    字段存在且非空计分，权重越大分值越高。
    """
    total = 0.0
    for field, weight in cfg.field_weights.items():
        value = preset.get(field)
        if value and str(value).strip():
            total += weight
    # 额外奖励: prompt 长度越长通常信息越丰富
    prompt = (preset.get("prompt") or "").strip()
    if prompt:
        # 长度归一化: 100 字符以内线性，满 200 字符封顶
        total += min(len(prompt) / 200.0, 1.0) * 0.5
    return total


def choose_winner(
    candidates: List[Any],
    cfg: DedupeConfig,
    strategy: str = "best",
) -> int:
    """
    从一组候选 preset 中选出保留的索引。
    strategy: 'first' | 'best'
    """
    if not candidates:
        return -1
    if strategy == "first":
        return 0
    # best: 最高分
    best_idx = 0
    best_score = -1.0
    for i, p in enumerate(candidates):
        s = score_preset(p, cfg)
        if s > best_score:
            best_score = s
            best_idx = i
    return best_idx


def is_better(a: Dict[str, Any], b: Dict[str, Any], cfg: DedupeConfig) -> bool:
    """a 是否比 b 更完整"""
    return score_preset(a, cfg) > score_preset(b, cfg)
