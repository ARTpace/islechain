"""测试平台合同验证，不代表游戏已运行或证据真实存在。"""
import copy
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from core.game_testing_models import (
    GameTestAttempt, GameTestEvidence, GameTestPlan, GameTestReport, TRANSITIONS, validate_transition,
)


def sample():
    return dict(
        planId='plan1', revision=1, owner='tester', projectId='project1',
        buildId='build1', inputManifestHash='a' * 64, workspaceEpoch=0,
        environments=[dict(profileId='desktop', browser='Chromium test', platform='Windows',
                           viewportWidth=1280, viewportHeight=720, devicePixelRatio=1.0,
                           deviceMode='desktop', capabilities=['keyboard', 'screenshot'])],
        requirements=dict(projectId='project1', planRevision=1,
                          requirements=[dict(requirementId='movement', text='玩家可以移动')]),
        cases=[dict(caseId='move', revision=1, title='移动', requirementIds=['movement'],
                    executionMode='manual', steps=['按右键'], expectations=['玩家向右移动'])],
    )


def attempt(**changes):
    return dict(testRunId='test1', runId='run1', sessionId='session1', plan=sample(),
                caseId='move', caseRevision=1, profileId='desktop', attempt=1, source='manual', **changes)


def test_plan_roundtrip_and_stable_requirement_id():
    raw = sample()
    raw['requirements']['requirements'].insert(0, dict(requirementId='start', text='可以启动'))
    plan = GameTestPlan.model_validate(raw)
    assert plan.cases[0].requirementIds == ['movement']
    assert GameTestPlan.model_validate_json(plan.model_dump_json()) == plan


@pytest.mark.parametrize('kind', ['project', 'requirement', 'duplicate_case', 'duplicate_requirement', 'epoch', 'hash', 'extra'])
def test_invalid_plan(kind):
    raw = sample()
    if kind == 'project':
        raw['requirements']['projectId'] = 'other'
    elif kind == 'requirement':
        raw['cases'][0]['requirementIds'] = ['unknown']
    elif kind == 'duplicate_case':
        raw['cases'].append(copy.deepcopy(raw['cases'][0]))
    elif kind == 'duplicate_requirement':
        raw['requirements']['requirements'] *= 2
    elif kind == 'epoch':
        raw['workspaceEpoch'] = -1
    elif kind == 'hash':
        raw['inputManifestHash'] = 'invalid'
    else:
        raw['unknown'] = True
    with pytest.raises(ValidationError):
        GameTestPlan.model_validate(raw)


@pytest.mark.parametrize('state', list(TRANSITIONS))
@pytest.mark.parametrize('target', list(TRANSITIONS))
def test_state_machine(state, target):
    if target in TRANSITIONS[state]:
        validate_transition(state, target)
    else:
        with pytest.raises(ValueError):
            validate_transition(state, target)


@pytest.mark.parametrize('result', ['passed', 'failed'])
def test_conclusions_require_completion_and_evidence(result):
    with pytest.raises(ValidationError):
        GameTestAttempt.model_validate(attempt(state='completed', result=result))
    with pytest.raises(ValidationError):
        GameTestAttempt.model_validate(attempt(state='running', result=result, evidenceIds=['e1']))
    checked = GameTestAttempt.model_validate(attempt(state='completed', result=result, evidenceIds=['e1']))
    assert checked.result == result


@pytest.mark.parametrize('changes', [
    dict(state='completed'), dict(state='cancelled'),
    dict(state='completed', result='blocked'), dict(caseRevision=2),
    dict(source='automated'), dict(attempt=0),
])
def test_invalid_attempt(changes):
    raw = attempt()
    raw.update(changes)
    with pytest.raises(ValidationError):
        GameTestAttempt.model_validate(raw)


def test_interrupted_does_not_count_as_passed():
    checked = GameTestAttempt.model_validate(attempt(state='interrupted', result='blocked', reason='服务中断'))
    assert checked.result == 'blocked'


def evidence(**changes):
    raw = dict(evidenceId='e1', projectId='project1', owner='tester', buildId='build1',
               inputManifestHash='a' * 64, workspaceEpoch=0, testRunId='test1', runId='run1',
               sessionId='session1', caseId='move', caseRevision=1, profileId='desktop',
               attempt=1, capturedAt=datetime.now(timezone.utc), kind='observation', source='manual',
               relativePath='runs/run1/evidence/e1.json', contentHash='b' * 64, sizeBytes=100)
    raw.update(changes)
    return raw


def report(**changes):
    raw = dict(reportId='report1', revision=1, plan=sample(),
               attempts=[attempt(state='completed', result='passed', evidenceIds=['e1'])],
               evidence=[evidence()])
    raw.update(changes)
    return raw


def test_report_roundtrip_and_summary():
    checked = GameTestReport.model_validate(report())
    assert checked.summary() == dict(total=1, counts=dict(passed=1, failed=0, blocked=0, not_run=0),
                                     flaky=[], requiredCasesPassed=True)
    assert GameTestReport.model_validate_json(checked.model_dump_json()) == checked


@pytest.mark.parametrize('field,value', [
    ('projectId', 'other'), ('owner', 'other'), ('buildId', 'other'),
    ('inputManifestHash', 'c' * 64), ('workspaceEpoch', 1), ('testRunId', 'other'),
    ('sessionId', 'other'), ('caseId', 'other'), ('caseRevision', 2),
    ('profileId', 'other'), ('attempt', 2), ('source', 'agent'),
])
def test_report_rejects_foreign_evidence(field, value):
    raw = report(evidence=[evidence(**{field: value})])
    with pytest.raises(ValidationError):
        GameTestReport.model_validate(raw)


@pytest.mark.parametrize('changes', [
    dict(relativePath='../secret'), dict(relativePath='runs/other/e1.json'),
    dict(sizeBytes=0), dict(sizeBytes=10 * 1024 * 1024 + 1),
    dict(capturedAt=datetime(2026, 11, 2)),
])
def test_invalid_evidence(changes):
    with pytest.raises(ValidationError):
        GameTestEvidence.model_validate(evidence(**changes))


@pytest.mark.parametrize('changes', [dict(evidence=[]), dict(evidence=[evidence(), evidence()]),
                                       dict(attempts=[]), dict(attempts=[attempt(), attempt()])])
def test_report_missing_duplicate_or_unbound_records(changes):
    with pytest.raises(ValidationError):
        GameTestReport.model_validate(report(**changes))


def test_missing_environment_counts_as_not_run():
    raw = report()
    extra = copy.deepcopy(raw['plan']['environments'][0])
    extra['profileId'] = 'small'
    raw['plan']['environments'].append(extra)
    raw['attempts'][0]['plan'] = copy.deepcopy(raw['plan'])
    summary = GameTestReport.model_validate(raw).summary()
    assert summary['total'] == 2
    assert summary['counts']['not_run'] == 1
    assert not summary['requiredCasesPassed']


def test_retry_keeps_failure_and_flags_flaky():
    raw = report()
    raw['attempts'][0]['result'] = 'failed'
    retry = copy.deepcopy(raw['attempts'][0])
    retry.update(attempt=2, result='passed', evidenceIds=['e2'])
    raw['attempts'].append(retry)
    raw['evidence'].append(evidence(evidenceId='e2', attempt=2, relativePath='runs/run1/evidence/e2.json'))
    checked = GameTestReport.model_validate(raw)
    assert len(checked.attempts) == 2
    assert checked.summary()['counts']['passed'] == 1
    assert checked.summary()['flaky'] == [dict(caseId='move', profileId='desktop')]
    assert not checked.summary()['requiredCasesPassed']


def test_missing_capability_blocks_conclusion():
    raw = attempt(state='completed', result='passed', evidenceIds=['e1'])
    raw['plan']['cases'][0]['requiredCapabilities'] = ['touch']
    with pytest.raises(ValidationError):
        GameTestAttempt.model_validate(raw)
    raw.update(result='blocked', reason='适配器不支持触屏', evidenceIds=[])
    assert GameTestAttempt.model_validate(raw).result == 'blocked'


@pytest.mark.parametrize('field,value', [('viewportWidth', 0), ('devicePixelRatio', float('nan')),
                                       ('capabilities', ['touch', 'touch'])])
def test_invalid_environment(field, value):
    raw = sample()
    raw['environments'][0][field] = value
    with pytest.raises(ValidationError):
        GameTestPlan.model_validate(raw)
