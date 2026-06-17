import json, time, urllib.request, uuid

with open('workflows/Z-Image.json', 'r', encoding='utf-8') as f:
    wf = json.load(f)

wf['23']['inputs']['text'] = 'a beautiful sunset over the ocean, masterpiece, best quality'
wf['22']['inputs']['seed'] = 123456789
wf['144']['inputs']['width'] = 1536
wf['144']['inputs']['height'] = 2048

prompt_id = str(uuid.uuid4())
body = json.dumps({'prompt': wf, 'client_id': 'test-xingliu', 'prompt_id': prompt_id}).encode('utf-8')

print(f'=== 测试 直接生2K ({wf["144"]["inputs"]["width"]}x{wf["144"]["inputs"]["height"]}) ===')
print(f'模型: {wf["33"]["inputs"]["model_name"]}')
print(f'VAE: {wf["20"]["class_type"]}')
print(f'Steps: {wf["22"]["inputs"]["steps"]}')

t0 = time.time()
req = urllib.request.Request('http://127.0.0.1:8188/prompt', data=body, headers={'Content-Type': 'application/json'}, method='POST')
try:
    resp = urllib.request.urlopen(req, timeout=10)
    result = json.loads(resp.read())
    pid = result.get('prompt_id', prompt_id)
    print(f'prompt_id: {pid}')
except urllib.error.HTTPError as e:
    print(f'提交失败: HTTP {e.code}')
    print(f'错误详情: {e.read().decode("utf-8", errors="ignore")[:500]}')
    exit(1)
except Exception as e:
    print(f'提交失败: {e}')
    exit(1)

for i in range(90):
    time.sleep(2)
    elapsed = time.time() - t0
    try:
        r = urllib.request.urlopen(f'http://127.0.0.1:8188/history/{pid}', timeout=5)
        hist = json.loads(r.read())
        pd = hist.get(pid)
        if not pd:
            print(f'  等待中... {elapsed:.0f}s')
            continue
        status = pd.get('status', {}).get('status_str', '')
        if status == 'error':
            print(f'=== 执行错误 ({elapsed:.0f}s) ===')
            print(json.dumps(pd.get('status', {}), indent=2, ensure_ascii=False))
            break
        outputs = pd.get('outputs', {})
        if outputs:
            print(f'=== 完成! 耗时 {elapsed:.0f}s ===')
            for nid, out in outputs.items():
                imgs = out.get('images', [])
                for img in imgs:
                    print(f'  节点 {nid} -> {img.get("filename")} ({img.get("type")})')
            break
    except Exception as e:
        print(f'  查询出错: {e}')
else:
    print(f'=== 超时 ({elapsed:.0f}s) ===')
print(f'总耗时: {time.time()-t0:.1f}s')
