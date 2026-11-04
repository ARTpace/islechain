"""纯契约测试，不导入 main，不触碰真实用户目录。"""
import copy
import hashlib
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from core.game_project_models import Document, Project, relative_path


@pytest.fixture
def sample():
    return json.loads((Path(__file__).parents[1] / 'docs/examples/game-project.json').read_text(encoding='utf-8'))


def test_five_asset_sample(sample):
    project = Project.model_validate(sample)
    assert len(project.assets) == 5
    assert sum(a.required and a.usage == 'runtime' for a in project.assets) == 4
    assert Project.model_validate_json(project.model_dump_json()) == project


@pytest.mark.parametrize('path', [
    '../x.png', '/x.png', 'C:/x.png', 'a\\x.png', 'a//x.png',
    'assets/CON.png', 'assets/lpt1.png', 'assets/x./y.png', 'assets/x /y.png',
    'assets/x:stream.png', 'assets/./x.png', 'assets/\x00.png',
])
def test_unsafe_path(path):
    with pytest.raises(ValueError):
        relative_path(path)


@pytest.mark.parametrize('case', ['duplicate', 'missing', 'cycle', 'case_path', 'unknown', 'format', 'alpha', 'node', 'selection'])
def test_invalid_project(sample, case):
    a, b = sample['assets'][:2]
    if case == 'duplicate':
        b['id'] = a['id']
    elif case == 'missing':
        b['referenceAssetIds'] = ['foreign_asset']
    elif case == 'cycle':
        a['referenceAssetIds'] = [b['id']]
    elif case == 'case_path':
        b['runtimeDestination'] = 'assets/BACKGROUNDS/EXPLORATION.PNG'
    elif case == 'unknown':
        a['apiKey'] = 'not-allowed'
    elif case == 'format':
        a['runtimeDestination'] = 'references/concept.jpg'
    elif case == 'alpha':
        b['spec']['format'] = 'jpeg'
    elif case == 'node':
        a['generatorNodeId'] = b['generatorNodeId'] = 'gen_1'
    else:
        b['selected'] = dict(selectionId='s1', relativePath='assets/foreign/s1.png',
                            sourceNodeId='g1', sourceOutputId='o1', contentHash='0' * 64,
                            sourceAssetRevision=1)
    with pytest.raises(ValidationError):
        Project.model_validate(sample)


def test_document_utf8_and_hash():
    body = '正文'
    data = dict(id='doc_1', title='策划', revision=1, lastSavedContent=body,
                contentHash=hashlib.sha256(body.encode()).hexdigest())
    assert Document.model_validate(data).lastSavedContent == body
    broken = copy.deepcopy(data)
    broken['lastSavedContent'] = '中断写入'
    with pytest.raises(ValidationError):
        Document.model_validate(broken)
    oversized = '中' * 400000
    data.update(lastSavedContent=oversized, contentHash=hashlib.sha256(oversized.encode()).hexdigest())
    with pytest.raises(ValidationError):
        Document.model_validate(data)


def test_effective_reference_limit_matches_canvas(sample):
    template = sample['assets'][-1]
    sample['plan'] = None
    sample['assets'] = []
    for index in range(22):
        asset = copy.deepcopy(template)
        asset.update(id=f'asset_{index}', runtimeDestination=f'assets/icon_{index}.png')
        sample['assets'].append(asset)
    sample['assets'][0]['referenceAssetIds'] = [f'asset_{index}' for index in range(1, 22)]
    with pytest.raises(ValidationError, match='最多 20'):
        Project.model_validate(sample)
    sample['assets'][0]['referenceAssetIds'].pop()
    assert len(Project.model_validate(sample).assets) == 22
