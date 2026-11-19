/* One marker per user turn; streaming token updates do not rebuild the outline. */
(() => {
    'use strict';
    const mounted = new WeakMap();
    function mount(thread) {
        if (mounted.has(thread)) return mounted.get(thread);
        const nav = document.createElement('nav');
        nav.className = 'chat-outline';
        nav.setAttribute('aria-label', '对话轮次导航');
        nav.hidden = true;
        document.body.appendChild(nav);
        const latest = document.createElement('button');
        latest.type = 'button';
        latest.className = 'chat-jump-latest';
        latest.title = '跳到最新对话';
        latest.setAttribute('aria-label', latest.title);
        latest.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 7 6 6 6-6M6 13l6 6 6-6"/></svg>';
        latest.hidden = true;
        const composer = document.getElementById('generationComposer');
        document.body.appendChild(latest);
        latest.onclick = () => {
            thread.dataset.readingHistory = '0';
            thread.scrollTo({top: thread.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
        };
        let rows = [], buttons = [], pending = false, frame = 0, disposed = false, active = true;
        function updateActive() {
            pending = false;
            if (disposed || !active) return;
            const rect = thread.getBoundingClientRect();
            latest.hidden = !rows.length || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 100;
            const anchor = composer ? composer.getBoundingClientRect() : rect;
            const bodyRect = document.body.getBoundingClientRect();
            const scale = bodyRect.width / document.body.offsetWidth || 1;
            latest.style.left = ((anchor.left + anchor.width / 2 - bodyRect.left) / scale) + 'px';
            latest.style.top = ((composer ? anchor.top : rect.bottom) - bodyRect.top) / scale - 54 + 'px';
            if (!rows.length) return;
            const edge = thread.getBoundingClientRect().top + 80;
            let current = 0;
            rows.forEach((row, index) => { if (row.getBoundingClientRect().top <= edge) current = index; });
            buttons.forEach((button, index) => {
                button.classList.toggle('is-current', index === current);
                if (index === current) button.setAttribute('aria-current', 'location');
                else button.removeAttribute('aria-current');
            });
        }
        function schedule() {
            if (!pending && !disposed && active) { pending = true; frame = requestAnimationFrame(updateActive); }
        }
        function rebuild() {
            if (!active || disposed) return;
            rows = Array.from(thread.children).filter(row => row.matches('.chat-row.user'));
            buttons = rows.map((row, index) => {
                const button = document.createElement('button');
                button.type = 'button';
                const text = (row.dataset.chatText || '').replace(/\s+/g, ' ').trim() || '图片对话';
                button.title = `第 ${index + 1} 轮：${text}`;
                button.setAttribute('aria-label', button.title);
                const label = document.createElement('span');
                label.textContent = text;
                button.appendChild(label);
                button.onclick = () => {
                    const top = row.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop - 20;
                    thread.scrollTo({top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
                };
                return button;
            });
            nav.replaceChildren(...buttons);
            nav.hidden = !rows.length;
            schedule();
        }
        const changes = new MutationObserver(rebuild);
        changes.observe(thread, {childList: true});
        const onScroll = () => {
            thread.dataset.readingHistory = thread.scrollHeight - thread.scrollTop - thread.clientHeight >= 100 ? '1' : '0';
            schedule();
        };
        thread.addEventListener('scroll', onScroll, {passive: true});
        window.addEventListener('resize', schedule);
        let sizes;
        if (typeof ResizeObserver !== 'undefined') {
            sizes = new ResizeObserver(schedule);
            sizes.observe(thread);
            if (composer) sizes.observe(composer);
        }
        nav.addEventListener('mouseenter', () => {
            const active = buttons.find(button => button.classList.contains('is-current'));
            if (active) nav.scrollTop = active.offsetTop - nav.clientHeight / 2;
        });
        function dispose() {
            if (disposed) return;
            disposed = true;
            changes.disconnect();
            sizes?.disconnect();
            if (pending) cancelAnimationFrame(frame);
            thread.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', schedule);
            window.removeEventListener('pagehide', onPageHide);
            nav.remove();
            latest.remove();
            unregister?.();
            mounted.delete(thread);
        }
        function onPageHide(event) { if (!event.persisted) dispose(); }
        window.addEventListener('pagehide', onPageHide);
        let unregister;
        const instance = {dispose,
            activate() { if (disposed || active) return; active = true; rebuild(); },
            deactivate() {
                active = false;
                if (pending) cancelAnimationFrame(frame);
                pending = false;
                nav.hidden = latest.hidden = true;
            }
        };
        unregister = window.PageLifecycle?.register({
            activate: () => instance.activate(), deactivate: () => instance.deactivate(),
            dispose, canDispose: () => true
        });
        mounted.set(thread, instance);
        rebuild();
        return instance;
    }
    window.ChatOutline = {mount};
})();
