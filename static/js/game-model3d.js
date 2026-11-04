/* 3D node UI; provider protocols and paid-task recovery live on the backend. */
(() => {
    'use strict';
    const types=['gameModelAsset','gameModel3d','gameAnimate3d'];
    const titles={gameModelAsset:'模型资产',gameModel3d:'3D 模型生成',gameAnimate3d:'3D 动画'};
    const imageNodeTypes=['image','group','output','generator','msgen','comfy','ltxDirector','rh','minimax'];
    const operations={image:'图片生成模型',text:'文字生成模型',retexture:'重新贴图',remesh:'重建网格'};
    const cache=new Map(),loading=new Map(),polling=new Set(),localBusy=new Set();
    const esc=value=>escapeHtml(String(value??''));
    const project=()=>window.GamePipeline?.project;
    const inputs=node=>connections.filter(c=>c.to===node.id).map(c=>nodes.find(n=>n.id===c.from)).filter(n=>n&&(n.projectId===node.projectId||[...imageNodeTypes,'prompt'].includes(n.type)));
    const linkedImages=node=>inputs(node).filter(n=>imageNodeTypes.includes(n.type)).flatMap(n=>imageRefsFromNode(n).map(ref=>({nodeId:n.id,url:ref.url,name:ref.name||'参考图'})));
    const selectedImages=node=>linkedImages(node).filter(ref=>!Array.isArray(node.modelRefSelection)||node.modelRefSelection.includes(JSON.stringify([ref.nodeId,ref.url])));
    const models=()=>project()?.mediaAssets?.filter(a=>a.kind==='model')||[];
    const imageAssets=()=>[...(project()?.mediaAssets||[]).filter(a=>a.kind==='image'),...(project()?.assets||[]).filter(a=>a.selected)];
    const asset=node=>models().find(a=>a.id===node.modelAssetId);
    const source=node=>inputs(node).find(n=>types.includes(n.type)&&asset(n))?.modelAssetId||node.sourceAssetId;
    const running=node=>['queued','running'].includes(node.modelJob?.status)||localBusy.has(node.id);
    const save=()=>scheduleSave();
    const refresh=node=>{save();if(nodes.includes(node))refreshNodes([node.id]);};
    const data=node=>cache.get(node.projectId)||{connections:[],catalog:[]};
    const connection=node=>data(node).connections.find(c=>c.id===node.modelConnection);
    const versions=node=>connection(node)?.models||data(node).catalog.find(c=>c.id===connection(node)?.protocol)?.models||[];
    function selectedModel(node){return versions(node).find(m=>m.id===node.modelVersion);}
    function compatible(c,node){return c.enabled&&(c.hasKey||c.authentication==='none')&&(node.type!=='gameAnimate3d'||c.protocol!=='hyper3d');}
    async function request(node,path,method='GET',body){
        const p=project();if(!p||p.id!==node.projectId||p.canvasId!==canvas?.id)throw new Error('请回到节点所属项目');
        const response=await fetch(`/api/game-projects/${encodeURIComponent(p.id)}/model3d${path}`,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
        const result=await response.json().catch(()=>({}));
        if(!response.ok){const error=new Error(typeof result.detail==='string'?result.detail:'3D 请求失败，请检查输入与连接配置');error.status=response.status;throw error;}
        if(project()?.id!==p.id||canvas?.id!==p.canvasId)throw new Error('已切换项目，请回原画布查看结果');
        return result;
    }
    async function load(node,force=false){
        if(cache.has(node.projectId)&&!force)return data(node);
        if(loading.has(node.projectId))return loading.get(node.projectId);
        const work=request(node,'/connections').then(result=>{cache.set(node.projectId,result);for(const n of nodes.filter(n=>types.includes(n.type)&&n.projectId===node.projectId))defaults(n);refreshNodes(nodes.filter(n=>types.includes(n.type)).map(n=>n.id));return result;}).catch(error=>{cache.set(node.projectId,{connections:[],catalog:[],error:error.message});throw error;}).finally(()=>loading.delete(node.projectId));
        loading.set(node.projectId,work);return work;
    }
    function defaults(node){
        if(!node.modelConnection){const c=data(node).connections.find(c=>compatible(c,node));if(c)node.modelConnection=c.id;}
        if(!node.modelVersion&&versions(node).length){node.modelVersion=versions(node)[0].id;node.targetPolycount=selectedModel(node)?.settings.polycount.default;}
    }
    function dialog(title,content){
        const el=document.createElement('dialog');el.className='m3d-dialog';
        el.innerHTML=`<header><h2>${esc(title)}</h2><button type="button" data-close aria-label="关闭">×</button></header><div class="m3d-dialog-body">${content}</div><p class="m3d-error" role="status"></p>`;
        el.querySelector('[data-close]').onclick=()=>el.close();el.addEventListener('close',()=>el.remove(),{once:true});document.body.append(el);el.showModal();return el;
    }
    const fail=(node,error)=>{node.modelNotice=error.message||String(error);refresh(node);};
    const button=(action,label,extra='')=>`<button type="button" class="tool-btn" data-m3d="${action}" ${extra}>${label}</button>`;
    function previewKey(node){if(node.modelJob?.status==='succeeded')return 'job:'+node.modelJob.jobId;const a=asset(node);return a?`${a.id}:${a.revision}:${a.contentHash}`:null;}
    function referenceImages(node){return types.includes(node?.type)&&node.modelReferenceKey===previewKey(node)&&node.modelReferenceUrl?[{url:node.modelReferenceUrl,name:'模型参考视图.png',kind:'image'}]:[];}
    function preserve(node,element){
        if(!types.includes(node?.type)||!element||element.querySelector('.m3d-screen')?.dataset.key!==previewKey(node)||!element.querySelector('.m3d-viewer'))return false;
        element.style.left=`${node.x}px`;element.style.top=`${node.y}px`;element.style.width=`${node.w||440}px`;element.classList.toggle('selected',selected.has(node.id));
        nodeBody(node,element.querySelector('.node-body'));return true;
    }
    function nodeBody(node,target){
        target.classList.add('gp-work-node','m3d-node');
        if(!project()||project().id!==node.projectId){target.textContent='正在载入游戏项目…';return;}
        if(!cache.has(node.projectId)&&!loading.has(node.projectId))void load(node).catch(error=>fail(node,error));
        const a=asset(node),locked=project().archived,busy=running(node),job=node.modelJob;
        const linkedSource=inputs(node).find(n=>types.includes(n.type)&&asset(n));
        let screen=target.querySelector('.m3d-screen');
        if(!screen){screen=document.createElement('div');screen.className='m3d-screen';target.prepend(screen);}
        const key=previewKey(node);
        if(screen.dataset.key!==(key||'')){
            screen.dataset.key=key||'';screen.replaceChildren();
            if(key){const frame=document.createElement('iframe');frame.className='m3d-viewer';frame.title=(a?.name||'候选模型')+' · 3D 预览';frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('allow','fullscreen');frame.referrerPolicy='no-referrer';frame.src=`/api/game-projects/${encodeURIComponent(node.projectId)}/model3d/`+(node.modelJob?.status==='succeeded'?`jobs/${encodeURIComponent(node.modelJob.jobId)}/preview`:`preview/${encodeURIComponent(a.id)}?revision=${a.revision}`);screen.append(frame);}
        }
        if(!key&&!screen.querySelector('.m3d-empty'))screen.innerHTML='<div class="m3d-empty"><span>◇</span><strong>3D 模型</strong><small>拖入模型，或连接上游生成模型</small></div>';
        let controls=target.querySelector('.m3d-controls');if(!controls){controls=document.createElement('div');controls.className='m3d-controls';target.append(controls);}
        let body='';
        if(node.type==='gameModelAsset'){
            body=`<label>项目模型<select data-asset><option value="">选择已有模型</option>${models().map(m=>`<option value="${esc(m.id)}" ${m.id===node.modelAssetId?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><div class="m3d-actions">${button('import',a?'替换模型':'导入模型')}${button('advanced','用途与设置')}${a?button('download','下载'):''}</div>`;
        }else{
            const cs=data(node).connections.filter(c=>compatible(c,node));
            body=`${node.type==='gameModel3d'?`<label class="m3d-operation"><select aria-label="模型操作" data-operation>${Object.entries(operations).filter(([op])=>!(op==='remesh'&&connection(node)?.protocol==='hyper3d')).map(([op,title])=>`<option value="${op}" ${op===(node.modelOperation||'image')?'selected':''}>${title}</option>`).join('')}</select></label><textarea data-prompt rows="2" placeholder="${node.modelOperation==='text'?'描述要生成的角色或物体':'可选：补充模型或贴图要求'}" aria-label="3D 提示词">${esc(node.modelPrompt)}</textarea>`:`<p class="m3d-source">源模型：${esc((linkedSource?titles[linkedSource.type]+' · ':'')+(models().find(a=>a.id===source(node))?.name||'连接模型资产或生成节点'))}</p>`}
            <label>3D 服务 / 模型<select data-model ${busy?'disabled':''}><option value="">选择 3D 模型</option>${cs.map(c=>(c.models||data(node).catalog.find(p=>p.id===c.protocol)?.models||[]).map(m=>`<option value="${esc(JSON.stringify([c.id,m.id]))}" ${c.id===node.modelConnection&&m.id===node.modelVersion?'selected':''}>${esc(m.name)} · ${esc(c.name)}</option>`).join('')).join('')}</select></label>
            <div class="m3d-actions">${job?.status==='succeeded'?button('adopt','采用生成结果'):button('generate',node.modelPending?'重试同一提交':node.type==='gameAnimate3d'?'生成绑定与动画':'生成模型',busy?'disabled':'')}${button('advanced','参数与输入')}${button('configure','⚙','title="配置 3D 服务" aria-label="配置 3D 服务"')}</div>`;
            if(node.type==='gameModel3d')body+=`<small class="m3d-context">参考图片 ${(node.imageAssetIds||[]).length+selectedImages(node).length} 张${source(node)?' · 已连接源模型':''}</small>`;
            if(busy&&job)body+=button('cancel','停止等待');
            else if(job&&['failed','cancelled','interrupted'].includes(job.status))body+=button('resume','恢复原任务');
            body+=`<div class="m3d-links">${button('history','任务记录')}${job?.status==='succeeded'?button('generate','重新生成'):''}${a?button('download','下载 GLB'):''}</div>`;
        }
        if(a)body+=`<small class="m3d-meta">${esc(a.name)} · ${(a.sizeBytes/1048576).toFixed(1)} MB · 动画 ${a.metadata.animations?.length||0}${a.enabled?'':' · 已停用'}</small>`;
        controls.innerHTML=`${body}<p class="m3d-status" role="status">${esc(node.modelNotice||job?.message||'')}</p>`;
        controls.querySelectorAll('button,input,select,textarea').forEach(el=>{if(locked)el.disabled=true;});
        controls.querySelector('[data-asset]')?.addEventListener('change',e=>{node.modelAssetId=e.target.value;refresh(node);});
        controls.querySelector('[data-operation]')?.addEventListener('change',e=>{node.modelOperation=e.target.value;refresh(node);});
        controls.querySelector('[data-prompt]')?.addEventListener('input',e=>{node.modelPrompt=e.target.value;save();});
        controls.querySelector('[data-model]')?.addEventListener('change',e=>{if(!e.target.value)return;[node.modelConnection,node.modelVersion]=JSON.parse(e.target.value);node.targetPolycount=selectedModel(node)?.settings.polycount.default;refresh(node);});
        controls.querySelectorAll('[data-m3d]').forEach(el=>el.onclick=e=>{e.stopPropagation();void action(node,el.dataset.m3d).catch(error=>fail(node,error));});
        if(key){const reference=document.createElement('div');reference.className='m3d-links';reference.innerHTML=button('reference',referenceImages(node).length?'更新参考视图':'设为参考视图','title="保存当前视角后，可连到图像、视频、LLM、策划节点"');reference.querySelector('button').disabled=locked;reference.querySelector('button').onclick=e=>{e.stopPropagation();void captureReference(node).catch(error=>fail(node,error));};controls.append(reference);}
        target.onwheel=e=>e.stopPropagation();
    }
    async function importFiles(node,files,replace=false){
        for(const file of files){
            if(file.size>(window.GameModelImport?.isModel(file)?100:32)*1048576)throw new Error('模型最大 100 MiB，图片最大 32 MiB');
            const importedFile=window.GameModelImport?.isModel(file)?await window.GameModelImport.convert(file,files):file;
            const raw=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(importedFile);});
            await window.GamePipeline.workflow(async ctx=>{
                if(ctx.project.id!==node.projectId||!nodes.includes(node))throw new Error('当前画布或节点已切换，请重新导入');
                const result=await ctx.write('/workspace/media-assets','POST',{filename:importedFile.name,purpose:node.modelPurpose||'游戏角色或场景素材',contentBase64:raw,...(replace&&node.modelAssetId?{assetId:node.modelAssetId}:{})});
                const imported=result.project.mediaAssets.find(a=>replace&&node.modelAssetId?a.id===node.modelAssetId:a===result.project.mediaAssets.at(-1));
                if(imported.kind==='model')node.modelAssetId=imported.id;
                else node.imageAssetIds=[...new Set([...(node.imageAssetIds||[]),imported.id])];
            });
        }
        refresh(node);
    }
    function pickFiles(node,images=false){return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=images?'.png,.jpg,.jpeg,.webp':window.GameModelImport.accept+',.bin,.mtl,.png,.jpg,.jpeg,.webp,.bmp,.tga';input.multiple=true;input.onchange=()=>{const files=[...input.files];void (async()=>{if(images)return importFiles(node,files);const modelFiles=files.filter(window.GameModelImport.isModel);if(modelFiles.length!==1)throw new Error('请选择一个模型，可同时选择其贴图、BIN、MTL 文件；多个模型请拖入画布');const converted=await window.GameModelImport.convert(modelFiles[0],files);await importFiles(node,[converted],true);})().catch(error=>fail(node,error));resolve();};input.oncancel=()=>resolve();input.click();});}
    async function dropModels(files,point){
        const activeCanvas=canvas?.id,modelFiles=files.filter(window.GameModelImport.isModel);
        if(!modelFiles.length)return false;
        if(files.length>128||files.reduce((n,f)=>n+f.size,0)>256*1048576)throw new Error('单批最多 128 个文件、256 MiB');
        await window.GamePipeline.ensureProject();
        for(const [index,file] of modelFiles.entries()){
            if(canvas?.id!==activeCanvas)throw new Error('画布已切换，请回原画布重新导入');
            const converted=await window.GameModelImport.convert(file,files);
            if(canvas?.id!==activeCanvas)throw new Error('画布已切换，请回原画布重新导入');
            const node=await window.GameWorkflow.addNode('gameModelAsset',{x:point.x+index*480,y:point.y});
            if(!node)throw new Error('无法创建模型节点，项目可能已归档');
            try{await importFiles(node,[converted]);}catch(error){fail(node,error);throw error;}
        }
        return true;
    }
    async function captureReference(node){
        const frame=document.querySelector(`[data-node-id="${node.id}"] iframe`)||document.getElementById(node.id)?.querySelector('iframe')||document.querySelector(`.node[data-id="${node.id}"] iframe`);
        if(!frame)throw new Error('请等待模型预览加载');
        const key=previewKey(node),activeCanvas=canvas.id,requestId=crypto.randomUUID();
        const blob=await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>{removeEventListener('message',receive);reject(new Error('参考视图读取超时，请等待模型加载后重试'));},10000);
            function receive(event){if(event.source!==frame.contentWindow||event.data?.type!=='model-reference'||event.data.requestId!==requestId)return;clearTimeout(timer);removeEventListener('message',receive);if(event.data.error)return reject(new Error(event.data.error));if(!(event.data.blob instanceof Blob)||event.data.blob.type!=='image/png'||event.data.blob.size>12*1048576)return reject(new Error('参考图无效或过大'));resolve(event.data.blob);}
            addEventListener('message',receive);frame.contentWindow.postMessage({type:'capture-model-reference',requestId},'*');
        });
        const form=new FormData();form.append('files',blob,'model-reference.png');
        const response=await fetch('/api/ai/upload',{method:'POST',body:form}),result=await response.json();
        if(!response.ok||!result.files?.[0]?.url)throw new Error('参考视图保存失败');
        if(canvas?.id!==activeCanvas||!nodes.includes(node)||previewKey(node)!==key)throw new Error('模型或画布已变化，请重新保存参考视图');
        node.modelReferenceUrl=result.files[0].url;node.modelReferenceKey=key;node.modelNotice='参考视图已保存，可连到图像、视频、LLM、策划节点';refresh(node);render();
    }
    const select=(name,label,options,value)=>`<label>${label}<select name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}" ${String(v)===String(value??'')?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
    async function advanced(node){
        const isAsset=node.type==='gameModelAsset',animate=node.type==='gameAnimate3d',a=asset(node),settings=selectedModel(node)?.settings;
        const options=node.modelOptions||{};
        const images=imageAssets(),linked=linkedImages(node);
        const el=dialog(isAsset?'模型用途与设置':animate?'动画输入与参数':'模型输入与参数',`<form>
            <label>素材用途<input name="purpose" maxlength="1000" value="${esc(node.modelPurpose||a?.purpose||'游戏角色或场景素材')}"></label>
            ${isAsset?`<label class="m3d-check"><input type="checkbox" name="enabled" ${a?.enabled!==false?'checked':''}>启用，供游戏开发使用</label>`:`
            ${select('source','源模型（连线优先）',[['','选择项目模型'],...models().map(a=>[a.id,a.name])],node.sourceAssetId)}
            ${!animate?`<fieldset><legend>参考图片</legend><div class="m3d-image-list">${images.map(a=>`<label class="m3d-check"><input type="checkbox" name="image" value="${esc(a.id)}" ${(node.imageAssetIds||[]).includes(a.id)?'checked':''}>${esc(a.name)}</label>`).join('')}${linked.map(ref=>{const key=JSON.stringify([ref.nodeId,ref.url]);return `<label class="m3d-check"><input type="checkbox" name="linkedImage" value="${esc(key)}" ${!Array.isArray(node.modelRefSelection)||node.modelRefSelection.includes(key)?'checked':''}>连线 · ${esc(ref.name)}</label>`;}).join('')}${!images.length&&!linked.length?'<small>可连接图片/生成/输出节点，或上传参考图。</small>':''}</div><button type="button" data-images>上传参考图</button><small>多视角按项目素材列表顺序，连接图片追加在后；可勾选具体输出。</small></fieldset>
            <label>目标面数<input name="faces" type="number" min="48" max="2000000" value="${node.targetPolycount||settings?.polycount.default||30000}"></label>
            <label class="m3d-check"><input type="checkbox" name="texture" ${node.modelTexture!==false?'checked':''}>生成贴图</label><label class="m3d-check"><input type="checkbox" name="pbr" ${node.modelPbr?'checked':''}>PBR 材质</label>
            ${select('pose','姿态',[['','自动'],['a-pose','A Pose'],['t-pose','T Pose']],options.pose)}
            ${select('textureQuality','贴图质量',[['','服务默认'],['fast','快速'],['standard','标准'],['detailed','精细'],['extreme','极致']],options.textureQuality)}
            <label>贴图模型版本（可选）<input name="textureModel" value="${esc(options.textureModel)}"></label>`:`
            <label>角色高度（米）<input name="height" type="number" min="0.01" max="100" step="0.01" value="${node.heightMeters||1.7}"></label>
            ${connection(node)?.protocol==='tripo'?`${select('rigModel','骨骼版本',[['v1.0-20240301','V1'],['v2.5-20260210','V2.5'],['v3.0-20260909','V3']],options.rigModel||'v1.0-20240301')}${select('rigType','角色类型',[['biped','双足'],['quadruped','四足'],['hexapod','六足'],['octopod','八足'],['serpentine','蛇形'],['aquatic','水生']],options.rigType||'biped')}<label class="m3d-check"><input name="inPlace" type="checkbox" ${options.animateInPlace?'checked':''}>原地动画</label>`:''}
            <fieldset><legend>动作库</legend><button type="button" data-library>加载动作库</button><input data-search placeholder="搜索动作名称 / 分类" aria-label="搜索动作"><div class="m3d-animation-list" data-actions>点击加载后勾选动作，可多选。</div></fieldset>`}`}
            <footer><button type="submit" class="tool-btn">保存设置</button></footer></form>`);
        const form=el.querySelector('form'),status=el.querySelector('[role="status"]');
        const value=name=>form.elements.namedItem(name)?.value;
        const checked=name=>Boolean(form.elements.namedItem(name)?.checked);
        const collectOptions=()=>Object.fromEntries(['pose','textureQuality','textureModel','rigModel','rigType'].map(k=>[k,value(k)]).filter(([,v])=>v));
        form.querySelector('[data-images]')?.addEventListener('click',()=>{el.close();void pickFiles(node,true);});
        let actions=node.modelActions||[];
        const showActions=()=>{
            const query=form.querySelector('[data-search]')?.value?.toLowerCase()||'';
            form.querySelector('[data-actions]').innerHTML=actions.filter(a=>(a.name+' '+a.category+' '+a.subCategory).toLowerCase().includes(query)).map(a=>`<div class="m3d-action-row"><label class="m3d-check"><input type="checkbox" data-action-id="${esc(JSON.stringify(a.id))}" ${(node.actionIds||[]).includes(a.id)?'checked':''}>${esc(a.name)}<small>${esc(a.category)}</small></label>${/^https?:\/\//.test(a.previewUrl||'')?`<button type="button" data-action-preview="${esc(a.previewUrl)}">预览</button>`:''}</div>`).join('')||'没有匹配动作';
            form.querySelectorAll('[data-action-id]').forEach(input=>input.onchange=()=>{const id=JSON.parse(input.dataset.actionId),ids=new Set(node.actionIds||[]);input.checked?ids.add(id):ids.delete(id);node.actionIds=[...ids];save();});
            form.querySelectorAll('[data-action-preview]').forEach(button=>button.onclick=()=>{const preview=dialog('动作预览',''),video=document.createElement('video');video.controls=true;video.playsInline=true;video.style.width='100%';video.src=button.dataset.actionPreview;preview.querySelector('.m3d-dialog-body').append(video);video.onerror=()=>{preview.querySelector('[role="status"]').textContent='服务提供的预览视频暂时无法加载';};preview.addEventListener('close',()=>{video.pause();video.removeAttribute('src');video.load();},{once:true});});
        };
        if(animate&&actions.length)showActions();
        form.querySelector('[data-search]')?.addEventListener('input',showActions);
        form.querySelector('[data-library]')?.addEventListener('click',async event=>{event.target.disabled=true;try{actions=await request(node,'/animations','POST',{connectionId:node.modelConnection,model:node.modelVersion,options:collectOptions()});node.modelActions=actions;node.actionIds=(node.actionIds||[]).filter(id=>actions.some(a=>a.id===id));showActions();status.textContent=`已加载 ${actions.length} 个动作`;}catch(error){status.textContent=error.message;}finally{event.target.disabled=false;}});
        form.onsubmit=async event=>{event.preventDefault();try{
            node.modelPurpose=value('purpose').trim();if(!node.modelPurpose)throw new Error('请填写素材用途');
            if(isAsset&&a)await window.GamePipeline.workflow(ctx=>ctx.write('/workspace/media-assets/'+a.id,'PATCH',{purpose:node.modelPurpose,enabled:checked('enabled')}));
            else if(!isAsset){node.sourceAssetId=value('source');node.modelOptions=collectOptions();
                if(animate){node.heightMeters=Number(value('height'));node.modelOptions.animateInPlace=checked('inPlace');}
                else{node.targetPolycount=Number(value('faces'));node.modelTexture=checked('texture');node.modelPbr=checked('pbr');node.imageAssetIds=[...form.querySelectorAll('[name="image"]:checked')].map(e=>e.value);node.modelRefSelection=[...form.querySelectorAll('[name="linkedImage"]:checked')].map(e=>e.value);}}
            refresh(node);el.close();
        }catch(error){status.textContent=error.message;}};
    }
    async function configure(node){
        await load(node,Boolean(data(node).error));
        const el=dialog('3D 服务连接',`<label>已有连接<select data-existing><option value="">添加新连接</option>${data(node).connections.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label><form>
        <label>名称<input name="name" required maxlength="100" value="Meshy"></label>
        ${select('protocol','协议',[['meshy','Meshy'],['tripo','Tripo'],['hyper3d','Hyper3D / Rodin']],'meshy')}
        <label>接口地址<input name="baseUrl" placeholder="留空使用官方地址"></label><label>API Key<input name="apiKey" type="password" autocomplete="new-password" placeholder="已有连接留空保留原 Key"></label>
        <label class="m3d-check"><input name="enabled" type="checkbox" checked>启用连接</label><label class="m3d-check"><input name="noAuth" type="checkbox">无需认证（仅自建兼容服务）</label>
        <details><summary>模型版本与兼容参数</summary><p>默认使用 ohmygame 的官方版本及能力表。</p><div data-model-editor></div><button type="button" data-add-model>添加自定义版本</button><label>额外请求头（JSON，可选）<textarea name="headers" placeholder='{"X-Provider":"example"}'>{}</textarea></label></details>
        <footer><button class="tool-btn" type="submit">保存连接</button><button type="button" data-balance>查询余额</button></footer></form>`);
        const form=el.querySelector('form'),status=el.querySelector('[role="status"]');let editId='',modelDefinitions=null;
        const val=n=>form.elements.namedItem(n).value;
        const showModels=()=>{const protocol=val('protocol'),presets=data(node).catalog.find(c=>c.id===protocol)?.models||[];
            const list=modelDefinitions||presets;
            form.querySelector('[data-model-editor]').innerHTML=list.map((m,i)=>`<div class="m3d-model-version"><strong>${esc(m.name)}</strong><small>${esc(m.id)} · ${m.settings.polycount.min}–${m.settings.polycount.max} 面</small><button type="button" data-edit-version="${i}">编辑</button>${!presets.some(p=>p.id===m.id)?`<button type="button" data-remove-version="${i}">移除</button>`:''}</div>`).join('');
            form.querySelectorAll('[data-edit-version]').forEach(b=>b.onclick=()=>editVersion(Number(b.dataset.editVersion)));
            form.querySelectorAll('[data-remove-version]').forEach(b=>b.onclick=()=>{modelDefinitions=structuredClone(list).filter((_,i)=>i!==Number(b.dataset.removeVersion));showModels();});};
        const editVersion=index=>{
            const protocol=val('protocol'),presets=data(node).catalog.find(c=>c.id===protocol)?.models||[],list=modelDefinitions||presets;
            const m=structuredClone(index===undefined?presets[0]:list[index]);const official=index!==undefined&&presets.some(p=>p.id===m.id);
            if(index===undefined){m.id='';m.name='';}
            const d=dialog('3D 模型版本',`<form><label>版本 ID<input name="id" value="${esc(m.id)}" ${index!==undefined?'readonly':''} required></label><label>名称<input name="name" value="${esc(m.name)}" required></label>
            <label>最小面数<input name="min" type="number" value="${m.settings.polycount.min}" ${official?'readonly':''}></label><label>最大面数<input name="max" type="number" value="${m.settings.polycount.max}" ${official?'readonly':''}></label><label>默认面数<input name="default" type="number" value="${m.settings.polycount.default}"></label>
            <label>最多参考图<input name="refs" type="number" min="1" max="9" value="${m.settings.maxReferenceImages}" ${official?'readonly':''}></label>
            ${select('operation','生成模式',[['image-to-3d','单图'],['multi-image-to-3d','多图']],m.settings.operation)}
            ${select('modelType','模型类型',[['standard','标准'],['smart-topology','智能拓扑']],m.settings.modelType)}
            <label class="m3d-check"><input name="texture" type="checkbox" ${m.settings.supportsTexture?'checked':''} ${official?'disabled':''}>支持贴图</label><label class="m3d-check"><input name="pbr" type="checkbox" ${m.settings.supportsPbr?'checked':''} ${official?'disabled':''}>支持 PBR</label><button type="submit">保存版本</button></form>`);
            const f=d.querySelector('form');if(official){f.elements.operation.disabled=true;f.elements.modelType.disabled=true;}
            f.onsubmit=e=>{e.preventDefault();const value=n=>f.elements.namedItem(n).value;m.id=value('id').trim();m.name=value('name').trim();m.settings.polycount={...m.settings.polycount,min:Number(value('min')),max:Number(value('max')),default:Number(value('default'))};m.settings.polycount.presets=m.settings.polycount.presets.filter(v=>v>=m.settings.polycount.min&&v<=m.settings.polycount.max);if(!m.settings.polycount.presets.length)m.settings.polycount.presets=[m.settings.polycount.default];m.settings.maxReferenceImages=Number(value('refs'));m.settings.operation=value('operation');m.settings.modelType=value('modelType');m.settings.supportsTexture=f.elements.texture.checked;m.settings.supportsPbr=f.elements.pbr.checked;if(!m.settings.supportsTexture)m.settings.defaults={texture:false,pbr:false};else if(!m.settings.supportsPbr)m.settings.defaults={...m.settings.defaults,pbr:false};modelDefinitions=structuredClone(list);if(index===undefined)modelDefinitions.push(m);else modelDefinitions[index]=m;showModels();d.close();};
        };
        showModels();form.querySelector('[data-add-model]').onclick=()=>editVersion();
        form.elements.protocol.onchange=()=>{modelDefinitions=null;showModels();};
        el.querySelector('[data-existing]').onchange=e=>{editId=e.target.value;const c=data(node).connections.find(c=>c.id===editId);if(!c){form.reset();modelDefinitions=null;showModels();return;}for(const k of ['name','protocol','baseUrl'])form.elements.namedItem(k).value=c[k];form.elements.enabled.checked=c.enabled;form.elements.noAuth.checked=c.authentication==='none';form.elements.apiKey.value='';form.elements.headers.value=JSON.stringify(c.headers||{});modelDefinitions=c.models?structuredClone(c.models):null;showModels();};
        form.onsubmit=async e=>{e.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;try{
            const result=await request(node,'/connections','PUT',{id:editId||uid('model3d'),name:val('name').trim(),protocol:val('protocol'),baseUrl:val('baseUrl').trim(),apiKey:val('apiKey')||null,enabled:form.elements.enabled.checked,authentication:form.elements.noAuth.checked?'none':'api_key',models:modelDefinitions,headers:JSON.parse(val('headers')||'{}')});
            node.modelConnection=result.id;node.modelVersion='';await load(node,true);defaults(node);refresh(node);el.close();
        }catch(error){status.textContent=error.message;}finally{submit.disabled=false;}};
        form.querySelector('[data-balance]').onclick=async()=>{try{if(!editId)throw new Error('请先保存连接，再选择已有连接');const c=data(node).connections.find(c=>c.id===editId),m=(c.models||data(node).catalog.find(p=>p.id===c.protocol)?.models)[0];const value=await request(node,'/balance','POST',{connectionId:c.id,model:m.id});status.textContent='余额：'+value.balance+(value.frozen!==undefined?' · 冻结：'+value.frozen:'');}catch(error){status.textContent=error.message;}};
    }
    async function start(node){
        if(running(node))return;
        if(!node.modelPending){
            if((node.modelJob?.submissionUncertain||node.modelJob?.status==='cancelled')&&!confirm('原任务可能已提交或仍在远端运行。建议先恢复原任务或到服务控制台核对。仍要新建可能重复计费的任务吗？'))return;
            if(!connection(node)||!selectedModel(node))throw new Error('请先选择或配置 3D 服务模型');
            const animate=node.type==='gameAnimate3d',operation=animate?'animate':node.modelOperation||'image',upstream=inputs(node);
            if(['animate','retexture','remesh'].includes(operation)&&upstream.filter(n=>types.includes(n.type)&&asset(n)).length>1)throw new Error('请只保留一个源模型连线，避免使用错误模型');
            const linkedPrompt=upstream.filter(n=>['prompt','document'].includes(n.type)).map(n=>n.type==='document'?project().documents.find(d=>d.id===n.docId)?.lastSavedContent:(n.text||n.prompt||'')).filter(Boolean).join('\n');
            const body={baseRevision:project().revision,requestId:crypto.randomUUID(),nodeId:node.id,connectionId:node.modelConnection,model:node.modelVersion,operation,prompt:[linkedPrompt,node.modelPrompt||''].filter(Boolean).join('\n'),imageAssetIds:['image','retexture'].includes(operation)?node.imageAssetIds||[]:[],imageNodeRefs:['image','retexture'].includes(operation)?selectedImages(node).map(({nodeId,url})=>({nodeId,url})):[],targetPolycount:node.targetPolycount||selectedModel(node).settings.polycount.default,texture:node.modelTexture!==false,pbr:Boolean(node.modelPbr),heightMeters:node.heightMeters||1.7,actionIds:node.actionIds||[],options:node.modelOptions||{}};
            if(['animate','retexture','remesh'].includes(operation)){body.sourceAssetId=source(node);if(!body.sourceAssetId)throw new Error('请连接或选择源模型');}
            if(operation==='image'&&!body.imageAssetIds.length&&!body.imageNodeRefs.length)throw new Error('请连接图片节点，或在参数与输入中添加参考图');
            if(operation==='text'&&!body.prompt.trim())throw new Error('请填写模型描述，或连接提示词节点');
            if(animate&&!body.actionIds.length)throw new Error('请在参数与输入中加载动作库并选择动作');
            if(animate&&body.actionIds.length>30)throw new Error('最多选择 30 个动作');
            node.modelPending=body;save();
        }
        localBusy.add(node.id);node.modelNotice='正在提交…';refresh(node);
        try{await window.GamePipeline.workflow(ctx=>ctx.ensureSavedCanvas());node.modelJob=await request(node,'/jobs','POST',node.modelPending);delete node.modelPending;node.modelNotice='';}
        catch(error){if(error.status&&error.status<500)delete node.modelPending;throw error;}
        finally{localBusy.delete(node.id);refresh(node);}
    }
    async function action(node,name){
        node.modelNotice='';
        if(name==='advanced')return advanced(node);
        if(name==='configure')return configure(node);
        if(name==='import')return pickFiles(node);
        if(name==='generate')return start(node);
        if(name==='download'){const a=asset(node);if(!a)throw new Error('没有可下载模型');const response=await fetch(`/api/game-projects/${node.projectId}/workspace/media-assets/${a.id}/content`);if(!response.ok)throw new Error('模型下载失败');const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=a.name.endsWith('.glb')?a.name:a.name+'.glb';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);return;}
        if(name==='resume'||name==='cancel'){node.modelJob=await request(node,`/jobs/${node.modelJob.jobId}/control/${name}`,'POST');refresh(node);return;}
        if(name==='adopt'){await window.GamePipeline.workflow(async ctx=>{const result=await ctx.write(`/model3d/jobs/${node.modelJob.jobId}/adopt`,'POST',{purpose:node.modelPurpose||'游戏角色或场景素材',name:titles[node.type]});node.modelAssetId=result.assetId;node.modelJob={...node.modelJob,status:'adopted',message:'已接入项目，可连接到游戏开发节点'};});refresh(node);return;}
        if(name==='history'){
            const jobs=(await request(node,'/jobs')).filter(j=>j.nodeId===node.id);const el=dialog('3D 任务记录',jobs.map(j=>`<article class="m3d-history"><strong>${esc(j.operation)} · ${esc(j.model)}</strong><p>${esc(j.message)}</p><small>${esc(new Date(j.createdAt*1000).toLocaleString())}</small><button data-job="${esc(j.jobId)}">查看此任务</button></article>`).join('')||'<p>还没有任务记录</p>');
            el.querySelectorAll('[data-job]').forEach(button=>button.onclick=()=>{node.modelJob=jobs.find(j=>j.jobId===button.dataset.job);refresh(node);el.close();});
        }
    }
    async function tick(){
        for(const node of nodes.filter(n=>types.includes(n.type)&&n.projectId===project()?.id&&['queued','running'].includes(n.modelJob?.status))){
            if(polling.has(node.id))continue;polling.add(node.id);
            try{const job=await request(node,'/jobs/'+node.modelJob.jobId);if(nodes.includes(node)&&job.jobId===node.modelJob?.jobId){const changed=JSON.stringify(job)!==JSON.stringify(node.modelJob);node.modelJob=job;if(changed)refresh(node);}}
            catch(error){if(nodes.includes(node)){if([403,404].includes(error.status))node.modelJob.status='interrupted';fail(node,error);}}
            finally{polling.delete(node.id);}
        }
    }
    setInterval(()=>void tick(),2500);
    function canConnect(from,to){
        if(!types.includes(from?.type)&&!types.includes(to?.type))return null;
        if(from.projectId&&to.projectId&&from.projectId!==to.projectId)return false;
        if(types.includes(from.type)){
            if(to.type==='gameDevelop'||['gameAnimate3d','gameModel3d'].includes(to.type))return from.projectId===to.projectId;
            // Canvas connections are validated before the project index has loaded.
            const hasReference=project()?.id===from.projectId?referenceImages(from).length>0:Boolean(from.modelReferenceUrl&&from.modelReferenceKey);
            return hasReference&&['generator','msgen','comfy','ltxDirector','video','rh','minimax','llm','gamePlan'].includes(to.type);
        }
        return to.type==='gameModel3d'&&[...imageNodeTypes,'prompt','document'].includes(from.type);
    }
    window.GameModel3D={types,titles,nodeBody,preserve,canConnect,referenceImages,dropModels,active:node=>types.includes(node?.type)&&Boolean(previewKey(node)),action};
})();
