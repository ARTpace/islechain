// ponytail: extend the existing DOM canvas, editor and save/undo stack; no second canvas engine.

async function openGalleryImageEditor(key) {
    try {
        if (!key?.startsWith('canvas-image-edit:')) throw new Error('图片编辑请求无效');
        const image = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (!image?.url) throw new Error('图片编辑请求已失效，请从图库重新打开');
        const lookup = await fetch('/api/canvases');
        if (!lookup.ok) throw new Error('查询已有编辑画布失败，请重试');
        const listing = await lookup.json();
        let existing = (listing.canvases || []).find(item => item.image_edit_source === image.url);
        // Older running backends do not expose the source in list records yet.
        for(const item of listing.canvases || []) {
            if(existing) break;
            if('image_edit_source' in item || !item.title?.startsWith('图片编辑')) continue;
            const response = await fetch('/api/canvases/' + encodeURIComponent(item.id));
            if(response.status === 404) continue;
            if(!response.ok) throw new Error('查询已有编辑画布失败，请重试');
            const record = await response.json();
            const source = record.canvas?.nodes?.find(node => node.type === 'image');
            if((source?.imageVersions?.[0]?.url || source?.url) === image.url) existing=item;
        }
        if(existing) {
            await openCanvas(existing.id);
            const source = nodes.find(node => node.type === 'image' && (node.url === image.url || node.imageVersions?.some(version => version.url === image.url)));
            selected.clear();
            if(source) selected.add(source.id);
            sessionStorage.removeItem(key);
            history.replaceState(null, '', '/static/canvas.html?id=' + encodeURIComponent(existing.id) + '&fromGallery=1');
            await focusGalleryEditorImage(source);
            return;
        }
        const response = await fetch('/api/canvases', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({title:'图片编辑 · ' + new Date().toLocaleString(), icon:'✎', kind:'classic'})
        });
        const data = await response.json();
        if (!response.ok || !data.canvas?.id) throw new Error('创建图片编辑画布失败');
        const id = data.canvas.id;
        // Persist the source before navigating, so a reload cannot silently lose the import.
        const source = {id:uid('img'), type:'image', x:80, y:100, url:image.url, name:'原图', prompt:String(image.prompt || '').slice(0,20000)};
        const saved = await fetch('/api/canvases/' + encodeURIComponent(id), {
            method:'PUT', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({title:data.canvas.title, icon:'✎', nodes:[source], connections:[], viewport:{x:0,y:0,scale:1}, logs:[]})
        });
        if (!saved.ok) throw new Error('原图保存失败，请从图库重新打开');
        sessionStorage.removeItem(key);
        history.replaceState(null, '', '/static/canvas.html?id=' + encodeURIComponent(id) + '&fromGallery=1');
        await openCanvas(id);
        selected.add(source.id);
        await focusGalleryEditorImage(nodes.find(node => node.id === source.id));
    } catch (error) {
        setStatus(error.message);
        alert(error.message);
    }
}

async function focusGalleryEditorImage(node) {
    if(!node) { render(); return; }
    const canvasId = canvas.id;
    if(!node.natural_w || !node.natural_h) {
        const size = await loadCanvasOriginalImageDimensions(node.url);
        if(canvas.id !== canvasId || !nodes.includes(node)) return;
        if(size) { node.natural_w = size.w; node.natural_h = size.h; }
    }
    focusTaggedImage(node.id);
}

function renderImageSelectionTools() {
    renderCanvasColorNavigator();
    let composer = document.getElementById('imageEditComposer');
    if(composer) composer.hidden = true;
    if(selected.size!==1 || !nodes.some(item=>selected.has(item.id) && imageComposerEnabledFor===canvas.id+':'+item.id)) imageComposerEnabledFor=null;
    if (selected.size !== 1) return;
    const node = nodes.find(item => selected.has(item.id));
    if (node?.type !== 'image' || !node.url || mediaKindForNode(node) !== 'image') return;
    const box = estimatedNodeRect(node);
    selectionHub.style.top = Math.max(8, Math.min(board.clientHeight - 48, box.y * viewport.scale + viewport.y - 84)) + 'px';
    selectionHub.classList.add('open');
    selectionHub.classList.add('image-action-toolbar');
    selectionHub.setAttribute('aria-label', '图片编辑工具');
    selectionHub.setAttribute('role', 'toolbar');
    selectionHub.onmousedown = event => event.stopPropagation();
    const button = (label, icon, action) => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'tool-btn';
        element.innerHTML = `<i data-lucide="${icon}" aria-hidden="true"></i><span>${label}</span>`;
        element.onclick = event => { event.stopPropagation(); action(); };
        selectionHub.appendChild(element);
    };
    button('智能改图', 'wand-sparkles', () => {
        imageComposerEnabledFor=canvas.id+':'+node.id;
        renderImageEditComposer(node);
    });
    button('抠图', 'scan-face', () => openCanvasMaskEditor(node));
    button('裁剪', 'crop', () => openImageEditor(node.id, 'crop'));
    button('绘制', 'paintbrush', () => openImageEditor(node.id, 'brush'));
    button('预览', 'expand', () => openImageEditor(node.id, 'preview'));
    button('下载', 'download', () => downloadUrl(node.url, node.name || 'image.png'));
    if(imageComposerEnabledFor===canvas.id+':'+node.id) renderImageEditComposer(node);
    refreshIcons();
    selectionHub.style.left = imageToolbarLeft(box,viewport,selectionHub.offsetWidth,board.clientWidth)+'px';
}

function imageToolbarLeft(box,view,width,boardWidth) {
    return Math.max(8,Math.min(boardWidth-width-8,(box.x+box.w/2)*view.scale+view.x-width/2));
}

function positionImageSelectionTools() {
    if(selected.size!==1 || !selectionHub.classList.contains('open'))return;
    const node=nodes.find(item=>selected.has(item.id));
    if(node?.type!=='image')return;
    const box=estimatedNodeRect(node);
    selectionHub.style.top=Math.max(8,Math.min(board.clientHeight-48,box.y*viewport.scale+viewport.y-84))+'px';
    selectionHub.style.left=imageToolbarLeft(box,viewport,selectionHub.offsetWidth,board.clientWidth)+'px';
}

function insertCanvasCutoutResult(result, source, canvasId) {
    if (canvas?.id !== canvasId) return false;
    const existing = nodes.find(node => node.editMeta?.operation === 'cutout' && node.editMeta.sourceId === source.id && node.url === result.url);
    if (existing) { selected.clear(); selected.add(existing.id); render(); return true; }
    pushUndo();
    const siblings = nodes.filter(node => node.editMeta?.sourceId === source.id);
    const bounds = estimatedNodeRect(source);
    const next = addGeneratedImageNode({url:result.url, name:'抠图 · ' + (result.model || '自动')}, source, '抠图', 0, {
        x:bounds.x + bounds.w + 120, y:bounds.y + siblings.length * (bounds.h + 36),
        prompt:source.prompt || '',
        editMeta:{operation:'cutout',sourceId:source.id,sourceUrl:source.url,taskId:result.id,attempt:result.attempt || '',model:result.model}
    });
    next.w = source.w || bounds.w;
    if(source.natural_w && source.natural_h) {
        next.natural_w = source.natural_w;
        next.natural_h = source.natural_h;
    }
    render();
    scheduleSave();
    return true;
}

function mountCanvasCutoutComparison(element, node) {
    if(node.editMeta?.operation !== 'cutout' || !node.editMeta.sourceUrl) return;
    const surface = element.querySelector('.image-preview-wrap');
    if(!surface) return;
    // Compare full-resolution files on both sides, even when the card is not selected.
    const resultImage = surface.querySelector('img');
    if(resultImage) {
        resultImage.removeAttribute('data-preview-src');
        resultImage.src = canvasDisplayMediaUrl(node.url);
    }
    surface.classList.add('cutout-compare');
    const original = document.createElement('img');
    original.className = 'cutout-compare-original';
    original.src = canvasDisplayMediaUrl(node.editMeta.sourceUrl);
    original.alt = '抠图前原图';original.draggable = false;
    const divider = document.createElement('span');
    divider.className = 'cutout-compare-divider';
    divider.setAttribute('aria-hidden','true');
    const slider = document.createElement('input');
    slider.type='range';slider.min='0';slider.max='100';slider.step='0.1';slider.value='0';
    slider.className='cutout-compare-slider';
    slider.setAttribute('aria-label','左右拖动对比原图与抠图结果');
    const update = () => {
        const value = Number(slider.value);
        original.style.clipPath=`inset(0 ${100-value}% 0 0)`;
        divider.style.left=`${value}%`;
        slider.setAttribute('aria-valuetext',value===0?'完整显示抠图结果':value===100?'完整显示原图':`左侧原图 ${Math.round(value)}%，右侧抠图结果`);
    };
    slider.oninput=update;
    for(const type of ['pointerdown','mousedown','touchstart','click','dblclick','keydown']) slider.addEventListener(type,event=>event.stopPropagation());
    // The preview's double-click handler runs in capture phase.
    slider.addEventListener('pointerdown',event=>slider.setPointerCapture(event.pointerId));
    original.onerror=()=>{original.remove();divider.remove();slider.remove();};
    surface.append(original,divider,slider);update();
}

function imageSourceLinkSegments(items, selection) {
    const byId = new Map(items.map(node => [node.id,node]));
    return items.flatMap(node => {
        const source = byId.get(node.editMeta?.sourceId);
        if(node.type !== 'image' || !source || source.type !== 'image' || source.id === node.id) return [];
        const a = estimatedNodeRect(source), b = estimatedNodeRect(node);
        const forward = b.x + b.w/2 >= a.x + a.w/2;
        return [{a:{x:forward ? a.x+a.w : a.x,y:a.y+a.h/2}, b:{x:forward ? b.x : b.x+b.w,y:b.y+b.h/2}, active:selection.has(source.id)||selection.has(node.id)}];
    });
}

