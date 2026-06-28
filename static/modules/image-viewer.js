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
    // 预取的 fullImage 缓存：key = originalUrl, value = Image 实例
    // 用于切图时复用已下载的原图，避免重复 IO
    const _fullImageCache = new Map();
    // 当前正在等待的原图 URL（用于切图时丢弃过期加载）
    let _pendingFullUrl = null;

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
            img.style.transform = `scale(${currentScale}) translate(${panX}px, ${panY}px)`;
        });

        document.addEventListener('mouseup', () => {
            if (isPanning) {
                isPanning = false;
                img.style.cursor = 'grab';
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
        
        applyZoom();
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

        // 双层加载：先用 media-preview 1280 缩略图占位（秒出，受 max-height:70vh 限制画质已够），
        // 后台异步预取原图，到位后无缝替换。切图时若原图已在缓存中则直接显示原图。
        const originalUrl = imageList[currentIndex];
        _pendingFullUrl = originalUrl;

        // 如果原图已预取完成（来自 hover 预取或上一次切换），直接显示
        const cachedFull = _fullImageCache.get(originalUrl);
        if (cachedFull && cachedFull.complete && cachedFull.naturalWidth > 0) {
            img.src = originalUrl;
            originalWidth = cachedFull.naturalWidth;
            originalHeight = cachedFull.naturalHeight;
            if (res) {
                res.style.display = '';
                res.textContent = `${originalWidth}×${originalHeight} (${currentIndex + 1}/${imageList.length})`;
            }
            applyZoom();
        } else {
            // 先用 1280px 缩略图占位（走 media-preview 缓存，几乎秒出）
            img.src = '/api/media-preview?w=1280&url=' + encodeURIComponent(originalUrl);
            // 缩略图到达时记录尺寸，让缩放在缩略图阶段也能用；原图到达后会再覆写一次
            img.onload = () => {
                if (originalWidth === 0 && _pendingFullUrl === originalUrl) {
                    originalWidth = img.naturalWidth;
                    originalHeight = img.naturalHeight;
                    if (res) {
                        res.style.display = '';
                        res.textContent = `${originalWidth}×${originalHeight} (${currentIndex + 1}/${imageList.length})`;
                    }
                }
            };
            // 后台预取原图
            const fullImg = new Image();
            fullImg.onload = () => {
                _fullImageCache.set(originalUrl, fullImg);
                // 仅当用户还停留在这张图时才替换（避免快速切图时闪烁）
                if (_pendingFullUrl === originalUrl) {
                    const liveImg = document.getElementById('lightboxImg');
                    if (liveImg) {
                        liveImg.src = originalUrl;
                        originalWidth = fullImg.naturalWidth;
                        originalHeight = fullImg.naturalHeight;
                        if (res) {
                            res.style.display = '';
                            res.textContent = `${originalWidth}×${originalHeight} (${currentIndex + 1}/${imageList.length})`;
                        }
                        applyZoom();
                    }
                }
            };
            fullImg.onerror = () => {
                // 原图加载失败，缩略图保留显示，不报错打扰用户
            };
            fullImg.src = originalUrl;
        }

        // 切图后回调：把当前 index / url / prompt 通知上层
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
        img.style.transform = `scale(${currentScale}) translate(${panX}px, ${panY}px)`;
        img.style.transformOrigin = 'center center';
        img.style.cursor = currentScale > 1 ? 'grab' : 'default';
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
        applyZoom();
    }

    function zoomOut() {
        const newScale = Math.max(0.15, currentScale / 1.12);
        currentScale = newScale;
        applyZoom();
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
            document.body.style.overflow = '';
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
        _pendingFullUrl = null;
        // 关闭时清空预取缓存，避免长会话内存累积（原图可能数 MB × 数十张）
        _fullImageCache.clear();
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
