// ponytail: 原生观察器 + 有界队列，不代理远程图片、不修改缓存 URL。
function createPresetThumbnailLoader(root) {
    let active = 0;
    const pending = new Map();
    let watched = new WeakSet();
    const observer = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const bounds = entry.rootBounds;
                    pending.set(entry.target, Math.abs(entry.boundingClientRect.top - (bounds ? bounds.top + 400 : 0)));
                } else {
                    pending.delete(entry.target);
                }
            }
            drain();
        }, { root, rootMargin: '400px 0px' }) : null;

    function drain() {
        const sorted = [...pending].sort((a, b) => a[1] - b[1]);
        for (const [img] of sorted) {
            if (active >= 4) break;
            pending.delete(img);
            if (!img.isConnected || !root.contains(img) || !img.dataset.presetSrc) continue;
            if (observer) observer.unobserve(img);
            active++;
            const done = () => {
                img.removeEventListener('load', done);
                img.removeEventListener('error', done);
                active--;
                drain();
            };
            img.addEventListener('load', done);
            img.addEventListener('error', done);
            img.loading = 'eager';
            img.decoding = 'async';
            img.src = img.dataset.presetSrc;
            delete img.dataset.presetSrc;
        }
    }

    return {
        reset() {
            if (observer) observer.disconnect();
            pending.clear();
            watched = new WeakSet();
        },
        watch() {
            root.querySelectorAll('img[data-preset-src]').forEach(img => {
                if (watched.has(img)) return;
                watched.add(img);
                if (observer) observer.observe(img);
                else pending.set(img, 0);
            });
            drain();
        }
    };
}
