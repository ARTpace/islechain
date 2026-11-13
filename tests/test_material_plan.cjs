const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const reference={id:'ref',url:'/assets/reference.png',sourceId:'ref'};
const presets=fs.readdirSync('packs/material-skills').map(id=>({...JSON.parse(fs.readFileSync('packs/material-skills/'+id+'/preset.json','utf8')),id,skill:fs.readFileSync('packs/material-skills/'+id+'/SKILL.md','utf8')}));
const node={id:'material',type:'materialPbr',x:0,y:0,materialDescription:'蓝色釉面陶瓷'};
let count=0,calls=[],aiCalls=0,derived=0;
const element=()=>({children:[],append(...items){this.children.push(...items);},setAttribute(){}});
const context={window:{},document:{createElement:element},Option:function(text,value){return {text,value};},
    nodes:[node],connections:[],canvas:{id:'canvas'},structuredClone,
    scheduleSave(){},render(){},async saveCanvas(){},focusCreatedNode(){},
    chatApiProviders:()=>[{id:'my-chat',chat_models:['my-model']},{id:'disabled',has_key:true,enabled:false,chat_models:['hidden']},{id:'local',has_key:false,chat_models:['local-model']}],
    fetch:async()=>({ok:true,json:async()=>({presets})}),
    addPromptNode:point=>{const p={id:'prompt'+count++,type:'prompt',...point};context.nodes.push(p);return p;},
    addImageGenerationNode:point=>{const p={id:'image'+count++,type:'imageGen',...point,generationSettings:{engine:'cloud',cloud:{model:'my-image'}}};context.nodes.push(p);return p;},
    async callCanvasLLM(descriptor,message,history,options){
        aiCalls++;assert.equal(descriptor.llmProvider,'my-chat');assert.deepEqual(Array.from(options.images),[reference.url]);
        assert.ok(descriptor.systemPrompt.includes('ai-pbr-material'));
        return JSON.stringify({colorPrompt:'Blue glazed ceramic seamless unlit tile',normalPrompt:'Fixed UV OpenGL normal',roughness:.2,metallic:0,notes:'需要检查对齐与平铺'});
    }};
vm.createContext(context);
// 规划脚本走的是 window.LlmNode.callCanvasLLM（LLM 节点已模块化），这里把桩挂到同一个位置
context.window.LlmNode={callCanvasLLM:context.callCanvasLLM};
vm.runInContext(fs.readFileSync('static/js/canvas-material-plan.js','utf8'),context);
const api={refs:()=>[reference],async derive(n){derived++;assert.ok(n.materialColor.endsWith('color.png'));if(n.materialPlan.workflow==='color-normal')assert.ok(n.materialNormal.endsWith('normal.png'));else assert.equal(n.materialNormal,'');n.materialJob={status:'succeeded'};}};
const controls=()=>context.window.CanvasMaterialPlan.controls(node,api,(label,action)=>({label,action}));
const flatten=e=>[e,...(e.children||[]).flatMap(flatten)];
const click=label=>flatten(controls()).find(b=>b.label===label).action();
const generate=async(id,options)=>{
    const source=context.nodes.find(n=>n.id===id),kind=source.materialRole,owner=context.nodes.find(n=>n.id===source.materialOwner);
    calls.push(kind);assert.equal(options.materialPrompt,kind==='color'?'Blue glazed ceramic seamless unlit tile':'Fixed UV OpenGL normal');
    assert.equal(source.referenceImages[0].url,kind==='color'?reference.url:owner.materialColor);
    source.generatedOutputs=[{url:'/output/'+(owner===node?'':owner.id+'-')+kind+'.png'}];
};
context.window.CanvasImageGeneration={run:generate};
(async()=>{
    controls();await new Promise(resolve=>setImmediate(resolve));
    const model=controls().children[0];assert.equal(model.children.length,3,'configured models remain selectable without key metadata; disabled providers are excluded');
    assert.equal(model.disabled,false);assert.equal(model.value,JSON.stringify(['my-chat','my-model']));
    node.materialTextModel='removed-model';
    assert.equal(flatten(controls()).find(b=>b.label==='编写提示词').disabled,true);
    const replacement=controls().children[0];replacement.value=JSON.stringify(['local','local-model']);replacement.onchange();
    assert.equal(node.materialTextProvider,'local');assert.equal(node.materialTextModel,'local-model');
    assert.equal(flatten(controls()).find(b=>b.label==='编写提示词').disabled,false,'selecting a replacement model enables prompt planning');
    replacement.value=JSON.stringify(['my-chat','my-model']);replacement.onchange();
    await click('编写提示词');
    assert.equal(aiCalls,1);assert.equal(calls.length,0,'planning must not generate images');
    assert.equal(context.nodes.filter(n=>n.type==='prompt').length,0);
    assert.equal(context.nodes.filter(n=>n.type==='imageGen').length,2);
    assert(context.connections.some(c=>c.from===node.materialHelper_color&&c.to===node.materialHelper_normal));
    assert.equal(context.nodes.find(n=>n.id===node.materialHelper_color).prompt,'Blue glazed ceramic seamless unlit tile');
    assert.equal(node.materialRoughness,.2);
    node.materialDescription='输入已变';
    await assert.rejects(click('生成贴图'),/需求或参考图已改变/);
    node.materialDescription='蓝色釉面陶瓷';
    const normal=context.nodes.find(n=>n.id===node.materialHelper_normal);normal.generationSettings.cloud.model='independent-normal-model';
    await click('生成贴图');
    assert.equal(normal.generationSettings.cloud.model,'independent-normal-model','normal keeps its independently selected model');
    assert.deepEqual(calls,['color','normal']);assert.equal(derived,1);assert.equal(node.materialPipeline.status,'done');
    const color=context.nodes.find(n=>n.id===node.materialHelper_color);
    node.materialPipeline={status:'failed',stage:'color',started:true,before:['/output/color.png'],prompts:['Blue glazed ceramic seamless unlit tile','Fixed UV OpenGL normal']};
    await assert.rejects(click('继续流程'),/不会自动重发/);
    assert.equal(calls.length,2,'unknown accepted request must never be resubmitted');
    color.imageGenerationTask={requests:[{id:'saved-task'}]};
    context.window.CanvasImageGeneration.recover=async id=>{
        assert.equal(id,color.id);calls.push('resume');color.generatedOutputs=[{url:'/output/recovered.png'}];delete color.imageGenerationTask;
    };
    // Resume a completed color task, then stop rather than submit a normal if the requirement changed.
    context.saveCanvas=async()=>{node.materialDescription='changed while running';};
    await assert.rejects(click('继续流程'),/需求或参考图已改变/);
    assert.equal(calls.at(-1),'resume');assert.equal(calls.length,3);
    context.saveCanvas=async()=>{};node.materialDescription='蓝色釉面陶瓷';node.materialPipeline=null;
    const defaultSystem=context.callCanvasLLM;
    context.window.LlmNode.callCanvasLLM=async(...args)=>{assert.ok(args[0].systemPrompt.includes('快速原型制作'));return defaultSystem(...args);};
    node.materialPreset='quick';await click('编写提示词');
    color.generatedOutputs=[];context.window.CanvasImageGeneration.run=generate;
    const before=calls.length;await click('生成贴图');assert.equal(calls.length,before+1,'quick preset skips paid normal generation');
    assert.equal(node.materialNormal,'');assert.equal(node.materialPlan.workflow,'color-only');
    assert.equal(node.materialAlgorithm,undefined,'quick workflow retains the AI controls');
    context.window.LlmNode.callCanvasLLM=defaultSystem;
    node.materialBatchText='灰色岩石\n红色陶瓷';
    context.window.CanvasMaterials={create(point){const child={id:'batch'+count++,type:'materialPbr',...point};context.nodes.push(child);return child;}};
    await click('准备批量');assert.equal(node.materialBatch.items.length,2);
    assert.equal(node.materialBatch.status,'ready');
    const imageCalls=calls.length;await click('生成 / 继续批量');
    assert.equal(calls.length,imageCalls+2);assert.equal(node.materialBatch.status,'done');
    for(const item of node.materialBatch.items){assert.equal(item.status,'done');assert.equal(context.nodes.find(n=>n.id===item.nodeId).materialJob.status,'succeeded');}
    assert.equal(context.nodes.filter(n=>n.type==='prompt'||n.type==='output').length,0);
    await click('新建批次');await click('准备批量');
    let attempts=0;
    context.window.CanvasImageGeneration.run=async(id,options)=>{
        attempts++;if(attempts===1)throw Error('accepted task state unknown');
        return generate(id,options);
    };
    await assert.rejects(click('生成 / 继续批量'),/state unknown/);
    assert.equal(node.materialBatch.status,'paused');assert.equal(attempts,1,'batch stops before the next material after failure');
    await assert.rejects(click('生成 / 继续批量'),/不会自动重发/);
    assert.equal(attempts,1,'continuing an unknown submission must not create another image request');
    console.log('material plan: direct image graph, configured models, persona workflows, independent models, sequential batch and safe recovery passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
