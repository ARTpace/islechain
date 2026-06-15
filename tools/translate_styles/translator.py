"""风格预设名 → 中文的核心翻译逻辑

算法
----
1. 规范化：小写、保留分隔符
2. 去掉来源前缀（fooocus/sai/mre/mk/diva/...）
3. 优先尝试整串在 DICT 中（最长匹配）
4. 否则按分隔符 [-_/ ] 切分；贪心尝试多段组合
5. 未命中段保持原文
6. 清理：去重相邻空格、修正首尾
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

from .dictionary import DICT, SEPARATORS


# 来源前缀（小写），用于去前缀
# 注意：必须去 prefix 才能命中核心词
# 按长度倒序优先匹配长前缀
SOURCE_PREFIXES = sorted(
    [
        "fooocus",
        "sai",
        "mre",
        "marc_k3nt3l",
        "marc k3nt3l",
        "marc",
        "k3nt3l",
        "diva",
        "twri",
        "ads",
        "artstyle",
        "cinematic",
        "futuristic",
        "game",
        "misc",
        "papercraft",
        "photo",
        "pixel",
        "manga",
        "anime",
        "logo",
        "commercial",
        "crafts",
        "painting",
        "retro",
        "photography",
        "film_cinema",
        "film",
        "digital_3d",
        "art_movements",
        "mk",
    ],
    key=len,
    reverse=True,
)


def _strip_source_prefix(s: str) -> str:
    """去除来源前缀。返回剩余部分（小写）。"""
    for pfx in SOURCE_PREFIXES:
        for sep in SEPARATORS:
            full = pfx + sep
            if s.startswith(full):
                return s[len(full):]
        # 前缀后紧跟单词边界（无分隔符）
        # 比如 "MKVanGogh" — 但通常 name 是空格分隔
    return s


def _try_long_match(parts: List[str], start: int, max_n: int = 4) -> Optional[Tuple[int, str]]:
    """从 parts[start:start+n] 找最长匹配，返回 (n, zh)"""
    n = min(max_n, len(parts) - start)
    # 尝试 4,3,2,1 段组合
    for n_try in range(n, 0, -1):
        cand_parts = parts[start : start + n_try]
        # 多种连接形式
        candidates = [
            " ".join(cand_parts),
            "-".join(cand_parts),
            "_".join(cand_parts),
            "".join(cand_parts),
        ]
        for cand in candidates:
            if cand in DICT:
                return n_try, DICT[cand]
    return None


def translate_one(name: str, *, src_id: Optional[str] = None) -> Tuple[str, str]:
    """翻译单个 name。

    返回 (zh, status)
    status:
        - "ok"      : 完整翻译（含已知未翻译段）
        - "ok_partial": 部分翻译（含未命中词典的原段）
        - "unknown" : 完全未命中
        - "raw"     : 输入为空
    """
    if not name or not name.strip():
        return "", "raw"

    original = name.strip()
    s = original.lower()

    # 1) 尝试整串在 DICT
    if s in DICT:
        return DICT[s], "ok"

    # 2) 去前缀
    s2 = _strip_source_prefix(s)
    if s2 and s2 != s:
        # 去前缀后试整串
        if s2 in DICT:
            return DICT[s2], "ok"
        # 试去前缀的另一个组合（用空格）
        if s2.replace("-", " ") in DICT:
            return DICT[s2.replace("-", " ")], "ok"
        if s2.replace("-", "_") in DICT:
            return DICT[s2.replace("-", "_")], "ok"
        s = s2

    # 3) 按分隔符切分
    # 统一 - _ / 为 -
    s_norm = re.sub(r"[-_/]", "-", s)
    s_norm = re.sub(r"\s+", "-", s_norm).strip("-")
    if not s_norm:
        return original, "unknown"
    parts = s_norm.split("-")

    # 4) 贪心多段匹配
    out: List[str] = []
    i = 0
    while i < len(parts):
        m = _try_long_match(parts, i, max_n=4)
        if m:
            n_use, zh = m
            out.append(zh)
            i += n_use
        else:
            # 单段
            w = parts[i]
            if not w:
                i += 1
                continue
            if w in DICT:
                out.append(DICT[w])
            else:
                # 保留原文（保留首字母大写）
                # 还原成原始 parts[i] 的样式（取 original 中的对应段，保持大写）
                # 简单处理：保留小写
                out.append(w)
            i += 1

    if not out:
        return original, "unknown"

    zh = "".join(out)
    # 状态判断：若 zh 与 original 完全相同（lowercase 比较）才算 unknown
    if zh.lower() == original.lower():
        return zh, "unknown"
    # 检查输出中是否还有未翻译的英文段
    has_unknown_seg = any(
        seg and all(c.isascii() and c.isalpha() for c in seg)
        for seg in out
    )
    if has_unknown_seg:
        return zh, "ok_partial"
    return zh, "ok"


def translate_many(items: List[Tuple[str, str]]) -> List[Tuple[str, str, str, str]]:
    """批量翻译

    items: [(preset_id, name), ...]
    returns: [(preset_id, name, zh, status), ...]
    """
    return [(pid, name, *translate_one(name, src_id=pid)) for pid, name in items]


def build_report(
    results: List[Tuple[str, str, str, str]],
    cfg,
) -> str:
    """生成可读报告：成功/部分翻译/未翻译分组 + 统计"""
    n_total = len(results)
    n_ok = sum(1 for r in results if r[3] == "ok")
    n_partial = sum(1 for r in results if r[3] == "ok_partial")
    n_unknown = sum(1 for r in results if r[3] == "unknown")
    n_raw = sum(1 for r in results if r[3] == "raw")

    lines = []
    lines.append(f"# 风格预设翻译报告")
    lines.append(f"")
    lines.append(f"- 总数: {n_total}")
    lines.append(f"- 完整翻译: {n_ok}")
    lines.append(f"- 部分翻译（含未命中段）: {n_partial}")
    lines.append(f"- 未翻译: {n_unknown}")
    lines.append(f"- 空名: {n_raw}")
    lines.append(f"- 翻译率（ok+partial）: {(n_ok+n_partial)/max(n_total,1)*100:.1f}%")
    lines.append(f"")

    # 完整翻译（前 100）
    lines.append(f"## 完整翻译（ok，前 100）")
    for pid, name, zh, _ in [r for r in results if r[3] == "ok"][:100]:
        lines.append(f"- {name}  →  {zh}")
    if n_ok > 100:
        lines.append(f"  ... 还有 {n_ok - 100} 条")
    lines.append(f"")

    # 部分翻译（重点）
    lines.append(f"## 部分翻译（ok_partial，前 200）")
    for pid, name, zh, _ in [r for r in results if r[3] == "ok_partial"][:200]:
        lines.append(f"- {name}  →  {zh}")
    if n_partial > 200:
        lines.append(f"  ... 还有 {n_partial - 200} 条")
    lines.append(f"")

    # 未翻译
    lines.append(f"## 未翻译（unknown）")
    for pid, name, _, _ in [r for r in results if r[3] == "unknown"]:
        lines.append(f"- {name}  (id={pid})")
    if n_unknown == 0:
        lines.append(f"  (无)")

    return "\n".join(lines) + "\n"
