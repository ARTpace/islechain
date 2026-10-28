// ponytail: present the existing model menus together; their handlers remain the source of truth.
(function () {
    function init() {
        const composer=document.getElementById('generationComposer');
        const row=composer?.querySelector('.gen-row');
        if(!row)return;
        const trigger=document.createElement('button');
        trigger.type='button';trigger.className='anima-ctrl generation-options-trigger';
        trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','generationOptionsPanel');
        const panel=document.createElement('section');
        const modelWrap=document.getElementById('unifiedModelWrap');
        const modelAnchor=document.createComment('model selector desktop position');
        if(modelWrap)modelWrap.before(modelAnchor);
        const phone=window.matchMedia('(max-width:600px)');
        panel.id='generationOptionsPanel';panel.className='generation-options-panel';panel.hidden=true;
        panel.setAttribute('aria-label','图片生成参数');
        row.insertBefore(trigger,row.firstChild);
        (document.documentElement.classList.contains('canvas-composer-embed')?composer:document.body).appendChild(panel);
        let pending=false,choosing=false;
        const observer=new MutationObserver(()=>{
            if(pending)return;
            pending=true;requestAnimationFrame(()=>{pending=false;sync();});
        });
        const observe=()=>['animaControls','cloudGenControls','batchCountWrap'].forEach(id=>{
            const host=document.getElementById(id);
            if(host)observer.observe(host,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','disabled']});
        });
        const label=element=>(element.querySelector('.dd-label')?.textContent||element.textContent).replace(/✓/g,'').trim();
        function groups() {
            const cloud=document.documentElement.classList.contains('engine-cloud');
            const host=document.getElementById(cloud?'cloudGenControls':'animaControls');
            const result=[];
            for(const menu of host?.querySelectorAll('.anima-ctrl-menu')||[]){
                const button=menu.parentElement.querySelector('button');
                if(!button || !menu.querySelector('.anima-ctrl-menu-item'))continue;
                const id=menu.id.toLowerCase();
                const title=id.includes('ratio')?'选择比例':id.includes('res')||id.includes('size')?'选择分辨率':id.includes('count')?'选择生成数量':id.includes('quality')?'质量参数':id.includes('provider')?'生成渠道':'模型参数';
                result.push({menu,button,title,ratio:id.includes('ratio')});
            }
            const batch=document.getElementById('batchCountWrap');
            if(batch && !(cloud && document.documentElement.classList.contains('website-model'))){
                result.push({menu:document.getElementById('batchCountMenu'),button:document.getElementById('batchCountBtn'),title:'选择生成数量'});
            }
            return result.sort((a,b)=>['选择比例','选择分辨率','质量参数','选择生成数量','生成渠道','模型参数'].indexOf(a.title)-['选择比例','选择分辨率','质量参数','选择生成数量','生成渠道','模型参数'].indexOf(b.title));
        }
        function place() {
            if(panel.hidden)return;
            if(document.documentElement.classList.contains('canvas-composer-embed'))return;
            GenerationMenuPosition.place(panel,trigger,{width:520,preferAbove:true,align:'end'});
        }
        function sync() {
            observer.disconnect();
            composer.querySelectorAll('.generation-options-source').forEach(el=>el.classList.remove('generation-options-source'));
            const entries=groups();
            trigger.hidden=!entries.length;
            trigger.textContent=entries.map(entry=>label(entry.button)).filter(Boolean).join(' · ')+'  ⌃';
            const ratio=entries.find(entry=>entry.ratio);
            const pair=ratio?label(ratio.button).split(':').map(Number):[];
            if(pair.length===2 && pair.every(n=>Number.isFinite(n)&&n>0)){
                const icon=document.createElement('span');icon.className='generation-options-ratio-icon';
                icon.setAttribute('aria-hidden','true');
                icon.style.width=Math.max(6,18*Math.min(1,pair[0]/pair[1]))+'px';
                icon.style.height=Math.max(6,18*Math.min(1,pair[1]/pair[0]))+'px';
                trigger.prepend(icon);
            }
            trigger.setAttribute('aria-label','生成参数：'+entries.map(entry=>label(entry.button)).join('，'));
            const focused=panel.contains(document.activeElement)?document.activeElement?.dataset.optionKey:null;
            panel.replaceChildren();
            if(modelWrap){
                if(phone.matches){
                    const section=document.createElement('div');section.className='generation-options-section generation-options-model';
                    const heading=document.createElement('h3');heading.textContent='选择模型';
                    section.append(heading,modelWrap);panel.appendChild(section);
                }else modelAnchor.after(modelWrap);
            }
            entries.forEach(({menu,button,title,ratio})=>{
                button.classList.add('generation-options-source');
                const section=document.createElement('div');section.className='generation-options-section';
                const heading=document.createElement('h3');heading.textContent=title;section.appendChild(heading);
                const options=document.createElement('div');options.className='generation-options-segments'+(ratio?' is-ratio':'');
                const current=label(button);
                const items=Array.from(menu.querySelectorAll('.anima-ctrl-menu-item'));
                if(ratio)items.sort((a,b)=>{
                    const aspect=item=>{const [w,h]=label(item).split(':').map(Number);return w/h||0;};
                    return aspect(b)-aspect(a);
                });
                items.forEach((item,index)=>{
                    const option=document.createElement('button');option.type='button';
                    const text=label(item);option.dataset.optionKey=menu.id+':'+index;
                    option.setAttribute('aria-pressed',String(text===current));
                    option.disabled=button.disabled||item.getAttribute('aria-disabled')==='true'||item.hasAttribute('disabled');
                    if(ratio){
                        const pair=text.split(':').map(Number);
                        if(pair.length===2 && pair.every(n=>Number.isFinite(n)&&n>0)){
                            const icon=document.createElement('span');icon.className='generation-options-ratio-icon';
                            icon.style.width=Math.max(7,20*Math.min(1,pair[0]/pair[1]))+'px';
                            icon.style.height=Math.max(7,20*Math.min(1,pair[1]/pair[0]))+'px';option.appendChild(icon);
                        }
                    }
                    const caption=document.createElement('span');caption.textContent=text.replace(/^×/,'');option.appendChild(caption);
                    option.onclick=event=>{
                        event.stopPropagation();choosing=true;
                        try{item.click();}finally{choosing=false;}
                        sync();
                    };
                    options.appendChild(option);
                });
                section.appendChild(options);panel.appendChild(section);
            });
            if(focused)Array.from(panel.querySelectorAll('button')).find(el=>el.dataset.optionKey===focused)?.focus({preventScroll:true});
            place();observe();
        }
        function close() {window.closeUnifiedModelMenu?.();panel.hidden=true;trigger.setAttribute('aria-expanded','false');}
        trigger.onclick=event=>{event.stopPropagation();panel.hidden=!panel.hidden;trigger.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)sync();};
        document.addEventListener('click',event=>{if(!choosing&&!panel.contains(event.target)&&!trigger.contains(event.target))close();});
        document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){close();trigger.focus();}});
        window.addEventListener('resize',place);
        phone.addEventListener('change',()=>{window.closeUnifiedModelMenu?.();sync();});
        // Engine classes change outside the composer; resync when switching local/API models.
        let engineKey='';
        new MutationObserver(()=>{
            const key=['engine-cloud','website-model'].map(name=>document.documentElement.classList.contains(name)).join(':');
            if(key!==engineKey){engineKey=key;sync();}
        }).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
        sync();
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
