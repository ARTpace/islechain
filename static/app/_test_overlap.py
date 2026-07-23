#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
复现"新生成图片与现有卡片重叠"bug。
先通过 mock data API 或 pushNewImage 循环塞入多张图，建立 column 布局，
然后 prepend 一张新图，看是否 overlap。
"""
from playwright.sync_api import sync_playwright
import os, time

OUT = r"C:\Users\zhengyuliang\.qclaw\workspace-agent-a9e0dff1\screenshots"
os.makedirs(OUT, exist_ok=True)

# 准备几张不同尺寸的测试图（让 column 布局填出 2 列以上）
def make_test_png(name, w, h, rgb):
    path = os.path.join(OUT, f"_test_{name}.png")
    if not os.path.exists(path):
        import subprocess
        subprocess.run(["powershell", "-Command", f"""
            Add-Type -AssemblyName System.Drawing
            $bmp = New-Object System.Drawing.Bitmap({w}, {h})
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.Clear([System.Drawing.Color]::FromArgb(255, {rgb[0]}, {rgb[1]}, {rgb[2]}))
            $bmp.Save('{path}', [System.Drawing.Imaging.ImageFormat]::Png)
            $g.Dispose(); $bmp.Dispose()
        """], check=True)
    return path

# 5 张不同尺寸的图
images = [
    make_test_png("a", 800, 600, (220, 80, 80)),
    make_test_png("b", 800, 1200, (80, 220, 100)),
    make_test_png("c", 800, 1000, (80, 120, 220)),
    make_test_png("d", 800, 700, (220, 180, 80)),
    make_test_png("e", 800, 1400, (180, 80, 220)),
]
# 验证文件
for p in images:
    print(f"  exists: {p} -> {os.path.exists(p)} ({os.path.getsize(p) if os.path.exists(p) else 0} bytes)")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    
    # 拦截 history API：返回我们自己的 mock 数据
    def handle_route(route):
        if "/api/history" in route.request.url:
            import json
            base = "http://localhost:9099/static/app"
            records = []
            # 时间戳从旧到新，方便自然 prepend 时 prepend 是最新的
            now = int(time.time() * 1000)
            for i, p in enumerate(images):
                ts = now - (len(images) - i) * 60000  # 旧到新
                fname = os.path.basename(p)
                records.append({
                    "timestamp": ts,
                    "type": "t2i",
                    "prompt": f"test {i+1}",
                    "images": [f"{base}/_test_{fname}"],
                    "model": "test",
                })
            route.fulfill(status=200, content_type="application/json", body=json.dumps(records))
        else:
            route.continue_()
    ctx.route("**/*", handle_route)
    
    pg.goto("http://localhost:9099/static/app/zimage.html", wait_until="domcontentloaded", timeout=20000)
    pg.wait_for_timeout(4000)
    
    n0 = pg.evaluate("document.querySelectorAll('.masonry-item').length")
    print(f"\nInitial cards loaded from API: {n0}")
    
    # 拿到所有卡片位置
    layout_before = pg.evaluate("""() => {
        return Array.from(document.querySelectorAll('.masonry-item')).map((c, i) => {
            const r = c.getBoundingClientRect();
            return { i, id: c.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        });
    }""")
    print(f"\nLayout BEFORE prepend:")
    for item in layout_before:
        print(f"  [{item['i']}] {item['id']} x={item['x']} y={item['y']} w={item['w']} h={item['h']}")
    
    pg.screenshot(path=f"{OUT}\\overlap_before.png", full_page=False)
    
    # 模拟推送一张新图
    future_ts = int(time.time() * 1000) + 99999999
    img_url = "http://localhost:9099/static/app/_overlap_test.png"
    
    pg.evaluate(f"""(args) => {{
        const record = {{
            timestamp: args.ts,
            type: 't2i',
            prompt: 'NEW: overlap test',
            images: [args.url],
            model: 'test',
        }};
        window.GalleryList.pushNewImage(record, {{ eagerFirstImage: true }});
    }}""", {"ts": future_ts, "url": img_url})
    
    # 立即看
    pg.wait_for_timeout(50)
    layout_50ms = pg.evaluate("""() => {
        return Array.from(document.querySelectorAll('.masonry-item')).map((c, i) => {
            const r = c.getBoundingClientRect();
            return { i, id: c.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        });
    }""")
    print(f"\nLayout 50ms after prepend:")
    for item in layout_50ms:
        print(f"  [{item['i']}] {item['id']} x={item['x']} y={item['y']} w={item['w']} h={item['h']}")
    
    pg.screenshot(path=f"{OUT}\\overlap_50ms.png", full_page=False)
    
    # 等图片加载完成
    pg.wait_for_timeout(3000)
    layout_after = pg.evaluate("""() => {
        return Array.from(document.querySelectorAll('.masonry-item')).map((c, i) => {
            const r = c.getBoundingClientRect();
            return { i, id: c.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        });
    }""")
    print(f"\nLayout 3s after prepend (loaded):")
    for item in layout_after:
        print(f"  [{item['i']}] {item['id']} x={item['x']} y={item['y']} w={item['w']} h={item['h']}")
    
    pg.screenshot(path=f"{OUT}\\overlap_after.png", full_page=False)
    
    # 检查 overlap
    def overlap_area(a, b):
        ix = max(0, min(a['x']+a['w'], b['x']+b['w']) - max(a['x'], b['x']))
        iy = max(0, min(a['y']+a['h'], b['y']+b['h']) - max(a['y'], b['y']))
        return ix * iy
    
    if len(layout_after) >= 2:
        o = overlap_area(layout_after[0], layout_after[1])
        print(f"\n[50ms] Overlap new vs next: {o}")
        o_loaded = overlap_area(layout_after[0], layout_after[1]) if len(layout_after) >= 2 else 0
        print(f"[3s]   Overlap new vs next: {o_loaded}")
        if max(o, o_loaded) > 100:
            print("❌ BUG REPRODUCED: cards overlap!")
        else:
            print("✓ No overlap")
    
    b.close()
