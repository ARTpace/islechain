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

        // NSFW
        nsfwEnabled: false,      // 默认关闭，zimage 可开启

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
     *  状态
     * ============================================================ */
    let config = {};
    let lightboxState = {
        images: [],
        currentIndex: 0,
        currentRecord: null,
        currentPrompt: '',
    };

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

/* === NSFW 屏蔽：彻底隐藏卡片，避免空白分隔线 === */
body.nsfw-mode .masonry-item[data-nsfw="1"] { display: none !important; }

/* === NSFW Only：仅显示 NSFW 图片 === */
body.nsfw-only-mode .masonry-item:not([data-nsfw="1"]) { display: none !important; }
body.nsfw-only-mode .date-separator { display: none !important; }

/* === NSFW 按钮长按进度指示器 === */
.nsfw-longpress-progress {
    position: absolute;
    inset: -3px;
    border-radius: 999px;
    pointer-events: none;
    border: 2px solid transparent;
    transition: none;
    z-index: 1;
    box-sizing: border-box;
}
.nsfw-longpress-progress.active {
    animation: nsfwLongPressFill 5s linear forwards;
}
@keyframes nsfwLongPressFill {
    0%   { border-color: rgba(220,38,38,0); border-top-color: rgba(220,38,38,0.9); }
    25%  { border-color: rgba(220,38,38,0.15); border-top-color: rgba(220,38,38,0.9); border-right-color: rgba(220,38,38,0.9); }
    50%  { border-color: rgba(220,38,38,0.25); border-top-color: rgba(220,38,38,0.9); border-right-color: rgba(220,38,38,0.9); border-bottom-color: rgba(220,38,38,0.9); }
    75%  { border-color: rgba(220,38,38,0.35); border-left-color: rgba(220,38,38,0); border-top-color: rgba(220,38,38,0.9); border-right-color: rgba(220,38,38,0.9); border-bottom-color: rgba(220,38,38,0.9); }
    100% { border-color: rgba(220,38,38,0.7); border-left-color: rgba(220,38,38,0.7); }
}
/* 长按时按钮底色的淡入效果 */
.nsfw-pulsing {
    animation: nsfwPulseBg 1s ease-in-out infinite alternate !important;
    position: relative;
}
@keyframes nsfwPulseBg {
    from { background: rgba(220,38,38,0.4) !important; box-shadow: 0 0 0 0 rgba(220,38,38,0.5); }
    to   { background: rgba(220,38,38,0.7) !important; box-shadow: 0 0 0 6px rgba(220,38,38,0.2); }
}

/* === Scroll to Top === */
#galleryScrollToTop {
    position: fixed;
    bottom: 32px;
    right: 32px;
    z-index: 40;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    transition: all 0.3s ease;
    opacity: 0;
    pointer-events: none;
    border: none;
    cursor: pointer;
}
#galleryScrollToTop.visible {
    opacity: 1;
    pointer-events: auto;
}
#galleryScrollToTop:hover {
    background: rgba(0,0,0,0.8);
    transform: scale(1.1);
}

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
        // --- Lightbox ---
        if (config.lightbox && !document.getElementById('lightbox')) {
            const lightboxHTML = `
<div id="lightbox" onclick="GalleryDisplay.handleOutsideClick(event)" class="hidden fixed inset-0 z-50 gallery-lightbox flex flex-col items-center justify-center">
    <div class="flex flex-col w-full">
        <div id="lightboxImgContainer" class="flex items-center justify-center overflow-hidden relative" style="height:80vh; min-height:0; padding:4px;">
            <img id="lightboxImg" src="" class="object-contain rounded-lg sm:rounded-2xl shadow-2xl">
        </div>
        <div id="lightboxActions" class="z-50 flex gap-1.5 justify-center flex-shrink-0" style="display:none;"></div>
        <div id="lightboxRes" class="text-center text-white/70 text-[10px] sm:text-[11px] font-bold tracking-wider py-1" style="display:none;"></div>
        <div id="lightboxThumbnails" class="flex overflow-x-auto" style="display:none; width:100%; max-width:min(95vw, 800px); margin:0 auto;"></div>
    </div>
</div>`;
            document.body.insertAdjacentHTML('beforeend', lightboxHTML);
        }

        // --- Scroll to Top ---
        if (config.scrollToTop && !document.getElementById('galleryScrollToTop')) {
            const sttHTML = `
<button id="galleryScrollToTop" onclick="GalleryDisplay.scrollToTop()">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
</button>`;
            document.body.insertAdjacentHTML('beforeend', sttHTML);
        }

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
     *  Lightbox Actions HTML
     * ============================================================ */
    const LB_ACTION_SVGS = {
        openFolder: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        download: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
        favorite: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        favoriteActive: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-amber-400"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        copyPrompt: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>',
        usePrompt: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
        delete: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
        prompt: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
        close: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    };

    function renderLightboxActions() {
        const el = document.getElementById('lightboxActions');
        if (!el) return;
        const btnClass = 'w-8 h-8 bg-white/90 backdrop-blur text-black rounded-lg flex items-center justify-center transition-colors';
        const actions = [
            { key: 'openFolder', title: '打开文件夹', hover: 'hover:bg-blue-600 hover:text-white' },
            { key: 'download', title: '下载图片', hover: 'hover:bg-green-600 hover:text-white' },
            { key: 'favorite', id: 'lightboxFavBtn', title: '收藏', hover: 'hover:bg-amber-400 hover:text-white' },
            { key: 'copyPrompt', title: '复制提示词', hover: 'hover:bg-cyan-600 hover:text-white' },
            { key: 'usePrompt', title: '载入提示词', hover: 'hover:bg-indigo-600 hover:text-white' },
            { key: 'delete', title: '删除', hover: 'hover:bg-black hover:text-white' },
            { key: 'prompt', id: 'lightboxPromptBtn', title: '查看提示词', hover: 'hover:bg-violet-600 hover:text-white' },
            { key: 'close', title: '关闭', hover: 'hover:bg-red-600 hover:text-white' },
        ];
        el.innerHTML = actions.map(a => {
            const idAttr = a.id ? ` id="${a.id}"` : '';
            return `<button${idAttr} onclick="GalleryDisplay.lightboxAction('${a.key}')" class="${btnClass} ${a.hover}" title="${a.title}">${LB_ACTION_SVGS[a.key]}</button>`;
        }).join('');
    }

    /* ============================================================
     *  Scroll to Top
     * ============================================================ */
    function initScrollToTop() {
        const btn = document.getElementById('galleryScrollToTop');
        if (!btn) return;
        const mainEl = document.querySelector(config.mainSelector);
        if (!mainEl) return;
        let ticking = false;
        mainEl.addEventListener('scroll', function () {
            if (!ticking) {
                window.requestAnimationFrame(function () {
                    if (mainEl.scrollTop > 400) {
                        btn.classList.add('visible');
                    } else {
                        btn.classList.remove('visible');
                    }
                    ticking = false;
                });
                ticking = true;
            }
        });
    }

    function scrollToTop() {
        const mainEl = document.querySelector(config.mainSelector);
        if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ============================================================
     *  Favorites 初始化
     * ============================================================ */
    function initFavorites() {
        if (!config.favoritesEnabled) return;
        try {
            const key = config.favoritesStorageKey;
            const arr = JSON.parse(localStorage.getItem(key) || '[]');
            const items = (arr || []).map(String);
            // 迁移旧格式（纯数字 timestamp → URL）
            if (items.length > 0 && items.every(s => /^\d+$/.test(s))) {
                console.log('[GalleryDisplay] 迁移旧收藏格式, 已清空');
                localStorage.removeItem(key);
                window.__galleryFavorites = new Set();
            } else {
                window.__galleryFavorites = new Set(items);
            }
        } catch (_) {
            window.__galleryFavorites = new Set();
        }
    }

    /* ============================================================
     *  Lightbox 核心逻辑
     * ============================================================ */
    function findRecord(imgUrl) {
        try {
            const allHistory = (window.GalleryList && window.GalleryList.allHistory) || [];
            for (const h of allHistory) {
                if (h.images && h.images.includes(imgUrl)) return h;
            }
        } catch (e) {}
        return null;
    }

    function getAllHistoryImages() {
        const allHistory = (window.GalleryList && window.GalleryList.allHistory) || [];
        const allImages = [];
        allHistory.forEach(h => {
            if (h.images && h.images.length) {
                h.images.forEach(u => { if (u) allImages.push(u); });
            }
        });
        return allImages;
    }

    function refreshFavBtn() {
        const btn = document.getElementById('lightboxFavBtn');
        if (!btn || !lightboxState.currentRecord) return;
        const imgUrl = (lightboxState.currentRecord.images && lightboxState.currentRecord.images[lightboxState.currentIndex]) || '';
        const favSet = window.__galleryFavorites || new Set();
        const isFav = favSet.has(imgUrl);
        btn.innerHTML = isFav ? LB_ACTION_SVGS.favoriteActive : LB_ACTION_SVGS.favorite;
    }

    function refreshThumbnails() {
        const container = document.getElementById('lightboxThumbnails');
        if (!container || lightboxState.images.length <= 1) {
            if (container) container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';
        container.innerHTML = lightboxState.images.map((url, i) =>
            `<div class="lightbox-thumb${i === lightboxState.currentIndex ? ' active' : ''}" data-index="${i}">
                <img src="/api/media-preview?w=96&url=${encodeURIComponent(url)}" alt="缩略图 ${i + 1}" draggable="false">
            </div>`
        ).join('');
        const activeThumb = container.querySelector('.active');
        if (activeThumb) activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

        // 绑定拖动滚动 + 点击切换（只绑一次）
        if (!container._thumbScrollBound) {
            container._thumbScrollBound = true;
            let isDragging = false, hasMoved = false, startX = 0, startScrollLeft = 0;
            const DRAG_THRESHOLD = 5;

            container.addEventListener('wheel', (e) => {
                e.preventDefault();
                container.scrollLeft += e.deltaY * 2;
            }, { passive: false });

            container.addEventListener('mousedown', (e) => {
                isDragging = true;
                hasMoved = false;
                startX = e.pageX;
                startScrollLeft = container.scrollLeft;
                container.style.cursor = 'grabbing';
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                const dx = e.pageX - startX;
                if (Math.abs(dx) > DRAG_THRESHOLD) hasMoved = true;
                if (hasMoved) container.scrollLeft = startScrollLeft - dx;
            });
            document.addEventListener('mouseup', () => {
                if (isDragging) { isDragging = false; container.style.cursor = 'grab'; }
            });
            container.addEventListener('click', (e) => {
                if (hasMoved) return;
                const thumb = e.target.closest('.lightbox-thumb');
                if (thumb) {
                    const index = parseInt(thumb.dataset.index);
                    if (!isNaN(index)) switchImage(index);
                }
            });
        }
    }

    function switchImage(index) {
        if (index >= 0 && index < lightboxState.images.length) {
            lightboxState.currentIndex = index;
            const img = document.getElementById('lightboxImg');
            if (img) img.src = lightboxState.images[index];
            refreshThumbnails();
            if (ImageViewer && typeof ImageViewer.goTo === 'function') {
                ImageViewer.goTo(index);
            }
        }
    }

    /**
     * 打开灯箱
     * 兼容多种签名：
     *   openLightbox(url, prompt)
     *   openLightbox(url, allImages, startIndex, prompt)
     *   openLightbox(url, allImages, startIndex, prompt, allPrompts)
     */
    function openLightbox(url, imagesOrPrompt, startIndexOrPrompt, promptParam, allPrompts) {
        if (!config.lightbox) return;

        const actionsEl = document.getElementById('lightboxActions');

        // 切图后回调
        const onImageChange = (idx, imgUrl, newPrompt) => {
            lightboxState.currentIndex = idx;
            lightboxState.currentRecord = findRecord(imgUrl);
            refreshThumbnails();
            refreshFavBtn();
            // newPrompt 可能是 ImageViewer 传入的 Promise，统一 await 后再存
            Promise.resolve(newPrompt).then(function (v) {
                updatePromptDisplay(typeof v === 'string' ? v : (v && (v.en || v.text || v.prompt)) || '');
            });
        };

        // 确定首图 URL
        const firstImgUrl = Array.isArray(imagesOrPrompt) ? (imagesOrPrompt[startIndexOrPrompt || 0] || url) : url;
        lightboxState.currentRecord = findRecord(firstImgUrl);

        if (actionsEl) actionsEl.style.display = lightboxState.currentRecord ? 'flex' : 'none';
        refreshFavBtn();

        if (Array.isArray(imagesOrPrompt)) {
            // 3/4/5 参版本
            lightboxState.currentPrompt = promptParam || '';
            lightboxState.images = getAllHistoryImages();
            lightboxState.currentIndex = lightboxState.images.indexOf(firstImgUrl);
            if (lightboxState.currentIndex === -1) lightboxState.currentIndex = 0;

            if (lightboxState.images.length > 1) {
                let prompts = [];
                try {
                    const allHistory = (window.GalleryList && window.GalleryList.allHistory) || [];
                    const historyByImage = new Map();
                    allHistory.forEach(h => {
                        if (h.images && h.images.length) {
                            h.images.forEach(u => { if (u) historyByImage.set(u, h); });
                        }
                    });
                    prompts = lightboxState.images.map(imgUrl => {
                        const h = historyByImage.get(imgUrl);
                        return (h && h.prompt) || '';
                    });
                } catch (e) {}
                // 5 参版本 allPrompts 覆写
                if (allPrompts && allPrompts.length === imagesOrPrompt.length) {
                    prompts = allPrompts;
                }
                ImageViewer.init(lightboxState.images, lightboxState.currentIndex, { prompts, onShow: onImageChange });
            } else {
                lightboxState.images = getAllHistoryImages();
                lightboxState.currentIndex = lightboxState.images.indexOf(url);
                if (lightboxState.currentIndex === -1) lightboxState.currentIndex = 0;
                ImageViewer.init(lightboxState.images, lightboxState.currentIndex);
            }
        } else {
            // 2 参版本：openLightbox(image, prompt) — url 也可能是图片数组
            lightboxState.currentPrompt = imagesOrPrompt || '';
            lightboxState.images = getAllHistoryImages();
            lightboxState.currentIndex = lightboxState.images.indexOf(Array.isArray(url) ? url[0] : url);
            if (lightboxState.currentIndex === -1) lightboxState.currentIndex = 0;
            ImageViewer.init(lightboxState.images, lightboxState.currentIndex);
        }

        refreshThumbnails();
        updatePromptDisplay(lightboxState.currentPrompt);
        hidePromptPanel();
    }

    function updatePromptDisplay(prompt) {
        // 仅记录当前提示词，供悬浮面板与复制使用；不再自动显示
        // （点击顶部「提示词」图标按钮 → GalleryDisplay.togglePromptPanel → 通用 PromptPanel 组件）
        lightboxState.currentPrompt = prompt || '';
    }

    /* 显示 / 隐藏 提示词悬浮面板（委托给通用 PromptPanel 组件） */
    function togglePromptPanel() {
        const btn = document.getElementById('lightboxPromptBtn');
        const record = lightboxState.currentRecord;
        // 锚定到图片容器（而非底部工具栏按钮），避免和 "自动/✕/键鼠" 等工具栏按键水平重叠
        const imgBox = document.getElementById('lightboxImgContainer');
        if (global.PromptPanel) {
            // 与缩略图 viewPrompt (actions.js) 保持完全一致
            const text = (record && record.prompt) || '';
            global.PromptPanel.toggle({
                cn: text,
                negative: (record && record.negative_prompt) || '',
                genParams: (record && record.genParams) || null,
                recordMeta: {
                    type: (record && record.type) || undefined,
                    model: (record && record.model) || undefined,
                    seed: (record && record.seed) != null ? record.seed : undefined
                },
                translate: (typeof config.onPromptDisplay === 'function') ? config.onPromptDisplay : null,
                anchor: imgBox || btn || null
            });
        }
        if (btn) btn.classList.toggle('active', global.PromptPanel ? global.PromptPanel.isOpen() : false);
    }

    function hidePromptPanel() {
        if (global.PromptPanel) global.PromptPanel.close();
    }

    function lightboxAction(action) {
        if (!lightboxState.currentRecord) return;
        const record = lightboxState.currentRecord;
        const imgUrl = (record.images && record.images[lightboxState.currentIndex]) || '';
        const ts = record.timestamp;

        switch (action) {
            case 'openFolder':
                if (typeof config.onOpenFolder === 'function') config.onOpenFolder(record);
                else if (window.GalleryActions && GalleryActions.openImageFolder) GalleryActions.openImageFolder(record);
                break;
            case 'download':
                if (window.GalleryActions && GalleryActions.downloadImage) {
                    GalleryActions.downloadImage(imgUrl, String(ts) + '.png');
                }
                break;
            case 'favorite':
                if (window.GalleryActions && GalleryActions.toggleFavorite) {
                    GalleryActions.toggleFavorite(record, null, imgUrl);
                    refreshFavBtn();
                }
                break;
            case 'copyPrompt':
                if (typeof config.onCopyPrompt === 'function') config.onCopyPrompt(record);
                else if (window.GalleryActions && GalleryActions.copyPrompt) GalleryActions.copyPrompt(record);
                break;
            case 'usePrompt':
                if (typeof config.onUsePrompt === 'function') config.onUsePrompt(record);
                else if (window.GalleryActions && GalleryActions.usePrompt) GalleryActions.usePrompt(record);
                break;
            case 'delete':
                if (window.GalleryActions && GalleryActions.deleteHistoryItem) {
                    if (confirm('确认删除这张图片？')) {
                        // 直接执行删除，绕过两步确认
                        const ts = record.timestamp;
                        const historyType = record.type || (window.GALLERY_CONFIG && GALLERY_CONFIG.type) || 'unknown';
                        fetch('/api/history/delete', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ timestamp: ts })
                        }).catch(() => {});
                        const el = document.getElementById('history-' + ts);
                        if (el) el.remove();
                        if (window.GalleryList && Array.isArray(GalleryList.allHistory)) {
                            GalleryList.allHistory = GalleryList.allHistory.filter(h => String(h.timestamp) !== String(ts));
                        }
                        closeLightbox();
                    }
                }
                break;
            case 'prompt':
                togglePromptPanel();
                break;
            case 'close':
                closeLightbox();
                break;
        }
    }

    function closeLightbox() {
        const lb = document.getElementById('lightbox');
        if (lb) lb.classList.add('hidden');
        document.body.style.overflow = '';
        const actionsEl = document.getElementById('lightboxActions');
        if (actionsEl) actionsEl.style.display = 'none';
        hidePromptPanel();
        lightboxState.currentRecord = null;
        setTimeout(() => {
            const img = document.getElementById('lightboxImg');
            if (img) img.src = '';
        }, 300);
    }

    function handleOutsideClick(e) {
        if (e.target.id === 'lightbox') closeLightbox();
    }

    /* ============================================================
     *  Toolbar Extras（缩略图尺寸 / 收藏过滤 / NSFW）
     * ============================================================ */
    function initToolbarExtras() {
        if (!config.toolbarExtras) return;
        if (!window.HistoryBulkManager) return;

        const extraButtons = [];

        // 缩略图尺寸切换
        extraButtons.push({
            id: 'thumb-size',
            label: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="3" width="10" height="10" rx="2"/><rect x="12" y="3" width="3" height="5" rx="1" opacity="0.4"/><rect x="12" y="9" width="3" height="4" rx="1" opacity="0.4"/></svg>',
            title: '切换缩略图尺寸',
            onClick: (btn) => {
                const modes = ['thumb-large', 'thumb-medium', 'thumb-small'];
                const icons = [
                    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="14" height="14" rx="2"/></svg>',
                    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="3" width="10" height="10" rx="2"/><rect x="12" y="3" width="3" height="5" rx="1" opacity="0.4"/><rect x="12" y="9" width="3" height="4" rx="1" opacity="0.4"/></svg>',
                    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="7" y="1" width="5" height="5" rx="1" opacity="0.6"/><rect x="1" y="7" width="5" height="5" rx="1" opacity="0.6"/><rect x="7" y="7" width="5" height="5" rx="1" opacity="0.4"/></svg>'
                ];
                const grid = document.querySelector(config.masonrySelector);
                if (!grid) return;
                const cur = modes.findIndex(m => grid.classList.contains(m));
                const next = (cur + 1) % modes.length;
                modes.forEach(m => grid.classList.remove(m));
                grid.classList.add(modes[next]);
                btn.innerHTML = icons[next];
                btn.title = ['大图', '默认', '小图'][next];
                try { localStorage.setItem('gallery_thumb_size', String(next)); } catch (_) {}
            }
        });

        // 收藏过滤
        if (config.favoritesEnabled) {
            extraButtons.push({
                id: 'fav-toggle',
                label: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><span class="btn-text"> 收藏</span>',
                title: '仅显示已收藏的图',
                onClick: (btn) => {
                    const on = !document.body.classList.contains('fav-mode');
                    document.body.classList.toggle('fav-mode', on);
                    btn.classList.toggle('is-on', on);
                    try { localStorage.setItem('gallery_fav_mode', on ? '1' : '0'); } catch (_) {}
                    if (on) {
                        setTimeout(() => {
                            document.querySelectorAll('.masonry-item[data-fav="1"] img[loading="lazy"]').forEach(img => {
                                if (!img.complete) { const src = img.src; img.src = ''; img.src = src; }
                            });
                        }, 50);
                    }
                }
            });
        }

        // NSFW 按钮（默认开启屏蔽）
        if (config.nsfwEnabled) {
            extraButtons.push({
                id: 'nsfw-toggle',
                label: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg><span class="btn-text"> NSFW</span>',
                title: '不显示 NSFW 相关图片（长按 5 秒切换 NSFW Only 模式）',
                onClick: (btn) => {
                    // 长按触发的 NSFW Only 切换已在 attach 后的 setTimeout 中完成，阻止 click 重复执行
                    if (window.__nsfwLongPressTriggered) {
                        window.__nsfwLongPressTriggered = false;
                        return;
                    }
                    const isOnly = document.body.classList.contains('nsfw-only-mode');
                    if (isOnly) {
                        document.body.classList.remove('nsfw-only-mode');
                        btn.classList.remove('is-only-on');
                        try { localStorage.removeItem('gallery_nsfw_only'); } catch (_) {}
                    }
                    const on = !document.body.classList.contains('nsfw-mode');
                    document.body.classList.toggle('nsfw-mode', on);
                    btn.classList.toggle('is-on', on);
                    try { localStorage.setItem('gallery_nsfw_block', on ? '1' : '0'); } catch (_) {}
                    setTimeout(() => {
                        if (window.GalleryList) { GalleryList.pruneEmptySeparators(); GalleryList.ensureLoadMore(); }
                    }, 50);
                },

            });
        }

        // 业务页自定义按钮
        if (typeof config.onExtraToolbarButtons === 'function') {
            const extra = config.onExtraToolbarButtons();
            if (Array.isArray(extra)) extraButtons.push(...extra);
        }

        window.HistoryBulkManager.attach({
            masonry: config.masonrySelector,
            extraButtons,
            longPressToSelect: config.longPressToSelect
        });

        // NSFW 按钮长按绑定（HistoryBulkManager 不支持 onMount，手动绑）
        setTimeout(() => {
            const nsfwBtn = document.querySelector('[data-extra-btn="nsfw-toggle"]');
            if (!nsfwBtn) return;
            let pressTimer = null;
            let progressEl = null;
            let triggered = false;
            const startPress = () => {
                if (triggered) return;
                triggered = false;
                if (!progressEl) {
                    progressEl = document.createElement('span');
                    progressEl.className = 'nsfw-longpress-progress';
                    nsfwBtn.style.position = 'relative';
                    nsfwBtn.appendChild(progressEl);
                }
                progressEl.classList.add('active');
                nsfwBtn.classList.add('nsfw-pulsing');
                pressTimer = setTimeout(() => {
                    triggered = true;
                    const isOnly = !document.body.classList.contains('nsfw-only-mode');
                    document.body.classList.toggle('nsfw-only-mode', isOnly);
                    nsfwBtn.classList.remove('is-on');
                    if (isOnly) {
                        nsfwBtn.classList.add('is-only-on');
                        document.body.classList.remove('nsfw-mode');
                        try { localStorage.setItem('gallery_nsfw_only', '1'); localStorage.setItem('gallery_nsfw_block', '0'); } catch (_) {}
                    } else {
                        nsfwBtn.classList.remove('is-only-on');
                        try { localStorage.removeItem('gallery_nsfw_only'); } catch (_) {}
                    }
                    if (progressEl) progressEl.classList.remove('active');
                    nsfwBtn.classList.remove('nsfw-pulsing');
                    pressTimer = null;
                    // 标记长按已触发，防止紧随的 click 重复执行
                    window.__nsfwLongPressTriggered = true;
                }, 5000);
            };
            const cancelPress = () => {
                if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
                if (triggered) {
                    triggered = false;
                    // 重新标记确保 mouseup 后的 click 事件能捕获到，500ms 足够覆盖
                    window.__nsfwLongPressTriggered = true;
                    setTimeout(() => {
                        window.__nsfwLongPressTriggered = false;
                        if (window.GalleryList) { GalleryList.pruneEmptySeparators(); GalleryList.ensureLoadMore(); }
                    }, 500);
                    return;
                }
                if (progressEl) progressEl.classList.remove('active');
                nsfwBtn.classList.remove('nsfw-pulsing');
            };
            nsfwBtn.addEventListener('mousedown', startPress);
            nsfwBtn.addEventListener('mouseup', cancelPress);
            nsfwBtn.addEventListener('mouseleave', cancelPress);
            nsfwBtn.addEventListener('touchstart', startPress, { passive: true });
            nsfwBtn.addEventListener('touchend', cancelPress);
            nsfwBtn.addEventListener('touchcancel', cancelPress);
        }, 100);

        // 恢复收藏过滤偏好
        try {
            if (localStorage.getItem('gallery_fav_mode') === '1') {
                document.body.classList.add('fav-mode');
                setTimeout(() => {
                    const btn = document.querySelector('[data-extra-btn="fav-toggle"]');
                    if (btn) btn.classList.add('is-on');
                    document.querySelectorAll('.masonry-item[data-fav="1"] img[loading="lazy"]').forEach(img => {
                        if (!img.complete) { const src = img.src; img.src = ''; img.src = src; }
                    });
                }, 100);
            }
        } catch (_) {}

        // 恢复 NSFW 偏好：首次使用无记录时默认开启屏蔽
        try {
            const nsfwVal = localStorage.getItem('gallery_nsfw_block');
            if (nsfwVal === null || nsfwVal === '1') {
                // 无记录或值为 1 → 开启 nsfw-mode
                document.body.classList.add('nsfw-mode');
                setTimeout(() => {
                    const btn = document.querySelector('[data-extra-btn="nsfw-toggle"]');
                    if (btn) btn.classList.add('is-on');
                }, 0);
            }
            // 恢复 NSFW Only 模式
            if (localStorage.getItem('gallery_nsfw_only') === '1') {
                document.body.classList.add('nsfw-only-mode');
                document.body.classList.remove('nsfw-mode');
                setTimeout(() => {
                    const btn = document.querySelector('[data-extra-btn="nsfw-toggle"]');
                    if (btn) { btn.classList.add('is-only-on'); btn.classList.remove('is-on'); }
                }, 0);
            }
        } catch (_) {}

        // 清除长按触发标记
        window.__nsfwLongPressTriggered = false;

        // 恢复缩略图尺寸偏好
        try {
            const saved = parseInt(localStorage.getItem('gallery_thumb_size')) || 0;
            if (saved >= 0 && saved <= 2) {
                const modes = ['thumb-large', 'thumb-medium', 'thumb-small'];
                const icons = [
                    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="14" height="14" rx="2"/></svg>',
                    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="3" width="10" height="10" rx="2"/><rect x="12" y="3" width="3" height="5" rx="1" opacity="0.4"/><rect x="12" y="9" width="3" height="4" rx="1" opacity="0.4"/></svg>',
                    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="7" y="1" width="5" height="5" rx="1" opacity="0.6"/><rect x="1" y="7" width="5" height="5" rx="1" opacity="0.6"/><rect x="7" y="7" width="5" height="5" rx="1" opacity="0.4"/></svg>'
                ];
                setTimeout(() => {
                    const grid = document.querySelector(config.masonrySelector);
                    const btn = document.querySelector('[data-extra-btn="thumb-size"]');
                    if (grid) grid.classList.add(modes[saved]);
                    if (btn) { btn.innerHTML = icons[saved]; btn.title = ['大图', '默认', '小图'][saved]; }
                }, 0);
            }
        } catch (_) {}
    }

    /* ============================================================
     *  自动扫描新图片（已禁用：pushNewImage 已实时推送，重复 load(0) 导致 UI 卡顿）
     * ============================================================ */
    let _scanTimer = null;

    function startAutoScan() {
        // 页面加载后延迟扫描一次，补上之前未入库的图片（跨 session 的图片）
        setTimeout(() => { scanNewImages(); }, 3000);
        // 之后每 60 秒自动检测一次
        _scanTimer = setInterval(() => { scanNewImages(); }, 60000);
    }

    async function scanNewImages() {
        try {
            const token = localStorage.getItem('xy_auth_token') || '';
            const res = await fetch('/api/gallery/scan-new?type=' + encodeURIComponent(config.historyType || '') + '&token=' + encodeURIComponent(token));
            if (!res.ok) return;
            const data = await res.json();
            if (data.imported > 0) {
                console.log('[GalleryDisplay] 自动导入 ' + data.imported + ' 张新图片');
                // 重新加载历史列表
                if (window.GalleryList) GalleryList.load(0);
            }
        } catch (e) {}
    }

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

        // 3. 渲染 lightbox action 按钮
        if (config.lightbox) renderLightboxActions();

        // 4. 初始化收藏
        initFavorites();

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

        // 7. 初始化工具栏
        initToolbarExtras();

        // 8. 初始化回到顶部
        initScrollToTop();

        // 9. 加载历史
        if (window.GalleryList) GalleryList.load(0);

        // 10. 自动扫描新图片（每 30 秒检测一次）
        if (config.autoScan !== false) {
            startAutoScan();
        }

        // 11. 挂载 HistoryBulkManager
        if (window.HistoryBulkManager) {
            window.HistoryBulkManager.attach({ masonry: config.masonrySelector, longPressToSelect: config.longPressToSelect });
        }

        // 11. 刷新图标
        if (window.lucide && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }

        // 11.5 [Task 1 迁移] 初始化 NSFW Filter 模块（并存期：原代码仍生效）
        if (config.nsfwEnabled && window.GalleryDisplay?.NsfwFilter) {
            window.GalleryDisplay.NsfwFilter.init({ autoRestore: true });
        }
    }

    /* ============================================================
     *  暴露全局
     * ============================================================ */
    global.GalleryDisplay = {
        init,
        openLightbox,
        closeLightbox,
        handleOutsideClick,
        lightboxAction,
        togglePromptPanel,
        refreshFavBtn,
        refreshThumbnails,
        scrollToTop,
        switchImage,
        scanNewImages,
    };

    // 兼容旧代码：window.openLightbox = GalleryDisplay.openLightbox
    Object.defineProperty(global, 'openLightbox', {
        get() { return global.GalleryDisplay.openLightbox; },
        set(fn) { global.GalleryDisplay.openLightbox = fn; },
        configurable: true,
    });

})(window);
