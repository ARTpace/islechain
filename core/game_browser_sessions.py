"""一个 Web 试玩适配器：独立浏览器上下文、禁止网络，只加载固定构建。"""
import asyncio
import time
from dataclasses import dataclass, field

from fastapi import HTTPException

from core.game_projects import atomic_write, digest, json_bytes, uid

CAPABILITIES = ['keyboard', 'mouse', 'viewport', 'screenshot', 'dom']
KEYS = {'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'Space', 'Enter', 'Escape'}


@dataclass
class BrowserSession:
    sessionId: str
    runId: str
    workspace: object
    buildId: str
    epoch: int
    profile: object = None
    state: str = 'opening'
    driver: object = None
    browser: object = None
    context: object = None
    page: object = None
    opening: object = None
    watchdog: object = None
    expires: float = field(default_factory=lambda: time.monotonic() + 180)
    log: list = field(default_factory=list)
    keys: set = field(default_factory=set)
    evidence: list = field(default_factory=list)
    measurements: list = field(default_factory=list)
    input_lock: object = field(default_factory=asyncio.Lock)
    close_lock: object = field(default_factory=asyncio.Lock)

    def persist(self):
        atomic_write(self.workspace.path(f'runs/{self.runId}/session.json'), json_bytes(dict(
            sessionId=self.sessionId, runId=self.runId, projectId=self.workspace.project.id,
            owner=self.workspace.project.owner, buildId=self.buildId, workspaceEpoch=self.epoch,
            state=self.state, capabilities=CAPABILITIES, log=self.log, evidence=self.evidence,
            measurements=self.measurements)))


class BrowserSessions:
    def __init__(self):
        self.sessions = {}

    async def open(self, workspace, build_id, page_bytes, run_id=None, session_id=None, profile=None):
        if len(self.sessions) >= 4:
            raise HTTPException(429, '试玩会话上限为 4；请先关闭自己的会话')
        if len(list(workspace.path('runs').glob('preview_*/session.json'))) >= 100:
            raise HTTPException(413, '项目试玩记录达到 100 条，不自动清理历史')
        session = BrowserSession(uid('session'), uid('preview'), workspace, build_id, workspace.state()['workspaceEpoch'])
        if run_id:
            session.runId = run_id
        if session_id:
            session.sessionId = session_id
        session.profile = profile
        self.sessions[session.sessionId] = session
        session.persist()
        session.opening = asyncio.create_task(self._launch(session, page_bytes))
        try:
            await asyncio.wait_for(asyncio.shield(session.opening), timeout=45)
            if session.state != 'opening':
                raise HTTPException(409, '打开期间会话已被取消，所属窗口已清理')
            session.state = 'running'
            session.persist()
            session.watchdog = asyncio.create_task(self._watch(session))
            return self.describe(session)
        except BaseException:
            await asyncio.shield(self.close(session))
            raise

    async def _launch(self, session, page_bytes):
        try:
            from playwright.async_api import async_playwright
        except ImportError as exc:
            raise HTTPException(503, '未安装可选的 Playwright 游戏测试依赖') from exc
        session.driver = await async_playwright().start()
        session.browser = await session.driver.chromium.launch(headless=False, chromium_sandbox=True,
            timeout=30000, args=['--disable-background-networking', '--disable-component-update'])
        profile = session.profile
        session.context = await session.browser.new_context(viewport=dict(
            width=profile.viewportWidth if profile else 1280, height=profile.viewportHeight if profile else 900),
            device_scale_factor=profile.devicePixelRatio if profile else 1,
            accept_downloads=False, service_workers='block')
        delivered = False
        async def route(request_route):
            nonlocal delivered
            if request_route.request.url == 'http://game.invalid/index.html' and not delivered:
                delivered = True
                from core.game_web_builds import PREVIEW_CSP
                # 独立 Chromium 上下文没有宿主身份；仅这里保留 game.invalid 的临时存储。
                # 宿主 iframe 仍使用不允许同源的 sandbox，不能复用这份策略。
                browser_csp = PREVIEW_CSP.removeprefix('sandbox allow-scripts; ')
                await request_route.fulfill(status=200, body=page_bytes, headers={
                    'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': browser_csp})
            else:
                await request_route.abort('blockedbyclient')
        await session.context.route('**/*', route)
        session.page = await session.context.new_page()
        def diagnostic(kind, message):
            if session.state in ('opening', 'running') and len(session.log) < 100:
                session.log.append(dict(kind=kind, message=str(message)[:1000]))
        session.page.on('pageerror', lambda error: diagnostic('pageerror', error))
        session.page.on('console', lambda message: diagnostic('console', message.text) if message.type == 'error' else None)
        session.page.on('requestfailed', lambda request: diagnostic('resource', request.url.split('?', 1)[0]))
        await session.page.goto('http://game.invalid/index.html', wait_until='load', timeout=15000)

    async def _watch(self, session):
        try:
            while session.state == 'running':
                await asyncio.sleep(1)
                epoch = await asyncio.to_thread(lambda: session.workspace.state()['workspaceEpoch'])
                if time.monotonic() > session.expires or epoch != session.epoch:
                    await self.close(session)
                    return
        except asyncio.CancelledError:
            return

    def get(self, session_id, workspace, allow_stale=False):
        session = self.sessions.get(session_id)
        if session is None:
            raise HTTPException(404, '会话不存在或服务已重启；不会自动重放输入')
        if (session.workspace.project.id != workspace.project.id
                or session.workspace.project.owner != workspace.project.owner):
            raise HTTPException(403, '会话不属于当前项目或 owner')
        if not allow_stale and session.epoch != workspace.state()['workspaceEpoch']:
            raise HTTPException(409, '恢复后旧会话失效，正在等待归属清理')
        return session

    @staticmethod
    def describe(session):
        return dict(sessionId=session.sessionId, runId=session.runId, buildId=session.buildId,
                    workspaceEpoch=session.epoch, state=session.state, capabilities=CAPABILITIES,
                    storageIsolation='ephemeral_browser_context',
                    limits=dict(batch=20, sessionSeconds=180, logEntries=100), log=session.log)

    async def inspect(self, session):
        if session.state != 'running':
            raise HTTPException(409, '会话不在运行')
        return dict(**self.describe(session), title=await session.page.title(),
                    viewport=session.page.viewport_size,
                    text=(await session.page.locator('body').inner_text(timeout=3000))[:16000])

    @staticmethod
    def selector(value):
        import re
        if not value or len(value) > 160 or not re.fullmatch(r'[A-Za-z0-9_# .:\[\]="\-]+', value):
            raise HTTPException(422, '只支持受限 CSS 选择器')
        return value

    async def act(self, session, actions):
        if not 1 <= len(actions) <= 20:
            raise HTTPException(422, '动作批次限定 1—20 条')
        async with session.input_lock:
            if session.state != 'running':
                raise HTTPException(409, '会话不在运行')
            try:
                async with asyncio.timeout(15):
                    for action in actions:
                        if session.state != 'running' or session.epoch != session.workspace.state()['workspaceEpoch']:
                            raise HTTPException(409, '会话已失效')
                        kind = action['type']
                        if kind in ('keydown', 'keyup', 'press'):
                            key = action.get('key')
                            if key not in KEYS:
                                raise HTTPException(422, '不支持此按键')
                            if kind == 'keydown':
                                await session.page.keyboard.down(key); session.keys.add(key)
                            elif kind == 'keyup':
                                await session.page.keyboard.up(key); session.keys.discard(key)
                            else:
                                await session.page.keyboard.press(key)
                        elif kind == 'click':
                            await session.page.locator(self.selector(action.get('selector'))).click(timeout=3000)
                        elif kind == 'pointer':
                            x, y = action.get('x'), action.get('y')
                            viewport = session.page.viewport_size
                            if (type(x) is not int or type(y) is not int or not viewport
                                    or not 0 <= x < viewport['width'] or not 0 <= y < viewport['height']):
                                raise HTTPException(422, '点击坐标必须位于当前视口内')
                            await session.page.mouse.click(x, y)
                        elif kind == 'wait':
                            duration = action.get('milliseconds')
                            if type(duration) is not int or not 0 <= duration <= 3000:
                                raise HTTPException(422, '等待限定 0—3000 ms')
                            await asyncio.sleep(duration / 1000)
                        elif kind == 'viewport':
                            width, height = action.get('width'), action.get('height')
                            if type(width) is not int or type(height) is not int or not (320 <= width <= 2560 and 240 <= height <= 1440):
                                raise HTTPException(422, '视口超出限制')
                            await session.page.set_viewport_size(dict(width=width, height=height))
                        else:
                            raise HTTPException(422, '不支持该动作；触屏、reset/setSeed/step 均未开放')
                session.persist()
                return await self.inspect(session)
            finally:
                # 每批结束也释放按键，防止失败或取消后形成残留输入。
                for key in list(session.keys):
                    try:
                        await session.page.keyboard.up(key)
                    finally:
                        session.keys.discard(key)

    async def capture(self, session):
        if session.state != 'running':
            raise HTTPException(409, '会话不在运行')
        if len(session.evidence) >= 10:
            raise HTTPException(413, '单会话截图达到 10 张')
        raw = await session.page.screenshot(type='png', timeout=5000)
        if len(raw) > 5 * 1024 * 1024:
            raise HTTPException(413, '截图超过 5 MiB')
        if sum(e['sizeBytes'] for e in session.evidence) + len(raw) > 20 * 1024 * 1024:
            raise HTTPException(413, '单会话截图总量超过 20 MiB')
        evidence_id = uid('capture')
        record = dict(evidenceId=evidence_id, relativePath=f'runs/{session.runId}/evidence/{evidence_id}.png',
                      buildId=session.buildId, sessionId=session.sessionId, workspaceEpoch=session.epoch,
                      hash=digest(raw), sizeBytes=len(raw))
        atomic_write(session.workspace.path(record['relativePath']), raw)
        session.evidence.append(record); session.persist()
        return record

    async def measure(self, session):
        if session.state != 'running' or session.epoch != session.workspace.state()['workspaceEpoch']:
            raise HTTPException(409, '会话不在有效运行状态')
        if len(session.measurements) >= 3:
            raise HTTPException(413, '单会话最多采样三次')
        async with session.input_lock:
            if len(session.measurements) >= 3 or session.state != 'running':
                raise HTTPException(409, '会话不可采样或已达到采样上限')
            try:
                intervals = await asyncio.wait_for(session.page.evaluate('''() => new Promise(resolve => {
                    const samples = []; let previous = null, frames = 0;
                    function sample(time) {
                        if (previous !== null && frames > 10) samples.push(time - previous);
                        previous = time; frames++;
                        if (samples.length === 60) resolve(samples); else requestAnimationFrame(sample);
                    }
                    requestAnimationFrame(sample);
                })'''), timeout=6)
            except Exception:
                # 不把后台窗口限频或不支持 RAF 误判为游戏性能失败。
                raise HTTPException(409, '帧间隔采样不可用或超时；未形成性能结论')
            if session.state != 'running' or session.epoch != session.workspace.state()['workspaceEpoch']:
                raise HTTPException(409, '采样期间会话失效')
            if len(intervals) != 60 or any(type(value) not in (int, float) or not 0 < value < 6000 for value in intervals):
                raise HTTPException(409, '帧间隔样本无效；未形成性能结论')
            mean = sum(intervals) / len(intervals)
            record = dict(measurementId=uid('metric'), sessionId=session.sessionId, runId=session.runId,
                buildId=session.buildId, workspaceEpoch=session.epoch, browser='Chromium ' + session.browser.version,
                warmupFrames=10, sampleFrames=60, samplesMs=intervals, meanIntervalMs=mean,
                p95IntervalMs=sorted(intervals)[56], observedFrameRate=1000 / mean,
                interpretation='仅为该窗口当前场景的 RAF 帧调度间隔，不是 CPU/GPU 耗时或跨机器评分',
                unsupported=['cpu_time', 'gpu_time', 'real_device_performance'])
            session.measurements.append(record)
            session.persist()
            return record

    async def close(self, session):
        async with session.close_lock:
            if session.state == 'closed':
                return
            session.state = 'closing'
            if session.opening and not session.opening.done():
                try:
                    await asyncio.wait_for(asyncio.shield(session.opening), timeout=35)
                except (Exception, asyncio.CancelledError):
                    session.opening.cancel()
                    try:
                        await session.opening
                    except (Exception, asyncio.CancelledError):
                        pass
            if session.watchdog and session.watchdog is not asyncio.current_task():
                session.watchdog.cancel()
            errors = []
            for target, method in ((session.context, 'close'), (session.browser, 'close'), (session.driver, 'stop')):
                if target:
                    try:
                        await asyncio.wait_for(getattr(target, method)(), timeout=10)
                    except Exception:
                        errors.append(method)
            session.keys.clear()
            session.state = 'cleanup_failed' if errors else 'closed'
            session.persist()
            if not errors:
                self.sessions.pop(session.sessionId, None)
            else:
                raise HTTPException(503, '所属会话清理未完成，可显式重试；不影响其他会话')


sessions = BrowserSessions()
