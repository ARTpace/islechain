/**
 * 桌面穿透态桥接层。
 *
 * 透明画布**不是另一个窗口**，而是主窗口自己换皮。这个模块负责：
 *   1. 给 body 加 `desktop-overlay` 类（CSS 靠它把背景/工具栏藏掉）
 *   2. 把每个节点的屏幕矩形上报给后端（`POST /api/desktop/overlay-rects`），
 *      Rust 侧轮询拉走，交给 `SetWindowRgn` 把**主窗口**裁成"节点形状"
 *
 * 开关由 Rust 通过 `window.__setOverlayMode(true/false)` 控制，可反复切换。
 * 坐标是**相对窗口左上角的 CSS 像素**，缩放交给 Rust 侧按 scale_factor 换算。
 */
(function () {
    const params = new URLSearchParams(location.search);
    const PAD = 2;             // 只留抗锯齿，外扩太大就会在卡片外露出一圈窗口底
    const INTERVAL = 250;      // 静止时的心跳；拖动不靠这个追矩形
    const ENDPOINT = '/api/desktop/overlay-rects';

    let dock = null;
    let lastPayload = '';
    let timer = null;
    let tickCount = 0;
    let running = false;
    let bound = false;
    let holding = false;       // 指针按在节点上：区域改整屏，避免拖出卡片就断

    function frameOffset() {
        // 画布在工作室的 iframe 里时，矩形要加上框相对主窗口的位置。
        if (!window.frameElement) return [0, 0];
        const r = window.frameElement.getBoundingClientRect();
        return [r.left, r.top];
    }

    function boundsOf(el) {
        const r = el.getBoundingClientRect();
        let left = r.left;
        let top = r.top;
        let right = r.right;
        let bottom = r.bottom;
        // 接口和缩放手柄画在节点盒子外面，只量 .node 会把它们裁掉。
        el.querySelectorAll('.port, .resize-handle').forEach(part => {
            const p = part.getBoundingClientRect();
            if (p.width < 1 || p.height < 1) return;
            left = Math.min(left, p.left);
            top = Math.min(top, p.top);
            right = Math.max(right, p.right);
            bottom = Math.max(bottom, p.bottom);
        });
        return { left, top, right, bottom };
    }

    function rectOf(el) {
        const b = boundsOf(el);
        const width = b.right - b.left;
        const height = b.bottom - b.top;
        if (width < 2 || height < 2) return null;
        const [ox, oy] = frameOffset();
        const left = b.left + ox;
        const top = b.top + oy;
        if (top + height <= 0 || left + width <= 0 || top >= screen.height || left >= screen.width) return null;
        return [Math.round(left) - 4, Math.round(top) - 4, Math.round(width) + 8, Math.round(height) + 8];
    }

    function collect() {
        const out = [];
        document.querySelectorAll('#nodes > .node').forEach(node => {
            if (node.classList.contains('is-collapsed') || node.style.display === 'none') return;
            const r = rectOf(node);
            if (!r) return;
            out.push(r);
        });
        if (dock) {
            const d = rectOf(dock);
            if (d) out.push(d);
        }
        // 命令面板打开时也要并进窗口区域，否则面板所在位置会被 SetWindowRgn 裁掉，
        // 点击直接穿透到桌面其它应用。开关面板时 canvas.js 会调 CanvasOverlay.sync()。
        const palette = document.getElementById('commandPalette');
        if (palette && palette.classList.contains('open')) {
            const p = rectOf(palette);
            if (p) out.push(p);
        }
        // Toast 同理：短暂的反馈浮层也要能点在窗口里。
        const toasts = document.getElementById('canvasToastStack');
        if (toasts && toasts.children.length) {
            const t = rectOf(toasts);
            if (t) out.push(t);
        }
        return out;
    }

    async function flush(force) {
        if (!running) return;
        const rects = collect();
        const payload = JSON.stringify({ key: '', mode: 'tight', rects });
        if (!force && payload === lastPayload) return;
        lastPayload = payload;
        try {
            await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true,
            });
        } catch (error) {
            // 后端临时不可用不该影响画布本身
            lastPayload = '';
        }
    }

    function tick() {
        tickCount += 1;
        // 每 5 秒无条件重发：后端有 6 秒 TTL，节点静止时也不能让它过期，
        // 否则窗口区域会退化成只剩右下角控制条。
        flush(tickCount % 20 === 0);
        if (running) timer = setTimeout(tick, INTERVAL);
    }

    /** 立即上报一次（拖动/缩放结束、节点增删时调用，不等节流） */
    function sync() {
        if (!running) return;
        flush();
    }

    function buildDock() {
        if (dock) return dock;
        dock = document.createElement('div');
        dock.id = 'overlayDock';
        dock.className = 'overlay-dock';
        dock.innerHTML = `
            <button type="button" data-act="commands" title="命令面板（Ctrl+K）"><i data-lucide="command"></i></button>
            <button type="button" data-act="fit" title="全部节点适应窗口"><i data-lucide="maximize-2"></i></button>
            <button type="button" data-act="reload" title="重新加载画布"><i data-lucide="refresh-cw"></i></button>
            <button type="button" data-act="exit" class="dock-exit" title="退出透明模式"><i data-lucide="log-out"></i></button>`;
        document.body.appendChild(dock);
        dock.addEventListener('mousedown', e => e.stopPropagation());
        dock.addEventListener('click', e => {
            const btn = e.target.closest('button[data-act]');
            if (!btn) return;
            e.stopPropagation();
            if (btn.dataset.act === 'reload') location.reload();
            // 原来这里调的是并不存在的 fitCanvasToNodes，是个静默失效的死链。
            else if (btn.dataset.act === 'fit') window.fitAllNodesViewport?.(undefined, true);
            else if (btn.dataset.act === 'commands') window.CanvasCommandPalette?.toggle();
            else if (btn.dataset.act === 'exit') exitOverlay();
        });
        if (window.lucide) window.lucide.createIcons({ root: dock });
        return dock;
    }

    /** 退出透明模式：页面是 127.0.0.1:7000 的远程 origin，调不了 Tauri IPC，
     *  所以走一个 HTTP 信号，Rust 侧的矩形轮询会捡到 EXIT 并把窗口还原。
     *  注意不要在这里自己 stop()：那只撤皮肤不还窗口，反而变成全屏不透明挡板。 */
    function exitOverlay() {
        fetch('/api/desktop/overlay-exit', { method: 'POST', keepalive: true }).catch(() => {});
    }

    function bindOnce() {
        if (bound) return;
        bound = true;
        window.addEventListener('pointerdown', event => {
            if (!running || !event.target.closest?.('.node')) return;
            holding = true;
            flush(true);
        }, true);
        window.addEventListener('pointermove', () => {
            if (!running || !holding) return;
            flush(true);
        }, true);
        window.addEventListener('wheel', event => {
            if (!running) return;
            if (!event.target.closest?.('.node')) return;
            window.__canvasWheelZoom?.(event);
        }, { capture: true, passive: false });
        window.addEventListener('pointerup', () => {
            if (!holding) return;
            holding = false;
            flush(true);
        }, true);
        window.addEventListener('pointercancel', () => {
            if (!holding) return;
            holding = false;
            flush(true);
        }, true);
        window.addEventListener('resize', sync);
        window.addEventListener('pointerup', sync, true);
        window.addEventListener('wheel', () => {
            clearTimeout(bindOnce.wheelTimer);
            bindOnce.wheelTimer = setTimeout(sync, 140);
        }, { passive: true });
        const nodes = document.getElementById('nodes');
        if (nodes) {
            new MutationObserver(() => sync()).observe(nodes, { childList: true, subtree: false });
        }
    }

    function paint(on) {
        [document.documentElement, document.body, document.getElementById('shell'), document.getElementById('board'), document.getElementById('world')].forEach(el => {
            if (!el) return;
            if (on) {
                el.style.setProperty('background', 'transparent', 'important');
                el.style.setProperty('background-color', 'transparent', 'important');
                el.style.setProperty('background-image', 'none', 'important');
            } else {
                el.style.removeProperty('background');
                el.style.removeProperty('background-color');
                el.style.removeProperty('background-image');
            }
        });
    }

    function start() {
        if (running) return;
        running = true;
        document.body.classList.add('desktop-overlay');
        paint(true);
        buildDock();
        bindOnce();
        // 尽快上报一次：Rust 进穿透态时先把区域收成右下角控制条，
        // 这里越早补上节点矩形，屏幕上"只有一条"的过渡就越短。
        setTimeout(() => {
            if (!running) return;
            flush(true);
            tick();
        }, 60);
    }

    function stop() {
        if (!running) return;
        running = false;
        clearTimeout(timer);
        timer = null;
        document.body.classList.remove('desktop-overlay');
        paint(false);
        if (dock) {
            dock.remove();
            dock = null;
        }
        lastPayload = '';
    }

    window.__setOverlayMode = on => (on ? start() : stop());
    window.CanvasOverlay = {
        get enabled() { return running; },
        start,
        stop,
        sync,
        collect,
        exit: exitOverlay,   // 供 Ctrl+K 命令面板「退出透明穿透模式」调用
    };

    // URL 带 mode=desktop 时自动进入（快捷方式「启动即穿透」走这条路）
    const auto = (window.__CANVAS_MODE__ || params.get('mode')) === 'desktop';
    const boot = () => { if (auto) start(); };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
