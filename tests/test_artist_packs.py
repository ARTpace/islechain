"""画师包：条目规范化、多包合并、图片地址拼接、zip 安全、老数据回退。

对应 src：artist_packs/（schema / store / catalog / paths / thumbs）

画师包没有详情层，所以测试重点不在"拆分可逆"，而在：
    1. 两种来源（官方 search.json / 老单文件）都能规范成同一结构
    2. 多包合并时 imageBase 不同也不能拼错地址
    3. 图片类型靠嗅探判断，不能依赖文件扩展名
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

from artist_packs import catalog as catalog_mod  # noqa: E402
from artist_packs import schema, store as store_mod, thumbs  # noqa: E402
from artist_packs.paths import (  # noqa: E402
    DEFAULT_IMAGE_EXT,
    image_url_of,
    tier_of,
)

BASE_A = "https://cdn.example.com/release-a/images/"
BASE_B = "https://cdn.example.com/release-b/images/"


def make_artist(aid, posts=500, **kw):
    """官方 search.json 的一条原始数据。"""
    base = {
        "slug": aid,
        "tag": "@" + aid,
        "imageId": "%s-deadbeef-p1" % aid,
        "postCount": posts,
        "hasImage": True,
    }
    base.update(kw)
    return base


def write_pack(root, pack_id, artists, order=100, image_base=BASE_A,
               image_ext=DEFAULT_IMAGE_EXT, entry_count=None, drop_index=False):
    """按正式产物结构写一个画师包目录。"""
    items = schema.split_artists(artists)
    pack_dir = Path(root) / pack_id
    pack_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema": 1, "packId": pack_id, "kind": "artists",
        "name": pack_id, "version": "1.0.0", "order": order,
        "entryCount": entry_count if entry_count is not None else len(items),
        "files": {} if drop_index else {"index": "index.json"},
    }
    (pack_dir / "pack.json").write_text(json.dumps(manifest), encoding="utf-8")
    if not drop_index:
        (pack_dir / "index.json").write_text(
            json.dumps({
                "schema": 1, "kind": "artists", "count": len(items),
                "imageBase": image_base, "imageExt": image_ext, "items": items,
            }, ensure_ascii=False), encoding="utf-8")
    return pack_dir


class TempRoots(unittest.TestCase):
    """把包目录与老单文件整体换到临时目录。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.root = root
        self.builtin = root / "builtin"
        self.user = root / "user"
        self.legacy = root / "legacy" / "artist_data.js"
        self.builtin.mkdir(parents=True, exist_ok=True)
        self.user.mkdir(parents=True, exist_ok=True)

        self._patches = [
            mock.patch.object(store_mod, "BUILTIN_PACKS_DIR", self.builtin),
            mock.patch.object(store_mod, "USER_PACKS_DIR", self.user),
            mock.patch.object(store_mod, "LEGACY_ARTISTS_FILE", self.legacy),
            mock.patch.object(catalog_mod, "BUILTIN_PACKS_DIR", self.builtin),
            mock.patch.object(catalog_mod, "USER_PACKS_DIR", self.user),
            mock.patch.object(catalog_mod, "BASE_DIR", root),
        ]
        for patch in self._patches:
            patch.start()
        store_mod._index_cache["sig"] = None
        store_mod._index_cache["payload"] = None

    def tearDown(self):
        for patch in self._patches:
            patch.stop()
        store_mod._index_cache["sig"] = None
        store_mod._index_cache["payload"] = None
        self._tmp.cleanup()


class TestSchema(unittest.TestCase):
    def test_normalize_official_entry(self):
        entry = schema.normalize_artist(make_artist("dairi", 15830))
        self.assertEqual(entry, {
            "id": "dairi", "tag": "@dairi", "posts": 15830,
            "img": "dairi-deadbeef-p1",
        })

    def test_normalize_legacy_entry(self):
        """老单文件用 id/name/post_count/danbooru_tag/image_url。"""
        entry = schema.normalize_artist({
            "id": "dairi", "name": "dairi", "post_count": 15830,
            "danbooru_tag": "@dairi",
            "image_url": "https://cdn.example.com/x/dairi-abc.webp",
        })
        self.assertEqual(entry["id"], "dairi")
        self.assertEqual(entry["tag"], "@dairi")
        self.assertEqual(entry["posts"], 15830)
        self.assertEqual(entry["url"], "https://cdn.example.com/x/dairi-abc.webp")
        self.assertNotIn("img", entry, "完整地址不拆成 imageId")

    def test_tag_falls_back_to_slug(self):
        entry = schema.normalize_artist({"slug": "abc", "postCount": 1})
        self.assertEqual(entry["tag"], "@abc")

    def test_slug_falls_back_to_tag(self):
        entry = schema.normalize_artist({"tag": "@x_y", "postCount": 1})
        self.assertEqual(entry["id"], "x_y")

    def test_no_image_drops_image_fields(self):
        entry = schema.normalize_artist(make_artist("noimg", hasImage=False))
        self.assertNotIn("img", entry)
        self.assertNotIn("url", entry)

    def test_empty_and_invalid_rows_are_skipped(self):
        items = schema.split_artists([{}, None, {"foo": "bar"}, make_artist("ok")])
        self.assertEqual([e["id"] for e in items], ["ok"])

    def test_duplicate_slug_keeps_first(self):
        """官方 search.json 里有 8 条重复 slug，必须只留第一条。"""
        raw = [make_artist("dup", 10), make_artist("dup", 99)]
        items = schema.split_artists(raw)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["posts"], 10)
        self.assertEqual(schema.dedupe_stats(raw), {"raw": 2, "unique": 1, "duplicated": 1})


class TestImageUrl(unittest.TestCase):
    def test_join_base_and_id(self):
        url = image_url_of(BASE_A, "abc-def-p1", ".avif")
        self.assertEqual(url, BASE_A + "abc-def-p1.avif")

    def test_base_without_trailing_slash(self):
        url = image_url_of("https://cdn.example.com/img", "x", "avif")
        self.assertEqual(url, "https://cdn.example.com/img/x.avif")

    def test_full_url_passthrough(self):
        full = "https://cdn.example.com/other/x.webp"
        self.assertEqual(image_url_of(BASE_A, full), full)

    def test_empty_id(self):
        self.assertEqual(image_url_of(BASE_A, ""), "")

    def test_tier_boundaries(self):
        self.assertEqual(tier_of(5000), "legend")
        self.assertEqual(tier_of(4999), "famous")
        self.assertEqual(tier_of(1000), "famous")
        self.assertEqual(tier_of(999), "active")
        self.assertEqual(tier_of(100), "active")
        self.assertEqual(tier_of(99), "rising")
        self.assertEqual(tier_of(0), "newbie")


class TestStoreMerge(TempRoots):
    def test_merge_dedup_and_builtin_first(self):
        write_pack(self.builtin, "artists-seed",
                   [make_artist("a_one"), make_artist("b_two")], order=100)
        write_pack(self.user, "artists-extra",
                   [make_artist("b_two", posts=999), make_artist("c_three")], order=500)

        payload = store_mod.merged_index(force=True)
        self.assertEqual(payload["count"], 3, "同 id 只保留一条")
        ids = [e["id"] for e in payload["items"]]
        self.assertEqual(ids[0], "a_one", "内置包排在前")
        self.assertEqual(payload["items"][1]["posts"], 500, "重复 id 保留首次出现")
        self.assertEqual(payload["imageBase"], BASE_A)
        self.assertFalse(payload["legacy"])

    def test_tier_counts(self):
        write_pack(self.builtin, "artists-seed", [
            make_artist("legend", 6000), make_artist("famous", 1200),
            make_artist("active", 300), make_artist("rising", 20),
        ])
        tiers = store_mod.merged_index(force=True)["tiers"]
        self.assertEqual(tiers, {"legend": 1, "famous": 1, "active": 1, "rising": 1})

    def test_entry_image_url_uses_top_level_base(self):
        write_pack(self.builtin, "artists-seed", [make_artist("dairi")])
        entry = store_mod.index_entry("dairi")
        self.assertEqual(store_mod.entry_image_url(entry),
                         BASE_A + "dairi-deadbeef-p1.avif")

    def test_conflicting_base_degrades_to_full_url(self):
        """两个包图床不同时，后装包的条目要降级成完整 URL，否则会拼错。"""
        write_pack(self.builtin, "artists-seed", [make_artist("a_one")], image_base=BASE_A)
        write_pack(self.user, "artists-extra", [make_artist("b_two")], image_base=BASE_B)

        payload = store_mod.merged_index(force=True)
        by_id = {e["id"]: e for e in payload["items"]}
        self.assertIn("img", by_id["a_one"], "主前缀包保持 imageId")
        self.assertEqual(by_id["b_two"]["url"], BASE_B + "b_two-deadbeef-p1.avif")
        self.assertNotIn("img", by_id["b_two"], "冲突包的 imageId 被替换成完整地址")

        # 不管哪种形态，最终地址都必须正确
        self.assertEqual(store_mod.entry_image_url(by_id["a_one"], payload),
                         BASE_A + "a_one-deadbeef-p1.avif")
        self.assertEqual(store_mod.entry_image_url(by_id["b_two"], payload),
                         BASE_B + "b_two-deadbeef-p1.avif")

    def test_find_artist_by_id_and_tag(self):
        write_pack(self.builtin, "artists-seed", [make_artist("dairi")])
        self.assertEqual(store_mod.find_artist("dairi")["id"], "dairi")
        self.assertEqual(store_mod.find_artist("@dairi")["id"], "dairi")
        self.assertEqual(store_mod.find_artist("DAIRI")["id"], "dairi")
        self.assertIsNone(store_mod.find_artist("nobody"))

    def test_pack_without_index_is_skipped(self):
        write_pack(self.builtin, "broken", [make_artist("x")], drop_index=True)
        payload = store_mod.merged_index(force=True)
        self.assertEqual(payload["count"], 0)
        self.assertEqual(payload["packs"], [], "索引缺失的包不参与合并")

    def test_legacy_fallback_when_no_packs(self):
        """没有任何包时回退读老单文件，避免升级瞬间画师全空。"""
        self.legacy.parent.mkdir(parents=True, exist_ok=True)
        legacy_rows = [{
            "id": "old_one", "name": "old_one", "post_count": 321,
            "danbooru_tag": "@old_one", "image_url": "https://x/old.webp",
        }]
        self.legacy.write_text(
            "// 老格式\nconst ARTIST_DATA = %s;\n" % json.dumps(legacy_rows, ensure_ascii=False),
            encoding="utf-8")

        payload = store_mod.merged_index(force=True)
        self.assertTrue(payload["legacy"])
        self.assertEqual(payload["count"], 1)
        entry = payload["items"][0]
        self.assertEqual(entry["id"], "old_one")
        self.assertEqual(entry["posts"], 321)
        self.assertEqual(store_mod.entry_image_url(entry, payload), "https://x/old.webp")

    def test_packs_win_over_legacy(self):
        self.legacy.parent.mkdir(parents=True, exist_ok=True)
        self.legacy.write_text("const A = %s;" % json.dumps([
            {"id": "old_one", "name": "old_one", "post_count": 1}]), encoding="utf-8")
        write_pack(self.builtin, "artists-seed", [make_artist("new_one")])

        payload = store_mod.merged_index(force=True)
        self.assertFalse(payload["legacy"], "有包就不该回退老文件")
        self.assertEqual([e["id"] for e in payload["items"]], ["new_one"])

    def test_version_token_changes_with_pack(self):
        write_pack(self.builtin, "artists-seed", [make_artist("a_one")])
        first = store_mod.version_token()
        write_pack(self.builtin, "artists-seed", [make_artist("a_one"), make_artist("b_two")])
        self.assertNotEqual(first, store_mod.version_token(), "包变化必须让 ETag 变")


class TestImportSafety(TempRoots):
    def _zip(self, entries):
        path = Path(self._tmp.name) / "pack.zip"
        with zipfile.ZipFile(path, "w") as zf:
            for name, payload in entries.items():
                zf.writestr(name, payload)
        return path

    def test_import_valid_pack(self):
        import json as _json

        src = write_pack(Path(self._tmp.name) / "src", "artists-x", [make_artist("a_one")])
        zip_path = Path(self._tmp.name) / "ok.zip"
        with zipfile.ZipFile(zip_path, "w") as zf:
            for path in src.rglob("*.json"):
                zf.write(path, "artists-x/%s" % path.relative_to(src).as_posix())

        pack = catalog_mod.import_pack(zip_path)
        self.assertEqual(pack.pack_id, "artists-x")
        self.assertTrue((self.user / "artists-x" / "index.json").is_file())
        payload = store_mod.merged_index(force=True)
        self.assertEqual(payload["count"], 1)

    def test_reject_empty_pack(self):
        """只有 pack.json、没有索引内容的包要拒绝，否则装了等于没装。"""
        import json as _json

        from content_packs.packer import PackError

        zip_path = self._zip({
            "empty/pack.json": _json.dumps({
                "schema": 1, "packId": "empty", "kind": "artists",
                "files": {"index": "index.json"},
            }),
        })
        with self.assertRaises(PackError):
            catalog_mod.import_pack(zip_path)

    def test_reject_path_traversal(self):
        import json as _json

        from content_packs.packer import PackError

        zip_path = self._zip({
            "../evil/pack.json": _json.dumps({
                "schema": 1, "packId": "evil", "kind": "artists",
                "files": {"index": "index.json"},
            }),
            "../evil/index.json": "{}",
        })
        with self.assertRaises(PackError):
            catalog_mod.import_pack(zip_path)

    def test_builtin_pack_cannot_be_uninstalled(self):
        from content_packs.packer import PackError

        write_pack(self.builtin, "artists-seed", [make_artist("a_one")])
        with self.assertRaises(PackError):
            catalog_mod.uninstall_pack("artists-seed")

    def test_uninstall_user_pack(self):
        write_pack(self.user, "artists-extra", [make_artist("x")])
        self.assertTrue(catalog_mod.uninstall_pack("artists-extra"))
        self.assertFalse((self.user / "artists-extra").exists())

    def test_official_status_marks_installed(self):
        write_pack(self.builtin, "artists-seed", [make_artist("a_one")])
        dist = Path(self._tmp.name) / "dist" / "artist-packs"
        dist.mkdir(parents=True, exist_ok=True)
        (dist / "catalog.json").write_text(json.dumps({
            "packs": [
                {"packId": "artists-seed", "entryCount": 1},
                {"packId": "artists-active", "entryCount": 999, "file": "artists-active.zip"},
            ],
        }), encoding="utf-8")
        (dist / "artists-active.zip").write_bytes(b"PK\x05\x06" + b"\x00" * 18)

        status = catalog_mod.official_with_status()
        by_id = {p["packId"]: p for p in status["packs"]}
        self.assertTrue(by_id["artists-seed"]["installed"])
        self.assertTrue(by_id["artists-seed"]["installedBuiltin"])
        self.assertFalse(by_id["artists-active"]["installed"])
        self.assertTrue(by_id["artists-active"]["available"])


class TestThumbs(unittest.TestCase):
    def test_media_type_sniffing(self):
        self.assertEqual(thumbs.media_type_of(b"\x89PNG\r\n\x1a\n"), "image/png")
        self.assertEqual(thumbs.media_type_of(b"\xff\xd8\xff\xe0"), "image/jpeg")
        self.assertEqual(thumbs.media_type_of(b"RIFF\x00\x00\x00\x00WEBPVP"), "image/webp")
        self.assertEqual(thumbs.media_type_of(b"\x00\x00\x00\x1cftypavif"), "image/avif")
        self.assertEqual(thumbs.media_type_of(b"GIF89a"), "image/gif")

    def test_unknown_falls_back_to_webp(self):
        self.assertEqual(thumbs.media_type_of(b"????"), "image/webp")

    def test_cache_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch("artist_packs.thumbs.user_data_dir", return_value=tmp):
                self.assertIsNone(thumbs.read_cached("nope"))
                payload = b"\x00\x00\x00\x1cftypavif" + b"x" * 200
                thumbs.write_cached("abc", payload)
                self.assertEqual(thumbs.read_cached("abc"), payload)

    def test_short_payload_not_cached(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch("artist_packs.thumbs.user_data_dir", return_value=tmp):
                thumbs.write_cached("tiny", b"x")
                self.assertIsNone(thumbs.read_cached("tiny"))


if __name__ == "__main__":
    unittest.main()
