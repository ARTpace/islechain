/* 开发入口内直接接入素材；无需先编辑清单或逐项声明用途。 */
(() => {
    'use strict';
    const $=id=>document.getElementById(id), intake=window.GameAssetIntake;
    const projectId=new URLSearchParams(location.search).get('projectId');
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(projectId||''))return;
    let busy=false,project;
    const status=message=>{$('materialStatus').textContent=message;};
    async function refresh(){
        const response=await fetch('/api/game-projects/'+projectId),value=await response.json();
        if(!response.ok)throw Error('游戏素材读取失败');
        project=value.project;
        const assets=[...(project.assets||[]).filter(a=>a.usage==='runtime'&&a.selected).map(a=>({...a,kind:'image',url:`/api/game-projects/${projectId}/assets/${a.id}/image`})),...(project.mediaAssets||[]).filter(a=>a.enabled).map(a=>({...a,imported:true,url:`/api/game-projects/${projectId}/workspace/media-assets/${a.id}/content`}))];
        $('materialCount').textContent=`游戏素材 · ${assets.length} 项供 AI 使用`;
        $('materialList').replaceChildren();
        for(const asset of assets){
            const tile=document.createElement('div');tile.className='material-tile';tile.title=asset.purpose||asset.name;
            if(asset.kind==='image'){const img=document.createElement('img');img.src=asset.url;img.alt=asset.name;img.loading='lazy';tile.append(img);}
            else{const symbol=document.createElement('span');symbol.className='material-symbol';symbol.textContent=asset.kind==='audio'?'♫':'3D';tile.append(symbol);}
            const name=document.createElement('span');name.className='material-name';name.textContent=asset.name;tile.append(name);
            if(asset.imported){
                const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','不再提供给 AI：'+asset.name);
                remove.onclick=()=>void perform(async()=>{
                    const response=await fetch(`/api/game-projects/${projectId}/workspace/media-assets/${asset.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:project.revision,enabled:false,purpose:asset.purpose})});
                    const value=await response.json();if(!response.ok)throw Error(typeof value.detail==='string'?value.detail:'修改失败，请刷新后重试');
                    return '已从 AI 使用范围移出，原文件与历史版本保留。';
                });tile.append(remove);
            }
            $('materialList').append(tile);
        }
    }
    async function perform(operation){
        if(busy)return;
        if(!document.dispatchEvent(new Event('game-native-before-operation',{cancelable:true}))){status('请先保存源码或数值草稿，再调整素材。');return;}
        busy=true;$('gameMaterials').setAttribute('aria-busy','true');
        $('gameMaterials').querySelectorAll('button,input').forEach(el=>el.disabled=true);
        try{
            const result=await operation();
            await refresh();
            status(typeof result==='string'?result:intake.summary(result));
            document.dispatchEvent(new Event('game-assets-changed'));
        }catch(error){status(error.message);}
        finally{busy=false;$('gameMaterials').setAttribute('aria-busy','false');$('gameMaterials').querySelectorAll('button,input').forEach(el=>el.disabled=false);}
    }
    const addFiles=files=>perform(()=>intake.upload(projectId,[...files],status));
    $('materialFilesButton').onclick=()=>$('materialFiles').click();
    $('materialFolderButton').onclick=()=>$('materialFolder').click();
    for(const id of ['materialFiles','materialFolder'])$(id).onchange=()=>{if($(id).files.length)void addFiles($(id).files);$(id).value='';};
    try{
        if(window.parent!==window&&window.parent.GameAssetIntake){
            $('materialCanvasButton').hidden=false;
            $('materialCanvasButton').onclick=()=>void perform(async()=>{
                const refs=window.parent.GameAssetIntake.selectedRefs();
                if(!refs.length)throw Error('返回画布选中素材节点，再点击此按钮。');
                return intake.fromRefs(projectId,refs,status);
            });
        }
    }catch{/* 独立来源不读取父页面。 */}
    const zone=$('gameMaterials');
    zone.addEventListener('dragover',event=>{event.preventDefault();event.stopPropagation();zone.classList.add('drag-over');});
    zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
    zone.addEventListener('drop',event=>{
        event.preventDefault();event.stopPropagation();zone.classList.remove('drag-over');
        const transfer=event.dataTransfer;
        // 必须在drop事件尚有效时取得目录入口与内部拖拽数据。
        const files=intake.droppedFiles(transfer).then(value=>({value}),error=>({error}));
        let ref=null;
        try{ref=JSON.parse(transfer.getData('application/x-canvas-asset')||'null');}catch{}
        if(!ref){const url=transfer.getData('application/x-canvas-output-image');if(url)ref={url};}
        void perform(async()=>{
            const collected=await files;if(collected.error)throw collected.error;
            const entries=collected.value;
            if(entries.length)return intake.upload(projectId,entries,status);
            if(ref?.url)return intake.fromRefs(projectId,[ref],status);
            throw Error('请拖入图片、音频、GLB，或包含这些素材的文件夹。');
        });
    });
    document.addEventListener('game-native-before-operation',event=>{if(busy)event.preventDefault();});
    void refresh().catch(error=>status(error.message));
})();
