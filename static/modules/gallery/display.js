/*!
 * GalleryDisplay - 统一图片展示层
 * 把 Lightbox / 工具栏 / 回到顶部 / 滚动加载 全部收进一个文件，
 * 页面只需调 GalleryDisplay.init(config) 即可。
 *
 * 依赖（需在本文件之前加载）：
 *   gallery/style.css  / card.js / list.js / actions.js / context-menu.js
 *   image-viewer.js
 *
 * API:
 *   GalleryDisplay.init(config)   初始化（注入 HTML/CSS、绑定事件）
 *   GalleryDisplay.openLightbox() 打开灯箱（兼容多种签名）
 *   GalleryDisplay.closeLightbox()
 *   GalleryDisplay.refreshFavBtn()
 *   GalleryDisplay.refreshThumbnails()
 */
(function (global) {
    'use strict';

    /* ============================================================
     *  默认配置
     * ============================================================ */
    const DEFAULTS = {
        // 容器选择器
        masonrySelector: '#masonry',
        loadMoreSelector: '#loadMoreTrigger',
        mainSelector: 'main',

        // 功能开关
        lightbox: true,          // 是否注入 lightbox
        scrollToTop: true,       // 是否注入回到顶部按钮
        loadMore: true,          // 是否注入 loadMoreTrigger
        toolbarExtras: true,     // 是否注入工具栏额外按钮（缩略图尺寸/收藏过滤/NSFW）

        // 收藏功能
        favoritesEnabled: true,
        favoritesStorageKey: 'gallery_favorites',

        // 业务回调（页面可覆盖）
        onPromptDisplay: null,   // (promptText) => { en, cn }  用于 lightbox prompt 翻译
        onCopyPrompt: null,      // (record) => void
        onUsePrompt: null,       // (record) => void
        onRegenerate: null,      // (record) => void
        onOpenFolder: null,      // (record) => void
        onExtraToolbarButtons: null, // () => [{id, label, title, onClick}]

        // 历史记录类型（传给 GalleryList）
        historyType: 'unknown',
        pageSize: 15,
        autoScan: true,           // 是否自动扫描新图片
    };

    /* ============================================================
     *  CSS / 基础 HTML 注入：已迁移到 gallery-core.js
     * ============================================================ */

    /* ============================================================
     *  GALLERY_CONFIG 设置
     * ============================================================ */
    function setupGalleryConfig() {
        window.GALLERY_CONFIG = {
            type: config.historyType,
            container: config.masonrySelector,
            trigger: config.loadMoreSelector,
            pageSize: config.pageSize,
            onUsePrompt: config.onUsePrompt || null,
            features: Object.assign({
                delete: true,
                openFolder: true,
                download: true,
                copyToCanvas: false,
                regenerate: false,
                batchSelect: false,
                contextMenu: true,
                imageFallback: true,
                modelBadge: null,
                favorite: config.favoritesEnabled,
                copyPrompt: true,
                usePrompt: true,
            }, config.galleryFeatures || {}),
        };
    }

    /* ============================================================
     *  公开 API
     * ============================================================ */
    function init(userConfig) {
        config = Object.assign({}, DEFAULTS, userConfig || {});

        // 1. 注入基础 CSS + Load-More Trigger（[Task 7 迁移]）
        if (window.GalleryDisplay?.GalleryCore) {
            window.GalleryDisplay.GalleryCore.init({
                loadMore: config.loadMore,
                mainSelector: config.mainSelector,
            });
        }

        // 2. 初始化 Lightbox 模块（[Task 6 迁移] HTML/Actions 全部由其负责）
        if (config.lightbox && window.GalleryDisplay?.Lightbox) {
            window.GalleryDisplay.Lightbox.init({
                lightbox: config.lightbox,
                onOpenFolder: config.onOpenFolder,
                onCopyPrompt: config.onCopyPrompt,
                onUsePrompt: config.onUsePrompt,
                onPromptDisplay: config.onPromptDisplay,
            });
        }

        // 4. 初始化收藏（[Task 3 迁移]）
        if (config.favoritesEnabled && window.GalleryDisplay?.Favorites) {
            window.GalleryDisplay.Favorites.init({
                storageKey: config.favoritesStorageKey,
            });
        }

        // 5. 设置 GALLERY_CONFIG
        setupGalleryConfig();

        // 6. 初始化 GalleryList
        if (window.GalleryList) {
            GalleryList.init({
                type: config.historyType,
                container: config.masonrySelector,
                trigger: config.loadMoreSelector,
                pageSize: config.pageSize,
                batchSelect: (window.GALLERY_CONFIG.features && window.GALLERY_CONFIG.features.batchSelect) || false,
            });
        }

        // 7. 初始化工具栏（[Task 5 迁移]）
        if (config.toolbarExtras && window.GalleryDisplay?.ToolbarExtras) {
            window.GalleryDisplay.ToolbarExtras.init({
                toolbarExtras: config.toolbarExtras,
                masonrySelector: config.masonrySelector,
                favoritesEnabled: config.favoritesEnabled,
                nsfwEnabled: config.nsfwEnabled,
                longPressToSelect: config.longPressToSelect,
                onExtraToolbarButtons: config.onExtraToolbarButtons,
            });
        }

        // 8. 初始化回到顶部（[Task 2 迁移]）
        if (config.scrollToTop && window.GalleryDisplay?.ScrollTop) {
            window.GalleryDisplay.ScrollTop.init({ mainSelector: config.mainSelector });
        }

        // 9. 加载历史
        if (window.GalleryList) GalleryList.load(0);

        // 10. 自动扫描新图片（[Task 4 迁移] 默认 60s/次，首次 3s 延迟）
        if (config.autoScan !== false && window.GalleryDisplay?.AutoScan) {
            window.GalleryDisplay.AutoScan.init({ historyType: config.historyType });
        }

        // 11. 挂载 HistoryBulkManager
        if (window.HistoryBulkManager) {
            window.HistoryBulkManager.attach({ masonry: config.masonrySelector, longPressToSelect: config.longPressToSelect });
        }

        // 11. 刷新图标
        if (window.lucide && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }

        // 11.5 [Task 1 迁移] 初始化 NSFW Filter 模块
        if (config.nsfwEnabled && window.GalleryDisplay?.NsfwFilter) {
            const NsfwFilter = window.GalleryDisplay.NsfwFilter;
            NsfwFilter.init({ autoRestore: true });
            // 绑定到工具栏按钮（DOM 由 HistoryBulkManager 在上一行已渲染）
            const nsfwBtn = document.querySelector('[data-extra-btn="nsfw-toggle"]');
            if (nsfwBtn) {
                NsfwFilter.attachButton(nsfwBtn);
                // 初始高亮状态：与 body class 对齐
                nsfwBtn.classList.toggle('is-on', NsfwFilter.getMode() === 'block');
                nsfwBtn.classList.toggle('is-only-on', NsfwFilter.getMode() === 'only');
            }
        }
    }

    /* ============================================================
     *  暴露全局（合并到已有 GalleryDisplay 命名空间，避免覆盖子模块）
     *  Lightbox 相关 API（[Task 6 迁移]）从 GalleryDisplay.Lightbox 转发，
     *  保持 window.openLightbox / GalleryDisplay.openLightbox 等旧调用方式可用。
     * ============================================================ */
    const _lightboxProxy = () => (global.GalleryDisplay && global.GalleryDisplay.Lightbox) || null;
    global.GalleryDisplay = Object.assign(global.GalleryDisplay || {}, {
        init,
        openLightbox: (...args) => { const lb = _lightboxProxy(); if (lb) return lb.openLightbox(...args); },
        closeLightbox: () => { const lb = _lightboxProxy(); if (lb) return lb.closeLightbox(); },
        handleOutsideClick: (e) => { const lb = _lightboxProxy(); if (lb) return lb.handleOutsideClick(e); },
        lightboxAction: (a) => { const lb = _lightboxProxy(); if (lb) return lb.lightboxAction(a); },
        togglePromptPanel: () => { const lb = _lightboxProxy(); if (lb) return lb.togglePromptPanel(); },
        refreshFavBtn: () => { const lb = _lightboxProxy(); if (lb) return lb.refreshFavBtn(); },
        refreshThumbnails: () => { const lb = _lightboxProxy(); if (lb) return lb.refreshThumbnails(); },
        switchImage: (i) => { const lb = _lightboxProxy(); if (lb) return lb.switchImage(i); },
    });

    // 兼容旧代码：window.openLightbox = GalleryDisplay.openLightbox
    Object.defineProperty(global, 'openLightbox', {
        get() { return global.GalleryDisplay.openLightbox; },
        set(fn) { global.GalleryDisplay.openLightbox = fn; },
        configurable: true,
    });

})(window);
