/* 运行真实节点动作；模拟 API，验证连线输入、采用及美术节点衔接。 */
const vm = require('node:vm'), fs = require('node:fs'), assert = require('node:assert/strict');
let p = null, calls = [], saves = 0, bound = [];
const context = vm.createContext({window: {}, Set, Map, Object, JSON, Error,
    canvas: {id: 'canvas'}, nodes: [], connections: [],
    escapeHtml: v => String(v), chatApiProviders: () => [
        {id: 'free-empty', name: 'FreeApi', chat_models: ['unavailable'], has_key: false},
        {id: 'configured', name: '已配置渠道', chat_models: ['chat-a', 'chat-b'], has_key: true},
    ],
    chatProviderOptions: () => '', scheduleSave: () => saves++, render() {}, pushUndo() {},
    uid: (() => {let n = 0; return prefix => prefix + ++n;})(),
});
const ctx = {
    get project() {return p;}, ask: async () => true, bindAsset: async asset => bound.push(asset.id),
    write: async (path, method, data) => {
        calls.push({path, method, data});
        if (path === '/tables' && method === 'POST') p.tables.push(data.table);
        if (path === '/documents' && method === 'POST') p.documents.push({id: 'new-doc', ...data});
        if (path.endsWith('/ai-edit')) return {project: p, draft: '# AI 修改', sourceRevision: 1};
        if (path.startsWith('/documents/') && method === 'PUT') p.documents.find(d => path.endsWith(d.id)).lastSavedContent = data.content;
        if (path.endsWith('-candidates')) {
            const kind = path.includes('plan') ? 'plan' : 'assets';
            p.candidates.push({id: 'candidate-' + calls.length, status: 'valid', kind,
                data: kind === 'plan' ? {title: '猫咪飞船', revision: 1} : [{id: 'cat'}, {id: 'ship'}]});
        } else if (path === '/plan') {p.plan = data.plan; p.planConfirmed = true; p.planSourceChanged=false; p.candidates = p.candidates.filter(c => c.id !== data.candidateId);}
        else if (path === '/assets') {p.assets = data.assets; p.candidates = p.candidates.filter(c => c.id !== data.candidateId);}
        return {project: p};
    },
};
context.window.GamePipeline = {get project() {return p;}, workflow: fn => fn(ctx)};
context.fetch = async path => {
    if (path === '/api/game-projects/presets') return {ok: true, json: async () => ({presets: [
        {id: 'default', name: '通用助手', kinds: ['plan', 'assets']},
        {id: 'game-director', name: '游戏制作人', kinds: ['plan']},
        {id: 'art-director', name: '美术总监', kinds: ['assets']},
    ]})};
    assert.equal(path, '/api/providers');
    return {ok: true, json: async () => ({providers: context.chatApiProviders()})};
};
vm.runInContext(fs.readFileSync('static/js/game-workflow.js', 'utf8'), context);
const canvasSource = fs.readFileSync('static/js/canvas.js', 'utf8');
const start = canvasSource.indexOf('function canConnect(');
context.CANVAS_GENERATOR_TYPES = ['generator'];
context.CANVAS_MEDIA_OUTPUT_TYPES = [];
vm.runInContext(canvasSource.slice(start, canvasSource.indexOf('function sanitizeConnections(', start)), context);
(async () => {
    p = {id: 'project', canvasId: 'canvas', candidates: [], documents: [], assets: []};
    await context.window.GameWorkflow.loaded();
    assert.equal(context.nodes.length, 3);
    await context.window.GameWorkflow.loaded();
    assert.equal(context.nodes.length, 3, '重复载入不重复建节点');
    const [idea, plan, assets] = context.nodes;
    idea.idea = '猫咪修理飞船';
    assert.ok(context.canConnect(idea.id, plan.id));
    assert.ok(context.canConnect(plan.id, assets.id));
    assert.equal(context.canConnect(assets.id, plan.id), false);
    const devNode = {id:'dev',type:'gameDevelop',projectId:p.id};
    const playNode = {id:'play',type:'gamePlay',projectId:p.id};
    context.nodes.push(devNode,playNode);
    assert.equal(context.canConnect(plan.id,devNode.id),true);
    assert.equal(context.canConnect(assets.id,devNode.id),true);
    assert.equal(context.canConnect(devNode.id,playNode.id),true);
    assert.equal(context.canConnect(playNode.id,devNode.id),false,'不允许反向执行环');
    playNode.projectId='foreign'; assert.equal(context.canConnect(devNode.id,playNode.id),false);
    context.nodes.splice(context.nodes.indexOf(devNode),2);
    await context.window.GameWorkflow.execute(plan, 'plan');
    assert.equal(calls[0].data.idea, idea.idea);
    assert.equal(calls[0].data.provider, 'configured');
    assert.equal(calls[0].data.model, 'chat-a');
    assert.equal(calls[0].data.presetId, 'default');
    assert.equal(plan.model, 'chat-a', '默认选中的实际模型也要持久化');
    assert.ok(plan.candidateId);
    await context.window.GameWorkflow.execute(plan, 'adopt-plan');
    assert.ok(p.planConfirmed);
    assert.equal(context.window.GameWorkflow.planState(plan).ready,true);
    p.planSourceChanged=true;
    assert.equal(context.window.GameWorkflow.planState(plan).label,'来源已变化，待核对');
    const beforeReconfirm=calls.length;
    await context.window.GameWorkflow.execute(plan,'reconfirm-plan');
    assert.equal(calls.length,beforeReconfirm+1,'沿用策划只保存一次，不重复调用模型');
    assert.equal(calls.at(-1).path,'/plan');
    assert.equal(context.window.GameWorkflow.planState(plan).ready,true);
    await context.window.GameWorkflow.execute(assets, 'assets');
    assert.equal(calls.at(-1).path, '/asset-candidates');
    const beforeEmpty = calls.length;
    await context.window.GameWorkflow.execute(assets, 'bind-selected');
    assert.equal(calls.length, beforeEmpty, '空选不能采用或创建节点');
    assert.equal(bound.length, 0);
    await context.window.GameWorkflow.execute(assets, 'select-assets');
    assert.equal(assets.selectedAssetIds.length, 2);
    await context.window.GameWorkflow.execute(assets, 'clear-assets');
    assert.equal(assets.selectedAssetIds.length, 0);
    assets.selectedAssetIds = ['ship'];
    await context.window.GameWorkflow.execute(assets, 'bind-selected');
    assert.equal(p.assets.length, 2, '采用完整候选清单');
    assert.deepEqual(bound, ['ship'], '只创建勾选资产的节点');
    assets.selectedAssetIds = ['cat'];
    await context.window.GameWorkflow.execute(assets, 'bind-selected');
    assert.deepEqual(bound, ['ship', 'cat'], '已采用清单也支持选择创建');
    const count = calls.length;
    idea.idea = '新的想法';
    await context.window.GameWorkflow.execute(assets, 'assets');
    assert.equal(calls.length, count, '输入改变后阻止旧策划拆解资产');
    context.connections = [];
    await context.window.GameWorkflow.execute(plan, 'plan');
    assert.equal(calls.length, count, '断开输入后不调用 LLM');
    assert.ok(saves > 0);
    const extra = await context.window.GameWorkflow.addNode('gamePlan', {x: 12, y: 34});
    assert.equal(extra.projectId, p.id);
    assert.equal(extra.x, 12);
    assert.equal(context.canConnect(idea.id, extra.id), true);
    extra.projectId = 'foreign';
    assert.equal(context.canConnect(idea.id, extra.id), false);
    extra.projectId = p.id;
    context.connections = [{from: idea.id, to: extra.id}];
    extra.provider = 'configured'; extra.model = 'chat-b';
    extra.presetId = 'game-director';
    await context.window.GameWorkflow.execute(extra, 'plan');
    assert.equal(calls.at(-1).data.model, 'chat-b', '使用下拉菜单选择的模型');
    assert.equal(calls.at(-1).data.presetId, 'game-director', '预设随请求提交');
    const beforeWrongPreset = calls.length;
    extra.presetId = 'art-director';
    await context.window.GameWorkflow.execute(extra, 'plan');
    assert.equal(calls.length, beforeWrongPreset, '不向策划节点提交资产专用预设');
    const beforeInvalid = calls.length;
    extra.provider = 'free-empty'; extra.model = 'unavailable';
    await context.window.GameWorkflow.execute(extra, 'plan');
    assert.equal(calls.length, beforeInvalid, '不可用模型不能静默切换渠道或提交');
    extra.provider = 'configured'; extra.model = 'chat-b'; extra.presetId = 'default';
    const image = {id: 'reference', type: 'image', url: '/output/alice/ref.png'};
    const doc = {id: 'doc-node', type: 'document', docId: 'doc', projectId: p.id, editInstruction: '补全玩法'};
    const tableNode = {id: 'table-node', type: 'gameTable', tableId: 'table', projectId: p.id};
    p.documents.push({id: 'doc', revision: 1, title: '需求', lastSavedContent: '原稿'});
    p.tables = [{id: 'table', revision: 1}];
    context.nodes.push(image, doc, tableNode);
    assert.equal(context.canConnect(image.id, doc.id), true);
    assert.equal(context.canConnect(image.id, extra.id), true);
    assert.equal(context.canConnect(tableNode.id, extra.id), true);
    context.connections.push({from: image.id, to: extra.id}, {from: tableNode.id, to: extra.id}, {from: image.id, to: doc.id});
    await context.window.GameWorkflow.execute(extra, 'plan');
    assert.equal(calls.at(-1).data.referenceImages[0], image.url);
    assert.equal(calls.at(-1).data.tableIds[0], 'table');
    await context.window.GameWorkflow.execute(doc, 'ai-content');
    assert.equal(doc.contentCandidate.data, '# AI 修改');
    assert.equal(p.documents[0].lastSavedContent, '原稿', 'AI 不自动覆盖原文');
    assert.equal(calls.at(-1).data.referenceImages[0], image.url);
    assert.equal(calls.at(-1).data.label, undefined, '不提交渠道展示字段');
    await context.window.GameWorkflow.execute(doc, 'adopt-content');
    assert.equal(p.documents[0].lastSavedContent, '# AI 修改');
    assert.equal(doc.contentCandidate, undefined);
    const createdTable = await context.window.GameWorkflow.addNode('gameTable', {x: 45, y: 67});
    assert.ok(createdTable.tableId && context.nodes.includes(createdTable), '异步创建表格返回可连接的实际节点');
    const createdDocument = await context.window.GameWorkflow.addNode('document', {x: 89, y: 12});
    assert.equal(createdDocument.docId, 'new-doc');
    assert.ok(context.nodes.includes(createdDocument));
    const savedProject=p;
    const menuTypes=()=>{
        let html='';
        context.document={createElement:()=>({dataset:{},set innerHTML(value){html=value;},querySelectorAll:()=>[]})};
        context.window.GameWorkflow.populateMenu({querySelector:()=>null,prepend(){}});
        return [...html.matchAll(/data-game-type="([^"]+)"/g)].map(match=>match[1]);
    };
    const projectTypes=menuTypes();p=null;
    assert.deepEqual(menuTypes(),projectTypes,'plain and project canvases expose the same nodes');
    let ensured=0;
    context.window.GamePipeline.ensureProject=async()=>{ensured++;p=savedProject;return p;};
    const sharedNode=await context.window.GameWorkflow.addNode('gamePlan',{x:20,y:30});
    assert.equal(ensured,1);assert.equal(sharedNode.projectId,savedProject.id);
    p=null;
    context.window.GamePipeline.ensureProject=async()=>{context.canvas.id='other';p=savedProject;return p;};
    await assert.rejects(context.window.GameWorkflow.addNode('gamePlan',{x:0,y:0}),/画布已切换/);
    console.log('GAME_WORKFLOW_OK');
})().catch(e => {console.error(e); process.exitCode = 1;});
