/*!
 * GalleryContextMenu - 统一的右键菜单
 */
(function (global) {
    'use strict';

    let menuEl = null;
    let currentRecord = null;
    let currentFeatures = null;
    let deleteConfirmNode = null;  // 删除两步确认：当前处于确认态的菜单项节点

    function ensureMenu() {
        if (menuEl) return menuEl;
        menuEl = document.createElement('div');
        menuEl.id = 'galleryContextMenu';
        menuEl.className = 'gallery-context-menu';
        document.body.appendChild(menuEl);
        // 点其他地方关闭
        document.addEventListener('click', () => hide());
        document.addEventListener('contextmenu', (e) => {
            // 如果是图片卡片上的右键，不关闭（让 card.js 的处理接管）
            if (e.target.closest('.masonry-item')) return;
            hide();
        });
        return menuEl;
    }

    /**
     * 显示右键菜单
     * @param {number} x
     * @param {number} y
     * @param {Object} record
     * @param {Object} features
     */
    function show(x, y, record, features) {
        const el = ensureMenu();
        currentRecord = record;
        currentFeatures = features || {};
        deleteConfirmNode = null;  // 每次重新打开菜单重置确认态
        const items = buildItems(record, currentFeatures);
        el.innerHTML = items.map((it, i) => {
            if (it.divider) return '<div class="gallery-context-divider"></div>';
            return `<div class="gallery-context-item" data-action="${it.action}">${it.icon || ''}<span>${it.label}</span></div>`;
        }).join('');
        el.style.display = 'block';
        // 防止超出视口
        requestAnimationFrame(() => {
            const rect = el.getBoundingClientRect();
            if (rect.right > window.innerWidth) el.style.left = (window.innerWidth - rect.width - 8) + 'px';
            else el.style.left = x + 'px';
            if (rect.bottom > window.innerHeight) el.style.top = (window.innerHeight - rect.height - 8) + 'px';
            else el.style.top = y + 'px';
        });
        // 绑定点击
        el.querySelectorAll('.gallery-context-item').forEach(node => {
            node.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = node.dataset.action;

                // 删除 — 两步确认（第一次变红，第二次才执行）
                if (action === 'deleteHistoryItem') {
                    if (deleteConfirmNode === node) {
                        // 第二次点击：执行删除
                        hide();
                        doDelete(currentRecord);
                    } else {
                        // 第一次点击：进入确认态
                        // 先清除其他项的确认态
                        if (deleteConfirmNode) {
                            deleteConfirmNode.classList.remove('gallery-context-confirming');
                            const span = deleteConfirmNode.querySelector('span');
                            if (span) span.textContent = '删除';
                        }
                        // 当前项变红
                        node.classList.add('gallery-context-confirming');
                        const span = node.querySelector('span');
                        if (span) span.textContent = '确认删除？';
                        deleteConfirmNode = node;
                    }
                    return;
                }

                hide();
                if (action === '__view__') {
                    // 查看大图：触发卡片的 click 事件打开 lightbox
                    const card = document.querySelector(`#history-${currentRecord.timestamp}`);
                    if (card) card.click();
                    else if (currentRecord.images && currentRecord.images[0]) window.open(currentRecord.images[0], '_blank');
                } else if (action === 'downloadImage') {
                    // 下载图片：需要传 (imageUrl, filename, event)
                    const imgUrl = (currentRecord.images && currentRecord.images[0]) || '';
                    const filename = (currentRecord.timestamp || Date.now()) + '.png';
                    global.GalleryActions.downloadImage(imgUrl, filename, e);
                } else if (action === 'toggleFavorite') {
                    // 收藏：统一入口 GalleryDisplay.Favorites.toggle(url)
                    // UI 同步由 fav:changed 事件驱动
                    const imgUrl = (currentRecord.images && currentRecord.images[0]) || '';
                    if (global.GalleryDisplay && global.GalleryDisplay.Favorites) {
                        global.GalleryDisplay.Favorites.toggle(imgUrl);
                    } else if (typeof global.GalleryActions[action] === 'function') {
                        // 兜底：模块未加载
                        global.GalleryActions[action](currentRecord, e, imgUrl);
                    }
                } else if (action && typeof global.GalleryActions[action] === 'function') {
                    global.GalleryActions[action](currentRecord, e);
                }
            });
        });
    }

    /** 自包含的删除逻辑（不依赖 GalleryActions.deleteHistoryItem，绕过其两步确认限制） */
    function doDelete(record) {
        const ts = record && record.timestamp;
        if (!ts) return;
        const historyType = record.type || (global.GALLERY_CONFIG && global.GALLERY_CONFIG.type) || 'unknown';
        fetch('/api/history/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: historyType, timestamp: ts })
        }).catch(function () {});
        var el = document.getElementById('history-' + ts);
        if (el) el.remove();
        if (global.GalleryList && Array.isArray(global.GalleryList.allHistory)) {
            global.GalleryList.allHistory = global.GalleryList.allHistory.filter(function (h) { return String(h.timestamp) !== String(ts); });
        }
    }

    function hide() {
        // 重置删除确认态
        if (deleteConfirmNode) {
            deleteConfirmNode.classList.remove('gallery-context-confirming');
            var span = deleteConfirmNode.querySelector('span');
            if (span) span.textContent = '删除';
            deleteConfirmNode = null;
        }
        if (menuEl) menuEl.style.display = 'none';
    }

    const _SVG = {
        magnify: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
        folder: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        pencil: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
        copy: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        star: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        download: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        canvas: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
        refresh: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
        trash: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    };

    function buildItems(record, features) {
        const items = [];
        items.push({ label: '查看大图', action: '__view__', icon: _SVG.magnify });
        if (features.openFolder)  items.push({ label: '打开文件夹', action: 'openImageFolder', icon: _SVG.folder });
        if (features.usePrompt)   items.push({ label: '载入提示词', action: 'usePrompt',       icon: _SVG.pencil });
        if (features.copyPrompt)  items.push({ label: '复制提示词', action: 'copyPrompt',      icon: _SVG.copy });
        if (features.favorite)    items.push({ label: '收藏',       action: 'toggleFavorite',  icon: _SVG.star });
        if (features.download)    items.push({ label: '下载图片',   action: 'downloadImage',   icon: _SVG.download });
        if (features.copyToCanvas) items.push({ label: '复制到画布', action: 'copyToCanvas',    icon: _SVG.canvas });
        if (features.regenerate)  items.push({ label: '重新生成',   action: 'regenerate',      icon: _SVG.refresh });
        if (features.delete) {
            items.push({ divider: true });
            items.push({ label: '删除', action: 'deleteHistoryItem', icon: _SVG.trash });
        }
        return items;
    }

    global.GalleryContextMenu = { show, hide };
})(window);
