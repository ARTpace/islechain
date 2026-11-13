// 生成类浮层统一锚定到触发按钮：优先出现在按钮上方，按钮搬家 / 布局变化自动跟随。
// 任何菜单都只需调用 place(menu, anchorButton, {width, preferAbove, align})，不再写死 left/top。
(function () {
    const tracked = new Map();
    let scheduled = false, watching = false;
    // 测试桩 / 轻量元素可能没有 getClientRects，此时按「已挂载即可见」处理。
    const visible = el => !!el.isConnected && (typeof el.getClientRects !== 'function' || el.getClientRects().length > 0);
    const anchorObserver = window.ResizeObserver ? new ResizeObserver(() => schedule()) : null;

    function place(menu, anchor, options = {}) {
        const isNew = !tracked.has(menu);
        tracked.set(menu, {anchor, options});
        if (isNew && anchorObserver && anchor && anchor.isConnected) anchorObserver.observe(anchor);
        startWatch();
        if (!visible(menu) || !visible(anchor)) return;

        const margin = 12, gap = 8;
        const bodyRect = document.body.getBoundingClientRect();
        const transformed = getComputedStyle(document.body).transform !== 'none';
        const scale = transformed && document.body.offsetWidth ? bodyRect.width / document.body.offsetWidth : 1;
        const originX = transformed ? bodyRect.left : 0, originY = transformed ? bodyRect.top : 0;
        const view = window.visualViewport;
        const leftEdge = view?.offsetLeft || 0, topEdge = view?.offsetTop || 0;
        const viewWidth = view?.width || window.innerWidth, viewHeight = view?.height || window.innerHeight;
        const r = anchor.getBoundingClientRect();
        const wanted = Math.min(options.width || 320, viewWidth - margin * 2);
        const above = Math.max(0, r.top - topEdge - gap - margin);
        const below = Math.max(0, topEdge + viewHeight - r.bottom - gap - margin);
        const available = Math.min(Math.max(above, below), viewHeight - margin * 2);

        // 先固定尺寸再测量：菜单自带 max-width / 缩放时，用实际渲染宽度算对齐才不会横向跑偏。
        Object.assign(menu.style, {
            position: 'fixed', margin: '0', bottom: 'auto', right: 'auto',
            width: wanted / scale + 'px', maxWidth: wanted / scale + 'px',
            maxHeight: Math.max(1, available) / scale + 'px', overflowY: 'auto'
        });
        const visualRect = typeof menu.getBoundingClientRect === 'function' ? menu.getBoundingClientRect() : null;
        const width = menu.offsetWidth ? menu.offsetWidth * scale : wanted;
        const height = menu.offsetHeight ? menu.offsetHeight * scale : (visualRect?.height || 0);
        const openUp = options.preferAbove ? (above >= height || above >= below) : above > below;
        const align = options.align || 'start';
        const anchorX = align === 'center' ? r.left + r.width / 2 - width / 2
            : align === 'end' ? r.right - width : r.left;
        const left = Math.max(leftEdge + margin, Math.min(leftEdge + viewWidth - width - margin, anchorX));
        const top = Math.max(topEdge + margin, Math.min(topEdge + viewHeight - height - margin,
            openUp ? r.top - gap - height : r.bottom + gap));
        menu.style.left = (left - originX) / scale + 'px';
        menu.style.top = (top - originY) / scale + 'px';
    }

    // 忽略菜单自身 style 变更造成的 mutation，否则 place() 写 left/top 会无限自激。
    function ownMenuMutation(target) {
        for (const menu of tracked.keys()) if (menu === target || menu.contains(target)) return true;
        return false;
    }
    function startWatch() {
        if (watching || !window.MutationObserver) return;
        watching = true;
        new MutationObserver(list => {
            if (!tracked.size) return;
            if (list.every(m => ownMenuMutation(m.target))) return;
            schedule();
        }).observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden']});
    }
    function schedule(event) {
        if (event?.type === 'scroll' && [...tracked.keys()].some(menu => menu === event.target || menu.contains(event.target))) return;
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            for (const [menu, {anchor, options}] of tracked) {
                if (!menu.isConnected) { tracked.delete(menu); continue; }
                place(menu, anchor, options);
            }
        });
    }

    window.GenerationMenuPosition = {place, refresh: schedule};
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('studio-ui-scale-change', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    document.addEventListener('DOMContentLoaded', () => {
        const composer = document.getElementById('generationComposer');
        if (composer && window.ResizeObserver) new ResizeObserver(schedule).observe(composer);
    });
})();
