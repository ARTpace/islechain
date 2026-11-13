/* 工具页共享运行时 —— 2dstyle / cgstyle / kuotu / rmbg / yichuwuti / gaoqingxiufu / promptgen / textmatting / watermark-removal 共用
 *
 * 为什么要有它：这 9 个页面是从同一份模板复制出来的，其中的 apiFetch / buildWsUrl /
 * generateUUID / loadConfig / checkServerConnection / 进度条四件套 / 提交并等待结果
 * 在每页各写一遍（buildWsUrl 10 份字面完全相同，checkServerConnection 8 份完全相同）。
 * 改一处 bug（比如 /api/ 路径直连 8188 被 CORS 拦）要改 9 个文件。
 *
 * 分工：
 *   本模块 —— 服务器地址解析、请求封装、WebSocket 进度、任务提交与结果轮询
 *   宿主   —— 工作流 JSON、参数绑定、上传、历史记录、按钮状态、页面样式
 *
 * 加新工具页的正确姿势：引入本文件 + 一行 create()，不要再抄模板。
 */
(function () {
    'use strict';

    // 默认 DOM id 由 comfy-progress.js 提供，这里只透传宿主的覆盖项

    function byId(id) {
        return id ? document.getElementById(id) : null;
    }

    function uuid() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            try { return crypto.randomUUID(); } catch (e) { /* 老浏览器降级 */ }
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    // 每个浏览器一个稳定 client_id，ComfyUI 用它区分消息归属
    function clientId() {
        var id = '';
        try { id = localStorage.getItem('client_id') || ''; } catch (e) { id = ''; }
        if (!id) {
            id = uuid();
            try { localStorage.setItem('client_id', id); } catch (e) { /* 隐私模式忽略 */ }
        }
        return id;
    }

    function normalizeUrl(address, scheme) {
        var text = String(address || '').trim().replace(/\/+$/, '');
        if (!text) return '';
        if (/^https?:\/\//i.test(text)) return text;
        return scheme + '://' + text;
    }

    // ComfyUI 原生消息 → 统一的进度事件。未识别的类型返回 null。
    function normalizeMessage(message) {
        if (!message || typeof message !== 'object') return null;
        var data = message.data || {};
        switch (message.type) {
            case 'execution_start':
                return { status: 'started', value: 0, max: 1, node: '', promptId: data.prompt_id || '' };
            case 'execution_cached':
                return { status: 'cached', value: 0, max: 1, node: 'cached', promptId: data.prompt_id || '' };
            case 'progress':
                return { status: 'sampling', value: data.value || 0, max: data.max || 1, node: data.node || '', promptId: data.prompt_id || '' };
            case 'executing':
                return {
                    status: data.node === null ? 'done' : 'executing',
                    value: data.node === null ? 1 : 0,
                    max: 1,
                    node: data.node || '',
                    promptId: data.prompt_id || ''
                };
            case 'executed':
                // 单节点出图完成。多图工作流靠它累计进度文案
                return { status: 'executed', value: 0, max: 1, node: data.node || '', promptId: data.prompt_id || '', output: data.output || null };
            case 'execution_error':
                return { status: 'error', value: 0, max: 1, node: '', promptId: data.prompt_id || '', error: data.exception_message || '执行错误' };
            default:
                return null;
        }
    }

    function create(options) {
        var opts = options || {};
        var progressIds = opts.progress || {};
        var statusIds = opts.status || {};
        var nodeTitles = opts.nodeTitles || {};

        var server = normalizeUrl(opts.comfyServer || 'http://127.0.0.1:8188', 'http');
        var localHost = /^(127\.0\.0\.1|localhost)$/i.test(location.hostname);
        var isLocal = localHost;
        var client = clientId();
        var socket = null;
        var scoped = [];          // 提交期间注册的临时监听
        var keepAlive = !!opts.keepAlive;
        var reconnectTimer = 0;
        var retryDelay = 3000;

        function emit(event) {
            if (!event) return;
            if (typeof opts.onProgress === 'function') {
                try { opts.onProgress(event); } catch (e) { /* 宿主回调异常不应中断流 */ }
            }
            scoped.slice().forEach(function (fn) {
                try { fn(event); } catch (e) { /* 同上 */ }
            });
        }

        /* ---------- 进度条（绘制在 comfy-progress.js，这里只做装配） ---------- */

        var bar = window.ComfyProgress
            ? window.ComfyProgress.create(progressIds, { nodeTitles: nodeTitles })
            : null;

        function startProgress(text) { if (bar) bar.start(text); }
        function updateProgress(event) { if (bar) bar.update(event); }
        function completeProgress(text) { if (bar) bar.complete(text); }
        function hideProgress() { if (bar) bar.hide(); }
        /* ---------- 服务器地址 ---------- */

        // 本地模式优先用后端设置页里的真实地址（localStorage 可能是空或过期）
        async function loadConfig() {
            var raw = '';
            try { raw = localStorage.getItem('comfyui_config') || ''; } catch (e) { raw = ''; }
            if (raw) {
                try {
                    var config = JSON.parse(raw);
                    isLocal = (config.active_server || '本地服务器') === '本地服务器';
                    if (!isLocal && config.cloud_address) {
                        server = normalizeUrl(config.cloud_address, 'https');
                        return getState();
                    }
                    if (config.local_address) server = normalizeUrl(config.local_address, 'http');
                } catch (e) {
                    console.error('[ComfyTool] 解析 comfyui_config 失败:', e);
                }
            }
            if (!isLocal) return getState();
            try {
                var res = await fetch('/api/comfyui/instances');
                if (res.ok) {
                    var data = await res.json();
                    var first = (data.instances || [])[0];
                    if (first) server = normalizeUrl(first, 'http');
                }
            } catch (e) {
                console.warn('[ComfyTool] 获取后端 ComfyUI 地址失败，沿用', server);
            }
            return getState();
        }

        function getState() {
            return { server: server, isLocal: isLocal, clientId: client };
        }

        // /api/ 一律走 FastAPI 代理：直连 8188 会被 CORS 拦（这是 gaoqingxiufu 修过的坑）
        async function apiFetch(url, requestOptions) {
            var settings = requestOptions || {};
            if (isLocal && typeof url === 'string' && url.indexOf('/api/') !== 0) {
                return fetch(server + url, settings);
            }
            var headers = Object.assign({ 'X-ComfyUI-Server-Url': server }, settings.headers || {});
            return fetch(url, Object.assign({}, settings, { headers: headers }));
        }

        function buildWsUrl() {
            var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            return protocol + '//' + location.host + '/api/comfyui/ws?client_id=' + client;
        }

        /* ---------- WebSocket ---------- */

        function connect() {
            if (socket && socket.readyState <= 1) return socket;
            try {
                socket = new WebSocket(buildWsUrl());
            } catch (e) {
                socket = null;
                return null;
            }
            socket.onmessage = function (event) {
                if (typeof event.data !== 'string') return;
                var message;
                try { message = JSON.parse(event.data); } catch (e) { return; }
                var mapped = normalizeMessage(message);
                if (!mapped) return;
                if (typeof opts.mapMessage === 'function') mapped = opts.mapMessage(mapped, message) || mapped;
                emit(mapped);
            };
            socket.onopen = function () {
                retryDelay = 3000;   // 连上就重置退避
            };
            socket.onclose = function () {
                socket = null;
                if (!keepAlive && !scoped.length) return;
                clearTimeout(reconnectTimer);
                // 后端没起来时不要每 3 秒无限重连，逐步退避到 30 秒
                reconnectTimer = setTimeout(connect, retryDelay);
                retryDelay = Math.min(retryDelay * 2, 30000);
            };
            return socket;
        }

        function disconnect() {
            keepAlive = false;
            clearTimeout(reconnectTimer);
            if (socket) {
                try { socket.close(); } catch (e) { /* 已断开 */ }
                socket = null;
            }
        }

        /* ---------- 历史与结果 ---------- */

        // 返回 null 表示「还没跑完」；否则 { done, imageUrl, outputs }
        // 完成判定不能只看 images：提示词反推页（ShowText）只产出文本，
        // 只认图片会让它永远等不到结果。以 status.completed / 有任意 outputs 为准。
        async function historyEntry(promptId) {
            var res = await fetch('/api/comfyui/history/' + encodeURIComponent(promptId));
            if (!res.ok) throw new Error('获取历史记录失败');
            var data = await res.json();
            var entry = data[promptId];
            if (!entry) return null;
            if (entry.status && entry.status.status_str === 'error') {
                throw new Error('任务执行错误: ' + JSON.stringify(entry.status.messages || {}));
            }
            var outputs = entry.outputs || {};
            var imageUrl = '';
            for (var nodeId in outputs) {
                var images = outputs[nodeId].images;
                if (images && images.length) {
                    var image = images[0];
                    imageUrl = '/api/comfyui/view?filename=' + encodeURIComponent(image.filename)
                        + '&subfolder=' + encodeURIComponent(image.subfolder || '')
                        + '&type=' + encodeURIComponent(image.type || 'output');
                    break;
                }
            }
            var completed = !!(entry.status && entry.status.completed);
            var hasOutputs = Object.keys(outputs).length > 0;
            return { done: completed || hasOutputs, imageUrl: imageUrl || null, outputs: outputs };
        }

        // 只关心图片的调用方用这个
        async function history(promptId) {
            var entry = await historyEntry(promptId);
            return entry && entry.done ? entry.imageUrl : null;
        }

        function sleep(ms) {
            return new Promise(function (resolve) { setTimeout(resolve, ms); });
        }

        // node_errors: {节点id: {errors: [{message, details}]}} → 一句人话
        function describeNodeErrors(nodeErrors) {
            if (!nodeErrors || typeof nodeErrors !== 'object') return '';
            var ids = Object.keys(nodeErrors);
            if (!ids.length) return '';
            var parts = [];
            ids.slice(0, 3).forEach(function (id) {
                var first = (nodeErrors[id].errors || [])[0] || {};
                var text = first.details || first.message || '未知错误';
                parts.push('节点 ' + id + ': ' + String(text).slice(0, 160));
            });
            return '工作流校验失败（' + parts.join('；') + '）';
        }

        /**
         * 提交工作流并等待结果。
         * 完成判定用 history 轮询而不是只等 WebSocket：WS 消息丢了就会永久挂起，
         * 这是原来每页各写一遍时都有的隐患。
         */
        async function submit(workflow, submitOptions) {
            var runOpts = submitOptions || {};
            var timeoutMs = runOpts.timeoutMs || 600000;
            var pollMs = runOpts.pollMs || 1500;
            var promptId = runOpts.promptId || uuid();
            var listener = runOpts.onProgress;
            if (listener) {
                var wrapped = function (event) {
                    if (event.promptId && event.promptId !== promptId) return;
                    listener(event);
                };
                wrapped.__owner = listener;   // dropScoped 靠它找回自己
                scoped.push(wrapped);
            }

            connect();
            var res;
            try {
                var payload = { prompt: workflow, client_id: client, prompt_id: promptId };
                // 有些节点（如 GJJ_MultiImageLoader 的 selected_images）只能通过 extra_pnginfo 传参，
                // 写进 inputs 会被 ComfyUI 丢弃
                if (runOpts.extraData) payload.extra_data = runOpts.extraData;
                res = await fetch('/api/comfyui/prompt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } catch (e) {
                dropScoped(listener);
                throw new Error('提交任务失败: ' + e.message);
            }
            if (!res.ok) {
                // 400 里也可能带 node_errors（模型文件缺失等），优先给可读原因
                var raw = '';
                try { raw = await res.text(); } catch (e) { raw = ''; }
                var parsed = null;
                try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
                dropScoped(listener);
                var reason = describeNodeErrors(parsed && parsed.node_errors)
                    || (parsed && parsed.error && (parsed.error.details || parsed.error.message))
                    || raw;
                throw new Error('HTTP ' + res.status + (reason ? ': ' + String(reason).slice(0, 240) : ''));
            }
            var accepted = await res.json();
            // ComfyUI 对「文件不存在」这类校验错误仍然返回 200，只在 node_errors 里说明。
            // 不检查就会误以为提交成功，然后一直轮询到超时（原来每页各写一遍时都是这么挂的）。
            var failed = describeNodeErrors(accepted && accepted.node_errors);
            if (failed) {
                dropScoped(listener);
                throw new Error(failed);
            }
            if (accepted && accepted.prompt_id) promptId = accepted.prompt_id;
            var statusLine = byId(progressIds.status);
            if (statusLine) statusLine.textContent = '任务已提交，等待执行...';

            var deadline = Date.now() + timeoutMs;
            try {
                while (Date.now() < deadline) {
                    await sleep(pollMs);
                    var entry = await historyEntry(promptId);
                    if (entry && entry.done) {
                        return { imageUrl: entry.imageUrl, outputs: entry.outputs, promptId: promptId };
                    }
                }
            } finally {
                dropScoped(listener);
            }
            throw new Error('任务超时（' + Math.round(timeoutMs / 1000) + '秒未返回结果）');
        }

        function dropScoped(listener) {
            if (!listener) return;
            var index = scoped.findIndex(function (fn) {
                return fn.__owner === listener;
            });
            if (index >= 0) scoped.splice(index, 1);
            if (!keepAlive && !scoped.length) disconnect();
        }

        /* ---------- 服务器状态灯（绘制在 comfy-progress.js） ---------- */

        var statusBar = window.ComfyProgress
            ? window.ComfyProgress.createStatus(statusIds)
            : { set: function () {}, check: function () { return Promise.resolve(false); }, queue: function () {} };

        function setStatus(text, kind) { statusBar.set(text, kind); }
        function checkConnection() { return statusBar.check(apiFetch); }
        function queueStatus() { statusBar.queue(client); }

        function start() {
            if (opts.keepAlive) { keepAlive = true; connect(); }
            return getState();
        }

        return {
            uuid: uuid,
            get clientId() { return client; },
            get server() { return server; },
            get isLocal() { return isLocal; },
            state: getState,
            loadConfig: loadConfig,
            apiFetch: apiFetch,
            buildWsUrl: buildWsUrl,
            connect: connect,
            disconnect: disconnect,
            start: start,
            submit: submit,
            history: history,
            historyEntry: historyEntry,
            startProgress: startProgress,
            updateProgress: updateProgress,
            completeProgress: completeProgress,
            hideProgress: hideProgress,
            setStatus: setStatus,
            checkConnection: checkConnection,
            queueStatus: queueStatus
        };
    }

    window.ComfyTool = { create: create, uuid: uuid, clientId: clientId };
})();
