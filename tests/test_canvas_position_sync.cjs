const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync('static/js/canvas.js','utf8');
function context(){
    let timer=0;
    const pending=new Map(),node={id:'card',type:'imageGen',x:10,y:20};
    const c={nodes:[node],connections:[],canvas:{id:'canvas',updated_at:1},selected:new Set(),viewport:{scale:1},
        localCanvasDirty:false,savingCanvasNow:false,saveCanvasAgain:false,applyingRemoteCanvas:false,
        saveTimer:null,remoteSyncTimer:null,lastCanvasUpdatedAt:1,CLIENT_ID:'local',currentCanvasTime:null,
        dragNode:null,resizeNode:null,window:{},document:{body:{classList:{add(){}}}},nodesEl:{querySelector(){return null;}},
        setTimeout(fn){pending.set(++timer,fn);return timer;},clearTimeout(id){pending.delete(id);},
        setStatus(){},syncRemoteCanvasNow(){},sanitizeConnections(){},serializableCanvasNodes(){return c.nodes.map(n=>({...n}));},
        loadCanvasList(){},console,formatCanvasTime:String,startKnifeDrag(){return false;},endDrag(){},
        defaultNodeSize(){return {w:440,h:200};},scheduleLinksRender(){},renderSelectionHub(){},scheduleMinimapRender(){},workflowTransferModal:null,
        async fetch(url,options){c.saved=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({canvas:{id:'canvas',updated_at:2}})};}
    };
    vm.createContext(c);
    for(const [start,end] of [
        ['function scheduleSave(','function scheduleViewportSave('],
        ['async function saveCanvas(','async function loadConfig('],
        ['function applyRemoteCanvasData(','function resetTransientRunState('],
        ['function handleCanvasUpdatedMessage(','async function returnToCanvasManager('],
        ['function startNodeDrag(','function startLink(']
    ])vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),c);
    c.pending=pending;return c;
}
const event={button:0,clientX:100,clientY:100,preventDefault(){},stopPropagation(){}};
test('remote notification preserves an unsaved position and its save timer',()=>{
    const c=context();c.nodes[0].x=300;c.scheduleSave();const save=c.saveTimer;
    c.handleCanvasUpdatedMessage({type:'canvas_updated',canvas_id:'canvas',client_id:'other',updated_at:2});
    assert.equal(c.localCanvasDirty,true);assert.equal(c.saveTimer,save);assert(c.pending.has(save));
    c.applyRemoteCanvasData({id:'canvas',updated_at:2,nodes:[{id:'card',x:10,y:20}]});
    assert.equal(c.nodes[0].x,300);
});
test('reused card drag and resize handlers resolve the current node object',()=>{
    const c=context(),old=c.nodes[0],current={...old,x:80,y:90};c.nodes=[current];
    c.startNodeDrag(event,old);assert.equal(c.dragNode.node,current);
    c.onNodeDrag({...event,clientX:160,clientY:170});assert.equal(current.x,140);assert.equal(current.y,160);assert.equal(old.x,10);
    c.startNodeResize(event,old);assert.equal(c.resizeNode.node,current);
});
test('remote data cannot replace nodes during a drag or resize before mouseup',()=>{
    for(const key of ['dragNode','resizeNode']){
        const c=context(),node=c.nodes[0];c[key]={node};
        c.applyRemoteCanvasData({id:'canvas',updated_at:2,nodes:[{id:'card',x:999}]});
        assert.equal(c.nodes[0],node);assert(c.remoteSyncTimer);
    }
});
test('save clears the consumed debounce timer and writes the moved coordinates',async()=>{
    const c=context();c.nodes[0].x=300;c.scheduleSave();const timer=c.saveTimer;
    await c.saveCanvas();assert.equal(c.saved.nodes[0].x,300);
    assert.equal(c.saveTimer,null);assert.equal(c.pending.has(timer),false);assert.equal(c.localCanvasDirty,false);
});
