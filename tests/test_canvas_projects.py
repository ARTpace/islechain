"""项目分类真实路由回归，所有写入限定于临时账号目录。"""
import os
from pathlib import Path
import subprocess
import sys


def test_project_classification_lifecycle(tmp_path):
    script = r'''
import core.user_paths
core.user_paths.migrate_project_user_data = lambda *a, **k: []
import core.media_migration
core.media_migration.migrate = lambda *a, **k: {}
import main
from fastapi.testclient import TestClient
main.save_users({'alice': {'token': 'test-alice'}, 'bob': {'token': 'test-bob'}})
client = TestClient(main.app)
a = {'Authorization': 'Bearer test-alice'}
b = {'Authorization': 'Bearer test-bob'}
created = client.post('/api/projects', headers=a, json={'name': '测试项目'})
assert created.status_code == 200, (created.status_code, created.text)
project = created.json()['project']
pid = project['id']
assert client.get('/api/projects', headers=a).json()['projects'][-1] == project
assert len(client.get('/api/projects', headers=b).json()['projects']) == 1
assert client.post('/api/projects', json={'name': '匿名'}).status_code == 401
assert client.post('/api/projects/' + pid, headers=b, json={'name': '越权'}).status_code == 404
assert client.post('/api/projects/' + pid, headers=a, json={'name': '改名'}).status_code == 200
assert client.get('/api/projects', headers=a).json()['projects'][-1]['name'] == '改名'
assert client.post('/api/projects', headers=a, json={'name': '  '}).status_code == 422
assert client.delete('/api/projects/default', headers=a).status_code == 400
canvas = client.post('/api/canvases', headers=a, json={'project': pid, 'board_x': 12, 'board_y': -5}).json()['canvas']
cid = canvas['id']
record = client.get('/api/canvases', headers=a).json()['canvases'][0]
assert (record['project'], record['board_x'], record['board_y']) == (pid, 12, -5)
meta_url = '/api/canvases/' + cid + '/meta'
assert client.post(meta_url, headers=b, json={'project': 'default'}).status_code == 403
assert client.post(meta_url, headers=a, json={'project': 'missing'}).status_code == 404
assert client.post(meta_url, headers=a, json={'project': 'default', 'board_x': 90}).status_code == 200
assert client.get('/api/canvases/' + cid, headers=a).json()['canvas']['project'] == 'default'
assert client.post(meta_url, headers=a, json={'project': pid}).status_code == 200
assert client.delete('/api/projects/' + pid, headers=a).status_code == 200
assert client.get('/api/canvases/' + cid, headers=a).json()['canvas']['project'] == 'default'
assert len(client.get('/api/projects', headers=a).json()['projects']) == 1
assert client.post('/api/canvases', headers=a, json={'project': pid}).status_code == 404
print('PROJECT_CLASSIFICATION_OK')
'''
    result = subprocess.run(
        [sys.executable, '-c', script], cwd=Path(__file__).parents[1],
        env={**os.environ, 'ART_CANVAS_HOME': str(tmp_path / 'user'), 'PYTHONIOENCODING': 'utf-8'},
        capture_output=True, text=True, encoding='utf-8', timeout=90,
    )
    assert result.returncode == 0, result.stdout[-1000:] + result.stderr[-2500:]
    assert 'PROJECT_CLASSIFICATION_OK' in result.stdout
