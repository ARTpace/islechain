/* ponytail: MCP management stays outside cards; canvas proposals reuse factories, connections and undo. */
(() => {
    'use strict';
    const types = ['comfy','extension','prompt','llm','image','generator','output','gameIdea','gamePlan','gameAssets','gameDevelop','gameTest','gameRelease','gameModelAsset','gameModel3d','gameAnimate3d','gameSpeech','gameFile','gameScene'];
    const fields = ['text','instruction','idea','feedback','chatInput','systemPrompt','name','audioOperation','audioPrompt','modelPrompt','nodeDefinition','comfyBuildId','comfyRevision'];
    const nodeLabels={prompt:'提示词',llm:'AI 文本',image:'图片',generator:'图片生成',output:'输出',gameIdea:'游戏灵感',gamePlan:'游戏策划',gameAssets:'资产拆解',gameDevelop:'游戏开发',gameTest:'试玩与场景',gameRelease:'游戏交付',gameModelAsset:'模型资产',gameModel3d:'3D 模型生成',gameAnimate3d:'3D 动画',gameSpeech:'音频生成',gameFile:'文件资料',gameScene:'试玩与场景'};
    const esc = value => escapeHtml(String(value ?? ''));
    let panel, configs = [], models = [], controller = null, candidate = null, base = '', sourceCanvas = '', candidateMessageId='';
    let chatCanvasId='', chat={messages:[],draft:'',model:'',serverIds:[]}, references=[], saveTimer=null;
    let configsReady=false;
    // Tool keys the user allowed for this canvas session (serverId/toolName).
    let preapproved = new Set();
    // Selected MCP resources and prompts, keyed 'resource:server/uri' | 'prompt:server/name'.
    let extraRefs = new Set();
    // Pending approval request rendered inline in the message list.
    let approval = null;
    const RISK_LABEL = {readonly:'只读',mutating:'写入',destructive:'危险',trusted:'已信任'};
    const $ = id => panel?.querySelector(`[data-agent="${id}"]`);
    async function api(path, method='GET', body) {
        const response = await fetch('/api/mcp' + path, {method, headers:{'Content-Type':'application/json','X-Art-MCP':'1'}, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
        const data = await response.json();
        if(!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'MCP 请求失败');
        return data;
    }
    function snapshot() {
        const projectId = window.GamePipeline?.projectId || null;
        const snap = {projectId, selectedNodeIds:references.map(item=>item.id).filter(id=>nodes.some(node=>node.id===id)), nodes:nodes.map(node => Object.fromEntries(['id','type','x','y',...fields].filter(key => node[key] !== undefined).map(key => [key,node[key]]))), connections:connections.map(({from,to,bindings}) => ({from,to,...(bindings===undefined?{}:{bindings:JSON.parse(JSON.stringify(bindings))})}))};
        for(const node of snap.nodes){const source=nodes.find(item=>item.id===node.id);if(node.type==='image'&&typeof mediaKindForNode==='function')node.mediaKind=mediaKindForNode(source);}
        snap.connectionRules = types.flatMap(from => types.filter(to => canConnectNodes({id:'__agent_from',type:from,projectId},{id:'__agent_to',type:to,projectId})).map(to => [from,to]));
        snap.conditionalConnectionRules={imageWorkerInputs:['image','output','group','generator','comfy'],
            condition:'目标 extension 声明 ports 时必须用 bindings 映射兼容端口，集合到单值必须指定 index（0—7）；可为已有连线提交 bindings 更新映射。未声明 ports 的节点保持旧协议。目标 extension 的 execution.media=true 时可接受图片；源 extension 的 execution.media=true 时可连接 output。以实际节点定义校验。'};
        return snap;
    }
    function fingerprint() { const {selectedNodeIds,...data}=snapshot();return JSON.stringify(data); }
    function notice(message) { if($('notice'))$('notice').textContent=message || ''; }
    function persist(session=chat,id=chatCanvasId) {
        if(!id)return;
        try{window.CanvasAgentState.save(id,session);}catch{notice('浏览器存储已满或不可用；本次对话仍可继续，刷新前请保留重要内容。');}
    }
    function loadChat() {
        if(!panel || !canvas?.id || chatCanvasId===canvas.id)return;
        clearTimeout(saveTimer);persist();controller?.abort();
        chatCanvasId=canvas.id;chat=window.CanvasAgentState.load(chatCanvasId);references=[];candidate=null;candidateMessageId='';
        $('prompt').value=chat.draft;renderMessages();renderReferences();renderPicks();renderExtras();
        $('canvas-title').textContent=canvas.title || '当前画布';
        window.CanvasComfyBuilds?.changed();
    }
    function setFields(node, values) {
        if(values.nodeDefinition){
            if(node.type!=='extension')throw new Error('只有配置型节点可以设置定义');
            window.CanvasNodeCatalog.initialize(node,JSON.parse(values.nodeDefinition));
        }
        if(node.running || ['queued','running'].includes(node.audioJob?.status) || node.audioPending)throw new Error('目标节点正在执行，请完成后再采用方案');
        if(values.audioOperation && values.audioOperation!==node.audioOperation){
            delete node.audioJob;delete node.audioAssetId;delete node.audioPending;delete node.extraNotice;
        }
        for(const [key,value] of Object.entries(values)){
            if(!fields.includes(key))throw new Error('节点属性不支持');node[key]=value;
        }
    }
    function renderMessages() {
        const host=$('messages'),follow=host.scrollTop+host.clientHeight>=host.scrollHeight-60;
        const expanded=new Set([...host.querySelectorAll('details[open]')].map(item=>item.dataset.messageId));
        host.innerHTML=chat.messages.length ? chat.messages.map(message=>{
            const active=message.id===candidateMessageId && candidate && message.status==='proposed';
            const state={applied:'已采用到画布',expired:'旧方案已失效，可继续对话重新生成',superseded:'已有后续对话',interrupted:'已停止，可重新发送',failed:'未完成，请查看原因',denied:'工具调用被拒绝'}[message.status];
            const trace=message.trace || [];
            const running=trace.find(item=>item.status==='running');
            const progress=running && running.progress;
            return `<article class="canvas-agent-message is-${message.role}" data-message-id="${esc(message.id)}"><div class="canvas-agent-speaker">${message.role==='user'?'你':'画布 AI'}</div>
              ${(message.references || []).length?`<div class="canvas-agent-inline-refs">${message.references.map(item=>`<span>${esc(item.label)}</span>`).join('')}</div>`:''}
              ${message.text?`<div class="canvas-agent-content">${esc(message.text)}</div>`:''}
              ${message.status==='working'?`<div class="canvas-agent-thinking" role="status">${esc(message.progress || '正在理解画布…')}</div>`:''}
              ${trace.length?`<details class="canvas-agent-execution" data-message-id="${esc(message.id)}" ${expanded.has(message.id)?'open':''}><summary>${message.status==='working'?'正在执行':'执行记录'} · ${trace.length} 项</summary>${trace.map(item=>`<div><span>${esc(item.name)}</span><small>${esc({running:'进行中',completed:'完成',failed:'失败',denied:'已拒绝'}[item.status] || '已停止')}</small></div>${item.status==='running'&&item.progress!=null?`<div class="canvas-agent-progress"><i style="width:${Math.max(0,Math.min(100,Number(item.progress)||0))}%"></i></div><div class="canvas-agent-progress-note">${esc(item.progressNote||'')}</div>`:''}`).join('')}</details>`:''}
              ${message.summary?`<div class="canvas-agent-proposal"><strong>画布编辑方案</strong><p>${esc(message.summary)}</p>${active?`<small>新增 ${candidate.nodes.length} 个节点 · 修改 ${(candidate.updates || []).length} 个节点 · ${candidate.connections.length} 条连线</small>${changePreview()}<button type="button" class="agent-primary" data-adopt="${esc(message.id)}" ${controller?'disabled':''}>采用到画布</button>`:''}</div>`:''}
              ${state?`<div class="canvas-agent-message-state">${esc(state)}</div>`:''}</article>`;
        }).join('') + (approval?approvalCard():'') : `<div class="canvas-agent-empty"><div class="canvas-agent-mark">✦</div><h3>想在画布上完成什么？</h3><p>描述目标，让 AI 帮你搭建和修改工作流。</p><button type="button" data-starter="搭建一个角色美术工作流，包含描述、生图和输出节点。">搭建美术工作流 <span>↗</span></button><button type="button" data-starter="查看当前画布，告诉我下一步可以做什么。">看看下一步做什么 <span>↗</span></button></div>`;
        host.querySelectorAll('[data-starter]').forEach(button=>button.onclick=()=>{$('prompt').value=button.dataset.starter;chat.draft=$('prompt').value;persist();$('prompt').focus();});
        host.querySelectorAll('[data-adopt]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await apply();}catch(error){notice(error.message);}finally{button.disabled=false;}});
        host.querySelectorAll('[data-approval]').forEach(button=>button.onclick=()=>decideApproval(button.dataset.approval,button.dataset.remember==='1'));
        if(follow)host.scrollTop=host.scrollHeight;
    }
    function approvalCard() {
        if(!approval)return '';
        const args=JSON.stringify(approval.arguments||{},null,2);
        return `<div class="canvas-agent-approval" data-agent="approval-card"><strong>请求执行外部工具</strong><small>${esc(approval.name)} · ${esc(RISK_LABEL[approval.risk]||'危险')}级操作，请确认后继续</small><pre>${esc(args.slice(0,1200))}</pre><div class="canvas-agent-approval-actions"><button type="button" data-approval="allow">允许一次</button><button type="button" data-approval="allow" data-remember="1">本次会话允许</button><button type="button" data-approval="deny">拒绝</button></div></div>`;
    }
    async function decideApproval(action,remember) {
        if(!approval)return;
        const current=approval;approval=null;
        renderMessages();
        try{
            await api('/agent/approval','POST',{id:current.id,granted:action==='allow',remember:!!remember});
            if(action==='allow'&&remember&&current.tool)preapproved.add(current.tool);
        }catch(error){notice(error.message);}
    }
    function changePreview() {
        const previous=JSON.parse(base).nodes;
        const names=new Map(previous.map(node=>[node.id,node.name || nodeLabels[node.type] || node.type]));
        candidate.nodes.forEach(node=>names.set(node.id,node.fields?.name || nodeLabels[node.type] || node.type));
        const fieldLabels={text:'提示词',instruction:'开发要求',idea:'游戏灵感',feedback:'修改要求',chatInput:'对话输入',systemPrompt:'角色设定',name:'名称',audioOperation:'音频类型',audioPrompt:'音频描述',modelPrompt:'模型描述'};
        const additions=candidate.nodes.map(node=>`<div><strong>新增 · ${esc(names.get(node.id))}</strong>${Object.entries(node.fields || {}).map(([key,value])=>`<small>${esc(fieldLabels[key] || key)}</small><pre>${esc(value)}</pre>`).join('')}</div>`).join('');
        const updates=(candidate.updates || []).map(update=>{const before=previous.find(node=>node.id===update.id) || {};return `<div><strong>修改 · ${esc(names.get(update.id))}</strong>${Object.entries(update.fields || {}).map(([key,value])=>`<small>${esc(fieldLabels[key] || key)} · 原内容</small><pre>${esc(before[key] || '（空）')}</pre><small>新内容</small><pre>${esc(value)}</pre>`).join('')}</div>`;}).join('');
        const links=candidate.connections.map(edge=>`<div class="canvas-agent-change-link">${esc(names.get(edge.from))} → ${esc(names.get(edge.to))}${(edge.bindings||[]).map(binding=>`<small>${esc(binding.source)}${binding.index===undefined?'':`[${esc(binding.index)}]`} → ${esc(binding.target)}</small>`).join('')}</div>`).join('');
        return `<details class="canvas-agent-change-preview"><summary>查看具体变更</summary><div>${additions}${updates}${links?`<strong>连线与端口映射</strong>${links}`:''}</div></details>`;
    }
    function renderReferences() {
        $('references').innerHTML=references.map(item=>`<button type="button" data-remove-ref="${esc(item.id)}" aria-label="移除引用 ${esc(item.label)}">${esc(item.label)} <span>×</span></button>`).join('');
        $('references').querySelectorAll('[data-remove-ref]').forEach(button=>button.onclick=()=>{references=references.filter(item=>item.id!==button.dataset.removeRef);renderReferences();});
        $('context').textContent=`当前画布 · ${nodes.length} 个节点`;
    }
    function closePanel() { panel.hidden=true;window.CanvasComfyBuilds?.hide();document.body.classList.remove('canvas-agent-open','canvas-agent-resizing');document.getElementById('canvasAgentToggle')?.setAttribute('aria-expanded','false');persist(); }
    function buildDialog() {
        panel=document.createElement('aside');panel.className='canvas-agent-sidebar';panel.hidden=true;panel.setAttribute('aria-label','画布 AI 对话');
        panel.innerHTML=`<div class="canvas-agent-resize" role="separator" aria-label="调整 AI 对话宽度" aria-orientation="vertical" tabindex="0"></div>
          <header class="canvas-agent-header"><div><h2>画布 AI</h2><span data-agent="canvas-title">当前画布</span></div><div class="canvas-agent-header-actions"><button type="button" data-agent="close" aria-label="收起 AI 对话" title="收起对话"><i data-lucide="panel-right-close"></i></button></div></header>
          <div class="canvas-agent-messages" data-agent="messages" role="log" aria-label="画布对话记录" aria-live="polite"></div>
          <footer class="canvas-agent-footer"><div class="canvas-agent-context"><span data-agent="context"></span><button type="button" data-agent="attach">＋ 引用选中节点</button></div><div class="canvas-agent-references" data-agent="references"></div>
            <div class="canvas-agent-extra" data-agent="extra-refs"></div>
            <form data-agent="form" class="canvas-agent-composer"><label class="canvas-agent-input-label" for="canvasAgentPrompt">告诉 AI 如何编辑画布</label><textarea id="canvasAgentPrompt" data-agent="prompt" rows="3" maxlength="16000" placeholder="描述想法，或继续提出修改…"></textarea>
              <div class="canvas-agent-compose-actions"><select data-agent="model" aria-label="对话模型"></select><button type="button" data-agent="tools" aria-label="本次使用的 MCP 工具">工具</button><button type="submit" data-agent="run" class="agent-primary" aria-label="发送消息" title="发送（Enter）"><i data-lucide="arrow-up"></i></button><button type="button" data-agent="stop" class="agent-primary" aria-label="停止生成" hidden><i data-lucide="square"></i></button></div></form>
            <div class="canvas-agent-tool-picker" data-agent="tool-picker" hidden><strong>本次使用的外部工具</strong><div data-agent="picks"></div><small>已授权的工具可能修改外部文件。服务与授权在「设置 → MCP 工具」里管理。</small></div>
            <p class="canvas-agent-notice" data-agent="notice" role="status"></p><div class="canvas-agent-input-hint">Enter 发送 · Shift + Enter 换行</div></footer>`;
        document.body.append(panel);
        window.CanvasComfyBuilds?.mount(panel);
        $('close').onclick=closePanel;
        $('tools').onclick=()=>{$('tool-picker').hidden=!$('tool-picker').hidden;};
        $('stop').onclick=()=>controller?.abort();
        $('form').onsubmit=event=>{event.preventDefault();run().catch(error=>notice(error.message));};
        $('prompt').onkeydown=event=>{if(event.key==='Enter' && !event.shiftKey && !event.isComposing){event.preventDefault();if(!controller)$('form').requestSubmit();}};
        $('prompt').oninput=()=>{chat.draft=$('prompt').value;clearTimeout(saveTimer);saveTimer=setTimeout(()=>persist(),300);};
        $('model').onchange=()=>{const model=models[Number($('model').value)];chat.model=model?JSON.stringify([model.provider,model.model]):'';persist();};
        $('attach').onclick=()=>{references=nodes.filter(node=>selected.has(node.id)).slice(0,24).map(node=>({id:node.id,label:node.name || node.title || nodeLabels[node.type] || node.type}));renderReferences();if(!references.length)notice('先在画布中选中节点，再点击引用。');else notice('');};
        const resize=panel.querySelector('.canvas-agent-resize');
        const setWidth=value=>{const maximum=Math.max(340,Math.min(580,window.innerWidth*.55)),width=Math.round(Math.max(340,Math.min(value,maximum)));document.body.style.setProperty('--canvas-agent-width',width+'px');resize.setAttribute('aria-valuemin','340');resize.setAttribute('aria-valuemax',String(Math.round(maximum)));resize.setAttribute('aria-valuenow',String(width));resize.setAttribute('aria-valuetext',width+' 像素');return width;};
        let width=390;try{width=Number(localStorage.getItem('canvas-agent-width')) || 390;}catch{}width=setWidth(width);
        window.addEventListener('resize',()=>{if(window.innerWidth>=900)width=setWidth(width);});
        resize.onpointerdown=event=>{resize.setPointerCapture(event.pointerId);document.body.classList.add('canvas-agent-resizing');};
        resize.onpointermove=event=>{if(resize.hasPointerCapture(event.pointerId))width=setWidth(window.innerWidth-event.clientX);};
        const finish=()=>{document.body.classList.remove('canvas-agent-resizing');try{localStorage.setItem('canvas-agent-width',String(width));}catch{}};
        resize.onpointerup=finish;resize.onpointercancel=finish;
        resize.onkeydown=event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();width=setWidth(width+(event.key==='ArrowLeft'?16:-16));finish();}};
        window.addEventListener('beforeunload',()=>{clearTimeout(saveTimer);persist();});
        panel.addEventListener('keydown',event=>{if(event.key==='Escape')closePanel();});
        window.lucide?.createIcons();
    }
    async function refresh() {
        configs=(await api('/servers')).servers;
        configsReady=true;
        renderPicks();
    }
    async function showExtras(host,config) {
        host.hidden=false;
        host.innerHTML='<div class="canvas-agent-extra-empty">正在读取资源与提示词…</div>';
        const id=encodeURIComponent(config.id);
        const [resources,prompts]=await Promise.all([
            api('/servers/'+id+'/resources','POST',{}).catch(()=>({resources:[],templates:[]})),
            api('/servers/'+id+'/prompts','POST',{}).catch(()=>({prompts:[]}))]);
        const items=[];
        (resources.resources||[]).forEach(item=>items.push(`<label><input type="checkbox" data-ref-kind="resource" data-ref-server="${esc(config.id)}" data-ref-value="${esc(item.uri||item.name||'')}"><span>${esc(item.name||item.uri||'')}<small>${esc(item.uri||'')}</small></span></label>`));
        (prompts.prompts||[]).forEach(item=>items.push(`<label><input type="checkbox" data-ref-kind="prompt" data-ref-server="${esc(config.id)}" data-ref-value="${esc(item.name||'')}"><span>${esc(item.name||'')}<small>${esc(item.description||'提示词模板')}</small></span></label>`));
        host.innerHTML=items.length?items.join(''):'<div class="canvas-agent-extra-empty">该服务未提供资源或提示词。</div>';
        host.querySelectorAll('[data-ref-kind]').forEach(input=>input.onchange=()=>{
            const kind=input.dataset.refKind;
            const key=kind+':'+input.dataset.refServer+'/'+input.dataset.refValue;
            if(input.checked)extraRefs.add(key);else extraRefs.delete(key);
            renderExtras();
        });
        renderExtras();
    }
    function renderExtras() {
        const host=$('extra-refs');
        if(!host)return;
        const items=[...extraRefs].map(key=>{
            const [kind,...rest]=key.split(':');
            const value=rest.join(':');
            return `<button type="button" data-remove-extra="${esc(key)}" aria-label="移除引用 ${esc(value)}">${kind==='resource'?'资源':'提示词'} · ${esc(value)} <span>×</span></button>`;
        });
        host.innerHTML=items.join('');
        host.querySelectorAll('[data-remove-extra]').forEach(button=>button.onclick=()=>{extraRefs.delete(button.dataset.removeExtra);renderExtras();});
    }
    function extraPayload() {
        const resources=[],prompts=[];
        for(const key of extraRefs){
            const index=key.indexOf(':');
            const kind=key.slice(0,index);
            const rest=key.slice(index+1);
            const slash=rest.lastIndexOf('/');
            const server=rest.slice(0,slash);
            const value=rest.slice(slash+1);
            if(kind==='resource')resources.push({server,uri:value});else prompts.push({server,name:value,arguments:{}});
        }
        return {resources,prompts};
    }
    function renderPicks() {
        if(!$('picks'))return;
        const selectedIds=new Set(chat.serverIds);
        const available=configs.filter(s=>s.enabled && s.enabledTools.length);
        if(configsReady)chat.serverIds=chat.serverIds.filter(id=>available.some(config=>config.id===id));
        $('picks').innerHTML=available.map(s=>`<div class="canvas-agent-pick" data-pick="${esc(s.id)}"><label><input type="checkbox" data-server-pick="${esc(s.id)}" ${selectedIds.has(s.id)?'checked':''}> ${esc(s.id)} · ${s.enabledTools.length} 个工具</label><button type="button" data-extras>资源 / 提示词</button><div class="canvas-agent-extra-list" data-extras-list hidden></div></div>`).join('') || '<small>尚无已授权工具，可在「设置 → MCP 工具」中启用服务并授权工具。</small>';
        $('picks').querySelectorAll('[data-server-pick]').forEach(input=>input.onchange=()=>{chat.serverIds=[...$('picks').querySelectorAll('[data-server-pick]:checked')].map(el=>el.dataset.serverPick);$('tools').textContent=chat.serverIds.length?`工具 · ${chat.serverIds.length}`:'工具';persist();});
        $('picks').querySelectorAll('[data-pick]').forEach(details=>{
            const config=configs.find(s=>s.id===details.dataset.pick);
            details.querySelector('[data-extras]').onclick=()=>showExtras(details.querySelector('[data-extras-list]'),config).catch(error=>notice(error.message));
        });
        $('tools').textContent=chat.serverIds.length?`工具 · ${chat.serverIds.length}`:'工具';
    }
    async function run() {
        if(controller)return;
        if(!canvas?.id)throw new Error('请先打开画布');
        loadChat();
        const prompt=$('prompt').value.trim();if(!prompt)throw new Error('请描述希望完成的任务');
        const model=models[Number($('model').value)];if(!model)throw new Error('请先在 API 配置中添加聊天模型');
        const snap=snapshot();base=fingerprint();sourceCanvas=canvas.id;candidate=null;
        const session=chat,requestCanvas=chatCanvasId;
        session.model=JSON.stringify([model.provider,model.model]);
        session.messages.filter(message=>message.status==='proposed').forEach(message=>message.status='superseded');
        const history=window.CanvasAgentState.history(session.messages);
        session.messages.push({id:crypto.randomUUID(),role:'user',text:prompt,references:[...references]});
        const message={id:crypto.randomUUID(),role:'assistant',text:'',status:'working',trace:[]};session.messages.push(message);
        session.messages=session.messages.slice(-40);session.draft='';$('prompt').value='';references=[];renderReferences();notice('');
        controller=new AbortController();$('run').hidden=true;$('stop').hidden=false;
        renderMessages();$('messages').scrollTop=$('messages').scrollHeight;persist();
        try {
            const extras=extraPayload();
            const response=await fetch('/api/mcp/agent',{method:'POST',headers:{'Content-Type':'application/json','X-Art-MCP':'1'},signal:controller.signal,body:JSON.stringify({canvasId:requestCanvas,prompt,history,provider:model.provider,model:model.model,serverIds:session.serverIds,snapshot:snap,preapproved:[...preapproved],resources:extras.resources,prompts:extras.prompts})});
            if(!response.ok){const data=await response.json();throw new Error(typeof data.detail==='string'?data.detail:'AI 请求失败');}
            const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
            const consume=line=>{if(!line.trim())return;const event=JSON.parse(line);
                if(chatCanvasId!==requestCanvas)throw new DOMException('画布已切换','AbortError');
                if(event.type==='progress')message.progress=event.message;
                if(event.type==='tool'){
                    if(event.name==='comfy_start_test' && event.status==='completed')window.CanvasComfyBuilds?.changed(true);
                    const running=message.trace.findLast(item=>item.name===event.name && item.status==='running');
                    if(running)running.status=event.status;else message.trace.push({name:event.name,status:event.status});
                    message.progress=`${event.name} · ${{running:'调用中',completed:'完成',failed:'失败',denied:'已拒绝'}[event.status] || event.status}`;
                }
                if(event.type==='comfyJob')window.CanvasComfyBuilds?.changed(true);
                if(event.type==='toolProgress'){
                    const running=message.trace.findLast(item=>item.name===event.name && item.status==='running');
                    if(running){running.progress=event.progress;running.progressNote=event.message||'';running.total=event.total;}
                }
                if(event.type==='approval'){approval={id:event.id,name:event.name,risk:event.risk,arguments:event.arguments};message.progress=`等待确认：${event.name}`;}
                if(event.type==='error')throw new Error(event.message);
                if(event.type==='result'){candidate=event.proposal;candidateMessageId=message.id;message.text=event.text || '';message.summary=candidate?.summary || '';message.status=candidate?'proposed':'completed';}
                renderMessages();
            };
            while(true){const {value,done}=await reader.read();pending+=decoder.decode(value || new Uint8Array(),{stream:!done});const lines=pending.split('\n');pending=lines.pop();lines.forEach(consume);if(done){consume(pending);break;}}
            if(message.status==='working')throw new Error('连接已结束，但未收到完整结果，请重新发送。');
        } catch(error){
            controller?.abort();
            message.status=error.name==='AbortError'?'interrupted':'failed';message.text=error.name==='AbortError'?'已停止生成。已完成的外部工具操作不会撤销。':error.message;
            if(chatCanvasId===requestCanvas && !$('prompt').value){session.draft=prompt;$('prompt').value=prompt;}
        } finally{
            controller=null;$('run').hidden=false;$('stop').hidden=true;persist(session,requestCanvas);
            if(chatCanvasId===requestCanvas){renderMessages();window.CanvasComfyBuilds?.changed();}
        }
    }
    async function apply() {
        if(!candidate)return;
        if(controller)throw new Error('请等待当前回复完成后再采用方案');
        if(canvas?.id!==sourceCanvas || fingerprint()!==base)throw new Error('画布已发生变化，请继续对话重新生成方案');
        const applying=candidate;
        for(const item of applying.nodes.filter(item=>item.type==='extension'))await window.CanvasNodeCatalog.install(JSON.parse(item.fields.nodeDefinition));
        const comfyArtifacts=new Map();
        for(const item of applying.nodes.filter(item=>item.type==='comfy'))comfyArtifacts.set(item.id,await window.CanvasComfyBuilds.prepare(item.fields,sourceCanvas));
        if(candidate!==applying || canvas?.id!==sourceCanvas || fingerprint()!==base)throw new Error('安装定义期间画布已变化，请重新生成方案；已安装定义保留在目录中');
        const currentProject=window.GamePipeline?.project;
        if(candidate.nodes.some(node=>node.type.startsWith('game')) && (!currentProject || currentProject.archived || currentProject.canvasId!==canvas.id))throw new Error('游戏工程不可用，请先初始化工程');
        const oldNodes=nodes,oldConnections=connections,oldUndo=undoStack.slice();
        const bounds=document.getElementById('board').getBoundingClientRect();
        const point=screenToWorld(bounds.left+bounds.width/2-220,bounds.top+bounds.height/2-180),mapping=new Map(nodes.map(node=>[node.id,node.id]));
        if(candidate.nodes.length && nodes.length){
            const left=point.x+Math.min(...candidate.nodes.map(node=>node.x));
            const right=point.x+Math.max(...candidate.nodes.map(node=>node.x+440));
            const top=point.y+Math.min(...candidate.nodes.map(node=>node.y));
            const bottom=point.y+Math.max(...candidate.nodes.map(node=>node.y+500));
            if(nodes.some(node=>node.x<right && node.x+(node.w||440)>left && node.y<bottom && node.y+(node.h||500)>top))
                point.y=Math.max(...nodes.map(node=>node.y+(node.h||500)))+120-Math.min(...candidate.nodes.map(node=>node.y));
        }
        try {
            pushUndo();const singleUndo=undoStack.slice();nodes=nodes.map(node=>({...node}));connections=connections.map(edge=>({...edge}));
            for(const item of candidate.nodes){
                if(!types.includes(item.type))throw new Error('不支持的节点类型');
                const node=createNodeByType(item.type,{x:point.x+item.x,y:point.y+item.y});
                if(!node || typeof node.then==='function')throw new Error('节点创建失败');
                mapping.set(item.id,node.id);
                setFields(node,item.fields || {});
                if(item.type==='comfy')window.CanvasComfyBuilds.configure(node,comfyArtifacts.get(item.id),item.fields);
            }
            for(const item of candidate.updates || []){
                const node=nodes.find(node=>node.id===item.id);if(!node)throw new Error('修改目标不存在');
                setFields(node,item.fields || {});
            }
            for(const edge of candidate.connections){
                const from=mapping.get(edge.from),to=mapping.get(edge.to);
                if(!canConnect(from,to))throw new Error('方案中包含不兼容连线，请重新生成');
                const existing=connections.find(item=>item.from===from && item.to===to);
                const bindings=edge.bindings===undefined?undefined:JSON.parse(JSON.stringify(edge.bindings));
                if(bindings!==undefined){
                    const target=nodes.find(node=>node.id===to);
                    if(target?.running)throw new Error('目标节点正在运行，请结束后重新采用方案');
                    if(existing)existing.bindings=bindings;
                    if(target){delete target.outputText;delete target.extensionImages;delete target.extensionPortOutputs;target.runStatus='';}
                }
                if(!existing)connections.push({id:uid('c'),from,to,...(bindings===undefined?{}:{bindings})});
            }
            undoStack=singleUndo;render();
            const changedIds=new Set([...candidate.nodes.map(node=>mapping.get(node.id)),...(candidate.updates || []).map(node=>node.id)]);
            if(!changedIds.size)candidate.connections.forEach(edge=>{changedIds.add(mapping.get(edge.from));changedIds.add(mapping.get(edge.to));});
            if(changedIds.size)fitAllNodesViewport(nodes.filter(node=>changedIds.has(node.id)));
            scheduleSave();const message=chat.messages.find(item=>item.id===candidateMessageId);if(message)message.status='applied';
            candidate=null;persist();renderMessages();renderReferences();notice('已更新画布，可使用撤销恢复。节点尚未运行。');
        } catch(error){nodes=oldNodes;connections=oldConnections;undoStack=oldUndo;render();scheduleSave();throw error;}
    }
    async function open() {
        if(!panel)buildDialog();loadChat();
        if(!panel.hidden){closePanel();return;}
        panel.hidden=false;document.body.classList.add('canvas-agent-open');document.getElementById('canvasAgentToggle')?.setAttribute('aria-expanded','true');
        window.CanvasComfyBuilds?.changed();
        renderReferences();notice('正在加载模型与工具…');
        try{
            const [providers]=await Promise.all([fetch('/api/providers').then(response=>{if(!response.ok)throw new Error('模型配置读取失败');return response.json();}),refresh()]);
            models=(providers.providers || []).filter(p=>p.enabled!==false && p.has_key).flatMap(p=>(p.chat_models || []).map(model=>({provider:p.id,model,label:`${p.model_labels?.[model] || model} · ${p.name || p.id}`})));
            $('model').innerHTML=models.map((model,index)=>`<option value="${index}">${esc(model.label)}</option>`).join('') || '<option>没有已配置的聊天模型</option>';
            const picked=models.findIndex(model=>JSON.stringify([model.provider,model.model])===chat.model);if(picked>=0)$('model').value=String(picked);
            notice('');$('prompt').focus();
        }catch(error){notice(error.message);}
    }
    window.CanvasAgent={open,canvasLoaded:loadChat};
    document.getElementById('canvasAgentToggle')?.addEventListener('click',()=>open());
})();
