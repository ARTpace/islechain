"""作业手册接口与面数参数的入口校验（不需要启动 Blender）。"""
import os
from pathlib import Path
import subprocess
import sys


def test_blender_skills_and_target_tris_entry(tmp_path):
    script = r'''
import core.user_paths
core.user_paths.migrate_project_user_data = lambda *a, **k: []
import core.media_migration
core.media_migration.migrate = lambda *a, **k: {}
import main
from fastapi.testclient import TestClient
main.save_users({'tester': {'token': 'skills-test'}})
client = TestClient(main.app)
headers = {'Authorization': 'Bearer skills-test', 'Origin': 'http://testserver'}

assert client.get('/api/game-projects/blender-skills').status_code == 401
skills = client.get('/api/game-projects/blender-skills', headers=headers)
assert skills.status_code == 200, skills.text
ids = [item['id'] for item in skills.json()['skills']]
assert 'optimizer' in ids and 'hard-surface' in ids, ids
optimizer = next(item for item in skills.json()['skills'] if item['id'] == 'optimizer')
assert '减面' in optimizer['name']
assert optimizer['path'] == 'packs/blender-skills/optimizer/SKILL.md'

presets = client.get('/api/game-projects/presets', headers=headers).json()['presets']
model_presets = [item['id'] for item in presets if 'model' in item['kinds']]
assert 'optimizer' in model_presets, model_presets
assert all('prompt' not in item for item in presets)

canvas = client.post('/api/canvases', headers=headers, json={'title': '减面画布'}).json()['canvas']
# 作业手册现在跟着人设走（job['skillId'] = preset['id']），路由里没有单独的手册校验；
# 未知 presetId 会回落到 default，而不是报「作业手册不存在」。
body = {'canvasId': canvas['id'], 'prompt': '把这个模型减到 5000 面', 'presetId': 'nope', 'targetTris': -1}

# 面数超出上限由 pydantic 拦下，不会进到建模流程（也不依赖模型渠道密钥）
assert client.post('/api/dcc/build-model', headers=headers, json=body).status_code == 422
print('DCC_SKILLS_APP_OK')
'''
    result = subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).parents[1],
                            env={**os.environ, 'ART_CANVAS_HOME': str(tmp_path / 'user'), 'PYTHONIOENCODING': 'utf-8'},
                            capture_output=True, text=True, encoding='utf-8', timeout=90)
    assert result.returncode == 0, result.stdout[-500:] + result.stderr[-2200:]
    assert 'DCC_SKILLS_APP_OK' in result.stdout
