// Shared by gallery and canvas; the backend owns model selection and task caching.
(function (global) {
    async function cutoutRequest(url, options) {
        const response = await fetch(url, { ...options, signal: AbortSignal.timeout(90000) });
        const data = await response.json();
        if (response.status === 404 && url === '/api/image-cutout/models') throw new Error('模型列表接口未生效，请重启工具后端');
        if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '抠图请求失败');
        return data;
    }

    async function runCutout(imageUrl, prompt, options = {}) {
        if(typeof WebSocket === 'undefined') return pollCutout(imageUrl, prompt, options);
        const clientId = global.crypto?.randomUUID?.() || `cutout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let socket, taskId, numerical = false;
        try {
            // Reuse the existing proxy; percentages come only from this task's ComfyUI events.
            await new Promise(resolve => {
                const timer = setTimeout(resolve, 3000);
                try {
                    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/comfyui/ws?client_id=${clientId}`);
                    socket.onerror = () => { clearTimeout(timer); resolve(); };
                    socket.onmessage = event => {
                        if(typeof event.data !== 'string') return;
                        let message;
                        try { message = JSON.parse(event.data); } catch { return; }
                        clearTimeout(timer); resolve();
                        const data = message.data || {};
                        if(!taskId || data.prompt_id !== taskId) return;
                        if(message.type === 'executing') numerical = false;
                        if(message.type !== 'progress' || !Number.isFinite(data.value) || !Number.isFinite(data.max) || data.max <= 0) return;
                        numerical = true;
                        const value = Math.max(0, Math.min(100, data.value / data.max * 100));
                        options.onProgress?.({value,stage:'running',label:`抠图推理：${data.value} / ${data.max}（${Math.floor(value)}%）`});
                    };
                } catch { clearTimeout(timer); resolve(); }
            });
            return await pollCutout(imageUrl, prompt, {...options, clientId,
                onTask: id => { taskId = id; },
                onProgress: state => { if(!numerical || state.stage === 'done') options.onProgress?.(state); }
            });
        } finally { socket?.close(); }
    }

    async function pollCutout(imageUrl, prompt, options = {}) {
        options.onProgress?.({ label: '正在读取原图并提交任务…', stage: 'submitting' });
        const submit = retry => cutoutRequest('/api/image-cutout', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: imageUrl, prompt: String(prompt).slice(0, 20000), model: options.model || 'auto', retry, client_id: options.clientId, target: String(options.target || '').slice(0, 2000) })
        });
        let result = await submit(!!options.retry);
        const differs = state => options.model && options.model !== 'auto' && (state.model !== options.model || (options.model === 'SAM3' && String(state.target || '').trim() !== String(options.target || '').trim()));
        // The backend caches by source image. A different model/target needs a new attempt, not that cached PNG.
        if (!options.retry && result.status === 'done' && (differs(result) || (options.model === 'auto' && result.selection === 'manual'))) {
            result = await submit(true);
            if (!result.attempt) throw new Error('工具后端尚未更新换模功能，请重启工具后端后重试');
        }
        if (result.status === 'processing' && differs(result)) throw new Error('这张图片正在使用其他模型或主体抠图，请等待当前任务完成后再切换');
        if (options.retry && !result.attempt) throw new Error('工具后端尚未更新换模功能，请重启工具后端后重试');
        if (options.model && options.model !== 'auto' && result.model !== options.model) throw new Error('后端未使用所选模型，请重启工具后端后重试');
        const deadline = Date.now() + 31 * 60 * 1000;
        options.onTask?.(result.prompt_id);
        const notify = () => options.onProgress?.(result.status === 'done' ? { value: 100, label: '抠图完成', stage: 'done' } : result.progress || { label: '正在抠图…' });
        notify();
        while (result.status === 'processing') {
            if (Date.now() > deadline) throw new Error('抠图等待超时，再次点击可查询已有任务');
            await new Promise(resolve => setTimeout(resolve, 2000));
            result = await cutoutRequest('/api/image-cutout/' + result.id);
            notify();
        }
        if (result.status !== 'done' || !result.url) throw new Error(result.error || '抠图未成功，请重试');
        if (differs(result)) throw new Error('抠图结果与所选模型或主体不一致，请重新识别');
        return result;
    }
    global.ImageCutoutClient = { request: cutoutRequest, run: runCutout };
})(window);
