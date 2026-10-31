"""media_paths 落盘规则：目录层级、类型判定、自动登记、路径安全。

用 unittest（与 tests/ 下其它用例一致，不依赖 pytest）：
    python -m unittest tests.test_media_paths -v
"""
import os
import tempfile
import unittest
from unittest import mock

from core import media_paths


class MediaPathsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = self._tmp.name
        self._env = mock.patch.dict(os.environ, {"ART_CANVAS_HOME": self.home})
        self._env.start()
        self._reset_registry_cache()

    def tearDown(self):
        self._env.stop()
        self._tmp.cleanup()
        self._reset_registry_cache()

    def _reset_registry_cache(self):
        media_paths._cache["data"] = None
        media_paths._cache["stamp"] = None

    def parts(self, directory):
        return os.path.relpath(directory, media_paths.output_root()).split(os.sep)

    def media_type(self, directory):
        """目录倒数第三段即类型：{owner}/{type}/{feature}/{date}"""
        return self.parts(directory)[-3]

    # --- 目录层级 ---

    def test_layout_is_owner_type_feature_date(self):
        d, url = media_paths.resolve_media_dir(owner="alice", feature="zimage", kind="image", ext=".png")
        parts = self.parts(d)
        self.assertEqual(parts[0], "alice")
        self.assertEqual(parts[1], "image")
        self.assertEqual(parts[2], "zimage")
        self.assertEqual(len(parts), 4)          # owner/type/feature/date
        self.assertTrue(url.startswith("/output/alice/image/zimage/"))

    def test_empty_owner_skips_owner_level(self):
        d, url = media_paths.resolve_media_dir(owner="", feature="tts", kind="audio", ext=".wav")
        self.assertEqual(self.parts(d)[:2], ["audio", "tts"])
        self.assertTrue(url.startswith("/output/audio/tts/"))

    def test_blank_feature_uses_other(self):
        d, _ = media_paths.resolve_media_dir(owner="u", feature="", ext=".png")
        self.assertEqual(self.media_type(d), "image")
        self.assertEqual(self.parts(d)[-2], "other")

    # --- 类型判定 ---

    def test_type_falls_back_to_extension(self):
        cases = [(".mp4", "video"), (".wav", "audio"), (".png", "image"), ("out.mp4", "video")]
        for ext, expected in cases:
            with self.subTest(ext=ext):
                d, _ = media_paths.resolve_media_dir(owner="u", feature=f"m_{expected}", ext=ext)
                self.assertEqual(self.media_type(d), expected)

    def test_explicit_kind_overrides_auto_type(self):
        """同一模型既出图又出视频：首次 auto 登记不能把后续媒体锁死。"""
        media_paths.resolve_media_dir(owner="u", feature="dual", kind="image", ext=".png")
        d, _ = media_paths.resolve_media_dir(owner="u", feature="dual", kind="video", ext=".mp4")
        self.assertEqual(self.media_type(d), "video")

    def test_manual_registry_type_wins_over_explicit(self):
        """人工登记的 type 是权威，不被调用方误传覆盖。"""
        media_paths.resolve_media_dir(owner="u", feature="抠图", kind="video", ext=".mp4")
        d, _ = media_paths.resolve_media_dir(owner="u", feature="抠图", ext=".png")
        parts = self.parts(d)
        self.assertEqual(parts[-3], "image")
        self.assertEqual(parts[-2], "cutout")     # 注册表指定的 latin 目录名

    # --- 自动登记 ---

    def test_unknown_feature_registered_on_first_write(self):
        media_paths.resolve_media_dir(owner="u", feature="brand_new_model", kind="image", ext=".png")
        entry = media_paths.registry()["features"]["brand_new_model"]
        self.assertTrue(entry["auto"])
        self.assertEqual(entry["type"], "image")
        self.assertTrue(os.path.isfile(media_paths.user_registry_path()))

    # --- 路径安全 ---

    def test_traversal_is_contained(self):
        d, url = media_paths.resolve_media_dir(owner="../../evil", feature="../../evil", ext=".png")
        root = os.path.abspath(media_paths.output_root())
        self.assertTrue(os.path.abspath(d).startswith(root))
        self.assertNotIn("..", os.path.relpath(d, root).split(os.sep))
        self.assertFalse(any(seg in ("..", ".") for seg in url.split("/")))

    def test_malicious_feature_not_learned(self):
        media_paths.resolve_media_dir(owner="u", feature="../../evil", ext=".png")
        self.assertNotIn("../../evil", media_paths.registry()["features"])


if __name__ == "__main__":
    unittest.main()
