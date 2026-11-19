/* Reusable image card. Original URLs and natural dimensions remain authoritative. */
(() => {
    'use strict';
    function createImage({src, ratio, previewSrc = value => value, bindZoom}) {
        const card = document.createElement('div');
        card.className = 'chat-image-card chat-gen-media';
        card.style.aspectRatio = ratio || '1 / 1';
        const img = document.createElement('img');
        img.alt = '生成图';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.className = 'chat-image-content';
        // 请求比例只用于加载前占位，返回图片的实际尺寸才决定边框比例。
        img.addEventListener('load', function () {
            if (img.naturalWidth && img.naturalHeight) card.style.aspectRatio = img.naturalWidth + ' / ' + img.naturalHeight;
        }, { once: true });
        img.setAttribute('data-original-src', src);
        img.src = previewSrc(src);
        if (bindZoom) bindZoom(img);
        card.appendChild(img);
        return {card, img};
    }
    window.ChatMedia = {createImage};
})();
