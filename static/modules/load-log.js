// 刷新诊断：只记录耗时与去掉查询参数的路径，不读取请求/响应内容。
(function () {
    'use strict';
    if (window.ArtLoadLog) return;
    const KEY = 'art_load_logs_v1';
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const startedAt = new Date().toISOString();
    const requests = [];
    const stages = [];
    const longTasks = [];
    let saveTimer;
    function pathOf(value) {
        try {
            const url = new URL(value, location.href);
            return (url.origin === location.origin ? '' : url.origin) + url.pathname
                .replace(/(\/api\/conversations\/)[^/]+/g, '$1:id');
        } catch (_) { return '[unknown]'; }
    }
    const ms = value => Math.round(value || 0);
    function snapshot() {
        const nav = performance.getEntriesByType('navigation')[0];
        const paints = performance.getEntriesByType('paint');
        return {
            id, startedAt, page: pathOf(location.href), frame: window === window.top ? 'main' : 'iframe',
            elapsedMs: ms(performance.now()),
            navigation: nav ? {
                type: nav.type, ttfbMs: ms(nav.responseStart - nav.requestStart),
                downloadMs: ms(nav.responseEnd - nav.responseStart),
                domReadyMs: ms(nav.domContentLoadedEventEnd), loadMs: ms(nav.loadEventEnd)
            } : null,
            paints: paints.map(p => ({name: p.name, atMs: ms(p.startTime)})),
            stages: stages.slice(-40),
            requests: requests.slice(-100).map(r => ({...r,
                durationMs: r.pending ? ms(performance.now() - r.startMs) : r.durationMs})),
            slowResources: performance.getEntriesByType('resource')
                .slice().sort((a, b) => b.duration - a.duration).slice(0, 30)
                .map(r => ({path: pathOf(r.name), type: r.initiatorType,
                    startMs: ms(r.startTime), durationMs: ms(r.duration),
                    ttfbMs: ms(r.responseStart - r.requestStart), transferBytes: r.transferSize,
                    bodyBytes: r.encodedBodySize,
                    serverTiming: (r.serverTiming || []).map(t => ({name: t.name, durationMs: t.duration}))})),
            longTasks: longTasks.slice(-30)
        };
    }
    function history() {
        try {
            const rows = JSON.parse(localStorage.getItem(KEY) || '[]');
            return Array.isArray(rows) ? rows : [];
        } catch (_) { return []; }
    }
    function save() {
        const report = snapshot();
        try { localStorage.setItem(KEY, JSON.stringify(history().filter(r => r.id !== id).concat(report).slice(-8))); }
        catch (_) { /* 禁用存储或配额不足时仍可在控制台查看当前报告。 */ }
        return report;
    }
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 500);
    }
    function report() {
        const data = save();
        console.groupCollapsed('[LoadPerf] ' + data.page + ' · ' + data.elapsedMs + ' ms');
        console.log('页面时间', data.navigation, data.paints);
        console.table(data.stages);
        console.table(data.requests.slice().sort((a, b) => b.durationMs - a.durationMs).slice(0, 20));
        console.table(data.slowResources);
        console.log('主线程长任务', data.longTasks);
        console.groupEnd();
        return data;
    }
    window.ArtLoadLog = {
        report,
        measure(name, start, details) {
            if (stages.length >= 40) stages.shift();
            stages.push({name, startMs: ms(start), durationMs: ms(performance.now() - start), ...details});
            scheduleSave();
        },
        download() {
            save();
            const url = URL.createObjectURL(new Blob([JSON.stringify(history(), null, 2)], {type: 'application/json'}));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'art-canvas-load-log.json';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    };
    const fetchOriginal = window.fetch;
    window.fetch = function (input, options) {
        const row = {path: pathOf(typeof input === 'string' || input instanceof URL ? input : input?.url),
            startMs: performance.now(), pending: true};
        if (requests.length >= 100) requests.shift();
        requests.push(row);
        // 只观察响应头到达时间；完整下载时间看 Resource Timing，不克隆响应或读取正文。
        return fetchOriginal.apply(this, arguments).then(response => {
            row.status = response.status;
            row.serverTiming = response.headers?.get('Server-Timing') || '';
            row.serverBoot = response.headers?.get('X-ArtCanvas-Boot') || '';
            row.serverVersion = response.headers?.get('X-ArtCanvas-Perf') || '';
            return response;
        }, error => {
            row.error = error.name || 'Error';
            throw error;
        }).finally(() => {
            row.pending = false;
            row.durationMs = ms(performance.now() - row.startMs);
            scheduleSave();
        });
    };
    try {
        new PerformanceObserver(list => {
            for (const item of list.getEntries()) {
                if (longTasks.length >= 30) longTasks.shift();
                longTasks.push({startMs: ms(item.startTime), durationMs: ms(item.duration)});
            }
        }).observe({type: 'longtask', buffered: true});
    } catch (_) { /* 部分浏览器不支持 Long Tasks API。 */ }
    document.addEventListener('DOMContentLoaded', () => {
        window.ArtLoadLog.measure('DOMContentLoaded', 0);
    }, {once: true});
    window.addEventListener('load', () => {
        setTimeout(report, 2000);
        setTimeout(report, 15000);
    }, {once: true});
    // 即使某个资源一直不结束，也能留下未完成请求。
    setTimeout(report, 10000);
    window.addEventListener('pagehide', save);
})();
