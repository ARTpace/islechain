/* Conversation video uses the shared video task API; image settings remain separate. */
window.ChatVideo = (() => {
    let providers=[], loaded=false, mode='image';
    let settings={provider_id:'',model:'',duration:5,aspect_ratio:'16:9',resolution:'720p'};
    try {settings={...settings,...JSON.parse(localStorage.getItem('chat_video_settings')||'{}')};}catch(_){}
    function isRequest(text) {
        const value=String(text||'');
        if(/(?:不要|不用|无需|别).{0,8}(?:生成|制作|视频|动画)|只.{0,6}(?:描述|提示词|脚本|代码)|(?:怎么|如何|能否|能不能|可以吗|支持吗|能.*吗)/.test(value))return false;
        return /(?:生成|制作|做|拍|来|出|转成|变成).{0,30}(?:视频|动画|短片)|(?:视频|动画|短片).{0,12}(?:生成|制作)|让.{0,30}(?:动起来|跑起来|跳起来)|\b(?:generate|create|make|animate)\b.{0,40}\b(?:video|animation|clip)\b/i.test(value);
    }
    function wants(text) {return isRequest(text) || (mode==='video' && !/(?:不要|不用|无需|只.{0,6}(?:描述|提示词|代码)|怎么|如何|生成.{0,20}(?:图片|图像|照片)|[?？])/.test(text||''));}
    function needsReference(text) {return /动起来|跑起来|跳起来|这张|这个|这只|刚才|上一张|图生视频|animate|this image/i.test(text||'');}
    function persist(){try{localStorage.setItem('chat_video_settings',JSON.stringify(settings));}catch(_) {}}
    function setMode(value){mode=value==='video'?'video':'image';paintControls();}
    async function load() {
        const response=await fetch('/api/chat-video/models');
        const data=await response.json();if(!response.ok)throw new Error(data.detail||'加载视频模型失败');
        providers=data.providers||[];loaded=true;
        let provider=providers.find(p=>p.id===settings.provider_id && p.models.includes(settings.model));
        if(!provider){provider=providers[0];settings.provider_id=provider?.id||'';settings.model=provider?.models[0]||'';}
        paintControls();return providers;
    }
    function validate(spec, current=settings) {
        if(!spec || typeof spec.prompt!=='string' || !spec.prompt.trim())throw new Error('视频描述不能为空');
        const next={...current}, params=spec.params||{};
        for(const [key,value] of Object.entries(params)) {
            if(key==='duration') {if(!Number.isInteger(value)||value<1||value>60)throw new Error('视频时长需为 1–60 秒');next.duration=value;}
            else if(key==='ratio'||key==='aspect_ratio') {if(!['16:9','9:16','1:1','4:3','3:4','21:9','9:21'].includes(value))throw new Error('视频比例不支持');next.aspect_ratio=value;}
            else if(key==='resolution') {if(!['','480p','720p','1080p'].includes(value))throw new Error('视频分辨率支持 Auto、480p、720p、1080p');next.resolution=value;}
            else throw new Error('视频暂不支持参数：'+key);
        }
        if(!next.provider_id||!next.model)throw new Error('请在 API 设置中启用视频模型，再选择视频模型');
        return {prompt:spec.prompt.trim(),...next};
    }
    function guide(requested) {
        return '\n视频生成规则：用户明确要求生成视频、动画或让参考图动起来时，使用 VIDEO {"prompt":"完整动作、场景、镜头描述","params":{"duration":5,"ratio":"16:9","resolution":"720p"}}，最后单独一行输出，不要代码块，不要 IMAGE。视频与图片参数分开；视频 params 仅可用 duration（1–60整数秒）、ratio、resolution（Auto为空串、480p/720p/1080p），只修改本轮明确要求的字段，不支持的参数不要编造。当前视频设置：'+JSON.stringify(settings)+'。'+(requested?'本轮明确为视频任务，禁止输出图片指令。':'普通聊天或只写脚本/提示词时不要提交视频。')+' 若没有视频模型，应提示用户在 API 设置启用视频模型。实际能力以上游模型为准，不能声称视频已经生成。';
    }
    function readSpec(raw, requested, control) {
        if(!requested)return null;
        if(control && ['VIDEO','IMAGE'].includes(control.kind) && control.value?.prompt)return control.value;
        let text=String(raw||'').trim();const fence=text.match(/^(`{3,}|~{3,})(?:json)?\s*\n([\s\S]*?)\n\1\s*$/i);
        if(fence)text=fence[2];
        try{const data=JSON.parse(text);return typeof data?.prompt==='string' && data.prompt.trim()?data:null;}catch(_){return null;}
    }
    function mountVideo(host, url) {
        if(!url || !/^(?:\/output\/|\/assets\/|https?:\/\/)/i.test(url))return;
        if([...host.querySelectorAll('video')].some(video=>video.getAttribute('src')===url))return;
        const card=document.createElement('div');card.className='chat-video-card';
        const video=document.createElement('video');video.controls=true;video.preload='metadata';video.playsInline=true;video.src=url;
        const download=document.createElement('a');download.href=url;download.download='';download.textContent='下载视频';download.target='_blank';download.rel='noopener noreferrer';
        card.append(video,download);host.appendChild(card);return card;
    }
    function pending(host) {
        const card=document.createElement('div');card.className='chat-video-pending chat-gen-media';card.dataset.pending='video';
        const [w,h]=String(settings.aspect_ratio||'16:9').split(':');card.style.aspectRatio=w+' / '+h;
        if(typeof CardProgress!=='undefined'){CardProgress.attach(card);CardProgress.update(card,{status:'online',label:'视频生成中',progress:null});}
        else card.textContent='视频生成中…';
        host.appendChild(card);return card;
    }
    const delay=(signal)=>new Promise((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new DOMException('已停止等待，视频任务可能仍在继续','AbortError'));};
        const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},1500);
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    });
    async function poll(taskId, signal, onProgress) {
        for(let i=0;i<1200;i++) {
            const response=await fetch('/api/chat-video/tasks/'+encodeURIComponent(taskId),{signal});
            const task=await response.json();if(!response.ok)throw new Error(task.detail||'查询视频任务失败');
            if(task.status==='succeeded')return task.result;
            if(task.status==='failed')throw new Error(task.error||'视频生成失败');
            onProgress?.(task.progress||{});await delay(signal);
        }
        throw new Error('视频等待超时，可重新打开对话查看后台结果');
    }
    async function generate(host, spec, refs, task, binding, onComplete) {
        if(!loaded)await load();
        const body=task.videoBody||validate(spec);
        const provider=providers.find(p=>p.id===body.provider_id && p.models.includes(body.model));
        if(!provider)throw new Error('视频模型已禁用，请重新选择');
        const images=task.videoBody?.images||refs||[];
        if(images.length && !provider.image_to_video)throw new Error('此视频通道尚未接入图生视频，请选择其他视频模型');
        if(provider.protocol==='openai' && images.length>1)throw new Error('此视频接口一次支持一张参考图');
        body.images=images;Object.assign(body,binding);
        settings={...settings,provider_id:body.provider_id,model:body.model,duration:body.duration,aspect_ratio:body.aspect_ratio,resolution:body.resolution};persist();setMode('video');
        task.engine='cloud';task.videoBody=JSON.parse(JSON.stringify(body));
        task.setStage('');const card=pending(host);
        try {
            task.check();
            const response=await fetch('/api/chat-video/tasks',{method:'POST',headers:{'Content-Type':'application/json'},signal:task.controller.signal,body:JSON.stringify(body)});
            const created=await response.json();if(!response.ok)throw new Error(created.detail||'提交视频失败');
            task.videoTaskId=created.task_id;
            const result=await poll(created.task_id,task.controller.signal,progress=>{
                if(typeof CardProgress!=='undefined')CardProgress.update(card,{status:'online',label:'视频生成中',progress:typeof progress.progress==='number'?progress.progress:null});
            });
            task.check();if(!(result.videos||[]).length)throw new Error('视频任务未返回视频');
            (result.videos||[]).forEach(url=>mountVideo(host,url));onComplete?.();task.finish();
        } catch(error) {task.finish(error);throw error;}
        finally {if(typeof CardProgress!=='undefined')CardProgress.update(card,{status:'failed'});card.remove();}
    }
    function paintControls() {
        const root=document.getElementById('chatVideoControls');if(!root)return;
        root.querySelector('[data-video-mode]').value=mode;
        root.querySelectorAll('[data-video-option]').forEach(el=>el.hidden=mode!=='video');
        document.body.classList.toggle('chat-video-mode',mode==='video');
        const select=root.querySelector('[data-video-model]');select.replaceChildren();
        if(!providers.length){const option=document.createElement('option');option.value='';option.textContent='请在 API 设置添加视频模型';select.appendChild(option);}
        providers.forEach(provider=>provider.models.forEach(model=>{const option=document.createElement('option');option.value=JSON.stringify([provider.id,model]);option.textContent=(provider.name||provider.id)+' · '+model;select.appendChild(option);}));
        select.value=JSON.stringify([settings.provider_id,settings.model]);
        for(const key of ['duration','aspect_ratio','resolution'])root.querySelector('[data-video-'+key+']').value=settings[key];
    }
    function mount() {
        if(!document.body.classList.contains('chat-layout'))return;
        const anchor=document.getElementById('unifiedModelBtn')?.closest('.anima-ctrl-wrap') || document.getElementById('unifiedModelBtn')?.parentElement;
        if(!anchor)return;
        const root=document.createElement('div');root.id='chatVideoControls';root.className='chat-video-controls';
        root.innerHTML='<select class="anima-ctrl" data-video-mode aria-label="生成类型"><option value="image">图片</option><option value="video">视频</option></select>'+
            '<select class="anima-ctrl" data-video-option data-video-model aria-label="视频模型" hidden></select>'+
            '<label data-video-option hidden><input data-video-duration type="number" min="1" max="60" aria-label="视频时长"> 秒</label>'+
            '<select class="anima-ctrl" data-video-option data-video-aspect_ratio aria-label="视频比例" hidden>'+['16:9','9:16','1:1','4:3','3:4','21:9','9:21'].map(value=>'<option>'+value+'</option>').join('')+'</select>'+
            '<select class="anima-ctrl" data-video-option data-video-resolution aria-label="视频分辨率" hidden><option value="">Auto</option><option>480p</option><option>720p</option><option>1080p</option></select>';
        anchor.before(root);anchor.dataset.imageModel='1';
        root.querySelector('[data-video-mode]').onchange=event=>setMode(event.target.value);
        root.querySelector('[data-video-model]').onchange=event=>{if(event.target.value){[settings.provider_id,settings.model]=JSON.parse(event.target.value);persist();}};
        for(const key of ['duration','aspect_ratio','resolution'])root.querySelector('[data-video-'+key+']').onchange=event=>{settings[key]=key==='duration'?Math.min(60,Math.max(1,Number(event.target.value)||5)):event.target.value;persist();paintControls();};
        paintControls();load().catch(()=>{});
        window.addEventListener('focus',()=>load().catch(()=>{}));
    }
    document.addEventListener('DOMContentLoaded',mount,{once:true});
    return {isRequest,wants,needsReference,guide,readSpec,validate,generate,mountVideo,pending,poll,load,setMode,context:()=>({...settings})};
})();
