/* 游戏项目：沿用画布的节点、API 配置、生成队列及主题。 */
(() => {
    'use strict';
    let project = null, tab = 'documents', busy = false, dirty = false, candidateId = null;
    let recovery = [], selectedDoc = '', draftPlan = null, draftAssets = null, error = '', batchStopped = false;
    let draftArtConfirmed = null, ideaDraft = '';
    const base = '/api/game-projects';
    const esc = value => escapeHtml(String(value ?? ''));
    const dialog = document.createElement('dialog');
    dialog.id = 'gameProjectDialog';
    dialog.setAttribute('aria-label', '游戏项目');
    dialog.innerHTML = '<div class="gp-shell"><header><div><small>策划 → 美术</small><h2 id="gpTitle">游戏项目</h2></div><button type="button" class="tool-btn" data-action="close" aria-label="关闭">×</button></header><nav id="gpTabs"></nav><div id="gpMessage" role="status" aria-live="polite"></div><main id="gpBody"></main><footer><span id="gpRevision"></span><button class="tool-btn" data-action="reload">重新载入</button><button class="tool-btn" data-action="archive">归档并解除关联</button></footer></div>';
    document.body.append(dialog);
    const confirmation = document.createElement('dialog');
    confirmation.className = 'gp-confirm';
    confirmation.setAttribute('aria-label', '确认操作');
    confirmation.innerHTML = '<p></p><div class="gp-actions"><button type="button" class="tool-btn" data-answer="no">取消</button><button type="button" class="tool-btn gp-primary" data-answer="yes">确认</button></div>';
    document.body.append(confirmation);
    let resolveConfirmation = null;
    function finishConfirmation(answer) {
        confirmation.close();
        const resolve = resolveConfirmation; resolveConfirmation = null;
        resolve?.(answer);
    }
    confirmation.addEventListener('click', event => {
        const answer = event.target.closest('[data-answer]')?.dataset.answer;
        if (answer) finishConfirmation(answer === 'yes');
    });
    confirmation.addEventListener('cancel', event => { event.preventDefault(); finishConfirmation(false); });
    function ask(text) {
        confirmation.querySelector('p').textContent = text;
        confirmation.showModal();
        return new Promise(resolve => { resolveConfirmation = resolve; });
    }
    const body = dialog.querySelector('#gpBody');
    const message = dialog.querySelector('#gpMessage');
    const key = () => `game-project-draft:${canvas?.id || ''}:${project?.id || 'new'}`;
    const field = (name, label, value, multiline = false, type = 'text') => `<label>${esc(label)}${multiline ? `<textarea name="${name}">${esc(value)}</textarea>` : `<input name="${name}" type="${type}" value="${esc(value)}">`}</label>`;
    const button = (action, label, id = '', primary = false) => `<button type="button" class="tool-btn ${primary ? 'gp-primary' : ''}" data-action="${action}" data-id="${esc(id)}">${esc(label)}</button>`;
    const assetById = id => project?.assets.find(a => a.id === id);
    const remember = () => {
        if (!dirty || !project) return;
        try {
            const fields = [...body.querySelectorAll('input,textarea,select')].map(el => [el.name, el.type === 'checkbox' ? el.checked : el.value]);
            localStorage.setItem(key(), JSON.stringify({tab, selectedDoc, draftPlan, draftAssets, draftArtConfirmed, candidateId, fields}));
        } catch (_) { /* 退出提示仍保护未保存内容。 */ }
    };
    function markDirty() { dirty = true; remember(); }
    function clean() { dirty = false; try { localStorage.removeItem(key()); } catch (_) {} }
    function showError(value) { error = typeof value === 'string' ? value : JSON.stringify(value); message.textContent = error; }
    async function api(path = '', method = 'GET', data) {
        const response = await fetch(base + path, {method, headers: {'Content-Type': 'application/json'}, ...(data ? {body: JSON.stringify(data)} : {})});
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = result.detail;
            const exception = new Error(typeof detail === 'string' ? detail : detail?.message || (Array.isArray(detail) ? '内容尚不完整，请先用 AI 生成方案，或展开详细编辑补全后再保存。' : '请求失败，请重试'));
            exception.detail = detail;
            exception.status = response.status;
            throw exception;
        }
        return result;
    }
    function assign(result) {
        project = result.project;
        recovery = result.recovery || [];
        window.GamePipeline.projectId = project?.archived ? null : project?.id;
        renderPanel();
        render();
    }
    async function write(path, method, data = {}) {
        const activeCanvas = canvas?.id, activeProject = project.id;
        const result = await api(`/${project.id}${path}`, method, {baseRevision: project.revision, ...data});
        if (canvas?.id !== activeCanvas || project?.id !== activeProject) throw new Error('操作已保存到原项目；当前画布已切换，请重新打开原项目查看');
        clean();
        assign(result);
        return result;
    }
    function blankPlan() {
        return {schemaVersion: 1, revision: 1, title: project.title, playerFantasy: '', coreLoop: '', controls: '', progression: '', successFailureRestart: '', firstPlayable: '', visualDirection: {description: '', palette: [], referenceAssetIds: []}, characters: [], scenes: [], openQuestions: [], assumptions: [], acceptanceCriteria: []};
    }
    function blankAsset() {
        return {id: uid('asset'), revision: 1, name: '新资产', purpose: '', usage: 'runtime', required: true, kind: 'image', spec: {width: 256, height: 256, format: 'png', alphaRequired: false}, prompt: '', referenceAssetIds: [], visualOverride: null, runtimeDestination: 'assets/' + uid('image') + '.png', generatorNodeId: null, promptNodeId: null, selected: null, review: {status: 'pending', issues: [], humanConfirmed: false}, needsUpdate: false};
    }
    function llmControls() {
        return `${field('idea', '一句话说说你想玩的游戏（可留空，让 AI 自由发挥）', ideaDraft, true)}<details><summary>高级设置（可选）</summary><div class="gp-row"><label>LLM 渠道<select name="provider">${chatProviderOptions(chatApiProviders()[0]?.id || 'comfly')}</select></label>${field('model', '模型（默认即可）', '')}</div></details>`;
    }
    async function generatePlan() {
        const idea = ideaDraft;
        const provider = value('provider') || chatApiProviders()[0]?.id || 'comfly';
        const model = value('model');
        const result = await api(`/${project.id}/plan-candidates`, 'POST', {baseRevision: project.revision, provider, model, idea: idea || '请自由构思一个有新意、适合小团队制作的小游戏，给我完整可玩的方案。'});
        project = result.project;
        const candidate = project.candidates.filter(c => c.kind === 'plan').at(-1);
        if (candidate?.status !== 'valid') {
            renderPanel();
            throw new Error('AI 暂未生成完整方案，请重试或在高级设置中更换模型。');
        }
        draftPlan = structuredClone(candidate.data);
        candidateId = candidate.id; tab = 'plan'; dirty = true;
        renderPanel(); remember();
    }
    function candidateList(kind) {
        const list = project.candidates.filter(c => c.kind === kind);
        return list.map(c => `<article class="gp-candidate"><strong>${c.status === 'valid' ? '可编辑候选' : '生成未通过'}</strong><p>来源版本 ${c.sourceRevision} · ${c.id.slice(-8)}</p>${c.diagnostics.length ? `<pre>${esc(c.diagnostics.join('\n'))}</pre>` : ''}${c.status === 'valid' ? button('edit-candidate', '查看差异并编辑', c.id) : `<details><summary>原始输出</summary><pre>${esc(c.raw)}</pre></details>`}${button('discard', '丢弃', c.id)}</article>`).join('');
    }
    function renderDocuments() {
        const doc = project.documents.find(d => d.id === selectedDoc);
        return `<div class="gp-row"><select id="gpDocSelect" aria-label="选择文档"><option value="">新文档</option>${project.documents.map(d => `<option value="${esc(d.id)}" ${d.id === selectedDoc ? 'selected' : ''}>${esc(d.title)} · v${d.revision}</option>`).join('')}</select>${button('new-doc', '新建文档')}<label class="gp-file">导入 Markdown/TXT<input id="gpImportDoc" type="file" accept=".md,.txt"></label></div>${field('docTitle', '标题', doc?.title || '')}${field('docContent', '正文', doc?.lastSavedContent || '', true)}<div class="gp-actions">${button('save-doc', '保存文档', '', true)}${doc ? button('doc-node', '放入画布', doc.id) + button('delete-doc', '移除文档', doc.id) : ''}</div><p class="gp-muted">删除节点保留正文；同项目复制节点引用同一正文。导入限 UTF-8、1 MiB。</p>`;
    }
    function renderPlan() {
        const plan = draftPlan || project.plan || blankPlan();
        const labels = {title: '游戏名称', playerFantasy: '玩家目标与体验', coreLoop: '核心循环', controls: '主要操作', progression: '进程', successFailureRestart: '胜负与重开', firstPlayable: '首个可玩范围与排除项'};
        return `${project.planSourceChanged ? '<p class="gp-warning">来源文档已变化，请核对策划后重新确认。</p>' : ''}<section><h3>一句话，开始你的游戏</h3><p class="gp-muted">玩法、操作、成长与美术方向交给 AI。只说一个灵感，也可以直接让 AI 帮你想。</p>${llmControls()}${button('generate-plan', project.plan || draftPlan ? '按想法重新生成' : '生成游戏方案', '', true)}${button('surprise-plan', '帮我想一个')}</section>${candidateList('plan')}${candidateId ? '<p class="gp-warning">正在编辑候选，保存采用后才替换正式策划。</p>' : ''}${project.plan || draftPlan ? `<article class="gp-candidate"><h3>${esc(plan.title)}</h3>${Object.entries(labels).filter(([name]) => name !== 'title').map(([name, label]) => `<h4>${label}</h4><p style="white-space:pre-wrap">${esc(plan[name])}</p>`).join('')}<h4>美术方向</h4><p>${esc(plan.visualDirection.description)}</p></article>` : ''}<details><summary>详细编辑（可选）</summary>${Object.entries(labels).map(([name, label]) => field(name, label, plan[name], name !== 'title')).join('')}${field('visualDescription', '美术方向', plan.visualDirection.description, true)}${field('palette', '配色（每行一项）', plan.visualDirection.palette.join('\n'), true)}${field('sharedRefs', '共享参考资产 ID（每行一项）', plan.visualDirection.referenceAssetIds.join('\n'), true)}${['characters', 'scenes'].map(key => `<details><summary>${key === 'characters' ? '角色' : '场景'}</summary><p class="gp-muted">每行：稳定 ID | 描述 | 关联资产 ID（逗号分隔）</p>${field(key, '', plan[key].map(e => `${e.id} | ${e.description} | ${e.assetIds.join(',')}`).join('\n'), true)}</details>`).join('')}${[['openQuestions', '待确认问题'], ['assumptions', '假设'], ['acceptanceCriteria', '验收条目']].map(([name, label]) => field(name, label + '（每行一项）', plan[name].join('\n'), true)).join('')}</details>${project.plan || draftPlan ? '' : '<p class="gp-muted">先生成方案，再确认采用，无需填写详细表单。</p>'}<label class="gp-check"><input name="planConfirmed" type="checkbox" ${!candidateId && project.planConfirmed ? 'checked' : ''}>我已核对并确认此策划</label>${project.plan || draftPlan ? button('save-plan', candidateId ? '采用这个方案' : '保存策划', '', true) : ''}`;
    }
    function renderAssets() {
        const assets = draftAssets || project.assets;
        return `<details><summary>AI 辅助拆解资产</summary>${llmControls()}${button('generate-assets', '生成清单候选')}</details>${candidateList('assets')}${candidateId ? '<p class="gp-warning">正在编辑清单候选，采用前不会修改正式资产。</p>' : ''}<div class="gp-actions">${button('add-asset', '添加资产')}${button('save-assets', candidateId ? '采用清单差异' : '保存清单', '', true)}</div><label class="gp-check"><input name="artConfirmed" type="checkbox" ${(draftArtConfirmed ?? project.artConfirmed) ? 'checked' : ''}>已确认美术方向（可先生成代表性资产）</label>${assets.map(a => `<details class="gp-asset" data-asset="${esc(a.id)}"><summary>${esc(a.name)} <span>${a.usage === 'concept' ? '概念图' : '运行时'} · v${a.revision} ${a.needsUpdate ? '· 待更新' : ''}</span></summary><small>${esc(a.id)}</small>${field('name', '名称', a.name)}${field('purpose', '用途', a.purpose)}<div class="gp-row"><label>分类<select name="usage"><option value="runtime" ${a.usage === 'runtime' ? 'selected' : ''}>运行时素材</option><option value="concept" ${a.usage === 'concept' ? 'selected' : ''}>概念图</option></select></label><label class="gp-check"><input name="required" type="checkbox" ${a.required ? 'checked' : ''}>必需</label></div><div class="gp-row">${field('width', '宽', a.spec.width, false, 'number')}${field('height', '高', a.spec.height, false, 'number')}<label>格式<select name="format">${['png', 'jpeg', 'webp'].map(f => `<option ${f === a.spec.format ? 'selected' : ''}>${f}</option>`).join('')}</select></label></div><label class="gp-check"><input name="alphaRequired" type="checkbox" ${a.spec.alphaRequired ? 'checked' : ''}>要求透明背景</label>${field('prompt', '生成提示词', a.prompt, true)}${field('referenceAssetIds', '参考资产 ID（每行一项）', a.referenceAssetIds.join('\n'), true)}${field('visualOverride', '单项美术方向覆盖（留空使用共享风格）', a.visualOverride?.description || '', true)}${field('overridePalette', '覆盖配色（每行一项）', a.visualOverride?.palette.join('\n') || '', true)}${field('overrideRefs', '覆盖风格参考 ID（每行一项）', a.visualOverride?.referenceAssetIds.join('\n') || '', true)}${field('runtimeDestination', '导出相对路径', a.runtimeDestination)}${button('remove-asset', '从清单移除（保留文件）', a.id)}</details>`).join('')}`;
    }
    function renderDelivery() {
        return `<p class="gp-muted">创建节点不生成；实际生成使用所选渠道，可能计费。无可靠报价时不估算费用。选用后再完成规格与人工检查。</p><div class="gp-actions">${button('create-all', '创建 / 恢复全部节点')}${button('batch', '生成勾选资产')}${button('stop', '停止后续提交')}${button('sync-outputs', '恢复生成候选')}</div>${project.assets.map(a => {
            const gen = nodes.find(n => n.id === a.generatorNodeId && n.projectId === project.id && n.assetId === a.id);
            const outputs = project.outputs.filter(o => o.assetId === a.id);
            const preview = a.selected ? `<img class="gp-preview" alt="${esc(a.name)} 已选版本" data-selected="${esc(a.id)}">` : '';
            return `<article class="gp-delivery"><div class="gp-row"><label class="gp-check"><input type="checkbox" name="batchAsset" value="${esc(a.id)}">${esc(a.name)}</label><span>${a.spec.width}×${a.spec.height} · ${esc(a.spec.format)} · ${a.required ? '必需' : '可选'} · ${a.usage === 'concept' ? '概念' : '运行时'}</span></div><p>${esc(a.purpose)} · ${gen ? '已绑定' : '绑定缺失，可恢复'} · ${a.needsUpdate ? '待更新' : a.review.status === 'passed' ? '检查通过' : '待检查'}</p><div class="gp-actions">${button('bind', gen ? '定位 / 同步节点' : '创建 / 恢复节点', a.id)}${button('generate', '实际生成', a.id)}<label class="gp-file">上传修正版并选用<input type="file" data-upload="${esc(a.id)}" accept="image/png,image/jpeg,image/webp"></label></div>${preview}<div class="gp-output-list">${outputs.map(o => `<div><img alt="${esc(a.name)} 候选" data-output="${esc(o.id)}"><small>来源修订 ${o.sourceAssetRevision}</small>${button('select', '选用此图', o.id)}</div>`).join('')}</div>${a.selected ? `<label class="gp-check"><input type="checkbox" name="human-${esc(a.id)}">我已确认语义、裁切、风格和真实透明效果</label><label class="gp-check"><input type="checkbox" name="accept-${esc(a.id)}">确认旧图仍适用于当前修订</label>${button('review', '检查当前选用文件', a.id)}<p>${esc(a.review.issues.join('；'))}</p>` : '<p class="gp-muted">尚未选用真实文件</p>'}</article>`;
        }).join('')}<div class="gp-actions">${button('export', '导出正式资产包', '', true)}${button('draft-export', '导出草稿包')}</div>`;
    }
    function renderPanel() {
        dialog.querySelector('#gpTitle').textContent = project?.title || '游戏项目';
        dialog.querySelector('#gpRevision').textContent = project ? `项目修订 ${project.revision}${project.archived ? ' · 已归档' : ''}` : '';
        dialog.querySelector('#gpTabs').innerHTML = project ? [['documents', '1 文档'], ['plan', '2 策划'], ['assets', '3 资产清单'], ['delivery', '4 生成与交付']].map(([id, label]) => `<button class="tool-btn ${tab === id ? 'active' : ''}" data-tab="${id}" type="button">${label}</button>`).join('') : '';
        if (!project) body.innerHTML = `<h3>把当前画布关联为游戏项目</h3><p>管理策划文档、生成资产与可交付文件。普通画布节点可继续使用。</p>${llmControls()}${button('create', '生成我的游戏方案', '', true)}`;
        else if (project.archived) body.innerHTML = '<p>项目已归档，文件保留。关闭后重新打开可为当前画布创建新项目。</p>';
        else if (canvas?.kind === 'game') {
            dialog.querySelector('#gpTabs').innerHTML = '';
            body.innerHTML = '<p>灵感、策划、文档与资产拆解均在画布节点中操作。这里管理选用结果、验收和导出。</p>' + renderDelivery();
        }
        else body.innerHTML = ({documents: renderDocuments, plan: renderPlan, assets: renderAssets, delivery: renderDelivery}[tab])();
        message.textContent = error || (busy ? '正在处理，请稍候…' : '');
        if (project && !project.archived) {
            const link = document.createElement('a');
            link.className = 'tool-btn'; link.textContent = '打开游戏工作台';
            link.href = '/static/game-workbench.html?projectId=' + encodeURIComponent(project.id);
            link.target = '_blank'; link.rel = 'noopener'; body.prepend(link);
        }
        if (recovery.length) {
            const warning = document.createElement('p');
            warning.className = 'gp-warning';
            warning.textContent = '检测到正文写入中断；编辑器显示项目中上次保存的权威正文。';
            warning.insertAdjacentHTML('beforeend', button('recover', '恢复正文文件'));
            body.prepend(warning);
        }
        dialog.querySelectorAll('button[data-action]').forEach(el => { el.disabled = busy && !['close', 'stop'].includes(el.dataset.action); });
        loadImages();
    }
    const objectUrls = new Set();
    async function loadImages() {
        for (const url of objectUrls) URL.revokeObjectURL(url);
        objectUrls.clear();
        if (!dialog.open || !project || tab !== 'delivery') return;
        const id = project.id;
        await Promise.all([...body.querySelectorAll('img')].map(async img => {
            try {
                const path = img.dataset.selected ? `/assets/${img.dataset.selected}/image` : `/outputs/${img.dataset.output}/image`;
                const response = await fetch(`${base}/${id}${path}`);
                if (!response.ok) throw new Error('源文件缺失或无权读取');
                const blob = await response.blob();
                if (!img.isConnected || project.id !== id) return;
                const url = URL.createObjectURL(blob); objectUrls.add(url); img.src = url;
            } catch (_) { img.alt += '（文件缺失，请重新选用）'; }
        }));
    }
    function listLines(name, root = body) { return (root.querySelector(`[name="${name}"]`)?.value || '').split('\n').map(s => s.trim()).filter(Boolean); }
    function value(name, root = body) { return root.querySelector(`[name="${name}"]`)?.value || ''; }
    function checked(name, root = body) { return !!root.querySelector(`[name="${name}"]`)?.checked; }
    function readPlan() {
        const plan = structuredClone(draftPlan || project.plan || blankPlan());
        for (const name of ['title', 'playerFantasy', 'coreLoop', 'controls', 'progression', 'successFailureRestart', 'firstPlayable']) plan[name] = value(name);
        plan.visualDirection = {description: value('visualDescription'), palette: listLines('palette'), referenceAssetIds: listLines('sharedRefs')};
        for (const name of ['openQuestions', 'assumptions', 'acceptanceCriteria']) plan[name] = listLines(name);
        for (const name of ['characters', 'scenes']) plan[name] = listLines(name).map(line => {
            const [id, description, refs = ''] = line.split('|').map(s => s.trim());
            return {id, description: description || '', assetIds: refs.split(',').map(s => s.trim()).filter(Boolean)};
        });
        return plan;
    }
    function readAssets() {
        draftArtConfirmed = checked('artConfirmed');
        return [...body.querySelectorAll('[data-asset]')].map(row => {
            const original = (draftAssets || project.assets).find(a => a.id === row.dataset.asset);
            const asset = structuredClone(original);
            for (const name of ['name', 'purpose', 'usage', 'prompt', 'runtimeDestination']) asset[name] = value(name, row);
            asset.required = checked('required', row);
            asset.spec = {width: Number(value('width', row)), height: Number(value('height', row)), format: value('format', row), alphaRequired: checked('alphaRequired', row)};
            asset.referenceAssetIds = listLines('referenceAssetIds', row);
            asset.visualOverride = value('visualOverride', row).trim() ? {description: value('visualOverride', row), palette: listLines('overridePalette', row), referenceAssetIds: listLines('overrideRefs', row)} : null;
            return asset;
        });
    }
    async function ensureSavedCanvas() {
        clearTimeout(saveTimer); saveTimer = null;
        await saveCanvas();
        const deadline = Date.now() + 15000;
        while (savingCanvasNow || saveCanvasAgain) {
            if (Date.now() > deadline) throw new Error('画布尚未保存，请稍后重试');
            await new Promise(resolve => setTimeout(resolve, 80));
        }
        if (localCanvasDirty) throw new Error('画布保存失败，已保留本地节点');
    }
    function effectiveReferences(asset) {
        const style = asset.visualOverride || project.plan?.visualDirection;
        return [...new Set([...asset.referenceAssetIds, ...(style?.referenceAssetIds || []).filter(id => id !== asset.id)])];
    }
    async function bindAsset(asset) {
        const source = nodes.find(n => n.type === 'gameAssets' && n.projectId === project.id);
        const position = source ? {x: source.x + 540, y: source.y + project.assets.indexOf(asset) * 520} : defaultPoint(-360, project.assets.indexOf(asset) * 80);
        let gen = nodes.find(n => n.id === asset.generatorNodeId && n.type === 'generator' && n.projectId === project.id && n.assetId === asset.id);
        gen ||= nodes.find(n => n.type === 'generator' && n.projectId === project.id && n.assetId === asset.id && n.gameBinding === true);
        let prompt = nodes.find(n => n.id === asset.promptNodeId && n.type === 'prompt' && n.projectId === project.id && n.assetId === asset.id);
        prompt ||= nodes.find(n => n.type === 'prompt' && n.projectId === project.id && n.assetId === asset.id && n.gameBinding === true);
        pushUndo();
        if (!prompt) prompt = addPromptNode(position);
        if (!gen) gen = addGeneratorNode({x: position.x + 360, y: position.y});
        const style = asset.visualOverride || project.plan?.visualDirection;
        Object.assign(prompt, {projectId: project.id, assetId: asset.id, gameBinding: true,
            text: [asset.prompt, style?.description, style?.palette?.length ? '配色：' + style.palette.join('、') : ''].filter(Boolean).join('\n')});
        Object.assign(gen, {projectId: project.id, assetId: asset.id, gameBinding: true, gameAssetRevision: asset.revision, count: 1,
            customSize: `${asset.spec.width}x${asset.spec.height}`, customWidth: String(asset.spec.width), customHeight: String(asset.spec.height), ratio: 'custom', resolution: 'custom'});
        if (!connections.some(c => c.from === prompt.id && c.to === gen.id)) connections.push({id: uid('c'), from: prompt.id, to: gen.id});
        if (source && !connections.some(c => c.from === source.id && c.to === prompt.id)) connections.push({id: uid('c'), from: source.id, to: prompt.id});
        const activeRefs = new Set(effectiveReferences(asset));
        connections = connections.filter(c => c.to !== gen.id || !nodes.find(n => n.id === c.from)?.gameReference || activeRefs.has(nodes.find(n => n.id === c.from)?.gameReference));
        for (const refId of activeRefs) {
            const reference = assetById(refId);
            if (!reference?.selected) continue;
            let node = nodes.find(n => n.gameReference === refId && n.projectId === project.id && n.assetId === asset.id);
            if (!node) node = addImageNode({x: position.x - 300, y: position.y});
            Object.assign(node, {projectId: project.id, assetId: asset.id, gameReference: refId,
                url: `${base}/${project.id}/files/${refId}/${reference.selected.selectionId}.${reference.selected.relativePath.split('.').at(-1)}`, name: reference.name});
            if (!connections.some(c => c.from === node.id && c.to === gen.id)) connections.push({id: uid('c'), from: node.id, to: gen.id});
        }
        syncGeneratorInputs(); render(); scheduleSave();
        await ensureSavedCanvas();
        await write(`/assets/${asset.id}/binding`, 'POST', {generatorNodeId: gen.id, promptNodeId: prompt.id});
        return gen;
    }
    async function generateAsset(asset) {
        if (!project.planConfirmed || project.planSourceChanged) throw new Error('请先确认当前策划');
        for (const ref of effectiveReferences(asset)) if (!assetById(ref)?.selected) throw new Error(`请先选用参考资产 ${ref}`);
        const gen = await bindAsset(asset);
        if (gen.running) throw new Error('此资产正在生成');
        await runCanvasGenerate(gen.id);
        if (gen.runStatus === 'failed') throw new Error(gen.runError || '生成失败，旧选用版本已保留');
        await syncOutputs();
    }
    async function syncOutputs() {
        if (!project) return;
        const activeProjectId = project.id;
        await ensureSavedCanvas();
        for (const log of canvas.logs || []) {
            const origin = log.gameProject;
            if (!origin || origin.projectId !== activeProjectId || log.status !== 'success') continue;
            for (let i = 0; i < (log.outputs || []).length; i++) {
                const sourceUrl = outputUrlValue(log.outputs[i]);
                const sourceOutputId = `${log.request?.task_id || log.request?.request_id || log.id}_${i}`;
                if (project.outputs.some(o => o.sourceNodeId === origin.sourceNodeId && o.sourceOutputId === sourceOutputId)) continue;
                const output = {id: uid('output'), assetId: origin.assetId, sourceNodeId: origin.sourceNodeId, sourceOutputId,
                    sourceAssetRevision: origin.assetRevision, sourceUrl,
                    parameters: origin.parameters || {prompt: log.prompt || '', model: log.model || '', provider: origin.provider || '', size: origin.size || '', references: (log.refs || []).map(r => r.url).slice(0, 32)}};
                const result = await api(`/${activeProjectId}/assets/${origin.assetId}/outputs`, 'POST', {output});
                if (project?.id !== activeProjectId) return;
                project = result.project;
            }
        }
        if (!dirty) renderPanel();
    }
    async function editCandidate(id) {
        const candidate = project.candidates.find(c => c.id === id);
        if (!candidate?.data) return;
        if (dirty && !await ask('当前草稿尚未保存，改为编辑此候选？')) return;
        if (candidate.kind === 'assets') {
            const before = new Map(project.assets.map(a => [a.id, a]));
            const after = new Map(candidate.data.map(a => [a.id, a]));
            const added = [...after.keys()].filter(id => !before.has(id));
            const removed = [...before.keys()].filter(id => !after.has(id));
            const fields = ['name', 'purpose', 'usage', 'required', 'spec', 'prompt', 'referenceAssetIds', 'visualOverride', 'runtimeDestination'];
            const modified = [...after.keys()].filter(id => before.has(id) && fields.some(key => JSON.stringify(before.get(id)[key]) !== JSON.stringify(after.get(id)[key])));
            const summary = `新增 ${added.length} 项：${added.map(id => after.get(id).name).join('、') || '无'}\n修改 ${modified.length} 项：${modified.map(id => after.get(id).name).join('、') || '无'}\n移除 ${removed.length} 项：${removed.map(id => before.get(id).name).join('、') || '无'}`;
            if (!await ask('清单差异\n' + summary + '\n打开候选编辑？采用前仍可逐项修改。')) return;
            draftAssets = structuredClone(candidate.data); tab = 'assets';
        } else { draftPlan = structuredClone(candidate.data); tab = 'plan'; }
        candidateId = id; dirty = true; renderPanel(); remember();
    }
    async function adopt(path, data) {
        try { await write(path, 'PUT', {...data, candidateId}); }
        catch (exception) {
            if (!exception.detail?.sourceChanged || !await ask('候选生成后来源或项目已变化。已检查当前差异，仍采用此候选？')) throw exception;
            await write(path, 'PUT', {...data, candidateId, acknowledgeSourceChange: true});
        }
        candidateId = null; draftPlan = null; draftAssets = null; draftArtConfirmed = null; renderPanel(); render();
    }
    async function open() {
        if (!canvas) return alert('请先打开画布');
        if (!dialog.open) dialog.showModal();
        error = ''; project = null; body.textContent = '正在读取项目…';
        try {
            const result = await api(`?canvasId=${encodeURIComponent(canvas.id)}`);
            const item = result.projects.find(p => !p.archived);
            if (item) {
                tab = 'plan';
                const loaded = await api('/' + item.id);
                if (!loaded.project.documents.some(d => d.id === selectedDoc)) selectedDoc = loaded.project.documents[0]?.id || '';
                assign(loaded);
            } else { window.GamePipeline.projectId = null; renderPanel(); }
            if (project) {
                const saved = localStorage.getItem(key());
                if (saved && await ask('检测到未保存草稿，是否恢复？')) {
                    const draft = JSON.parse(saved);
                    ({tab, selectedDoc, draftPlan, draftAssets, draftArtConfirmed, candidateId} = draft);
                    dirty = true; renderPanel();
                    const controls = [...body.querySelectorAll('input,textarea,select')];
                    (draft.fields || []).forEach(([name, val], index) => {
                        const el = controls[index];
                        if (!el || el.name !== name) return;
                        if (el.type === 'checkbox') el.checked = val; else el.value = val;
                    });
                }
                render();
            }
        } catch (exception) { showError(exception.message); }
    }
    async function action(name, id) {
        error = '';
        if (name === 'close') { remember(); dialog.close(); return; }
        if (name === 'stop') { batchStopped = true; showError('已停止后续提交；已提交任务继续等待，不代表上游取消。'); return; }
        if (busy) return;
        busy = true;
        message.textContent = '正在处理，请稍候…';
        dialog.querySelectorAll('button[data-action]').forEach(el => { el.disabled = !['close', 'stop'].includes(el.dataset.action); });
        try {
            if (name === 'create') { ideaDraft = value('idea'); project = (await api('', 'POST', {title: ideaDraft.trim().slice(0, 80) || '我的游戏灵感', canvasId: canvas.id})).project; window.GamePipeline.projectId = project.id; tab = 'plan'; await generatePlan(); }
            else if (name === 'reload') { if (!dirty || await ask('草稿仍保留在本机，重新载入服务端版本？')) { dirty = false; draftPlan = draftAssets = null; candidateId = null; if (project) assign(await api('/' + project.id)); else await open(); } }
            else if (name === 'archive') { if (project && await ask('归档并解除当前画布关联？正文与图片文件保留。')) { await write('/archive', 'POST'); } }
            else if (name === 'recover') await write('/recover-documents', 'POST');
            else if (name === 'new-doc') { if (!dirty || await ask('保留草稿并新建文档？')) { remember(); selectedDoc = ''; dirty = false; renderPanel(); } }
            else if (name === 'save-doc') { const docId = selectedDoc; const result = await write('/documents' + (docId ? '/' + docId : ''), docId ? 'PUT' : 'POST', {title: value('docTitle'), content: value('docContent')}); selectedDoc = docId || result.project.documents.at(-1).id; renderPanel(); render(); }
            else if (name === 'delete-doc' && await ask('从项目索引移除此文档？仍被引用时会阻止，原文件保留。')) { await write('/documents/' + id, 'DELETE'); selectedDoc = ''; renderPanel(); }
            else if (name === 'doc-node') {
                pushUndo(); addNode({id: uid('document'), type: 'document', x: defaultPoint().x, y: defaultPoint().y, projectId: project.id, docId: id}); await ensureSavedCanvas();
            }
            else if (name === 'generate-plan' || name === 'surprise-plan') {
                if (dirty && !await ask('生成新方案？当前草稿会被新方案替换。')) return;
                ideaDraft = name === 'surprise-plan' ? '' : value('idea');
                await generatePlan();
            }
            else if (name === 'generate-assets') {
                remember();
                const result = await api(`/${project.id}/${name === 'generate-plan' ? 'plan' : 'asset'}-candidates`, 'POST', {baseRevision: project.revision, provider: value('provider'), model: value('model'), idea: value('idea')});
                project = result.project;
                if (dirty) { showError('候选已保存；当前编辑草稿保留。保存草稿后重新载入可查看候选。'); }
                else renderPanel();
            }
            else if (name === 'edit-candidate') await editCandidate(id);
            else if (name === 'discard') await write('/candidates/' + id, 'DELETE');
            else if (name === 'save-plan') await adopt('/plan', {plan: readPlan(), confirmed: checked('planConfirmed')});
            else if (name === 'save-assets') await adopt('/assets', {assets: readAssets(), artConfirmed: checked('artConfirmed')});
            else if (name === 'add-asset') { draftAssets = readAssets(); draftAssets.push(blankAsset()); markDirty(); renderPanel(); remember(); }
            else if (name === 'remove-asset') { draftAssets = readAssets().filter(a => a.id !== id); markDirty(); renderPanel(); remember(); }
            else if (name === 'bind') { await bindAsset(assetById(id)); }
            else if (name === 'create-all') { for (const asset of [...project.assets]) await bindAsset(assetById(asset.id)); }
            else if (name === 'generate') { if (await ask('将使用当前 API 图片渠道生成 1 项资产，可能计费。现无可靠报价，确认提交？')) await generateAsset(assetById(id)); }
            else if (name === 'batch') {
                const ids = [...body.querySelectorAll('[name="batchAsset"]:checked')].map(el => el.value);
                const channels = [...new Set(ids.map(id => nodes.find(n => n.id === assetById(id).generatorNodeId)?.apiProvider || imageApiProviders()[0]?.name || '默认图片渠道'))];
                if (!ids.length) throw new Error('请勾选要生成的资产');
                if (ids.length > 1 && !project.artConfirmed) throw new Error('请先确认美术方向，再批量生成；可先单项生成代表性资产。');
                if (await ask(`将按现有队列逐项提交 ${ids.length} 项资产；渠道：${channels.join('、')}。无可靠报价，可能计费。确认？`)) {
                    batchStopped = false;
                    const failures = [];
                    for (const assetId of ids) { if (batchStopped) break; try { await generateAsset(assetById(assetId)); } catch (e) { failures.push(assetById(assetId).name + '：' + e.message); } }
                    if (failures.length) throw new Error(failures.join('\n'));
                }
            }
            else if (name === 'sync-outputs') await syncOutputs();
            else if (name === 'select') { const output = project.outputs.find(o => o.id === id); await write(`/assets/${output.assetId}/selection`, 'POST', {candidateId: id}); }
            else if (name === 'review') await write(`/assets/${id}/review`, 'POST', {humanConfirmed: checked('human-' + id), acceptCurrentRevision: checked('accept-' + id)});
            else if (name === 'export' || name === 'draft-export') {
                const result = await api(`/${project.id}/exports`, 'POST', {baseRevision: project.revision, draft: name === 'draft-export'});
                const response = await fetch(`${base}/${project.id}/exports/${result.exportId}`);
                if (!response.ok) throw new Error('下载失败');
                downloadBlob(await response.blob(), `${project.title}-${result.projectRevision}${result.draft ? '-草稿' : ''}.zip`);
                showError(result.draft ? '草稿已导出：' + result.issues.join('；') : '正式资产包已导出');
            }
        } catch (exception) { if (name === 'create' && project) renderPanel(); remember(); showError(exception.message + (exception.detail?.issues ? '\n' + exception.detail.issues.join('\n') : '')); }
        finally {
            busy = false;
            if (!error) message.textContent = '已完成';
            dialog.querySelectorAll('button[data-action]').forEach(el => { el.disabled = false; });
        }
    }
    dialog.addEventListener('click', async event => {
        const target = event.target.closest('button');
        if (target?.dataset.action) action(target.dataset.action, target.dataset.id);
        if (target?.dataset.tab) {
            if (busy) return;
            if (dirty && !await ask('未保存内容将保留为本机草稿。切换步骤？')) return;
            remember(); dirty = false; candidateId = null; draftPlan = draftAssets = null; tab = target.dataset.tab; renderPanel();
        }
    });
    dialog.addEventListener('input', event => {
        if (event.target.name === 'idea') ideaDraft = event.target.value;
        if (!event.target.matches('input,textarea,select') || ['batchAsset', 'provider', 'model', 'idea'].includes(event.target.name) || /^(human-|accept-)/.test(event.target.name) || event.target.type === 'file') return;
        markDirty();
    });
    dialog.addEventListener('cancel', () => remember());
    dialog.addEventListener('change', async event => {
        const target = event.target;
        if (target.id === 'gpDocSelect') {
            if (dirty && !await ask('保留草稿并切换文档？')) { target.value = selectedDoc; return; }
            remember(); dirty = false; selectedDoc = target.value; renderPanel();
        }
        if (target.id === 'gpImportDoc' && target.files[0]) {
            const file = target.files[0];
            try {
                if (!/\.(md|txt)$/i.test(file.name) || file.size > 1048576) throw new Error('只支持最大 1 MiB 的 UTF-8 Markdown/TXT');
                const text = new TextDecoder('utf-8', {fatal: true}).decode(await file.arrayBuffer());
                body.querySelector('[name="docTitle"]').value = file.name.replace(/\.(md|txt)$/i, '');
                body.querySelector('[name="docContent"]').value = text; selectedDoc = ''; markDirty();
            } catch (e) { showError(e.message); }
        }
        if (target.dataset.upload && target.files[0]) {
            const file = target.files[0];
            if (file.size > 40 * 1024 * 1024) return showError('图片超过 40 MiB');
            if (busy || !await ask('上传修正版并替换当前选用？旧文件保留。')) return;
            busy = true;
            try {
                const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
                await write(`/assets/${target.dataset.upload}/upload`, 'POST', {contentBase64: encoded});
            } catch (e) { showError(e.message); } finally { busy = false; renderPanel(); }
        }
    });
    window.addEventListener('beforeunload', event => { if (dirty) { remember(); event.preventDefault(); event.returnValue = ''; } });
    document.getElementById('gameProjectToggle')?.addEventListener('click', open);
    window.GamePipeline = {
        projectId: null,
        get project() { return project; },
        async ensureProject() {
            if(project?.canvasId===canvas?.id){if(project.archived)throw new Error('项目已归档');return project;}
            if(busy||dirty)throw new Error('项目正在处理其他操作，请稍后重试');
            busy=true;
            const active=canvas?.id;
            try {
                if(!active)throw new Error('请先打开画布');
                await ensureSavedCanvas();
                const existing=await api(`?canvasId=${encodeURIComponent(active)}`);
                const item=existing.projects.find(p=>!p.archived);
                const result=item?await api('/'+item.id):await api('','POST',{title:canvas.title||'模型资产项目',canvasId:active});
                if(canvas?.id!==active)throw new Error('画布已切换，请回原画布重新导入');
                project=result.project;window.GamePipeline.projectId=project.id;
                const toggle=document.getElementById('gameProjectToggle');if(toggle)toggle.hidden=false;
                return project;
            } finally {busy=false;}
        },
        async workflow(operation) {
            if (!project || project.archived || project.canvasId !== canvas?.id) throw new Error('游戏项目尚未载入，请稍后重试');
            if (busy) throw new Error('项目正在处理其他操作，请稍候');
            if (dirty) throw new Error('请先保存或关闭项目面板中的编辑草稿');
            busy = true;
            const active = canvas.id;
            try {
                return await operation({
                    get project() { return project; },
                    read: async path => {
                        if (canvas?.id !== active) throw new Error('当前画布已切换');
                        const result = await api(`/${project.id}${path}`);
                        if (canvas?.id !== active) throw new Error('当前画布已切换');
                        return result;
                    },
                    write: async (...args) => {
                        if (canvas?.id !== active) throw new Error('当前画布已切换，请重新打开原项目');
                        return write(...args);
                    },
                    bindAsset, generateAsset, syncOutputs, ensureSavedCanvas, ask,
                });
            } finally { busy = false; if (canvas?.id === active) render(); }
        },
        open,
        async canvasLoaded() {
            const canvasId = canvas?.id;
            if (!canvasId) return;
            try {
                const result = await api(`?canvasId=${encodeURIComponent(canvasId)}`);
                const item = result.projects.find(p => !p.archived);
                const loaded = item ? await api('/' + item.id) : null;
                if (canvas?.id !== canvasId || busy || dirty) return;
                project = loaded?.project || null;
                recovery = loaded?.recovery || [];
                window.GamePipeline.projectId = project?.id || null;
                const toggle = document.getElementById('gameProjectToggle');
                if (toggle) toggle.hidden = !(canvas.kind === 'game' || project);
                await window.GameWorkflow?.loaded();
                render();
            } catch (e) { console.warn('项目关联读取失败：', e.message); }
        },
        documentBody(node, target) {
            const doc = node.projectId === project?.id ? project.documents.find(d => d.id === node.docId) : null;
            target.innerHTML = `<strong>${esc(doc?.title || '项目文档')}</strong><p>${esc(doc ? doc.lastSavedContent.slice(0, 180) : '打开项目以载入正文；跨项目引用不可编辑。')}</p><small>${doc ? '版本 ' + doc.revision : ''}</small>${button('open-doc', '编辑正文')}`;
            target.querySelector('button').onclick = async e => {
                e.stopPropagation();
                await open();
                if (node.projectId !== project?.id) return showError('此文档属于其他项目，拒绝跨项目引用');
                tab = 'documents'; selectedDoc = node.docId; renderPanel();
            };
        },
        snapshot(node) {
            if (!node.gameBinding || !node.projectId || !node.assetId) return undefined;
            return {projectId: node.projectId, assetId: node.assetId, assetRevision: node.gameAssetRevision,
                sourceNodeId: node.id, provider: node.apiProvider || '', size: node.customSize || ''};
        },
        result() {
            // 等现有日志/画布保存完成；失败可在面板中显式恢复，不自动重跑生成。
            if (project && !busy && !dirty) setTimeout(() => {
                if (!busy && !dirty) syncOutputs().catch(e => showError('候选登记待恢复：' + e.message));
            }, 500);
        },
    };
    if (typeof canvas !== 'undefined' && canvas) window.GamePipeline.canvasLoaded();
})();
