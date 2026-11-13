import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../static/app/rodin3d-image-tools.js',import.meta.url),'utf8');
const tools=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const response=data=>({ok:true,json:async()=>data});
const provider={id:'web',name:'网站模型',protocol:'webai2api',image_models:['image'],model_capabilities:{image:{generation_params:{source:'website',status:'ready',max_reference_images:1,params:[{key:'ratio',default:'1:1',options:['1:1','2:3']}]}}}};
test('loads enabled providers and local image workflows, excludes other workflow kinds',async()=>{
  global.fetch=async url=>response(url==='/api/providers'?{providers:[provider,{id:'off',enabled:false,image_models:['hidden']}]}:{workflows:[{name:'text2image/qwen.json',title:'Qwen'},{name:'video/test.json'}]});
  const models=await tools.catalog();assert.equal(models.length,2);assert.equal(models[1].workflow,'text2image/qwen.json');
});
test('forwards declared website params and reference, rejects invalid or unavailable schemas',()=>{
  const model={model:'image',provider};
  const body=tools.cloudPayload(model,'参考图',[{url:'/output/ref.png'}],'1024x1024',{ratio:'2:3'});
  assert.deepEqual(body.generation_params,{ratio:'2:3'});assert.equal(body.provider_id,'web');assert.equal(body.reference_images.length,1);
  assert.throws(()=>tools.cloudPayload(model,'p',[],'1024x1024',{ratio:'bad'}),/请选择/);
  assert.throws(()=>tools.cloudPayload(model,'p',[{},{}],'1024x1024',{}),/参考图/);
});

test('reference optimizer only offers verified image-editing models and supported workflows',()=>{
  assert.equal(tools.supportsEditing({model:'image',provider}),true);
  assert.equal(tools.supportsEditing({model:'text-only',provider:{protocol:'openai'}}),false);
  assert.equal(tools.supportsEditing({model:'gpt-image-2',provider:{protocol:'codex'}}),true);
  assert.equal(tools.supportsEditing({model:'image',provider:{...provider,model_capabilities:{image:{image_policy:'forbidden'}}}}),false);
  assert.equal(tools.supportsEditing({model:'image',provider:{...provider,model_capabilities:{image:{generation_params:{status:'ready',max_reference_images:0}}}}}),false);
  assert.equal(tools.supportsEditing({workflow:'text2image/qwen-image-2.1-fast.json'}),true);
  assert.equal(tools.supportsEditing({workflow:'text2image/moss-image-sft-4step.json'}),true);
  assert.equal(tools.supportsEditing({workflow:'text2image/krea2-turbo.json'}),true);
  assert.equal(tools.supportsEditing({workflow:'text2image/flux-dev.json'}),false);
});
test('submits once, saves recovery ID, and returns existing async task image',async()=>{
  const saved=new Map();global.localStorage={setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
  let submissions=0;global.fetch=async(url,options)=>{
    if(options?.method==='POST'){submissions++;assert.equal(JSON.parse(options.body).provider_id,'web');return response({task_id:'accepted'});}
    assert.equal(url,'/api/canvas-image-tasks/accepted');return response({status:'succeeded',result:{images:[{url:'/output/result.png'}]}});
  };
  assert.equal(await tools.generate({model:'image',provider},{prompt:'test'},()=>{}),'/output/result.png');assert.equal(submissions,1);assert.equal(saved.size,0);
});
test('poll network failure preserves accepted ID without resubmission',async()=>{
  const saved=new Map();global.localStorage={setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
  let submissions=0;global.fetch=async(url,options)=>{if(options?.method==='POST'){submissions++;return response({task_id:'uncertain'});}throw new Error('offline');};
  await assert.rejects(tools.generate({model:'image',provider},{prompt:'test'},()=>{}),/offline/);
  assert.equal(submissions,1);assert.equal(JSON.parse(saved.get('rodin3d_image_task')).id,'uncertain');
});
test('local model uses shared workflow builder and Comfy task endpoint',async()=>{
  global.localStorage={setItem(){},removeItem(){}};
  global.window={ImageGenerationWorkflow:{build:async options=>{assert.equal(options.workflowName,'text2image/qwen.json');return {name:options.workflowName,workflow:{'1':{class_type:'KSampler'}}};}}};
  global.fetch=async(url,options)=>{if(options?.method==='POST'){assert.equal(url,'/api/canvas-comfy-tasks');assert.ok(JSON.parse(options.body).workflow_data);return response({task_id:'local'});}return response({status:'succeeded',result:{images:['/output/local.png']}});};
  assert.equal(await tools.generate({workflow:'text2image/qwen.json'},{prompt:'test'},()=>{}),'/output/local.png');
});
