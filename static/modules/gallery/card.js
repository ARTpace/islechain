/*!
 * GalleryCard - 统一的缩略图卡片渲染
 * 一个函数搞定所有功能的缩略图，按 features 配置显示对应按钮
 */
(function (global) {
    'use strict';

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
        imageFallback: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>'
    };

    // 按钮配置表：feature → {icon, title, className, action, primary}
    const BUTTON_CONFIG = {
        openFolder: { icon: 'folder', title: '打开文件夹', className: 'hover:bg-blue-600 hover:text-white', action: 'openImageFolder' },
        download:   { icon: 'download', title: '下载图片',   className: 'hover:bg-green-600 hover:text-white', action: 'downloadImage' },
        copyToCanvas:{ icon: 'copy',    title: '复制到画布', className: 'hover:bg-purple-600 hover:text-white', action: 'copyToCanvas' },
        favorite:  { icon: 'star',   title: '收藏',       className: 'hover:bg-amber-400 hover:text-white', action: 'toggleFavorite' },
        copyPrompt:  { icon: 'clipboard', title: '复制提示词',  className: 'hover:bg-cyan-600 hover:text-white', action: 'copyPrompt' },
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
        modelBadge: null        // 左上角徽标 URL
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

        const cfg = global.GALLERY_CONFIG || {};
        const features = Object.assign({}, DEFAULT_FEATURES, cfg.features || {}, opts.features || {});
        const historyType = opts.historyType || cfg.type || record.type || 'unknown';

        const containerEl = typeof container === 'string' ? document.querySelector(container) : container;
        if (!containerEl) return null;

        const card = document.createElement('div');
        card.id = `history-${record.timestamp}`;
        card.dataset.historyTs = record.timestamp;
        card.dataset.historyType = historyType;
        card.className = 'masonry-item group cursor-zoom-in animate-in fade-in duration-700';

        // 单击 → lightbox（兼容 openLightbox 的两种签名）
        card.onclick = (e) => {
            if (document.body.classList.contains('history-bulk-selecting')) return;
            // NSFW 屏蔽模式下，已识别的图片不响应点击
            if (document.body.classList.contains('nsfw-mode') && card.dataset.nsfw === '1') return;
            if (e.target.closest('button') || e.target.closest('.batch-checkbox')) return;
            if (typeof global.openLightbox !== 'function') return;
            const prompt = record.prompt || '';
            if (global.openLightbox.length >= 4) {
                // 4/5 参版本：openLightbox(image, allImages, startIndex, prompt[, allPrompts])
                // 多张生成：展开所有 images 到 allImages，同 record 的 prompt 共享
                const allHistory = (global.GalleryList && global.GalleryList.allHistory) || [record];
                const allImages = [];
                const allPrompts = [];
                for (const item of allHistory) {
                    const imgs = (item.images || []).filter(Boolean);
                    for (const u of imgs) {
                        allImages.push(u);
                        allPrompts.push(item.prompt || '');
                    }
                }
                const historyIndex = allHistory.findIndex(item => item.timestamp === record.timestamp);
                let startIndex = 0;
                for (let i = 0; i < historyIndex; i++) {
                    startIndex += ((allHistory[i].images || []).filter(Boolean)).length;
                }
                if (global.openLightbox.length >= 5) {
                    global.openLightbox(record.images[0], allImages, startIndex, prompt, allPrompts);
                } else {
                    global.openLightbox(record.images[0], allImages, startIndex, prompt);
                }
            } else if (global.openLightbox.length >= 3) {
                // 3 参版本：openLightbox(image, allImages, startIndex)
                const allHistory = (global.GalleryList && global.GalleryList.allHistory) || [record];
                const allImages = [];
                for (const item of allHistory) {
                    const imgs = (item.images || []).filter(Boolean);
                    for (const u of imgs) allImages.push(u);
                }
                const historyIndex = allHistory.findIndex(item => item.timestamp === record.timestamp);
                let startIndex = 0;
                for (let i = 0; i < historyIndex; i++) {
                    startIndex += ((allHistory[i].images || []).filter(Boolean)).length;
                }
                global.openLightbox(record.images[0], allImages, startIndex, prompt);
            } else {
                // 2 参版本：openLightbox(image, prompt) — 多张生成时传图片数组
                if ((record.images || []).length > 1) {
                    global.openLightbox(record.images, prompt);
                } else {
                    global.openLightbox(record.images[0], prompt);
                }
            }
        };

        // 收藏状态标记（zimage 端从 localStorage 同步；其他页默认 0）
        const isFav = (global.__galleryFavorites && global.__galleryFavorites.has(String(record.timestamp))) ? '1' : '0';
        card.dataset.fav = isFav;

        // 构建操作按钮 HTML
        const buttons = [];
        if (features.openFolder)  buttons.push(buttonHTML('openFolder', record));
        if (features.usePrompt)   buttons.push(buttonHTML('usePrompt', record));
        if (features.copyPrompt)  buttons.push(buttonHTML('copyPrompt', record));
        if (features.favorite)    buttons.push(buttonHTML('favorite', record, { active: isFav === '1' }));
        if (features.download)    buttons.push(buttonHTML('download', record));
        if (features.copyToCanvas) buttons.push(buttonHTML('copyToCanvas', record));
        if (features.regenerate)  buttons.push(buttonHTML('regenerate', record));
        if (features.delete)      buttons.push(buttonHTML('delete', record));

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
                badgeHTML = `<div class="model-badge absolute bottom-3 right-3 z-10 px-2 py-1 bg-black/60 backdrop-blur rounded-lg text-[9px] font-bold text-white">${escapeHTML(badgeText)}</div>`;
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

        card.innerHTML = `
            ${buildImagesHTML(record, features, onerror)}
            ${fallbackHTML}
            ${badgeHTML}
            ${batchHTML}
            ${nsfwBadge}
            <div class="gallery-actions absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex gap-1">
                ${buttons.join('')}
            </div>`;

        // 右键菜单
        if (features.contextMenu) {
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (global.GalleryContextMenu && typeof global.GalleryContextMenu.show === 'function') {
                    global.GalleryContextMenu.show(e.clientX, e.clientY, record, features);
                }
            });
        }

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
    function buildImagesHTML(record, features, onerror) {
        const imgs = (record.images || []).filter(Boolean);
        if (imgs.length <= 1) {
            // 单图：按原始比例显示，自适应高度
            return `<img src="${imgs[0] || ''}" class="w-full" loading="lazy" onerror="${onerror}" style="display:block; object-fit:contain;">`;
        }
        // 多图：使用flex布局，自适应高度
        if (imgs.length === 2) {
            // 2张图：左右并排，按原始比例显示
            return `<div class="flex gap-0.5" style="height:auto;">${imgs.slice(0, 2).map(u => 
                `<div class="flex-1 relative overflow-hidden" style="background:#f5f5f5;"><img src="${u}" class="w-full h-full" loading="lazy" onerror="${onerror}" style="display:block; object-fit:contain;"></div>`
            ).join('')}</div>`;
        } else if (imgs.length === 3) {
            // 3张图：上1 + 下2
            return `<div class="flex flex-col gap-0.5" style="height:auto;">
                <div class="relative overflow-hidden" style="background:#f5f5f5;"><img src="${imgs[0]}" class="w-full" loading="lazy" onerror="${onerror}" style="display:block; object-fit:contain;"></div>
                <div class="flex gap-0.5">${imgs.slice(1, 3).map(u => 
                    `<div class="flex-1 relative overflow-hidden" style="background:#f5f5f5;"><img src="${u}" class="w-full" loading="lazy" onerror="${onerror}" style="display:block; object-fit:contain;"></div>`
                ).join('')}</div>
            </div>`;
        } else {
            // 4张及以上：2x2网格
            const cells = imgs.slice(0, 4).map((u, i) => {
                const isLast = (i === 3 && imgs.length > 4);
                const overlay = isLast
                    ? `<div class="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-2xl font-bold pointer-events-none">+${imgs.length - 4}</div>`
                    : '';
                return `<div class="relative overflow-hidden" style="background:#f5f5f5;"><img src="${u}" class="w-full" loading="lazy" onerror="${onerror}" style="display:block; object-fit:contain;">${overlay}</div>`;
            }).join('');
            return `<div class="grid grid-cols-2 gap-0.5" style="height:auto;">${cells}</div>`;
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

    // NSFW 提示词关键词检测（保守黑名单，匹配单词边界或紧邻分隔符）
    const NSFW_PATTERNS = [
        // 英文（单词边界）
        /\b(nude|naked|nsfw|explicit|uncensored|hentai|porn|sex|pussy|penis|vagina|anus|nipple|orgasm|erotic|lewd|bdsm|fetish|genitals|masturbat|cumshot|blowjob|handjob|footjob|titfuck|deepthroat|gangbang|creampie|facial\W*cum|anal\W*sex|virgin\W*sex|rape\W*|rapist|incest|pedophil)\b/i,
        // 中文（紧邻分隔符或首尾）
        /(?:^|[\s,，、。;；])(裸体|裸露|色情|做爱|性交|阴茎|阴道|阴部|乳头|高潮|情色|自慰|口交|肛交|强暴|强奸|乱伦|恋童|卖淫|嫖娼|裸照|裸聊|裸舞|裸戏|三级片|黄片|黄网|毛片)(?=[\s,，、。;；]|$)/
    ];
    function isNsfwPrompt(prompt) {
        if (!prompt) return false;
        const p = String(prompt);
        return NSFW_PATTERNS.some(re => re.test(p));
    }

    global.GalleryCard = { render, ICONS, DEFAULT_FEATURES, BUTTON_CONFIG };
})(window);
