const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const color={id:'color',type:'image',url:'/assets/alice/color.png'};
const normal={id:'normal',type:'image',url:'/assets/alice/normal.png',materialColorBasis:color.url};
const node={id:'pbr',type:'materialPbr',materialColor:color.url,materialNormal:normal.url};
const context={window:{},canvas:{id:'test'},nodes:[color,normal,node],
    connections:[{from:'color',to:'pbr'},{from:'normal',to:'pbr'}],
    imageRefsFromNode:n=>n.url?[{url:n.url,name:n.id}]:[],setTimeout,clearTimeout};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/js/canvas-materials.js','utf8'),context);
const api=context.window.CanvasMaterials;
node.materialJob={inputs:{colorUrl:color.url,normalUrl:normal.url,size:1024,normalFormat:'opengl',roughness:.66,metallic:0},
    result:{maps:{basecolor:'/assets/alice/maps/basecolor.png',normal:'/assets/alice/maps/normal.png'}}};
// Existing normal output must never acquire a new color basis when the helper is reused.
assert.equal(api.images(node).length,0);
api.recordGeneration(normal,[{url:normal.url}],{refs:[{url:color.url}]});
assert.equal(api.images(node).length,2);
normal.materialColorBasis='/assets/alice/new-color.png';
assert.equal(api.images(node).length,2);
api.recordGeneration(normal,[{url:'/assets/alice/new-normal.png'}],{refs:[{url:normal.materialColorBasis}]});
assert.equal(normal.materialNormalBases[normal.url],color.url);
node.materialRoughness=.8;
assert.equal(api.images(node).length,0,'changed parameters cannot feed stale maps downstream');
delete node.materialRoughness;
context.connections.pop();
assert.equal(api.images(node).length,0,'disconnected normal invalidates previous result');
context.connections.push({from:'normal',to:'pbr'});
assert.equal(api.images(node).length,2);
node.materialColor='/assets/alice/new-color.png';
node.materialJob.inputs.colorUrl=node.materialColor;
color.url=node.materialColor;
assert.equal(api.images(node).length,0,'normal generated from old color must be rejected');
assert.equal(api.canConnect(node,{type:'output'}),true);
assert.equal(api.canConnect(node,{type:'materialPbr'}),false);
console.log('material UI: source disconnection, stale maps and immutable normal basis passed');

// Preparing helpers must work without any configured cloud provider or paid API call.
(async()=>{
    const elements=[];
    context.document={createElement:()=>{
        const element={append(){},addEventListener(){},setAttribute(){}};
        elements.push(element);return element;
    }};
    context.Option=function(text,value){return {text,value};};
    const previewUrls=[];
    context.openOutputLightbox=url=>previewUrls.push(url);
    const previewFiles=['basecolor_2x2.jpg','normal_2x2.jpg','basecolor_offset.png','normal_offset.png'];
    context.document.createTextNode=text=>({text});
    api.body({id:'preview',type:'materialPbr',materialJob:{result:{maps:{basecolor:'/maps/color.png'},checks:{},previews:Object.fromEntries(previewFiles.map(file=>[file,'/maps/'+file])),limitations:''}}});
    const previewButtons=elements.filter(e=>['色 2×2','法 2×2','色 偏移','法 偏移'].includes(e.textContent));
    assert.equal(previewButtons.length,4);
    for(const control of previewButtons)control.onclick();
    assert.deepEqual(previewUrls,previewFiles.map(file=>'/maps/'+file),'all material checks open the in-page image viewer');
    elements.find(e=>e.href==='/maps/color.png').onclick({preventDefault(){},stopPropagation(){}});
    assert.equal(previewUrls.at(-1),'/maps/color.png','map thumbnails open the same in-page viewer');
    const canvasSource=fs.readFileSync('static/js/canvas.js','utf8');
    vm.runInContext(canvasSource.slice(canvasSource.indexOf('function isNodeControl('),canvasSource.indexOf('function destroyLTXEditor(')),context);
    assert.equal(context.isNodeControl({closest:selector=>selector.split(',').map(s=>s.trim()).includes('a[href]')}),true,'image links must not start node dragging');
    context.structuredClone=structuredClone;
    context.scheduleSave=context.render=context.focusCreatedNode=()=>{};
    context.alert=message=>{throw Error(message);};
    context.addImageGenerationNode=point=>{
        const helper={id:'helper-'+context.nodes.length,type:'imageGen',...point,generationSettings:null};
        context.nodes.push(helper);return helper;
    };
    const material={id:'free-model',type:'materialPbr',x:0,y:0,materialColor:color.url,materialDescription:'灰色火山岩，细孔，随机分布'};
    context.nodes.push(material);
    const click=async label=>{
        elements.length=0;api.body(material);
        await elements.find(e=>e.textContent===label).onclick();
    };
    await click('准备 AI 颜色节点');
    const colorHelper=context.nodes.find(n=>n.id===material.materialHelper_color);
    assert.equal(colorHelper.generationSettings,null,'use native default without requiring cloud configuration');
    assert.ok(colorHelper.prompt.includes(material.materialDescription));
    assert.ok(!/木板|木纹|plank|wood/i.test(colorHelper.prompt));
    material.materialDescription='蓝色釉面陶瓷，细密开片';
    await click('准备 AI 颜色节点');
    assert.ok(colorHelper.prompt.includes(material.materialDescription));
    assert.ok(!colorHelper.prompt.includes('火山岩'));
    material.materialDescription='';
    await assert.rejects(click('准备 AI 颜色节点'),/填写要生成的材质/);
    context.connections.push({from:'color',to:material.id});
    await click('准备 AI 颜色节点');
    assert.ok(colorHelper.prompt.includes('attached reference'));
    assert.equal(colorHelper.referenceImages[0].url,color.url);
    colorHelper.generationSettings={engine:'cloud',cloud:{provider:'my-provider',model:'my-image-model'}};
    await click('准备 AI 法线节点');
    const normalHelper=context.nodes.find(n=>n.id===material.materialHelper_normal);
    assert.ok(!/wood|plank|grain subtle|Gaps and chips/.test(normalHelper.prompt));
    assert.deepEqual(normalHelper.generationSettings,colorHelper.generationSettings);
    assert.notEqual(normalHelper.generationSettings,colorHelper.generationSettings);
    normalHelper.generationSettings.cloud.model='another-model';
    await click('准备 AI 法线节点');
    assert.equal(normalHelper.generationSettings.cloud.model,'another-model','reuse preserves user model choice');
    console.log('material helpers: no provider requirement, custom models and preserved settings passed');
    material.materialAlgorithm=true;
    material.materialNormal='/missing-old-normal.png';
    context.crypto={randomUUID:()=> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
    context.saveCanvas=async()=>{};
    let submitted;
    context.fetch=async(url,options)=>{
        submitted=JSON.parse(options.body);
        return {ok:true,json:async()=>({id:submitted.requestId,status:'running',designer:{status:'not_sent'}})};
    };
    await click('从颜色图生成整套 PBR');
    assert.equal(submitted.colorUrl,color.url);
    assert.equal(submitted.normalUrl,'','color-only mode must not reuse an old normal');
    assert.equal(submitted.normalFormat,'opengl');
    material.materialJob.result={maps:{normal:'/maps/normal.png'}};
    assert.equal(api.images(material).length,1);
    material.materialAlgorithm=false;
    assert.equal(api.images(material).length,0,'switching modes invalidates algorithm results');
    console.log('color-only UI: local computation, no old normal and mode invalidation passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
