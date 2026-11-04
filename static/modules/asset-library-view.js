/* 提示词库里的「素材」标签：本地资产库与直连资产仓库共用提示词那套筛选栏 + 瀑布流卡片 + 弹窗详情。
   本地库额外支持导入、编辑名称/标签、移动分类、批量删除。 */
(function () {
    'use strict';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const state = {libId:'', catId:'', query:'', sort:'default', onlyFav:false, manage:false, picked:new Set()};
    let host, libraries = [];
    const FAV_KEY = 'artCanvas.mediaFavorites.v1';
    const favId = (libId, item) => `${libId}:${item.id}`;
    const isLocal = lib => Boolean(lib) && !lib.repository_source;
    const imageCats = lib => ((lib && lib.categories) || []).filter(cat => (cat.type || 'image') === 'image');
    const libName = lib => String((lib && lib.name) || '').replace(/^PoseAtlas\s*·\s*/, '').split('·').pop().trim() || '素材';
    function activeLibrary() {
        const local = libraries.filter(isLocal);
        if (state.libId === 'local') return local[0] || libraries[0] || null;
        return libraries.find(lib => lib.id === state.libId) || libraries[0] || null;
    }
    function kindOf(item) {
        const url = String(item.url || item.path || '');
        if (/\.(mp4|webm|mov|mkv)$/i.test(url)) return '视频';
        if (/\.(mp3|wav|flac|m4a|ogg)$/i.test(url)) return '音频';
        return '图片';
    }
    function itemsOf(lib) {
        if (!lib) return [];
        const query = state.query.trim().toLowerCase();
        const fav = window.PromptGalleryUI.favorites(FAV_KEY);
        let items = imageCats(lib)
            .filter(cat => !state.catId || cat.id === state.catId)
            .flatMap(cat => (cat.items || []).map(item => ({...item, _catId:cat.id, _cat:cat.name})));
        if (query) {
            items = items.filter(item => [item.name, item._cat, item.repository_title, item.caption, (item.classification || {}).summary, kindOf(item)]
                .join(' ').toLowerCase().includes(query));
        }
        if (state.onlyFav) items = items.filter(item => fav.has(favId(lib.id, item)));
        if (state.sort === 'name') items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        else if (state.sort === 'cat') items.sort((a, b) => String(a._cat || '').localeCompare(String(b._cat || '')));
        else if (state.sort === 'newest') items.sort((a, b) => Number(b.mtime || b.created_at || 0) - Number(a.mtime || a.created_at || 0));
        return items;
    }
    function countNode(text) {
        const node = host?.closest('.asset-manager-root')?.querySelector('[data-content-kind-count]');
        if (node) node.textContent = text;
    }
    function sortOptions() {
        return [['default', '默认顺序'], ['newest', '最新入库'], ['name', '名称排序'], ['cat', '按分类']];
    }
    function render(nextHost, libs, libId) {
        host = nextHost;
        libraries = Array.isArray(libs) ? libs.filter(Boolean) : [];
        // 'local' 代表「素材」标签，具体在看哪个本地库由标签页内的切换决定
        const keepLocal = libId === 'local' && libraries.some(lib => lib.id === state.libId && !lib.repository_source);
        if (libId && libId !== state.libId && !keepLocal) {
            state.libId = libId;
            state.catId = '';
            state.picked.clear();
            state.manage = false;
        }
        const lib = activeLibrary();
        const items = itemsOf(lib);
        const ui = window.PromptGalleryUI;
        countNode(`共 ${items.length} 条`);
        if (!libraries.length) {
            host.innerHTML = `<div class="empty-state">还没有资产库。到「管理」标签新建一个库，或添加 PoseAtlas 仓库。</div>`;
            return;
        }
        if (!lib) {
            host.innerHTML = `<div class="empty-state">这个资产库已停用，可到「管理」标签重新启用。</div>`;
            return;
        }
        const local = isLocal(lib);
        const fav = ui.favorites(FAV_KEY);
        const narrow = window.innerWidth <= 760;
        const cats = imageCats(lib);
        const swLibs = local ? libraries.filter(isLocal) : libraries.filter(entry => entry.repository_source);
        const cut = 240;
        const visible = items.slice(0, cut);
        host.innerHTML = `<div class="prompt-filter-bar content-filter-bar">
            ${cats.length > 1 ? `<button class="prompt-chip prompt-icon-chip prompt-filter-open ${state.catId ? 'is-on' : ''}" type="button" data-media-filter-open aria-label="筛选分类" title="筛选分类"><i data-lucide="sliders-horizontal"></i></button>` : ''}
            <label class="asset-search-wrap"><i data-lucide="search"></i><input class="asset-search" type="search" data-media-search placeholder="${narrow ? '搜索' : '搜索名称、分类或标签'}" value="${esc(state.query)}"></label>
            ${ui.sortSelect(state.sort, sortOptions(), 'data-media-sort')}
            ${ui.favToggle(state.onlyFav, `只看收藏（${fav.size} 条）`)}
            ${ui.sizeToggle()}
            ${local ? `<button class="prompt-chip" type="button" data-media-upload title="导入素材到当前分类"><i data-lucide="upload"></i><span>导入</span></button>` : ''}
            ${local && items.length ? `<button class="prompt-chip prompt-icon-chip ${state.manage ? 'is-on' : ''}" type="button" data-media-manage title="${state.manage ? '退出管理' : '批量管理'}"><i data-lucide="${state.manage ? 'x' : 'list-checks'}"></i></button>` : ''}
        </div>
        ${swLibs.length > 1 ? `<div class="prompt-subchips" role="group" aria-label="资产库">
            ${swLibs.map(entry => `<button class="prompt-subchip ${entry.id === lib.id ? 'is-on' : ''}" type="button" data-media-lib="${esc(entry.id)}" aria-pressed="${entry.id === lib.id}">${esc(libName(entry))}</button>`).join('')}
        </div>` : ''}
        ${cats.length > 1 ? `<div class="prompt-subchips" role="group" aria-label="分类">
            <button class="prompt-subchip ${state.catId ? '' : 'is-on'}" type="button" data-media-cat="" aria-pressed="${state.catId ? 'false' : 'true'}">全部</button>
            ${cats.map(cat => `<button class="prompt-subchip ${state.catId === cat.id ? 'is-on' : ''}" type="button" data-media-cat="${esc(cat.id)}" aria-pressed="${state.catId === cat.id}">${esc(cat.name)}</button>`).join('')}
        </div>` : ''}
        ${local && state.manage ? `<div class="manage-tools">
            <span>已选择 ${state.picked.size} 条素材，支持逐个勾选。</span>
            <div class="asset-tools">
                <button class="asset-btn" type="button" data-media-select-all><i data-lucide="check-square"></i><span>全选</span></button>
                <button class="asset-btn" type="button" data-media-clear ${state.picked.size ? '' : 'disabled'}><i data-lucide="square"></i><span>清空</span></button>
                <button class="asset-btn danger" type="button" data-media-delete ${state.picked.size ? '' : 'disabled'}><i data-lucide="trash-2"></i><span>删除所选</span></button>
            </div>
        </div>` : ''}
        <div class="content-scroll prompt-gallery-scroll">
            <div class="prompt-masonry prompt-gallery">${visible.map(item => ui.card(
                {id:item.id, name:item.name || item._cat, thumbnail:item.thumbnail || item.url},
                {
                    attribute:'data-media-open',
                    label:item._cat || '',
                    favorite:fav.has(favId(lib.id, item)),
                    selectable:local && state.manage,
                    checked:state.picked.has(String(item.id)),
                    checkAttribute:'data-media-check'
                }
            )).join('')}</div>
            ${!items.length ? `<div class="empty-state">${state.query || state.catId ? '没有匹配的素材，换个关键词或分类试试。' : (local ? '这个分类还没有素材，点「导入」上传图片。' : '这里暂时没有可显示的条目。')}</div>` : ''}
            ${items.length > cut ? `<div class="prompt-gallery-end">已显示前 ${cut} 条，用搜索或分类缩小范围</div>` : ''}
        </div>`;
        ui.mount(host.querySelector('.prompt-masonry'), {cardWidth:ui.cardSize()});
        window.lucide?.createIcons();
        bind(lib, items);
    }
    function refresh(library) {
        if (library && window.AssetManagerBridge?.applyLibrary) {
            window.AssetManagerBridge.applyLibrary(library);
            return;
        }
        render(host, libraries, activeLibrary()?.id || '');
    }
    function toast(text) {
        if (window.AssetManagerBridge?.toast) window.AssetManagerBridge.toast(text);
    }
    function bind(lib, items) {
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
            if (event.target.matches('[data-media-check]')) {
                const id = event.target.dataset.mediaCheck;
                if (event.target.checked) state.picked.add(id); else state.picked.delete(id);
                const bar = host.querySelector('.manage-tools span');
                if (bar) bar.textContent = `已选择 ${state.picked.size} 条素材，支持逐个勾选。`;
                return;
            }
            const sort = event.target.closest('[data-media-sort]');
            if (sort) {
                state.sort = sort.value;
                render(host, libraries);
            }
        };
        host.onclick = async event => {
            if (event.target.closest('[data-media-check]')) return;
            if (event.target.closest('[data-media-filter-open]')) {
                openCatSheet(lib, event.target.closest('[data-media-filter-open]'));
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
                state.picked.clear();
                state.manage = false;
                render(host, libraries);
                return;
            }
            const catButton = event.target.closest('[data-media-cat]');
            if (catButton) {
                state.catId = catButton.dataset.mediaCat || '';
                state.picked.clear();
                render(host, libraries);
                return;
            }
            if (event.target.closest('[data-media-upload]')) { pickFiles(lib); return; }
            if (event.target.closest('[data-media-manage]')) {
                state.manage = !state.manage;
                state.picked.clear();
                render(host, libraries);
                return;
            }
            if (event.target.closest('[data-media-select-all]')) {
                items.forEach(item => state.picked.add(String(item.id)));
                render(host, libraries);
                return;
            }
            if (event.target.closest('[data-media-clear]')) {
                state.picked.clear();
                render(host, libraries);
                return;
            }
            if (event.target.closest('[data-media-delete]')) {
                await deletePicked(lib);
                return;
            }
            const card = event.target.closest('[data-media-open]');
            if (!card) return;
            const item = items.find(entry => String(entry.id) === card.dataset.mediaOpen);
            if (item) openViewer(lib, item);
        };
    }
    // 导入：上传到当前分类（没选分类就用第一个），沿用原素材库的上传接口
    function pickFiles(lib) {
        const cats = imageCats(lib);
        const cat = cats.find(entry => entry.id === state.catId) || cats[0];
        if (!cat) { toast('当前资产库还没有分类，请先在「管理」标签建一个分组'); return; }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,video/*,audio/*';
        input.multiple = true;
        input.style.display = 'none';
        document.body.appendChild(input);
        input.onchange = async () => {
            const files = [...(input.files || [])];
            input.remove();
            if (!files.length) return;
            const form = new FormData();
            files.forEach(file => form.append('files', file));
            form.append('library_id', lib.id);
            form.append('category_id', cat.id);
            toast('正在上传素材…');
            try {
                const data = await apiJson('/api/asset-library/upload', {method:'POST', body:form});
                state.picked.clear();
                refresh(data.library);
                toast(`已上传 ${data.items?.length || files.length} 个素材`);
            } catch (err) {
                toast(err.message || '上传失败');
            }
        };
        input.click();
    }
    async function deletePicked(lib) {
        const ids = [...state.picked];
        if (!ids.length) return;
        if (!window.confirm(`确定删除所选 ${ids.length} 个素材？此操作不可撤销。`)) return;
        try {
            const data = await apiJson('/api/asset-library/items/delete', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({library_id:lib.id, ids})
            });
            state.picked.clear();
            refresh(data.library);
            toast(`已删除 ${data.deleted ?? ids.length} 个素材`);
        } catch (err) {
            toast(err.message || '删除失败');
        }
    }
    function openCatSheet(lib, anchor) {
        closeCatSheet();
        const cats = imageCats(lib);
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
            state.picked.clear();
            closeCatSheet();
            render(host, libraries);
        });
    }
    let sheetEl = null;
    function closeCatSheet() {
        if (sheetEl) sheetEl.remove();
        sheetEl = null;
        document.documentElement.classList.remove('filter-sheet-open');
    }
    function openViewer(lib, item) {
        const local = isLocal(lib);
        const isImage = kindOf(item) === '图片';
        const fav = window.PromptGalleryUI.favorites(FAV_KEY);
        const faved = fav.has(favId(lib.id, item));
        const cats = imageCats(lib);
        const tags = (item.classification || {}).summary || '';
        const catOptions = cats.map(cat => `<option value="${esc(cat.id)}" ${cat.id === item._catId ? 'selected' : ''}>${esc(cat.name)}</option>`).join('');
        const overlay = document.createElement('div');
        overlay.className = 'prompt-dialog-backdrop';
        overlay.innerHTML = `<section class="prompt-dialog" role="dialog" aria-modal="true" aria-label="${esc(item.name || '素材')}">
            <button class="prompt-dialog-close" data-media-close aria-label="关闭">×</button>
            <div class="prompt-dialog-media">${isImage ? `<img src="${esc(item.url || item.thumbnail || '')}" alt="${esc(item.name || '')}">` : `<video src="${esc(item.url || '')}" controls playsinline></video>`}</div>
            <div class="prompt-dialog-copy">
                <header class="prompt-dialog-head"><h2>${esc(item.name || '素材')}</h2><p>${esc(item._cat || '')}</p></header>
                ${local ? `<label>名称<input class="detail-name-input" data-media-name type="text" value="${esc(item.name || '')}"></label>` : ''}
                ${cats.length > 1 && local ? `<label>分类<select class="detail-name-input" data-media-move>${catOptions}</select></label>` : ''}
                ${tags ? `<label>标签<textarea class="detail-caption-textarea" ${local ? 'data-media-caption' : 'readonly'}>${esc(tags)}</textarea></label>` : (local ? '<label>标签<textarea class="detail-caption-textarea" data-media-caption placeholder="给这张素材写点标签，方便以后搜到"></textarea></label>' : '')}
                <div class="prompt-dialog-actions">
                    ${local ? '<button class="asset-btn primary" data-media-save>保存</button>' : ''}
                    <button class="asset-btn" data-media-copy="tags">复制标签</button>
                    <button class="asset-btn" data-media-fav>${faved ? '取消收藏' : '收藏'}</button>
                    <a class="asset-btn" href="${esc(item.url || '#')}" target="_blank" rel="noopener">打开原图</a>
                    ${local ? '<button class="asset-btn danger" data-media-remove>删除</button>' : ''}
                </div>
                <div data-media-notice></div>
            </div>
        </section>`;
        const close = () => overlay.remove();
        overlay.onclick = async event => {
            const notice = overlay.querySelector('[data-media-notice]');
            if (event.target === overlay || event.target.closest('[data-media-close]')) return close();
            if (event.target.closest('[data-media-fav]')) {
                const set = window.PromptGalleryUI.toggleFavorite(FAV_KEY, favId(lib.id, item));
                event.target.closest('[data-media-fav]').textContent = set.has(favId(lib.id, item)) ? '取消收藏' : '收藏';
                render(host, libraries);
                return;
            }
            if (event.target.closest('[data-media-copy]')) {
                try { await navigator.clipboard.writeText(tags || item.name || ''); notice.textContent = '已复制标签'; }
                catch (_) { notice.textContent = '复制失败，请手动选中文本'; }
                return;
            }
            if (event.target.closest('[data-media-save]')) {
                const name = (overlay.querySelector('[data-media-name]')?.value || '').trim();
                const caption = overlay.querySelector('[data-media-caption]')?.value || '';
                try {
                    const data = await apiJson(`/api/asset-library/items/${encodeURIComponent(item.id)}`, {
                        method:'PATCH', headers:{'Content-Type':'application/json'},
                        body:JSON.stringify({name: name || item.name, caption})
                    });
                    close();
                    refresh(data.library);
                    toast('已保存素材信息');
                } catch (err) {
                    notice.textContent = err.message || '保存失败';
                }
                return;
            }
            if (event.target.closest('[data-media-remove]')) {
                if (!window.confirm('确定删除这个素材？此操作不可撤销。')) return;
                try {
                    const data = await apiJson(`/api/asset-library/items/${encodeURIComponent(item.id)}`, {method:'DELETE'});
                    close();
                    refresh(data.library);
                    toast('已删除素材');
                } catch (err) {
                    notice.textContent = err.message || '删除失败';
                }
            }
        };
        overlay.onchange = async event => {
            const select = event.target.closest('[data-media-move]');
            if (!select) return;
            const notice = overlay.querySelector('[data-media-notice]');
            try {
                const data = await apiJson('/api/asset-library/items/move', {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({library_id:lib.id, target_library_id:lib.id, target_category_id:select.value, ids:[item.id]})
                });
                close();
                refresh(data.library);
                toast('已移动素材');
            } catch (err) {
                notice.textContent = err.message || '移动失败';
            }
        };
        document.addEventListener('keydown', function onKey(event) {
            if (event.key !== 'Escape') return;
            document.removeEventListener('keydown', onKey, true);
            close();
        }, true);
        document.body.appendChild(overlay);
        window.lucide?.createIcons();
    }
    window.AssetLibraryView = {render};
})();
