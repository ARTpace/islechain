import io
import json
import zipfile

from test_game_workspace import env, call, create


def install(env):
    state = create(env)
    response = call(env, 'POST', '/template', dict(baseRevision=state['revision']))
    assert response.status_code == 200, response.text
    return response.json()


def build(env):
    state = install(env)
    response = call(env, 'POST', '/builds', dict(baseRevision=state['revision']))
    assert response.status_code == 200, response.text
    return response.json()


def test_build_fixed_artifact_sandbox_and_export(env):
    result = build(env)
    assert result['syntaxCheck']['exitCode'] == 0
    assert result['developmentOnly']
    preview = call(env, 'GET', f"/builds/{result['buildId']}/preview")
    assert preview.status_code == 200
    csp = preview.headers['content-security-policy']
    assert 'sandbox allow-scripts;' in csp
    assert 'allow-same-origin' not in csp
    assert "connect-src data: blob:" in csp
    assert 'https:' not in csp
    assert 'game-preview-diagnostic' in preview.text
    assert '<canvas' in preview.text
    assert 'GAME_CONFIG' in preview.text
    fitted = env[0].get(f"/api/game-projects/p1/workspace/builds/{result['buildId']}/preview", params={'token':'alice','fit':'true'})
    assert fitted.status_code == 200
    assert '100dvh' in fitted.text and '100dvh' not in preview.text
    assert fitted.headers['content-security-policy'] == csp
    embedded = env[0].get(f"/api/game-projects/p1/workspace/builds/{result['buildId']}/preview", params={'token':'alice','embedded':'true','channel':'node-preview'})
    assert embedded.status_code == 200
    assert 'game-node-control' in embedded.text and 'event.source!==parent' in embedded.text
    assert embedded.text.index('game-node-control') < embedded.text.index('window.GAME_CONFIG=')
    assert 'game-node-control' not in preview.text
    assert call(env, 'GET', f"/builds/{result['buildId']}/preview", owner='bob').status_code == 403
    exported = call(env, 'GET', f"/builds/{result['buildId']}/web.zip")
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['artifactHash'] == result['artifactHash']
        assert 'index.html' in archive.namelist()
    workspace = env[1]
    source = workspace.root / workspace.state()['active'] / 'game.js'
    source.write_text('throw new Error("新源码不影响旧包");', encoding='utf-8')
    assert call(env, 'GET', f"/builds/{result['buildId']}/preview").text == preview.text


def test_template_does_not_overwrite_and_syntax_failure_keeps_build(env):
    result = build(env)
    state = call(env, 'GET').json()
    assert call(env, 'POST', '/template', dict(baseRevision=state['revision'])).status_code == 409
    (env[1].root / state['active'] / 'game.js').write_text('function {', encoding='utf-8')
    response = call(env, 'POST', '/builds', dict(baseRevision=state['revision']))
    assert response.status_code == 422
    assert len(call(env, 'GET', '/builds').json()) == 1
    assert call(env, 'GET', f"/builds/{result['buildId']}/preview").status_code == 200


def test_artifact_corruption_is_diagnosed(env):
    result = build(env)
    (env[1].root / f"builds/{result['buildId']}/index.html").write_text('破坏', encoding='utf-8')
    assert call(env, 'GET', f"/builds/{result['buildId']}/preview").status_code == 409


def test_template_content_limits(env):
    state = install(env)
    path = env[1].root / state['active'] / 'content/game-data.json'
    data = json.loads(path.read_bytes())
    data['datasets'][2]['rows'][0]['values']['target'] = 26
    path.write_text(json.dumps(data), encoding='utf-8')
    assert call(env, 'POST', '/builds', dict(baseRevision=state['revision'])).status_code == 422


def test_multifile_invalid_manifest_and_frozen_order(env):
    state=install(env)
    root=env[1].root/state['active']
    (root/'a.js').write_text('window.Game={value:1};',encoding='utf-8')
    (root/'b.js').write_text('window.Game.value+=2;',encoding='utf-8')
    manifest=dict(schemaVersion=1,runtime='native-canvas-multifile-v1',entry='b.js',scripts=['a.js','b.js'],styles=['style.css'])
    (root/'game-project.json').write_text(json.dumps(manifest),encoding='utf-8')
    result=call(env,'POST','/builds',dict(baseRevision=state['revision']))
    assert result.status_code==200,result.text
    endpoint=f"/builds/{result.json()['buildId']}/preview"
    page=call(env,'GET',endpoint).text
    assert page.index('window.Game={value:1}') < page.index('window.Game.value+=2')
    (root/'a.js').write_text('function {',encoding='utf-8')
    assert call(env,'POST','/builds',dict(baseRevision=state['revision'])).status_code==422
    assert call(env,'GET',endpoint).text==page
    for bad in ([], {'scripts':['../a.js']}, dict(manifest,scripts=['a.js','missing.js'],entry='missing.js'),dict(manifest,scripts=[1,2])):
        (root/'game-project.json').write_text(json.dumps(bad),encoding='utf-8')
        assert call(env,'POST','/builds',dict(baseRevision=state['revision'])).status_code==422


def test_multifile_source_export_builds_offline(env,tmp_path):
    import subprocess
    import sys
    state=install(env)
    root=env[1].root/state['active']
    (root/'state.js').write_text('window.Game={count:1};',encoding='utf-8')
    (root/'main.js').write_text('window.Game.count+=1;',encoding='utf-8')
    manifest=dict(schemaVersion=1,runtime='native-canvas-multifile-v1',entry='main.js',scripts=['state.js','main.js'],styles=['style.css'])
    (root/'game-project.json').write_text(json.dumps(manifest),encoding='utf-8')
    with zipfile.ZipFile(io.BytesIO(env[1].export_source())) as archive:
        archive.extractall(tmp_path)
        assert 'game/state.js' in archive.namelist()
    result=subprocess.run([sys.executable,'-S',str(tmp_path/'build.py')],capture_output=True,timeout=15)
    assert result.returncode==0,result.stderr
    page=(tmp_path/'dist/index.html').read_text('utf-8')
    assert page.index('window.Game={count:1}') < page.index('window.Game.count+=1')
