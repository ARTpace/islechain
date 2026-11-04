// ponytail: tags are ordinary node data; navigation uses the existing viewport and undo stack.
const IMAGE_TAG_COLORS=[{id:'cyan',name:'青绿色',hex:'#09bfd0'},{id:'blue',name:'蓝色',hex:'#6b78ff'},{id:'purple',name:'紫色',hex:'#ba60f5'},{id:'orange',name:'橙色',hex:'#ff922e'},{id:'yellow',name:'黄色',hex:'#ffd600'}];
let canvasColorNavigatorOpen=false;
let canvasColorNavigatorFilter='all';

function taggedImageGroups(items) {
    return IMAGE_TAG_COLORS.map(color=>({...color,items:items.filter(node=>node.colorTag===color.id)})).filter(group=>group.items.length);
}

function setImageColorTag(nodeId,color) {
    const node=nodes.find(item=>item.id===nodeId);
    if(!node||(color&&!IMAGE_TAG_COLORS.some(item=>item.id===color))||(node.colorTag||'')===color)return false;
    pushUndo();
    if(color)node.colorTag=color;else delete node.colorTag;
    const element=document.querySelector?.(`.node[data-id="${CSS.escape(node.id)}"]`);
    if(element){element.querySelector('.image-color-marker')?.remove();element.querySelector('.image-color-palette')?.remove();mountImageColorTag(element,node);}
    render();scheduleSave();return true;
}

function focusTaggedImage(nodeId) {
    const node=nodes.find(item=>item.id===nodeId);
    if(!node)return false;
    selected.clear();selected.add(node.id);
    render();
    const box=estimatedNodeRect(node);
    const dockHeight=document.getElementById('imageEditComposer')?.offsetHeight||0;
    const fit=Math.min((board.clientWidth-120)/box.w,Math.max(120,board.clientHeight-dockHeight-100)/box.h,1);
    viewport.scale=Math.max(.1,fit);
    centerViewportOnWorldPoint({x:box.x+box.w/2,y:box.y+box.h/2+dockHeight/(2*viewport.scale)});
    scheduleSave();return true;
}

function mountImageColorTag(element,node) {
    const controls=element.querySelector('.node-head > div');
    const marker=document.createElement('button');marker.type='button';marker.className='image-color-marker';
    const color=IMAGE_TAG_COLORS.find(item=>item.id===node.colorTag);
    marker.setAttribute('aria-label',color?'颜色标记：'+color.name:'设置颜色标记');marker.title=marker.getAttribute('aria-label');
    marker.setAttribute('aria-expanded','false');
    if(color){marker.style.setProperty('--image-tag-color',color.hex);marker.classList.add('tagged');}
    marker.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 13 13 20a2 2 0 0 1-3 0l-7-7V4h9l8 6a2 2 0 0 1 0 3Z"/><circle cx="7.5" cy="8" r="1"/></svg>';
    controls.prepend(marker);
    marker.onclick=event=>{
        event.stopPropagation();
        const existing=element.querySelector('.image-color-palette');
        if(existing){existing.remove();marker.setAttribute('aria-expanded','false');return;}
        document.querySelectorAll('.image-color-palette').forEach(item=>item.remove());
        const palette=document.createElement('div');palette.className='image-color-palette';palette.setAttribute('role','menu');palette.setAttribute('aria-label','卡片颜色标记');
        for(const option of [{id:'',name:'取消标记',hex:'transparent'},...IMAGE_TAG_COLORS]){
            const button=document.createElement('button');button.type='button';button.title=option.name;button.setAttribute('aria-label',option.name);button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String((node.colorTag||'')===option.id));button.style.setProperty('--image-tag-color',option.hex);button.textContent=option.id?'':'∅';
            button.onclick=e=>{e.stopPropagation();if(!setImageColorTag(node.id,option.id)){palette.remove();marker.setAttribute('aria-expanded','false');}};
            palette.appendChild(button);
        }
        palette.onmousedown=e=>e.stopPropagation();
        palette.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();palette.remove();marker.setAttribute('aria-expanded','false');marker.focus();}};
        element.querySelector('.node-head').appendChild(palette);marker.setAttribute('aria-expanded','true');
    };
}

function renderCanvasColorNavigator() {
    let nav=document.getElementById('canvasColorNavigator');
    if(!nav){
        nav=document.createElement('div');nav.id='canvasColorNavigator';nav.className='canvas-color-navigator editor-only';
        document.querySelector('.topbar').appendChild(nav);
        ['mousedown','pointerdown','click','wheel'].forEach(type=>nav.addEventListener(type,event=>event.stopPropagation()));
        document.addEventListener('click',event=>{
            if(!nav.contains(event.target)&&canvasColorNavigatorOpen){canvasColorNavigatorOpen=false;renderCanvasColorNavigator();}
        });
        nav.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();canvasColorNavigatorOpen=false;renderCanvasColorNavigator();}});
    }
    const focused=nav.contains(document.activeElement)?document.activeElement?.dataset.navFocus:null;
    nav.innerHTML='';
    const groups=taggedImageGroups(nodes);
    const dots=document.createElement('div');dots.className='color-nav-dots';dots.setAttribute('role','toolbar');dots.setAttribute('aria-label','画布颜色标记');
    const togglePanel=filter=>{canvasColorNavigatorOpen=!(canvasColorNavigatorOpen&&canvasColorNavigatorFilter===filter);canvasColorNavigatorFilter=filter;renderCanvasColorNavigator();};
    for(const group of groups){
        const button=document.createElement('button');button.type='button';button.className='color-nav-dot';
        button.setAttribute('aria-label',group.name+'，'+group.items.length+'个节点');button.title=group.name;
        button.setAttribute('aria-expanded',String(canvasColorNavigatorOpen&&canvasColorNavigatorFilter===group.id));
        button.dataset.navFocus=group.id;button.style.setProperty('--image-tag-color',group.hex);
        const dot=document.createElement('span');button.appendChild(dot);button.onclick=()=>togglePanel(group.id);dots.appendChild(button);
    }
    if(!groups.length){
        const empty=document.createElement('button');empty.type='button';empty.className='color-nav-icon';empty.textContent='◇';empty.title='暂无颜色标记';empty.setAttribute('aria-label','暂无颜色标记');empty.onclick=()=>togglePanel('all');dots.appendChild(empty);
    }
    nav.appendChild(dots);
    const iconButton=(label,path,action)=>{
        const button=document.createElement('button');button.type='button';button.className='color-nav-icon';button.title=label;button.setAttribute('aria-label',label);
        button.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+path+'</svg>';
        button.onclick=action;nav.appendChild(button);
    };
    iconButton('搜索图片','<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',()=>togglePanel('search'));
    iconButton('画布日志','<circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/>',event=>openCanvasLog(event));
    if(canvasColorNavigatorOpen){
        const panel=document.createElement('section');panel.className='color-nav-panel';panel.setAttribute('aria-label','按颜色定位节点');
        const group=groups.find(item=>item.id===canvasColorNavigatorFilter);
        const search=canvasColorNavigatorFilter==='search';
        const heading=document.createElement('h3');heading.textContent=search?'搜索图片':group?group.name+' '+group.items.length:'暂无颜色标记';panel.appendChild(heading);
        const list=document.createElement('div');list.className='color-nav-results';panel.appendChild(list);
        const renderItems=query=>{
            list.innerHTML='';
            const items=search?nodes.filter(node=>node.type==='image'&&node.url&&String(node.name||'图片').toLowerCase().includes(query.toLowerCase())):(group?.items||[]);
            if(!items.length){const empty=document.createElement('p');empty.textContent=search?'未找到图片':'在节点右上角添加颜色标记后，可在这里快速定位';list.appendChild(empty);}
            items.forEach((node,index)=>{
                const item=document.createElement('button');item.type='button';item.className='color-nav-item';
                const thumb=document.createElement('div');thumb.className='color-nav-thumb';
                const img=document.createElement(node.type==='image'&&node.url?'img':'span');if(node.type==='image'&&node.url){img.src=canvasDisplayMediaUrl(node.url,node.name||'');img.alt='';img.loading='lazy';}else{img.textContent=node.type==='prompt'?'T':'◇';}
                const number=document.createElement('span');number.className='color-nav-number';number.textContent=index+1;thumb.append(img,number);
                const text=document.createElement('div');const name=document.createElement('span');name.textContent=node.name||node.title||document.querySelector(`.node[data-id="${CSS.escape(node.id)}"] .node-title`)?.textContent||'节点';
                const subtitle=document.createElement('small');subtitle.textContent=node.type==='image'?'图片':'节点';text.append(name,subtitle);item.append(thumb,text);item.onclick=()=>focusTaggedImage(node.id);list.appendChild(item);
            });
        };
        if(search){const input=document.createElement('input');input.type='search';input.placeholder='搜索图片名称';input.setAttribute('aria-label','搜索图片名称');input.dataset.navFocus='search';input.oninput=()=>renderItems(input.value);panel.insertBefore(input,list);}
        renderItems('');nav.appendChild(panel);
    }
    if(focused)nav.querySelector('[data-nav-focus="'+focused+'"]')?.focus();
}
