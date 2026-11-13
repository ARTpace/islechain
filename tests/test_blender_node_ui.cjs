/* AI 建模节点：人设（含手册查看）/ 目标面数 的接线检查（假 DOM，不启浏览器）。
   重点是三件事：控件渲染出来、请求体带上 skillId 与 targetTris、面数回填到节点状态。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const stubEl = () => ({
    innerHTML: '', textContent: '', style: {}, disabled: false,
    appendChild() {}, querySelector() { return stubEl(); }, addEventListener() {},
    setAttribute() {}, focus() {}
});

const calls = [];
let jobPayload = null;
const flush = () => new Promise(resolve => setImmediate(resolve));

const context = {
    console,
    window: {},
    document: { createElement: () => stubEl() },
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout() {},
    alert: () => {},
    render() {},
    scheduleSave() {},
    uid: (prefix) => prefix + '_1',
    addNode: (node) => node,
    defaultPoint: () => ({ x: 0, y: 0 }),
    escapeHtml: (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    generatorSources: () => [],
    model3dViewerElement: () => stubEl(),
    cascadeBtnHtml: () => '',
    bindCascadeButtons() {},
    fetch: async (url, options) => {
        calls.push({ url, body: options && options.body ? JSON.parse(options.body) : null });
        if (url === '/api/providers') {
            return { ok: true, json: async () => ({ providers: [] }) };
        }
        if (url === '/api/game-projects/presets') {
            return { ok: true, json: async () => ({ presets: [
                { id: 'default', name: '通用助手', kinds: ['model'], description: '按当前想法完成任务' },
                { id: 'optimizer', name: '减面拓扑师', kinds: ['model'], description: '在现有模型上减面' }
            ] }) };
        }
        if (url === '/api/game-projects/blender-skills') {
            return { ok: true, json: async () => ({ skills: [
                { id: 'default', name: '通用建模师 · 作业手册', description: '基础手法', path: 'packs/blender-skills/default/SKILL.md' },
                { id: 'optimizer', name: '减面拓扑师 · 作业手册', description: 'DECIMATE 配方', path: 'packs/blender-skills/optimizer/SKILL.md' }
            ] }) };
        }
        if (url === '/api/dcc/build-model') {
            return { ok: true, json: async () => ({ jobId: 'job1', status: 'building' }) };
        }
        if (url.startsWith('/api/dcc/jobs/job1/import')) {
            return { ok: true, json: async () => ({ items: [] }) };
        }
        if (url.startsWith('/api/dcc/jobs/')) {
            return { ok: true, json: async () => jobPayload };
        }
        return { ok: true, json: async () => ({}) };
    }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/nodes/blender-gen/index.js', 'utf8'), context);

const api = context.window.BlenderGenNode;
const node = {
    id: 'blender_1', type: 'blenderGen', x: 0, y: 0, w: 360,
    prompt: '把这个模型减到 5000 面', presetId: 'optimizer', skillId: 'optimizer',
    targetTris: 5000, status: 'idle', statusText: '', logs: []
};
api.init({
    nodes: () => [node],
    connections: () => [],
    canvas: () => ({ id: 'canvas1' })
});

(async () => {
    // 1) 控件必须出现在节点面板里（先等一次 fetch 回来）
    api.body(node);
    await flush();
    api.body(node);
    await flush();
    const html = api.body(node).innerHTML;
    // 手册跟着人设走：节点上只有人设下拉 + 一个「手册」查看键，不再有独立的手册下拉
    assert.match(html, /class="blender-preset"/, '缺少人设下拉');
    assert.match(html, /blender-preset-info/, '缺少手册查看键');
    assert.doesNotMatch(html, /blender-skill/, '不应该再有独立的手册下拉');
    assert.match(html, /目标面数/, '缺少目标面数输入');
    assert.match(html, /class="blender-target-tris"/);
    assert.match(html, /value="5000"/, '目标面数没有回填到输入框');
    assert.match(html, /减面拓扑师/, '人设下拉没有选中减面人设');

    // 2) 运行请求必须带上 presetId 与 targetTris（后端按人设取手册）
    jobPayload = { status: 'produced', stage: '已出模型', tris: 4980, targetTris: 5000, trisDelta: -0.4, logs: [] };
    await api.run('blender_1');
    const submit = calls.find(item => item.url === '/api/dcc/build-model');
    assert.ok(submit, '没有提交建模请求');
    assert.equal(submit.body.presetId, 'optimizer', 'presetId 没有透传');
    assert.equal(submit.body.targetTris, 5000, 'targetTris 没有透传');
    assert.equal(submit.body.presetId, 'optimizer');

    // 3) 面数要回填，状态行要能读出真实面数
    assert.equal(node.tris, 4980, '产物面数没有回填到节点');
    assert.match(node.statusText, /4,980/, '状态行没有显示面数：' + node.statusText);
    assert.match(node.statusText, /5,000/, '状态行没有显示目标面数');
    assert.equal(node.running, false);

    // 4) 留空 / 非法输入按"不限"处理，不把 NaN 送进后端
    node.targetTris = 'abc';
    jobPayload = { status: 'produced', stage: '已出模型', logs: [] };
    calls.length = 0;
    await api.run('blender_1');
    assert.equal(calls.find(item => item.url === '/api/dcc/build-model').body.targetTris, 0);

    // 场景入口保留原类型并返回节点；未接通工序不能经快捷/级联入口误跑建模。
    const scene = api.addNode({x:12,y:24}, true);
    assert.equal(scene.type, 'blenderGen');
    assert.equal(scene.sceneWorkspace, true);
    node.sceneWorkspace = true;
    for(const step of ['uv','material','scene','lighting','render']){
        node.workspaceStep = step;
        calls.length = 0;
        await api.run(node.id);
        assert.equal(calls.length, 0, step + '不应发起建模请求');
    }
    node.workspaceStep = 'model';
    calls.length = 0;
    await api.run(node.id);
    assert.ok(calls.some(item => item.url === '/api/dcc/build-model'));

    context.generatorSources = () => [{refs:Array.from({length:9},(_,i)=>({url:`/ref${i}.png`,kind:'image'}))}];
    calls.length = 0;
    await api.run(node.id);
    assert.equal(calls.length,0,'超出八张应拦截，不应静默丢图');

    // 场景改造已有模型也要生成独立输出，不调用覆盖原资产的下载/写入分支。
    const liveNodes=[node], liveConnections=[];
    api.init({nodes:()=>liveNodes,connections:()=>liveConnections,canvas:()=>({id:'canvas1'})});
    context.addNode=fresh=>{liveNodes.push(fresh);return fresh;};
    context.window.GameModel3D={adoptLocal:async fresh=>{fresh.type='gameModelAsset';fresh.projectId='p';fresh.modelAssetId='new-model';}};
    const output={id:'model-output',type:'model3d',url:'/generated.glb'};
    context.fetch=async (url)=>{calls.push({url});return {ok:true,json:async()=>({items:[{kind:'model',url:'/generated.glb',node:output}]})};};
    node.targetAssetId='original-model';node.targetProjectId='p';
    calls.length=0;
    await api.importJob(node,'completed-job');
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'/api/dcc/jobs/completed-job/import');
    assert.equal(liveNodes[1].type,'gameModelAsset');
    assert.equal(liveConnections[0].from,node.id);
    assert.equal(liveConnections[0].to,output.id);
    assert.equal(node.targetAssetId,'original-model');
    assert.equal(api.previewUrl(node),'/generated.glb');

    console.log('blender node UI: preset select, manual entry, target tris and face-count feedback passed');
})().catch(error => { console.error(error); process.exit(1); });
