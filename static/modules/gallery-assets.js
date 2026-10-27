/* 生成图库与资产库共用展示区，复用资产库现有交互。 */
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('assetLibraryOverlay');
    const gallery = document.querySelector('main');
    if (!overlay || !gallery) return;
    const originalHost = overlay.parentElement;
    let active = false;
    function showAssets(on) {
        active = on;
        document.body.classList.toggle('gallery-assets-active', on);
        document.getElementById('galleryAssetsToggle')?.setAttribute('aria-pressed', String(on));
        gallery.hidden = on;
        gallery.style.display = on ? 'none' : '';
        if (on) {
            gallery.after(overlay);
            overlay.classList.add('gallery-assets-embedded');
            overlay.querySelector('.ap-panel').setAttribute('aria-modal', 'false');
            AssetLibrary.open({ kind:'image' });
            document.body.classList.remove('ap-overlay-open');
        } else {
            AssetLibrary.close();
            overlay.classList.remove('gallery-assets-embedded');
            overlay.querySelector('.ap-panel').setAttribute('aria-modal', 'true');
            originalHost.appendChild(overlay);
        }
    }
    function mountToggle() {
        const favorite = document.querySelector('[data-extra-btn="fav-toggle"]');
        if (!favorite || document.getElementById('galleryAssetsToggle')) return;
        const button = document.createElement('button');
        button.id = 'galleryAssetsToggle';
        button.type = 'button';
        button.className = favorite.className;
        button.title = '切换生成图 / 资产图';
        button.setAttribute('aria-pressed', String(active));
        button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h7l2-3h9v16H3z"/></svg><span class="btn-text">资产图</span>';
        button.onclick = () => showAssets(!active);
        favorite.after(button);
    }
    new MutationObserver(mountToggle).observe(document.body, { childList:true, subtree:true });
    new MutationObserver(() => {
        if (active && !overlay.classList.contains('open')) showAssets(false);
    }).observe(overlay, { attributes:true, attributeFilter:['class'] });
    // 原资产入口也进入统一展示区，收藏则返回生成图筛选。
    document.getElementById('refImageAssetBtn')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        showAssets(true);
        document.querySelector('.chat-drawer')?.classList.add('open');
        document.getElementById('chatGalleryBtn')?.classList.add('active');
    }, true);
    document.addEventListener('click', event => {
        if (active && event.target.closest?.('[data-extra-btn="fav-toggle"]')) showAssets(false);
    }, true);
    mountToggle();
});
