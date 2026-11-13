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
    const imageWorker=node=>!!definition(node)?.execution?.media||!!definition(node)?.ports?.outputs?.some(p=>['image','mask'].includes(p.type));
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
    function effectiveBindings(edge,source,node){
        if(edge.bindings?.length)return edge.bindings;
        const origins=ports(source,'outputs');
        const bindings=[];
        for(const target of ports(node,'inputs')){
            if(Object.hasOwn(node.extensionPortInputs||{},target.id))continue;
            let choices=origins.filter(origin=>origin.type===target.type);
            if(!choices.length&&['image','mask'].includes(target.type))choices=origins.filter(origin=>['image','mask'].includes(origin.type));
            const named=choices.filter(origin=>origin.id===target.id);
            if(named.length)choices=named;
            if(choices.length>1)throw new Error(`“${target.label||target.id}”有多个可用输出，请在高级端口映射中选择`);
            if(choices.length===1){const origin=choices[0];bindings.push({source:origin.id,target:target.id,...(origin.multiple&&!target.multiple?{index:0}:{})});}
        }
        // A single output must not silently populate several unrelated inputs.
        if(bindings.some(b=>bindings.filter(other=>other.source===b.source).length>1))throw new Error('多个输入端口可接收同一输出，请在高级端口映射中选择');
        return bindings;
    }
    function mappedInputs(node){
        const result=JSON.parse(JSON.stringify(node.extensionPortInputs||{})),inputs=ports(node,'inputs');
        for(const edge of connections.filter(e=>e.to===node.id)){
            const source=nodes.find(n=>n.id===edge.from);if(!source)throw new Error('上游节点缺失');
            for(const binding of effectiveBindings(edge,source,node)){
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
            const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='高级端口映射';details.append(summary);root.append(details);
            const note=document.createElement('p');
            try{const bindings=effectiveBindings(edge,source,node);note.textContent=(edge.bindings?.length?'已自定义连接：':'已自动连接：')+bindings.map(b=>`${ports(source,'outputs').find(p=>p.id===b.source)?.label||b.source}${b.index!==undefined?`[${b.index}]`:''} → ${ports(node,'inputs').find(p=>p.id===b.target)?.label||b.target}`).join('，');}
            catch(error){note.textContent=error.message;details.open=true;}
            root.append(note);
            const title=document.createElement('p');title.textContent=`端口映射 · ${definition(source)?.title||source.title||source.id}`;details.append(title);
            const edit=change=>{if(node.running)return;pushUndo();change();clearOutput(node);scheduleSave();render();};
            const displayed=edge.bindings?.length?edge.bindings:(()=>{try{return effectiveBindings(edge,source,node);}catch{return [];}})();
            const customize=()=>{if(!edge.bindings?.length)edge.bindings=displayed.map(b=>({...b}));};
            for(const [index,binding] of displayed.entries()){
                const row=document.createElement('div');
                for(const [name,choices] of [['source',ports(source,'outputs')],['target',ports(node,'inputs')]]){
                    const select=document.createElement('select');select.className='select-lite';select.disabled=!!node.running;select.setAttribute('aria-label',name==='source'?'输出端口':'输入端口');
                    for(const port of choices){const option=document.createElement('option');option.value=port.id;option.textContent=`${port.label||port.id} (${port.type}${port.multiple?'[]':''})`;select.append(option);}select.value=binding[name];select.onchange=()=>edit(()=>{customize();edge.bindings[index][name]=select.value;});row.append(select);
                }
                const input=document.createElement('input');input.type='number';input.min=0;input.max=7;input.placeholder='集合索引（可空）';input.value=binding.index??'';input.disabled=!!node.running;input.setAttribute('aria-label','集合索引，从0开始');input.onchange=()=>edit(()=>{customize();if(input.value==='')delete edge.bindings[index].index;else edge.bindings[index].index=Number(input.value);});row.append(input);
                const remove=button('移除映射',()=>edit(()=>{customize();edge.bindings.splice(index,1);}));remove.disabled=!!node.running;row.append(remove);details.append(row);
            }
            const add=button('添加端口映射',()=>edit(()=>{customize();if((edge.bindings||[]).length>=24)throw new Error('每条连线最多24项映射');const origin=ports(source,'outputs')[0],target=ports(node,'inputs')[0];if(origin&&target)(edge.bindings||=[]).push({source:origin.id,target:target.id});}));add.disabled=!!node.running;details.append(add);
            const reset=button('恢复自动匹配',()=>edit(()=>delete edge.bindings));reset.disabled=!!node.running;details.append(reset);
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
        item=await install(item);if(!catalog.hashes[key(item)])throw new Error('此节点版本已停用，请先启用');
        const point=menuPoint||defaultPoint();
        if(item.execution.kind==='comfy.workflow'){
            const canvasId=canvas?.id;
            const response=await fetch('/api/workflows');
            if(!response.ok)throw new Error('工作流目录刷新失败');
            comfyWorkflows=(await response.json()).workflows||[];
            if(!await ensureComfyWorkflow(item.execution.workflowName))throw new Error('封装工作流文件缺失，请重新发布');
            if(canvas?.id!==canvasId)throw new Error('画布已切换，请重新添加节点');
            const node=addComfyNode(point);
            window.CanvasComfyBuilds.configure(node,{workflowName:item.execution.workflowName,nodeDefinition:item,definitionHash:catalog.hashes[key(item)],
                params:Object.fromEntries(item.fields.map(f=>[f.id,f.default]))},
                {comfyBuildId:item.execution.buildId,comfyRevision:item.execution.revision});
            render();scheduleSave();closeCreateMenu();focusCreatedNode(node);return;
        }
        const node=create(point);initialize(node,item);render();scheduleSave();closeCreateMenu();focusCreatedNode(node);
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
    // Unity CLI 节点：默认只显示「工程 / 编辑器方法」两个自动下拉，其余全部收进高级选项。
    // 工程留空 → 后端 unity_cli.run() 自动选；方法由后端扫描 Assets/**/Editor/*.cs 生成候选。
    let unityProjectsCache=null,unityProjectsAt=0;
    const unityMethodsCache=new Map();
    async function unityProjects(force){
        if(force||!unityProjectsCache||Date.now()-unityProjectsAt>30000){
            unityProjectsCache=await api('unity-projects'+(force?'?refresh=1':''));unityProjectsAt=Date.now();
        }
        return unityProjectsCache;
    }
    function unityHint(text){
        const el=document.createElement('div');
        el.style.cssText='font-size:10px;opacity:.62;margin:4px 0 10px;line-height:1.5;word-break:break-all';
        el.textContent=text;return el;
    }
    function unityMiniBtn(label,onClick){
        const b=document.createElement('button');b.type='button';b.textContent=label;
        b.style.cssText='flex:0 0 auto;height:30px;padding:0 10px;border-radius:9px;border:1px solid var(--line-2);background:var(--card-solid);color:var(--text);font-size:10px;font-weight:700;cursor:pointer';
        b.onclick=onClick;return b;
    }
    function unitySelect(label,placeholder){
        const title=document.createElement('div');title.className='setting-title';title.textContent=label;
        const row=document.createElement('div');row.style.cssText='display:flex;gap:6px;align-items:center;margin-top:5px';
        const select=document.createElement('select');select.className='select-lite';select.style.cssText='flex:1 1 auto;width:100%;min-width:0';
        select.setAttribute('aria-label',label);select.append(new Option(placeholder,''));row.append(select);
        return {title,row,select};
    }
    function unityControls(d,node,update){
        const box=document.createElement('div'),params=node.extensionParams||{};
        let currentProject=params.project||'',allMethods=[],showAll=false;
        const RECENT_KEY='artcanvas.unity.recentMethods';
        const readRecent=()=>{try{return JSON.parse(localStorage.getItem(RECENT_KEY)||'[]').slice(0,6);}catch{return [];}};
        const remember=name=>{try{localStorage.setItem(RECENT_KEY,JSON.stringify([name,...readRecent().filter(x=>x!==name)].slice(0,6)));}catch{}};
        const p=unitySelect('Unity 工程（自动识别）','自动选择最近可用工程（留空）');
        const pNote=unityHint('正在扫描本机 Unity 工程…');
        p.row.append(unityMiniBtn('刷新',()=>loadProjects(true).then(()=>loadMethods(currentProject,true))));
        const m=unitySelect('编辑器方法（自动识别）','选择要执行的方法…');
        m.row.append(unityMiniBtn('刷新',()=>loadMethods(currentProject,true)));
        const search=document.createElement('input');search.type='search';search.className='setting-input';
        search.placeholder='搜你的工具：Region / Plane / Mask / 遮罩 / Build…';
        search.setAttribute('aria-label','搜索编辑器方法');search.style.marginTop='6px';
        const mNote=unityHint('等待工程扫描…');
        const tools=document.createElement('label');
        tools.style.cssText='display:flex;gap:6px;align-items:center;margin:-4px 0 10px;font-size:10px;opacity:.75;cursor:pointer';
        const showAllBox=document.createElement('input');showAllBox.type='checkbox';
        showAllBox.onchange=()=>{showAll=showAllBox.checked;renderMethods();};
        tools.append(showAllBox,document.createTextNode('显示全部（含仅打开窗口的菜单项）'));
        function optionFor(item){
            const o=new Option((item.usable?'':'[窗口] ')+(item.label||item.name),item.name);
            o.title=`${item.name}\n${item.menu||''}\n${item.file||''}:${item.line||''}`;
            return o;
        }
        function group(label,items){
            if(!items.length)return;const g=document.createElement('optgroup');g.label=label;
            items.forEach(item=>g.append(optionFor(item)));m.select.append(g);
        }
        function renderMethods(){
            const q=search.value.trim().toLowerCase(),recent=readRecent();
            let list;
            if(q)list=allMethods.filter(x=>`${x.name} ${x.menu||''} ${x.label||''} ${x.file||''}`.toLowerCase().includes(q)).slice(0,25);
            else if(showAll)list=allMethods.slice(0,600);
            else list=[...recent.map(n=>allMethods.find(x=>x.name===n)).filter(Boolean),
                       ...allMethods.filter(x=>x.own&&!recent.includes(x.name)),
                       ...allMethods.filter(x=>x.usable&&!x.own&&!recent.includes(x.name))].slice(0,14);
            m.select.replaceChildren(new Option(q?`搜索结果 ${list.length} 条`:showAll?`全部 ${list.length} 条`:'最近使用 / 你的工具（输入关键字搜索）',''));
            if(q||showAll)group(q?'匹配的方法':'全部方法',list);
            else{
                group('最近使用',list.filter(x=>recent.includes(x.name)));
                group('你的工具 · RegionTool / PlaneGenerator 等',list.filter(x=>x.own&&!recent.includes(x.name)));
                group('其它可执行方法',list.filter(x=>!x.own&&!recent.includes(x.name)));
            }
            m.select.value=node.extensionParams?.method||params.method||'';
        }
        async function loadProjects(force){
            try{
                const data=await unityProjects(force);
                p.select.replaceChildren(new Option('自动选择最近可用工程（留空）',''));
                (data.projects||[]).forEach(item=>{
                    const tags=[item.pipeline?'工程级CLI包':'',item.editorInstalled?'编辑器已装':'缺编辑器',item.valid?'':'缺ProjectVersion'].filter(Boolean).join(' · ');
                    p.select.append(new Option(`${item.title} · ${item.version||'?'} · ${tags} · ${item.path}`,item.path));
                });
                p.select.value=(data.projects||[]).some(item=>item.path===currentProject)?currentProject:'';
                pNote.textContent=data.error?('扫描失败：'+data.error):`本机 ${data.projects?.length||0} 个工程 · 当前：${currentProject||'自动选择'}`;
            }catch(e){pNote.textContent='扫描失败：'+e.message;}
        }
        async function loadMethods(project,force){
            mNote.textContent='正在扫描工程里的脚本…';m.select.disabled=true;
            const cacheKey=project||'';
            try{
                let entry=unityMethodsCache.get(cacheKey);
                if(force||!entry||Date.now()-entry.at>30000){
                    entry={at:Date.now(),data:await api('unity-editor-methods?project='+encodeURIComponent(project||''))};
                    unityMethodsCache.set(cacheKey,entry);
                }
                const data=entry.data;allMethods=data.methods||[];renderMethods();
                mNote.textContent=data.error?('扫描失败：'+data.error):
                    `共 ${data.total??allMethods.length} 个 · 你的工具 ${data.own??0} 个（已置顶）· 可执行 ${data.usable??0} 个 · 第三方窗口菜单默认隐藏`;
            }catch(e){mNote.textContent='扫描失败：'+e.message;}
            m.select.disabled=false;
        }
        search.oninput=renderMethods;
        p.select.onchange=()=>{currentProject=p.select.value;update('project',currentProject);pNote.textContent='当前：'+(currentProject||'自动选择');loadMethods(currentProject,true);};
        m.select.onchange=()=>{if(!m.select.value)return;remember(m.select.value);update('method',m.select.value);mNote.textContent='已选择：'+m.select.value;};
        const adv=document.createElement('details');adv.style.cssText='margin:2px 0 10px';
        const sum=document.createElement('summary');sum.textContent='高级选项（一般不用填）';
        sum.style.cssText='font-size:10px;font-weight:800;letter-spacing:.06em;opacity:.7;cursor:pointer;padding:6px 0';
        adv.append(sum);
        for(const field of d.fields)adv.append(control(field,params[field.id]??field.default,v=>update(field.id,v),null));
        box.append(p.title,p.row,pNote,m.title,search,m.row,mNote,tools,adv);
        loadProjects(false).then(()=>loadMethods(currentProject,false));
        return box;
    }
    // Unity 场景制作（uloop）：图形化向导，默认零填写。工程/CLI/场景/参考/输出目录/预检全部自动。
    const ULOOP_MODES=[['generate','一键生成地表（推荐）'],['inspect','只看当前场景和参考'],['custom','自定义 C#（高级）']];
    const ULOOP_SHAPES=[['rect','矩形'],['circle','圆形'],['custom','自定义轮廓点']];
    const ULOOP_MAIN=['shape','slot','height','size_x','size_z','center_x','center_z','save_scene'];
    const ULOOP_MORE=['reference','root_name','output_folder','circle_segments','points_json'];
    const ULOOP_ADV=['project','cli','timeout'];
    function uloopNote(text){
        const el=document.createElement('div');
        el.style.cssText='font-size:11px;line-height:1.7;opacity:.82;background:rgba(127,127,127,.10);border:1px solid var(--line-2);border-radius:10px;padding:10px 12px;margin:2px 0 12px';
        el.textContent=text;return el;
    }
    function uloopDetails(summary){
        const box=document.createElement('details');
        box.style.cssText='margin:10px 0;border:1px solid var(--line-2);border-radius:10px;padding:8px 10px';
        const s=document.createElement('summary');s.textContent=summary;
        s.style.cssText='font-size:11px;font-weight:700;cursor:pointer;opacity:.85';
        box.append(s);return box;
    }
    function uloopControls(d,node,update){
        // 只留「工程路径」一个手填项；功能列表与其余环境全部由 /api/mcp/uloop-features 自动检测。
        const box=document.createElement('div'),byId=Object.fromEntries(d.fields.map(f=>[f.id,f]));
        const current=()=>node.extensionParams||{};
        const status=document.createElement('div');
        status.style.cssText='font-size:10px;opacity:.7;line-height:1.6;margin:8px 0 2px;word-break:break-all';
        const pTitle=document.createElement('div');pTitle.className='setting-title';pTitle.textContent='Unity 工程目录';
        const projRow=document.createElement('div');projRow.style.cssText='display:flex;gap:6px;align-items:center;margin-top:5px';
        const projInput=document.createElement('input');projInput.className='setting-input';
        projInput.placeholder='留空自动识别，或填 D:/color-client/UnityProj';
        projInput.value=current().project||'';projInput.setAttribute('aria-label','Unity 工程目录');
        const fTitle=document.createElement('div');fTitle.className='setting-title';fTitle.style.marginTop='12px';fTitle.textContent='功能（按工程自动检测）';
        const featureSel=document.createElement('select');featureSel.className='select-lite';
        featureSel.setAttribute('aria-label','功能');featureSel.style.marginTop='5px';
        const codeBox=document.createElement('div');
        projRow.append(projInput);
        box.append(pTitle,projRow,fTitle,featureSel,status,codeBox);
        let features=[];
        function renderFeatures(){
            featureSel.replaceChildren();
            if(!features.length){featureSel.append(new Option('正在检测工程…',''));return;}
            for(const f of features){
                const o=new Option(f.available?f.label:f.label+'（不可用）',f.id);
                o.title=f.description||'';o.disabled=!f.available;featureSel.append(o);
            }
            featureSel.value=String(current().feature||'ground');
            if(![...featureSel.options].some(o=>o.value===featureSel.value&&!o.disabled)){
                const first=[...featureSel.options].find(o=>!o.disabled);
                if(first){featureSel.value=first.value;update('feature',first.value);}
            }
        }
        function renderCode(){
            codeBox.replaceChildren();
            if(featureSel.value!=='custom'||!byId.code)return;
            const f=byId.code,row=control(f,current().code??f.default,v=>update('code',v),d),area=row.querySelector('textarea');
            if(area){area.rows=10;area.style.cssText='min-height:170px;font:11px/1.55 ui-monospace,Menlo,Consolas,monospace;resize:vertical';}
            codeBox.append(row);
        }
        async function load(force){
            const project=(current().project||'').trim();
            status.textContent='正在自动检测工程…';
            renderFeatures();
            try{
                const data=await api('uloop-features?project='+encodeURIComponent(project)+(force?'&refresh=1':''));
                if(!project&&data.project){projInput.value=data.project;update('project',data.project);}
                features=data.features||[];renderFeatures();renderCode();
                const bits=[data.cli?.found?'uloop CLI 已找到':'uloop CLI 未找到',
                    '插件 '+(data.plugins||[]).length+' 个','自动化 API '+(data.apis||[]).length+' 个',
                    '扫描 '+(data.scannedFiles||0)+' 个 Editor 脚本'];
                if(data.error)bits.push(data.error);
                status.textContent=bits.join(' · ');
            }catch(e){features=[];renderFeatures();status.textContent='检测失败：'+e.message;}
        }
        const autoBtn=unityMiniBtn('自动识别',async()=>{
            autoBtn.disabled=true;status.textContent='正在自动识别本机 Unity 工程…';
            try{const data=await api('uloop-features');
                if(data.project){projInput.value=data.project;update('project',data.project);await load(true);}
                else status.textContent='没找到本机 Unity 工程，请手动填写路径。';}
            catch(e){status.textContent=e.message;}finally{autoBtn.disabled=false;}
        });
        projRow.append(autoBtn);
        projInput.onchange=()=>{update('project',projInput.value.trim());load(true);};
        featureSel.onchange=()=>{update('feature',featureSel.value);renderCode();};
        load(false);
        return box;
    }
    function control(field,value,onChange,d){
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
        if(d.ui&&window.CanvasPluginUI)root.append(window.CanvasPluginUI.mount(d,node.extensionParams||{},update,{key:node.id,onRun:()=>nodes.includes(node)?execute(node):undefined,getState:()=>({running:node.running,error:node.runError,text:node.outputText,images:imageRefs(node)})}));
        else if(d.typeId==='unity.cli')root.append(unityControls(d,node,update));
        else if(d.typeId==='uloop.cli'){
            // 2.0.0 起是图形化向导；已保存的 1.0.0 老节点仍按原代码框渲染，参数不被破坏。
            if(d.fields.some(f=>f.id==='feature'||f.id==='mode'))root.append(uloopControls(d,node,update));
            else for(const field of d.fields)root.append(control(field,node.extensionParams?.[field.id]??field.default,value=>update(field.id,value),d));
        }
        else for(const field of d.fields)root.append(control(field,node.extensionParams?.[field.id]??field.default,value=>update(field.id,value),d));
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
        if(imageRefs(node).length){const note=document.createElement('p');note.textContent=`已生成 ${imageRefs(node).length} 张图片，请在输出节点查看`;root.append(note);}return root;
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
            // host.cli 也可能跑十几分钟（Unity 冷启动 + 编辑器方法），必须给取消按钮注册 runId。
            if(['worker.python','host.cli'].includes(d.execution.kind)){node.workerRunId=crypto.randomUUID();render();}
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
    /* Built-in menu sections. User-made groups win; unknown cli/game types fall back by prefix. */
    const PAGE_GROUPS=[
        {id:'basic',title:'基础',tone:'slate',members:['image','prompt','loop','llm','output','webapp']},
        {id:'image',title:'图像生成',tone:'rose',members:['imageGen','generator','msgen']},
        {id:'video3d',title:'视频 · 3D',tone:'violet',members:['video','ltxDirector','minimax','blenderGen','model3d','gameModelAsset','gameModel3d','gameAnimate3d']},
        {id:'workflow',title:'工作流',tone:'amber',members:['comfy','rh','materialPbr']},
        {id:'cli',title:'CLI 工具',tone:'teal',members:['cliComfy','cliTripo','cliJimeng','cliCodex','cliGemini','cliGen']},
        {id:'game',title:'游戏项目',tone:'blue',members:['gameIdea','gamePlan','gameAssets','gameTable','gameDevelop','gameTest','gameRelease','gameFile','gameScene','gameFolder','gameSpeech','gameAnimate']},
    ];
    const SYSTEM_GROUP_IDS=new Set(['basic','generate','workflow','game']);
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
        function section(title,buttons,tone){
            const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('div');
            details.className='catalog-menu-group';if(tone)details.dataset.tone=tone;
            const dot=document.createElement('i');dot.className='cm-group-dot';
            const label=document.createElement('span');label.className='cm-group-label';label.textContent=title;
            const count=document.createElement('span');count.className='cm-group-count';count.textContent=String(buttons.length);
            summary.append(dot,label,count);
            list.className='catalog-menu-list';details.append(summary,list);list.append(...buttons);items.append(details);sections.push({details,summary,buttons,title,count});bindFlyout(details,summary,list);
        }
        const menuGroups=PAGE_GROUPS.map(g=>({...g,members:[...g.members]}));
        for(const b of entries){
            const type=b.dataset.catalogType||'';
            const extra=type.startsWith('cli')?menuGroups.find(g=>g.id==='cli'):type.startsWith('game')?menuGroups.find(g=>g.id==='game'):null;
            if(extra&&!extra.members.includes(type))extra.members.push(type);
        }
        const byType=new Map(entries.map(b=>[b.dataset.catalogType,b])),claimed=new Set();
        const take=members=>{const out=[];for(const type of members||[]){const b=byType.get(type);if(b&&!claimed.has(type)){claimed.add(type);out.push(b);}}return out;};
        const add=(title,members,tone)=>{const buttons=take(members);if(buttons.length)section(title,buttons,tone);};
        for(const g of catalog.groups||[]){if(SYSTEM_GROUP_IDS.has(g.id)||menuGroups.some(d=>d.id===g.id))continue;add(g.title||'自定义',g.members,'violet');}
        for(const g of menuGroups)add(g.title,g.members,g.tone);
        for(const g of catalog.groups||[]){if(!SYSTEM_GROUP_IDS.has(g.id))continue;add(g.title,g.members,'slate');}
        const rest=entries.filter(b=>!claimed.has(b.dataset.catalogType));
        if(rest.length)section('其它',rest,'slate');
        const empty=document.createElement('p');empty.className='catalog-menu-empty';empty.textContent='没有匹配的节点';empty.hidden=true;items.append(empty);
        const management=document.createElement('details');management.className='catalog-menu-group catalog-menu-management';const heading=document.createElement('summary');heading.textContent='管理';const managementList=document.createElement('div');managementList.className='catalog-menu-list';managementList.append(button('分组',groups),button('版本',manageVersions),button('导入节点',()=>{const value=prompt('粘贴符合节点 SDK 的节点 JSON');if(value)return install(JSON.parse(value)).then(()=>{openCreateMenuFromCatalog();render();});}));management.append(heading,managementList);menu.append(management);bindFlyout(management,heading,managementList);
        const filter=()=>{const q=search.value.trim().toLowerCase();menu.classList.toggle('catalog-menu-searching',!!q);management.open=false;let total=0;for(const s of sections){let count=0;for(const b of s.buttons){const show=!q||`${b.textContent} ${b.dataset.catalogType} ${b.dataset.keywords||''}`.toLowerCase().includes(q);b.hidden=!show;b.style.display=show?'':'none';if(show)count++;}s.details.hidden=!!q&&!count;if(q)s.details.open=!!count;else s.details.open=false;s.count.textContent=String(q?count:s.buttons.length);total+=count;}empty.hidden=total>0;management.hidden=!!q;};
        search.oninput=filter;filter();
        if(!loaded)load().then(()=>{openCreateMenuFromCatalog();render();}).catch(error=>{search.placeholder=error.message;});
    }
    function workflowAvailable(node){const d=node.comfyNodeDefinition;return d&&catalog.hashes[key(d)]===node.comfyDefinitionHash;}
    window.CanvasNodeCatalog={load,install,definition,initialize,create,body,execute,canConnect,enhanceMenu,switchVersion,imageRefs,mappedInputs,ports,workflowAvailable};
    document.addEventListener('DOMContentLoaded',()=>{load().then(()=>{if(typeof render==='function')render();}).catch(()=>{});});
})();
