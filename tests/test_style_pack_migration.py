"""老版本用户全量快照 -> 风格包增量层的迁移。

对应 style_packs/snapshot.py 的 migrate_legacy_snapshot()。
    python -m unittest tests.test_style_pack_migration -v
"""

import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import style_packs
from style_packs import packer as packer_mod
from style_packs import paths as paths_mod
from style_packs import store as store_mod


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with io.open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _make_pack(root, categories, presets):
    pack_dir = Path(root) / "core"
    pack_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for cid, name in categories:
        _write_json(pack_dir / ("%s.json" % cid), {"categories": [{
            "id": cid, "name": name,
            "subcategories": [{"id": cid, "name": name, "presets": presets}],
        }]})
        entries.append({"id": cid, "name": name, "file": "%s.json" % cid, "order": 100})
    _write_json(pack_dir / "pack.json", {
        "schema": 1, "packId": "core", "name": "core", "order": 100, "categories": entries,
    })
    return pack_dir


class LegacySnapshotMigrationTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.builtin = root / "builtin"
        self.overlay = root / "data" / "style-overlay.json"
        self.legacy = root / "data" / "style-presets.json"
        _make_pack(self.builtin, [("photo", "摄影")], [
            {"id": "p1", "name": "一", "prompt": "old"},
            {"id": "p2", "name": "二", "prompt": "two"},
        ])
        self._patches = [
            mock.patch.object(store_mod, "BUILTIN_PACKS_DIR", self.builtin),
            mock.patch.object(store_mod, "USER_PACKS_DIR", root / "user"),
            mock.patch.object(store_mod, "OVERLAY_FILE", self.overlay),
            mock.patch.object(paths_mod, "LEGACY_USER_SNAPSHOT", self.legacy),
        ]
        for patch in self._patches:
            patch.start()

    def tearDown(self):
        for patch in self._patches:
            patch.stop()
        self._tmp.cleanup()

    def _legacy_snapshot(self):
        """模拟老版本写下的全量快照：改一条、加一条、删一条。"""
        snapshot = {"categories": style_packs.base_categories()}
        presets = snapshot["categories"][0]["subcategories"][0]["presets"]
        presets[0]["prompt"] = "edited-by-user"
        presets.append({"id": "mine", "name": "我的", "prompt": "custom"})
        presets[:] = [p for p in presets if p["id"] != "p2"]
        return snapshot

    def test_migrate_converts_and_archives(self):
        _write_json(self.legacy, self._legacy_snapshot())
        self.assertTrue(style_packs.migrate_legacy_snapshot())

        overlay = style_packs.read_overlay()
        self.assertIn("p1", overlay["patches"])
        self.assertIn("mine", overlay["items"])
        self.assertEqual(overlay["removed"], ["p2"])

        # 原文件已归档，不会重复迁移
        self.assertFalse(self.legacy.exists())
        archived = list(self.legacy.parent.glob("style-presets.json.legacy-*"))
        self.assertEqual(len(archived), 1)
        self.assertFalse(style_packs.migrate_legacy_snapshot())

        # 迁移后的合并视图与旧快照一致
        merged = style_packs.merged_categories()
        presets = merged[0]["subcategories"][0]["presets"]
        ids = [p["id"] for p in presets]
        self.assertIn("mine", ids)
        self.assertNotIn("p2", ids)
        self.assertEqual(next(p for p in presets if p["id"] == "p1")["prompt"], "edited-by-user")

    def test_existing_overlay_is_not_overwritten(self):
        style_packs.add_item({"id": "newer", "name": "新的", "prompt": "p"})
        _write_json(self.legacy, self._legacy_snapshot())
        self.assertTrue(style_packs.migrate_legacy_snapshot())

        overlay = style_packs.read_overlay()
        self.assertIn("newer", overlay["items"])
        self.assertNotIn("mine", overlay["items"], "已有增量层时不应被旧快照覆盖")
        self.assertFalse(self.legacy.exists(), "旧快照仍要归档")

    def test_no_legacy_file_is_noop(self):
        self.assertFalse(style_packs.migrate_legacy_snapshot())


if __name__ == "__main__":
    unittest.main()
