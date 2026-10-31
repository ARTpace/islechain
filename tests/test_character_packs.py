"""角色包：索引/详情拆分可逆、多包合并、zip 导入安全、官方包状态、老数据回退。

对应 src：character_packs/（schema / store / catalog）
"""

import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import character_packs  # noqa: E402
from character_packs import catalog as catalog_mod  # noqa: E402
from character_packs import schema, store as store_mod  # noqa: E402
from character_packs.paths import (  # noqa: E402
    detail_filename,
    detail_shard_of,
    thumb_url_of,
)

FEATURE_MAP = json.loads(
    (ROOT / "data" / "character-features.json").read_text(encoding="utf-8")
)["features"]


def make_char(cid, **kw):
    trigger = cid + ", test ip"
    base = {
        "name": cid, "slug": cid, "copyright": "test_ip", "post_count": 500,
        "gender": "1girl", "hair": "white", "eye": "blue",
        "trigger": trigger, "tags": ["long hair", "glasses", "blue eyes"],
        "thumb_url": thumb_url_of(trigger),
        "img_url": "https://x/img.png", "danbooru_url": "https://x/d",
    }
    base.update(kw)
    return base


def write_pack(root, pack_id, chars, order=100, entry_count=None, extra_files=None):
    """按正式产物结构写一个角色包目录。"""
    items, shards = schema.split_characters(chars, feature_map=FEATURE_MAP)
    pack_dir = Path(root) / pack_id
    pack_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema": 1, "packId": pack_id, "kind": "characters",
        "name": pack_id, "version": "1.0.0", "order": order,
        "entryCount": entry_count if entry_count is not None else len(items),
        "files": {"index": "index.json"},
    }
    manifest.update(extra_files or {})
    (pack_dir / "pack.json").write_text(json.dumps(manifest), encoding="utf-8")
    (pack_dir / "index.json").write_text(
        json.dumps({"schema": 1, "count": len(items), "items": items},
                   ensure_ascii=False), encoding="utf-8")
    for shard, entries in shards.items():
        (pack_dir / detail_filename(shard)).write_text(
            json.dumps(entries, ensure_ascii=False), encoding="utf-8")
    return pack_dir


class TempRoots(unittest.TestCase):
    """把三个目录常量整体换到临时目录。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.builtin = root / "builtin"
        self.user = root / "user"
        self.legacy = root / "legacy" / "characters.json"
        self.builtin.mkdir(parents=True, exist_ok=True)
        self.user.mkdir(parents=True, exist_ok=True)

        self._patches = [
            mock.patch.object(store_mod, "BUILTIN_PACKS_DIR", self.builtin),
            mock.patch.object(store_mod, "USER_PACKS_DIR", self.user),
            mock.patch.object(store_mod, "LEGACY_CHARACTERS_FILE", self.legacy),
            mock.patch.object(catalog_mod, "BUILTIN_PACKS_DIR", self.builtin),
            mock.patch.object(catalog_mod, "USER_PACKS_DIR", self.user),
            mock.patch.object(catalog_mod, "BASE_DIR", root),
        ]
        for patch in self._patches:
            patch.start()

    def tearDown(self):
        for patch in self._patches:
            patch.stop()
        self._tmp.cleanup()


class TestSplitRoundTrip(unittest.TestCase):
    def test_split_and_merge_back(self):
        chars = [make_char("a_one"), make_char("b_two"), make_char("c_three")]
        items, shards = schema.split_characters(chars, feature_map=FEATURE_MAP)

        self.assertEqual(len(items), 3)
        self.assertNotIn("tags", items[0], "索引层不应包含 tags")
        self.assertNotIn("img_url", items[0], "索引层不应包含大图")
        self.assertEqual(items[0]["feat"], ["长发", "眼镜", "蓝瞳"])

        merged = schema.merge_back(items, shards)
        for src, row in zip(chars, merged):
            for key in ("name", "copyright", "post_count", "gender", "hair", "eye",
                        "trigger", "tags", "img_url", "danbooru_url", "thumb_url"):
                self.assertEqual(row.get(key), src.get(key), "%s.%s" % (src["slug"], key))

    def test_duplicate_id_keeps_first(self):
        chars = [make_char("dup", post_count=10), make_char("dup", post_count=99)]
        items, _ = schema.split_characters(chars, feature_map=FEATURE_MAP)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["post_count"], 10)

    def test_thumb_fallback_when_rule_mismatch(self):
        char = make_char("odd", thumb_url="https://example.com/custom.webp")
        entry = schema.to_index_entry(char, FEATURE_MAP)
        self.assertEqual(entry["thumb"], "https://example.com/custom.webp")

    def test_detail_shard_normalization(self):
        self.assertEqual(detail_shard_of("Abc_1"), "a")
        self.assertEqual(detail_shard_of("9x"), "9")
        self.assertEqual(detail_shard_of("中文角色"), "other")
        self.assertEqual(detail_filename("other"), "detail-other.json")


class TestStoreMerge(TempRoots):
    def test_merge_dedup_and_builtin_first(self):
        write_pack(self.builtin, "characters-seed", [make_char("a_one"), make_char("b_two")], order=100)
        write_pack(self.user, "characters-extra",
                   [make_char("b_two", post_count=999), make_char("c_three")], order=500)

        payload = store_mod.merged_index(force=True)
        self.assertEqual(payload["count"], 3, "同 id 只应保留一条")
        ids = [e["id"] for e in payload["items"]]
        self.assertEqual(ids[0], "a_one", "内置包在前")
        # 后装包的字段不覆盖先出现的（去重保留首个）
        self.assertEqual(payload["items"][1]["post_count"], 500)

    def test_get_detail_by_shard(self):
        write_pack(self.builtin, "characters-seed", [make_char("a_one"), make_char("b_two")])
        detail = store_mod.get_detail("a_one")
        self.assertTrue(detail)
        self.assertIn("glasses", detail["tags"])
        self.assertIsNone(store_mod.get_detail("no_such"))

    def test_legacy_fallback_when_no_packs(self):
        self.legacy.parent.mkdir(parents=True, exist_ok=True)
        self.legacy.write_text(json.dumps({
            "version": "test", "count": 1,
            "characters": [make_char("legacy_one")],
        }, ensure_ascii=False), encoding="utf-8")

        payload = store_mod.merged_index(force=True)
        self.assertTrue(payload["legacy"], "没有包时应回退老单文件")
        self.assertEqual(payload["count"], 1)
        detail = store_mod.get_detail("legacy_one")
        self.assertTrue(detail and detail["tags"])


class TestPackZip(TempRoots):
    def _zip(self, name, pack_id, chars, with_index=True, absolute=False):
        pack_dir = write_pack(self.builtin, pack_id, chars)
        zip_path = Path(self._tmp.name) / name
        with zipfile.ZipFile(zip_path, "w") as zf:
            for path in sorted(pack_dir.rglob("*.json")):
                if not with_index and path.name == "index.json":
                    continue
                arc = ("../evil/" if absolute else pack_id + "/") + path.name
                zf.write(path, arc)
        return zip_path

    def test_import_ok(self):
        zip_path = self._zip("ok.zip", "characters-ext", [make_char("x_one")])
        manifest = character_packs.import_pack(zip_path)
        self.assertEqual(manifest.pack_id, "characters-ext")
        self.assertTrue((self.user / "characters-ext" / "index.json").is_file())
        self.assertEqual(store_mod.merged_index(force=True)["count"], 1)

    def test_import_rejects_missing_index(self):
        zip_path = self._zip("noindex.zip", "characters-noidx", [make_char("y_one")], with_index=False)
        with self.assertRaises(character_packs.catalog.PackError):
            character_packs.import_pack(zip_path)

    def test_import_rejects_traversal(self):
        zip_path = self._zip("evil.zip", "characters-evil", [make_char("z_one")], absolute=True)
        with self.assertRaises(character_packs.catalog.PackError):
            character_packs.import_pack(zip_path)

    def test_uninstall_builtin_refused(self):
        write_pack(self.builtin, "characters-seed", [make_char("a_one")])
        with self.assertRaises(character_packs.catalog.PackError):
            character_packs.uninstall_pack("characters-seed")

    def test_uninstall_user_pack(self):
        write_pack(self.user, "characters-mine", [make_char("m_one")])
        self.assertTrue(character_packs.uninstall_pack("characters-mine"))
        self.assertFalse((self.user / "characters-mine").exists())


class TestOfficialCatalog(TempRoots):
    def test_official_status(self):
        official = Path(self._tmp.name) / "data" / "character-packs-official"
        official.mkdir(parents=True, exist_ok=True)
        (official / "catalog.json").write_text(json.dumps({
            "schema": 1, "totalEntries": 100,
            "packs": [
                {"packId": "characters-popular", "name": "热门", "entryCount": 60,
                 "file": "characters-popular.zip", "order": 200},
                {"packId": "characters-longtail", "name": "长尾", "entryCount": 40,
                 "file": "characters-longtail.zip", "order": 300},
            ],
        }), encoding="utf-8")
        (official / "characters-popular.zip").write_bytes(b"PK\x03\x04placeholder")

        write_pack(self.user, "characters-popular", [make_char("p_one")])
        status = character_packs.official_with_status()
        table = {p["packId"]: p for p in status["packs"]}
        self.assertTrue(table["characters-popular"]["installed"])
        self.assertTrue(table["characters-popular"]["available"])
        self.assertFalse(table["characters-longtail"]["installed"])
        self.assertFalse(table["characters-longtail"]["available"], "zip 不存在应标为不可安装")

    def test_export_roundtrip(self):
        write_pack(self.user, "characters-mine", [make_char("m_one")])
        out = Path(self._tmp.name) / "out" / "mine.zip"
        character_packs.export_pack_zip("characters-mine", out)
        self.assertTrue(out.is_file())
        with zipfile.ZipFile(out) as zf:
            names = zf.namelist()
        self.assertTrue(any(n.endswith("pack.json") for n in names))
        self.assertTrue(any(n.endswith("index.json") for n in names))


if __name__ == "__main__":
    unittest.main()
