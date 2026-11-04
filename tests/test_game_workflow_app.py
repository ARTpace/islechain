"""独立游戏画布的真实入口、模拟 LLM 与保存恢复。"""
import os
from pathlib import Path
import subprocess
import sys


def test_game_canvas_workflow(tmp_path):
    script = r'''
import core.user_paths
core.user_paths.migrate_project_user_data = lambda *a, **k: []
import core.media_migration
core.media_migration.migrate = lambda *a, **k: {}
import main, json, httpx
from fastapi.testclient import TestClient
main.save_users({'tester': {'token': 'workflow-test'}, 'other': {'token': 'workflow-other'}})
client = TestClient(main.app)
headers = {'Authorization': 'Bearer workflow-test'}
created = client.post('/api/canvases', headers=headers, json={'title': '游戏画布', 'kind': 'game'})
assert created.status_code == 200, created.text
canvas = created.json()['canvas']
assert canvas['kind'] == 'game'
assert [n['type'] for n in canvas['nodes']] == ['gameIdea', 'gamePlan', 'gameAssets']
assert len(canvas['connections']) == 2
pid = canvas['nodes'][0]['projectId']
root = '/api/game-projects/' + pid
catalog = client.get('/api/game-projects/presets', headers=headers)
assert catalog.status_code == 200, catalog.text
assert any(p['id'] == 'character-designer' for p in catalog.json()['presets'])
assert all('prompt' not in p for p in catalog.json()['presets'])
assert client.get('/api/game-projects/presets').status_code == 401
assert client.get('/api/game-projects?canvasId=' + canvas['id'], headers=headers).json()['projects'][0]['id'] == pid
assert client.get(root, headers={'Authorization': 'Bearer workflow-other'}).status_code == 403
ordinary = client.post('/api/canvases', headers=headers, json={'title': '普通画布'}).json()['canvas']
assert ordinary.get('kind') == 'classic' and not ordinary['nodes']
assert not client.get('/api/game-projects?canvasId=' + ordinary['id'], headers=headers).json()['projects']
assert client.put('/api/canvases/' + ordinary['id'], headers=headers, json={'nodes': canvas['nodes']}).status_code == 422
sample = json.load(open('docs/examples/game-project.json', encoding='utf-8'))
for entry in sample['plan']['characters'] + sample['plan']['scenes']:
    entry['assetIds'] = []
main.resolve_chat_provider = lambda *args: ('https://mock.invalid/v1', {}, 'mock-game')
original = httpx.AsyncClient
calls = []
def reply(request):
    body = json.loads(request.content)
    calls.append(body)
    data = sample['assets'] if '输出资产条目' in body['messages'][0]['content'] else sample['plan']
    return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(data)}}]})
httpx.AsyncClient = lambda **kwargs: original(transport=httpx.MockTransport(reply), **kwargs)
assert client.post(root + '/plan-candidates', headers=headers, json={'baseRevision': 1, 'presetId': 'character-designer'}).status_code == 422
assert client.post(root + '/plan-candidates', headers=headers, json={'baseRevision': 1, 'presetId': 'unknown'}).status_code == 422
proposal = client.post(root + '/plan-candidates', headers=headers, json={'baseRevision': 1, 'idea': '猫咪修理飞船', 'presetId': 'game-director'})
assert proposal.status_code == 200, proposal.text
p = proposal.json()['project']
candidate = p['candidates'][-1]
assert candidate['status'] == 'valid', candidate
assert candidate['presetId'] == 'game-director' and candidate['presetVersion'] == 1
assert '游戏制作人' in calls[0]['messages'][0]['content']
assert '猫咪修理飞船' in calls[0]['messages'][1]['content']
assert client.post(root + '/asset-candidates', headers=headers, json={'baseRevision': p['revision']}).status_code == 409
adopted = client.put(root + '/plan', headers=headers, json={'baseRevision': p['revision'], 'plan': candidate['data'], 'candidateId': candidate['id'], 'confirmed': True})
assert adopted.status_code == 200, adopted.text
p = adopted.json()['project']
assets = client.post(root + '/asset-candidates', headers=headers, json={'baseRevision': p['revision'], 'presetId': 'character-designer'})
assert assets.status_code == 200, assets.text
p = assets.json()['project']; candidate = p['candidates'][-1]
assert candidate['status'] == 'valid', candidate
assert candidate['presetId'] == 'character-designer'
assert '游戏角色设定师' in calls[-1]['messages'][0]['content']
adopted = client.put(root + '/assets', headers=headers, json={'baseRevision': p['revision'], 'assets': candidate['data'], 'candidateId': candidate['id']})
assert adopted.status_code == 200, adopted.text
p = adopted.json()['project']
assert len(p['assets']) == 5
canvas['nodes'][0]['idea'] = '猫咪修理飞船'
canvas['nodes'][1]['presetId'] = 'game-director'
save = client.put('/api/canvases/' + canvas['id'], headers=headers, json={'title': canvas['title'], 'nodes': canvas['nodes'], 'connections': canvas['connections']})
assert save.status_code == 200, save.text
reloaded = client.get('/api/canvases/' + canvas['id'], headers=headers).json()['canvas']
assert reloaded['nodes'][0]['idea'] == '猫咪修理飞船'
assert reloaded['nodes'][1]['presetId'] == 'game-director'
assert reloaded['connections'] == canvas['connections']
assert client.get(root, headers=headers).json()['project']['planConfirmed']
doc = client.post(root + '/documents', headers=headers, json={'baseRevision': p['revision'], 'title': '连线需求', 'content': '必须收集零件'})
assert doc.status_code == 200, doc.text
p = doc.json()['project']; did = p['documents'][-1]['id']
filtered = client.post(root + '/plan-candidates', headers=headers, json={'baseRevision': p['revision'], 'documentIds': []})
assert filtered.status_code == 200, filtered.text
assert json.loads(calls[-1]['messages'][1]['content'])['documents'] == []
p = filtered.json()['project']
included = client.post(root + '/plan-candidates', headers=headers, json={'baseRevision': p['revision'], 'documentIds': [did]})
assert included.status_code == 200, included.text
assert json.loads(calls[-1]['messages'][1]['content'])['documents'][0]['content'] == '必须收集零件'
p = included.json()['project']
assert client.post(root + '/plan-candidates', headers=headers, json={'baseRevision': p['revision'], 'documentIds': ['foreign_doc']}).status_code == 422
print('GAME_WORKFLOW_APP_OK')
'''
    result = subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).parents[1],
                            env={**os.environ, 'ART_CANVAS_HOME': str(tmp_path / 'user'), 'PYTHONIOENCODING': 'utf-8'},
                            capture_output=True, text=True, encoding='utf-8', timeout=90)
    assert result.returncode == 0, result.stdout[-500:] + result.stderr[-2200:]
    assert 'GAME_WORKFLOW_APP_OK' in result.stdout
