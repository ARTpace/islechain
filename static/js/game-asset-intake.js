/* 素材接入复用项目媒体API；不发起模型调用。 */
(() => {
    'use strict';
    const extensions=new Set(['png','jpg','jpeg','webp','mp3','wav','ogg','glb']);
    const suffix=name=>String(name||'').split('.').pop().toLowerCase();
    const supported=name=>extensions.has(suffix(name));
    const safeURL=value=>{
        try{
            const url=new URL(value,location.origin);
            if(url.protocol==='blob:'&&url.origin===location.origin)return url.href;
            return url.origin===location.origin && /^\/(?:assets\/|output\/|api\/game-projects\/)/.test(url.pathname)?url.href:null;
        }catch{return null;}
    };
    async function json(url,options={}){
        const response=await fetch(url,options),value=await response.json();
        if(!response.ok)throw Error(typeof value.detail==='string'?value.detail:'素材接入失败，请刷新后重试');
        return value;
    }
    async function upload(projectId,files,notify=()=>{}){
        if(files.length>200)throw Error('一次最多接入200个文件，请分批选择。');
        let project=(await json('/api/game-projects/'+encodeURIComponent(projectId))).project;
        const result={added:0,reused:0,skipped:[],failed:[]};
        for(const [index,item] of files.entries()){
            const file=item.file||item,name=file.name;
            const path=file.webkitRelativePath||name;
            if(!supported(name)||path.split('/').some(part=>['.git','node_modules','__pycache__'].includes(part)||part.startsWith('.env'))){result.skipped.push(name);continue;}
            const limit=(suffix(name)==='glb'?100:32)*1024*1024;
            if(!file.size||file.size>limit){result.failed.push(name+'：文件为空或超出大小上限');continue;}
            notify('正在接入 '+name+'…');
            try{
                const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('文件读取失败'));reader.readAsDataURL(file);});
                const value=await json(`/api/game-projects/${encodeURIComponent(projectId)}/workspace/media-assets`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:project.revision,filename:name,purpose:item.purpose||path,contentBase64:encoded,...(item.sourceKey?{sourceKey:item.sourceKey}:{})})});
                project=value.project;result[value.reusedAssetId?'reused':'added']++;
            }catch(error){
                result.failed.push(name+'：'+error.message);
                result.remaining=files.length-index-1;
                // 版本冲突后停止，保留已经成功的文件，避免后续每项重复失败。
                break;
            }
        }
        result.project=project;return result;
    }
    async function fromRefs(projectId,refs,notify){
        if(refs.length>200)throw Error('一次最多选择200项素材。');
        const files=[],failed=[];
        for(const ref of refs){
            const url=safeURL(ref.url);
            if(!url){failed.push((ref.name||'素材')+'：只接入本工具中可访问的本地素材');continue;}
            try{
                const response=await fetch(url);
                if(!response.ok)throw Error('文件读取失败');
                if(Number(response.headers.get('content-length'))>100*1024*1024)throw Error('文件超过100MiB');
                const blob=await response.blob();
                if(blob.size>100*1024*1024)throw Error('文件超过100MiB');
                const ext=({ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','audio/ogg':'ogg','model/gltf-binary':'glb'})[blob.type.split(';')[0]];
                let name=String(ref.name||decodeURIComponent(new URL(url).pathname.split('/').pop())||'素材');
                if(!supported(name)&&ext)name+='.'+ext;
                files.push({file:new File([blob],name,{type:blob.type}),sourceKey:ref.sourceKey,purpose:ref.purpose||ref.name});
            }catch(error){failed.push((ref.name||'素材')+'：'+error.message);}
        }
        const result=await upload(projectId,files,notify);result.failed.push(...failed);return result;
    }
    function summary(result){
        return `已接入 ${result.added} 项，复用 ${result.reused} 项`+(result.skipped.length?`；跳过 ${result.skipped.length} 个非支持文件`:'')+(result.failed.length?`；失败：${result.failed.join('；')}`:'')+(result.remaining?`；还有 ${result.remaining} 项未提交`:'')+'。已接入素材会随下次开发提供给 AI。';
    }
    function selectedRefs(){
        if(typeof nodes==='undefined'||typeof selected==='undefined')return [];
        const found=new Map(),p=window.GamePipeline?.project;
        for(const node of nodes.filter(n=>selected.has(n.id))){
            const modelNode=['gameModelAsset','gameModel3d','gameAnimate3d'].includes(node.type);
            let refs=!modelNode&&typeof imageRefsFromNode==='function'?imageRefsFromNode(node):[];
            if(node.type==='model3d'&&node.url)refs=[...refs,{url:node.url,name:node.name||'模型.glb'}];
            if(node.type==='image'&&node.url&&!refs.length)refs=[{url:node.url,name:node.name}];
            if(node.type==='output')refs=[...refs,...(node.images||[]).map(item=>({url:typeof outputUrlValue==='function'?outputUrlValue(item):typeof item==='string'?item:item.url,name:typeof item==='object'?item.name:''})).filter(r=>r.url)];
            refs.push(...(node.generatedOutputs||[]).map(item=>({url:typeof outputUrlValue==='function'?outputUrlValue(item):typeof item==='string'?item:item.url,name:typeof item==='object'?item.name:''})).filter(r=>r.url));
            const owned=p?.mediaAssets?.find(a=>a.id===(node.modelAssetId||node.audioAssetId));
            if(owned)refs.push({url:`/api/game-projects/${p.id}/workspace/media-assets/${owned.id}/content`,name:owned.name,purpose:owned.purpose});
            refs.forEach((ref,index)=>{if(ref.url&&!found.has(ref.url))found.set(ref.url,{...ref,purpose:ref.purpose||node.name||ref.name,sourceKey:`canvas:${typeof canvas!=='undefined'?canvas.id:''}:${node.id}:${index}`});});
        }
        return [...found.values()];
    }
    async function droppedFiles(transfer){
        const entries=[...(transfer.items||[])].map(item=>item.webkitGetAsEntry?.()).filter(Boolean);
        if(!entries.some(e=>e.isDirectory))return [...transfer.files];
        const files=[];
        async function walk(entry,depth=0){
            if(depth>24||files.length>=200)throw Error('文件夹过大，请选择较小的素材目录（最多200个文件）。');
            if(['.git','node_modules','__pycache__'].includes(entry.name)||entry.name.startsWith('.env'))return;
            if(entry.isFile){files.push(await new Promise((resolve,reject)=>entry.file(resolve,reject)));return;}
            const reader=entry.createReader();let children;
            while((children=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject))).length)for(const child of children)await walk(child,depth+1);
        }
        for(const entry of entries)await walk(entry);return files;
    }
    window.GameAssetIntake={supported,safeURL,upload,fromRefs,summary,selectedRefs,droppedFiles};
    const toolbar=document.getElementById('gameProjectToggle');
    if(toolbar){
        const button=document.createElement('button');button.type='button';button.className=toolbar.className;button.textContent='用选中素材做游戏';button.title='选中图片、生成结果、音频或模型节点后点击';toolbar.after(button);
        button.onclick=async()=>{
            const refs=selectedRefs();if(!refs.length){alert('先在画布上选中要用于游戏的素材节点。');return;}
            button.disabled=true;
            try{
                const p=await window.GamePipeline.ensureProject();
                const result=await fromRefs(p.id,refs,message=>{button.textContent=message;});
                await window.GamePipeline.canvasLoaded();
                if(result.failed.length||result.skipped.length)alert(summary(result));
                if(result.added||result.reused)window.GameDevelopment.openWorkbench(p.id);
            }catch(error){alert(error.message);}
            finally{button.disabled=false;button.textContent='用选中素材做游戏';}
        };
    }
})();
