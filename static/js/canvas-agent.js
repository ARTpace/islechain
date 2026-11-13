/* ponytail: MCP management stays outside cards; canvas proposals reuse factories, connections and undo.
   UI: Gemini-style transcript — brand header, thought row, markdown body, suggestion carousel, pill composer. */
(() => {
    'use strict';
    const types = ['comfy','extension','prompt','llm','image','generator','output','gameIdea','gamePlan','gameAssets','gameDevelop','gameTest','gameRelease','gameModelAsset','gameModel3d','gameAnimate3d','gameSpeech','gameFile','gameScene'];
    const fields = ['text','instruction','idea','feedback','chatInput','systemPrompt','name','audioOperation','audioPrompt','modelPrompt','nodeDefinition','comfyBuildId','comfyRevision'];
    const nodeLabels={prompt:'提示词',llm:'AI 文本',image:'图片',generator:'图片生成',output:'输出',gameIdea:'游戏灵感',gamePlan:'游戏策划',gameAssets:'资产拆解',gameDevelop:'游戏开发',gameTest:'试玩与场景',gameRelease:'游戏交付',gameModelAsset:'模型资产',gameModel3d:'3D 模型生成',gameAnimate3d:'3D 动画',gameSpeech:'音频生成',gameFile:'文件资料',gameScene:'试玩与场景'};
    const esc = value => escapeHtml(String(value ?? ''));
    const SUGGEST_KEY='canvas-agent-suggestions-dismissed';
    const ICONS={
        spark:'<path d="M12 2.4c.56 4.7 3.34 7.48 8.04 8.04-4.7.56-7.48 3.34-8.04 8.04-.56-4.7-3.34-7.48-8.04-8.04C8.66 9.88 11.44 7.1 12 2.4Z"/>',
        sparkles:'<path d="M11 3.4c.4 3.2 2.28 5.08 5.48 5.48-3.2.4-5.08 2.28-5.48 5.48-.4-3.2-2.28-5.08-5.48-5.48C8.72 8.48 10.6 6.6 11 3.4Z"/><path d="M18.2 14.6c.22 1.76 1.24 2.78 3 3-1.76.22-2.78 1.24-3 3-.22-1.76-1.24-2.78-3-3 1.76-.22 2.78-1.24 3-3Z"/>',
        plus:'<path d="M12 5.5v13M5.5 12h13"/>',
        arrowUp:'<path d="M12 19.2V5M5.6 11.4 12 5l6.4 6.4"/>',
        stop:'<rect x="7.6" y="7.6" width="8.8" height="8.8" rx="1.7"/>',
        mic:'<path d="M12 15.2a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6.2a3 3 0 0 0 3 3Z"/><path d="M19 11.4a7 7 0 0 1-14 0"/><path d="M12 18.4v3"/>',
        chevronDown:'<path d="M6 9.6l6 6 6-6"/>',
        copy:'<rect x="9" y="9" width="11" height="11" rx="2.6"/><path d="M15 5.6A2.6 2.6 0 0 0 12.4 3H6.6A2.6 2.6 0 0 0 4 5.6v5.8A2.6 2.6 0 0 0 6.6 14"/>',
        refresh:'<path d="M20 11.6A8 8 0 1 0 18.2 17"/><path d="M20 4.8v6h-6"/>',
        bulb:'<path d="M9.6 18.2h4.8M10.6 21.4h2.8"/><path d="M12 2.6a6.4 6.4 0 0 0-3.7 11.6c.5.4.8 1 .8 1.6v1.5h5.8v-1.5c0-.6.3-1.2.8-1.6A6.4 6.4 0 0 0 12 2.6Z"/>',
        check:'<path d="M20 6.6 9.6 17 4.2 11.6"/>',
        close:'<path d="M6.2 6.2l11.6 11.6M17.8 6.2 6.2 17.8"/>',
        panelClose:'<rect x="3" y="4.4" width="18" height="15.2" rx="2.6"/><path d="M14.8 4.4v15.2"/>',
        tools:'<path d="M4 7.4h9M19 7.4h1M4 16.6h3M13 16.6h7"/><circle cx="16" cy="7.4" r="2.1"/><circle cx="10" cy="16.6" r="2.1"/>',
        image:'<rect x="3" y="4.4" width="18" height="15.2" rx="2.6"/><circle cx="8.6" cy="9.6" r="1.6"/><path d="M4.2 17.4 9.4 12.2l3.9 3.9 2.9-2.4 3.6 3.1"/>',
        workflow:'<rect x="3.2" y="3.2" width="7" height="7" rx="2"/><rect x="13.8" y="13.8" width="7" height="7" rx="2"/><path d="M6.7 10.2v4.2a3 3 0 0 0 3 3h4.1"/>',
        layers:'<path d="M12 3.2 3.4 8l8.6 4.8L20.6 8 12 3.2Z"/><path d="M3.4 13 12 17.8 20.6 13"/>',
        scan:'<path d="M4 8.4V5.6A1.6 1.6 0 0 1 5.6 4h2.8M15.6 4h2.8A1.6 1.6 0 0 1 20 5.6v2.8M20 15.6v2.8a1.6 1.6 0 0 1-1.6 1.6h-2.8M8.4 20H5.6A1.6 1.6 0 0 1 4 18.4v-2.8"/><path d="M7.4 12h9.2"/>',
        text:'<path d="M4 6.4h16M4 12h9.6M4 17.6h6.4"/>',
        group:'<rect x="3.2" y="3.2" width="7.6" height="7.6" rx="2"/><rect x="13.2" y="13.2" width="7.6" height="7.6" rx="2"/><path d="M10.8 7h4a2.2 2.2 0 0 1 2.2 2.2v4"/>',
    };
    const FILLED=new Set(['spark','stop']);
    const icon=(name,extra='')=>`<svg viewBox="0 0 24 24" fill="${FILLED.has(name)?'currentColor':'none'}" stroke="${FILLED.has(name)?'none':'currentColor'}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${ICONS[name]||''}</svg>`;
    const brandMark=suffix=>`<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="ca-brand-${suffix}" x1="2.4" y1="2" x2="21.6" y2="21.6" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4f8bff"/><stop offset=".52" stop-color="#9b6cf0"/><stop offset="1" stop-color="#f2707f"/></linearGradient></defs><path d="M12 1.6c.62 5.06 3.72 8.16 8.78 8.78-5.06.62-8.16 3.72-8.78 8.78-.62-5.06-3.72-8.16-8.78-8.78C8.28 9.76 11.38 6.66 12 1.6Z" fill="url(#ca-brand-${suffix})"/></svg>`;
    const GLYPH='<svg viewBox="0 0 52 34" fill="currentColor" aria-hidden="true"><rect x="19" y="0" width="13.5" height="13.5" rx="4" opacity=".62"/><rect x="34.5" y="0" width="13.5" height="13.5" rx="4" opacity=".34"/><rect x="3.5" y="17.5" width="13.5" height="13.5" rx="4" opacity=".34"/><rect x="19" y="17.5" width="13.5" height="13.5" rx="4" opacity=".18"/></svg>';
    const SUGGESTIONS=[
        {title:'搭建一个角色美术工作流',tag:'工作流',icon:'workflow',prompt:'帮我搭建一个角色美术工作流：提示词节点 → 图像生成 → 输出节点，并连好线。'},
        {title:'批量生成 4 张风格变体',tag:'批量生成',icon:'layers',prompt:'在当前画布上批量生成 4 张不同风格的变体，并各自接好输出节点。'},
        {title:'检查画布连线的兼容性',tag:'诊断',icon:'scan',prompt:'检查当前画布的节点和连线是否兼容，指出问题并给出修复方案。'},
        {title:'补 5 条风格描述',tag:'提示词',icon:'text',prompt:'为选中的提示词节点补充 5 条可直接使用的风格描述。'},
        {title:'把选中的图片整理成一组',tag:'整理',icon:'group',prompt:'把当前选中的图片节点整理成一个分组，并保持现有连线不变。'},
    ];
    let panel, configs = [], models = [], controller = null, candidate = null, base = '', sourceCanvas = '', candidateMessageId='';
    let chatCanvasId='', chat={messages:[],draft:'',model:'',serverIds:[]}, references=[], saveTimer=null;
    let configsReady=false;
    // Tool keys the user allowed for this canvas session (serverId/toolName).
    let preapproved = new Set();
    // Selected MCP resources and prompts, keyed 'resource:server/uri' | 'prompt:server/name'.
    let extraRefs = new Set();
    // Pending approval request rendered inline in the message list.
    let approval = null;
    let collapsed = new Set(), suggestionsHidden = false, recognizer = null;
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
        chatCanvasId=canvas.id;chat=window.CanvasAgentState.load(chatCanvasId);references=[];candidate=null;candidateMessageId='';collapsed.clear();
        $('prompt').value=chat.draft;syncComposer();renderMessages();renderReferences();renderPicks();renderExtras();
        $('canvas-title').textContent=canvas.title || '';
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
    const seconds = ms => Math.max(1, Math.round(Number(ms || 0) / 1000));
    function modelLabel(message) {
        if(message?.modelLabel)return message.modelLabel;
        const index=selectedModelIndex();
        const model=models[index] || models[0];
        return model ? shortLabel(model) : '画布 AI';
    }
    const shortLabel = model => String(model?.label || model?.model || '模型').split(' · ')[0];
    function selectedModelIndex() {
        return models.findIndex(model=>JSON.stringify([model.provider,model.model])===chat.model);
    }
    function renderMarkdown(text) {
        const engine=window.CanvasAgentMarkdown;
        return engine ? engine.render(text) : `<p>${esc(text).replace(/\n/g,'<br>')}</p>`;
    }
    /* ---------- transcript ---------- */
    function renderMessages() {
        const host=$('messages');if(!host)return;
        const follow=host.scrollTop+host.clientHeight>=host.scrollHeight-60;
        host.classList.toggle('is-empty',!chat.messages.length);
        const expanded=new Set([...host.querySelectorAll('details[open]')].map(item=>item.dataset.caOpen).filter(Boolean));
        const blocks=chat.messages.map(message=>message.role==='user'?userBlock(message):assistantBlock(message,expanded));
        if(!chat.messages.length)blocks.push(emptyState());
        if(!controller && suggestionsVisible())blocks.push(suggestionsBlock());
        host.innerHTML=blocks.join('')+(approval?approvalCard():'');
        host.querySelectorAll('[data-adopt]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await apply();}catch(error){notice(error.message);}finally{button.disabled=false;}});
        host.querySelectorAll('[data-approval]').forEach(button=>button.onclick=()=>decideApproval(button.dataset.approval,button.dataset.remember==='1'));
        host.querySelectorAll('[data-collapse]').forEach(button=>button.onclick=()=>{
            const id=button.dataset.collapse;
            if(collapsed.has(id))collapsed.delete(id);else collapsed.add(id);
            renderMessages();
        });
        host.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{
            const message=chat.messages.find(item=>item.id===button.dataset.copy);if(!message)return;
            try{await navigator.clipboard.writeText(message.text || '');notice('已复制回复内容');}catch{notice('复制失败，请手动选择文本');}
        });
        host.querySelectorAll('[data-retry]').forEach(button=>button.onclick=()=>{
            const index=chat.messages.findIndex(item=>item.id===button.dataset.retry);
            const previous=[...chat.messages.slice(0,Math.max(0,index))].reverse().find(item=>item.role==='user');
            if(!previous)return;
            $('prompt').value=previous.text;syncComposer();$('prompt').focus();notice('已放回输入框，确认后发送');
        });
        host.querySelectorAll('[data-suggestion]').forEach(button=>button.onclick=()=>{
            const item=SUGGESTIONS[Number(button.dataset.suggestion)];if(!item)return;
            $('prompt').value=item.prompt;syncComposer();$('prompt').focus();notice('');
        });
        host.querySelectorAll('[data-dismiss-suggestions]').forEach(button=>button.onclick=()=>{
            suggestionsHidden=true;try{localStorage.setItem(SUGGEST_KEY,'1');}catch{}renderMessages();
        });
        if(follow)host.scrollTop=host.scrollHeight;
    }
    function userBlock(message) {
        return `<article class="canvas-agent-message is-user" data-message-id="${esc(message.id)}"><div class="canvas-agent-body">
            ${(message.references || []).length?`<div class="canvas-agent-inline-refs">${message.references.map(item=>`<span>${esc(item.label)}</span>`).join('')}</div>`:''}
            <div class="canvas-agent-user-bubble">${esc(message.text || '')}</div></div></article>`;
    }
    function assistantBlock(message, expanded) {
        const active=message.id===candidateMessageId && candidate && message.status==='proposed';
        const state={applied:'已采用到画布',expired:'旧方案已失效，可继续对话重新生成',superseded:'已有后续对话',interrupted:'已停止，可重新发送',failed:'未完成，请查看原因',denied:'工具调用被拒绝'}[message.status];
        const trace=message.trace || [];
        const working=message.status==='working';
        const isCollapsed=collapsed.has(message.id);
        const elapsed=message.elapsedMs!=null?seconds(message.elapsedMs):(working&&message.startedAt?seconds(Date.now()-message.startedAt):null);
        return `<article class="canvas-agent-message is-assistant${isCollapsed?' is-collapsed':''}" data-message-id="${esc(message.id)}">
            <div class="canvas-agent-meta">
                <span class="canvas-agent-meta-model">${esc(modelLabel(message))}</span>
                ${elapsed!=null && trace.length?`<span class="canvas-agent-meta-dot">·</span><span>用时 ${elapsed} 秒</span>`:''}
                <button type="button" data-collapse="${esc(message.id)}" title="${isCollapsed?'展开回复':'收起回复'}" aria-label="${isCollapsed?'展开回复':'收起回复'}">${icon(isCollapsed?'chevronDown':'chevronDown')}</button>
            </div>
            <div class="canvas-agent-body">
                ${thoughtBlock(message, trace, working, expanded)}
                ${message.text?`<div class="canvas-agent-content">${renderMarkdown(message.text)}</div>`:''}
                ${message.summary?proposalBlock(message, active):''}
                ${state?`<div class="canvas-agent-message-state">${esc(state)}</div>`:''}
                ${message.text && !working?`<div class="canvas-agent-actions"><button type="button" data-copy="${esc(message.id)}" title="复制" aria-label="复制">${icon('copy')}</button><button type="button" data-retry="${esc(message.id)}" title="重新编辑这条提问" aria-label="重新编辑">${icon('refresh')}</button></div>`:''}
            </div></article>`;
    }
    function thoughtBlock(message, trace, working, expanded) {
        const ms=message.thinkingMs;
        if(!trace.length && ms==null && !working)return '';
        const key=`thought:${message.id}`;
        const label=working?'思考中…':`思考了 ${seconds(ms)} 秒`;
        const head=working?`<span class="canvas-agent-spinner" aria-hidden="true"></span>`:icon('bulb');
        if(!trace.length)return `<div class="canvas-agent-thought${working?' is-live':''}"><div class="canvas-agent-thought-line">${head}<span>${esc(label)}</span></div></div>`;
        const rows=trace.map(item=>{
            const stateLabel={running:'进行中',completed:'完成',failed:'失败',denied:'已拒绝'}[item.status] || '已停止';
            return `<div class="canvas-agent-trace-row"><span>${esc(item.name)}</span><small class="${item.status==='failed'?'is-failed':''}">${esc(stateLabel)}</small></div>`
                +(item.error?`<div class="canvas-agent-progress-note">${esc(item.error)}</div>`:'')
                +(item.status==='running'&&item.progress!=null?`<div class="canvas-agent-progress"><i style="width:${Math.max(0,Math.min(100,Number(item.progress)||0))}%"></i></div><div class="canvas-agent-progress-note">${esc(item.progressNote||'')}</div>`:'');
        }).join('');
        const open=working || expanded.has(key);
        return `<details class="canvas-agent-thought${working?' is-live':''}" data-ca-open="${esc(key)}" ${open?'open':''}>
            <summary>${head}<span>${esc(label)}</span>${icon('chevronDown','class="canvas-agent-thought-caret"')}</summary>
            <div class="canvas-agent-trace">${rows}</div></details>`;
    }
    function proposalBlock(message, active) {
        return `<div class="canvas-agent-proposal">
            <div class="canvas-agent-proposal-head">${icon('sparkles')}<span>画布编辑方案</span></div>
            <p>${esc(message.summary)}</p>
            ${active?`<small class="canvas-agent-proposal-stats">新增 ${candidate.nodes.length} 个节点 · 修改 ${(candidate.updates || []).length} 个节点 · ${candidate.connections.length} 条连线</small>${changePreview()}<button type="button" class="agent-primary" data-adopt="${esc(message.id)}" ${controller?'disabled':''}>采用到画布</button>`:''}
        </div>`;
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
    function emptyState() {
        return `<div class="canvas-agent-empty"><div class="canvas-agent-empty-mark">${brandMark('empty')}</div>
            <h3>想在画布上做什么？</h3><p>描述目标，我会直接帮你搭建节点、连好线并写好参数。</p></div>`;
    }
    function suggestionsVisible() {
        if(suggestionsHidden)return false;
        const last=chat.messages[chat.messages.length-1];
        return !last || last.role==='assistant';
    }
    function suggestionsBlock() {
        return `<div class="canvas-agent-suggestions">
            <div class="canvas-agent-suggestions-head">${icon('sparkles')}<span>推荐</span><button type="button" data-dismiss-suggestions title="隐藏推荐" aria-label="隐藏推荐">${icon('close')}</button></div>
            <div class="canvas-agent-suggestion-track">${SUGGESTIONS.map((item,index)=>`<button type="button" class="canvas-agent-suggestion" data-suggestion="${index}">
                <span class="canvas-agent-suggestion-title">${esc(item.title)}</span>
                <span class="canvas-agent-suggestion-tag">${icon(item.icon)}${esc(item.tag)}</span>
                <span class="canvas-agent-suggestion-glyph">${GLYPH}</span></button>`).join('')}</div></div>`;
    }
    function renderReferences() {
        $('references').innerHTML=references.map(item=>`<button type="button" data-remove-ref="${esc(item.id)}" aria-label="移除引用 ${esc(item.label)}">${esc(item.label)} <span>×</span></button>`).join('');
        $('references').querySelectorAll('[data-remove-ref]').forEach(button=>button.onclick=()=>{references=references.filter(item=>item.id!==button.dataset.removeRef);renderReferences();});
        const count=$('ref-count');
        if(count)count.textContent=references.length?`${references.length} 个`:'';
    }
    /* ---------- composer ---------- */
    function syncComposer() {
        const field=$('prompt');if(!field)return;
        field.style.height='auto';
        field.style.height=Math.min(184,Math.max(24,field.scrollHeight))+'px';
        const run=$('run');
        if(run && !controller)run.dataset.idle=field.value.trim()?'false':'true';
        chat.draft=field.value;
        clearTimeout(saveTimer);saveTimer=setTimeout(()=>persist(),300);
    }
    function closeMenus() {
        ['attach-menu','model-menu'].forEach(id=>{const node=$(id);if(node)node.hidden=true;});
        $('attach')?.setAttribute('aria-expanded','false');
        $('model-btn')?.setAttribute('aria-expanded','false');
    }
    function toggleMenu(id) {
        const target=$(id),wasHidden=target.hidden;
        closeMenus();
        if(wasHidden){target.hidden=false;($(id==='attach-menu'?'attach':'model-btn'))?.setAttribute('aria-expanded','true');}
    }
    function updateModelLabel() {
        const index=selectedModelIndex();
        const model=models[index] || models[0];
        const label=$('model-label');
        if(label)label.textContent=model?shortLabel(model):'模型';
    }
    function renderModelMenu() {
        const host=$('model-menu');if(!host)return;
        const index=selectedModelIndex();
        host.innerHTML=models.length?models.map((model,position)=>`<button type="button" class="canvas-agent-menu-item${position===index?' is-active':''}" data-model="${position}">
            <span>${esc(model.label)}</span>${position===index?icon('check','class="is-check"'):''}</button>`).join('')
            :'<div class="canvas-agent-menu-label">还没有已配置的聊天模型，请先在设置里添加渠道。</div>';
        host.querySelectorAll('[data-model]').forEach(button=>button.onclick=()=>{
            const model=models[Number(button.dataset.model)];if(!model)return;
            chat.model=JSON.stringify([model.provider,model.model]);persist();
            renderModelMenu();updateModelLabel();closeMenus();
        });
        updateModelLabel();
    }
    function toggleMic() {
        const Speech=window.SpeechRecognition || window.webkitSpeechRecognition;
        const button=$('mic');
        if(!Speech){notice('当前浏览器不支持语音输入，请使用 Chrome 或 Edge。');return;}
        if(recognizer){try{recognizer.stop();}catch{}return;}
        try{
            const started=$('prompt').value;
            const engine=new Speech();
            engine.lang='zh-CN';engine.interimResults=true;engine.continuous=false;
            engine.onresult=event=>{
                let text='';
                for(const result of event.results)text+=result[0].transcript;
                $('prompt').value=(started?started.replace(/\s*$/,' '):'')+text;
                syncComposer();
            };
            engine.onerror=event=>notice(event.error==='not-allowed'?'没有麦克风权限，请在浏览器地址栏允许。':'语音输入失败，请重试。');
            engine.onend=()=>{recognizer=null;button.classList.remove('is-live');button.title='语音输入';};
            recognizer=engine;engine.start();button.classList.add('is-live');button.title='停止语音输入';notice('');
        }catch{notice('语音输入启动失败。');}
    }
    function newChat() {
        if(controller)controller.abort();
        approval=null;candidate=null;candidateMessageId='';collapsed.clear();references=[];
        chat={...chat,messages:[],draft:''};
        $('prompt').value='';syncComposer();renderMessages();renderReferences();notice('');
        persist();$('prompt').focus();
    }
    function closePanel() {
        panel.hidden=true;closeMenus();try{recognizer?.stop();}catch{}
        document.body.classList.remove('canvas-agent-open','canvas-agent-resizing');
        document.getElementById('canvasAgentToggle')?.setAttribute('aria-expanded','false');
        persist();
    }
    function buildDialog() {
        panel=document.createElement('aside');panel.className='canvas-agent-sidebar';panel.hidden=true;panel.setAttribute('aria-label','画布 AI 对话');
        panel.innerHTML=`<div class="canvas-agent-resize" role="separator" aria-label="调整 AI 对话宽度" aria-orientation="vertical" tabindex="0"></div>
          <header class="canvas-agent-header">
            <div class="canvas-agent-brand"><span class="canvas-agent-brand-mark">${brandMark('head')}</span><span class="canvas-agent-brand-name">画布 AI</span><span class="canvas-agent-brand-sub" data-agent="canvas-title"></span></div>
            <div class="canvas-agent-header-actions">
              <button type="button" class="canvas-agent-icon-btn" data-agent="new-chat" title="新对话" aria-label="新对话">${icon('plus')}</button>
              <button type="button" class="canvas-agent-icon-btn" data-agent="close" title="收起对话" aria-label="收起对话">${icon('panelClose')}</button>
            </div>
          </header>
          <div class="canvas-agent-messages" data-agent="messages" role="log" aria-label="画布对话记录" aria-live="polite"></div>
          <footer class="canvas-agent-footer">
            <div class="canvas-agent-references" data-agent="references"></div>
            <div class="canvas-agent-extra" data-agent="extra-refs"></div>
            <form data-agent="form" class="canvas-agent-composer">
              <label class="canvas-agent-input-label" for="canvasAgentPrompt">告诉 AI 如何编辑画布</label>
              <textarea id="canvasAgentPrompt" data-agent="prompt" rows="1" maxlength="16000" placeholder="描述修改，添加新功能，或者随便问点什么"></textarea>
              <div class="canvas-agent-compose-actions">
                <button type="button" class="canvas-agent-round" data-agent="attach" title="添加引用或工具" aria-label="添加引用或工具" aria-expanded="false">${icon('plus')}</button>
                <span class="canvas-agent-spacer"></span>
                <button type="button" class="canvas-agent-model-pill" data-agent="model-btn" aria-haspopup="menu" aria-expanded="false"><span data-agent="model-label">模型</span>${icon('chevronDown')}</button>
                <button type="button" class="canvas-agent-mic" data-agent="mic" title="语音输入" aria-label="语音输入">${icon('mic')}</button>
                <button type="submit" class="canvas-agent-send" data-agent="run" data-idle="true" title="发送（Enter）" aria-label="发送">${icon('arrowUp')}</button>
                <button type="button" class="canvas-agent-send canvas-agent-stop" data-agent="stop" title="停止生成" aria-label="停止生成" hidden>${icon('stop')}</button>
              </div>
            </form>
            <div class="canvas-agent-menu" data-agent="attach-menu" hidden>
              <button type="button" class="canvas-agent-menu-item" data-menu="refs">${icon('image')}<span>引用选中节点</span><small data-agent="ref-count"></small></button>
              <button type="button" class="canvas-agent-menu-item" data-menu="tools">${icon('tools')}<span>MCP 工具与资源</span><small data-agent="tool-count"></small></button>
              <div class="canvas-agent-menu-sep"></div>
              <div class="canvas-agent-tool-picker" data-agent="tool-picker" hidden><strong>本次使用的外部工具</strong><div data-agent="picks"></div><small>已授权的工具可能修改外部文件。服务与授权在「设置 → MCP 工具」里管理。</small></div>
            </div>
            <div class="canvas-agent-menu" data-agent="model-menu" hidden></div>
            <p class="canvas-agent-notice" data-agent="notice" role="status"></p>
            <div class="canvas-agent-input-hint">Enter 发送 · Shift + Enter 换行</div>
          </footer>`;
        document.body.append(panel);
        $('close').onclick=closePanel;
        $('new-chat').onclick=newChat;
        $('stop').onclick=()=>controller?.abort();
        $('mic').onclick=toggleMic;
        $('form').onsubmit=event=>{event.preventDefault();if(!$('prompt').value.trim()){$('prompt').focus();return;}run().catch(error=>notice(error.message));};
        $('prompt').onkeydown=event=>{if(event.key==='Enter' && !event.shiftKey && !event.isComposing){event.preventDefault();if(!controller)$('form').requestSubmit();}};
        $('prompt').oninput=syncComposer;
        $('attach').onclick=()=>toggleMenu('attach-menu');
        $('model-btn').onclick=()=>{renderModelMenu();toggleMenu('model-menu');};
        panel.querySelector('[data-menu="refs"]').onclick=()=>{
            references=nodes.filter(node=>selected.has(node.id)).slice(0,24).map(node=>({id:node.id,label:node.name || node.title || nodeLabels[node.type] || node.type}));
            renderReferences();closeMenus();
            if(!references.length)notice('先在画布中选中节点，再点这里引用。');else notice(`已引用 ${references.length} 个节点`);
        };
        panel.querySelector('[data-menu="tools"]').onclick=()=>{
            const picker=$('tool-picker');picker.hidden=!picker.hidden;
            if(!picker.hidden)renderPicks();
        };
        document.addEventListener('pointerdown',event=>{
            if(!panel || panel.hidden || !(event.target instanceof Element))return;
            if(event.target.closest('.canvas-agent-menu') || event.target.closest('[data-agent="attach"]') || event.target.closest('[data-agent="model-btn"]'))return;
            closeMenus();
        });
        const resize=panel.querySelector('.canvas-agent-resize');
        const setWidth=value=>{const maximum=Math.max(360,Math.min(600,window.innerWidth*.55)),width=Math.round(Math.max(360,Math.min(value,maximum)));document.body.style.setProperty('--canvas-agent-width',width+'px');resize.setAttribute('aria-valuemin','360');resize.setAttribute('aria-valuemax',String(Math.round(maximum)));resize.setAttribute('aria-valuenow',String(width));resize.setAttribute('aria-valuetext',width+' 像素');return width;};
        let width=400;try{width=Number(localStorage.getItem('canvas-agent-width')) || 400;}catch{}width=setWidth(width);
        window.addEventListener('resize',()=>{if(window.innerWidth>=900)width=setWidth(width);});
        resize.onpointerdown=event=>{resize.setPointerCapture(event.pointerId);document.body.classList.add('canvas-agent-resizing');};
        resize.onpointermove=event=>{if(resize.hasPointerCapture(event.pointerId))width=setWidth(window.innerWidth-event.clientX);};
        const finish=()=>{document.body.classList.remove('canvas-agent-resizing');try{localStorage.setItem('canvas-agent-width',String(width));}catch{}};
        resize.onpointerup=finish;resize.onpointercancel=finish;
        resize.onkeydown=event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();width=setWidth(width+(event.key==='ArrowLeft'?16:-16));finish();}};
        window.addEventListener('beforeunload',()=>{clearTimeout(saveTimer);persist();});
        panel.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!$('attach-menu').hidden || !$('model-menu').hidden)closeMenus();else closePanel();}});
        try{suggestionsHidden=localStorage.getItem(SUGGEST_KEY)==='1';}catch{}
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
        $('picks').querySelectorAll('[data-server-pick]').forEach(input=>input.onchange=()=>{chat.serverIds=[...$('picks').querySelectorAll('[data-server-pick]:checked')].map(el=>el.dataset.serverPick);updateToolCount();persist();});
        $('picks').querySelectorAll('[data-pick]').forEach(details=>{
            const config=configs.find(s=>s.id===details.dataset.pick);
            details.querySelector('[data-extras]').onclick=()=>showExtras(details.querySelector('[data-extras-list]'),config).catch(error=>notice(error.message));
        });
        updateToolCount();
    }
    function updateToolCount() {
        const count=$('tool-count');
        if(count)count.textContent=chat.serverIds.length?`已选 ${chat.serverIds.length}`:'';
    }
    async function run() {
        if(controller)return;
        if(!canvas?.id)throw new Error('请先打开画布');
        loadChat();
        const prompt=$('prompt').value.trim();if(!prompt)throw new Error('请描述希望完成的任务');
        const model=models[selectedModelIndex()] || models[0];if(!model)throw new Error('请先在 API 配置中添加聊天模型');
        const snap=snapshot();base=fingerprint();sourceCanvas=canvas.id;candidate=null;
        const session=chat,requestCanvas=chatCanvasId;
        session.model=JSON.stringify([model.provider,model.model]);
        session.messages.filter(message=>message.status==='proposed').forEach(message=>message.status='superseded');
        const history=window.CanvasAgentState.history(session.messages);
        session.messages.push({id:crypto.randomUUID(),role:'user',text:prompt,references:[...references]});
        const message={id:crypto.randomUUID(),role:'assistant',text:'',status:'working',trace:[],startedAt:Date.now(),modelLabel:shortLabel(model)};session.messages.push(message);
        session.messages=session.messages.slice(-40);session.draft='';$('prompt').value='';syncComposer();references=[];renderReferences();notice('');
        controller=new AbortController();$('run').hidden=true;$('stop').hidden=false;
        renderMessages();$('messages').scrollTop=$('messages').scrollHeight;persist();
        const markThought=()=>{if(message.thinkingMs==null)message.thinkingMs=Date.now()-message.startedAt;};
        try {
            const extras=extraPayload();
            const response=await fetch('/api/mcp/agent',{method:'POST',headers:{'Content-Type':'application/json','X-Art-MCP':'1'},signal:controller.signal,body:JSON.stringify({canvasId:requestCanvas,prompt,history,provider:model.provider,model:model.model,serverIds:session.serverIds,snapshot:snap,preapproved:[...preapproved],resources:extras.resources,prompts:extras.prompts})});
            if(!response.ok){const data=await response.json();throw new Error(typeof data.detail==='string'?data.detail:'AI 请求失败');}
            const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
            const consume=line=>{if(!line.trim())return;const event=JSON.parse(line);
                if(chatCanvasId!==requestCanvas)throw new DOMException('画布已切换','AbortError');
                if(event.type==='progress')message.progress=event.message;
                if(event.type==='tool'){
                    markThought();
                    const running=message.trace.findLast(item=>item.name===event.name && item.status==='running');
                    if(running){running.status=event.status;running.error=event.error || '';}else message.trace.push({name:event.name,status:event.status,error:event.error || ''});
                    message.progress=`${event.name} · ${{running:'调用中',completed:'完成',failed:'失败',denied:'已拒绝'}[event.status] || event.status}`;
                }
                if(event.type==='toolProgress'){
                    markThought();
                    const running=message.trace.findLast(item=>item.name===event.name && item.status==='running');
                    if(running){running.progress=event.progress;running.progressNote=event.message||'';running.total=event.total;}
                }
                if(event.type==='approval'){markThought();approval={id:event.id,name:event.name,risk:event.risk,arguments:event.arguments};message.progress=`等待确认：${event.name}`;}
                if(event.type==='error')throw new Error(event.message);
                if(event.type==='result'){markThought();candidate=event.proposal;candidateMessageId=message.id;message.text=event.text || '';message.summary=candidate?.summary || '';message.status=candidate?'proposed':'completed';}
                renderMessages();
            };
            while(true){const {value,done}=await reader.read();pending+=decoder.decode(value || new Uint8Array(),{stream:!done});const lines=pending.split('\n');pending=lines.pop();lines.forEach(consume);if(done){consume(pending);break;}}
            if(message.status==='working')throw new Error('连接已结束，但未收到完整结果，请重新发送。');
        } catch(error){
            controller?.abort();
            message.status=error.name==='AbortError'?'interrupted':'failed';message.text=error.name==='AbortError'?'已停止生成。已完成的外部工具操作不会撤销。':error.message;
            if(chatCanvasId===requestCanvas && !$('prompt').value){session.draft=prompt;$('prompt').value=prompt;syncComposer();}
        } finally{
            message.elapsedMs=Date.now()-message.startedAt;
            if(message.thinkingMs==null)message.thinkingMs=message.elapsedMs;
            controller=null;$('run').hidden=false;$('stop').hidden=true;syncComposer();persist(session,requestCanvas);
            if(chatCanvasId===requestCanvas)renderMessages();
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
        const oldNodes=nodes,oldConnections=connections,oldUndo=canvasHistory.snapshot();
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
            pushUndo();const singleUndo=canvasHistory.snapshot();nodes=nodes.map(node=>({...node}));connections=connections.map(edge=>({...edge}));
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
            canvasHistory.restore(singleUndo);render();
            const changedIds=new Set([...candidate.nodes.map(node=>mapping.get(node.id)),...(candidate.updates || []).map(node=>node.id)]);
            if(!changedIds.size)candidate.connections.forEach(edge=>{changedIds.add(mapping.get(edge.from));changedIds.add(mapping.get(edge.to));});
            if(changedIds.size)fitAllNodesViewport(nodes.filter(node=>changedIds.has(node.id)));
            scheduleSave();const message=chat.messages.find(item=>item.id===candidateMessageId);if(message)message.status='applied';
            candidate=null;persist();renderMessages();renderReferences();notice('已更新画布，可使用撤销恢复。节点尚未运行。');
        } catch(error){nodes=oldNodes;connections=oldConnections;canvasHistory.restore(oldUndo);render();scheduleSave();throw error;}
    }
    async function open() {
        if(!panel)buildDialog();loadChat();
        if(!panel.hidden){closePanel();return;}
        panel.hidden=false;document.body.classList.add('canvas-agent-open');document.getElementById('canvasAgentToggle')?.setAttribute('aria-expanded','true');
        renderReferences();syncComposer();notice('正在加载模型与工具…');
        try{
            const [providers]=await Promise.all([fetch('/api/providers').then(response=>{if(!response.ok)throw new Error('模型配置读取失败');return response.json();}),refresh()]);
            models=(providers.providers || []).filter(p=>p.enabled!==false && p.has_key).flatMap(p=>(p.chat_models || []).map(model=>({provider:p.id,model,label:`${p.model_labels?.[model] || model} · ${p.name || p.id}`})));
            if(selectedModelIndex()<0 && models.length)chat.model=JSON.stringify([models[0].provider,models[0].model]);
            renderModelMenu();renderMessages();
            notice('');$('prompt').focus();
        }catch(error){notice(error.message);}
    }
    window.CanvasAgent={open,canvasLoaded:loadChat};
    document.getElementById('canvasAgentToggle')?.addEventListener('click',()=>open());
})();
