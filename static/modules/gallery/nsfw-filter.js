/*!
 * NsfwFilter - NSFW 图片屏蔽 / NSFW Only 模式
 * 依赖: GalleryDisplay.Base
 * 状态: localStorage['gallery_nsfw_block'] = '0' | '1'
 *       localStorage['gallery_nsfw_only'] = '0' | '1'
 */
(function (global) {
    'use strict';
    const NS = global.GalleryDisplay = global.GalleryDisplay || {};
    const Base = NS.Base;
    if (!Base) { console.error('[NsfwFilter] 缺少 GalleryDisplay.Base'); return; }

    const CSS_ID = 'gallery-nsfw-filter-css';
    const STORAGE_KEY_BLOCK = 'gallery_nsfw_block';
    const STORAGE_KEY_ONLY  = 'gallery_nsfw_only';

    const CSS = `
/* === NSFW 屏蔽：彻底隐藏卡片，避免空白分隔线 === */
body.nsfw-mode .masonry-item[data-nsfw="1"] { display: none !important; }
/* === NSFW Only：仅显示 NSFW 图片 === */
body.nsfw-only-mode .masonry-item:not([data-nsfw="1"]) { display: none !important; }
body.nsfw-only-mode .date-separator { display: none !important; }
/* === NSFW 按钮长按进度指示器 === */
.nsfw-longpress-progress {
    position: absolute; left: 0; top: 0; height: 100%; width: 0;
    background: rgba(239, 68, 68, 0.35); border-radius: inherit;
    transition: width 0.1s linear; pointer-events: none;
}
.nsfw-longpress-progress.active { animation: nsfwLongPressFill 5s linear forwards; }
@keyframes nsfwLongPressFill { from { width: 0; } to { width: 100%; } }
.nsfw-pulsing { animation: nsfwPulseBg 1s ease-in-out infinite alternate !important; }
@keyframes nsfwPulseBg {
    from { background: rgba(255, 255, 255, 0.9); }
    to   { background: rgba(239, 68, 68, 0.9); }
}`;

    const NsfwFilter = {
        _config: null,
        _initialized: false,
        _buttonEl: null,
        _cleanup: null,
        _longPressTimer: null,

        init(config = {}) {
            if (this._initialized) return;
            this._config = Object.assign({
                autoRestore: true,
                defaultBlock: true
            }, config);

            Base.injectCSS(CSS_ID, CSS);
            if (this._config.autoRestore) this._restorePreferences();
            this._initialized = true;
        },

        destroy() {
            document.body.classList.remove('nsfw-mode', 'nsfw-only-mode');
            this._unbindButton();
            this._initialized = false;
        },

        /** 注册工具栏按钮（由 toolbar-extras 调用或外部直接调用） */
        attachButton(buttonEl) {
            if (!buttonEl) return;
            this._unbindButton();
            this._buttonEl = buttonEl;

            const onClick = (e) => {
                // 长按触发的 Only 切换已在长按回调中完成，此处阻止 click 重复
                if (global.__nsfwLongPressTriggered) {
                    global.__nsfwLongPressTriggered = false;
                    return;
                }
                this.toggle();
            };

            const startPress = (e) => {
                if (e.cancelable) e.preventDefault();
                this._showProgress(buttonEl);
                this._longPressTimer = setTimeout(() => {
                    global.__nsfwLongPressTriggered = true;
                    this._toggleOnlyMode();
                }, 5000);
            };
            const cancelPress = () => {
                this._hideProgress(buttonEl);
                if (this._longPressTimer) {
                    clearTimeout(this._longPressTimer);
                    this._longPressTimer = null;
                }
            };

            buttonEl.addEventListener('click', onClick);
            buttonEl.addEventListener('mousedown', startPress);
            buttonEl.addEventListener('mouseup', cancelPress);
            buttonEl.addEventListener('mouseleave', cancelPress);
            buttonEl.addEventListener('touchstart', startPress, { passive: true });
            buttonEl.addEventListener('touchend', cancelPress);
            buttonEl.addEventListener('touchcancel', cancelPress);

            this._cleanup = () => {
                buttonEl.removeEventListener('click', onClick);
                ['mousedown', 'mouseup', 'mouseleave', 'touchstart', 'touchend', 'touchcancel']
                    .forEach(evt => buttonEl.removeEventListener(evt, startPress));
                cancelPress();
            };
        },

        _unbindButton() {
            if (this._cleanup) { this._cleanup(); this._cleanup = null; }
            this._buttonEl = null;
        },

        /** 切换普通屏蔽模式 */
        toggle() {
            const on = !document.body.classList.contains('nsfw-mode');
            document.body.classList.toggle('nsfw-mode', on);
            document.body.classList.remove('nsfw-only-mode');
            Base.storage.set(STORAGE_KEY_BLOCK, on ? '1' : '0');
            Base.storage.remove(STORAGE_KEY_ONLY);
            Base.bus.emit('nsfw:change', { mode: on ? 'block' : 'off' });
        },

        /** 切换 Only 模式（长按触发） */
        _toggleOnlyMode() {
            const isOnly = !document.body.classList.contains('nsfw-only-mode');
            document.body.classList.toggle('nsfw-only-mode', isOnly);
            document.body.classList.remove('nsfw-mode');
            if (isOnly) {
                Base.storage.set(STORAGE_KEY_ONLY, '1');
                Base.storage.set(STORAGE_KEY_BLOCK, '0');
            } else {
                Base.storage.remove(STORAGE_KEY_ONLY);
            }
            this._hideProgress(this._buttonEl);
            Base.bus.emit('nsfw:change', { mode: isOnly ? 'only' : 'off' });
        },

        _showProgress(btn) {
            if (!btn || btn.querySelector('.nsfw-longpress-progress')) return;
            btn.style.position = 'relative';
            const p = document.createElement('div');
            p.className = 'nsfw-longpress-progress active';
            btn.appendChild(p);
            btn.classList.add('nsfw-pulsing');
        },

        _hideProgress(btn) {
            if (!btn) return;
            btn.classList.remove('nsfw-pulsing');
            const p = btn.querySelector('.nsfw-longpress-progress');
            if (p) p.remove();
        },

        _restorePreferences() {
            const blockVal = Base.storage.get(STORAGE_KEY_BLOCK);
            if (blockVal === null || blockVal === '1') {
                document.body.classList.add('nsfw-mode');
            }
            if (Base.storage.get(STORAGE_KEY_ONLY) === '1') {
                document.body.classList.add('nsfw-only-mode');
                document.body.classList.remove('nsfw-mode');
            }
        },

        /** 查询当前模式 */
        getMode() {
            if (document.body.classList.contains('nsfw-only-mode')) return 'only';
            if (document.body.classList.contains('nsfw-mode')) return 'block';
            return 'off';
        }
    };

    NS.NsfwFilter = NsfwFilter;
})(window);
