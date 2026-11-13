"""建模作业手册（skill）目录：packs/blender-skills/<id>/SKILL.md。

人设（core/game_role_presets）管取舍方向，手册管具体手法与踩过的 API 坑。
两者拆开后同一人设可以配不同手册，例如「硬表面道具师 + 减面手册」。
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'packs' / 'blender-skills'
SKILL_ID = re.compile(r'[a-z0-9-]{1,40}')
# 手册里标杆脚本之后的范例不再送进每次请求，避免模型照抄范例造型
CUT_MARK = '## 标杆脚本'

FALLBACK = {'id': 'builtin', 'name': '内置手册'}


def _parse(path):
    try:
        text = path.read_text(encoding='utf-8')
    except OSError:
        return '', ''
    title = summary = ''
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith('#'):
            if not title:
                title = line.lstrip('#').strip()
            continue
        if not summary:
            summary = line.lstrip('-*· ').strip()
    return title, summary


def list_skills():
    """扫目录给前端下拉用。标题取一级标题，说明取正文第一行。"""
    items = []
    try:
        folders = sorted(item for item in ROOT.iterdir() if item.is_dir())
    except OSError:
        return items
    for folder in folders:
        if not SKILL_ID.fullmatch(folder.name):
            continue
        path = folder / 'SKILL.md'
        if not path.is_file():
            continue
        title, summary = _parse(path)
        items.append({'id': folder.name,
                      'name': title or folder.name,
                      'description': summary[:120],
                      'path': 'packs/blender-skills/%s/SKILL.md' % folder.name})
    return items


def text(skill_id, out_path):
    """取手册正文，返回 (正文, 实际命中的 id)。找不到就退回内置手册。"""
    from core import blender_modeller
    for pid in (str(skill_id or '').strip(), 'default'):
        if not SKILL_ID.fullmatch(pid or ''):
            continue
        path = ROOT / pid / 'SKILL.md'
        if not path.is_file():
            continue
        try:
            body = path.read_text(encoding='utf-8').split(CUT_MARK, 1)[0]
        except OSError:
            continue
        return body.replace('{out_path}', str(out_path)), pid
    return blender_modeller.NOTES, 'builtin'


def name_of(skill_id):
    for item in list_skills():
        if item['id'] == skill_id:
            return item['name']
    return FALLBACK['name']


def document(skill_id):
    """整份手册正文（含「## 标杆脚本」之后的范例），只给前端「查看工作手册」面板看。
    送进模型请求的仍走 text()，那里会截断范例避免照抄。"""
    for pid in (str(skill_id or '').strip(), 'default'):
        if not SKILL_ID.fullmatch(pid or ''):
            continue
        path = ROOT / pid / 'SKILL.md'
        if not path.is_file():
            continue
        try:
            body = path.read_text(encoding='utf-8')
        except OSError:
            continue
        return {'id': pid, 'name': name_of(pid), 'body': body}
    return None
