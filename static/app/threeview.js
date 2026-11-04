/* 三视图 · 上传 / 工作流 / 生成 / 历史
 * ------------------------------------------------------------------
 * 控制条与参数弹层在 threeview.ui.js，引擎与预设数据在 threeview.config.js。
 * 这里只做：拿参数 → 填工作流 → 提交 → 分档进度 → 存历史。
 * 节点 id 全部来自 engine.nodeMap，页面不写死任何 id，也不写死张数。
 */
(function () {
    const _isLocalAccess = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
    let COMFYUI_SERVER = 'http://127.0.0.1:8188';
    let IS_LOCAL_SERVER = _isLocalAccess;
    let uploadedImageName = null;
    let isGenerating = false;
    let currentPromptId = null;
    let currentBranch = -1;

    const $ = id => document.getElementById(id);
    const mainGenBtn = $('mainGenBtn');

    function generateUUID() {
        if (crypto?.randomUUID) { try { return crypto.randomUUID(); } catch (e) { } }
        return 'xxxxxxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    const CLIENT_ID = localStorage.getItem('client_id') || generateUUID();
    localStorage.setItem('client_id', CLIENT_ID);

    async function loadConfig() {
        const local = localStorage.getItem('comfyui_config');
        if (!local) return;
        try {
            const config = JSON.parse(local);
            IS_LOCAL_SERVER = (config.active_server || '本地服务器') === '本地服务器';
            if (!IS_LOCAL_SERVER && config.cloud_address) {
                COMFYUI_SERVER = (config.cloud_address.startsWith('http') ? config.cloud_address : `https://${config.cloud_address}`).replace(/\/+$/, '');
            } else if (config.local_address) {
                COMFYUI_SERVER = (config.local_address.startsWith('http') ? config.local_address : `http://${config.local_address}`).replace(/\/+$/, '');
            }
        } catch (e) { console.error('解析本地配置失败:', e); }
    }
    const apiFetch = (url, opt = {}) => fetch(url.startsWith('/api/') ? url : '/api/comfyui' + url, opt);
    const buildWsUrl = () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/comfyui/ws?client_id=${CLIENT_ID}`;

    /* 顶部状态行按用户要求去掉了：连接状态只体现在生成按钮的 title 上，
     * 不占界面（界面越干净越好，出问题生成时也会 alert）。 */
    let serverOnline = null;
    async function checkServerConnection() {
        try {
            const r = await apiFetch(IS_LOCAL_SERVER ? '/system_stats' : '/api/comfyui/system_stats');
            serverOnline = r.ok;
        } catch (e) {
            serverOnline = false;
        }
        refreshButtonTitle();
    }
    function refreshButtonTitle() {
        if (!mainGenBtn) return;
        mainGenBtn.title = !uploadedImageName ? '先上传参考图'
            : serverOnline === false ? 'ComfyUI 未连接'
                : '生成';
    }

    /* ============ 展示区：统一画廊组件 ============ */
    GalleryDisplay.init({
        historyType: 'threeview',
        masonrySelector: '#masonry',
        loadMoreSelector: '#loadMoreTrigger',
        toolbarExtras: true,
        favoritesEnabled: true,
        nsfwEnabled: true,
        longPressToSelect: true
    });

    /* ============ 上传 ============ */
    const uploadZone = $('uploadZone');
    UploadZone.bind(uploadZone, $('fileInput'), handleFileUpload);

    async function handleFileUpload(file) {
        if (!file.type.startsWith('image/')) return alert('请上传图片文件');
        const reader = new FileReader();
        reader.onload = (e) => {
            $('preview').src = e.target.result;
            uploadZone.classList.add('has-image');
        };
        reader.readAsDataURL(file);
        const form = new FormData();
        form.append('files', file);
        try {
            const res = await fetch('/api/upload', { method: 'POST', body: form });
            const data = await res.json();
            if (data.files?.length) {
                uploadedImageName = data.files[0].comfy_name;
                $('imgMeta').textContent = file.name;
                updateGenButtonState();
            }
        } catch (e) { alert('上传失败'); }
    }

    function updateGenButtonState() {
        mainGenBtn.disabled = isGenerating || !uploadedImageName;
        refreshButtonTitle();
    }

    /* ============ 工作流（按路径缓存，切引擎不重复拉取） ============ */
    const WORKFLOW_CACHE = {};
    async function ensureWorkflow(engine) {
        const e = engine || TVUI.currentEngine();
        if (WORKFLOW_CACHE[e.workflow]) return WORKFLOW_CACHE[e.workflow];
        const res = await fetch(e.workflow, { cache: 'no-store' });
        if (!res.ok) throw new Error(`工作流加载失败 HTTP ${res.status} · ${e.workflow}`);
        WORKFLOW_CACHE[e.workflow] = await res.json();
        return WORKFLOW_CACHE[e.workflow];
    }

    /* 参数注入：控件值统一由 TVUI.readParams() 出，节点 id 全部来自 engine.nodeMap */
    function applyParams(wf, preset, engine) {
        const map = engine.nodeMap;
        const p = TVUI.readParams();

        if (map.image && wf[map.image]) wf[map.image].inputs.image = uploadedImageName;

        (map.promptNodes || []).forEach((nodeId, i) => {
            if (preset.prompts[i] && wf[nodeId]) wf[nodeId].inputs.prompt = preset.prompts[i];
        });
        if (map.lora && wf[map.lora]) wf[map.lora].inputs.strength_model = p.consistency;

        if (map.scale && wf[map.scale]) {
            wf[map.scale].inputs.width = p.width;
            wf[map.scale].inputs.height = p.height;
        }
        (map.samplerNodes || []).forEach((id, i) => {
            if (!wf[id]) return;
            wf[id].inputs.steps = p.steps;
            wf[id].inputs.seed = p.seed + i;
        });
        return p;
    }

    /* ============ 生成 ============ */
    function createPlaceholder() {
        const div = document.createElement('div');
        div.className = 'masonry-item';
        $('masonry').prepend(div);
        const progress = window.CardProgress ? CardProgress.attach(div) : null;
        if (!progress) div.innerHTML = '<div style="padding:40px;text-align:center;font-size:10px;color:#999;">生成中…</div>';
        return { div, progress };
    }

    async function handleRender() {
        if (!uploadedImageName || isGenerating) return;
        isGenerating = true;
        updateGenButtonState();
        setLoading(true);
        startProgress();
        const engine = TVUI.currentEngine();
        const preset = TVUI.currentPreset();
        const { div: placeholder, progress } = createPlaceholder();
        try {
            const base = await ensureWorkflow(engine);
            const wf = JSON.parse(JSON.stringify(base));
            const meta = applyParams(wf, preset, engine);
            currentPromptId = generateUUID();
            currentBranch = -1;

            const ws = await new Promise((resolve, reject) => {
                const socket = new WebSocket(buildWsUrl());
                socket.onopen = () => resolve(socket);
                socket.onerror = () => reject(new Error('WebSocket 连接失败'));
                setTimeout(() => reject(new Error('WebSocket 连接超时')), 6000);
            });

            await new Promise((resolve, reject) => {
                ws.onmessage = (event) => {
                    try {
                        if (typeof event.data !== 'string') return;
                        const msg = JSON.parse(event.data);
                        if (msg.data?.prompt_id && msg.data.prompt_id !== currentPromptId) return;
                        const type = msg.type;

                        if (type === 'execution_start') {
                            progress?.update({ status: 'started' });
                            updateInline({ status: 'started' });
                        } else if (type === 'progress') {
                            const d = msg.data || {};
                            progress?.update({ status: 'sampling', value: d.value || 0, max: d.max || 1 });
                            updateInline({ status: 'sampling', value: d.value || 0, max: d.max || 1 });
                        } else if (type === 'executing') {
                            const node = msg.data?.node;
                            if (node === null) {
                                progress?.update({ status: 'done' });
                                updateInline({ status: 'done' });
                                setTimeout(() => {
                                    ws.close();
                                    resolve(getResult(currentPromptId, preset, placeholder, meta, engine));
                                }, 400);
                            } else if ((engine.nodeMap.samplerNodes || []).includes(String(node))) {
                                currentBranch = engine.nodeMap.samplerNodes.indexOf(String(node));
                                progress?.update({ status: 'executing', label: `${engine.views[currentBranch] || '采样'} 采样` });
                                updateInline({ status: 'executing' });
                            } else {
                                progress?.update({ status: 'executing', label: '准备采样' });
                            }
                        } else if (type === 'execution_error') {
                            ws.close();
                            reject(new Error(msg.data?.exception_message || '执行错误'));
                        }
                    } catch (e) { reject(e); }
                };

                fetch('/api/comfyui/prompt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: wf, client_id: CLIENT_ID, prompt_id: currentPromptId })
                }).then(async r => {
                    if (!r.ok) return reject(new Error(`HTTP ${r.status}: ${await r.text()}`));
                    const result = await r.json();
                    if (result.prompt_id) currentPromptId = result.prompt_id;
                    $('progressStatus').textContent = '任务已提交，等待执行…';
                }).catch(reject);
            });
        } catch (e) {
            placeholder?.remove();
            progress?.destroy?.();
            alert(e.message || '生成失败');
            progress?.update?.({ status: 'failed' });
        } finally {
            isGenerating = false;
            currentBranch = -1;
            completeProgress();
            setTimeout(() => hideProgress(), 900);
            setLoading(false);
            updateGenButtonState();
        }
    }

    async function getResult(promptId, preset, placeholder, meta, engine) {
        try {
            let item = null;
            for (let i = 0; i < 6; i++) {
                const res = await fetch(`/api/comfyui/history/${promptId}`);
                if (!res.ok) throw new Error('获取历史记录失败');
                const history = await res.json();
                item = history[promptId];
                if (item) break;
                await new Promise(r => setTimeout(r, 1000));
            }
            if (!item) throw new Error('未找到生成结果');
            if (item.status?.status_str === 'error') throw new Error('任务执行错误');

            const outputs = item.outputs || {};
            const raw = [];
            (engine.nodeMap.outputNodes || []).forEach(id => (outputs[id]?.images || []).forEach(im => raw.push(im)));
            if (!raw.length) Object.values(outputs).forEach(o => (o?.images || []).forEach(im => raw.push(im)));
            if (!raw.length) throw new Error('未找到生成结果');

            const urls = [];
            for (const im of raw) {
                const comfyUrl = `/api/comfyui/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder || '')}&type=${encodeURIComponent(im.type || 'output')}`;
                urls.push(await saveToUserOutput(comfyUrl, '三视图'));
            }

            /* 多视角合成一张横图，追加在末尾。
             * 为什么不放第 1 位：画廊卡片的列宽只有 ~300px，宽高比 2:1 的横图当封面时
             * 每一格只剩 100px 宽，人物细节全糊 —— 原图其实是清晰的（832×1216 无损粘贴），
             * 只是被卡片压扁了。封面留给单视角，横图进灯箱翻到最后一页看/下载。 */
            let mergedUrl = null;
            if (urls.length > 1) {
                $('progressStatus').textContent = `正在合成 ${urls.length} 视角横图…`;
                mergedUrl = await mergeImagesHorizontal(urls, '三视图');
            }
            const images = mergedUrl ? [...urls, mergedUrl] : urls;

            const record = {
                timestamp: Date.now(),
                prompt: `三视图 · ${preset.badge}`,
                images,
                type: 'threeview',
                model: engine.model,
                params: {
                    ...meta,
                    engine: TVUI.engineId(),
                    branches: engine.views.length,
                    preset: TVUI.presetKey(),
                    merged: !!mergedUrl
                }
            };
            GalleryList.pushNewImage(record);
            placeholder?.remove();
            await fetch('/api/history/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(record)
            });
        } catch (e) {
            placeholder?.remove();
            alert('获取结果失败: ' + e.message);
        }
    }

    /* ============ 按钮 / 进度 ============ */
    /* 按钮与文生图 #mainGenBtn 同款：图标 + 「生成」，生成中只换文字与转圈 */
    function setLoading(on) {
        mainGenBtn.disabled = on || !uploadedImageName;
        mainGenBtn.innerHTML = on
            ? '<span class="gen-spin"></span><span class="btn-text">生成中</span>'
            : '<i data-lucide="zap" class="gen-run-icon"></i><span class="btn-text">生成</span>';
        if (!on && typeof lucide !== 'undefined') lucide.createIcons();
    }

    function startProgress() {
        $('progressInline').style.display = 'block';
        $('progressFill').style.width = '0%';
        $('progressPercent').textContent = '0%';
        $('progressStatus').textContent = '正在提交任务…';
    }

    function updateInline(msg) {
        const fill = $('progressFill');
        const percent = $('progressPercent');
        const status = $('progressStatus');
        const views = TVUI.currentEngine().views || ['输出'];
        const total = views.length;
        const branch = currentBranch >= 0 ? `${views[currentBranch]} (${currentBranch + 1}/${total}) · ` : '';
        if (msg.status === 'started') {
            fill.style.width = '2%'; percent.textContent = '2%';
            status.textContent = 'ComfyUI 开始执行（首次加载模型约 2~4 分钟）';
        } else if (msg.status === 'executing') {
            fill.style.width = '6%'; percent.textContent = '6%';
            status.textContent = `${branch}准备采样…`;
        } else if (msg.status === 'sampling') {
            const value = msg.value || 0, max = msg.max || 1;
            const overall = Math.round(((Math.max(0, currentBranch) + value / max) / total) * 92) + 4;
            fill.style.width = `${overall}%`; percent.textContent = `${overall}%`;
            status.textContent = `${branch}采样中 ${value}/${max}`;
        } else if (msg.status === 'done') {
            fill.style.width = '96%'; percent.textContent = '96%';
            status.textContent = '解码并保存中…';
        }
    }

    function completeProgress() {
        $('progressFill').style.width = '100%';
        $('progressPercent').textContent = '100%';
        $('progressStatus').textContent = '三视图生成完成';
    }
    function hideProgress() {
        $('progressInline').style.display = 'none';
        currentPromptId = null;
    }

    window.addEventListener('DOMContentLoaded', async () => {
        TVUI.init();
        mainGenBtn.addEventListener('click', handleRender);
        await loadConfig();
        try { await ensureWorkflow(TVUI.currentEngine()); } catch (e) { console.warn(e); }
        checkServerConnection();
        setInterval(checkServerConnection, 5000);
        GalleryList.load(0).then(() => {
            const trigger = $('loadMoreTrigger');
            trigger.classList.remove('hidden');
            trigger.onclick = () => GalleryList.load(1);
        });
    });
})();
