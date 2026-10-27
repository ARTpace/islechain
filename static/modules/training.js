/* ponytail: fixed training operations over the trainer's existing MCP API. */
window.TrainingUI = (() => {
    function parseConnection(text) {
        let url='', token='';
        if (text.trim().startsWith('{')) {
            const data=JSON.parse(text), servers=data.mcpServers || data.mcp_servers || {};
            const entries=Object.values(servers);
            const server=servers.kohya_lora || (entries.length===1 ? entries[0] : null) || (data.url ? data : null);
            if (!server) throw new Error('没有找到 Kohya MCP 配置');
            url=server.url || ''; token=(server.headers || server.http_headers || {}).Authorization || '';
        } else {
            const section=text.match(/\[mcp_servers\.kohya_lora\]([\s\S]*?)(?=\n\[|$)/);
            const source=section ? section[1] : text;
            const read=key=>{const match=source.match(new RegExp('(?:^|[\\s{,])'+key+'\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|\'[^\']*\')')); if(!match)return '';return match[1][0]==='"'?JSON.parse(match[1]):match[1].slice(1,-1);};
            url=read('url');token=read('Authorization');
        }
        const parsed=new URL(url);
        if(parsed.protocol!=='http:' || !['localhost','127.0.0.1'].includes(parsed.hostname) || parsed.pathname!=='/mcp' || parsed.username || parsed.password || parsed.search || parsed.hash)throw new Error('仅支持本机 MCP 地址');
        token=String(token).replace(/^Bearer\s+/i,'').trim();
        if(!token)throw new Error('配置缺少连接密钥');
        return {url,token};
    }
    function changedConfig(previous,next) {
        const patch={};
        for(const [key,value] of Object.entries(next)){
            if(JSON.stringify(value)===JSON.stringify(previous[key]))continue;
            if(key==='params'&&value&&typeof value==='object'&&!Array.isArray(value)){
                const before=previous.params||{},params={};
                for(const [name,item] of Object.entries(value))if(JSON.stringify(item)!==JSON.stringify(before[name]))params[name]=item;
                for(const name of Object.keys(before))if(!Object.hasOwn(value,name))params[name]=null;
                if(Object.keys(params).length)patch.params=params;
            }else patch[key]=value;
        }
        return patch;
    }
    async function mount() {
        const $=id=>document.getElementById(id);
        let online=false, tools=new Map(), project=null, currentConfig=null, revision='', dirty=false, taskId='', offset=0, timer=null, polling=false, catalogRequest=0;
        let pending=0, taskState='', environment=null;
        const labels={inspect_dataset:'素材检查',prepare_training:'训练预检',list_models:'模型状态',prepare_data:'素材预处理',start_training:'开始训练',resume_training:'从快照续训',training_history:'训练历史',get_diagnostics:'诊断信息',prepare_environment:'环境准备',download_model:'模型下载',list_samples:'采样文件',inspect_task_dataset:'任务素材检查',continue_training:'继续训练',cancel_task:'请求停止'};
        const common=[['raw_dir','素材目录'],['trigger','触发词'],['base_model','底模路径'],['train_env','训练环境路径'],['params.rank','LoRA Rank','number'],['params.alpha','Alpha','number'],['params.max_epochs','训练轮数','number'],['params.batch_size','批量大小（数字或 auto）'],['params.resolution','训练分辨率','number'],['params.unet_lr','学习率'],['params.sample_interval','采样间隔','number'],['params.sample_prompt','采样提示词']];
        const notify=(message,error=false)=>{const el=$('notice');el.hidden=!message;el.textContent=message;el.classList.toggle('error',error);};
        const show=(title,data)=>{$('resultTitle').textContent=title;$('resultPanel').textContent=typeof data==='string'?data:JSON.stringify(data,null,2);};
        const can=name=>online&&tools.has(name)&&(tools.get(name).annotations?.readOnlyHint!==false || environment?.mcp?.allow_actions===true);
        function updateButtons(){
            document.querySelectorAll('[data-operation]').forEach(button=>{button.disabled=!project||!can(button.dataset.operation==='resume_training'?'start_training':button.dataset.operation)||pending>0;});
            document.querySelectorAll('[data-setup]').forEach(button=>{button.disabled=!project||!can('prepare_environment')||pending>0;});
            $('createProjectBtn').disabled=!can('create_project')||pending>0;
            $('saveProjectBtn').disabled=!project||!can('update_project')||pending>0;
            $('downloadModelBtn').disabled=!project||!can('download_model')||pending>0;
            $('refreshProjectsBtn').disabled=!can('list_projects')||pending>0;
            $('reloadProjectBtn').disabled=!project||!can('get_project')||pending>0;
            $('taskRefreshBtn').disabled=!taskId||!online||pending>0;
            $('samplesBtn').disabled=!taskId||!can('list_samples')||pending>0;
            $('cancelTaskBtn').disabled=!taskId||!can('cancel_task')||!['running','awaiting_review','cancelling','queued'].includes(taskState)||pending>0;
            $('continueTaskBtn').disabled=!taskId||!can('continue_training')||!$('reviewConfirmed').checked||pending>0;
        }
        async function api(path,body){
            const response=await fetch('/api/training/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Art-Training':'1'},body:JSON.stringify(body)});
            const data=await response.json().catch(()=>({detail:'服务返回格式错误'}));
            if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'训练接口请求失败');return data;
        }
        async function call(name,args={}){
            const data=await api('call',{name,arguments:args});
            if(data.ok===false)throw new Error((data.code ? data.code+'：':'')+(data.error||'训练器操作失败'));
            return data;
        }
        async function busy(action){pending++;updateButtons();try{await action();}catch(error){notify(error.message,true);}finally{pending--;updateButtons();}}
        const clean=()=>{dirty=false;$('dirtyHint').textContent='已同步';};
        const changed=()=>{dirty=true;$('dirtyHint').textContent='有未保存修改';};
        async function refreshProjects(){
            const data=await call('list_projects');
            $('projectList').replaceChildren();
            for(const item of data.projects||[]){
                const name=typeof item==='string'?item:item.name;if(!name)continue;
                const button=document.createElement('button');button.type='button';button.className='project-item';button.dataset.project=name;
                button.classList.toggle('active',name===project);button.textContent=name;
                if(item.mode){const sub=document.createElement('small');sub.textContent=[item.mode,item.base_type].filter(Boolean).join(' · ');button.appendChild(sub);}
                button.onclick=()=>busy(()=>loadProject(name));$('projectList').appendChild(button);
            }
            if(!$('projectList').children.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='暂无项目，可从下方创建';$('projectList').appendChild(empty);}
            $('projectTemplate').replaceChildren();
            for(const item of data.templates||[]){const option=document.createElement('option');option.value=typeof item==='string'?item:item.name;option.textContent=typeof item==='string'?item:(item.label||item.title||item.name);$('projectTemplate').appendChild(option);}
        }
        function renderConfig(data){
            currentConfig=data.config;revision=data.revision;
            $('projectTitle').textContent=project;$('projectSubtitle').textContent=[currentConfig.mode,currentConfig.base_type,'参数由训练器校验'].filter(Boolean).join(' · ');
            $('projectEditor').hidden=false;$('commonFields').replaceChildren();
            for(const [path,label,type] of common){
                const field=document.createElement('label');field.textContent=label;
                const input=document.createElement('input');input.type=type||'text';if(type==='number')input.step='any';
                const keys=path.split('.');const value=keys.reduce((object,key)=>object?.[key],currentConfig)??data.parameters?.[keys.at(-1)]??'';
                input.value=value;input.dataset.path=path;input.dataset.initial=input.value;input.oninput=changed;field.appendChild(input);$('commonFields').appendChild(field);
            }
            $('advancedConfig').value=JSON.stringify(currentConfig,null,2);clean();
            document.querySelectorAll('[data-project]').forEach(button=>button.classList.toggle('active',button.dataset.project===project));
        }
        async function loadProject(name){
            if(dirty&&!confirm('当前参数尚未保存，放弃修改并重新读取？'))return;
            const request=++catalogRequest;const data=await call('get_project',{project:name});
            if(request!==catalogRequest)return;project=name;renderConfig(data);show('实际生效参数',data.parameters||data);updateButtons();
        }
        async function saveProject(){
            let next;try{next=JSON.parse($('advancedConfig').value);}catch(_){throw new Error('高级配置 JSON 格式不正确');}
            if(!next||Array.isArray(next)||typeof next!=='object')throw new Error('项目配置必须是 JSON 对象');
            for(const input of $('commonFields').querySelectorAll('input')){
                if(input.value===input.dataset.initial)continue;
                let value=input.type==='number'?Number(input.value):input.value;
                if(input.type==='number'&&(input.value===''||!Number.isFinite(value)))throw new Error('参数数值无效');
                const keys=input.dataset.path.split('.');if(keys.length===2){next.params={...(next.params||{}),[keys[1]]:value};}else next[keys[0]]=value;
            }
            const patch=changedConfig(currentConfig,next);
            if(!Object.keys(patch).length){clean();notify('参数没有变化');return;}
            const data=await call('update_project',{project,expected_revision:revision,patch});
            renderConfig(data);notify('参数已保存，原配置由训练器备份');
        }
        const taskKey=()=> 'studio_training_task:'+ $('trainerUrl').value;
        function track(id){
            if(!id)return;taskId=id;offset=0;$('taskLogs').textContent='';taskState='running';
            try{localStorage.setItem(taskKey(),id);}catch(_){}updateButtons();
        }
        function schedule(){clearTimeout(timer);if(taskId&&!document.hidden&&['running','awaiting_review','cancelling','queued'].includes(taskState))timer=setTimeout(()=>poll().catch(error=>notify(error.message,true)),5000);}
        async function poll(){
            if(!taskId||polling||!online)return;polling=true;
            try{
                const requested=taskId;const data=await call('get_task',{task_id:requested,after:offset,limit:200});
                if(requested!==taskId)return;
                const task=data.task||data;taskState=task.status||data.status||'unknown';
                offset=data.next_offset??offset;
                const logs=(data.logs||[]).map(line=>typeof line==='string'?line:JSON.stringify(line)).join('\n');
                if(logs){const el=$('taskLogs');el.textContent=(el.textContent+logs+'\n').slice(-120000);el.scrollTop=el.scrollHeight;}
                const names={running:'执行中',awaiting_review:'等待检查素材',completed:'已完成',done:'已完成',success:'已完成',failed:'失败',error:'失败',cancelled:'已停止',cancelling:'正在停止',queued:'排队中'};
                $('taskStatus').textContent=names[taskState]||taskState;$('taskTitle').textContent=[task.title||data.title,requested].filter(Boolean).join(' · ');
                const awaiting=taskState==='awaiting_review';if($('reviewPanel').hidden===awaiting){$('reviewConfirmed').checked=false;}$('reviewPanel').hidden=!awaiting;
                // No invented percentage: only show actual numeric progress supplied by the trainer.
                const progress=task.progress;const fraction=typeof progress==='number'&&progress>=0&&progress<=1?progress:null;
                $('taskProgress').hidden=fraction===null;if(fraction!==null){$('taskProgress').max=1;$('taskProgress').value=fraction;}
                if(task.error)notify(String(task.error),true);
                if(['failed','error'].includes(taskState))show('任务失败',data);
                schedule();
            }finally{polling=false;updateButtons();}
        }
        async function connect(){
            clearTimeout(timer);online=false;tools=new Map();updateButtons();notify('正在连接训练器…');const data=await api('connect',{});online=data.online===true;
            $('connectionStatus').textContent=online?'已连接':'未连接';$('connectionStatus').classList.toggle('online',online);
            if(!online){notify(data.message||'连接失败',true);updateButtons();return;}
            environment=data.environment;tools=new Map((data.tools||[]).map(entry=>[entry.name,entry]));
            const writable=environment.mcp?.allow_actions===true;
            $('connectionStatus').textContent=writable?'已连接 · 可操作':'已连接 · 只读';
            $('connectionHint').textContent=writable?'本机连接正常':'需在训练器中开启操作权限才能创建和训练';$('connectionPanel').open=false;
            notify(writable?'训练器已连接':'连接成功，当前为只读；可查看项目、检查素材和读取进度。');show('环境信息',environment);
            await refreshProjects();updateButtons();
            const active=environment.active_task;let saved='';try{saved=localStorage.getItem(taskKey())||'';}catch(_){}
            const id=active?.id||saved;if(id){track(id);await poll();}
        }
        async function operation(name,args={}){
            if(dirty&&['start_training','resume_training','prepare_data','prepare_environment','download_model'].includes(name))throw new Error('请先保存项目参数，再执行操作');
            let actual=name;
            if(name==='resume_training'){actual='start_training';args.resume=true;}
            if(['start_training','prepare_data','prepare_environment','download_model'].includes(actual)&&!confirm(actual==='start_training'?'按已保存参数开始训练？请确认其他生图任务已结束，显存足够。':'此操作可能下载依赖或模型，并处理素材，确认执行？'))return;
            const data=await call(actual,{project,...args});show(labels[name]||name,data);
            if(data.task_id){track(data.task_id);await poll();}else notify((labels[name]||name)+'完成');
        }
        $('parseConfigBtn').onclick=()=>{try{const parsed=parseConnection($('pasteConfig').value);$('trainerUrl').value=parsed.url;$('trainerToken').value=parsed.token;$('pasteConfig').value='';notify('配置已解析，点击“保存并连接”');}catch(error){notify(error.message,true);}};
        $('saveConnectionBtn').onclick=()=>busy(async()=>{
            if($('pasteConfig').value.trim()) {const parsed=parseConnection($('pasteConfig').value);$('trainerUrl').value=parsed.url;$('trainerToken').value=parsed.token;$('pasteConfig').value='';}
            const body={url:$('trainerUrl').value.trim(),install_dir:$('installDir').value.trim()};if($('trainerToken').value.trim())body.token=$('trainerToken').value.trim();
            await api('connection',body);$('trainerToken').value='';await connect();
        });
        $('connectBtn').onclick=()=>busy(connect);
        $('launchBtn').onclick=()=>busy(async()=>{const data=await api('launch',{});notify(data.message);});
        $('refreshProjectsBtn').onclick=()=>busy(refreshProjects);
        $('reloadProjectBtn').onclick=()=>busy(()=>loadProject(project));
        $('projectForm').onsubmit=event=>{event.preventDefault();busy(saveProject);};
        $('advancedConfig').oninput=changed;
        $('createProjectForm').onsubmit=event=>{event.preventDefault();busy(async()=>{const name=$('newProjectName').value.trim();if(dirty)throw new Error('请先保存当前项目');await call('create_project',{project:name,template:$('projectTemplate').value,training_type:$('trainingType').value});await refreshProjects();await loadProject(name);notify('项目已创建');});};
        document.querySelectorAll('[data-operation]').forEach(button=>button.onclick=()=>busy(()=>operation(button.dataset.operation)));
        document.querySelectorAll('[data-setup]').forEach(button=>button.onclick=()=>busy(()=>operation('prepare_environment',{target:button.dataset.setup})));
        $('downloadModelBtn').onclick=()=>busy(()=>{const key=$('downloadModelKey').value.trim();if(!key)throw new Error('请先填写模型状态返回的组件 key');return operation('download_model',{key});});
        $('taskRefreshBtn').onclick=()=>busy(poll);
        $('samplesBtn').onclick=()=>busy(async()=>show('采样文件',await call('list_samples',{task_id:taskId,offset:0})));
        $('cancelTaskBtn').onclick=()=>busy(async()=>{show('请求停止',await call('cancel_task',{task_id:taskId}));await poll();});
        $('inspectReviewBtn').onclick=()=>busy(async()=>show('当前任务素材',await call('inspect_task_dataset',{task_id:taskId})));
        $('reviewConfirmed').onchange=updateButtons;
        $('continueTaskBtn').onclick=()=>busy(async()=>{if(!$('reviewConfirmed').checked)return;show('继续训练',await call('continue_training',{task_id:taskId,confirmed:true}));await poll();});
        $('clearResultBtn').onclick=()=>show('结果','');
        document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(timer);else if(online&&taskId)poll().catch(error=>notify(error.message,true));});
        window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
        try{const config=await api('connection');$('trainerUrl').value=config.url;$('installDir').value=config.install_dir;$('trainerToken').placeholder=config.has_token?'已保存密钥；留空保留':'粘贴训练器 MCP 连接密钥';if(config.has_token)await connect();else notify('先点击“启动训练器”，开启 MCP 后将连接配置粘贴到这里。');}
        catch(error){notify(error.message,true);}updateButtons();
    }
    document.addEventListener('DOMContentLoaded',()=>mount(),{once:true});
    return {parseConnection,changedConfig};
})();
