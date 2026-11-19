"""Atomic writer must preserve the old file on serialization/replacement failure."""
import json
from unittest.mock import patch

import pytest

from core.json_store import atomic_write_json


def test_atomic_roundtrip_and_serialization_failure(tmp_path):
    target = tmp_path / 'nested' / 'state.json'
    atomic_write_json(target, {'name': '中文'})
    before = target.read_bytes()
    assert json.loads(before) == {'name': '中文'}
    with pytest.raises(TypeError):
        atomic_write_json(target, {'invalid': object()})
    assert target.read_bytes() == before
    assert list(target.parent.glob('.tmp_*')) == []


def test_replace_failure_keeps_original_and_removes_tempfile(tmp_path):
    target = tmp_path / 'state.json'
    atomic_write_json(target, [1])
    with patch('core.json_store.os.replace', side_effect=PermissionError('locked')), pytest.raises(PermissionError):
        atomic_write_json(target, [2])
    assert json.loads(target.read_text(encoding='utf-8')) == [1]
    assert list(tmp_path.glob('.tmp_*')) == []
