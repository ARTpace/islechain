"""Storage and archive regression tests; every write uses an isolated directory."""
import copy
import json
import shutil
import stat
import zipfile
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException

from core.canvas_bundle import export_bundle, import_bundle
from core.canvas_paths import CanvasPaths, rewrite_prefix
from core.canvas_schema import check_write, validate_canvas
from core.canvas_store import CanvasStore
from core import canvas_migration as migration
from core.game_projects import atomic_write, json_bytes


def canvas(canvas_id='a' * 32, owner='alice', folder='画布 folder'):
    return {'id': canvas_id, 'owner': owner, 'output_folder': folder, 'schema_version': 1,
            'title': '测试', 'nodes': [], 'connections': [], 'created_at': 1, 'updated_at': 1}


def publish(store, value=None):
    value = value or canvas()
    return store.publish(value, [{'owner': value['owner'] or '', 'folder': value['output_folder']}])


def test_legacy_and_project_save_revisions_and_partial_edits(tmp_path):
    store = CanvasStore(tmp_path)
    old = canvas('b' * 32, folder='legacy')
    atomic_write(store.legacy_file(old['id']), json_bytes(old))
    loaded = store.read(old['id'])
    loaded['title'] = '旧格式继续写'
    store.save(loaded)
    assert not store.published(old['id'])
    assert store.read(old['id'])['title'] == '旧格式继续写'
    current = publish(store)
    graph, metadata = store.read(current['id']), store.read(current['id'])
    graph['nodes'] = [{'id': 'p', 'type': 'prompt', 'x': 0, 'y': 0, 'text': '保留'}]
    store.save(graph)
    metadata['project'] = 'p_other'
    store.save(metadata)
    assert store.read(current['id'])['nodes'] == graph['nodes']
    assert store.read(current['id'])['project'] == 'p_other'
    with pytest.raises(HTTPException) as error:
        store.save(metadata, base_revision=1)
    assert error.value.status_code == 409
    def update(index):
        value = store.read(current['id'])
        value['field_' + str(index)] = index
        store.save(value)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(update, range(8)))
    final = store.read(current['id'])
    assert final['revision'] == 11
    assert all(final['field_' + str(index)] == index for index in range(8))


def test_future_version_and_purge_never_resurrect_legacy(tmp_path):
    store = CanvasStore(tmp_path)
    value = publish(store)
    atomic_write(store.legacy_file(value['id']), json_bytes(canvas()))
    path = store.directory(value['id']) / 'project.json'
    snapshot = json.loads(path.read_text(encoding='utf-8'))
    snapshot['schemaVersion'] = 2
    atomic_write(path, json_bytes(snapshot))
    with pytest.raises(HTTPException) as error:
        store.save(store.read(value['id']))
    assert error.value.status_code == 422
    snapshot['schemaVersion'] = 1
    atomic_write(path, json_bytes(snapshot))
    store.purge(value['id'])
    with pytest.raises(HTTPException):
        store.read(value['id'], include_deleted=True)
    with pytest.raises(HTTPException):
        store.save(value)
    assert list(store.documents()) == []
    path.unlink()
    with pytest.raises(HTTPException) as error:
        store.read(value['id'])
    assert error.value.status_code == 503


def test_warn_enforce_and_semantic_validation(tmp_path, monkeypatch):
    value = canvas()
    value['nodes'] = [{'id': 'n', 'type': 'prompt', 'x': float('nan'), 'y': 0},
                      {'id': 'n', 'type': 'unknown-plugin', 'x': 0, 'y': 0}]
    value['connections'] = [{'from': 'n', 'to': 'missing'}, {'from': 'n', 'to': 'missing'}]
    codes = {item['code'] for item in validate_canvas(value)}
    assert {'finite', 'duplicate_node', 'missing_endpoint', 'duplicate_connection'} <= codes
    monkeypatch.setenv('ART_CANVAS_SCHEMA_MODE', 'warn')
    assert check_write(value, None, tmp_path)
    log = (tmp_path / 'logs/canvas-schema.log').read_text(encoding='utf-8')
    assert value['id'] not in log and 'unknown-plugin' not in log
    monkeypatch.setenv('ART_CANVAS_SCHEMA_MODE', 'enforce')
    with pytest.raises(HTTPException) as error:
        check_write(value, None, tmp_path)
    assert error.value.status_code == 422


def test_alias_resolution_missing_files_authorization_and_purge(tmp_path):
    store = CanvasStore(tmp_path)
    value = publish(store)
    calls = []
    paths = CanvasPaths(store, authorize=lambda item: calls.append(item['owner']))
    target = paths.resolve_media('/assets/alice/%E7%94%BB%E5%B8%83%20folder/missing.png?x=1#f')
    assert target == store.directory(value['id']) / 'assets/missing.png'
    assert calls == ['alice']
    assert not target.exists()
    def deny(item):
        raise HTTPException(403, 'denied')
    with pytest.raises(HTTPException) as error:
        CanvasPaths(store, authorize=deny).resolve_media('/output/alice/画布 folder/x.png')
    assert error.value.status_code == 403
    for path in ('../x', 'alice/../../x', 'C:/x', '//server/file'):
        with pytest.raises(HTTPException):
            paths.resolve_write_path(path, 'output')
    store.purge(value['id'])
    assert paths.resolve_media('/output/alice/画布 folder/retained.png') is not None
    with pytest.raises(HTTPException):
        paths.resolve_write_path('alice/画布 folder/new.png', 'output')


def test_bundle_roundtrip_owner_rewrite_and_nested_query(tmp_path):
    store = CanvasStore(tmp_path)
    value = canvas()
    url = '/assets/alice/%E7%94%BB%E5%B8%83%20folder/pic%25.png?download=1#preview'
    value['nodes'] = [{'id': 'image', 'type': 'image', 'x': 50, 'y': -2, 'nested': {'url': url}}]
    value['apiKey'] = 'never-export'
    value['arbitraryText'] = 'http://[invalid-url'
    value = publish(store, value)
    source = store.directory(value['id']) / 'assets/pic%.png'
    source.write_bytes(b'image content')
    archive, manifest = export_bundle(store, value['id'], lambda url: CanvasPaths(store).resolve_media(url))
    try:
        assert manifest['selfContained']
        with zipfile.ZipFile(archive) as reader:
            assert b'never-export' not in reader.read('canvas.json')
        imported, _ = import_bundle(store, archive, 'bob', 'bob', lambda title, cid: 'new_' + cid)
        assert imported['id'] != value['id'] and imported['owner'] == 'bob'
        rewritten = imported['nodes'][0]['nested']['url']
        assert rewritten.startswith('/assets/bob/new_') and rewritten.endswith('?download=1#preview')
        assert CanvasPaths(store).resolve_media(rewritten).read_bytes() == b'image content'
        assert imported['nodes'][0]['x'] == 50
    finally:
        shutil.rmtree(archive.parent)


def test_legacy_purge_quarantines_and_alias_collision_is_rejected(tmp_path):
    store, value = legacy_with_file(tmp_path)
    with pytest.raises(HTTPException) as error:
        publish(store, canvas('c' * 32, folder='legacy'))
    assert error.value.status_code == 409
    store.purge(value['id'])
    assert not store.legacy_file(value['id']).exists()
    assert list((store.root / '.trash').glob('*/legacy.json'))
    assert (tmp_path / 'output/alice/legacy/pic.png').read_bytes() == b'original'


@pytest.mark.parametrize('names', [['../escape'], ['/abs'], ['C:/escape'], ['\\\\server\\x'],
                                  ['assets/a', 'assets/A'], ['assets/a', 'assets/a'], ['assets/x:stream'],
                                  ['assets/CON.png'], ['assets/a/../b']])
def test_unsafe_archives_rejected_without_publication(tmp_path, names):
    archive = tmp_path / 'bad.zip'
    with zipfile.ZipFile(archive, 'w') as output:
        for name in names:
            output.writestr(name, b'x')
    store = CanvasStore(tmp_path / 'user')
    with pytest.raises(HTTPException):
        import_bundle(store, archive, 'bob', 'bob', lambda title, cid: cid)
    assert list(store.documents()) == []
    assert not list((store.root / '.staging').glob('*'))


def test_links_and_quota_rejected(tmp_path, monkeypatch):
    import core.canvas_bundle as bundle
    archive = tmp_path / 'bad.zip'
    with zipfile.ZipFile(archive, 'w') as output:
        link = zipfile.ZipInfo('assets/link')
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        output.writestr(link, '../secret')
    store = CanvasStore(tmp_path / 'user')
    with pytest.raises(HTTPException):
        import_bundle(store, archive, 'bob', 'bob', lambda title, cid: cid)
    monkeypatch.setattr(bundle, 'MAX_TOTAL', 3)
    with zipfile.ZipFile(archive, 'w') as output:
        output.writestr('canvas.json', b'1234')
    with pytest.raises(HTTPException) as error:
        import_bundle(store, archive, 'bob', 'bob', lambda title, cid: cid)
    assert error.value.status_code == 413


def legacy_with_file(tmp_path):
    store = CanvasStore(tmp_path)
    value = canvas(folder='legacy')
    atomic_write(store.legacy_file(value['id']), json_bytes(value))
    atomic_write(tmp_path / 'output/alice/legacy/pic.png', b'original')
    return store, value


def test_migration_dry_run_copy_resume_and_rollback(tmp_path, monkeypatch):
    store, value = legacy_with_file(tmp_path)
    before = {p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob('*')}
    record = migration.plan(store, value['id'])
    assert before == {p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob('*')}
    rebuild = store.rebuild_index
    def interrupted():
        raise RuntimeError('simulated crash after directory publication')
    monkeypatch.setattr(store, 'rebuild_index', interrupted)
    with pytest.raises(RuntimeError):
        migration.apply(store, record)
    assert store.published(value['id'])
    monkeypatch.setattr(store, 'rebuild_index', rebuild)
    record = migration.load_log(store, migration._log_path(store, record['operation']))
    migration.apply(store, record)
    assert migration.verify(store, record)
    migration.apply(store, record)  # idempotent
    assert (tmp_path / 'output/alice/legacy/pic.png').read_bytes() == b'original'
    migration.rollback(store, record)
    assert not store.published(value['id'])
    assert (store.root / '.rollback' / record['operation'] / 'outputs/pic.png').is_file()


def test_migration_refuses_rollback_after_new_writes(tmp_path):
    store, value = legacy_with_file(tmp_path)
    record = migration.apply(store, migration.plan(store, value['id']))
    loaded = store.read(value['id'])
    loaded['title'] = 'new writes'
    store.save(loaded)
    with pytest.raises(HTTPException) as error:
        migration.rollback(store, record)
    assert error.value.status_code == 409
    assert store.read(value['id'])['title'] == 'new writes'


def test_migration_refuses_new_source_files(tmp_path):
    store, value = legacy_with_file(tmp_path)
    record = migration.plan(store, value['id'])
    atomic_write(tmp_path / 'output/alice/legacy/new.png', b'new upload')
    with pytest.raises(HTTPException) as error:
        migration.apply(store, record)
    assert error.value.status_code == 409
    assert not store.published(value['id'])


@pytest.mark.parametrize('phase', ['copying', 'prepared', 'published', 'copy', 'validation'])
def test_migration_recovers_interrupted_phases(tmp_path, monkeypatch, phase):
    store, value = legacy_with_file(tmp_path)
    record = migration.plan(store, value['id'])
    write_log, copyfile, digest = migration._write_log, migration.shutil.copyfile, migration.digest
    def log_then_crash(store, record):
        write_log(store, record)
        if record['state'] == phase:
            raise RuntimeError('simulated log-phase interruption')
    def copy_then_crash(source, target):
        copyfile(source, target)
        raise RuntimeError('simulated copy interruption')
    def corrupt_validation(path):
        return 'bad hash' if '.staging' in str(path) else digest(path)
    monkeypatch.setattr(migration, '_write_log', log_then_crash)
    if phase == 'copy':
        monkeypatch.setattr(migration.shutil, 'copyfile', copy_then_crash)
    if phase == 'validation':
        monkeypatch.setattr(migration, 'digest', corrupt_validation)
    with pytest.raises((RuntimeError, HTTPException)):
        migration.apply(store, record)
    assert store.published(value['id']) == (phase == 'published')
    monkeypatch.setattr(migration, '_write_log', write_log)
    monkeypatch.setattr(migration.shutil, 'copyfile', copyfile)
    monkeypatch.setattr(migration, 'digest', digest)
    record = migration.load_log(store, migration._log_path(store, record['operation']))
    migration.apply(store, record)
    assert migration.verify(store, record)
    assert (tmp_path / 'output/alice/legacy/pic.png').read_bytes() == b'original'


def test_persistence_api_lifecycle(tmp_path):
    import os
    import subprocess
    import sys
    from pathlib import Path
    script = r'''
import io, json
from pathlib import Path
import core.user_paths
core.user_paths.migrate_project_user_data = lambda *a, **k: []
import core.media_migration
core.media_migration.migrate = lambda *a, **k: {}
import main
from fastapi.testclient import TestClient
from core.canvas_store import store_for
main.save_users({'alice': {'token': 'test-alice'}, 'bob': {'token': 'test-bob'}})
client = TestClient(main.app)
a = {'Authorization': 'Bearer test-alice'}
b = {'Authorization': 'Bearer test-bob'}
def ok(response):
    assert response.status_code == 200, (response.status_code, response.text)
    return response.json()
created = ok(client.post('/api/canvases', headers=a, json={'title': '兼容性画布'}))
canvas = created['canvas']
cid = canvas['id']
store = store_for(main.CANVAS_DIR)
assert store.published(cid) and not store.legacy_file(cid).exists()
assert client.get('/api/canvases/' + cid, headers=b).status_code == 403
from PIL import Image
image_stream = io.BytesIO()
Image.new('RGB', (2, 2)).save(image_stream, format='PNG')
image_bytes = image_stream.getvalue()
upload = ok(client.post('/api/canvases/' + cid + '/assets/upload', headers=a,
    files=[('files', ('image.png', image_bytes, 'image/png'))]))
url = upload['files'][0]['url']
assert client.get(url, headers=a).content == image_bytes
assert client.get(url, headers=b).status_code == 403
canvas['nodes'] = [{'id': 'image', 'type': 'image', 'x': 0, 'y': 0, 'url': url}]
output = store.directory(cid) / 'outputs/generated.png'
output.write_bytes(b'generated-content')
output_url = main.build_output_url(canvas, 'generated.png')
canvas['logs'] = [{'id': 'test-log', 'outputs': [{'url': output_url}]}]
saved = ok(client.put('/api/canvases/' + cid, headers=a, json=canvas))['canvas']
assert saved['revision'] > canvas['revision']
from routers.game_projects import reference_content
context = main.REQUEST_TOKEN.set('test-alice')
try:
    reference = reference_content('test', [url], None, 'alice')
    assert reference[1]['image_url']['url'].startswith('data:image/jpeg;base64,')
finally:
    main.REQUEST_TOKEN.reset(context)
assert main.output_file_from_url(output_url) == str(output)
assert main.asset_library_item_path(output_url) == str(output)
assert client.get('/api/download-output', headers=a, params={'url': output_url}).content == b'generated-content'
sibling = ok(client.post('/api/canvases', headers=a, json={'title': '共享引用'}))['canvas']
sibling['nodes'] = [{'id': 'shared', 'type': 'image', 'x': 0, 'y': 0, 'url': output_url}]
ok(client.put('/api/canvases/' + sibling['id'], headers=a, json=sibling))
assert client.put('/api/canvases/' + cid, headers=a,
    json={**saved, 'base_revision': canvas['revision']}).status_code == 409
ok(client.post('/api/canvases/' + cid + '/meta', headers=a, json={'title': '改名'}))
assert ok(client.get('/api/canvases/' + cid, headers=a))['canvas']['nodes'] == saved['nodes']
bundle = client.get('/api/canvases/' + cid + '/export', headers=a)
assert bundle.status_code == 200, bundle.text
imported = ok(client.post('/api/canvases/import', headers=b,
    files={'file': ('canvas.zip', bundle.content, 'application/zip')}))['canvas']
assert imported['id'] != cid and imported['owner'] == 'bob'
assert client.get(imported['nodes'][0]['url'], headers=b).content == image_bytes
assert client.get(imported['nodes'][0]['url'], headers=a).status_code == 403
deleted_log = ok(client.post('/api/canvases/' + cid + '/logs/delete', headers=a,
    json={'log_id': 'test-log', 'delete_unreferenced_media': True}))
assert output.is_file() and 'generated.png' in deleted_log['skipped_referenced']
disposable = store.directory(cid) / 'outputs/disposable.png'
disposable.write_bytes(b'disposable')
path = main.build_output_url(canvas, disposable.name)[len('/output/'):]
assert client.get('/api/delete-output-file', headers=b, params={'path': path}).status_code == 403
ok(client.get('/api/delete-output-file', headers=a, params={'path': path}))
assert not disposable.exists()
ok(client.delete('/api/canvases/' + cid, headers=a))
assert client.get('/api/canvases/' + cid, headers=a).status_code == 404
assert client.get(output_url, headers=a).content == b'generated-content'
ok(client.post('/api/canvases/' + cid + '/restore', headers=a))
assert ok(client.get('/api/canvases/' + cid, headers=a))['canvas']['nodes'] == saved['nodes']
snapshot = store.directory(cid) / 'project.json'
envelope = json.loads(snapshot.read_text(encoding='utf-8'))
envelope['schemaVersion'] = 999
snapshot.write_text(json.dumps(envelope), encoding='utf-8')
assert client.put('/api/canvases/' + cid, headers=a, json=saved).status_code == 422
envelope['schemaVersion'] = 1
snapshot.write_text(json.dumps(envelope), encoding='utf-8')
ok(client.delete('/api/canvases/' + cid, headers=a))
ok(client.delete('/api/canvases/' + cid + '/purge', headers=a))
assert client.get('/api/canvases/' + cid, headers=a).status_code == 404
assert client.get(imported['nodes'][0]['url'], headers=b).content == image_bytes
print('PERSISTENCE_API_OK')
'''
    result = subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).parents[1],
        env={**os.environ, 'ART_CANVAS_HOME': str(tmp_path / 'user'), 'PYTHONIOENCODING': 'utf-8'},
        capture_output=True, text=True, encoding='utf-8', timeout=90)
    assert result.returncode == 0, result.stdout[-1500:] + result.stderr[-2500:]
    assert 'PERSISTENCE_API_OK' in result.stdout
