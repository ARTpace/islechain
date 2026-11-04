import io
import json
import zipfile

import pytest
from fastapi import HTTPException

from core.game_backups import export_backup, import_backup, read_backup
from core.game_projects import digest
from core.game_workspace import Workspace
from test_game_workspace import env, create


def test_backup_roundtrip_new_identity_and_history_archive(env):
    state = create(env)
    workspace = env[1]
    raw = export_backup(workspace.repository, workspace.project)
    entries = read_backup(raw)
    imported = import_backup(workspace.repository, entries, 'bob', 'new_canvas', '恢复项目')
    assert imported.id != workspace.project.id
    assert imported.owner == 'bob' and imported.canvasId == 'new_canvas'
    restored = Workspace(workspace.repository, imported)
    assert restored.overview()['workspaceEpoch'] == 1
    assert restored.read('content/game-data.json')['content'] == workspace.read('content/game-data.json')['content']
    assert restored.path('imported-history/project.json').is_file()
    assert not restored.path('tests/registry.json').exists()
    assert workspace.overview()['revision'] == state['revision']


def package(entries, manifest=None):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as archive:
        for path, raw in entries.items():
            archive.writestr('project/' + path, raw)
        archive.writestr('backup.json', json.dumps(dict(schemaVersion=1,
            manifest=manifest if manifest is not None else {n:digest(c) for n,c in entries.items()})))
    return stream.getvalue()


@pytest.mark.parametrize('path', ['../escape', 'nested/../../escape', 'C:/secret', '.env', 'game/.env.local'])
def test_backup_rejects_unsafe_paths(path):
    with pytest.raises(HTTPException) as error:
        read_backup(package({'project.json':b'{}',path:b'value'}))
    assert error.value.status_code == 422


def test_backup_rejects_hash_mismatch():
    with pytest.raises(HTTPException):
        read_backup(package({'project.json':b'{}'}, {'project.json':'0' * 64}))


def test_import_invalid_current_data_does_not_publish_project(env):
    create(env)
    workspace = env[1]
    entries = read_backup(export_backup(workspace.repository, workspace.project))
    active = json.loads(entries['workspace.json'])['active']
    entries[active + '/content/game-data.json'] = b'{}'
    with pytest.raises(HTTPException):
        import_backup(workspace.repository, entries, 'bob', 'new_canvas', '无效')
    assert workspace.repository.list('bob') == []
