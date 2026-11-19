(() => {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    let drag = null, suppressClick = false;
    const id = item => item.id === 'nav-comfy' ? 'apps' : item.dataset.module;
    const items = () => [...nav.children].filter(item => item.matches('.nav-item') && id(item));
    const clearHints = () => items().forEach(item => item.classList.remove('sidebar-drop-before', 'sidebar-drop-after'));
    // ponytail: 指针捕获不依赖桌面 WebView 的原生拖放事件，排序仍复用设置页。
    for (const item of items()) {
        item.draggable = false;
        item.addEventListener('dragstart', event => event.preventDefault());
        item.addEventListener('pointerdown', event => {
            if (event.button !== 0 || drag) return;
            drag = { item, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false, target: null };
            item.setPointerCapture(event.pointerId);
        });
        item.addEventListener('pointermove', event => {
            if (!drag || drag.item !== item || drag.pointerId !== event.pointerId) return;
            if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
            drag.active = true;
            suppressClick = true;
            event.preventDefault();
            item.classList.add('sidebar-dragging');
            clearHints();
            const bounds = nav.getBoundingClientRect();
            if (event.clientY < bounds.top + 24) nav.scrollTop -= 12;
            if (event.clientY > bounds.bottom - 24) nav.scrollTop += 12;
            // 捕获后 event.target 始终是源按钮，必须按坐标寻找落点。
            const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('.nav-item');
            drag.target = hit && hit !== item && hit.parentNode === nav ? hit : null;
            if (!drag.target) return;
            const rect = hit.getBoundingClientRect();
            drag.after = event.clientY >= rect.top + rect.height / 2;
            hit.classList.add(drag.after ? 'sidebar-drop-after' : 'sidebar-drop-before');
        });
        const finish = event => {
            if (!drag || drag.item !== item || drag.pointerId !== event.pointerId) return;
            const ended = drag;
            drag = null;
            item.classList.remove('sidebar-dragging');
            clearHints();
            if (item.hasPointerCapture(event.pointerId)) item.releasePointerCapture(event.pointerId);
            if (event.type === 'pointerup' && ended.active && ended.target) {
                window.FeatureModules.moveTo(id(item), id(ended.target), ended.after);
            }
            if (ended.active) setTimeout(() => { suppressClick = false; }, 0);
        };
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) item.addEventListener(type, finish);
    }
    nav.addEventListener('click', event => {
        if (!suppressClick) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }, true);
})();
