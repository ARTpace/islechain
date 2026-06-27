import json, urllib.request, time, os

def test_workflow(name, path):
    print(f'\n=== Testing {name} ===')
    try:
        with open(path, 'r', encoding='utf-8') as f:
            wf = json.load(f)
        data = json.dumps({'prompt': wf, 'client_id': f'test_{name}'}).encode('utf-8')
        req = urllib.request.Request('http://127.0.0.1:8188/prompt', data=data)
        resp = urllib.request.urlopen(req, timeout=10)
        result = json.loads(resp.read())
        pid = result.get('prompt_id')
        if not pid:
            err = result.get('error', result)
            print(f'  ERROR submitting: {err}')
            if 'node_errors' in result:
                for nid, e in result['node_errors'].items():
                    print(f'    Node {nid}: {json.dumps(e, ensure_ascii=False)[:300]}')
            return False
        print(f'  Submitted: {pid}')
        for i in range(120):
            time.sleep(3)
            try:
                h = json.loads(urllib.request.urlopen(f'http://127.0.0.1:8188/history/{pid}', timeout=5).read())
                if pid in h:
                    status = h[pid].get('status', {})
                    if status.get('completed'):
                        outputs = h[pid].get('outputs', {})
                        has_image = any('images' in out for out in outputs.values())
                        has_audio = any('audio' in out for out in outputs.values())
                        if has_image:
                            print(f'  OK - image(s) generated')
                            return True
                        elif has_audio:
                            print(f'  OK - audio(s) generated')
                            return True
                        else:
                            print(f'  WARN - completed but no output')
                            return False
                    elif status.get('status_str') == 'error':
                        msgs = status.get('messages', [])
                        for m in msgs:
                            if m[0] == 'execution_error':
                                exc_msg = m[1].get('exception_message', '')
                                exc_type = m[1].get('exception_type', '')
                                print(f'  FAIL - {exc_type}: {exc_msg[:300]}')
                                # Check node outputs for errors
                                outputs = h[pid].get('outputs', {})
                                for nid, out in outputs.items():
                                    if 'error' in out:
                                        print(f'    Node {nid} error: {str(out["error"])[:200]}')
                        return False
            except Exception as e2:
                pass
        print('  TIMEOUT after 6 minutes')
        return False
    except Exception as e:
        print(f'  ERROR: {e}')
        return False

base = r'H:\AI-Tools\art-canvas\workflows'

results = {}
workflows = [
    ('Z-Image', 'Z-Image.json'),
    ('Boogu-Base', 'Boogu-Base.json'),
    ('Boogu-Turbo', 'Boogu-Turbo.json'),
    ('Boogu-Edit', 'Boogu-Edit.json'),
    ('Klein', 'klein.json'),
    ('Krea2-Turbo', 'Krea2-Turbo.json'),
    ('Anima', 'anima \u52a8\u6f2b\u6587\u751f\u56fe.json'),
    ('Ideogram4', 'Ideogram4.json'),
]

for name, fname in workflows:
    path = os.path.join(base, fname)
    if not os.path.exists(path):
        print(f'\n=== {name}: FILE NOT FOUND ({fname}) ===')
        results[name] = 'NOT_FOUND'
        continue
    ok = test_workflow(name, path)
    results[name] = 'OK' if ok else 'FAIL'

print('\n\n========== SUMMARY ==========')
for name, status in results.items():
    icon = '\u2705' if status == 'OK' else ('\u274c' if status == 'FAIL' else '\u26a0\ufe0f')
    print(f'  {icon} {name}: {status}')
