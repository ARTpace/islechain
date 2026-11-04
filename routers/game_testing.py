"""人工测试管理接口；不提供伪自动执行接口。"""
import importlib

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import Field, ValidationError

from core.game_project_models import Contract, Identifier, Text
from core.game_testing import TestingStore
from core.game_testing_models import GameTestCase, GameTestPlan, RequirementSet
from typing import Literal

projects = importlib.import_module('routers.game_projects')
router = APIRouter(prefix='/api/game-projects/{project_id}/testing', tags=['game-testing'])


class Write(Contract):
    baseRevision: int = Field(ge=0)


class RequirementsWrite(Write):
    requirements: RequirementSet


class CaseWrite(Write):
    case: GameTestCase


class PlanWrite(Write):
    plan: GameTestPlan


class Start(Write):
    planId: Identifier
    planRevision: int = Field(ge=1)
    requestId: Identifier


class Retry(Write):
    requestId: Identifier


class VisualReview(Write):
    currentEvidenceId: Identifier
    baselineEvidenceId: Identifier | None = None
    decision: Literal['accepted', 'rejected', 'needs_revision']
    comment: Text
    adoptBaseline: bool = False


class ResultWrite(Write):
    caseId: Identifier
    profileId: Identifier
    result: Literal['passed', 'failed', 'blocked']
    observation: Text
    screenshotBase64: str | None = Field(default=None, max_length=7 * 1024 * 1024)


class IssueWrite(Write):
    testRunId: Identifier
    caseId: Identifier
    profileId: Identifier
    attempt: int = Field(ge=1)
    title: Text
    severity: Literal['blocker', 'major', 'minor']
    expected: Text
    actual: Text
    steps: list[Text] = Field(min_length=1, max_length=100)


class IssueStateWrite(Write):
    issueRevision: int = Field(ge=1)
    state: Literal['open', 'triaged', 'in_progress', 'ready_for_retest', 'closed']
    regressionTestRunId: Identifier | None = None


def operate(project_id, token, operation, writable=False):
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token), writable=writable)
        try:
            return operation(TestingStore(repository, project))
        except ValidationError as exc:
            raise HTTPException(422, str(exc)) from exc


@router.get('')
def overview(project_id: Identifier, token: str = ''):
    def read(store):
        from core.game_test_execution import jobs
        from core.game_testing_models import GameTestAttempt, GameTestPlan
        data = store.read()
        changed = False
        for run in data['runs']:
            if run.get('executionMode') == 'automated' and run['state'] in ('preparing', 'running') and run['testRunId'] not in jobs:
                run['state'] = 'interrupted'
                run['reason'] = '服务中断，未自动重新执行'
                if run.get('activeCase'):
                    plan = GameTestPlan.model_validate(run['plan'])
                    case = next(c for c in plan.cases if c.caseId == run['activeCase'])
                    history = [a for a in run['attempts'] if a['caseId'] == case.caseId
                        and a['profileId'] == plan.environments[0].profileId]
                    queued = next((a for a in history if a['sessionId'] == run['sessionId'] and a['state'] == 'queued'), None)
                    number = queued['attempt'] if queued else max((a['attempt'] for a in history), default=0) + 1
                    if queued:
                        run['attempts'].remove(queued)
                    run['attempts'].append(GameTestAttempt(testRunId=run['testRunId'], runId=run['runId'],
                        sessionId=run['sessionId'], plan=plan, caseId=case.caseId, caseRevision=case.revision,
                        profileId=plan.environments[0].profileId, attempt=number, source='automated',
                        state='interrupted', result='blocked', reason=run['reason']).model_dump(mode='json'))
                    run['activeCase'] = None
                changed = True
        return store.save(data) if changed else data
    return operate(project_id, token, read)


@router.put('/requirements')
def requirements(project_id: Identifier, request: RequirementsWrite, token: str = ''):
    return operate(project_id, token, lambda s: s.adopt_requirements(request.baseRevision, request.requirements), True)


@router.post('/cases')
def save_case(project_id: Identifier, request: CaseWrite, token: str = ''):
    return operate(project_id, token, lambda s: s.save_case(request.baseRevision, request.case), True)


@router.post('/plans')
def save_plan(project_id: Identifier, request: PlanWrite, token: str = ''):
    return operate(project_id, token, lambda s: s.save_plan(request.baseRevision, request.plan), True)


@router.post('/cases/{case_id}/archive')
def archive_case(project_id: Identifier, case_id: Identifier, request: Write, token: str = ''):
    def update(store):
        data = store.read(request.baseRevision)
        if not any(c['caseId'] == case_id for c in data['cases']):
            raise HTTPException(404, '用例不存在')
        archived = data.setdefault('archivedCases', [])
        if case_id not in archived:
            archived.append(case_id)
        return store.save(data)
    return operate(project_id, token, update, True)


@router.post('/manual-runs')
def start(project_id: Identifier, request: Start, token: str = ''):
    return operate(project_id, token, lambda s: dict(zip(('testing', 'run'), s.start_manual(
        request.baseRevision, request.planId, request.planRevision, request.requestId))), True)


@router.post('/manual-runs/{test_run_id}/results')
def record(project_id: Identifier, test_run_id: Identifier, request: ResultWrite, token: str = ''):
    return operate(project_id, token, lambda s: s.record_manual(request.baseRevision, test_run_id,
        request.caseId, request.profileId, request.result, request.observation, request.screenshotBase64), True)


@router.post('/manual-runs/{test_run_id}/cancel')
def cancel(project_id: Identifier, test_run_id: Identifier, request: Write, token: str = ''):
    def update(store):
        data = store.read(request.baseRevision)
        run = store.find_run(data, test_run_id)
        if run.get('executionMode', 'manual') != 'manual':
            raise HTTPException(409, '自动运行须通过所属执行器取消')
        if run['state'] != 'running':
            raise HTTPException(409, '此人工记录已结束')
        run['state'] = 'cancelled'
        return store.save(data)
    return operate(project_id, token, update, True)


@router.post('/manual-runs/{test_run_id}/reports')
def report(project_id: Identifier, test_run_id: Identifier, request: Write, token: str = ''):
    return operate(project_id, token, lambda s: s.report(request.baseRevision, test_run_id), True)


@router.get('/evidence/{evidence_id}')
def read_evidence(project_id: Identifier, evidence_id: Identifier, token: str = ''):
    def read(store):
        data = store.read()
        record = next((e for r in data['runs'] for e in r['evidence'] if e['evidenceId'] == evidence_id), None)
        if record is None:
            raise HTTPException(404, '证据不存在')
        path = store.workspace.path(record['relativePath'])
        from core.game_projects import digest
        if not path.is_file() or path.stat().st_size != record['sizeBytes'] or digest(path.read_bytes()) != record['contentHash']:
            raise HTTPException(409, '证据文件损坏或缺失')
        return Response(path.read_bytes(), media_type='image/png' if record['kind'] == 'screenshot' else 'text/plain',
                        headers={'X-Content-Type-Options': 'nosniff'})
    return operate(project_id, token, read)


@router.get('/reports/{report_id}')
def download_report(project_id: Identifier, report_id: Identifier, format: Literal['json', 'markdown'] = 'json', token: str = ''):
    def read(store):
        data = store.read()
        record = next((r for r in data['reports'] if r['reportId'] == report_id), None)
        if record is None:
            raise HTTPException(404, '报告不存在')
        import json
        if format == 'json':
            return Response(json.dumps(record, ensure_ascii=False, indent=2), media_type='application/json')
        summary = record['summary']
        lines = ['# 游戏测试报告草稿', '', f"构建：{record['plan']['buildId']}",
                 f"计划总数：{summary['total']}", '', '结果：' + json.dumps(summary['counts'], ensure_ascii=False),
                 '', '交付批准：否', '', '限制：', *['- ' + value for value in record['limitations']]]
        lines += ['', '实际环境：' + json.dumps(record.get('observedEnvironment'), ensure_ascii=False), '', '用例结果：']
        for attempt in record['attempts']:
            lines += ['', f"- {attempt['caseId']} / {attempt['profileId']} / attempt {attempt['attempt']}: {attempt['result']} ({attempt['source']})"]
        lines += ['', '证据（交付包内相对路径）：']
        for evidence in record['evidence']:
            lines.append(f"- [{evidence['evidenceId']}]({evidence['relativePath']}) · SHA-256 {evidence['contentHash']}")
        return Response('\n'.join(lines), media_type='text/markdown')
    return operate(project_id, token, read)


@router.post('/issues')
def create_issue(project_id: Identifier, request: IssueWrite, token: str = ''):
    return operate(project_id, token, lambda s: s.create_issue(request.baseRevision, request.testRunId,
        request.caseId, request.profileId, request.attempt, request.title, request.severity,
        request.expected, request.actual, request.steps), True)


@router.post('/visual-reviews')
def review_visual(project_id: Identifier, request: VisualReview, token: str = ''):
    return operate(project_id, token, lambda s: s.review_visual(request.baseRevision,
        request.currentEvidenceId, request.baselineEvidenceId, request.decision, request.comment, request.adoptBaseline), True)


@router.post('/issues/{issue_id}/state')
def issue_state(project_id: Identifier, issue_id: Identifier, request: IssueStateWrite, token: str = ''):
    return operate(project_id, token, lambda s: s.update_issue(request.baseRevision, issue_id,
        request.issueRevision, request.state, request.regressionTestRunId), True)


@router.post('/automatic-runs')
async def start_automatic(project_id: Identifier, request: Start, token: str = ''):
    from core.game_test_execution import start
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token), writable=True)
    return start(repository, project, request.baseRevision, request.planId, request.planRevision, request.requestId)


@router.get('/automatic-runs/{test_run_id}/events')
def events(project_id: Identifier, test_run_id: Identifier, after: int = 0, token: str = ''):
    if after < 0:
        raise HTTPException(422, '游标不能为负')
    def read(store):
        run = store.find_run(store.read(), test_run_id)
        entries = run.get('events', [])
        selected = [e for e in entries if e['cursor'] > after][:100]
        return dict(state=run['state'], events=selected, cursor=selected[-1]['cursor'] if selected else after,
                    hasMore=bool(selected and entries[-1]['cursor'] > selected[-1]['cursor']))
    return operate(project_id, token, read)


@router.post('/automatic-runs/{test_run_id}/retry')
async def retry_automatic(project_id: Identifier, test_run_id: Identifier, request: Retry, token: str = ''):
    from core.game_test_execution import retry
    repository = projects.store()
    with repository.locked():
        project = repository.read(project_id, projects.identity(token), writable=True)
    return retry(repository, project, test_run_id, request.baseRevision, request.requestId)


@router.post('/automatic-runs/{test_run_id}/cancel')
async def cancel_automatic(project_id: Identifier, test_run_id: Identifier, token: str = ''):
    from core.game_test_execution import jobs
    operate(project_id, token, lambda store: store.find_run(store.read(), test_run_id))
    task = jobs.get(test_run_id)
    if task:
        task.cancel()
        try:
            await task
        except __import__('asyncio').CancelledError:
            pass
    jobs.pop(test_run_id, None)
    def finish(store):
        data = store.read()
        run = store.find_run(data, test_run_id)
        if run.get('executionMode') == 'automated' and run['state'] in ('preparing', 'running'):
            run['state'] = 'cancelled'
            run['reason'] = '在执行器开始前取消；未执行项保持未测'
            store.save(data)
        return run
    return operate(project_id, token, finish)
