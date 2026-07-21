/*!
 * ScrollTop - 回到顶部按钮
 * 依赖: GalleryDisplay.Base
 * 用法: ScrollTop.init({ mainSelector: '.main-content' })
 */
(function (global) {
    'use strict';
    const NS = global.GalleryDisplay = global.GalleryDisplay || {};
    const Base = NS.Base;
    if (!Base) { console.error('[ScrollTop] 缺少 GalleryDisplay.Base'); return; }

    const CSS_ID = 'gallery-scroll-top-css';
    const BUTTON_ID = 'galleryScrollToTop';
    const VISIBLE_THRESHOLD = 400;

    const CSS = `
#${BUTTON_ID} {
    position: fixed;
    bottom: 32px;
    right: 32px;
    z-index: 40;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    transition: all 0.3s ease;
    opacity: 0;
    pointer-events: none;
    border: none;
    cursor: pointer;
}
#${BUTTON_ID}.visible {
    opacity: 1;
    pointer-events: auto;
}
#${BUTTON_ID}:hover {
    background: rgba(0,0,0,0.8);
    transform: scale(1.1);
}`;

    const ScrollTop = {
        _initialized: false,
        _mainEl: null,
        _buttonEl: null,
        _ticking: false,
        _onScroll: null,

        init(config = {}) {
            if (this._initialized) return;
            this._config = Object.assign({ mainSelector: '.main-content' }, config);

            Base.injectCSS(CSS_ID, CSS);
            this._createButton();
            this._bindScroll();
            this._initialized = true;

            if (!this._config.skipSelfTest) this._runSelfTests();
        },

        destroy() {
            if (this._buttonEl) { this._buttonEl.remove(); this._buttonEl = null; }
            if (this._mainEl && this._onScroll) {
                this._mainEl.removeEventListener('scroll', this._onScroll);
            }
            this._onScroll = null;
            this._mainEl = null;
            this._initialized = false;
        },

        _createButton() {
            if (document.getElementById(BUTTON_ID)) return;
            const btn = document.createElement('button');
            btn.id = BUTTON_ID;
            btn.type = 'button';
            btn.title = '回到顶部';
            btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`;
            btn.addEventListener('click', () => this.scrollToTop());
            document.body.appendChild(btn);
            this._buttonEl = btn;
        },

        _bindScroll() {
            this._mainEl = document.querySelector(this._config.mainSelector);
            if (!this._mainEl || !this._buttonEl) return;
            this._onScroll = () => {
                if (this._ticking) return;
                this._ticking = true;
                window.requestAnimationFrame(() => {
                    this._buttonEl.classList.toggle('visible', this._mainEl.scrollTop > VISIBLE_THRESHOLD);
                    this._ticking = false;
                });
            };
            this._mainEl.addEventListener('scroll', this._onScroll);
        },

        scrollToTop() {
            if (this._mainEl) {
                this._mainEl.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                // fallback: 主元素未找到时滚 window
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        },

        _runSelfTests() {
            const snapshotBtn = !!document.getElementById(BUTTON_ID);
            Base.Test.suite('ScrollTop', [
                ['模块已挂载到 GalleryDisplay', () => NS.ScrollTop === this],
                ['CSS 已注入', () => !!document.getElementById(CSS_ID)],
                ['按钮 DOM 已创建', () => !!this._buttonEl],
                ['按钮 id 正确', () => this._buttonEl?.id === BUTTON_ID],
                ['主元素已绑定', () => !!this._mainEl],
                ['scrollToTop() 是函数', () => typeof this.scrollToTop === 'function'],
                ['VISIBLE_THRESHOLD 边界', () => {
                    // 模拟滚动到 500px 应显示
                    if (!this._mainEl || !this._buttonEl) return true;
                    this._mainEl.scrollTop = 500;
                    this._onScroll(); // 同步触发（rAF 异步）
                    // requestAnimationFrame 异步，需手动调用内部逻辑
                    this._buttonEl.classList.toggle('visible', this._mainEl.scrollTop > VISIBLE_THRESHOLD);
                    const visible = this._buttonEl.classList.contains('visible');
                    this._mainEl.scrollTop = 100;
                    this._buttonEl.classList.toggle('visible', this._mainEl.scrollTop > VISIBLE_THRESHOLD);
                    const hidden = !this._buttonEl.classList.contains('visible');
                    this._mainEl.scrollTop = 0; // 还原
                    return visible && hidden;
                }],
            ]);
        }
    };

    NS.ScrollTop = ScrollTop;
})(window);
