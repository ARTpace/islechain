"""游戏管线 API 贯穿验收：临时目录、模拟 LLM、真实图片解码与 ZIP 解包。"""
import base64
import asyncio
import copy
import importlib
import io
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import zipfile

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image
import pytest

from core.game_projects import ProjectStore, digest, project_image_path

routes = importlib.import_module('routers.game_projects')


def image_bytes(width=256, height=256, transparent=True):
    stream = io.BytesIO()
    Image.new('RGBA', (width, height), (20, 60, 100, 0 if transparent else 255)).save(stream, 'PNG')
    return stream.getvalue()


@pytest.fixture
def environment(tmp_path, monkeypatch):
    repository = ProjectStore(tmp_path / 'projects')
    canvases = {'canvas_1': dict(id='canvas_1', owner='alice', nodes=[], connections=[])}
    output = tmp_path / 'output'
    for owner in ('alice', 'bob'):
        (output / owner).mkdir(parents=True)

    def identity(token):
        if token not in ('alice', 'bob'):
            raise HTTPException(401, '登录失效')
        return token

    def canvas_for(project, token):
        canvas = canvases.get(project.canvasId)
        if not canvas:
            raise HTTPException(404, '画布不存在')
        if canvas['owner'] != identity(token):
            raise HTTPException(403, '无权访问画布')
        return canvas

    main = SimpleNamespace(require_valid_token=identity,
        output_file_from_url=lambda url: str(output / url.removeprefix('/output/')),
        get_user_output_dir=lambda owner: (str(output / owner), None),
        resolve_chat_provider=lambda *a: ('https://mock.invalid/v1', {}, 'mock-model'),
        text_from_chat_response=lambda raw: raw['choices'][0]['message']['content'],
        AI_REQUEST_TIMEOUT=3)
    monkeypatch.setattr(routes, 'main', lambda: main)
    monkeypatch.setattr(routes, 'store', lambda: repository)
    monkeypatch.setattr(routes, 'canvas_for', canvas_for)
    canvas_module = importlib.import_module('routers.canvases')
    monkeypatch.setattr(canvas_module, 'get_canvas_asset_dir', lambda canvas: str(tmp_path / 'input' / 'alice'))
    app = FastAPI()
    app.include_router(routes.router)
    client = TestClient(app, raise_server_exceptions=False)

    def call(method, path='', data=None, owner='alice'):
        return client.request(method, '/api/game-projects' + path, params={'token': owner}, json=data)

    created = call('POST', data=dict(title='测试探索游戏', canvasId='canvas_1'))
    assert created.status_code == 200, created.text
    project = created.json()['project']
    example = json.loads((Path(__file__).parents[1] / 'docs/examples/game-project.json').read_text('utf-8'))
    return SimpleNamespace(repo=repository, call=call, project=project, example=example,
                           canvases=canvases, output=output, main=main, client=client)


def put(env, suffix, data, method='PUT', project=None):
    project = project or env.project
    result = env.call(method, '/' + project['id'] + suffix, {'baseRevision': project['revision'], **data})
    if result.status_code == 200 and 'project' in result.json():
        env.project = result.json()['project']
    return result


def setup_assets(env):
    response = put(env, '/assets', dict(assets=env.example['assets'], artConfirmed=True))
    assert response.status_code == 200, response.text
    response = put(env, '/plan', dict(plan=env.example['plan'], confirmed=True))
    assert response.status_code == 200, response.text


def test_planning_table_history_validation_and_export(environment):
    env = environment
    table = {'id': 'balance', 'title': '敌人配置', 'columns': [{'id': 'hp', 'title': '血量', 'type': 'number'}],
                 'rows': [{'id': 'slime', 'cells': {'hp': 10}}]}
    assert put(env, '/tables', {'table': table}, 'POST').status_code == 200
    original = copy.deepcopy(env.project)
    assert put(env, '/tables', {'table': table}, 'POST').status_code == 409
    table['rows'][0]['cells']['hp'] = 'invalid'
    assert put(env, '/tables/balance', {'table': table}).status_code == 422
    table['rows'][0]['cells']['hp'] = True
    assert put(env, '/tables/balance', {'table': table}).status_code == 422
    table['rows'][0]['cells']['hp'] = 20
    assert put(env, '/tables/balance', {'table': table}).status_code == 200
    assert put(env, '/tables/balance', {'table': table}, project=original).status_code == 409
    root = '/' + env.project['id'] + '/tables/balance'
    assert env.call('GET', root + '/history').json()['revisions'] == [2, 1]
    assert env.call('GET', root + '/history/1', owner='bob').status_code == 403
    assert env.call('GET', root + '/history/1').json()['item']['rows'][0]['cells']['hp'] == 10
    assert put(env, '/tables/balance/restore', {'revision': 1}, 'POST').status_code == 200
    assert env.project['tables'][0]['revision'] == 3
    assert env.project['tables'][0]['rows'][0]['cells']['hp'] == 10
    assert put(env, '/documents', {'title': '设计', 'content': '# 原稿'}, 'POST').status_code == 200
    doc = env.project['documents'][0]
    assert put(env, '/documents/' + doc['id'], {'title': '设计', 'content': '# 改稿'}).status_code == 200
    assert put(env, '/documents/' + doc['id'] + '/restore', {'revision': 1}, 'POST').status_code == 200
    assert env.project['documents'][0]['lastSavedContent'] == '# 原稿'
    assert env.project['documents'][0]['revision'] == 3
    assert put(env, '/tables/balance/restore', {'revision': 999}, 'POST').status_code == 404
    result = put(env, '/exports', {'draft': True}, 'POST').json()
    exported = env.call('GET', f'/{env.project["id"]}/exports/{result["exportId"]}')
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        assert json.loads(archive.read('tables/balance.json'))['revision'] == 3
        assert archive.read(f'documents/{doc["id"]}.md').decode() == '# 原稿'


def test_ai_edit_preserves_source_and_rejects_incomplete_output(environment, monkeypatch):
    env = environment
    assert put(env, '/documents', {'title': '设计', 'content': '# 原稿'}, 'POST').status_code == 200
    doc = env.project['documents'][0]
    root = '/documents/' + doc['id']
    state = {'reason': 'stop', 'text': '# 修改候选'}

    async def post(*args, **kwargs):
        return SimpleNamespace(raise_for_status=lambda: None,
            json=lambda: {'choices': [{'finish_reason': state['reason'], 'message': {'content': state['text']}}]})

    monkeypatch.setattr(routes.httpx.AsyncClient, 'post', post)
    result = put(env, root + '/ai-edit', {'instruction': '完善核心循环'}, 'POST')
    assert result.status_code == 200, result.text
    assert result.json()['draft'] == '# 修改候选'
    assert result.json()['sourceRevision'] == 1
    assert env.project['documents'][0]['lastSavedContent'] == '# 原稿'
    state['reason'] = 'length'
    assert put(env, root + '/ai-edit', {'instruction': '完善'}, 'POST').status_code == 502
    assert env.project['documents'][0]['lastSavedContent'] == '# 原稿'
    table = {'id': 'config', 'title': '配置', 'columns': [{'id': 'name', 'title': '名称', 'type': 'text'}], 'rows': []}
    assert put(env, '/tables', {'table': table}, 'POST').status_code == 200
    state.update(reason='stop', text=json.dumps({**table, 'id': 'foreign'}))
    assert put(env, '/tables/config/ai-edit', {'instruction': '添加敌人'}, 'POST').status_code == 502
    state['text'] = json.dumps({**table, 'rows': [{'id': 'slime', 'cells': {'name': '史莱姆'}}]})
    result = put(env, '/tables/config/ai-edit', {'instruction': '添加敌人'}, 'POST')
    assert result.status_code == 200, result.text
    assert result.json()['draft']['rows'][0]['id'] == 'slime'
    assert env.project['tables'][0]['rows'] == []


def test_planning_receives_images_and_tables_with_access_checks(environment, monkeypatch):
    env = environment
    table = {'id': 'config', 'title': '配置', 'columns': [{'id': 'name', 'title': '名称', 'type': 'text'}], 'rows': []}
    assert put(env, '/tables', {'table': table}, 'POST').status_code == 200
    path = env.output / 'alice' / 'reference.png'
    path.write_bytes(image_bytes())
    env.main.OUTPUT_DIR = str(env.output)
    env.main.ASSETS_DIR = str(env.output)
    env.main.local_media_path_from_url = lambda url: str(env.output / url.removeprefix('/output/'))
    env.main.image_path_to_data_url = lambda path: 'data:image/png;base64,' + base64.b64encode(Path(path).read_bytes()).decode()

    def access(relative):
        if not relative.startswith('alice/'):
            raise HTTPException(403, '无权查看')

    env.main.assert_account_media = access
    calls = []
    plan = copy.deepcopy(env.example['plan'])
    for item in plan['characters'] + plan['scenes']:
        item['assetIds'] = []

    async def post(*args, **kwargs):
        calls.append(kwargs['json'])
        return SimpleNamespace(raise_for_status=lambda: None,
            json=lambda: {'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(plan)}}]})

    monkeypatch.setattr(routes.httpx.AsyncClient, 'post', post)
    data = {'tableIds': ['config'], 'referenceImages': ['/output/alice/reference.png']}
    result = put(env, '/plan-candidates', data, 'POST')
    assert result.status_code == 200, result.text
    assert result.json()['project']['candidates'][-1]['status'] == 'valid'
    content = calls[-1]['messages'][1]['content']
    assert json.loads(content[0]['text'])['tables'][0]['id'] == 'config'
    assert content[1]['image_url']['url'].startswith('data:image/png;base64,')
    for url, status in [('https://example.com/image.png', 422), ('/output/bob/private.png', 403),
                        ('/output/alice/../bob/private.png', 403), ('/output/alice/../../../outside.png', 422)]:
        assert put(env, '/plan-candidates', {**data, 'referenceImages': [url]}, 'POST').status_code == status
    assert put(env, '/plan-candidates', {'tableIds': ['foreign']}, 'POST').status_code == 422
    assert len(calls) == 1


def upload(env, asset, content=None):
    content = content or image_bytes(asset['spec']['width'], asset['spec']['height'])
    response = put(env, f'/assets/{asset["id"]}/upload', dict(contentBase64=base64.b64encode(content).decode()), 'POST')
    assert response.status_code == 200, response.text
    return response


def test_document_restore_conflict_and_archive(environment, monkeypatch):
    env = environment
    old = copy.deepcopy(env.project)
    result = put(env, '/documents', dict(title='初始策划', content='你好，森林'), 'POST')
    assert result.status_code == 200
    doc = env.project['documents'][0]
    path = env.repo.directory(env.project['id']) / 'documents' / (doc['id'] + '.md')
    assert path.read_text('utf-8') == '你好，森林'
    conflict = put(env, '/documents', dict(title='另一个修改', content='不可覆盖'), 'POST', old)
    assert conflict.status_code == 409
    path.write_text('模拟写入中断', encoding='utf-8')
    loaded = env.call('GET', '/' + env.project['id']).json()
    assert loaded['recovery'][0]['docId'] == doc['id']
    assert loaded['project']['documents'][0]['lastSavedContent'] == '你好，森林'
    assert put(env, '/recover-documents', {}, 'POST').status_code == 200
    assert path.read_text('utf-8') == '你好，森林'
    assert env.call('POST', data=dict(title='重复关联', canvasId='canvas_1')).status_code == 409
    assert put(env, '/archive', {}, 'POST').status_code == 200
    assert path.exists()
    assert env.call('POST', data=dict(title='新项目', canvasId='canvas_1')).status_code == 200
    assert put(env, '/documents', dict(title='归档不能写', content='x'), 'POST').status_code == 409


def test_owner_and_paths(environment):
    env = environment
    pid = '/' + env.project['id']
    assert env.call('GET', pid, owner='bob').status_code == 403
    assert env.call('GET', pid, owner='').status_code == 401
    assert env.call('POST', data=dict(title='越权画布', canvasId='canvas_1'), owner='bob').status_code == 403
    bad = copy.deepcopy(env.example['assets'])
    bad[0]['runtimeDestination'] = 'C:/escape.png'
    assert put(env, '/assets', dict(assets=bad)).status_code == 422
    assert not env.project['assets']
    bad = copy.deepcopy(env.example['assets'])
    bad[0]['referenceAssetIds'] = ['foreign_asset']
    assert put(env, '/assets', dict(assets=bad)).status_code == 422
    with pytest.raises(HTTPException):
        project_image_path(env.repo.root, pid + '/files/a/../../users.json', 'alice')


def test_five_asset_delivery_export_and_partial_update(environment):
    env = environment
    setup_assets(env)
    blocked = put(env, '/exports', dict(draft=False), 'POST')
    assert blocked.status_code == 409
    draft = put(env, '/exports', dict(draft=True), 'POST').json()
    assert draft['issues']
    for original in env.example['assets']:
        upload(env, original)
        review = put(env, f'/assets/{original["id"]}/review', dict(humanConfirmed=True, acceptCurrentRevision=True), 'POST')
        assert review.status_code == 200, review.text
    result = put(env, '/exports', dict(draft=False), 'POST')
    assert result.status_code == 200, result.text
    export = result.json()
    download = env.call('GET', f'/{env.project["id"]}/exports/{export["exportId"]}')
    assert download.status_code == 200
    assert env.call('GET', f'/{env.project["id"]}/exports/{export["exportId"]}', owner='bob').status_code == 403
    with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['projectRevision'] == env.project['revision']
        assert len(manifest['assets']) == 5
        for item in manifest['assets']:
            assert digest(archive.read(item['path'])) == item['contentHash']
            assert not Path(item['path']).is_absolute()
            assert item['review']['humanConfirmed']
            assert item['review']['status'] == 'passed'
        assert next(a for a in manifest['assets'] if a['usage'] == 'concept')['path'].startswith('references/')
        assert 'owner' not in archive.read('manifest.json').decode()
        assert str(env.repo.root) not in archive.read('manifest.json').decode()
    old_paths = [a['selected']['relativePath'] for a in env.project['assets']]
    changed = copy.deepcopy(env.project['assets'])
    changed[1]['spec']['width'] = 512
    response = put(env, '/assets', dict(assets=changed, artConfirmed=True))
    assert response.status_code == 200
    assert [a['id'] for a in env.project['assets'] if a['needsUpdate']] == ['asset_hero_portrait']
    assert [a['selected']['relativePath'] for a in env.project['assets']] == old_paths
    assert put(env, '/exports', dict(draft=False), 'POST').status_code == 409
    assert all((env.repo.directory(env.project['id']) / path).exists() for path in old_paths)


def test_binding_idempotence_outputs_and_late_results(environment):
    env = environment
    setup_assets(env)
    asset = env.project['assets'][1]
    canvas = env.canvases['canvas_1']
    canvas['nodes'] = [dict(id='gen_1', type='generator', projectId=env.project['id'], assetId=asset['id']),
                       dict(id='prompt_1', type='prompt', projectId=env.project['id'], assetId=asset['id'])]
    canvas['connections'] = [dict(id='c1', **{'from': 'prompt_1', 'to': 'gen_1'})]
    for _ in range(2):
        result = put(env, '/assets/' + asset['id'] + '/binding', dict(generatorNodeId='gen_1', promptNodeId='prompt_1'), 'POST')
        assert result.status_code == 200
    assert len(canvas['nodes']) == 2
    canvas['nodes'].append(dict(id='copy_gen', type='generator', projectId=env.project['id'], assetId=asset['id']))
    canvas['connections'].append(dict(id='c2', **{'from': 'prompt_1', 'to': 'copy_gen'}))
    assert put(env, '/assets/' + asset['id'] + '/binding', dict(generatorNodeId='copy_gen', promptNodeId='prompt_1'), 'POST').status_code == 409
    canvas['nodes'][0]['type'] = 'image'
    assert put(env, '/assets/' + asset['id'] + '/binding', dict(generatorNodeId='copy_gen', promptNodeId='prompt_1'), 'POST').status_code == 200
    source = env.output / 'alice' / 'result.png'
    source.write_bytes(image_bytes())
    output = dict(id='output_1', assetId=asset['id'], sourceNodeId='gen_1', sourceOutputId='out_1',
                  sourceAssetRevision=1, sourceUrl='/output/alice/result.png', parameters=dict(prompt='头像'))
    url = '/' + env.project['id'] + '/assets/' + asset['id']
    response = env.call('POST', url + '/outputs', dict(output=output))
    assert response.status_code == 200, response.text
    env.project = response.json()['project']
    revision = env.project['revision']
    assert env.call('POST', url + '/outputs', dict(output=output)).json()['project']['revision'] == revision
    duplicate = {**output, 'id': 'duplicate_callback', 'sourceOutputId': 'duplicate_log_id'}
    assert env.call('POST', url + '/outputs', dict(output=duplicate)).json()['project']['revision'] == revision
    assert put(env, '/assets/' + asset['id'] + '/selection', dict(candidateId='output_1'), 'POST').status_code == 200
    selected = copy.deepcopy(env.project['assets'][1]['selected'])
    late_source = env.output / 'alice' / 'late.png'
    late_source.write_bytes(image_bytes())
    output.update(id='late_output', sourceOutputId='out_late', sourceUrl='/output/alice/late.png')
    canvas['nodes'] = [n for n in canvas['nodes'] if n['id'] != 'gen_1']
    response = env.call('POST', url + '/outputs', dict(output=output))
    env.project = response.json()['project']
    assert env.project['assets'][1]['selected'] == selected
    source.unlink()
    late_source.unlink()
    assert env.call('GET', '/' + env.project['id'] + '/assets/' + asset['id'] + '/image').status_code == 200
    assert put(env, '/assets/' + asset['id'] + '/selection', dict(candidateId='late_output'), 'POST').status_code == 404
    version_url = f'/api/game-projects/{env.project["id"]}/files/{asset["id"]}/{selected["selectionId"]}.png'
    assert project_image_path(env.repo.root, version_url, 'alice').read_bytes() == image_bytes()
    with pytest.raises(HTTPException):
        project_image_path(env.repo.root, version_url, 'bob')
    source.write_bytes(image_bytes())
    foreign = copy.deepcopy(output)
    foreign.update(id='foreign_output', sourceOutputId='foreign', sourceUrl='/output/bob/result.png')
    (env.output / 'bob' / 'result.png').write_bytes(image_bytes())
    assert env.call('POST', url + '/outputs', dict(output=foreign)).status_code == 403


@pytest.mark.parametrize('reason,text', [('length', '{}'), ('stop', ''), ('content_filter', '{}')])
def test_llm_failed_output_preserves_plan(environment, monkeypatch, reason, text):
    env = environment
    setup_assets(env)
    old = copy.deepcopy(env.project['plan'])
    response = SimpleNamespace(raise_for_status=lambda: None,
        json=lambda: dict(choices=[dict(finish_reason=reason, message=dict(content=text))]))
    post = AsyncMock(return_value=response)
    monkeypatch.setattr(routes.httpx.AsyncClient, 'post', post)
    result = put(env, '/plan-candidates', {}, 'POST')
    assert result.status_code == 200, result.text
    assert env.project['plan'] == old
    assert env.project['candidates'][-1]['status'] == 'failed'
    assert post.await_count == 1


def test_llm_repair_once_and_source_conflict(environment, monkeypatch):
    env = environment
    plan = env.example['plan']
    # 初次策划还没有资产，角色/场景不得引用尚不存在的清单。
    plan = copy.deepcopy(plan)
    for entity in plan['characters'] + plan['scenes']:
        entity['assetIds'] = []
    replies = ['{}', json.dumps(plan)]
    async def post(*args, **kwargs):
        text = replies.pop(0)
        return SimpleNamespace(raise_for_status=lambda: None,
            json=lambda: dict(choices=[dict(finish_reason='stop', message=dict(content=text))]))
    mocked = AsyncMock(side_effect=post)
    monkeypatch.setattr(routes.httpx.AsyncClient, 'post', mocked)
    result = put(env, '/plan-candidates', {}, 'POST')
    assert result.status_code == 200, result.text
    candidate = env.project['candidates'][-1]
    assert candidate['status'] == 'valid'
    assert len(candidate['rawAttempts']) == 2
    assert mocked.await_count == 2
    assert env.project['plan'] is None
    assert put(env, '/documents', dict(title='新来源', content='变化'), 'POST').status_code == 200
    response = put(env, '/plan', dict(plan=candidate['data'], confirmed=True, candidateId=candidate['id']))
    assert response.status_code == 409
    assert response.json()['detail']['sourceChanged']
    assert put(env, '/plan', dict(plan=candidate['data'], confirmed=True, candidateId=candidate['id'], acknowledgeSourceChange=True)).status_code == 200
    assert env.project['planConfirmed']


@pytest.mark.parametrize('fence', ['```json\n{}\n```', '```\n{}\n```', '{}'])
def test_asset_candidate_accepts_json_code_block(environment, monkeypatch, fence):
    env = environment
    setup_assets(env)
    previous = copy.deepcopy(env.project['assets'])
    text = fence.replace('{}', json.dumps(env.example['assets']))
    response = SimpleNamespace(raise_for_status=lambda: None,
        json=lambda: dict(choices=[dict(finish_reason='stop', message=dict(content=text))]))
    post = AsyncMock(return_value=response)
    monkeypatch.setattr(routes.httpx.AsyncClient, 'post', post)
    result = put(env, '/asset-candidates', {}, 'POST')
    assert result.status_code == 200, result.text
    candidate = env.project['candidates'][-1]
    assert candidate['status'] == 'valid', candidate['diagnostics']
    assert candidate['raw'] == text
    assert post.await_count == 1
    assert env.project['assets'] == previous


def test_asset_candidate_model_draft_normalization(environment, monkeypatch):
    env = environment
    setup_assets(env)
    previous = copy.deepcopy(env.project['assets'])
    data = copy.deepcopy(env.example['assets'])
    for asset in data:
        asset.update(generatorNodeId='invented_same_node', promptNodeId='invented_same_prompt',
                     selected={'invented': True}, review={'status': 'passed'}, needsUpdate=True)
        if asset['usage'] == 'concept':
            asset['runtimeDestination'] = asset['runtimeDestination'].replace('references/', 'assets/', 1)
    text = json.dumps(data)[1:-1]  # 实际渠道返回的完整对象序列，遗漏了最外层 []。
    response = SimpleNamespace(raise_for_status=lambda: None,
        json=lambda: dict(choices=[dict(finish_reason='stop', message=dict(content=text))]))
    post = AsyncMock(return_value=response)
    monkeypatch.setattr(routes.httpx.AsyncClient, 'post', post)
    result = put(env, '/asset-candidates', {}, 'POST')
    assert result.status_code == 200, result.text
    candidate = env.project['candidates'][-1]
    assert candidate['status'] == 'valid', candidate['diagnostics']
    assert post.await_count == 1
    assert candidate['raw'] == text
    for asset in candidate['data']:
        assert asset['generatorNodeId'] is None and asset['selected'] is None
        assert asset['review']['status'] == 'pending' and not asset['needsUpdate']
        assert asset['runtimeDestination'].startswith('references/' if asset['usage'] == 'concept' else 'assets/')
    assert env.project['assets'] == previous


@pytest.mark.parametrize('text', ['{"id":"a"', '{"id":"a"},', '说明：{"id":"a"}', '{"id":"a"} explanation'])
def test_candidate_json_rejects_truncation_and_prose(text):
    with pytest.raises(ValueError):
        routes.candidate_json(text, 'assets')


@pytest.mark.parametrize('destination', ['assets/../escape.png', 'assets/CON.png'])
def test_generated_asset_does_not_repair_unsafe_paths(destination):
    with pytest.raises(ValueError):
        routes.generated_asset({'id': 'a', 'usage': 'concept', 'runtimeDestination': destination})


def test_concurrent_revision_allows_only_one_write(environment):
    env = environment
    snapshot = copy.deepcopy(env.project)
    def save(i):
        return env.call('POST', '/' + snapshot['id'] + '/documents', dict(baseRevision=snapshot['revision'], title=str(i), content='内容')).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, range(2))) == [200, 409]


def test_format_alpha_and_selection_integrity(environment):
    env = environment
    setup_assets(env)
    portrait = env.project['assets'][1]
    upload(env, portrait, image_bytes(32, 32, False))
    result = put(env, '/assets/' + portrait['id'] + '/review', dict(humanConfirmed=True), 'POST')
    assert result.status_code == 200
    review = env.project['assets'][1]['review']
    assert review['status'] == 'failed'
    assert review['imageInfo']['hasAlpha']
    assert not review['imageInfo']['hasTransparentPixels']
    assert len(review['issues']) == 2
    path = env.repo.directory(env.project['id']) / env.project['assets'][1]['selected']['relativePath']
    path.write_bytes(b'corrupt')
    assert env.call('GET', '/' + env.project['id'] + '/assets/' + portrait['id'] + '/image').status_code == 409
    assert put(env, '/assets/' + portrait['id'] + '/upload', dict(contentBase64=base64.b64encode(b'not-image').decode()), 'POST').status_code == 422


def test_interrupted_selection_keeps_previous_file(environment, monkeypatch):
    env = environment
    setup_assets(env)
    asset = env.project['assets'][0]
    upload(env, asset)
    previous = copy.deepcopy(env.project['assets'][0]['selected'])
    original_save = env.repo.save
    def fail(*args, **kwargs):
        raise OSError('模拟元数据写入中断')
    monkeypatch.setattr(env.repo, 'save', fail)
    result = put(env, '/assets/' + asset['id'] + '/upload', dict(contentBase64=base64.b64encode(image_bytes(1024, 1024)).decode()), 'POST')
    assert result.status_code == 500
    monkeypatch.setattr(env.repo, 'save', original_save)
    persisted = env.call('GET', '/' + env.project['id']).json()['project']
    assert persisted['assets'][0]['selected'] == previous
    assert (env.repo.directory(env.project['id']) / previous['relativePath']).is_file()


def test_document_commit_interruption_is_explicit(environment, monkeypatch):
    env = environment
    original_write = env.repo.write_document_file
    def fail(*args, **kwargs):
        raise OSError('模拟正文写入中断')
    monkeypatch.setattr(env.repo, 'write_document_file', fail)
    assert put(env, '/documents', dict(title='中断正文', content='权威正文'), 'POST').status_code == 500
    loaded = env.call('GET', '/' + env.project['id']).json()
    assert loaded['recovery']
    assert loaded['project']['documents'][0]['lastSavedContent'] == '权威正文'
    env.project = loaded['project']
    monkeypatch.setattr(env.repo, 'write_document_file', original_write)
    assert put(env, '/recover-documents', {}, 'POST').status_code == 200
    assert env.call('GET', '/' + env.project['id']).json()['recovery'] == []


def test_invalid_llm_retries_only_once(environment, monkeypatch):
    env = environment
    setup_assets(env)
    previous = copy.deepcopy(env.project['plan'])
    response = SimpleNamespace(raise_for_status=lambda: None,
        json=lambda: dict(choices=[dict(finish_reason='stop', message=dict(content='{}'))]))
    mocked = AsyncMock(return_value=response)
    monkeypatch.setattr(routes.httpx.AsyncClient, 'post', mocked)
    assert put(env, '/plan-candidates', {}, 'POST').status_code == 200
    candidate = env.project['candidates'][-1]
    assert candidate['status'] == 'invalid'
    assert len(candidate['rawAttempts']) == len(candidate['diagnostics']) == mocked.await_count == 2
    assert env.project['plan'] == previous


def test_source_and_reference_changes_remain_local(environment):
    env = environment
    assert put(env, '/documents', dict(title='来源', content='初始内容'), 'POST').status_code == 200
    setup_assets(env)
    doc_id = env.project['documents'][0]['id']
    assert put(env, '/documents/' + doc_id, dict(title='来源', content='新内容')).status_code == 200
    assert env.project['planSourceChanged']
    assert env.project['plan']['title'] == env.example['plan']['title']
    assert put(env, '/asset-candidates', {}, 'POST').status_code == 409
    upload(env, env.project['assets'][0])
    assert [a['id'] for a in env.project['assets'] if a['needsUpdate']] == ['asset_hero_portrait']


def test_added_working_documents_do_not_invalidate_confirmed_plan(environment):
    env = environment
    assert put(env, '/documents', dict(title='策划来源', content='原始需求'), 'POST').status_code == 200
    source_id = env.project['documents'][0]['id']
    setup_assets(env)
    assert put(env, '/documents', dict(title='开发记录', content='调试笔记'), 'POST').status_code == 200
    assert not env.project['planSourceChanged']
    note_id = env.project['documents'][-1]['id']
    assert put(env, '/documents/' + note_id, dict(title='开发记录', content='更新笔记')).status_code == 200
    assert not env.project['planSourceChanged']
    # Repair persisted false positives from older versions on read, without a new AI request.
    stored = env.repo.read(env.project['id'], 'alice')
    stored.planSourceChanged = True
    env.repo.save(stored)
    loaded = env.call('GET', '/' + env.project['id']).json()['project']
    assert loaded['planConfirmed'] and not loaded['planSourceChanged']
    env.project = loaded
    assert put(env, '/documents/' + source_id, dict(title='策划来源', content='修改玩法')).status_code == 200
    assert env.project['planSourceChanged']
    assert put(env, '/plan', dict(plan=env.project['plan'], confirmed=True)).status_code == 200
    assert not env.call('GET', '/' + env.project['id']).json()['project']['planSourceChanged']


def test_saving_unchanged_source_table_does_not_require_reconfirmation(environment):
    env = environment
    table = dict(id='balance', title='数值', columns=[dict(id='hp', title='血量', type='number')], rows=[])
    assert put(env, '/tables', dict(table=table), 'POST').status_code == 200
    setup_assets(env)
    assert put(env, '/tables/balance', dict(table=env.project['tables'][0])).status_code == 200
    assert not env.project['planSourceChanged']


def test_adopted_candidate_tracks_only_documents_used_for_planning(environment, monkeypatch):
    env = environment
    setup_assets(env)
    assert put(env, '/documents', dict(title='输入需求', content='玩法需求'), 'POST').status_code == 200
    source_id = env.project['documents'][-1]['id']
    assert put(env, '/documents', dict(title='调试笔记', content='不参与策划'), 'POST').status_code == 200
    note_id = env.project['documents'][-1]['id']
    response = SimpleNamespace(raise_for_status=lambda: None,
        json=lambda: dict(choices=[dict(finish_reason='stop', message=dict(content=json.dumps(env.example['plan'])))]))
    monkeypatch.setattr(routes.httpx.AsyncClient, 'post', AsyncMock(return_value=response))
    assert put(env, '/plan-candidates', dict(documentIds=[source_id]), 'POST').status_code == 200
    candidate = env.project['candidates'][-1]
    assert candidate['status'] == 'valid'
    assert set(candidate['sourceHashes']) == {source_id}
    assert put(env, '/plan', dict(plan=candidate['data'], confirmed=True, candidateId=candidate['id'])).status_code == 200
    assert put(env, '/documents/' + note_id, dict(title='调试笔记', content='更新实现说明')).status_code == 200
    assert not env.project['planSourceChanged']


def test_game_project_inherits_canvas_guest_policy():
    from core.feature_access import required_modules
    for path in ('/api/game-projects', '/api/game-projects/project_1/exports/export_1'):
        assert asyncio.run(required_modules(SimpleNamespace(url=SimpleNamespace(path=path)))) == {'canvas'}
