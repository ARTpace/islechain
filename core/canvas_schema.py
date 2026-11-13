"""Shared, bounded canvas validation. Legacy saves default to warning only."""
import json
import logging
import math
import os
from functools import lru_cache
from logging.handlers import RotatingFileHandler
from pathlib import Path
from threading import RLock

from fastapi import HTTPException
from jsonschema import Draft202012Validator

CURRENT_VERSION = 1
_locks = {}
_locks_guard = RLock()


def canvas_lock(directory, canvas_id):
    # Single-process server; projects never share a write lock.
    key = (str(Path(directory).resolve()), canvas_id)
    with _locks_guard:
        return _locks.setdefault(key, RLock())


@lru_cache(maxsize=1)
def validator():
    path = Path(__file__).parents[1] / 'static/schemas/canvas.schema.json'
    schema = json.loads(path.read_text(encoding='utf-8'))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def check_version(canvas):
    for key in ('schema_version', 'schemaVersion'):
        version = canvas.get(key, 1)
        if type(version) is not int or version < 1 or version > CURRENT_VERSION:
            raise HTTPException(422, {'message': '画布版本不兼容，禁止覆盖', 'field': key})


def validate_canvas(canvas):
    """Only codes and JSON paths leave this function, never user content."""
    errors = []

    def add(code, path):
        if len(errors) < 20:
            errors.append({'code': code, 'path': path})

    candidate = {**canvas, 'schema_version': canvas.get('schema_version', 1)}
    for error in validator().iter_errors(candidate):
        add(str(error.validator), '/' + '/'.join(map(str, error.absolute_path)))
        if len(errors) == 20:
            return errors
    nodes = canvas.get('nodes', [])
    nodes = nodes if isinstance(nodes, list) else []
    ids = set()
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        node_id = node.get('id')
        if isinstance(node_id, str):
            if node_id in ids:
                add('duplicate_node', f'/nodes/{index}/id')
            ids.add(node_id)
        for key in ('x', 'y', 'w', 'h'):
            value = node.get(key)
            if isinstance(value, (int, float)) and not math.isfinite(value):
                add('finite', f'/nodes/{index}/{key}')
    viewport = canvas.get('viewport', {})
    if isinstance(viewport, dict):
        for key in ('x', 'y', 'scale'):
            value = viewport.get(key)
            if isinstance(value, (int, float)) and not math.isfinite(value):
                add('finite', '/viewport/' + key)
    edges = set()
    connections = canvas.get('connections', [])
    for index, edge in enumerate(connections if isinstance(connections, list) else []):
        if not isinstance(edge, dict):
            continue
        source, target = edge.get('from'), edge.get('to')
        if not isinstance(source, str) or not isinstance(target, str):
            continue
        if source not in ids or target not in ids:
            add('missing_endpoint', f'/connections/{index}')
        if source == target:
            add('self_connection', f'/connections/{index}')
        # Bindings are part of the edge identity, including their selection index.
        identity = (source, target, json.dumps(edge.get('bindings'), sort_keys=True))
        if identity in edges:
            add('duplicate_connection', f'/connections/{index}')
        edges.add(identity)
        bindings = edge.get('bindings', [])
        if isinstance(bindings, list):
            seen = set()
            for offset, binding in enumerate(bindings):
                signature = json.dumps(binding, sort_keys=True)
                if signature in seen:
                    add('duplicate_binding', f'/connections/{index}/bindings/{offset}')
                seen.add(signature)
    return errors


def enforce_enabled(canvas):
    return os.environ.get('ART_CANVAS_SCHEMA_MODE', 'warn').lower() == 'enforce'


@lru_cache(maxsize=8)
def _logger(directory):
    directory = Path(directory) / 'logs'
    directory.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger('canvas.schema.' + str(directory))
    logger.setLevel(logging.WARNING)
    logger.propagate = False
    handler = RotatingFileHandler(directory / 'canvas-schema.log', maxBytes=1024 * 1024,
                                 backupCount=2, encoding='utf-8')
    logger.addHandler(handler)
    return logger


def report_warnings(errors, directory):
    if errors:
        _logger(str(directory)).warning('%s', json.dumps({'errors': errors[:20]}))


def check_write(candidate, persisted, directory):
    check_version(persisted or {})
    check_version(candidate)
    errors = validate_canvas(candidate)
    if errors and enforce_enabled(candidate):
        raise HTTPException(422, {'message': '画布结构校验失败', 'errors': errors})
    report_warnings(errors, directory)
    return errors
