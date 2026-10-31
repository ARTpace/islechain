// Both generation menus are portalled to body; compensate for its optional UI transform.
(function () {
    const tracked=new Map();
    let scheduled=false;
    function place(menu,anchor,options={}) {
        tracked.set(menu,{anchor,options});
        if(!menu.isConnected || !anchor.isConnected || !menu.getClientRects().length)return;
        const margin=12,gap=8;
        const bodyRect=document.body.getBoundingClientRect();
        const transformed=getComputedStyle(document.body).transform!=='none';
        const scale=transformed&&document.body.offsetWidth?bodyRect.width/document.body.offsetWidth:1;
        const originX=transformed?bodyRect.left:0,originY=transformed?bodyRect.top:0;
        const view=window.visualViewport;
        const leftEdge=view?.offsetLeft||0,topEdge=view?.offsetTop||0;
        const viewWidth=view?.width||window.innerWidth,viewHeight=view?.height||window.innerHeight;
        const r=anchor.getBoundingClientRect();
        const width=Math.min(options.width||320,viewWidth-margin*2);
        const above=Math.max(0,r.top-topEdge-gap-margin);
        const below=Math.max(0,topEdge+viewHeight-r.bottom-gap-margin);
        const available=Math.min(Math.max(above,below),viewHeight-margin*2);
        Object.assign(menu.style,{
            position:'fixed',margin:'0',bottom:'auto',right:'auto',
            width:width/scale+'px',maxWidth:width/scale+'px',
            maxHeight:Math.max(1,available)/scale+'px',overflowY:'auto'
        });
        // 用 offsetHeight（布局高度）而非 getBoundingClientRect，避免菜单缩放动画影响测量
        const height=menu.offsetHeight;
        const openUp=options.preferAbove&&above>=height || above>below;
        const left=Math.max(leftEdge+margin,Math.min(leftEdge+viewWidth-width-margin,options.align==='end'?r.right-width:r.left));
        const top=Math.max(topEdge+margin,Math.min(topEdge+viewHeight-height-margin,openUp?r.top-gap-height:r.bottom+gap));
        menu.style.left=(left-originX)/scale+'px';
        menu.style.top=(top-originY)/scale+'px';
    }
    function schedule(event) {
        if(event?.type==='scroll' && [...tracked.keys()].some(menu=>menu===event.target||menu.contains(event.target)))return;
        if(scheduled)return;
        scheduled=true;requestAnimationFrame(()=>{
            scheduled=false;
            for(const [menu,{anchor,options}] of tracked) {
                if(!menu.isConnected){tracked.delete(menu);continue;}
                place(menu,anchor,options);
            }
        });
    }
    window.GenerationMenuPosition={place};
    window.addEventListener('resize',schedule);
    window.addEventListener('scroll',schedule,true);
    window.addEventListener('studio-ui-scale-change',schedule);
    window.visualViewport?.addEventListener('resize',schedule);
    window.visualViewport?.addEventListener('scroll',schedule);
    document.addEventListener('DOMContentLoaded',()=>{
        const composer=document.getElementById('generationComposer');
        if(composer)new ResizeObserver(schedule).observe(composer);
    });
})();
