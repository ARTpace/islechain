import copy

import pytest
from pydantic import ValidationError

from core.game_content import GameContent, initial_content


def test_initial_content_roundtrip():
    data = initial_content()
    assert GameContent.model_validate_json(data.model_dump_json()) == data
    assert data.datasets[2].rows[0].values['enemy'] == 'slime'


@pytest.mark.parametrize('value', [True, '160', -1, float('nan'), float('inf')])
def test_invalid_speed(value):
    raw = initial_content().model_dump()
    raw['datasets'][0]['rows'][0]['values']['speed'] = value
    with pytest.raises(ValidationError):
        GameContent.model_validate(raw)


@pytest.mark.parametrize('kind', ['reference', 'delete', 'duplicate_row', 'duplicate_dataset', 'missing', 'unknown', 'integer'])
def test_invalid_content(kind):
    raw = initial_content().model_dump()
    if kind == 'reference':
        raw['datasets'][2]['rows'][0]['values']['enemy'] = 'missing'
    elif kind == 'delete':
        raw['datasets'][1]['rows'] = []
    elif kind == 'duplicate_row':
        raw['datasets'][0]['rows'] *= 2
    elif kind == 'duplicate_dataset':
        raw['datasets'][1] = copy.deepcopy(raw['datasets'][0])
    elif kind == 'missing':
        del raw['datasets'][0]['rows'][0]['values']['hp']
    elif kind == 'unknown':
        raw['datasets'][0]['rows'][0]['values']['ghost'] = 1
    else:
        raw['datasets'][0]['rows'][0]['values']['hp'] = 1.5
    with pytest.raises(ValidationError):
        GameContent.model_validate(raw)


@pytest.mark.parametrize('kind,value,valid', [('boolean', False, True), ('boolean', 0, False),
    ('enum', 'easy', True), ('enum', 'other', False), ('string', '001', True), ('string', 1, False)])
def test_field_types(kind, value, valid):
    raw = initial_content().model_dump()
    field = dict(id='extra', title='字段', type=kind)
    if kind == 'enum':
        field['options'] = ['easy', 'hard']
    raw['datasets'][0]['fields'].append(field)
    raw['datasets'][0]['rows'][0]['values']['extra'] = value
    if valid:
        assert GameContent.model_validate(raw).datasets[0].rows[0].values['extra'] == value
    else:
        with pytest.raises(ValidationError):
            GameContent.model_validate(raw)


def test_unique_and_asset_constraints():
    raw = initial_content().model_dump()
    raw['datasets'][0]['fields'][0]['unique'] = True
    other = copy.deepcopy(raw['datasets'][0]['rows'][0])
    other['id'] = 'player2'
    raw['datasets'][0]['rows'].append(other)
    with pytest.raises(ValidationError):
        GameContent.model_validate(raw)
    raw = initial_content().model_dump()
    raw['datasets'][0]['fields'].append(dict(id='portrait', title='头像', type='asset'))
    raw['datasets'][0]['rows'][0]['values']['portrait'] = 'asset1'
    data = GameContent.model_validate(raw)
    with pytest.raises(ValueError):
        data.validate_assets(set())
    data.validate_assets({'asset1'})
