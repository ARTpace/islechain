"""游戏测试合同；此模块自身不启动游戏或读写项目，持久化与执行由服务层负责。"""
from typing import Literal

from pydantic import AwareDatetime, Field, field_validator, model_validator

from core.game_project_models import Contract, Digest, Identifier, Text, Title, relative_path

ExecutionState = Literal['queued', 'preparing', 'running', 'completed', 'cancelled', 'interrupted']
Result = Literal['passed', 'failed', 'blocked', 'not_run']
ExecutionMode = Literal['automated', 'agent', 'manual']
Capability = Literal['keyboard', 'mouse', 'touch', 'viewport', 'screenshot', 'dom', 'bridge']


class EnvironmentProfile(Contract):
    profileId: Identifier
    browser: Title
    platform: Title
    viewportWidth: int = Field(ge=1, le=16384)
    viewportHeight: int = Field(ge=1, le=16384)
    devicePixelRatio: float = Field(gt=0, le=8, allow_inf_nan=False)
    deviceMode: Literal['desktop', 'simulated', 'real_device']
    capabilities: list[Capability] = Field(max_length=7)

    @model_validator(mode='after')
    def unique_capabilities(self):
        if len(self.capabilities) != len(set(self.capabilities)):
            raise ValueError('能力重复')
        return self

# ponytail: 合同不直接持有执行器；状态、会话和文件证据分别由服务层校验。
TRANSITIONS = {
    'queued': {'preparing', 'cancelled', 'interrupted'},
    'preparing': {'running', 'cancelled', 'interrupted'},
    'running': {'completed', 'cancelled', 'interrupted'},
    'completed': set(), 'cancelled': set(), 'interrupted': set(),
}


def validate_transition(current: ExecutionState, target: ExecutionState) -> None:
    if target not in TRANSITIONS.get(current, set()):
        raise ValueError('非法测试执行状态转换')


class Requirement(Contract):
    requirementId: Identifier
    text: Text


class RequirementSet(Contract):
    """独立候选需求映射；显式采用前不替换 Plan.acceptanceCriteria。"""
    schemaVersion: Literal[1] = 1
    projectId: Identifier
    planRevision: int = Field(ge=1)
    requirements: list[Requirement] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def unique_requirements(self):
        ids = [r.requirementId for r in self.requirements]
        if len(ids) != len(set(ids)):
            raise ValueError('需求 ID 重复')
        return self


class TestAction(Contract):
    type: Literal['keydown', 'keyup', 'press', 'click', 'wait', 'viewport']
    key: Title | None = None
    selector: Title | None = None
    milliseconds: int | None = Field(default=None, ge=0, le=3000)
    width: int | None = Field(default=None, ge=320, le=2560)
    height: int | None = Field(default=None, ge=240, le=1440)

    @model_validator(mode='after')
    def required_arguments(self):
        if self.type in ('keydown', 'keyup', 'press') and self.key is None:
            raise ValueError('按键动作需要 key')
        if self.type == 'click' and self.selector is None:
            raise ValueError('点击动作需要 selector')
        if self.type == 'wait' and self.milliseconds is None:
            raise ValueError('等待动作需要 milliseconds')
        if self.type == 'viewport' and (self.width is None or self.height is None):
            raise ValueError('视口动作需要 width/height')
        return self


class DOMExpectation(Contract):
    selector: Title
    comparison: Literal['contains', 'exact', 'visible']
    expected: Text | None = None
    timeoutMs: int = Field(default=3000, ge=100, le=3000)

    @model_validator(mode='after')
    def text_required(self):
        if self.comparison != 'visible' and self.expected is None:
            raise ValueError('文本断言需要预期文本')
        return self


class GameTestCase(Contract):
    caseId: Identifier
    revision: int = Field(ge=1)
    title: Title
    category: Literal['startup', 'gameplay', 'assets', 'data', 'save', 'device', 'delivery', 'visual'] = 'gameplay'
    requirementIds: list[Identifier] = Field(min_length=1, max_length=100)
    required: bool = True
    executionMode: ExecutionMode
    requiredCapabilities: list[Capability] = Field(default_factory=list, max_length=7)
    preconditions: list[Text] = Field(default_factory=list, max_length=100)
    steps: list[Text] = Field(min_length=1, max_length=100)
    expectations: list[Text] = Field(min_length=1, max_length=100)
    actions: list[TestAction] = Field(default_factory=list, max_length=20)
    domExpectations: list[DOMExpectation] = Field(default_factory=list, max_length=20)
    runtimeErrorsFail: bool = True
    measureFrameIntervals: bool = False

    @model_validator(mode='after')
    def unique_references(self):
        if len(set(self.requirementIds)) != len(self.requirementIds):
            raise ValueError('需求引用重复')
        if len(set(self.requiredCapabilities)) != len(self.requiredCapabilities):
            raise ValueError('能力引用重复')
        if self.executionMode == 'automated':
            if not self.actions or not self.domExpectations:
                raise ValueError('自动用例必须提供结构化真实输入和 DOM 断言')
            if self.preconditions:
                raise ValueError('自动用例前置条件须转为显式动作，不执行自然语言条件')
            if sum(a.milliseconds or 0 for a in self.actions) > 10000:
                raise ValueError('单批显式等待总量超过 10 秒')
        return self


class GameTestPlan(Contract):
    """计划输入快照；存储层按修订追加，执行始终绑定保存的输入。"""
    schemaVersion: Literal[1] = 1
    planId: Identifier
    revision: int = Field(ge=1)
    owner: Title
    projectId: Identifier
    buildId: Identifier
    inputManifestHash: Digest
    workspaceEpoch: int = Field(ge=0)
    requirements: RequirementSet
    cases: list[GameTestCase] = Field(min_length=1, max_length=100)
    environments: list[EnvironmentProfile] = Field(min_length=1, max_length=16)

    @model_validator(mode='after')
    def valid_references(self):
        if self.requirements.projectId != self.projectId:
            raise ValueError('需求不属于当前项目')
        ids = [c.caseId for c in self.cases]
        if len(ids) != len(set(ids)):
            raise ValueError('用例 ID 重复')
        profiles = [e.profileId for e in self.environments]
        if len(profiles) != len(set(profiles)):
            raise ValueError('环境 ID 重复')
        requirements = {r.requirementId for r in self.requirements.requirements}
        if any(set(c.requirementIds) - requirements for c in self.cases):
            raise ValueError('用例引用了不存在的需求')
        return self


class GameTestAttempt(Contract):
    testRunId: Identifier
    runId: Identifier
    sessionId: Identifier
    plan: GameTestPlan
    caseId: Identifier
    caseRevision: int = Field(ge=1)
    profileId: Identifier
    attempt: int = Field(ge=1)
    state: ExecutionState = 'queued'
    result: Result = 'not_run'
    source: ExecutionMode
    reason: Text | None = None
    evidenceIds: list[Identifier] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def valid_result(self):
        case = next((c for c in self.plan.cases if c.caseId == self.caseId), None)
        if case is None or case.revision != self.caseRevision:
            raise ValueError('用例版本与计划不匹配')
        if self.source != case.executionMode:
            raise ValueError('结果来源与计划不匹配')
        environment = next((e for e in self.plan.environments if e.profileId == self.profileId), None)
        if environment is None:
            raise ValueError('环境不属于计划')
        if self.result in ('passed', 'failed') and set(case.requiredCapabilities) - set(environment.capabilities):
            raise ValueError('环境缺少所需能力，不能判定游戏结果')
        if len(set(self.evidenceIds)) != len(self.evidenceIds):
            raise ValueError('证据引用重复')
        if self.result in ('passed', 'failed'):
            if self.state != 'completed' or not self.evidenceIds:
                raise ValueError('通过或失败需要完成执行并引用证据')
        if self.result == 'blocked' and not self.reason:
            raise ValueError('阻塞需要原因')
        if self.state == 'completed' and self.result == 'not_run':
            raise ValueError('未执行不能标记完成')
        if self.state in ('queued', 'preparing', 'running') and self.result != 'not_run':
            raise ValueError('在途执行不能写入最终结论')
        if self.state in ('cancelled', 'interrupted') and not self.reason:
            raise ValueError('取消或中断需要原因')
        return self


class GameTestEvidence(Contract):
    """证据索引；hash、大小与实际文件一致性由存储层负责。"""
    evidenceId: Identifier
    projectId: Identifier
    owner: Title
    buildId: Identifier
    inputManifestHash: Digest
    workspaceEpoch: int = Field(ge=0)
    testRunId: Identifier
    runId: Identifier
    sessionId: Identifier
    caseId: Identifier
    caseRevision: int = Field(ge=1)
    profileId: Identifier
    attempt: int = Field(ge=1)
    capturedAt: AwareDatetime
    kind: Literal['screenshot', 'log', 'observation']
    source: ExecutionMode
    relativePath: str
    contentHash: Digest
    sizeBytes: int = Field(ge=1, le=10 * 1024 * 1024)

    _path = field_validator('relativePath')(relative_path)

    @model_validator(mode='after')
    def run_path(self):
        if not self.relativePath.startswith(f'runs/{self.runId}/'):
            raise ValueError('证据必须位于所属底层运行目录')
        return self


class GameTestReport(Contract):
    """测试结果草稿；不代表文件完整性验证或最终游戏交付审批。"""
    schemaVersion: Literal[1] = 1
    reportId: Identifier
    revision: int = Field(ge=1)
    plan: GameTestPlan
    attempts: list[GameTestAttempt] = Field(default_factory=list, max_length=10000)
    evidence: list[GameTestEvidence] = Field(default_factory=list, max_length=10000)

    @model_validator(mode='after')
    def matching_inputs(self):
        evidence = {e.evidenceId: e for e in self.evidence}
        if len(evidence) != len(self.evidence):
            raise ValueError('证据 ID 重复')
        keys = set()
        used = set()
        for attempt in self.attempts:
            if attempt.plan != self.plan:
                raise ValueError('执行输入与报告计划不匹配')
            key = (attempt.caseId, attempt.profileId, attempt.attempt)
            if key in keys:
                raise ValueError('同一用例环境的 attempt 重复')
            keys.add(key)
            for evidence_id in attempt.evidenceIds:
                item = evidence.get(evidence_id)
                if item is None:
                    raise ValueError('缺少证据索引')
                expected = dict(projectId=self.plan.projectId, owner=self.plan.owner,
                                buildId=self.plan.buildId, inputManifestHash=self.plan.inputManifestHash,
                                workspaceEpoch=self.plan.workspaceEpoch)
                expected.update({field: getattr(attempt, field) for field in (
                    'testRunId', 'runId', 'sessionId', 'caseId', 'caseRevision', 'profileId', 'attempt')})
                expected['source'] = attempt.source
                if any(getattr(item, field) != value for field, value in expected.items()):
                    raise ValueError('证据归属、来源或版本不匹配')
                used.add(evidence_id)
        if used != set(evidence):
            raise ValueError('报告含未关联证据')
        return self

    def summary(self) -> dict:
        """以全计划用例×环境为分母；显式保留历史失败与不稳定项。"""
        counts = dict(passed=0, failed=0, blocked=0, not_run=0)
        required_passed = True
        flaky = []
        for case in self.plan.cases:
            for environment in self.plan.environments:
                history = sorted((a for a in self.attempts if a.caseId == case.caseId
                                  and a.profileId == environment.profileId), key=lambda a: a.attempt)
                result = history[-1].result if history else 'not_run'
                counts[result] += 1
                unstable = {'passed', 'failed'} <= {a.result for a in history}
                if unstable:
                    flaky.append(dict(caseId=case.caseId, profileId=environment.profileId))
                if case.required and (result != 'passed' or unstable):
                    required_passed = False
        return dict(total=sum(counts.values()), counts=counts, flaky=flaky,
                    requiredCasesPassed=required_passed)
