#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
复现"新生成图与现有图重叠"bug
- 在 zimage.html 中手动模拟: 准备 N 张已加载完成的图（pushNewImage 直接到容器）
- 模拟 handleRender 流程：prepend placeholder → 等图加载完 → 替换为 tempCard
- 检查新卡和现有卡是否 overlap
"""
from playwright.sync_api import sync_playwright
import os, time

OUT = r"C:\Users\zhengyuliang\.qclaw\workspace-agent-a9e0dff1\screenshots"
os.makedirs(OUT, exist_ok=True)

# 准备几张不同尺寸的测试图
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

images = [
    make_test_png("a", 800, 600, (220, 80, 80)),
    make_test_png("b", 800, 1200, (80, 220, 100)),
    make_test_png("c", 800, 1000, (80, 120, 220)),
    make_test_png("d", 800, 700, (220, 180, 80)),
    make_test_png("e", 800, 1400, (180, 80, 220)),
]

# 写一份 records.json 让页面用
records_json = f"""[
{',\n'.join(f'{{"timestamp":{int(time.time()*1000) - (len(images)-i)*60000},"type":"t2i","prompt":"test {i+1}","images":["http://localhost:9099/static/app/_test_{["a","b","c","d","e"][i]}.png"],"model":"test"}}' for i in range(len(images)))}
]"""

with open(os.path.join(OUT, "_records.json"), "w", encoding="utf-8") as f:
    f.write(records_json)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    
    def handle_route(route):
        url = route.request.url
        if "/api/history" in url and "list" in url or url.endswith("/api/history"):
            route.fulfill(status=200, content_type="application/json", body=records_json)
        else:
            route.continue_()
    ctx.route("**/*", handle_route)
    
    pg.goto("http://localhost:9099/static/app/zimage.html", wait_until="domcontentloaded", timeout=20000)
    pg.wait_for_timeout(3000)
    
    n0 = pg.evaluate("document.querySelectorAll('.masonry-item').length")
    print(f"Initial cards: {n0}")
    
    if n0 == 0:
        # 用直接 prepend 注入 cards
        print("Injecting cards manually...")
        for i, p in enumerate(images):
            ts = int(time.time()*1000) - (len(images)-i)*60000
            pg.evaluate(f"""(args) => {{
                if (window.GalleryList && window.GalleryList.pushNewImage) {{
                    window.GalleryList.pushNewImage({{
                        timestamp: args.ts,
                        type: 't2i',
                        prompt: 'test ' + args.i,
                        images: [args.url],
                        model: 'test',
                    }}, {{ eagerFirstImage: true }});
                }}
            }}""", {"ts": ts, "i": i+1, "url": f"http://localhost:9099/static/app/_test_{['a','b','c','d','e'][i]}.png"})
        pg.wait_for_timeout(3000)
        n0 = pg.evaluate("document.querySelectorAll('.masonry-item').length")
        print(f"After inject: {n0} cards")
    
    # 等所有图加载完
    pg.evaluate("""() => Promise.all(Array.from(document.querySelectorAll('.masonry-item img')).map(img => 
        img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
    ))""")
    pg.wait_for_timeout(500)
    
    layout0 = pg.evaluate("""() => Array.from(document.querySelectorAll('.masonry-item')).map(c => {
        const r = c.getBoundingClientRect();
        return { id: c.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })""")
    print(f"\nLayout BEFORE (stable):")
    for c in layout0: print(f"  {c}")
    pg.screenshot(path=f"{OUT}\\overlap2_0_before.png", full_page=False)
    
    # === 关键：模拟 handleRender 的 placeholder 流程 ===
    # 1. prepend placeholder (aspectRatio: 1/1, minHeight: 180)
    print("\n--- Simulating handleRender() flow ---")
    pg.evaluate("""() => {
        // 1) 创建 placeholder
        const placeholder = document.createElement('div');
        placeholder.className = 'masonry-item bg-gray-50 flex flex-col items-center justify-center border-dashed border-2 border-gray-200';
        placeholder.style.minHeight = '180px';
        placeholder.style.aspectRatio = '1 / 1';
        placeholder.style.transition = 'all 0.4s ease';
        placeholder.innerHTML = '<div class="card-progress">Loading...</div>';
        document.getElementById('masonry').prepend(placeholder);
        window._testPlaceholder = placeholder;
    }""")
    pg.wait_for_timeout(100)
    
    layout_placeholder = pg.evaluate("""() => Array.from(document.querySelectorAll('.masonry-item')).slice(0, 3).map(c => {
        const r = c.getBoundingClientRect();
        return { id: c.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })""")
    print(f"\nLayout with placeholder (just inserted):")
    for c in layout_placeholder: print(f"  {c}")
    
    pg.screenshot(path=f"{OUT}\\overlap2_1_placeholder.png", full_page=False)
    
    # 2) 等"图片"加载，模拟"温度"事件：prepend 一个真实卡片（render to temp container, 然后 insertBefore sibling）
    print("\n--- Simulating image loaded, replacing placeholder with tempCard ---")
    pg.evaluate("""async () => {
        // 创建真实卡片，模拟"图片刚加载完"的状态
        const ts = Date.now();
        const record = {
            timestamp: ts,
            type: 't2i',
            prompt: 'NEW: overlap test',
            images: ['http://localhost:9099/static/app/_test_e.png'],  // 800x1400 竖图
            model: 'test',
        };
        // 模拟 zimage.html 的流程
        const tempContainer = document.createElement('div');
        window.GalleryCard.render(Object.assign({ container: tempContainer, record, isNew: true }, { eagerFirstImage: true }));
        const tempCard = tempContainer.querySelector('.masonry-item');
        tempCard.style.aspectRatio = '1024 / 1408';  // 模拟 800x1400 = ratio
        const placeholder = window._testPlaceholder;
        const _parent = placeholder.parentNode;
        const _sibling = placeholder.nextSibling;
        _parent.insertBefore(tempCard, _sibling);
        placeholder.remove();
        window._testTempCard = tempCard;
    }""")
    
    # 立即看（图片还没解码完）
    pg.wait_for_timeout(50)
    layout_50ms = pg.evaluate("""() => Array.from(document.querySelectorAll('.masonry-item')).slice(0, 3).map(c => {
        const r = c.getBoundingClientRect();
        return { id: c.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })""")
    print(f"\nLayout 50ms after replacing placeholder:")
    for c in layout_50ms: print(f"  {c}")
    pg.screenshot(path=f"{OUT}\\overlap2_2_50ms.png", full_page=False)
    
    # 等 3 秒
    pg.wait_for_timeout(3000)
    layout_3s = pg.evaluate("""() => Array.from(document.querySelectorAll('.masonry-item')).slice(0, 3).map(c => {
        const r = c.getBoundingClientRect();
        return { id: c.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })""")
    print(f"\nLayout 3s after replacing placeholder (image loaded):")
    for c in layout_3s: print(f"  {c}")
    pg.screenshot(path=f"{OUT}\\overlap2_3_3s.png", full_page=False)
    
    # 检查 overlap
    def overlap(a, b):
        ix = max(0, min(a['x']+a['w'], b['x']+b['w']) - max(a['x'], b['x']))
        iy = max(0, min(a['y']+a['h'], b['y']+b['h']) - max(a['y'], b['y']))
        return ix * iy
    
    if len(layout_3s) >= 2:
        o = overlap(layout_3s[0], layout_3s[1])
        print(f"\n50ms: overlap(新, 旧[1]) = {overlap(layout_50ms[0], layout_50ms[1])}")
        print(f"3s:   overlap(新, 旧[1]) = {o}")
        if o > 100:
            print("❌ BUG REPRODUCED!")
        else:
            print("✓ No overlap")
    
    b.close()
