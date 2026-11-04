"""开发节点沿用项目/画布身份校验，不能通过伪造节点跨项目引用。"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from core.game_projects import validate_document_nodes


@pytest.mark.parametrize('kind', ['gameDevelop', 'gamePlay', 'gameTest', 'gameRelease'])
def test_production_nodes_enforce_canvas_and_archive(kind):
    project = SimpleNamespace(id='project', canvasId='canvas', archived=False)
    repository = SimpleNamespace(read=lambda project_id, owner: project)
    canvas = {'id': 'canvas', 'owner': 'alice', 'nodes': []}
    node = {'id': 'node', 'type': kind, 'projectId': 'project'}
    validate_document_nodes(repository, canvas, [node])
    project.canvasId = 'other'
    with pytest.raises(HTTPException) as error:
        validate_document_nodes(repository, canvas, [node])
    assert error.value.status_code == 422
    project.canvasId = 'canvas'
    project.archived = True
    with pytest.raises(HTTPException) as error:
        validate_document_nodes(repository, canvas, [node])
    assert error.value.status_code == 409
    canvas['nodes'] = [node]
    validate_document_nodes(repository, canvas, [node])
