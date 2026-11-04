/* Durable work runs on the server; the chat only presents progress and adoption. */
(() => {
    'use strict';
    let host=null,panelRef=null,timer=0,loading=false;
    const testingPlugins=new Set();
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
        return artifact;
    }
    function configure(node,artifact,fields){
        node.mode='custom';node.comfyWorkflow=artifact.workflowName;node.comfyParams={...artifact.params};
        node.comfyBuildId=fields.comfyBuildId;node.comfyRevision=fields.comfyRevision;
    }
    function button(label,action){const b=document.createElement('button');b.type='button';b.textContent=label;b.className='menu-btn';b.onclick=async()=>{b.disabled=true;try{await action();}catch(error){alert(error.message);}finally{b.disabled=false;}};return b;}
    async function adopt(record){
        const canvasId=canvas?.id;if(!canvasId)throw new Error('请先打开画布');
        const fields={comfyBuildId:record.id,comfyRevision:record.revision},artifact=await prepare(fields,canvasId);
        if(canvas?.id!==canvasId)throw new Error('画布已切换，请回原画布采用构建');
        const existing=nodes.find(node=>node.comfyBuildId===record.id&&node.comfyRevision===record.revision);
        if(existing){focusCreatedNode(existing);return;}
        pushUndo();const node=createNodeByType('comfy',defaultPoint());configure(node,artifact,fields);render();scheduleSave();focusCreatedNode(node);
    }
    async function refresh(){
        clearTimeout(timer);if(loading||!host?.open||panelRef?.hidden||!canvas?.id)return;
        loading=true;const canvasId=canvas.id,content=host.querySelector('[data-build-content]');
        try{
            const {builds,installs=[],plugins=[]}=await api(null,canvasId);if(canvas?.id!==canvasId)return;
            content.replaceChildren();
            if(!builds.length&&!installs.length&&!plugins.length){const note=document.createElement('p');note.textContent='在对话中描述节点需求，这里保留插件候选、安装和真实测试记录。';content.append(note);}
            for(const record of plugins){
                const card=document.createElement('article');card.className='canvas-agent-message';
                const title=document.createElement('strong');title.textContent=record.title+' · 节点插件';card.append(title);
                const state=document.createElement('p');state.textContent=record.executionKind==='host.http'&&record.status==='passed'?'模拟响应测试通过（未联网）':({draft:'待测试',passed:'执行测试通过',failed:'执行测试失败'})[record.status]||record.status;card.append(state);
                if(record.report){const scope=document.createElement('p');scope.textContent=record.report.scope;card.append(scope);
                    for(const result of (record.report.results||[]).slice(0,8))for(const output of result.images||[]){const image=document.createElement('img');image.src=output.url;image.alt=`候选测试 ${result.index+1} · ${output.width}×${output.height}`;image.style.maxWidth='100%';image.loading='lazy';card.append(image);}}
                if(!testingPlugins.has(record.id)&&(record.status==='draft'||record.status==='failed'||record.status==='passed'&&record.dependencies?.length))card.append(button(record.status==='passed'?'准备环境并重新测试':'运行候选测试',async()=>{
                    const worker=record.executionKind==='worker.python';
                    if(worker&&!confirm('此 Python worker 不是操作系统沙箱，可访问当前用户文件、网络并创建进程。请先通过“查看候选与报告”审阅代码，只对可信代码和依赖包授权。'+((record.dependencies||[]).length?'\n将从PyPI下载并安装到当前账号的独立目录，不改宿主或ComfyUI：\n'+record.dependencies.map(item=>item.name+'=='+item.version).join('\n'):'')))return;
                    testingPlugins.add(record.id);await refresh();
                    try{await api({action:'plugin-test',candidateId:record.id,trustedCode:worker},canvasId);}
                    finally{testingPlugins.delete(record.id);await refresh();}
                }));
                if(testingPlugins.has(record.id))card.append(button('取消候选测试',async()=>{await api({action:'plugin-cancel',candidateId:record.id},canvasId);}));
                if(record.dependencies?.length)card.append(button('查看独立依赖环境',async()=>{
                    const detail=await api({action:'plugin-environment',candidateId:record.id},canvasId),dialog=document.createElement('dialog');dialog.style.cssText='max-width:80vw;max-height:80vh;overflow:auto;';
                    const text=document.createElement('pre');text.textContent=JSON.stringify(detail,null,2);text.style.whiteSpace='pre-wrap';dialog.append(text,button('关闭',()=>{dialog.close();dialog.remove();}));document.body.append(dialog);dialog.showModal();
                }));
                card.append(button('查看候选与报告',async()=>{
                    const detail=await api({action:'plugin-get',candidateId:record.id},canvasId),dialog=document.createElement('dialog');
                    dialog.style.cssText='max-width:80vw;max-height:80vh;overflow:auto;';
                    const code=document.createElement('pre');code.textContent=JSON.stringify(detail,null,2);code.style.whiteSpace='pre-wrap';
                    dialog.append(code,button('关闭',()=>{dialog.close();dialog.remove();}));document.body.append(dialog);dialog.showModal();
                }));
                if(record.status==='passed')card.append(button('安装并放入画布',async()=>{
                    const artifact=await api({action:'plugin-install',candidateId:record.id,revision:record.revision},canvasId);
                    await window.CanvasNodeCatalog.load();if(canvas?.id!==canvasId)throw new Error('画布已切换，插件已安装，可从菜单创建');
                    const existing=nodes.find(node=>node.pluginCandidateId===record.id);if(existing){focusCreatedNode(existing);return;}
                    pushUndo();const node=window.CanvasNodeCatalog.create(defaultPoint());window.CanvasNodeCatalog.initialize(node,artifact.definition);
                    node.pluginCandidateId=record.id;render();scheduleSave();focusCreatedNode(node);
                }));
                if(record.status==='passed')card.append(button('导出节点包',async()=>{
                    const artifact=await api({action:'plugin-export',candidateId:record.id,revision:record.revision},canvasId);
                    const data=Uint8Array.from(atob(artifact.package),character=>character.charCodeAt(0)),url=URL.createObjectURL(new Blob([data],{type:'application/zip'}));
                    const link=document.createElement('a');link.href=url;link.download=artifact.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
                }));
                content.append(card);
            }
            for(const record of installs){
                const card=document.createElement('article');card.className='canvas-agent-message';
                const title=document.createElement('strong');title.textContent=(record.kind==='model'?'模型下载 · ':'插件安装 · ')+record.packages.map(item=>item.id+' '+item.version).join('、');card.append(title);
                const status=document.createElement('p');status.textContent=({prepared:'版本已固定，待授权安装',queued:'等待安装',submitting:'提交安装中',installing:'Manager 正在安装或下载',succeeded:record.kind==='model'?'模型枚举验证通过，仍需推理测试':'节点注册验证通过',restart_required:'安装完成，需重启原 ComfyUI 实例后验证',restarting:'受管实例重启与验证中',verification_required:'下载结束，等待加载器验证',staged:'仅暂存代码，依赖尚未安装',failed:'安装失败',uncertain:'安装结果待核对，请勿重复提交',paused:'请恢复原实例'})[record.status]||record.status;card.append(status);
                if(record.error){const error=document.createElement('p');error.textContent=record.error;card.append(error);}
                if(record.status==='prepared')card.append(button('授权并安装可信插件',async()=>{
                    if(record.approvedRevision!==record.revision&&!confirm(record.risk+'\n\n实例：'+record.instance+'\n'+record.packages.map(item=>item.id+'@'+item.version+'\n'+item.repository).join('\n')))return;
                    await api({action:'install-start',installId:record.id,revision:record.revision,trustedCode:true},canvasId);await refresh();
                }));
                if(record.downloadReceipt?.verified){const receipt=document.createElement('p');receipt.textContent=`模型SHA256已验证 · ${record.downloadReceipt.bytes} 字节${record.downloadReceipt.recheckedAt?' · 已重新核对本机文件':''}`;card.append(receipt);}
                if(['failed','uncertain','restart_required','staged','verification_required'].includes(record.status))card.append(button(record.downloadPolicy?'重新校验文件和加载器':'核对版本和注册',async()=>{await api({action:'install-reconcile',installId:record.id},canvasId);await refresh();}));
                if(['failed','cancelled'].includes(record.status))card.append(button('核对后重新准备（需再次授权）',async()=>{await api({action:'install-retry',installId:record.id},canvasId);await refresh();}));
                if(record.status==='restart_required')card.append(button('重启受管实例并验证',async()=>{await api({action:'install-restart',installId:record.id},canvasId);await refresh();}));
                if(['queued','submitting','installing','restarting'].includes(record.status))card.append(button('停止监控（不全局中断安装）',async()=>{await api({action:'install-cancel',installId:record.id},canvasId);await refresh();}));
                content.append(card);
            }
            for(const record of builds){
                const card=document.createElement('article');card.className='canvas-agent-message';
                const title=document.createElement('strong');title.textContent=record.title;card.append(title);
                const status=document.createElement('p');status.textContent=({draft:'已校验，尚未测试',queued:'等待测试',submitting:'正在提交测试',running:'正在真实运行',succeeded:'技术测试通过',failed:'测试失败',uncertain:'提交状态待核对',paused:'等待恢复原实例',cancelled:'已停止监控'})[record.status]||record.status;card.append(status);
                if(record.error){const error=document.createElement('p');error.textContent=record.error;card.append(error);}
                if(record.report){const scope=document.createElement('p');scope.textContent=record.report.scope;card.append(scope);for(const output of record.report.outputs||[]){const image=document.createElement('img');image.src=output.preview+'&w=256';image.alt=`测试输出 ${output.width}×${output.height}`;image.style.maxWidth='100%';image.loading='lazy';card.append(image);}}
                if(record.status==='succeeded')card.append(button('放入画布',()=>adopt(record)));
                if(['draft','queued','submitting','running','paused','uncertain'].includes(record.status))card.append(button('停止测试监控',async()=>{await api({action:'cancel',buildId:record.id},canvasId);await refresh();}));
                content.append(card);
            }
            if(host.open&&!panelRef.hidden&&(builds.some(record=>['queued','submitting','running'].includes(record.status))||installs.some(record=>['queued','submitting','installing','restarting'].includes(record.status))))timer=setTimeout(refresh,4000);
        }catch(error){content.textContent=error.message;}
        finally{loading=false;if(canvas?.id!==canvasId&&host.open&&!panelRef.hidden)timer=setTimeout(refresh,0);}
    }
    function mount(panel){
        if(host)return;
        panelRef=panel;
        host=document.createElement('details');host.style.maxHeight='32vh';host.style.overflow='auto';host.style.padding='8px 20px';
        const summary=document.createElement('summary');summary.textContent='节点插件、安装与工作流测试';
        const content=document.createElement('div');content.dataset.buildContent='1';
        host.append(summary,button('刷新构建记录',refresh),button('导入节点包',()=>{
            const canvasId=canvas?.id;if(!canvasId)throw new Error('请先打开画布');
            const input=document.createElement('input');input.type='file';input.accept='.artnode,.zip';
            input.onchange=async()=>{try{
                const file=input.files?.[0];if(!file)return;if(file.size>262144)throw new Error('节点包不能超过 256 KiB');
                const bytes=new Uint8Array(await file.arrayBuffer()),encoded=btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join(''));
                await api({action:'plugin-import',package:encoded},canvasId);if(canvas?.id!==canvasId)throw new Error('画布已切换，候选保留在原画布');
                host.open=true;await refresh();
            }catch(error){alert(error.message);}};input.click();
        }),content);panel.querySelector('.canvas-agent-header').after(host);
        host.ontoggle=()=>{if(host.open)refresh();else clearTimeout(timer);};
    }
    function changed(show=false){if(show&&host)host.open=true;if(host?.open)refresh();}
    function hide(){clearTimeout(timer);}
    window.CanvasComfyBuilds={mount,prepare,configure,changed,hide};
})();
