/* Video 节点（video）：调用视频生成 API，产物走输出节点。
 *
 * 从 canvas.js 的「Generator 与 Video 节点渲染」与「生成源解析与级联执行」两段原样迁出，
 * 未改动业务逻辑。
 */
(() => {
let deps = null;

function getNodes(){ return deps.nodes(); }

function renderVideoBody(node){
    const wrap = document.createElement('div');
    wrap.className = 'generator-body';
    const inputSources = generatorSources(node);
    const ordered = orderedSources(node, inputSources);
    const mediaInputs = ordered.filter(src => src.refs?.some(ref => ['image','video','audio'].includes(mediaKindForRef(ref))));
    const promptInputs = ordered.filter(src => src.prompt && !src.refs?.length);
    sanitizeVideoNodeProviderModel(node);
    node.model = node.model || 'veo3-fast';

    const head = document.createElement('div');
    head.innerHTML = `
        <div class="prompt-list mb-3"></div>
        <div class="video-input-head">
            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Media</div>
            <div class="video-input-actions">
                <button type="button" class="tool-btn" data-video-manual-url title="手动输入视频 URL"><i data-lucide="link" class="w-4 h-4"></i><span>输入网址</span></button>
                <button type="button" class="tool-btn" data-video-temp-sh ${node.tempShUploading ? 'disabled' : ''} title="上传当前输入视频到云端直链"><i data-lucide="upload-cloud" class="w-4 h-4"></i><span>${node.tempShUploading ? '上传中...' : '上传云端'}</span></button>
            </div>
        </div>
        <div class="input-list video-img-list"></div>`;
    wrap.appendChild(head);

    const settingsUi = NodeControls.settings();
    let modelUi;
    const providerUi = NodeControls.select(node, {
        key: 'apiProvider',
        className: 'video-provider',
        style: 'flex:1',
        options: videoProviderOptions(node.apiProvider),
        onChange: () => {
            const models = providerVideoModels(node.apiProvider);
            if(!models.includes(node.model)) node.model = models[0] || node.model;
            modelUi.setOptions(videoModelOptions(node.model, node.apiProvider));
        }
    });
    modelUi = NodeControls.select(node, {
        key: 'model',
        className: 'video-model',
        style: 'flex:2',
        options: videoModelOptions(node.model, node.apiProvider)
    });

    const duration = NodeControls.numberField({
        title: tr('canvas.videoDuration'),
        className: 'video-duration',
        min: 1,
        max: 60,
        step: 1,
        value: Number(node.duration || 5),
        onInput: value => {
            node.duration = Math.max(1, Math.min(60, Number(value || 5)));
            scheduleSave();
        },
        onBlur: () => { duration.input.value = String(Math.max(1, Math.min(60, Number(node.duration || 5)))); }
    });

    const aspectUi = NodeControls.select(node, {
        key: 'aspectRatio',
        fallback: '16:9',
        className: 'video-aspect compact-select',
        options: `
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                        <option value="1:1">1:1</option>
                        <option value="4:3">4:3</option>
                        <option value="3:4">3:4</option>
                        <option value="21:9">21:9</option>
                        <option value="9:21">9:21</option>
                        <option value="keep_ratio">keep</option>
                        <option value="adaptive">adapt</option>
                    `
    });
    const resolutionUi = NodeControls.select(node, {
        key: 'resolution',
        className: 'video-resolution compact-select',
        options: `
                        <option value="">Auto</option>
                        <option value="480p">480p</option>
                        <option value="720p">720p</option>
                        <option value="1080p">1080p</option>
                        <option value="780P">780P</option>
                    `
    });

    settingsUi.append(NodeControls.row([providerUi, modelUi]));
    settingsUi.append(NodeControls.row([
        duration,
        NodeControls.labeled(tr('canvas.videoAspect'), aspectUi),
        NodeControls.labeled(tr('canvas.videoResolution'), resolutionUi)
    ]));
    settingsUi.append(NodeControls.togglePills(node, [
        { key: 'enhancePrompt', label: tr('canvas.videoEnhancePrompt') },
        { key: 'enableUpsample', label: tr('canvas.videoUpsample') },
        { key: 'watermark', label: tr('canvas.videoWatermark') },
        { key: 'cameraFixed', label: tr('canvas.videoCameraFixed') },
        { key: 'generateAudio', label: tr('canvas.videoGenerateAudio') },
        { key: 'multimodal', label: tr('canvas.videoMultimodal') },
        { key: 'useFrameRoles', label: tr('canvas.videoFirstLastFrames') }
    ], {
        onToggle: (key, value) => {
            if(key === 'multimodal' && value) node.useFrameRoles = false;
            if(key === 'useFrameRoles' && value) node.multimodal = false;
        },
        rerender: () => render()
    }));
    wrap.appendChild(settingsUi.el);

    wrap.appendChild(NodeControls.runBar(node, {
        icon: 'clapperboard',
        label: () => tr('canvas.videoGenerate'),
        runningLabel: () => tr('canvas.generating'),
        extra: cascadeBtnHtml(node),
        onRun: () => runCanvasGenerate(node.id)
    }).el);
    const retry = document.createElement('div');
    retry.innerHTML = retryBarHtml(node);
    wrap.appendChild(retry);

    wrap.querySelectorAll('[data-video-temp-sh]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = async e => {
            e.stopPropagation();
            try {
                await uploadCanvasVideosToCloud(node.id);
            } catch(err) {
                showErrorModal(err.message || '云端上传失败', '上传云端');
            }
        };
    });
    wrap.querySelectorAll('[data-video-manual-url]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = async e => {
            e.stopPropagation();
            try {
                await setCanvasManualVideoUrl(node.id);
            } catch(err) {
                showErrorModal(err.message || '设置视频网址失败', '输入网址');
            }
        };
    });
    renderVideoImageInputs(wrap.querySelector('.video-img-list'), node, mediaInputs);
    renderPromptPreview(wrap.querySelector('.prompt-list'), promptInputs);
    bindCascadeButtons(wrap, node.id);
    return wrap;
}

async function runVideoNode(nodeId, opts={}){
    const node = getNodes().find(n => n.id === nodeId);
    if(!node || (node.running && !opts.cascade)) return;
    const cascadeTargetId = cascadeTargetIdFromOptions(opts);
    const sources = orderedSources(node, generatorSources(node));
    const prompt = sources.map(s => s.prompt).filter(Boolean).join('\n\n');
    const allRefs = sources.flatMap(s => s.refs || []);
    const mediaRefs = applyUploadedUrlToRefs((allRefs || []).filter(ref => ['image','video','audio'].includes(mediaKindForRef(ref))), node);
    const refs = imageRefsOnly(mediaRefs);
    const videoRefs = videoRefsOnly(mediaRefs);
    const audioRefs = audioRefsOnly(mediaRefs);
    if(node.useFrameRoles && refs[0]) refs[0] = {...refs[0], role:'first_frame'};
    if(node.useFrameRoles && refs[1]) refs[1] = {...refs[1], role:'last_frame'};
    if(!prompt){ alert(tr('canvas.videoNeedsPrompt')); return; }
    let out = outputForNode(node, 460);
    const pendingId = uid('p');
    const run = runSnapshot(node, prompt, refs);
    if(out) out._pending = [...(out._pending || []), makePendingForRun(pendingId, run, node, {refs, cascadeTargetId})];
    if(!opts.cascade){ node.running = true; refreshRunNodes(node, out); }
    else refreshRunNodes(node, out);
    try {
        const result = await cascadeFetch('/api/canvas-video', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                prompt,
                provider_id:resolveVideoProviderId(node.apiProvider || 'comfly'),
                model:node.model || 'veo3-fast',
                duration:Number(node.duration || 5),
                aspect_ratio:node.aspectRatio || '16:9',
                resolution:node.resolution || '',
                images:refs,
                videos:manualVideoUrlForNode(node)
                    ? [manualVideoUrlForNode(node)]
                    : videoRefs.map(ref => tempShUploadedUrlForNode(node, ref.url)),
                audios:audioRefs.map(ref => ref.url).filter(Boolean),
                enhance_prompt:Boolean(node.enhancePrompt),
                enable_upsample:Boolean(node.enableUpsample),
                watermark:Boolean(node.watermark),
                camerafixed:Boolean(node.cameraFixed),
                generate_audio:Boolean(node.generateAudio),
                multimodal:Boolean(node.multimodal)
            })
        }, {cascadeTargetId}).then(async r => { if(!r.ok) throw new Error(await responseErrorMessage(r, tr('canvas.videoFailed'))); return r.json(); });
        const meta = collectRunMeta(out, pendingId);
        if(out) out._pending = (out._pending || []).filter(p => p.id !== pendingId);
        const outputUrls = resultMediaUrls(result).map(item => {
            const url = outputUrlValue(item);
            return item && typeof item === 'object' ? {...item, url, kind:item.kind || 'video'} : {url, kind:'video'};
        }).filter(item => item.url);
        if(!outputUrls.length) throw new Error(tr('canvas.videoFailed'));
        run.request = requestMetaFromResult(result);
        appendOutputImages(out, outputUrls, refs[0], [{...meta, kind:'video'}]);
        mergeGeneratedOutputs(node, outputUrls, Boolean(opts.cascade));
        addGenerationLog({run, outputs:outputUrls, runMs:meta.runMs || 0});
        node.runStatus = 'done'; node.runError = '';
        refreshRunNodes(node, out);
        scheduleSave();
    } catch(err) {
        const meta = collectRunMeta(out, pendingId);
        addGenerationLog({run, outputs:[], runMs:meta.runMs || 0, error:err.message || String(err)});
        if(out) out._pending = (out._pending || []).filter(p => p.id !== pendingId);
        if(isCascadeAbortError(err)){
            if(opts.cascade) throw err;
            return;
        }
        node.runStatus = 'failed'; node.runError = err.message || String(err);
        refreshRunNodes(node, out);
        if(opts.cascade) throw err;
        alert(err.message || tr('canvas.videoFailed'));
    } finally {
        node.running = false;
        refreshRunNodes(node, out);
    }
}

window.VideoNode = {
    type: 'video',
    title: '视频生成',
    init(next){ deps = next; },
    body: renderVideoBody,
    run: runVideoNode,
};
})();
