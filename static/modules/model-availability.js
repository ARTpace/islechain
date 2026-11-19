/* 模型可用性 —— 全站模型菜单的统一过滤依据。
 *
 * 后端 GET /api/models/availability 给出 {entries[key]={available,reason,stage}}；
 * 本模块只做三件事：缓存快照、提供同步查询、在结果变化时通知菜单重绘。
 *
 * 纪律（绝不误杀）：快照没到 / 接口失败 / key 不存在，一律返回「可用」。
 * 所以首屏菜单照常显示，检测在后台完成后再自动剔除不可用项。
 * 快照放 sessionStorage：本次工具会话内首屏不闪，重启工具即重新检测。
 *
 * key 契约（与 core/model_availability*.py 一致）：
 *   provider:<id> / chat|image|video:<id>/<model> / workflow:<相对路径>
 */
(function () {
    'use strict';

    var SETTINGS = {
        endpoint: '/api/models/availability',
        cacheKey: 'islechain.modelAvailability.v1',
        cacheTtl: 5 * 60 * 1000,
        pollMs: 60 * 1000,
        channel: 'studio-model-availability'
    };
    var state = {
        snapshot: null, overrides: {}, fetchedAt: 0, fetching: null,
        listeners: [], started: false, channel: null
    };

    function providerKey(id) { return 'provider:' + id; }
    function modelKey(kind, id, model) { return kind + ':' + id + '/' + model; }
    function workflowKey(name) { return 'workflow:' + name; }

    function emit() {
        for (var i = state.listeners.length - 1; i >= 0; i--) {
            try { state.listeners[i](); } catch (e) { /* 单个宿主出错不影响其它菜单 */ }
        }
    }

    function subscribe(fn) {
        if (typeof fn !== 'function') return function () {};
        state.listeners.push(fn);
        return function () {
            var at = state.listeners.indexOf(fn);
            if (at >= 0) state.listeners.splice(at, 1);
        };
    }

    function apply(data, silent) {
        if (!data || data.version !== 1 || !data.entries) return;
        state.snapshot = data;
        state.fetchedAt = Date.now();
        state.overrides = {};
        (data.overrides || []).forEach(function (key) { state.overrides[key] = true; });
        try {
            sessionStorage.setItem(SETTINGS.cacheKey, JSON.stringify({ data: data, ts: Date.now() }));
        } catch (e) { /* 隐私模式下无 sessionStorage，降级为纯内存 */ }
        if (!silent) emit();
    }

    function readCache() {
        try {
            var raw = JSON.parse(sessionStorage.getItem(SETTINGS.cacheKey) || 'null');
            if (raw && raw.data && Date.now() - raw.ts < SETTINGS.cacheTtl) apply(raw.data, true);
        } catch (e) { /* 缓存坏了就重新检测 */ }
    }

    function ensure(force) {
        if (state.fetching) return state.fetching;
        var ttl = ((state.snapshot && state.snapshot.ttl) || 60) * 1000;
        if (!force && state.snapshot && Date.now() - state.fetchedAt < ttl) {
            return Promise.resolve(state.snapshot);
        }
        var url = SETTINGS.endpoint + (force ? '?refresh=1' : '');
        state.fetching = fetch(url, { cache: 'no-store' })
            .then(function (res) {
                if (!res.ok) throw new Error('availability HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) { apply(data); return data; })
            .catch(function (err) {
                // 失败时保留旧快照；完全没有快照就保持「全部放行」，不把菜单清空
                console.warn('[ModelAvailability] 检测不可用，暂按全部可用处理:', err.message);
                return state.snapshot;
            })
            .then(function (data) { state.fetching = null; return data; });
        return state.fetching;
    }

    function refresh() { return ensure(true); }

    function isAvailable(key) {
        if (state.overrides[key]) return true;
        var entries = state.snapshot && state.snapshot.entries;
        var item = entries && entries[key];
        return !(item && item.available === false);
    }

    function isProviderAvailable(id) { return id ? isAvailable(providerKey(id)) : true; }
    function isModelAvailable(kind, id, model) {
        return isProviderAvailable(id) && isAvailable(modelKey(kind, id, model));
    }
    function isWorkflowAvailable(name) { return name ? isAvailable(workflowKey(name)) : true; }
    function reason(key) {
        var item = state.snapshot && state.snapshot.entries && state.snapshot.entries[key];
        return item ? (item.reason || '') : '';
    }
    function isForced(key) { return Boolean(state.overrides[key]); }

    function filterModels(kind, id, models) {
        return (models || []).filter(function (model) {
            var name = typeof model === 'string' ? model : (model && (model.id || model.name || ''));
            return isModelAvailable(kind, id, name);
        });
    }

    /* provider 列表通用过滤：整组不可用或过滤后没有模型，就不出现在菜单里。
     * field 支持 chat_models / image_models / models（不同页面字段名不同）。 */
    function filterProviders(kind, providers, field) {
        field = field || (kind === 'chat' ? 'chat_models' : 'image_models');
        return (providers || []).map(function (provider) {
            if (!provider || provider.enabled === false || !isProviderAvailable(provider.id)) return null;
            var source = provider[field] || provider.models || [];
            var kept = filterModels(kind, provider.id, source);
            if (!kept.length) return null;
            var copy = Object.assign({}, provider);
            copy[field] = kept;
            if (field !== 'models' && Array.isArray(provider.models)) copy.models = kept;
            return copy;
        }).filter(Boolean);
    }

    function filterWorkflows(items) {
        return (items || []).filter(function (item) {
            return item && isWorkflowAvailable(item.name);
        });
    }

    function unavailableList() {
        var entries = (state.snapshot && state.snapshot.entries) || {};
        return Object.keys(entries).filter(function (key) {
            return entries[key].available === false;
        }).map(function (key) {
            return {
                key: key, reason: entries[key].reason || '', stage: entries[key].stage || '',
                forced: Boolean(state.overrides[key]),
                missing_models: entries[key].missing_models || [],
                missing_nodes: entries[key].missing_nodes || []
            };
        }).sort(function (a, b) { return a.key.localeCompare(b.key); });
    }

    function setOverride(key, forced) {
        return fetch('/api/models/availability/override', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key, forced: Boolean(forced) })
        }).then(function (res) {
            if (!res.ok) throw new Error('保存强制显示失败');
            return res.json();
        }).then(function (data) {
            if (forced) state.overrides[key] = true; else delete state.overrides[key];
            if (state.snapshot) state.snapshot.overrides = data.overrides || [];
            emit();
            if (state.channel) state.channel.postMessage({ type: 'changed' });
            return data;
        });
    }

    function start() {
        if (state.started) return;
        state.started = true;
        readCache();
        ensure();  // 不 await：首屏零阻塞
        setInterval(function () { if (!document.hidden) ensure(); }, SETTINGS.pollMs);
        try {
            state.channel = new BroadcastChannel(SETTINGS.channel);
            state.channel.onmessage = function (event) {
                if (event.data && event.data.type === 'changed') refresh();
            };
        } catch (e) { /* 不支持 BroadcastChannel 的页面靠轮询兜底 */ }
        window.addEventListener('storage', function (event) {
            if (event.key === SETTINGS.cacheKey) refresh();
        });
    }

    function install(options) {
        Object.assign(SETTINGS, options || {});
        start();
        return window.ModelAvailability;
    }

    window.ModelAvailability = {
        install: install, ensure: ensure, refresh: refresh, subscribe: subscribe,
        ready: function () { return Boolean(state.snapshot); },
        snapshot: function () { return state.snapshot; },
        isAvailable: isAvailable, isProviderAvailable: isProviderAvailable,
        isModelAvailable: isModelAvailable, isWorkflowAvailable: isWorkflowAvailable,
        reason: reason, isForced: isForced,
        filterModels: filterModels, filterProviders: filterProviders,
        filterWorkflows: filterWorkflows, unavailableList: unavailableList,
        setOverride: setOverride,
        keys: { provider: providerKey, model: modelKey, workflow: workflowKey }
    };
    start();
})();
