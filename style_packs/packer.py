"""风格包的导入、导出与卸载。

导入的是 zip，内部结构可以是：
    my-pack/pack.json + my-pack/photography.json      （推荐）
    pack.json + photography.json                       （也接受，根目录平铺）

安全检查：拒绝绝对路径与 .. 穿越、限制解压总体积、只接受 json 文件。
"""

import io
import json
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

from .manifest import load_manifest, parse_manifest
from .paths import (
    MANIFEST_NAME,
    MAX_PACK_BYTES,
    PACK_ID_PATTERN,
    USER_PACKS_DIR,
    is_safe_filename,
    is_valid_pack_id,
)


class PackError(Exception):
    """导入风格包失败，消息可直接展示给用户。"""


def _find_manifest_root(names) -> Optional[str]:
    """在 zip 的条目名里找出 pack.json 所在的前缀（支持多套一层目录）。"""
    candidates = [n for n in names if n.replace("\\", "/").endswith("/" + MANIFEST_NAME) or n == MANIFEST_NAME]
    if not candidates:
        return None
    # 取层级最浅的那个
    return min(candidates, key=lambda n: n.count("/"))


def _safe_member_path(base: Path, member: str) -> Path:
    """把 zip 条目解析成磁盘路径，任何越界都抛错。"""
    normalized = member.replace("\\", "/")
    if normalized.startswith("/") or ":" in normalized.split("/")[0]:
        raise PackError("压缩包内含绝对路径条目：%s" % member)
    parts = [p for p in normalized.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise PackError("压缩包内含越界路径：%s" % member)
    target = base.joinpath(*parts).resolve()
    if not str(target).startswith(str(base.resolve())):
        raise PackError("压缩包条目越界：%s" % member)
    return target


def _read_zip_manifest(zf: zipfile.ZipFile, manifest_name: str) -> dict:
    try:
        raw = zf.read(manifest_name)
    except KeyError:
        raise PackError("压缩包内找不到 %s" % MANIFEST_NAME)
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise PackError("pack.json 不是合法的 UTF-8 JSON：%s" % exc)
    if not isinstance(data, dict):
        raise PackError("pack.json 顶层必须是对象")
    return data


def import_pack(zip_path, replace: bool = False):
    """导入一个风格包 zip，返回导入后的 PackManifest。"""
    zip_path = Path(zip_path)
    if not zip_path.is_file():
        raise PackError("文件不存在：%s" % zip_path)

    try:
        zf = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile:
        raise PackError("不是有效的 zip 文件")

    with zf:
        manifest_name = _find_manifest_root(zf.namelist())
        if not manifest_name:
            raise PackError("压缩包内缺少 pack.json，无法识别为风格包")
        prefix = manifest_name[: -len(MANIFEST_NAME)]
        data = _read_zip_manifest(zf, manifest_name)

        pack_id = str(data.get("packId") or "").strip()
        if not is_valid_pack_id(pack_id):
            raise PackError("packId 非法（要求小写字母数字与连字符，2~40 位）：%r" % pack_id)
        if data.get("builtin"):
            raise PackError("用户导入的包不能声明 builtin，请移除该字段")

        target = USER_PACKS_DIR / pack_id
        if target.exists() and not replace:
            raise PackError("已存在同名风格包 %s，如需覆盖请选择覆盖安装" % pack_id)

        USER_PACKS_DIR.mkdir(parents=True, exist_ok=True)
        temp_root = Path(tempfile.mkdtemp(prefix="pack-", dir=str(USER_PACKS_DIR)))
        try:
            total = 0
            extracted = 0
            for info in zf.infolist():
                if info.is_dir():
                    continue
                name = info.filename
                if not name.startswith(prefix):
                    continue
                rel = name[len(prefix):]
                if not rel or not is_safe_filename(rel):
                    # 只接受单层 json 文件，忽略子目录与其它杂项
                    continue
                total += info.file_size
                if total > MAX_PACK_BYTES:
                    raise PackError("压缩包解压后超过 %d MB 上限" % (MAX_PACK_BYTES // 1024 // 1024))
                dst = _safe_member_path(temp_root, rel)
                dst.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(dst, "wb") as out:
                    shutil.copyfileobj(src, out)
                if rel != MANIFEST_NAME:
                    extracted += 1

            if extracted == 0:
                raise PackError("压缩包里没有分类文件（只有 pack.json 不算风格包）")

            manifest = load_manifest(temp_root, builtin=False)
            if not manifest:
                raise PackError("pack.json 校验未通过")

            if target.exists():
                shutil.rmtree(target, ignore_errors=True)
            os.replace(str(temp_root), str(target))
            temp_root = None
            return load_manifest(target, builtin=False)
        finally:
            if temp_root and temp_root.exists():
                shutil.rmtree(temp_root, ignore_errors=True)


def export_pack(pack_id: str, out_path, builtin: bool = False):
    """把一个包（含内置包）导出成 zip，方便分享或另存。"""
    if not is_valid_pack_id(pack_id):
        raise PackError("packId 非法：%r" % pack_id)
    root = (Path(__file__).resolve().parent.parent / "data" / "style-packs") if builtin else USER_PACKS_DIR
    src = root / pack_id
    if not src.is_dir():
        raise PackError("包不存在：%s" % pack_id)

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(src.rglob("*.json")):
            arc = "%s/%s" % (pack_id, path.relative_to(src).as_posix())
            zf.write(path, arc)
    return out_path


def uninstall_pack(pack_id: str) -> bool:
    """卸载用户包（内置包不可卸载）。"""
    if not is_valid_pack_id(pack_id):
        raise PackError("packId 非法：%r" % pack_id)
    target = USER_PACKS_DIR / pack_id
    if not target.is_dir():
        return False
    shutil.rmtree(target, ignore_errors=True)
    return not target.exists()
