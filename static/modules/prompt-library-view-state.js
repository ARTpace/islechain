/* 提示词库「会话级视图状态」：分类 / 子分类 / 内容类型 / 排序 / 滚动位置。
 *
 * 生命周期：只在一次工具会话内记住。父窗口重新加载（重启工具 / 刷新）会换一个
 * session 令牌，旧快照立即失效。搜索词刻意不进快照：iframe 重建时输入框回到空，
 * 满足「重启工具清除搜索记录」。
 *
 * 依赖倒置：不直接读写 asset-manager.js 的内部变量，只认注入的
 * window.PromptLibraryStateBridge（snapshot / restore / setScroll）。
 * 宿主可通过 install({scrollSelector}) 换滚动容器，不需改本模块。
 */
(function (global) {
    'use strict';

    var KEY_PREFIX = 'islechain.plib.view.';
    var VERSION = 1;
    var SUSPEND_MESSAGE = 'prompt-library:suspend';

    var session = '';
    var scrollSelector = '.prompt-gallery-scroll';
    var captureTimer = null;
    var installed = false;
    var pendingRestore = false;

    function storage() {
        try { return global.sessionStorage; } catch (_) { return null; }
    }
    function bridge() { return global.PromptLibraryStateBridge || null; }
    function key() { return KEY_PREFIX + session; }
    function scroller() {
        try { return document.querySelector(scrollSelector); } catch (_) { return null; }
    }

    function prune(store) {
        if (!store) return;
        try {
            for (var i = store.length - 1; i >= 0; i--) {
                var k = store.key(i);
                if (k && k.indexOf(KEY_PREFIX) === 0 && k !== key()) store.removeItem(k);
            }
        } catch (_) { /* 隐私模式忽略 */ }
    }

    function read() {
        var store = storage();
        if (!store || !session) return null;
        try {
            var raw = JSON.parse(store.getItem(key()) || 'null');
            if (!raw || raw.v !== VERSION || !raw.state || typeof raw.state !== 'object') return null;
            return raw.state;
        } catch (_) { return null; }
    }

    function write(state) {
        var store = storage();
        if (!store || !session || !state) return;
        try {
            store.setItem(key(), JSON.stringify({ v: VERSION, state: state }));
            prune(store);
        } catch (_) { /* 容量/隐私模式忽略 */ }
    }

    function scrollOf() {
        var el = scroller();
        if (!el) return null;
        return { scrollTop: Math.round(el.scrollTop), scrollLeft: Math.round(el.scrollLeft) };
    }

    // 只记导航状态，不记 promptQuery：重启后搜索框必须是空的
    function capture() {
        var b = bridge();
        if (!b || !session || typeof b.snapshot !== 'function') return;
        var state = b.snapshot() || {};
        delete state.query;
        var sc = scrollOf();
        if (sc) { state.scrollTop = sc.scrollTop; state.scrollLeft = sc.scrollLeft; }
        write(state);
    }

    function scheduleCapture(delay) {
        clearTimeout(captureTimer);
        captureTimer = setTimeout(capture, delay || 160);
    }

    // 瀑布流 / 服务端分页异步回来会重排，内容变高后要补设几次才能真正滚到原位
    function applyScroll(state, tries) {
        var b = bridge();
        if (!b || !state || typeof b.setScroll !== 'function') return;
        var top = Number(state.scrollTop) || 0;
        var left = Number(state.scrollLeft) || 0;
        if (top <= 0 && left <= 0) return;
        var attempt = function (n) {
            var el = scroller();
            if (!el) return;
            b.setScroll(top, left);
            if (n > 0 && el.scrollTop < top - 2) {
                setTimeout(function () { attempt(n - 1); }, 220);
            }
        };
        global.requestAnimationFrame(function () { attempt(tries || 3); });
    }

    function restoreScrollOnly() {
        var state = read();
        if (!state) return false;
        applyScroll(state, 4);
        return true;
    }

    function restore() {
        var b = bridge();
        var state = read();
        if (!b || typeof b.restore !== 'function' || !state) return false;
        b.restore(state);
        applyScroll(state, 6);
        return true;
    }

    function bind(next) {
        var value = String(next || '');
        if (value === session) return;
        session = value;
        // 空令牌 = 宿主未提供会话（如画布内嵌库），不启用快照、也不清理别人的键
        if (value) prune(storage());
    }

    // loadAll() 完成后数据才齐，分类对应的列表此时才能正确渲染
    function onReady() {
        if (!pendingRestore) { restoreScrollOnly(); return; }
        pendingRestore = false;
        restore();
    }

    function install(options) {
        if (options && options.scrollSelector) scrollSelector = options.scrollSelector;
        if (installed) return;
        installed = true;
        // 捕获阶段监听：inner HTML 重绘后新元素上的事件同样能抓到
        document.addEventListener('scroll', function () { scheduleCapture(220); }, true);
        document.addEventListener('input', function () { scheduleCapture(200); }, true);
        document.addEventListener('change', function () { scheduleCapture(200); }, true);
        document.addEventListener('click', function () { scheduleCapture(260); }, true);
        global.addEventListener('message', function (event) {
            if (event.origin !== location.origin || event.source !== global.parent) return;
            if (event.data && event.data.type === SUSPEND_MESSAGE) {
                clearTimeout(captureTimer);
                capture();
            }
        });
    }

    global.PromptLibraryViewState = {
        install: install,
        bind: bind,
        capture: capture,
        restore: restore,
        restoreScrollOnly: restoreScrollOnly,
        markPendingRestore: function () { pendingRestore = true; },
        onReady: onReady,
        read: read,
        session: function () { return session; }
    };
})(window);
