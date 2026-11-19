const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('static/js/canvas-list-selection.js','utf8');
const original = fs.readFileSync('static/js/canvas-list.js','utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('    function intersects('), source.indexOf("    board.addEventListener('mousedown'")),ctx);
assert(ctx.intersects({left:0,top:0,right:100,bottom:100},{left:50,top:50,right:150,bottom:150}));
assert(!ctx.intersects({left:0,top:0,right:100,bottom:100},{left:101,top:0,right:150,bottom:50}));
// 中键在卡片上也能平移；左键不再触发平移。
Object.assign(ctx, {viewport:{x:0,y:0},board:{classList:{add(){},remove(){}}}, closeCardMenu(){},applyViewport(){}});
vm.runInContext(original.slice(original.indexOf('let panState = null;'),original.indexOf('function onBoardWheel')),ctx);
let prevented = false;
const event = {button:0,clientX:10,clientY:20,target:{closest:()=>null},preventDefault(){prevented=true;}};
ctx.onBoardPanStart(event); ctx.onBoardPanMove({clientX:50,clientY:60});
assert.equal(ctx.viewport.x,0);
ctx.onBoardPanStart({...event,button:1}); ctx.onBoardPanMove({clientX:50,clientY:60}); ctx.onBoardPanEnd();
assert(prevented); assert.equal(ctx.viewport.x,40); assert.equal(ctx.viewport.y,40);
const items = [{id:'a',board_x:10,board_y:20,project:'default'},{id:'b',board_x:400,board_y:300,project:'default'},{id:'other',board_x:900,board_y:900,project:'default'}];
const calls = [], statuses = [];
Object.assign(ctx, {canvases:items, busy:false, chosen:()=>ctx.canvases.filter(c=>c.id!=='other'), L:a=>a,
    window:{StudioConfirm:{ask:async()=>true}},projects:[{id:'default'},{id:'next'}],currentProjectId:'default',
    board:{clientWidth:800},sync(){},clear(){},renderBoard(){},renderProjects(){},refreshTrashCount(){},
    setStatus:message=>statuses.push(message),
    persistMeta:async(id,patch)=>{calls.push([id,patch]); return id!=='b';},
    fetch:async url=>({ok:!url.endsWith('/b')}),
});
vm.runInContext(source.slice(source.indexOf('    async function run('),source.indexOf("    bar.querySelectorAll('[data-action]'")),ctx);
(async()=>{
    await ctx.run('arrange');
    assert.equal(calls.length,2);
    assert.equal(items[2].board_x,900);
    assert.equal(items[1].board_x,400); // 保存失败不修改本地位置。
    assert(statuses.at(-1).includes('1'));
    calls.length=0;
    await ctx.run('move','next');
    assert.equal(items[0].project,'next'); assert.equal(items[1].project,'default');
    ctx.window.StudioConfirm.ask=async()=>false;
    await ctx.run('delete'); assert.equal(ctx.canvases.length,3);
    ctx.window.StudioConfirm.ask=async()=>true;
    await ctx.run('delete');
    assert.deepEqual(Array.from(ctx.canvases,c=>c.id),['b','other']);
    assert.equal(ctx.busy,false);
    console.log('中键平移、框选命中、选中项整理、批量移动/删除及部分失败检查通过');
})().catch(error=>{console.error(error);process.exitCode=1;});
