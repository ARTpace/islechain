"""画师数据抓取工具：从 anima.mooshieblob.com 拉取官方画师索引。

用法：
    python tools/artist_pack_fetch.py fetch            # 自动发现最新 release 并下载
    python tools/artist_pack_fetch.py fetch --release 20260425_anima_all_artists
    python tools/artist_pack_fetch.py show             # 只看远端当前 release 与统计，不下载

数据来源（站点 Anima Style Explorer 自己用的接口）：
    站点首页 /assets/index-*.js 里写着 manifest 地址，形如
    https://cdn.mooshieblob.com/<release>/indices/manifest.json

    manifest.json   声明 releasePrefix / imageBaseUrl / shards / searchIndex
    search.json     全量索引：slug / tag / imageId / postCount（本工具只下这一个）
    shards/<x>.json 分桶明细（含 aliases 与全部图片变体，默认不下）

图片地址规则（来自站点前端）：
    <imageBaseUrl>/<releasePrefix>/images/<imageId>.avif

产物（不进 git，仅本机拆包原料）：
    data/artist-packs-source/<release>/manifest.json
    data/artist-packs-source/<release>/search.json
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_ROOT = ROOT / "data" / "artist-packs-source"

SITE_URL = "https://anima.mooshieblob.com/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) art-canvas"
MANIFEST_PATTERN = re.compile(
    r"https://cdn\.mooshieblob\.com/[A-Za-z0-9_.-]+/indices/manifest\.json"
)


def http_get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def http_json(url: str, timeout: int = 60):
    return json.loads(http_get(url, timeout).decode("utf-8"))


def discover_manifest_url() -> str:
    """从站点页面与主脚本里找出 manifest 地址（release 更新后自动跟随）。"""
    html = http_get(SITE_URL).decode("utf-8", "ignore")
    found = MANIFEST_PATTERN.findall(html)
    if found:
        return found[0]
    for src in re.findall(r'src="(/assets/[^"]+\.js)"', html):
        try:
            script = http_get(SITE_URL.rstrip("/") + src).decode("utf-8", "ignore")
        except Exception:
            continue
        found = MANIFEST_PATTERN.findall(script)
        if found:
            return found[0]
    raise RuntimeError("未能在站点脚本中找到 manifest 地址，请用 --manifest 手动指定")


def manifest_url_of(release: str) -> str:
    return "https://cdn.mooshieblob.com/%s/indices/manifest.json" % release


def resolve_manifest(manifest_url: str = "", release: str = "") -> dict:
    """取 manifest，并补齐它自己没写全的派生字段。"""
    url = manifest_url or (manifest_url_of(release) if release else discover_manifest_url())
    data = http_json(url)
    release_prefix = str(data.get("releasePrefix") or "")
    base = str(data.get("imageBaseUrl") or "").rstrip("/")
    if not release_prefix or not base:
        raise RuntimeError("manifest 缺少 releasePrefix/imageBaseUrl：%s" % url)
    # indices/ 是 manifest 所在目录，shard 与 search 都相对它
    indices_dir = url.rsplit("/", 1)[0] + "/"
    data["_manifestUrl"] = url
    data["_indicesDir"] = indices_dir
    data["_imageBase"] = "%s/%s/images/" % (base, release_prefix)
    return data


def source_dir_of(manifest: dict) -> Path:
    return SOURCE_ROOT / str(manifest["releasePrefix"])


def cmd_show(args):
    manifest = resolve_manifest(args.manifest, args.release)
    print("manifest : %s" % manifest["_manifestUrl"])
    print("release  : %s" % manifest["releasePrefix"])
    print("画师总数 : %s" % manifest.get("artistCount"))
    print("有图     : %s" % manifest.get("artistsWithImage"))
    print("图片目录 : %s" % manifest["_imageBase"])
    print("索引文件 : %s%s" % (manifest["_indicesDir"], (manifest.get("searchIndex") or {}).get("path", "")))
    print("生成时间 : %s" % manifest.get("generatedAt"))
    return 0


def cmd_fetch(args):
    manifest = resolve_manifest(args.manifest, args.release)
    release = str(manifest["releasePrefix"])
    target = source_dir_of(manifest)
    target.mkdir(parents=True, exist_ok=True)

    search_path = str((manifest.get("searchIndex") or {}).get("path") or "search.json")
    url = manifest["_indicesDir"] + search_path
    print("下载索引 %s" % url)
    raw = http_get(url, timeout=180)
    entries = json.loads(raw.decode("utf-8"))
    if not isinstance(entries, list) or not entries:
        raise RuntimeError("索引内容异常：期望非空数组，实际 %s" % type(entries).__name__)
    print("  %d 条  %.1f MB" % (len(entries), len(raw) / 1048576))

    _write_json(target / "search.json", entries)
    _write_json(target / "manifest.json", {
        key: manifest.get(key) for key in
        ("version", "releasePrefix", "imageBaseUrl", "artistCount",
         "artistsWithImage", "generatedAt")
    } | {"imageBase": manifest["_imageBase"], "source": manifest["_manifestUrl"]})
    print("已保存到 %s" % target)
    return 0


def _write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    os.replace(tmp, path)


def latest_source_dir() -> Path:
    """取本机已下载的最新 release 目录（按目录名倒序，名字带日期前缀）。"""
    if not SOURCE_ROOT.is_dir():
        raise RuntimeError("尚未下载任何画师源数据，请先执行 fetch")
    dirs = [p for p in SOURCE_ROOT.iterdir() if p.is_dir() and (p / "search.json").is_file()]
    if not dirs:
        raise RuntimeError("源数据目录里没有 search.json，请重新执行 fetch")
    return sorted(dirs, key=lambda p: p.name)[-1]


def main():
    parser = argparse.ArgumentParser(description="画师数据抓取")
    sub = parser.add_subparsers(dest="cmd")
    for name in ("fetch", "show"):
        p = sub.add_parser(name)
        p.add_argument("--release", default="", help="指定 release，如 20260425_anima_all_artists")
        p.add_argument("--manifest", default="", help="直接指定 manifest.json 地址")
    args = parser.parse_args()
    cmd = args.cmd or "fetch"
    if cmd == "show":
        return cmd_show(args)
    return cmd_fetch(args)


if __name__ == "__main__":
    sys.exit(main())
