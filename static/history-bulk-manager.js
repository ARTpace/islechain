(function(){
    const STYLE_ID = 'history-bulk-manager-style';
    const labels = () => {
        const en = window.StudioI18n?.lang?.() === 'en';
        return en ? {
            manage:'Manage',
            done:'Done',
            delete:'Delete',
            selected:'selected',
            cancel:'Cancel',
            selectAll:'Select All',
            deselectAll:'Deselect All'
        } : {
            manage:'批量管理',
            done:'完成',
            delete:'删除',
            selected:'已选择',
            cancel:'取消',
            selectAll:'全选',
            deselectAll:'取消全选'
        };
    };

    function ensureStyle(){
        if(document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .history-bulk-surface{position:relative}
            .history-bulk-surface.is-selecting{cursor:crosshair}
            /* [Fix] 工具栏吸顶 — 把 toolbar 移到 <main> 外部的 DOM 中（attach() 中处理），
               用 position:sticky 贴住视口顶部。body 是 flex column + overflow:hidden，
               所以 main 的滚动不会推它，绝对不抖动。 */
            .history-bulk-toolbar{
                display:flex;align-items:center;gap:10px;
                margin:0 auto 12px;
                padding:8px var(--history-toolbar-pad, 40px);
                min-height:34px;
                position:sticky;top:0;z-index:25;
                max-width:var(--history-toolbar-max, 1280px);width:100%;
                box-sizing:border-box;
                background:var(--ui-panel, var(--bg-base, #f8f8f8));
                border-bottom:1px solid var(--ui-line, transparent);
                box-shadow:none;
            }
            body.studio-theme-dark .history-bulk-toolbar,
            html.studio-theme-dark .history-bulk-toolbar{
                background:var(--ui-panel, #1c202a);
                border-bottom-color:var(--ui-line, #343b4c);
                box-shadow:none;
            }
            @media (max-width:768px){
                .history-bulk-toolbar{padding:8px 16px;}
            }
            @media (max-width:640px){
                .history-bulk-toolbar{padding:8px 12px;}
            }
            .history-bulk-toolbar .bulk-spacer{flex:1}
            .history-bulk-btn{height:32px;border-radius:999px;border:1px solid var(--ui-line, rgba(161, 159, 151, .28));background:var(--ui-soft, rgba(255,255,255,.9));color:var(--ui-text, #595851);padding:0 12px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;display:inline-flex;align-items:center;gap:7px;transition:all .18s ease}
            .history-bulk-btn:hover{background:color-mix(in srgb, var(--ui-text, #181817) 12%, var(--ui-soft, #fff));color:var(--ui-text, #181817);border-color:var(--ui-line-strong, #181817)}
            .history-bulk-btn.danger{background:#181817;color:#fcfcfb;border-color:#181817}
            .history-bulk-btn.danger:disabled{opacity:.38;cursor:not-allowed}
            .history-bulk-btn[data-bulk-delete]{display:none}
            .history-bulk-btn[data-bulk-selectall]{display:none}
            .history-bulk-toolbar.is-selecting .history-bulk-btn[data-bulk-delete]{display:inline-flex}
            .history-bulk-toolbar.is-selecting .history-bulk-btn[data-bulk-selectall]{display:inline-flex}
            .history-bulk-count{font-size:10px;font-weight:900;color:#a19f97;text-transform:uppercase;letter-spacing:.12em}
            /* 搜索框 */
            .history-search-wrap{display:flex;align-items:center;gap:0;transition:width .25s ease,opacity .25s ease;width:0;opacity:0;overflow:hidden}
            .history-search-wrap.is-open{width:220px;opacity:1}
            .history-search-inner{position:relative;flex:1;min-width:0}
            .history-search-input{height:32px;border-radius:999px;border:1px solid var(--ui-line, rgba(161, 159, 151, .28));background:var(--ui-soft, rgba(255,255,255,.9));color:var(--ui-text, #282825);padding:0 28px 0 12px;font-size:11px;font-weight:600;outline:none;width:100%;transition:border-color .18s;box-sizing:border-box}
            .history-search-input::placeholder{color:#a19f97;font-weight:500}
            .history-search-input:focus{border-color:#6366f1}
            .history-search-clear{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:18px;height:18px;border-radius:50%;border:none;background:rgba(161, 159, 151, .3);color:#7d7c74;display:none;align-items:center;justify-content:center;cursor:pointer;font-size:11px;line-height:1;padding:0;transition:background .15s}
            .history-search-clear:hover{background:rgba(125, 124, 116, .5);color:#282825}
            .history-search-input:not(:placeholder-shown)~.history-search-clear{display:flex}
            html.studio-theme-dark .history-search-input,body.studio-theme-dark .history-search-input{background:var(--ui-soft, #252b38);border-color:var(--ui-line, #343b4c);color:var(--ui-text, #f6f6f4)}
            html.studio-theme-dark .history-search-input::placeholder,body.studio-theme-dark .history-search-input::placeholder{color:#6e6d66}
            html.studio-theme-dark .history-search-input:focus,body.studio-theme-dark .history-search-input:focus{border-color:#06b6d4}
            html.studio-theme-dark .history-search-clear,body.studio-theme-dark .history-search-clear{background:rgba(110, 109, 102, .4);color:#a19f97}
            html.studio-theme-dark .history-search-clear:hover,body.studio-theme-dark .history-search-clear:hover{background:rgba(110, 109, 102, .6);color:#eceae5}
            body.history-bulk-selecting,body.history-bulk-selecting *{user-select:none!important;-webkit-user-select:none!important}
            body.history-bulk-selecting{cursor:crosshair}
            .history-bulk-selecting .masonry-grid{cursor:crosshair}
            .history-bulk-selecting .masonry-item{position:relative;cursor:pointer!important}
            .history-bulk-selecting .masonry-item img{-webkit-user-drag:none;user-drag:none;pointer-events:none}
            .history-bulk-selecting .masonry-item::after{content:"";position:absolute;inset:0;border-radius:inherit;background:rgba(255,255,255,.34);opacity:0;transition:opacity .14s ease;pointer-events:none;z-index:8}
            .history-bulk-selecting .masonry-item:hover::after{opacity:1}
            .masonry-item.bulk-selected::after{opacity:1;background:rgba(255,255,255,.42);box-shadow:inset 0 0 0 2px rgba(24, 24, 23, .9)}
            .masonry-item.bulk-selected{outline:2px solid rgba(24, 24, 23, .9);outline-offset:3px}
            .bulk-check{position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:999px;background:#fcfcfb;color:#181817;border:2px solid rgba(24, 24, 23, .9);display:none;align-items:center;justify-content:center;z-index:12;box-shadow:0 10px 24px rgba(23, 23, 22, .18)}
            .history-bulk-selecting .bulk-check{display:flex}
            .bulk-check::before{content:"";width:8px;height:5px;border-left:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg);opacity:0}
            .masonry-item.bulk-selected .bulk-check{background:#181817;color:#fcfcfb}
            .masonry-item.bulk-selected .bulk-check::before{opacity:1}
            .history-select-box{position:fixed;z-index:9999;border:1px solid rgba(24, 24, 23, .72);background:rgba(24, 24, 23, .09);pointer-events:none;border-radius:10px;box-shadow:0 0 0 1px rgba(255,255,255,.5) inset}
            html.studio-theme-dark .history-bulk-btn,body.studio-theme-dark .history-bulk-btn{background:var(--ui-soft, #252b38);border-color:var(--ui-line, #343b4c);color:var(--ui-text, #f6f6f4)}
            html.studio-theme-dark .history-bulk-btn:hover,body.studio-theme-dark .history-bulk-btn:hover{background:color-mix(in srgb, var(--ui-text, #f6f6f4) 12%, var(--ui-soft, #252b38));color:var(--ui-text, #f6f6f4);border-color:var(--ui-line-strong, #445066)}
            html.studio-theme-dark .masonry-item.bulk-selected::after,body.studio-theme-dark .masonry-item.bulk-selected::after{background:rgba(23, 23, 22, .38);box-shadow:inset 0 0 0 2px rgba(236, 234, 229, .88)}
            html.studio-theme-dark .masonry-item.bulk-selected,body.studio-theme-dark .masonry-item.bulk-selected{outline-color:rgba(236, 234, 229, .88)}
            html.studio-theme-dark .bulk-check,body.studio-theme-dark .bulk-check{background:#141414;color:#e5e3db;border-color:rgba(236, 234, 229, .78)}
            html.studio-theme-dark .masonry-item.bulk-selected .bulk-check,body.studio-theme-dark .masonry-item.bulk-selected .bulk-check{background:#e5e3db;color:#141414}
            /* NSFW 角标（默认隐藏，开启"显示角标"或屏蔽模式时可见） */
            .nsfw-badge{position:absolute;left:10px;bottom:10px;z-index:14;padding:2px 7px;border-radius:6px;font-size:9px;font-weight:900;letter-spacing:.1em;background:rgba(220,38,38,.92);color:#fcfcfb;backdrop-filter:blur(4px);box-shadow:0 4px 12px rgba(0,0,0,.25);display:none}
            body.show-nsfw-badges .nsfw-badge{display:inline-block}
            /* NSFW 屏蔽模式：直接隐藏 */
            body.nsfw-mode .masonry-item[data-nsfw="1"]{display:none!important}
            /* 收藏按钮高亮态 */
            .history-bulk-btn[data-extra-btn="fav-toggle"].is-on{background:#f59e0b;border-color:#f59e0b;color:#fcfcfb}
            .history-bulk-btn[data-extra-btn="fav-toggle"].is-on:hover{background:#d97706;border-color:#d97706;color:#fcfcfb}
            .history-bulk-btn[data-extra-btn="nsfw-toggle"].is-on{background:#dc2626;border-color:#dc2626;color:#fcfcfb}
            .history-bulk-btn[data-extra-btn="nsfw-toggle"].is-on:hover{background:#b91c1c;border-color:#b91c1c;color:#fcfcfb}
            /* favorite 按钮激活态 */
            .gallery-action-btn.is-fav{background:rgba(245,158,11,.95)!important;color:#fcfcfb!important;box-shadow:0 4px 10px rgba(245,158,11,.35)}
            /* 单张图片收藏星标 */
            .img-fav-btn.is-fav{background:rgba(245,158,11,.95)!important;color:#fcfcfb!important;box-shadow:0 2px 8px rgba(245,158,11,.4)}
            .img-fav-btn.is-fav svg{width:12px;height:12px}
            .img-fav-btn svg{width:12px;height:12px}
            /* 收藏视图下：显示单图收藏星标 */
            body.fav-mode .img-fav-btn{opacity:1!important}
            /* 仅显示收藏：非收藏卡片隐藏 */
            body.fav-mode .masonry-item[data-fav="0"]{display:none!important}
            /* fav-mode 下的占位提示 */
            body.fav-mode .masonry:empty::before,
            body.fav-mode #masonry:empty::before{content:"暂无收藏的图";display:block;padding:60px 0;text-align:center;color:#a19f97;font-size:13px;letter-spacing:.05em}
            /* 长按进入批量模式：进度环 + 卡片反馈 */
            .lp-ring{position:fixed;width:56px;height:56px;margin:-28px 0 0 -28px;pointer-events:none;z-index:10000;transform:scale(.5);opacity:0;transition:transform .16s ease,opacity .16s ease}
            .lp-ring.is-on{transform:scale(1);opacity:1}
            .lp-ring svg{width:56px;height:56px;transform:rotate(-90deg);display:block;filter:drop-shadow(0 4px 12px rgba(0,0,0,.22))}
            .lp-ring .lp-track{fill:none;stroke:rgba(161, 159, 151, .45);stroke-width:4}
            .lp-ring .lp-progress{fill:none;stroke:#181817;stroke-width:4;stroke-linecap:round}
            html.studio-theme-dark .lp-ring .lp-progress,body.studio-theme-dark .lp-ring .lp-progress{stroke:#eceae5}
            .history-longpressing,body.history-longpressing *{user-select:none!important;-webkit-user-select:none!important}
            .masonry-item.lp-active{transform:scale(1.05);transition:transform .18s ease;z-index:13;box-shadow:0 14px 34px rgba(23, 23, 22, .20)}
            html.studio-theme-dark .masonry-item.lp-active,body.studio-theme-dark .masonry-item.lp-active{box-shadow:0 14px 34px rgba(0,0,0,.5)}
            .masonry-item.lp-active::after{content:"";position:absolute;inset:0;border-radius:inherit;background:rgba(99,102,241,.16);pointer-events:none;z-index:9}
        `;
        document.head.appendChild(style);
    }

    let _searchMode = false;
    let _searchPrevHasMore = false;
    let _searchPrevPage = 0;
    let _searchPrevIndex = 0;

    function exitSearchMode(masonry) {
        if (!_searchMode) return;
        _searchMode = false;
        // 恢复正常分页模式
        if (window.GalleryList && typeof window.GalleryList.load === 'function') {
            window.GalleryList.load(0);
        }
    }

    async function serverSearch(masonry, query) {
        if (!window.GalleryList) return;
        _searchMode = true;
        const type = window.GalleryList.allHistory && window.GalleryList.allHistory.length
            ? (window.GALLERY_CONFIG && window.GALLERY_CONFIG.type) || 'zimage,anima'
            : (window.GALLERY_CONFIG && window.GALLERY_CONFIG.type) || 'zimage,anima';
        try {
            const token = (window.AuthManager && window.AuthManager.getToken)
                ? window.AuthManager.getToken()
                : (localStorage.getItem('xy_auth_token') || '');
            const res = await fetch('/api/history?type=' + encodeURIComponent(type) + '&q=' + encodeURIComponent(query) + '&token=' + encodeURIComponent(token));
            if (!res.ok) throw new Error('Search API ' + res.status);
            const json = await res.json();
            const items = Array.isArray(json) ? json : (json.items || []);
            // 清空当前画廊
            masonry.innerHTML = '';
            // 更新 GalleryList 状态
            window.GalleryList.allHistory = items;
            // 渲染搜索结果
            items.forEach(item => {
                if (window.GalleryCard && typeof window.GalleryCard.render === 'function') {
                    window.GalleryCard.render({
                        container: masonry,
                        record: item,
                        isNew: false
                    });
                }
            });
            // 隐藏加载更多的触发器
            const trigger = document.getElementById('loadMoreTrigger');
            if (trigger) trigger.classList.add('hidden');
        } catch (e) {
            console.error('[Search] error:', e);
        }
    }

    function applySearchFilter(masonry, query) {
        const items = masonry.querySelectorAll('.masonry-item[data-history-ts]');
        const seps = masonry.querySelectorAll('.date-separator');
        if (!query) {
            items.forEach(el => el.style.display = '');
            seps.forEach(el => el.style.display = '');
            return;
        }
        const allHistory = (window.GalleryList && window.GalleryList.allHistory) || [];
        const historyMap = new Map();
        allHistory.forEach(item => { historyMap.set(String(item.timestamp), item); });
        items.forEach(el => {
            const ts = el.dataset.historyTs;
            const record = historyMap.get(ts);
            const prompt = (record && (record.prompt || record.text || '')).toLowerCase();
            const model = (record && (record.model || '')).toLowerCase();
            el.style.display = (prompt.includes(query) || model.includes(query)) ? '' : 'none';
        });
        seps.forEach(sep => {
            let next = sep.nextElementSibling;
            while (next && !next.classList.contains('date-separator')) {
                if (next.classList.contains('masonry-item') && next.style.display !== 'none') {
                    sep.style.display = '';
                    return;
                }
                next = next.nextElementSibling;
            }
            sep.style.display = 'none';
        });
    }

    function deleteHistory(timestamp){
        return fetch('/api/history/delete', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({timestamp})
        }).then(r => r.json()).catch(() => ({success:false}));
    }

    function attach(options={}){
        ensureStyle();
        const masonry = typeof options.masonry === 'string' ? document.querySelector(options.masonry) : (options.masonry || document.getElementById('masonry'));
        if(!masonry || masonry._historyBulkManager) return masonry?._historyBulkManager || null;
        const surface = masonry.closest('section') || masonry.parentElement || masonry;
        surface.classList.add('history-bulk-surface');
        const L = labels();
        const toolbar = document.createElement('div');
        toolbar.className = 'history-bulk-toolbar';
        // extraButtons: [{ id, label, title?, onClick, beforeToggle? }]
        // 插入到 [data-bulk-toggle] 之前
        const extraHtml = (options.extraButtons || []).map(b =>
            `<button class="history-bulk-btn" type="button" data-extra-btn="${b.id}"${b.title ? ` title="${b.title}"` : ''}>${b.label}</button>`
        ).join('');
        toolbar.innerHTML = `
            <button class="history-bulk-btn" type="button" data-bulk-search title="搜索历史图片" style="flex-shrink:0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </button>
            <div class="history-search-wrap" data-search-wrap>
                <div class="history-search-inner">
                    <input class="history-search-input" type="text" data-search-input placeholder="搜索提示词..." autocomplete="off">
                    <button class="history-search-clear" type="button" data-search-clear title="清除">✕</button>
                </div>
            </div>
            <span class="bulk-spacer"></span>
            <span class="history-bulk-count" data-bulk-count></span>
            ${extraHtml}
            <button class="history-bulk-btn" type="button" data-bulk-selectall><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg><span class="btn-text"> ${L.selectAll}</span></button>
            <button class="history-bulk-btn danger" type="button" data-bulk-delete disabled><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg><span class="btn-text"> ${L.delete}</span></button>
            <button class="history-bulk-btn" type="button" data-bulk-toggle><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg><span class="btn-text"> ${L.manage}</span></button>
        `;
        masonry.parentNode.insertBefore(toolbar, masonry);
        // === [Fix] 工具栏吸顶：把 toolbar 移到 <main> 外部，作为 main 的兄弟节点
        // body 是 flex column + overflow:hidden，toolbar 脱离 main 的滚动流后，
        // position:sticky 把它固定在视口顶部，零抖动。
        (function moveToolbarAboveScroll() {
            const sc = masonry.closest('main');
            if (sc && sc.parentNode && toolbar.parentNode !== sc.parentNode) {
                sc.parentNode.insertBefore(toolbar, sc);
            }
        })();
        const toggleBtn = toolbar.querySelector('[data-bulk-toggle]');
        const searchBtn = toolbar.querySelector('[data-bulk-search]');
        const searchWrap = toolbar.querySelector('[data-search-wrap]');
        const searchInput = toolbar.querySelector('[data-search-input]');
        // 搜索功能
        if (searchBtn && searchWrap && searchInput) {
            const clearBtn = toolbar.querySelector('[data-search-clear]');
            searchBtn.addEventListener('click', () => {
                const opening = !searchWrap.classList.contains('is-open');
                searchWrap.classList.toggle('is-open', opening);
                if (opening) {
                    searchInput.focus();
                } else {
                    searchInput.value = '';
                    exitSearchMode(masonry);
                }
            });
            let searchTimer = null;
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimer);
                const q = searchInput.value.trim();
                if (!q) { exitSearchMode(masonry); return; }
                searchTimer = setTimeout(() => serverSearch(masonry, q), 300);
            });
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    searchInput.value = '';
                    exitSearchMode(masonry);
                    searchWrap.classList.remove('is-open');
                }
            });
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    searchInput.value = '';
                    exitSearchMode(masonry);
                    searchInput.focus();
                });
            }
        }
        const deleteBtn = toolbar.querySelector('[data-bulk-delete]');
        const selectAllBtn = toolbar.querySelector('[data-bulk-selectall]');
        const countEl = toolbar.querySelector('[data-bulk-count]');
        // 绑定 extra 按钮
        (options.extraButtons || []).forEach(b => {
            const btn = toolbar.querySelector(`[data-extra-btn="${b.id}"]`);
            if (btn) btn.onclick = (e) => b.onClick(btn, e);
        });
        let selecting = false;
        let selected = new Set();
        let drag = null;
        let down = null;

        function removeSelectBoxes(){
            document.querySelectorAll('.history-select-box').forEach(box => box.remove());
        }
        function clearNativeSelection(){
            const sel = window.getSelection?.();
            if(sel && sel.rangeCount) sel.removeAllRanges();
        }
        function selectableCards(){
            return [...masonry.querySelectorAll('.masonry-item[data-history-ts]')];
        }
        function cardTs(card){ return card?.dataset?.historyTs || ''; }
        function sync(){
            const l = labels();
            const toggleText = toolbar.querySelector('[data-bulk-toggle] .btn-text');
            if (toggleText) toggleText.textContent = ' ' + (selecting ? l.done : l.manage);
            const delText = deleteBtn.querySelector('.btn-text');
            if (delText) delText.textContent = ' ' + l.delete;
            deleteBtn.disabled = !selected.size;
            countEl.textContent = selected.size ? `${selected.size} ${l.selected}` : '';
            toolbar.classList.toggle('is-selecting', selecting);
            surface.classList.toggle('is-selecting', selecting);
            document.body.classList.toggle('history-bulk-selecting', selecting);
            // 全选按钮状态
            if(selectAllBtn){
                const cards = selectableCards();
                const allSelected = cards.length > 0 && cards.every(c => selected.has(cardTs(c)));
                const saText = selectAllBtn.querySelector('.btn-text');
                if(saText) saText.textContent = allSelected ? ' ' + l.deselectAll : ' ' + l.selectAll;
            }
            selectableCards().forEach(card => {
                card.classList.toggle('bulk-selected', selected.has(cardTs(card)));
                if(!card.querySelector('.bulk-check')){
                    const check = document.createElement('span');
                    check.className = 'bulk-check';
                    card.appendChild(check);
                }
            });
        }
        function setSelecting(next){
            selecting = Boolean(next);
            if(!selecting) selected.clear();
            sync();
        }
        function selectAll(){
            const cards = selectableCards();
            const allSelected = cards.length > 0 && cards.every(c => selected.has(cardTs(c)));
            if(allSelected){
                selected.clear();
            } else {
                cards.forEach(c => { const ts = cardTs(c); if(ts) selected.add(ts); });
            }
            sync();
        }
        function toggleCard(card){
            const ts = cardTs(card);
            if(!ts) return;
            selected.has(ts) ? selected.delete(ts) : selected.add(ts);
            sync();
        }
        toggleBtn.onclick = () => setSelecting(!selecting);
        selectAllBtn.onclick = () => selectAll();
        deleteBtn.onclick = async () => {
            if(!selected.size) return;
            const targets = [...selected];
            deleteBtn.disabled = true;
            for(const ts of targets){
                const res = await deleteHistory(ts);
                if(res.success){
                    document.querySelector(`[data-history-ts="${CSS.escape(ts)}"]`)?.remove();
                    selected.delete(ts);
                }
            }
            sync();
            options.onDelete?.(targets);
        };
        masonry.addEventListener('click', e => {
            if(!selecting) return;
            if(e.target.closest('.history-bulk-toolbar')) return;
            if(down?.dragged){
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            const card = e.target.closest('.masonry-item[data-history-ts]');
            if(!card || !masonry.contains(card)) return;
            e.preventDefault();
            e.stopPropagation();
            toggleCard(card);
        }, true);
        function shouldIgnorePointer(e){
            return Boolean(e.target.closest('.history-bulk-toolbar,button,a,input,textarea,select'));
        }
        function insideHistoryBand(y){
            const rect = surface.getBoundingClientRect();
            return y >= rect.top - 24 && y <= rect.bottom + 96;
        }
        document.addEventListener('mousedown', e => {
            if(!selecting || e.button !== 0) return;
            if(shouldIgnorePointer(e)) return;
            if(!insideHistoryBand(e.clientY)) return;
            e.preventDefault();
            e.stopPropagation();
            removeSelectBoxes();
            drag = null;
            clearNativeSelection();
            down = {sx:e.clientX, sy:e.clientY, dragged:false};
        }, true);
        document.addEventListener('selectstart', e => {
            if(!selecting) return;
            if(e.clientY && !insideHistoryBand(e.clientY)) return;
            e.preventDefault();
            e.stopPropagation();
            clearNativeSelection();
        }, true);
        document.addEventListener('dragstart', e => {
            if(!selecting) return;
            const pointY = e.clientY || down?.sy;
            if(pointY && !insideHistoryBand(pointY)) return;
            e.preventDefault();
            e.stopPropagation();
        }, true);
        window.addEventListener('mousemove', e => {
            if((drag || down) && e.buttons === 0){
                finishDrag();
                return;
            }
            if(down && !drag){
                const moved = Math.hypot(e.clientX - down.sx, e.clientY - down.sy);
                if(moved < 6) return;
                e.preventDefault();
                clearNativeSelection();
                down.dragged = true;
                const box = document.createElement('div');
                box.className = 'history-select-box';
                document.body.appendChild(box);
                drag = {sx:down.sx, sy:down.sy, box};
            }
            if(!drag) return;
            e.preventDefault();
            clearNativeSelection();
            const x = Math.min(drag.sx, e.clientX);
            const y = Math.min(drag.sy, e.clientY);
            const w = Math.abs(e.clientX - drag.sx);
            const h = Math.abs(e.clientY - drag.sy);
            Object.assign(drag.box.style, {left:`${x}px`, top:`${y}px`, width:`${w}px`, height:`${h}px`});
            const r = {left:x, top:y, right:x+w, bottom:y+h};
            selectableCards().forEach(card => {
                const cr = card.getBoundingClientRect();
                const hit = cr.left < r.right && cr.right > r.left && cr.top < r.bottom && cr.bottom > r.top;
                if(hit) selected.add(cardTs(card));
            });
            sync();
        });
        function finishDrag(){
            if(drag){
                drag = null;
                sync();
            }
            removeSelectBoxes();
            if(down){
                setTimeout(() => { down = null; }, 0);
            }
        }
        document.addEventListener('mouseup', finishDrag, true);
        window.addEventListener('mouseup', finishDrag, true);
        document.addEventListener('pointerup', finishDrag, true);
        document.addEventListener('pointercancel', finishDrag, true);
        window.addEventListener('mouseleave', finishDrag);
        window.addEventListener('blur', finishDrag);
        window.addEventListener('studio-lang-change', sync);
        window.addEventListener('message', event => {
            if(event.data?.type === 'studio-lang') setTimeout(sync, 0);
        });
        let syncTimer = null;
        const observer = new MutationObserver(() => {
            if(!selecting) return;
            clearTimeout(syncTimer);
            syncTimer = setTimeout(sync, 30);
        });
        observer.observe(masonry, {childList:true});
        const manager = {sync, setSelecting, isSelecting:() => selecting, toggleCard: (card) => toggleCard(card)};
        masonry._historyBulkManager = manager;

        // === 长按画廊图片 → 进入批量管理模式并预选该图（opt-in，默认关闭，不影响其它页面）===
        // 仅当调用方传入 longPressToSelect:true 时启用。桌面鼠标长按 / 移动端触摸长按均可触发。
        if (options.longPressToSelect) {
            let _lp = null;            // 当前长按会话 {x,y,card,ring,timer}
            let _suppress = false;     // 长按触发后，吞掉紧随的 click，避免误开灯箱 / 重复切换
            const LONG_PRESS_MS = 2000;  // 长按阈值：2 秒
            const MOVE_TOL = 14;       // 超过此位移视为滚动/拖动，取消长按
            const clearLp = () => {
                if (_lp) {
                    if (_lp.timer) clearTimeout(_lp.timer);
                    if (_lp.ring) _lp.ring.remove();
                    if (_lp.card) _lp.card.classList.remove('lp-active');
                }
                document.body.classList.remove('history-longpressing');
                _lp = null;
            };
            // 长按进行中或刚触发时，阻止触屏原生菜单 / 文本选择（此时不应弹出系统菜单）
            const _blockNative = () => _lp !== null || _suppress;
            function makeRing(x, y) {
                const ring = document.createElement('div');
                ring.className = 'lp-ring';
                ring.style.left = x + 'px';
                ring.style.top = y + 'px';
                ring.innerHTML = '<svg viewBox="0 0 56 56"><circle class="lp-track" cx="28" cy="28" r="24"/><circle class="lp-progress" cx="28" cy="28" r="24"/></svg>';
                document.body.appendChild(ring);
                const prog = ring.querySelector('.lp-progress');
                const C = 2 * Math.PI * 24;
                prog.style.strokeDasharray = C;
                prog.style.strokeDashoffset = C;
                // 强制两帧后开始过渡，保证 transition 生效
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    ring.classList.add('is-on');
                    prog.style.transition = 'stroke-dashoffset ' + LONG_PRESS_MS + 'ms linear';
                    prog.style.strokeDashoffset = '0';
                }));
                return ring;
            }
            masonry.addEventListener('pointerdown', (e) => {
                if (e.button !== undefined && e.button !== 0) return; // 仅左键/触摸
                const card = e.target.closest('.masonry-item[data-history-ts]');
                if (!card || !masonry.contains(card)) return;
                if (shouldIgnorePointer(e)) return;
                _suppress = false;   // 新一次按下：解除上一轮的 click 抑制
                clearLp();
                const ring = makeRing(e.clientX, e.clientY);
                document.body.classList.add('history-longpressing');
                card.classList.add('lp-active');
                _lp = { x: e.clientX, y: e.clientY, card, ring, timer: setTimeout(() => {
                    _lp = null;
                    document.body.classList.remove('history-longpressing');
                    card.classList.remove('lp-active');
                    ring.remove();
                    manager.setSelecting(true);   // 进入批量管理模式
                    // [Bugfix] 用户反馈：长按触发批量管理即可，不需要预选这张图
                    // 原逻辑: manager.toggleCard(card);  // 预选被长按的这张图
                    _suppress = true;              // 抑制紧随的 click（直到下次 pointerdown 才解除）
                }, LONG_PRESS_MS) };
            }, true);
            masonry.addEventListener('pointermove', (e) => {
                if (!_lp) return;
                if (Math.hypot(e.clientX - _lp.x, e.clientY - _lp.y) > MOVE_TOL) clearLp();
            }, true);
            masonry.addEventListener('pointerup', clearLp, true);
            // 修复：在画廊图片上「拖动」会触发浏览器原生图片拖拽（dragstart）；该过程抢占 pointer 事件流，
            // 导致 pointermove 不再派发、clearLp 不被移动事件触发，2 秒后长按 timer 误触发批量模式。
            // 因此 dragstart 时若长按会话仍在进行，仅取消计时（clearLp），不 preventDefault——
            // 这样图片原生拖拽能力照常保留，只是不再误进批量模式。
            masonry.addEventListener('dragstart', (e) => {
                if (_lp) { clearLp(); }
            }, true);
            // 注意：不监听 pointercancel→clearLp，避免触屏长按（浏览器先派发 pointercancel 再弹系统菜单）被误取消
            masonry.addEventListener('contextmenu', (e) => {
                if (_blockNative()) { e.preventDefault(); e.stopPropagation(); }
            }, true);
            // 捕获阶段拦截长按后的 click：阻止灯箱（inline onclick）与 masonry 自身选择处理重复切换
            document.addEventListener('click', (e) => {
                if (_suppress) {
                    e.preventDefault();
                    e.stopPropagation();
                    _suppress = false;
                }
            }, true);
        }

        // === [Fix v2] toolbar 已移出 <main>，用 position:sticky 贴视口顶部 ===
        // 不再需要 JS scroll 监听 + transform 补偿。
        sync();
        return manager;
    }

    window.HistoryBulkManager = {attach};
})();
