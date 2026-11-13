/* ComfyUI 可用性 —— 共享状态
 *
 * 为什么要有它：文生图页（zimage.html）自己轮询 /api/comfyui/process-status，
 * 探测到 ComfyUI 没运行就把本地模型组隐藏掉、并自动切到在线渠道。
 * 画布生成节点（canvas-generation-node.js）和材质重绘（texture-repaint.html）
 * 用的是同一个 ModelPicker 渲染组件，但各自只调 localRows() 直接把本地工作流
 * 全列出来，从来没探测过——于是没运行的 ComfyUI 模型也照常显示、还能选中，
 * 点下去才在运行时失败。
 *
 * 渲染复用了，可用性探测没复用。这里把探测收成一份共享状态，三处共用。
 *
 * 用法：
 *   ComfyStatus.start()                       页面加载时调一次，之后每 5 秒刷新
 *   ComfyStatus.offline()                     true=明确离线 / false=在线 / null 视作未知
 *   ComfyStatus.subscribe(fn)                 状态变化回调 fn(reachable)，返回退订函数
 *   ComfyStatus.keepLocalRow(rows, workflow)  离线时只留当前选中的那一行
 */
(function () {
    'use strict';

    var POLL_MS = 5000;
    var reachable = null;      // null = 还没探测完，此时按「未知」处理，不隐藏任何模型
    var timer = 0;
    var inFlight = null;
    var listeners = [];

    function emit() {
        listeners.slice().forEach(function (fn) {
            try { fn(reachable); } catch (e) { /* 单个订阅者出错不影响其余 */ }
        });
    }

    function refresh() {
        if (inFlight) return inFlight;
        inFlight = fetch('/api/comfyui/process-status', { credentials: 'same-origin' })
            .then(function (resp) {
                if (!resp.ok) throw new Error('process-status');
                return resp.json();
            })
            .then(function (data) { return data.reachable === true; })
            .catch(function () { return false; })
            .then(function (ok) {
                var changed = reachable !== ok;
                reachable = ok;
                inFlight = null;
                if (changed) emit();
                return ok;
            });
        return inFlight;
    }

    function tick() {
        clearTimeout(timer);
        refresh().catch(function () {}).then(function () {
            timer = setTimeout(tick, POLL_MS);
        });
    }

    function start() {
        if (timer || inFlight) return;
        tick();
    }

    // 离线时别把当前正在用的本地模型一起藏掉，否则用户看不到自己在用什么，
    // 也不知道为什么生成的按钮还在那儿。留下这一行、标成不可用即可。
    function keepLocalRow(rows, workflow) {
        if (!workflow) return [];
        return (rows || []).filter(function (row) {
            return (row.workflows || []).indexOf(workflow) >= 0;
        });
    }

    window.ComfyStatus = {
        start: start,
        refresh: refresh,
        reachable: function () { return reachable; },
        offline: function () { return reachable === false; },
        keepLocalRow: keepLocalRow,
        subscribe: function (fn) {
            if (typeof fn !== 'function') return function () {};
            listeners.push(fn);
            return function () {
                listeners = listeners.filter(function (item) { return item !== fn; });
            };
        }
    };
})();
