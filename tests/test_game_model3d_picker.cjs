// 选择器使用真实逻辑，验证默认画布范围、搜索及绑定切换。
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('static/js/game-model3d.js','utf8');
const a={id:'a',name:'model.glb'},b={id:'b',name:'model.glb'};
const node={id:'local',projectId:'p',modelAssetId:'a',modelDisplayName:'屏风',modelReferenceUrl:'old',modelReferenceKey:'old'};
const search={value:''},scope={value:'canvas'},grid={html:'',buttons:[],
 set innerHTML(html){this.html=html;this.buttons=Array.from(html.matchAll(/data-pick="([^"]+)"/g),m=>({dataset:{pick:m[1]}}));},
 querySelectorAll(){return this.buttons;}};
let closed=false,saved=false;
const el={querySelector(s){return {'[data-search]':search,'[data-scope]':scope,'.m3d-asset-grid':grid}[s];},close(){closed=true;}};
const context={dialog:()=>el,nodes:[node],models:()=>[a,b],referenceImages:()=>[],esc:v=>String(v||''),contentUrl:n=>'/asset/'+n.modelAssetId,project:()=>({id:'p'}),refresh:()=>{saved=true;}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('    function chooseAsset(node){'),source.indexOf('    async function action(node,name){')),context);
context.chooseAsset(node);
assert.deepEqual(grid.buttons.map(v=>v.dataset.pick),['a']);
scope.value='project';scope.onchange();
assert.deepEqual(grid.buttons.map(v=>v.dataset.pick),['a','b']);
search.value='屏风';search.oninput();assert.deepEqual(grid.buttons.map(v=>v.dataset.pick),['a']);
search.value='b';search.oninput();assert.deepEqual(grid.buttons.map(v=>v.dataset.pick),['a','b']);
// 选择同名但不同 ID 的资产，不修改项目文件或其他节点。
grid.buttons.find(v=>v.dataset.pick==='b').onclick();
assert.equal(node.modelAssetId,'b');assert.equal(node.modelDisplayName,undefined);
assert.equal(node.modelReferenceUrl,undefined);assert.equal(a.name,'model.glb');
assert.equal(saved,true);assert.equal(closed,true);
console.log('GAME_MODEL_PICKER_OK: canvas scope, project scope, search, asset binding');
