/* 生成图库与资产库共用展示区，复用资产库现有交互。
   资产图入口已整合进「提示词」面板：这里不再注入工具栏切换键，只保留展示区桥接（open/close）。 */
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
    // 收藏筛选键顺手退回生成图，避免停在资产视图
    document.addEventListener('click', event => {
        if (active && event.target.closest?.('[data-extra-btn="fav-toggle"]')) showAssets(false);
    }, true);
});
