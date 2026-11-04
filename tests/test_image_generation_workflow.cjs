const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={window:{},console:{log(){},warn(){},groupCollapsed(){},groupEnd(){}},LoraManager:{injectNodes:(workflow,loras)=>{context.injected=loras;}},fetch:async url=>{const name=decodeURIComponent(url.split('/').pop());return {ok:true,json:async()=>({workflow:JSON.parse(fs.readFileSync('workflows/'+name,'utf8'))})};}};
vm.createContext(context);vm.runInContext(fs.readFileSync('static/modules/image-generation-workflow.js','utf8'),context);
const build=context.window.ImageGenerationWorkflow.build;
const base={prompt:'unique positive prompt',seed:123,size:{width:768,height:1024},controls:{ratioW:3,ratioH:4,batchCount:2,seedMode:'fixed',fixedSeed:123},presetPrompts:'style token'};
(async()=>{
 for(const name of fs.readdirSync('workflows/text2image').filter(n=>n.endsWith('.json')&&!n.endsWith('.config.json'))){
  const result=await build({...base,workflowName:'text2image/'+name});const text=JSON.stringify(result.workflow);assert(text.includes('unique positive prompt'),name+' must receive the prompt');assert(text.includes('123'),name+' must receive the seed');
 }
 const first=await build({...base,workflowName:'text2image/z-image.json',unet:'custom.safetensors',loras:[{name:'hero.safetensors',strength:0.5}]});assert.equal(first.workflow['144'].inputs.width,768);assert.equal(first.workflow['144'].inputs.batch_size,2);assert.equal(context.injected[0].name,'hero.safetensors');
 const second=await build({...base,workflowName:'text2image/z-image.json',prompt:'second',size:{width:1024,height:1024}});assert.equal(first.workflow['23'].inputs.text,'unique positive prompt');assert.equal(second.workflow['23'].inputs.text,'second','cached workflows must be cloned');
 for(const name of ['qwen-image-2.1','moss-image-sft','flux3-klein','krea2-turbo']){const edited=await build({...base,workflowName:'text2image/'+name+'.json',refs:[{url:'/output/a.png'}],referenceNames:async()=>['a.png']});assert(edited.name.startsWith('image-edit/'),name+' must use reference workflow');assert(JSON.stringify(edited.workflow).includes('a.png'));}
 await assert.rejects(build({...base,workflowName:'text2image/z-image.json',refs:[{}]}),/未接入/);
 console.log('IMAGE_GENERATION_WORKFLOW_OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
