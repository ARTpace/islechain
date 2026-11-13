import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import material_presets


class MaterialPresetTests(unittest.TestCase):
    def test_shipped_personas_have_distinct_manuals_and_workflows(self):
        items = material_presets.presets()
        self.assertEqual(items[0]['id'], 'default')
        self.assertEqual({p['id'] for p in items}, {'default', 'stylized', 'realistic', 'quick'})
        self.assertEqual(len({p['skill'] for p in items}), 4)
        self.assertEqual(next(p for p in items if p['id'] == 'quick')['workflow'], 'color-only')

    def test_custom_manual_is_loaded_and_invalid_configs_are_ignored(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name, config in [('custom', {'name': '自定义', 'workflow': 'color-normal', 'persona': '自定义人设'}),
                                 ('invalid', {'name': '错误', 'workflow': 'execute-code'}), ('bad-json', [])]:
                folder = root / name
                folder.mkdir()
                (folder / 'preset.json').write_text(json.dumps(config), encoding='utf-8')
                (folder / 'SKILL.md').write_text('自定义技能正文', encoding='utf-8')
            with patch.object(material_presets, 'ROOT', root):
                items = material_presets.presets()
            self.assertEqual([p['id'] for p in items], ['custom'])
            self.assertEqual(items[0]['skill'], '自定义技能正文')


if __name__ == '__main__':
    unittest.main()
