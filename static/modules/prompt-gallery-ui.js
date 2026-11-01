/* 素材、提示词、画师、角色共用卡片和响应式列布局。 */
(function () {
    'use strict';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let observer;
    const sizeKey = 'artCanvas.gallery.cardSize.v1';
    function cardSize(value) {
        try {
            const size = Number(value === undefined ? localStorage.getItem(sizeKey) : value);
            const valid = Number.isInteger(size) && size >= 140 && size <= 480 && size % 20 === 0;
            if (value !== undefined && valid) localStorage.setItem(sizeKey, String(size));
            return valid ? size : 240;
        } catch (_) { return Number(value) || 240; }
    }
    function sizeControl(id, value = cardSize(), oninput = '') {
        return `<label class="gallery-size-control" title="调节卡片尺寸"><span>卡片</span><input id="${esc(id)}" class="asset-size-range" type="range" min="140" max="480" step="20" value="${value}" aria-label="调节卡片尺寸" ${oninput ? `oninput="${esc(oninput)}"` : ''}><output>${value}px</output></label>`;
    }
    // 卡片尺寸三档 + 排序 + 只看收藏：风格 / 画师 / 角色 / 姿势 / 衣装 / 人像 六个标签共用同一套控件
    const SIZES = [280, 200, 160];
    const SIZE_LABELS = ['大卡片', '中等卡片', '小卡片'];
    const SIZE_SVGS = [
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="14" height="14" rx="2"/></svg>',
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="3" width="10" height="10" rx="2"/><rect x="12" y="3" width="3" height="5" rx="1" opacity="0.4"/><rect x="12" y="9" width="3" height="4" rx="1" opacity="0.4"/></svg>',
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="7" y="1" width="5" height="5" rx="1" opacity="0.6"/><rect x="1" y="7" width="5" height="5" rx="1" opacity="0.6"/><rect x="7" y="7" width="5" height="5" rx="1" opacity="0.4"/></svg>'
    ];
    function sizeIndex() {
        const current = cardSize();
        let best = 0;
        let bestDiff = Infinity;
        SIZES.forEach((size, index) => {
            const diff = Math.abs(size - current);
            if (diff < bestDiff) { best = index; bestDiff = diff; }
        });
        return best;
    }
    function sortSelect(value, options, attribute = 'data-gallery-sort') {
        const rows = (options || [['popular', '热度排序'], ['name', '名称排序']])
            .map(([key, text]) => `<option value="${esc(key)}" ${key === value ? 'selected' : ''}>${esc(text)}</option>`).join('');
        return `<label class="prompt-select prompt-sort-select" title="排序方式"><select ${attribute} aria-label="排序方式">${rows}</select></label>`;
    }
    function favToggle(active, title = '只看收藏', attribute = 'data-gallery-fav') {
        return `<button class="prompt-chip prompt-icon-chip ${active ? 'is-on' : ''}" type="button" ${attribute} aria-pressed="${active}" title="${esc(title)}" aria-label="只看收藏"><i data-lucide="heart"></i></button>`;
    }
    function sizeToggle(attribute = 'data-gallery-size') {
        const index = sizeIndex();
        return `<button class="prompt-chip prompt-icon-chip" type="button" ${attribute} title="切换卡片尺寸（当前${SIZE_LABELS[index]}）" aria-label="切换卡片尺寸">${SIZE_SVGS[index]}</button>`;
    }
    // 循环切档，返回新档位宽度（各标签页只需重渲染即可，尺寸值已写入 localStorage）
    function cycleSize() {
        const next = (sizeIndex() + 1) % SIZES.length;
        cardSize(SIZES[next]);
        return SIZES[next];
    }
    function favorites(key) {
        try {
            const list = JSON.parse(localStorage.getItem(key) || '[]');
            return new Set(Array.isArray(list) ? list : []);
        } catch (_) { return new Set(); }
    }
    function toggleFavorite(key, id) {
        const set = favorites(key);
        if (set.has(id)) set.delete(id); else set.add(id);
        try { localStorage.setItem(key, JSON.stringify([...set])); } catch (_) { /* 隐私模式下可能写不进去 */ }
        return set;
    }
    function unmount() { observer?.disconnect(); observer = null; }
    function card(item, options = {}) {
        const attribute = options.attribute || 'data-prompt-row';
        const name = item.name || '提示词';
        const image = item.thumbnail || '';
        const badge = `<span class="prompt-card-badge">${esc(options.label || '')}</span>`;
        const favorite = (options.actionHtml || '') + (options.favorite ? '<span class="prompt-card-fav" title="已收藏">★</span>' : '');
        const check = options.selectable ? `<input class="${esc(options.checkClass || 'prompt-row-check')}" type="checkbox" ${options.checkAttribute || 'data-prompt-check'}="${esc(item.id)}" ${options.checked ? 'checked' : ''} ${options.readonly ? 'disabled' : ''}>` : '';
        return `<article class="prompt-card ${esc(options.className || '')} ${image ? '' : 'is-text'} ${options.active ? 'active' : ''}" ${attribute}="${esc(item.id)}" ${options.draggable ? 'draggable="true" tabindex="0"' : ''}>
            ${check}${image ? `<div class="prompt-card-media"><div class="prompt-card-fallback" hidden><strong>${esc(name)}</strong></div><img src="${esc(options.src || image)}" data-fallback-src="${esc(image)}" alt="${esc(name)}" loading="lazy" decoding="async" onload="this.previousElementSibling.hidden=true" onerror="if(!this.dataset.fallbackUsed&&this.src!==this.dataset.fallbackSrc){this.dataset.fallbackUsed='1';this.src=this.dataset.fallbackSrc}else{this.previousElementSibling.hidden=false;this.remove()}">${badge}${favorite}</div><div class="prompt-card-caption"><button type="button" title="查看详情" ${attribute}="${esc(item.id)}">${esc(name)}</button></div>` : `<div class="prompt-card-body"><div class="prompt-card-tags"><span class="prompt-tag">${esc(options.label || '')}</span>${favorite}</div><button type="button" class="prompt-card-title" ${attribute}="${esc(item.id)}">${esc(name)}</button></div>`}
        </article>`;
    }
    function mount(gallery, options = {}) {
        unmount();
        if (!gallery) return;
        const cards = [...gallery.querySelectorAll(':scope > .prompt-card, :scope > .prompt-masonry-column > .prompt-card')];
        let previousCount = 0;
        const layout = () => {
            const small = window.innerWidth <= 760;
            const gap = small ? 14 : 24;
            // 桌面端用档位的 0.86 作为每列最小宽度：列会被 1fr 拉满，若直接按档位算，
            // 小档位（160）会和大档位算出同样的列数，点了按钮看起来没反应。
            const base = options.cardWidth || cardSize();
            let count;
            if (small) {
                // 手机端三档直接映射成 2 / 3 / 4 列，比按像素算更好感知
                count = [2, 3, 4][sizeIndex()];
            } else {
                const perColumn = base * 0.86 + gap;
                count = Math.floor((gallery.clientWidth + gap) / perColumn);
            }
            count = Math.max(1, Math.min(8, count || 1));
            if (count === previousCount) return;
            previousCount = count;
            const columns = Array.from({length:count}, () => {
                const column = document.createElement('div');
                column.className = 'prompt-masonry-column';
                return column;
            });
            cards.forEach((card, index) => columns[index % count].append(card));
            gallery.replaceChildren(...columns);
            gallery.style.gridTemplateColumns = `repeat(${count}, minmax(0, 1fr))`;
        };
        layout();
        observer = new ResizeObserver(layout);
        observer.observe(gallery);
    }
    // 桌面/平板：把筛选面板挂到触发按钮下方，从按钮位置展开；手机端保持底部抽屉
    function anchorSheet(backdrop, sheet, anchor) {
        if (!anchor || !sheet || window.innerWidth <= 760) return;
        backdrop.classList.add('is-anchored');
        const rect = anchor.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight, pad = 14, gap = 10;
        const width = Math.min(sheet.offsetWidth || 520, vw - pad * 2);
        sheet.style.width = `${width}px`;
        // is-auto 的浮层按内容自适应高度，不锁死高度
        const auto = sheet.classList.contains('is-auto');
        const height = Math.min(sheet.offsetHeight || 480, vh - pad * 2);
        if(!auto) sheet.style.height = `${height}px`;
        const center = rect.left + rect.width / 2;
        const left = Math.min(Math.max(pad, center - width / 2), Math.max(pad, vw - width - pad));
        const below = rect.bottom + gap;
        const flip = below + height > vh - pad;
        const top = flip ? Math.max(pad, rect.top - gap - height) : below;
        const originX = Math.min(Math.max(center - left, 22), width - 22);
        sheet.style.left = `${left}px`;
        sheet.style.top = `${top}px`;
        sheet.style.transformOrigin = `${originX}px ${flip ? height : 0}px`;
    }
    window.PromptGalleryUI = {card, mount, unmount, cardSize, sizeControl, sizeIndex, sortSelect, favToggle, sizeToggle, cycleSize, favorites, toggleFavorite, anchorSheet, SIZES, SIZE_LABELS};
})();
