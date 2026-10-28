/**
 * 通用图片查看器模块
 * 功能：鼠标滚轮缩放、键盘左右切换、按钮点击切换
 * 适用：所有 ComfyUI 图片类应用
 */

(function() {
    'use strict';

    let imageList = [];
    let promptList = [];        // 可选：与 imageList 长度一致的提示词数组
    let onShowCallback = null;  // 可选：切图后的回调 (index, url, prompt)
    let currentIndex = 0;
    let currentScale = 1;
    let originalWidth = 0;
    let originalHeight = 0;
    // 当前正在加载的图片 URL（用于切图时丢弃过期加载）
    let _pendingPhaseUrl = null;

    function unwrapMediaUrl(url) {
        const raw = String(url || '');
        try {
            const parsed = new URL(raw, location.origin);
            if (parsed.pathname === '/api/media-preview') {
                const inner = parsed.searchParams.get('url') || '';
                if (inner) return unwrapMediaUrl(inner);
            }
            if (parsed.origin === location.origin) return parsed.pathname + parsed.search;
        } catch (e) {}
        return raw;
    }

    function readSize(bytes, offset, size, little) {
        let value = 0;
        for (let i = 0; i < size; i++) {
            const shift = little ? i * 8 : (size - 1 - i) * 8;
            value += bytes[offset + i] * (2 ** shift);
        }
        return value;
    }

    function sniffImageSize(bytes) {
        if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
            return { w: readSize(bytes, 16, 4, false), h: readSize(bytes, 20, 4, false) };
        }
        if (bytes.length >= 10 && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) {
            return { w: readSize(bytes, 6, 2, true), h: readSize(bytes, 8, 2, true) };
        }
        if (bytes.length >= 30 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) {
            const tag = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
            if (tag === 'VP8X') {
                return {
                    w: 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536,
                    h: 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536
                };
            }
            if (tag === 'VP8 ') {
                return { w: readSize(bytes, 26, 2, true) & 0x3fff, h: readSize(bytes, 28, 2, true) & 0x3fff };
            }
            if (tag === 'VP8L') {
                const bits = readSize(bytes, 21, 4, true);
                return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
            }
        }
        if (bytes[0] === 0xff && bytes[1] === 0xd8) {
            let offset = 2;
            while (offset + 8 < bytes.length) {
                if (bytes[offset] !== 0xff) { offset++; continue; }
                const marker = bytes[offset + 1];
                const length = readSize(bytes, offset + 2, 2, false);
                if (length < 2) break;
                const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb);
                if (sof) return { w: readSize(bytes, offset + 7, 2, false), h: readSize(bytes, offset + 5, 2, false) };
                offset += 2 + length;
            }
        }
        return null;
    }

    function probeWithImage(url) {
        return new Promise(resolve => {
            const probe = new Image();
            probe.onload = () => resolve(probe.naturalWidth ? { w: probe.naturalWidth, h: probe.naturalHeight } : null);
            probe.onerror = () => resolve(null);
            probe.src = url;
        });
    }

    async function probeFileSize(url) {
        if (!url) return null;
        if (url.startsWith('blob:')) return probeWithImage(url);
        try {
            const resp = await fetch(url, { headers: { Range: 'bytes=0-262143' } });
            if (!resp.ok && resp.status !== 206) throw new Error('size');
            const reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;
            const chunks = [];
            let got = 0;
            if (reader) {
                while (got < 262144) {
                    const step = await reader.read();
                    if (step.done) break;
                    chunks.push(step.value);
                    got += step.value.length;
                }
                if (reader.cancel) reader.cancel().catch(() => {});
            } else {
                chunks.push(new Uint8Array(await resp.arrayBuffer()));
            }
            const bytes = new Uint8Array(got || chunks.reduce((sum, part) => sum + part.length, 0));
            let offset = 0;
            chunks.forEach(part => { bytes.set(part, offset); offset += part.length; });
            const size = sniffImageSize(bytes);
            if (size && size.w && size.h) return size;
        } catch (e) {}
        return probeWithImage(url);
    }

    function previewMediaUrl(url, width) {
        const original = unwrapMediaUrl(url);
        if (!original || original.startsWith('data:') || original.startsWith('blob:')) return original;
        if (original.startsWith('/api/comfyui/view')) {
            const parsed = new URL(original, location.origin);
            parsed.searchParams.set('w', String(width));
            return parsed.pathname + '?' + parsed.searchParams.toString();
        }
        if (original.startsWith('/output/') || original.startsWith('/assets/')) {
            return '/api/media-preview?w=' + width + '&url=' + encodeURIComponent(original.split('?')[0]);
        }
        return original;
    }

    function init(images, startIndex = 0, options = {}) {
        imageList = images;
        currentIndex = startIndex;
        currentScale = 1;
        originalWidth = 0;
        originalHeight = 0;
        promptList = Array.isArray(options.prompts) ? options.prompts : [];
        onShowCallback = typeof options.onShow === 'function' ? options.onShow : null;

        const lightbox = document.getElementById('lightbox');
        lightbox.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        setupEventListeners();
        showImage(currentIndex);
    }

    function setupEventListeners() {
        const img = document.getElementById('lightboxImg');
        if (!img) return;

        img.onwheel = handleWheel;
        window.removeEventListener('keydown', handleKeyDown);
        window.addEventListener('keydown', handleKeyDown);

        // 触摸滑动支持
        let touchStartX = 0;
        let touchEndX = 0;
        const minSwipeDistance = 50;

        img.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        img.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            const diff = touchStartX - touchEndX;
            if (Math.abs(diff) > minSwipeDistance) {
                if (diff > 0) {
                    nextImage();
                } else {
                    prevImage();
                }
            }
        }, { passive: true });

        // 拖动平移（缩放时）
        let dragStartX = 0;
        let dragStartY = 0;
        let dragStartPanX = 0;
        let dragStartPanY = 0;

        img.addEventListener('mousedown', (e) => {
            isPanning = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            dragStartPanX = panX;
            dragStartPanY = panY;
            beginInteract(img, 'drag');
            img.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isPanning) return;
            // 计算相对偏移量，并根据缩放比例调整
            const dx = (e.clientX - dragStartX) / currentScale;
            const dy = (e.clientY - dragStartY) / currentScale;
            panX = dragStartPanX + dx;
            panY = dragStartPanY + dy;
            // 只记录最新位移，实际写样式交给下一帧统一执行：
            // 高刷鼠标一帧可能触发多次 mousemove，逐事件同步写 style 会造成卡顿
            pendingTransform = true;
            schedulePanFlush();
        });

        document.addEventListener('mouseup', () => {
            if (isPanning) {
                isPanning = false;
                img.style.cursor = 'grab';
                endInteract(img);
            }
        });
    }

    function handleWheel(event) {
        event.preventDefault();
        event.stopPropagation();
        
        const img = document.getElementById('lightboxImg');
        if (!img || !img.naturalWidth) return;
        
        const oldZoom = currentScale;
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        currentScale = Math.max(0.15, Math.min(6.0, currentScale * factor));
        
        beginInteract(img, 'zoom');
        applyZoom();
        endInteract(img);
    }

    function handleKeyDown(event) {
        const t = event.target;
        const editable = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);
        if (event.key === 'Escape') {
            closeLightbox();
            return;
        }
        if (editable) return;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            prevImage();
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            nextImage();
        } else if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoomIn();
        } else if (event.key === '-') {
            event.preventDefault();
            zoomOut();
        }
    }

    function showImage(index) {
        if (index < 0 || index >= imageList.length) return;

        currentIndex = index;
        currentScale = 1;
        originalWidth = 0;
        originalHeight = 0;
        resetPan();

        const img = document.getElementById('lightboxImg');
        const res = document.getElementById('lightboxRes');

        // 重置图片样式
        img.style.width = '';
        img.style.height = '';
        img.style.maxWidth = '85vw';
        img.style.maxHeight = '70vh';
        img.style.objectFit = 'contain';
        img.style.transform = 'scale(1)';
        img.style.transformOrigin = 'center center';

        // 画面用 1536px 预览，尺寸文字读原文件，避免把预览宽高当成成图尺寸。
        const originalUrl = unwrapMediaUrl(imageList[currentIndex]);
        _pendingPhaseUrl = originalUrl;
        const paintFileSize = (size) => {
            if (!size || _pendingPhaseUrl !== originalUrl || !res) return;
            res.style.display = '';
            res.textContent = size.w + '×' + size.h + ' (' + (currentIndex + 1) + '/' + imageList.length + ')';
        };

        // 画质策略：原图优先（/output 直出未重编码），失败再回落压缩预览。
        // 开关：localStorage('viewer_full_quality') 设为 '0' 可回到旧的压缩预览，无需改代码。
        const _fullQuality = localStorage.getItem('viewer_full_quality') !== '0';
        const _isVideo = /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(String(originalUrl).split('?')[0]);

        img.src = previewMediaUrl(originalUrl, 768);
        img.onload = () => {
            if (originalWidth === 0 && _pendingPhaseUrl === originalUrl) {
                originalWidth = img.naturalWidth;
                originalHeight = img.naturalHeight;
            }
        };

        (function phase2() {
            // 阶段二加载成图：默认直接拉原图，避免 /api/media-preview 的 WebP(q=88) 重编码降质
            const useOriginal = _fullQuality && !_isVideo;
            const fullUrl = unwrapMediaUrl(originalUrl);
            const applyFull = (src, w, h) => {
                if (_pendingPhaseUrl !== originalUrl) return;
                const liveImg = document.getElementById('lightboxImg');
                if (!liveImg) return;
                liveImg.src = src;
                originalWidth = w;
                originalHeight = h;
                applyZoom();
            };
            const loadPreview = () => {
                const midImg = new Image();
                const midUrl = previewMediaUrl(originalUrl, 1536);
                midImg.onload = () => applyFull(midUrl, midImg.naturalWidth, midImg.naturalHeight);
                midImg.onerror = () => {};
                midImg.src = midUrl;
            };
            if (!useOriginal) { loadPreview(); return; }
            const fullImg = new Image();
            fullImg.onload = () => applyFull(fullUrl, fullImg.naturalWidth, fullImg.naturalHeight);
            fullImg.onerror = loadPreview;   // 原图不可用（如外部 URL）时回落压缩预览
            fullImg.src = fullUrl;
        })();

        probeFileSize(originalUrl).then(paintFileSize);

        // 切图后回调
        if (onShowCallback) {
            try {
                onShowCallback(currentIndex, imageList[currentIndex], promptList[currentIndex] || '');
            } catch (e) { /* ignore */ }
        }

        updateNavigationButtons();
    }

    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;

    function applyZoom() {
        const img = document.getElementById('lightboxImg');
        if (!img || !originalWidth) return;
        
        // 使用 transform 缩放，不影响布局
        writeTransform(img);
        img.style.cursor = currentScale > 1 ? 'grab' : 'default';
    }

    // ─────────────────────────────────────────────
    //  拖动性能：按帧合并写入 + 交互期 GPU 合成层提升 + 关闭补间动画
    //  这三样缺一样，拖动大尺寸原图就会有拖影 / 卡顿感
    // ─────────────────────────────────────────────
    let pendingTransform = false;
    let panRAF = 0;
    let gpuIdleTimer = null;

    function writeTransform(img) {
        if (!img) return;
        img.style.transform = `scale(${currentScale}) translate(${panX}px, ${panY}px)`;
        img.style.transformOrigin = 'center center';
    }

    function schedulePanFlush() {
        if (panRAF) return;
        panRAF = requestAnimationFrame(() => {
            panRAF = 0;
            if (!pendingTransform) return;
            pendingTransform = false;
            writeTransform(document.getElementById('lightboxImg'));
        });
    }

    // 交互开始：提升为独立合成层；拖动还会禁用 transform 补间动画 + 关掉背景毛玻璃
    // mode: 'drag' = 关补间+关毛玻璃+升层；'zoom' = 只升层（保留补间的顺滑手感）
    function beginInteract(img, mode) {
        if (gpuIdleTimer) { clearTimeout(gpuIdleTimer); gpuIdleTimer = null; }
        if (img) img.classList.add(mode === 'drag' ? 'is-lb-interacting' : 'is-lb-gpu');
        if (mode === 'drag') {
            const lb = document.getElementById('lightbox');
            if (lb) lb.classList.add('is-lb-dragging');
        }
    }

    // 交互结束后延迟释放合成层（连续缩放不会反复申请/释放图层）
    function endInteract(img) {
        const lb = document.getElementById('lightbox');
        if (lb) lb.classList.remove('is-lb-dragging');
        if (gpuIdleTimer) clearTimeout(gpuIdleTimer);
        gpuIdleTimer = setTimeout(() => {
            gpuIdleTimer = null;
            const el = img || document.getElementById('lightboxImg');
            if (el) el.classList.remove('is-lb-interacting', 'is-lb-gpu');
        }, 500);
    }

    function resetPan() {
        panX = 0;
        panY = 0;
    }

    function prevImage() {
        if (currentIndex > 0) {
            showImage(currentIndex - 1);
        } else {
            showImage(imageList.length - 1);
        }
    }

    function nextImage() {
        if (currentIndex < imageList.length - 1) {
            showImage(currentIndex + 1);
        } else {
            showImage(0);
        }
    }

    function zoomIn() {
        const newScale = Math.min(6.0, currentScale * 1.12);
        currentScale = newScale;
        beginInteract(null, 'zoom');
        applyZoom();
        endInteract(null);
    }

    function zoomOut() {
        const newScale = Math.max(0.15, currentScale / 1.12);
        currentScale = newScale;
        beginInteract(null, 'zoom');
        applyZoom();
        endInteract(null);
    }

    function updateNavigationButtons() {
        const prevBtn = document.getElementById('lightboxPrevBtn');
        const nextBtn = document.getElementById('lightboxNextBtn');
        
        if (prevBtn) prevBtn.style.display = imageList.length > 1 ? 'flex' : 'none';
        if (nextBtn) nextBtn.style.display = imageList.length > 1 ? 'flex' : 'none';
    }

    function closeLightbox() {
        const lightbox = document.getElementById('lightbox');
        if (lightbox) {
            lightbox.classList.add('hidden');
            lightbox.classList.remove('is-lb-dragging');
            document.body.style.overflow = '';
            // 关闭时彻底释放合成层与待处理帧，避免残留图层占显存
            if (panRAF) { cancelAnimationFrame(panRAF); panRAF = 0; }
            pendingTransform = false;
            if (gpuIdleTimer) { clearTimeout(gpuIdleTimer); gpuIdleTimer = null; }
            const el = document.getElementById('lightboxImg');
            if (el) el.classList.remove('is-lb-interacting', 'is-lb-gpu');
            setTimeout(() => {
                const img = document.getElementById('lightboxImg');
                if (img) img.src = '';
            }, 300);
        }
        
        window.removeEventListener('keydown', handleKeyDown);
        resetState();
    }

    function resetState() {
        imageList = [];
        promptList = [];
        onShowCallback = null;
        currentIndex = 0;
        currentScale = 1;
        originalWidth = 0;
        originalHeight = 0;
        _pendingPhaseUrl = null;
    }

    function goTo(index) {
        if (index >= 0 && index < imageList.length) {
            showImage(index);
        }
    }

    window.ImageViewer = {
        init,
        prevImage,
        nextImage,
        goTo,
        closeLightbox,
        zoomIn,
        zoomOut
    };
})();
