/* 提示词库生成页选用桥接；分类、列表、预览复用资产库。 */
(function () {
    'use strict';
    const enabled = window.parent !== window && new URLSearchParams(location.search).get('picker') === 'prompt';
    const items = new Map();
    let selected = new Set();
    const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function button(key, item) {
        if (!enabled) return '';
        items.set(key, item);
        const on = selected.has(key);
        return `<button type="button" class="prompt-import-btn ${on ? 'is-on' : ''}" data-prompt-import="${esc(key)}" aria-pressed="${on}" title="${on ? '从输入栏取消' : '导入输入栏'}" aria-label="${on ? '从输入栏取消' : '导入输入栏'}"><i data-lucide="${on ? 'check' : 'text-cursor-input'}"></i></button>`;
    }
    function sync() {
        document.querySelectorAll('[data-prompt-import]').forEach(button => {
            const on = selected.has(button.dataset.promptImport);
            button.classList.toggle('is-on', on);
            button.setAttribute('aria-pressed', String(on));
            button.title = on ? '从输入栏取消' : '导入输入栏';
            button.setAttribute('aria-label', button.title);
            button.innerHTML = `<i data-lucide="${on ? 'check' : 'text-cursor-input'}"></i>`;
        });
        window.lucide?.createIcons();
    }
    if (enabled) {
        document.documentElement?.classList.add('prompt-library-picker');
        document.addEventListener('click', event => {
            const button = event.target.closest?.('[data-prompt-import]');
            if (!button) return;
            event.preventDefault(); event.stopImmediatePropagation();
            const key = button.dataset.promptImport;
            const item = items.get(key);
            if (item) window.parent.postMessage({type:'prompt-library:toggle', key, item}, location.origin);
        }, true);
        window.addEventListener('message', event => {
            if (event.origin !== location.origin || event.source !== window.parent) return;
            if (event.data?.type === 'prompt-library:state' && Array.isArray(event.data.keys)) {
                selected = new Set(event.data.keys); sync();
            }
            if (event.data?.type === 'prompt-library:view') {
                const view = event.data.view;
                promptContentKind = view === 'char' ? 'characters' : view === 'artist' ? 'artists' : '';
                activeTab = 'prompts';
                activePromptLibraryId = view === 'preset' ? 'system-tags' : 'system';
                activePromptCategory = 'all'; promptDialogId = ''; render();
            }
        });
    }
    async function extendLibrary(library) {
        if (!enabled) return;
        const response = await fetch('/api/prompt-presets');
        if (!response.ok) throw new Error('标签库加载失败');
        const data = await response.json();
        const entries = new Map();
        const categories = data.categories || [];
        for (const cat of categories) for (const sub of cat.subcategories || []) for (const p of sub.presets || []) {
            const id = `${cat.id}:${p.id}`;
            if (!entries.has(id)) entries.set(id, {...p, id, category:cat.id, positive:p.prompt || p.name || '', negative:p.negative_prompt || ''});
        }
        library.libraries.push({id:'system-tags', name:'标签库', readonly:true, categories, items:[...entries.values()]});
    }
    window.PromptLibraryPicker = {enabled, button, extendLibrary};
})();
