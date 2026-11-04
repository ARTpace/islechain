"""真实入口隔离导入与路由注册；禁止迁移工程内或真实账号文件。"""
import os
from pathlib import Path
import subprocess
import sys
import runpy


def test_isolated_main_registration(tmp_path):
    root = Path(__file__).parents[1]
    script = r'''
import os
import core.user_paths
core.user_paths.migrate_project_user_data = lambda *a, **k: []
import core.media_migration
core.media_migration.migrate = lambda *a, **k: {}
import main
import base64, io
from PIL import Image
from fastapi.testclient import TestClient
main.save_users({'preview': {'token': 'isolated-test-token'}, 'other': {'token': 'isolated-other-token'}})
client = TestClient(main.app)
headers = {'Authorization': 'Bearer isolated-test-token'}
canvas = client.post('/api/canvases', headers=headers, json={'title': 'isolated-canvas'}).json()['canvas']
created = client.post('/api/game-projects', headers=headers, json={'title': 'isolated-project', 'canvasId': canvas['id']})
assert created.status_code == 200, created.text
project = created.json()['project']
assert client.get('/api/game-projects/' + project['id'], headers=headers).status_code == 200
assert client.get('/api/game-projects/' + project['id']).status_code == 401
pid = '/api/game-projects/' + project['id']
document = client.post(pid + '/documents', headers=headers, json={'baseRevision': 1, 'title': '文档', 'content': '正文'}).json()['project']
doc_id = document['documents'][0]['id']
node = {'id': 'document_node', 'type': 'document', 'projectId': project['id'], 'docId': doc_id}
assert client.put('/api/canvases/' + canvas['id'], headers=headers, json={'nodes': [node]}).status_code == 200
other = client.post('/api/canvases', headers=headers, json={'title': 'other-canvas'}).json()['canvas']
assert client.put('/api/canvases/' + other['id'], headers=headers, json={'nodes': [node]}).status_code == 422
assert client.request('DELETE', pid + '/documents/' + doc_id, headers=headers, json={'baseRevision': 2}).status_code == 409
asset = {'id': 'asset_1', 'revision': 1, 'name': '图标', 'purpose': '测试', 'usage': 'runtime', 'required': True,
         'spec': {'width': 1, 'height': 1, 'format': 'png'}, 'prompt': '图标', 'runtimeDestination': 'assets/icon.png'}
updated = client.put(pid + '/assets', headers=headers, json={'baseRevision': 2, 'assets': [asset]})
assert updated.status_code == 200, updated.text
image = io.BytesIO(); Image.new('RGB', (1, 1)).save(image, 'PNG')
uploaded = client.post(pid + '/assets/asset_1/upload', headers=headers, json={'baseRevision': 3, 'contentBase64': base64.b64encode(image.getvalue()).decode()})
assert uploaded.status_code == 200, uploaded.text
selection = uploaded.json()['project']['assets'][0]['selected']
reference = pid + '/files/asset_1/' + selection['selectionId'] + '.png'
handle = main.REQUEST_TOKEN.set('isolated-test-token')
try:
    assert main.output_file_from_url(reference).startswith(os.environ['ART_CANVAS_HOME'])
finally:
    main.REQUEST_TOKEN.reset(handle)
assert client.get(reference, headers=headers).status_code == 200
async def fake_image(payload, username=None, on_progress=None):
    assert username == 'preview', 'Cookie/Header 身份未传入图片任务'
    return {'images': [], 'model': 'isolated-model', 'ownerReceived': username}
main.build_online_image_result = fake_image
task = client.post('/api/canvas-image-tasks', headers=headers, json={'prompt': '隔离任务'})
assert task.status_code == 200, task.text
task_id = task.json()['task_id']
assert main.CANVAS_TASKS[task_id]['owner'] == 'preview'
assert main.CANVAS_TASKS[task_id]['result']['ownerReceived'] == 'preview'
assert client.get('/api/canvas-image-tasks/' + task_id, headers=headers).status_code == 200
assert client.get('/api/canvas-image-tasks/' + task_id, headers={'Authorization': 'Bearer isolated-other-token'}).status_code == 403
assert client.get('/api/canvas-image-tasks/' + task_id).status_code == 401
assert client.post('/api/canvas-image-tasks', json={'prompt': '不能匿名生成'}).status_code == 401
client.cookies.set('xy_auth_token', 'isolated-test-token')
cookie_task = client.post('/api/canvas-image-tasks', json={'prompt': 'Cookie 隔离任务'})
assert cookie_task.status_code == 200, cookie_task.text
assert main.CANVAS_TASKS[cookie_task.json()['task_id']]['owner'] == 'preview'
client.cookies.clear()
paths = [(method, route.path) for route in main.app.routes for method in getattr(route, 'methods', []) if route.path.startswith('/api/game-projects')]
assert len(paths) == len(set(paths)), paths
assert len(paths) >= 20, paths
html = client.get('/static/canvas.html').text
assert 'gameProjectToggle' in html and 'game-pipeline.js' in html
print('GAME_PIPELINE_APP_OK', len(paths))
'''
    environment = {**os.environ, 'ART_CANVAS_HOME': str(tmp_path / 'user'), 'PYTHONIOENCODING': 'utf-8'}
    result = subprocess.run([sys.executable, '-c', script], cwd=root, env=environment,
                            capture_output=True, text=True, encoding='utf-8', timeout=90)
    assert result.returncode == 0, result.stderr[-2500:]
    assert 'GAME_PIPELINE_APP_OK' in result.stdout


def test_existing_route_contract_is_unchanged(tmp_path):
    root = Path(__file__).parents[1]
    helpers = runpy.run_path(str(root / 'tests/test_route_inventory.py'))
    extract = helpers['extract_main_app_routes']
    original = subprocess.run(['git', 'show', 'HEAD:main.py'], cwd=root, capture_output=True, check=True).stdout
    path = tmp_path / 'main.py'
    path.write_bytes(original)
    old_routes, old_includes = extract(path)
    routes, includes = extract(root / 'main.py')
    added = {('POST', '/api/projects', 'create_project', 'main.py'),
             ('POST', '/api/projects/{project_id}', 'rename_project', 'main.py'),
             ('DELETE', '/api/projects/{project_id}', 'delete_project', 'main.py')}
    assert set(routes) - set(old_routes) == added
    assert [route for route in routes if route not in added] == old_routes
    # game/mcp 相关 router 是本轮新增接入的，允许相对 HEAD 多出来；
    # 其余 router 的 include 名单与 prefix 必须与 HEAD 完全一致。
    feature_routers = {'game_projects', 'game_workspace', 'game_testing', 'game_code_candidates',
                       'game_development_tasks', 'game_native_runtime', 'game_model3d',
                       'game_audio', 'game_node_assets', 'mcp_tools', 'generation_dashboard'}
    assert {name: prefix for name, prefix in includes.items() if name not in feature_routers} == old_includes
    assert all(includes[name] == '' for name in feature_routers)
    assert includes['game_workspace'] == ''
    assert includes['game_testing'] == ''
    assert includes['game_code_candidates'] == ''
    assert includes['game_projects'] == ''
