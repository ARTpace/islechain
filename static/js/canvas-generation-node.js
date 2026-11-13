/* Native canvas UI. Reuses the existing task queues and shared local workflow builder. */
const loraState = LoraManager.state;
(function(){
    'use strict';
    const cards=new Map(),running=new Map();
    let catalog=null,catalogPromise=null,panel=null,owner=null,revision=0,libraryFrame=null;
    const key=node=>canvas.id+':'+node.id;
    // 画布每 2.5s 轮询远端版本，applyRemoteCanvasData() 会整体替换 nodes 数组（新对象）。
    // 卡片 DOM 是复用的，事件闭包却仍指向旧对象 —— 一旦引用被换掉，用户改的提示词/参数
    // 会写进已脱离的节点，界面又按新对象刷回旧值，表现就是「改了没用、变回上一次」。
    // 所有读写一律经 liveNode 重定向到当前数组里的同一 id。
    const liveNode=target=>{
        if(!target)return target;
        if(typeof nodes==='undefined'||!Array.isArray(nodes))return target;
        return nodes.find(n=>n.id===target.id&&n.type===target.type)||target;
    };
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    async function json(url,options){const r=await fetch(url,options),d=await r.json();if(!r.ok)throw new Error(typeof d.detail==='string'?d.detail:d.error||'加载失败');return d;}
    function settings(target){
        const node=liveNode(target);
        const s=node.generationSettings ||= {};s.engine ||= 'local';s.workflow ||= 'text2image/z-image.json';
        s.controls ||= {};for(const [k,v] of Object.entries({ratioW:1,ratioH:1,res:1,batchCount:1,seedMode:'random',fixedSeed:0}))s.controls[k] ??= v;
        s.cloud ||= {};s.loras ||= [];s.negative ??= (s.fields||[]).find(f=>/negativePrompt/i.test(f.id))?.value||'';return s;
    }
    function inputs(target){
        const node=liveNode(target);
        const sources=orderedSources(node,generatorSources(node));
        const owner=node.materialRole==='normal'&&nodes.find(n=>n.id===node.materialOwner);
        const color=owner?.materialColor;
        if(color)node.materialColorBasis=color;
        const linked=color?[{url:color,name:'最终颜色图',kind:'image'}]:imageRefsOnly(sources.flatMap(s=>s.refs||[]));
        const refs=[...linked,...(color?[]:node.referenceImages||[])].filter((r,i,list)=>r.url&&list.findIndex(x=>x.url===r.url)===i);
        return {refs,linked,linkedPrompt:sources.map(s=>s.prompt||'').filter(Boolean).join('\n\n')};
    }
    function save(node){scheduleSave();update(node);}
    // 档位归并统一交给 ModelPicker：按 config.title 判断哪些文件属于同一模型，
    // 从文件名 slug（-fast/-turbo/-4step/-6step）推断档位。以前这里对 MOSS、
    // Qwen、Boogu 各写一条正则，加一个多档模型就要改三处，且容易漏（Boogu 就漏过）。
    // 用户在设置里隐藏的模型不该出现在画布菜单里 —— 与文生图页共用同一份显示偏好
    // （localStorage 同源，iframe 通过 storage 事件即时同步）。当前正在用的那行始终保留，
    // 否则用户看不到自己选的是什么，按钮也会显示成一个菜单里不存在的模型。
    function visibleRows(rows){
        const mv=window.ModelVisibility;
        if(!mv)return rows;
        return rows.filter(r=>r.active||mv.isVisible('text:'+r.label));
    }
    function catalogRows(currentWorkflow){
        const rows=window.ModelPicker?window.ModelPicker.localRows(catalog?.workflows||[],{currentWorkflow:currentWorkflow||''}):[];
        return visibleRows(rows);
    }
    // 显示偏好一变（设置里关掉某个模型），已打开的菜单和卡片按钮文案立即跟着变
    let visibilityBound=false;
    function bindVisibility(){
        if(visibilityBound||!window.ModelVisibility)return;
        visibilityBound=true;
        window.ModelVisibility.subscribe(()=>{
            for(const node of nodes.filter(n=>n.type==='imageGen'))update(node);
            const content=panel?.querySelector('.imagegen-panel-content');
            if(content&&owner&&panel?.classList.contains('imagegen-model-dropdown')){
                const node=liveNode(owner);
                loadCatalog().then(data=>{if(panel?.contains(content))renderModels(node,content,data);}).catch(()=>{});
            }
        });
    }
    function modelLabel(node){
        const s=settings(node);
        if(s.engine==='cloud')return s.cloud.model||'选择在线模型';
        const row=window.ModelPicker?window.ModelPicker.findRow(catalogRows(s.workflow),s.workflow):null;
        const tier=window.ModelPicker?window.ModelPicker.tierOfWorkflow(s.workflow):'';
        const base=row?row.label:(s.workflow.split('/').pop().replace(/\.json$/i,''));
        return base+(tier?' · '+tier:'');
    }
    function button(label,action,className=''){const b=document.createElement('button');b.type='button';b.className='imagegen-control '+className;b.textContent=label;b.onclick=action;return b;}
    function status(node,text){const card=cards.get(key(node));if(card)card.status.textContent=text;}
    function update(target){
        const node=liveNode(target);
        const card=cards.get(key(node));if(!card)return;const s=settings(node),c=s.controls,data=inputs(node);
        if(document.activeElement!==card.prompt)card.prompt.value=node.prompt||'';
        card.model.textContent=modelLabel(node)+' ▾';const schema=s.engine==='cloud'?schemaFor(s):null,values=schema?.source==='website'?s.cloud.website?.[s.cloud.provider+'/'+s.cloud.model]:s.cloud.params;card.summary.textContent=schema?.params?.length?schema.params.filter(p=>['ratio','size','quality','count'].includes(p.key)).map(p=>{const value=values?.[p.key]??p.default;return p.options?.find(o=>String(o.value??o)===String(value))?.label||value;}).filter(v=>v!==undefined).join(' · ')||'模型参数':c.ratioW+':'+c.ratioH+' · '+c.res+'K · ×'+c.batchCount;
        card.lora.textContent='LoRA'+(s.loras.length?' · '+s.loras.length:'');card.lora.disabled=s.engine!=='local';
        card.generate.disabled=!!node.running;card.generate.textContent=node.running?'生成中…':node.imageGenerationTask?'继续等待':'生成';
        card.context.textContent=data.linkedPrompt;card.context.hidden=!data.linkedPrompt;
        card.input.classList.toggle('has-inputs',!!data.linkedPrompt||!!data.refs.length);
        card.prompt.placeholder=data.linkedPrompt?'补充描述或修改要求（可选）':'描述你想生成的画面…';
        card.prompt.setAttribute('aria-label',data.linkedPrompt?'生图补充要求（可选）':'生图提示词');
        const signature=JSON.stringify(data.refs);
        if(card.refs.dataset.signature!==signature){
            card.refs.dataset.signature=signature;card.refs.replaceChildren();
            for(const ref of data.refs){
                const item=document.createElement('div');item.className='imagegen-reference';
                const img=document.createElement('img');img.src=ref.url;img.alt=ref.name||'参考图';img.title=ref.name||'参考图';item.append(img);
                if(data.linked.some(r=>r.url===ref.url)){const label=document.createElement('span');label.textContent='上游图片';item.append(label);}
                else {const remove=button('×',()=>{pushUndo();node.referenceImages=node.referenceImages.filter(r=>r.url!==ref.url);save(node);},'imagegen-remove');remove.setAttribute('aria-label','移除参考图 '+(ref.name||''));item.append(remove);}
                card.refs.append(item);
            }
        }
        card.refs.hidden=!data.refs.length;
        const connected=[data.linkedPrompt?'上游文本':'',data.refs.length?data.refs.length+' 张参考图':''].filter(Boolean).join(' · ');
        status(node,node.running?'正在生成，结果将输出到画布':node.runError||node.runNotice||(node.runStatus==='done'?'生成完成，结果已输出':connected?'已接入 '+connected:'连接素材或添加参考图'));
    }
    function body(node){
        settings(node);
        if(node.generationUiVersion!==2){node.w=440;delete node.h;node.generationUiVersion=2;scheduleSave();}
        const root=document.createElement('div');root.className='imagegen-composer';
        const model=button(modelLabel(node)+' ▾',()=>openPanel(node,'models',model),'imagegen-model');
        const prompt=document.createElement('textarea');prompt.className='imagegen-prompt';prompt.placeholder='描述你想生成的画面…';prompt.setAttribute('aria-label','生图提示词');prompt.value=node.prompt||'';
        prompt.oninput=()=>{liveNode(node).prompt=prompt.value;scheduleSave();};prompt.onfocus=()=>pushUndo();
        const context=document.createElement('div');context.className='imagegen-context';const refs=document.createElement('div');refs.className='imagegen-references';
        context.setAttribute('aria-label','上游文本');context.title='来自连线节点，随上游内容同步';
        const input=document.createElement('div');input.className='imagegen-input';input.append(refs,context,prompt);
        const tools=document.createElement('div');tools.className='imagegen-tools';
        const library=button('提示词库',()=>openPanel(node,'prompts',library)),add=button('＋ 参考图',()=>openPanel(node,'references',add)),lora=button('LoRA',()=>openPanel(node,'loras',lora));tools.append(library,add,lora);
        const bottom=document.createElement('div');bottom.className='imagegen-bottom';const summary=button('',()=>openPanel(node,'parameters',summary),'imagegen-summary');
        const advanced=button('高级',()=>openPanel(node,'advanced',advanced)),generate=button('生成',()=>run(node.id).catch(()=>{}),'imagegen-generate');bottom.append(model,summary,advanced,generate);
        const message=document.createElement('div');message.className='imagegen-status';message.setAttribute('role','status');root.append(input,tools,bottom,message);
        ['mousedown','pointerdown','wheel','dblclick'].forEach(type=>root.addEventListener(type,e=>e.stopPropagation()));
        root.ondragover=e=>{e.preventDefault();e.stopPropagation();root.classList.add('is-drop-target');};root.ondragleave=()=>root.classList.remove('is-drop-target');
        root.ondrop=async e=>{
            e.preventDefault();e.stopPropagation();root.classList.remove('is-drop-target');
            try{if(e.dataTransfer.files.length)await upload(node,e.dataTransfer.files);else{const raw=e.dataTransfer.getData('application/x-canvas-asset');const ref=raw?JSON.parse(raw):{url:e.dataTransfer.getData('application/x-canvas-output-image')};if(ref.url&&(!ref.kind||ref.kind==='image'))addReference(node,ref);}}catch(error){status(node,error.message);}
        };
        cards.set(key(node),{root,input,prompt,model,context,refs,lora,summary,generate,status:message});update(node);return root;
    }
    function preserve(node,element){
        const card=cards.get(key(node));if(!card||!element?.contains(card.root))return false;
        element.style.left=node.x+'px';element.style.top=node.y+'px';element.style.width=(node.w||440)+'px';element.style.height=node.h?node.h+'px':'';element.style.zIndex=String(2+nodes.indexOf(node));
        element.classList.toggle('selected',selected.has(node.id));update(node);return true;
    }
    function sync(){
        for(const id of cards.keys())if(!nodes.some(n=>n.type==='imageGen'&&key(n)===id))cards.delete(id);
        if(owner&&!nodes.some(n=>n.id===owner.id&&canvas.id===owner.canvasId))closePanel();
        for(const node of nodes.filter(n=>n.type==='imageGen')){update(node);if(node.imageGenerationTask&&!node.imageGenerationTask.paused&&!running.has(key(node)))resume(node).catch(()=>{});}
    }
    async function loadCatalog(){
        if(catalog)return catalog;
        if(!catalogPromise)catalogPromise=Promise.allSettled([json('/api/providers'),json('/api/workflows/builtin')]).then(([p,w])=>{
            if(p.status==='rejected'&&w.status==='rejected')throw new Error('模型列表加载失败，请重试');
            catalog={providers:p.status==='fulfilled'?(p.value.providers||[]).filter(p=>p.enabled!==false):[],workflows:w.status==='fulfilled'?(w.value.workflows||[]).filter(w=>w.name.startsWith('text2image/')):[],partial:p.status==='rejected'||w.status==='rejected'};return catalog;
        }).finally(()=>{catalogPromise=null;});return catalogPromise;
    }
    function closePanel(){
        const previous=owner,shell=panel?.querySelector('#loraPickerShell');
        if(shell){loraPickerClose();shell.classList.remove('prompt-embedded');document.body.append(shell);}
        revision++;libraryFrame=null;panel?.remove();panel=null;owner=null;
        if(previous?.anchor?.isConnected)previous.anchor.focus({preventScroll:true});
    }
    function alive(version,node){return panel&&revision===version&&owner?.id===node.id&&owner.canvasId===canvas.id;}
    function place(anchor){
        if(!panel||panel.classList.contains('imagegen-floating'))return;const r=anchor.getBoundingClientRect(),width=Math.min(panel.classList.contains('imagegen-options-panel')?520:380,window.innerWidth-24);
        panel.style.width=width+'px';panel.style.left=Math.max(12,Math.min(r.left,window.innerWidth-width-12))+'px';
        panel.style.top=Math.max(12,Math.min(r.bottom+8,window.innerHeight-Math.min(panel.offsetHeight,window.innerHeight-24)-12))+'px';
    }
    async function openPanel(target,kind,anchor){
        const node=liveNode(target);
        if(kind==='models'&&panel?.classList.contains('imagegen-model-dropdown')&&owner?.id===node.id){closePanel();return;}
        closePanel();const version=++revision;owner={id:node.id,canvasId:canvas.id,anchor};
        panel=document.createElement('section');panel.className='imagegen-panel '+(['models','parameters'].includes(kind)?'imagegen-popover':'imagegen-floating');
        if(kind==='models')panel.classList.add('imagegen-model-dropdown');if(kind==='parameters')panel.classList.add('generation-options-panel','imagegen-options-panel');
        panel.setAttribute('role',kind==='models'?'region':'dialog');panel.setAttribute('aria-label',({models:'选择生图模型',parameters:'生成参数',advanced:'高级参数',prompts:'提示词库',loras:'LoRA',references:'参考图'})[kind]);
        const head=document.createElement('header');head.innerHTML='<div><strong>'+panel.getAttribute('aria-label')+'</strong><small>图像生成 · '+esc((node.prompt||'未命名节点').slice(0,22))+'</small></div>';
        const close=button('×',closePanel,'imagegen-panel-close');close.setAttribute('aria-label','关闭生图面板');head.append(close);
        const content=document.createElement('div');content.className='imagegen-panel-content';if(!['models','parameters'].includes(kind))panel.append(head);panel.append(content);(document.querySelector('.shell')||document.body).append(panel);
        ['mousedown','pointerdown','wheel'].forEach(type=>panel.addEventListener(type,e=>e.stopPropagation()));place(anchor);if(kind!=='models')close.focus({preventScroll:true});
        try{
            if(kind==='parameters'){content.textContent='正在加载参数…';await loadCatalog();await refreshProvider(settings(node));if(alive(version,node))renderParameters(node,content);}
            if(kind==='references')renderReferences(node,content);
            if(kind==='advanced'){content.textContent='正在加载参数…';await loadCatalog();await refreshProvider(settings(node));if(alive(version,node))renderAdvanced(node,content);}
            if(kind==='models'){content.textContent='正在加载模型…';const data=await loadCatalog();if(alive(version,node))renderModels(node,content,data);}
            if(kind==='prompts')await renderPrompts(node,content,version);
            if(kind==='loras'){content.textContent='正在加载 LoRA…';await Promise.all([LoraManager.load(),loadCatalog()]);if(alive(version,node))await renderLoras(node,content,version);}
            if(alive(version,node))place(anchor);
        }catch(error){if(alive(version,node))content.textContent=error.message;}
    }
    function group(container,title){const section=document.createElement('section');section.className='imagegen-section';const label=document.createElement('h4');label.textContent=title;section.append(label);container.append(section);if(container.optionsPanel){section.optionsTitle=({'画面比例':'选择比例','分辨率':'选择分辨率','模型质量':'质量参数','图像质量':'质量参数','生成数量':'选择生成数量'})[title]||title;}return section;}
    function choices(container,values,current,choose){
        if(container.optionsTitle){const parent=container;parent.replaceChildren();return window.GenerationOptionsPanel.renderSection(parent,{title:container.optionsTitle,ratio:container.optionsTitle==='选择比例',items:values.map(item=>{const [value,label]=Array.isArray(item)?item:[item,item];return {value,label:String(label)};}),current,onSelect:choose});}
        const row=document.createElement('div');row.className='imagegen-choices';
        for(const item of values){const [value,label]=Array.isArray(item)?item:[item,item];const b=button(label,()=>{choose(value);row.querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));});b.setAttribute('aria-pressed',String(value===current));row.append(b);}container.append(row);
    }
    // 分辨率上限与画面比例都来自 ModelPicker，文生图页用同一份，改一处两边同步
    const maxRes=model=>window.ModelPicker?window.ModelPicker.maxResFor(model):2;
    const RATIO_LABELS=()=>window.ModelPicker?window.ModelPicker.RATIOS.map(r=>r.l):['1:1'];
    function modelBadge(model,provider){
        const schema=provider?.model_capabilities?.[model]?.generation_params;
        if(schema||provider?.protocol==='webai2api'){
            if(!schema||schema.status==='unavailable')return '参数未获取';
            const sizes=schema.params?.find(p=>p.key==='size')?.options?.map(o=>typeof o==='object'?o.label||o.value:o);
            return sizes?.join(' / ')||(schema.size===false?'尺寸自动':'');
        }
        return maxRes(model)+'K';
    }
    function renderModelParams(node,container,redraw){
        const s=settings(node),base=providerFor(s)?.model_capabilities?.[s.cloud.model]?.generation_params;
        const schema=schemaFor(s);if(!base)return false;
        if(schema?.source==='website'&&schema.status!=='ready'){const section=group(container,'模型参数');section.append(document.createTextNode(schema.message||'参数未获取，请刷新模型'));return true;}
        s.cloud.website ||= {};s.cloud.params ||= {};
        const state=base.source==='website'?(s.cloud.website[s.cloud.provider+'/'+s.cloud.model] ||= {}):s.cloud.params;
        const params=[...(base.byProvider?(base.params||[]).filter(p=>p.key==='provider'):[]),...(schema?.params||[]).filter(p=>!base.byProvider||p.key!=='provider')];
        for(const param of params){
            const options=(param.options||[]).map(v=>typeof v==='object'?v:{value:v});if(!options.length)continue;
            let value=state[param.key]??param.default;
            if(!options.some(o=>String(o.value)===String(value)))value=options[0].value;
            state[param.key]=value;
            choices(group(container,param.label||param.key),options.map(o=>[o.value,o.label||String(o.value)]),value,v=>{pushUndo();if(param.key==='provider'){for(const k of Object.keys(state))delete state[k];}state[param.key]=v;save(node);redraw();});
        }
        return true;
    }
    function renderParameters(node,container){
        container.replaceChildren();container.optionsPanel=true;const s=settings(node),c=s.controls,redraw=()=>renderParameters(node,container);
        const declared=s.engine==='cloud'&&renderModelParams(node,container,redraw),schema=s.engine==='cloud'?schemaFor(s):null;
        if(declared&&schema?.source!=='website'){
            if(!schema?.params?.some(p=>p.key==='ratio'))choices(group(container,'画面比例'),RATIO_LABELS(),c.ratioW+':'+c.ratioH,v=>{pushUndo();[c.ratioW,c.ratioH]=v.split(':').map(Number);save(node);});
            if(!schema?.params?.some(p=>p.key==='size')){if(schema?.size===false){const note=document.createElement('p');note.textContent='尺寸自动';container.append(note);}else{c.res=Math.min(c.res,maxRes(s.cloud.model));choices(group(container,'分辨率'),Array.from({length:maxRes(s.cloud.model)},(_,i)=>[i+1,(i+1)+'K']),c.res,v=>{pushUndo();c.res=v;save(node);});}}
        }
        if(!declared){
            const max=s.engine==='local'?2:maxRes(s.cloud.model);if(c.res>max){c.res=max;save(node);}
            choices(group(container,'画面比例'),RATIO_LABELS(),c.ratioW+':'+c.ratioH,v=>{pushUndo();[c.ratioW,c.ratioH]=v.split(':').map(Number);save(node);});
            choices(group(container,'分辨率'),Array.from({length:max},(_,i)=>[i+1,(i+1)+'K']),c.res,v=>{pushUndo();c.res=v;save(node);});
        }
        // 多档模型（MOSS / Qwen / Boogu……）的「模型质量」统一从工作流归并结果得来，
        // 不再逐个硬编码：只要同一模型的各档 config.title 一致，这里自动出现档位选项
        if(s.engine==='local'&&window.ModelPicker){
            const row=window.ModelPicker.findRow(catalogRows(s.workflow),s.workflow);
            if(row&&row.multi)choices(group(container,'模型质量'),row.workflows.map(name=>[name,window.ModelPicker.tierOfWorkflow(name)||'高']),s.workflow,v=>{pushUndo();s.workflow=v;save(node);});
        }
        if(s.engine==='local'&&/ideogram4/i.test(s.workflow))choices(group(container,'模型质量'),[['Quality','高'],['Default','中'],['Turbo','低']],s.qualities?.ideogram||'Default',v=>{pushUndo();s.qualities={...s.qualities,ideogram:v};save(node);});
        if(s.engine==='cloud'&&!declared)choices(group(container,'图像质量'),[['high','高'],['medium','中'],['low','低']],s.cloud.quality||'medium',v=>{pushUndo();s.cloud.quality=v;save(node);});
        if(!declared||!schemaFor(s)?.params?.some(p=>p.key==='count'))choices(group(container,'生成数量'),[1,2,3,4],c.batchCount,v=>{pushUndo();c.batchCount=v;save(node);});
    }
    function field(container,label,value,onChange,type='text'){
        const row=document.createElement('label');row.className='imagegen-field';const title=document.createElement('span');title.textContent=label;
        const input=document.createElement(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.value=value??'';input.onchange=()=>onChange(type==='number'?Number(input.value):input.value);row.append(title,input);container.append(row);return input;
    }
    function selectField(container,label,items,value,onChange){
        const row=document.createElement('label');row.className='imagegen-field';const title=document.createElement('span');title.textContent=label;const select=document.createElement('select');
        for(const item of items){const option=document.createElement('option');option.value=String(item.value);option.textContent=item.label||String(item.value);select.append(option);}select.value=String(value);
        select.onchange=()=>onChange(items.find(item=>String(item.value)===select.value)?.value);row.append(title,select);container.append(row);return select;
    }
    function providerFor(s){return catalog?.providers.find(p=>p.id===s.cloud.provider);}
    async function refreshProvider(s){
        const provider=providerFor(s);if(s.engine!=='cloud'||provider?.protocol!=='webai2api')return;
        const data=await json('/api/providers/webai2api/status?'+new URLSearchParams({provider_id:provider.id,refresh:'true',model:s.cloud.model}),{cache:'no-store'});
        if(!data.online)throw new Error(data.message||'模型参数更新失败，请检查网关连接');
        provider.model_capabilities=data.model_capabilities;
        const metadata=provider.model_capabilities?.[s.cloud.model];
        if(!metadata||metadata.available===false)throw new Error('当前模型已不可用，请重新选择模型');
    }
    function schemaFor(s){const base=providerFor(s)?.model_capabilities?.[s.cloud.model]?.generation_params;if(!base?.byProvider)return base;const state=s.cloud.website?.[s.cloud.provider+'/'+s.cloud.model]||{};return base.byProvider[state.provider??base.params?.find(p=>p.key==='provider')?.default];}
    function renderAdvanced(node,container){
        container.replaceChildren();const s=settings(node),c=s.controls;
        if(s.engine==='local'){
            const seeds=group(container,'种子');choices(seeds,[['random','随机'],['fixed','固定']],c.seedMode,v=>{c.seedMode=v;save(node);});
            const seed=field(seeds,'固定种子',c.fixedSeed,v=>{if(Number.isSafeInteger(v)&&v>=0){c.fixedSeed=v;save(node);}},'number');seed.min='0';seed.max='9007199254740991';
            field(group(container,'负面提示词'),'不希望出现的内容',s.negative,v=>{s.negative=v;save(node);},'textarea');
            field(group(container,'本地模型权重'),'UNET / Diffusion 路径（留空沿用工作流）',s.unet||'',v=>{s.unet=v;save(node);});
            if(/ideogram4/i.test(s.workflow))selectField(group(container,'模型质量'),'质量',[{value:'Default'},{value:'Turbo'},{value:'Quality'}],s.qualities?.ideogram||'Default',v=>{s.qualities={...s.qualities,ideogram:v};save(node);});
        }else{
            choices(group(container,'图像质量'),[['low','低'],['medium','中'],['high','高']],s.cloud.quality||'medium',v=>{s.cloud.quality=v;save(node);});
            const schema=schemaFor(s),section=group(container,'模型专用参数');
            if(schema?.source==='website'&&schema.status!=='ready')section.append(document.createTextNode(schema.message||'网站参数尚未就绪，请在模型面板刷新后重试。'));
            for(const param of schema?.params||[]){
                const options=(param.options||[]).map(v=>typeof v==='object'?v:{value:v});if(!options.length)continue;
                s.cloud.website ||= {};s.cloud.params ||= {};const state=schema.source==='website'?(s.cloud.website[s.cloud.provider+'/'+s.cloud.model] ||= {}):s.cloud.params;
                selectField(section,param.label||param.key,options,state[param.key]??param.default??options[0].value,v=>{state[param.key]=v;save(node);if(param.key==='provider')renderAdvanced(node,container);});
            }
            if(!schema?.params?.length)section.append(document.createTextNode('此模型使用通用比例、分辨率与质量设置。'));
        }
    }
    function renderModels(node,container,data){
        if(!window.ModelPicker){container.textContent='模型选择组件未加载';return;}
        bindVisibility();
        const s=settings(node);
        // /api/providers 的 image_models 可能是字符串或 {id,name}，统一成组件要的形状
        const providers=(data.providers||[]).map(p=>({
            id:p.id,name:p.name,enabled:p.enabled,
            models:(p.image_models||[]).map(m=>typeof m==='string'?m:{id:m.id||m.name,label:m.id||m.name})
        }));
        const pick=(row,meta)=>{
            pushUndo();
            if(row.kind==='cloud'){s.engine='cloud';s.cloud.provider=row.provider;s.cloud.model=row.model;}
            else{s.engine='local';s.workflow=row.workflow;s.unet='';}
            save(node);
            // 行内切档不关面板：用户常常要连着比几档，关掉就得再点开一次
            if(meta?.fromTier){update(node);return;}
            closePanel();
        };
        container.replaceChildren();
        // 与文生图页共用同一份 ComfyUI 可用性状态：没运行时本地模型置灰、只留当前正在用的那个。
        const comfyOffline=Boolean(window.ComfyStatus&&window.ComfyStatus.offline());
        const localRows=visibleRows(window.ModelPicker.localRows(data.workflows,{currentWorkflow:s.workflow}));
        window.ModelPicker.render(container,{
            host:'canvas',
            rows:comfyOffline?window.ComfyStatus.keepLocalRow(localRows,s.workflow):localRows,
            comfyOffline:comfyOffline,
            groups:window.ModelPicker.cloudGroups(providers,{currentProvider:s.cloud.provider,currentModel:s.cloud.model}),
            features:{search:true,refresh:true,searchPlaceholder:'搜索本地或在线模型',localTitle:'本地 ComfyUI'},
            badgeOf:row=>row.kind==='cloud'?modelBadge(row.model,data.providers.find(p=>p.id===row.provider)||null):'',
            onPick:pick,
            onRefresh:async()=>{
                catalog=null;
                if(window.ComfyStatus)await window.ComfyStatus.refresh();
                const fresh=await loadCatalog();
                if(panel?.contains(container)){renderModels(node,container,fresh);update(node);place(owner.anchor);}
            },
            emptyText:'没有匹配的模型'
        });
        // 面板打开时才探测一次：状态若变了（ComfyUI 刚启停）重画，不然用户会对着过期列表发呆。
        if(window.ComfyStatus){
            window.ComfyStatus.refresh().then(()=>{
                if(!panel||!panel.contains(container)||owner?.id!==node.id)return;
                if(Boolean(window.ComfyStatus.offline())===comfyOffline)return;
                renderModels(node,container,data);
            }).catch(()=>{});
        }
        if(data.partial)container.append(document.createTextNode('部分模型列表未加载，点击刷新重试'));
        const search=container.querySelector('.mp-search');
        if(search)search.focus({preventScroll:true});
    }
    function addReference(target,ref){
        const node=liveNode(target);
        const url=new URL(ref.url,location.origin);if(!['http:','https:'].includes(url.protocol))throw new Error('参考图地址无效');if(inputs(node).refs.some(r=>r.url===ref.url))return;
        pushUndo();node.referenceImages=[...(node.referenceImages||[]),{url:ref.url,name:ref.name||'参考图',kind:'image'}];save(node);
    }
    async function upload(target,files){
        const images=Array.from(files).filter(f=>f.type.startsWith('image/'));if(!images.length)throw new Error('请选择图片文件');
        status(target,'正在导入参考图…');const form=new FormData();images.forEach(file=>form.append('files',file));const result=await json('/api/ai/upload',{method:'POST',body:form});for(const ref of result.files||[])addReference(target,ref);update(target);
    }
    function renderReferences(node,container){
        const input=document.createElement('input');input.type='file';input.accept='image/*';input.multiple=true;input.hidden=true;
        input.onchange=()=>upload(node,input.files).then(()=>{if(owner?.id===node.id){container.replaceChildren();renderReferences(node,container);}}).catch(error=>status(node,error.message));container.append(button('从电脑导入图片',()=>input.click()),input);
        const section=group(container,'从画布选用'),grid=document.createElement('div');grid.className='imagegen-asset-grid';section.append(grid);
        const refs=nodes.filter(n=>n.id!==node.id).flatMap(n=>imageRefsFromNode(n)).filter((r,i,all)=>all.findIndex(x=>x.url===r.url)===i);
        for(const ref of refs){const b=button('',()=>{addReference(node,ref);b.setAttribute('aria-pressed','true');},'imagegen-asset');b.setAttribute('aria-label','使用参考图 '+(ref.name||''));b.setAttribute('aria-pressed',String(inputs(node).refs.some(r=>r.url===ref.url)));const img=document.createElement('img');img.src=ref.url;img.alt=ref.name||'画布图片';b.append(img);grid.append(b);}
        if(!refs.length)section.append(document.createTextNode('画布暂无图片。也可以将图片节点连到生图节点。'));
    }
    async function renderPrompts(node,container,version){
        container.classList.add('imagegen-library-host');
        const frame=document.createElement('iframe');frame.title='提示词库选择器';
        frame.src='/static/asset-manager.html?picker=prompt';
        const send=()=>{
            if(!alive(version,node))return;
            frame.contentWindow.postMessage({type:'prompt-library:view',view:'style'},location.origin);
            frame.contentWindow.postMessage({type:'prompt-library:state',keys:Object.keys(node.promptLibrarySelections||{})},location.origin);
        };
        frame.addEventListener('load',()=>{
            if(!alive(version,node))return;
            // Keep the shared library's own UI, but inherit the canvas palette.
            const palette=getComputedStyle(panel),style=frame.contentDocument.createElement('style');
            const names=['page','card','card-solid','soft','soft-2','line','line-2','text','muted','faint','strong','strong-text'];
            const declarations=names.map(name=>'--'+name+':'+palette.getPropertyValue('--'+name)+' !important;').join('');
            style.textContent='html:root,body{'+declarations+'--bg:var(--page)!important;--ui-bg:var(--page)!important;--ui-panel:var(--card-solid)!important;--ui-soft:var(--soft)!important;}';
            frame.contentDocument.head.append(style);
            frame.contentDocument.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closePanel();}});
            send();
        });libraryFrame={frame,node,version,send};container.append(frame);
    }
    window.addEventListener('message',event=>{
        const current=libraryFrame;if(!current||event.origin!==location.origin||event.source!==current.frame.contentWindow||!alive(current.version,current.node))return;
        if(event.data?.type==='prompt-library:ready'){current.send();return;}
        if(event.data?.type!=='prompt-library:toggle')return;
        const {key:selectionKey,item}=event.data;
        if(typeof selectionKey!=='string'||selectionKey.length>500||!item||typeof item.positive!=='string'||item.positive.length>20000)return;
        const node=liveNode(current.node);pushUndo();const selections=node.promptLibrarySelections ||= {};
        if(Object.hasOwn(selections,selectionKey))delete selections[selectionKey];else selections[selectionKey]={positive:item.positive,negative:String(item.negative||'').slice(0,20000)};
        const owned=node.promptLibraryOwned ||= {};
        for(const field of ['positive','negative']){
            const result=GenerationPromptLibrary.reconcile(field==='positive'?node.prompt:settings(node).negative,new Set(owned[field]||[]),Object.values(selections).map(entry=>entry[field]));
            owned[field]=[...result.owned];if(field==='positive')node.prompt=result.text;else settings(node).negative=result.text;
        }
        save(node);current.frame.contentWindow.postMessage({type:'prompt-library:state',keys:Object.keys(selections)},location.origin);
    });
    async function renderLoras(node,container,version){
        container.replaceChildren();container.classList.add('imagegen-lora-host');
        LoraManager.state.active=settings(node).loras.map(item=>({...item}));
        window.BUILTIN_WF_META=catalog?.workflows||[];LoraManager.setWorkflowFilter(settings(node).workflow);
        loraPickerInit();const shell=document.getElementById('loraPickerShell');shell.classList.add('prompt-embedded');container.append(shell);
        const apply=items=>{
            const target=liveNode(node);
            if(!alive(version,target))return;
            pushUndo();const s=settings(target),previous=target.loraOwnedWords||[];
            s.loras=items.map(item=>({...item}));
            const result=GenerationPromptLibrary.reconcile(target.prompt,new Set(previous),LoraManager.collectTriggerWords(s.loras));
            target.prompt=result.text;target.loraOwnedWords=[...result.owned];save(target);
        };
        await loraPickerOpen(apply);
        if(!alive(version,node)){loraPickerClose();shell.classList.remove('prompt-embedded');document.body.append(shell);return;}
        loraPickerOnSelectionChange=apply;
        shell.querySelector('.lora-picker-close').onclick=closePanel;
    }
    function sizeFor(c){const base=({1:1024,2:2048,3:3072,4:4096})[c.res]||1024,ratio=c.ratioW/c.ratioH;return {width:Math.round((ratio>1?base:base*ratio)/8)*8,height:Math.round((ratio>1?base/ratio:base)/8)*8};}
    function cloudPayload(snapshot){
        const s=snapshot.settings,c=s.controls,p=providerFor(s);if(!p)throw new Error('在线渠道已不可用，请重新选择模型');const schema=schemaFor(s),params={};
        const values=schema?.source==='website'?s.cloud.website?.[s.cloud.provider+'/'+s.cloud.model]||{}:s.cloud.params||{};
        if(schema?.source==='website'&&schema.status!=='ready')throw new Error(schema.message||'网站参数未就绪，请刷新模型');
        if(schema?.source==='website'&&snapshot.refs.length&&(!Number.isInteger(schema.max_reference_images)||snapshot.refs.length>schema.max_reference_images))throw new Error('当前模型的参考图数量超限，请减少参考图');
        for(const param of schema?.params||[]){const options=(param.options||[]).map(v=>typeof v==='object'?v:{value:v});let value=values[param.key]??param.default;
            if(value===undefined&&param.key==='ratio')value=c.ratioW+':'+c.ratioH;if(value===undefined&&param.key==='size')value=c.res+'K';
            const choice=options.find(o=>String(o.value)===String(value));if(!choice)throw new Error('请在高级参数中选择模型支持的'+(param.label||param.key));params[param.key]=choice.value;}
        return {prompt:snapshot.prompt,model:s.cloud.model,provider_id:p.id,protocol:p.protocol||'openai',size:snapshot.size.width+'x'+snapshot.size.height,quality:s.cloud.quality||'medium',reference_images:snapshot.refs,generation_params:params,feature:'online-'+s.cloud.model.replace(/[^a-zA-Z0-9_-]/g,'-').toLowerCase()};
    }
    async function execute(node,options){
        const s=JSON.parse(JSON.stringify(settings(node))),data=inputs(node),prompt=(options.materialPrompt??[node.prompt,data.linkedPrompt].filter(Boolean).join('\n\n')).trim();if(!prompt)throw new Error('请输入提示词，或连接上游提示词节点');
        await loadCatalog();if(s.engine==='local'||!schemaFor(s))s.controls.res=Math.min(s.controls.res,s.engine==='local'?2:maxRes(s.cloud.model));
        const snapshot={settings:s,prompt,refs:data.refs,size:sizeFor(s.controls)};
        let payload,kind;
        if(s.engine==='cloud'){await refreshProvider(s);payload=cloudPayload(snapshot);kind='online';}
        else{const seed=s.controls.seedMode==='fixed'?Number(s.controls.fixedSeed):Math.floor(Math.random()*10**15);
            const built=await ImageGenerationWorkflow.build({workflowName:s.workflow,prompt,seed,size:snapshot.size,controls:s.controls,unet:s.unet,refs:data.refs,referenceNames:async refs=>Promise.all(refs.map(comfyNameForRef)),loras:s.loras,negative:s.negative,qualities:s.qualities});
            const feature=s.workflow.split('/').pop().replace(/\.json$/i,'');kind='local';payload={prompt,workflow_json:built.name,workflow_data:built.workflow,width:snapshot.size.width,height:snapshot.size.height,client_id:crypto.randomUUID(),type:feature,feature,canvas_id:canvas.id};}
        const task={snapshot,requests:[],canvasId:canvas.id,createdAt:Date.now(),expected:kind==='online'&&!schemaFor(s)?.params?.some(p=>p.key==='count')?Math.max(1,Math.min(4,s.controls.batchCount)):1};node.imageGenerationTask=task;
        // Save accepted IDs one by one. Recovery waits on these IDs instead of resubmitting.
        for(let i=0;i<task.expected;i++){
            const created=kind==='online'?await createCanvasImageTask(payload,options):await createCanvasComfyTask(payload,options);
            task.requests.push({id:created.task_id,kind});scheduleSave();await saveCanvas();
        }
        return complete(node,task,options);
    }
    async function wait(request,options){
        const path=request.kind==='local'?'/api/canvas-comfy-tasks/':'/api/canvas-image-tasks/';
        while(true){
            const response=await cascadeFetch(path+encodeURIComponent(request.id),{},options),data=await response.json();
            if(!response.ok){const error=new Error(typeof data.detail==='string'?data.detail:'任务状态查询失败');error.terminal=response.status===404;throw error;}
            if(data.status==='failed'){const error=new Error(data.error||'生成失败');error.terminal=true;throw error;}
            if(data.status==='succeeded')return data.result||{};
            await new Promise(resolve=>setTimeout(resolve,1200));
        }
    }
    async function complete(targetNode,task,options){
        // 收尾必须写到当前数组里的同一个 id：远端同步会换掉 node 对象，
        // 用旧对象收尾会让 generatedOutputs 落在已脱离的节点上，且 task 永远清不掉。
        const node=liveNode(targetNode);
        if(!task.requests.length)throw new Error('未保存到任务编号，请检查任务状态后再试');
        for(const request of task.requests){
            if(request.done)continue;
            let result;
            try{result=await wait(request,options);}catch(error){if(!error.terminal)throw error;request.done=true;request.error=error.message;scheduleSave();continue;}
            const items=(result.images||[]).map(item=>({url:typeof item==='string'?item:item.url,kind:'image',run:{id:request.id,prompt:task.snapshot.prompt,model:task.snapshot.settings.engine==='cloud'?task.snapshot.settings.cloud?.model:task.snapshot.settings.workflow}})).filter(i=>i.url);
            if(!items.length){request.done=true;request.error='模型未返回图片';scheduleSave();continue;}
            if(canvas.id!==task.canvasId||!nodes.some(n=>n.id===node.id))return;
            window.CanvasMaterials?.recordGeneration(node,items,task.snapshot);
            pushUndo();const fresh=items.filter(item=>!(node.generatedOutputs||[]).some(old=>old.url===item.url&&old.run?.id===request.id));node.generatedOutputs=[...(node.generatedOutputs||[]),...fresh];
            const out=node.materialRole?null:outputForNode(node,(node.w||440)+80);if(out)appendOutputImagesWithoutDuplicates(out,fresh);syncConnectedOutputsFromGenerated(node,fresh);request.done=true;render();scheduleSave();
        }
        const errors=task.requests.filter(request=>request.error);
        if(errors.length){const error=new Error(errors.map(request=>request.error).join('；'));error.terminal=true;throw error;}
        node.runNotice=task.expected&&task.requests.length<task.expected?'仅完成已提交的 '+task.requests.length+'/'+task.expected+' 次任务；其余未提交':'';
        delete node.imageGenerationTask;node.runStatus='done';node.runError='';scheduleSave();
    }
    function track(node,operation){
        const id=key(node);node.running=true;node.runStatus='running';node.runError='';node.runNotice='';update(node);
        const promise=Promise.resolve().then(operation).catch(error=>{node.runStatus='failed';node.runError=error.message;if(node.imageGenerationTask){if(error.terminal||!node.imageGenerationTask.requests.length)delete node.imageGenerationTask;else node.imageGenerationTask.paused=true;}throw error;}).finally(()=>{node.running=false;running.delete(id);update(node);scheduleSave();});
        running.set(id,promise);return promise;
    }
    function run(id,options={}){
        const node=nodes.find(n=>n.id===id&&n.type==='imageGen');
        if(!node)return Promise.reject(new Error('生图节点不存在'));
        if(running.has(key(node)))return running.get(key(node));
        const task=node.imageGenerationTask;
        // 用户主动点「生成」= 用当前提示词重开一次。旧任务若已无未完成请求（或已暂停），
        // 必须丢掉，否则会 resume 旧 snapshot，改了提示词也只会重复上一次的图。
        if(task&&(task.paused||!task.requests.some(r=>!r.done)))delete node.imageGenerationTask;
        return node.imageGenerationTask?resume(node,options):track(node,()=>execute(node,options));
    }
    function resume(node,options={}){const task=node.imageGenerationTask;task.paused=false;return track(node,()=>complete(node,task,options));}
    document.addEventListener('pointerdown',event=>{if(panel&&!panel.contains(event.target)&&!owner?.anchor?.contains(event.target))closePanel();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&panel){event.preventDefault();event.stopImmediatePropagation();closePanel();}},true);
    window.addEventListener('resize',()=>{if(owner)place(owner.anchor);});
    function recover(id){
        const node=nodes.find(n=>n.id===id&&n.type==='imageGen');
        if(!node?.imageGenerationTask)return Promise.reject(new Error('没有已保存的生图任务，不会自动重发'));
        return running.get(key(node))||resume(node);
    }
    window.CanvasImageGeneration={body,preserve,sync,run,recover};
})();
