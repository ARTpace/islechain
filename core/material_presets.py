"""Material personas paired with editable, project-owned skill manuals."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'packs' / 'material-skills'


def presets():
    items = []
    for folder in sorted(ROOT.iterdir()):
        if not folder.is_dir() or not re.fullmatch(r'[a-z0-9-]{1,40}', folder.name):
            continue
        try:
            data = json.loads((folder / 'preset.json').read_text(encoding='utf-8'))
            manual = (folder / 'SKILL.md').read_text(encoding='utf-8').strip()
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict) or data.get('workflow') not in ('color-normal', 'color-only') or not manual or not data.get('name'):
            continue
        items.append(dict(id=folder.name, name=str(data['name']), description=str(data.get('description', '')),
                          workflow=data['workflow'], persona=str(data.get('persona', '')), skill=manual,
                          path=f'packs/material-skills/{folder.name}/SKILL.md'))
    return sorted(items, key=lambda p: (p['id'] != 'default', p['name']))
