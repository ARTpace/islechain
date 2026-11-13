/* PBR 材质直连模型资产：连线规则、通道识别、材质球按钮复用（不启浏览器）。
   这条链路的重点是「不再多建一个 3D 模型节点」——资产节点自己就是材质预览的落点。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const material = {
    id: 'mat1', type: 'materialPbr', x: 0, y: 0, w: 440, name: 'PBR 材质',
    materialJob: {result: {maps: {
        basecolor: '/assets/a/materials/j1/maps/basecolor.png',
        normal: '/assets/a/materials/j1/maps/normal.png',
        roughness: '/assets/a/materials/j1/maps/roughness.png'
    }}}
};
const assetNode = {id: 'asset1', type: 'gameModelAsset', projectId: 'p1', modelAssetId: 'm1'};
const nodes = [material, assetNode];
const connections = [{id: 'c1', from: 'mat1', to: 'asset1'}];
let added = 0, focused = null;

const context = {
    console,
    window: {},
    document: {createElement: () => ({style: {}, addEventListener() {}, append() {}})},
    canvas: {id: 'canvas1'},
    nodes,
    connections,
    scheduleSave() {},
    render() {},
    addNode(node) { added += 1; nodes.push(node); return node; },
    focusCreatedNode(node) { focused = node; },
    uid: prefix => prefix + '_' + Math.random().toString(16).slice(2, 8),
    imageRefsFromNode: node => (node && node.url ? [{url: node.url, name: node.name || node.id}] : [])
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/js/canvas-material-preview.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('static/js/canvas-materials.js', 'utf8'), context);

const materials = context.window.CanvasMaterials;
const preview = context.window.CanvasMaterialPreview;

// 1) 连线：PBR 材质能直接连到模型资产
assert.equal(materials.canConnect(material, assetNode), true, 'PBR 材质应能连模型资产');
assert.equal(materials.canConnect(material, {type: 'model3d'}), true, '旧版 3D 模型节点照旧');
assert.equal(materials.canConnect(material, {type: 'output'}), true);
assert.equal(materials.canConnect(material, {type: 'gameDevelop'}), false);
// AI 建模产物那条路不能被材质模块截断，必须交回 GameModel3D 判定
assert.equal(materials.canConnect({type: 'blenderGen'}, assetNode), undefined);
assert.equal(materials.canConnect({type: 'image', url: '/x/normal.png'}, assetNode), true);
assert.equal(materials.canConnect({type: 'image'}, assetNode), false);

// 2) 通道识别：资产节点也能从材质节点读整套贴图
const sources = preview.sources(assetNode);
assert.deepEqual(Object.keys(sources.maps).sort(), ['basecolor', 'normal', 'roughness']);
assert.equal(preview.sources({type: 'image'}), null, '其它节点不能被误识别');
assert.equal(preview.sources({type: 'gameModelAsset'}), null, '没连材质时没有可预览的贴图');

(async()=>{
context.window.GamePipeline={project:{id:'p1',canvasId:'canvas1'}};
context.window.GameWorkflow={async addNode(type,point){return context.addNode({id:'created'+added,type,projectId:'p1',...point});}};
context.window.GameModel3D={async adoptLocal(node){node.type='gameModelAsset';node.projectId='p1';}};
// 3) 材质球按钮：已连资产时复用节点，不新建
await materials.ballPreview(material);
assert.equal(added, 0, '已经连了模型资产就不该再建节点');
assert.equal(assetNode.materialPreview, 'sphere', '复用时要切到球体预览');
assert.equal(focused && focused.id, 'asset1');

// 4) 没有可复用节点时只建模型资产，多次点击共用同一次创建
const lonely = {
    id: 'mat2', type: 'materialPbr', x: 0, y: 0, w: 440,
    materialJob: {result: {maps: {basecolor: '/assets/a/materials/j2/maps/basecolor.png'}}}
};
nodes.push(lonely);
const first=materials.ballPreview(lonely);
assert.equal(materials.ballPreview(lonely),first,'重复点击共用创建任务');
await first;
assert.equal(added, 1, '没有可复用的 3D 节点时才新建');
const created = nodes.at(-1);
assert.equal(created.type, 'gameModelAsset');
assert.equal(created.materialPreview, 'sphere');
assert.ok(connections.some(c => c.from === 'mat2' && c.to === created.id), '新节点要自动连线');
await materials.ballPreview(lonely);assert.equal(added,1);
const empty={id:'empty',type:'gameModelAsset',projectId:'p1',x:800,y:900};nodes.push(empty);
const next={...lonely,id:'mat4'};nodes.push(next);
assert.equal(await materials.ballPreview(next),empty,'复用当前画布的空资产节点');
assert.equal(added,1);assert.equal(empty.x,800);assert.equal(empty.y,900);
const old={id:'legacy',type:'model3d',x:30,y:40};nodes.push(old);
const legacyMaterial={...lonely,id:'mat5'};nodes.push(legacyMaterial);connections.push({from:legacyMaterial.id,to:old.id});
assert.equal(await materials.ballPreview(legacyMaterial),old);assert.equal(old.type,'gameModelAsset');assert.equal(added,1);

// 5) 没有贴图时按钮直接拒绝
assert.throws(() => materials.ballPreview({id: 'mat3', type: 'materialPbr'}), /请先计算 PBR 贴图/);

console.log('material on asset: unified creation, empty asset reuse, legacy upgrade and duplicate-click protection passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
