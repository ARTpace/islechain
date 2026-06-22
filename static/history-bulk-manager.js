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
            .history-bulk-toolbar{display:flex;align-items:center;gap:10px;margin:-4px 0 18px;min-height:34px}
            .history-bulk-toolbar .bulk-spacer{flex:1}
            .history-bulk-btn{height:32px;border-radius:999px;border:1px solid rgba(148,163,184,.28);background:rgba(255,255,255,.9);color:#475569;padding:0 12px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;display:inline-flex;align-items:center;gap:7px;transition:all .18s ease}
            .history-bulk-btn:hover{background:#111827;color:#fff;border-color:#111827}
            .history-bulk-btn.danger{background:#111827;color:#fff;border-color:#111827}
            .history-bulk-btn.danger:disabled{opacity:.38;cursor:not-allowed}
            .history-bulk-btn[data-bulk-delete]{display:none}
            .history-bulk-btn[data-bulk-selectall]{display:none}
            .history-bulk-toolbar.is-selecting .history-bulk-btn[data-bulk-delete]{display:inline-flex}
            .history-bulk-toolbar.is-selecting .history-bulk-btn[data-bulk-selectall]{display:inline-flex}
            .history-bulk-count{font-size:10px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:.12em}
            /* 搜索框 */
            .history-search-wrap{display:flex;align-items:center;gap:0;transition:width .25s ease,opacity .25s ease;width:0;opacity:0;overflow:hidden}
            .history-search-wrap.is-open{width:220px;opacity:1}
            .history-search-inner{position:relative;flex:1;min-width:0}
            .history-search-input{height:32px;border-radius:999px;border:1px solid rgba(148,163,184,.28);background:rgba(255,255,255,.9);color:#1f2937;padding:0 28px 0 12px;font-size:11px;font-weight:600;outline:none;width:100%;transition:border-color .18s;box-sizing:border-box}
            .history-search-input::placeholder{color:#94a3b8;font-weight:500}
            .history-search-input:focus{border-color:#6366f1}
            .history-search-clear{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:18px;height:18px;border-radius:50%;border:none;background:rgba(148,163,184,.3);color:#64748b;display:none;align-items:center;justify-content:center;cursor:pointer;font-size:11px;line-height:1;padding:0;transition:background .15s}
            .history-search-clear:hover{background:rgba(100,116,139,.5);color:#1f2937}
            .history-search-input:not(:placeholder-shown)~.history-search-clear{display:flex}
            html.studio-theme-dark .history-search-input,body.studio-theme-dark .history-search-input{background:#111722;border-color:#2a3444;color:#e5e7eb}
            html.studio-theme-dark .history-search-input::placeholder,body.studio-theme-dark .history-search-input::placeholder{color:#4a6a80}
            html.studio-theme-dark .history-search-input:focus,body.studio-theme-dark .history-search-input:focus{border-color:#818cf8}
            html.studio-theme-dark .history-search-clear,body.studio-theme-dark .history-search-clear{background:rgba(74,106,128,.4);color:#94a3b8}
            html.studio-theme-dark .history-search-clear:hover,body.studio-theme-dark .history-search-clear:hover{background:rgba(74,106,128,.6);color:#e5e7eb}
            body.history-bulk-selecting,body.history-bulk-selecting *{user-select:none!important;-webkit-user-select:none!important}
            body.history-bulk-selecting{cursor:crosshair}
            .history-bulk-selecting .masonry-grid{cursor:crosshair}
            .history-bulk-selecting .masonry-item{position:relative;cursor:pointer!important}
            .history-bulk-selecting .masonry-item img{-webkit-user-drag:none;user-drag:none;pointer-events:none}
            .history-bulk-selecting .masonry-item::after{content:"";position:absolute;inset:0;border-radius:inherit;background:rgba(255,255,255,.34);opacity:0;transition:opacity .14s ease;pointer-events:none;z-index:8}
            .history-bulk-selecting .masonry-item:hover::after{opacity:1}
            .masonry-item.bulk-selected::after{opacity:1;background:rgba(255,255,255,.42);box-shadow:inset 0 0 0 2px rgba(17,24,39,.9)}
            .masonry-item.bulk-selected{outline:2px solid rgba(17,24,39,.9);outline-offset:3px}
            .bulk-check{position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:999px;background:#fff;color:#111827;border:2px solid rgba(17,24,39,.9);display:none;align-items:center;justify-content:center;z-index:12;box-shadow:0 10px 24px rgba(15,23,42,.18)}
            .history-bulk-selecting .bulk-check{display:flex}
            .bulk-check::before{content:"";width:8px;height:5px;border-left:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg);opacity:0}
            .masonry-item.bulk-selected .bulk-check{background:#111827;color:#fff}
            .masonry-item.bulk-selected .bulk-check::before{opacity:1}
            .history-select-box{position:fixed;z-index:9999;border:1px solid rgba(17,24,39,.72);background:rgba(17,24,39,.09);pointer-events:none;border-radius:10px;box-shadow:0 0 0 1px rgba(255,255,255,.5) inset}
            html.studio-theme-dark .history-bulk-btn,body.studio-theme-dark .history-bulk-btn{background:#111722;border-color:#2a3444;color:#d8dee9}
            html.studio-theme-dark .history-bulk-btn:hover,body.studio-theme-dark .history-bulk-btn:hover{background:#d8dee9;color:#10141d;border-color:#d8dee9}
            html.studio-theme-dark .masonry-item.bulk-selected::after,body.studio-theme-dark .masonry-item.bulk-selected::after{background:rgba(15,23,42,.38);box-shadow:inset 0 0 0 2px rgba(226,232,240,.88)}
            html.studio-theme-dark .masonry-item.bulk-selected,body.studio-theme-dark .masonry-item.bulk-selected{outline-color:rgba(226,232,240,.88)}
            html.studio-theme-dark .bulk-check,body.studio-theme-dark .bulk-check{background:#10141d;color:#d8dee9;border-color:rgba(226,232,240,.78)}
            html.studio-theme-dark .masonry-item.bulk-selected .bulk-check,body.studio-theme-dark .masonry-item.bulk-selected .bulk-check{background:#d8dee9;color:#10141d}
            /* NSFW 角标（默认隐藏，开启"显示角标"或屏蔽模式时可见） */
            .nsfw-badge{position:absolute;left:10px;bottom:10px;z-index:14;padding:2px 7px;border-radius:6px;font-size:9px;font-weight:900;letter-spacing:.1em;background:rgba(220,38,38,.92);color:#fff;backdrop-filter:blur(4px);box-shadow:0 4px 12px rgba(0,0,0,.25);display:none}
            body.show-nsfw-badges .nsfw-badge{display:inline-block}
            /* NSFW 屏蔽模式：蒙版 + 中央提示 */
            body.nsfw-mode .masonry-item[data-nsfw="1"]{position:relative;cursor:default!important}
            body.nsfw-mode .masonry-item[data-nsfw="1"] > img, body.nsfw-mode .masonry-item[data-nsfw="1"] img{filter:blur(24px) saturate(.4);transition:filter .2s}
            body.nsfw-mode .masonry-item[data-nsfw="1"]::before{content:"";position:absolute;inset:0;z-index:11;background:rgba(17,24,39,.32);pointer-events:none;transition:background .2s}
            body.nsfw-mode .masonry-item[data-nsfw="1"]:hover > img{filter:blur(28px) saturate(.3)}
            /* 收藏按钮高亮态 */
            .history-bulk-btn[data-extra-btn="fav-toggle"].is-on{background:#f59e0b;border-color:#f59e0b;color:#fff}
            .history-bulk-btn[data-extra-btn="fav-toggle"].is-on:hover{background:#d97706;border-color:#d97706;color:#fff}
            .history-bulk-btn[data-extra-btn="nsfw-toggle"].is-on{background:#dc2626;border-color:#dc2626;color:#fff}
            .history-bulk-btn[data-extra-btn="nsfw-toggle"].is-on:hover{background:#b91c1c;border-color:#b91c1c;color:#fff}
            /* favorite 按钮激活态 */
            .gallery-action-btn.is-fav{background:rgba(245,158,11,.95)!important;color:#fff!important;box-shadow:0 4px 10px rgba(245,158,11,.35)}
            /* 单张图片收藏星标 */
            .img-fav-btn.is-fav{background:rgba(245,158,11,.95)!important;color:#fff!important;box-shadow:0 2px 8px rgba(245,158,11,.4)}
            .img-fav-btn.is-fav svg{width:12px;height:12px}
            .img-fav-btn svg{width:12px;height:12px}
            /* 收藏视图下：显示单图收藏星标 */
            body.fav-mode .img-fav-btn{opacity:1!important}
            /* 仅显示收藏：非收藏卡片隐藏 */
            body.fav-mode .masonry-item[data-fav="0"]{display:none!important}
            /* fav-mode 下的占位提示 */
            body.fav-mode .masonry:empty::before,
            body.fav-mode #masonry:empty::before{content:"暂无收藏的图";display:block;padding:60px 0;text-align:center;color:#94a3b8;font-size:13px;letter-spacing:.05em}
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
        const manager = {sync, setSelecting, isSelecting:() => selecting};
        masonry._historyBulkManager = manager;
        sync();
        return manager;
    }

    window.HistoryBulkManager = {attach};
})();
