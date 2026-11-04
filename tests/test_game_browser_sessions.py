import asyncio
import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from core.game_browser_sessions import BrowserSessions
from test_game_workspace import env, create


class Closer:
    version = 'mock'
    def __init__(self):
        self.calls = 0
    async def close(self):
        self.calls += 1
    async def stop(self):
        self.calls += 1


class Page:
    def __init__(self):
        self.viewport_size = dict(width=800, height=600)
        self.clicks = []
        async def pointer(x, y):
            self.clicks.append((x, y))
        self.mouse = SimpleNamespace(click=pointer)
        self.keys = set()
        async def down(key):
            self.keys.add(key)
        async def up(key):
            self.keys.discard(key)
        self.keyboard = SimpleNamespace(down=down, up=up, press=down)
    async def title(self):
        return 'mock'
    def locator(self, selector):
        return self
    async def inner_text(self, **kwargs):
        return 'playing'
    async def click(self, **kwargs):
        pass
    async def screenshot(self, **kwargs):
        return b'\x89PNG\r\n\x1a\n'


def fake_launch(manager, monkeypatch, gate=None, entered=None):
    async def launch(session, page):
        if entered:
            entered.set()
        if gate:
            await gate.wait()
        session.driver = Closer(); session.browser = Closer(); session.context = Closer(); session.page = Page()
    monkeypatch.setattr(manager, '_launch', launch)


def test_owned_sessions_actions_and_capture_are_bounded(env, monkeypatch):
    create(env)
    manager = BrowserSessions()
    fake_launch(manager, monkeypatch)
    async def scenario():
        first = await manager.open(env[1], 'build1', b'')
        second = await manager.open(env[1], 'build1', b'')
        session = manager.get(first['sessionId'], env[1])
        foreign = SimpleNamespace(project=SimpleNamespace(id='other', owner='alice'))
        with pytest.raises(HTTPException) as denied:
            manager.get(session.sessionId, foreign)
        assert denied.value.status_code == 403
        result = await manager.act(session, [dict(type='keydown', key='ArrowRight'),dict(type='wait', milliseconds=0)])
        assert result['text'] == 'playing'
        assert not session.page.keys
        result = await manager.act(session, [dict(type='pointer',x=400,y=300)])
        assert session.page.clicks == [(400, 300)] and result['viewport']['width'] == 800
        for x, y in [(800,300), (0,-1), (True,1)]:
            with pytest.raises(HTTPException):
                await manager.act(session, [dict(type='pointer',x=x,y=y)])
        with pytest.raises(HTTPException):
            await manager.act(session, [dict(type='touch')])
        with pytest.raises(HTTPException):
            await manager.act(session, [dict(type='wait', milliseconds=3001)])
        screenshot = await manager.capture(session)
        assert env[1].path(screenshot['relativePath']).read_bytes().startswith(b'\x89PNG')
        await manager.close(session)
        assert manager.get(second['sessionId'], env[1]).state == 'running'
        await manager.close(manager.get(second['sessionId'], env[1]))
        assert not manager.sessions
    asyncio.run(scenario())


@pytest.mark.skipif(os.environ.get('ART_GAME_BROWSER_TEST') != '1', reason='需显式开启真实 headed 存档验证')
def test_real_save_slots_corruption_and_context_isolation(env):
    from core.game_web_builds import WebBuilds
    state = create(env)
    builds = WebBuilds(env[1].repository, env[1].project)
    state = builds.install_template(state['revision'])
    build = builds.build(state['revision'])
    _, page = builds.artifact(build['buildId'])
    manager = BrowserSessions()
    async def click(session, selector):
        return await manager.act(session, [dict(type='click', selector=selector)])
    async def scenario():
        first = await manager.open(env[1], build['buildId'], page)
        second = await manager.open(env[1], build['buildId'], page)
        one, two = manager.get(first['sessionId'], env[1]), manager.get(second['sessionId'], env[1])
        try:
            await click(one, '#save')
            key = await one.page.evaluate('Object.keys(localStorage)[0]')
            initial = await one.page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', key)
            await manager.act(one, [dict(type='click', selector='canvas'), dict(type='keydown', key='ArrowRight'),
                dict(type='wait', milliseconds=300), dict(type='keyup', key='ArrowRight')])
            await click(one, '#save')
            moved = await one.page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', key)
            assert moved['x'] > initial['x']
            await click(one, '#restart')
            assert '存档已载入' in (await click(one, '#load'))['text']
            await click(one, '#save')
            loaded = await one.page.evaluate('(key) => JSON.parse(localStorage.getItem(key))', key)
            assert loaded['x'] == moved['x']
            assert '当前槽没有存档' in (await click(two, '#load'))['text']
            # 夹具故障注入只修改该独立上下文的存档，不操作宿主或真实玩家数据。
            for broken in ['{broken', '{"saveVersion":999}']:
                await one.page.evaluate('({key, value}) => localStorage.setItem(key, value)', dict(key=key, value=broken))
                assert '原存档保留' in (await click(one, '#load'))['text']
                assert await one.page.evaluate('(key) => localStorage.getItem(key)', key) == broken
            await click(one, '#clear')
            assert await one.page.evaluate('(key) => localStorage.getItem(key)', key) is None
            assert await one.page.evaluate('(key) => localStorage.getItem(key + ":backup")', key) == '{"saveVersion":999}'
            await manager.close(one)
            assert two.state == 'running'
            assert 'playing' in (await manager.inspect(two))['text']
        finally:
            await manager.close(one)
            await manager.close(two)
        assert not manager.sessions
    asyncio.run(scenario())


def test_cancel_waits_for_inflight_open_and_cleans_owned_window(env, monkeypatch):
    create(env)
    manager = BrowserSessions()
    async def scenario():
        gate, entered = asyncio.Event(), asyncio.Event()
        fake_launch(manager, monkeypatch, gate, entered)
        opening = asyncio.create_task(manager.open(env[1], 'b1', b''))
        await entered.wait()
        session = next(iter(manager.sessions.values()))
        closing = asyncio.create_task(manager.close(session))
        await asyncio.sleep(0)
        assert not closing.done()
        gate.set()
        await closing
        with pytest.raises(HTTPException):
            await opening
        assert session.context.calls == 1
        assert session.browser.calls == 1
        assert session.driver.calls == 1
        assert not manager.sessions
    asyncio.run(scenario())


@pytest.mark.skipif(os.environ.get('ART_GAME_BROWSER_TEST') != '1', reason='需显式开启真实有界 headed 浏览器验证')
def test_real_headed_fixed_build_input_capture_and_network_denial(env):
    from core.game_web_builds import WebBuilds
    state = create(env)
    builds = WebBuilds(env[1].repository, env[1].project)
    state = builds.install_template(state['revision'])
    build = builds.build(state['revision'])
    _, page = builds.artifact(build['buildId'])
    manager = BrowserSessions()
    async def scenario():
        opened = await manager.open(env[1], build['buildId'], page)
        session = manager.get(opened['sessionId'], env[1])
        try:
            observation = await manager.act(session, [dict(type='click', selector='#restart'),
                dict(type='click', selector='canvas'), dict(type='keydown', key='ArrowRight'),
                dict(type='wait', milliseconds=200), dict(type='keyup', key='ArrowRight')])
            assert 'playing' in observation['text']
            assert not session.keys
            blocked = await session.page.evaluate("fetch('http://127.0.0.1:1/host-secret').then(()=>false,()=>true)")
            assert blocked
            measured = await manager.measure(session)
            assert measured['buildId'] == build['buildId']
            assert measured['sampleFrames'] == len(measured['samplesMs']) == 60
            assert measured['warmupFrames'] == 10
            assert measured['meanIntervalMs'] > 0
            assert measured['unsupported']
            shot = await manager.capture(session)
            assert env[1].path(shot['relativePath']).read_bytes().startswith(b'\x89PNG')
        finally:
            await manager.close(session)
        assert not manager.sessions
    asyncio.run(scenario())
