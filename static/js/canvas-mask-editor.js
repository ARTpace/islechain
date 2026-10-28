// ponytail: a native canvas mask and the existing cutout/upload APIs cover this editing flow.
function createMaskHistory(mask, budget = 64 * 1024 * 1024) {
    const ctx = mask.getContext('2d', {willReadFrequently:true});
    const limit = Math.max(2, Math.min(20, Math.floor(budget / (mask.width * mask.height * 4))));
    let states = [], index = -1;
    return {
        save() {
            states = states.slice(0, index + 1);
            states.push(ctx.getImageData(0,0,mask.width,mask.height));
            if (states.length > limit) states.shift();
            index = states.length - 1;
        },
        move(delta) {
            const next = index + delta;
            if (next < 0 || next >= states.length) return false;
            index = next; ctx.putImageData(states[index],0,0); return true;
        },
        get undo() { return index > 0; },
        get redo() { return index < states.length - 1; }
    };
}

async function openCanvasMaskEditor(node) {
    if (document.getElementById('canvasMaskEditor')) return;
    const source = {...node}, canvasId = canvas.id;
    const dialog = document.createElement('dialog');
    dialog.id = 'canvasMaskEditor';
    dialog.className = 'canvas-mask-editor';
    dialog.setAttribute('aria-label','抠图选区编辑');
    dialog.innerHTML = `<header><div><strong>抠图</strong><span>涂抹保留区域，擦除多选部分</span></div><button data-close title="取消并返回画布" aria-label="取消并返回画布">✕</button></header>
        <div class="mask-stage"><div class="mask-surface"><canvas aria-label="抠图选区，使用画笔或橡皮擦调整"></canvas><div class="mask-cursor" hidden></div></div></div>
        <div class="mask-feedback" role="status" aria-live="polite">正在加载原图…</div>
        <progress class="mask-progress" max="100" aria-label="抠图进度" hidden></progress>
        <div class="mask-toolbar" role="toolbar" aria-label="选区工具">
        <button data-tool="brush" title="画笔：补充保留区域（B）" aria-label="画笔" aria-pressed="true"><i data-lucide="paintbrush"></i></button>
        <button data-tool="erase" title="橡皮擦：移除选区（E）" aria-label="橡皮擦" aria-pressed="false"><i data-lucide="eraser"></i></button>
        <button data-auto title="自动识别主体" aria-label="自动主体"><i data-lucide="scan-face"></i></button>
        <button data-tool="rectangle" title="矩形框选：补充保留区域" aria-label="矩形框选" aria-pressed="false"><i data-lucide="scan"></i></button>
        <span class="mask-divider"></span><label title="笔刷大小"><i data-lucide="pencil"></i><input data-size type="range" min="2" max="180" value="32" aria-label="笔刷大小"></label>
        <span class="mask-divider"></span><button data-undo title="撤销（Ctrl+Z）" aria-label="撤销选区" disabled><i data-lucide="undo-2"></i></button><button data-redo title="重做（Ctrl+Shift+Z）" aria-label="重做选区" disabled><i data-lucide="redo-2"></i></button>
        <div class="mask-model-picker"><button data-model-toggle title="选择抠图模型" aria-label="选择抠图模型" aria-haspopup="menu" aria-expanded="false"><span data-model-name>自动</span><i data-lucide="chevron-up"></i></button>
        <div class="mask-model-menu" hidden><div class="mask-model-options" role="menu" aria-label="抠图模型"></div><select data-model hidden><option value="auto">自动</option></select><label data-target-label hidden>保留主体<input data-target maxlength="2000" placeholder="例如：中间穿蓝衣服的人"><button data-model-apply type="button">识别主体</button></label></div></div>
        <button data-generate class="mask-generate" disabled>生成</button></div>
        `;
    document.body.appendChild(dialog);
    dialog.showModal();
    refreshIcons();
    const display = dialog.querySelector('canvas'), surface = dialog.querySelector('.mask-surface');
    const stage = dialog.querySelector('.mask-stage'), cursor = dialog.querySelector('.mask-cursor');
    const feedback = dialog.querySelector('[role=status]'), generate = dialog.querySelector('[data-generate]');
    const model = dialog.querySelector('[data-model]'), target = dialog.querySelector('[data-target]');
    const size = dialog.querySelector('[data-size]');
    let tool = 'brush', mask, history, image, drawing = null, busy = true, closed = false, saving = false, hasMask = false, zoom = 1;
    const loadImage = url => new Promise((resolve,reject) => {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img); img.onerror = () => reject(new Error('图片加载失败，请检查图片地址是否允许访问'));
        img.src = url;
    });
    const setBusy = value => {
        busy = value;
        dialog.querySelectorAll('[data-tool],[data-auto],[data-model],[data-target],[data-model-toggle],[data-model-option],[data-model-apply]').forEach(el => el.disabled = value);
        generate.disabled = value || !hasMask;
        dialog.querySelector('[data-undo]').disabled = value || !history?.undo;
        dialog.querySelector('[data-redo]').disabled = value || !history?.redo;
    };
    const renderMask = () => {
        const ctx = display.getContext('2d');
        ctx.clearRect(0,0,display.width,display.height);
        ctx.drawImage(image,0,0,display.width,display.height);
        const tint = document.createElement('canvas'); tint.width = mask.width; tint.height = mask.height;
        const tc = tint.getContext('2d'); tc.drawImage(mask,0,0); tc.globalCompositeOperation = 'source-in';
        const tile = document.createElement('canvas'); tile.width = tile.height = 24;
        const pc = tile.getContext('2d'); pc.fillStyle = '#7297ef'; pc.fillRect(0,0,24,24); pc.fillStyle = '#3c63b5'; pc.fillRect(0,0,12,12); pc.fillRect(12,12,12,12);
        tc.fillStyle = tc.createPattern(tile,'repeat'); tc.fillRect(0,0,mask.width,mask.height);
        ctx.globalAlpha = .53; ctx.drawImage(tint,0,0); ctx.globalAlpha = 1;
        if (!drawing) {
            const pixels = mask.getContext('2d').getImageData(0,0,mask.width,mask.height).data;
            hasMask = false;
            for (let i=3;i<pixels.length;i+=4) if (pixels[i]) { hasMask=true; break; }
        }
        setBusy(busy);
    };
    const fit = () => {
        if (!image) return;
        const scale = Math.min((stage.clientWidth-48)/display.width,(stage.clientHeight-32)/display.height,1) * zoom;
        surface.style.width = Math.max(1,display.width*scale)+'px';
        surface.style.height = Math.max(1,display.height*scale)+'px';
    };
    const resize = new ResizeObserver(fit); resize.observe(stage);
    dialog.querySelector('[data-close]').onclick = () => { if (!saving) dialog.close(); };
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.addEventListener('close', () => { closed=true;resize.disconnect();dialog.remove(); },{once:true});
    const menu=dialog.querySelector('.mask-model-menu'),modelToggle=dialog.querySelector('[data-model-toggle]');
    const showMenu=value=>{menu.hidden=!value;modelToggle.setAttribute('aria-expanded',String(value));};
    modelToggle.onclick=()=>showMenu(menu.hidden);
    dialog.addEventListener('click',event=>{if(!event.target.closest('.mask-model-picker'))showMenu(false);});
    const renderModels=()=>{
        const list=dialog.querySelector('.mask-model-options');list.innerHTML='';
        for(const option of model.options){
            const button=document.createElement('button');button.type='button';button.dataset.modelOption=option.value;
            button.textContent=option.text;button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String(model.value===option.value));button.disabled=busy;
            button.onclick=()=>{model.value=option.value;model.onchange();};list.appendChild(button);
        }
    };
    model.onchange = () => {
        dialog.querySelector('[data-model-name]').textContent=model.value==='auto'?'自动':model.value;
        dialog.querySelector('[data-target-label]').hidden=model.value!=='SAM3';renderModels();
        if(model.value==='SAM3'){showMenu(true);target.focus();}
        else{showMenu(false);autoSelect();}
    };
    const chooseTool = value => {
        tool=value; dialog.querySelectorAll('[data-tool]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.tool===value)));
    };
    dialog.querySelectorAll('[data-tool]').forEach(el=>el.onclick=()=>chooseTool(el.dataset.tool));
    const undo = delta => { if (!busy && !drawing && history?.move(delta)) renderMask(); };
    dialog.querySelector('[data-undo]').onclick=()=>undo(-1);
    dialog.querySelector('[data-redo]').onclick=()=>undo(1);
    dialog.addEventListener('keydown',event=>{
        event.stopPropagation(); // Mask editing must not trigger node deletion or canvas undo.
        if(event.key==='Escape'&&!menu.hidden){event.preventDefault();showMenu(false);modelToggle.focus();return;}
        if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
        if ((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z') {event.preventDefault();event.stopPropagation();undo(event.shiftKey?1:-1);}
        if (!busy && event.key.toLowerCase()==='b') chooseTool('brush');
        if (!busy && event.key.toLowerCase()==='e') chooseTool('erase');
    });
    stage.addEventListener('wheel',event=>{event.preventDefault();zoom=Math.max(.5,Math.min(4,zoom*(event.deltaY<0?1.1:1/1.1)));fit();},{passive:false});
    const point = event => { const r=display.getBoundingClientRect();return {x:(event.clientX-r.left)*mask.width/r.width,y:(event.clientY-r.top)*mask.height/r.height}; };
    const stroke = (from,to) => {
        const ctx=mask.getContext('2d');ctx.globalCompositeOperation=tool==='erase'?'destination-out':'source-over';
        ctx.strokeStyle=ctx.fillStyle='#fff';ctx.lineWidth=Number(size.value)*mask.width/display.getBoundingClientRect().width;
        ctx.lineCap=ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
        ctx.beginPath();ctx.arc(to.x,to.y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();ctx.globalCompositeOperation='source-over';
    };
    display.onpointerdown=event=>{
        if (busy || event.button!==0) return;event.preventDefault();display.setPointerCapture(event.pointerId);
        const p=point(event);drawing={start:p,last:p,before:tool==='rectangle'?mask.getContext('2d').getImageData(0,0,mask.width,mask.height):null};
        if(tool!=='rectangle') {stroke(p,p);renderMask();}
    };
    display.onpointermove=event=>{
        const r=display.getBoundingClientRect();cursor.hidden=busy||tool==='rectangle';cursor.style.width=cursor.style.height=size.value+'px';cursor.style.left=(event.clientX-r.left)+'px';cursor.style.top=(event.clientY-r.top)+'px';
        if(!drawing)return;const p=point(event);
        if(tool==='rectangle') {const ctx=mask.getContext('2d');ctx.putImageData(drawing.before,0,0);ctx.fillStyle='#fff';ctx.fillRect(Math.min(p.x,drawing.start.x),Math.min(p.y,drawing.start.y),Math.abs(p.x-drawing.start.x),Math.abs(p.y-drawing.start.y));}
        else stroke(drawing.last,p);
        drawing.last=p;renderMask();
    };
    const finish = event=>{if(!drawing)return;drawing=null;history.save();renderMask();if(display.hasPointerCapture(event.pointerId))display.releasePointerCapture(event.pointerId);};
    display.onpointerup=display.onpointercancel=finish;
    display.onpointerleave=()=>cursor.hidden=true;
    const autoSelect = async () => {
        if(busy||drawing)return;
        if(model.value==='SAM3'&&!target.value.trim()){showMenu(true);feedback.textContent='请输入需要保留的主体';target.focus();return;}
        const progress = dialog.querySelector('.mask-progress');
        progress.hidden=false;progress.removeAttribute('value');
        setBusy(true);feedback.textContent='正在自动识别主体…';
        try {
            const result=await ImageCutoutClient.run(source.url,source.prompt||'',{model:model.value,target:target.value.trim(),onProgress:state=>{
                if(closed)return;
                feedback.textContent=state.label||'正在识别…';
                if(Number.isFinite(state.value))progress.value=state.value;
                else progress.removeAttribute('value');
            }});
            if(closed)return;
            const cutout=await loadImage(result.url);if(closed)return;
            if(cutout.naturalWidth!==image.naturalWidth||cutout.naturalHeight!==image.naturalHeight)throw new Error('识别结果尺寸与原图不同，无法可靠对齐；请手动画选区');
            const ctx=mask.getContext('2d');ctx.clearRect(0,0,mask.width,mask.height);ctx.drawImage(cutout,0,0,mask.width,mask.height);
            ctx.globalCompositeOperation='source-in';ctx.fillStyle='#fff';ctx.fillRect(0,0,mask.width,mask.height);ctx.globalCompositeOperation='source-over';
            history.save();renderMask();feedback.textContent='蓝色区域将被保留，可用画笔补选、橡皮擦擦除';
        }catch(error){if(!closed)feedback.textContent=error.message+'；也可以手动画选区';}
        finally{progress.hidden=true;if(!closed)setBusy(false);}
    };
    dialog.querySelector('[data-auto]').onclick=autoSelect;
    dialog.querySelector('[data-model-apply]').onclick=()=>{if(target.value.trim())showMenu(false);autoSelect();};
    generate.onclick=async()=>{
        if(busy||!hasMask||drawing)return;saving=true;setBusy(true);dialog.querySelector('[data-close]').disabled=true;feedback.textContent='正在生成透明图片…';
        try{
            if(canvas?.id!==canvasId)throw new Error('画布已切换，请返回原画布后重试');
            const output=document.createElement('canvas');output.width=image.naturalWidth;output.height=image.naturalHeight;
            const ctx=output.getContext('2d');ctx.drawImage(image,0,0);ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0,output.width,output.height);
            const blob=await new Promise(resolve=>output.toBlob(resolve,'image/png'));if(!blob)throw new Error('透明图片生成失败');
            const file=await uploadCroppedBlob(blob,'cutout-'+Date.now()+'.png');if(!file?.url)throw new Error('图片保存失败，请重试');
            if(!insertCanvasCutoutResult({url:file.url,model:'选区编辑'},source,canvasId))throw new Error('画布已切换，结果已上传但未插入');
            dialog.close();
        }catch(error){if(!closed){saving=false;dialog.querySelector('[data-close]').disabled=false;feedback.textContent=error.message;setBusy(false);}}
    };
    setBusy(true);
    try{
        image=await loadImage(source.url);if(closed)return;
        if(image.naturalWidth*image.naturalHeight>32*1024*1024)throw new Error('图片超过3200万像素，请先缩小图片再抠图');
        const scale=Math.min(1,2048/Math.max(image.naturalWidth,image.naturalHeight));
        mask=document.createElement('canvas');mask.width=display.width=Math.max(1,Math.round(image.naturalWidth*scale));mask.height=display.height=Math.max(1,Math.round(image.naturalHeight*scale));
        history=createMaskHistory(mask);history.save();fit();renderMask();setBusy(false);
        renderModels();
        ImageCutoutClient.request('/api/image-cutout/models').then(data=>{if(!closed){for(const name of data.models||[])model.add(new Option(name,name));renderModels();}}).catch(error=>{if(!closed)feedback.textContent='模型列表读取失败：'+error.message;});
        await autoSelect();
    }catch(error){if(!closed){feedback.textContent=error.message;setBusy(true);}}
}
