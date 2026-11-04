/* ponytail: version-one declarative text nodes use existing canvas factories and styles. */
(() => {
    'use strict';
    let catalog={definitions:[],groups:[],hashes:{},revision:0},loading=null,loaded=false;
    const key=d=>`${d.typeId}@${d.version}`;
    async function api(path='',body){
        const response=await fetch('/api/mcp/'+(path||'node-catalog'),body?{method:'POST',headers:{'Content-Type':'application/json','X-Art-MCP':'1'},body:JSON.stringify(body)}:{});
        const value=await response.json();
        if(!response.ok)throw new Error(typeof value.detail==='string'?value.detail:'节点目录请求失败');
        return value;
    }
    async function load(){
        if(!loading)loading=api().then(value=>{catalog=value;loaded=true;return value;}).finally(()=>loading=null);
        return loading;
    }
    async function install(definition){catalog=await api('',{action:'install',definition});loaded=true;return catalog.definitions.find(d=>key(d)===key(definition));}
    function definition(node){try{return JSON.parse(node.nodeDefinition||'null');}catch{return null;}}
    const imageWorker=node=>!!definition(node)?.execution?.media;
    const imageRefs=node=>(node.extensionImages||[]).map(item=>({...item,resourceId:item.id,kind:'image'}));
    function clearOutput(node){delete node.outputText;delete node.extensionImages;delete node.extensionPortOutputs;node.runStatus='';}
    function collectInputs(node){
        const sources=connections.filter(edge=>edge.to===node.id).map(edge=>nodes.find(n=>n.id===edge.from)).filter(Boolean);
        const inputs=sources.filter(n=>['prompt','llm','extension'].includes(n.type)).map(n=>n.type==='prompt'?n.text||'':n.outputText||'');
        const images=imageWorker(node)?[...sources.flatMap(n=>n.type==='extension'?imageRefs(n):typeof mediaRefsFromNode==='function'?mediaRefsFromNode(n).filter(ref=>ref.kind==='image'):[]),...(node.extensionImageInputs||[])]:[];
        return {inputs,images};
    }
    function ports(node,direction){
        const d=definition(node);if(d?.ports)return d.ports[direction]||[];
        if(node.type==='extension')return [{id:'text',type:'text',multiple:true},...(imageWorker(node)?[{id:'images',type:'image',multiple:true}]:[])];
        if(['prompt','llm'].includes(node.type))return [{id:'text',type:'text',multiple:false}];
        if(['gameSpeech','gameSoundEffect','gameMusic','gameAudioScene'].includes(node.type)||(node.type==='image'&&(node.mediaKind==='audio'||typeof mediaKindForNode==='function'&&mediaKindForNode(node)==='audio')))return [{id:'audio',type:'audio',multiple:false}];
        if(node.type==='image'&&(node.mediaKind==='video'||typeof mediaKindForNode==='function'&&mediaKindForNode(node)==='video'))return [{id:'video',type:'video',multiple:false}];
        if(['video','ltxDirector','minimax','output','comfy','rh','group'].includes(node.type))return [{id:'images',type:'image',multiple:true},{id:'video',type:'video',multiple:true},{id:'audio',type:'audio',multiple:true}];
        return [{id:'images',type:'image',multiple:node.type!=='image'}];
    }
    function mappedInputs(node){
        const result=JSON.parse(JSON.stringify(node.extensionPortInputs||{})),inputs=ports(node,'inputs');
        for(const edge of connections.filter(e=>e.to===node.id)){
            const source=nodes.find(n=>n.id===edge.from);if(!source)throw new Error('上游节点缺失');
            if(!edge.bindings?.length)throw new Error('请先配置上游连线的端口映射');
            for(const binding of edge.bindings){
                const origin=ports(source,'outputs').find(p=>p.id===binding.source),target=inputs.find(p=>p.id===binding.target);
                if(!origin||!target)throw new Error('端口已变化，请重新映射');
                if(origin.type!==target.type&&!(['image','mask'].includes(origin.type)&&['image','mask'].includes(target.type)))throw new Error('端口类型不兼容');
                let value;
                if(definition(source)?.ports)value=source.extensionPortOutputs?.[origin.id];
                else if(origin.type==='text'){value=source.type==='prompt'?source.text||'':source.outputText||'';if(origin.multiple)value=[value];}
                else if(origin.type==='video'){value=mediaRefsFromNode(source).filter(ref=>ref.kind==='video');if(!origin.multiple)value=value[0];}
                else if(origin.type==='audio'){
                    if(source.type==='image')value=source.url?{url:source.url,kind:'audio'}:undefined;
                    else if(!['gameSpeech','gameSoundEffect','gameMusic','gameAudioScene'].includes(source.type)){value=mediaRefsFromNode(source).filter(ref=>ref.kind==='audio');if(!origin.multiple)value=value[0];}
                    else {const project=window.GamePipeline?.project;const asset=project?.id===source.projectId&&project.mediaAssets?.find(asset=>asset.id===source.audioAssetId);value=asset?{url:`/api/game-projects/${encodeURIComponent(project.id)}/workspace/media-assets/${encodeURIComponent(asset.id)}/content`,kind:'audio',contentHash:asset.contentHash}:undefined;}
                }
                else {value=source.type==='extension'?imageRefs(source):mediaRefsFromNode(source).filter(r=>r.kind==='image');if(!origin.multiple)value=value[0];}
                if(binding.index!==undefined){if(!origin.multiple||!Number.isInteger(binding.index)||binding.index<0||binding.index>7)throw new Error('集合索引无效');value=value?.[binding.index];}
                else if(origin.multiple&&!target.multiple)throw new Error('集合到单值端口需要选择索引');
                if(value===undefined)throw new Error('上游端口没有输出，请先运行上游节点');
                if(target.multiple)result[target.id]=[...(result[target.id]||[]),...(Array.isArray(value)?value:[value])];
                else {if(Object.hasOwn(result,target.id))throw new Error('单值端口不能重复绑定');result[target.id]=value;}
            }
        }
        return result;
    }
    function mappingPanel(node){
        const root=document.createElement('div');
        for(const port of ports(node,'inputs').filter(port=>['audio','video'].includes(port.type))){
            const label=document.createElement('p');label.textContent=`${port.label||port.id} · ${port.type==='video'?'H.264 MP4视频':'WAV/MP3/AAC音频'}`;root.append(label);
            const mediaLabel=port.type==='video'?'视频':'音频';
            const upload=document.createElement('input');upload.type='file';upload.accept=port.type==='video'?'.mp4,video/mp4':'.wav,.mp3,.aac,.m4a,audio/*';upload.multiple=!!port.multiple;upload.disabled=!!node.running;upload.setAttribute('aria-label',`上传${mediaLabel} ${port.id}`);
            upload.onchange=async()=>{try{const files=[...(upload.files||[])];if(files.length>8)throw new Error(`最多8项${mediaLabel}`);upload.disabled=true;const refs=[];for(const file of files)refs.push(await api('node-run',{action:'import-media',data:await fileData(file)}));if(!files.length||!nodes.includes(node))return;pushUndo();node.extensionPortInputs={...node.extensionPortInputs,[port.id]:port.multiple?refs:refs[0]};clearOutput(node);scheduleSave();render();}catch(error){alert(error.message);}finally{upload.value='';upload.disabled=!!node.running;}};root.append(upload);
            const values=node.extensionPortInputs?.[port.id];
            if(values){for(const ref of Array.isArray(values)?values:[values]){const audio=document.createElement(port.type);audio.controls=true;audio.src=ref.url;audio.preload='metadata';audio.style.maxWidth='100%';root.append(audio);}const remove=button(`移除已上传${mediaLabel}`, ()=>{if(node.running)return;pushUndo();delete node.extensionPortInputs[port.id];clearOutput(node);scheduleSave();render();});remove.disabled=!!node.running;root.append(remove);}
        }
        for(const edge of connections.filter(e=>e.to===node.id)){
            const source=nodes.find(n=>n.id===edge.from);if(!source)continue;
            const title=document.createElement('p');title.textContent=`端口映射 · ${definition(source)?.title||source.title||source.id}`;root.append(title);
            const edit=change=>{if(node.running)return;pushUndo();change();clearOutput(node);scheduleSave();render();};
            for(const [index,binding] of (edge.bindings||[]).entries()){
                const row=document.createElement('div');
                for(const [name,choices] of [['source',ports(source,'outputs')],['target',ports(node,'inputs')]]){
                    const select=document.createElement('select');select.className='select-lite';select.disabled=!!node.running;select.setAttribute('aria-label',name==='source'?'输出端口':'输入端口');
                    for(const port of choices){const option=document.createElement('option');option.value=port.id;option.textContent=`${port.label||port.id} (${port.type}${port.multiple?'[]':''})`;select.append(option);}select.value=binding[name];select.onchange=()=>edit(()=>binding[name]=select.value);row.append(select);
                }
                const input=document.createElement('input');input.type='number';input.min=0;input.max=7;input.placeholder='集合索引（可空）';input.value=binding.index??'';input.disabled=!!node.running;input.setAttribute('aria-label','集合索引，从0开始');input.onchange=()=>edit(()=>{if(input.value==='')delete binding.index;else binding.index=Number(input.value);});row.append(input);
                const remove=button('移除映射',()=>edit(()=>edge.bindings.splice(index,1)));remove.disabled=!!node.running;row.append(remove);root.append(row);
            }
            const add=button('添加端口映射',()=>edit(()=>{if((edge.bindings||[]).length>=24)throw new Error('每条连线最多24项映射');const origin=ports(source,'outputs')[0],target=ports(node,'inputs')[0];if(origin&&target)(edge.bindings||=[]).push({source:origin.id,target:target.id});}));add.disabled=!!node.running;root.append(add);
        }
        return root;
    }
    function fileData(file){
        if(file.size>8*1024*1024)throw new Error('单张图片不能超过8 MiB');
        return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(file);});
    }
    async function importImage(ref){
        if(ref.resourceId)return ref.resourceId;
        if(ref.id)return ref.id;
        const response=await fetch(ref.url);if(!response.ok)throw new Error('上游图片读取失败');
        let blob=await response.blob();
        if(['audio','video'].includes(ref.kind))blob=new Blob([blob],{type:ref.kind==='video'?'video/mp4':'audio/wav'});
        const resource=await api('node-run',{action:['audio','video'].includes(ref.kind)?'import-media':'import-image',data:await fileData(blob)});
        return resource.id;
    }
    function available(node){const d=definition(node);return d&&catalog.hashes[key(d)]===node.definitionHash;}
    function initialize(node,value){
        node.nodeDefinition=JSON.stringify(value);node.definitionHash=catalog.hashes[key(value)];
        if(!node.definitionHash)throw new Error('请先安装对应节点定义');
        node.extensionParams=Object.fromEntries(value.fields.map(f=>[f.id,f.default]));
    }
    function create(point){return addNode({id:uid('extension'),type:'extension',x:point?.x||0,y:point?.y||0,w:380,nodeDefinition:'',extensionParams:{}});}
    async function createInstalled(item){
        item=await install(item);if(!catalog.hashes[key(item)])throw new Error('此节点版本已停用，请先启用');const node=create(menuPoint||defaultPoint());initialize(node,item);render();scheduleSave();closeCreateMenu();focusCreatedNode(node);
    }
    async function switchVersion(node,target){
        if(node.running)throw new Error('运行中不能切换节点版本');
        const before=JSON.stringify(node.extensionParams||{}),old=definition(node),hash=node.definitionHash;
        const previous=node.extensionVersionStates?.[key(target)];
        const migrated=await api('',{action:'migrate',typeId:target.typeId,version:target.version,params:previous?.params||node.extensionParams||{}});
        if(!nodes.includes(node)||node.running||node.definitionHash!==hash||JSON.stringify(node.extensionParams||{})!==before)throw new Error('节点已发生变化，请重新切换');
        pushUndo();const states={...node.extensionVersionStates};delete states[key(old)];states[key(old)]={params:JSON.parse(before)};
        node.extensionVersionStates=Object.fromEntries(Object.entries(states).slice(-12));
        node.nodeDefinition=JSON.stringify(migrated.definition);node.definitionHash=catalog.hashes[key(target)];node.extensionParams=migrated.params;
        delete node.runError;clearOutput(node);render();scheduleSave();
    }
    function control(field,value,onChange){
        const row=document.createElement('label');row.className='field';
        const title=document.createElement('div');title.className='setting-title';title.textContent=field.label;row.append(title);
        const input=document.createElement(field.component==='textarea'?'textarea':field.component==='dropdown'?'select':'input');
        input.className=field.component==='boolean'?'':field.component==='slider'?'canvas-range':field.component==='dropdown'?'select-lite':'setting-input';
        if(field.component==='dropdown')for(const option of field.options){const item=document.createElement('option');item.value=option;item.textContent=option;input.append(item);}
        else if(field.component!=='textarea')input.type=({boolean:'checkbox',slider:'range',number:'number'})[field.component]||'text';
        if(field.minimum!==null)input.min=field.minimum;if(field.maximum!==null)input.max=field.maximum;input.step=field.step;
        if(field.component==='boolean')input.checked=value;else input.value=value??'';
        input.onchange=()=>onChange(field.component==='boolean'?input.checked:['number','slider'].includes(field.component)?Number(input.value):input.value);
        row.append(input);return row;
    }
    function body(node){
        const root=document.createElement('div'),d=definition(node);
        if(!d||!available(node)){
            const note=document.createElement('p');note.textContent=loaded?'节点版本缺失或不兼容，参数与连线已保留。':'正在加载节点目录…';root.append(note);
            if(d){const restore=document.createElement('button');restore.className='gen-btn';restore.textContent='恢复或启用此节点版本';restore.onclick=async()=>{try{await install(d);if((catalog.disabled||[]).includes(key(d)))catalog=await api('',{action:'enabled',typeId:d.typeId,version:d.version,enabled:true,revision:catalog.revision});node.definitionHash=catalog.hashes[key(d)];render();scheduleSave();}catch(e){alert(e.message);}};root.append(restore);}
            return root;
        }
        const info=document.createElement('p');info.textContent=d.description||`${d.typeId} · ${d.version}`;root.append(info);
        if(d.execution.kind==='host.http'){
            const note=document.createElement('p');note.textContent=`外部API：${d.execution.url}。绑定凭据即授权此版本向该地址发送请求；运行可能产生费用，失败不会自动重试。Windows凭据绑定当前系统用户，换电脑或系统用户后需重新绑定。`;root.append(note);
            const status=document.createElement('p');status.textContent='正在查询凭据状态…';root.append(status);
            const password=document.createElement('input');password.type='password';password.autocomplete='new-password';password.className='setting-input';password.placeholder=`Bearer凭据 · ${d.execution.credentialRef}`;password.setAttribute('aria-label','API凭据');password.disabled=!!node.running;root.append(password);
            const save=button('绑定凭据并授权',async()=>{const token=password.value;password.value='';if(!token)throw new Error('请输入凭据');await api('node-http-credential',{definitionHash:node.definitionHash,token});status.textContent='已绑定当前账号与此节点版本';});save.disabled=!!node.running;root.append(save);
            const remove=button('解除凭据绑定',async()=>{await api('node-http-credential',{definitionHash:node.definitionHash,token:''});status.textContent='未绑定凭据';});remove.disabled=!!node.running;root.append(remove);
            api('node-http-credential?definitionHash='+encodeURIComponent(node.definitionHash)).then(value=>{status.textContent=value.configured?'已绑定当前账号与此节点版本':'未绑定凭据';}).catch(error=>{status.textContent=error.message;});
        }
        const versions=catalog.definitions.filter(item=>item.typeId===d.typeId&&!(catalog.disabled||[]).includes(key(item)));
        if(versions.length>1){const select=document.createElement('select');select.className='select-lite';select.setAttribute('aria-label','节点版本');
            for(const item of versions){const option=document.createElement('option');option.value=item.version;option.textContent=item.version;select.append(option);}select.value=d.version;select.disabled=!!node.running;
            select.onchange=()=>switchVersion(node,versions.find(item=>item.version===select.value)).catch(error=>{select.value=d.version;alert(error.message);});root.append(select);}
        const update=(id,value)=>{pushUndo();node.extensionParams={...node.extensionParams,[id]:value};clearOutput(node);scheduleSave();};
        if(d.ui&&window.CanvasPluginUI)root.append(window.CanvasPluginUI.mount(d,node.extensionParams||{},update));
        else for(const field of d.fields)root.append(control(field,node.extensionParams?.[field.id]??field.default,value=>update(field.id,value)));
        if(d.ports)root.append(mappingPanel(node));
        if(imageWorker(node)&&!d.ports){
            const upload=document.createElement('input');upload.type='file';upload.accept='image/png,image/jpeg,image/webp,image/bmp';upload.multiple=true;upload.disabled=!!node.running;upload.setAttribute('aria-label','添加节点输入图片');
            upload.onchange=async()=>{const imported=[];try{
                const files=[...(upload.files||[])];if((node.extensionImageInputs||[]).length+files.length>8)throw new Error('最多添加8张图片');
                upload.disabled=true;for(const file of files){const item=await api('node-run',{action:'import-image',data:await fileData(file)});imported.push({...item,resourceId:item.id});}
            }catch(error){alert(error.message);}finally{
                if(imported.length&&nodes.includes(node)){pushUndo();node.extensionImageInputs=[...(node.extensionImageInputs||[]),...imported];clearOutput(node);scheduleSave();render();}
                upload.disabled=false;upload.value='';}};
            const note=document.createElement('p');note.textContent='图片按上游连线顺序传入，再附加下方上传图片；最多8张。';root.append(note,upload);
            for(const [index,ref] of (node.extensionImageInputs||[]).entries()){
                const row=document.createElement('div'),image=document.createElement('img');image.src=ref.url;image.alt=`输入图片 ${index+1}`;image.style.maxWidth='100%';image.loading='lazy';
                const remove=button(`移除输入 ${index+1}`,()=>{if(node.running)return;pushUndo();node.extensionImageInputs.splice(index,1);clearOutput(node);render();scheduleSave();});remove.disabled=!!node.running;row.append(image,remove);root.append(row);
            }
        }
        const run=document.createElement('button');run.className='gen-btn';run.textContent=node.running?'运行中…':d.execution.kind==='host.http'&&node.httpRunId?'继续API任务 / 读取结果':'运行';run.disabled=!!node.running;
        run.onclick=()=>execute(node).catch(error=>alert(error.message));root.append(run);
        if(d.execution.kind==='host.http'&&node.httpRunId){const fresh=button('开始新API请求（可能再次计费）',()=>{if(node.running)return;pushUndo();delete node.httpRunId;clearOutput(node);scheduleSave();render();});fresh.disabled=!!node.running;root.append(fresh);}
        if(node.running&&node.workerRunId)root.append(button('取消运行',()=>api('node-run',{action:'cancel',runId:node.workerRunId})));
        const result=document.createElement('pre');result.style.whiteSpace='pre-wrap';result.style.overflowWrap='anywhere';result.textContent=node.runError||node.outputText||'';root.append(result);
        for(const [id,value] of Object.entries(node.extensionPortOutputs||{})){const port=d.ports?.outputs.find(port=>port.id===id&&['audio','video'].includes(port.type));if(!port)continue;for(const ref of Array.isArray(value)?value:[value]){const audio=document.createElement(port.type);audio.controls=true;audio.src=ref.url;audio.preload='metadata';audio.style.maxWidth='100%';audio.setAttribute('aria-label','节点媒体输出');root.append(audio);}}
        for(const ref of imageRefs(node)){const image=document.createElement('img');image.src=ref.url;image.alt=`节点输出 ${ref.width}×${ref.height}`;image.style.maxWidth='100%';image.loading='lazy';root.append(image);}return root;
    }
    async function execute(node){
        if(node.running)throw new Error('节点正在运行');
        if(!available(node))throw new Error('节点版本缺失或不兼容');
        const d=definition(node),params=JSON.parse(JSON.stringify(node.extensionParams||{}));
        const collect=()=>d.ports?{inputs:[],images:[],ports:mappedInputs(node)}:collectInputs(node);
        const collected=collect(),inputs=collected.inputs,inputSnapshot=JSON.stringify(collected);
        node.running=true;node.runError='';clearOutput(node);render();
        try{
            if(collected.images.length>8)throw new Error('图片输入总量不能超过8张');
            const imageInputs=[];for(const ref of collected.images)imageInputs.push(await importImage(ref));
            const portInputs=collected.ports?{...collected.ports}:undefined;
            if(portInputs)for(const port of d.ports.inputs){if(!['image','mask','audio','video'].includes(port.type)||portInputs[port.id]===undefined)continue;const refs=port.multiple?portInputs[port.id]:[portInputs[port.id]];const ids=[];for(const ref of refs)ids.push(await importImage(ref));portInputs[port.id]=port.multiple?ids:ids[0];}
            if(!nodes.includes(node))return;
            if(JSON.stringify(collect())!==inputSnapshot||JSON.stringify(node.extensionParams||{})!==JSON.stringify(params))throw new Error('准备期间参数或输入已变化，请重新运行');
            if(d.execution.kind==='worker.python'){node.workerRunId=crypto.randomUUID();render();}
            if(d.execution.kind==='host.http'){node.httpRunId||=crypto.randomUUID();node.workerRunId=node.httpRunId;scheduleSave();render();}
            const result=await api('node-run',{typeId:d.typeId,version:d.version,definitionHash:node.definitionHash,params,inputs,imageInputs,portInputs,runId:node.workerRunId});
            if(!nodes.includes(node))return;
            if(JSON.stringify(node.extensionParams||{})!==JSON.stringify(params)||JSON.stringify(collect())!==inputSnapshot)throw new Error('执行期间参数或输入已变化，旧结果未发布，请重新运行');
            node.extensionPortOutputs=result.outputs.ports;node.outputText=result.outputs.text;if(imageWorker(node)){node.extensionImages=result.outputs.images;if(typeof syncConnectedOutputsFromGenerated==='function')syncConnectedOutputsFromGenerated(node,node.extensionImages);}
            node.runStatus='done';if(typeof syncGeneratorInputs==='function')syncGeneratorInputs();return result;
        }catch(error){node.runError=error.message;node.runStatus='failed';throw error;}
        finally{node.running=false;delete node.workerRunId;render();scheduleSave();}
    }
    function canConnect(from,to){
        if(from.type!=='extension'&&to.type!=='extension')return undefined;
        if(to.type==='extension'&&definition(to)?.ports)return ports(from,'outputs').some(a=>ports(to,'inputs').some(b=>a.type===b.type||['image','mask'].includes(a.type)&&['image','mask'].includes(b.type)))&&!wouldCreateGeneratorCycle(from.id,to.id);
        if(to.type==='extension')return (['prompt','llm','extension'].includes(from.type)||imageWorker(to)&&(['image','output','group'].includes(from.type)||(typeof CANVAS_MEDIA_OUTPUT_TYPES!=='undefined'&&CANVAS_MEDIA_OUTPUT_TYPES.includes(from.type))))&&!wouldCreateGeneratorCycle(from.id,to.id);
        if(to.type==='output')return imageWorker(from);
        return ['llm','generator','imageGen','comfy','msgen','video','rh','minimax'].includes(to.type)&&!wouldCreateGeneratorCycle(from.id,to.id);
    }
    function button(label,action){const b=document.createElement('button');b.type='button';b.className='menu-btn';b.textContent=label;b.onclick=()=>Promise.resolve().then(action).catch(error=>alert(error.message));return b;}
    async function manageVersions(){
        await load();const dialog=document.createElement('dialog');dialog.style.cssText='max-width:80vw;max-height:80vh;overflow:auto;';
        const heading=document.createElement('h3');heading.textContent='节点版本管理';const list=document.createElement('div');
        function draw(){list.replaceChildren();for(const item of catalog.definitions){
            const row=document.createElement('div'),title=document.createElement('span'),enabled=!(catalog.disabled||[]).includes(key(item));title.textContent=`${item.title} · ${key(item)} `;
            row.append(title,button(enabled?'停用':'启用',async()=>{catalog=await api('',{action:'enabled',typeId:item.typeId,version:item.version,enabled:!enabled,revision:catalog.revision});draw();render();}));list.append(row);
        }}
        dialog.append(heading,list,button('关闭',()=>{dialog.close();dialog.remove();}));draw();document.body.append(dialog);dialog.showModal();
    }
    async function groups(){
        if(!loaded)await load();
        const revision=catalog.revision,draft=JSON.parse(JSON.stringify(catalog.groups)),dialog=document.createElement('dialog');
        dialog.style.maxWidth='min(560px,90vw)';dialog.style.maxHeight='80vh';dialog.style.overflow='auto';
        const heading=document.createElement('h3');heading.textContent='节点分组';dialog.append(heading);
        const select=document.createElement('select');select.className='select-lite';select.setAttribute('aria-label','选择分组');dialog.append(select);
        const name=document.createElement('input');name.className='setting-input';name.placeholder='分组名称';name.maxLength=60;dialog.append(name);
        const members=document.createElement('div'),notice=document.createElement('p');
        const entries=new Map([...createMenu.querySelectorAll('[data-catalog-type]')].map(b=>[b.dataset.catalogType,b.textContent]));
        const current=()=>draft.find(g=>g.id===select.value);
        function draw(){
            const id=select.value;select.replaceChildren();
            for(const g of draft){const option=document.createElement('option');option.value=g.id;option.textContent=g.title;select.append(option);}
            if(draft.some(g=>g.id===id))select.value=id;
            name.value=current()?.title||'';members.replaceChildren();
            for(const [id,title] of entries){const label=document.createElement('label');label.style.display='block';const check=document.createElement('input');check.type='checkbox';check.checked=current()?.members.includes(id)||false;check.disabled=!current();check.onchange=()=>{const g=current();g.members=check.checked?[...new Set([...g.members,id])]:g.members.filter(v=>v!==id);};label.append(check,document.createTextNode(title));members.append(label);}
        }
        select.onchange=draw;
        dialog.append(button('新建分组',()=>{const title=name.value.trim()||'新分组';draft.push({id:'group-'+crypto.randomUUID(),title,members:[]});draw();select.value=draft.at(-1).id;draw();}),button('保存名称',()=>{if(current()&&name.value.trim()){current().title=name.value.trim();draw();}}),button('上移',()=>{const i=draft.indexOf(current());if(i>0){[draft[i-1],draft[i]]=[draft[i],draft[i-1]];draw();}}),button('下移',()=>{const i=draft.indexOf(current());if(i>=0&&i<draft.length-1){[draft[i+1],draft[i]]=[draft[i],draft[i+1]];draw();}}),button('删除分组',()=>{const i=draft.indexOf(current());if(i>=0){draft.splice(i,1);draw();}}),members,notice,
            button('保存分组',async()=>{try{catalog=await api('',{action:'groups',groups:draft,revision});dialog.close();openCreateMenuFromCatalog();}catch(error){notice.textContent=error.message;}}),button('取消',()=>dialog.close()));
        dialog.onclose=()=>dialog.remove();document.body.append(dialog);draw();dialog.showModal();
    }
    function openCreateMenuFromCatalog(){if(createMenu.classList.contains('open'))enhanceMenu(createMenu);}
    function enhanceMenu(menu){
        // Reuse the existing buttons and handlers; rebuild only the menu containers.
        const builtins=[...menu.querySelectorAll('.menu-btn')].filter(b=>b.dataset.catalogType&&!b.dataset.catalogType.startsWith('extension:')||b.dataset.gameType||b.getAttribute('onclick')?.includes('menuAdd('));
        for(const b of builtins){if(!b.dataset.catalogType)b.dataset.catalogType=b.dataset.gameType||b.getAttribute('onclick')?.match(/menuAdd\('([^']+)'\)/)?.[1]||'';}
        menu.replaceChildren();menu.classList.add('catalog-menu');
        const tools=document.createElement('div');tools.dataset.nodeCatalogTools='1';
        const search=document.createElement('input');search.type='search';search.className='setting-input';search.placeholder='搜索节点…';search.setAttribute('aria-label','搜索节点');tools.append(search);menu.append(tools);
        const items=document.createElement('div');items.dataset.nodeCatalogItems='1';menu.append(items);
        const entries=[...new Map(builtins.map(b=>[b.dataset.catalogType,b])).values()],latest=new Map();
        for(const d of catalog.definitions){if((catalog.disabled||[]).includes(key(d)))continue;const old=latest.get(d.typeId),parts=d.version.split('.').map(Number),previous=old?.version.split('.').map(Number);if(!old||parts.reduce((result,n,i)=>result||Math.sign(n-previous[i]),0)>0)latest.set(d.typeId,d);}
        for(const d of latest.values()){const b=button(d.title,()=>createInstalled(d));b.title=`${d.typeId} · ${d.version}`;b.dataset.catalogType='extension:'+d.typeId;b.dataset.keywords=(d.keywords||[]).join(' ');entries.push(b);}
        const sections=[];
        const flyouts=[];
        function bindFlyout(details,summary,list){
            flyouts.push(details);
            const show=()=>{
                if(search.value.trim())return;
                for(const other of flyouts)other.open=other===details;
                const anchor=summary.getBoundingClientRect();
                list.style.left='0px';list.style.top='0px';
                const rect=list.getBoundingClientRect(),gap=8;
                const right=anchor.right;
                const left=right+rect.width<=window.innerWidth-gap?right:Math.max(gap,anchor.left-rect.width);
                list.style.left=left+'px';list.style.top=Math.max(gap,Math.min(anchor.top,window.innerHeight-rect.height-gap))+'px';
            };
            details.onmouseenter=show;
            details.onmouseleave=()=>{if(!search.value.trim())details.open=false;};
            summary.onfocus=show;
            summary.onclick=event=>{if(!search.value.trim()){event.preventDefault();show();}};
        }
        function section(title,buttons){
            const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('div');
            details.className='catalog-menu-group';summary.textContent=title;list.className='catalog-menu-list';details.append(summary,list);list.append(...buttons);items.append(details);sections.push({details,summary,buttons,title});bindFlyout(details,summary,list);
        }
        for(const g of catalog.groups){const matches=entries.filter(b=>g.members.includes(b.dataset.catalogType));section(g.title,matches.map(b=>{const copy=b.cloneNode(true);copy.onclick=b.onclick;return copy;}));}
        const ungrouped=entries.filter(b=>!catalog.groups.some(g=>g.members.includes(b.dataset.catalogType)));
        if(ungrouped.length)section('未分组',ungrouped);
        const empty=document.createElement('p');empty.className='catalog-menu-empty';empty.textContent='没有匹配的节点';empty.hidden=true;items.append(empty);
        const management=document.createElement('details');management.className='catalog-menu-group catalog-menu-management';const heading=document.createElement('summary');heading.textContent='管理';const managementList=document.createElement('div');managementList.className='catalog-menu-list';managementList.append(button('分组',groups),button('版本',manageVersions),button('导入节点',()=>{const value=prompt('粘贴符合节点 SDK 的节点 JSON');if(value)return install(JSON.parse(value)).then(()=>{openCreateMenuFromCatalog();render();});}));management.append(heading,managementList);menu.append(management);bindFlyout(management,heading,managementList);
        const filter=()=>{const q=search.value.trim().toLowerCase();menu.classList.toggle('catalog-menu-searching',!!q);management.open=false;let total=0;for(const s of sections){let count=0;for(const b of s.buttons){const show=!q||`${b.textContent} ${b.dataset.catalogType} ${b.dataset.keywords||''}`.toLowerCase().includes(q);b.hidden=!show;b.style.display=show?'':'none';if(show)count++;}s.details.hidden=!!q&&!count;if(q)s.details.open=!!count;else s.details.open=false;s.summary.textContent=s.title;total+=count;}empty.hidden=total>0;management.hidden=!!q;};
        search.oninput=filter;filter();
        if(!loaded)load().then(()=>{openCreateMenuFromCatalog();render();}).catch(error=>{search.placeholder=error.message;});
    }
    window.CanvasNodeCatalog={load,install,definition,initialize,create,body,execute,canConnect,enhanceMenu,switchVersion,imageRefs,mappedInputs,ports};
    document.addEventListener('DOMContentLoaded',()=>{load().then(()=>{if(typeof render==='function')render();}).catch(()=>{});});
})();
