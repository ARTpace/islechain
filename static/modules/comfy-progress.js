/* 任务进度条绘制 —— 工具页共用（comfy-tool-runtime 内部使用，也可单独用）
 *
 * 9 个工具页原来的 startProgress / updateRealProgress / completeProgress / hideProgress
 * 是同一份代码抄了 7 遍，差别只有 DOM id 和节点中文名。这里把它们收成一份，
 * DOM 契约固定为：容器加 .active 显示，fill 宽度、percent 文本、status 文案。
 *
 * 用法：
 *   const bar = ComfyProgress.create({ container:'progressInline', fill:'progressFill',
 *                                      percent:'progressPercent', status:'progressStatus' },
 *                                    { nodeTitles: { '123': '采样' } });
 *   bar.start(); bar.update({status:'sampling', value:3, max:20}); bar.complete(); bar.hide();
 */
(function () {
    'use strict';

    var DEFAULT_IDS = {
        container: 'progressInline',
        fill: 'progressFill',
        percent: 'progressPercent',
        status: 'progressStatus'
    };

    // 状态灯的四种配色（原来在 8 个页面里各写一遍 className 字符串）
    var DOT_CLASSES = {
        ready: 'w-1.5 h-1.5 bg-green-500 rounded-full',
        offline: 'w-1.5 h-1.5 bg-red-500 rounded-full',
        busy: 'w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse',
        idle: 'w-1.5 h-1.5 bg-black rounded-full'
    };

    function byId(id) {
        return id ? document.getElementById(id) : null;
    }

    function create(ids, options) {
        var map = Object.assign({}, DEFAULT_IDS, ids || {});
        var titles = (options && options.nodeTitles) || {};

        // 所有取元素都做空值保护：页面精简掉某个节点时不应该整页报错
        function paint(percent, text) {
            var fill = byId(map.fill);
            var pct = byId(map.percent);
            var status = byId(map.status);
            if (fill) fill.style.width = percent + '%';
            if (pct) pct.textContent = percent + '%';
            if (status && text) status.textContent = text;
        }

        function show() {
            var box = byId(map.container);
            if (box) box.classList.add('active');
        }

        function nodeTitle(id) {
            if (!id) return '...';
            // titles 可以是「节点 id → 中文名」的字典，也可以是解析函数
            if (typeof titles === 'function') return titles(id) || ('#' + id);
            return titles[id] || ('#' + id);
        }

        return {
            paint: paint,
            show: show,

            start: function (text) {
                show();
                paint(0, text || '正在提交任务...');
            },

            update: function (event) {
                show();
                var status = event.status;
                if (status === 'started') {
                    paint(2, 'ComfyUI 开始执行...');
                } else if (status === 'executing') {
                    paint(5, '执行节点: ' + nodeTitle(event.node));
                } else if (status === 'cached') {
                    var line = byId(map.status);
                    if (line) line.textContent = '部分节点命中缓存';
                } else if (status === 'sampling') {
                    var value = event.value || 0;
                    var max = event.max || 1;
                    // 采样占 10%~90%，剩下留给解码与保存
                    paint(10 + Math.round((value / max) * 80), '采样中 ' + value + '/' + max);
                } else if (status === 'done') {
                    paint(95, '解码保存中...');
                }
            },

            complete: function (text) {
                show();
                paint(100, text || '生成完成！');
            },

            hide: function () {
                var box = byId(map.container);
                if (box) box.classList.remove('active');
            }
        };
    }

    /* 服务器状态灯：页面标题旁的小圆点 + 文案 */
    function createStatus(ids) {
        var map = Object.assign({ text: 'statusText', dot: 'dotColor' }, ids || {});

        function set(text, kind) {
            var label = byId(map.text);
            var dot = byId(map.dot);
            if (label && text) label.innerText = text;
            if (dot && DOT_CLASSES[kind]) dot.className = DOT_CLASSES[kind];
        }

        return {
            set: set,

            // 一律走代理：直连 8188 在页面上是跨源请求，会被 CORS 拦成 Offline
            check: async function (apiFetch) {
                try {
                    var response = await apiFetch('/api/comfyui/system_stats');
                    if (!response.ok) throw new Error('Server not responding');
                    set('System Ready', 'ready');
                    return true;
                } catch (e) {
                    set('System Offline', 'offline');
                    return false;
                }
            },

            queue: async function (clientId) {
                try {
                    var res = await fetch('/api/queue_status?client_id=' + encodeURIComponent(clientId));
                    var data = await res.json();
                    if (data.total > 0) set('Queueing ' + data.position + '/' + data.total, 'busy');
                    else set('System Ready', 'idle');
                } catch (e) {
                    /* 队列接口偶发失败不影响主流程 */
                }
            }
        };
    }

    window.ComfyProgress = { create: create, createStatus: createStatus, DEFAULT_IDS: DEFAULT_IDS };
})();
