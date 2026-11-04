/* ponytail: 常用操作自动准备会话；高级工具仍复用同一组API。 */
(() => {
    'use strict';
    const $=id=>document.getElementById(id), projectId=new URLSearchParams(location.search).get('projectId');
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(projectId || ''))return;
    const base=`/api/game-projects/${projectId}/native-runtime`, active=r=>['starting','running','stopping'].includes(r.status);
    const operationNames={agent:'开发',install:'安装依赖',build:'构建',dev:'开发服务',preview:'产物预览',plugin:'本机工具'};
    const stateNames={starting:'正在准备',running:'进行中',stopping:'正在停止',succeeded:'已完成',failed:'失败',cancelled:'已停止',interrupted:'已中断'};
    $('nativeSource').href=base+'/source.zip';
    let busy=false,timer=null,current=null,overview=null,reviewedSession=null,queueCancelled=false,agentPathLoaded=false;
    const draftKey='game-development-draft:'+projectId;
    try{$('nativeAgent').value=localStorage.getItem('game-agent:'+projectId)||'codex';}catch{}
    if(!['codex','claude','opencode'].includes($('nativeAgent').value))$('nativeAgent').value='codex';
    try{$('nativePrompt').value=sessionStorage.getItem(draftKey)||'';}catch{}
    $('nativePrompt').addEventListener('input',()=>{try{sessionStorage.setItem(draftKey,$('nativePrompt').value);}catch{}});
    async function api(path='',method='GET',body) {
        const form=body instanceof FormData;
        const response=await fetch(base+path,{method,headers:{'X-Art-Runtime':'1',...(form?{}:{'Content-Type':'application/json'})},
            ...(body===undefined?{}:{body:form?body:JSON.stringify(body)})});
        const value=await response.json();
        if(!response.ok)throw new Error(typeof value.detail==='string'?value.detail:JSON.stringify(value.detail));
        return value;
    }
    function notice(message,error=false) {
        $('nativeStatus').textContent=message;
        $('nativeStatus').classList.toggle('error',error);
    }
    function options(select,items,id,label) {
        const selected=select.value;select.replaceChildren();
        for(const item of items){const option=document.createElement('option');option.value=item[id];option.textContent=label(item);select.append(option);}
        if(items.some(item=>item[id]===selected))select.value=selected;
    }
    function controls() {
        const running=busy || !!overview?.runs.some(active);
        const writing=!!overview?.runs.some(r=>active(r)&&!['dev','preview'].includes(r.operation));
        $('nativeRuntime').setAttribute('aria-busy',String(running));
        document.querySelectorAll('[data-native]').forEach(button=>{
            const action=button.dataset.native;
            button.disabled=action==='stop'?false:busy || (['develop','agent','resume','play','session','template','import','install','build','changes'].includes(action) && writing);
            if(action==='stop' && !button.closest('#nativeAdvanced'))button.hidden=!running;
            if(action==='adopt')button.disabled=busy || writing || reviewedSession!==$('nativeSessions').value;
        });
        $('nativeAgent').disabled=busy||writing;
        $('nativeTarget').disabled=busy||writing;
        $('nativePlugin').disabled=busy||writing;
        $('nativePluginAction').disabled=busy||writing;
        document.querySelectorAll('[data-round]').forEach(button=>button.disabled=running);
    }
    function renderPreview() {
        const server=overview?.runs.find(r=>r.sessionId===$('nativeSessions').value && r.serverReady && active(r));
        const ready=!!server && Number.isInteger(server.port);
        $('nativePreview').hidden=!ready;$('nativeReady').hidden=!ready;$('nativePreviewEmpty').hidden=ready;
        if(ready)$('nativePreview').href=`http://127.0.0.1:${server.port}/`;
    }
    async function showRun() {
        if(timer)clearTimeout(timer);timer=null;
        const id=$('nativeRuns').value;
        if(!id){$('nativeLog').textContent='';controls();await conversation();return;}
        current=await api('/runs/'+encodeURIComponent(id));
        const index=overview.runs.findIndex(r=>r.runId===id);
        if(index>=0)overview.runs[index]=current;
        $('nativeLog').textContent=`${operationNames[current.operation]||current.operation} · ${stateNames[current.status]||current.status}\n${current.message || ''}\n${current.log || ''}${current.logTruncated?'\n（仅保留最近256KiB日志）':''}`;
        const download=$('nativeExport');download.hidden=!current.artifactManifest;
        download.href=base+'/runs/'+encodeURIComponent(id)+'/web.zip';
        if(!busy){
            if(current.operation==='agent' && current.status==='succeeded')notice(current.plugin?'本机工程开发结束。请在对应引擎或 Git 查看改动，外部文件不经过 Web 源码保存。':'开发完成。先审阅改动，再保存到项目或运行试玩。');
            else if(current.status==='failed')notice(`${operationNames[current.operation]}失败：${current.message||'展开高级工具查看日志，修改后可重新发起。'}`,true);
            else if(active(current))notice(`${operationNames[current.operation]}${current.serverReady?'已就绪':stateNames[current.status]}，可离开本页，任务会继续运行。`);
        }
        $('nativeReview').hidden=!overview.runs.some(r=>r.sessionId===$('nativeSessions').value && r.operation==='agent'&&!r.plugin);
        renderPreview();controls();
        await conversation();
        // 即使选择了旧记录，也继续观察真正运行中的任务。
        if(overview.runs.some(active))timer=setTimeout(()=>void refresh().catch(error=>notice(error.message,true)),2000);
    }
    async function refresh() {
        overview=await api();
        if(!agentPathLoaded){$('nativeAgentPath').value=overview.agents?.[$('nativeAgent').value]||'';agentPathLoaded=true;}
        for(const option of $('nativeAgent').options){const names={codex:'Codex',claude:'Claude Code',opencode:'OpenCode'};option.textContent=names[option.value]+(overview.tools[option.value]?'':' · 未找到');}
        if(!busy)notice(!overview.enabled?'首次开发会请你授权本项目使用本机工具。':!overview.tools[$('nativeAgent').value]?'未找到所选 Agent，请在高级工具配置路径并先完成官方登录。':'开发环境已就绪，填写需求即可开始。');
        options($('nativeSessions'),overview.sessions.sort((a,b)=>b.createdAt-a.createdAt),'sessionId',s=>`${s.branchLabel||'主线'} · ${s.targetPlugin||'Web'} · r${s.workspaceRevision} · ${s.sessionId.slice(-8)}${s.agentSessionId?' · 已有对话':''}`);
        options($('nativeRuns'),overview.runs,'runId',r=>`${operationNames[r.operation]} · ${stateNames[r.status]||r.status} · ${r.runId.slice(-8)}`);
        const initialPlugins=!$('nativePlugin').options.length;
        options($('nativePlugin'),overview.pluginCatalog||[],'id',p=>p.name+(p.enabled?' · 已启用':p.available?' · 可配置':' · 未找到'));
        if(initialPlugins)pluginFields();
        const targets=(overview.pluginCatalog||[]).filter(p=>p.enabled);
        options($('nativeTarget'),[{id:'',name:'当前 Web 工程'},...targets.map(p=>({id:p.id,name:p.name}))],'id',p=>p.name);
        $('nativeTargetLabel').hidden=!targets.length;
        await showRun();
    }
    async function workspace() {
        const response=await fetch(`/api/game-projects/${projectId}/workspace`);
        const value=await response.json();if(!response.ok)throw new Error(value.detail);return value;
    }
    async function start(operation,sid,resume=false,pluginOverride=null) {
        const run=await api('/runs','POST',{sessionId:sid,requestId:crypto.randomUUID(),operation,
            prompt:$('nativePrompt').value,model:$('nativeModel').value.trim(),resume,agent:$('nativeAgent').value,
            ...(operation==='plugin'?{plugin:pluginOverride?.id||$('nativePlugin').value,pluginAction:pluginOverride?.action||$('nativePluginAction').value}:operation==='agent'?{plugin:$('nativeTarget').value}:{})});
        if(operation==='agent'){reviewedSession=null;$('nativeDiff').textContent='';}
        await refresh();$('nativeRuns').value=run.runId;await showRun();return run;
    }
    async function prepare(approved,target='') {
        await refresh();
        if(!overview.enabled){
            if(!approved.enable && !confirm('为本项目开启本机执行？工程脚本使用当前用户权限。仅开启你信任的工程；后续可在高级工具停用。'))return null;
            await api('','PUT',{enabled:true});
        }
        let state=await workspace();
        if(!state.active){
            if(!approved.create && !confirm('为当前游戏创建文件工程？随后可开始开发。'))return null;
            const response=await fetch(`/api/game-projects/${projectId}/workspace`,{method:'POST'});
            state=await response.json();if(!response.ok)throw new Error(state.detail||'创建工程失败');
            document.dispatchEvent(new Event('game-native-source-changed'));
        }
        if(!target&&!state.files.some(file=>file.path==='package.json')){
            if(!approved.template && !confirm('当前是画布游戏工程。是否添加标准 Web 起步模板？原文件保留；现有玩法不会自动迁移。'))return null;
            await api('/template','POST',{baseRevision:state.revision});
            document.dispatchEvent(new Event('game-native-source-changed'));state=await workspace();
        }
        const response=await fetch(`/api/game-projects/${projectId}`);
        const value=await response.json();if(!response.ok)throw new Error('项目状态读取失败');
        const selected=overview.sessions.find(s=>s.sessionId===$('nativeSessions').value);
        if(selected && selected.workspaceRevision===state.revision && selected.workspaceEpoch===state.workspaceEpoch && selected.projectRevision===value.project.revision)return selected;
        const session=await api('/sessions','POST',selected?{parentSessionId:selected.sessionId}:{});
        await refresh();$('nativeSessions').value=session.sessionId;reviewedSession=null;return session;
    }
    async function waitFor(run) {
        while(active(run)){
            if(queueCancelled)throw new Error('已停止准备试玩。');
            await new Promise(resolve=>setTimeout(resolve,800));
            run=await api('/runs/'+encodeURIComponent(run.runId));
        }
        if(run.status!=='succeeded')throw new Error(`${operationNames[run.operation]}${stateNames[run.status]||run.status}，请展开高级工具查看日志。`);
    }
    async function quick(action) {
        if(action==='develop' && !$('nativePrompt').value.trim()){$('nativePrompt').focus();throw new Error('先写下想实现的玩法或修改要求。');}
        await refresh();
        const target=$('nativeTarget').value;
        if((action==='develop'||!target)&&!overview.tools[action==='develop'?$('nativeAgent').value:'npm'])throw new Error(action==='develop'?'未找到所选 Agent，请先安装登录或在高级工具配置路径。':'未找到 npm，请先安装 Node.js 后再运行试玩。');
        const state=await workspace();
        const approved={enable:!overview.enabled,create:!state.active,template:!target&&!state.files.some(file=>file.path==='package.json')};
        const steps=[];
        if(approved.enable)steps.push('为本项目开启本机执行，工程脚本具有当前用户权限，仅运行你信任的工程');
        if(approved.create)steps.push('创建文件工程');
        if(approved.template)steps.push('添加标准 Web 起步模板，原文件保留，已有玩法不会自动迁移');
        if(action==='develop')steps.push('将需求、对话、策划与已选素材交给所选 Agent 开发，可能产生模型费用');
        if(target)steps.push('操作 '+target+' 已绑定的本机原始工程；其文件由引擎或Git负责撤销');
        if(steps.length && !confirm('本次操作将：\n\n'+steps.map(step=>'• '+step).join('\n\n')+'\n\n继续？'))return;
        const session=await prepare(approved,target);if(!session)return;
        if(queueCancelled)return;
        if(action==='develop'){
            await start('agent',session.sessionId,!!session.agentSessionId);
            notice('已开始开发，可继续查看试玩或源码。');
        }else{
            if(target){
                const tool=overview.pluginCatalog.find(p=>p.id===target);
                await start('plugin',session.sessionId,false,{id:target,action:tool.actions.includes('run')?'run':'editor'});
                notice('已启动本机工具，输出可在高级工具与运行记录查看。');return;
            }
            const server=overview.runs.find(r=>r.sessionId===session.sessionId&&r.serverReady&&active(r));
            if(server){renderPreview();notice('游戏已运行，点击「打开游戏」即可试玩。');return;}
            if(overview.runs.some(r=>['dev','preview'].includes(r.operation)&&active(r))){
                if(!confirm('另一个工程副本正在试玩。停止旧试玩并切换到当前工程？'))return;
                await api('/stop','POST');
            }
            notice('正在安装依赖，完成后自动启动试玩…');
            await waitFor(await start('install',session.sessionId));
            if(queueCancelled)return;
            await start('dev',session.sessionId);notice('正在启动试玩，准备好后会显示「打开游戏」。');
        }
    }
    async function perform(action) {
        if(action==='stop'){
            queueCancelled=true;
            try{await api('/stop','POST');await refresh();notice('已停止本机任务。');}catch(error){notice(error.message,true);}return;
        }
        if(busy)return;
        busy=true;queueCancelled=false;controls();
        try {
            if(!['refresh','disable'].includes(action) && !document.dispatchEvent(new Event('game-native-before-operation',{cancelable:true}))){notice('请先保存源码或数值草稿，再开始开发或运行。',true);return;}
            if(action==='refresh')return await refresh();
            if(action==='agentConfig'){
                await api('/agents/'+$('nativeAgent').value,'PUT',{executable:$('nativeAgentPath').value.trim()});
                await refresh();notice('Agent 路径已保存；登录沿用该 CLI 自身配置。');return;
            }
            if(action==='pluginConfig'||action==='pluginDisable'){
                if(action==='pluginConfig'&&!confirm('绑定此本机工程并允许工具及开发 Agent 操作它？外部工程不在 Web 对话撤销范围内。'))return;
                await api('/plugins/'+$('nativePlugin').value,'PUT',{executable:$('nativePluginPath').value.trim(),project:$('nativePluginProject').value.trim(),enabled:action==='pluginConfig'});
                await refresh();pluginFields();notice(action==='pluginConfig'?'工具已启用，后续开发会提供调用命令。':'工具已停用。');return;
            }
            if(action==='plugin'){
                if(!confirm('运行已绑定的本机工具？工具可能修改原始工程，输出见运行记录。'))return;
                const state=await workspace();
                if(!state.active){const response=await fetch(`/api/game-projects/${projectId}/workspace`,{method:'POST'});if(!response.ok)throw new Error('创建工程失败');}
                let sid=$('nativeSessions').value;
                if(!sid){const session=await api('/sessions','POST');sid=session.sessionId;}
                await start('plugin',sid);return;
            }
            if(action==='develop'||action==='play')return await quick(action);
            if(action==='enable' || action==='disable') {
                if(action==='enable' && !confirm('为此项目开启本机执行：项目脚本具有本机用户权限；仅开启你信任的工程。'))return;
                await api('','PUT',{enabled:action==='enable'});
            } else if(action==='template') {
                if(!confirm('添加标准 Web 起步文件，原文件保留；已有玩法不会自动迁移。继续？'))return;
                await api('/template','POST',{baseRevision:(await workspace()).revision});
                document.dispatchEvent(new Event('game-native-source-changed'));
            } else if(action==='import') {
                const file=$('nativeImport').files[0];if(!file)throw new Error('请选择源码 ZIP');
                if(!confirm('将源码合并到当前工程；同路径文件会被替换，并保存恢复点。继续？'))return;
                const body=new FormData();body.append('file',file);body.append('baseRevision',(await workspace()).revision);
                await api('/import','POST',body);document.dispatchEvent(new Event('game-native-source-changed'));
            } else if(action==='session') {
                const session=await api('/sessions','POST',$('nativeSessions').value?{parentSessionId:$('nativeSessions').value}:{});await refresh();$('nativeSessions').value=session.sessionId;reviewedSession=null;return;
            } else if(action==='changes' || action==='adopt') {
                const sid=$('nativeSessions').value;if(!sid)throw new Error('尚无工程副本，请先开发或运行试玩。');
                if(action==='adopt' && reviewedSession!==sid)throw new Error('请先审阅这份工程的改动。');
                if(action==='adopt' && !confirm('将已审阅改动保存到项目？当前版本会保留恢复点。'))return;
                const value=await api('/sessions/'+encodeURIComponent(sid)+'/changes','POST',{apply:action==='adopt'});
                $('nativeDiff').textContent=(value.changes||[]).map(change=>change.diff||change.path).join('\n\n')||value.message||'改动已保存。';
                reviewedSession=action==='changes'&&value.changes?.length?sid:null;
                if(action==='adopt'){document.dispatchEvent(new Event('game-native-source-changed'));notice('改动已保存到项目，可运行试玩。');}
            } else {
                const sid=$('nativeSessions').value;if(!sid)throw new Error('请先开发或运行试玩，工程副本会自动准备。');
                if(['agent','resume'].includes(action) && !confirm('调用所选 Agent 开发，可能产生模型费用。继续？'))return;
                await start(action==='resume'?'agent':action,sid,action==='resume');return;
            }
            await refresh();
        } catch(error){notice(error.message,true);}
        finally{busy=false;controls();}
    }
    document.querySelectorAll('[data-native]').forEach(button=>button.onclick=()=>void perform(button.dataset.native));
    const actionLabels={check:'检查工程',run:'运行游戏',editor:'打开编辑器',build:'构建',render:'渲染首帧',export:'导出素材'};
    function pluginFields(){
        const plugin=overview?.pluginCatalog?.find(p=>p.id===$('nativePlugin').value);if(!plugin)return;
        $('nativePluginPath').value=plugin.executable||'';$('nativePluginProject').value=plugin.project||'';
        options($('nativePluginAction'),plugin.actions.map(id=>({id})),'id',a=>actionLabels[a.id]||a.id);
    }
    async function conversation(){
        const sid=$('nativeSessions').value,container=$('nativeConversation');
        if(!sid){container.textContent='开发后会保留需求、回复和每轮恢复点。';return;}
        const value=await api('/sessions/'+encodeURIComponent(sid)+'/conversation');
        if($('nativeSessions').value!==sid)return;
        container.replaceChildren();
        for(const round of [...value.rounds,...(value.hostHistory||[])].sort((a,b)=>(a.createdAt||0)-(b.createdAt||0))){
            const item=document.createElement('article'),title=document.createElement('strong'),text=document.createElement('pre');
            title.textContent=`${round.agent}${round.targetPlugin?' · '+round.targetPlugin:''} · ${stateNames[round.status]||round.status}`;
            text.style.whiteSpace='pre-wrap';text.textContent=`你：${round.prompt}\n\n${round.answer||round.message||'回复尚未完成；详细工具输出见运行记录。'}`;
            item.append(title,text);
            for(const restore of round.roundId?(round.targetPlugin?[false]:[false,true]):[]){
                const button=document.createElement('button');button.dataset.round=round.roundId;
                button.textContent=restore?'撤销到此轮之前':round.targetPlugin?'分支对话（外部文件保持当前状态）':'从此轮之前分支';
                button.onclick=()=>void forkRound(sid,round.roundId,restore);item.append(button);
            }
            container.append(item);
        }
        if(!value.rounds.length&&!value.hostHistory?.length)container.textContent='此分支尚无开发记录。';
        controls();
    }
    async function forkRound(sid,roundId,restore){
        if(busy)return;
        if(!document.dispatchEvent(new Event('game-native-before-operation',{cancelable:true})))return;
        if(!confirm(restore?'恢复到本轮开始前的源码？保存项目与工程副本一起恢复；原分支和恢复点保留，素材和外部引擎文件不变。':'从本轮开始前创建新分支？原分支保留，已保存项目暂不改变。'))return;
        busy=true;controls();
        try{
            const session=await api('/sessions/'+encodeURIComponent(sid)+'/branch','POST',{roundId,restore});
            reviewedSession=null;$('nativeDiff').textContent='';await refresh();$('nativeSessions').value=session.sessionId;
            $('nativeTarget').value=session.targetPlugin||'';
            await conversation();renderPreview();
            if(restore)document.dispatchEvent(new Event('game-native-source-changed'));
            notice(restore?'已撤销并切换到恢复分支，原对话仍保留。':'已切换到新分支，下一次开发自动交接上下文。');
        }catch(error){notice(error.message,true);}finally{busy=false;controls();}
    }
    $('nativePlugin').onchange=pluginFields;
    $('nativeAgent').onchange=()=>{
        try{localStorage.setItem('game-agent:'+projectId,$('nativeAgent').value);}catch{}
        $('nativeAgentPath').value=overview?.agents?.[$('nativeAgent').value]||'';$('nativeModel').value='';
        notice('下一轮使用所选 Agent，已有对话会自动交接。');
    };
    $('nativeRuns').onchange=()=>void showRun().catch(error=>notice(error.message,true));
    $('nativeSessions').onchange=()=>{reviewedSession=null;$('nativeDiff').textContent='';renderPreview();controls();void conversation().catch(error=>notice(error.message,true));$('nativeReview').hidden=!overview?.runs.some(r=>r.sessionId===$('nativeSessions').value&&r.operation==='agent'&&!r.plugin);};
    window.addEventListener('beforeunload',()=>{if(timer)clearTimeout(timer);});
    void refresh().catch(error=>notice(error.message+'；可继续使用试玩和源码页面。',true));
})();
