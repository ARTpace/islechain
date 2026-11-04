"""交付门槛协议测试；人工观察是测试夹具，不是样例游戏的实际验收。"""
import io
import zipfile

import pytest
from fastapi import HTTPException

from core.game_project_models import Project
from core.game_releases import REQUIRED_CATEGORIES, release
from core.game_testing import TestingStore as Store
from core.game_testing_models import GameTestCase, GameTestPlan
from core.game_web_builds import WebBuilds
from test_game_testing import env, setup


def prepared(env):
    setup(env)
    original = env[1]
    repository = original.workspace.repository
    raw = original.project.model_dump()
    raw.update(assets=[], artConfirmed=True)
    raw['plan']['visualDirection']['referenceAssetIds'] = []
    for entity in raw['plan']['characters'] + raw['plan']['scenes']:
        entity['assetIds'] = []
    project = Project.model_validate(raw)
    repository.save(project, increment=False)
    store = Store(repository, project)
    state = store.workspace.create()
    builds = WebBuilds(repository, project)
    state = builds.install_template(state['revision'])
    build = builds.build(state['revision'], True, {'game': '测试夹具源码声明'})
    data = store.read()
    cases = []
    for category in sorted(REQUIRED_CATEGORIES):
        case = GameTestCase(caseId=category, revision=1, title=category, category=category,
            requirementIds=[r['requirementId'] for r in data['requirements']['requirements']],
            executionMode='manual', steps=['按测试夹具操作'], expectations=['夹具预期'])
        data = store.save_case(data['revision'], case)
        cases.append(case)
    plan = GameTestPlan(planId='release-plan', revision=1, owner=project.owner, projectId=project.id,
        buildId=build['buildId'], inputManifestHash=build['inputManifestHash'], workspaceEpoch=0,
        requirements=data['requirements'], cases=cases, environments=[dict(profileId='desktop',
            browser='fixture', platform='fixture', viewportWidth=1280, viewportHeight=720,
            devicePixelRatio=1, deviceMode='desktop', capabilities=[])])
    data = store.save_plan(data['revision'], plan)
    data, run = store.start_manual(data['revision'], plan.planId, 1, 'release-run')
    for case in cases:
        data = store.record_manual(data['revision'], run['testRunId'], case.caseId, 'desktop', 'passed', '夹具人工观察')
    report = store.report(data['revision'], run['testRunId'])
    return store, build, report


def test_release_carries_report_evidence_and_rejects_missing_approval(env):
    store, build, report = prepared(env)
    args = (store.workspace.repository, store.project, build['buildId'], [report['reportId']])
    with pytest.raises(HTTPException) as rejected:
        release(*args, False, True, True, [])
    assert rejected.value.status_code == 409
    metadata = release(*args, True, True, True, [])
    assert metadata['deliveryApproved']
    path = store.workspace.path(f"exports/releases/{metadata['releaseId']}.zip")
    with zipfile.ZipFile(io.BytesIO(path.read_bytes())) as archive:
        assert 'index.html' in archive.namelist()
        for evidence in report['evidence']:
            assert archive.read(evidence['relativePath']) == store.workspace.path(evidence['relativePath']).read_bytes()


def test_release_rechecks_evidence_and_blocking_issues(env):
    store, build, report = prepared(env)
    args = (store.workspace.repository, store.project, build['buildId'], [report['reportId']], True, True, True, [])
    data = store.read()
    data['issues'].append(dict(issueId='blocker', severity='blocker', state='open'))
    store.save(data)
    with pytest.raises(HTTPException) as rejected:
        release(*args)
    assert any('阻断' in item for item in rejected.value.detail['issues'])
    data = store.read()
    data['issues'] = []
    store.save(data)
    store.workspace.path(report['evidence'][0]['relativePath']).write_bytes(b'corrupt')
    with pytest.raises(HTTPException) as rejected:
        release(*args)
    assert any('证据' in item for item in rejected.value.detail['issues'])
