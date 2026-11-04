const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('static/js/canvas-agent.js','utf8');
const host={querySelectorAll:()=>[],scrollTop:0,scrollHeight:0,clientHeight:0};
const context={host,window:{},document:{getElementById:id=>id==='board'?{getBoundingClientRect:()=>({left:0,top:0,width:1000,height:800})}:null},
 nodes:[{id:'a',type:'extension',x:0,y:0},{id:'b',type:'extension',x:500,y:0,outputText:'stale',extensionPortOutputs:{old:1}}],
 connections:[{id:'edge',from:'a',to:'b',bindings:[{source:'old',target:'old'}]}],canvas:{id:'canvas'},undoStack:[],
 escapeHtml:s=>s.replaceAll('<','&lt;'),canConnectNodes:()=>true,canConnect:()=>true,screenToWorld:()=>({x:0,y:0}),
 pushUndo(){context.undoStack.push(JSON.parse(JSON.stringify({nodes:context.nodes,connections:context.connections})));},
 uid:()=> 'new-edge',render(){},scheduleSave(){},fitAllNodesViewport(){}};
const expose=`window.CanvasAgent={snapshot,fingerprint,apply,changePreview,prepare(value){candidate=value;sourceCanvas=canvas.id;base=fingerprint();panel={querySelector:()=>host};}};`;
vm.createContext(context);vm.runInContext(source.replace('window.CanvasAgent={open,canvasLoaded:loadChat};',expose),context);
const api=context.window.CanvasAgent;
(async()=>{
 const snap=api.snapshot();snap.connections[0].bindings[0].source='mutated';assert.equal(context.connections[0].bindings[0].source,'old','snapshot must not share bindings');
 const bindings=[{source:'original',target:'photo'},{source:'mask',target:'alpha',index:0}];
 api.prepare({summary:'映射',nodes:[],connections:[{from:'a',to:'b',bindings}]});
 assert(api.changePreview().includes('mask[0]'));const before=api.fingerprint();context.connections[0].bindings[0].source='changed';assert.notEqual(api.fingerprint(),before);
 await assert.rejects(api.apply(),/画布已发生变化/);
 api.prepare({summary:'映射',nodes:[],connections:[{from:'a',to:'b',bindings}]});await api.apply();
 assert.equal(context.connections.length,1);assert.deepEqual(JSON.parse(JSON.stringify(context.connections[0].bindings)),bindings);
 assert.equal(context.connections[0].id,'edge');assert.equal(context.nodes[1].extensionPortOutputs,undefined);
 bindings[0].source='mutated';assert.equal(context.connections[0].bindings[0].source,'original');
 assert.equal(context.undoStack[0].connections[0].bindings[0].source,'changed');
 context.connections=[];api.prepare({summary:'新连线',nodes:[],connections:[{from:'a',to:'b',bindings:[{source:'mask',target:'alpha'}]}]});await api.apply();assert.equal(context.connections[0].bindings[0].source,'mask');
 context.nodes[1].running=true;api.prepare({summary:'运行保护',nodes:[],connections:[{from:'a',to:'b',bindings:[{source:'other',target:'alpha'}]}]});await assert.rejects(api.apply(),/正在运行/);assert.equal(context.connections[0].bindings[0].source,'mask');
 console.log('CANVAS_AGENT_PORTS_OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
