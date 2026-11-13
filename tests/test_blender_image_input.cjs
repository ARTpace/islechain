const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const canvas = fs.readFileSync('static/js/canvas.js', 'utf8');
const context = vm.createContext({
    window: {},
    CANVAS_IMAGE_OUTPUT_TYPES: ['imageGen','generator','msgen','comfy','ltxDirector','rh','minimax'],
    wouldCreateGeneratorCycle: () => false,
    cliNodeType: () => false,
});
vm.runInContext(canvas.slice(canvas.indexOf('function canConnectNodes('), canvas.indexOf('\nfunction ', canvas.indexOf('function canConnectNodes(') + 1)), context);
const target = {id:'model', type:'blenderGen'};
for (const type of ['image','group','output',...context.CANVAS_IMAGE_OUTPUT_TYPES]) {
    assert.equal(context.canConnectNodes({id:'source',type}, target), true, type);
}
assert.equal(context.canConnectNodes(target, target), false);
assert.equal(context.canConnectNodes({id:'video',type:'video'}, target), false);
context.wouldCreateGeneratorCycle = () => true;
assert.equal(context.canConnectNodes({id:'image',type:'image'}, target), false);
context.wouldCreateGeneratorCycle = () => false;
context.window.GameModel3D = {canConnect: () => true};
assert.equal(context.canConnectNodes({id:'asset',type:'gameModelAsset'}, target), true);

// Exercise the production source resolver and Blender URL collection together.
const image = {id:'image',type:'image',url:'/upload/reference.png',name:'reference.png'};
context.deps = {nodes:()=>[image,target], connections:()=>[{from:image.id,to:target.id}], mediaOutputTypes:()=>[]};
context.getNodes = () => context.deps.nodes();
context.getConnections = () => context.deps.connections();
context.mediaKindForNode = () => 'image';
context.window.GameModel3D = undefined;
const sources = fs.readFileSync('static/js/canvas-generation-sources.js', 'utf8');
vm.runInContext(sources.slice(sources.indexOf('function generatorSources('), sources.indexOf('\nfunction ', sources.indexOf('function generatorSources(') + 1)), context);
const blender = fs.readFileSync('static/nodes/blender-gen/index.js', 'utf8');
vm.runInContext(blender.slice(blender.indexOf('function blenderRefUrls('), blender.indexOf('\nlet blenderProviders', blender.indexOf('function blenderRefUrls('))), context);
assert.deepEqual(Array.from(context.blenderRefUrls(target)), ['/upload/reference.png']);
context.generatorSources = () => [{refs:[{url:'/image.png',kind:'image'},{url:'/video.mp4',kind:'video'}]}];
assert.deepEqual(Array.from(context.blenderRefUrls(target)), ['/image.png']);
console.log('BLENDER_IMAGE_INPUT_OK: links, cycle guard, model input, reference URL collection');

// 预览与发送共用去重后的图片列表，超过旧四图限制也不丢失。
context.generatorSources = () => [{refs:Array.from({length:9},(_,i)=>({url:`/ref${i}.png`,kind:'image'})).concat([{url:'/ref0.png',kind:'image'},{url:'/clip.mp4',kind:'video'}])}];
assert.equal(context.blenderRefUrls(target).length,9);
assert.deepEqual(Array.from(context.blenderRefPreviews(target),ref=>ref.url),Array.from(context.blenderRefUrls(target)));

// 两种建模界面共用同一类型，输出拖线都必须提供模型资产候选。
vm.runInContext(canvas.slice(canvas.indexOf('function linkCreateOptions('),canvas.indexOf('function addMiniMaxNode(')),context);
for(const sceneWorkspace of [false,true]){
    context.nodes=[{id:'blender',type:'blenderGen',sceneWorkspace}];
    assert.deepEqual(Array.from(context.linkCreateOptions({originId:'blender',originKind:'out'}),item=>item.type),['gameModelAsset']);
}
// 使用生产模型连接规则，确保候选不是只能显示但连不上。
const modelSource=fs.readFileSync('static/js/game-model3d.js','utf8');
const start=modelSource.indexOf('    function canConnect(from,to){');
vm.runInContext('var types=["gameModelAsset","gameModel3d","gameAnimate3d"];'+modelSource.slice(start,modelSource.indexOf('    window.GameModel3D=',start)),context);
context.window.GameModel3D={canConnect:context.canConnect};
assert.equal(context.canConnectNodes({id:'b',type:'blenderGen'},{id:'a',type:'gameModelAsset',projectId:'p'}),true);
console.log('BLENDER_OUTPUT_LINK_OK');
