"""
knowledge.py — 知识库管理
=========================
职责：管理 Anima 知识库（anima-knowledge.txt）和用户自定义知识条目。

核心设计：
  - anima-knowledge.txt 是只读的源文件（不在此模块中修改）
  - 用户新增/删除的条目存储在 data/user-knowledge.json 中
  - search() 做关键词检索，只返回 top-N 片段嵌入 system prompt
    显著减少 token 消耗 vs 旧版全量嵌入

未来扩展：
  - 支持语义检索（需要嵌入模型）
  - 支持知识库版本管理
"""

import json
import re
from pathlib import Path
from typing import Optional, List, Dict, Any

MODULE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = MODULE_DIR.parent

# anima-knowledge.txt 的路径（只读源文件）
KNOWLEDGE_FILE = PROJECT_DIR / "data" / "anima-knowledge.txt"
# 用户自定义知识条目
USER_KNOWLEDGE_FILE = PROJECT_DIR / "data" / "user-knowledge.json"


# ═══════════════════════════════════════════════════════════════════════
#  Anima 知识库加载
# ═══════════════════════════════════════════════════════════════════════

_KNOWLEDGE_CACHE: Optional[str] = None


def _load_anima_knowledge() -> str:
    """
    加载 anima-knowledge.txt 全文。
    使用模块级缓存，避免重复磁盘读取。
    """
    global _KNOWLEDGE_CACHE
    if _KNOWLEDGE_CACHE is None:
        if KNOWLEDGE_FILE.exists():
            _KNOWLEDGE_CACHE = KNOWLEDGE_FILE.read_text(encoding='utf-8')
        else:
            _KNOWLEDGE_CACHE = ""
    return _KNOWLEDGE_CACHE


def _invalidate_cache():
    """清空知识库缓存（当文件可能变化时调用）"""
    global _KNOWLEDGE_CACHE
    _KNOWLEDGE_CACHE = None


def _load_user_entries() -> List[dict]:
    """加载用户自定义知识条目"""
    if not USER_KNOWLEDGE_FILE.exists():
        return []
    try:
        with open(USER_KNOWLEDGE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_user_entries(entries: List[dict]):
    """保存用户自定义知识条目"""
    USER_KNOWLEDGE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(USER_KNOWLEDGE_FILE, 'w', encoding='utf-8') as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)


# ═══════════════════════════════════════════════════════════════════════
#  公开 API
# ═══════════════════════════════════════════════════════════════════════

def search(query: str, limit: int = 20) -> str:
    """
    按关键词检索知识库，返回相关的片段文本。

    搜索策略：
      1. 在 anima-knowledge.txt 中按行检索关键词
      2. 匹配到的行 + 上下文行 组成片段
      3. 追加用户自定义知识条目中匹配的条目
      4. 拼接后截取 limit 行

    相比旧版 load_knowledge() 返回全量 ~100KB 文本，
    此方法通常只返回 2-5KB，大幅减少 LLM 的 token 消耗。

    Args:
        query: 搜索关键词（中文/英文皆可）
        limit: 最多返回的行数

    Returns:
        匹配的知识库片段文本
    """
    query_lower = query.lower().strip()
    if not query_lower:
        # 没有搜索词时返回空（不嵌入全量知识库）
        return ""

    # ── 1. 在 anima-knowledge.txt 中搜索 ──
    full_text = _load_anima_knowledge()
    lines = full_text.split('\n')
    matched_lines = []
    matched_indices = set()

    for i, line in enumerate(lines):
        if query_lower in line.lower():
            # 取上下文：上2行 + 本行 + 下2行
            for j in range(max(0, i - 2), min(len(lines), i + 3)):
                if j not in matched_indices:
                    matched_lines.append(lines[j])
                    matched_indices.add(j)

    # ── 2. 在用户自定义条目中搜索 ──
    user_entries = _load_user_entries()
    for entry in user_entries:
        term = entry.get("term", "").lower()
        context = entry.get("context", "")
        if query_lower in term or query_lower in context.lower():
            matched_lines.append(f"# {entry.get('term', '')}: {context}")

    # ── 3. 截取 ──
    if len(matched_lines) > limit:
        matched_lines = matched_lines[:limit]
        matched_lines.append("...(更多结果已省略)")

    if not matched_lines:
        return ""

    return "\n".join(matched_lines)


def add_entry(term: str, tags: Optional[List[str]], context: str) -> dict:
    """
    新增用户知识条目。

    Args:
        term: 关键词/术语
        tags: 关联标签列表
        context: 描述/上下文

    Returns:
        新建的条目 dict
    """
    entries = _load_user_entries()
    entry = {
        "id": f"uk-{len(entries) + 1}",
        "term": term,
        "tags": tags or [],
        "context": context,
        "created_at": "",
    }
    entries.append(entry)
    _save_user_entries(entries)
    return entry


def remove_entry(entry_id: str) -> bool:
    """删除用户知识条目"""
    entries = _load_user_entries()
    new_entries = [e for e in entries if e.get("id") != entry_id]
    if len(new_entries) == len(entries):
        return False
    _save_user_entries(new_entries)
    return True


def list_entries(page: int = 1, page_size: int = 20) -> dict:
    """
    分页列出用户自定义知识条目。

    Returns:
        {"entries": [...], "total": N, "page": P, "page_size": S}
    """
    entries = _load_user_entries()
    total = len(entries)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "entries": entries[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
