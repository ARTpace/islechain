/* 工作区只等正文就绪，不增加最短播放时间，也不等待图片等次要资源。 */
(function(){
    const stage=document.querySelector('.stage');
    const shell=document.getElementById('workspace-loading');
    if(!stage||!shell)return;
    const states=new WeakMap();
    let active=null;
    function done(frame,loaded=false){
        const state=states.get(frame);
        if(!state)return;
        // 忽略 about:blank 以及导航前旧页面发来的就绪消息。
        try{
            const href=frame.contentWindow.location.href;
            if(href==='about:blank'||(!loaded&&href!==new URL(state.src,location.href).href))return;
        }catch(e){if(!loaded)return;}
        state.ready=true;
        frame.classList.remove('workspace-waiting');
        if(frame===active){shell.classList.remove('is-visible');stage.setAttribute('aria-busy','false');}
    }
    window.WorkspaceLoading={
        forget(frame){const state=states.get(frame);if(state)state.ready=false;},
        activate(frame){
            active=frame;
            if(!frame){shell.classList.remove('is-visible');stage.setAttribute('aria-busy','false');return;}
            const src=frame.getAttribute('src')||frame.dataset.src;
            let state=states.get(frame);
            // load 兜底允许正常跳转（例如登录页），不能让加载层遮住跳转结果。
            if(!state){frame.addEventListener('load',()=>done(frame,true));}
            if(!state||state.src!==src){state={src,ready:false};states.set(frame,state);}
            frame.classList.toggle('workspace-waiting',!state.ready);
            shell.classList.toggle('is-visible',!state.ready);
            stage.setAttribute('aria-busy',String(!state.ready));
        }
    };
    window.addEventListener('message',event=>{
        if(event.origin!==location.origin||event.data?.type!=='studio-page-ready')return;
        if(active&&event.source===active.contentWindow)done(active);
    });
})();
