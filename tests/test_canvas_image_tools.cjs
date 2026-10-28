const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const original = {id:'source',type:'image',url:'/output/original.png',x:10,y:20,w:260};
const snapshots = [];
const context = vm.createContext({
    console, Map, Set, Date, JSON,
    canvas:{id:'canvas'}, nodes:[{...original}], selected:new Set(),
    estimatedNodeRect:n=>({...n,h:180}),
    pushUndo:()=>snapshots.push(JSON.stringify(context.nodes)),
    render:()=>{},scheduleSave:()=>{},
    addGeneratedImageNode:(file,source,suffix,offset,extra)=>{
        const node = {id:'result'+context.nodes.length,type:'image',url:file.url,...extra};
        context.nodes.push(node);context.selected.clear();context.selected.add(node.id);return node;
    }
});
vm.runInContext(fs.readFileSync('static/js/canvas-image-tools.js','utf8'),context);
const comparisonElements=[];
context.document={createElement:()=>({style:{},setAttribute(){},addEventListener(){},remove(){}})};
const resultPreview={src:'/api/media-preview?w=768',removeAttribute(name){this.removed=name;}};
const comparisonSurface={querySelector:()=>resultPreview,classList:{add(){}},append:(...items)=>comparisonElements.push(...items)};
context.canvasDisplayMediaUrl=url=>url;
context.mountCanvasCutoutComparison({querySelector:()=>comparisonSurface},{url:'/output/full-cutout.png',editMeta:{operation:'cutout',sourceUrl:original.url}});
assert.equal(resultPreview.src,'/output/full-cutout.png','comparison result must use the full-resolution file');
assert.equal(resultPreview.removed,'data-preview-src','selection sync must not downgrade the result back to a thumbnail');
const [comparisonOriginal,comparisonDivider,comparisonSlider]=comparisonElements;
assert.equal(comparisonSlider.value,'0','comparison starts with the full generated image');
assert.equal(comparisonOriginal.style.clipPath,'inset(0 100% 0 0)');
comparisonSlider.value='65';comparisonSlider.oninput();
assert.equal(comparisonOriginal.style.clipPath,'inset(0 35% 0 0)');
assert.equal(comparisonDivider.style.left,'65%');
comparisonSlider.value='100';comparisonSlider.oninput();
assert.equal(comparisonOriginal.style.clipPath,'inset(0 0% 0 0)','right endpoint reveals the full original');
const result = {id:'task',url:'/output/cutout.png',model:'BEN2'};
// A thumbnail transfers the actual clicked image without submitting a cutout task.
const card = fs.readFileSync('static/modules/gallery/card.js','utf8');
let click, transferred, opened;
const storage = new Map();
const gallery = vm.createContext({
    BTN_INLINE:'', crypto:require('node:crypto').webcrypto,
    sessionStorage:{setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    document:{createElement:()=>({style:{},setAttribute:()=>{},addEventListener:(_,handler)=>{click=handler}})},
    global:{parent:{},location:{assign:url=>{opened=url;transferred=[...storage.values()][0];}},alert:message=>{throw Error(message)}}
});
vm.runInContext(card.slice(card.indexOf('    function mountCutoutAction('),card.indexOf('    let cutoutClientLoading;')),gallery);
gallery.mountCutoutAction({appendChild:()=>{}},()=>({prompt:'clicked image'}),'/output/second-image.png');
click({stopPropagation:()=>{}});
assert.match(opened,/canvas.html\?editImage=/);
assert.equal(JSON.parse(transferred).url,'/output/second-image.png');
assert.equal(storage.size,1,'same-tab navigation must preserve the payload until the canvas imports it');
let embeddedKey;
gallery.global.parent.openGalleryCanvasEditor=key=>{embeddedKey=key;return true;};
gallery.global.location.assign=()=>{throw Error('must not navigate outside the app shell');};
click({stopPropagation:()=>{}});
assert(storage.has(embeddedKey),'embedded editing routes through the app shell with its payload intact');
const shell=fs.readFileSync('static/index.html','utf8');
let returned=false;
const shellFrame={},canvasFrame={};
const previousNav={click:()=>{returned=true;}};
const canvasNav={};
const shellContext=vm.createContext({window:{},encodeURIComponent,
    document:{querySelector:selector=>selector==='iframe.active'?shellFrame:selector.includes('data-module')?canvasNav:previousNav,getElementById:()=>canvasFrame},
    switchUI:(nav,id)=>{assert.equal(nav,canvasNav);assert.equal(id,'canvas');},showFrame:()=>{}
});
vm.runInContext(shell.slice(shell.indexOf('        let imageEditorReturnFrame'),shell.indexOf('        function switchUI(')),shellContext);
assert.equal(shellContext.window.openGalleryCanvasEditor('canvas-image-edit:test'),true);
assert.match(canvasFrame.src,/editImage=canvas-image-edit/);
assert.equal(shellContext.window.returnFromGalleryCanvasEditor(),true);
assert.equal(returned,true,'back restores the original navigation instead of leaving the shell');
assert.equal(shellContext.window.returnFromGalleryCanvasEditor(),false,'return destination is consumed once');
assert.equal(context.insertCanvasCutoutResult(result,original,'canvas'),true);
assert.deepEqual(context.nodes[0],original,'source must remain unchanged');
assert.equal(context.nodes[1].editMeta.sourceUrl,original.url);
assert(context.nodes[1].x>original.x+original.w);
context.insertCanvasCutoutResult(result,original,'canvas');
assert.equal(context.nodes.length,2,'cached result must not create duplicates');
assert.equal(snapshots.length,1,'duplicate results must not consume undo history');
context.insertCanvasCutoutResult({...result,url:'/output/other-model.png'},original,'canvas');
assert.equal(context.nodes.length,3);
assert(context.nodes[2].y>context.nodes[1].y,'versions must not overlap');
assert.equal(context.insertCanvasCutoutResult(result,original,'another-canvas'),false);
let sourceLinks = context.imageSourceLinkSegments(context.nodes,new Set(['source']));
assert.equal(sourceLinks.length,2,'each derived image must show a source relationship');
assert.equal(sourceLinks[0].active,true);
assert.equal(sourceLinks[0].a.x,original.x+original.w);
context.nodes[1].x=-500;
sourceLinks=context.imageSourceLinkSegments(context.nodes,new Set());
assert.equal(sourceLinks[0].a.x,original.x,'moving a result to the left must reverse link endpoints');
assert.equal(sourceLinks[0].active,false);
assert.equal(context.imageSourceLinkSegments(context.nodes.slice(1),new Set()).length,0,'deleting the source must hide its relationship lines');
context.nodes=JSON.parse(snapshots[0]);
assert.deepEqual(context.nodes,[original],'undo snapshot must retain only the source');
vm.runInContext(fs.readFileSync('static/js/canvas-image-composer.js','utf8'),context);
vm.runInContext(fs.readFileSync('static/js/canvas-image-versions.js','utf8'),context);
context.document={getElementById:()=>null};
const editTask={id:'edit-task',prompt:'change background',model:'configured-model'};
context.insertImageEditResults(['/output/edit1.png','/output/edit1.png','/output/edit2.png'],original,editTask);
assert.equal(context.nodes.length,1,'editing must add versions to the same image card');
assert.equal(context.nodes[0].url,original.url,'new generations must not silently replace the current image');
assert.equal(context.nodes[0].imageVersions.length,3,'history includes the original and unique generated versions');
assert.equal(context.nodes[0].imageVersions[1].prompt,'change background');
context.insertImageEditResults(['/output/edit1.png'],original,editTask);
assert.equal(context.nodes[0].imageVersions.length,3,'querying a completed task must not duplicate versions');
assert(context.selectImageVersion('source',context.nodes[0].imageVersions[1].id));
assert.equal(context.nodes[0].url,'/output/edit1.png');
assert.equal(context.nodes[0].imageEditDraft,'change background');
const switched=JSON.parse(JSON.stringify(context.nodes));
assert(context.selectImageVersion('source','original'));
assert.equal(context.nodes[0].url,original.url);
assert.equal(context.nodes[0].imageVersions.length,3,'restoring the original must retain generated versions');
context.nodes=JSON.parse(snapshots.at(-1));
assert.equal(context.nodes[0].url,switched[0].url,'undo must restore the previously selected version');

(async()=>{
    const requests=[];
    context.sessionStorage={getItem:()=>JSON.stringify({url:original.url,prompt:'portrait'}),removeItem:()=>{}};
    context.fetch=async(url,options)=>{
        if(!options) return {ok:true,json:async()=>({canvases:[]})};
        requests.push({url,body:JSON.parse(options.body)});
        return {ok:true,json:async()=>({canvas:{id:'new',title:'editor'}})};
    };
    context.uid=()=> 'imported';
    context.history={replaceState:()=>requests.push({navigated:true})};
    const focused=[];
    context.loadCanvasOriginalImageDimensions=async()=>({w:1024,h:768});
    context.focusTaggedImage=id=>{focused.push(id);};
    context.openCanvas=async()=>{context.nodes=[{id:'imported',type:'image',url:original.url}];};
    context.setStatus=()=>{};
    context.alert=message=>{throw new Error(message)};
    await context.openGalleryImageEditor('canvas-image-edit:test');
    assert.equal(requests[1].body.nodes[0].url,original.url);
    assert.equal(requests[1].url,'/api/canvases/new');
    assert.equal(requests[2].navigated,true,'import must be persisted before URL navigation');
    assert.equal(focused.at(-1),'imported','new image must be focused after opening');
    assert.equal(context.nodes[0].natural_w,1024,'focus must wait for image dimensions');
    let reused;
    context.fetch=async(url,options)=>{
        assert.equal(options,undefined,'reopening an existing image must not create or overwrite a canvas');
        return {ok:true,json:async()=>({canvases:[{id:'existing',image_edit_source:original.url}]})};
    };
    context.openCanvas=async id=>{reused=id;context.nodes=[{...original}];};
    await context.openGalleryImageEditor('canvas-image-edit:test');
    assert.equal(reused,'existing','re-editing the same image reuses its saved canvas');
    assert.equal(focused.at(-1),'source','existing canvas must focus the requested image');
    console.log('Canvas image import, immutable source, cached result deduplication and undo checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
