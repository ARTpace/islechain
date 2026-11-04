"""正式交付门槛与不可变本地包；人工审批由调用方显式提交。"""
import io
import json
import zipfile

from fastapi import HTTPException

from core.game_projects import atomic_write, digest, inspect_image, json_bytes, uid
from core.game_testing import TestingStore
from core.game_testing_models import GameTestReport
from core.game_web_builds import WebBuilds

REQUIRED_CATEGORIES = {'startup', 'gameplay', 'assets', 'data', 'save', 'device', 'delivery', 'visual'}


def release(repository, project, build_id, report_ids, gameplay, visual, licenses_confirmed, limitations):
    builds = WebBuilds(repository, project)
    workspace = builds.workspace
    build, page = builds.artifact(build_id)
    issues = []
    if not build.get('releaseCandidate') or build['developmentOnly']:
        issues.append('灰盒开发构建不能作为正式交付')
    if not (gameplay and visual and licenses_confirmed):
        issues.append('需要明确确认玩法、视觉与来源许可证')
    if project.revision != build['projectRevision']:
        issues.append('项目在构建后已变化，须重新构建及验证')
    current, files = workspace.current()
    if current['workspaceEpoch'] != build['workspaceEpoch'] or workspace.manifest(files) != build['files']:
        issues.append('工作区输入已变化，旧证据不能用于当前正式交付')
    workspace.validate_content(files)
    for asset in project.assets:
        if asset.required:
            try:
                raw = repository.selected_content(project, asset)
                _, failures = inspect_image(raw, asset.spec)
                if failures:
                    issues.append(asset.id + ' 规格检查失败')
            except HTTPException:
                issues.append(asset.id + ' 选用文件缺失或不完整')
    testing = TestingStore(repository, project).read()
    for issue in testing.get('issues', []):
        if issue['severity'] == 'blocker' and issue['state'] != 'closed':
            issues.append('存在未关闭阻断问题：' + issue['issueId'])
    reports = [r for r in testing['reports'] if r['reportId'] in report_ids]
    if len(set(report_ids)) != len(report_ids) or len(reports) != len(report_ids) or not reports:
        issues.append('报告引用缺失或重复')
    covered, categories, profiles = set(), set(), set()
    for record in reports:
        report = GameTestReport.model_validate_json(json.dumps({name:record[name] for name in GameTestReport.model_fields}))
        if (report.plan.buildId != build_id or report.plan.inputManifestHash != build['inputManifestHash']
                or report.plan.workspaceEpoch != build['workspaceEpoch']):
            issues.append('报告与交付构建版本不匹配')
        if report.plan.requirements.model_dump() != testing.get('requirements'):
            issues.append('报告需求版本不是当前采用版本')
        if not report.summary()['requiredCasesPassed']:
            issues.append('必需用例失败、阻塞、未测或不稳定')
        for case in report.plan.cases:
            for environment in report.plan.environments:
                history = [a for a in report.attempts if a.caseId == case.caseId and a.profileId == environment.profileId]
                latest = max(history, key=lambda a:a.attempt) if history else None
                if latest and latest.result == 'passed':
                    covered.update(case.requirementIds)
                    categories.add(case.category)
                    profiles.add(environment.profileId)
                elif not case.required and not limitations:
                    issues.append('可选项未通过时须明确已知限制')
        for evidence in report.evidence:
            path = workspace.path(evidence.relativePath)
            if not path.is_file() or path.stat().st_size != evidence.sizeBytes or digest(path.read_bytes()) != evidence.contentHash:
                issues.append('交付证据缺失或损坏：' + evidence.evidenceId)
    expected = {r['requirementId'] for r in (testing.get('requirements') or {}).get('requirements', [])}
    if not expected or covered != expected:
        issues.append('当前需求尚未全部形成通过覆盖')
    if REQUIRED_CATEGORIES - categories:
        issues.append('缺少验收类别：' + ', '.join(sorted(REQUIRED_CATEGORIES - categories)))
    if issues:
        raise HTTPException(409, dict(message='正式交付未通过，仍可导出开发版', issues=sorted(set(issues))))
    index_path = workspace.path('exports/releases/index.json')
    index = json.loads(index_path.read_bytes()) if index_path.exists() else []
    if len(index) >= 50:
        raise HTTPException(413, '正式交付记录达到 50 条，不自动清理历史')
    release_id = uid('release')
    metadata = dict(releaseId=release_id, buildId=build_id, inputManifestHash=build['inputManifestHash'],
        artifactHash=build['artifactHash'], reportIds=report_ids, verifiedEnvironmentProfiles=sorted(profiles),
        deliveryApproved=True, knownLimitations=limitations, unverified=build['unverified'], licenses=build['licenses'])
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('index.html', page)
        for name,(raw,_) in builds.resources(build).items():
            archive.writestr(name, raw)
        if any(a.get('kind')=='model' for a in build.get('mediaAssets', [])):
            from core.game_web_builds import TEMPLATE
            archive.writestr('THIRD_PARTY_NOTICES/three-LICENSE.txt',(TEMPLATE.parent/'game-web-3d/three-LICENSE.txt').read_bytes())
        archive.writestr('release.json', json_bytes(metadata))
        archive.writestr('test-reports.json', json_bytes(reports))
        included = set()
        for report in reports:
            for evidence in report['evidence']:
                path = evidence['relativePath']
                if path not in included:
                    archive.writestr(path, workspace.path(path).read_bytes())
                    included.add(path)
        archive.writestr('THIRD_PARTY_NOTICES.md', '\n\n'.join(f'{name}: {license}' for name,license in build['licenses'].items()))
        archive.writestr('README.md', '# Web 游戏交付包\n\n打开 index.html 试玩，或部署到独立静态来源。\n'
            '设备与环境以 release.json 中的验收记录为准，触屏与真实手机未验证。\n'
            '源码与项目备份需分别导出，个人存档不包含在包内。\n')
    raw = stream.getvalue()
    metadata['packageHash'] = digest(raw)
    atomic_write(workspace.path(f'exports/releases/{release_id}.zip'), raw)
    atomic_write(index_path, json_bytes(index + [metadata]))
    return metadata
