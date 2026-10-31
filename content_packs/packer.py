"""内容包的导入、导出与卸载（与包类型无关）。

导入的是 zip，内部结构可以是：
    my-pack/pack.json + my-pack/<数据>.json      （推荐，多套一层目录）
    pack.json + <数据>.json                      （也接受，根目录平铺）

安全检查：拒绝绝对路径与 .. 穿越、限制解压总体积、只接受单层 json 文件。
包类型差异只体现在 required_files（例如角色包必须有 index.json）与提示语。
"""

import json
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

from .manifest import load_manifest
from .paths import (
    MANIFEST_NAME,
    MAX_PACK_BYTES,
    is_safe_filename,
    is_valid_pack_id,
)


class PackError(Exception):
    """导入内容包失败，消息可直接展示给用户。"""


def _find_manifest_root(names) -> Optional[str]:
    """在 zip 的条目名里找出 pack.json 所在的前缀（支持多套一层目录）。"""
    candidates = [
        n for n in names
        if n.replace("\\", "/").endswith("/" + MANIFEST_NAME) or n == MANIFEST_NAME
    ]
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


def import_pack(zip_path, *, dest_root, kind="", display_name="内容包",
                required_files=(), replace: bool = False,
                log_tag="content_packs"):
    """导入一个内容包 zip 到 dest_root，返回导入后的 ContentManifest。"""
    zip_path = Path(zip_path)
    dest_root = Path(dest_root)
    if not zip_path.is_file():
        raise PackError("文件不存在：%s" % zip_path)

    try:
        zf = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile:
        raise PackError("不是有效的 zip 文件")

    with zf:
        manifest_name = _find_manifest_root(zf.namelist())
        if not manifest_name:
            raise PackError("压缩包内缺少 %s，无法识别为%s" % (MANIFEST_NAME, display_name))
        prefix = manifest_name[: -len(MANIFEST_NAME)]
        # 目录前缀本身也可能是穿越路径（如 "../evil/pack.json"），
        # 虽然解压时只取文件名不会真的越界，但这种包一律拒绝。
        _raw_prefix = prefix.replace("\\", "/")
        if _raw_prefix.startswith("/") or ".." in [p for p in _raw_prefix.split("/") if p]:
            raise PackError("压缩包内含越界路径：%s" % manifest_name)
        data = _read_zip_manifest(zf, manifest_name)

        pack_id = str(data.get("packId") or "").strip()
        if not is_valid_pack_id(pack_id):
            raise PackError("packId 非法（要求小写字母数字与连字符，2~40 位）：%r" % pack_id)
        if data.get("builtin"):
            raise PackError("用户导入的包不能声明 builtin，请移除该字段")

        target = dest_root / pack_id
        if target.exists() and not replace:
            raise PackError("已存在同名%s %s，如需覆盖请选择覆盖安装" % (display_name, pack_id))

        dest_root.mkdir(parents=True, exist_ok=True)
        temp_root = Path(tempfile.mkdtemp(prefix="pack-", dir=str(dest_root)))
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
                    raise PackError(
                        "压缩包解压后超过 %d MB 上限" % (MAX_PACK_BYTES // 1024 // 1024)
                    )
                dst = _safe_member_path(temp_root, rel)
                dst.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(dst, "wb") as out:
                    shutil.copyfileobj(src, out)
                if rel != MANIFEST_NAME:
                    extracted += 1

            if extracted == 0:
                raise PackError(
                    "压缩包里没有数据文件（只有 %s 不算%s）" % (MANIFEST_NAME, display_name)
                )

            manifest = load_manifest(
                temp_root, kind=kind, builtin=False,
                log_tag=log_tag, required_files=required_files,
            )
            if not manifest:
                raise PackError("%s 校验未通过" % MANIFEST_NAME)

            # 清单里登记了必需文件不算数，文件必须真的在包里
            absent = [name for name in required_files if not (temp_root / name).is_file()]
            if absent:
                raise PackError("压缩包缺少必需文件：%s" % ", ".join(absent))

            if target.exists():
                shutil.rmtree(target, ignore_errors=True)
            os.replace(str(temp_root), str(target))
            temp_root = None
            return load_manifest(
                target, kind=kind, builtin=False,
                log_tag=log_tag, required_files=required_files,
            )
        finally:
            if temp_root and temp_root.exists():
                shutil.rmtree(temp_root, ignore_errors=True)


def export_pack_dir(src_dir, pack_id: str, out_path):
    """把一个已存在的包目录导出成 zip，方便分享或另存。"""
    if not is_valid_pack_id(pack_id):
        raise PackError("packId 非法：%r" % pack_id)
    src_dir = Path(src_dir)
    if not src_dir.is_dir():
        raise PackError("包不存在：%s" % pack_id)

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(src_dir.rglob("*.json")):
            arc = "%s/%s" % (pack_id, path.relative_to(src_dir).as_posix())
            zf.write(path, arc)
    return out_path


def uninstall_pack(pack_id: str, *, dest_root) -> bool:
    """删除 dest_root 下的包目录（内置包由调用方挡在前面）。"""
    if not is_valid_pack_id(pack_id):
        raise PackError("packId 非法：%r" % pack_id)
    target = Path(dest_root) / pack_id
    if not target.is_dir():
        return False
    shutil.rmtree(target, ignore_errors=True)
    return not target.exists()
