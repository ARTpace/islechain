/* ponytail: 复用现有图生图；矩形回贴保证选区外不变，无新增模型和依赖。 */
window.ChatAssistant = (() => {
    function capabilities(engine, model, protocol) {
        if (engine === 'cloud' && protocol === 'codex') return { edit:true, maxReferences:null, region:'reference-edit-and-composite', note:'Codex 内置 image_gen 支持参考图生成与编辑，由下游生图工具执行，使用 IMAGE 提交完整编辑要求。' };
        if (engine !== 'local') return { edit:'unknown', maxReferences:null, region:'reference-edit-and-composite', note:'API 是否支持参考图由平台与模型决定，不得承诺支持；失败后不要改为无参考图重试。' };
        const edit = /(?:qwen-image-2\.1|moss-image-sft|flux3-klein|krea2)/i.test(model || '');
        return { edit, maxReferences:!edit ? 0 : /moss/i.test(model) ? 1 : /krea2/i.test(model) ? 2 : 4,
            region:edit ? 'reference-edit-and-composite' : false };
    }
    function region(value) {
        if (!value || typeof value !== 'object') throw new Error('修改区域格式无效');
        const { x, y, width, height } = value;
        if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) throw new Error('区域需位于图片内，坐标使用 0–1');
        const image = value.image ?? 1;
        if (!Number.isSafeInteger(image) || image < 1) throw new Error('请选择有效的参考图编号');
        return { image, x, y, width:Math.min(width, 1-x), height:Math.min(height, 1-y) };
    }
    function pixelBox(value, w, h) {
        const box = region(value);
        const x = Math.min(w-1, Math.floor(box.x*w)), y = Math.min(h-1, Math.floor(box.y*h));
        return { x, y, width:Math.max(1, Math.min(w, Math.ceil((box.x+box.width)*w))-x), height:Math.max(1, Math.min(h, Math.ceil((box.y+box.height)*h))-y) };
    }
    function preferenceKey() {
        let user = 'anonymous';
        try { user = JSON.parse(localStorage.getItem('xy_auth_user') || 'null')?.username || user; } catch (_) {}
        return 'studio_chat_preferences:' + user;
    }
    function preferences() { try { return localStorage.getItem(preferenceKey()) || ''; } catch (_) { return ''; } }
    function isPreferenceRequest(text) { return /记住|以后|保存.{0,8}偏好|清[除空].{0,8}偏好|忘掉.{0,8}偏好/.test(text || ''); }
    function savePreferences(text) {
        if (typeof text !== 'string' || text.length > 1200) throw new Error('创作偏好最多支持1200字');
        try { if (text.trim()) localStorage.setItem(preferenceKey(),text.trim()); else localStorage.removeItem(preferenceKey()); }
        catch (_) { throw new Error('创作偏好保存失败'); }
        const input = document.getElementById('chatPreferences'); if (input) input.value=text.trim();
    }
    function guide(context, refs, selection, error) {
        return '\n生图助手执行约定：' + JSON.stringify({ capabilities:capabilities(context.engine, context.model, context.protocol), references:refs.length, selectedRegion:selection ? region(selection) : null, preferences:preferences(), lastGenerationError:String(error || '').slice(0,1200) }) +
            '\n你负责理解需求并输出指令，实际生成与编辑由页面调用下游生图工具执行，不受当前对话模型自身生图能力限制。capabilities.edit=true 且用户要求抠出主体、拆分元素、换背景或修改图片时，输出 IMAGE 与完整编辑要求；不得因自己是对话模型而回答不支持编辑。保留参考图主体特征，不擅自改成重新生成相似主体。用户只询问能力、分析图片或讨论方案时仍正常回答，不自动生图。' +
            '\n根据用户语义判断聊天、描述图片、修改参数、生成或编辑图片。连续修改须以本轮参考图为基础，完整说明修改要求及需要保留的内容；没有参考图不能假装编辑。仅改参数用 PARAMS，需生成/编辑用 IMAGE。' +
            '\n用户要求局部修改时，IMAGE 可增加 region:{"image":1,"x":0.1,"y":0.1,"width":0.3,"height":0.4}，坐标相对原图左上角归一化为0–1；先根据可见图片估计范围，程序会展示确认框，不得声称精准识别轮廓。明确选区时沿用 selectedRegion。提示词要求整张图构图、比例、镜头不变，仅修改所述区域，不绘制选区边框。合成会保留矩形外原图，边界衔接受模型影响。' +
            '\n本地 edit=false 时明确提示切换到支持图片编辑的模型，不输出编辑 IMAGE。参考图超过能力数量时要求用户减少。API edit=unknown 时说明需平台支持。' +
            '\n用户明确要求记住/以后默认/保存偏好时，最后输出 PREFS {"text":"合并已有偏好后的完整偏好文本"}；清空偏好时 text 为空字符串。仅此类请求允许 PREFS。每轮仅输出一个 IMAGE、PARAMS 或 PREFS 指令，需要保存偏好并立即生图时先保存偏好并请用户继续生图。不要在未要求时写入偏好。' +
            '\n“快速预览”可用1K；“高清成品”可用2K。不得为快慢擅自改模型专用 steps/cfg。偏好仅供默认，当前明确要求优先；只在生图时把相关偏好映射到受支持参数。分析错误时引用 lastGenerationError，不编造服务状态，不自动重试或悄悄降级。不要声称设置已执行，程序会显示结果。';
    }
    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image(); img.crossOrigin = 'anonymous';
            img.onload = () => img.naturalWidth*img.naturalHeight > 24000000 ? reject(new Error('区域编辑暂支持不超过2400万像素的原图')) : resolve(img);
            img.onerror = () => reject(new Error('图片读取失败，请使用本地上传的图片重试')); img.src = url;
        });
    }
    async function chooseRegion(url, initial, signal) {
        const img = await loadImage(url);
        if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
        return new Promise(resolve => {
            const dialog = document.createElement('dialog'); dialog.className = 'chat-region-dialog';
            dialog.innerHTML = '<header><strong>修改区域</strong><button type="button" data-cancel aria-label="关闭">×</button></header><p>拖动框选或填写百分比。框外保留原图，框内由当前模型编辑。</p><div class="chat-region-stage"><img alt="待修改的原图" draggable="false"><div class="chat-region-box"></div></div><div class="chat-region-coordinates">' + ['x','y','width','height'].map((key,index)=>'<label>'+['左侧 %','顶部 %','宽度 %','高度 %'][index]+'<input type="number" min="0" max="100" step="0.1" data-coordinate="'+key+'" aria-label="'+['左侧百分比','顶部百分比','宽度百分比','高度百分比'][index]+'"></label>').join('') + '</div><footer><span role="status">请框选区域</span><button type="button" data-cancel>取消</button><button type="button" data-confirm disabled>确认区域</button></footer>';
            const stage = dialog.querySelector('.chat-region-stage'), preview = stage.querySelector('img'), outline = stage.querySelector('div');
            const confirm = dialog.querySelector('[data-confirm]'), status = dialog.querySelector('[role=status]');
            preview.src = img.src;
            let box = initial ? region(initial) : null, start = null, finished = false;
            const draw = () => {
                outline.hidden = !box; confirm.disabled = !box;
                if (!box) return;
                Object.assign(outline.style, { left:box.x*100+'%', top:box.y*100+'%', width:box.width*100+'%', height:box.height*100+'%' });
                dialog.querySelectorAll('[data-coordinate]').forEach(input => { input.value = Math.round(box[input.dataset.coordinate]*1000)/10; });
                status.textContent = Math.round(box.width*100)+'% × '+Math.round(box.height*100)+'% · 可重新拖动';
            };
            const point = event => {
                const rect = stage.getBoundingClientRect();
                return { x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)), y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)) };
            };
            stage.onpointerdown = event => { if (event.button !== 0) return; start = point(event); stage.setPointerCapture(event.pointerId); event.preventDefault(); };
            stage.onpointermove = event => {
                if (!start) return;
                const end = point(event), width = Math.abs(end.x-start.x), height = Math.abs(end.y-start.y);
                box = width > .005 && height > .005 ? { image:initial?.image || 1, x:Math.min(start.x,end.x), y:Math.min(start.y,end.y), width, height } : null; draw();
            };
            stage.onpointerup = stage.onpointercancel = () => { start = null; };
            dialog.querySelectorAll('[data-coordinate]').forEach(input => input.oninput = () => {
                const candidate = { image:initial?.image || 1 };
                dialog.querySelectorAll('[data-coordinate]').forEach(field => { candidate[field.dataset.coordinate] = field.value === '' ? NaN : Number(field.value)/100; });
                try { box = region(candidate); draw(); }
                catch (_) { box = null; outline.hidden = true; confirm.disabled = true; status.textContent = '范围需在图片内，宽度和高度须大于0'; }
            });
            const finish = result => {
                if (finished) return; finished = true;
                signal?.removeEventListener('abort', abort); dialog.close(); dialog.remove(); resolve(result);
            };
            const abort = () => finish(null);
            dialog.querySelectorAll('[data-cancel]').forEach(button => button.onclick = () => finish(null));
            confirm.onclick = () => finish(box ? { ...region(box), source:url, sourceWidth:img.naturalWidth, sourceHeight:img.naturalHeight } : null);
            dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
            dialog.addEventListener('click', event => { if (event.target === dialog) { const r=dialog.getBoundingClientRect(); if (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) finish(null); } });
            signal?.addEventListener('abort', abort, { once:true });
            document.body.appendChild(dialog); dialog.showModal(); draw();
        });
    }
    async function composite(urls, selection, signal) {
        if (!selection) return urls;
        const source = await loadImage(selection.source);
        const canvas = document.createElement('canvas'); canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
        const ctx = canvas.getContext('2d'), box = pixelBox(selection, canvas.width, canvas.height), results = [];
        try {
            for (const url of urls) {
                if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
                const edited = await loadImage(url);
                ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(source,0,0);
                ctx.save(); ctx.beginPath(); ctx.rect(box.x,box.y,box.width,box.height); ctx.clip();
                ctx.drawImage(edited,0,0,canvas.width,canvas.height); ctx.restore();
                const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
                if (!blob) throw new Error('区域编辑结果导出失败');
                const form = new FormData(); form.append('files',blob,'region-edit.png');
                form.append('token',localStorage.getItem('xy_auth_token') || '');
                const response = await fetch('/api/ai/upload',{ method:'POST', body:form, signal });
                if (!response.ok) throw new Error('区域编辑结果保存失败');
                const data = await response.json(), result = data.files?.[0]?.url;
                if (!result) throw new Error('区域编辑保存未返回图片'); results.push(result);
            }
            return results;
        } finally { canvas.width = canvas.height = 1; }
    }
    function mountPreferences() {
        const panel = document.getElementById('chatAdvancedPanel'); if (!panel || panel.querySelector('[data-chat-preferences]')) return;
        const wrap = document.createElement('div'); wrap.className = 'chat-advanced-negative'; wrap.dataset.chatPreferences = '1';
        const label = document.createElement('label'); label.textContent = '创作偏好 · 保存后供 AI 参考'; label.htmlFor = 'chatPreferences';
        const input = document.createElement('textarea'); input.id='chatPreferences'; input.maxLength=1200; input.rows=2; input.placeholder='例如：默认横图，偏好自然光；不要水印'; input.value=preferences();
        const save=document.createElement('button'); save.type='button'; save.className='anima-ctrl'; save.textContent='保存偏好';
        const clear=document.createElement('button'); clear.type='button'; clear.className='anima-ctrl'; clear.textContent='清除';
        const status=document.createElement('span'); status.setAttribute('role','status');
        save.onclick=()=>{ try { localStorage.setItem(preferenceKey(),input.value.trim()); status.textContent='已保存'; } catch (_) { status.textContent='保存失败'; } };
        clear.onclick=()=>{ try { localStorage.removeItem(preferenceKey()); input.value=''; status.textContent='已清除'; } catch (_) { status.textContent='清除失败'; } };
        wrap.append(label,input,save,clear,status); panel.appendChild(wrap);
    }
    document.addEventListener('DOMContentLoaded', mountPreferences, {once:true});
    return { capabilities, region, pixelBox, guide, chooseRegion, composite, mountPreferences, isPreferenceRequest, savePreferences };
})();
