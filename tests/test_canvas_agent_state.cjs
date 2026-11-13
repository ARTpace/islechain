const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const entries=new Map();
let blocked=false;
const context={window:{},localStorage:{getItem:key=>entries.get(key) || null,setItem:(key,value)=>{if(blocked)throw new Error('quota');entries.set(key,value);}}};
vm.runInNewContext(fs.readFileSync('static/js/canvas-agent-state.js','utf8'),context);
const state=context.window.CanvasAgentState;
const plain=value=>JSON.parse(JSON.stringify(value));
const session={draft:'继续调整森林角色',model:'["provider","model"]',serverIds:['art'],messages:[
    {id:'user1',role:'user',text:'修改选中的描述',references:[{id:'node42',label:'角色提示词'}]},
    {id:'assistant1',role:'assistant',text:'已准备修改。',summary:'把角色描述改为像素风',status:'applied',proposal:{secret:'must-not-persist'},trace:[{name:'canvas_read',status:'completed'}]},
    {id:'assistant2',role:'assistant',text:'',summary:'新方案',status:'proposed'},
    {id:'assistant3',role:'assistant',text:'',status:'working'},
]};
state.save('canvas1',session);
assert.ok(![...entries.values()][0].includes('must-not-persist'));
const restored=state.load('canvas1');
assert.equal(restored.draft,session.draft);
assert.equal(restored.messages[1].status,'applied');
assert.equal(restored.messages[2].status,'expired');
assert.equal(restored.messages[3].status,'interrupted');
assert.equal(restored.messages[0].references[0].id,'node42');
assert.equal(state.load('canvas2').messages.length,0);
const history=plain(state.history(restored.messages));
assert.ok(history[0].content.includes('node42'));
assert.ok(history[1].content.includes('已采用'));
assert.ok(history[2].content.includes('已失效'));
assert.ok(history.every(item=>['user','assistant'].includes(item.role)));
const many=Array.from({length:60},(_,index)=>({id:String(index),role:'user',text:'消息 '+index}));
state.save('large',{...session,messages:many});
assert.equal(state.load('large').messages.length,40);
assert.equal(state.history(many).length,12);
entries.set('art-canvas-agent-chat-v1:broken','null');
assert.equal(state.load('broken').messages.length,0);
entries.set('art-canvas-agent-chat-v1:broken','invalid json');
assert.equal(state.load('broken').messages.length,0);
blocked=true;
assert.throws(()=>state.save('canvas1',session),/quota/);
assert.equal(state.load('canvas1').draft,session.draft);
// Fit only this turn's nodes into the board space left beside the chat panel.
const canvasSource=fs.readFileSync('static/js/canvas.js','utf8');
const fitSource=canvasSource.slice(canvasSource.indexOf('function fitAllNodesViewport('),canvasSource.indexOf('function enterZoomPreview('));
const added=[{x:0,y:800,w:310,h:240},{x:440,y:800,w:380,h:390},{x:880,y:800,w:460,h:200}];
const view={scale:1,x:0,y:0};let saves=0;
const fitContext={board:{getBoundingClientRect:()=>({width:900,height:650})},nodes:[{x:20000,y:0,w:440,h:500}],
    viewport:view,estimatedNodeRect:node=>node,applyViewport:()=>{},renderLinks:()=>{},renderSelectionHub:()=>{},scheduleViewportSave:()=>saves++};
vm.createContext(fitContext);vm.runInContext(fitSource,fitContext);fitContext.fitAllNodesViewport(added);
for(const node of added){
    assert.ok(node.x*view.scale+view.x>=0);
    assert.ok((node.x+node.w)*view.scale+view.x<=900);
    assert.ok(node.y*view.scale+view.y>=0);
    assert.ok((node.y+node.h)*view.scale+view.y<=650);
}
assert.equal(saves,1);
console.log('CANVAS_AGENT_STATE_OK');

blocked=false;
state.save('diagnostics',{...session,messages:[{id:'diagnostic',role:'assistant',text:'失败',trace:[{name:'create',status:'failed',error:'缺少 expectedImages'}]}]});
assert.equal(state.load('diagnostics').messages[0].trace[0].error,'缺少 expectedImages');
