/*!
 * GalleryCard - 统一的缩略图卡片渲染
 * 一个函数搞定所有功能的缩略图，按 features 配置显示对应按钮
 */
(function (global) {
    'use strict';

    // 一次性注入缩略图「查看提示词」按钮样式：默认隐藏，悬停卡片时由 JS 加 .show 显示。
    // 关键：全部用注入的全局 CSS（非 Tailwind 动态 class），避免预构建 tailwind.min.css 不编译动态类。
    (function ensureCardCSS() {
        if (document.getElementById('gallery-card-style')) return;
        const style = document.createElement('style');
        style.id = 'gallery-card-style';
        style.textContent = [
            '.gallery-vpfab{opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease;cursor:pointer;}',
            '.gallery-vpfab.show{opacity:1;pointer-events:auto;}',
            '.gallery-vpfab:hover{transform:scale(1.12)}',
            '.gallery-vpfab:active{transform:scale(0.9)}',
            // [Bugfix] 恢复原行为：hover 卡片才显示（opacity:0 → .show 时 1）
            // cursor-zoom-in 放在按钮自身上，鼠标移到按钮上才变放大镜 cursor，
            // 之前 card 整体 cursor-zoom-in 会让鼠标在卡片任意位置都变放大镜
            '.gallery-magnify{opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease;cursor:zoom-in;}',
            '.gallery-magnify.show{opacity:1;pointer-events:auto;}',
            '.gallery-magnify:hover{transform:scale(1.12)}',
            '.gallery-magnify:active{transform:scale(0.9)}',
            '.gallery-fav{opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease;cursor:pointer;}',
            '.gallery-fav.show{opacity:1;pointer-events:auto;}',
            '.gallery-fav:hover{transform:scale(1.12)}',
            '.gallery-fav:active{transform:scale(0.9)}',
            // [Bugfix] 整个星形金黄：fill 金黄 + 当前色继承保持原细描边（不另加粗轮廓）
            '.gallery-fav.is-fav{opacity:1!important;pointer-events:auto!important;color:#fbbf24;fill:#fbbf24;filter:drop-shadow(0 0 6px rgba(251,191,36,.55))!important;}',
            '.gallery-fav.is-fav svg{fill:#fbbf24!important;stroke:#fbbf24!important;}',
            '.masonry-item.gallery-selected{outline:3px solid #38bdf8;outline-offset:-3px;border-radius:8px;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(style);
    })();

    // 用于 onclick="..." 属性中双引号转义
    var escAttr = function(v) { return String(v).replace(/"/g, '&quot;'); };

    // 收藏按钮 22x22 星星 SVG
    // 注意：无论是否已收藏，统一使用空心 SVG；CSS 通过 .is-fav 切换填充
    var FAV_OUT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

    /**
     * 收藏切换（统一入口 GalleryDisplay.Favorites.toggle）
     * 保留 window.toggleFav 是为了与历史 inline onclick 兼容，
     * 实际逻辑已迁移到 Favorites 模块，UI 同步由 fav:changed 事件驱动。
     */
    function toggleFav(record, event, imgUrl) {
        if (event) event.stopPropagation();
        const url = imgUrl || (record && record.images && record.images[0]) || '';
        if (!url) return;
        if (window.GalleryDisplay && GalleryDisplay.Favorites) {
            GalleryDisplay.Favorites.toggle(url);
        } else {
            // 兜底：模块未加载时使用旧逻辑（理论上不会发生）
            const set = (global.__galleryFavorites = global.__galleryFavorites || new Set());
            const added = !set.has(url);
            if (added) set.add(url); else set.delete(url);
        }
    }
    if (!global.toggleFav) global.toggleFav = toggleFav;

    // SVG 图标模板
    const ICONS = {
        folder: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        trash: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
        download: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
        copy: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        refresh: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
        star: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        starOutline: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        clipboard: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>',
        pencilLine: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
        check: '<svg class="check-icon w-4 h-4 text-cyan-500" style="display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        imageFallback: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>',
        info: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    // 按钮配置表：feature → {icon, title, className, action, primary}
    const BUTTON_CONFIG = {
        openFolder: { icon: 'folder', title: '打开文件夹', className: 'hover:bg-blue-600 hover:text-white', action: 'openImageFolder' },
        download:   { icon: 'download', title: '下载图片',   className: 'hover:bg-green-600 hover:text-white', action: 'downloadImage' },
        copyToCanvas:{ icon: 'copy',    title: '复制到画布', className: 'hover:bg-purple-600 hover:text-white', action: 'copyToCanvas' },
        favorite:  { icon: 'star',   title: '收藏',       className: 'hover:bg-amber-400 hover:text-white', action: 'toggleFavorite' },
        copyPrompt:  { icon: 'clipboard', title: '复制提示词',  className: 'hover:bg-cyan-600 hover:text-white', action: 'copyPrompt' },
        viewPrompt: { icon: 'info', title: '查看提示词', className: 'hover:bg-violet-600 hover:text-white', action: 'viewPrompt' },
        usePrompt:   { icon: 'pencilLine', title: '把这条提示词载入到输入框', className: 'hover:bg-indigo-600 hover:text-white', action: 'usePrompt' },
        regenerate: { icon: 'refresh', title: '重新生成',   className: 'hover:bg-amber-500 hover:text-white', action: 'regenerate' },
        delete:     { icon: 'trash',   title: '删除',       className: 'hover:bg-black hover:text-white',     action: 'deleteHistoryItem' }
    };

    /**
     * 默认 features（全开）
     * 业务页可通过 GALLERY_CONFIG.features 关闭
     */
    const DEFAULT_FEATURES = {
        delete: true,
        openFolder: true,
        download: true,
        copyToCanvas: false,    // 默认关闭，需要业务页 onCopyToCanvas 回调
        regenerate: false,      // 默认关闭，需要业务页 onRegenerate 回调
        batchSelect: false,     // 默认关闭（rmbg 启用）
        contextMenu: true,
        imageFallback: true,
        modelBadge: null,       // 左上角徽标 URL
        viewPrompt: true,        // 缩略图「查看提示词」按钮（默认开启，点击弹出通用 PromptPanel）
        viewFullImage: true      // 左上角「查看大图」放大镜按钮（默认开启；点击图片切换选中态，点击此按钮才打开 lightbox）
    };

    /**
     * 渲染一张缩略图卡片
     * @param {Object} opts
     *   - container: '#masonry'
     *   - record: { timestamp, prompt, images: [url], type, model, ... }
     *   - isNew: boolean （新生成的插顶部）
     *   - features: { delete, openFolder, download, copyToCanvas, regenerate, batchSelect, contextMenu, imageFallback, modelBadge }
     *   - historyType: 'zimage'  // 备用，从 GALLERY_CONFIG.type 取
     */
    function render(opts) {
        const { container, record, isNew = false } = opts;
        if (!record || !record.timestamp || !record.images || !record.images[0]) return null;
        if (document.getElementById(`history-${record.timestamp}`)) return null; // 防重

        // [Task 5 收敛] 优先 NS.Config
        const cfg = (window.GalleryDisplay && window.GalleryDisplay.Config) || {};
        const features = Object.assign({}, DEFAULT_FEATURES, cfg.features || {}, opts.features || {});
        const historyType = opts.historyType || cfg.type || record.type || 'unknown';

        const containerEl = typeof container === 'string' ? document.querySelector(container) : container;
        if (!containerEl) return null;

        const card = document.createElement('div');
        card.id = `history-${record.timestamp}`;
        card.dataset.historyTs = record.timestamp;
        card.dataset.historyType = historyType;
        card.className = 'masonry-item group animate-in fade-in duration-300';

        // 提取打开 lightbox 的逻辑为独立函数，供放大按键和内部使用
        function openLightboxForRecord(r) {
            if (typeof global.openLightbox !== 'function') return;
            const prompt = r.prompt || '';
            if (global.openLightbox.length >= 4) {
                const allHistory = (global.GalleryList && global.GalleryList.allHistory) || [r];
                const allImages = [];
                const allPrompts = [];
                for (const item of allHistory) {
                    const imgs = (item.images || []).filter(Boolean);
                    for (const u of imgs) {
                        allImages.push(u);
                        allPrompts.push(item.prompt || '');
                    }
                }
                const historyIndex = allHistory.findIndex(item => item.timestamp === r.timestamp);
                let startIndex = 0;
                for (let i = 0; i < historyIndex; i++) {
                    startIndex += ((allHistory[i].images || []).filter(Boolean)).length;
                }
                if (global.openLightbox.length >= 5) {
                    global.openLightbox(r.images[0], allImages, startIndex, prompt, allPrompts);
                } else {
                    global.openLightbox(r.images[0], allImages, startIndex, prompt);
                }
            } else if (global.openLightbox.length >= 3) {
                const allHistory = (global.GalleryList && global.GalleryList.allHistory) || [r];
                const allImages = [];
                for (const item of allHistory) {
                    const imgs = (item.images || []).filter(Boolean);
                    for (const u of imgs) allImages.push(u);
                }
                const historyIndex = allHistory.findIndex(item => item.timestamp === r.timestamp);
                let startIndex = 0;
                for (let i = 0; i < historyIndex; i++) {
                    startIndex += ((allHistory[i].images || []).filter(Boolean)).length;
                }
                global.openLightbox(r.images[0], allImages, startIndex, prompt);
            } else {
                if ((r.images || []).length > 1) {
                    global.openLightbox(r.images, prompt);
                } else {
                    global.openLightbox(r.images[0], prompt);
                }
            }
        }
        // 暴露到全局，供 HTML onclick 调用
        if (!global.openLightboxForRecord) global.openLightboxForRecord = openLightboxForRecord;

        // 单击卡片：切换选中态（视觉高亮），不再直接打开大图
        card.onclick = (e) => {
            if (document.body.classList.contains('history-bulk-selecting')) return;
            if (document.body.classList.contains('nsfw-mode') && card.dataset.nsfw === '1') return;
            if (e.target.closest('button') || e.target.closest('.batch-checkbox')) return;
            card.classList.toggle('gallery-selected');
        };

        // 收藏状态标记（按图片 URL，支持多图组中只收藏某几张）
        const favSet = global.__galleryFavorites || new Set();
        const images = (record.images || []).filter(Boolean);
        const anyFav = images.some(u => favSet.has(u));
        card.dataset.fav = anyFav ? '1' : '0';
        // 标记首图 url，便于全局 fav:changed 事件同步
        card.dataset.favUrl = images[0] || '';
        // 每张子图的收藏状态
        card.dataset.favImages = JSON.stringify(images.map(u => favSet.has(u) ? 1 : 0));

        // 三个悬浮按钮统一样式（透明底 + 白色图标 + drop-shadow 深色光晕），hover 显示
        // 统一内联模板：position:absolute;z-index:20;width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:#fff;cursor:pointer;filter:drop-shadow(0 0 5px rgba(0,0,0,.85)) drop-shadow(0 3px 8px rgba(0,0,0,.95))
        const BTN_INLINE = 'position:absolute;z-index:20;width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:#fff;cursor:pointer;filter:drop-shadow(0 0 5px rgba(0,0,0,.85)) drop-shadow(0 3px 8px rgba(0,0,0,.95));';
        const SVG_22 = ' xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"';

        // ① 左上角 — 查看大图（放大镜）
        const magHandler = `openLightboxForRecord(${JSON.stringify(record).replace(/"/g, '&quot;')})`;
        const magnifyHTML = features.viewFullImage
            ? `<button onclick="${magHandler}" class="gallery-magnify" title="查看大图" aria-label="查看大图" style="left:12px;top:12px;${BTN_INLINE}"><svg${SVG_22}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>`
            : '';

        // ② 右上角 — 收藏（统一透明+drop-shadow 样式，hover 显示）
        const favImgUrl = (record.images && record.images[0]) || '';
        const favHandler = `toggleFav(${escAttr(JSON.stringify(record))}, event, ${escAttr(JSON.stringify(favImgUrl))})`;
        // SVG 统一使用空心，CSS 通过 .is-fav 切换填充
        const favHTML = features.favorite
            ? `<button onclick="${favHandler}" data-fav-url="${escAttr(favImgUrl)}" class="gallery-fav${anyFav ? ' is-fav' : ''}" title="收藏" aria-label="收藏" style="right:12px;top:12px;${BTN_INLINE}">${FAV_OUT_SVG}</button>`
            : '';

        // ③ 左下角 — 查看提示词（感叹号）
        const vpHandler = `GalleryActions.viewPrompt(${JSON.stringify(record).replace(/"/g, '&quot;')}, event)`;
        const viewPromptHTML = features.viewPrompt
            ? `<button onclick="${vpHandler}" class="gallery-vpfab" title="查看提示词" aria-label="查看提示词" style="left:12px;bottom:12px;${BTN_INLINE}"><svg${SVG_22}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></button>`
            : '';

        // 徽标：右下角 model 名称（悬停显示）
        let badgeHTML = '';
        if (features.modelBadge === 'auto') {
            let badgeText = record.model;
            // 如果没有model字段，从图片URL路径提取
            if (!badgeText && record.images && record.images[0]) {
                const url = record.images[0];
                // 尝试从路径中提取：/output/xxx/xxx/xxx.png
                const pathMatch = url.match(/\/output\/[^/]+\/([^/]+)(?:\/|$)/);
                if (pathMatch) {
                    badgeText = pathMatch[1].toUpperCase();
                } else {
                    // 备选：取路径中倒数第二个文件夹名
                    const parts = url.split('/').filter(Boolean);
                    if (parts.length >= 2) {
                        badgeText = parts[parts.length - 2].toUpperCase();
                    }
                }
            }
            if (badgeText) {
                // [Bugfix] 改用内联 style + .model-badge 已有 CSS，不再依赖 Tailwind 预编译类
                // 旧的 `bg-black/60 backdrop-blur text-[9px]` 是 Tailwind v3 类，
                // 预编译的 tailwind.min.css 不一定包含，导致徽标透明看不见。
                badgeHTML = `<div class="model-badge" style="position:absolute;bottom:12px;right:12px;z-index:10;padding:4px 8px;background:rgba(0,0,0,0.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-radius:8px;font-size:10px;line-height:1;font-weight:700;color:#fff;letter-spacing:.04em;">${escapeHTML(badgeText)}</div>`;
            }
        } else if (typeof features.modelBadge === 'string' && features.modelBadge) {
            badgeHTML = `<div class="model-badge absolute bottom-3 right-3 z-10"><img src="${features.modelBadge}" class="h-4 w-auto object-contain bg-white/90 rounded-full p-0.5 shadow-sm"></div>`;
        }

        // 批量勾选框
        const batchHTML = features.batchSelect ? `
            <div onclick="GalleryList && GalleryList.toggleItemSelection('${record.timestamp}', event)" class="batch-checkbox absolute top-3 right-3 z-20 w-7 h-7 rounded-lg bg-white/90 backdrop-blur border-2 border-gray-300 flex items-center justify-center cursor-pointer hover:border-cyan-400 transition-all" style="display:none">
                ${ICONS.check}
            </div>` : '';

        // NSFW 检测 + 角标
        const nsfwFlag = isNsfwPrompt(record.prompt || record.text || '');
        card.dataset.nsfw = nsfwFlag ? '1' : '0';
        const nsfwBadge = nsfwFlag ? '<div class="nsfw-badge" title="检测到 NSFW 提示词">NSFW</div>' : '';

        // 图片加载失败兜底
        const fallbackHTML = features.imageFallback ? `
            <div class="img-fallback absolute inset-0 flex flex-col items-center justify-center text-gray-400 dark:text-gray-600" style="display:none">
                ${ICONS.imageFallback}
                <span class="text-[10px] font-bold mt-1.5">图片已删除</span>
            </div>` : '';

        const onerror = `this.onerror=null;this.closest('.masonry-item')?.remove()`;

        // 新生成（prepend）首图：禁用懒加载 + 高优先级，避免 Edge 的 placeholder 替换
        const eager = !!opts.eagerFirstImage;

        card.innerHTML = `
            ${buildImagesHTML(record, features, onerror, { eagerFirstImage: eager })}
            ${fallbackHTML}
            ${badgeHTML}
            ${viewPromptHTML}
            ${magnifyHTML}
            ${favHTML}
            ${batchHTML}
            ${nsfwBadge}
            `;

        // 右键菜单
        if (features.contextMenu) {
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (global.GalleryContextMenu && typeof global.GalleryContextMenu.show === 'function') {
                    global.GalleryContextMenu.show(e.clientX, e.clientY, record, features);
                }
            });
        }

        // Hover 预取原图：用户把鼠标移到缩略图上时就开始拉原图，
        // 点开大图时原图已进浏览器缓存，秒显。{once:true} 每个卡片只触发一次。
        if (images.length > 0) {
            card.addEventListener('mouseenter', () => {
                images.forEach(u => {
                    if (!u) return;
                    const pre = new Image();
                    pre.src = u;
                });
            }, { once: true, passive: true });
        }
        // 悬停卡片显示悬浮按钮（每次进入都触发，非 once）
        card.addEventListener('mouseenter', () => {
            card.querySelectorAll('.gallery-vpfab, .gallery-magnify, .gallery-fav').forEach(el => el.classList.add('show'));
        }, { passive: true });
        // 鼠标离开卡片时隐藏按钮
        card.addEventListener('mouseleave', () => {
            card.querySelectorAll('.gallery-vpfab, .gallery-magnify, .gallery-fav').forEach(el => el.classList.remove('show'));
        }, { passive: true });

        if (isNew) containerEl.prepend(card);
        else containerEl.appendChild(card);

        // 强制瀑布流重新布局
        if (isNew && containerEl) {
            // 使用 requestAnimationFrame 延迟触发
            requestAnimationFrame(() => {
                // 隐藏再显示，强制重新计算布局
                containerEl.style.visibility = 'hidden';
                containerEl.offsetHeight;
                containerEl.style.visibility = '';
                // 如果有图片，等待图片加载后再触发一次
                const imgs = card.querySelectorAll('img');
                if (imgs.length) {
                    let loaded = 0;
                    const checkDone = () => {
                        loaded++;
                        if (loaded >= imgs.length) {
                            containerEl.style.visibility = 'hidden';
                            containerEl.offsetHeight;
                            containerEl.style.visibility = '';
                        }
                    };
                    imgs.forEach(img => {
                        if (img.complete) checkDone();
                        else {
                            img.onload = checkDone;
                            img.onerror = checkDone;
                        }
                    });
                }
            });
        }
        return card;
    }

    /**
     * 渲染卡片内的图片区。
     * - 1 张：全幅 cover
     * - 2 张：上下两半
     * - 3 张：上 1 + 下 2
     * - 4 张：2x2 拼图
     * - 5+ 张：2x2 拼图 + 最后一张叠加 "+N"
     */
    /** 单张图片收藏星标按钮 HTML — 已废弃，改用统一的 favOldHTML 单按钮，禁用子图收藏按钮避免重叠 */
    function imgFavBtnHTML(url, isFav) {
        return '';
    }

    /**
     * 渲染卡片内的图片区。
     * - 1 张：全幅 cover
     * - 2 张：上下两半
     * - 3 张：上 1 + 下 2
     * - 4 张：2x2 拼图
     * - 5+ 张：2x2 拼图 + 最后一张叠加 "+N"
     */
    function buildImagesHTML(record, features, onerror, opts) {
        opts = opts || {};
        const eager = !!opts.eagerFirstImage;
        // eager 时首图用 loading="eager" fetchpriority="high"（避免 Edge lazy placeholder 替换）
        // 其它图仍 lazy
        const ldAttr = eager ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"';
        const imgs = (record.images || []).filter(Boolean);
        const favSet = global.__galleryFavorites || new Set();
        if (imgs.length <= 1) {
            const src = thumbUrl(imgs[0] || '', 768);
            const favBtn = features.favorite ? imgFavBtnHTML(imgs[0] || '', favSet.has(imgs[0] || '')) : '';
            return '<div class="relative group"><img src="' + src + '" data-original-src="' + (imgs[0] || '') + '" class="w-full"' + ldAttr + ' onerror="' + onerror + '" style="display:block; object-fit:contain;">' + favBtn + '</div>';
        }
        // 多图：使用flex布局，自适应高度
        if (imgs.length === 2) {
            return '<div class="flex gap-0.5" style="height:auto;">' + imgs.slice(0, 2).map(function(u, i) {
                const attr = (eager && i === 0) ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"';
                return '<div class="flex-1 relative overflow-hidden group" style="background:#f5f5f5;"><img src="' + thumbUrl(u, 600) + '" data-original-src="' + u + '" class="w-full h-full"' + attr + ' onerror="' + onerror + '" style="display:block; object-fit:contain;">' + (features.favorite ? imgFavBtnHTML(u, favSet.has(u)) : '') + '</div>';
            }).join('') + '</div>';
        } else if (imgs.length === 3) {
            return '<div class="flex flex-col gap-0.5" style="height:auto;">' +
                '<div class="relative overflow-hidden group" style="background:#f5f5f5;"><img src="' + thumbUrl(imgs[0], 768) + '" data-original-src="' + imgs[0] + '" class="w-full"' + ldAttr + ' onerror="' + onerror + '" style="display:block; object-fit:contain;">' + (features.favorite ? imgFavBtnHTML(imgs[0], favSet.has(imgs[0])) : '') + '</div>' +
                '<div class="flex gap-0.5">' + imgs.slice(1, 3).map(function(u) {
                    return '<div class="flex-1 relative overflow-hidden group" style="background:#f5f5f5;"><img src="' + thumbUrl(u, 600) + '" data-original-src="' + u + '" class="w-full h-full" loading="lazy" onerror="' + onerror + '" style="display:block; object-fit:contain;">' + (features.favorite ? imgFavBtnHTML(u, favSet.has(u)) : '') + '</div>';
                }).join('') + '</div>' +
            '</div>';
        } else {
            var cells = imgs.slice(0, 4).map(function(u, i) {
                var isLast = (i === 3 && imgs.length > 4);
                var overlay = isLast
                    ? '<div class="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-2xl font-bold pointer-events-none">+' + (imgs.length - 4) + '</div>'
                    : '';
                const attr = (eager && i === 0) ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"';
                return '<div class="relative overflow-hidden group" style="background:#f5f5f5;"><img src="' + thumbUrl(u, 600) + '" data-original-src="' + u + '" class="w-full"' + attr + ' onerror="' + onerror + '" style="display:block; object-fit:contain;">' + overlay + (features.favorite ? imgFavBtnHTML(u, favSet.has(u)) : '') + '</div>';
            }).join('');
            return '<div class="grid grid-cols-2 gap-0.5" style="height:auto;">' + cells + '</div>';
        }
    }

    function buttonHTML(featureKey, record, extra) {
        const cfg = BUTTON_CONFIG[featureKey];
        if (!cfg) return '';
        const ts = record.timestamp;
        const imgUrl = (record.images && record.images[0]) || '';
        // 把双引号转成 &quot;，避免在 onclick="..." 内提前关闭属性
        const q = (v) => String(v).replace(/"/g, '&quot;');
        // download 走 (imageUrl, filename, event) 三参；其余 action 传完整 record
        let handlerCall;
        if (cfg.action === 'downloadImage') {
            handlerCall = `GalleryActions.${cfg.action}(${q(JSON.stringify(imgUrl))}, ${q(JSON.stringify(String(ts) + '.png'))}, event)`;
        } else if (cfg.action === 'toggleFavorite') {
            // 收藏按钮传图片 URL，支持多图组中只收藏某几张
            handlerCall = `GalleryActions.${cfg.action}(${JSON.stringify(record).replace(/"/g, '&quot;')}, event, ${q(JSON.stringify(imgUrl))})`;
        } else {
            handlerCall = `GalleryActions.${cfg.action}(${JSON.stringify(record).replace(/"/g, '&quot;')}, event)`;
        }
        // favorite：按 active 切换图标 + 颜色
        let iconSvg = ICONS[cfg.icon] || '';
        let extraClass = '';
        if (featureKey === 'favorite') {
            iconSvg = extra && extra.active ? ICONS.star : ICONS.starOutline;
            extraClass = extra && extra.active ? ' is-fav' : '';
        }
        return `<button onclick="${handlerCall}" class="gallery-action-btn w-8 h-8 bg-white/90 backdrop-blur text-black ${cfg.className}${extraClass} rounded-lg flex items-center justify-center transition-colors" title="${cfg.title}">${iconSvg}</button>`;
    }

    function escapeHTML(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /**
     * 将原始图片 URL 转为 /api/media-preview 缩略图 URL
     * 只处理 /output/ 和 /assets/ 本地路径，其他 URL 原样返回
     */
    function thumbUrl(url, w) {
        w = w || 512;
        var raw = String(url || '');
        if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
        // ComfyUI 代理：直接给 w 参数让后端返回 WebP 缩略图（秒出，不再加载原图）
        if (raw.indexOf('/api/comfyui/view') === 0) {
            var q = raw.split('?')[1] || '';
            return '/api/comfyui/view?w=' + w + (q ? '&' + q : '');
        }
        if (!raw.startsWith('/output/') && !raw.startsWith('/assets/')) return raw;
        if (!/\.(png|jpe?g|webp|gif|bmp|avif)(\?|#|$)/i.test(raw)) return raw;
        return '/api/media-preview?w=' + w + '&url=' + encodeURIComponent(raw);
    }

    // NSFW 提示词关键词检测（保守黑名单，匹配单词边界或紧邻分隔符）
    const NSFW_PATTERNS = [
        // 英文（单词边界）
        /\b(nude|naked|nsfw|explicit|uncensored|hentai|porn|sex|pussy|penis|penetration|vagina|anus|nipple|orgasm|erotic|lewd|bdsm|fetish|genitals|masturbat|cumshot|blowjob|handjob|footjob|titfuck|deepthroat|gangbang|creampie|facial\W*cum|anal\W*sex|virgin\W*sex|rape\W*|rapist|incest|pedophil)\b/i,
        // 中文（紧邻分隔符或首尾）
        /(?:^|[\s,，、。;；])(裸体|裸露|色情|做爱|性交|阴茎|阴道|阴部|乳头|高潮|情色|自慰|口交|肛交|强暴|强奸|乱伦|恋童|卖淫|嫖娼|裸照|裸聊|裸舞|裸戏|三级片|黄片|黄网|毛片)(?=[\s,，、。;；]|$)/
    ];
    function isNsfwPrompt(prompt) {
        if (!prompt) return false;
        // 先规范化：下划线/连字符替换为空格，避免 \b 边界失效
        // 例如 "stealth_sex" → "stealth sex" 才能匹配 \bsex\b
        const p = String(prompt).replace(/[-_]/g, ' ');
        return NSFW_PATTERNS.some(re => re.test(p));
    }

    global.GalleryCard = { render, ICONS, DEFAULT_FEATURES, BUTTON_CONFIG };

    // 点击卡片外空白区域：取消所有选中描边（蓝色高亮）
    // 仅绑定一次；批量选择模式与预设选择浮层内不干涉
    if (!global.__galleryBlankDeselectBound) {
        global.__galleryBlankDeselectBound = true;
        document.addEventListener('click', function (e) {
            if (document.body.classList.contains('history-bulk-selecting')) return;
            // 点在卡片（或其内部元素）上 → 交给卡片自身 onclick 处理，这里不动
            if (e.target.closest && e.target.closest('.masonry-item')) return;
            // 点在预设选择浮层内 → 不干涉
            if (e.target.closest && (e.target.closest('.sp-picker-shell') || e.target.closest('.sp-picker-window'))) return;
            // 其余视为点击空白区域 → 清除所有选中描边
            var sel = document.querySelectorAll('.masonry-item.gallery-selected');
            for (var i = 0; i < sel.length; i++) sel[i].classList.remove('gallery-selected');
        });
    }
})(window);
