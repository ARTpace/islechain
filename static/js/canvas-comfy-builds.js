/* Durable work runs on the server; this panel only presents node packages, installs and test records.
   The ledger lives in the workflow transfer panel — the chat panel no longer owns it. */
(() => {
    'use strict';
    let host=null,timer=0,loading=false,currentCanvas='';
    const testingPlugins=new Set();
    const STATUS_KIND={passed:'ok',succeeded:'ok',draft:'idle',prepared:'idle',cancelled:'idle',failed:'fail',uncertain:'warn',staged:'warn',verification_required:'warn',restart_required:'warn',queued:'busy',submitting:'busy',installing:'busy',restarting:'busy',running:'busy',paused:'warn'};
    const INSTALL_STATE={prepared:'版本已固定，待授权安装',queued:'等待安装',submitting:'提交安装中',installing:'Manager 正在安装或下载',succeeded:'安装完成，仍需推理测试',restart_required:'安装完成，需重启原 ComfyUI 实例后验证',restarting:'受管实例重启与验证中',verification_required:'下载结束，等待加载器验证',staged:'仅暂存代码，依赖尚未安装',failed:'安装失败',uncertain:'安装结果待核对，请勿重复提交',paused:'请恢复原实例'};
    const BUILD_STATE={draft:'已校验，尚未测试',queued:'等待测试',submitting:'正在提交测试',running:'正在真实运行',succeeded:'技术测试通过',failed:'测试失败',uncertain:'提交状态待核对',paused:'等待恢复原实例',cancelled:'已停止监控'};
    const PLUGIN_STATE={draft:'待测试',passed:'执行测试通过',failed:'执行测试失败'};
    async function api(body,canvasId){
        const url='/api/mcp/comfy-builds'+(body?'':'?canvas_id='+encodeURIComponent(canvasId));
        const response=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json','X-Art-MCP':'1'},body:JSON.stringify({...body,canvasId})}:{});
        const value=await response.json();if(!response.ok)throw new Error(typeof value.detail==='string'?value.detail:'工作流构建请求失败');return value;
    }
    async function prepare(fields,canvasId){
        const artifact=await api({action:'publish',buildId:fields.comfyBuildId,revision:fields.comfyRevision},canvasId);
        const response=await fetch('/api/workflows');if(!response.ok)throw new Error('工作流目录刷新失败');
        const data=await response.json();comfyWorkflows=data.workflows||[];
        if(!comfyWorkflows.some(item=>item.name===artifact.workflowName))throw new Error('已发布工作流未出现在目录中');
        delete comfyWorkflowCache[artifact.workflowName];
        if(!await ensureComfyWorkflow(artifact.workflowName))throw new Error('工作流配置读取失败');
        const catalog=await window.CanvasNodeCatalog?.load();
        if(artifact.nodeDefinition)artifact.definitionHash=catalog?.hashes?.[`${artifact.nodeDefinition.typeId}@${artifact.nodeDefinition.version}`];
        return artifact;
    }
    function configure(node,artifact,fields){
        node.mode='custom';node.comfyWorkflow=artifact.workflowName;node.comfyParams={...artifact.params};
        node.comfyBuildId=fields.comfyBuildId;node.comfyRevision=fields.comfyRevision;
        if(artifact.nodeDefinition){
            node.comfyNodeDefinition=JSON.parse(JSON.stringify(artifact.nodeDefinition));
            node.comfyDefinitionHash=artifact.definitionHash;
            node.name=artifact.nodeDefinition.title;
        }
    }
    async function adopt(record){
        const canvasId=canvas?.id;if(!canvasId)throw new Error('请先打开画布');
        const fields={comfyBuildId:record.id,comfyRevision:record.revision},artifact=await prepare(fields,canvasId);
        if(canvas?.id!==canvasId)throw new Error('画布已切换，请回原画布采用构建');
        const existing=nodes.find(node=>node.comfyBuildId===record.id&&node.comfyRevision===record.revision);
        if(existing){focusCreatedNode(existing);return;}
        pushUndo();const node=createNodeByType('comfy',defaultPoint());configure(node,artifact,fields);render();scheduleSave();focusCreatedNode(node);
    }
    /* ---------- view helpers ---------- */
    function ensureHost(){
        if(host && host.isConnected)return host;
        host=document.getElementById('nodePackageRecords');
        return host;
    }
    function panelOpen(){
        return !!document.getElementById('workflowTransferModal')?.classList.contains('open');
    }
    function element(tag,className,text){
        const node=document.createElement(tag);
        if(className)node.className=className;
        if(text!=null)node.textContent=text;
        return node;
    }
    function button(label,action,variant){
        const node=element('button','node-record-btn'+(variant?' '+variant:''),label);
        node.type='button';
        node.onclick=async()=>{node.disabled=true;try{await action();}catch(error){alert(error.message);}finally{node.disabled=false;}};
        return node;
    }
    function recordCard({title,state,kind,notes=[],images=[],primary,more=[]}){
        const card=element('article','node-record');
        const head=element('div','node-record-head');
        head.append(element('strong','node-record-title',title));
        head.append(element('span','node-record-state is-'+(kind||'idle'),state));
        card.append(head);
        for(const note of notes.filter(Boolean))card.append(element('p','node-record-note',note));
        const shots=images.slice(0,4);
        if(shots.length){
            const strip=element('div','node-record-shots');
            for(const shot of shots){const image=document.createElement('img');image.src=shot.src;image.alt=shot.alt;image.loading='lazy';strip.append(image);}
            card.append(strip);
        }
        if(primary||more.length){
            const actions=element('div','node-record-actions');
            if(primary)actions.append(button(primary.label,primary.run,'primary'));
            if(more.length){
                const box=element('details','node-record-more');
                box.append(element('summary',null,'更多'));
                const list=element('div','node-record-more-list');
                for(const item of more)list.append(button(item.label,item.run));
                box.append(list);
                actions.append(box);
            }
            card.append(actions);
        }
        return card;
    }
    function pluginCard(record,canvasId){
        const simulated=record.executionKind==='host.http'&&record.status==='passed';
        const state=simulated?'模拟响应测试通过（未联网）':(PLUGIN_STATE[record.status]||record.status);
        const images=(record.report?.results||[]).flatMap(result=>(result.images||[]).map(output=>({src:output.url,alt:`候选测试 ${result.index+1} · ${output.width}×${output.height}`})));
        const testing=testingPlugins.has(record.id);
        const runTest=async()=>{
            const worker=record.executionKind==='worker.python';
            if(worker&&!confirm('此 Python worker 不是操作系统沙箱，可访问当前用户文件、网络并创建进程。请先通过“查看候选与报告”审阅代码，只对可信代码和依赖包授权。'+((record.dependencies||[]).length?'\n将从PyPI下载并安装到当前账号的独立目录，不改宿主或ComfyUI：\n'+record.dependencies.map(item=>item.name+'=='+item.version).join('\n'):'')))return;
            testingPlugins.add(record.id);await refresh();
            try{await api({action:'plugin-test',candidateId:record.id,trustedCode:worker},canvasId);}
            finally{testingPlugins.delete(record.id);await refresh();}
        };
        const install=async()=>{
            const artifact=await api({action:'plugin-install',candidateId:record.id,revision:record.revision},canvasId);
            await window.CanvasNodeCatalog.load();if(canvas?.id!==canvasId)throw new Error('画布已切换，插件已安装，可从菜单创建');
            const existing=nodes.find(node=>node.pluginCandidateId===record.id);if(existing){focusCreatedNode(existing);return;}
            pushUndo();const node=window.CanvasNodeCatalog.create(defaultPoint());window.CanvasNodeCatalog.initialize(node,artifact.definition);
            node.pluginCandidateId=record.id;render();scheduleSave();focusCreatedNode(node);
        };
        const more=[{label:'查看候选与报告',run:async()=>{
            const detail=await api({action:'plugin-get',candidateId:record.id},canvasId),dialog=document.createElement('dialog');
            dialog.style.cssText='max-width:80vw;max-height:80vh;overflow:auto;';
            const code=document.createElement('pre');code.textContent=JSON.stringify(detail,null,2);code.style.whiteSpace='pre-wrap';
            dialog.append(code,button('关闭',()=>{dialog.close();dialog.remove();}));document.body.append(dialog);dialog.showModal();
        }}];
        if(record.dependencies?.length)more.push({label:'查看独立依赖环境',run:async()=>{
            const detail=await api({action:'plugin-environment',candidateId:record.id},canvasId),dialog=document.createElement('dialog');dialog.style.cssText='max-width:80vw;max-height:80vh;overflow:auto;';
            const text=document.createElement('pre');text.textContent=JSON.stringify(detail,null,2);text.style.whiteSpace='pre-wrap';dialog.append(text,button('关闭',()=>{dialog.close();dialog.remove();}));document.body.append(dialog);dialog.showModal();
        }});
        if(record.status==='passed')more.push({label:record.dependencies?.length?'准备环境并重新测试':'重新运行候选测试',run:runTest});
        if(record.status==='passed')more.push({label:'导出节点包',run:async()=>{
            const artifact=await api({action:'plugin-export',candidateId:record.id,revision:record.revision},canvasId);
            const data=Uint8Array.from(atob(artifact.package),character=>character.charCodeAt(0)),url=URL.createObjectURL(new Blob([data],{type:'application/zip'}));
            const link=document.createElement('a');link.href=url;link.download=artifact.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }});
        let primary=null;
        if(testing)primary={label:'取消候选测试',run:async()=>{await api({action:'plugin-cancel',candidateId:record.id},canvasId);}};
        else if(record.status==='passed')primary={label:'安装并放入画布',run:install};
        else primary={label:record.dependencies?.length?'准备环境并重新测试':'运行候选测试',run:runTest};
        return recordCard({title:record.title+' · 节点插件',state,kind:STATUS_KIND[record.status]||'idle',
            notes:[record.report?.scope||''],images,primary,more});
    }
    function installCard(record,canvasId){
        const reconcile=async()=>{await api({action:'install-reconcile',installId:record.id},canvasId);await refresh();};
        const cancel=async()=>{await api({action:'install-cancel',installId:record.id},canvasId);await refresh();};
        const busy=['queued','submitting','installing','restarting'].includes(record.status);
        const more=[];
        if(['failed','cancelled'].includes(record.status))more.push({label:'核对后重新准备（需再次授权）',run:async()=>{await api({action:'install-retry',installId:record.id},canvasId);await refresh();}});
        if(busy)more.push({label:'停止监控（不全局中断安装）',run:cancel});
        let primary=null;
        if(record.status==='prepared')primary={label:'授权并安装可信插件',run:async()=>{
            if(record.approvedRevision!==record.revision&&!confirm(record.risk+'\n\n实例：'+record.instance+'\n'+record.packages.map(item=>item.id+'@'+item.version+'\n'+item.repository).join('\n')))return;
            await api({action:'install-start',installId:record.id,revision:record.revision,trustedCode:true},canvasId);await refresh();
        }};
        else if(record.status==='restart_required')primary={label:'重启受管实例并验证',run:async()=>{await api({action:'install-restart',installId:record.id},canvasId);await refresh();}};
        else if(['failed','uncertain','staged','verification_required'].includes(record.status))primary={label:record.downloadPolicy?'重新校验文件和加载器':'核对版本和注册',run:reconcile};
        const model=record.kind==='model';
        const state=(model?({succeeded:'模型枚举验证通过，仍需推理测试',failed:'下载失败'}[record.status]):'')||INSTALL_STATE[record.status]||record.status;
        const receipt=record.downloadReceipt?.verified?`模型 SHA256 已验证 · ${record.downloadReceipt.bytes} 字节${record.downloadReceipt.recheckedAt?' · 已重新核对本机文件':''}`:'';
        return recordCard({title:(model?'模型下载 · ':'插件安装 · ')+record.packages.map(item=>item.id+' '+item.version).join('、'),
            state,kind:STATUS_KIND[record.status]||'idle',
            notes:[record.error||'',receipt],primary,more});
    }
    function buildCard(record,canvasId){
        const images=(record.report?.outputs||[]).map(output=>({src:output.preview+'&w=256',alt:`测试输出 ${output.width}×${output.height}`}));
        let primary=null;
        if(record.status==='succeeded')primary={label:'放入画布',run:()=>adopt(record)};
        else if(['draft','queued','submitting','running','paused','uncertain'].includes(record.status))primary={label:'停止测试监控',run:async()=>{await api({action:'cancel',buildId:record.id},canvasId);await refresh();}};
        return recordCard({title:record.title,state:BUILD_STATE[record.status]||record.status,kind:STATUS_KIND[record.status]||'idle',
            notes:[record.error||'',record.report?.scope||''],images,primary});
    }
    /* ---------- data ---------- */
    async function refresh(){
        clearTimeout(timer);
        if(loading||!ensureHost()||!panelOpen()||!canvas?.id)return;
        loading=true;
        const canvasId=canvas.id;
        try{
            const {builds=[],installs=[],plugins=[]}=await api(null,canvasId);
            if(canvas?.id!==canvasId)return;
            if(currentCanvas!==canvasId){currentCanvas=canvasId;host.replaceChildren();}
            const fragment=document.createDocumentFragment();
            for(const record of plugins)fragment.append(pluginCard(record,canvasId));
            for(const record of installs)fragment.append(installCard(record,canvasId));
            for(const record of builds)fragment.append(buildCard(record,canvasId));
            if(!plugins.length&&!installs.length&&!builds.length)fragment.append(element('p','node-package-empty','还没有记录。导入节点包后，候选测试、安装进度和真实测试结果都会留在这里。'));
            host.replaceChildren(fragment);
            const busy=builds.some(record=>['queued','submitting','running'].includes(record.status))||installs.some(record=>['queued','submitting','installing','restarting'].includes(record.status));
            if(busy&&panelOpen())timer=setTimeout(refresh,4000);
        }catch(error){
            if(host)host.replaceChildren(element('p','node-package-error',error.message));
        }finally{
            loading=false;
            if(canvas?.id!==canvasId&&panelOpen())timer=setTimeout(refresh,0);
        }
    }
    function importPackage(){
        const canvasId=canvas?.id;
        if(!canvasId){alert('请先打开画布');return;}
        const input=document.createElement('input');input.type='file';input.accept='.artnode,.zip';
        input.onchange=async()=>{
            try{
                const file=input.files?.[0];if(!file)return;if(file.size>262144)throw new Error('节点包不能超过 256 KiB');
                const bytes=new Uint8Array(await file.arrayBuffer()),encoded=btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join(''));
                await api({action:'plugin-import',package:encoded},canvasId);
                if(canvas?.id!==canvasId)throw new Error('画布已切换，候选保留在原画布');
                await refresh();
            }catch(error){alert(error.message);}
        };
        input.click();
    }
    function mount(){return ensureHost();}
    function changed(){if(panelOpen())refresh();}
    function hide(){clearTimeout(timer);}
    window.CanvasComfyBuilds={mount,prepare,configure,changed,hide,refresh,importPackage,adopt};
})();
