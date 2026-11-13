/* Generator 节点（generator）：调用图像 API（OpenAI 兼容 / 豆包 / ModelScope 等）出图。
 *
 * 从 canvas.js 的「Generator 与 Video 节点渲染」与「生成源解析与级联执行」两段原样迁出，
 * 未改动业务逻辑。依赖约定见 static/nodes/README.md：
 *   - 状态走 deps：只读 nodes（按 id 找节点）
 *   - 生成源解析（generatorSources / orderedSources / syncGeneratorInputs 等）仍在宿主，直接调用
 */
(() => {
let deps = null;

function getNodes(){ return deps.nodes(); }

function renderGeneratorBody(node){
    const wrap = document.createElement('div');
    wrap.className = 'generator-body';
    const inputSources = generatorSources(node);
    const ordered = orderedSources(node, inputSources);
    const mediaInputs = ordered.filter(src => src.refs?.some(ref => ['image','video','audio'].includes(mediaKindForRef(ref))));
    const promptInputs = ordered.filter(src => src.prompt && !src.refs?.length);
    sanitizeImageNodeProviderModel(node);
    normalizeApiNodeSizeChoice(node);

    // 头部两块列表由宿主共享函数填充（renderPromptPreview / renderImageInputList）
    const head = document.createElement('div');
    head.innerHTML = `
        <div class="prompt-list mb-3"></div>
        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">${tr('canvas.images')}</div>
        <div class="input-list"></div>`;
    wrap.appendChild(head);

    // 设置区结构统一由 NodeControls 生成，业务联动仍留在本节点
    const referenceImages = ordered.flatMap(src => src.refs || []);
    let providerUi, modelUi, resolutionUi, ratioUi, qualityUi, countRow, customRatioRow, customSizeRow, fitBtn;
    const settingsUi = NodeControls.settings();

    const syncQualityControls = () => {
        if(!['auto','low','medium','high'].includes(String(node.quality || 'auto'))) node.quality = 'auto';
        qualityUi.setDisabled(false);
        qualityUi.sync();
    };
    const hydrateCustomParts = () => {
        if((!node.customRatioWidth || !node.customRatioHeight) && node.customRatio) {
            const raw = String(node.customRatio || '');
            if(raw.includes(':')){
                const [w,h] = raw.split(':');
                node.customRatioWidth = node.customRatioWidth || w;
                node.customRatioHeight = node.customRatioHeight || h;
            }
        }
        if((!node.customWidth || !node.customHeight) && node.customSize) {
            const parsed = parseSizeValue(node.customSize);
            node.customWidth = node.customWidth || parsed?.width || '';
            node.customHeight = node.customHeight || parsed?.height || '';
        }
    };
    hydrateCustomParts();
    let sourceRatioRequest = 0;
    const updateSourceRatioFromFirstRef = async () => {
        if(node.ratio !== 'source') return;
        const ref = referenceImages.find(item => item.url);
        const requestId = ++sourceRatioRequest;
        if(!ref){
            node.customRatio = '';
            node.customRatioWidth = '';
            node.customRatioHeight = '';
            ratioW.input.value = '';
            ratioH.input.value = '';
            return;
        }
        try {
            const dims = await getImageDimensions(ref.url);
            if(requestId !== sourceRatioRequest || node.ratio !== 'source') return;
            const parts = ratioPartsFromDimensions(dims.width, dims.height);
            node.customRatioWidth = String(parts.width);
            node.customRatioHeight = String(parts.height);
            node.customRatio = `${parts.width}:${parts.height}`;
            ratioW.input.value = node.customRatioWidth;
            ratioH.input.value = node.customRatioHeight;
            scheduleSave();
        } catch(_) {}
    };
    const syncSizeControls = () => {
        normalizeApiNodeSizeChoice(node);
        const autoOption = resolutionUi.el.querySelector('option[value="auto"]');
        if(autoOption) autoOption.disabled = !isGptImageAutoSizeModel(resolveImageModel(node.model));
        const squareOption = ratioUi.el.querySelector('option[value="square"]');
        if(squareOption){
            squareOption.disabled = false;
            squareOption.title = '';
        }
        resolutionUi.sync();
        ratioUi.sync();
        ratioUi.setDisabled(node.resolution === 'custom' || node.resolution === 'auto');
        customRatioRow.style.display = (node.resolution !== 'auto' && (node.ratio === 'custom' || node.ratio === 'source')) ? 'flex' : 'none';
        customSizeRow.style.display = node.resolution === 'custom' ? 'flex' : 'none';
        ratioW.input.disabled = node.ratio === 'source';
        ratioH.input.disabled = node.ratio === 'source';
        ratioW.input.value = node.customRatioWidth || '';
        ratioH.input.value = node.customRatioHeight || '';
        sizeW.input.value = node.customWidth || '';
        sizeH.input.value = node.customHeight || '';
        if(fitBtn) fitBtn.el.disabled = !referenceImages.some(ref => ref.url);
        syncQualityControls();
        if(node.ratio === 'source') updateSourceRatioFromFirstRef();
    };

    providerUi = NodeControls.select(node, {
        key: 'apiProvider',
        className: 'provider-select',
        options: providerOptions(node.apiProvider),
        onChange: () => {
            const providerModels = providerImageModels(node.apiProvider);
            if(!providerModels.includes(resolveImageModel(node.model))) node.model = providerModels[0] || '';
            node._apiResolutionUserSet = false;
            node.resolution = defaultApiImageResolution(node.model);
            modelUi.setOptions(imageModelOptions(node.model, node.apiProvider));
            syncSizeControls();
        }
    });
    modelUi = NodeControls.select(node, {
        key: 'model',
        className: 'model-select',
        options: imageModelOptions(node.model, node.apiProvider),
        onChange: () => {
            node._apiResolutionUserSet = false;
            if(node.resolution !== 'custom') node.resolution = defaultApiImageResolution(node.model);
            syncSizeControls();
        }
    });
    resolutionUi = NodeControls.select(node, {
        key: 'resolution',
        dataField: 'resolution',
        className: 'resolution compact-select',
        options: `
                    <option value="auto">自动</option>
                    <option value="1k">1K</option>
                    <option value="2k">2K</option>
                    <option value="4k">4K</option>
                    <option value="custom">${tr('canvas.custom')}</option>
                `,
        onChange: () => {
            node._apiResolutionUserSet = true;
            if(node.resolution === 'custom') {
                node.ratio = '';
            } else if(node.resolution === 'auto') {
                if(!node.ratio) node.ratio = 'square';
                node.customSize = '';
                node.customWidth = '';
                node.customHeight = '';
            } else if(!node.ratio) {
                node.ratio = 'square';
                node.customSize = '';
                node.customWidth = '';
                node.customHeight = '';
            } else {
                node.customSize = '';
                node.customWidth = '';
                node.customHeight = '';
            }
            syncSizeControls();
        }
    });
    ratioUi = NodeControls.select(node, {
        key: 'ratio',
        dataField: 'ratio',
        className: 'ratio compact-select',
        options: `
                    <option value="square">1:1</option>
                    <option value="portrait">2:3</option>
                    <option value="landscape">3:2</option>
                    <option value="portrait43">3:4</option>
                    <option value="landscape43">4:3</option>
                    <option value="story">9:16</option>
                    <option value="wide">16:9</option>
                    <option value="ultrawide">21:9</option>
                    <option value="ultratall">9:21</option>
                    <option value="source">${tr('canvas.adaptiveRatio')}</option>
                    <option value="custom">${tr('canvas.custom')}</option>
                `,
        onChange: () => {
            normalizeApiNodeSizeChoice(node);
            if(node.ratio !== 'custom' && node.ratio !== 'source') {
                node.customRatio = '';
                node.customRatioWidth = '';
                node.customRatioHeight = '';
            } else if(node.ratio === 'source') {
                node.customRatio = '';
                node.customRatioWidth = '';
                node.customRatioHeight = '';
            }
            syncSizeControls();
        }
    });
    qualityUi = NodeControls.select(node, {
        key: 'quality',
        className: 'quality-select',
        options: `
                    <option value="auto">Q auto</option>
                    <option value="low">Q low</option>
                    <option value="medium">Q med</option>
                    <option value="high">Q high</option>
                `
    });

    const ratioW = NodeControls.numberField({
        title: tr('canvas.ratioWidth'),
        className: 'custom-ratio-w-input',
        placeholder: '4',
        value: node.customRatioWidth || '',
        onInput: value => {
            node.customRatioWidth = value;
            node.customRatioHeight = ratioH.input.value;
            node.customRatio = node.customRatioWidth && node.customRatioHeight ? `${node.customRatioWidth}:${node.customRatioHeight}` : '';
            node.ratio = 'custom';
            syncSizeControls();
            scheduleSave();
        }
    });
    const ratioH = NodeControls.numberField({
        title: tr('canvas.ratioHeight'),
        className: 'custom-ratio-h-input',
        placeholder: '3',
        value: node.customRatioHeight || '',
        onInput: value => {
            node.customRatioHeight = value;
            node.customRatioWidth = ratioW.input.value;
            node.customRatio = node.customRatioWidth && node.customRatioHeight ? `${node.customRatioWidth}:${node.customRatioHeight}` : '';
            node.ratio = 'custom';
            syncSizeControls();
            scheduleSave();
        }
    });
    customRatioRow = NodeControls.row([ratioW, ratioH], { className: 'custom-ratio-row', hidden: true });

    const sizeW = NodeControls.numberField({
        title: tr('canvas.width'),
        className: 'custom-w-input',
        placeholder: 'Auto',
        min: 64,
        step: 64,
        value: node.customWidth || '',
        onInput: value => {
            node.customWidth = value;
            node.customHeight = sizeH.input.value;
            node.customSize = node.customWidth && node.customHeight ? `${node.customWidth}x${node.customHeight}` : '';
            node.resolution = 'custom';
            node._apiResolutionUserSet = true;
            node.ratio = '';
            syncSizeControls();
            scheduleSave();
        }
    });
    const sizeH = NodeControls.numberField({
        title: tr('canvas.height'),
        className: 'custom-h-input',
        placeholder: 'Auto',
        min: 64,
        step: 64,
        value: node.customHeight || '',
        onInput: value => {
            node.customHeight = value;
            node.customWidth = sizeW.input.value;
            node.customSize = node.customWidth && node.customHeight ? `${node.customWidth}x${node.customHeight}` : '';
            node.resolution = 'custom';
            node._apiResolutionUserSet = true;
            node.ratio = '';
            syncSizeControls();
            scheduleSave();
        }
    });
    fitBtn = NodeControls.ghostButton({
        label: tr('canvas.fitImageSize'),
        className: 'fit-size-btn',
        onClick: async () => {
            const ref = referenceImages.find(item => item.url);
            if(!ref) return;
            try {
                const dims = await getImageDimensions(ref.url);
                node.customWidth = dims.width;
                node.customHeight = dims.height;
                node.customSize = `${dims.width}x${dims.height}`;
                node.resolution = 'custom';
                node._apiResolutionUserSet = true;
                node.ratio = '';
                syncSizeControls();
                scheduleSave();
            } catch(err) {
                showErrorModal(tr('canvas.imageReadFailed'));
            }
        }
    });
    customSizeRow = NodeControls.row([sizeW, sizeH, fitBtn], { className: 'custom-size-row', hidden: true });

    countRow = document.createElement('div');
    countRow.className = 'gen-count-row';
    countRow.appendChild(NodeControls.stepper(node, {
        key: 'count',
        min: 1,
        max: 8,
        decreaseTitle: tr('canvas.decrease'),
        decreaseLabel: tr('canvas.decreaseCount'),
        increaseTitle: tr('canvas.increase'),
        increaseLabel: tr('canvas.increaseCount')
    }).el);

    settingsUi.append(NodeControls.row([providerUi, modelUi]));
    settingsUi.append(NodeControls.row([resolutionUi, ratioUi, qualityUi, countRow]));
    settingsUi.append(customRatioRow);
    settingsUi.append(customSizeRow);
    wrap.appendChild(settingsUi.el);

    wrap.appendChild(NodeControls.runBar(node, {
        icon: 'zap',
        label: () => tr('canvas.apiGenerate'),
        runningLabel: () => tr('canvas.generating'),
        extra: cascadeBtnHtml(node),
        onRun: () => runCanvasGenerate(node.id)
    }).el);
    const retry = document.createElement('div');
    retry.innerHTML = retryBarHtml(node);
    wrap.appendChild(retry);

    syncSizeControls();
    renderImageInputList(wrap.querySelector('.input-list'), node, mediaInputs);
    renderPromptPreview(wrap.querySelector('.prompt-list'), promptInputs);
    bindCascadeButtons(wrap, node.id);
    return wrap;
}

async function runGenerator(genId, opts={}){
    const gen = getNodes().find(n => n.id === genId);
    if(!gen || (gen.running && !opts.cascade)) return;
    const cascadeTargetId = cascadeTargetIdFromOptions(opts);
    const sources = orderedSources(gen, generatorSources(gen));
    const prompt = sources.map(s => s.prompt).filter(Boolean).join('\n\n');
    const refs = imageRefsOnly(sources.flatMap(s => s.refs || []));
    if(!prompt && !refs.length){ alert(tr('canvas.needPromptOrImage')); return; }
    const count = Math.max(1, Math.min(8, Number(gen.count || 1)));
    let out = outputForNode(gen, 460);
    const run = runSnapshot(gen, prompt || 'Edit the reference images.', refs);
    const payload = {
        prompt: prompt || 'Edit the reference images.',
        provider_id:resolveImageProviderId(gen.apiProvider || 'comfly'),
        model:resolveImageModel(gen.model),
        size:await generatorSizeForRun(gen, refs),
        aspect_ratio:gen.ratio === 'custom' ? (gen.customRatio || '') : (gen.ratio || ''),
        resolution:gen.resolution || '',
        reference_images:refs.slice(0, CANVAS_REFERENCE_IMAGE_MAX)
    };
    const quality = normalizedImageQuality(gen.quality);
    if(quality) payload.quality = quality;
    if(run.gameProject) run.gameProject.parameters = {
        prompt:payload.prompt, model:payload.model, provider:payload.provider_id,
        size:payload.size, references:payload.reference_images.map(ref => ref.url),
        quality:payload.quality || '', aspectRatio:payload.aspect_ratio || '', resolution:payload.resolution || ''
    };
    let pendingIds = [];
    const startedAt = nowMs();
    if(!opts.cascade){
        gen.running = true;
        refreshRunNodes(gen, out);
        // API 支持并发：2s 后即可再次点击，任务仍由 pending 卡片继续追踪
        setTimeout(() => { gen.running = false; refreshRunNodes(gen, out); }, 2000);
    }
    try {
        const taskInfos = await Promise.all(Array.from({length:count}, () => createCanvasImageTask(payload, {cascadeTargetId})));
        if(!out){
            let outputs = [];
            for(const task of taskInfos){
                const result = await waitCanvasImageTaskResult(task.task_id, {cascadeTargetId});
                outputs.push(...(result.images || []));
                run.request = requestMetaFromResult(result);
            }
            if(!outputs.length) throw new Error(tr('canvas.generationFailed'));
            mergeGeneratedOutputs(gen, outputs, Boolean(opts.cascade));
            addGenerationLog({run, outputs, runMs:nowMs() - startedAt});
            gen.runStatus = 'done';
            gen.runError = '';
            gen.running = false;
            refreshRunNodes(gen, out);
            scheduleSave();
            return;
        }
        pendingIds = taskInfos.map(() => uid('p'));
        if(out) out._pending = [
            ...(out._pending || []),
            ...taskInfos.map((task, index) => makePendingForRun(pendingIds[index], run, gen, {refs, requestSize:payload.size, cascadeTargetId}, {
                canvasTaskId:task.task_id,
                canvasTaskType:'online-image',
                providerId:payload.provider_id,
                model:payload.model,
                appendGenerated:Boolean(opts.cascade)
            }))
        ];
        refreshRunNodes(gen, out);
        scheduleSave();
        await saveCanvas();
        const statuses = await Promise.all(taskInfos.map(task => pollCanvasImageTask(task.task_id, {cascadeTargetId})));
        if(statuses.includes('aborted')) throw cascadeAbortError(cascadeStopMessage());
        if(statuses.includes('failed')) throw new Error(gen.runError || tr('canvas.generationFailed'));
    } catch(err) {
        const remainingPending = pendingIds.map(id => pendingById(out, id)).filter(Boolean);
        const removableIds = remainingPending.filter(p => !(p.failed && p.recoverTaskId)).map(p => p.id);
        if(removableIds.length){
            const metas = collectRunMetas(out, removableIds);
            addGenerationLog({run, outputs:[], runMs:Math.max(...metas.map(m => m.runMs || 0), 0), error:err.message || String(err)});
            if(out) out._pending = (out._pending||[]).filter(p => !removableIds.includes(p.id));
        }
        if(isCascadeAbortError(err)){
            gen.running = false;
            refreshRunNodes(gen, out);
            scheduleSave();
            throw err;
        }
        gen.runStatus = 'failed'; gen.runError = err.message || String(err);
        gen.running = false;
        refreshRunNodes(gen, out);
        scheduleSave();
        if(remainingPending.some(p => p.failed && p.recoverTaskId) && !removableIds.length) return;
        if(opts.cascade) throw err;
        showErrorModal(err.message || tr('canvas.generationFailed'), tr('canvas.apiFailed'));
    }
}

async function runGeneratorLegacy(genId, opts={}){
    const gen = getNodes().find(n => n.id === genId);
    if(!gen || (gen.running && !opts.cascade)) return;
    const sources = orderedSources(gen, generatorSources(gen));
    const prompt = sources.map(s => s.prompt).filter(Boolean).join('\n\n');
    const refs = imageRefsOnly(sources.flatMap(s => s.refs || []));
    if(!prompt && !refs.length){ alert(tr('canvas.needPromptOrImage')); return; }
    const count = Math.max(1, Math.min(8, Number(gen.count || 1)));
    let out = outputForNode(gen, 460);
    const pendingIds = Array.from({length:count}, () => uid('p'));
    const run = runSnapshot(gen, prompt || 'Edit the reference images.', refs);
    const requestSize = await generatorSizeForRun(gen, refs);
    if(out) out._pending = [...(out._pending||[]), ...pendingIds.map(id => makePendingForRun(id, run, gen, {refs, requestSize}))];
    if(!opts.cascade){
        gen.running = true;
        refreshRunNodes(gen, out);
        setTimeout(() => { gen.running = false; refreshRunNodes(gen, out); }, 2000);
    }
    else refreshRunNodes(gen, out);
    try {
        const payload = {
            prompt: prompt || 'Edit the reference images.',
            provider_id:resolveImageProviderId(gen.apiProvider || 'comfly'),
            model:resolveImageModel(gen.model),
            size:requestSize,
            reference_images:refs.slice(0, CANVAS_REFERENCE_IMAGE_MAX)
        };
        const quality = normalizedImageQuality(gen.quality);
        if(quality) payload.quality = quality;
        const results = await Promise.all(Array.from({length:count}, () => fetch('/api/online-image', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(payload)
        }).then(async r => { if(!r.ok) throw new Error(await responseErrorMessage(r, tr('canvas.generationFailed'))); return r.json(); })));
        const images = results.flatMap(result => result.images || []);
        const metas = collectRunMetas(out, pendingIds);
        run.request = results[0] ? requestMetaFromResult(results[0]) : {};
        if(out) out._pending = (out._pending||[]).filter(p => !pendingIds.includes(p.id));
        appendOutputImages(out, images, refs[0], metas);
        mergeGeneratedOutputs(gen, images, Boolean(opts.cascade));
        addGenerationLog({run, outputs:images, runMs:Math.max(...metas.map(m => m.runMs || 0), 0)});
        gen.runStatus = 'done'; gen.runError = '';
        refreshRunNodes(gen, out);
        scheduleSave();
    } catch(err) {
        const metas = collectRunMetas(out, pendingIds);
        addGenerationLog({run, outputs:[], runMs:Math.max(...metas.map(m => m.runMs || 0), 0), error:err.message || String(err)});
        if(out) out._pending = (out._pending||[]).filter(p => !pendingIds.includes(p.id));
        gen.runStatus = 'failed'; gen.runError = err.message || String(err);
        refreshRunNodes(gen, out);
        if(opts.cascade) throw err;
        showErrorModal(err.message || tr('canvas.generationFailed'), tr('canvas.apiFailed'));
    }
}

window.GeneratorNode = {
    type: 'generator',
    title: '图像生成',
    init(next){ deps = next; },
    body: renderGeneratorBody,
    run: runGenerator,
    runLegacy: runGeneratorLegacy,
};
})();
