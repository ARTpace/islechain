import json
import tempfile
import unittest
from pathlib import Path

from tools.import_yuanbao_styles import import_package


class YuanbaoImportTests(unittest.TestCase):
    def test_preserves_library_prompts_and_backup_and_reimports_without_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package, home = root / "package", root / "home"
            (package / "images").mkdir(parents=True)
            (package / "images/a.webp").write_bytes(b"test-image")
            row = {"id": "abc", "name": "模板", "prompt": "完整提示词\n保留原文", "thumbnail_file": "images/a.webp",
                   "reference_files": ["images/a.webp"], "reference_images": ["https://example.com/ref"],
                   "generation_type": "image2image", "min_images": 1, "max_images": 2,
                   "upload_requirements": "建议上传人像", "categories": [
                       {"id": "all", "name": "全部"}, {"id": "one", "name": "海报\u200b"},
                       {"id": "two", "name": "创意"}], "source_metadata": {"tabId": "one"}}
            (package / "styles.json").write_text(json.dumps([row]), encoding="utf-8")
            (package / "report.json").write_text(json.dumps({"complete": True, "templates": 1}), encoding="utf-8")
            library = root / "style-presets.json"
            original = b'{"categories":[{"id":"existing","name":"old","subcategories":[]}],"custom":true}'
            library.write_bytes(original)
            result = import_package(package, library, home)
            self.assertEqual(Path(result["backup"]).read_bytes(), original)
            data = json.loads(library.read_text(encoding="utf-8"))
            self.assertTrue(data["custom"])
            self.assertEqual(data["categories"][0], json.loads(original)["categories"][0])
            group = data["categories"][1]["subcategories"][0]
            self.assertEqual(group["name"], "海报")
            preset = group["presets"][0]
            self.assertEqual(preset["prompt"], row["prompt"])
            self.assertIn("建议上传人像", preset["description"])
            self.assertEqual(preset["thumbnail"], "/api/thumbnails/yuanbao_a.webp")
            self.assertEqual(preset["reference_images"], [preset["thumbnail"]])
            self.assertEqual((home / "thumbnails/yuanbao_a.webp").read_bytes(), b"test-image")
            import_package(package, library, home)
            self.assertEqual(len(json.loads(library.read_text(encoding="utf-8"))["categories"]), 2)
            row["thumbnail_file"] = "../outside.webp"
            (package / "styles.json").write_text(json.dumps([row]), encoding="utf-8")
            before = library.read_bytes()
            with self.assertRaises(ValueError):
                import_package(package, library, home)
            self.assertEqual(library.read_bytes(), before)
            (package / "report.json").write_text('{"complete":false}', encoding="utf-8")
            with self.assertRaises(ValueError):
                import_package(package, library, home)
            self.assertEqual(library.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
