// Version data belongs to the image node and is saved / undone with the existing canvas state.
const expandedImageVersions=new Set();

function imageVersionSnapshot(node,id,label) {
    return {id,url:node.url,name:node.name||label,label,prompt:node.prompt||'',natural_w:node.natural_w,natural_h:node.natural_h,createdAt:Date.now()};
}

function selectImageVersion(nodeId,versionId) {
    const node=nodes.find(item=>item.id===nodeId);
    const version=node?.imageVersions?.find(item=>item.id===versionId);
    if(!version||node.url===version.url)return false;
    pushUndo();
    node.url=version.url;node.name=version.name||'图片';node.prompt=version.prompt||'';
    node.imageEditDraft=version.prompt||'';
    delete node.natural_w;delete node.natural_h;delete node._naturalSizeLoading;
    if(version.natural_w&&version.natural_h){node.natural_w=version.natural_w;node.natural_h=version.natural_h;}
    selected.clear();selected.add(node.id);
    render();scheduleSave();return true;
}

function mountImageVersions(element,node) {
    const versions=node.imageVersions;
    if(!versions?.length)return;
    const key=canvas.id+':'+node.id;
    const expanded=expandedImageVersions.has(key);
    const preview=element.querySelector('.image-preview-wrap');
    if(!preview)return;
    const toggle=document.createElement('button');
    const versionCount=versions.length+(node.imageComposerPending?1:0);
    toggle.type='button';toggle.className='image-version-toggle';
    toggle.textContent=versionCount+' ⌄';
    toggle.title='查看图片历史版本';toggle.setAttribute('aria-label','历史记录 '+versionCount);
    toggle.setAttribute('aria-expanded',String(expanded));
    const changeExpanded=value=>{value?expandedImageVersions.add(key):expandedImageVersions.delete(key);render();};
    toggle.onclick=event=>{event.stopPropagation();changeExpanded(!expanded);};
    preview.appendChild(toggle);
    if(!expanded)return;
    element.classList.add('image-history-expanded');
    element.style.setProperty('--image-object-height',element.style.height||'336px');
    element.style.height='auto';
    const history=document.createElement('section');history.className='image-version-history';
    history.setAttribute('aria-label','图片历史版本');
    const heading=document.createElement('header');
    const title=document.createElement('span');title.textContent='历史记录 '+versionCount;
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','收起图片历史');close.onclick=()=>changeExpanded(false);
    heading.append(title,close);history.appendChild(heading);
    if(node.imageComposerPending){
        const pending=document.createElement('div');
        pending.className='image-version-pending';
        pending.dataset.canvasComposerProgress=node.imageComposerPending.id;
        history.appendChild(pending);
        clearCanvasComposerProgressView();
        const progress=canvasComposerProgressView=CardProgress.attach(pending);
        progress.update(canvasComposerProgress.get(node.imageComposerPending.id)||{status:'online',label:'已停止跟踪，请到文生图生成历史查看结果',progress:null});
    }
    if(node.imageComposerError){const error=document.createElement('p');error.className='image-version-error';error.textContent=node.imageComposerError;history.appendChild(error);}
    for(const [index,version] of [...versions].reverse().entries()){
        const item=document.createElement('button');item.type='button';item.className='image-version-item';
        const active=node.url===version.url;
        item.setAttribute('aria-pressed',String(active));
        item.setAttribute('aria-label',active?'当前图片':version.id==='original'?'恢复原图':'使用生成版本 '+(versions.length-index));
        const img=document.createElement('img');img.src=canvasDisplayMediaUrl(version.url,version.name||'');img.alt=version.id==='original'?'编辑前原图':'生成的图片';img.loading='lazy';img.draggable=false;
        const label=document.createElement('span');label.textContent=active?'当前图片':version.id==='original'?'原图 · 点击恢复':'生成版本 · 点击替换';
        item.append(img,label);item.onclick=()=>selectImageVersion(node.id,version.id);history.appendChild(item);
    }
    ['mousedown','pointerdown','click','dblclick','wheel'].forEach(type=>history.addEventListener(type,event=>event.stopPropagation()));
    element.querySelector('.node-body').appendChild(history);
}
