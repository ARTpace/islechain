/* One marker per user turn; streaming token updates do not rebuild the outline. */
(() => {
    'use strict';
    function mount(thread) {
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
        let rows = [], buttons = [], pending = false;
        function updateActive() {
            pending = false;
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
            if (!pending) { pending = true; requestAnimationFrame(updateActive); }
        }
        function rebuild() {
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
        new MutationObserver(rebuild).observe(thread, {childList: true});
        thread.addEventListener('scroll', () => {
            thread.dataset.readingHistory = thread.scrollHeight - thread.scrollTop - thread.clientHeight >= 100 ? '1' : '0';
            schedule();
        }, {passive: true});
        window.addEventListener('resize', schedule);
        if (typeof ResizeObserver !== 'undefined') {
            const sizes = new ResizeObserver(schedule);
            sizes.observe(thread);
            if (composer) sizes.observe(composer);
        }
        nav.addEventListener('mouseenter', () => {
            const active = buttons.find(button => button.classList.contains('is-current'));
            if (active) nav.scrollTop = active.offsetTop - nav.clientHeight / 2;
        });
        rebuild();
    }
    window.ChatOutline = {mount};
})();
