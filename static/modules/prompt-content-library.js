/* 复用已安装内容包的索引与详情，不复制到用户提示词数据中。 */
(function () {
    'use strict';
    const states = {};
    const labels = {artists: '画师库', characters: '角色库'};
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const favoriteKey = kind => kind === 'artists' ? 'anima-artist-favorites' : 'anima-char-favorites';
    function favorites(kind) {
        try { const list = JSON.parse(localStorage.getItem(favoriteKey(kind)) || '[]'); return new Set(Array.isArray(list) ? list : []); }
        catch (_) { return new Set(); }
    }
    async function json(url) {
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.error || '加载失败');
        return data;
    }
    function adapt(kind, payload) {
        return (payload.items || []).map(raw => {
            if (kind === 'artists') {
                const tag = raw.tag || '@' + raw.id;
                return {...raw, name: tag.replace(/^@/, ''), prompt: tag, count: raw.posts || 0,
                    image: raw.url || (raw.img && payload.imageBase ? payload.imageBase + raw.img + (payload.imageExt || '.avif') : '/api/artists/thumb?slug=' + encodeURIComponent(raw.id))};
            }
            const trigger = raw.trigger || '';
            const quoted = encodeURIComponent(trigger.replace(/[:/]/g, '_')).replace(/[!'*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
            return {...raw, prompt: trigger, count: raw.post_count || 0,
                image: raw.thumb || 'https://blobs.animadex.net/Outputs/thumbs/' + quoted + '.webp'};
        });
    }
    function tier(kind, count) {
        const bands = kind === 'artists' ? [[5000, '传奇画师'], [1000, '知名画师'], [100, '活跃画师'], [10, '新锐画师'], [0, '潜力画师']]
            : [[10000, '传奇角色'], [5000, '热门角色'], [1000, '知名角色'], [100, '活跃角色'], [0, '新锐角色']];
        return bands.find(([min]) => count >= min)?.[1] || bands.at(-1)[1];
    }
    function categories(kind, items) {
        const fields = kind === 'artists' ? [['tier', '热度分级']] : [['tier', '热度分级'], ['gender', '角色性别'], ['hair', '角色发色'], ['eye', '角色瞳色'], ['feat', '角色特征'], ['copyright', '作品系列']];
        return fields.map(([key, label]) => {
            const counts = new Map();
            for (const item of items) {
                const value = key === 'tier' ? tier(kind, item.count) : item[key];
                for (const entry of new Set(Array.isArray(value) ? value : [value])) {
                    if (entry) counts.set(entry, (counts.get(entry) || 0) + 1);
                }
            }
            return {key, label, options: [...counts].sort((a, b) => b[1] - a[1])};
        });
    }
    function matchesFilters(kind, item, filters) {
        return Object.entries(filters).every(([key, expected]) => {
            const value = key === 'tier' ? tier(kind, item.count) : item[key];
            return Array.isArray(value) ? value.includes(expected) : value === expected;
        });
    }
    function renderCategories(sidebar, host, kind, state) {
        if (!sidebar) return;
        const opened = new Set([...sidebar.querySelectorAll('details[open]')].map(el => el.dataset.group));
        const initialized = sidebar.dataset.initialized;
        sidebar.dataset.initialized = 'true';
        sidebar.innerHTML = `<button class="content-category-row ${!Object.keys(state.filters).length ? 'active' : ''}" data-content-filter-clear>全部${labels[kind]}<span>${state.items.length}</span></button>` + categories(kind, state.items).map(group =>
            `<details data-group="${group.key}" ${opened.has(group.key) || (!initialized && group.key === 'tier') ? 'open' : ''}><summary>${group.label}</summary><div class="content-category-options">${group.options.map(([value, count]) => `<button class="content-category-row ${state.filters[group.key] === value ? 'active' : ''}" data-content-filter="${group.key}" data-value="${esc(value)}" title="${esc(value)}"><span>${esc(value)}</span><span>${count}</span></button>`).join('')}</div></details>`).join('');
        sidebar.onclick = event => {
            const button = event.target.closest('[data-content-filter], [data-content-filter-clear]');
            if (!button) return;
            if (button.hasAttribute('data-content-filter-clear')) state.filters = {};
            else {
                const key = button.dataset.contentFilter, value = button.dataset.value;
                if (state.filters[key] === value) delete state.filters[key];
                else state.filters[key] = value;
            }
            state.page = 1;
            render(host, kind, sidebar);
        };
    }
    function render(host, kind, sidebar) {
        const state = states[kind] ||= {items: [], loaded: false, busy: false, error: '', query: '', onlyFav: false, page: 1, sort: 'popular', filters: {}};
        renderCategories(sidebar, host, kind, state);
        const fav = favorites(kind);
        const query = state.query.toLowerCase().trim();
        const items = state.items.filter(item => matchesFilters(kind, item, state.filters) && (!state.onlyFav || fav.has(item.name)) &&
            (!query || [item.name, item.prompt, item.copyright, item.gender, item.hair, item.eye].join(' ').toLowerCase().includes(query)));
        items.sort(state.sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.count - a.count);
        const pages = Math.max(1, Math.ceil(items.length / 60));
        state.page = Math.min(state.page, pages);
        host.innerHTML = `<div class="content-toolbar"><div class="content-heading"><strong>${labels[kind]}</strong><span>共 ${items.length} 条 · 与生成界面共用已安装内容包</span></div><button class="asset-btn" data-content-reload>刷新数据</button></div>
            <div class="prompt-filter-bar"><label class="asset-search-wrap"><input class="asset-search" type="search" data-content-search placeholder="搜索名称、触发词或作品" value="${esc(state.query)}"></label><label class="prompt-select"><span>排序</span><select data-content-sort><option value="popular">热度排序</option><option value="name" ${state.sort === 'name' ? 'selected' : ''}>名称排序</option></select></label><button class="prompt-chip ${state.onlyFav ? 'is-on' : ''}" data-content-favorites>只看收藏</button></div>
            <div class="content-scroll prompt-gallery-scroll"><div class="prompt-masonry prompt-gallery">${items.slice((state.page - 1) * 60, state.page * 60).map(item => window.PromptGalleryUI.card({id:item.id, name:item.name, thumbnail:item.image}, {attribute:'data-content-open', label:item.copyright || (kind === 'artists' ? '画师风格' : '角色'), favorite:fav.has(item.name)})).join('')}</div>
            ${!items.length ? `<div class="empty-state">${esc(state.busy ? '正在加载…' : state.error || '暂无匹配内容，可在左侧「内容包管理」安装或导入数据。')}</div>` : ''}
            <div class="prompt-content-pagination"><button class="asset-btn" data-content-page="-1" ${state.page <= 1 ? 'disabled' : ''}>上一页</button><span>${state.page} / ${pages}</span><button class="asset-btn" data-content-page="1" ${state.page >= pages ? 'disabled' : ''}>下一页</button></div></div>`;
        window.PromptGalleryUI.mount(host.querySelector('.prompt-masonry'));
        host.oninput = event => {
            if (!event.target.matches('[data-content-search]')) return;
            state.query = event.target.value; state.page = 1;
            const start = event.target.selectionStart;
            render(host, kind, sidebar);
            const input = host.querySelector('[data-content-search]'); input.focus();
            try { input.setSelectionRange(start, start); } catch (_) { /* search 输入框可能不支持光标位置 */ }
        };
        host.onchange = event => {
            if (event.target.matches('[data-content-sort]')) { state.sort = event.target.value; state.page = 1; render(host, kind, sidebar); }
        };
        host.onclick = async event => {
            const button = event.target.closest('[data-content-open],button');
            if (!button) return;
            if (button.hasAttribute('data-content-favorites')) { state.onlyFav = !state.onlyFav; state.page = 1; render(host, kind, sidebar); }
            if (button.hasAttribute('data-content-page')) { state.page += Number(button.dataset.contentPage); render(host, kind, sidebar); }
            if (button.hasAttribute('data-content-reload')) { state.loaded = false; state.error = ''; render(host, kind, sidebar); }
            if (button.hasAttribute('data-content-open')) {
                const item = state.items.find(item => String(item.id) === button.dataset.contentOpen);
                if (!item) return;
                button.disabled = true;
                try {
                    const data = await json('/api/' + kind + '/detail?id=' + encodeURIComponent(item.id));
                    if (host.isConnected) showDetail(host, kind, item, data.artist || data.character, sidebar);
                } catch (err) { button.title = err.message; button.setAttribute('title', '加载失败，点击重试：' + err.message); }
                finally { button.disabled = false; }
            }
        };
        if (!state.loaded && !state.busy) {
            state.busy = true;
            json('/api/' + kind + '/index').then(payload => { state.items = adapt(kind, payload); state.loaded = true; })
                .catch(err => { state.error = err.message; state.loaded = true; })
                .finally(() => { state.busy = false; if (host.isConnected) render(host, kind, sidebar); });
        }
    }
    function showDetail(host, kind, item, detail, sidebar) {
        const trigger = detail.tag || detail.trigger || item.prompt;
        const tags = Array.isArray(detail.tags) ? detail.tags.join(', ') : String(detail.tags || '');
        const full = [trigger, tags].filter(Boolean).join(', ');
        const overlay = document.createElement('div');
        overlay.className = 'prompt-dialog-backdrop';
        overlay.innerHTML = `<section class="prompt-dialog" role="dialog" aria-modal="true" aria-label="${esc(item.name)}"><button class="prompt-dialog-close" data-content-close aria-label="关闭">×</button><div class="prompt-dialog-media"><img src="${esc(detail.imageUrl || detail.img_url || detail.thumb_url || item.image)}" alt="${esc(item.name)}"></div><div class="prompt-dialog-copy"><header class="prompt-dialog-head"><h2>${esc(item.name)}</h2><p>${esc(item.copyright || labels[kind])}</p></header><label>触发词<textarea class="detail-caption-textarea" readonly>${esc(trigger)}</textarea></label>${tags ? `<label>角色特征<textarea class="detail-caption-textarea" readonly>${esc(tags)}</textarea></label>` : ''}<div class="prompt-dialog-actions"><button class="asset-btn primary" data-content-copy="trigger">复制触发词</button>${tags ? '<button class="asset-btn" data-content-copy="full">复制全部提示词</button>' : ''}<button class="asset-btn" data-content-fav>${favorites(kind).has(item.name) ? '取消收藏' : '收藏'}</button></div><div data-content-notice></div></div></section>`;
        const previous = document.activeElement;
        function close() { overlay.remove(); document.removeEventListener('keydown', onKey, true); if (previous?.isConnected) previous.focus(); }
        function onKey(event) {
            if (event.key === 'Escape') { event.stopImmediatePropagation(); close(); }
            if (event.key === 'Tab') {
                const list = [...overlay.querySelectorAll('button,textarea')];
                if (event.shiftKey && document.activeElement === list[0]) { event.preventDefault(); list.at(-1).focus(); }
                else if (!event.shiftKey && document.activeElement === list.at(-1)) { event.preventDefault(); list[0].focus(); }
            }
        }
        overlay.onclick = async event => {
            if (event.target === overlay || event.target.closest('[data-content-close]')) return close();
            const copy = event.target.closest('[data-content-copy]');
            const notice = overlay.querySelector('[data-content-notice]');
            if (copy) {
                try { await navigator.clipboard.writeText(copy.dataset.contentCopy === 'full' ? full : trigger); notice.textContent = '已复制，可粘贴到生成界面'; }
                catch (_) { notice.textContent = '复制失败，请选中上方文本手动复制'; }
            }
            const button = event.target.closest('[data-content-fav]');
            if (button) {
                const fav = favorites(kind);
                fav.has(item.name) ? fav.delete(item.name) : fav.add(item.name);
                try { localStorage.setItem(favoriteKey(kind), JSON.stringify([...fav])); button.textContent = fav.has(item.name) ? '取消收藏' : '收藏'; render(host, kind, sidebar); }
                catch (_) { notice.textContent = '收藏保存失败'; }
            }
        };
        document.body.append(overlay);
        document.addEventListener('keydown', onKey, true);
        overlay.querySelector('button').focus();
    }
    window.addEventListener?.('content-packs-changed', () => {
        for (const state of Object.values(states)) state.loaded = false;
    });
    window.PromptContentLibrary = {render, adapt, categories, matchesFilters};
})();
