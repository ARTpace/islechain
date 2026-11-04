/* ponytail: 复用现有项目 API 和画布节点；连线定义阶段输入，不另建执行引擎。 */
(() => {
    'use strict';
    const types = ['gameIdea', 'gamePlan', 'gameAssets'];
    const productionTypes = ['gameDevelop', 'gamePlay', 'gameTest', 'gameRelease'];
    const running = new Set(), notices = new Map();
    let configuredProviders = [], providerRequest = null;
    let rolePresets = [], presetRequest = null;
    const project = () => window.GamePipeline?.project;
    const esc = value => escapeHtml(String(value ?? ''));
    const field = (name, label, value = '') => `<label>${esc(label)}<textarea data-field="${name}">${esc(value)}</textarea></label>`;
    const button = (action, label, id = '') => `<button type="button" class="tool-btn" data-work="${action}" data-id="${esc(id)}">${esc(label)}</button>`;
    const incoming = node => connections.filter(c => c.to === node.id).map(c => nodes.find(n => n.id === c.from)).filter(n => n && (n.projectId === node.projectId || n.type === 'image'));
    const MEDIA_TABS = [
        {id: 'image', label: '图片', hint: '最多 9 张 · PNG / JPG / WebP', accept: 'image/png,image/jpeg,image/webp', icon: 'image'},
        {id: 'video', label: '视频', hint: 'MP4 / WebM / MOV，单段建议 30 秒内', accept: 'video/*', icon: 'clapperboard'},
        {id: 'audio', label: '音频', hint: 'MP3 / WAV / M4A，用于音效与氛围参考', accept: 'audio/*', icon: 'music'}
    ];
    const MEDIA_LIMITS = {image: 9, video: 4, audio: 6};
    const mediaOf = node => Array.isArray(node.media) ? node.media : (node.media = []);
    const mediaIn = (node, kind) => mediaOf(node).filter(item => item.kind === kind);
    const fileKind = file => {
        const type = String(file?.type || '');
        if (type.startsWith('image/')) return 'image';
        if (type.startsWith('video/')) return 'video';
        if (type.startsWith('audio/')) return 'audio';
        const ext = String(file?.name || '').split('.').pop().toLowerCase();
        if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
        if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
        if (['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'].includes(ext)) return 'audio';
        return '';
    };
    function mediaBlock(node) {
        const tab = MEDIA_TABS.find(item => item.id === (node.mediaTab || 'image')) || MEDIA_TABS[0];
        const list = mediaIn(node, tab.id);
        const total = mediaOf(node).length;
        const full = list.length >= MEDIA_LIMITS[tab.id];
        const tabs = MEDIA_TABS.map(item => {
            const count = mediaIn(node, item.id).length;
            return `<button type="button" class="gp-media-tab${item.id === tab.id ? ' is-on' : ''}" role="tab" aria-selected="${item.id === tab.id}" data-media-tab="${item.id}">${item.label}<em>${count}</em></button>`;
        }).join('');
        const tiles = list.map(item => `<figure class="gp-media-item" title="${esc(item.name)}">
            ${item.kind === 'image' ? `<img src="${esc(item.url)}" alt="${esc(item.name)}" loading="lazy">`
                : `<span class="gp-media-ph"><i data-lucide="${item.kind === 'video' ? 'clapperboard' : 'music'}"></i></span>`}
            <button type="button" class="gp-media-del" data-media-del="${esc(item.id)}" title="移除" aria-label="移除"><i data-lucide="x"></i></button>
            <figcaption>${esc(item.name)}</figcaption>
        </figure>`).join('');
        const empty = `<label class="gp-media-drop">
            <i data-lucide="upload-cloud"></i>
            <strong>点击或拖入${tab.label}</strong>
            <small>${tab.hint}</small>
            <input type="file" multiple accept="${tab.accept}" data-media-input hidden ${full ? 'disabled' : ''}>
        </label>`;
        const add = full ? '' : `<label class="gp-media-add" title="添加${tab.label}">
            <i data-lucide="plus"></i><span>添加</span>
            <input type="file" multiple accept="${tab.accept}" data-media-input hidden>
        </label>`;
        return `<div class="gp-media" data-media>
            <div class="gp-media-head">
                <span class="gp-media-title"><i data-lucide="layers"></i>灵感素材</span>
                <span class="gp-media-tools">
                    <span class="gp-media-total">${total ? `共 ${total} 项` : '可选'}</span>
                    <button type="button" class="gp-media-library" data-media-library title="从资产库选择"><i data-lucide="folder-open"></i><span>资产库</span></button>
                </span>
            </div>
            <div class="gp-media-tabs" role="tablist">${tabs}</div>
            <div class="gp-media-pane" data-media-pane>
                ${list.length ? `<div class="gp-media-grid">${tiles}${add}</div>` : empty}
            </div>
        </div>`;
    }
    const referenceImages = node => [...new Set([
        ...incoming(node).flatMap(n => n.type === 'image' && n.url ? [n.url] : (window.GameModel3D?.referenceImages(n)||[]).map(ref=>ref.url)),
        ...incoming(node).flatMap(n => (n.type === 'gameIdea' ? mediaIn(n, 'image') : [])).map(item => item.url)
    ])];
    const candidate = node => project()?.candidates.find(c => c.id === node.candidateId && c.status === 'valid');
    function planState(node) {
        const p=project();
        if(candidate(node)?.kind==='plan')return {ready:false,label:'新方案待采用',message:'策划节点有新方案，请先采用或放弃该方案。'};
        if(!p?.planConfirmed)return {ready:false,label:'待确认',message:'请先在策划节点采用方案。'};
        if(p.planSourceChanged||(node.adoptedInput&&node.adoptedInput!==inputSignature(node)))return {ready:false,label:'来源已变化，待核对',message:'策划来源已变化，请在策划节点点击“确认沿用当前策划”，或重新策划并采用。'};
        return {ready:true,label:'已确认',message:''};
    }
    const inputSignature = node => JSON.stringify({feedback: node.feedback || '',
        ...(node.presetId && node.presetId !== 'default' ? {presetId: node.presetId} : {}),
        inputs: incoming(node).map(n => ({id: n.id, idea: n.idea || '', doc: project()?.documents.find(d => d.id === n.docId)?.contentHash,
            files: (window.GameExtraNodes?.files(n)||[]).map(f=>[f.id,f.contentHash]), draft: n.documentDraft, table: project()?.tables?.find(t => t.id === n.tableId)?.revision, tableDraft: n.tableDraft,
            image: n.type === 'image' ? n.url : window.GameModel3D?.referenceImages(n)[0]?.url, media: (n.media || []).map(item => item.id), planRevision: n.type === 'gamePlan' ? project()?.plan?.revision : undefined}))});
    const changed = () => { scheduleSave(); render(); };
    function planPreview(plan) {
        if (!plan) return '<p class="gp-plan-empty">还没有方案。填好想法后点「生成游戏策划」，AI 会补全玩法与美术方向。</p>';
        const labels = {playerFantasy: '玩家体验', coreLoop: '核心玩法', controls: '操作', progression: '成长', successFailureRestart: '胜负与重开', firstPlayable: '首个可玩版本'};
        return `<h3>${esc(plan.title)}</h3>${Object.entries(labels).map(([key, label]) => `<h4>${label}</h4><p>${esc(plan[key])}</p>`).join('')}<h4>美术方向</h4><p>${esc(plan.visualDirection.description)}</p>`;
    }
    function configuredChatModels() {
        return configuredProviders.filter(p => p.has_key && p.enabled !== false)
            .flatMap(p => [...new Set(p.chat_models || [])].map(model => ({provider: p.id, model,
                label: `${p.model_labels?.[model] || model} · ${p.name || p.id}`, primary: p.primary})))
            .sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));
    }
    function selectedChatModel(node) {
        const models = configuredChatModels();
        if (node.model) return models.find(m => m.provider === node.provider && m.model === node.model);
        return models.find(m => m.provider === node.provider) || models[0];
    }
    function controls(node) {
        const models = configuredChatModels(), selected = selectedChatModel(node);
        const placeholder = !models.length ? '请先在 API 配置中添加可用的聊天模型' : '原模型已不可用，请重新选择';
        const presets = rolePresets.filter(p => p.kinds.includes(node.type === 'gamePlan' ? 'plan' : 'assets'));
        const presetId = node.presetId || 'default', preset = presets.find(p => p.id === presetId);
        const modelControl = `<label>聊天模型<select data-chat-model ${!models.length ? 'disabled' : ''}>${!selected ? `<option value="" selected disabled>${placeholder}</option>` : ''}${models.map(m => `<option value="${esc(JSON.stringify([m.provider, m.model]))}" ${m.provider === selected?.provider && m.model === selected?.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>`;
        if (['document', 'gameTable'].includes(node.type)) return modelControl;
        return `<div class="gp-model-preset">${modelControl}<label>角色预设<select data-field="presetId" ${!presets.length ? 'disabled' : ''}>${!preset ? '<option value="" disabled selected>请选择可用预设</option>' : ''}${presets.map(p => `<option value="${esc(p.id)}" ${p.id === presetId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div><small data-preset-description>${esc(preset?.description || '')}</small>`;
    }
    async function adopt(ctx, node, kind) {
        const item = candidate(node);
        if (!item || item.kind !== kind) throw new Error('请先生成有效候选方案');
        if (node.candidateInput && node.candidateInput !== inputSignature(node) && !await ctx.ask('上游输入已变化，仍采用节点中显示的旧候选？')) return;
        const data = kind === 'plan' ? {plan: item.data, confirmed: true} : {assets: item.data, artConfirmed: false};
        try { await ctx.write(kind === 'plan' ? '/plan' : '/assets', 'PUT', {...data, candidateId: item.id}); }
        catch (error) {
            if (!error.detail?.sourceChanged || !await ctx.ask('来源已变化，请核对节点中的候选方案，仍然采用？')) throw error;
            await ctx.write(kind === 'plan' ? '/plan' : '/assets', 'PUT', {...data, candidateId: item.id, acknowledgeSourceChange: true});
        }
        delete node.candidateId;
        delete node.fresh;
        if (kind === 'plan') node.adoptedInput = inputSignature(node);
        delete node.candidateInput;
        scheduleSave();
    }
    async function generate(ctx, node, kind) {
        const inputs = incoming(node);
        if (kind === 'plan' && !inputs.some(n => ['gameIdea', 'document', 'gameTable'].includes(n.type))) throw new Error('请将灵感、文档或表格节点连接到策划节点');
        if (kind === 'assets' && !inputs.some(n => n.type === 'gamePlan')) throw new Error('请将策划节点连接到资产拆解节点');
        if (kind === 'assets' && inputs.some(n => n.type === 'gamePlan' && (candidate(n) || (n.adoptedInput && n.adoptedInput !== inputSignature(n))))) throw new Error('上游灵感或策划已变化，请先生成并采用新的策划');
        if (inputs.some(n => n.type === 'document' && n.documentDraft !== undefined)) throw new Error('请先保存上游文档节点，再生成策划');
        if (inputs.some(n => n.type === 'gameTable' && n.tableDraft)) throw new Error('请先保存上游表格，再生成策划');
        if (referenceImages(node).length > 9) throw new Error('最多 9 张参考图片（含灵感节点里的图片素材）');
        const mediaBrief = inputs.filter(n => n.type === 'gameIdea')
            .flatMap(n => mediaOf(n).filter(item => item.kind !== 'image'))
            .map(item => `${item.kind === 'video' ? '视频' : '音频'}素材：${item.name}`).join('\n');
        const idea = [node.feedback, ...inputs.filter(n => n.type === 'gameIdea').map(n => n.idea),
            mediaBrief ? `[灵感节点附带的其它素材，供玩法与氛围参考]\n${mediaBrief}` : ''].filter(Boolean).join('\n');
        const signature = inputSignature(node);
        const model = selectedChatModel(node);
        if (!model) throw new Error('请选择已在 API 配置中启用并配置密钥的聊天模型');
        const presetId = node.presetId || 'default';
        if (!rolePresets.some(p => p.id === presetId && p.kinds.includes(kind))) throw new Error('请选择此节点可用的角色预设');
        Object.assign(node, {provider: model.provider, model: model.model});
        scheduleSave();
        const result = await ctx.write(kind === 'plan' ? '/plan-candidates' : '/asset-candidates', 'POST', {
            provider: model.provider, model: model.model, presetId,
            ...(kind === 'plan' ? {documentIds: inputs.flatMap(n => n.type === 'document' ? [n.docId] : (window.GameExtraNodes?.files(n)||[]).map(f=>f.documentId).filter(Boolean))} : {}),
            tableIds: inputs.filter(n => n.type === 'gameTable').map(n => n.tableId), referenceImages: referenceImages(node),
            idea: idea || (kind === 'plan' ? '自由构思一个有创意、适合小团队制作的小游戏，补全全部玩法与美术方向。' : '根据已确认策划，拆解首个可玩版本所需的完整美术资产清单。'),
        });
        const item = result.project.candidates.filter(c => c.kind === kind).at(-1);
        if (item?.status !== 'valid') {
            const detail = item?.diagnostics?.at(-1)?.split('\n').slice(0, 2).join(' ').slice(0, 300);
            throw new Error('AI 返回内容未通过校验，旧方案已保留。' + (detail ? '\n原因：' + detail : '请重试或更换模型。'));
        }
        node.candidateId = item.id;
        node.candidateInput = signature;
        delete node.fresh;
        scheduleSave();
    }
    async function execute(node, action, id) {
        if (productionTypes.includes(node.type) || ['development-chain','media'].includes(action)) return window.GameDevelopment?.execute(node, action);
        if (running.size) return;
        if (action === 'edit-document') { const doc = project()?.documents.find(d => d.id === node.docId); if (doc) window.GameAuthoring.editDocument(node, doc); return; }
        if (action === 'edit-table') { const table = project()?.tables?.find(t => t.id === node.tableId); if (table) window.GameAuthoring.editTable(node, table); return; }
        if (action === 'history') { await window.GameAuthoring.history(node); return; }
        if (action === 'discard-content') { delete node.contentCandidate; changed(); return; }
        if (action === 'select-assets' || action === 'clear-assets') {
            const proposal = candidate(node);
            const assets = proposal?.kind === 'assets' ? proposal.data : project()?.assets || [];
            node.selectedAssetIds = action === 'select-assets' ? assets.map(a => a.id) : [];
            changed(); return;
        }
        running.add(node.id); notices.delete(node.id); render();
        try {
            await window.GamePipeline.workflow(async ctx => {
                if (node.projectId !== ctx.project.id) throw new Error('节点不属于当前游戏项目');
                if (action === 'save-table') {
                    const table = ctx.project.tables.find(t => t.id === node.tableId);
                    if (!table) throw new Error('表格不存在');
                    if (node.tableDraftRevision !== undefined && node.tableDraftRevision !== table.revision && !await ctx.ask('表格已被更新，仍用当前草稿覆盖？旧内容将保留在历史版本。')) return;
                    await ctx.write('/tables/' + table.id, 'PUT', {table: node.tableDraft || table});
                    delete node.tableDraft; delete node.tableDraftRevision; scheduleSave();
                }
                else if (action === 'restore-content') {
                    if (!await ctx.ask('恢复所选历史版本？当前已保存内容会保留为历史，当前手工草稿将被替换。')) return;
                    const path = node.type === 'document' ? 'documents/' + node.docId : 'tables/' + node.tableId;
                    await ctx.write('/' + path + '/restore', 'POST', {revision: Number(id)});
                    delete node.documentDraft; delete node.documentTitle; delete node.tableDraft; delete node.documentDraftRevision; delete node.tableDraftRevision; scheduleSave();
                }
                else if (action === 'ai-content') {
                    const isDoc = node.type === 'document';
                    if (node.documentDraft !== undefined || node.documentTitle !== undefined || node.tableDraft) throw new Error('请先保存手工编辑的草稿，再让 AI 修改');
                    if (!node.editInstruction?.trim()) throw new Error('请填写 AI 修改要求');
                    const model = selectedChatModel(node);
                    if (!model) throw new Error('请选择可用聊天模型');
                    if (referenceImages(node).length > 9) throw new Error('最多 9 张参考图片（含灵感节点里的图片素材）');
                    Object.assign(node, model && {provider: model.provider, model: model.model});
                    const result = await ctx.write(`/${isDoc ? 'documents/' + node.docId : 'tables/' + node.tableId}/ai-edit`, 'POST',
                        {provider: model.provider, model: model.model, instruction: node.editInstruction, referenceImages: referenceImages(node)});
                    node.contentCandidate = {data: result.draft, sourceRevision: result.sourceRevision}; scheduleSave();
                }
                else if (action === 'adopt-content') {
                    const proposal = node.contentCandidate;
                    if (!proposal) throw new Error('没有可采用的候选');
                    const isDoc = node.type === 'document', item = isDoc ? ctx.project.documents.find(d => d.id === node.docId) : ctx.project.tables.find(t => t.id === node.tableId);
                    if (!item) throw new Error('来源不存在');
                    if ((item.revision !== proposal.sourceRevision || node.documentDraft !== undefined || node.documentTitle !== undefined || node.tableDraft)
                        && !await ctx.ask('来源或手工草稿已变化，仍以 AI 候选替换当前内容？')) return;
                    await ctx.write(`/${isDoc ? 'documents/' + item.id : 'tables/' + item.id}`, 'PUT',
                        isDoc ? {title: node.documentTitle || item.title, content: proposal.data} : {table: proposal.data});
                    delete node.contentCandidate; delete node.documentDraft; delete node.documentTitle; delete node.tableDraft; delete node.documentDraftRevision; delete node.tableDraftRevision; scheduleSave();
                }
                else if (action === 'plan') await generate(ctx, node, 'plan');
                else if (action === 'reconfirm-plan') {
                    if(!ctx.project.plan||candidate(node))throw new Error('请先采用或放弃新方案');
                    if(incoming(node).some(n=>n.documentDraft!==undefined||n.tableDraft))throw new Error('请先保存上游文档或表格草稿');
                    await ctx.write('/plan','PUT',{plan:ctx.project.plan,confirmed:true});
                    node.adoptedInput=inputSignature(node);scheduleSave();
                }
                else if (action === 'assets') await generate(ctx, node, 'assets');
                else if (action === 'adopt-plan') await adopt(ctx, node, 'plan');
                else if (action === 'adopt-assets') {
                    if (!await ctx.ask('采用新资产清单？新增或修改的资产会更新，移除项保留已有文件。')) return;
                    await adopt(ctx, node, 'assets');
                }
                else if (action === 'add-document') {
                    const result = await ctx.write('/documents', 'POST', {title: '游戏需求文档', content: ''});
                    const doc = result.project.documents.at(-1);
                    pushUndo();
                    const added = {id: uid('document'), type: 'document', projectId: ctx.project.id, docId: doc.id, x: node.x, y: node.y + 430};
                    nodes.push(added);
                    const plan = nodes.find(n => n.type === 'gamePlan' && n.projectId === node.projectId);
                    if (plan) connections.push({id: uid('c'), from: added.id, to: plan.id});
                    changed();
                }
                else if (action === 'save-document') {
                    const doc = ctx.project.documents.find(d => d.id === node.docId);
                    if (!doc) throw new Error('文档不存在');
                    if (node.documentDraftRevision !== undefined && node.documentDraftRevision !== doc.revision && !await ctx.ask('文档已被更新，仍用当前草稿覆盖？旧内容将保留在历史版本。')) return;
                    await ctx.write('/documents/' + doc.id, 'PUT', {title: node.documentTitle || doc.title, content: node.documentDraft ?? doc.lastSavedContent});
                    delete node.documentDraft; delete node.documentTitle; delete node.documentDraftRevision; scheduleSave();
                }
                else if (action === 'bind-selected') {
                    const proposal = candidate(node);
                    const available = proposal?.kind === 'assets' ? proposal.data : ctx.project.assets;
                    const ids = new Set(node.selectedAssetIds || []);
                    const selected = available.filter(a => ids.has(a.id)).map(a => a.id);
                    if (!selected.length) throw new Error('请先勾选要创建图片节点的资产');
                    if (proposal?.kind === 'assets') {
                        await adopt(ctx, node, 'assets');
                        if (candidate(node)) return;
                    }
                    for (const assetId of selected) {
                        const asset = ctx.project.assets.find(a => a.id === assetId);
                        if (!asset) throw new Error('资产清单已变化，请重新选择');
                        await ctx.bindAsset(asset);
                    }
                }
                else if (action === 'generate-asset') {
                    const asset = ctx.project.assets.find(a => a.id === id);
                    if (!asset) throw new Error('资产不存在');
                    if (await ctx.ask(`生成“${asset.name}”？将调用已配置的图片渠道，可能计费。`)) await ctx.generateAsset(asset);
                }
                else if (action === 'sync') await ctx.syncOutputs();
                else if (action === 'select') {
                    const output = ctx.project.outputs.find(o => o.id === id);
                    if (!output) throw new Error('生成结果不存在');
                    await ctx.write(`/assets/${output.assetId}/selection`, 'POST', {candidateId: id});
                }
                else if (action === 'review') {
                    if (await ctx.ask('已检查图片内容、尺寸与透明效果，确认这项资产可用于游戏？')) await ctx.write(`/assets/${id}/review`, 'POST', {humanConfirmed: true, acceptCurrentRevision: true});
                }
                else if (action === 'confirm-art') {
                    if (await ctx.ask('确认使用当前策划中的美术方向？')) await ctx.write('/assets', 'PUT', {assets: ctx.project.assets, artConfirmed: true});
                }
            });
            notices.set(node.id, '已完成');
        } catch (error) { notices.set(node.id, error.message); }
        finally { running.delete(node.id); render(); }
    }
    function refreshMediaBlock(node, target) {
        const root = target.querySelector('[data-media]');
        if (!root) return;
        root.outerHTML = mediaBlock(node);
        window.refreshIcons?.();
    }
    function mediaStatus(target, text) {
        const status = target.querySelector('.gp-node-status');
        if (status) status.textContent = text || '';
    }
    async function uploadMedia(node, target, files) {
        const list = Array.from(files || []).filter(file => fileKind(file));
        if (!list.length) { mediaStatus(target, '只支持图片、视频、音频文件'); return; }
        const canvasId = canvas?.id || window.canvas?.id;
        if (!canvasId) { mediaStatus(target, '画布未就绪，请刷新后重试'); return; }
        mediaStatus(target, '正在上传素材…');
        try {
            const form = new FormData();
            list.forEach(file => form.append('files', file));
            const res = await fetch(`/api/canvases/${canvasId}/assets/upload`, {method: 'POST', body: form});
            if (!res.ok) throw new Error('素材上传失败');
            const data = await res.json();
            const uploaded = Array.isArray(data.files) ? data.files : [];
            const bucket = mediaOf(node);
            let added = 0, skipped = 0, firstKind = '';
            uploaded.forEach(entry => {
                const kind = fileKind({name: entry.name});
                if (!kind || bucket.filter(item => item.kind === kind).length >= MEDIA_LIMITS[kind]) { skipped += 1; return; }
                bucket.push({id: uid('media'), kind, url: entry.url, name: entry.name || '素材'});
                firstKind ||= kind;
                added += 1;
            });
            if (firstKind) node.mediaTab = firstKind;
            scheduleSave();
            refreshMediaBlock(node, target);
            mediaStatus(target, added ? `已添加 ${added} 个素材${skipped ? `，${skipped} 个超出上限被跳过` : ''}` : '素材数量已达上限');
        } catch (error) {
            mediaStatus(target, error.message || '素材上传失败');
        }
    }
    function ideaPickerOverlay() {
        let overlay = document.getElementById('ideaAssetPicker');
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'ideaAssetPicker';
        overlay.className = 'gp-picker-overlay';
        overlay.innerHTML = `<div class="gp-picker-panel">
            <div class="gp-picker-head">
                <span class="gp-picker-title"><i data-lucide="folder-open"></i><span data-idea-title>从资产库选择</span></span>
                <button type="button" class="gp-picker-close" data-idea-close aria-label="关闭"><i data-lucide="x"></i></button>
            </div>
            <div class="gp-picker-body" data-idea-grid></div>
            <div class="gp-picker-foot"><span data-idea-count>未选择</span><button type="button" class="tool-btn" data-idea-add disabled>添加素材</button></div>
        </div>`;
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-idea-close]')) overlay.classList.remove('open');
        });
        document.body.appendChild(overlay);
        window.refreshIcons?.();
        return overlay;
    }
    async function openIdeaAssetPicker(node, target) {
        const canvasId = canvas?.id || window.canvas?.id;
        if (!canvasId) { mediaStatus(target, '画布未就绪，请刷新后重试'); return; }
        const tab = MEDIA_TABS.find(item => item.id === (node.mediaTab || 'image')) || MEDIA_TABS[0];
        const overlay = ideaPickerOverlay();
        const grid = overlay.querySelector('[data-idea-grid]');
        const count = overlay.querySelector('[data-idea-count]');
        const addBtn = overlay.querySelector('[data-idea-add]');
        const picked = new Map();
        const syncFoot = () => {
            count.textContent = picked.size ? `已选 ${picked.size} 项` : '未选择';
            addBtn.disabled = !picked.size;
            addBtn.textContent = picked.size ? `添加 ${picked.size} 项` : '添加素材';
        };
        overlay.querySelector('[data-idea-title]').textContent = `从资产库选择${tab.label}`;
        grid.innerHTML = '<p class="gp-picker-tip">正在读取资产库…</p>';
        syncFoot();
        overlay.classList.add('open');
        grid.onclick = event => {
            const item = event.target.closest('[data-idea-item]');
            if (!item || item.dataset.ideaAdded === '1') return;
            const key = item.dataset.ideaItem;
            if (picked.has(key)) { picked.delete(key); item.classList.remove('is-on'); }
            else {
                picked.set(key, {url: item.dataset.ideaUrl, name: item.dataset.ideaName});
                item.classList.add('is-on');
            }
            syncFoot();
        };
        addBtn.onclick = () => {
            const bucket = mediaOf(node);
            let added = 0, skipped = 0;
            picked.forEach(entry => {
                const kind = fileKind({name: entry.name});
                if (!kind || bucket.filter(item => item.kind === kind).length >= MEDIA_LIMITS[kind] || bucket.some(item => item.url === entry.url)) { skipped += 1; return; }
                bucket.push({id: uid('media'), kind, url: entry.url, name: entry.name || '素材'});
                added += 1;
            });
            if (added) { node.mediaTab = tab.id; scheduleSave(); refreshMediaBlock(node, target); }
            overlay.classList.remove('open');
            mediaStatus(target, added ? `已从资产库添加 ${added} 个素材${skipped ? `，${skipped} 个超出上限或重复被跳过` : ''}` : '没有可添加的素材');
        };
        try {
            const res = await fetch(`/api/canvases/${canvasId}/media`);
            if (!res.ok) throw new Error('资产库读取失败');
            const data = await res.json();
            const items = (data.items || data.assets || data.files || [])
                .filter(item => item?.url && (item.kind ? item.kind === tab.id : fileKind({name: item.name}) === tab.id));
            grid.innerHTML = items.length ? `<div class="gp-picker-grid">${items.map(item => {
                const added = mediaOf(node).some(entry => entry.url === item.url);
                return `<button type="button" class="gp-picker-item${added ? ' is-added' : ''}" data-idea-item="${esc(item.url)}" data-idea-url="${esc(item.url)}" data-idea-name="${esc(item.name || '素材')}"${added ? ' data-idea-added="1"' : ''} title="${esc(item.name || '')}${added ? ' · 已添加' : ''}">
                ${tab.id === 'image' ? `<img src="${esc(item.url)}" alt="${esc(item.name || '')}" loading="lazy">` : `<span class="gp-picker-ph"><i data-lucide="${tab.id === 'video' ? 'clapperboard' : 'music'}"></i><em>${esc(item.name || '')}</em></span>`}
                <span class="gp-picker-check"><i data-lucide="check"></i></span>
            </button>`;
            }).join('')}</div>` : `<p class="gp-picker-tip">资产库里还没有${tab.label}，先在资产页面生成或上传。</p>`;
            window.refreshIcons?.();
        } catch (error) {
            grid.innerHTML = `<p class="gp-picker-tip">${esc(error.message || '读取失败')}</p>`;
        }
    }
    function bindMedia(node, target) {
        // 画布会给节点内的 button 绑 stopPropagation，这里必须用捕获阶段才收得到点击
        // 素材区自己接管按下事件，否则会被当成节点拖拽，label 的默认转发也会失效
        target.addEventListener('mousedown', event => {
            if (event.target.closest('[data-media]')) event.stopPropagation();
        }, true);
        target.addEventListener('click', event => {
            // 自己触发的 input.click() 会再次冒到 body，必须放行，否则会被 preventDefault 把文件框吞掉
            if (event.target.matches?.('[data-media-input]')) return;
            const picker = event.target.closest('.gp-media-drop, .gp-media-add');
            if (picker) {
                const input = picker.tagName === 'LABEL' ? picker.querySelector('input[data-media-input]') : null;
                if (input && !input.disabled) { event.preventDefault(); event.stopPropagation(); input.click(); }
                return;
            }
            const tab = event.target.closest('[data-media-tab]');
            if (tab) { event.stopPropagation(); node.mediaTab = tab.dataset.mediaTab; scheduleSave(); refreshMediaBlock(node, target); return; }
            const library = event.target.closest('[data-media-library]');
            if (library) { event.stopPropagation(); openIdeaAssetPicker(node, target); return; }
            const del = event.target.closest('[data-media-del]');
            if (del) {
                event.stopPropagation();
                node.media = mediaOf(node).filter(item => item.id !== del.dataset.mediaDel);
                scheduleSave();
                refreshMediaBlock(node, target);
                mediaStatus(target, '已移除素材');
            }
        }, true);
        target.addEventListener('change', event => {
            if (!event.target.matches('[data-media-input]')) return;
            const files = Array.from(event.target.files || []);
            event.target.value = '';
            uploadMedia(node, target, files);
        });
        const pane = () => target.querySelector('[data-media-pane]');
        const isExternalFiles = event => !!(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length);
        target.addEventListener('dragover', event => {
            if (!isExternalFiles(event)) return;
            if (!event.target.closest('.gp-work-node')) return;
            event.preventDefault();
            event.stopPropagation();
            pane()?.classList.add('is-drag');
        });
        target.addEventListener('dragleave', event => {
            if (!event.target.closest('[data-media-pane]')) return;
            pane()?.classList.remove('is-drag');
        });
        target.addEventListener('drop', event => {
            if (!isExternalFiles(event)) return;
            if (!event.target.closest('.gp-work-node')) return;
            event.preventDefault();
            event.stopPropagation();
            pane()?.classList.remove('is-drag');
            uploadMedia(node, target, event.dataTransfer?.files);
        });
    }
    function nodeBody(node, target) {
        if (window.GameExtraNodes?.types.includes(node.type)) return window.GameExtraNodes.nodeBody(node, target);
        if (window.GameModel3D?.types.includes(node.type)) return window.GameModel3D.nodeBody(node, target);
        if (productionTypes.includes(node.type)) return window.GameDevelopment?.nodeBody(node, target);
        const p = project();
        target.classList.add('gp-work-node');
        if (!p || node.projectId !== p.id) { target.textContent = '正在读取项目，或此节点属于其他项目。'; return; }
        if (p.archived) { target.textContent = '项目已归档，已有文档和图片保留。'; return; }
        let content = '';
        if (node.type === 'gameIdea') {
            content = `<p>一句话描述灵感，玩法与美术方向交给 AI。留空也可以自由构思。</p>${field('idea', '游戏灵感', node.idea)}${mediaBlock(node)}${button('add-document', '添加需求文档节点')}<small>右侧端口可接到 AI 策划、LLM 对话或生图节点：图片作为参考图、文字灵感作为提示词一起送过去。</small>`;
        } else if (node.type === 'document') {
            const doc = p.documents.find(d => d.id === node.docId);
            if (!doc) { target.textContent = '文档引用已失效'; return; }
            content = `<h3>${esc(node.documentTitle ?? doc.title)}</h3><article class="gp-markdown gp-node-result">${window.GameAuthoring.markdown(node.documentDraft ?? doc.lastSavedContent)}</article>${button('edit-document', '展开编辑 / 插图')}${node.documentDraft !== undefined ? button('save-document', '保存正文草稿') : ''}<small>v${doc.revision} · 可连接图片作为 AI 参考，保存后供策划使用。</small>${contentControls(node)}`;
        } else if (node.type === 'gameTable') {
            const table = p.tables?.find(t => t.id === node.tableId);
            if (!table) { target.textContent = '表格引用已失效'; return; }
            content = `<h3>${esc((node.tableDraft || table).title)}</h3>${window.GameAuthoring.preview(node.tableDraft || table)}${button('edit-table', '编辑表格 / CSV 导入导出')}${node.tableDraft ? button('save-table', '保存表格草稿') : ''}<small>v${table.revision} · 连接到策划节点可作为数值或配置需求。</small>${contentControls(node)}`;
        } else if (node.type === 'gamePlan') {
            const proposal = candidate(node);
            // 新节点不继承项目里已有的策划，只有本节点生成或采用过才显示
            const linked = Boolean(node.candidateId || node.adoptedInput);
            const plan = proposal?.kind === 'plan' ? proposal.data : (linked ? p.plan : null);
            content = `${field('feedback', '补充想法 / 修改要求（可选）', node.feedback)}${controls(node)}${button('plan', plan ? '按输入重新策划' : '生成游戏策划')}<div class="gp-node-result">${planPreview(plan)}</div>${proposal?.kind === 'plan' ? button('adopt-plan', '采用这个方案') : ''}${plan && !proposal && !planState(node).ready ? button('reconfirm-plan', '确认沿用当前策划') : ''}<small>${plan ? '正式策划：' + planState(node).label : '生成后点击采用，再拆解资产'}</small>`;
        } else if (node.type === 'gameAssets') {
            const proposal = candidate(node);
            const linked = !node.fresh || Boolean(node.candidateId);
            const assets = proposal?.kind === 'assets' ? proposal.data : (linked ? p.assets : []);
            const picked = new Set(node.selectedAssetIds || []);
            content = `${field('feedback', '拆解要求（可选）', node.feedback)}${controls(node)}${button('assets', 'AI 拆解资产清单')}${proposal?.kind === 'assets' ? button('adopt-assets', '采用这份清单') : ''}<div class="gp-node-result">${assets.map(a => `<article><label class="gp-pick"><input type="checkbox" data-pick-asset="${esc(a.id)}" ${picked.has(a.id) ? 'checked' : ''}><strong>${esc(a.name)}</strong></label><p>${esc(a.purpose)}</p><small>${a.spec.width} × ${a.spec.height} · ${esc(a.spec.format)}${a.selected ? ' · 已选用' : ''}${a.needsUpdate ? ' · 需更新' : ''}</small><p class="gp-asset-prompt"><small>AI 生成提示词</small>${esc(a.prompt)}</p>${proposal ? '' : `<div class="gp-actions">${button('generate-asset', '生成美术', a.id)}${a.selected ? button('review', '验收此素材', a.id) : ''}</div>${p.outputs.filter(o => o.assetId === a.id).map((o, i) => button('select', `选用结果 ${i + 1}`, o.id)).join('')}`}</article>`).join('') || '<p>等待生成资产清单。</p>'}</div>${assets.length ? `<div class="gp-actions">${button('select-assets', '全选')}${button('clear-assets', '清空选择')}<small data-picked-count>已选 ${assets.filter(a => picked.has(a.id)).length} 项</small></div>${button('bind-selected', proposal ? '采用清单并创建所选图片生成节点' : '创建所选图片生成节点')}<small>自动带入 AI 提示词、尺寸与风格，并连接图片生成器；创建后在生成节点中运行。</small>` : ''}${!proposal && assets.length ? `${button('confirm-art', p.artConfirmed ? '美术方向已确认' : '确认美术方向')}${button('sync', '同步画布生成结果')}` : ''}`;
        }
        if (node.type === 'gameAssets') content += button('development-chain', '连接开发与试玩测试');
        target.innerHTML = `${content}${node.type==='gameAssets' ? button('media','接入图片 / 音乐 / 3D 模型') : ''}<p class="gp-node-status" role="status">${esc(running.has(node.id) ? 'AI 正在处理，请稍候…' : notices.get(node.id) || '')}</p>`;
        target.querySelectorAll('[data-field]').forEach(el => {
            el.addEventListener('input', () => { node[el.dataset.field] = el.value; scheduleSave(); });
            el.addEventListener('change', () => { node[el.dataset.field] = el.value; scheduleSave();
                if (el.dataset.field === 'presetId') target.querySelector('[data-preset-description]').textContent = rolePresets.find(p => p.id === el.value)?.description || '';
            });
        });
        target.querySelector('[data-chat-model]')?.addEventListener('change', event => {
            const [provider, model] = JSON.parse(event.target.value);
            Object.assign(node, {provider, model}); scheduleSave();
        });
        target.querySelectorAll('[data-pick-asset]').forEach(el => {
            el.addEventListener('change', () => {
                const ids = new Set(node.selectedAssetIds || []);
                if (el.checked) ids.add(el.dataset.pickAsset); else ids.delete(el.dataset.pickAsset);
                node.selectedAssetIds = [...ids]; scheduleSave();
                target.querySelector('[data-picked-count]').textContent = `已选 ${target.querySelectorAll('[data-pick-asset]:checked').length} 项`;
            });
        });
        target.querySelectorAll('[data-work]').forEach(el => {
            el.disabled = running.size > 0;
            el.onclick = event => { event.stopPropagation(); execute(node, el.dataset.work, el.dataset.id); };
        });
        if (node.type === 'gameIdea') bindMedia(node, target);
        target.addEventListener('wheel', event => event.stopPropagation());
    }
    function contentControls(node) {
        const proposal = node.contentCandidate;
        return `${button('history', '历史版本 / 恢复')}${field('editInstruction', 'AI 修改要求', node.editInstruction)}${controls(node)}${button('ai-content', 'AI 生成修改候选')}${proposal ? `<details open><summary>AI 候选（尚未采用）</summary><div class="gp-node-result">${node.type === 'document' ? window.GameAuthoring.markdown(proposal.data) : window.GameAuthoring.preview(proposal.data)}</div>${button('adopt-content', '采用并保存')}${button('discard-content', '丢弃候选')}</details>` : ''}`;
    }
    async function loaded() {
        const p = project();
        if (!p || p.archived || p.canvasId !== canvas?.id) return;
        // /api/config 的渠道没有 has_key；复用 API 配置页的公开列表，不读取密钥。
        providerRequest ||= fetch('/api/providers').then(async response => {
            if (!response.ok) throw new Error('API 配置读取失败，请刷新后重试');
            return (await response.json()).providers || [];
        });
        try { configuredProviders = await providerRequest; }
        catch (error) {
            providerRequest = null; configuredProviders = [];
            nodes.filter(n => types.includes(n.type)).forEach(n => notices.set(n.id, error.message));
        }
        presetRequest ||= fetch('/api/game-projects/presets').then(async response => {
            if (!response.ok) throw new Error('角色预设读取失败，请确认后端已更新并刷新页面');
            return (await response.json()).presets || [];
        });
        try { rolePresets = await presetRequest; }
        catch (error) {
            presetRequest = null; rolePresets = [];
            nodes.filter(n => types.includes(n.type)).forEach(n => notices.set(n.id, error.message));
        }
        if (project()?.id !== p.id || canvas?.id !== p.canvasId) return;
        window.GameDevelopment?.mergeLegacy();
        // 已有项目无须重建；旧面板项目首次打开时获得节点入口。
        if (!nodes.some(n => [...types, ...(window.GameModel3D?.types || []), ...(window.GameExtraNodes?.types || [])].includes(n.type) && n.projectId === p.id)) {
            pushUndo();
            const added = types.map((type, index) => ({id: uid('node'), type, projectId: p.id, x: 80 + index * 500, y: 100}));
            nodes.push(...added);
            for (let i = 0; i < added.length - 1; i++) connections.push({id: uid('c'), from: added[i].id, to: added[i + 1].id});
            scheduleSave();
        }
        render();
    }
    async function addWorkflowNode(type, point) {
        if (![...types, ...productionTypes, 'gameTable', 'document', ...(window.GameModel3D?.types || []), ...(window.GameExtraNodes?.types || [])].includes(type)) return null;
        const active = canvas?.id;
        // Node availability is shared; project data is created only when a node needs it.
        const p = project()?.canvasId === active ? project() : await window.GamePipeline.ensureProject();
        if (!p || p.archived) throw new Error('项目不可用或已归档');
        if (canvas?.id !== active || p.canvasId !== active) throw new Error('当前画布已切换，请重新添加节点');
        const node = {id: uid('node'), type, projectId: p.id, x: point.x, y: point.y, fresh: true};
        if (type === 'gameTable' || type === 'document') return window.GamePipeline.workflow(async ctx => {
            if (ctx.project.id !== p.id) throw new Error('当前项目已切换');
            if (type === 'gameTable') {
                const table = {id: uid('table'), title: '策划配置表', revision: 1,
                    columns: [{id: 'name', title: '名称', type: 'text'}, {id: 'value', title: '数值', type: 'number'}], rows: []};
                await ctx.write('/tables', 'POST', {table}); node.tableId = table.id;
            } else {
                const result = await ctx.write('/documents', 'POST', {title: '游戏需求文档', content: ''});
                node.docId = result.project.documents.at(-1).id;
            }
            pushUndo(); nodes.push(node); changed(); return node;
        });
        pushUndo(); nodes.push(node); changed(); return node;
    }
    function populateMenu(menu) {
        menu.querySelector('[data-game-menu]')?.remove();
        const group = document.createElement('div');
        group.dataset.gameMenu = '1';
        group.className = 'game-menu-group';
        const metas = [['gameIdea', '游戏灵感', 'gamepad-2'], ['gamePlan', 'AI 游戏策划', 'clipboard-list'], ['gameAssets', '需求与资产拆解', 'list-tree'], ['gameTable', '策划表格', 'table'], ['gameDevelop', '游戏开发', 'code'], ['gameTest', '试玩与场景', 'play'], ['gameRelease', '游戏交付', 'package']];
        metas.push(...Object.entries(window.GameExtraNodes?.menuTitles||{}).map(([type,title])=>[type,title,type==='gameScene'?'gamepad-2':type==='gameFolder'?'folder':type==='gameFile'?'file':'music']));
        metas.push(['gameModelAsset', '模型资产', 'box'], ['gameModel3d', '3D 模型生成', 'boxes'], ['gameAnimate3d', '3D 动画', 'person-standing']);
        group.innerHTML = '<div class="game-menu-head">游戏项目</div>' + metas.map(([type, label, icon]) =>
            `<button class="menu-btn" type="button" data-game-type="${type}"><i data-lucide="${icon}" class="w-4 h-4"></i><span>${label}</span></button>`).join('');
        group.querySelectorAll('button').forEach(el => { el.onclick = () => menuAdd(el.dataset.gameType); });
        menu.prepend(group);
        // 动态插入的图标要手动换一次 svg，否则只剩空 <i>
        window.lucide?.createIcons();
    }
    window.GameWorkflow = {nodeBody, loaded, execute, addNode: addWorkflowNode, populateMenu, referenceImages, controls, selectedChatModel, inputSignature, planState, uploadMedia};
    if (project()) loaded();
})();
