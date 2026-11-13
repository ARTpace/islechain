/* 公共外观偏好：整体预设与本地背景，只影响界面容器，不处理作品内容。 */
(function(){
    const PROFILE = 'studio_appearance_profile';
    const BACKGROUND = 'studio_background';
    const defaults = {density:'standard', radius:'standard', depth:'standard', style:'standard'};
    const choices = {density:['compact','standard','relaxed'], radius:['crisp','standard','soft'], depth:['flat','standard','raised'], style:['standard','cartoon','scifi','glass']};
    const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch(e){ return fallback; } };
    function profile(){
        const saved = read(PROFILE, {});
        return Object.fromEntries(Object.keys(defaults).map(key => [key, choices[key].includes(saved[key]) ? saved[key] : defaults[key]]));
    }
    function background(){
        const saved = read(BACKGROUND, {});
        const valid = typeof saved.image === 'string' && saved.image.length < 1800000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(saved.image);
        const video = typeof saved.video === 'string' && /^video-[a-z0-9-]+$/.test(saved.video) ? saved.video : '';
        return {image:video ? '' : (valid ? saved.image : ''), video, strength:Number.isFinite(saved.strength) ? Math.max(0,Math.min(100,saved.strength)) : 25};
    }
    function save(key, value){
        try { localStorage.setItem(key, JSON.stringify(value)); }
        catch(e){ throw new Error('外观设置未保存：浏览器存储空间不足或已被禁用，请移除旧背景后重试。'); }
        apply();
        window.dispatchEvent(new CustomEvent('studio-look-change'));
        // storage 事件负责其他文档；同源 iframe 也主动同步，避免外壳与内容短暂不一致。
        document.querySelectorAll('iframe').forEach(frame => {
            try { frame.contentWindow.postMessage({type:'studio-appearance-refresh'}, location.origin); } catch(e){}
        });
    }
    // 视频 Blob 放 IndexedDB，偏好仅记录键值，避免把大文件塞入 localStorage。
    function videoStore(mode, key, value){
        return new Promise((resolve,reject) => {
            if(!window.indexedDB) return reject(new Error('当前浏览器不支持本地视频存储。'));
            const request = window.indexedDB.open('studio-background-media',1);
            request.onupgradeneeded = () => request.result.createObjectStore('videos');
            request.onblocked = () => reject(new Error('本地视频存储被其他页面占用，请关闭旧页面后重试。'));
            request.onerror = () => reject(new Error('无法打开本地视频存储。'));
            request.onsuccess = () => {
                const db = request.result;
                let tx, operation;
                try {
                    tx = db.transaction('videos', mode === 'get' ? 'readonly' : 'readwrite');
                    const store = tx.objectStore('videos');
                    operation = mode === 'get' ? store.get(key) : mode === 'put' ? store.put(value,key) : store.delete(key);
                } catch(e){ db.close(); reject(new Error('本地视频存储不可用。')); return; }
                tx.oncomplete = () => { const result = operation.result; db.close(); resolve(result); };
                tx.onerror = tx.onabort = () => { db.close(); reject(new Error('视频未保存：浏览器空间不足或存储被禁用。')); };
            };
        });
    }
    let videoKey = '', videoURL = '', videoEpoch = 0;
    const players = new Set();
    function stopVideos(){
        players.forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); });
        players.clear();
        if(videoURL) URL.revokeObjectURL(videoURL);
        videoURL = '';
    }
    function syncPlayback(){
        players.forEach(video => {
            const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if(document.hidden || reduced || video.getClientRects().length === 0 || background().strength === 0 || (video.parentNode.id === 'studio-background-layer' && document.getElementById('settings-panel')?.getClientRects().length)) video.pause();
            else video.play().catch(() => { /* 自动播放被系统拦截时保留静态帧。 */ });
        });
    }
    function mountVideos(){
        if(!videoURL) return;
        const targets = [document.getElementById('studio-background-layer'), document.getElementById('settings-panel')].filter(Boolean);
        players.forEach(video => { if(!video.isConnected){ video.pause(); players.delete(video); } });
        targets.forEach(target => {
            if(Array.from(players).some(video => video.parentNode === target)) return;
            const video = document.createElement('video');
            video.className = 'studio-background-video';
            video.muted = true; video.loop = true; video.playsInline = true;
            video.setAttribute('aria-hidden','true'); video.setAttribute('disablepictureinpicture','');
            video.src = videoURL;
            video.onerror = () => window.dispatchEvent(new CustomEvent('studio-background-error',{detail:'背景视频无法播放，请更换当前浏览器支持编码的 MP4 或 WebM。'}));
            target.prepend(video); players.add(video);
        });
        syncPlayback();
    }
    async function applyVideo(key){
        if(key === videoKey){ mountVideos(); syncPlayback(); return; }
        videoKey = key;
        const epoch = ++videoEpoch;
        stopVideos();
        if(!key) return;
        try {
            const blob = await videoStore('get',key);
            if(epoch !== videoEpoch) return;
            if(!blob) throw new Error('本地背景视频已丢失，请重新添加。');
            videoURL = URL.createObjectURL(blob);
            mountVideos();
        } catch(error){
            if(epoch === videoEpoch) window.dispatchEvent(new CustomEvent('studio-background-error',{detail:error.message}));
        }
    }
    async function setVideoBackground(file){
        if(!['video/mp4','video/webm'].includes(file.type)) throw new Error('请选择 MP4 或 WebM 视频。');
        if(file.size > 50*1024*1024) throw new Error('背景视频不能超过 50 MB，建议使用短小的循环视频。');
        const source = URL.createObjectURL(file);
        try {
            await new Promise((resolve,reject) => {
                const video = document.createElement('video');
                const timer = setTimeout(() => done(new Error('视频读取超时，请更换文件。')),15000);
                function done(error){ clearTimeout(timer); video.onloadeddata = video.onerror = null; video.removeAttribute('src'); video.load(); error ? reject(error) : resolve(); }
                video.muted = true; video.preload = 'auto';
                video.onloadeddata = () => done(video.videoWidth ? null : new Error('视频尺寸无效。'));
                video.onerror = () => done(new Error('视频无法解码，请选择浏览器支持编码的 MP4 或 WebM。'));
                video.src = source;
            });
        } finally { URL.revokeObjectURL(source); }
        const key = 'video-'+crypto.randomUUID();
        const old = background().video;
        await videoStore('put',key,file);
        try { save(BACKGROUND,{...background(),image:'',video:key}); }
        catch(error){ await videoStore('delete',key).catch(()=>{}); throw error; }
        if(old) await videoStore('delete',old).catch(()=>{});
    }
    function apply(){
        const p = profile(), bg = background();
        const root = document.documentElement;
        Object.entries(p).forEach(([key,value]) => root.dataset['appearance'+key[0].toUpperCase()+key.slice(1)] = value);
        let layer = document.getElementById('studio-background-layer');
        const hasMedia = Boolean(bg.image || bg.video);
        if(hasMedia && document.body && !layer){
            layer = document.createElement('div');
            layer.id = 'studio-background-layer';
            layer.setAttribute('aria-hidden','true');
            document.body.prepend(layer);
        }
        if(layer){
            layer.style.backgroundImage = bg.image ? 'url("'+bg.image+'")' : 'none';
            layer.style.opacity = String(bg.strength / 100);
            layer.hidden = !hasMedia;
        }
        root.style.setProperty('--studio-background-image', bg.image ? 'url("'+bg.image+'")' : 'none');
        root.style.setProperty('--studio-background-strength', String(bg.strength / 100));
        root.classList.toggle('studio-has-background', hasMedia);
        root.classList.toggle('studio-has-video-background', Boolean(bg.video));
        applyVideo(bg.video);
    }
    async function setBackground(file){
        if(file && ['video/mp4','video/webm'].includes(file.type)) return setVideoBackground(file);
        if(!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
        if(file.size > 15 * 1024 * 1024) throw new Error('图片不能超过 15 MB。');
        const source = URL.createObjectURL(file);
        try {
            const image = await new Promise((resolve,reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('图片无法解码，请更换文件。'));
                img.src = source;
            });
            if(!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效。');
            const ratio = Math.min(1, 1920 / Math.max(image.naturalWidth,image.naturalHeight));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.naturalWidth*ratio));
            canvas.height = Math.max(1, Math.round(image.naturalHeight*ratio));
            const ctx = canvas.getContext('2d');
            if(!ctx) throw new Error('当前浏览器无法处理背景图。');
            ctx.drawImage(image,0,0,canvas.width,canvas.height);
            const data = canvas.toDataURL('image/webp', .8);
            if(data.length >= 1800000) throw new Error('图片压缩后仍过大，请选择更小的背景图。');
            const old = background().video;
            save(BACKGROUND, {...background(), image:data, video:''});
            if(old) await videoStore('delete',old).catch(()=>{});
        } finally { URL.revokeObjectURL(source); }
    }
    function install(){
        if(!window.StudioLook) return;
        Object.assign(window.StudioLook, {
            profile,
            setProfile(key,value){
                if(!choices[key]?.includes(value)) throw new Error('无效的外观预设。');
                save(PROFILE, {...profile(), [key]:value});
            },
            background, setBackground,
            async clearBackground(){
                const old = background().video;
                save(BACKGROUND, {...background(),image:'',video:''});
                if(old) await videoStore('delete',old).catch(()=>{});
            },
            setBackgroundStrength(value){
                const n = Number(value);
                if(!Number.isFinite(n)) throw new Error('无效的背景强度。');
                save(BACKGROUND, {...background(),strength:Math.max(0,Math.min(100,n))});
            }
        });
        apply();
        window.dispatchEvent(new CustomEvent('studio-look-change'));
    }
    window.addEventListener('storage', event => { if(event.key === PROFILE || event.key === BACKGROUND || event.key === null) apply(); });
    window.addEventListener('message', event => { if(event.origin === location.origin && event.data?.type === 'studio-appearance-refresh') apply(); });
    document.addEventListener('visibilitychange',syncPlayback);
    if(window.matchMedia) window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',syncPlayback);
    // 设置面板按需创建；只在视频启用时挂载其背景，不改动业务内容。
    if(typeof MutationObserver !== 'undefined') new MutationObserver(() => { if(videoKey) mountVideos(); }).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden']});
    install();
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',install,{once:true});
})();
