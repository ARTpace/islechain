import asyncio
import os

import pytest

from core.game_browser_sessions import sessions
from core.game_test_execution import jobs, start
from core.game_web_builds import WebBuilds
from test_game_testing import env, call, setup


def prepare(env, measure=False):
    _, plan, _ = setup(env)
    store = env[1]
    state = store.workspace.create()
    builds = WebBuilds(store.workspace.repository, store.project)
    state = builds.install_template(state['revision'])
    build = builds.build(state['revision'])
    case = dict(caseId='startup', revision=1, title='自动启动', requirementIds=['req0'], required=True,
        executionMode='automated', requiredCapabilities=['mouse','dom','screenshot'],
        steps=['重开'], expectations=['显示 playing'], actions=[dict(type='click',selector='#restart')],
        domExpectations=[dict(selector='#hud',comparison='contains',expected='playing')], measureFrameIntervals=measure)
    result = call(env, 'POST', '/cases', dict(baseRevision=4, case=case))
    assert result.status_code == 200, result.text
    plan.update(planId='auto-plan', revision=1, buildId=build['buildId'], inputManifestHash=build['inputManifestHash'], cases=[case])
    plan['environments'][0]['capabilities'] = ['keyboard','mouse','dom','screenshot']
    result = call(env, 'POST', '/plans', dict(baseRevision=result.json()['revision'], plan=plan))
    assert result.status_code == 200, result.text
    return result.json()['revision']


@pytest.mark.skipif(os.environ.get('ART_GAME_BROWSER_TEST') != '1', reason='需显式开启真实 headed 自动执行链路')
def test_real_automatic_plan_evidence_and_report(env):
    base = prepare(env, measure=True)
    store = env[1]
    async def scenario():
        run = start(store.workspace.repository, store.project, base, 'auto-plan', 1, 'automatic1')
        same = start(store.workspace.repository, store.project, base, 'auto-plan', 1, 'automatic1')
        assert run['testRunId'] == same['testRunId']
        await jobs[run['testRunId']]
        data = store.read()
        saved = store.find_run(data, run['testRunId'])
        assert saved['state'] == 'completed', saved
        assert saved['attempts'][0]['source'] == 'automated'
        assert saved['attempts'][0]['result'] == 'passed', saved
        assert any(e['kind'] == 'screenshot' for e in saved['evidence'])
        assert saved['observedEnvironment']['browser'].startswith('Chromium ')
        assert saved['sessionId'] not in sessions.sessions
        report = store.report(data['revision'], run['testRunId'])
        assert report['summary']['requiredCasesPassed']
        assert report['observedEnvironment'] == saved['observedEnvironment']
        observation = next(e for e in saved['evidence'] if e['kind'] == 'observation')
        assert 'samplesMs' in store.workspace.path(observation['relativePath']).read_text(encoding='utf-8')
        assert not report['deliveryApproved']
    asyncio.run(scenario())


def test_cancel_before_execution_starts_does_not_open_browser(env):
    base = prepare(env)
    store = env[1]
    async def scenario():
        run = start(store.workspace.repository, store.project, base, 'auto-plan', 1, 'cancel1')
        task = jobs[run['testRunId']]
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        jobs.pop(run['testRunId'], None)
        # 模拟重启后的查询：保留中断事实，不静默自动重跑。
    asyncio.run(scenario())
    data = call(env).json()
    run = next(r for r in data['runs'] if r['requestId'] == 'cancel1')
    assert run['state'] == 'interrupted'
    assert not run['attempts']


def test_automated_output_cannot_be_submitted_by_manual_result_api(env):
    base = prepare(env)
    store = env[1]
    # 只建立未启动记录，验证结果入口权限，不启动浏览器。
    data, run = store.start_manual(base, 'auto-plan', 1, 'fake1', mode='automated')
    response = call(env, 'POST', f"/manual-runs/{run['testRunId']}/results", dict(
        baseRevision=data['revision'], caseId='startup', profileId='desktop', result='passed', observation='模型说通过'))
    assert response.status_code == 409


def test_idempotency_key_cannot_cross_execution_modes(env):
    base = prepare(env)
    data, run = env[1].start_manual(base, 'auto-plan', 1, 'mode-key', mode='automated')
    response = call(env, 'POST', '/manual-runs', dict(baseRevision=data['revision'],
        planId='auto-plan', planRevision=1, requestId='mode-key'))
    assert response.status_code == 409


def test_restart_marks_only_active_case_blocked(env):
    base = prepare(env)
    store = env[1]
    data, run = store.start_manual(base, 'auto-plan', 1, 'restart1', mode='automated')
    run.update(state='running', activeCase='startup')
    store.save(data)
    recovered = call(env).json()
    saved = store.find_run(recovered, run['testRunId'])
    assert saved['state'] == 'interrupted'
    assert saved['attempts'][0]['result'] == 'blocked'
    assert saved['attempts'][0]['state'] == 'interrupted'


def test_late_result_after_restore_cannot_pass(env):
    from core.game_test_execution import append_result
    from core.game_testing_models import GameTestPlan
    from core.game_projects import atomic_write, json_bytes
    base = prepare(env)
    store = env[1]
    data, run = store.start_manual(base, 'auto-plan', 1, 'restore1', mode='automated')
    state = store.workspace.state()
    state['workspaceEpoch'] += 1
    atomic_write(store.workspace.path('workspace.json'), json_bytes(state))
    plan = GameTestPlan.model_validate(run['plan'])
    append_result(store, run, plan.cases[0], plan.environments[0], 'passed', '迟到的通过')
    assert run['attempts'][0]['result'] == 'blocked'
    assert run['attempts'][0]['state'] == 'interrupted'


@pytest.mark.skipif(os.environ.get('ART_GAME_BROWSER_TEST') != '1', reason='需显式开启真实 headed 自动执行链路')
@pytest.mark.parametrize('condition', ['startup_error', 'cancel'])
def test_real_startup_error_and_inflight_cancel(env, monkeypatch, condition):
    base = prepare(env)
    store = env[1]
    original_open, original_capture = sessions.open, sessions.capture
    async def opening(*args, **kwargs):
        opened = await original_open(*args, **kwargs)
        if condition == 'startup_error':
            sessions.get(opened['sessionId'], store.workspace).log.append(dict(kind='pageerror', message='启动错误'))
        return opened
    async def capture(session):
        if condition == 'cancel':
            asyncio.current_task().cancel()
            await asyncio.sleep(0)
        return await original_capture(session)
    monkeypatch.setattr(sessions, 'open', opening)
    monkeypatch.setattr(sessions, 'capture', capture)
    async def scenario():
        run = start(store.workspace.repository, store.project, base, 'auto-plan', 1, 'condition1')
        await jobs[run['testRunId']]
        saved = store.find_run(store.read(), run['testRunId'])
        assert saved['state'] == ('cancelled' if condition == 'cancel' else 'completed')
        assert saved['attempts'][0]['result'] == ('blocked' if condition == 'cancel' else 'failed')
        assert saved['sessionId'] not in sessions.sessions
        if condition == 'startup_error':
            from core.game_test_execution import retry
            first_report = store.report(store.read()['revision'], run['testRunId'])
            monkeypatch.setattr(sessions, 'open', original_open)
            retried = retry(store.workspace.repository, store.project, run['testRunId'], store.read()['revision'], 'retry1')
            same = retry(store.workspace.repository, store.project, run['testRunId'], 0, 'retry1')
            assert same['sessionId'] == retried['sessionId']
            await jobs[run['testRunId']]
            data = store.read()
            saved = store.find_run(data, run['testRunId'])
            assert [a['result'] for a in saved['attempts']] == ['failed', 'passed']
            assert [a['attempt'] for a in saved['attempts']] == [1, 2]
            assert len({a['sessionId'] for a in saved['attempts']}) == 2
            report = store.report(data['revision'], run['testRunId'])
            assert report['summary']['flaky']
            assert not report['summary']['requiredCasesPassed']
            assert store.read()['reports'][0] == first_report
    asyncio.run(scenario())
