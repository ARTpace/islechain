const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const frameWindow={},otherWindow={};
const source={id:'source',type:'image',url:'/original.png'};
const messages=[];
const frame={contentWindow:{postMessage:data=>messages.push(data)}};
// This verifies routing/security and the existing same-card version flow, without submitting a paid task.
const context=vm.createContext({
    Map,Set,Date,JSON,Math,location:{origin:'http://local'},
    canvas:{id:'canvas'},nodes:[source],selected:new Set(),
    document:{querySelector:()=>null},CardProgress:{update:()=>{}},
    pushUndo:()=>{},render:()=>{},scheduleSave:()=>{},
    testState:{frame,ready:true,sentKey:'selected',current:{canvasId:'canvas',nodeId:'source'},active:null}
});
vm.runInContext(fs.readFileSync('static/js/canvas-image-versions.js','utf8'),context);
vm.runInContext(fs.readFileSync('static/js/canvas-image-composer.js','utf8'),context);
vm.runInContext('canvasComposerBridge=testState',context);
const anchor=(view)=>context.imageComposerPosition({x:400,y:100,w:200,h:300},view,720,1400);
assert.equal(anchor({x:0,y:0,scale:1}).left,140,'composer centers below the selected card');
assert.equal(anchor({x:0,y:0,scale:1}).top,416);
assert.equal(anchor({x:50,y:80,scale:2}).top,896,'composer follows pan and zoom');
assert.equal(context.imageComposerPosition({x:0,y:0,w:100,h:100},{x:-100,y:0,scale:1},720,1400).left,8,'horizontal edge stays usable');
const send=(data,source=frame.contentWindow,origin='http://local')=>context.handleCanvasComposerMessage({data,source,origin});
context.testState.panel={hidden:false,offsetWidth:720,style:{}};
context.board={clientHeight:900,clientWidth:1400};
context.viewport={x:30,y:50,scale:0.5};
context.CSS={escape:value=>value};
context.nodesEl={querySelector:()=>({offsetWidth:200,offsetHeight:600})};
source.x=400;source.y=100;
context.selected.add(source.id);
context.positionImageEditComposer();
assert.equal(context.testState.panel.hidden,true,'selection alone must not show the composer');
vm.runInContext("imageComposerEnabledFor='canvas:source'",context);
context.positionImageEditComposer();
assert.equal(context.testState.panel.style.top,'416px','actual card height anchors composer even during pan');
context.viewport.scale=0.2;
context.positionImageEditComposer();
assert.equal(context.testState.panel.hidden,true,'tiny image hides the composer');
context.viewport.scale=0.5;
context.positionImageEditComposer();
assert.equal(context.testState.panel.hidden,false,'zooming back in restores the same composer');
context.selected.clear();
context.testState.panel.hidden=true;
context.positionImageEditComposer();
assert.equal(context.testState.panel.hidden,true,'zoom must not reopen a deselected composer');
send({type:'canvas-composer-height',height:204});
assert.equal(context.testState.panel.style.height,'204px','compact composer must not retain an empty minimum-height area');
const start={type:'canvas-composer-start',canvasId:'canvas',nodeId:'source',requestId:'request',prompt:'edit background'};
send(start,otherWindow);assert.equal(source.imageComposerPending,undefined,'unrelated frame must be ignored');
send(start,frame.contentWindow,'http://other');assert.equal(source.imageComposerPending,undefined,'cross-origin messages must be ignored');
send(start);assert.equal(source.imageComposerPending.id,'request');
send({type:'canvas-composer-result',requestId:'stale',record:{images:['/wrong.png']}});
assert.equal(source.imageVersions.length,1,'stale task results must be ignored');
send({type:'canvas-composer-result',requestId:'request',record:{images:['/edited.png'],prompt:'edit background'}});
send({type:'canvas-composer-result',requestId:'request',record:{images:['/edited.png'],prompt:'edit background'}});
assert.equal(source.imageVersions.length,2,'result replay must not duplicate versions');
assert.equal(source.url,'/original.png');
assert.equal(source.imageComposerPending,undefined);
send({type:'canvas-composer-finish',requestId:'request'});
assert.equal(context.testState.active,null);
send({...start,requestId:'retry'});
send({type:'canvas-composer-finish',requestId:'retry',error:'backend unavailable'});
assert.equal(source.imageComposerPending,undefined,'failure must clear the loading card');
assert.equal(source.imageComposerError,'backend unavailable');
console.log('Composer bridge: origin/source checks, request isolation, version deduplication and failure cleanup passed');
