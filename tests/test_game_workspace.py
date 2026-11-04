import io
import json
import zipfile
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from core.game_project_models import Project
from core.game_projects import ProjectStore, digest
from core.game_workspace import Workspace
import importlib

routes = importlib.import_module('routers.game_workspace')


@pytest.fixture
def env(tmp_path, monkeypatch):
    store = ProjectStore(tmp_path / 'projects')
    project = Project(id='p1', owner='alice', canvasId='c1', revision=1, title='测试')
    with store.locked():
        store.save(project, increment=False)
    monkeypatch.setattr(routes.projects, 'store', lambda: store)
    def identity(token):
        if token not in ('alice', 'bob'):
            raise HTTPException(401, '登录失效')
        return token
    monkeypatch.setattr(routes.projects, 'identity', identity)
    app = FastAPI()
    app.include_router(routes.router)
    client = TestClient(app)
    return client, Workspace(store, project)


def call(env, method, suffix='', data=None, owner='alice'):
    return env[0].request(method, '/api/game-projects/p1/workspace' + suffix,
                          params={'token': owner}, json=data)


def create(env):
    result = call(env, 'POST')
    assert result.status_code == 200, result.text
    return result.json()


def patch(env, state, content='hello', base_hash=None, apply=True, path='src/main.ts'):
    return call(env, 'POST', '/patches', dict(baseRevision=state['revision'], apply=apply,
                changes=[dict(path=path, content=content, baseHash=base_hash)]))


def test_edit_diff_snapshot_restore_and_export(env):
    initial = create(env)
    preview = patch(env, initial, apply=False)
    assert '+hello' in preview.json()['changes'][0]['diff']
    assert call(env, 'GET').json()['revision'] == initial['revision']
    applied = patch(env, initial).json()
    assert call(env, 'GET', '/file&bad').status_code == 404
    response = env[0].get('/api/game-projects/p1/workspace/file', params={'token': 'alice', 'path': 'src/main.ts'})
    assert response.json()['content'] == 'hello'
    assert patch(env, initial).status_code == 409
    restored = call(env, 'POST', '/restore', dict(baseRevision=applied['revision'], snapshotId=initial['snapshots'][0]['snapshotId']))
    assert restored.status_code == 200, restored.text
    assert restored.json()['workspaceEpoch'] == 1
    assert all(f['path'] != 'src/main.ts' for f in restored.json()['files'])
    exported = call(env, 'GET', '/source.zip')
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        assert 'game/README.md' in archive.namelist()
        assert json.loads(archive.read('manifest.json'))['developmentOnly']


def test_external_edit_conflict_and_preservation(env):
    state = create(env)
    root = env[1].root
    original = root / state['active'] / 'README.md'
    old_hash = digest(original.read_bytes())
    original.write_text('手改正文', encoding='utf-8')
    assert patch(env, state, '覆盖', old_hash, path='README.md').status_code == 409
    updated = patch(env, state, '新正文', digest(original.read_bytes()), path='README.md').json()
    preserved_id = updated['snapshots'][-2]['snapshotId']
    restored = call(env, 'POST', '/restore', dict(baseRevision=updated['revision'], snapshotId=preserved_id))
    assert (root / restored.json()['active'] / 'README.md').read_text(encoding='utf-8') == '手改正文'
    first_id = state['snapshots'][0]['snapshotId']
    record = json.loads((root / f'snapshots/{first_id}/manifest.json').read_bytes())
    assert (root / record['directory'] / 'README.md').read_text(encoding='utf-8') != '手改正文'


@pytest.mark.parametrize('path', ['../outside', '/absolute', 'C:/secret', 'src/../x', '.env', 'node_modules/x', 'src/CON.ts'])
def test_unsafe_paths(env, path):
    state = create(env)
    assert patch(env, state, path=path).status_code == 422


def test_permissions_archive_and_duplicate_create(env):
    assert call(env, 'GET', owner='').status_code == 401
    assert call(env, 'POST', owner='bob').status_code == 403
    create(env)
    assert call(env, 'POST').status_code == 409
    assert call(env, 'GET', '/source.zip', owner='bob').status_code == 403
    store = env[1].repository
    with store.locked():
        project = store.read('p1', 'alice')
        project.archived = True
        store.save(project)
    assert patch(env, call(env, 'GET').json()).status_code == 409


def test_two_concurrent_writes_conflict(env):
    state = create(env)
    with ThreadPoolExecutor(2) as executor:
        responses = list(executor.map(lambda _: patch(env, state), range(2)))
    assert sorted(r.status_code for r in responses) == [200, 409]


def test_corrupt_snapshot_does_not_change_active(env):
    state = create(env)
    snapshot_id = state['snapshots'][0]['snapshotId']
    (env[1].root / f'snapshots/{snapshot_id}/game/README.md').write_text('损坏', encoding='utf-8')
    assert call(env, 'POST', '/restore', dict(baseRevision=state['revision'], snapshotId=snapshot_id)).status_code == 409
    assert call(env, 'GET').json()['revision'] == state['revision']


def test_failed_staging_preserves_active(env, monkeypatch):
    state = create(env)
    module = importlib.import_module('core.game_workspace')
    original = module.atomic_write
    def fail(path, content):
        if str(path).endswith('main.ts'):
            raise OSError('模拟磁盘故障')
        return original(path, content)
    monkeypatch.setattr(module, 'atomic_write', fail)
    with pytest.raises(OSError):
        patch(env, state)
    current = call(env, 'GET').json()
    assert current['active'] != state['active']  # 保护点仍包含原有完整文件
    assert all(f['path'] != 'src/main.ts' for f in current['files'])


def test_symlink_is_rejected(env, tmp_path):
    state = create(env)
    outside = tmp_path / 'outside'
    outside.mkdir()
    link = env[1].root / state['active'] / 'escape'
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip('当前 Windows 账号无创建符号链接权限')
    assert call(env, 'GET').status_code == 422


def test_dataset_edit_preview_import_and_reference_guard(env):
    state = create(env)
    source = call(env, 'GET', '/datasets').json()
    data = json.loads(source['content'])
    data['datasets'][1]['rows'][0]['values']['speed'] = 90
    request = dict(baseRevision=state['revision'], baseHash=source['hash'], content=data, apply=False)
    preview = call(env, 'PUT', '/datasets', request)
    assert preview.status_code == 200, preview.text
    assert any(line.startswith('+') and '"speed": 90' in line
               for line in preview.json()['changes'][0]['diff'].splitlines())
    assert call(env, 'GET').json()['revision'] == state['revision']
    request['apply'] = True
    result = call(env, 'PUT', '/datasets', request)
    assert result.status_code == 200, result.text
    current = call(env, 'GET', '/datasets').json()
    imported = json.loads(current['content'])
    assert imported['datasets'][1]['revision'] == 2
    assert call(env, 'PUT', '/datasets', request).status_code == 409
    imported['datasets'][1]['rows'] = []
    request.update(baseRevision=current['revision'], baseHash=current['hash'], content=imported)
    assert call(env, 'PUT', '/datasets', request).status_code == 422
    assert call(env, 'GET', '/datasets').json()['hash'] == current['hash']
