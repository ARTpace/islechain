#!/usr/bin/env python3
"""全量导入 OpenNana（无数量限制）"""
import urllib.request, json, os, time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = Path(__file__).resolve().parent.parent.parent  # art-canvas/
DATA = BASE / "data"
OUT_FILE = DATA / "style-presets.json"
I18N_FILE = DATA / "style-i18n.json"
CACHE_DIR = Path(__file__).resolve().parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

API = "https://api.opennana.com"
HDR = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
WORKERS = 12


def api(path, params=None):
    url = f"{API}{path}"
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    for i in range(3):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=HDR), timeout=15)
            return json.loads(r.read())
        except:
            if i == 2: raise
            time.sleep(0.3)


def get_all_slugs():
    slugs = []
    page = 1
    while True:
        d = api("/api/prompts", {"limit": 100, "page": page})
        items = d.get("data", {}).get("items", [])
        pag = d.get("data", {}).get("pagination", {})
        for it in items:
            if it.get("slug") and not it.get("_is_sponsor") and it.get("media_type") == "image":
                slugs.append({"id": it["id"], "slug": it["slug"], "title": it.get("title",""),
                              "cover": it.get("cover_image","")})
        if not pag.get("has_more") or page >= pag.get("total_pages", 0):
            break
        page += 1
        if page % 20 == 0:
            print(f"  slugs: {len(slugs)} (page {page}/{pag.get('total_pages',0)})")
        time.sleep(0.05)
    return slugs


def get_detail(slug):
    cf = CACHE_DIR / f"{slug}.json"
    if cf.exists():
        return json.loads(cf.read_text("utf-8"))
    try:
        d = api(f"/api/prompts/{slug}")
        if d.get("status") == 200:
            det = d.get("data", d)
            cf.write_text(json.dumps(det, ensure_ascii=False), "utf-8")
            return det
    except:
        pass
    return None


def classify(title, prompt):
    t = (title + " " + prompt).lower()
    if any(x in t for x in ['photo','portrait','dslr','camera','bokeh','shallow depth','golden hour','headshot']):
        return "photography"
    if any(x in t for x in ['cinematic','film grain','anamorphic','dramatic lighting']):
        return "film_cinema"
    if any(x in t for x in ['anime','manga','ghibli','chibi','kawaii','cartoon']):
        return "anime_manga"
    if any(x in t for x in ['oil paint','watercolor','gouache','sketch','drawing','pencil','charcoal','ink wash']):
        return "painting"
    if any(x in t for x in ['3d','render','blender','octane','isometric','low poly','voxel','cgi']):
        return "digital_3d"
    if any(x in t for x in ['poster','banner','flyer','layout','infographic','typography','logo','brand','packaging','ui design']):
        return "commercial"
    if any(x in t for x in ['retro','vintage','nostalgic','sepia','polaroid']):
        return "retro"
    if any(x in t for x in ['sculpture','craft','paper art','origami','textile']):
        return "crafts"
    if any(x in t for x in ['art style','abstract','surreal','expressionist','impressionist']):
        return "art_movements"
    return "misc"


def main():
    t0 = time.time()
    print("=" * 50)
    print("  OpenNana 全量导入")
    print("=" * 50)

    # 1. 获取所有 slug
    print("\n[1/3] 获取 slug 列表...")
    slugs = get_all_slugs()
    print(f"  共 {len(slugs)} 个 ({time.time()-t0:.1f}s)")

    # 2. 并发抓详情（全量，已缓存的秒回）
    print(f"\n[2/3] 抓取详情 ({WORKERS}并发, 已缓存的跳过)...")
    results = {}
    done = 0

    def fetch(it):
        return it["slug"], get_detail(it["slug"])

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(fetch, s): s for s in slugs}
        for f in as_completed(futs):
            slug, det = f.result()
            if det:
                results[slug] = det
            done += 1
            if done % 200 == 0:
                print(f"  {done}/{len(slugs)} ({len(results)} ok, {time.time()-t0:.1f}s)")

    print(f"  完成: {len(results)} 个 ({time.time()-t0:.1f}s)")

    # 3. 转换合并
    print(f"\n[3/3] 转换合并...")
    existing = json.loads(OUT_FILE.read_text("utf-8")) if OUT_FILE.exists() else {"categories": []}
    exist_ids = set()
    for c in existing.get("categories", []):
        for s in c.get("subcategories", []):
            for p in s.get("presets", []):
                exist_ids.add(p["id"])

    cat_names = {"photography":"摄影","film_cinema":"电影感","anime_manga":"动漫","painting":"绘画",
                 "digital_3d":"数字3D","commercial":"商业设计","retro":"复古","crafts":"手工艺",
                 "art_movements":"艺术风格","misc":"综合"}
    added = 0
    for slug, det in results.items():
        prompts = det.get("prompts", [])
        zh, en = "", ""
        for p in prompts:
            if isinstance(p, dict):
                if p.get("type") == "zh": zh = p.get("text","").strip()
                elif p.get("type") == "en": en = p.get("text","").strip()
        prompt = zh or en
        if not prompt or len(prompt) < 20:
            continue

        pid = f"opennana_{slug}"
        if pid in exist_ids:
            continue

        title = det.get("title","")
        model = det.get("model","")
        cover = det.get("cover_image","") or (det.get("images",[None]) or [None])[0] or ""
        cat = classify(title, prompt)

        if "{subject}" not in prompt:
            prompt = "{subject}, " + prompt

        preset = {"id":pid, "name":title or prompt[:30], "type":"prompt",
                  "prompt":prompt, "negative_prompt":"",
                  "description":model, "thumbnail":cover}

        cat_obj = next((c for c in existing["categories"] if c["id"]==cat), None)
        if not cat_obj:
            cat_obj = {"id":cat,"name":cat_names.get(cat,cat),"subcategories":[{"id":cat,"name":cat,"presets":[]}]}
            existing["categories"].append(cat_obj)
        subs = cat_obj["subcategories"]
        if not subs:
            subs.append({"id":cat,"name":cat,"presets":[]})
        subs[0]["presets"].append(preset)
        exist_ids.add(pid)
        added += 1

    OUT_FILE.write_text(json.dumps(existing, ensure_ascii=False, indent=2), "utf-8")

    # i18n
    i18n = json.loads(I18N_FILE.read_text("utf-8")) if I18N_FILE.exists() else {"categories":{},"subcategories":{},"presets":{}}
    for c in existing["categories"]:
        for s in c.get("subcategories",[]):
            for p in s.get("presets",[]):
                if p["id"] not in i18n.get("presets",{}):
                    i18n.setdefault("presets",{})[p["id"]] = p["name"]
    I18N_FILE.write_text(json.dumps(i18n, ensure_ascii=False, indent=2), "utf-8")

    total = sum(len(s.get("presets",[])) for c in existing["categories"] for s in c.get("subcategories",[]))
    print(f"\n  新增: {added}")
    print(f"  总计: {total} 预设 ({len(existing['categories'])} 分类)")
    print(f"  耗时: {time.time()-t0:.1f}s")
    print(f"  缓存: {len(list(CACHE_DIR.iterdir()))} 文件")


if __name__ == "__main__":
    main()
