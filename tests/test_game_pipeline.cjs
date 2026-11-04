/* 执行现有画布函数，验证复制语义、真实提交参数与来源修订冻结。 */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('static/js/canvas.js', 'utf8');
function extract(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length)); }
let sequence = 0, notices = 0, submitted, registered = 0;
const context = vm.createContext({
    JSON, Map, Set, Math, Date, Boolean, String, Number,
    canvas: {id: 'canvas', logs: []}, nodes: [], connections: [], selected: new Set(),
    clipboard: null, lastMouseBoard: {x: 200, y: 200},
    window: {GamePipeline: {projectId: 'project_1',
        snapshot: node => node.gameBinding ? ({projectId: node.projectId, assetId: node.assetId,
            assetRevision: node.gameAssetRevision, sourceNodeId: node.id}) : undefined,
        result: () => registered++}},
    uid: prefix => `${prefix}_${++sequence}`,
    alert: () => notices++, pushUndo() {}, render() {}, scheduleSave() {}, sanitizeConnections() {}, syncGeneratorInputs() {},
    cascadeTargetIdFromOptions: () => '', orderedSources: (node, sources) => sources,
    generatorSources: () => [{prompt: '实际生成提示词', refs: [{url: '/assets/reference.png', name: '参考'}]}],
    imageRefsOnly: refs => refs, outputForNode: () => null,
    resolveImageProviderId: () => 'actual-provider', resolveImageModel: () => 'actual-model',
    generatorSizeForRun: async () => '256x256', normalizedImageQuality: () => 'high',
    CANVAS_REFERENCE_IMAGE_MAX: 20, nowMs: () => 123, setTimeout() {}, refreshRunNodes() {},
    createCanvasImageTask: async payload => { submitted = payload; return {task_id: 'task_1'}; },
    waitCanvasImageTaskResult: async () => {
        context.nodes[0].gameAssetRevision = 2;
        return {images: ['/output/alice/result.png'], task_id: 'task_1'};
    },
    requestMetaFromResult: result => ({task_id: result.task_id}),
    mergeGeneratedOutputs: (node, outputs) => { node.generatedOutputs = outputs; },
    outputUrlValue: value => typeof value === 'string' ? value : value.url,
    playGenerationCompleteSound() {},
    runPlatformLabel: () => 'test', runTaskLabel: run => run.node.model,
});
for (const [start, end] of [
    ['function serializableCanvasNode(', 'function serializableCanvasNodes('],
    ['function cloneNode(', 'function duplicateNodesForAltDrag('],
    ['function pasteNodes(', 'function selectedWorkflowPayload('],
    ['function runSnapshot(', 'function comfyRunLabel('],
    ['function addGenerationLog(', 'function renderCanvasLog('],
    ['async function runGenerator(', 'async function runGeneratorLegacy('],
]) vm.runInContext(extract(start, end), context);

const generator = {id: 'gen', type: 'generator', x: 0, y: 0, projectId: 'project_1', assetId: 'asset_1',
    gameBinding: true, gameAssetRevision: 1, gameReference: 'reference_1', model: 'alias', apiProvider: 'alias', count: 1};
const copy = context.cloneNode(generator, 30, 40);
for (const key of ['projectId', 'assetId', 'gameBinding', 'gameAssetRevision', 'gameReference']) assert.equal(copy[key], undefined);
const document = {id: 'doc_node', type: 'document', projectId: 'project_1', docId: 'doc_1', x: 0, y: 0};
assert.equal(context.cloneNode(document, 0, 0).docId, 'doc_1');
context.clipboard = {nodes: [{...document, projectId: 'foreign'}], connections: []};
context.pasteNodes();
assert.equal(notices, 1);
assert.equal(context.nodes.length, 0);
context.clipboard.nodes = [document];
context.pasteNodes();
assert.equal(context.nodes.length, 1);
assert.equal(context.nodes[0].docId, 'doc_1');
assert.notEqual(context.nodes[0].id, document.id);

(async () => {
    context.nodes = [generator];
    await context.runGenerator(generator.id);
    assert.equal(submitted.model, 'actual-model');
    assert.equal(context.canvas.logs.length, 1);
    const log = context.canvas.logs[0];
    assert.equal(log.gameProject.assetRevision, 1, '来源修订须在提交时冻结');
    assert.equal(log.gameProject.parameters.model, 'actual-model');
    assert.equal(log.gameProject.parameters.provider, 'actual-provider');
    assert.equal(log.gameProject.parameters.quality, 'high');
    assert.equal(log.gameProject.parameters.size, '256x256');
    assert.equal(log.gameProject.parameters.references[0], '/assets/reference.png');
    assert.equal(registered, 1);
    context.addGenerationLog({run: {gameProject: log.gameProject, node: generator}, error: '上游失败'});
    assert.equal(registered, 1, '失败不能登记成功候选');
    assert.equal(context.canvas.logs[1].gameProject.assetRevision, 1);
    console.log('Game pipeline: clone, cross-project paste, actual generation snapshot and failed-result protection passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
