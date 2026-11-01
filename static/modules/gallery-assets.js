/* 生成图库与资产库共用展示区，复用资产库现有交互。 */
document.addEventListener('DOMContentLoaded', () => {
    const gallery = document.querySelector('main');
    if (!window.AssetLibrary || !gallery) return;
    const frame = document.createElement('iframe');
    frame.title = '资产库';
    frame.className = 'gallery-assets-embedded';
    frame.hidden = true;
    frame.style.cssText = 'width:100%;flex:1;min-height:0;border:0;';
    let active = false;
    function showAssets(on) {
        active = on;
        document.body.classList.toggle('gallery-assets-active', on);
        document.getElementById('galleryAssetsToggle')?.setAttribute('aria-pressed', String(on));
        gallery.hidden = on;
        gallery.style.display = on ? 'none' : '';
        if (on) {
            gallery.after(frame);
            if (!frame.hasAttribute('src')) frame.src = '/static/asset-manager.html?picker=image';
            frame.hidden = false;
        } else {
            frame.hidden = true;
        }
    }
    // 两个生成模式都进入真实资产库，保留原来的参考图导入流程。
    AssetLibrary.open = () => {
        showAssets(true);
        document.querySelector('.chat-drawer')?.classList.add('open');
        document.getElementById('chatGalleryBtn')?.classList.add('active');
    };
    AssetLibrary.close = () => showAssets(false);
    window.addEventListener('message', event => {
        if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
        if (event.data?.type !== 'asset-library:apply' || typeof event.data.url !== 'string') return;
        if (typeof applyAssetToRef === 'function') applyAssetToRef(event.data.url, event.data.name);
        showAssets(false);
    });
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
