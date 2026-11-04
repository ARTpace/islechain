"""暂存候选的真实浏览器回归；不执行宿主命令，不接触活动源码。"""
import asyncio
import base64
import io
import re

from PIL import Image

from fastapi import HTTPException
from pydantic import Field, model_validator
from typing import Literal

from core.game_project_models import Contract
from core.game_projects import digest, json_bytes, uid
from core.game_browser_sessions import BrowserSessions, KEYS
from core.game_web_builds import check_sources
from core.game_web_template import make_page
from core.game_media_assets import runtime_resources, inline_resources


def safe_selector(selector):
    try:
        return BrowserSessions.selector(selector)
    except HTTPException as exc:
        raise ValueError('回归选择器不合法') from exc


class GameInput(Contract):
    type: Literal['click', 'pointer', 'press', 'keydown', 'keyup', 'wait']
    x: int | None = Field(default=None, ge=0, le=2560)
    y: int | None = Field(default=None, ge=0, le=1440)
    selector: str = Field(default='', max_length=160)
    key: str = Field(default='', max_length=20)
    milliseconds: int = Field(default=0, ge=0, le=1000)

    @model_validator(mode='after')
    def allowed(self):
        if self.type == 'click':
            safe_selector(self.selector)
        elif self.type == 'pointer' and (self.x is None or self.y is None):
            raise ValueError('画布点击需要视口CSS像素坐标 x/y')
        elif self.type in ('press', 'keydown', 'keyup') and self.key not in KEYS:
            raise ValueError('不支持此回归按键')
        return self


class GameAssertion(Contract):
    kind: Literal['contains', 'equals', 'visible', 'changed']
    selector: str = Field(default='#hud', max_length=160)
    text: str = Field(default='', max_length=500)

    @model_validator(mode='after')
    def allowed(self):
        safe_selector(self.selector)
        if self.kind in ('contains', 'equals') and not self.text:
            raise ValueError('文本断言不能为空')
        return self


class RegressionCase(Contract):
    name: str = Field(min_length=1, max_length=100)
    actions: list[GameInput] = Field(default_factory=list, max_length=12)
    assertions: list[GameAssertion] = Field(min_length=1, max_length=8)


def runtime_identity(workspace, project, staged, tests):
    from core.game_media_assets import media_content
    for asset in project.mediaAssets:
        if asset.enabled:
            media_content(workspace.repository, project, asset)
    return digest(json_bytes(dict(files=workspace.manifest(staged), projectRevision=project.revision, tests=tests)))


def candidate_page(workspace, project, staged, build_id):
    _, _, script, style = check_sources(staged)
    content = workspace.validate_content(staged)
    assets = {}
    for asset in project.assets:
        if asset.usage == 'runtime' and asset.selected:
            raw = workspace.repository.selected_content(project, asset)
            assets[asset.id] = 'data:image/' + asset.spec.format + ';base64,' + base64.b64encode(raw).decode()
    resources, media_urls, metadata = runtime_resources(workspace.repository, project)
    assets.update(media_urls)
    page = make_page(project.title, dict(projectId=project.id, buildId=build_id, saveSlot='candidate',
        content=content.model_dump(), assets=assets,assetInfo=metadata,
        engine='three' if any(a.enabled and a.kind=='model' for a in project.mediaAssets) else 'canvas'), script, style, build_id)
    page = inline_resources(page, resources)
    if len(page) > 384 * 1024 * 1024:
        raise HTTPException(413, '候选运行页面超过384 MiB（含隔离预览资源）')
    return page


async def run_regression(workspace, project, staged, candidate):
    tests = candidate.get('regressionCases', [])
    if not tests:
        return dict(passed=False, available=True, diagnostic='请先用 playtest 声明至少一个带断言的行为回归用例')
    identity = runtime_identity(workspace, project, staged, tests)
    run_id = uid('candidate')
    report = dict(passed=False, available=True, snapshotHash=identity, runId=run_id,
        tests=tests, cases=[], note='仅验证所列操作和断言，不代表全部玩法或正式交付验收')
    try:
        page = candidate_page(workspace, project, staged, run_id)
    except HTTPException as exc:
        report['diagnostic'] = str(exc.detail)[:1200]
        return report
    manager = runtime_sessions
    try:
        async with asyncio.timeout(75):
            for raw in tests:
                case = RegressionCase.model_validate(raw)
                session = None
                result = dict(name=case.name, passed=False, assertions=[], log=[])
                try:
                    opened = await manager.open(workspace, run_id, page)
                    session = manager.get(opened['sessionId'], workspace)
                    # 每条用例独立浏览器上下文，不继承前一条的存档和运行状态。
                    before = []
                    for assertion in case.assertions:
                        locator = session.page.locator(assertion.selector)
                        before.append(await locator.inner_text(timeout=2000) if assertion.kind == 'changed' else None)
                    if case.actions:
                        await manager.act(session, [a.model_dump() for a in case.actions])
                    # 给事件回调和异步初始化一段有上限的观察窗口。
                    await asyncio.sleep(.2)
                    for index, assertion in enumerate(case.assertions):
                        locator = session.page.locator(assertion.selector)
                        actual = ''
                        if assertion.kind == 'visible':
                            passed = await locator.is_visible(timeout=2000)
                        else:
                            actual = (await locator.inner_text(timeout=2000))[:16000]
                            passed = (assertion.text in actual if assertion.kind == 'contains' else
                                actual == assertion.text if assertion.kind == 'equals' else before[index] != actual)
                        result['assertions'].append(dict(**assertion.model_dump(), passed=passed, actual=actual[:1000]))
                    result['log'] = [dict(item) for item in session.log
                        if not (item['kind'] == 'resource' and item['message'].endswith('/favicon.ico'))]
                    result['screenshot'] = await manager.capture(session)
                    result['passed'] = all(a['passed'] for a in result['assertions']) and not result['log']
                except HTTPException as exc:
                    if exc.status_code in (429, 503):
                        report.update(available=False, diagnostic=str(exc.detail)[:500])
                    result['error'] = str(exc.detail)[:500]
                except Exception:
                    if session is None:
                        report.update(available=False, diagnostic='无法启动独立 Chromium；请检查游戏测试依赖和浏览器安装')
                    result['error'] = '浏览器操作、断言或截图未完成；本用例未通过'
                finally:
                    if session:
                        try:
                            result['log'] = [dict(item) for item in session.log
                                if not (item['kind'] == 'resource' and item['message'].endswith('/favicon.ico'))]
                            if 'screenshot' not in result:
                                try:
                                    result['screenshot'] = await manager.capture(session)
                                except Exception:
                                    result['captureError'] = '未能保存本次截图'
                            result['passed'] = result['passed'] and not result['log']
                        finally:
                            await asyncio.shield(manager.close(session))
                report['cases'].append(result)
                if not report['available']:
                    break
        report['passed'] = len(report['cases']) == len(tests) and all(c['passed'] for c in report['cases'])
    except TimeoutError:
        report['diagnostic'] = '候选回归超过75秒；未形成通过结论'
    except HTTPException as exc:
        report.update(available=False, diagnostic=str(exc.detail)[:500])
    except asyncio.CancelledError:
        raise
    except Exception:
        report.update(available=False, diagnostic='候选浏览器启动或清理失败；未形成通过结论')
    return report


def runtime_images(workspace, report):
    """只发送本工程、本次运行且 hash 匹配的证据缩略图，不接受模型指定的路径。"""
    images = []
    for case in (report or {}).get('cases', [])[:2]:
        evidence = case.get('screenshot')
        if not evidence:
            continue
        relative = evidence.get('relativePath', '')
        if (not re.fullmatch(r'runs/[A-Za-z0-9_-]+/evidence/[A-Za-z0-9_-]+\.png', relative)
                or evidence.get('buildId') != report.get('runId')
                or evidence.get('workspaceEpoch') != workspace.state()['workspaceEpoch']):
            raise HTTPException(409, '试玩截图来源或版本不匹配')
        path = workspace.path(relative)
        if not path.is_file() or path.stat().st_size > 5 * 1024 * 1024:
            raise HTTPException(409, '试玩截图缺失或超过大小上限')
        raw = path.read_bytes()
        if digest(raw) != evidence.get('hash'):
            raise HTTPException(409, '试玩截图内容已变化')
        try:
            with Image.open(io.BytesIO(raw)) as image:
                if image.width * image.height > 16_000_000:
                    raise ValueError('截图尺寸过大')
                image.thumbnail((960, 960))
                output = io.BytesIO()
                image.convert('RGB').save(output, format='JPEG', quality=75)
            if output.tell() > 256 * 1024:
                raise ValueError('截图缩略图过大')
        except (OSError, ValueError) as exc:
            raise HTTPException(409, '试玩截图无法读取') from exc
        images.append('data:image/jpeg;base64,' + base64.b64encode(output.getvalue()).decode())
    return images


async def close_agent_game(workspace, candidate):
    reference = candidate.get('agentSession')
    if not reference:
        return
    try:
        session = runtime_sessions.get(reference['sessionId'], workspace, allow_stale=True)
    except HTTPException as exc:
        if exc.status_code == 404:
            candidate.pop('agentSession', None)
            return
        raise
    await runtime_sessions.close(session)
    candidate.pop('agentSession', None)


async def agent_game_use(workspace, project, staged, candidate, operation, actions):
    """Agent 逐步观察试玩；与回归证据分开，不用自由试玩冒充用例通过。"""
    identity = runtime_identity(workspace, project, staged, [])
    if operation == 'close':
        await close_agent_game(workspace, candidate)
        return dict(closed=True, note='只关闭本候选拥有的会话')
    reference = candidate.get('agentSession')
    if reference and reference['snapshotHash'] != identity:
        await close_agent_game(workspace, candidate)
        if operation != 'open':
            raise HTTPException(409, '候选源码已变化，旧试玩已关闭；请重新 open')
        reference = None
    if operation == 'open' and not reference:
        build_id = uid('agentgame')
        page = candidate_page(workspace, project, staged, build_id)
        opened = await runtime_sessions.open(workspace, build_id, page)
        reference = dict(sessionId=opened['sessionId'], snapshotHash=identity, buildId=build_id)
        candidate['agentSession'] = reference
    if not reference:
        raise HTTPException(409, '先用 game_use open 打开候选试玩')
    session = runtime_sessions.get(reference['sessionId'], workspace)
    if session.buildId != reference['buildId']:
        raise HTTPException(409, '试玩版本不匹配')
    if operation == 'act':
        if not actions:
            raise HTTPException(422, 'act 需要至少一个真实输入动作')
        await runtime_sessions.act(session, actions)
    observation = await runtime_sessions.inspect(session)
    if operation in ('open', 'act', 'capture'):
        evidence = await runtime_sessions.capture(session)
        candidate['gameObservation'] = dict(runId=session.buildId, snapshotHash=identity,
            cases=[dict(name='Agent 自由试玩', screenshot=evidence)])
        observation['screenshot'] = evidence
    return dict(**observation, note='自由试玩观察，不是自动回归或正式验收结论')


# 与手工试玩共享会话容量；不另开无限浏览器池。
from core.game_browser_sessions import sessions as runtime_sessions
