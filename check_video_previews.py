import urllib.request, json
try:
    with urllib.request.urlopen("http://127.0.0.1:8188/api/lm/loras/list?page=1&page_size=200", timeout=15) as r:
        d = json.loads(r.read())
    items = d.get("items", [])
    video_exts = ('.mp4', '.webm', '.mov', '.avi', '.mkv')
    for m in items:
        url = m.get("preview_url", "")
        if any(url.lower().endswith(ext) for ext in video_exts):
            print(f"VIDEO: {m['model_name']} -> {url}")
    print(f"\nTotal: {len(items)} items checked")
    # Also show a few preview_url samples
    print("\nSample preview_urls:")
    for m in items[:5]:
        print(f"  {m['model_name']}: {m.get('preview_url','')[:120]}")
except Exception as e:
    print(f"Error: {e}")
