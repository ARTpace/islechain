"""固定构建上的真实键盘玩法与缺陷回归；仅显式开启时启动独立 headed Chromium。"""
import asyncio
import json
import os

import pytest

from core.game_projects import digest
from core.game_test_execution import jobs, start
from core.game_testing_models import GameTestCase, GameTestPlan
from core.game_web_builds import WebBuilds
from test_game_testing import env, setup

pytestmark = pytest.mark.skipif(os.environ.get('ART_GAME_BROWSER_TEST') != '1', reason='需开启真实 headed 玩法执行')


def case(case_id, actions, expected):
    return GameTestCase(caseId=case_id, revision=1, title=case_id, requirementIds=['req0'],
        executionMode='automated', requiredCapabilities=['keyboard', 'mouse', 'dom', 'screenshot'],
        steps=['按结构化输入操作'], expectations=[expected], actions=actions,
        domExpectations=[dict(selector='#hud', comparison='contains', expected=expected)])


def click():
    return dict(type='click', selector='#restart')


def wait(ms):
    return dict(type='wait', milliseconds=ms)


def movement():
    return [dict(type='click', selector='canvas'), dict(type='keydown', key='ArrowRight'),
        wait(550), dict(type='keyup', key='ArrowRight'), dict(type='keydown', key='ArrowDown'),
        wait(300), dict(type='keyup', key='ArrowDown')]


def prepare(env, broken=False):
    setup(env)
    store = env[1]
    builds = WebBuilds(store.workspace.repository, store.project)
    state = store.workspace.create()
    state = builds.install_template(state['revision'])
    content_file = store.workspace.read('content/game-data.json')
    content = json.loads(content_file['content'])
    content['datasets'][1]['rows'][0]['values']['speed'] = 2000
    content['datasets'][2]['rows'][0]['values']['target'] = 1
    content['datasets'][1]['revision'] += 1
    content['datasets'][2]['revision'] += 1
    changes = [dict(path='content/game-data.json', baseHash=content_file['hash'], content=json.dumps(content))]
    if broken:
        source = store.workspace.read('game.js')
        changes.append(dict(path='game.js', baseHash=source['hash'],
            content=source['content'].replace('hp: playerData.hp ?? 3', 'hp: state?.hp ?? playerData.hp ?? 3')))
    state = store.workspace.patch(state['revision'], changes, True)
    return store, builds, builds.build(state['revision'])


def plan_for(store, build, cases, revision=1):
    data = store.read()
    if revision == 1:
        for item in cases:
            data = store.save_case(data['revision'], item)
    plan = GameTestPlan(planId='gameplay', revision=revision, projectId=store.project.id, owner=store.project.owner,
        buildId=build['buildId'], inputManifestHash=build['inputManifestHash'], workspaceEpoch=build['workspaceEpoch'],
        requirements=data['requirements'], cases=cases, environments=[dict(profileId='desktop', browser='Chromium',
            platform='Windows', viewportWidth=1280, viewportHeight=900, devicePixelRatio=1,
            deviceMode='desktop', capabilities=['keyboard', 'mouse', 'dom', 'screenshot'])])
    store.save_plan(data['revision'], plan)
    return plan


async def execute_plan(store, plan, request):
    run = start(store.workspace.repository, store.project, store.read()['revision'], plan.planId, plan.revision, request)
    await jobs[run['testRunId']]
    saved = store.find_run(store.read(), run['testRunId'])
    assert saved['state'] == 'completed', saved
    return saved


def test_real_keyboard_collection_health_win_loss_restart(env):
    store, _, build = prepare(env)
    cases = [case('startup', [click()], 'playing'),
        case('collection', movement(), '收集 1/1'),
        case('victory', [wait(0)], 'won'),
        case('restart-win', [click()], '收集 0/1'),
        case('damage', [wait(650)], '生命 2'),
        case('loss', [wait(2500)], 'lost'),
        case('restart-loss', [click()], '生命 3')]
    plan = plan_for(store, build, cases)
    saved = asyncio.run(execute_plan(store, plan, 'gameplay1'))
    assert [a['result'] for a in saved['attempts']] == ['passed'] * len(cases), saved
    assert len([e for e in saved['evidence'] if e['kind'] == 'screenshot']) == len(cases)


def test_real_restart_defect_requires_fixed_new_build_regression(env):
    store, builds, broken = prepare(env, broken=True)
    cases = [case('restart-regression', [click(), wait(3000), click()], '生命 3')]
    plan = plan_for(store, broken, cases)
    async def scenario():
        failed = await execute_plan(store, plan, 'broken-run')
        assert failed['attempts'][0]['result'] == 'failed', failed
        data = store.create_issue(store.read()['revision'], failed['testRunId'], cases[0].caseId,
            'desktop', 1, '重开未恢复生命值', 'blocker', '生命 3', '生命 0', ['等待失败后重开'])
        issue = data['issues'][-1]
        for target in ['triaged', 'in_progress', 'ready_for_retest']:
            data = store.update_issue(data['revision'], issue['issueId'], issue['revision'], target)
            issue = data['issues'][-1]
        source = store.workspace.read('game.js')
        fixed = source['content'].replace('hp: state?.hp ?? playerData.hp ?? 3', 'hp: playerData.hp ?? 3')
        state = store.workspace.patch(source['revision'], [dict(path='game.js', baseHash=digest(source['content'].encode()), content=fixed)], True)
        build = builds.build(state['revision'])
        regression_plan = plan_for(store, build, cases, revision=2)
        passed = await execute_plan(store, regression_plan, 'fixed-run')
        assert passed['attempts'][0]['result'] == 'passed', passed
        data = store.update_issue(store.read()['revision'], issue['issueId'], issue['revision'], 'closed', passed['testRunId'])
        assert data['issues'][-1]['state'] == 'closed'
        assert store.find_run(data, failed['testRunId'])['attempts'][0]['result'] == 'failed'
    asyncio.run(scenario())
