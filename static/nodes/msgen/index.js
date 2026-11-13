/* MsGen 多段生图节点（msgen）：ModelScope / 魔搭上的 Z-Image、Qwen-Image-Edit 等模型。
 *
 * 从 canvas.js 的「09 · MsGen 多段生图节点」「10 · MsGen 执行与节点创建」两段原样迁出，
 * 未改动业务逻辑。依赖约定见 static/nodes/README.md：
 *   - 画布状态必须走 deps（本节点只用到 nodes，用于按 id 找节点）
 *   - 工具函数与常量（MS_GEN_MODELS / modelscopeImageModels / cascadeBtnHtml / scheduleSave 等）
 *     都是 canvas.js 顶层的 function 声明或 const，classic script 之间互相可见，直接调用即可
 */
(() => {
let deps = null;

function getNodes(){ return deps.nodes(); }

function renderMsGenBody(node){
    const wrap = document.createElement('div');
    wrap.className = 'generator-body';
    const modelKey = node.msgenModel || 'zimage';
    const msModel = MS_GEN_MODELS[modelKey] || MS_GEN_MODELS.zimage;
    const inputSources = generatorSources(node);
    const ordered = orderedSources(node, inputSources);
    const mediaInputs = ordered.filter(src => src.refs?.some(ref => ['image','video','audio'].includes(mediaKindForRef(ref))));
    const promptInputs = ordered.filter(src => src.prompt && !src.refs?.length);
    const referenceImages = ordered.flatMap(src => src.refs || []);
    const isCustomMs = modelKey === 'custom';
    const msUsesImages = Boolean(msModel.supportsImage || msModel.acceptsImage);
    node.msCustomModel = node.msCustomModel || modelscopeImageModels()[0] || 'Tongyi-MAI/Z-Image-Turbo';
    const msModelId = currentMsModelId(modelKey, node);
    const msLoras = modelscopeLorasForModel(msModelId);
    const selectedMsLora = msLoras.find(lora => String(lora.id || '').trim() === String(node.msLoraId || '').trim()) || msLoras[0];
    const loraEnabled = Boolean(node.msLoraEnabled);
    const loraStrength = node.msLoraStrength ?? Number(selectedMsLora?.strength ?? 0.8);

    // 模型切换标签是本节点独有结构，保留手写
    const tabs = document.createElement('div');
    tabs.className = 'ms-model-tabs';
    tabs.innerHTML = Object.entries(MS_GEN_MODELS).map(([k,m]) =>
        `<button type="button" data-model="${k}" class="${modelKey===k?'active':''}">${escapeHtml(m.labelKey ? tr(m.labelKey) : m.label)}</button>`
    ).join('');
    wrap.appendChild(tabs);
    tabs.querySelectorAll('button').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            if(node.msgenModel !== btn.dataset.model){
                node.msLoraId = '';
                delete node.msLoraStrength;
                node.msLoraEnabled = false;
            }
            node.msgenModel = btn.dataset.model;
            render();
            scheduleSave();
        };
    });

    const content = document.createElement('div');
    content.className = 'ms-content';
    content.innerHTML = `
            <div class="prompt-list mt-2 mb-2"></div>
            ${msUsesImages ? `
            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">${tr('canvas.images')}</div>
            <div class="input-list ms-img-list"></div>
            ` : ''}`;
    wrap.appendChild(content);

    const controls = document.createElement('div');
    controls.className = 'ms-controls';
    const settingsUi = NodeControls.settings();

    let resolutionUi, ratioUi, customRatioRow, customSizeRow, fitBtn;
    const syncMsCustomSizeControls = () => {
        resolutionUi.sync();
        ratioUi.sync();
        ratioUi.setDisabled(node.msResolution === 'custom');
        customRatioRow.style.display = node.msRatio === 'custom' ? 'flex' : 'none';
        customSizeRow.style.display = node.msResolution === 'custom' ? 'flex' : 'none';
        ratioW.input.value = node.msCustomRatioWidth || '';
        ratioH.input.value = node.msCustomRatioHeight || '';
        sizeW.input.value = node.msCustomWidth || '';
        sizeH.input.value = node.msCustomHeight || '';
        if(fitBtn) fitBtn.el.disabled = !referenceImages.some(ref => ref.url);
    };

    if((!node.msCustomRatioWidth || !node.msCustomRatioHeight) && node.msCustomRatio) {
        const raw = String(node.msCustomRatio || '');
        if(raw.includes(':')){
            const [w,h] = raw.split(':');
            node.msCustomRatioWidth = node.msCustomRatioWidth || w;
            node.msCustomRatioHeight = node.msCustomRatioHeight || h;
        }
    }
    if((!node.msCustomWidth || !node.msCustomHeight) && node.msCustomSize) {
        const parsed = parseSizeValue(node.msCustomSize);
        node.msCustomWidth = node.msCustomWidth || parsed?.width || '';
        node.msCustomHeight = node.msCustomHeight || parsed?.height || '';
    }

    if(isCustomMs){
        settingsUi.append(NodeControls.row([NodeControls.select(node, {
            key: 'msCustomModel',
            className: 'ms-custom-model-select',
            options: modelscopeImageModelOptions(node.msCustomModel),
            onChange: () => {
                node.msLoraId = '';
                delete node.msLoraStrength;
                node.msLoraEnabled = false;
                scheduleSave();
                render();
            }
        })]));
    }

    resolutionUi = NodeControls.select(node, {
        key: 'msResolution',
        dataField: 'msResolution',
        className: 'resolution compact-select',
        options: `
                        <option value="1k">1K</option>
                        <option value="2k">2K</option>
                        <option value="4k">4K</option>
                    <option value="custom">${tr('canvas.custom')}</option>
                `,
        onChange: () => {
            if(node.msResolution === 'custom') {
                node.msRatio = '';
            } else if(!node.msRatio) {
                node.msRatio = 'square';
                node.msCustomSize = '';
                node.msCustomWidth = '';
                node.msCustomHeight = '';
            } else {
                node.msCustomSize = '';
                node.msCustomWidth = '';
                node.msCustomHeight = '';
            }
            syncMsCustomSizeControls();
        }
    });
    ratioUi = NodeControls.select(node, {
        key: 'msRatio',
        dataField: 'msRatio',
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
                        <option value="custom">${tr('canvas.custom')}</option>
                    `,
        onChange: () => {
            if(node.msRatio !== 'custom') {
                node.msCustomRatio = '';
                node.msCustomRatioWidth = '';
                node.msCustomRatioHeight = '';
            }
            syncMsCustomSizeControls();
        }
    });
    const countRow = document.createElement('div');
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

    const ratioW = NodeControls.numberField({
        title: tr('canvas.ratioWidth'),
        className: 'ms-custom-ratio-w-input',
        placeholder: '4',
        value: node.msCustomRatioWidth || '',
        onInput: () => {
            node.msCustomRatioWidth = ratioW.input.value;
            node.msCustomRatioHeight = ratioH.input.value;
            node.msCustomRatio = node.msCustomRatioWidth && node.msCustomRatioHeight ? `${node.msCustomRatioWidth}:${node.msCustomRatioHeight}` : '';
            node.msRatio = 'custom';
            syncMsCustomSizeControls();
            scheduleSave();
        }
    });
    const ratioH = NodeControls.numberField({
        title: tr('canvas.ratioHeight'),
        className: 'ms-custom-ratio-h-input',
        placeholder: '3',
        value: node.msCustomRatioHeight || '',
        onInput: () => {
            node.msCustomRatioWidth = ratioW.input.value;
            node.msCustomRatioHeight = ratioH.input.value;
            node.msCustomRatio = node.msCustomRatioWidth && node.msCustomRatioHeight ? `${node.msCustomRatioWidth}:${node.msCustomRatioHeight}` : '';
            node.msRatio = 'custom';
            syncMsCustomSizeControls();
            scheduleSave();
        }
    });
    customRatioRow = NodeControls.row([ratioW, ratioH], { className: 'ms-custom-ratio-row', hidden: true });

    const sizeW = NodeControls.numberField({
        title: tr('canvas.width'),
        className: 'ms-custom-w-input',
        placeholder: 'Auto',
        min: 64,
        step: 64,
        value: node.msCustomWidth || '',
        onInput: () => {
            node.msCustomWidth = sizeW.input.value;
            node.msCustomHeight = sizeH.input.value;
            node.msCustomSize = node.msCustomWidth && node.msCustomHeight ? `${node.msCustomWidth}x${node.msCustomHeight}` : '';
            node.msResolution = 'custom';
            node.msRatio = '';
            syncMsCustomSizeControls();
            scheduleSave();
        }
    });
    const sizeH = NodeControls.numberField({
        title: tr('canvas.height'),
        className: 'ms-custom-h-input',
        placeholder: 'Auto',
        min: 64,
        step: 64,
        value: node.msCustomHeight || '',
        onInput: () => {
            node.msCustomWidth = sizeW.input.value;
            node.msCustomHeight = sizeH.input.value;
            node.msCustomSize = node.msCustomWidth && node.msCustomHeight ? `${node.msCustomWidth}x${node.msCustomHeight}` : '';
            node.msResolution = 'custom';
            node.msRatio = '';
            syncMsCustomSizeControls();
            scheduleSave();
        }
    });
    fitBtn = NodeControls.ghostButton({
        label: tr('canvas.fitImageSize'),
        className: 'ms-fit-size-btn',
        onClick: async () => {
            const ref = referenceImages.find(item => item.url);
            if(!ref) return;
            try {
                const dims = await getImageDimensions(ref.url);
                node.msCustomWidth = dims.width;
                node.msCustomHeight = dims.height;
                node.msCustomSize = `${dims.width}x${dims.height}`;
                node.msResolution = 'custom';
                node.msRatio = '';
                syncMsCustomSizeControls();
                scheduleSave();
            } catch(err) {
                showErrorModal(tr('canvas.imageReadFailed'));
            }
        }
    });
    customSizeRow = NodeControls.row([sizeW, sizeH, fitBtn], { className: 'ms-custom-size-row', hidden: true });

    settingsUi.append(NodeControls.row([resolutionUi, ratioUi, countRow]));
    settingsUi.append(customRatioRow);
    settingsUi.append(customSizeRow);

    // LoRA 区块（仅部分模型有），结构与交互保持原样
    const loraHtml = `
                ${msLoras.length ? `
                <div class="gen-settings-row">
                    <label class="setting-check" style="cursor:pointer">
                        <input type="checkbox" class="ms-lora-check" ${node.msLoraEnabled ? 'checked' : ''}>
                        <span style="font-size:11px;font-weight:700">${tr('canvas.enableLora')}</span>
                    </label>
                </div>
                ${node.msLoraEnabled ? `
                <div class="gen-settings-row">
                    <label class="field" style="flex:1">
                        <div class="setting-title">LoRA</div>
                        <select class="select-lite ms-lora-select">${modelscopeLoraOptions(msLoras, String(selectedMsLora?.id || '').trim())}</select>
                    </label>
                </div>
                <div class="gen-settings-row">
                    <label class="field" style="flex:1">
                        <div class="setting-title" style="display:flex;justify-content:space-between">
                            <span>${tr('canvas.loraStrength')}</span><span class="ms-lora-strength-val">${loraStrength.toFixed(2)}</span>
                        </div>
                        <input type="range" class="canvas-range ms-lora-strength-slider" min="0.1" max="1.0" step="0.05" value="${loraStrength}">
                    </label>
                </div>` : ''}` : ''}
                ${!msLoras.length ? `<div class="gen-settings-row"><div style="color:var(--faint);font-size:11px;font-weight:700;line-height:1.45">${tr('canvas.noLoraForModel')}</div></div>` : ''}`;
    const loraHost = document.createElement('div');
    loraHost.innerHTML = loraHtml;
    Array.from(loraHost.children).forEach(child => settingsUi.el.appendChild(child));

    controls.appendChild(settingsUi.el);
    controls.appendChild(NodeControls.runBar(node, {
        icon: 'zap',
        label: () => tr('canvas.msGenerate'),
        runningLabel: () => tr('canvas.generating'),
        extra: cascadeBtnHtml(node),
        onRun: () => runCanvasGenerate(node.id)
    }).el);
    const retry = document.createElement('div');
    retry.innerHTML = retryBarHtml(node);
    controls.appendChild(retry);
    wrap.appendChild(controls);

    syncMsCustomSizeControls();

    const msLoraCheck = wrap.querySelector('.ms-lora-check');
    if(msLoraCheck){
        msLoraCheck.onchange = e => {
            node.msLoraEnabled = e.target.checked;
            if(node.msLoraEnabled && !node.msLoraId && msLoras[0]){
                node.msLoraId = String(msLoras[0].id || '').trim();
                node.msLoraStrength = Number(msLoras[0].strength ?? 0.8);
            }
            scheduleSave();
            render();
        };
    }
    const msLoraSelect = wrap.querySelector('.ms-lora-select');
    if(msLoraSelect){
        NodeControls.stop(msLoraSelect);
        msLoraSelect.onchange = e => {
            e.stopPropagation();
            node.msLoraId = e.target.value;
            const picked = msLoras.find(lora => String(lora.id || '').trim() === node.msLoraId);
            node.msLoraStrength = Number(picked?.strength ?? node.msLoraStrength ?? 0.8);
            scheduleSave();
            render();
        };
    }
    const msLoraSlider = wrap.querySelector('.ms-lora-strength-slider');
    if(msLoraSlider){
        NodeControls.stop(msLoraSlider);
        msLoraSlider.oninput = e => {
            node.msLoraStrength = parseFloat(e.target.value);
            const val = wrap.querySelector('.ms-lora-strength-val');
            if(val) val.textContent = node.msLoraStrength.toFixed(2);
            scheduleSave();
        };
    }
    // 整块 pill 可点（不只是复选框方块）
    wrap.querySelectorAll('.setting-check').forEach(pill => {
        pill.onmousedown = e => e.stopPropagation();
        const cb = pill.querySelector('input[type="checkbox"]');
        if(!cb) return;
        pill.onclick = e => {
            e.stopPropagation();
            e.preventDefault();
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change'));
        };
        cb.onclick = e => e.stopPropagation();
    });
    if(msUsesImages){
        renderImageInputList(wrap.querySelector('.ms-img-list'), node, mediaInputs);
    }
    renderPromptPreview(wrap.querySelector('.prompt-list'), promptInputs);
    bindCascadeButtons(wrap, node.id);
    return wrap;
}

async function runMsGenNode(nodeId, opts={}){
    const node = getNodes().find(n => n.id === nodeId);
    if(!node || (node.running && !opts.cascade)) return;
    const cascadeTargetId = cascadeTargetIdFromOptions(opts);
    const sources = orderedSources(node, generatorSources(node));
    const prompt = sources.map(s => s.prompt).filter(Boolean).join('\n\n');
    const refs = imageRefsOnly(sources.flatMap(s => s.refs || []));
    const modelKey = node.msgenModel || 'zimage';
    const msModel = MS_GEN_MODELS[modelKey] || MS_GEN_MODELS.zimage;
    const msModelId = currentMsModelId(modelKey, node);
    const msLoras = modelscopeLorasForModel(msModelId);
    if(!prompt){ alert(tr('canvas.needPrompt')); return; }
    if(msModel.supportsImage && !refs.length){ alert(tr('canvas.needImage')); return; }
    const count = Math.max(1, Math.min(8, Number(node.count || 1)));
    // 链路中间节点默认不创建 Output；链尾、手动开启或已有 Output 连接时才输出。
    let out = outputForNode(node, 460);
    const pendingIds = Array.from({length:count}, () => uid('p'));
    const run = runSnapshot(node, prompt, refs);
    const size = apiImageSize(node.msRatio ?? 'square', node.msResolution || '1k', node.msCustomRatio || '', node.msCustomSize || '');
    const parsed = parseSizeValue(size);
    let width = Number(parsed?.width) || 1024;
    let height = Number(parsed?.height) || 1024;
    if(!parsed && node.msWidth && node.msHeight){
        width = Number(node.msWidth) || width;
        height = Number(node.msHeight) || height;
    }
    const requestSize = {width, height};
    if(out) out._pending = [...(out._pending || []), ...pendingIds.map(id => makePendingForRun(id, run, node, {refs, requestSize, cascadeTargetId}))];
    if(!opts.cascade){
        node.running = true;
        refreshRunNodes(node, out);
        setTimeout(() => { node.running = false; refreshRunNodes(node, out); }, 2000);
    }
    else refreshRunNodes(node, out);
    try {
        const imageUrls = [];
        if(msModel.supportsImage || msModel.acceptsImage){
            for(const ref of refs.slice(0, CANVAS_REFERENCE_IMAGE_MAX)){
                if(ref.url){
                    try { imageUrls.push(await urlToBase64(ref.url)); }
                    catch(e){ imageUrls.push(ref.url); }
                }
            }
        }
        const submitMs = async () => {
            let apiBody;
            if(modelKey === 'zimage'){
                apiBody = { prompt, model: 'Tongyi-MAI/Z-Image-Turbo', width, height, size: `${width}x${height}`, client_id: CLIENT_ID };
            } else if(modelKey === 'qwen_edit'){
                apiBody = { prompt, model: 'Qwen/Qwen-Image-Edit-2511', image_urls: imageUrls, width, height, size: `${width}x${height}`, client_id: CLIENT_ID };
            } else if(modelKey === 'custom'){
                apiBody = {
                    prompt,
                    model: node.msCustomModel || modelscopeImageModels()[0] || 'Tongyi-MAI/Z-Image-Turbo',
                    image_urls: imageUrls,
                    width,
                    height,
                    size: `${width}x${height}`,
                    client_id: CLIENT_ID
                };
            } else {
                apiBody = { prompt, model: msModel.modelId, image_urls: imageUrls, width, height, size:`${width}x${height}`, client_id: CLIENT_ID };
            }
            if(node.msLoraEnabled){
                const selected = msLoras.find(lora => String(lora.id || '').trim() === String(node.msLoraId || '').trim()) || msLoras[0];
                const loraId = String(selected?.id || node.msLoraId || '').trim();
                if(!loraId) throw new Error(tr('canvas.noLoraBoundError'));
                apiBody.loras = { [loraId]: Number(node.msLoraStrength ?? selected?.strength ?? 0.8) };
            }
            const res = await cascadeFetch(msModel.endpoint, {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify(apiBody)
            }, {cascadeTargetId});
            if(!res.ok) throw new Error(await responseErrorMessage(res, tr('canvas.msFailed')));
            return await res.json();
        };
        const results = await Promise.all(Array.from({length:count}, submitMs));
        const metas = collectRunMetas(out, pendingIds);
        const outputUrls = results.map(data => data.url).filter(Boolean);
        run.request = results[0] ? requestMetaFromResult(results[0]) : {};
        if(out) out._pending = (out._pending || []).filter(p => !pendingIds.includes(p.id));
        appendOutputImages(out, outputUrls, refs[0], metas);
        mergeGeneratedOutputs(node, outputUrls, Boolean(opts.cascade));
        addGenerationLog({run, outputs:outputUrls, runMs:Math.max(...metas.map(m => m.runMs || 0), 0)});
        node.runStatus = 'done'; node.runError = '';
        refreshRunNodes(node, out);
        scheduleSave();
    } catch(err){
        const metas = collectRunMetas(out, pendingIds);
        addGenerationLog({run, outputs:[], runMs:Math.max(...metas.map(m => m.runMs || 0), 0), error:err.message || String(err)});
        if(out) out._pending = (out._pending || []).filter(p => !pendingIds.includes(p.id));
        if(isCascadeAbortError(err)){
            if(opts.cascade) throw err;
            return;
        }
        node.runStatus = 'failed'; node.runError = err.message || String(err);
        refreshRunNodes(node, out);
        if(opts.cascade) throw err;
        alert(err.message || tr('canvas.msFailed'));
    }
}

window.MsGenNode = {
    type: 'msgen',
    title: '多段生图',
    init(next){ deps = next; },
    body: renderMsGenBody,
    run: runMsGenNode,
};
})();
