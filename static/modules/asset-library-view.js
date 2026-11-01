/* 直连资产仓库（PoseAtlas 姿势 / 衣装 / 人像）在提示词库里的浏览视图，复用统一瀑布流卡片。 */
(function () {
    'use strict';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const state = {libId:'', catId:'', query:'', openId:'', sort:'default', onlyFav:false};
    let host, libraries = [];
    const FAV_KEY = 'artCanvas.mediaFavorites.v1';
    const favId = (libId, item) => `${libId}:${item.id}`;

    function repoLibraries() {
        return libraries.filter(lib => lib && lib.repository_source);
    }
    function activeLibrary() {
        const list = repoLibraries();
        return list.find(lib => lib.id === state.libId) || list[0] || null;
    }
    function itemsOf(lib) {
        if (!lib) return [];
        const query = state.query.trim().toLowerCase();
        const fav = window.PromptGalleryUI.favorites(FAV_KEY);
        const items = (lib.categories || [])
            .filter(cat => !state.catId || cat.id === state.catId)
            .flatMap(cat => (cat.items || []).map(item => ({...item, _cat: cat.name})))
            .filter(item => !query || [item.name, item._cat, item.repository_title, (item.classification || {}).summary]
                .join(' ').toLowerCase().includes(query))
            .filter(item => !state.onlyFav || fav.has(favId(lib.id, item)));
        if (state.sort === 'name') items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        else if (state.sort === 'cat') items.sort((a, b) => String(a._cat || '').localeCompare(String(b._cat || '')));
        return items;
    }
    function countNode(text) {
        const node = host?.closest('.asset-manager-root')?.querySelector('[data-content-kind-count]');
        if (node) node.textContent = text;
    }
    function render(nextHost, libs, libId) {
        host = nextHost;
        libraries = Array.isArray(libs) ? libs : [];
        const list = repoLibraries();
        if (libId && list.some(lib => lib.id === libId)) state.libId = libId;
        const lib = activeLibrary();
        const items = itemsOf(lib);
        countNode(`共 ${items.length} 条`);
        if (!list.length) {
            host.innerHTML = `<div class="empty-state">还没有接入直连资产仓库。到「管理」标签添加 PoseAtlas 仓库后，姿势 / 衣装 / 人像会各自成为一个标签。</div>`;
            return;
        }
        if (!lib) {
            host.innerHTML = `<div class="empty-state">这个资产库已停用，可到「管理」标签重新启用。</div>`;
            return;
        }
        const ui = window.PromptGalleryUI;
        const fav = ui.favorites(FAV_KEY);
        const narrow = window.innerWidth <= 760;
        const cats = lib.categories || [];
        host.innerHTML = `<div class="prompt-filter-bar content-filter-bar">
            ${cats.length > 1 ? `<button class="prompt-chip prompt-icon-chip prompt-filter-open ${state.catId ? 'is-on' : ''}" type="button" data-media-filter-open aria-label="筛选分类" title="筛选分类"><i data-lucide="sliders-horizontal"></i></button>` : ''}
            <label class="asset-search-wrap"><i data-lucide="search"></i><input class="asset-search" type="search" data-media-search placeholder="${narrow ? '搜索' : '搜索名称、分类或标签'}" value="${esc(state.query)}"></label>
            ${ui.sortSelect(state.sort, [['default', '默认顺序'], ['name', '名称排序'], ['cat', '按分类']], 'data-media-sort')}
            ${ui.favToggle(state.onlyFav, `只看收藏（${fav.size} 条）`)}
            ${ui.sizeToggle()}
        </div>
        <div class="content-scroll prompt-gallery-scroll">
            <div class="prompt-masonry prompt-gallery">${items.slice(0, 240).map(item => ui.card(
                {id:item.id, name:item.name || item._cat, thumbnail:item.thumbnail || item.url},
                {attribute:'data-media-open', label:item._cat, favorite:fav.has(favId(lib.id, item))}
            )).join('')}</div>
            ${!items.length ? '<div class="empty-state">这里暂时没有可显示的条目。</div>' : ''}
            ${items.length > 240 ? `<div class="prompt-gallery-end">已显示前 240 条，用搜索或分类缩小范围</div>` : ''}
        </div>`;
        ui.mount(host.querySelector('.prompt-masonry'), {cardWidth:ui.cardSize()});
        window.lucide?.createIcons();
        bind();
    }
    function bind() {
        host.oninput = event => {
            if (!event.target.matches('[data-media-search]')) return;
            state.query = event.target.value;
            const start = event.target.selectionStart;
            render(host, libraries);
            const input = host.querySelector('[data-media-search]');
            input.focus();
            try { input.setSelectionRange(start, start); } catch (_) { /* search 输入框可能不支持光标位置 */ }
        };
        host.onchange = event => {
            const sort = event.target.closest('[data-media-sort]');
            if (sort) {
                state.sort = sort.value;
                render(host, libraries);
                return;
            }
            const select = event.target.closest('[data-media-cat]');
            if (!select) return;
            state.catId = select.value;
            render(host, libraries);
        };
        host.onclick = event => {
            if (event.target.closest('[data-media-filter-open]')) {
                openCatSheet(activeLibrary(), event.target.closest('[data-media-filter-open]'));
                return;
            }
            if (event.target.closest('[data-gallery-fav]')) {
                state.onlyFav = !state.onlyFav;
                render(host, libraries);
                return;
            }
            if (event.target.closest('[data-gallery-size]')) {
                window.PromptGalleryUI.cycleSize();
                render(host, libraries);
                return;
            }
            const libButton = event.target.closest('[data-media-lib]');
            if (libButton) {
                state.libId = libButton.dataset.mediaLib;
                state.catId = '';
                render(host, libraries);
                return;
            }
            const card = event.target.closest('[data-media-open]');
            if (!card) return;
            const item = itemsOf(activeLibrary()).find(entry => String(entry.id) === card.dataset.mediaOpen);
            if (item) openViewer(item);
        };
    }
    // 手机端：分类筛选收进筛选图标，点开是底部面板
    let sheetEl = null;
    function closeCatSheet() {
        if (sheetEl) sheetEl.remove();
        sheetEl = null;
        document.documentElement.classList.remove('filter-sheet-open');
    }
    function openCatSheet(lib, anchor) {
        if (!lib) return;
        closeCatSheet();
        const cats = lib.categories || [];
        const total = cats.reduce((sum, cat) => sum + (cat.items || []).length, 0);
        const row = (id, name, count, active) => `<button class="filter-opt ${active ? 'is-on' : ''}" type="button" data-sheet-cat="${esc(id)}" aria-pressed="${active}"><span>${esc(name)}</span><em>${count}</em></button>`;
        const overlay = document.createElement('div');
        overlay.className = 'filter-sheet-backdrop';
        overlay.innerHTML = `<div class="filter-sheet" role="dialog" aria-modal="true" aria-label="筛选分类">
            <div class="filter-sheet-body"><section class="filter-block"><h4>分类</h4><div class="filter-grid">
                ${row('', '全部分类', total, !state.catId)}
                ${cats.map(cat => row(cat.id, cat.name, (cat.items || []).length, state.catId === cat.id)).join('')}
            </div></section></div>
        </div>`;
        document.body.appendChild(overlay);
        document.documentElement.classList.add('filter-sheet-open');
        window.PromptGalleryUI?.anchorSheet?.(overlay, overlay.querySelector('.filter-sheet'), anchor);
        sheetEl = overlay;
        window.lucide?.createIcons();
        overlay.addEventListener('click', event => {
            if (event.target === overlay || event.target.closest('[data-sheet-close]')) { closeCatSheet(); return; }
            const option = event.target.closest('[data-sheet-cat]');
            if (!option) return;
            state.catId = option.dataset.sheetCat || '';
            closeCatSheet();
            render(host, libraries);
        });
    }
    function openViewer(item) {
        const overlay = document.createElement('div');
        overlay.className = 'prompt-dialog-backdrop';
        overlay.innerHTML = `<section class="prompt-dialog" role="dialog" aria-modal="true" aria-label="${esc(item.name || '')}"><button class="prompt-dialog-close" data-media-close aria-label="关闭">×</button><div class="prompt-dialog-media"><img src="${esc(item.url || item.thumbnail || '')}" alt="${esc(item.name || '')}"></div><div class="prompt-dialog-copy"><header class="prompt-dialog-head"><h2>${esc(item.name || '')}</h2><p>${esc(item._cat || '')}</p></header>${(item.classification || {}).summary ? `<label>标签<textarea class="detail-caption-textarea" readonly>${esc(item.classification.summary)}</textarea></label>` : ''}<div class="prompt-dialog-actions"><button class="asset-btn primary" data-media-copy="tags">复制标签</button><button class="asset-btn" data-media-fav>${window.PromptGalleryUI.favorites(FAV_KEY).has(favId(activeLibrary()?.id || '', item)) ? '取消收藏' : '收藏'}</button><a class="asset-btn" href="${esc(item.url || '#')}" target="_blank" rel="noopener">打开原图</a></div><div data-media-notice></div></div></section>`;
        const close = () => overlay.remove();
        overlay.onclick = async event => {
            if (event.target === overlay || event.target.closest('[data-media-close]')) return close();
            if (event.target.closest('[data-media-fav]')) {
                const button = event.target.closest('[data-media-fav]');
                const set = window.PromptGalleryUI.toggleFavorite(FAV_KEY, favId(activeLibrary()?.id || '', item));
                button.textContent = set.has(favId(activeLibrary()?.id || '', item)) ? '取消收藏' : '收藏';
                render(host, libraries);
            }
            if (event.target.closest('[data-media-copy]')) {
                const notice = overlay.querySelector('[data-media-notice]');
                try { await navigator.clipboard.writeText((item.classification || {}).summary || item.name || ''); notice.textContent = '已复制标签'; }
                catch (_) { notice.textContent = '复制失败，请手动选中文本'; }
            }
        };
        document.addEventListener('keydown', function onKey(event) {
            if (event.key !== 'Escape') return;
            document.removeEventListener('keydown', onKey, true);
            close();
        }, true);
        document.body.appendChild(overlay);
    }
    window.AssetLibraryView = {render};
})();
