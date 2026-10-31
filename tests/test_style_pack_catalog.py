"""官方可选风格包：目录发现、安装状态、一键安装、导出回环与路径安全。

用 unittest（与 tests/ 下其它用例一致）：
    python -m unittest tests.test_style_pack_catalog -v
"""

import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import style_packs
from style_packs import catalog as catalog_mod
from style_packs import packer as packer_mod
from style_packs import store as store_mod


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with io.open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _make_pack_dir(root, pack_id, order, preset_id):
    pack_dir = Path(root) / pack_id
    pack_dir.mkdir(parents=True, exist_ok=True)
    _write_json(pack_dir / "sample.json", {"categories": [{
        "id": "sample", "name": "示例",
        "subcategories": [{"id": "sample", "name": "示例",
                           "presets": [{"id": preset_id, "name": preset_id, "prompt": "p"}]}],
    }]})
    _write_json(pack_dir / "pack.json", {
        "schema": 1, "packId": pack_id, "name": pack_id, "version": "1.0.0",
        "order": order, "entryCount": 1,
        "categories": [{"id": "sample", "name": "示例", "file": "sample.json", "order": order}],
    })
    return pack_dir


def _zip_pack(pack_dir, out_zip):
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(Path(pack_dir).rglob("*.json")):
            zf.write(path, "%s/%s" % (Path(pack_dir).name, path.relative_to(pack_dir).as_posix()))
    return out_zip


class CatalogTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.base = root / "app"
        self.official = self.base / "data" / "style-packs-official"
        self.builtin = self.base / "data" / "style-packs"
        self.user = root / "user-packs"
        for path in (self.official, self.builtin, self.user):
            path.mkdir(parents=True, exist_ok=True)

        self._patches = [
            mock.patch.object(catalog_mod, "BASE_DIR", self.base),
            mock.patch.object(catalog_mod, "USER_PACKS_DIR", self.user),
            mock.patch.object(store_mod, "BUILTIN_PACKS_DIR", self.builtin),
            mock.patch.object(store_mod, "USER_PACKS_DIR", self.user),
            mock.patch.object(packer_mod, "USER_PACKS_DIR", self.user),
        ]
        for patch in self._patches:
            patch.start()

    def tearDown(self):
        for patch in self._patches:
            patch.stop()
        self._tmp.cleanup()

    def _publish(self, pack_id, order=500, preset_id="s1"):
        build = Path(self._tmp.name) / "build" / pack_id
        _make_pack_dir(build.parent, pack_id, order, preset_id)
        zip_path = _zip_pack(build if build.exists() else Path(self._tmp.name) / "build" / pack_id,
                             self.official / (pack_id + ".zip"))
        return zip_path

    def _write_catalog(self, entries):
        _write_json(self.official / "catalog.json", {
            "schema": 1, "packs": entries, "totalEntries": sum(e.get("entryCount", 0) for e in entries),
        })

    def test_official_dir_found_and_status(self):
        self._publish("platform-a")
        self._write_catalog([{
            "packId": "platform-a", "name": "A 包", "version": "1.0.0",
            "entryCount": 1, "categoryCount": 1, "sizeBytes": 100, "file": "platform-a.zip",
        }])
        self.assertEqual(catalog_mod.official_dir(), self.official)

        status = style_packs.official_with_status()
        self.assertEqual(len(status["packs"]), 1)
        pack = status["packs"][0]
        self.assertTrue(pack["available"])
        self.assertFalse(pack["installed"])
        self.assertEqual(pack["entryCount"], 1)

    def test_install_official_then_status_marks_installed(self):
        self._publish("platform-a")
        self._write_catalog([{
            "packId": "platform-a", "name": "A 包", "version": "1.0.0",
            "entryCount": 1, "categoryCount": 1, "sizeBytes": 100, "file": "platform-a.zip",
        }])

        manifest = style_packs.install_official("platform-a")
        self.assertEqual(manifest.pack_id, "platform-a")
        self.assertTrue((self.user / "platform-a" / "pack.json").is_file())

        pack = style_packs.official_with_status()["packs"][0]
        self.assertTrue(pack["installed"])
        self.assertFalse(pack["installedBuiltin"])

    def test_install_unknown_pack_raises(self):
        self._write_catalog([])
        with self.assertRaises(style_packs.PackError):
            style_packs.install_official("platform-missing")

    def test_catalog_file_field_cannot_escape(self):
        """catalog 里的 file 被改成越界路径时不能用，只能回退到 <packId>.zip。"""
        self._publish("platform-a")
        self._write_catalog([{
            "packId": "platform-a", "name": "A 包", "file": "../../../evil.zip", "entryCount": 1,
        }])
        path = catalog_mod.zip_path_of("platform-a")
        self.assertIsNotNone(path)
        self.assertEqual(path.name, "platform-a.zip")
        self.assertEqual(path.parent, self.official)

    def test_invalid_pack_id_rejected(self):
        self.assertIsNone(catalog_mod.zip_path_of("../../evil"))
        with self.assertRaises(style_packs.PackError):
            style_packs.install_official("../../evil")

    def test_export_then_reimport_roundtrip(self):
        """导出已装的包再导入，条目与服务端一致。"""
        _make_pack_dir(self.user, "mine", 500, "mine-1")
        out = Path(self._tmp.name) / "export" / "mine.zip"
        style_packs.export_pack_zip("mine", out)
        self.assertTrue(out.is_file())

        style_packs.uninstall_pack("mine")
        self.assertFalse((self.user / "mine").exists())

        style_packs.import_pack(out, replace=True)
        manifest = style_packs.load_manifest(self.user / "mine", builtin=False)
        self.assertIsNotNone(manifest)
        self.assertEqual(manifest.pack_id, "mine")

    def test_export_missing_pack_raises(self):
        with self.assertRaises(style_packs.PackError):
            style_packs.export_pack_zip("nope", Path(self._tmp.name) / "x.zip")

    def test_official_missing_catalog_returns_empty(self):
        empty_base = Path(self._tmp.name) / "empty-app"
        empty_base.mkdir()
        with mock.patch.object(catalog_mod, "BASE_DIR", empty_base):
            self.assertIsNone(catalog_mod.official_dir())
            status = style_packs.official_with_status()
            self.assertEqual(status["packs"], [])


if __name__ == "__main__":
    unittest.main()
