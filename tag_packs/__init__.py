"""标签包：仅加载用户显式安装的数据，复用内容包安全导入与分类合并。"""
import json
import os
import tempfile
from pathlib import Path
from core.user_paths import user_data_dir
from content_packs.scanner import discover
from content_packs.packer import import_pack as _import, uninstall_pack as _uninstall
from style_packs.merge import base_categories
def atomic_write_json(path, data, **kwargs):
    target = Path(path)
    fd, temp = tempfile.mkstemp(dir=str(target.parent), suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(data, handle, **kwargs)
        os.replace(temp, target)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


USER_PACKS_DIR = Path(user_data_dir()) / 'tag-packs'

def discover_packs():
    return discover(((USER_PACKS_DIR, False),), kind='tags', log_tag='tag_packs')

def installed_packs():
    return [{'packId':p.pack_id, 'kind':'tags', 'name':p.name, 'version':p.version,
             'entryCount':p.entry_count, 'builtin':False} for p in discover_packs()]

def get_presets():
    return {'categories':base_categories(discover_packs())}

def import_pack(path, replace=False):
    return _import(path, dest_root=USER_PACKS_DIR, kind='tags', display_name='标签包', replace=replace)

def uninstall_pack(pack_id):
    return _uninstall(pack_id, dest_root=USER_PACKS_DIR)

def save_presets(data):
    # 编辑结果作为独立用户包，不写回仓库安装包或旧预设目录。
    root = USER_PACKS_DIR / 'custom-tags'
    categories = data.get('categories', [])
    count = sum(len(sub.get('presets', [])) for cat in categories for sub in cat.get('subcategories', []))
    root.mkdir(parents=True, exist_ok=True)
    atomic_write_json(str(root / 'tags.json'), {'categories':categories}, ensure_ascii=False, indent=2)
    atomic_write_json(str(root / 'pack.json'), {'schema':1, 'kind':'tags', 'packId':'custom-tags', 'name':'我的标签',
        'version':'1.0.0', 'entryCount':count, 'order':900, 'categories':[{'id':'custom', 'name':'我的标签', 'file':'tags.json'}]}, ensure_ascii=False, indent=2)
    return True


def signature():
    return tuple((str(p), p.stat().st_mtime_ns, p.stat().st_size) for p in sorted(USER_PACKS_DIR.glob('*/*.json')) if p.is_file())
