/* 提示词、画师、角色共用卡片和响应式列布局。 */
(function () {
    'use strict';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let observer;
    function unmount() { observer?.disconnect(); observer = null; }
    function card(item, options = {}) {
        const attribute = options.attribute || 'data-prompt-row';
        const name = item.name || '提示词';
        const image = item.thumbnail || '';
        const badge = `<span class="prompt-card-badge">${esc(options.label || '')}</span>`;
        const favorite = options.favorite ? '<span class="prompt-card-fav" title="已收藏">★</span>' : '';
        const check = options.selectable ? `<input class="prompt-row-check" type="checkbox" data-prompt-check="${esc(item.id)}" ${options.checked ? 'checked' : ''} ${options.readonly ? 'disabled' : ''}>` : '';
        return `<article class="prompt-card ${image ? '' : 'is-text'} ${options.active ? 'active' : ''}" ${attribute}="${esc(item.id)}">
            ${check}${image ? `<div class="prompt-card-media"><div class="prompt-card-fallback" hidden><strong>${esc(name)}</strong></div><img src="${esc(options.src || image)}" data-fallback-src="${esc(image)}" alt="${esc(name)}" loading="lazy" decoding="async" onload="this.previousElementSibling.hidden=true" onerror="if(!this.dataset.fallbackUsed&&this.src!==this.dataset.fallbackSrc){this.dataset.fallbackUsed='1';this.src=this.dataset.fallbackSrc}else{this.previousElementSibling.hidden=false;this.remove()}">${badge}${favorite}</div><div class="prompt-card-caption"><button type="button" title="查看大图和提示词" ${attribute}="${esc(item.id)}">${esc(name)}</button></div>` : `<div class="prompt-card-body"><div class="prompt-card-tags"><span class="prompt-tag">${esc(options.label || '')}</span>${favorite}</div><button type="button" class="prompt-card-title" ${attribute}="${esc(item.id)}">${esc(name)}</button></div>`}
        </article>`;
    }
    function mount(gallery) {
        unmount();
        if (!gallery) return;
        const cards = [...gallery.querySelectorAll(':scope > .prompt-card, :scope > .prompt-masonry-column > .prompt-card')];
        let previousCount = 0;
        const layout = () => {
            const small = window.innerWidth <= 760;
            const gap = small ? 14 : 24;
            const count = Math.max(1, Math.min(5, Math.floor((gallery.clientWidth + gap) / ((small ? 150 : 300) + gap))));
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
    window.PromptGalleryUI = {card, mount, unmount};
})();
