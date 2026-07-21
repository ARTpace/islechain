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
     *  Lightbox：已迁移到 lightbox.js
     * ============================================================ */

    /* ============================================================
     *  CSS 注入
     * ============================================================ */
    const GALLERY_DISPLAY_CSS = `
/* === Lightbox === */
.gallery-lightbox {
    background: rgba(0,0,0,0.88);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
}
.gallery-lightbox #lightboxImg {
    transition: transform 0.1s ease-out;
    position: relative;
    z-index: 1;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}
/* === 提示词查看按钮（悬浮面板已抽到通用 PromptPanel 组件） === */
.lb-icon-btn {
    width: 38px; height: 38px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 11px;
    background: rgba(255,255,255,0.12);
    color: #e2e8f0;
    border: 1px solid rgba(255,255,255,0.18);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    transition: background .15s ease, color .15s ease, transform .15s ease;
    cursor: pointer;
    padding: 0;
}
.lb-icon-btn:hover { background: rgba(255,255,255,0.22); color: #fff; }
.lb-icon-btn:active { transform: scale(0.94); }
.lb-icon-btn.active { background: rgba(0,180,216,0.35); color: #fff; border-color: rgba(0,180,216,0.6); }
/* 提示词悬浮面板的样式已迁移到 prompt-panel.js（通用组件） */
#lightboxThumbnails {
    gap: 8px;
    padding: 8px 12px;
    overflow-x: auto;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
    cursor: grab;
    display: flex;
    flex-wrap: nowrap;
}
#lightboxThumbnails:active { cursor: grabbing; }
#lightboxThumbnails::-webkit-scrollbar { display: none; }
#lightboxThumbnails { -ms-overflow-style: none; scrollbar-width: none; }
.lightbox-thumb {
    width: 60px;
    height: 60px;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    opacity: 0.5;
    transition: all 0.2s;
    flex-shrink: 0;
    border: 2px solid transparent;
}
.lightbox-thumb:hover { opacity: 0.8; }
.lightbox-thumb.active {
    opacity: 1;
    border-color: #00b4d8;
    box-shadow: 0 0 12px rgba(0,180,216,0.5);
}
.lightbox-thumb img { width: 100%; height: 100%; object-fit: cover; }

/* === Masonry Grid（共享样式，覆盖所有页面） === */
.masonry-grid { column-count:2; column-gap:12px; }
.masonry-grid .date-separator { column-span:all; display:flex; align-items:center; gap:12px; padding:8px 0 4px; }
.masonry-grid .date-separator .sep-line { flex:1; height:1px; background:rgba(0,0,0,0.08); }
.masonry-grid .date-separator .sep-label { font-size:10px; font-weight:700; color:#999; text-transform:uppercase; letter-spacing:0.08em; white-space:nowrap; }
body.studio-theme-dark .masonry-grid .date-separator .sep-line { background:rgba(255,255,255,0.08); }
body.studio-theme-dark .masonry-grid .date-separator .sep-label { color:#4a6a80; }
@media(min-width:640px){ .masonry-grid{ column-gap:16px; } }
@media(min-width:768px){ .masonry-grid{ column-count:3; column-gap:20px; } }
@media(min-width:1024px){ .masonry-grid{ column-count:4; } }
.masonry-grid.thumb-large{ column-count:2!important; column-gap:14px!important; }
.masonry-grid.thumb-medium{ /* 默认 */ }
.masonry-grid.thumb-small{ column-count:5!important; column-gap:8px!important; }
.masonry-grid.thumb-small .model-badge{ display:none!important; }
@media(min-width:640px){ .masonry-grid.thumb-large{ column-count:2!important; column-gap:18px!important; } .masonry-grid.thumb-small{ column-count:5!important; } }
@media(min-width:768px){ .masonry-grid.thumb-large{ column-count:3!important; } .masonry-grid.thumb-small{ column-count:6!important; } }
@media(min-width:1024px){ .masonry-grid.thumb-large{ column-count:3!important; } .masonry-grid.thumb-small{ column-count:6!important; } }
.masonry-item { border-radius:24px; overflow:hidden; background:#eee; border:1px solid #f1f5f9; transition:all 0.5s cubic-bezier(0.4,0,0.2,1); position:relative; break-inside:avoid; margin-bottom:12px; }
.masonry-item:hover { transform:translateY(-6px); box-shadow:0 20px 40px rgba(0,0,0,0.08); }
body.studio-theme-dark .masonry-item { background:#0d1520; border-color:rgba(0,240,255,0.1); }
body.studio-theme-dark .masonry-item:hover { box-shadow:0 20px 40px rgba(0,240,255,0.06); }

/* === NSFW 相关样式已迁移到 nsfw-filter.js === */

/* === Scroll to Top 样式已迁移到 scroll-top.js === */

/* === 隐藏操作栏中右键菜单已有的按钮 === */
.gallery-actions .gallery-action-btn[onclick*="toggleFavorite"] { display: none !important; }
.gallery-actions .gallery-action-btn[onclick*="openImageFolder"] { display: none !important; }
.gallery-actions .gallery-action-btn[onclick*="copyPrompt"] { display: none !important; }

/* === 图片收藏星标：确保白色背景上可见 === */
.img-fav-btn {
    background: rgba(0,0,0,0.5) !important;
    color: #fff !important;
}
.img-fav-btn.is-fav {
    background: rgba(245,158,11,0.85) !important;
    color: #fff !important;
    opacity: 1 !important;
}

/* === 多图删除按钮 === */
.img-del-btn {
    background: rgba(220,38,38,0.8) !important;
    color: #fff !important;
}
.img-del-btn.is-confirming {
    background: #dc2626 !important;
    animation: galleryDeleteShake 0.4s ease-in-out infinite alternate;
}

/* === 缩略图操作按钮：顶部居中，按钮半透明 === */
.gallery-actions {
    top: 10px !important;
    right: auto !important;
    left: 50% !important;
    transform: translateX(-50%);
    background: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    border-radius: 0 !important;
    padding: 0 !important;
}
.gallery-action-btn {
    background: rgba(0,0,0,0.45) !important;
    color: #fff !important;
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
}

/* === 收藏模式：隐藏日期分隔线 === */
body.fav-mode .date-separator { display: none !important; }

/* === Dark mode === */
body.studio-theme-dark .lightbox-thumb.active {
    border-color: #00f0ff;
    box-shadow: 0 0 12px rgba(0,240,255,0.5);
}

/* === Responsive === */
@media (max-width: 640px) {
    #lightboxThumbnails { gap: 6px; padding: 6px 8px; }

`;

    function injectCSS() {
        if (document.getElementById('gallery-display-css')) return;
        const style = document.createElement('style');
        style.id = 'gallery-display-css';
        style.textContent = GALLERY_DISPLAY_CSS;
        document.head.appendChild(style);
    }

    /* ============================================================
     *  HTML 注入
     * ============================================================ */
    function injectHTML() {
        // Lightbox HTML：已迁移到 lightbox.js.init() / injectHTML()（在 init 阶段调用）

        // --- Scroll to Top：已迁移到 scroll-top.js（自动 init，无需此处处理）---

        // --- Load More Trigger ---
        if (config.loadMore && !document.getElementById('loadMoreTrigger')) {
            const main = document.querySelector(config.mainSelector);
            if (main) {
                const trigger = document.createElement('div');
                trigger.id = 'loadMoreTrigger';
                trigger.className = 'py-12 text-center text-gray-300 text-[10px] font-bold uppercase tracking-widest cursor-pointer hidden';
                trigger.textContent = '加载更多归档';
                main.appendChild(trigger);
            }
        }
    }

    /* ============================================================
     *  Lightbox Actions / Records / Refresh / Open / Close 等：
     *  已迁移到 lightbox.js
     * ============================================================ */

    /* ============================================================
     *  Toolbar Extras：已迁移到 toolbar-extras.js
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

        // 1. 注入 CSS
        injectCSS();

        // 2. 注入 HTML
        injectHTML();

        // 3. 初始化 Lightbox 模块（[Task 6 迁移] HTML/Actions 全部由其负责）
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
