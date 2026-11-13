/* 生成源解析：把上游节点产物整理成生成器节点（generator/msgen/comfy/rh/minimax...）的输入列表。
 *
 * 从 canvas.js 的「21 · 生成源解析与级联执行」原样迁出，未改动业务逻辑。
 * 依赖约定见 static/nodes/README.md：
 *   - 状态走 deps：nodes / connections / loopContext 是 canvas.js 顶层 let（不挂 window），
 *     必须由 init 注入；nodesEl 与 CANVAS_GENERATOR_TYPES 同样由 init 传入
 *   - 渲染函数（renderPromptPreview / renderImageInputList / renderComfyImages / rhXxx ...）
 *     是 canvas.js 顶层 function 声明，classic script 之间互相可见，直接调用
 *   - 导出的函数同时挂到 window 上，canvas.js 里原有的裸调用无需改动
 */
(() => {
let deps = null;
function getNodes(){ return deps.nodes(); }
function getConnections(){ return deps.connections(); }
function getLoopContext(){ return deps.loopContext(); }

function generatedImageRefs(node){
    const keepGeneratedMedia = ['rh','ltxDirector','video','minimax'].includes(node?.type);
    return (node?.generatedOutputs || [])
        .map((item, i) => {
            const url = outputUrlValue(item);
            if(!url) return null;
            const kind = mediaKindForOutputItem(item);
            return {url, name:outputImageName(url) || `${node.type || 'generated'}-${i + 1}`, kind, index:i};
        })
        .filter(Boolean)
        .filter(ref => keepGeneratedMedia || ref.kind === 'image')
        .map(ref => {
            const {index, ...clean} = ref;
            return clean;
        });
}
function mediaRefsFromNode(node){
    if(!node) return [];
    if(node.type === 'assetSplit') return window.CanvasAssetSplit?.images(node) || [];
    if(node.type === 'extension') return window.CanvasNodeCatalog?.imageRefs(node) || [];
    if(window.GameModel3D?.types.includes(node.type)) return window.GameModel3D.referenceImages(node);
    if(node.type === 'gameIdea') return (node.media || []).filter(item => item?.url)
        .map(item => ({url:item.url, name:item.name || item.kind, role:'', kind:item.kind || 'image'}));
    if(node.type === 'image' && node.url){
        const kind = mediaKindForNode(node);
        return [{url:node.url, name:node.name || kind, role:node.role || '', kind}];
    }
    if(node.type === 'group'){
        return (node.items || [])
            .map(id => getNodes().find(x => x.id === id))
            .filter(x => x?.type === 'image' && x?.url)
            .map(item => ({url:item.url, name:item.name || mediaKindForNode(item), role:item.role || '', kind:mediaKindForNode(item)}));
    }
    if(node.type === 'output'){
        return (node.images || []).map((item, i) => {
            const url = outputUrlValue(item);
            if(!url) return null;
            const kind = mediaKindForOutputItem(item);
            return {url, name:outputImageName(url) || `output-${i + 1}`, kind, nodeId:node.id, outputIndex:i};
        }).filter(Boolean);
    }
    if(deps.mediaOutputTypes().includes(node.type)) return generatedImageRefs(node);
    return [];
}
function generatorSources(gen){
    return getConnections().filter(c => c.to === gen.id).map(c => getNodes().find(n => n.id === c.from)).filter(Boolean).map(n => {
        if(n.type === 'assetSplit'){
            return (window.CanvasAssetSplit?.images(n)||[]).map((ref,i)=>({id:`${n.id}:split:${i}`,type:'generatedImage',label:ref.name,preview:ref.url,refs:[ref],prompt:''}));
        }
        if(n.type === 'materialPbr'){
            return (window.CanvasMaterials?.images(n)||[]).map((ref,i)=>({id:`${n.id}:material:${i}`,type:'generatedImage',label:ref.name,preview:ref.url,refs:[ref],prompt:''}));
        }
        if(window.GameModel3D?.types.includes(n.type)){
            const refs=window.GameModel3D.referenceImages(n);
            return {id:n.id,type:'image',label:'模型参考视图',preview:refs[0]?.url,refs,prompt:''};
        }
        if(n.type === 'output' && (n.images||[]).length){
            // 从 output 节点取最新一张图当作 reference 给下游
            const reversed = [...n.images].map((item, index) => ({item, index})).reverse();
            const found = reversed.find(entry => outputUrlValue(entry.item));
            if(found){
                const last = outputUrlValue(found.item);
                const kind = mediaKindForOutputItem(found.item);
                return {id:n.id, type:'outputImage', label:'上游输出', preview:last, refs:[{url:last, name:'output.png', kind, nodeId:n.id, outputIndex:found.index}], prompt:''};
            }
        }
        if(deps.mediaOutputTypes().includes(n.type)){
            const refs = generatedImageRefs(n);
            if(refs.length){
                return refs.map((ref, i) => ({
                    id:`${n.id}:generated:${i}:${ref.url}`,
                    type:'generatedImage',
                    label:`上游生成 ${i + 1}`,
                    preview:ref.url,
                    refs:[ref],
                    prompt:''
                }));
            }
        }
        if(n.type === 'gameIdea'){
            const media = (n.media || []).filter(item => item?.url);
            const sources = media.map(item => {
                const kind = item.kind || 'image';
                return {
                    id:`${n.id}:media:${item.id}`,
                    type:`idea-${kind}`,
                    label:item.name || kind,
                    preview:kind === 'image' ? item.url : undefined,
                    refs:[{url:item.url, name:item.name || kind, kind}],
                    prompt:''
                };
            });
            if(n.idea) sources.push({
                id:`${n.id}:idea`,
                type:'ideaPrompt',
                label:(n.idea || '游戏灵感').slice(0, 28),
                refs:[],
                prompt:n.idea
            });
            return sources.length ? sources : null;
        }
        if(n.type === 'image' && n.url) {
            const kind = mediaKindForNode(n);
            return {id:n.id, type:kind, label:n.name || kind, preview:n.url, refs:[{url:n.url, name:n.name || kind, role:n.role || '', kind}], prompt:''};
        }
        if(n.type === 'group') {
            const items = (n.items || []).map(id => getNodes().find(x => x.id === id)).filter(Boolean);
            const sources = items.filter(x => x.type === 'image' && x.url).map(img => ({
                id:`${n.id}:${img.id}`,
                type:`group-${mediaKindForNode(img)}`,
                groupId:n.id,
                imageId:img.id,
                label:img.name || mediaKindForNode(img),
                preview:img.url,
                refs:[{url:img.url, name:img.name || mediaKindForNode(img), role:img.role || '', kind:mediaKindForNode(img)}],
                prompt:''
            }));
            const prompts = items.filter(x => x.type === 'prompt').map(p => p.text || '').filter(Boolean);
            if(prompts.length){
                const combined = prompts.join('\n\n');
                sources.push({
                    id:`${n.id}:prompts`,
                    type:'groupPrompt',
                    groupId:n.id,
                    label:combined.slice(0, 32),
                    refs:[],
                    prompt:combined
                });
            }
            return sources;
        }
        if(n.type === 'prompt') return {id:n.id, type:'prompt', label:(n.text || '提示词').slice(0, 32), refs:[], prompt:n.text || ''};
        if(n.type === 'gamePlan'){
            const text = gamePlanText();
            return text ? {id:n.id, type:'gamePlanText', label:(window.GamePipeline?.project?.plan?.title || '游戏策划').slice(0, 28), refs:[], prompt:text} : null;
        }
        if(n.type === 'loop') {
            const ctx = gen?._activeLoopCtx || getLoopContext() || null;
            const prompt = renderLoopPrompt(n, ctx);
            const imageRefs = loopInputImageRefs(n, ctx);
            const out = [];
            if(imageRefs.length){
                const currentIndex = Math.max(1, Number(ctx?.index || n.loopStart || 1) || 1);
                imageRefs.forEach((ref, i) => {
                    out.push({
                        id:`${n.id}:image:${currentIndex + i}:${ref.url}`,
                        type:'loopImage',
                        label:trf('canvas.loopImageLabel', {n:currentIndex + i}),
                        preview:ref.url,
                        refs:[ref],
                        prompt:i === 0 && !out.length ? prompt : ''
                    });
                });
            }
            if(out.length) return out;
            return {id:n.id, type:'loop', label:`${tr('canvas.loopNode')} ${loopCount(n)}x`, refs:[], prompt};
        }
        if(n.type === 'promptGroup') {
            const prompts = (n.items || []).map(id => getNodes().find(x => x.id === id)).filter(Boolean).map(p => p.text || '').filter(Boolean);
            return {id:n.id, type:'promptGroup', label:`提示词 ${prompts.length} 个`, refs:[], prompt:prompts.join('\n\n')};
        }
        if(n.type === 'extension') {
            const refs=window.CanvasNodeCatalog?.imageRefs(n) || [];
            return {id:n.id, type:refs.length?'generatedImage':'prompt', label:(window.CanvasNodeCatalog?.definition(n)?.title || '扩展节点').slice(0,32), refs, preview:refs[0]?.url, prompt:n.outputText || ''};
        }
        if(n.type === 'llm' && (n.mode || 'node') === 'node' && n.outputText) return {id:n.id, type:'llm', label:(n.outputText || 'LLM').slice(0, 32), refs:[], prompt:n.outputText || ''};
        return null;
    }).flat().filter(Boolean);
}
function orderedSources(gen, sources){
    gen.inputs = (gen.inputs || []).filter(id => sources.some(s => s.id === id));
    sources.forEach(s => { if(!gen.inputs.includes(s.id)) gen.inputs.push(s.id); });
    return gen.inputs.map(id => sources.find(s => s.id === id)).filter(Boolean);
}
function reorderInput(gen, movedId, targetId){
    if(!movedId || movedId === targetId) return;
    const sources = generatorSources(gen);
    const imageIds = sources.filter(s => s.refs?.length).map(s => s.id);
    if(!imageIds.includes(movedId) || !imageIds.includes(targetId)) return;
    const promptIds = (gen.inputs || []).filter(id => !imageIds.includes(id));
    const ids = (gen.inputs || []).filter(id => imageIds.includes(id));
    const from = ids.indexOf(movedId), to = ids.indexOf(targetId);
    if(from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    gen.inputs = [...ids, ...promptIds];
    render();
    scheduleSave();
}
function syncGeneratorInputs(){
    getNodes().filter(n => deps.generatorTypes().includes(n.type)).forEach(gen => {
        orderedSources(gen, generatorSources(gen));
        if(gen.type === 'ltxDirector') window.LtxDirectorNode.ltxSyncConnectedImagesToTimeline(gen);
    });
    window.CanvasImageGeneration?.sync();
    window.CanvasMaterials?.sync();
}
// 提示词节点每敲一个字都全量重建所有生成器节点的输入/预览 DOM 会卡顿。节点的 text 已即时写入
// （运行时实时读取，不受影响），生成器里的预览只需稍后同步一次即可，这里做防抖。
let generatorInputSyncTimer = 0;
function scheduleGeneratorInputSync(){
    clearTimeout(generatorInputSyncTimer);
    generatorInputSyncTimer = setTimeout(() => {
        syncGeneratorInputs();
        refreshGeneratorInputViews();
    }, 160);
}
function refreshGeneratorInputViews(){
    getNodes().filter(n => deps.generatorTypes().includes(n.type)).forEach(gen => {
        const el = deps.nodesEl().querySelector(`.node[data-id="${gen.id}"]`);
        if(!el) return;
        const sources = orderedSources(gen, generatorSources(gen));
        const imageInputs = sources
            .map(src => ({...src, refs:imageRefsOnly(src.refs || [])}))
            .filter(src => src.refs?.length);
        renderPromptPreview(el.querySelector('.prompt-list'), sources.filter(src => src.prompt && !src.refs?.length));
        if(gen.type === 'generator') renderImageInputList(el.querySelector('.input-list'), gen, imageInputs);
        if(gen.type === 'msgen') renderImageInputList(el.querySelector('.ms-img-list'), gen, imageInputs);
        if(gen.type === 'comfy') renderComfyImages(el.querySelector('.input-list'), gen, imageInputs);
        if(gen.type === 'ltxDirector'){
            window.LtxDirectorNode.ltxSyncConnectedImagesToTimeline(gen);
            renderComfyImages(el.querySelector('.input-list'), gen, imageInputs);
        }
        if(gen.type === 'video') renderVideoImageInputs(el.querySelector('.video-img-list'), gen, imageInputs);
        if(gen.type === 'rh'){
            const media = rhMediaSources(gen);
            if(rhCurrentKind(gen) === 'model') renderPromptPreview(el.querySelector('.rh-prompt-list'), media.sources.filter(src => src.prompt && !src.refs?.length));
            else renderRhPromptFields(el.querySelector('.rh-prompt-list'), gen, rhActiveFields(gen));
            renderRhInputs(el.querySelector('.rh-input-list'), gen, media);
            renderRhParams(el.querySelector('.rh-param-list'), gen, rhActiveFields(gen), media);
        }
    });
}
const api = {
    generatedImageRefs,
    mediaRefsFromNode,
    generatorSources,
    orderedSources,
    reorderInput,
    syncGeneratorInputs,
    scheduleGeneratorInputSync,
    refreshGeneratorInputViews,
    init(options){ deps = options; }
};
window.CanvasGenerationSources = api;
// 现有 canvas.js 里都是裸调用，这里挂到 window 上保持向后兼容
Object.assign(window, {
    generatedImageRefs,
    mediaRefsFromNode,
    generatorSources,
    orderedSources,
    reorderInput,
    syncGeneratorInputs,
    scheduleGeneratorInputSync,
    refreshGeneratorInputViews
});
})();
