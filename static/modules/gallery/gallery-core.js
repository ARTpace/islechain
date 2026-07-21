/*!
 * GalleryCore - 展示层基础 CSS + Load-More 触发器
 * 依赖: 无
 * 用法: GalleryCore.init({ loadMore, mainSelector })
 */
(function (global) {
    'use strict';
    const NS = global.GalleryDisplay = global.GalleryDisplay || {};
    const Base = NS.Base;
    if (!Base) { console.error('[GalleryCore] 缺少 GalleryDisplay.Base'); return; }

    /* ============================================================
     *  共享 CSS（[Task 7 迁移] 从 display.js 抽离）
     *  - Lightbox / Masonry / Action Btn / Dark mode / Responsive
     * ============================================================ */
    const GALLERY_CORE_CSS = `
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

/* === 收藏星标：通过 .is-fav class 切换填充状态（统一入口 Favorites.toggle） === */
.gallery-fav svg polygon { fill: none; }
.gallery-fav.is-fav svg polygon { fill: currentColor; }

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
}
`;

    const GalleryCore = {
        _initialized: false,

        init(config = {}) {
            if (this._initialized) return;
            this.injectCSS();
            this.injectLoadMoreTrigger(config);
            this._initialized = true;
            if (!config.skipSelfTest) this._runSelfTests();
        },

        destroy() { this._initialized = false; },

        injectCSS() {
            if (document.getElementById('gallery-display-css')) return;
            const style = document.createElement('style');
            style.id = 'gallery-display-css';
            style.textContent = GALLERY_CORE_CSS;
            document.head.appendChild(style);
        },

        injectLoadMoreTrigger(config = {}) {
            if (!config.loadMore) return;
            if (document.getElementById('loadMoreTrigger')) return;
            const main = document.querySelector(config.mainSelector);
            if (!main) return;
            const trigger = document.createElement('div');
            trigger.id = 'loadMoreTrigger';
            trigger.className = 'py-12 text-center text-gray-300 text-[10px] font-bold uppercase tracking-widest cursor-pointer hidden';
            trigger.textContent = '加载更多归档';
            main.appendChild(trigger);
        },

        _runSelfTests() {
            Base.Test.suite('GalleryCore', [
                ['模块已挂载到 GalleryDisplay', () => NS.GalleryCore === this],
                ['_initialized=true', () => this._initialized === true],
                ['CSS 已注入到 <head>', () => !!document.getElementById('gallery-display-css')],
                ['idempotent: 二次 initCSS() 不重复注入', () => {
                    const before = document.getElementById('gallery-display-css');
                    this.injectCSS();
                    const after = document.getElementById('gallery-display-css');
                    return before === after;
                }],
            ]);
        },
    };

    NS.GalleryCore = GalleryCore;
})(window);
