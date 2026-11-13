/* MiniMax 节点的纯工具函数（无 DOM、无网络、无画布状态）。
 *
 * 从 nodes/minimax/index.js 拆出，按职责分组见 static/nodes/README.md 第十节：
 *   helpers.js     29 个纯工具（不依赖另外两个文件）
 *   runninghub.js  RunningHub 云端工作流（依赖本文件）
 *   index.js       工作台 UI + 节点 body/run（依赖两者）
 *
 * 本文件先加载，通过 window.MiniMaxHelpers 供另外两个文件解构使用。
 */
(() => {

function getNodes(){ return deps.nodes(); }

function getViewport(){ return deps.viewport(); }

function miniMaxActiveSegmentAt(node, time){
    miniMaxEnsureSegment(node);
    const safeTime = Math.max(0, Number(time || 0));
    return (node.segments || []).find(seg => safeTime >= Number(seg.start || 0) && safeTime <= Number(seg.start || 0) + Number(seg.duration || 0)) || miniMaxSelectedSegment(node);
}

function miniMaxApplyTimelineTime(wrap, node, time, play=false){
    const safeTime = miniMaxSetPlayheadDom(wrap, node, time);
    const seg = miniMaxActiveSegmentAt(node, safeTime);
    if(seg?.id && seg.id !== node.selectedSegmentId){
        node.selectedSegmentId = seg.id;
        refreshNodes([node.id]);
        scheduleSave();
        return;
    }
    miniMaxSyncPlayerDom(wrap, seg, safeTime, play);
}

function miniMaxAspectValue(value){
    const text = String(value || '').trim();
    const match = text.match(/\d+\s*:\s*\d+/);
    return match ? match[0].replace(/\s+/g, '') : '16:9';
}

function miniMaxCompactJson(value, limit=1800){
    try {
        const text = JSON.stringify(value);
        return text.length > limit ? `${text.slice(0, limit)}...` : text;
    } catch(e) {
        return String(value || '');
    }
}

function miniMaxCompactSegments(node){
    if(!node?.segments?.length) return;
    node.segments.sort((a, b) => Number(a.start || 0) - Number(b.start || 0));
    let cursor = 0;
    node.segments.forEach(seg => {
        seg.start = cursor;
        seg.duration = Math.max(0.5, Number(seg.duration || 1) || 1);
        cursor += seg.duration;
    });
    node.duration = Math.max(1, cursor);
    node.playhead = Math.min(Number(node.playhead || 0), node.duration);
}

function miniMaxDetailedError(message, details={}){
    const err = new Error(message);
    err.miniMaxDetails = details;
    return err;
}

function miniMaxDownloadItem(item){
    const url = outputUrlValue(item);
    if(!url) return;
    const link = document.createElement('a');
    link.href = canvasDisplayMediaUrl(url, item?.name || canvasFileNameFromUrl(url) || 'minimax.mp4');
    link.download = safeDownloadFileName(item?.name || canvasFileNameFromUrl(url) || 'minimax.mp4', 'minimax.mp4');
    document.body.appendChild(link);
    link.click();
    link.remove();
}

async function miniMaxDynamicParams(node, prompt, refs){
    const seg = miniMaxSelectedSegment(node);
    const duration = Math.max(0.5, Math.min(60, Number(seg?.duration || node.duration || 8) || 8));
    // art-canvas ships MiniMaxH3Easy (node 295); seed lives in KSampler (node 309).
    // MiniMaxH3Easy exposes a single reference media slot (media_1 / media_type_1).
    const params = {
        "295":{
            mode:'reference',
            prompt:prompt,
            seconds:String(duration),
            aspect_ratio:miniMaxAspectValue(seg?.aspectRatio || node.aspectRatio || '16:9'),
            resolution:'480P',
            fps:24,
            keyframe_role:'first'
        }
    };
    const images = imageRefsOnly(refs);
    if(images.length > CANVAS_MINIMAX_REF_IMAGE_MAX) throw new Error(`MiniMax H3 最多支持 ${CANVAS_MINIMAX_REF_IMAGE_MAX} 张参考图`);
    if(images.length > 1) console.warn('MiniMax H3 (Easy) 当前仅使用首张参考图 (media_1)');
    for(let i = 0; i < images.length; i++){
        const name = await comfyNameForRef(images[i]);
        const loadId = String(9000 + i);
        params[loadId] = {class_type:'LoadImage', inputs:{image:name}, _meta:{title:`MiniMax image ${i + 1}`}};
        params["295"][`media_${i + 1}`] = [loadId, 0];
        params["295"][`media_type_${i + 1}`] = 'image';
    }
    // reproducible seed (node 309) — not random each run
    const seed = Number(node.seed || node.minimaxSeed || 0);
    params["309"] = {seed: seed || (Math.floor(Math.random() * 4294967295))};
    return params;
}

function miniMaxEngine(node){
    return node?.minimaxEngine === 'runninghub' ? 'runninghub' : CANVAS_MINIMAX_DEFAULT_ENGINE;
}

function miniMaxEnsureSegment(node){
    node.minimaxEngine = miniMaxEngine(node);
    node.workflow = node.workflow || 'video/MiniMax_H3.json';
    node.minimaxRunningHubWorkflowId = node.minimaxRunningHubWorkflowId || CANVAS_MINIMAX_RUNNINGHUB_WORKFLOW_ID;
    node.rhPayment = node.rhPayment || 'free';
    node.aspectRatio = miniMaxAspectValue(node.aspectRatio || '16:9');
    node.megapixels = Number.isFinite(Number(node.megapixels)) ? Number(node.megapixels) : 0.4;
    node.segments = Array.isArray(node.segments) ? node.segments : [];
    if(!node.segments.length){
        node.segments.push({id:uid('seg'), start:0, duration:Number(node.duration || 8) || 8, prompt:'', refs:[], result:null, results:[], trimIn:0, trimOut:Number(node.duration || 8) || 8});
    }
    node.segments.forEach((seg, index) => {
        if(!seg.id) seg.id = uid('seg');
        seg.start = Math.max(0, Number(seg.start || 0) || 0);
        seg.duration = Math.max(0.5, Number(seg.duration || node.duration || 8) || 8);
        seg.prompt = String(seg.prompt || '');
        seg.aspectRatio = miniMaxAspectValue(seg.aspectRatio || node.aspectRatio || '16:9');
        seg.megapixels = Number.isFinite(Number(seg.megapixels)) ? Number(seg.megapixels) : Number(node.megapixels || 0.4);
        const refBuckets = seg.refs && typeof seg.refs === 'object' && !Array.isArray(seg.refs) ? seg.refs : {};
        const migrated = [
            ...(Array.isArray(seg.refs) ? seg.refs : []),
            ...(Array.isArray(seg.refItems) ? seg.refItems : []),
            ...['image','video','audio'].flatMap(kind => Array.isArray(refBuckets[kind]) ? refBuckets[kind].map(ref => ({...ref, kind})) : [])
        ];
        seg.refs = miniMaxUniqueRefs(migrated).slice(0, CANVAS_MINIMAX_REF_IMAGE_MAX + CANVAS_MINIMAX_REF_VIDEO_MAX + CANVAS_MINIMAX_REF_AUDIO_MAX);
        seg.result = seg.result && seg.result.url ? {...seg.result, kind:seg.result.kind || mediaKindForOutputItem(seg.result)} : null;
        seg.results = Array.isArray(seg.results) ? seg.results.filter(item => outputUrlValue(item)) : [];
        seg.trimIn = Math.max(0, Math.min(Number(seg.trimIn || 0), Math.max(0, seg.duration - 0.1)));
        seg.trimOut = Math.max(seg.trimIn + 0.1, Math.min(seg.duration, Number(seg.trimOut || seg.duration) || seg.duration));
        if(index > 0){
            const prev = node.segments[index - 1];
            seg.start = Math.max(seg.start, Number(prev.start || 0) + Number(prev.duration || 0));
        }
    });
    if(!node.selectedSegmentId || !node.segments.some(seg => seg.id === node.selectedSegmentId)) node.selectedSegmentId = node.segments[0].id;
    node.duration = Math.max(1, ...node.segments.map(seg => Number(seg.start || 0) + Number(seg.duration || 0)));
    node.materials = Array.isArray(node.materials) ? node.materials.filter(item => outputUrlValue(item)) : [];
    return node.segments.find(seg => seg.id === node.selectedSegmentId) || node.segments[0];
}

function miniMaxExplicitRefsForSegment(seg){
    return miniMaxUniqueRefs(seg?.refs || []);
}

function miniMaxFullAspectLabel(ratio){
    const clean = miniMaxAspectValue(ratio);
    if(clean === '16:9') return '16:9 (Widescreen)';
    if(clean === '9:16') return '9:16 (Portrait)';
    if(clean === '1:1') return '1:1 (Square)';
    return clean;
}

function miniMaxLogError(error, engine='comfyui'){
    const base = miniMaxReadableError(error, engine);
    const details = error?.miniMaxDetails || {};
    const lines = [base];
    if(details.taskId && !base.includes(details.taskId)) lines.push(`taskId: ${details.taskId}`);
    if(details.code !== undefined && details.code !== null && details.code !== '') lines.push(`code: ${details.code}`);
    if(details.stage) lines.push(`stage: ${details.stage}`);
    if(details.workflowId) lines.push(`workflowId: ${details.workflowId}`);
    if(details.nodeInfoList) lines.push(`nodeInfoList: ${miniMaxCompactJson(details.nodeInfoList, 1800)}`);
    if(details.raw) lines.push(`raw: ${miniMaxCompactJson(details.raw, 4200)}`);
    return lines.filter(Boolean).join('\n');
}

function miniMaxMediaHtml(item, label='Media'){
    const url = outputUrlValue(item);
    const kind = mediaKindForOutputItem(item) || mediaKindForRef(item);
    if(kind === 'image' && url) return canvasPreviewImgHtml(url, 512, 'draggable="false"');
    if(kind === 'video' && url) return `<div class="minimax-lite-media is-video">${canvasVideoPreviewHtml(url, 512, 'draggable="false"')}<span>${escapeHtml(item?.name || label)}</span></div>`;
    const icon = kind === 'audio' ? 'file-audio' : kind === 'video' ? 'film' : 'sparkles';
    return `<div class="minimax-lite-media is-${escapeAttr(kind || 'file')}"><i data-lucide="${icon}"></i><span>${escapeHtml(item?.name || label)}</span></div>`;
}

function miniMaxNormalizeRef(ref){
    if(!ref?.url) return null;
    return {...ref, kind:mediaKindForRef(ref)};
}

function miniMaxPlayerHtml(seg){
    const item = seg?.result?.url ? seg.result : null;
    if(!item) return `<div class="minimax-player-empty"><i data-lucide="clapperboard"></i><span>Current segment</span></div>`;
    const kind = mediaKindForOutputItem(item);
    if(kind === 'audio') return `<div class="minimax-player-empty"><i data-lucide="file-audio"></i><span>${escapeHtml(item.name || 'Audio')}</span><audio src="${escapeAttr(canvasDisplayMediaUrl(item.url, item.name || 'audio'))}" controls preload="metadata"></audio></div>`;
    if(kind === 'image') return `<div class="minimax-player-image">${canvasPreviewImgHtml(item.url, 1024, 'draggable="false"')}</div>`;
    return canvasVideoPlayerHtml(item.url, 'data-minimax-player="1"');
}

function miniMaxReadableError(error, engine='comfyui'){
    const text = String(error?.message || error || tr('canvas.generationFailed')).trim();
    const jsonStart = text.indexOf('{');
    if(jsonStart < 0) return text;
    try {
        const payload = JSON.parse(text.slice(jsonStart));
        const parts = [];
        const mainError = payload?.error;
        if(mainError?.message) parts.push(String(mainError.message));
        if(mainError?.details && !parts.includes(String(mainError.details))) parts.push(String(mainError.details));
        Object.entries(payload?.node_errors || {}).slice(0, 3).forEach(([nodeId, nodeError]) => {
            const details = (nodeError?.errors || []).slice(0, 2).map(item => item?.details || item?.message).filter(Boolean);
            if(details.length) parts.push(`节点 ${nodeId}${nodeError?.class_type ? `（${nodeError.class_type}）` : ''}：${details.join('；')}`);
        });
        const prefix = engine === 'runninghub' ? 'RunningHub 工作流执行失败' : 'ComfyUI 拒绝了工作流';
        return parts.length ? `${prefix}：${parts.join('；')}` : text;
    } catch(e) {
        return text;
    }
}

function miniMaxRefsForNode(node){
    const sources = orderedSources(node, generatorSources(node));
    return {
        sources,
        prompt:sources.map(src => src.prompt).filter(Boolean).join('\n\n'),
        refs:sources.flatMap(src => src.refs || []).filter(ref => ref?.url)
    };
}

function miniMaxRefsForSegment(node, seg){
    const own = miniMaxExplicitRefsForSegment(seg);
    if(own.length) return own;
    const upstream = miniMaxRefsForNode(node).refs;
    return miniMaxUniqueRefs(upstream).slice(0, CANVAS_MINIMAX_REF_IMAGE_MAX + CANVAS_MINIMAX_REF_VIDEO_MAX + CANVAS_MINIMAX_REF_AUDIO_MAX);
}

function miniMaxRefSummary(refs=[]){
    const counts = refs.reduce((map, ref) => {
        const kind = mediaKindForRef(ref);
        map[kind] = (map[kind] || 0) + 1;
        return map;
    }, {});
    const parts = [];
    if(counts.image) parts.push(`${counts.image} 图`);
    if(counts.video) parts.push(`${counts.video} 视频`);
    if(counts.audio) parts.push(`${counts.audio} 音频`);
    return parts.join(' · ') || 'No refs';
}

function miniMaxSegmentRefsByKind(refs, kind){
    return miniMaxUniqueRefs(refs).filter(ref => mediaKindForRef(ref) === kind);
}

function miniMaxSelectedSegment(node){
    return miniMaxEnsureSegment(node);
}

function miniMaxSetPlayheadDom(wrap, node, time){
    const total = miniMaxTimelineTotal(node);
    const safeTime = Math.max(0, Math.min(total, Number(time || 0)));
    node.playhead = safeTime;
    const pct = total ? (safeTime / total) * 100 : 0;
    wrap.querySelectorAll('[data-minimax-playhead]').forEach(head => { head.style.left = `${pct}%`; });
    const label = wrap.querySelector('[data-minimax-time-label]');
    if(label){
        const fmt = value => `${(Number(value || 0)).toFixed(Number(value || 0) % 1 ? 1 : 0)}s`;
        label.textContent = `${fmt(safeTime)} / ${fmt(total)}`;
    }
    return safeTime;
}

function miniMaxSetSegmentResult(node, seg, item){
    if(!node || !seg || !outputUrlValue(item)) return false;
    const url = outputUrlValue(item);
    const result = typeof item === 'object' ? {...item, url, kind:item.kind || 'video'} : {url, kind:'video', name:'minimax.mp4'};
    seg.result = result;
    seg.results = Array.isArray(seg.results) ? seg.results : [];
    if(!seg.results.some(existing => outputUrlValue(existing) === url)) seg.results.unshift(result);
    node.materials = Array.isArray(node.materials) ? node.materials : [];
    if(!node.materials.some(existing => outputUrlValue(existing) === url)) node.materials.unshift({...result, segmentId:seg.id, createdAt:Date.now()});
    return true;
}

function miniMaxSyncPlayerDom(wrap, seg, time, play=false){
    const stage = wrap.querySelector('[data-minimax-player-stage]');
    if(!stage || !seg) return;
    const nextUrl = seg.result?.url || '';
    if(stage.dataset.minimaxPlayerSegment !== seg.id || stage.dataset.minimaxPlayerUrl !== nextUrl){
        stage.dataset.minimaxPlayerSegment = seg.id || '';
        stage.dataset.minimaxPlayerUrl = nextUrl;
        const content = stage.querySelector('[data-minimax-player-content]');
        if(content) content.innerHTML = miniMaxPlayerHtml(seg);
        refreshIcons();
    }
    const media = stage.querySelector('[data-minimax-player]');
    if(media){
        const rel = Math.max(0, Number(time || 0) - Number(seg.start || 0));
        try { media.currentTime = Math.min(Math.max(0, rel), Number(seg.duration || rel) || rel); } catch(e) {}
        if(play) media.play?.().catch(() => {});
        else media.pause?.();
    }
}

function miniMaxTimelineTotal(node){
    miniMaxEnsureSegment(node);
    return Math.max(1, Number(node.duration || 0), ...node.segments.map(seg => Number(seg.start || 0) + Number(seg.duration || 0)));
}

function miniMaxUniqueRefs(refs=[]){
    const seen = new Set();
    return (refs || []).map(miniMaxNormalizeRef).filter(Boolean).filter(ref => {
        const key = `${ref.kind}:${ref.url}`;
        if(seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

window.MiniMaxHelpers = {
    getNodes,
    getViewport,
    miniMaxActiveSegmentAt,
    miniMaxApplyTimelineTime,
    miniMaxAspectValue,
    miniMaxCompactJson,
    miniMaxCompactSegments,
    miniMaxDetailedError,
    miniMaxDownloadItem,
    miniMaxDynamicParams,
    miniMaxEngine,
    miniMaxEnsureSegment,
    miniMaxExplicitRefsForSegment,
    miniMaxFullAspectLabel,
    miniMaxLogError,
    miniMaxMediaHtml,
    miniMaxNormalizeRef,
    miniMaxPlayerHtml,
    miniMaxReadableError,
    miniMaxRefsForNode,
    miniMaxRefsForSegment,
    miniMaxRefSummary,
    miniMaxSegmentRefsByKind,
    miniMaxSelectedSegment,
    miniMaxSetPlayheadDom,
    miniMaxSetSegmentResult,
    miniMaxSyncPlayerDom,
    miniMaxTimelineTotal,
    miniMaxUniqueRefs,
};
})();
