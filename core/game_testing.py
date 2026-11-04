"""测试管理的文件存储；人工记录与自动执行严格区分。调用方持有项目锁。"""
import json
from collections import Counter
from datetime import datetime, timezone

from fastapi import HTTPException

from core.game_projects import atomic_write, digest, json_bytes, uid
from core.game_testing_models import (
    GameTestAttempt, GameTestCase, GameTestEvidence, GameTestPlan, GameTestReport, RequirementSet,
)
from core.game_workspace import Workspace
from core.game_web_builds import WebBuilds


class TestingStore:
    def __init__(self, repository, project):
        self.workspace = Workspace(repository, project)
        self.project = project

    def read(self, base=None):
        path = self.workspace.path('tests/registry.json')
        data = json.loads(path.read_bytes()) if path.exists() else dict(
            schemaVersion=1, revision=0, requirements=None, cases=[], archivedCases=[], plans=[], runs=[], reports=[], issues=[])
        if data.get('schemaVersion') != 1:
            raise HTTPException(409, '未知测试数据版本，仅允许诊断')
        if base is not None and base != data['revision']:
            raise HTTPException(409, '测试资料已变化，请保留草稿并重载')
        return data

    def save(self, data):
        data['revision'] += 1
        content = json_bytes(data)
        if len(content) > 16 * 1024 * 1024:
            raise HTTPException(413, '测试索引超过 16 MiB，不自动清理历史')
        atomic_write(self.workspace.path('tests/registry.json'), content)
        return data

    def adopt_requirements(self, base, requirements):
        data = self.read(base)
        plan = self.project.plan
        if plan is None or not self.project.planConfirmed:
            raise HTTPException(409, '先确认当前策划')
        if requirements.projectId != self.project.id or requirements.planRevision != plan.revision:
            raise HTTPException(409, '需求映射与当前项目或策划修订不匹配')
        if Counter(r.text for r in requirements.requirements) != Counter(plan.acceptanceCriteria):
            raise HTTPException(422, '需求映射必须完整保留当前验收文本，包含重复项')
        if data['requirements']:
            old = RequirementSet.model_validate(data['requirements'])
            by_text, next_by_text = {}, {}
            for requirement in old.requirements:
                by_text.setdefault(requirement.text, set()).add(requirement.requirementId)
            for requirement in requirements.requirements:
                next_by_text.setdefault(requirement.text, set()).add(requirement.requirementId)
            for text, previous_ids in by_text.items():
                next_ids = next_by_text.get(text, set())
                # 相同文字增加重复项时可新增身份；仍存在的旧项不能因排序漂移。
                if len(previous_ids & next_ids) != min(len(previous_ids), len(next_ids)):
                    raise HTTPException(409, '未改变的需求文本须保留原 requirementId')
            if old != requirements:
                history = data.setdefault('requirementsHistory', [])
                if len(history) >= 100:
                    raise HTTPException(413, '需求采用历史达到 100 条，不自动删除')
                history.append(dict(requirements=old.model_dump(), replacedAt=datetime.now(timezone.utc).isoformat(),
                    owner=self.project.owner, projectRevision=self.project.revision))
        data['requirements'] = requirements.model_dump()
        return self.save(data)

    def save_case(self, base, case):
        data = self.read(base)
        requirements = RequirementSet.model_validate(data['requirements']) if data['requirements'] else None
        if requirements is None or set(case.requirementIds) - {r.requirementId for r in requirements.requirements}:
            raise HTTPException(422, '请先采用需求映射，用例不能引用未知需求')
        history = [c for c in data['cases'] if c['caseId'] == case.caseId]
        expected = max((c['revision'] for c in history), default=0) + 1
        if case.revision != expected:
            raise HTTPException(409, f'用例下个修订应为 {expected}')
        if len(data['cases']) >= 1000:
            raise HTTPException(413, '用例历史达到 1000 条')
        data['cases'].append(case.model_dump())
        return self.save(data)

    def save_plan(self, base, plan):
        data = self.read(base)
        if plan.projectId != self.project.id or plan.owner != self.project.owner:
            raise HTTPException(403, '计划不属于当前项目或 owner')
        if plan.requirements.model_dump() != data['requirements']:
            raise HTTPException(409, '计划需求不是当前采用版本')
        if not self.project.plan or plan.requirements.planRevision != self.project.plan.revision:
            raise HTTPException(409, '策划修订已变化，需先更新需求映射')
        if plan.workspaceEpoch != self.workspace.state()['workspaceEpoch']:
            raise HTTPException(409, '工作区 epoch 已变化')
        build = next((b for b in WebBuilds(self.workspace.repository, self.project).list() if b['buildId'] == plan.buildId), None)
        if build and (build['inputManifestHash'] != plan.inputManifestHash or build['workspaceEpoch'] != plan.workspaceEpoch):
            raise HTTPException(409, '计划输入与固定构建不匹配')
        for case in plan.cases:
            if case.caseId in data.get('archivedCases', []):
                raise HTTPException(409, '归档用例不能加入新计划，历史计划保留')
            if case.model_dump() not in [GameTestCase.model_validate(c).model_dump() for c in data['cases']]:
                raise HTTPException(422, '计划必须引用已保存的用例版本')
        expected = max((p['revision'] for p in data['plans'] if p['planId'] == plan.planId), default=0) + 1
        if plan.revision != expected:
            raise HTTPException(409, f'计划下个修订应为 {expected}；旧版本不可覆盖')
        if len(data['plans']) >= 100:
            raise HTTPException(413, '计划版本达到 100 条')
        data['plans'].append(plan.model_dump())
        return self.save(data)

    def start_manual(self, base, plan_id, plan_revision, request_id, mode='manual'):
        data = self.read()
        if any(request_id in r.get('retryRequestIds', []) for r in data['runs']):
            raise HTTPException(409, '幂等键已用于显式重测')
        old = next((r for r in data['runs'] if r['requestId'] == request_id), None)
        if old:
            if (old['plan']['planId'] != plan_id or old['plan']['revision'] != plan_revision
                    or old.get('executionMode', 'manual') != mode):
                raise HTTPException(409, '幂等键已用于另一计划')
            return data, old
        if base != data['revision']:
            raise HTTPException(409, '测试资料已变化，请重新载入')
        plan = next((p for p in data['plans'] if p['planId'] == plan_id and p['revision'] == plan_revision), None)
        if plan is None:
            raise HTTPException(404, '计划版本不存在')
        if any(c['executionMode'] != mode for c in plan['cases']):
            raise HTTPException(409, '计划的执行方式与所选入口不匹配')
        if mode == 'automated' and len(plan['environments']) != 1:
            raise HTTPException(409, '首版自动执行每个计划限定一个环境；多环境请分别建计划')
        if mode == 'automated' and len(plan['cases']) > 10:
            raise HTTPException(409, '首版单次自动计划最多 10 个用例，匹配截图容量')
        if plan['workspaceEpoch'] != self.workspace.state()['workspaceEpoch']:
            raise HTTPException(409, '恢复后旧计划需创建新修订')
        if len(data['runs']) >= 100:
            raise HTTPException(413, '测试运行达到 100 条')
        local_build = any(b['buildId'] == plan['buildId'] for b in WebBuilds(self.workspace.repository, self.project).list())
        if mode == 'automated' and not local_build:
            raise HTTPException(409, '自动执行只接受已校验的本地固定构建')
        run = dict(testRunId=uid('test'), runId=uid('run' if mode == 'automated' else 'manual'), sessionId=uid('test_session'),
                   requestId=request_id, plan=plan, state='running', attempts=[], evidence=[],
                   executionMode=mode, events=[], activeCase=None,
                   buildVerification='fixed_local_artifact' if local_build else 'external_unverified')
        data['runs'].append(run)
        return self.save(data), run

    def find_run(self, data, run_id):
        run = next((r for r in data['runs'] if r['testRunId'] == run_id), None)
        if run is None:
            raise HTTPException(404, '测试运行不存在')
        return run

    def record_manual(self, base, run_id, case_id, profile_id, result, observation, screenshot_base64=None):
        data = self.read(base)
        run = self.find_run(data, run_id)
        if run.get('executionMode', 'manual') != 'manual':
            raise HTTPException(409, '自动运行结果只能由实际执行器写入')
        if run['state'] != 'running':
            raise HTTPException(409, '测试记录已结束，不可追加结果')
        plan = GameTestPlan.model_validate(run['plan'])
        if plan.workspaceEpoch != self.workspace.state()['workspaceEpoch']:
            raise HTTPException(409, '恢复后旧测试会话失效')
        case = next((c for c in plan.cases if c.caseId == case_id), None)
        if case is None:
            raise HTTPException(404, '用例不属于计划')
        history = [a for a in run['attempts'] if a['caseId'] == case_id and a['profileId'] == profile_id]
        if len(run['attempts']) >= 1000:
            raise HTTPException(413, '单次运行最多 1000 条 attempt')
        number = max((a['attempt'] for a in history), default=0) + 1
        evidence_id = uid('evidence')
        raw = observation.encode('utf-8')
        attempt = GameTestAttempt(testRunId=run_id, runId=run['runId'], sessionId=run['sessionId'],
            plan=plan, caseId=case_id, caseRevision=case.revision, profileId=profile_id,
            attempt=number, source='manual', state='completed', result=result,
            reason=observation if result == 'blocked' else None, evidenceIds=[evidence_id])
        evidence = GameTestEvidence(evidenceId=evidence_id, projectId=self.project.id, owner=self.project.owner,
            buildId=plan.buildId, inputManifestHash=plan.inputManifestHash, workspaceEpoch=plan.workspaceEpoch,
            testRunId=run_id, runId=run['runId'], sessionId=run['sessionId'], caseId=case_id,
            caseRevision=case.revision, profileId=profile_id, attempt=number,
            capturedAt=datetime.now(timezone.utc), kind='observation', source='manual',
            relativePath=f"runs/{run['runId']}/evidence/{evidence_id}.txt", contentHash=digest(raw), sizeBytes=len(raw))
        attachments = []
        if screenshot_base64 is not None:
            import base64
            import binascii
            import io
            from PIL import Image
            try:
                image = base64.b64decode(screenshot_base64, validate=True)
                if not 0 < len(image) <= 5 * 1024 * 1024:
                    raise HTTPException(413, '截图限定 5 MiB')
                with Image.open(io.BytesIO(image)) as decoded:
                    if decoded.format != 'PNG' or decoded.width * decoded.height > 16_000_000:
                        raise ValueError('仅接受不超过 1600 万像素的 PNG')
                    decoded.verify()
            except (binascii.Error, ValueError, OSError, Image.DecompressionBombError) as exc:
                raise HTTPException(422, '截图必须是完整、有效的 PNG') from exc
            if sum(e['sizeBytes'] for e in run['evidence'] if e['kind'] == 'screenshot') + len(image) > 20 * 1024 * 1024:
                raise HTTPException(413, '单次运行截图总量限定 20 MiB')
            screenshot_id = uid('screenshot')
            screenshot = evidence.model_copy(update=dict(evidenceId=screenshot_id, kind='screenshot',
                relativePath=f"runs/{run['runId']}/evidence/{screenshot_id}.png",
                contentHash=digest(image), sizeBytes=len(image)))
            attachments.append((screenshot, image))
            attempt.evidenceIds.append(screenshot_id)
        # 先落盘后写索引；中断留下未引用证据，绝不留下虚假成功索引。
        atomic_write(self.workspace.path(evidence.relativePath), raw)
        for attachment, content in attachments:
            atomic_write(self.workspace.path(attachment.relativePath), content)
        run['attempts'].append(attempt.model_dump(mode='json'))
        run['evidence'].append(evidence.model_dump(mode='json'))
        run['evidence'].extend(attachment.model_dump(mode='json') for attachment, _ in attachments)
        return self.save(data)

    def review_visual(self, base, current_id, baseline_id, decision, comment, adopt_baseline):
        data = self.read(base)
        if len(data.get('visualReviews', [])) >= 100 or (adopt_baseline and len(data.get('visualBaselines', [])) >= 100):
            raise HTTPException(413, '视觉审阅或基线达到 100 条，不自动清理')
        def screenshot(evidence_id):
            for run in data['runs']:
                raw = next((e for e in run['evidence'] if e['evidenceId'] == evidence_id), None)
                if raw is None:
                    continue
                evidence = GameTestEvidence.model_validate_json(json.dumps(raw))
                if evidence.kind != 'screenshot' or evidence.workspaceEpoch != self.workspace.state()['workspaceEpoch']:
                    raise HTTPException(409, '只能审阅当前 epoch 的截图证据')
                path = self.workspace.path(evidence.relativePath)
                if not path.is_file() or path.stat().st_size != evidence.sizeBytes or digest(path.read_bytes()) != evidence.contentHash:
                    raise HTTPException(409, '截图证据缺失或损坏')
                plan = GameTestPlan.model_validate(run['plan'])
                profile = next(p for p in plan.environments if p.profileId == evidence.profileId)
                return evidence, profile, run.get('observedEnvironment')
            raise HTTPException(404, '截图证据不存在')
        current, profile, observed = screenshot(current_id)
        if baseline_id:
            baseline, previous_profile, previous_observed = screenshot(baseline_id)
            if (current.caseId, current.caseRevision, profile, observed) != (baseline.caseId, baseline.caseRevision, previous_profile, previous_observed):
                raise HTTPException(409, '基线用例修订或环境不匹配，请先重新建立对应基线')
        if adopt_baseline and decision != 'accepted':
            raise HTTPException(409, '只有明确接受的截图才能采用为基线')
        review = dict(reviewId=uid('visual'), currentEvidenceId=current_id, baselineEvidenceId=baseline_id,
            buildId=current.buildId, caseId=current.caseId, caseRevision=current.caseRevision,
            profileId=current.profileId, workspaceEpoch=current.workspaceEpoch,
            decision=decision, comment=comment, source='manual', reviewer=self.project.owner,
            reviewedAt=datetime.now(timezone.utc).isoformat(), adoptedBaselineId=None)
        if adopt_baseline:
            baseline = dict(baselineId=uid('baseline'), reviewId=review['reviewId'], evidenceId=current_id,
                caseId=current.caseId, caseRevision=current.caseRevision, profile=profile.model_dump(),
                observedEnvironment=observed, buildId=current.buildId, workspaceEpoch=current.workspaceEpoch)
            review['adoptedBaselineId'] = baseline['baselineId']
            data.setdefault('visualBaselines', []).append(baseline)
        data.setdefault('visualReviews', []).append(review)
        return self.save(data)

    def report(self, base, run_id):
        data = self.read(base)
        run = self.find_run(data, run_id)
        if run.get('executionMode') == 'automated' and run['state'] in ('preparing', 'running'):
            raise HTTPException(409, '自动运行尚未结束，不能冻结报告')
        report = GameTestReport.model_validate_json(json.dumps(dict(reportId=uid('report'), revision=1,
            plan=run['plan'], attempts=run['attempts'], evidence=run['evidence'])))
        for evidence in report.evidence:
            path = self.workspace.path(evidence.relativePath)
            if not path.is_file() or path.stat().st_size != evidence.sizeBytes or digest(path.read_bytes()) != evidence.contentHash:
                raise HTTPException(409, '证据文件缺失或损坏，不能生成报告')
        record = report.model_dump(mode='json')
        record['observedEnvironment'] = run.get('observedEnvironment')
        record['observedEnvironments'] = run.get('observedEnvironments', [])
        record['summary'] = report.summary()
        record['issues'] = data.get('issues', [])
        record['deliveryApproved'] = False
        record['limitations'] = ['尚未完成资产使用、视觉审批和正式交付检查']
        if run.get('executionMode', 'manual') == 'manual':
            record['limitations'].append('人工观察记录，不能作为自动执行结果')
        if run['buildVerification'] == 'external_unverified':
            record['limitations'].append('外部构建未核验')
        if report.plan.workspaceEpoch != self.workspace.state()['workspaceEpoch']:
            record['limitations'].append('历史 epoch，结果不适用于当前工作区')
        if len(data['reports']) >= 100:
            raise HTTPException(413, '报告达到 100 条')
        data['reports'].append(record)
        if run['state'] == 'running':
            run['state'] = 'completed'
        self.save(data)
        return record

    def create_issue(self, base, run_id, case_id, profile_id, attempt_number, title, severity, expected, actual, steps):
        data = self.read(base)
        run = self.find_run(data, run_id)
        attempt = next((a for a in run['attempts'] if a['caseId'] == case_id
                        and a['profileId'] == profile_id and a['attempt'] == attempt_number), None)
        if attempt is None or attempt['result'] != 'failed':
            raise HTTPException(422, '从失败用例登记问题必须引用确切失败 attempt')
        issues = data.setdefault('issues', [])
        if len(issues) >= 200:
            raise HTTPException(413, '问题达到 200 条')
        issue = dict(issueId=uid('issue'), revision=1, title=title, severity=severity, state='open',
                     expected=expected, actual=actual, steps=steps,
                     occurrences=[dict(testRunId=run_id, caseId=case_id, profileId=profile_id,
                                       caseRevision=attempt['caseRevision'], attempt=attempt_number,
                                       buildId=run['plan']['buildId'], evidenceIds=attempt['evidenceIds'])],
                     history=[], regression=None)
        issues.append(issue)
        return self.save(data)

    def update_issue(self, base, issue_id, issue_revision, target, regression_run_id=None):
        data = self.read(base)
        issue = next((i for i in data.get('issues', []) if i['issueId'] == issue_id), None)
        if issue is None:
            raise HTTPException(404, '问题不存在')
        if issue['revision'] != issue_revision:
            raise HTTPException(409, '问题修订已变化')
        transitions = dict(open={'triaged'}, triaged={'in_progress'}, in_progress={'ready_for_retest'},
                           ready_for_retest={'in_progress', 'closed'}, closed={'open'})
        if target not in transitions.get(issue['state'], set()):
            raise HTTPException(409, '非法问题状态转换')
        if target == 'closed':
            run = self.find_run(data, regression_run_id)
            if run['plan']['workspaceEpoch'] != self.workspace.state()['workspaceEpoch']:
                raise HTTPException(409, '回归证据已过期')
            WebBuilds(self.workspace.repository, self.project).artifact(run['plan']['buildId'])
            for occurrence in issue['occurrences']:
                if run['plan']['buildId'] == occurrence['buildId']:
                    raise HTTPException(409, '修复关闭必须使用新构建回归')
                history = [a for a in run['attempts'] if a['caseId'] == occurrence['caseId']
                           and a['profileId'] == occurrence['profileId']]
                if not history or max(history, key=lambda a: a['attempt'])['result'] != 'passed':
                    raise HTTPException(409, '缺少对应场景通过的回归结果')
                latest = max(history, key=lambda a: a['attempt'])
                if latest['caseRevision'] != occurrence['caseRevision']:
                    raise HTTPException(409, '回归用例版本改变，需明确审阅映射后才能关闭')
                for evidence_id in latest['evidenceIds']:
                    evidence = next(e for e in run['evidence'] if e['evidenceId'] == evidence_id)
                    path = self.workspace.path(evidence['relativePath'])
                    if not path.is_file() or digest(path.read_bytes()) != evidence['contentHash']:
                        raise HTTPException(409, '回归证据缺失或损坏')
            issue['regression'] = dict(testRunId=regression_run_id, buildId=run['plan']['buildId'])
        issue['history'].append(dict(fromState=issue['state'], toState=target, revision=issue['revision']))
        issue['state'] = target
        issue['revision'] += 1
        return self.save(data)
