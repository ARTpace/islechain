const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('static/js/canvas.js', 'utf8');
const context = vm.createContext({
    nodes: [], connections: [], window: {}, tr: key => key, linkCreateState: null,
    CANVAS_GENERATOR_TYPES: ['generator', 'msgen', 'comfy', 'ltxDirector', 'video', 'rh', 'minimax'],
    CANVAS_MEDIA_OUTPUT_TYPES: ['generator', 'msgen', 'comfy', 'ltxDirector', 'video', 'rh', 'minimax'],
    wouldCreateGeneratorCycle: () => false, closeLinkCreateMenu() {}, pushUndo() {},
    syncLatestGeneratedOutputToConnection() {}, syncGeneratorInputs() {}, scheduleSave() {}, render() {},
    uid: (() => { let n = 0; return () => 'created_' + ++n; })(), alerts: [],
    alert: message => context.alerts.push(message),
});
function load(start, end) {
    const offset = source.indexOf(start);
    assert.ok(offset >= 0, start);
    vm.runInContext(source.slice(offset, source.indexOf(end, offset + start.length)), context);
}
load('function linkCreateOptions(', 'function openLinkCreateMenu(');
load('function canConnect(', 'function sanitizeConnections(');
load('async function createLinkedNode(', 'function createNodeByType(');
const types = node => {
    context.nodes = [node];
    return Array.from(context.linkCreateOptions({originId: node.id, originKind: 'in'}), option => option.type);
};
assert.deepEqual(types({id: 'plan', type: 'gamePlan', projectId: 'p'}), ['image', 'gameIdea', 'document', 'gameTable']);
assert.deepEqual(types({id: 'assets', type: 'gameAssets', projectId: 'p'}), ['gamePlan']);
assert.deepEqual(types({id: 'doc', type: 'document', projectId: 'p'}), ['image']);
assert.deepEqual(types({id: 'table', type: 'gameTable', projectId: 'p'}), ['image']);
assert.deepEqual(types({id: 'loop', type: 'loop', imageInput: true, showPrompt: false}), ['image', 'group', 'output']);
assert.deepEqual(types({id: 'loop', type: 'loop', imageInput: false, showPrompt: true}), ['prompt', 'loop', 'llm']);
assert.deepEqual(types({id: 'loop', type: 'loop'}), []);
assert.deepEqual(types({id: 'output', type: 'output'}).sort(), Array.from(context.CANVAS_GENERATOR_TYPES).sort());
assert.ok(types({id: 'generator', type: 'generator'}).includes('prompt'));
assert.ok(!types({id: 'generator', type: 'generator'}).includes('gamePlan'));

(async () => {
    const plan = {id: 'plan', type: 'gamePlan', projectId: 'p'};
    context.nodes = [plan]; context.connections = [];
    context.linkCreateState = {originId: plan.id, originKind: 'in', point: {x: 12, y: 34}};
    context.createNodeByType = async (type, point) => {
        await Promise.resolve();
        const node = {id: 'doc', type, projectId: 'p', ...point}; context.nodes.push(node); return node;
    };
    await context.createLinkedNode('document');
    assert.equal(context.connections[0].from, 'doc');
    assert.equal(context.connections[0].to, plan.id, '输入端新建节点连接到原节点');
    const before = context.nodes.length;
    await context.createLinkedNode('generator');
    assert.equal(context.nodes.length, before, '不创建不兼容的上游节点');
    context.createNodeByType = async () => { throw new Error('模拟保存失败'); };
    await context.createLinkedNode('gameTable');
    assert.equal(context.connections.length, 1, '异步创建失败不留下连线');
    assert.equal(context.alerts.length, 1);
    const generator = {id: 'generator', type: 'generator'};
    context.nodes = [generator]; context.connections = [];
    context.linkCreateState = {originId: generator.id, originKind: 'out', point: {x: 0, y: 0}};
    context.createNodeByType = type => { const node = {id: 'output', type}; context.nodes.push(node); return node; };
    await context.createLinkedNode('output');
    assert.equal(context.connections[0].from, generator.id, '保留生成器菜单的输出创建');
    console.log('CANVAS_INPUT_LINKS_OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
