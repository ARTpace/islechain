"""风格包：拆分一致性、合并排序、用户增量层、zip 导入安全。

用 unittest（与 tests/ 下其它用例一致，不依赖 pytest）：
    python -m unittest tests.test_style_packs -v
"""

import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import style_packs
from style_packs import packer as packer_mod
from style_packs import store as store_mod


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with io.open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _category(cid, name, sub_id, presets):
    return {"id": cid, "name": name, "subcategories": [{"id": sub_id, "name": name, "presets": presets}]}


def _make_pack(root, pack_id, order, categories):
    """在 root 下生成一个包目录：pack.json + 每分类一个文件。"""
    pack_dir = Path(root) / pack_id
    pack_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for index, (cid, category) in enumerate(categories):
        _write_json(pack_dir / ("%s.json" % cid), {"categories": [category]})
        entries.append({
            "id": cid,
            "name": category["name"],
            "file": "%s.json" % cid,
            "order": order + index * 10,
        })
    _write_json(pack_dir / "pack.json", {
        "schema": 1,
        "packId": pack_id,
        "name": pack_id,
        "order": order,
        "categories": entries,
    })
    return pack_dir


class BuiltinPackTest(unittest.TestCase):
    """随包分发的只有精简种子包；完整 44MB 数据不进仓库、不进分发目录。"""

    def test_seed_pack_present(self):
        packs = [p for p in style_packs.discover_packs() if p.builtin]
        self.assertTrue(packs, "没有发现内置风格包")
        seed = next((p for p in packs if p.pack_id == "art-canvas-seed"), None)
        self.assertIsNotNone(seed, "缺少 art-canvas-seed 内置包")
        self.assertGreater(len(seed.categories), 0, "种子包不能是空壳")

        merged = style_packs.base_categories(packs)
        self.assertGreater(len(merged), 0)
        self.assertGreater(style_packs.category_total(merged), 0)

    def test_seed_pack_declares_entry_count(self):
        """清单里预存条目数，列表页才不用为显示数字去解析内容。"""
        seed = next((p for p in style_packs.discover_packs() if p.pack_id == "art-canvas-seed"), None)
        self.assertIsNotNone(seed)
        real = style_packs.category_total(style_packs.base_categories([seed]))
        self.assertEqual(seed.entry_count, real, "pack.json 的 entryCount 与实际条数不一致")

    def test_full_pack_not_in_distribution_dir(self):
        """完整源包只能放在 style-packs-source 下作切料，不能混进分发目录。"""
        repo_root = Path(__file__).resolve().parent.parent
        bad = repo_root / "data" / "style-packs" / "art-canvas-core"
        self.assertFalse(bad.exists(), "完整风格包出现在分发目录，仓库与安装包会被撑大")


class MergeTest(unittest.TestCase):
    """多包合并：内置在前、按 order 排序、同 id 覆盖但不移位。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self.builtin = root / "builtin"
        self.user = root / "user"
        self.builtin.mkdir()
        self.user.mkdir()
        self._patches = [
            mock.patch.object(store_mod, "BUILTIN_PACKS_DIR", self.builtin),
            mock.patch.object(store_mod, "USER_PACKS_DIR", self.user),
            mock.patch.object(store_mod, "OVERLAY_FILE", root / "overlay.json"),
        ]
        for patch in self._patches:
            patch.start()

    def tearDown(self):
        for patch in self._patches:
            patch.stop()
        self._tmp.cleanup()

    def test_order_and_priority(self):
        _make_pack(self.builtin, "core", 100, [
            ("b_cat", _category("b_cat", "乙分类", "b_cat", [{"id": "b1", "name": "乙1", "prompt": "x"}])),
            ("a_cat", _category("a_cat", "甲分类", "a_cat", [{"id": "a1", "name": "甲1", "prompt": "y"}])),
        ])
        _make_pack(self.user, "extra", 50, [
            ("c_cat", _category("c_cat", "丙分类", "c_cat", [{"id": "c1", "name": "丙1", "prompt": "z"}])),
        ])

        merged = style_packs.merged_categories()
        # order 是全局排序键：用户包用 50 可以置顶，内置包内再按 order 排（b_cat=100 前于 a_cat=110）
        self.assertEqual([c["id"] for c in merged], ["c_cat", "b_cat", "a_cat"])

    def test_same_category_merges_and_keeps_position(self):
        _make_pack(self.builtin, "core", 100, [
            ("photo", _category("photo", "摄影", "photo", [
                {"id": "p1", "name": "一", "prompt": "old"},
                {"id": "p2", "name": "二", "prompt": "two"},
            ])),
        ])
        _make_pack(self.user, "extra", 500, [
            ("photo", _category("photo", "摄影", "photo", [
                {"id": "p1", "name": "一", "prompt": "new"},
                {"id": "p3", "name": "三", "prompt": "three"},
            ])),
        ])

        merged = style_packs.merged_categories()
        self.assertEqual(len(merged), 1)
        presets = merged[0]["subcategories"][0]["presets"]
        self.assertEqual([p["id"] for p in presets], ["p1", "p2", "p3"])
        # 同 id 覆盖内容，但位置仍是第一
        self.assertEqual(presets[0]["prompt"], "new")


class OverlayTest(unittest.TestCase):
    """用户增量层：加、改、删，以及全量快照换算成差异。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.builtin = self.root / "builtin"
        self.overlay = self.root / "overlay.json"
        _make_pack(self.builtin, "core", 100, [
            ("photo", _category("photo", "摄影", "photo", [
                {"id": "p1", "name": "一", "prompt": "old"},
                {"id": "p2", "name": "二", "prompt": "two"},
            ])),
        ])
        self._patches = [
            mock.patch.object(store_mod, "BUILTIN_PACKS_DIR", self.builtin),
            mock.patch.object(store_mod, "USER_PACKS_DIR", self.root / "user"),
            mock.patch.object(store_mod, "OVERLAY_FILE", self.overlay),
        ]
        for patch in self._patches:
            patch.start()

    def tearDown(self):
        for patch in self._patches:
            patch.stop()
        self._tmp.cleanup()

    def _presets(self):
        merged = style_packs.merged_categories()
        return [p for c in merged for s in c["subcategories"] for p in s["presets"]]

    def test_add_patch_remove(self):
        self.assertTrue(style_packs.add_item(
            {"id": "mine_1", "name": "我的", "prompt": "custom"},
            {"id": "photo", "name": "摄影"},
            {"id": "photo", "name": "摄影"},
        ))
        self.assertIn("mine_1", [p["id"] for p in self._presets()])

        self.assertTrue(style_packs.patch_item("p1", {"prompt": "patched"}))
        p1 = next(p for p in self._presets() if p["id"] == "p1")
        self.assertEqual(p1["prompt"], "patched")
        self.assertEqual(p1["name"], "一", "未传的字段不应被清空")

        self.assertTrue(style_packs.remove_item("p2"))
        self.assertNotIn("p2", [p["id"] for p in self._presets()])

    def test_overlay_creates_missing_category_at_end(self):
        style_packs.add_item({"id": "x1", "name": "X", "prompt": "p"},
                             {"id": "my_styles", "name": "我的风格"},
                             {"id": "my_styles", "name": "我的风格"})
        merged = style_packs.merged_categories()
        self.assertEqual(merged[-1]["id"], "my_styles")
        self.assertEqual(merged[0]["id"], "photo")

    def test_diff_snapshot_is_empty_when_unchanged(self):
        base = {"categories": style_packs.base_categories()}
        overlay = style_packs.diff_overlay(base)
        self.assertEqual(overlay["items"], {})
        self.assertEqual(overlay["patches"], {})
        self.assertEqual(overlay["removed"], [])

    def test_diff_snapshot_only_records_changes(self):
        base = style_packs.base_categories()
        snapshot = json.loads(json.dumps(base))
        presets = snapshot[0]["subcategories"][0]["presets"]
        presets[0]["prompt"] = "changed"
        presets.append({"id": "new_1", "name": "新", "prompt": "brand new"})
        presets[:] = [p for p in presets if p["id"] != "p2"]

        overlay = style_packs.diff_overlay({"categories": snapshot})
        self.assertIn("p1", overlay["patches"])
        self.assertEqual(overlay["patches"]["p1"]["prompt"], "changed")
        self.assertIn("new_1", overlay["items"])
        self.assertEqual(overlay["removed"], ["p2"])


class PackerTest(unittest.TestCase):
    """zip 导入：正常导入、拒绝穿越、拒绝非法 packId、卸载。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.user_dir = self.root / "user"
        self.user_dir.mkdir()
        self._patch = mock.patch.object(packer_mod, "USER_PACKS_DIR", self.user_dir)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()
        self._tmp.cleanup()

    def _zip(self, name, files):
        path = self.root / name
        with zipfile.ZipFile(path, "w") as zf:
            for arc, content in files.items():
                zf.writestr(arc, content)
        return path

    def test_import_ok(self):
        manifest = {"schema": 1, "packId": "my-pack", "name": "我的包",
                    "categories": [{"id": "c1", "name": "分类一", "file": "c1.json", "order": 10}]}
        cat = {"categories": [_category("c1", "分类一", "c1", [{"id": "i1", "name": "条目", "prompt": "p"}])]}
        path = self._zip("ok.zip", {
            "my-pack/pack.json": json.dumps(manifest, ensure_ascii=False),
            "my-pack/c1.json": json.dumps(cat, ensure_ascii=False),
        })
        pack = style_packs.import_pack(path)
        self.assertEqual(pack.pack_id, "my-pack")
        self.assertEqual(len(pack.categories), 1)
        self.assertTrue((self.user_dir / "my-pack" / "c1.json").is_file())

    def test_reject_zip_slip(self):
        manifest = {"schema": 1, "packId": "evil", "name": "evil", "categories": []}
        path = self._zip("evil.zip", {
            "evil/pack.json": json.dumps(manifest),
            "evil/../../escape.json": "{}",
        })
        # 越界条目被文件名校验过滤，结果只剩 pack.json，于是整包被拒，什么都不会落地
        with self.assertRaises(style_packs.PackError):
            style_packs.import_pack(path)
        self.assertFalse((self.root / "escape.json").exists())
        self.assertFalse((self.user_dir / "escape.json").exists())
        self.assertFalse((self.user_dir / "evil").exists())

    def test_reject_bad_pack_id(self):
        manifest = {"schema": 1, "packId": "../../etc", "name": "bad", "categories": []}
        path = self._zip("bad.zip", {"p/pack.json": json.dumps(manifest)})
        with self.assertRaises(style_packs.PackError):
            style_packs.import_pack(path)

    def test_reject_builtin_claim(self):
        manifest = {"schema": 1, "packId": "fake-core", "name": "fake", "builtin": True, "categories": []}
        path = self._zip("fake.zip", {"f/pack.json": json.dumps(manifest)})
        with self.assertRaises(style_packs.PackError):
            style_packs.import_pack(path)

    def test_uninstall(self):
        target = self.user_dir / "my-pack"
        target.mkdir(parents=True)
        _write_json(target / "pack.json", {"schema": 1, "packId": "my-pack", "categories": []})
        self.assertTrue(style_packs.uninstall_pack("my-pack"))
        self.assertFalse(target.exists())
        self.assertFalse(style_packs.uninstall_pack("my-pack"))


if __name__ == "__main__":
    unittest.main()
