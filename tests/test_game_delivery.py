import asyncio
import io
import os
import subprocess
import sys
import zipfile

import pytest

from core.game_browser_sessions import BrowserSessions
from core.game_web_builds import WebBuilds
from test_game_workspace import env, create


def source_package(env, tmp_path):
    state = create(env)
    builds = WebBuilds(env[1].repository, env[1].project)
    builds.install_template(state['revision'])
    raw = env[1].export_source()
    destination = tmp_path / 'clean-source'
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        archive.extractall(destination)
    return destination


def test_source_builds_without_site_packages_or_network_dependencies(env, tmp_path):
    destination = source_package(env, tmp_path)
    result = subprocess.run([sys.executable, '-S', str(destination / 'build.py')],
        cwd=destination, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    page = (destination / 'dist/index.html').read_text(encoding='utf-8')
    assert 'GAME_CONFIG' in page and '<canvas' in page
    assert '<script src=' not in page
    assert not (destination / 'node_modules').exists()
    (destination / 'game/game.js').write_text('modified', encoding='utf-8')
    changed = subprocess.run([sys.executable, '-S', str(destination / 'build.py')],
        cwd=destination, capture_output=True, text=True, timeout=10)
    assert changed.returncode != 0


@pytest.mark.skipif(os.environ.get('ART_GAME_BROWSER_TEST') != '1', reason='需开启真实 headed 交付包验证')
def test_rebuilt_source_artifact_starts_in_fresh_browser(env, tmp_path):
    destination = source_package(env, tmp_path)
    subprocess.run([sys.executable, '-S', str(destination / 'build.py')],
        cwd=destination, capture_output=True, check=True, timeout=10)
    manager = BrowserSessions()
    async def scenario():
        opened = await manager.open(env[1], 'source-development', (destination / 'dist/index.html').read_bytes())
        session = manager.get(opened['sessionId'], env[1])
        try:
            observation = await manager.act(session, [dict(type='click', selector='#restart')])
            assert 'playing' in observation['text']
            assert not session.log
            assert (await manager.capture(session))['sizeBytes'] > 0
        finally:
            await manager.close(session)
    asyncio.run(scenario())
