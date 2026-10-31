"""把元宝下载数据包接入现有风格库，复用 /api/thumbnails，不改后端接口。"""
import argparse
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))
from core.user_paths import user_data_dir


def clean_name(value):
    return re.sub(r"[\u200b-\u200d\ufeff]", "", value).strip()


def build_category(rows, local_image, online=False):
    groups = {}
    seen = set()
    for row in rows:
        source_id = row["id"]
        if source_id in seen or not re.fullmatch(r"[a-zA-Z0-9_-]+", source_id):
            raise ValueError(f"模板 ID 重复或无效：{source_id}")
        seen.add(source_id)
        if not row.get("prompt", "").strip():
            raise ValueError(f"模板缺少提示词：{row.get('name', source_id)}")
        metadata = row.get("source_metadata", {})
        memberships = [c for c in row.get("categories", []) if clean_name(c["name"]) != "全部"]
        # ponytail: 每条风格只放一个主分类，避免现有风格选择器跨子分类重复计数。
        primary = next((c for c in memberships if c["id"] == metadata.get("tabId")),
                       memberships[0] if memberships else {"id": "uncategorized", "name": "未分类"})
        group_id = "yuanbao_" + primary["id"]
        group = groups.setdefault(group_id, {"id": group_id, "name": clean_name(primary["name"]), "presets": []})
        notes = ["腾讯元宝", "图生图" if row.get("generation_type") == "image2image" else "文生图"]
        tip = row.get("upload_requirements")
        if isinstance(tip, list):
            tip = "；".join(dict.fromkeys(tip))
        if tip:
            notes.append(tip)
        minimum, maximum = row.get("min_images"), row.get("max_images")
        if maximum:
            notes.append(f"参考图 {minimum or 0}–{maximum} 张")
        reference_urls = row.get("reference_images", [])
        reference_files = row.get("reference_files", [])
        preset = {
            "id": "yuanbao_" + source_id,
            "name": row["name"],
            "type": "prompt",
            "prompt": row["prompt"],
            "negative_prompt": "",
            "description": " · ".join(notes),
            "thumbnail": row["thumbnail"] if online else local_image(row["thumbnail_file"]),
            "reference_images": reference_urls if online else [local_image(file) for file in reference_files],
            "source": {
                "provider": "腾讯元宝", "template_id": source_id,
                "url": "https://yuanbao.tencent.com/chat/ai-creation",
                "categories": [{**c, "name": clean_name(c["name"])} for c in row.get("categories", [])],
                "generation_type": row.get("generation_type"),
                "min_images": minimum, "max_images": maximum,
                "reference_image_urls": reference_urls,
                "thumbnail_url": row.get("thumbnail"),
                "requires_portrait_authorization": metadata.get("requiresPortraitAuthorization", False),
            },
        }
        group["presets"].append(preset)
    return {"id": "yuanbao", "name": "腾讯元宝", "subcategories": list(groups.values())}


def import_package(package, library, home, online=False):
    package, library, home = Path(package).resolve(), Path(library).resolve(), Path(home).resolve()
    report = json.loads((package / "report.json").read_text(encoding="utf-8"))
    if not report.get("complete") or report.get("failures") or report.get("missingPrompts"):
        raise ValueError("下载数据包尚不完整，请先完成下载并查看 report.json")
    rows = json.loads((package / "styles.json").read_text(encoding="utf-8"))
    if not rows or len(rows) != report.get("templates"):
        raise ValueError("数据包模板数与报告不一致")
    original = library.read_bytes()
    data = json.loads(original)
    if not isinstance(data.get("categories"), list):
        raise ValueError("目标风格库结构无效")
    images = {}

    def local_image(relative):
        source = (package / relative).resolve()
        if not source.is_relative_to(package / "images") or not source.is_file() or not source.stat().st_size:
            raise ValueError(f"缺少有效本地图片：{relative}")
        if not re.fullmatch(r"[a-zA-Z0-9_.-]+", source.name):
            raise ValueError(f"图片文件名不适合缩略图接口：{relative}")
        target = home / "thumbnails" / ("yuanbao_" + source.name)
        images[source] = target
        return "/api/thumbnails/" + target.name

    category = build_category(rows, local_image, online=online)
    existing = next((i for i, c in enumerate(data["categories"]) if c.get("id") == "yuanbao"), None)
    if existing is None:
        data["categories"].append(category)
    else:
        data["categories"][existing] = category
    for source, target in images.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.read_bytes() != source.read_bytes():
                raise ValueError(f"目标已有同名但内容不同的图片，未覆盖：{target}")
        else:
            shutil.copy2(source, target)
    backup_dir = home / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / f"style-presets.before-yuanbao.{uuid4().hex}.json"
    backup.write_bytes(original)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=library.parent, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        if library.read_bytes() != original:
            raise RuntimeError("导入期间风格库被其他操作修改，已停止写入；请重新运行")
        os.replace(temporary, library)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return {"templates": len(rows), "subcategories": len(category["subcategories"]),
            "local_images": len(images), "library": str(library), "backup": str(backup),
            "thumbnails": str(home / "thumbnails")}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path, help="包含 styles.json、report.json、images/ 的下载目录")
    parser.add_argument("--library", type=Path, default=PROJECT_DIR / "data/style-presets.json")
    parser.add_argument("--home", type=Path, default=Path(user_data_dir()))
    parser.add_argument("--online", action="store_true", help="使用原始在线图片地址，不复制图片")
    args = parser.parse_args()
    print(json.dumps(import_package(args.package, args.library, args.home, online=args.online), ensure_ascii=False, indent=2))
