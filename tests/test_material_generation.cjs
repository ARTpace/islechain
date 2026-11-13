const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const material={id:'material',type:'materialPbr',materialColor:'/final-color.png'};
const normal={id:'normal',type:'imageGen',materialRole:'normal',materialOwner:material.id,prompt:'Fixed UV normal',referenceImages:[{url:'/stale.png'}],generationSettings:{engine:'cloud',cloud:{provider:'mock',model:'image'},controls:{batchCount:1}}};
let creates=0,outputCalls=0,fail=false,payload;
const context={window:{addEventListener(){}},document:{addEventListener(){}},LoraManager:{state:{}},
    nodes:[material,normal],canvas:{id:'test'},crypto:{randomUUID:()=> 'request'},setTimeout,
    orderedSources:(n,s)=>s,generatorSources:()=>[{refs:[{url:'/old-color.png'},{url:'/older-color.png'}]}],imageRefsOnly:r=>r,
    scheduleSave(){},async saveCanvas(){},pushUndo(){},render(){},
    outputForNode(){outputCalls++;return null;},syncConnectedOutputsFromGenerated(){},
    fetch:async url=>({ok:true,json:async()=>url==='/api/providers'?{providers:[{id:'mock',image_models:['image']}]}:{workflows:[]}}),
    async createCanvasImageTask(p){payload=p;creates++;return {task_id:'task-'+creates};},
    async cascadeFetch(url){if(fail){fail=false;throw Error('network interrupted');}return {ok:true,json:async()=>({status:'succeeded',result:{images:['/result-'+url.split('/').pop()+'.png']}})};}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/js/canvas-generation-node.js','utf8'),context);
const api=context.window.CanvasImageGeneration;
(async()=>{
    await api.run(normal.id);
    assert.deepEqual(Array.from(payload.reference_images,r=>r.url),[material.materialColor]);
    assert.equal(normal.materialColorBasis,material.materialColor);
    assert.equal(outputCalls,0,'material image generation must not create an output node');
    assert.equal(normal.generatedOutputs.length,1);
    fail=true;await assert.rejects(api.run(normal.id),/network interrupted/);
    assert.equal(normal.imageGenerationTask.paused,true);assert.equal(creates,2);
    await api.recover(normal.id);assert.equal(creates,2,'recover queries accepted tasks even when paused');
    assert.equal(normal.generatedOutputs.length,2);assert.equal(outputCalls,0);
    await assert.rejects(api.recover(normal.id),/不会自动重发/);assert.equal(creates,2);
    const ordinary={id:'ordinary',type:'imageGen',prompt:'ordinary image',generationSettings:structuredClone(normal.generationSettings)};
    context.nodes.push(ordinary);await api.run(ordinary.id);
    assert.equal(outputCalls,1,'ordinary image nodes retain their original output behavior');
    console.log('material generation: final color only, no automatic output, safe paused recovery and ordinary-node compatibility passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
