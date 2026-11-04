import copy
import importlib
import json

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from core.game_project_models import Project
from core.game_projects import ProjectStore
from core.game_testing import TestingStore as Store
from core.game_workspace import Workspace

routes = importlib.import_module('routers.game_testing')


@pytest.fixture
def env(tmp_path, monkeypatch):
    repository = ProjectStore(tmp_path / 'projects')
    raw = json.loads((__import__('pathlib').Path(__file__).parents[1] / 'docs/examples/game-project.json').read_text(encoding='utf-8'))
    raw.update(id='p1', owner='alice', canvasId='c1', planConfirmed=True)
    project = Project.model_validate(raw)
    with repository.locked():
        repository.save(project, increment=False)
    monkeypatch.setattr(routes.projects, 'store', lambda: repository)
    def identity(token):
        if token not in ('alice', 'bob'):
            raise HTTPException(401, '登录失效')
        return token
    monkeypatch.setattr(routes.projects, 'identity', identity)
    app = FastAPI()
    app.include_router(routes.router)
    client = TestClient(app)
    return client, Store(repository, project)


def call(env, method='GET', suffix='', data=None, owner='alice'):
    return env[0].request(method, '/api/game-projects/p1/testing' + suffix, params={'token': owner}, json=data)


def setup(env):
    project = env[1].project
    requirements = dict(projectId='p1', planRevision=project.plan.revision,
        requirements=[dict(requirementId=f'req{i}', text=text) for i, text in enumerate(project.plan.acceptanceCriteria)])
    response = call(env, 'PUT', '/requirements', dict(baseRevision=0, requirements=requirements))
    assert response.status_code == 200, response.text
    case = dict(caseId='movement', revision=1, title='移动', requirementIds=['req0'], executionMode='manual',
                steps=['按右方向键'], expectations=['玩家右移'])
    response = call(env, 'POST', '/cases', dict(baseRevision=1, case=case))
    assert response.status_code == 200, response.text
    plan = dict(planId='plan1', revision=1, owner='alice', projectId='p1', buildId='external-build1',
        inputManifestHash='a' * 64, workspaceEpoch=0, requirements=requirements, cases=[case],
        environments=[dict(profileId='desktop', browser='Chromium test', platform='Windows',
            viewportWidth=1280, viewportHeight=720, devicePixelRatio=1.0, deviceMode='desktop', capabilities=['keyboard'])])
    response = call(env, 'POST', '/plans', dict(baseRevision=2, plan=plan))
    assert response.status_code == 200, response.text
    request = dict(baseRevision=3, planId='plan1', planRevision=1, requestId='request1')
    response = call(env, 'POST', '/manual-runs', request)
    assert response.status_code == 200, response.text
    return response.json()['run'], plan, request


def record(env, run, result='failed'):
    state = call(env).json()
    return call(env, 'POST', f"/manual-runs/{run['testRunId']}/results", dict(
        baseRevision=state['revision'], caseId='movement', profileId='desktop', result=result, observation='人工观察：玩家实际位置与预期对比'))


def test_manual_failure_retry_report_and_evidence(env):
    run, _, request = setup(env)
    repeated = call(env, 'POST', '/manual-runs', request)
    assert repeated.json()['run']['testRunId'] == run['testRunId']
    assert record(env, run).status_code == 200
    response = record(env, run, 'passed')
    assert response.status_code == 200, response.text
    evidence_id = response.json()['runs'][0]['evidence'][0]['evidenceId']
    assert call(env, suffix='/evidence/' + evidence_id).status_code == 200
    assert call(env, suffix='/evidence/' + evidence_id, owner='bob').status_code == 403
    result = call(env, 'POST', f"/manual-runs/{run['testRunId']}/reports", dict(baseRevision=response.json()['revision']))
    assert result.status_code == 200, result.text
    report = result.json()
    assert report['summary']['flaky']
    assert not report['deliveryApproved']
    assert not report['summary']['requiredCasesPassed']
    assert len(report['attempts']) == 2
    assert call(env, suffix='/reports/' + report['reportId']).json() == report
    assert call(env, suffix='/reports/' + report['reportId'], owner='bob').status_code == 403
    assert record(env, run).status_code == 409
    # 新实例可恢复已保存事实，不依赖进程内对象。
    assert env[1].read()['reports'][0]['reportId'] == report['reportId']


def test_unrun_report_never_passes(env):
    run, _, _ = setup(env)
    result = call(env, 'POST', f"/manual-runs/{run['testRunId']}/reports", dict(baseRevision=4))
    assert result.status_code == 200
    assert result.json()['summary']['counts']['not_run'] == 1
    assert not result.json()['summary']['requiredCasesPassed']


def test_tampered_evidence_prevents_report(env):
    run, _, _ = setup(env)
    result = record(env, run, 'passed').json()
    evidence = result['runs'][0]['evidence'][0]
    env[1].workspace.path(evidence['relativePath']).write_text('伪造', encoding='utf-8')
    assert call(env, suffix='/evidence/' + evidence['evidenceId']).status_code == 409
    assert call(env, 'POST', f"/manual-runs/{run['testRunId']}/reports", dict(baseRevision=result['revision'])).status_code == 409
    assert not call(env).json()['reports']


def test_frozen_plan_revision_permissions_and_references(env):
    _, plan, _ = setup(env)
    assert call(env, owner='').status_code == 401
    assert call(env, owner='bob').status_code == 403
    assert call(env, 'POST', '/plans', dict(baseRevision=4, plan=plan)).status_code == 409
    altered = copy.deepcopy(plan)
    altered['revision'] = 2
    altered['owner'] = 'bob'
    assert call(env, 'POST', '/plans', dict(baseRevision=4, plan=altered)).status_code == 403
    altered['owner'] = 'alice'
    altered['cases'][0]['steps'] = ['未保存的变化']
    assert call(env, 'POST', '/plans', dict(baseRevision=4, plan=altered)).status_code == 422
    mapped = copy.deepcopy(plan['requirements'])
    mapped['requirements'][0]['requirementId'] = 'new-id'
    assert call(env, 'PUT', '/requirements', dict(baseRevision=4, requirements=mapped)).status_code == 409


def test_epoch_restore_invalidates_old_manual_session(env):
    run, _, _ = setup(env)
    workspace = env[1].workspace
    state = workspace.create()
    workspace.restore(state['revision'], state['snapshots'][0]['snapshotId'])
    assert record(env, run, 'passed').status_code == 409


def test_requirement_duplicate_increment_preserves_identity_and_history(env):
    from core.game_testing_models import RequirementSet
    _, plan, _ = setup(env)
    store = env[1]
    text = store.project.plan.acceptanceCriteria[0]
    store.project.plan.acceptanceCriteria.append(text)
    store.project.plan.revision += 1
    mapped = copy.deepcopy(plan['requirements'])
    mapped['planRevision'] += 1
    mapped['requirements'].append(dict(requirementId='duplicate-new', text=text))
    data = store.adopt_requirements(4, RequirementSet.model_validate(mapped))
    assert data['requirementsHistory'][0]['requirements'] == RequirementSet.model_validate(plan['requirements']).model_dump()
    assert data['requirements']['requirements'][0]['requirementId'] == 'req0'
    mapped['requirements'].reverse()
    assert store.adopt_requirements(data['revision'], RequirementSet.model_validate(mapped))['requirements'] == RequirementSet.model_validate(mapped).model_dump()


def test_manual_png_evidence_is_validated_bound_and_immutable(env):
    import base64
    import io
    from PIL import Image
    run, _, _ = setup(env)
    stream = io.BytesIO()
    Image.new('RGB', (4, 4), 'red').save(stream, format='PNG')
    raw = stream.getvalue()
    endpoint = f"/manual-runs/{run['testRunId']}/results"
    request = dict(baseRevision=4, caseId='movement', profileId='desktop', result='passed',
                   observation='截图审阅：位置正确', screenshotBase64='invalid!')
    assert call(env, 'POST', endpoint, request).status_code == 422
    assert call(env).json()['revision'] == 4
    request['screenshotBase64'] = base64.b64encode(b'not a PNG').decode()
    assert call(env, 'POST', endpoint, request).status_code == 422
    request['screenshotBase64'] = base64.b64encode(raw).decode()
    response = call(env, 'POST', endpoint, request)
    assert response.status_code == 200, response.text
    saved = response.json()['runs'][0]
    screenshot = next(e for e in saved['evidence'] if e['kind'] == 'screenshot')
    assert screenshot['source'] == 'manual'
    assert screenshot['buildId'] == run['plan']['buildId']
    assert screenshot['evidenceId'] in saved['attempts'][0]['evidenceIds']
    assert call(env, suffix='/evidence/' + screenshot['evidenceId']).content == raw
    assert call(env, suffix='/evidence/' + screenshot['evidenceId'], owner='bob').status_code == 403
    report = call(env, 'POST', f"/manual-runs/{run['testRunId']}/reports", dict(baseRevision=response.json()['revision']))
    assert report.status_code == 200, report.text
    assert len(report.json()['evidence']) == 2
    request['baseRevision'] = call(env).json()['revision']
    assert call(env, 'POST', endpoint, request).status_code == 409


def test_visual_review_preserves_baseline_and_requires_intact_matching_evidence(env):
    import base64
    import io
    from PIL import Image
    run, _, _ = setup(env)
    stream = io.BytesIO()
    Image.new('RGB', (4, 4), 'red').save(stream, format='PNG')
    request = dict(baseRevision=4, caseId='movement', profileId='desktop', result='passed',
        observation='截图审阅夹具', screenshotBase64=base64.b64encode(stream.getvalue()).decode())
    result = call(env, 'POST', f"/manual-runs/{run['testRunId']}/results", request)
    screenshot = next(e for e in result.json()['runs'][0]['evidence'] if e['kind'] == 'screenshot')
    review = dict(baseRevision=result.json()['revision'], currentEvidenceId=screenshot['evidenceId'],
        decision='accepted', comment='人工确认可读，采用首个基线', adoptBaseline=True)
    assert call(env, 'POST', '/visual-reviews', review, owner='bob').status_code == 403
    response = call(env, 'POST', '/visual-reviews', review)
    assert response.status_code == 200, response.text
    baseline = response.json()['visualBaselines'][0]
    review.update(baseRevision=response.json()['revision'], decision='rejected', comment='拒绝差异', adoptBaseline=True)
    assert call(env, 'POST', '/visual-reviews', review).status_code == 409
    review['adoptBaseline'] = False
    review['baselineEvidenceId'] = screenshot['evidenceId']
    response = call(env, 'POST', '/visual-reviews', review)
    assert response.status_code == 200, response.text
    assert response.json()['visualBaselines'] == [baseline]
    assert len(response.json()['visualReviews']) == 2
    assert response.json()['runs'][0]['attempts'][0]['result'] == 'passed'
    env[1].workspace.path(screenshot['relativePath']).write_bytes(b'corrupt')
    review['baseRevision'] = response.json()['revision']
    assert call(env, 'POST', '/visual-reviews', review).status_code == 409


def test_cancel_preserves_history_and_archive_blocks_new_plans(env):
    run, plan, _ = setup(env)
    result = record(env, run)
    revision = result.json()['revision']
    result = call(env, 'POST', f"/manual-runs/{run['testRunId']}/cancel", dict(baseRevision=revision))
    assert result.status_code == 200
    assert len(result.json()['runs'][0]['attempts']) == 1
    assert record(env, run).status_code == 409
    result = call(env, 'POST', '/cases/movement/archive', dict(baseRevision=result.json()['revision']))
    plan['revision'] = 2
    assert call(env, 'POST', '/plans', dict(baseRevision=result.json()['revision'], plan=plan)).status_code == 409


def test_issue_requires_new_build_and_matching_regression(env):
    from core.game_web_builds import WebBuilds
    run, plan, _ = setup(env)
    result = record(env, run).json()
    issue_request = dict(baseRevision=result['revision'], testRunId=run['testRunId'], caseId='movement',
        profileId='desktop', attempt=1, title='移动失败', severity='blocker',
        expected='玩家右移', actual='玩家没有移动', steps=['按右方向键'])
    response = call(env, 'POST', '/issues', issue_request)
    assert response.status_code == 200, response.text
    issue = response.json()['issues'][0]
    for target in ('triaged', 'in_progress', 'ready_for_retest'):
        state = call(env).json()
        response = call(env, 'POST', f"/issues/{issue['issueId']}/state", dict(
            baseRevision=state['revision'], issueRevision=issue['revision'], state=target))
        assert response.status_code == 200, response.text
        issue = response.json()['issues'][0]
    workspace = env[1].workspace
    state = workspace.create()
    builds = WebBuilds(workspace.repository, workspace.project)
    state = builds.install_template(state['revision'])
    artifact = builds.build(state['revision'])
    plan.update(revision=2, buildId=artifact['buildId'], inputManifestHash=artifact['inputManifestHash'])
    response = call(env, 'POST', '/plans', dict(baseRevision=call(env).json()['revision'], plan=plan))
    assert response.status_code == 200, response.text
    response = call(env, 'POST', '/manual-runs', dict(baseRevision=response.json()['revision'],
        planId='plan1', planRevision=2, requestId='regression1'))
    regression = response.json()['run']
    state = call(env).json()
    endpoint = f"/issues/{issue['issueId']}/state"
    request = dict(baseRevision=state['revision'], issueRevision=issue['revision'], state='closed',
                   regressionTestRunId=regression['testRunId'])
    assert call(env, 'POST', endpoint, request).status_code == 409
    response = record(env, regression, 'passed')
    assert response.status_code == 200
    request['baseRevision'] = response.json()['revision']
    response = call(env, 'POST', endpoint, request)
    assert response.status_code == 200, response.text
    assert response.json()['issues'][0]['state'] == 'closed'
    assert len(response.json()['issues'][0]['history']) == 4
