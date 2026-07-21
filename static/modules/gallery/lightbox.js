/*!
 * Lightbox - 灯箱（大图预览、提示词、收藏、动作）
 * 依赖: ImageViewer, GalleryActions, GalleryList, PromptPanel
 * 用法: Lightbox.init({ config, onOpenFolder, onCopyPrompt, onUsePrompt, onPromptDisplay, container })
 */
(function (global) {
    'use strict';
    const NS = global.GalleryDisplay = global.GalleryDisplay || {};
    const Base = NS.Base;
    if (!Base) { console.error('[Lightbox] 缺少 GalleryDisplay.Base'); return; }

    /* ============================================================
     *  状态
     * ============================================================ */
    const state = {
        images: [],
        currentIndex: 0,
        currentRecord: null,
        currentPrompt: '',
    };

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

    let _config = {};
    let _initialized = false;

    /* ============================================================
     *  Helpers
     * ============================================================ */
    function findRecord(imgUrl) {
        try {
            const allHistory = (global.GalleryList && global.GalleryList.allHistory) || [];
            for (const h of allHistory) {
                if (h.images && h.images.includes(imgUrl)) return h;
            }
        } catch (e) {}
        return null;
    }

    function getAllHistoryImages() {
        const allHistory = (global.GalleryList && global.GalleryList.allHistory) || [];
        const allImages = [];
        allHistory.forEach(h => {
            if (h.images && h.images.length) {
                h.images.forEach(u => { if (u) allImages.push(u); });
            }
        });
        return allImages;
    }

    /* ============================================================
     *  HTML / Actions 注入
     * ============================================================ */
    function injectHTML() {
        if (_config.lightbox && !document.getElementById('lightbox')) {
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
            renderLightboxActions();
        }
    }

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
     *  Refresh / Switch
     * ============================================================ */
    function refreshFavBtn() {
        const btn = document.getElementById('lightboxFavBtn');
        if (!btn || !state.currentRecord) return;
        const imgUrl = (state.currentRecord.images && state.currentRecord.images[state.currentIndex]) || '';
        const favSet = global.__galleryFavorites || new Set();
        const isFav = favSet.has(imgUrl);
        btn.innerHTML = isFav ? LB_ACTION_SVGS.favoriteActive : LB_ACTION_SVGS.favorite;
    }

    function refreshThumbnails() {
        const container = document.getElementById('lightboxThumbnails');
        if (!container || state.images.length <= 1) {
            if (container) container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';
        container.innerHTML = state.images.map((url, i) =>
            `<div class="lightbox-thumb${i === state.currentIndex ? ' active' : ''}" data-index="${i}">
                <img src="/api/media-preview?w=96&url=${encodeURIComponent(url)}" alt="缩略图 ${i + 1}" draggable="false">
            </div>`
        ).join('');
        const activeThumb = container.querySelector('.active');
        if (activeThumb) activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

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
        if (index >= 0 && index < state.images.length) {
            state.currentIndex = index;
            const img = document.getElementById('lightboxImg');
            if (img) img.src = state.images[index];
            refreshThumbnails();
            if (global.ImageViewer && typeof global.ImageViewer.goTo === 'function') {
                global.ImageViewer.goTo(index);
            }
        }
    }

    /* ============================================================
     *  Open / Close
     * ============================================================ */
    function openLightbox(url, imagesOrPrompt, startIndexOrPrompt, promptParam, allPrompts) {
        if (!_config.lightbox) return;

        const actionsEl = document.getElementById('lightboxActions');

        const onImageChange = (idx, imgUrl, newPrompt) => {
            state.currentIndex = idx;
            state.currentRecord = findRecord(imgUrl);
            refreshThumbnails();
            refreshFavBtn();
            Promise.resolve(newPrompt).then(function (v) {
                updatePromptDisplay(typeof v === 'string' ? v : (v && (v.en || v.text || v.prompt)) || '');
            });
        };

        const firstImgUrl = Array.isArray(imagesOrPrompt) ? (imagesOrPrompt[startIndexOrPrompt || 0] || url) : url;
        state.currentRecord = findRecord(firstImgUrl);

        if (actionsEl) actionsEl.style.display = state.currentRecord ? 'flex' : 'none';
        refreshFavBtn();

        if (Array.isArray(imagesOrPrompt)) {
            state.currentPrompt = promptParam || '';
            state.images = getAllHistoryImages();
            state.currentIndex = state.images.indexOf(firstImgUrl);
            if (state.currentIndex === -1) state.currentIndex = 0;

            if (state.images.length > 1) {
                let prompts = [];
                try {
                    const allHistory = (global.GalleryList && global.GalleryList.allHistory) || [];
                    const historyByImage = new Map();
                    allHistory.forEach(h => {
                        if (h.images && h.images.length) {
                            h.images.forEach(u => { if (u) historyByImage.set(u, h); });
                        }
                    });
                    prompts = state.images.map(imgUrl => {
                        const h = historyByImage.get(imgUrl);
                        return (h && h.prompt) || '';
                    });
                } catch (e) {}
                if (allPrompts && allPrompts.length === imagesOrPrompt.length) {
                    prompts = allPrompts;
                }
                global.ImageViewer.init(state.images, state.currentIndex, { prompts, onShow: onImageChange });
            } else {
                state.images = getAllHistoryImages();
                state.currentIndex = state.images.indexOf(url);
                if (state.currentIndex === -1) state.currentIndex = 0;
                global.ImageViewer.init(state.images, state.currentIndex);
            }
        } else {
            state.currentPrompt = imagesOrPrompt || '';
            state.images = getAllHistoryImages();
            state.currentIndex = state.images.indexOf(Array.isArray(url) ? url[0] : url);
            if (state.currentIndex === -1) state.currentIndex = 0;
            global.ImageViewer.init(state.images, state.currentIndex);
        }

        refreshThumbnails();
        updatePromptDisplay(state.currentPrompt);
        hidePromptPanel();
    }

    function closeLightbox() {
        const lb = document.getElementById('lightbox');
        if (lb) lb.classList.add('hidden');
        document.body.style.overflow = '';
        const actionsEl = document.getElementById('lightboxActions');
        if (actionsEl) actionsEl.style.display = 'none';
        hidePromptPanel();
        state.currentRecord = null;
        setTimeout(() => {
            const img = document.getElementById('lightboxImg');
            if (img) img.src = '';
        }, 300);
    }

    function handleOutsideClick(e) {
        if (e.target.id === 'lightbox') closeLightbox();
    }

    /* ============================================================
     *  Prompt Panel / Action
     * ============================================================ */
    function updatePromptDisplay(prompt) {
        state.currentPrompt = prompt || '';
    }

    function togglePromptPanel() {
        const btn = document.getElementById('lightboxPromptBtn');
        const record = state.currentRecord;
        const imgBox = document.getElementById('lightboxImgContainer');
        if (global.PromptPanel) {
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
                translate: (typeof _config.onPromptDisplay === 'function') ? _config.onPromptDisplay : null,
                anchor: imgBox || btn || null
            });
        }
        if (btn) btn.classList.toggle('active', global.PromptPanel ? global.PromptPanel.isOpen() : false);
    }

    function hidePromptPanel() {
        if (global.PromptPanel) global.PromptPanel.close();
    }

    function lightboxAction(action) {
        if (!state.currentRecord) return;
        const record = state.currentRecord;
        const imgUrl = (record.images && record.images[state.currentIndex]) || '';
        const ts = record.timestamp;

        switch (action) {
            case 'openFolder':
                if (typeof _config.onOpenFolder === 'function') _config.onOpenFolder(record);
                else if (global.GalleryActions && GalleryActions.openImageFolder) GalleryActions.openImageFolder(record);
                break;
            case 'download':
                if (global.GalleryActions && GalleryActions.downloadImage) {
                    GalleryActions.downloadImage(imgUrl, String(ts) + '.png');
                }
                break;
            case 'favorite':
                if (global.GalleryActions && GalleryActions.toggleFavorite) {
                    GalleryActions.toggleFavorite(record, null, imgUrl);
                    refreshFavBtn();
                }
                break;
            case 'copyPrompt':
                if (typeof _config.onCopyPrompt === 'function') _config.onCopyPrompt(record);
                else if (global.GalleryActions && GalleryActions.copyPrompt) GalleryActions.copyPrompt(record);
                break;
            case 'usePrompt':
                if (typeof _config.onUsePrompt === 'function') _config.onUsePrompt(record);
                else if (global.GalleryActions && GalleryActions.usePrompt) GalleryActions.usePrompt(record);
                break;
            case 'delete':
                if (global.GalleryActions && GalleryActions.deleteHistoryItem) {
                    if (confirm('确认删除这张图片？')) {
                        const ts2 = record.timestamp;
                        const historyType = record.type || (global.GALLERY_CONFIG && GALLERY_CONFIG.type) || 'unknown';
                        fetch('/api/history/delete', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ timestamp: ts2 })
                        }).catch(() => {});
                        const el = document.getElementById('history-' + ts2);
                        if (el) el.remove();
                        if (global.GalleryList && Array.isArray(GalleryList.allHistory)) {
                            GalleryList.allHistory = GalleryList.allHistory.filter(h => String(h.timestamp) !== String(ts2));
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

    /* ============================================================
     *  Init / Self-Tests
     * ============================================================ */
    function init(config = {}) {
        if (_initialized) return;
        _config = config || {};
        _initialized = true;
        if (!_config || !_config.skipSelfTest) _runSelfTests();
    }

    function destroy() { _initialized = false; _config = {}; }

    function _runSelfTests() {
        Base.Test.suite('Lightbox', [
            ['模块已挂载到 GalleryDisplay', () => NS.Lightbox && typeof NS.Lightbox.openLightbox === 'function'],
            ['state 已初始化', () => Array.isArray(state.images) && state.currentIndex === 0 && state.currentRecord === null],
            ['LB_ACTION_SVGS 至少 8 个图标（含 favorite/favoriteActive）', () => Object.keys(LB_ACTION_SVGS).length >= 8],
            ['findRecord 在空历史下返回 null', () => {
                const orig = global.GalleryList;
                global.GalleryList = { allHistory: [] };
                const r = findRecord('http://example.com/x.png');
                global.GalleryList = orig;
                return r === null;
            }],
            ['getAllHistoryImages 平铺 images', () => {
                const orig = global.GalleryList;
                global.GalleryList = { allHistory: [
                    { images: ['a', 'b'] },
                    { images: [] },
                    { images: ['c'] },
                ]};
                const r = getAllHistoryImages();
                global.GalleryList = orig;
                return r.length === 3 && r[0] === 'a' && r[1] === 'b' && r[2] === 'c';
            }],
            ['switchImage 越界不抛错', () => {
                state.images = ['a'];
                state.currentIndex = 0;
                let threw = false;
                try { switchImage(99); switchImage(-1); } catch (e) { threw = true; }
                return threw === false && state.currentIndex === 0;
            }],
        ]);
    }

    /* ============================================================
     *  Public API
     * ============================================================ */
    NS.Lightbox = {
        init,
        destroy,
        injectHTML,
        renderLightboxActions,
        findRecord,
        getAllHistoryImages,
        refreshFavBtn,
        refreshThumbnails,
        switchImage,
        openLightbox,
        closeLightbox,
        handleOutsideClick,
        lightboxAction,
        togglePromptPanel,
        hidePromptPanel,
        updatePromptDisplay,
        // expose for tests
        _state: state,
    };
})(window);
