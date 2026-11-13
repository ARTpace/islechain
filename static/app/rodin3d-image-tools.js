// Reuse the application's provider catalog, workflow builder and async task APIs.
export async function json(url, options) {
  const response=await fetch(url,options),data=await response.json();
  if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:data.error||'请求失败');
  return data;
}
export async function catalog() {
  const results=await Promise.allSettled([json('/api/providers'),json('/api/workflows/builtin')]);
  if(results.every(r=>r.status==='rejected'))throw new Error('工具模型加载失败');
  const providers=results[0].status==='fulfilled'?results[0].value.providers||[]:[];
  const workflows=results[1].status==='fulfilled'?results[1].value.workflows||[]:[];
  return [
    ...providers.filter(p=>p.enabled!==false).flatMap(provider=>(provider.image_models||[]).map(m=>({
      id:JSON.stringify([provider.id,typeof m==='string'?m:m.id||m.name]),
      label:provider.name+' · '+(typeof m==='string'?m:m.name||m.id),provider,model:typeof m==='string'?m:m.id||m.name
    }))),
    ...workflows.filter(w=>w.name.startsWith('text2image/')).map(w=>({id:JSON.stringify(['local',w.name]),label:'本地 · '+(w.title||w.name),workflow:w.name}))
  ];
}
export function supportsEditing(model) {
  if(model.workflow)return /(?:qwen-image-2\.1(?:-fast|-turbo)?|moss-image-sft(?:-fast|-4step)?|flux3-klein|krea2[^/]*)\.json$/i.test(model.workflow);
  const cap=model.provider?.model_capabilities?.[model.model];
  if(cap?.available===false||cap?.image_policy==='forbidden')return false;
  const declared=schema(model);
  if(model.provider?.protocol==='webai2api')return declared?.status==='ready'&&declared.max_reference_images>=1;
  return ['optional','required'].includes(cap?.image_policy)||cap?.supports_image_edit===true||/^gpt-image-/i.test(model.model);
}
export function schema(model, values={}) {
  const base=model?.provider?.model_capabilities?.[model.model]?.generation_params;
  return base?.byProvider?base.byProvider[values.provider??base.params?.find(p=>p.key==='provider')?.default]:base;
}
export function cloudPayload(model,prompt,refs,size,values) {
  const declared=schema(model,values),params={};
  if(declared?.source==='website'&&declared.status!=='ready')throw new Error(declared.message||'网站参数未就绪，请刷新模型');
  if(declared?.source==='website'&&refs.length&&(!Number.isInteger(declared.max_reference_images)||refs.length>declared.max_reference_images))throw new Error('当前模型不支持这些参考图');
  for(const p of declared?.params||[]) {
    const v=values[p.key]??p.default,choices=(p.options||[]).map(o=>typeof o==='object'?o.value:o);
    if(!choices.some(c=>String(c)===String(v)))throw new Error('请选择'+(p.label||p.key));
    params[p.key]=choices.find(c=>String(c)===String(v));
  }
  return {prompt,model:model.model,provider_id:model.provider.id,protocol:model.provider.protocol||'openai',
    size,quality:'medium',reference_images:refs,generation_params:params,feature:'3d-reference'};
}
export async function generate(model,{prompt,reference,size='1024x1024',values={}},status) {
  if(!prompt.trim())throw new Error('请输入提示词');
  const refs=reference?[{url:reference,name:'reference.png'}]:[];
  let payload,path;
  if(model.workflow) {
    const [width,height]=size.split('x').map(Number);
    const built=await window.ImageGenerationWorkflow.build({workflowName:model.workflow,prompt,seed:Math.floor(Math.random()*1e15),
      size:{width,height},controls:{batchCount:1,ratioW:width,ratioH:height,seedMode:'random'},refs,
      referenceNames:async()=>Promise.all(refs.map(async ref=>{
        const response=await fetch(ref.url);if(!response.ok)throw new Error('参考图读取失败');
        const form=new FormData();form.append('files',await response.blob(),'reference.png');
        const uploaded=await json('/api/upload',{method:'POST',body:form});
        if(!uploaded.files?.[0]?.comfy_name)throw new Error('参考图上传失败');return uploaded.files[0].comfy_name;
      }))});
    payload={prompt,workflow_json:built.name,workflow_data:built.workflow,width,height,client_id:crypto.randomUUID(),feature:'3d-reference'};
    path='/api/canvas-comfy-tasks';
  } else {payload=cloudPayload(model,prompt,refs,size,values);path='/api/canvas-image-tasks';}
  // Submit once. Save the accepted ID before polling so a network error never retries generation.
  const created=await json(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const task={path,id:created.task_id};localStorage.setItem('rodin3d_image_task',JSON.stringify(task));
  return wait(task,status);
}
export async function wait(task,status) {
  for(;;){
    const data=await json(task.path+'/'+encodeURIComponent(task.id));status('生图中 · '+task.id);
    if(data.status==='failed'){localStorage.removeItem('rodin3d_image_task');throw new Error(data.error||'生成失败');}
    if(data.status==='succeeded'){
      const image=(data.result?.images||[])[0],url=typeof image==='string'?image:image?.url;
      if(!url)throw new Error('未返回图片');localStorage.removeItem('rodin3d_image_task');return url;
    }
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
}
