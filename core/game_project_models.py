"""首期游戏项目契约；纯校验，不读取用户文件或调用生成服务。"""
import re
from pathlib import PurePosixPath
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

Identifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,80}$")]
Text = Annotated[str, StringConstraints(min_length=1, max_length=20000)]
Title = Annotated[str, StringConstraints(min_length=1, max_length=200)]
Digest = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]


def relative_path(value: str) -> str:
    """跨平台采用 Windows 文件名约束；调用方落盘仍须校验解析后的根边界。"""
    if not value or len(value) > 240 or value.startswith('/') or '\\' in value:
        raise ValueError('需要安全相对路径')
    for part in value.split('/'):
        if (not part or part in ('.', '..') or part.endswith((' ', '.'))
                or re.search(r'[<>:"|?*\x00-\x1f]', part)
                or re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])', part.split('.')[0], re.I)):
            raise ValueError('不安全的路径分量')
    return value


class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class VisualDirection(Contract):
    description: Text
    palette: list[Title] = Field(default_factory=list, max_length=32)
    referenceAssetIds: list[Identifier] = Field(default_factory=list, max_length=100)


class PlanEntity(Contract):
    id: Identifier
    description: Text
    assetIds: list[Identifier] = Field(default_factory=list, max_length=100)


class Plan(Contract):
    schemaVersion: Literal[1] = 1
    revision: int = Field(ge=1)
    title: Title
    playerFantasy: Text
    coreLoop: Text
    controls: Text
    progression: Text
    successFailureRestart: Text
    firstPlayable: Text
    visualDirection: VisualDirection
    characters: list[PlanEntity] = Field(default_factory=list, max_length=100)
    scenes: list[PlanEntity] = Field(default_factory=list, max_length=100)
    openQuestions: list[Text] = Field(default_factory=list, max_length=100)
    assumptions: list[Text] = Field(default_factory=list, max_length=100)
    acceptanceCriteria: list[Text] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def unique_entities(self):
        ids = [item.id for item in self.characters + self.scenes]
        if len(set(ids)) != len(ids):
            raise ValueError('角色与场景 ID 必须唯一')
        return self


class ImageSpec(Contract):
    width: int = Field(ge=1, le=8192)
    height: int = Field(ge=1, le=8192)
    format: Literal['png', 'jpeg', 'webp']
    alphaRequired: bool = False

    @model_validator(mode='after')
    def alpha_format(self):
        if self.alphaRequired and self.format == 'jpeg':
            raise ValueError('JPEG 不支持 alpha')
        return self


class Selection(Contract):
    selectionId: Identifier
    relativePath: str
    sourceNodeId: Identifier
    sourceOutputId: Identifier
    contentHash: Digest
    sourceAssetRevision: int = Field(ge=1)

    _path = field_validator('relativePath')(relative_path)


class Review(Contract):
    status: Literal['pending', 'passed', 'failed'] = 'pending'
    issues: list[Text] = Field(default_factory=list, max_length=100)
    humanConfirmed: bool = False
    assetRevision: int = Field(default=0, ge=0)
    selectionId: Identifier | None = None
    imageInfo: dict = Field(default_factory=dict)


class Asset(Contract):
    id: Identifier
    revision: int = Field(ge=1)
    name: Title
    purpose: Text
    usage: Literal['concept', 'runtime']
    required: bool
    kind: Literal['image'] = 'image'
    spec: ImageSpec
    prompt: Text
    referenceAssetIds: list[Identifier] = Field(default_factory=list, max_length=100)
    visualOverride: VisualDirection | None = None
    runtimeDestination: str
    generatorNodeId: Identifier | None = None
    promptNodeId: Identifier | None = None
    generatorNodeHistory: list[Identifier] = Field(default_factory=list, max_length=100)
    selected: Selection | None = None
    review: Review = Field(default_factory=Review)
    needsUpdate: bool = False

    _path = field_validator('runtimeDestination')(relative_path)

    @model_validator(mode='after')
    def valid_paths(self):
        suffix = PurePosixPath(self.runtimeDestination).suffix.lower()
        if suffix not in {'png': ('.png',), 'jpeg': ('.jpg', '.jpeg'), 'webp': ('.webp',)}[self.spec.format]:
            raise ValueError('目标扩展名与规格格式不一致')
        root = self.runtimeDestination.split('/')[0]
        if root != ('references' if self.usage == 'concept' else 'assets'):
            raise ValueError('概念图使用 references/，运行时资源使用 assets/')
        if self.selected:
            expected = f'assets/{self.id}/{self.selected.selectionId}.'
            if not self.selected.relativePath.startswith(expected) or '/' in self.selected.relativePath[len(expected):]:
                raise ValueError('选用文件必须位于当前资产版本目录')
            if self.selected.sourceAssetRevision > self.revision:
                raise ValueError('选用来源修订不能超前')
        return self


class Document(Contract):
    id: Identifier
    title: Title
    revision: int = Field(ge=1)
    contentHash: Digest
    lastSavedContent: str = Field(max_length=1048576)

    @model_validator(mode='after')
    def valid_content(self):
        import hashlib
        raw = self.lastSavedContent.encode('utf-8')
        if len(raw) > 1048576:
            raise ValueError('正文超过 1 MiB UTF-8')
        if hashlib.sha256(raw).hexdigest() != self.contentHash:
            raise ValueError('正文与索引 hash 不一致，需要恢复')
        return self


class TableColumn(Contract):
    id: Identifier
    title: Title
    type: Literal['text', 'number', 'boolean'] = 'text'


class TableRow(Contract):
    id: Identifier
    cells: dict[str, str | int | float | bool | None] = Field(default_factory=dict, max_length=100)


class PlanningTable(Contract):
    id: Identifier
    title: Title
    revision: int = Field(default=1, ge=1)
    columns: list[TableColumn] = Field(min_length=1, max_length=100)
    rows: list[TableRow] = Field(default_factory=list, max_length=1000)

    @model_validator(mode='after')
    def valid_cells(self):
        import math
        columns = {c.id: c.type for c in self.columns}
        if len(columns) != len(self.columns) or len({r.id for r in self.rows}) != len(self.rows):
            raise ValueError('行列 ID 必须唯一')
        for row in self.rows:
            for key, value in row.cells.items():
                if key not in columns:
                    raise ValueError('单元格引用了不存在的列')
                if value is None:
                    continue
                kind = columns[key]
                if ((kind == 'text' and (not isinstance(value, str) or len(value) > 10000))
                        or (kind == 'boolean' and type(value) is not bool)
                        or (kind == 'number' and (type(value) not in (int, float) or (type(value) is float and not math.isfinite(value))))):
                    raise ValueError('单元格与列类型不匹配或内容超限')
        return self


class RuntimeAsset(Contract):
    id: Identifier
    name: Title
    kind: Literal['image', 'audio', 'model']
    purpose: Text
    enabled: bool = True
    revision: int = Field(default=1, ge=1)
    relativePath: str
    contentHash: Digest
    mime: Literal['image/png','image/jpeg','image/webp','audio/mpeg','audio/wav','audio/ogg','model/gltf-binary']
    sizeBytes: int = Field(ge=1, le=100 * 1024 * 1024)
    metadata: dict = Field(default_factory=dict)
    sourceNodeId: str = Field(default='upload', max_length=180)
    _path = field_validator('relativePath')(relative_path)

    @model_validator(mode='after')
    def own_file(self):
        if self.kind != 'model' and self.sizeBytes > 32 * 1024 * 1024:
            raise ValueError('图片/音频最大 32 MiB')
        if not self.relativePath.startswith('assets/' + self.id + '/'):
            raise ValueError('资产文件必须保存在自身目录')
        if self.kind != ('model' if self.mime.startswith('model/') else self.mime.split('/')[0]):
            raise ValueError('资产类型与 MIME 不匹配')
        return self


class ProjectFile(Contract):
    id: Identifier
    path: str = Field(min_length=1,max_length=240)
    relativePath: str
    contentHash: Digest
    sizeBytes: int = Field(ge=0,le=32*1024*1024)
    documentId: Identifier | None = None

    @model_validator(mode='after')
    def valid_path(self):
        relative_path(self.path)
        relative_path(self.relativePath)
        if not self.relativePath.startswith('assets/files/'+self.id+'/'):
            raise ValueError('文件须保存在自身项目目录')
        return self

class PlayableScene(Contract):
    id: Identifier
    title: Title
    source: str = Field(max_length=200000)
    signals: list[Identifier] = Field(default_factory=lambda:['next'],max_length=20)

class PlayableEdge(Contract):
    source: Identifier
    signal: Identifier
    target: Identifier

class PlayableGraph(Contract):
    version: Literal[1] = 1
    entryNodeId: Identifier
    initialState: dict = Field(default_factory=dict)
    nodes: list[PlayableScene] = Field(min_length=1,max_length=50)
    edges: list[PlayableEdge] = Field(default_factory=list,max_length=200)

    @model_validator(mode='after')
    def valid_graph(self):
        import json
        ids={n.id for n in self.nodes}
        if len(ids)!=len(self.nodes) or self.entryNodeId not in ids:raise ValueError('场景ID重复或入口不存在')
        keys=set()
        for edge in self.edges:
            key=(edge.source,edge.signal)
            if edge.source not in ids or edge.target not in ids or edge.signal not in next(n.signals for n in self.nodes if n.id==edge.source) or key in keys:
                raise ValueError('场景出口重复或引用无效')
            keys.add(key)
        if len(json.dumps(self.initialState,allow_nan=False).encode())>32768:raise ValueError('共享状态超过32KiB')
        if sum(len(n.source.encode()) for n in self.nodes)>1048576:raise ValueError('场景代码总量超过1MiB')
        return self


class Project(Contract):
    schemaVersion: Literal[1] = 1
    id: Identifier
    owner: Title
    canvasId: Identifier
    revision: int = Field(ge=1)
    title: Title
    archived: bool = False
    documents: list[Document] = Field(default_factory=list, max_length=100)
    tables: list[PlanningTable] = Field(default_factory=list, max_length=100)
    plan: Plan | None = None
    planConfirmed: bool = False
    assets: list[Asset] = Field(default_factory=list, max_length=200)
    projectFiles: list[ProjectFile] = Field(default_factory=list,max_length=200)
    playableGraph: PlayableGraph | None = None
    mediaAssets: list[RuntimeAsset] = Field(default_factory=list, max_length=200)
    planSourceHashes: dict[str, Digest] = Field(default_factory=dict)
    planSourceChanged: bool = False
    artConfirmed: bool = False
    candidates: list['Candidate'] = Field(default_factory=list, max_length=200)
    outputs: list['ImageCandidate'] = Field(default_factory=list, max_length=2000)

    @model_validator(mode='after')
    def valid_references(self):
        for items in (self.documents, self.tables, self.assets):
            ids = [item.id for item in items]
            if len(set(ids)) != len(ids):
                raise ValueError('ID 重复')
        if len({f.id for f in self.projectFiles})!=len(self.projectFiles) or len({f.path.casefold() for f in self.projectFiles})!=len(self.projectFiles):
            raise ValueError('文件ID或路径重复')
        if any(f.documentId and not any(d.id==f.documentId for d in self.documents) for f in self.projectFiles):
            raise ValueError('文件文档引用无效')
        assets = {item.id: item for item in self.assets}
        all_ids = [a.id for a in self.assets] + [a.id for a in self.mediaAssets]
        if len(all_ids) != len(set(all_ids)):
            raise ValueError('资产 ID 重复')
        paths = [item.runtimeDestination.casefold() for item in self.assets]
        if len(paths) != len(set(paths)):
            raise ValueError('导出路径冲突')
        nodes = [item.generatorNodeId for item in self.assets if item.generatorNodeId]
        if len(nodes) != len(set(nodes)):
            raise ValueError('生成节点不能绑定多个资产')
        if self.planConfirmed and self.plan is None:
            raise ValueError('无策划不能确认')
        refs = []
        if self.plan:
            refs.extend(self.plan.visualDirection.referenceAssetIds)
            for entity in self.plan.characters + self.plan.scenes:
                refs.extend(entity.assetIds)
        graph = {}
        for asset in self.assets:
            dependencies = list(asset.referenceAssetIds)
            if asset.visualOverride:
                dependencies += asset.visualOverride.referenceAssetIds
            elif self.plan:
                # ponytail: 共享参考自身不产生自引用，其他隐式依赖参与循环检查。
                dependencies += [ref for ref in self.plan.visualDirection.referenceAssetIds if ref != asset.id]
            graph[asset.id] = dependencies
            if len(set(dependencies)) > 20:
                raise ValueError('单项有效参考图最多 20 项，与画布输入上限保持一致')
            refs.extend(dependencies)
        if any(ref not in assets for ref in refs):
            raise ValueError('引用了不存在或其他项目的资产')
        visited, active = set(), set()

        def visit(asset_id):
            if asset_id in active:
                raise ValueError('资产参考存在循环')
            if asset_id in visited:
                return
            active.add(asset_id)
            for ref in graph[asset_id]:
                visit(ref)
            active.remove(asset_id)
            visited.add(asset_id)

        for asset_id in graph:
            visit(asset_id)
        return self


class RevisionWrite(Contract):
    baseRevision: int = Field(ge=1)


class Candidate(Contract):
    id: Identifier
    kind: Literal['plan', 'assets']
    presetId: Identifier = 'default'
    presetVersion: int = Field(default=1, ge=1)
    sourceRevision: int = Field(ge=1)
    sourceHashes: dict[str, Digest]
    status: Literal['valid', 'invalid', 'failed']
    raw: str = Field(max_length=200000)
    rawAttempts: list[str] = Field(default_factory=list, max_length=2)
    diagnostics: list[Text] = Field(default_factory=list, max_length=20)
    # ponytail: 候选不是正式数据；采用时仍按 Plan/Asset 完整校验。
    data: dict | list | None = None


class GenerationParameters(Contract):
    prompt: str = Field(max_length=40000)
    model: str = Field(default='', max_length=200)
    provider: str = Field(default='', max_length=100)
    size: str = Field(default='', max_length=100)
    references: list[str] = Field(default_factory=list, max_length=32)
    quality: str = Field(default='', max_length=100)
    aspectRatio: str = Field(default='', max_length=100)
    resolution: str = Field(default='', max_length=100)


class ImageCandidate(Contract):
    id: Identifier
    assetId: Identifier
    sourceNodeId: Identifier
    sourceOutputId: Identifier
    sourceAssetRevision: int = Field(ge=1)
    sourceUrl: str = Field(max_length=2000)
    parameters: GenerationParameters


Project.model_rebuild()
