/* 工具内确认：普通操作使用主题对话框；删除按钮再次点击才执行。 */
(() => {
    if (window.StudioConfirm) return;
    let trigger = null, armed = null, queue = Promise.resolve();
    const destructive = text => /删除|清空|清除|卸载|移除|回收站|\b(delete|remove|uninstall|clear|trash)\b/i.test(text);
    const en = () => (document.documentElement.lang || localStorage.getItem('studio_lang') || '').startsWith('en');
    function reset() {
        if (!armed) return;
        const { button, nodes, title, timer } = armed;
        armed = null;
        clearTimeout(timer);
        button.replaceChildren(...nodes);
        if (title === null) button.removeAttribute('title'); else button.title = title;
        button.classList.remove('studio-delete-armed');
        button.removeEventListener('pointerleave', reset);
    }
    document.addEventListener('pointerdown', event => {
        if (armed && !armed.button.contains(event.target)) reset();
    }, true);
    document.addEventListener('click', event => {
        const button = event.target.closest('button,[role="button"],input[type="button"],input[type="submit"]');
        if (armed && armed.button !== button) reset();
        trigger = button;
        queueMicrotask(() => { if (trigger === button) trigger = null; });
    }, true);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' || !['Enter',' '].includes(event.key)) reset();
    }, true);
    window.addEventListener('blur', reset);
    function ensureStyle() {
        if (document.getElementById('studio-confirm-style')) return;
        const style = document.createElement('style');
        style.id = 'studio-confirm-style';
        style.textContent = `
.studio-confirm-dialog{box-sizing:border-box;width:min(440px,calc(100vw - 32px));max-height:85vh;overflow:auto;padding:22px;border:1px solid var(--ui-line,#ccc);border-radius:var(--ui-r,12px);background:var(--ui-panel,#fff);color:var(--ui-text,#222);box-shadow:0 18px 60px #0005;font:14px/1.6 system-ui;}
.studio-confirm-dialog::backdrop{background:#0007;}
.studio-confirm-dialog p{margin:0 0 20px;white-space:pre-wrap;overflow-wrap:anywhere;}
.studio-confirm-actions{display:flex;justify-content:flex-end;gap:10px;}
.studio-confirm-dialog button{min-height:36px;padding:6px 18px;border:1px solid var(--ui-line,#ccc);border-radius:var(--ui-r-sm,6px);background:var(--ui-soft,#eee);color:var(--ui-text,#222);font:inherit;cursor:pointer;}
.studio-confirm-dialog [data-yes]{background:var(--accent,#546b91);color:var(--ui-panel,#fff);border-color:transparent;}
.studio-confirm-dialog [data-yes].danger{background:#dc2626;color:#fff;}
html body .studio-delete-armed.studio-delete-armed{width:auto!important;min-width:64px!important;height:auto!important;min-height:30px!important;padding:4px 8px!important;background:var(--danger-soft,#dc262620)!important;color:var(--danger,#ef4444)!important;border:1px solid currentColor!important;white-space:nowrap!important;font-size:12px!important;}
`;
        document.head.appendChild(style);
    }
    function dialog(message, danger) {
        return new Promise(resolve => {
            ensureStyle();
            const panel = document.createElement('dialog');
            panel.className = 'studio-confirm-dialog';
            panel.innerHTML = '<p></p><div class="studio-confirm-actions"><button type="button" data-no></button><button type="button" data-yes></button></div>';
            panel.querySelector('p').textContent = message;
            const no = panel.querySelector('[data-no]'), yes = panel.querySelector('[data-yes]');
            no.textContent = en() ? 'Cancel' : '取消';
            yes.textContent = danger ? (en() ? 'Confirm delete' : '确认删除') : (en() ? 'Confirm' : '确认');
            yes.classList.toggle('danger', danger);
            let settled = false;
            const finish = result => {
                if (settled) return;
                settled = true;
                panel.close(); panel.remove(); resolve(result);
            };
            no.onclick = () => finish(false);
            yes.onclick = () => finish(true);
            panel.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
            panel.addEventListener('close', () => finish(false));
            document.body.appendChild(panel);
            panel.showModal(); no.focus();
        });
    }
    function ask(message, options = {}) {
        message = String(message);
        const danger = options.destructive ?? destructive(message);
        const button = options.button || trigger;
        if (danger && button && button.isConnected && button.tagName === 'BUTTON') {
            if (armed?.button === button && armed.message === message) { reset(); return Promise.resolve(true); }
            reset(); ensureStyle();
            armed = { button, message, nodes:[...button.childNodes], title:button.getAttribute('title') };
            button.textContent = en() ? 'Confirm delete' : '确认删除';
            button.title = message;
            button.classList.add('studio-delete-armed');
            button.addEventListener('pointerleave', reset);
            armed.timer = setTimeout(reset, 5000);
            return Promise.resolve(false);
        }
        // ponytail: 没有可再次点击的触发按钮（例如 Delete 快捷键）时保留工具内确认。
        const result = queue.then(() => dialog(message, danger));
        queue = result.catch(() => false);
        return result;
    }
    window.StudioConfirm = { ask, reset };
})();
