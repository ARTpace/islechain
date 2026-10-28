// Loaded only by the canvas embed; all controls and generation still belong to zimage.html.
(function () {
    if(new URLSearchParams(location.search).get('canvasComposer')!=='1' || parent===window)return;
    let context=null,active=null,loading=false;
    const send=data=>parent.postMessage(data,location.origin);
    const prompt=document.getElementById('prompt');
    const button=document.getElementById('mainGenBtn');
    const reportHeight=()=>{
        const composer=document.getElementById('generationComposer');
        send({type:'canvas-composer-height',height:Math.ceil(composer?.getBoundingClientRect().bottom||220)});
    };
    new ResizeObserver(reportHeight).observe(document.getElementById('generationComposer'));
    const originalProgress=CardProgress.update;
    CardProgress.update=function(card,status){
        originalProgress(card,status);
        if(active)send({type:'canvas-composer-progress',requestId:active.id,progress:status});
    };
    window.addEventListener('message',async event=>{
        if(event.origin!==location.origin||event.source!==parent||event.data?.type!=='canvas-composer-select'||active)return;
        const selection=event.data;
        context=selection;loading=true;button.disabled=true;
        try{
            initRefImageManager();
            const response=await fetch(selection.url);
            if(!response.ok)throw new Error('参考图片加载失败');
            const blob=await response.blob();
            if(context!==selection)return;
            const manager=window._refImgMgr;
            manager.clear();
            manager.addFiles([new File([blob],selection.name||'reference.png',{type:blob.type||'image/png'})]);
            prompt.value=selection.prompt||'';
            prompt.dispatchEvent(new Event('input',{bubbles:true}));
        }catch(error){
            if(context!==selection)return;
            context=null;
            alert(error.message);
        }finally{if(context===selection||context===null){loading=false;button.disabled=!context;reportHeight();}}
    });
    prompt.addEventListener('input',()=>{
        if(context&&!active)send({type:'canvas-composer-draft',canvasId:context.canvasId,nodeId:context.nodeId,prompt:prompt.value});
    });
    const originalRender=window.handleRender;
    window.handleRender=async function(...args){
        if(active||loading||!context)return;
        if(!String(prompt.value||'').trim()){prompt.focus();return;}
        const run={id:crypto.randomUUID(),failed:false,completed:false};active=run;
        send({type:'canvas-composer-start',requestId:run.id,canvasId:context.canvasId,nodeId:context.nodeId,prompt:prompt.value});
        try{await originalRender.apply(this,args);}
        catch(error){run.error=error.message;}
        finally{
            send({type:'canvas-composer-finish',requestId:run.id,error:run.error||(!run.completed?'生成未完成，请检查模型配置或生成历史':'')});
            active=null;reportHeight();
        }
    };
    window.addEventListener('studio-gen-complete',event=>{
        if(!active)return;active.completed=true;
        send({type:'canvas-composer-result',requestId:active.id,record:event.detail?.record});
    });
    window.addEventListener('studio-gen-failed',event=>{if(active)active.error=event.detail?.message||'生成失败';});
    button.disabled=true;
    send({type:'canvas-composer-ready'});
    reportHeight();
})();
