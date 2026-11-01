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
            const want = Array.isArray(expected) ? expected : [expected];
            if (!want.length) return true;
            const value = key === 'tier' ? tier(kind, item.count) : item[key];
            const values = Array.isArray(value) ? value : [value];
            // 同一维度内多选取并集，不同维度之间取交集
            return want.some(entry => values.includes(entry));
        });
    }
    function filterValues(state, key) {
        const raw = state.filters[key];
        return Array.isArray(raw) ? raw : (raw ? [raw] : []);
    }
    function toggleFilterValue(state, key, value) {
        const list = filterValues(state, key);
        const index = list.indexOf(value);
        if (index >= 0) list.splice(index, 1);
        else list.push(value);
        if (list.length) state.filters[key] = list;
        else delete state.filters[key];
    }
    // 卡片尺寸 / 排序 / 收藏筛选统一走 PromptGalleryUI，和「风格」页共用同一套控件与 localStorage
    function ui() { return window.PromptGalleryUI; }
    // 筛选控件按维度定制：性别用图标切换、发色/瞳色用色卡，比一串下拉直观得多
    const SWATCH_COLORS = {
        black: '#1e1e1f', brown: '#8b5e3c', blonde: '#e9c46a', blue: '#4a7bd1', grey: '#9aa0a6',
        silver: '#c8ccd0', white: '#f2f0ea', red: '#d94b3f', pink: '#ef8fb0', purple: '#8b5bd6',
        green: '#4a9c5d', orange: '#e08a3c', aqua: '#4fc3c8', cyan: '#4fc3c8', yellow: '#e6c243', gold: '#e6c243'
    };
    const SWATCH_NAMES = {
        black: '黑色', brown: '棕色', blonde: '金色', blue: '蓝色', grey: '灰色', silver: '银色', white: '白色',
        red: '红色', pink: '粉色', purple: '紫色', green: '绿色', orange: '橙色', aqua: '青色', cyan: '青色',
        yellow: '黄色', gold: '金色'
    };
    const GENDER_NAMES = {'1girl': '女', '1boy': '男', girl: '女', boy: '男', female: '女', male: '男'};
    // 手机端用的短标签，入口按钮一行放得下
    const SHORT_LABELS = {'热度分级': '热度', '角色性别': '性别', '性别': '性别', '角色发色': '发色', '角色瞳色': '瞳孔', '角色特征': '特征', '作品系列': '系列', '发色': '发色', '瞳色': '瞳孔'};
    function shortLabel(label) {
        return SHORT_LABELS[label] || (label.length > 3 ? label.replace(/^角色|^作品/, '') : label);
    }
    const GENDER_ICONS = {
        '1girl': '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="9" r="4"/><path d="M8 12.2V15M6.5 13.6h3"/></svg>',
        '1boy': '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="6.4" cy="9.6" r="3.8"/><path d="M9.2 6.8 14 2M14 2H11M14 2v3"/></svg>'
    };
    GENDER_ICONS.girl = GENDER_ICONS['1girl'];
    GENDER_ICONS.boy = GENDER_ICONS['1boy'];
    // 每个维度收成一个入口按钮，点开才展开选项面板；选完自动收起并回显所选值
    let popCloser = null;
    function closePopWatcher() {
        if (!popCloser) return;
        document.removeEventListener('pointerdown', popCloser, true);
        popCloser = null;
    }
    function renderCategories(host) {
        // 所有宽度统一：筛选只从搜索栏的图标进入，页面内不再铺行内入口
        const bar = host.querySelector('[data-content-categories]');
        if (!bar) return;
        bar.innerHTML = '';
        bar.onclick = null;
        closePopWatcher();
    }

    // ---------- 手机端筛选面板：筛选图标 → 底部升起的分组面板 ----------
    let sheetWrap = null;
    function closeFilterSheet() {
        if (sheetWrap) sheetWrap.remove();
        sheetWrap = null;
        document.documentElement.classList.remove('filter-sheet-open');
    }
    function sheetOption(group, option, count, active) {
        if (group.key === 'hair' || group.key === 'eye') {
            return `<button class="filter-swatch ${active ? 'is-on' : ''}" type="button" data-pfg-key="${group.key}" data-pfg-value="${esc(option)}" aria-pressed="${active}" aria-label="${esc(SWATCH_NAMES[option] || option)}（${count}）" title="${esc(SWATCH_NAMES[option] || option)}（${count}）" style="--swatch:${SWATCH_COLORS[option] || '#8b8b8b'}"></button>`;
        }
        const label = group.key === 'gender' ? (GENDER_NAMES[option] || option) : option;
        const icon = group.key === 'gender' ? (GENDER_ICONS[option] || '') : '';
        return `<button class="filter-opt ${active ? 'is-on' : ''}" type="button" data-pfg-key="${group.key}" data-pfg-value="${esc(option)}" aria-pressed="${active}">${icon}<span>${esc(label)}</span><em>${count}</em></button>`;
    }
    // 取值很多的维度（角色特征 / 作品系列）：默认只展示前若干项，标题右侧图标进入「全部标签」视图
    const LONG_GROUPS = new Set(['feat', 'copyright']);
    const SHEET_PREVIEW = 12;
    function sheetGridHtml(group, state, options) {
        const value = filterValues(state, group.key);
        const swatch = group.key === 'hair' || group.key === 'eye';
        // 「不限」和选项排在同一条流里，跟着一起换行，不单独占一行
        const clear = `<button class="filter-opt filter-clear ${value.length ? '' : 'is-on'}" type="button" data-pfg-key="${group.key}" data-pfg-value="" aria-pressed="${!value.length}">不限</button>`;
        const body = options.map(([option, count]) => sheetOption(group, option, count, value.includes(option))).join('');
        return `<div class="filter-grid ${swatch ? 'is-swatch' : 'is-chips'}">${clear}${body}</div>`;
    }
    // 分组列表：每组标题 + 右侧图标（展开该组全部标签）
    function sheetListHtml(groups, state) {
        if (!groups.length) return '<p class="filter-sheet-empty">当前内容还没有可筛选的维度。</p>';
        return groups.map(group => {
            const canExpand = LONG_GROUPS.has(group.key) && group.options.length > SHEET_PREVIEW;
            const more = canExpand
                ? `<button class="filter-block-expand" type="button" data-sheet-expand="${group.key}" title="查看全部 ${group.options.length} 项" aria-label="查看全部 ${group.options.length} 项"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.2 2.4H2.4v3.8M9.8 2.4h3.8v3.8M2.4 9.8v3.8h3.8M13.6 9.8v3.8H9.8"/></svg></button>`
                : '';
            return `<section class="filter-block" data-block="${group.key}">
                <h4><span>${esc(group.label)}</span>${more}</h4>
                <div data-opts>${sheetGridHtml(group, state, group.options.slice(0, canExpand ? SHEET_PREVIEW : group.options.length))}</div>
            </section>`;
        }).join('');
    }
    // 单组视图：整个面板只显示这一组的全部标签，可滑动并多选
    function sheetGroupHtml(group, state) {
        const value = filterValues(state, group.key);
        const swatch = group.key === 'hair' || group.key === 'eye';
        const clear = `<button class="filter-opt filter-clear ${value.length ? '' : 'is-on'}" type="button" data-pfg-key="${group.key}" data-pfg-value="" aria-pressed="${!value.length}">不限</button>`;
        const body = group.options.map(([option, count]) => sheetOption(group, option, count, value.includes(option))).join('');
        return `<div class="filter-grid ${swatch ? 'is-swatch' : 'is-chips'}">${clear}${body}</div>`;
    }
    function openFilterSheet(host, kind, state, anchor) {
        closeFilterSheet();
        const groups = categories(kind, state.items).filter(group => group.options.length);
        let view = '';
        const wrap = document.createElement('div');
        wrap.className = 'filter-sheet-backdrop';
        wrap.innerHTML = '<div class="filter-sheet" role="dialog" aria-modal="true" aria-label="筛选"></div>';
        const sheet = wrap.querySelector('.filter-sheet');
        const paint = (keepScroll = true) => {
            const kept = keepScroll ? (wrap.querySelector('.filter-sheet-body')?.scrollTop || 0) : 0;
            const group = view ? groups.find(item => item.key === view) : null;
            // 不显示标题栏与关闭键：点面板外的空白区域即可关闭；单组全量时只留一个返回箭头
            const back = group
                ? `<button class="filter-sheet-back" type="button" data-sheet-back aria-label="返回"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg></button>`
                : '';
            sheet.classList.toggle('has-back', !!group);
            sheet.innerHTML = `${back}<div class="filter-sheet-body">${group ? sheetGroupHtml(group, state) : sheetListHtml(groups, state)}</div>`;
            const body = sheet.querySelector('.filter-sheet-body');
            body.scrollTop = kept;
        };
        paint(false);
        wrap._host = host;
        wrap._kind = kind;
        document.body.appendChild(wrap);
        document.documentElement.classList.add('filter-sheet-open');
        window.PromptGalleryUI?.anchorSheet?.(wrap, sheet, anchor);
        sheetWrap = wrap;
        wrap.addEventListener('click', event => {
            if (event.target === wrap || event.target.closest('[data-sheet-close]')) { closeFilterSheet(); return; }
            if (event.target.closest('[data-sheet-back]')) { view = ''; paint(false); return; }
            const expand = event.target.closest('[data-sheet-expand]');
            if (expand) { view = expand.dataset.sheetExpand; paint(false); return; }
            const option = event.target.closest('[data-pfg-key]');
            if (!option) return;
            const key = option.dataset.pfgKey;
            const val = option.dataset.pfgValue || '';
            if (val) toggleFilterValue(state, key, val);
            else delete state.filters[key];
            state.page = 1;
            paint();
            render(host, kind);
        });
    }
    function render(host, kind, sidebar) {
        if (sheetWrap && sheetWrap._kind && sheetWrap._kind !== kind) closeFilterSheet();
        const state = states[kind] ||= {items: [], loaded: false, busy: false, error: '', query: '', onlyFav: false, page: 1, sort: 'popular', filters: {}};
        const fav = favorites(kind);
        const query = state.query.toLowerCase().trim();
        const items = state.items.filter(item => matchesFilters(kind, item, state.filters) && (!state.onlyFav || fav.has(item.name)) &&
            (!query || [item.name, item.prompt, item.copyright, item.gender, item.hair, item.eye].join(' ').toLowerCase().includes(query)));
        items.sort(state.sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.count - a.count);
        const pages = Math.max(1, Math.ceil(items.length / 60));
        state.page = Math.min(state.page, pages);
        const kit = ui();
        const filterCount = Object.values(state.filters).reduce((sum, entry) => sum + (Array.isArray(entry) ? entry.length : 1), 0);
        const filterButton = `<button class="prompt-chip prompt-icon-chip prompt-filter-open ${filterCount ? 'is-on' : ''}" type="button" data-content-filter-open aria-label="筛选" title="筛选${filterCount ? `（已选 ${filterCount} 项）` : ''}"><i data-lucide="sliders-horizontal"></i></button>`;
        host.innerHTML = `<div class="prompt-filter-bar content-filter-bar">
            ${filterButton}
            <label class="asset-search-wrap"><i data-lucide="search"></i><input class="asset-search" type="search" data-content-search placeholder="${window.innerWidth <= 760 ? '搜索' : '搜索名称、触发词或作品'}" value="${esc(state.query)}"></label>
            ${kit.sortSelect(state.sort, [['popular', '热度排序'], ['name', '名称排序']])}
            ${kit.favToggle(state.onlyFav, `只看收藏（${fav.size} 条）`)}
            ${kit.sizeToggle()}
            <button class="prompt-chip prompt-icon-chip" type="button" data-content-reload title="刷新数据" aria-label="刷新数据"><i data-lucide="rotate-cw"></i></button>
        </div>
        <div class="prompt-filter-groups" data-content-categories></div>
            <div class="content-scroll prompt-gallery-scroll"><div class="prompt-masonry prompt-gallery">${items.slice((state.page - 1) * 60, state.page * 60).map(item => window.PromptGalleryUI.card({id:item.id, name:item.name, thumbnail:item.image}, {attribute:'data-content-open', label:item.copyright || (kind === 'artists' ? '画师风格' : '角色'), favorite:fav.has(item.name), actionHtml:window.PromptLibraryPicker?.button(`${kind}:${item.id}`, {positive:item.prompt, negative:''}) || ''})).join('')}</div>
            ${!items.length ? `<div class="empty-state">${esc(state.busy ? '正在加载…' : state.error || '暂无匹配内容，可在「管理」标签安装或导入内容包。')}</div>` : ''}
            <div class="prompt-content-pagination"><button class="prompt-chip" type="button" data-content-page="-1" ${state.page <= 1 ? 'disabled' : ''}><i data-lucide="chevron-left"></i><span>上一页</span></button><span>${state.page} / ${pages}</span><button class="prompt-chip" type="button" data-content-page="1" ${state.page >= pages ? 'disabled' : ''}><span>下一页</span><i data-lucide="chevron-right"></i></button></div></div>`;
        renderCategories(host, kind, state);
        // 条数与「风格」页一样放在顶部标签栏右侧
        const countNode = host.closest('.asset-manager-root')?.querySelector('[data-content-kind-count]');
        if (countNode) countNode.textContent = `共 ${items.length} 条`;
        window.PromptGalleryUI.mount(host.querySelector('.prompt-masonry'), {cardWidth: window.PromptGalleryUI.cardSize()});
        window.lucide?.createIcons();
        host.oninput = event => {
            if (!event.target.matches('[data-content-search]')) return;
            state.query = event.target.value; state.page = 1;
            const start = event.target.selectionStart;
            render(host, kind, sidebar);
            const input = host.querySelector('[data-content-search]'); input.focus();
            try { input.setSelectionRange(start, start); } catch (_) { /* search 输入框可能不支持光标位置 */ }
        };
        host.onchange = event => {
            if (event.target.matches('[data-gallery-sort]')) { state.sort = event.target.value; state.page = 1; render(host, kind, sidebar); }
        };
        host.onclick = async event => {
            const button = event.target.closest('[data-content-open],button');
            if (!button) return;
            if (button.hasAttribute('data-content-filter-open')) { openFilterSheet(host, kind, state, button); return; }
            if (button.hasAttribute('data-gallery-fav')) { state.onlyFav = !state.onlyFav; state.page = 1; render(host, kind, sidebar); }
            if (button.hasAttribute('data-gallery-size')) {
                window.PromptGalleryUI.cycleSize();
                render(host, kind, sidebar);
            }
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
        const actions = overlay.querySelector('.prompt-dialog-actions');
        actions?.insertAdjacentHTML('afterbegin', window.PromptLibraryPicker?.button(`${kind}:${item.id}`, {positive:trigger, negative:''}) || '');
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
        window.lucide?.createIcons();
        document.addEventListener('keydown', onKey, true);
        overlay.querySelector('button').focus();
    }
    window.addEventListener?.('content-packs-changed', () => {
        for (const state of Object.values(states)) state.loaded = false;
    });
    window.PromptContentLibrary = {render, adapt, categories, matchesFilters};
})();
