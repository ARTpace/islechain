import importlib

import pytest

from core.game_project_models import Document
from core.game_projects import digest
from test_game_workspace import env, call, create


def prepare(env):
    workspace = env[1]
    project = workspace.project
    project.documents = [Document(id='doc1', title='初稿', revision=1,
        contentHash=digest(b'original'), lastSavedContent='original')]
    workspace.repository.write_document_file(project, project.documents[0])
    workspace.repository.save(project, increment=False)
    state = create(env)
    snapshot = state['snapshots'][0]['snapshotId']
    project.title = '修改后的标题'
    doc = project.documents[0]
    doc.lastSavedContent, doc.contentHash, doc.revision = 'changed', digest(b'changed'), 2
    workspace.repository.write_document_file(project, doc)
    workspace.project = workspace.repository.save(project)
    return state, snapshot


def test_full_restore_recovers_document_and_monotonic_identity(env):
    state, snapshot = prepare(env)
    response = call(env, 'POST', '/restore', dict(baseRevision=state['revision'], snapshotId=snapshot, fullProject=True))
    assert response.status_code == 200, response.text
    repository = env[1].repository
    project = repository.read('p1', 'alice')
    assert project.title == '测试'
    assert project.revision == 3
    assert project.documents[0].revision == 3
    assert project.documents[0].lastSavedContent == 'original'
    assert env[1].path('documents/doc1.md').read_bytes() == b'original'
    assert response.json()['workspaceEpoch'] == 1
    assert len(response.json()['snapshots']) == 3
    assert not call(env, 'GET', '/restore-transaction').json()['pending']


@pytest.mark.parametrize('decision', ['continue', 'rollback'])
def test_partial_restore_blocks_access_until_explicit_recovery(env, monkeypatch, decision):
    state, snapshot = prepare(env)
    module = importlib.import_module('core.game_workspace')
    original = module.atomic_write
    def interrupted(path, content):
        if path.name == 'workspace.json' and env[1].path('restore-pending.json').exists():
            raise OSError('模拟恢复中断')
        original(path, content)
    monkeypatch.setattr(module, 'atomic_write', interrupted)
    with pytest.raises(OSError):
        call(env, 'POST', '/restore', dict(baseRevision=state['revision'], snapshotId=snapshot, fullProject=True))
    assert call(env, 'GET').status_code == 409
    assert call(env, 'POST').status_code == 409
    assert call(env, 'GET', '/restore-transaction', owner='bob').status_code == 403
    assert call(env, 'GET', '/restore-transaction').json()['pending']
    monkeypatch.setattr(module, 'atomic_write', original)
    response = call(env, 'POST', '/restore-transaction', dict(decision=decision))
    assert response.status_code == 200, response.text
    project = env[1].repository.read('p1', 'alice')
    expected = 'original' if decision == 'continue' else 'changed'
    assert project.documents[0].lastSavedContent == expected
    assert env[1].path('documents/doc1.md').read_text() == expected
    assert response.json()['workspaceEpoch'] == (1 if decision == 'continue' else 2)
    assert project.revision >= 3
    assert not call(env, 'GET', '/restore-transaction').json()['pending']


def test_full_restore_does_not_discard_external_document_edits(env):
    state, snapshot = prepare(env)
    env[1].path('documents/doc1.md').write_bytes(b'external unsaved edit')
    response = call(env, 'POST', '/restore', dict(baseRevision=state['revision'], snapshotId=snapshot, fullProject=True))
    assert response.status_code == 409
    assert env[1].path('documents/doc1.md').read_bytes() == b'external unsaved edit'
    assert not call(env, 'GET', '/restore-transaction').json()['pending']
