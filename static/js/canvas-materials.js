/* Native material workflow. AI jobs stay in the existing image-generation nodes. */
(function(){
    'use strict';
    const active=new Set(),pollers=new Map(),pollStarted=new Map(),previewing=new Map();
    const names={basecolor:'颜色',normal:'法线 · OpenGL',height:'高度',ao:'AO',roughness:'粗糙度',metallic:'金属度'};
    const newId=()=>crypto.randomUUID().replaceAll('-','');
    const key=n=>canvas.id+':'+n.id;
    async function request(url,body){
        const response=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const data=await response.json();if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'请求失败（'+response.status+'）');return data;
    }
    function refs(node){
        return connections.filter(c=>c.to===node.id).flatMap(c=>{
            const source=nodes.find(n=>n.id===c.from);
            if(!source)return [];
            return imageRefsFromNode(source).map(r=>({...r,sourceId:source.id,label:(source.name||source.type)+' · '+(r.name||r.url.split('/').pop())}));
        }).filter((r,i,a)=>a.findIndex(x=>x.url===r.url)===i);
    }
    const colorOnly=node=>node.materialAlgorithm||node.materialPlan?.workflow==='color-only';
    function parameters(node){return {colorUrl:node.materialColor||'',normalUrl:colorOnly(node)?'':node.materialNormal||'',size:Number(node.materialSize||1024),normalFormat:colorOnly(node)?'opengl':node.materialNormalFormat||'opengl',roughness:Number(node.materialRoughness??.66),metallic:Number(node.materialMetallic??0)};}
    function stale(node){
        if(!node.materialJob)return false;
        if(JSON.stringify(parameters(node))!==JSON.stringify(node.materialJob.inputs))return true;
        try{validate(node);return false;}catch{return true;}
    }
    function save(){scheduleSave();render();}
    function button(label,action){
        const b=document.createElement('button');b.type='button';b.className='imagegen-control';b.textContent=label;
        b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){b.disabled=false;alert(e.message||'操作失败');}};return b;
    }
    function create(point){return addNode({id:uid('material'),type:'materialPbr',x:point.x,y:point.y,w:440,materialDescription:'',materialSize:1024,materialRoughness:.66,materialMetallic:0,materialNormalFormat:'opengl'});}
    // One asset node handles models and material previews; reuse before creating another card.
    function ballPreview(node){
        if(!node.materialJob?.result?.maps)throw Error('请先计算 PBR 贴图');
        const id=key(node);if(previewing.has(id))return previewing.get(id);
        const owner=canvas.id;
        const task=Promise.resolve().then(async()=>{
            const linked=type=>nodes.find(n=>n.type===type&&connections.some(c=>c.from===node.id&&c.to===n.id));
            let target=linked('gameModelAsset')||linked('model3d');
            const project=window.GamePipeline?.project;
            if(!target&&project?.canvasId===owner&&!project.archived)target=nodes.find(n=>n.type==='gameModelAsset'&&n.projectId===project.id&&!n.modelAssetId&&!n.modelJob&&!n.url&&!connections.some(c=>c.to===n.id));
            if(target?.type==='model3d')await window.GameModel3D.adoptLocal(target);
            if(!target)target=await window.GameWorkflow.addNode('gameModelAsset',{x:node.x+520,y:node.y});
            if(canvas.id!==owner||!nodes.includes(node)||!nodes.includes(target))throw Error('画布已切换，预览操作已停止');
            if(!connections.some(c=>c.from===node.id&&c.to===target.id))connections.push({id:uid('c'),from:node.id,to:target.id});
            target.materialPreview='sphere';
            scheduleSave();render();focusCreatedNode(target);return target;
        }).finally(()=>previewing.delete(id));
        previewing.set(id,task);return task;
    }
    function populateMenu(menu){
        if(menu.querySelector('[data-catalog-type="materialPbr"]'))return;
        const b=button('PBR 材质 · AI → Designer',()=>menuAdd('materialPbr'));b.className='menu-btn';b.dataset.catalogType='materialPbr';b.dataset.keywords='material texture 材质 木板 地砖 法线 substance';menu.append(b);
    }
    function images(node){return stale(node)?[]:Object.entries(node.materialJob?.result?.maps||{}).map(([channel,url])=>({url,name:names[channel],kind:'image'}));}
    function canConnect(from,to){
        if(to.type==='materialPbr')return from.type!=='materialPbr'&&imageRefsFromNode(from).length>0||['imageGen','generator','comfy','msgen','rh'].includes(from.type);
        // PBR 材质可以直连模型资产：资产节点自己识别通道并显示材质球，不必再建一个「3D 模型」节点。
        if(from.type==='materialPbr')return ['output','imageGen','model3d','gameModelAsset'].includes(to.type);
        // 3D 节点接收 PBR 贴图：材质节点的整套通道，或带通道名的单张贴图。
        // 其它来源（例如 AI 建模产物）返回 undefined，交给 GameModel3D 自己判定，别在这里截断。
        if(to.type==='model3d'||to.type==='gameModelAsset'){
            if(!['image','imageGen','generator','comfy','msgen','rh'].includes(from.type))return undefined;
            return imageRefsFromNode(from).length>0;
        }
        return undefined;
    }
    function recordGeneration(node,items,snapshot){
        const owner=nodes.find(n=>n.id===node.materialOwner&&n.type==='materialPbr');
        if(owner&&items.length){
            owner[node.materialRole==='normal'?'materialNormal':'materialColor']=items.at(-1).url;
        }
        if(!node.materialColorBasis)return;
        const basis=snapshot.refs?.[0]?.url;if(!basis)return;
        node.materialNormalBases ||= {};
        for(const item of items)node.materialNormalBases[item.url]=basis;
    }
    async function helper(node,kind){
        if(kind==='normal'&&!node.materialColor)throw Error('请先生成并选择颜色图');
        let source=nodes.find(n=>n.id===node['materialHelper_'+kind]);
        if(source?.imageGenerationTask)throw Error('该生图节点已有待完成任务，请先处理原任务');
        const color=kind==='normal'?node.materialColor:null;
        const references=kind==='normal'?[{url:color,name:'最终颜色图',kind:'image'}]:refs(node).filter(r=>r.sourceId!==node.materialHelper_normal&&r.sourceId!==node.materialHelper_color).slice(0,1);
        const description=(node.materialDescription||'').trim();
        if(kind==='color'&&!description&&!references.length)throw Error('请填写要生成的材质，或连接一张参考图片');
        const prompt=kind==='normal'
            ?'Convert this exact fixed UV color texture to a tangent-space OpenGL +Y normal map. Infer relief appropriate to the depicted material. Keep every surface feature and pattern boundary at the SAME pixel positions. Do not translate, scale, warp, add or redraw features. Represent only plausible surface geometry; do not invent joints, pores, fibers or damage absent from the input. Flat surfaces use RGB(128,128,255). Color differences alone must not become slopes. No lighting, albedo color, text or preview. Preserve periodic edges. Return one full-frame map.'
            :'Create ONE orthographic, unlit basecolor texture. '+(description?'Material requirements: '+description+'. ':'')+(references.length?'Extract the target surface material from the attached reference; preserve its material identity, palette, relative pattern scale and surface characteristics. Remove perspective, lighting and unrelated objects; reconstruct only missing surface areas. ':'')+'Design a repeat unit appropriate to this material FIRST; preserve its natural regularity or irregularity without adding an artificial grid or joints. Opposite edges must continue at identical coordinates, color and tangent. Seamless periodic tile, no frame, vignette, cast shadow, highlight, text, collage or preview object.';
        if(!source){
            source=addImageGenerationNode({x:node.x-520,y:node.y+(kind==='normal'?460:0)});
            const colorHelper=kind==='normal'&&nodes.find(n=>n.id===node.materialHelper_color);
            if(colorHelper?.generationSettings)source.generationSettings=structuredClone(colorHelper.generationSettings);
            node['materialHelper_'+kind]=source.id;
            connections.push({from:source.id,to:node.id});
        }
        source.prompt=prompt;source.referenceImages=references.map(({url,name,kind})=>({url,name,kind}));
        source.materialRole=kind;source.materialOwner=node.id;
        if(color)source.materialColorBasis=color;
        source.name=kind==='normal'?'材质 AI 法线':'材质 AI 颜色';
        node.materialMessage='已准备'+(kind==='normal'?'法线':'颜色')+'生图节点，请在该节点点击“生成”；完成后在这里选择结果。';
        save();focusCreatedNode(source);
    }
    function validate(node){
        const input=parameters(node),available=refs(node);
        if(colorOnly(node)){
            if(!input.colorUrl||!available.some(r=>r.url===input.colorUrl))throw Error('请连接并选择一张颜色图');
            return input;
        }
        if(!input.colorUrl||!input.normalUrl)throw Error('请连接并选择颜色图与法线图');
        if(input.colorUrl===input.normalUrl)throw Error('颜色和法线不能使用同一张图');
        if(!available.some(r=>r.url===input.colorUrl)||!available.some(r=>r.url===input.normalUrl))throw Error('所选图片已断开，请重新选择当前输入');
        const normalSource=available.find(r=>r.url===input.normalUrl)?.sourceId;
        const helperNode=nodes.find(n=>n.id===normalSource);
        if(helperNode?.materialColorBasis&&helperNode.materialNormalBases?.[input.normalUrl]!==input.colorUrl)throw Error('该法线不对应当前颜色，请基于新颜色重新生成并选择法线');
        return input;
    }
    async function derive(node){
        const id=key(node);if(active.has(id))return;
        const inputs=validate(node);active.add(id);
        try{
            const existing=node.materialJob;
            if(existing&&JSON.stringify(existing.inputs)===JSON.stringify(inputs)&&!['failed','interrupted'].includes(existing.status)){
                await refresh(node);return;
            }
            node.materialJob={id:newId(),inputs,status:'submitting'};node.materialMessage='正在保存并提交 PBR 计算…';
            await saveCanvas();
            const owner=canvas.id,job=node.materialJob;
            try{const state=await request('/api/materials/'+owner+'/jobs',{requestId:job.id,...inputs});apply(node,state,owner);}
            catch(error){node.materialMessage=error.message+'；可点击“查询 / 恢复任务”，保留原任务 ID 防止重复提交';save();throw error;}
        }finally{active.delete(id);}
    }
    function apply(node,state,owner){
        if(canvas.id!==owner||!nodes.includes(node)||node.materialJob?.id!==state.id)return;
        const old=node.materialJob;
        node.materialJob={...state,inputs:old.inputs};node.materialMessage=state.error||state.designer?.message||(state.status==='succeeded'?'PBR 已完成；请检查平铺与通道对齐':state.status==='running'?'正在计算 PBR…':state.status);
        if(state.status==='succeeded'){
            node.generatedOutputs=images(node);
            syncConnectedOutputsFromGenerated(node,node.generatedOutputs);
        }
        save();
    }
    async function refresh(node,automatic=false){
        const job=node.materialJob;if(!job)return;
        if(!automatic)pollStarted.set(key(node),Date.now());
        const owner=canvas.id;
        try{apply(node,await request('/api/materials/'+owner+'/jobs/'+job.id),owner);}
        catch(error){
            if(job.status==='submitting'){
                // Safe replay of the SAME idempotency key, never create a fresh paid AI/Designer job.
                apply(node,await request('/api/materials/'+owner+'/jobs',{requestId:job.id,...job.inputs}),owner);
            }else{node.materialMessage=error.message;save();throw error;}
        }
    }
    async function send(node){
        validate(node);if(stale(node))throw Error('输入或参数已更改，请先重新计算 PBR');
        if(node.materialJob?.status!=='succeeded')throw Error('请先生成 PBR');
        const owner=canvas.id;
        const state=await request('/api/materials/'+owner+'/jobs/'+node.materialJob.id+'/designer',{});apply(node,state,owner);
    }
    function body(node){
        const root=document.createElement('div');root.className='material-composer';
        for(const event of ['pointerdown','mousedown','dblclick','wheel'])root.addEventListener(event,e=>e.stopPropagation());
        const mode=document.createElement('select');mode.className='setting-input';mode.setAttribute('aria-label','材质制作方式');mode.append(new Option('AI 制作','ai'),new Option('导入颜色 · 算法 PBR','color'));mode.value=node.materialAlgorithm?'color':'ai';mode.onchange=()=>{node.materialAlgorithm=mode.value==='color';save();};
        const description=document.createElement('textarea');description.className='imagegen-prompt';description.placeholder='填写任意材质及风格、颜色、纹理尺度；或连接参考图自动提取';description.value=node.materialDescription||'';description.setAttribute('aria-label','材质描述');description.oninput=()=>{node.materialDescription=description.value;scheduleSave();};root.append(description);
        if(node.materialAlgorithm)description.hidden=true;
        if(!node.materialAlgorithm&&window.CanvasMaterialPlan)root.append(window.CanvasMaterialPlan.controls(node,{refs,derive,refresh},button));
        const advanced=document.createElement('details');const summary=document.createElement('summary');summary.textContent='设置';advanced.append(summary,mode);root.append(advanced);
        function row(label,control,target=advanced){const field=document.createElement('label');field.className='material-field';const text=document.createElement('span');text.textContent=label;field.append(text,control);target.append(field);}
        const available=refs(node);
        if(node.materialAlgorithm&&!node.materialColor&&available.length===1)node.materialColor=available[0].url;
        for(const [label,property] of [['颜色图','materialColor'],['法线图','materialNormal']]){
            if(node.materialAlgorithm&&property==='materialNormal')continue;
            const select=document.createElement('select');select.className='setting-input';select.append(new Option('连接图片 / 生图节点后选择',''));
            for(const ref of available)select.append(new Option(ref.label,ref.url));
            if(node[property]&&!available.some(r=>r.url===node[property]))select.append(new Option('已断开 · 请重新选择',node[property]));
            select.value=node[property]||'';select.onchange=()=>{node[property]=select.value;save();};row(label,select,node.materialAlgorithm?root:advanced);
        }
        if(node.materialAlgorithm){const calculate=button('从颜色图生成整套 PBR',()=>derive(node));calculate.disabled=active.has(key(node))||['running','submitting'].includes(node.materialJob?.status);root.append(calculate);}
        const helpers=document.createElement('div');helpers.className='material-actions';helpers.append(button('准备 AI 颜色节点',()=>helper(node,'color')),button('准备 AI 法线节点',()=>helper(node,'normal')));advanced.append(helpers);
        const format=document.createElement('select');format.className='setting-input';format.append(new Option('OpenGL +Y','opengl'),new Option('DirectX −Y（转为 OpenGL）','directx'));format.value=node.materialNormalFormat||'opengl';format.onchange=()=>{node.materialNormalFormat=format.value;save();};row('输入法线格式',format);
        const size=document.createElement('select');size.className='setting-input';size.append(new Option('512 · 快速预览','512'),new Option('1024 · 标准','1024'));size.value=String(node.materialSize||1024);size.onchange=()=>{node.materialSize=Number(size.value);save();};row('最大尺寸',size);
        for(const [label,property,fallback] of [['粗糙度基线','materialRoughness',.66],['金属度','materialMetallic',0]]){
            const input=document.createElement('input');input.className='setting-input';input.type='number';input.min=0;input.max=1;input.step=.01;input.value=node[property]??fallback;
            input.onchange=()=>{const value=Number(input.value);if(Number.isFinite(value)&&value>=0&&value<=1){node[property]=value;save();}else input.value=node[property]??fallback;};row(label,input);
        }
        const actions=document.createElement('div');actions.className='material-actions';
        const deriveButton=button('计算 PBR',()=>derive(node));deriveButton.disabled=active.has(key(node))||['running','submitting'].includes(node.materialJob?.status);
        const recover=button('查询 / 恢复任务',()=>refresh(node));recover.disabled=!node.materialJob;
        const importButton=button('导入 Designer',()=>send(node));const designer=node.materialJob?.designer;
        importButton.disabled=stale(node)||node.materialJob?.status!=='succeeded'||!['not_sent','unavailable'].includes(designer?.status);
        actions.append(deriveButton,recover,button('检查 Designer 连接',async()=>{const state=await request('/api/materials/designer/status');node.materialMessage=state.connected?'Designer 已连接':state.message;save();}));advanced.append(actions);
        const outputs=document.createElement('div');outputs.className='material-actions';
        const ballButton=button('查看材质',()=>ballPreview(node));ballButton.disabled=!node.materialJob?.result?.maps;
        outputs.append(importButton,ballButton);root.append(outputs);
        const message=document.createElement('p');message.className='imagegen-status';message.setAttribute('role','status');message.textContent=(stale(node)?'输入已变，以下为旧结果。 ':'')+(node.materialMessage||'编写后可在生图节点调整提示词与模型。');root.append(message);
        if(node.materialJob?.result){
            const result=node.materialJob.result,grid=document.createElement('div');grid.className='material-map-grid';
            for(const [channel,url] of Object.entries(result.maps)){
                const link=document.createElement('a');link.href=url;link.title='查看 '+names[channel];
                link.onclick=e=>{e.preventDefault();e.stopPropagation();openOutputLightbox(url);};
                const img=document.createElement('img');img.src=url;img.alt=names[channel];img.loading='lazy';link.append(img,document.createTextNode(channel==='normal'?'法线':names[channel]));grid.append(link);
            }root.append(grid);
            const toolbar=document.createElement('div');toolbar.className='material-checks';
            const checks=document.createElement('span');checks.className='imagegen-status';checks.textContent='边差 '+Object.entries(result.checks||{}).map(([name,c])=>(name==='basecolor'?'色':'法')+' '+c.wrap_mae_x.toFixed(1)+'/'+c.wrap_mae_y.toFixed(1)).join(' · ');checks.title='左右 / 上下边缘平均像素差，越小通常越易衔接；不代表无缝合格。';toolbar.append(checks);
            for(const [file,url] of Object.entries(result.previews||{})){
                const label=(file.startsWith('basecolor')?'色':'法')+(file.includes('2x2')?' 2×2':' 偏移');
                const preview=button(label,()=>openOutputLightbox(url));
                preview.title=file.includes('2x2')?'查看重复平铺后的接缝与重复感':'将边缘接缝移到中央检查，不会自动修补';
                toolbar.append(preview);
            }
            const note=document.createElement('span');note.className='imagegen-status';note.textContent='ⓘ';note.title=(result.limitations||'')+(result.method==='color'?'':' AI 法线可能重画细纹，请人工核对。');toolbar.append(note);root.append(toolbar);
            if(designer?.packageUrl){const link=document.createElement('a');link.href=designer.packageUrl;link.download='material.sbs';link.textContent='下载 Designer 工程（纹理为链接资源，请同时保留任务目录）';root.append(link);}
        }
        return root;
    }
    function sync(){
        const current=new Map(nodes.filter(n=>n.type==='materialPbr').map(n=>[key(n),n]));
        for(const [id,timer] of pollers)if(!current.has(id)){clearTimeout(timer);pollers.delete(id);pollStarted.delete(id);}
        for(const [id,node] of current){
            const job=node.materialJob,pending=['running','submitting'].includes(job?.status)||['connecting','submitting','pending'].includes(job?.designer?.status);
            if(!pending||pollers.has(id))continue;
            if(!pollStarted.has(id))pollStarted.set(id,Date.now());
            if(Date.now()-pollStarted.get(id)>5*60*1000)continue;
            const owner=canvas.id;
            pollers.set(id,setTimeout(async()=>{
                try{if(canvas.id===owner&&nodes.includes(node))await refresh(node,true);}catch{}finally{pollers.delete(id);if(canvas.id===owner&&nodes.includes(node))sync();}
            },5000));
        }
    }
    window.CanvasMaterials={create,populateMenu,body,images,canConnect,sync,recordGeneration,ballPreview};
})();
