/*!
 * GalleryContextMenu - 统一的右键菜单
 */
(function (global) {
    'use strict';

    let menuEl = null;
    let currentRecord = null;
    let currentFeatures = null;

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
                    // 收藏：需要传 (record, event, imgUrl)
                    const imgUrl = (currentRecord.images && currentRecord.images[0]) || '';
                    global.GalleryActions.toggleFavorite(currentRecord, e, imgUrl);
                } else if (action && typeof global.GalleryActions[action] === 'function') {
                    global.GalleryActions[action](currentRecord, e);
                }
            });
        });
    }

    function hide() {
        if (menuEl) menuEl.style.display = 'none';
    }

    function buildItems(record, features) {
        const items = [];
        // 始终提供：用浏览器查看
        items.push({ label: '查看大图', action: '__view__', icon: '🔍' });
        if (features.openFolder)  items.push({ label: '打开文件夹', action: 'openImageFolder', icon: '📁' });
        if (features.usePrompt)   items.push({ label: '载入提示词', action: 'usePrompt',       icon: '✏️' });
        if (features.copyPrompt)  items.push({ label: '复制提示词', action: 'copyPrompt',      icon: '📋' });
        if (features.favorite)    items.push({ label: '收藏',       action: 'toggleFavorite',  icon: '⭐' });
        if (features.download)    items.push({ label: '下载图片',   action: 'downloadImage',   icon: '⬇️' });
        if (features.copyToCanvas) items.push({ label: '复制到画布', action: 'copyToCanvas',    icon: '🎨' });
        if (features.regenerate)  items.push({ label: '重新生成',   action: 'regenerate',      icon: '🔄' });
        if (features.delete) {
            items.push({ divider: true });
            items.push({ label: '删除', action: 'deleteHistoryItem', icon: '🗑' });
        }
        return items;
    }

    global.GalleryContextMenu = { show, hide };
})(window);
