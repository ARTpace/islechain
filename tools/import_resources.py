"""把离线资源包解压回项目根（数据/预设/缩略图）。

这些资源不进 git，仓库只留代码。换机器或重新 clone 后，用本脚本一条命令补齐：

    python tools/import_resources.py H:/AI-Tools/art-canvas-resources/art-canvas-data.zip
    python tools/import_resources.py H:/AI-Tools/art-canvas-resources/art-canvas-images.zip

常用选项：
    --dry-run        只列出会写入哪些文件，不落盘
    --force          覆盖已存在的同名文件（默认跳过，保留本地改动）
    --target <dir>   解到别的项目根，默认本仓库根目录

安全：拒绝绝对路径、.. 越界与符号链接条目；只允许写入 <target>/data 与 <target>/static。
"""

import argparse
import os
import sys
import zipfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
ALLOWED_PREFIXES = ("data/", "static/")


def _safe_target(base: Path, member: str) -> Path:
    """把 zip 条目解析成磁盘路径，越界直接抛错。"""
    normalized = member.replace("\\", "/")
    if normalized.startswith("/") or ":" in normalized.split("/")[0]:
        raise ValueError("绝对路径条目：%s" % member)
    parts = [p for p in normalized.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise ValueError("越界路径条目：%s" % member)
    if not normalized.startswith(ALLOWED_PREFIXES):
        raise ValueError("不在允许目录内（只接受 data/ 与 static/）：%s" % member)
    target = (base / Path(*parts)).resolve()
    if not str(target).startswith(str(base.resolve())):
        raise ValueError("条目解析后越界：%s" % member)
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description="把离线资源包解压回项目根")
    parser.add_argument("zips", nargs="+", help="资源包 zip 路径，可给多个")
    parser.add_argument("--target", default=str(BASE_DIR), help="项目根目录")
    parser.add_argument("--dry-run", action="store_true", help="只预览不落盘")
    parser.add_argument("--force", action="store_true", help="覆盖已存在文件")
    args = parser.parse_args()

    base = Path(args.target).resolve()
    if not (base / "main.py").is_file():
        print("目标目录不像项目根（缺 main.py）：%s" % base)
        return 1

    written = skipped = 0
    for zpath in args.zips:
        src = Path(zpath)
        if not src.is_file():
            print("找不到资源包：%s" % src)
            return 1

        with zipfile.ZipFile(src) as zf:
            members = [n for n in zf.namelist() if not n.endswith("/")]
            print("\n%s：%d 个文件" % (src.name, len(members)))
            for name in members:
                try:
                    dest = _safe_target(base, name)
                except ValueError as exc:
                    print("  跳过 %s（%s）" % (name, exc))
                    continue

                if dest.exists() and not args.force:
                    skipped += 1
                    continue
                if args.dry_run:
                    print("  将写入 %s" % dest.relative_to(base))
                    written += 1
                    continue

                dest.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(name) as fh, open(dest, "wb") as out:
                    out.write(fh.read())
                written += 1

    verb = "将写入" if args.dry_run else "已写入"
    print("\n%s %d 个文件，跳过 %d 个（已存在）" % (verb, written, skipped))
    if skipped and not args.force:
        print("如需覆盖请加 --force")
    if not args.dry_run and written:
        print("资源已就位，重启服务即可生效。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
