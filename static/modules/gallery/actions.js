/*!
 * GalleryActions - 统一的图片操作行为
 * 所有功能的缩略图操作（删除/打开文件夹/批量删除/下载）都在这里实现
 * 业务页不再写任何 fetch / DOM 操作
 */
(function (global) {
    'use strict';

    /**
     * 在资源管理器中打开图片所在文件夹
     * 智能判断本地 /output/ 路径 vs ComfyUI 临时路径
     */
    async function openImageFolder(imageUrl, event) {
        if (event) event.stopPropagation();
        // 兼容 record 对象和 URL 字符串两种调用方式
        if (imageUrl && typeof imageUrl === 'object') {
            imageUrl = (imageUrl.images && imageUrl.images[0]) || '';
        }
        if (!imageUrl) return;
        if (imageUrl.startsWith('/output/')) {
            const relPath = imageUrl.replace('/output/', '');
            await fetch('/api/open-output-folder?path=' + encodeURIComponent(relPath)).catch(() => {});
            return;
        }
        // ComfyUI 图片从 URL 参数提取
        try {
            const u = new URL(imageUrl, window.location.origin);
            const filename = u.searchParams.get('filename') || '';
            const subfolder = u.searchParams.get('subfolder') || '';
            const type = u.searchParams.get('type') || 'output';
            await fetch(`/api/comfyui/open-folder?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`).catch(() => {});
        } catch (e) {
            console.error('[openImageFolder] 无效的图片地址:', imageUrl, e);
        }
    }

    /**
     * 删除单条历史（含本地文件清理 + 后端历史记录删除）
     * 两步确认：第一次点击 → 按钮变红（3s 内不点则自动还原）；
     *          第二次点击 → 直接删除，不再弹 confirm 框。
     */
    async function deleteHistoryItem(record, event) {
        if (event) event.stopPropagation();
        const timestamp = record && record.timestamp;
        if (!timestamp) return;

        // 取触发按钮并判断是否处于"待确认"状态
        const btn = event && event.target && event.target.closest && event.target.closest('button');
        if (btn && btn.classList.contains('is-confirming')) {
            // 第二次点击（按钮）：清除定时器，执行删除
            clearTimeout(btn._confirmTimer);
            btn.classList.remove('is-confirming');
            btn._confirmTimer = null;
        } else if (btn) {
            // 第一次点击（按钮）：进入待确认态
            // 先复位其他卡片的 confirming 态（避免误删）
            document.querySelectorAll('button.is-confirming').forEach(b => {
                if (b !== btn) {
                    b.classList.remove('is-confirming');
                    if (b._confirmTimer) { clearTimeout(b._confirmTimer); b._confirmTimer = null; }
                }
            });
            btn.classList.add('is-confirming');
            btn._confirmTimer = setTimeout(() => {
                btn.classList.remove('is-confirming');
                btn._confirmTimer = null;
            }, 3000);
            return;
        } else {
            return;
        }

        const historyType = (record && record.type) || (global.GALLERY_CONFIG && global.GALLERY_CONFIG.type) || 'unknown';

        // 调后端删除历史记录（后端会负责删除该 record 下所有图片文件）
        try {
            await fetch('/api/history/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: historyType, timestamp })
            });
        } catch (e) { /* 网络错误也允许前端移除 */ }

        // 移除 DOM
        const el = document.getElementById(`history-${timestamp}`);
        if (el) el.remove();
        // 同步内存中的 allHistory
        if (global.GalleryList && Array.isArray(global.GalleryList.allHistory)) {
            global.GalleryList.allHistory = global.GalleryList.allHistory.filter(h => String(h.timestamp) !== String(timestamp));
        }
        return true;
    }

    /**
     * 删除多图组合中的单张图片
     */
    async function deleteSingleImage(timestamp, imageUrl, event) {
        if (event) event.stopPropagation();
        if (!timestamp || !imageUrl) return;
        // 两步确认
        const btn = event && event.target && event.target.closest && event.target.closest('button');
        if (btn && btn.classList.contains('is-confirming')) {
            clearTimeout(btn._confirmTimer);
            btn.classList.remove('is-confirming');
            btn._confirmTimer = null;
        } else {
            if (btn) {
                document.querySelectorAll('button.is-confirming').forEach(b => {
                    if (b !== btn) { b.classList.remove('is-confirming'); if (b._confirmTimer) { clearTimeout(b._confirmTimer); b._confirmTimer = null; } }
                });
                btn.classList.add('is-confirming');
                btn._confirmTimer = setTimeout(() => { btn.classList.remove('is-confirming'); btn._confirmTimer = null; }, 3000);
            }
            return;
        }
        const historyType = (global.GALLERY_CONFIG && global.GALLERY_CONFIG.type) || 'unknown';
        try {
            const res = await fetch('/api/history/delete-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ timestamp, image_url: imageUrl })
            });
            if (!res.ok) throw new Error('删除失败');
            const data = await res.json();
            if (!data.success) throw new Error(data.message);
            // 从 DOM 中移除该图片
            const card = document.getElementById('history-' + timestamp);
            if (card) {
                const imgEl = card.querySelector('img[data-original-src="' + CSS.escape(imageUrl) + '"]');
                if (imgEl) {
                    const imgContainer = imgEl.closest('.relative');
                    if (imgContainer) imgContainer.remove();
                }
                // 如果只剩 0 张图，移除整个卡片
                if (data.remaining === 0) {
                    card.remove();
                }
            }
            // 更新 allHistory
            if (global.GalleryList && Array.isArray(GalleryList.allHistory)) {
                const record = GalleryList.allHistory.find(h => Math.abs(h.timestamp - timestamp) < 0.001);
                if (record) {
                    record.images = record.images.filter(u => u !== imageUrl);
                    if (record.images.length === 0) {
                        GalleryList.allHistory = GalleryList.allHistory.filter(h => Math.abs(h.timestamp - timestamp) >= 0.001);
                    }
                }
            }
        } catch (e) {
            console.error('[deleteSingleImage]', e);
            showToast('删除失败: ' + e.message, 'error');
        }
    }

    /**
     * 批量删除
     */
    async function deleteSelected(timestamps, event) {
        if (event) event.stopPropagation();
        if (!timestamps || timestamps.size === 0) return;
        if (!confirm(`确定删除选中的 ${timestamps.size} 条记录吗？`)) return;
        const historyType = (global.GALLERY_CONFIG && global.GALLERY_CONFIG.type) || 'unknown';
        const items = Array.from(timestamps);
        // 逐条删除（并行），前端先乐观移除
        items.forEach(ts => {
            const el = document.getElementById(`history-${ts}`);
            if (el) el.remove();
        });
        await Promise.all(items.map(async (ts) => {
            // 后端 /api/history/delete 会负责删除该 record 下所有图片文件
            try {
                await fetch('/api/history/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: historyType, timestamp: ts })
                });
            } catch (e) {}
        }));
        if (global.GalleryList && Array.isArray(global.GalleryList.allHistory)) {
            global.GalleryList.allHistory = global.GalleryList.allHistory.filter(h => !timestamps.has(String(h.timestamp)));
        }
        if (global.GalleryList && typeof global.GalleryList.clearSelection === 'function') {
            global.GalleryList.clearSelection();
        }
        return true;
    }

    /**
     * 下载图片到本地
     */
    async function downloadImage(imageUrl, filename, event) {
        if (event) event.stopPropagation();
        if (!imageUrl) return;
        try {
            const res = await fetch(imageUrl);
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename || `image_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } catch (e) {
            console.error('下载失败:', e);
            alert('下载失败');
        }
    }

    /**
     * 收藏 / 取消收藏（单张图片级别）
     * - key 使用图片 URL（而非 timestamp），支持多图组中只收藏某几张
     * - 维护 global.__galleryFavorites (Set) + localStorage('zimage_favorites')
     * - 同步更新按钮图标与高亮
     * - 同步更新卡片的 data-fav（任意子图被收藏 → 卡片 = 1）
     */
    const STAR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    const STAR_OUTLINE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

    function toggleFavorite(record, event, imgUrl) {
        if (event) event.stopPropagation();
        // 兼容旧调用：如果没有 imgUrl，用第一张图
        const url = imgUrl || (record && record.images && record.images[0]) || '';
        if (!url) return;
        const set = (global.__galleryFavorites = global.__galleryFavorites || new Set());
        const added = !set.has(url);
        if (added) set.add(url); else set.delete(url);
        try { localStorage.setItem('zimage_favorites', JSON.stringify(Array.from(set))); } catch (_) {}

        // 更新被点击的按钮
        const btn = event && event.target && event.target.closest && event.target.closest('button');
        if (btn) {
            btn.classList.toggle('is-fav', added);
            btn.innerHTML = added ? STAR_SVG : STAR_OUTLINE_SVG;
        }

        // 找到所属卡片并更新状态
        // 兼容右键菜单（btn 为 null）和按钮点击：btn 存在则从其找 card，否则通过 record.timestamp 查找
        const card = btn ? btn.closest('.masonry-item') : (record && document.getElementById('history-' + record.timestamp));
        if (card) {
            // 更新卡片内所有图片的收藏按钮状态
            card.querySelectorAll('.img-fav-btn').forEach(favBtn => {
                const favUrl = favBtn.getAttribute('data-fav-url');
                if (!favUrl) return;
                const isFav = set.has(favUrl);
                favBtn.classList.toggle('is-fav', isFav);
                favBtn.innerHTML = isFav ? STAR_SVG : STAR_OUTLINE_SVG;
            });
            // 重新计算卡片整体收藏状态
            const imgs = card.querySelectorAll('img[data-original-src]');
            let anyFav = false;
            imgs.forEach(img => { if (set.has(img.getAttribute('data-original-src'))) anyFav = true; });
            card.dataset.fav = anyFav ? '1' : '0';
            // 更新 action bar 中的收藏按钮
            const actionBarBtns = card.querySelectorAll('.gallery-action-btn');
            actionBarBtns.forEach(ab => {
                const onclick = ab.getAttribute('onclick') || '';
                if (onclick.includes('toggleFavorite')) {
                    ab.classList.toggle('is-fav', anyFav);
                    ab.innerHTML = anyFav ? STAR_SVG : STAR_OUTLINE_SVG;
                }
            });
        }
    }

    /** 判断某张图片是否被收藏 */
    function isImageFavorited(url) {
        const set = global.__galleryFavorites || new Set();
        return set.has(String(url || ''));
    }

    /** 旧接口兼容：按 timestamp 收藏（lightbox 等仍然用） */
    function toggleFavoriteByTs(record, event) {
        if (event) event.stopPropagation();
        const ts = record && record.timestamp;
        if (ts == null) return;
        // lightbox 里操作的是当前显示的那张图
        const imgUrl = (record && record.images && record._currentImageIndex != null)
            ? record.images[record._currentImageIndex]
            : (record.images && record.images[0]) || '';
        return toggleFavorite(record, event, imgUrl);
    }

    /**
     * 复制到画布节点
     * - 优先使用 GALLERY_CONFIG.onCopyToCanvas 业务回调
     * - 默认通过 BroadcastChannel('studio-api') 通知已打开的画布添加图片节点
     * - 都未实现则提示用户
     */
    function copyToCanvas(record, event) {
        if (event) event.stopPropagation();
        const cfg = global.GALLERY_CONFIG || {};
        if (typeof cfg.onCopyToCanvas === 'function') {
            cfg.onCopyToCanvas(record);
            return;
        }
        const imgUrl = record && record.images && record.images[0];
        if (!imgUrl) { alert('图片地址无效'); return; }
        try {
            if (typeof BroadcastChannel === 'undefined') {
                alert('当前浏览器不支持跨标签页通讯，请先打开画布页面再试');
                return;
            }
            const ch = new BroadcastChannel('studio-api');
            ch.postMessage({
                type: 'add-image-to-canvas',
                url: imgUrl,
                name: record.prompt || ('image_' + (record.timestamp || Date.now())),
                prompt: record.prompt || '',
                source: (cfg.type || 'gallery')
            });
            ch.close();
            // 视觉反馈
            showToast('已发送到画布（请确保画布页面已打开）', 'success');
        } catch (e) {
            console.error('[copyToCanvas] failed:', e);
            alert('发送到画布失败：' + (e.message || e));
        }
    }

    /**
     * 重新生成
     * - 优先使用 GALLERY_CONFIG.onRegenerate 业务回调
     * - 默认行为：把原 prompt 填回输入框（需业务页提供 fillPrompt 钩子）
     * - 否则提示
     */
    function regenerate(record, event) {
        if (event) event.stopPropagation();
        const cfg = global.GALLERY_CONFIG || {};
        if (typeof cfg.onRegenerate === 'function') {
            cfg.onRegenerate(record);
            return;
        }
        // 默认 fallback：尝试用 prompt 填充到页面可见的输入框
        const prompt = (record && record.prompt) || '';
        const targets = document.querySelectorAll('textarea, input[type="text"]');
        let filled = false;
        targets.forEach(el => {
            if (filled) return;
            // 跳过隐藏 / 太小 / 不是主输入
            if (el.offsetParent === null) return;
            if (!el.placeholder && !el.id && !el.name) return;
            // 优先匹配 prompt / keyword / 描述 字段
            const idName = ((el.id || '') + (el.name || '') + (el.placeholder || '')).toLowerCase();
            if (/(prompt|描述|提示|keyword|关键词|text|input)/i.test(idName)) {
                el.value = prompt;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                filled = true;
            }
        });
        if (filled) {
            showToast('已回填提示词，请点击生成', 'info');
            // 滚到顶部
            try { document.querySelector('main, .container, body')?.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
        } else {
            alert('当前页面未实现「重新生成」');
        }
    }

    /**
     * 轻量 toast 提示
     */
    function showToast(msg, type = 'info') {
        let el = document.getElementById('galleryToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'galleryToast';
            el.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,.18);transition:opacity .25s;opacity:0;pointer-events:none;';
            document.body.appendChild(el);
        }
        const colors = {
            success: { bg: '#10b981', fg: '#fff' },
            info:    { bg: '#111827', fg: '#fff' },
            warn:    { bg: '#f59e0b', fg: '#fff' },
            error:   { bg: '#ef4444', fg: '#fff' }
        };
        const c = colors[type] || colors.info;
        el.style.background = c.bg;
        el.style.color = c.fg;
        el.textContent = msg;
        el.style.opacity = '1';
        clearTimeout(el._timer);
        el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
    }

    /**
     * 复制这条图的 prompt 到剪贴板
     * - 优先 navigator.clipboard.writeText(异步 API,需 https/localhost)
     * - 失败兜底:老式 textarea + execCommand
     * - 视觉反馈:1.2s 内按钮变绿 ✓
     */
    async function copyPrompt(record, event) {
        if (event) event.stopPropagation();
        const text = (record && record.prompt) || '';
        if (!text) { showToast('该图没有提示词', 'warn'); return; }
        let ok = false;
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                ok = true;
            } else {
                // 兜底:旧浏览器 / 非安全上下文
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
                document.body.appendChild(ta);
                ta.focus(); ta.select();
                ok = document.execCommand('copy');
                document.body.removeChild(ta);
            }
        } catch (e) { ok = false; }

        // 视觉反馈:按钮临时变绿打勾
        const btn = event && event.target && event.target.closest && event.target.closest('button');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg>';
            btn.style.background = '#10b981';
            btn.style.color = '#fff';
            setTimeout(() => {
                btn.innerHTML = orig;
                btn.style.background = '';
                btn.style.color = '';
            }, 1200);
        }
        showToast(ok ? '已复制提示词到剪贴板' : '复制失败,请手动复制', ok ? 'success' : 'error');
    }

    /**
     * 查看这条图的 prompt（弹出通用 PromptPanel 悬浮面板）
     * - 任意功能模块复用，无需各自实现提示词展示 UI
     */
    function viewPrompt(record, event) {
        if (event) event.stopPropagation();
        const text = (record && record.prompt) || '';
        const cfg = global.GALLERY_CONFIG || {};
        const translate = (typeof cfg.onPromptDisplay === 'function') ? cfg.onPromptDisplay : null;
        const anchor = (event && event.currentTarget) ? event.currentTarget : null;
        if (global.PromptPanel) {
            global.PromptPanel.open({
                cn: text,
                negative: (record && record.negative_prompt) || '',
                genParams: (record && record.genParams) || null,
                recordMeta: {
                    type: (record && record.type) || undefined,
                    model: (record && record.model) || undefined,
                    seed: (record && record.seed) != null ? record.seed : undefined
                },
                translate: translate,
                anchor: anchor
            });
        } else {
            if (!text) showToast('该图没有提示词', 'warn');
            else showToast(text, 'info', 5000);
        }
    }

    /**
     * 把这条图的 prompt 覆盖写入提示词输入框
     * - 业务页可挂 GALLERY_CONFIG.onUsePrompt 自定义处理
     * - 默认行为:写入 #prompt,触发 input/change,触发 updatePromptTags(如存在)
     * - 完成后滚到顶部,toast 提示
     */
    function usePrompt(record, event) {
        if (event) event.stopPropagation();
        const cfg = global.GALLERY_CONFIG || {};
        if (typeof cfg.onUsePrompt === 'function') { cfg.onUsePrompt(record); return; }

        const text = (record && record.prompt) || '';
        if (!text) { showToast('该图没有提示词', 'warn'); return; }

        // 兜底查找:优先 #prompt,再按 id/name/placeholder 模糊匹配
        let target = document.getElementById('prompt');
        if (!target) {
            const all = document.querySelectorAll('textarea, input[type="text"]');
            for (const el of all) {
                if (el.offsetParent === null) continue; // 跳过隐藏
                const meta = ((el.id || '') + (el.name || '') + (el.placeholder || '')).toLowerCase();
                if (/(prompt|描述|提示|keyword|关键词)/i.test(meta)) { target = el; break; }
            }
        }
        if (!target) { showToast('未找到提示词输入框', 'error'); return; }

        target.value = text;
        target.dispatchEvent(new Event('input',  { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        // 先同步 LoRA/画师/角色选择器状态，再渲染标签（否则 LoRA 触发词识别不到）
        if (typeof global.syncPickerStatesFromPrompt === 'function') {
            try { global.syncPickerStatesFromPrompt(); } catch (_) {}
        }
        if (typeof global.updatePromptTags === 'function') {
            try { global.updatePromptTags(); } catch (_) {}
        }
        // 滚到顶部
        try {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            const main = document.querySelector('main, .container');
            if (main && main.scrollTo) main.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (_) {}
        // 焦点 + 光标移到末尾
        try { target.focus(); target.setSelectionRange(text.length, text.length); } catch (_) {}

        // 视觉反馈
        const btn = event && event.target && event.target.closest && event.target.closest('button');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg>';
            btn.style.background = '#6366f1';
            btn.style.color = '#fff';
            setTimeout(() => {
                btn.innerHTML = orig;
                btn.style.background = '';
                btn.style.color = '';
            }, 1200);
        }
        showToast('已载入到提示词输入框', 'success');
    }

    global.GalleryActions = {
        openImageFolder,
        deleteHistoryItem,
        deleteSingleImage,
        deleteSelected,
        downloadImage,
        toggleFavorite,
        toggleFavoriteByTs,
        isImageFavorited,
        copyPrompt,
        usePrompt,
        viewPrompt,
        copyToCanvas,
        regenerate
    };
})(window);
