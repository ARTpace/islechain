"""单进程、有界 Web 测试执行；只解释结构化动作，不解释模型命令或自然语言。"""
import asyncio
from datetime import datetime, timezone

from fastapi import HTTPException

from core.game_browser_sessions import CAPABILITIES, sessions
from core.game_projects import atomic_write, digest, uid
from core.game_testing import TestingStore
from core.game_testing_models import GameTestAttempt, GameTestEvidence, GameTestPlan
from core.game_web_builds import WebBuilds

jobs = {}


def update(repository, project_id, owner, run_id, operation):
    with repository.locked():
        project = repository.read(project_id, owner)
        store = TestingStore(repository, project)
        data = store.read()
        run = store.find_run(data, run_id)
        result = operation(store, run)
        store.save(data)
        return result


def event(run, kind, **details):
    events = run.setdefault('events', [])
    if len(events) < 1000:
        events.append(dict(cursor=len(events) + 1, type=kind, **details))


def append_result(store, run, case, profile, result, reason, screenshot=None, terminal='completed'):
    plan = GameTestPlan.model_validate(run['plan'])
    history = [a for a in run['attempts'] if a['caseId'] == case.caseId and a['profileId'] == profile.profileId]
    placeholder = next((a for a in history if a['sessionId'] == run['sessionId'] and a['state'] == 'queued'), None)
    number = placeholder['attempt'] if placeholder else max((a['attempt'] for a in history), default=0) + 1
    if store.project.archived or store.workspace.state()['workspaceEpoch'] != plan.workspaceEpoch:
        result, reason, screenshot, terminal = 'blocked', '项目归档或恢复后迟到结果失效', None, 'interrupted'
    evidence = []
    if screenshot:
        evidence.append(GameTestEvidence(evidenceId=screenshot['evidenceId'],
            projectId=store.project.id, owner=store.project.owner, buildId=plan.buildId,
            inputManifestHash=plan.inputManifestHash, workspaceEpoch=plan.workspaceEpoch,
            testRunId=run['testRunId'], runId=run['runId'], sessionId=run['sessionId'],
            caseId=case.caseId, caseRevision=case.revision, profileId=profile.profileId,
            attempt=number, capturedAt=datetime.now(timezone.utc), kind='screenshot', source='automated',
            relativePath=screenshot['relativePath'], contentHash=screenshot['hash'], sizeBytes=screenshot['sizeBytes']))
    raw = reason[:20000].encode('utf-8')
    evidence_id = uid('observation')
    observation = GameTestEvidence(evidenceId=evidence_id, projectId=store.project.id,
        owner=store.project.owner, buildId=plan.buildId, inputManifestHash=plan.inputManifestHash,
        workspaceEpoch=plan.workspaceEpoch, testRunId=run['testRunId'], runId=run['runId'],
        sessionId=run['sessionId'], caseId=case.caseId, caseRevision=case.revision,
        profileId=profile.profileId, attempt=number, capturedAt=datetime.now(timezone.utc),
        kind='observation', source='automated', relativePath=f"runs/{run['runId']}/evidence/{evidence_id}.txt",
        contentHash=digest(raw), sizeBytes=len(raw))
    atomic_write(store.workspace.path(observation.relativePath), raw)
    evidence.append(observation)
    attempt = GameTestAttempt(testRunId=run['testRunId'], runId=run['runId'], sessionId=run['sessionId'],
        plan=plan, caseId=case.caseId, caseRevision=case.revision, profileId=profile.profileId,
        attempt=number, state=terminal, result=result, source='automated', reason=reason[:20000],
        evidenceIds=[e.evidenceId for e in evidence])
    if placeholder:
        run['attempts'].remove(placeholder)
    run['attempts'].append(attempt.model_dump(mode='json'))
    run['evidence'].extend(e.model_dump(mode='json') for e in evidence)
    run['activeCase'] = None
    event(run, 'case_result', caseId=case.caseId, result=result)


async def execute(repository, project, run):
    run_id = run['testRunId']
    plan = GameTestPlan.model_validate(run['plan'])
    profile = plan.environments[0]
    active = None
    session = None
    terminal = 'completed'
    reason = ''
    try:
        store = TestingStore(repository, project)
        page = WebBuilds(repository, project).preview(plan.buildId)
        if profile.deviceMode == 'real_device' or set(profile.capabilities) - set(CAPABILITIES):
            raise HTTPException(409, '适配器不支持声明的真实设备或能力')
        for case in plan.cases:
            derived = {'dom', 'screenshot'}
            for action in case.actions:
                if action.type in ('keydown', 'keyup', 'press'):
                    derived.add('keyboard')
                elif action.type == 'click':
                    derived.add('mouse')
                elif action.type == 'viewport':
                    derived.add('viewport')
            if (set(case.requiredCapabilities) | derived) - set(profile.capabilities):
                raise HTTPException(409, '环境缺少用例所需能力')
        async with asyncio.timeout(180):
            opened = await sessions.open(store.workspace, plan.buildId, page,
                run_id=run['runId'], session_id=run['sessionId'], profile=profile)
            session = sessions.get(opened['sessionId'], store.workspace)
            def running(_, record):
                record['state'] = 'running'
                record['observedEnvironment'] = dict(browser='Chromium ' + session.browser.version,
                    viewportWidth=profile.viewportWidth, viewportHeight=profile.viewportHeight,
                    devicePixelRatio=profile.devicePixelRatio, deviceMode=profile.deviceMode)
                record.setdefault('observedEnvironments', []).append(dict(**record['observedEnvironment'],
                    runId=record['runId'], sessionId=record['sessionId']))
                event(record, 'running')
            update(repository, project.id, project.owner, run_id, running)
            from playwright.async_api import expect
            for case_index, case in enumerate(plan.cases):
                active = case
                def starting(current_store, record):
                    if current_store.project.archived or current_store.workspace.state()['workspaceEpoch'] != plan.workspaceEpoch:
                        raise HTTPException(409, '项目已归档或 epoch 改变')
                    record['activeCase'] = case.caseId
                    event(record, 'case_started', caseId=case.caseId)
                update(repository, project.id, project.owner, run_id, starting)
                result, observation = 'passed', ''
                try:
                    async with asyncio.timeout(30):
                        previous_errors = len(session.log) if case_index else 0
                        await sessions.act(session, [a.model_dump(exclude_none=True) for a in case.actions])
                        observed = []
                        for assertion in case.domExpectations:
                            locator = session.page.locator(sessions.selector(assertion.selector))
                            if assertion.comparison == 'visible':
                                await expect(locator).to_be_visible(timeout=assertion.timeoutMs)
                            elif assertion.comparison == 'contains':
                                await expect(locator).to_contain_text(assertion.expected, timeout=assertion.timeoutMs)
                            else:
                                await expect(locator).to_have_text(assertion.expected, timeout=assertion.timeoutMs)
                            observed.append(dict(selector=assertion.selector,
                                text=(await locator.inner_text(timeout=1000))[:1000]))
                        observation = '真实输入与 DOM 断言通过；观察：' + str(observed)
                        if case.measureFrameIntervals:
                            import json
                            observation += '；帧间隔采样：' + json.dumps(await sessions.measure(session), ensure_ascii=False)
                        if case.runtimeErrorsFail and len(session.log) > previous_errors:
                            result, observation = 'failed', '游戏运行产生错误：' + str(session.log[previous_errors:])[:3000]
                except AssertionError as exc:
                    result, observation = 'failed', '游戏断言未满足：' + str(exc)[:3000]
                except Exception as exc:
                    result, observation = 'blocked', '输入、观察或设施错误：' + type(exc).__name__
                screenshot = None
                try:
                    screenshot = await sessions.capture(session)
                except Exception:
                    result, observation = 'blocked', observation + '；截图证据采集失败'
                update(repository, project.id, project.owner, run_id,
                    lambda current_store, record: append_result(current_store, record, case, profile, result, observation, screenshot))
                active = None
    except asyncio.CancelledError:
        terminal, reason = 'cancelled', '用户取消，未完成用例保留为未测'
    except Exception as exc:
        terminal, reason = 'interrupted', '环境或执行中断：' + type(exc).__name__
    finally:
        if session:
            try:
                await asyncio.shield(sessions.close(session))
            except Exception:
                terminal, reason = 'interrupted', '所属浏览器清理未完成，需要显式重试'
        def finish(store, record):
            final_state, final_reason = terminal, reason
            if store.project.archived or store.workspace.state()['workspaceEpoch'] != plan.workspaceEpoch:
                final_state, final_reason = 'interrupted', '项目归档或恢复后执行失效'
            case = active
            if case is None and not any(a['sessionId'] == record['sessionId'] and a['state'] != 'queued' for a in record['attempts']):
                case = plan.cases[0]
            if case and not any(a['caseId'] == case.caseId and a['sessionId'] == record['sessionId']
                                and a['state'] != 'queued' for a in record['attempts']):
                append_result(store, record, case, profile, 'blocked', final_reason or '执行未形成有效结论',
                              terminal='interrupted' if final_state == 'interrupted' else 'cancelled')
            record['state'] = final_state
            if final_reason:
                record['reason'] = final_reason
            event(record, final_state)
        try:
            update(repository, project.id, project.owner, run_id, finish)
        finally:
            jobs.pop(run_id, None)


def start(repository, project, base, plan_id, plan_revision, request_id):
    with repository.locked():
        project = repository.read(project.id, project.owner, writable=True)
        store = TestingStore(repository, project)
        before = store.read()
        existing = next((r for r in before['runs'] if r['requestId'] == request_id), None)
        if existing:
            if existing['plan']['planId'] != plan_id or existing['plan']['revision'] != plan_revision or existing.get('executionMode') != 'automated':
                raise HTTPException(409, '幂等请求与已有运行不匹配')
            return existing
        data, run = store.start_manual(base, plan_id, plan_revision, request_id, mode='automated')
        run['state'] = 'preparing'
        event(run, 'preparing')
        store.save(data)
        jobs[run['testRunId']] = None
    jobs[run['testRunId']] = asyncio.create_task(execute(repository, project, run))
    return run


def retry(repository, project, run_id, base, request_id):
    with repository.locked():
        project = repository.read(project.id, project.owner, writable=True)
        store = TestingStore(repository, project)
        data = store.read()
        run = store.find_run(data, run_id)
        if request_id in run.get('retryRequestIds', []):
            return run
        if any(r['requestId'] == request_id or request_id in r.get('retryRequestIds', []) for r in data['runs']):
            raise HTTPException(409, '幂等键已用于另一执行')
        if data['revision'] != base:
            raise HTTPException(409, '测试资料已变化，请重载')
        if run.get('executionMode') != 'automated' or run['state'] not in ('completed', 'cancelled', 'interrupted') or run_id in jobs:
            raise HTTPException(409, '只能显式重测已结束的自动记录')
        if len(run.get('retryRequestIds', [])) >= 2:
            raise HTTPException(409, '同一记录最多执行三轮，请重新定位后另建计划')
        plan = GameTestPlan.model_validate(run['plan'])
        if plan.workspaceEpoch != store.workspace.state()['workspaceEpoch']:
            raise HTTPException(409, '恢复后旧计划失效，需要新修订')
        WebBuilds(repository, project).artifact(plan.buildId)
        run['runId'], run['sessionId'] = uid('run'), uid('test_session')
        for case in plan.cases:
            profile = plan.environments[0]
            number = max((a['attempt'] for a in run['attempts'] if a['caseId'] == case.caseId
                and a['profileId'] == profile.profileId), default=0) + 1
            run['attempts'].append(GameTestAttempt(testRunId=run_id, runId=run['runId'], sessionId=run['sessionId'],
                plan=plan, caseId=case.caseId, caseRevision=case.revision, profileId=profile.profileId,
                attempt=number, source='automated').model_dump(mode='json'))
        run.setdefault('retryRequestIds', []).append(request_id)
        run.update(state='preparing', activeCase=None)
        run.pop('reason', None)
        event(run, 'retry_preparing')
        store.save(data)
        jobs[run_id] = None
    jobs[run_id] = asyncio.create_task(execute(repository, project, run))
    return run
