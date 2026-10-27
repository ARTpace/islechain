/*!
 * GalleryTimeline — 历史区竖向时间轴（可复用模块）
 *
 * 把按日期分组的瀑布流渲染成竖向时间线：
 *  - 左侧竖向时间轴(.tl-nav)：所有日期圆点排布在贯穿的青色轨道上
 *  - 首屏即列出完整历史的所有日期，所有时间点都在时间轴上，无需滚动即可点击任意时间点跳转
 *  - 点击任意节点平滑滚动到对应时间区；滚动时联动高亮当前节点
 *
 * 设计要点：
 *  1. CSS 由本模块注入，页面无需再写时间轴样式（引入即用，避免重复/漏改）。
 *  2. 时间轴用真实 DOM 元素(.tl-nav/.tl-nav-item)而非伪元素——
 *     因为 .date-separator 是 column-span:all，挂其身上的 ::before 在 CSS 多列布局下
 *     绝对定位会相对整个多列区域计算，圆点被挤到视口外不渲染；真实 DOM 走正常文档流。
 *  3. 复用 list.js 已生成的 .date-separator（按日期分组由 GalleryDisplay.DateGrouping 负责）。
 *  4. 自带 MutationObserver + 轮询兜底，覆盖翻页/自动扫描/新图插入等所有来源，
 *     不依赖页面主动调用，解决"异步加载导致时间轴没出现"的问题。
 *  5. 导航点基于「完整历史日期」构建（默认内置 defaultGetDates：fetch 全量 /api/history +
 *     回退 GalleryList.allHistory），因此首屏不等历史区逐页渲染就列出所有时间点；
 *     点击尚未渲染的日期时，默认内置 defaultOnMissing 会自动 load(1) 直到该日期出现再跳转。
 *
 * 用法：
 *  <script src="/static/modules/gallery/timeline.js"></script>
 *  <script> GalleryTimeline.attach({ container: '#masonry' }); </script>
 *  （可选覆盖：attach({ container, getDates, onMissing, scrollRoot })）
 */
(function (global) {
    'use strict';

    var NS = global.GalleryDisplay = global.GalleryDisplay || {};

    /* ===================== 样式（注入一次） ===================== */
    var CSS = [
        '/* === Gallery Timeline (injected by /static/modules/gallery/timeline.js) === */',
        '.tl-enabled { position: relative; padding-left: 34px; }',
        '.tl-enabled .date-separator {',
        '  position: relative; column-span: all; display: flex; align-items: center; gap: 10px;',
        '  padding: 16px 0 12px; margin: 0; cursor: pointer; scroll-margin-top: 10px;',
        '  border-radius: 8px; transition: background .15s ease;',
        '}',
        '.tl-enabled .date-separator:hover { background: rgba(6, 182, 212, 0.07); }',
        '.tl-enabled .date-separator .sep-line { display: none; }',
        '.tl-enabled .date-separator .sep-label {',
        '  font-size: 11px; font-weight: 800; color: #06b6d4; text-transform: uppercase;',
        '  letter-spacing: 0.06em; white-space: nowrap; background: rgba(0,240,255,0.08);',
        '  padding: 3px 11px; border-radius: 999px;',
        '}',
        '.tl-enabled .date-separator:hover .sep-label { background: rgba(0,240,255,0.16); }',
        '/* 左侧竖向时间轴：位置由 JS 动态计算，垂直居中于画廊在视口的可见区域，',
        '   始终被「夹」在展示区边界内（不穿插顶部提示词/引擎区），高度固定不随图片数量拉伸 */',
        '/* 显隐由 JS 按画廊展示区占据视口的比例控制——展示区占够大才显示 */',
        '.tl-nav {',
        '  position: fixed; left: 16px; top: 0; height: 72vh; max-height: 72vh; width: 14px; z-index: 45;',
        '  display: flex; flex-direction: column; justify-content: space-evenly; align-items: center;',
        '  pointer-events: none; opacity: 0; transition: opacity .2s ease, top .15s ease, height .15s ease;',
        '  overflow-y: auto; overflow-x: visible; scrollbar-width: none; -ms-overflow-style: none;',
        '}',
        '.tl-nav::-webkit-scrollbar { display: none; }',
        '.tl-nav.is-visible { opacity: 1; }',
        '.tl-nav::before {',
        '  content: ""; position: absolute; left: 50%; transform: translateX(-50%);',
        '  top: 2px; bottom: 2px; width: 2px; border-radius: 2px;',
        '  background: linear-gradient(180deg, rgba(0,240,255,0) 0%, rgba(0,240,255,0.55) 5%, rgba(0,240,255,0.55) 95%, rgba(0,240,255,0) 100%);',
        '}',
        '.tl-nav-item {',
        '  position: relative; width: var(--tl-dot, 13px); height: var(--tl-dot, 13px); flex: 0 0 auto; padding: 0; border-radius: 50%;',
        '  border: 2px solid #fcfcfb; background: #00f0ff; box-shadow: 0 0 0 2px rgba(0,240,255,0.28);',
        '  cursor: pointer; pointer-events: auto;',
        '  transition: transform .15s ease, box-shadow .15s ease, background .15s ease;',
        '}',
        '.tl-nav-item:hover { transform: scale(1.45); background: #00f0ff; box-shadow: 0 0 0 4px rgba(6, 182, 212, 0.22); }',
        '.tl-nav-item.is-active { background: #00f0ff; box-shadow: 0 0 0 4px rgba(6, 182, 212, 0.34); transform: scale(1.3); }',
        '.tl-nav-item.is-loading { animation: tl-pulse 0.9s ease-in-out infinite; background: #00f0ff; }',
        '@keyframes tl-pulse { 0%,100% { box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.28); } 50% { box-shadow: 0 0 0 7px rgba(6, 182, 212, 0.05); } }',
        '.tl-nav-item::after {',
        '  content: attr(data-label); position: absolute; left: 100%; margin-left: 9px; top: 50%;',
        '  transform: translateY(-50%); white-space: nowrap; font-size: 11px; font-weight: 800;',
        '  letter-spacing: 0.04em; color: #06b6d4; background: rgba(0,240,255,0.12);',
        '  padding: 3px 9px; border-radius: 999px; opacity: 0; pointer-events: none; transition: opacity .15s ease;',
        '}',
        '.tl-nav-item:hover::after { opacity: 1; }',
        '@media (max-width: 640px) { .tl-nav { left: 10px; width: 12px; } .tl-nav-item { width: 11px; height: 11px; } }',
        '/* 暗色主题（兼容 studio-theme-dark 与 theme-dark） */',
        'body.theme-dark .tl-nav::before, body.studio-theme-dark .tl-nav::before {',
        '  background: linear-gradient(180deg, rgba(0,240,255,0) 0%, rgba(0,240,255,0.5) 5%, rgba(0,240,255,0.5) 95%, rgba(0,240,255,0) 100%);',
        '}',
        'body.theme-dark .tl-enabled .date-separator .sep-label, body.studio-theme-dark .tl-enabled .date-separator .sep-label {',
        '  color: #00f0ff; background: rgba(0,240,255,0.12);',
        '}',
        'body.theme-dark .tl-enabled .date-separator:hover, body.studio-theme-dark .tl-enabled .date-separator:hover { background: rgba(6, 182, 212, 0.1); }',
        'body.theme-dark .tl-nav-item, body.studio-theme-dark .tl-nav-item { border-color: #121211; }',
        'body.theme-dark .tl-nav-item::after, body.studio-theme-dark .tl-nav-item::after { color: #00f0ff; background: rgba(0,240,255,0.14); }'
    ].join('\n');

    function injectCss() {
        if (document.getElementById('gallery-timeline-css')) return;
        var st = document.createElement('style');
        st.id = 'gallery-timeline-css';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    /* ===================== 模块状态 ===================== */
    var _container = null;      // 历史区容器(#masonry)
    var _scrollRoot = null;     // 滚动容器（自动探测，可传 scrollRoot 覆盖）
    var _nav = null;            // 右侧浮动导航 DOM
    var _navSig = '';           // 导航节点签名（避免无变化时重建闪烁）
    var _spyBound = false;      // 滚动联动绑定守卫
    var _observer = null;       // 容器子节点变更监听
    var _retry = null;          // 异步加载兜底轮询
    var _attached = false;
    var _dates = null;          // 全量日期 [{key,label}]（数据驱动导航）
    var _getDates = null;       // 取全量日期的回调（页面可覆盖）
    var _onMissing = null;      // 点击未渲染日期时的回调（页面可覆盖）
    var _topSafe = 0;           // 页面顶部固定/粘性栏底边高度（时间轴顶部不可低于此，避免穿插提示词区）

    function getScrollParent(el) {
        var p = el.parentElement;
        while (p) {
            var s = getComputedStyle(p);
            var oy = s.overflowY, o = s.overflow;
            if ((oy === 'auto' || oy === 'scroll' || o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
            p = p.parentElement;
        }
        return null;
    }

    function getScrollCtx() {
        return _scrollRoot || getScrollParent(_container) || global;
    }

    // 探测页面顶部「固定(fixed)/粘性(sticky)栏」的底边高度，
    // 时间轴顶部不可低于此值，从而避免向下滚动后时间轴探入顶部提示词/工具栏区域。
    // 只在 attach / resize 时调用（不进 scroll 热路径），遍历一次即可。
    function probeTopSafe() {
        var vh = global.innerHeight || document.documentElement.clientHeight;
        var safe = 0;
        var all = document.body ? document.body.getElementsByTagName('*') : [];
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el === _nav) continue;
            var r = el.getBoundingClientRect();
            if (r.bottom <= 0 || r.top > 8) continue; // 先快速排除：只关心贴在视口顶部(≤8px)的元素
            var cs = getComputedStyle(el);
            if (cs.position === 'fixed' || cs.position === 'sticky') {
                if (r.height >= vh * 0.5) continue; // 全屏遮罩/背景层不算顶栏，避免误测导致 _topSafe 卡死、时间轴消失
                if (r.bottom > safe) safe = r.bottom;
            }
        }
        return safe;
    }

    // 时间轴垂直居中于画廊在视口内的可见区域，并始终被「夹」在展示区边界内：
    // 这样无论画廊在视口哪个位置，时间轴都不会超出展示区上/下边界，自然也不会穿插顶部提示词/引擎区。
    function positionNav() {
        if (!_nav || !_container) return;
        var rect = _container.getBoundingClientRect();
        var vh = global.innerHeight || document.documentElement.clientHeight;

        // 顶栏安全下限：探测值若被全屏遮罩误测过大，钳制到视口 60% 以内，保证时间轴始终可见
        var topSafe = Math.min(_topSafe, Math.round(vh * 0.6));
        // 画廊在视口内的可见区域（顶部下限取页面固定/粘性顶栏底边，避免向下滚动后时间轴探入提示词/工具栏区）
        var visibleTop = Math.max(0, rect.top, topSafe);
        var visibleBottom = Math.min(vh, rect.bottom);
        var visibleHeight = Math.max(0, visibleBottom - visibleTop);
        if (visibleHeight < 10) return; // 几乎不可见，保持现状

        // 时间轴高度：用满画廊可见区域（留 4px 上下边距）、且不超过 72vh → 给圆点最大空间，避免挤压/溢出滚动
        var navHeight = Math.max(40, Math.min(Math.round(visibleHeight) - 4, Math.round(vh * 0.72)));
        // 垂直居中于可见区域 → 时间轴被夹在展示区范围内，不穿插提示词区
        var navTop = visibleTop + Math.round((visibleHeight - navHeight) / 2);
        // 兜底：防止顶部下限把时间轴整体推出视口底部
        if (navTop + navHeight > vh) navTop = Math.max(topSafe, vh - navHeight - 4);
        // 水平对齐画廊左内边缘（padding-left 区域内侧）
        var padLeft = parseFloat(getComputedStyle(_container).paddingLeft) || 34;
        var navLeft = Math.max(8, Math.round(rect.left) + Math.min(8, Math.round(padLeft / 2)));

        _nav.style.top = navTop + 'px';
        _nav.style.height = navHeight + 'px';
        _nav.style.left = navLeft + 'px';
    }

    // 在容器内按标签（去掉 "·N" 计数后缀）查找对应日期分隔线
    function findSepByLabel(label) {
        if (!_container || !label) return null;
        var seps = _container.querySelectorAll('.date-separator');
        for (var i = 0; i < seps.length; i++) {
            var lb = seps[i].querySelector('.sep-label');
            if (!lb) continue;
            var base = lb.dataset.baseText || lb.textContent.replace(/\s*·\d+\s*$/, '').trim();
            if (base === label) return seps[i];
        }
        return null;
    }

    // 本地时区 "YYYY-MM-DD"（与 DateGrouping.getKey 一致），作为 DateGrouping 缺失时的兜底
    function fallbackKey(ts) {
        try {
            var d = new Date(typeof ts === 'number' ? ts : Number(ts));
            if (isNaN(d.getTime())) return null;
            var y = d.getFullYear();
            var m = ('0' + (d.getMonth() + 1)).slice(-2);
            var da = ('0' + d.getDate()).slice(-2);
            return y + '-' + m + '-' + da;
        } catch (e) { return null; }
    }

    function cleanLabel(lb) {
        if (!lb) return '';
        return lb.dataset.baseText || lb.textContent.replace(/\s*·\d+\s*$/, '').trim();
    }

    function updateActive() {
        if (!_container) return;
        var seps = _container.querySelectorAll('.date-separator');
        if (!seps.length) return;
        var sc = getScrollCtx();
        var refY = (sc === global) ? 0 : sc.getBoundingClientRect().top;
        var lineY = refY + 96; // 顶部阈值线：判定"当前所处时间"
        var best = null, bestDist = Infinity;
        seps.forEach(function (sep) {
            var r = sep.getBoundingClientRect();
            if (r.top <= lineY + 1) {
                var d = lineY - r.top;
                if (d < bestDist) { bestDist = d; best = sep; }
            }
        });
        if (!best) best = seps[0];
        var bestLabel = cleanLabel(best.querySelector('.sep-label'));
        // 联动高亮左侧时间轴中对应项
        if (_nav) {
            for (var i = 0; i < _nav.children.length; i++) {
                var item = _nav.children[i];
                item.classList.toggle('is-active', item.getAttribute('data-label') === bestLabel);
            }
        }
    }

    function jump(sep) {
        try { sep.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        catch (e) { sep.scrollIntoView(); }
        var lbl = cleanLabel(sep.querySelector('.sep-label'));
        if (_nav) {
            for (var i = 0; i < _nav.children.length; i++) {
                _nav.children[i].classList.toggle('is-active', _nav.children[i].getAttribute('data-label') === lbl);
            }
        }
    }

    // 数据驱动导航点击：优先跳转已渲染的日期区，否则交给 onMissing 去加载
    function jumpToDate(key, label) {
        var sep = findSepByLabel(label);
        if (sep) { jump(sep); return; }
        if (_onMissing) _onMissing(key, label);
    }

    // 时间轴显隐：按「画廊展示区在视口内的可见高度」判断。
    // 只要展示区占据视口足够大的比例（>30%），或画廊完全在视口内，就显示时间轴；
    // 这样滚动浏览图片时（日期分隔线可能滚出视口，但画廊容器仍在视口内）时间轴不会消失。
    // 滚到顶部提示词框/引擎来源区（画廊可见高度很小）或滚过画廊底部后，自动隐藏。
    function updateVisibleState() {
        if (!_nav || !_container) return;
        var rect = _container.getBoundingClientRect();
        var vh = global.innerHeight || document.documentElement.clientHeight;
        var visibleTop = Math.max(0, rect.top);
        var visibleBottom = Math.min(vh, rect.bottom);
        var visibleHeight = Math.max(0, visibleBottom - visibleTop);
        var fullyInView = rect.top >= 0 && rect.bottom <= vh;
        // 展示区占视口 30% 以上，或画廊整体在视口内 → 显示
        var active = visibleHeight > vh * 0.3 || fullyInView;
        var shouldShow = !!(_dates && _dates.length > 1 && active);
        _nav.classList.toggle('is-visible', shouldShow);
    }

    function onScrollContextChanged() {
        updateActive();
        positionNav();
        updateVisibleState();
    }

    function onResize() {
        _topSafe = probeTopSafe();
        onScrollContextChanged();
    }

    function bindSpy() {
        if (_spyBound) return;
        _spyBound = true;
        var sc = _container ? getScrollCtx() : global;
        // 滚动时同步：高亮当前日期 + 按画廊可见区域重定位时间轴 + 显隐
        sc.addEventListener('scroll', onScrollContextChanged, { passive: true });
        global.addEventListener('resize', onResize);
    }

    // 构建时间轴导航：日期集合只来自数据层(_dates 或 gl.allHistory)，
    // 绝不读 DOM 中已渲染的 .date-separator——否则 list.js 的 pruneEmptySeparators
    // 会动态增删日期节点，导致圆点数量随加载漂移、越来越少。
    function buildNav() {
        if (!_nav) {
            _nav = document.createElement('div');
            _nav.id = 'tlNav';
            _nav.className = 'tl-nav';
            document.body.appendChild(_nav); // 挂到 body，脱离容器：固定高度、不随图片数量拉伸
            requestAnimationFrame(positionNav);
        }
        positionNav();
        var nodes = [];
        if (_dates && _dates.length) {
            nodes = _dates.map(function (d) { return { key: d.key, label: d.label, sep: null }; });
        } else if (global.GalleryList && global.GalleryList.allHistory && global.GalleryList.allHistory.length) {
            nodes = toDatesFromItems(global.GalleryList.allHistory).map(function (d) { return { key: d.key, label: d.label, sep: null }; });
        }
        if (nodes.length <= 1) {
            _nav.innerHTML = '';
            _navSig = '';
            updateVisibleState();
            return;
        }
        // 圆点按总数自适应缩小，保证所有时间点都在有限高度内完整显示（不溢出、不出现滚动条）
        var n = nodes.length;
        var dotSize = 13;
        if (n > 45) dotSize = 7;
        else if (n > 30) dotSize = 8;
        else if (n > 20) dotSize = 10;
        else if (n > 12) dotSize = 11;
        _nav.style.setProperty('--tl-dot', dotSize + 'px');
        var sig = '';
        nodes.forEach(function (n) { sig += n.label + '|'; });
        if (sig === _navSig) return; // 节点无变化则不重建，避免闪烁
        _navSig = sig;
        _nav.innerHTML = '';
        nodes.forEach(function (n) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tl-nav-item';
            btn.setAttribute('data-label', n.label);
            btn.title = '跳转到 ' + n.label;
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (n.sep) jump(n.sep);
                else jumpToDate(n.key, n.label);
            });
            _nav.appendChild(btn);
        });
        updateVisibleState(); // 由容器是否在视口内 + 日期数量共同决定是否显示
    }

    // 数据层去重：把历史记录归并成「全量日期」集合（最新在前）。
    // 关键：只基于数据(items / gl.allHistory)，绝不读 DOM —— 否则 list.js 的
    // pruneEmptySeparators 会动态增删 .date-separator，导致圆点数量随加载漂移。
    function toDatesFromItems(items) {
        var DG = (global.GalleryDisplay && global.GalleryDisplay.DateGrouping) || null;
        var seen = {}, keys = [];
        (items || []).forEach(function (it) {
            var k = DG ? DG.getKey(it.timestamp) : fallbackKey(it.timestamp);
            if (k && !seen[k]) { seen[k] = 1; keys.push(k); }
        });
        keys.sort(); keys.reverse(); // 倒序：最新在前
        return keys.map(function (k) { return { key: k, label: DG ? DG.formatLabel(k) : k }; });
    }

    /* ---- 默认：取完整历史日期（首屏即全量，不依赖分页渲染） ---- */
    function defaultGetDates() {
        return new Promise(function (resolve) {
            var gl = global.GalleryList;
            var type = (gl && gl.type) || '';
            var local = (gl && gl.allHistory && gl.allHistory.length) ? gl.allHistory : [];
            if (!type) { resolve(toDatesFromItems(local)); return; }
            fetch('/api/history?type=' + encodeURIComponent(type) + '&page=0&page_size=99999')
                .then(function (r) { return r.json(); })
                .then(function (json) {
                    var arr = Array.isArray(json) ? json : (json.items || []);
                    resolve(toDatesFromItems(arr.length ? arr : local));
                })
                .catch(function () { resolve(toDatesFromItems(local)); });
        });
    }

    /* ---- 默认：点击尚未渲染的日期时，自动 load(1) 逐页加载直到该日期出现再跳转 ---- */
    function defaultOnMissing(key, label) {
        var gl = global.GalleryList;
        var sep = findSepByLabel(label);
        if (sep) { jump(sep); return; }
        if (!gl || !gl.load) return;
        // 高亮正在加载的导航点，给出反馈
        var loadingItem = null;
        if (_nav) {
            for (var i = 0; i < _nav.children.length; i++) {
                if (_nav.children[i].getAttribute('data-label') === label) { loadingItem = _nav.children[i]; break; }
            }
        }
        if (loadingItem) loadingItem.classList.add('is-loading');
        var tries = 0;
        (function step() {
            var s = findSepByLabel(label);
            if (s) {
                if (loadingItem) loadingItem.classList.remove('is-loading');
                jump(s);
                refreshDates(); // 加载后同步全量日期，确保时间点数量稳定（不再随 DOM prune 漂移）
                return;
            }
            // 以「分页真实到底」作为终止条件，而非「日期节点数量是否增加」——
            // 否则连续两页同日期时节点数不增会被误判为到底，导致后续日期永远加载不到。
            if (gl.hasMore === false) {
                if (loadingItem) loadingItem.classList.remove('is-loading');
                refreshDates();
                return;
            }
            if (tries >= 200) {
                if (loadingItem) loadingItem.classList.remove('is-loading');
                refreshDates();
                return;
            }
            tries++;
            Promise.resolve(gl.load(1)).then(step).catch(function () {
                if (loadingItem) loadingItem.classList.remove('is-loading');
                refreshDates();
            });
        })();
    }

    function build() {
        if (!_container) return;
        // 每个已渲染的日期分隔线：整行可点击跳转到对应时间区（绑定一次）
        var seps = _container.querySelectorAll('.date-separator');
        seps.forEach(function (sep) {
            if (!sep.dataset.tlBound) {
                sep.dataset.tlBound = '1';
                var lbl = sep.querySelector('.sep-label');
                sep.title = '点击跳转到 ' + cleanLabel(lbl);
                sep.addEventListener('click', function () { jump(sep); });
            }
        });
        buildNav();
        bindSpy();
        updateActive();
        positionNav();
        updateVisibleState();
    }

    function scheduleRetry() {
        if (_retry) return;
        var tries = 0;
        _retry = setInterval(function () {
            tries++;
            if (!_container) { clearInterval(_retry); _retry = null; return; }
            var seps = _container.querySelectorAll('.date-separator');
            if (seps.length) {
                build();
                clearInterval(_retry);
                _retry = null;
            } else if (tries > 40) { // ~6s 兜底，超过则停止轮询（自动扫描/新图仍由 observer 覆盖）
                clearInterval(_retry);
                _retry = null;
            }
        }, 150);
    }

    // 拉取/刷新全量日期集合（数据驱动导航）
    function refreshDates() {
        if (!_getDates) return;
        Promise.resolve(_getDates()).then(function (dates) {
            if (Array.isArray(dates)) { _dates = dates; buildNav(); }
        }).catch(function (e) { console.warn('[GalleryTimeline] getDates failed', e); });
    }

    /* ===================== 对外 API ===================== */
    function attach(opts) {
        opts = opts || {};
        injectCss();
        var c = typeof opts.container === 'string'
            ? document.querySelector(opts.container)
            : (opts.container || document.getElementById('masonry'));
        if (!c) {
            console.warn('[GalleryTimeline] container not found, skip attach.');
            return;
        }
        _container = c;
        _container.classList.add('tl-enabled');
        if (opts.scrollRoot) {
            _scrollRoot = typeof opts.scrollRoot === 'string'
                ? document.querySelector(opts.scrollRoot)
                : opts.scrollRoot;
        }
        _getDates = opts.getDates || defaultGetDates;
        _onMissing = opts.onMissing || defaultOnMissing;
        if (_attached) { build(); refreshDates(); return; }
        _attached = true;
        // 立即尝试构建（若历史区已渲染）
        build();
        // 探测页面顶部固定/粘性栏底边，作为时间轴顶部下限（避免穿插提示词区）；
        // 布局稳定后再探一次，覆盖字体/图片加载导致的顶栏高度变化；
        // 并在 500ms 后兜底再探一次，避免初始加载遮罩(fullscreen overlay)被误测为顶栏导致 _topSafe 卡死。
        _topSafe = probeTopSafe();
        requestAnimationFrame(function () { _topSafe = probeTopSafe(); positionNav(); });
        setTimeout(function () { _topSafe = probeTopSafe(); positionNav(); updateVisibleState(); }, 500);
        // 容器子节点变更（翻页/自动扫描/新图插入）后重绘
        if (_observer) _observer.disconnect();
        _observer = new MutationObserver(function () { build(); });
        _observer.observe(_container, { childList: true });
        // 兜底：历史区可能尚未加载完成，轮询直到出现日期节点
        scheduleRetry();
        // 首屏即拉全量日期构建导航（不依赖历史区分页渲染）
        refreshDates();
        // 滚动/resize 时按「画廊在视口的实际位置」显隐时间轴与高亮（见 bindSpy）
    }

    function rebuild() {
        if (_container) build();
        refreshDates();
    }

    function destroy() {
        if (_observer) { _observer.disconnect(); _observer = null; }
        if (_retry) { clearInterval(_retry); _retry = null; }
        if (_nav) { _nav.remove(); _nav = null; }
        if (_container) { _container.classList.remove('tl-enabled'); _container = null; }
        _dates = null;
        _getDates = null;
        _onMissing = null;
        _navSig = '';
        _attached = false;
    }

    var api = { attach: attach, rebuild: rebuild, destroy: destroy };
    NS.Timeline = api;
    global.GalleryTimeline = api;
})(window);
