// ponytail: embed the original creation console so parameters and submission stay in one implementation.
let canvasComposerBridge = null;
let imageComposerEnabledFor = null;
const canvasComposerProgress = new Map();
let canvasComposerProgressView=null;
function clearCanvasComposerProgressView() { canvasComposerProgressView?.destroy();canvasComposerProgressView=null; }

function renderImageEditComposer(node) {
    let panel = document.getElementById('imageEditComposer');
    if (!panel) {
        panel = document.createElement('section');
        panel.id = 'imageEditComposer';
        panel.className = 'image-edit-composer shared-generation-composer';
        panel.setAttribute('aria-label', '图片编辑创作控制台');
        const frame = document.createElement('iframe');
        frame.title = '文生图创作控制台';
        frame.src = '/static/app/zimage.html?canvasComposer=1&v=20261105noref';
        panel.appendChild(frame);
        ['pointerdown','mousedown','wheel','dblclick'].forEach(type=>panel.addEventListener(type,event=>event.stopPropagation()));
        board.appendChild(panel);
        canvasComposerBridge = {panel,frame,ready:false,current:null,active:null};
        window.addEventListener('message', handleCanvasComposerMessage);
        window.addEventListener('resize', positionImageEditComposer);
    }
    panel.hidden = false;
    const state = canvasComposerBridge;
    state.current = {canvasId:canvas.id,nodeId:node.id,url:node.url,name:node.name||'参考图',prompt:node.imageEditDraft??node.prompt??''};
    sendCanvasComposerSelection();
    positionImageEditComposer();
}

function imageComposerPosition(box, view, width, boardWidth) {
    return {
        left:Math.max(8,Math.min(boardWidth-width-8,(box.x+box.w/2)*view.scale+view.x-width/2)),
        top:(box.y+box.h)*view.scale+view.y+16
    };
}

function positionImageEditComposer() {
    const state=canvasComposerBridge;
    if(!state) return;
    if(selected.size!==1 || !selected.has(state.current?.nodeId) || imageComposerEnabledFor!==canvas.id+':'+state.current.nodeId){
        state.panel.hidden=true;
        return;
    }
    const node=nodes.find(item=>item.id===state.current?.nodeId);
    if(!node) return;
    const element=nodesEl.querySelector(`.node[data-id="${CSS.escape(node.id)}"]`);
    const box=element ? {x:node.x,y:node.y,w:element.offsetWidth,h:element.offsetHeight} : estimatedNodeRect(node);
    state.panel.hidden=Math.max(box.w,box.h)*viewport.scale<160;
    if(state.panel.hidden) return;
    const position=imageComposerPosition(box,viewport,state.panel.offsetWidth,board.clientWidth);
    state.panel.style.left=position.left+'px';
    state.panel.style.top=position.top+'px';
}

function sendCanvasComposerSelection() {
    const state = canvasComposerBridge;
    if (!state?.ready || state.active || !state.current) return;
    const key = JSON.stringify([state.current.canvasId,state.current.nodeId,state.current.url]);
    if (state.sentKey === key) return;
    state.sentKey = key;
    state.frame.contentWindow.postMessage({type:'canvas-composer-select',...state.current},location.origin);
}

function handleCanvasComposerMessage(event) {
    const state = canvasComposerBridge;
    if (!state || event.origin !== location.origin || event.source !== state.frame.contentWindow) return;
    const data = event.data || {};
    if (data.type === 'canvas-composer-ready') {
        state.ready = true; state.sentKey = null; sendCanvasComposerSelection(); return;
    }
    if (data.type === 'canvas-composer-height') {
        state.panel.style.height = Math.max(1,Math.min(board.clientHeight-24,Number(data.height)||220))+'px'; return;
    }
    if (data.type === 'canvas-composer-draft') {
        if (state.current?.nodeId !== data.nodeId || canvas?.id !== data.canvasId) return;
        const node = nodes.find(item=>item.id===data.nodeId);
        if(node) {node.imageEditDraft=String(data.prompt||'').slice(0,20000);scheduleSave();}
        return;
    }
    if (data.type === 'canvas-composer-start') {
        if (state.active || !state.current || canvas?.id!==data.canvasId || state.current.nodeId!==data.nodeId) return;
        const node = nodes.find(item=>item.id===data.nodeId);
        if(!node) return;
        state.active = {id:data.requestId,canvasId:canvas.id,source:{...node},prompt:data.prompt||'',results:false};
        node.imageVersions = node.imageVersions?.length ? node.imageVersions : [imageVersionSnapshot(node,'original','原图')];
        node.imageComposerPending = {id:data.requestId,startedAt:Date.now()};
        expandedImageVersions.add(canvas.id+':'+node.id);
        canvasComposerProgress.set(data.requestId,{status:'started'});
        render();scheduleSave();return;
    }
    const run=state.active;
    if(!run || run.id!==data.requestId) return;
    const node=canvas?.id===run.canvasId ? nodes.find(item=>item.id===run.source.id) : null;
    if(data.type==='canvas-composer-progress') {
        canvasComposerProgress.set(run.id,data.progress);
        const card=document.querySelector('[data-canvas-composer-progress]');
        if(card?.dataset.canvasComposerProgress===run.id) CardProgress.update(card,data.progress);
        return;
    }
    if(data.type==='canvas-composer-result') {
        if(!node) return;
        delete node.imageComposerPending;
        const record=data.record||{};
        insertImageEditResults((record.images||[]).map(item=>typeof item==='string'?item:item.url).filter(Boolean),run.source,{id:run.id,prompt:record.prompt||run.prompt,model:record.params?.model||record.model||''});
        run.results=true;scheduleSave();return;
    }
    if(data.type==='canvas-composer-finish') {
        if(node) {
            delete node.imageComposerPending;
            if(data.error && !run.results) node.imageComposerError=String(data.error).slice(0,1000);
            else delete node.imageComposerError;
            render();scheduleSave();
        }
        canvasComposerProgress.delete(run.id);
        state.active=null;
        sendCanvasComposerSelection();
    }
}

function insertImageEditResults(urls,source,task) {
    const current=nodes.find(node=>node.id===source.id);
    if(!current)return;
    const versions=current.imageVersions || [];
    const fresh=[...new Set(urls)].filter(url=>!versions.some(version=>version.taskId===task.id&&version.url===url));
    if(!fresh.length)return;
    pushUndo();
    if(!versions.length)versions.push(imageVersionSnapshot(source,'original','原图'));
    if(!versions.some(version=>version.url===current.url))versions.push(imageVersionSnapshot(current,'saved:'+versions.length,'编辑前图片'));
    for(const url of fresh)versions.push({id:task.id+':'+url,url,name:'智能改图',prompt:task.prompt,model:task.model,taskId:task.id,sourceUrl:source.url,createdAt:Date.now()});
    current.imageVersions=versions;
    expandedImageVersions.add(canvas.id+':'+current.id);
    render();scheduleSave();
}
