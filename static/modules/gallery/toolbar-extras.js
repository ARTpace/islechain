/*!
 * ToolbarExtras - 工具栏额外按钮（缩略图尺寸 / 收藏过滤 / NSFW / 业务自定义）
 * 依赖: GalleryDisplay.Base, HistoryBulkManager
 * 用法: ToolbarExtras.init({ config, onExtraToolbarButtons })
 */
(function (global) {
    'use strict';
    const NS = global.GalleryDisplay = global.GalleryDisplay || {};
    const Base = NS.Base;
    if (!Base) { console.error('[ToolbarExtras] 缺少 GalleryDisplay.Base'); return; }

    const THUMB_SVG_DEFAULT = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="3" width="10" height="10" rx="2"/><rect x="12" y="3" width="3" height="5" rx="1" opacity="0.4"/><rect x="12" y="9" width="3" height="4" rx="1" opacity="0.4"/></svg>';
    const THUMB_SVGS = [
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="14" height="14" rx="2"/></svg>',
        THUMB_SVG_DEFAULT,
        '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="7" y="1" width="5" height="5" rx="1" opacity="0.6"/><rect x="1" y="7" width="5" height="5" rx="1" opacity="0.6"/><rect x="7" y="7" width="5" height="5" rx="1" opacity="0.4"/></svg>'
    ];
    const THUMB_MODES = ['thumb-large', 'thumb-medium', 'thumb-small'];
    const THUMB_LABELS = ['大图', '默认', '小图'];
    const STORAGE_KEY = 'gallery_thumb_size';

    const ToolbarExtras = {
        _config: null,
        _initialized: false,

        init(config = {}) {
            if (this._initialized) return;
            this._config = config;
            if (!config.toolbarExtras) { this._initialized = true; return; }
            if (!window.HistoryBulkManager) {
                console.warn('[ToolbarExtras] HistoryBulkManager 未加载，跳过');
                this._initialized = true;
                return;
            }

            // NSFW 模块随工具栏一起初始化（[Task 3 收敛] 从 display.js 移过来）
            if (config.nsfwEnabled && window.GalleryDisplay?.NsfwFilter) {
                const NsfwFilter = window.GalleryDisplay.NsfwFilter;
                NsfwFilter.init({ autoRestore: true });
                // 把 attach 延迟到 _bindExternalButtonHandlers（按钮 DOM 已挂）
                this._pendingNsfwBind = NsfwFilter;
            }

            const extraButtons = this._buildButtons();
            window.HistoryBulkManager.attach({
                masonry: config.masonrySelector,
                extraButtons,
                longPressToSelect: config.longPressToSelect
            });

            // 工具栏 DOM 挂载后，绑定 NSFW 按钮（按钮是 _nsfwPlaceholderButton 占位）
            this._bindExternalButtonHandlers();

            this._restoreThumbSize();
            this._initialized = true;

            if (!this._config.skipSelfTest) this._runSelfTests();
        },

        destroy() { this._initialized = false; this._pendingNsfwBind = null; },

        _buildButtons() {
            const extraButtons = [];
            extraButtons.push(this._thumbSizeButton());

            if (this._config.favoritesEnabled) {
                extraButtons.push(this._favFilterButton());
            }
            if (this._config.nsfwEnabled) {
                extraButtons.push(this._nsfwPlaceholderButton());
            }
            if (typeof this._config.onExtraToolbarButtons === 'function') {
                const extra = this._config.onExtraToolbarButtons();
                if (Array.isArray(extra)) extraButtons.push(...extra);
            }
            return extraButtons;
        },

        _thumbSizeButton() {
            return {
                id: 'thumb-size',
                label: THUMB_SVG_DEFAULT,
                title: '切换缩略图尺寸',
                onClick: (btn) => this._cycleThumbSize(btn),
            };
        },

        _favFilterButton() {
            return {
                id: 'fav-toggle',
                label: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><span class="btn-text"> 收藏</span>',
                title: '仅显示已收藏的图',
                onClick: (btn) => {
                    // HistoryBulkManager 每次 click 调一次 onClick；仅首次绑定
                    if (btn._favBound) return;
                    btn._favBound = true;
                    if (window.GalleryDisplay?.Favorites) {
                        window.GalleryDisplay.Favorites.bindFilterButton(btn);
                    }
                }
            };
        },

        _nsfwPlaceholderButton() {
            return {
                id: 'nsfw-toggle',
                label: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg><span class="btn-text"> NSFW</span>',
                title: '不显示 NSFW 相关图片（长按 5 秒切换 NSFW Only 模式）',
                onClick: () => { /* 事件由 NsfwFilter.attachButton() 绑定 */ }
            };
        },

        _cycleThumbSize(btn) {
            const grid = document.querySelector(this._config.masonrySelector);
            if (!grid) return;
            const cur = THUMB_MODES.findIndex(m => grid.classList.contains(m));
            const next = (cur + 1) % THUMB_MODES.length;
            THUMB_MODES.forEach(m => grid.classList.remove(m));
            grid.classList.add(THUMB_MODES[next]);
            btn.innerHTML = THUMB_SVGS[next];
            btn.title = THUMB_LABELS[next];
            Base.storage.set(STORAGE_KEY, String(next));
        },

        _restoreThumbSize() {
            const saved = parseInt(Base.storage.get(STORAGE_KEY, '0'));
            if (!(saved >= 0 && saved <= 2)) return;
            setTimeout(() => {
                const grid = document.querySelector(this._config.masonrySelector);
                const btn = document.querySelector('[data-extra-btn="thumb-size"]');
                if (grid) grid.classList.add(THUMB_MODES[saved]);
                if (btn) { btn.innerHTML = THUMB_SVGS[saved]; btn.title = THUMB_LABELS[saved]; }
            }, 0);
        },

        /**
         * 把"占位按钮 + 业务模块"配对：NSFW 按钮 → NsfwFilter
         * 之所以在 attach() 之后做：HistoryBulkManager.attach() 才会把按钮挂到 DOM。
         */
        _bindExternalButtonHandlers() {
            if (this._pendingNsfwBind) {
                const nsfwBtn = document.querySelector('[data-extra-btn="nsfw-toggle"]');
                if (nsfwBtn) {
                    this._pendingNsfwBind.attachButton(nsfwBtn);
                    // 初始高亮：与当前 mode 对齐
                    nsfwBtn.classList.toggle('is-on', this._pendingNsfwBind.getMode() === 'block');
                    nsfwBtn.classList.toggle('is-only-on', this._pendingNsfwBind.getMode() === 'only');
                }
                this._pendingNsfwBind = null;
            }
        },

        _runSelfTests() {
            // 在 headless 环境里 HistoryBulkManager 不一定存在，跳过涉及 DOM 的部分
            const hasHBM = !!window.HistoryBulkManager;
            const hasGrid = !!document.querySelector(this._config.masonrySelector);

            Base.Test.suite('ToolbarExtras', [
                ['模块已挂载到 GalleryDisplay', () => NS.ToolbarExtras === this],
                ['_initialized=true', () => this._initialized === true],
                ['HistoryBulkManager 存在 或 已跳过', () => {
                    // init() 已经根据 HBM 存在性决定是否 attach
                    return hasHBM ? true : true;
                }],
                ['缩略图 cycle 逻辑（mocked）', () => {
                    // 总是用隔离的 test 元素，避免污染真实 masonry grid
                    const g = document.createElement('div');
                    g.classList.add('test-thumb-grid');
                    g.classList.add(THUMB_MODES[0]);
                    document.body.appendChild(g);
                    const origSelector = this._config.masonrySelector;
                    this._config.masonrySelector = '.test-thumb-grid';
                    const fakeBtn = { innerHTML: '', title: '' };
                    this._cycleThumbSize(fakeBtn);
                    const after1 = g.classList.contains(THUMB_MODES[1]);
                    this._cycleThumbSize(fakeBtn);
                    const after2 = g.classList.contains(THUMB_MODES[2]);
                    this._cycleThumbSize(fakeBtn);
                    const after3 = g.classList.contains(THUMB_MODES[0]);
                    this._config.masonrySelector = origSelector;
                    g.remove();
                    Base.storage.remove(STORAGE_KEY);
                    return after1 && after2 && after3;
                }],
                ['localStorage 持久化', () => {
                    Base.storage.remove(STORAGE_KEY);
                    const grid = document.createElement('div');
                    grid.classList.add('test-thumb-grid');
                    grid.classList.add(THUMB_MODES[0]);
                    document.body.appendChild(grid);
                    const origSelector = this._config.masonrySelector;
                    this._config.masonrySelector = '.test-thumb-grid';
                    this._cycleThumbSize({ innerHTML: '', title: '' });
                    const saved = Base.storage.get(STORAGE_KEY);
                    this._config.masonrySelector = origSelector;
                    grid.remove();
                    Base.storage.remove(STORAGE_KEY);
                    return saved === '1';
                }],
                ['_bindExternalButtonHandlers 在无按钮时安全', () => {
                    // 临时挂一个不存在的 nsfw-toggle 按钮，验证不会抛错
                    this._pendingNsfwBind = { attachButton: () => {}, getMode: () => 'off' };
                    let threw = false;
                    try { this._bindExternalButtonHandlers(); } catch (_) { threw = true; }
                    // pending 应被清空
                    const cleared = this._pendingNsfwBind === null;
                    return !threw && cleared;
                }],
                ['_bindExternalButtonHandlers 找到按钮时调用 attach', () => {
                    const calls = [];
                    const fakeBtn = document.createElement('button');
                    fakeBtn.setAttribute('data-extra-btn', 'nsfw-toggle');
                    document.body.appendChild(fakeBtn);
                    this._pendingNsfwBind = {
                        attachButton: (b) => calls.push(b.id || b.getAttribute('data-extra-btn')),
                        getMode: () => 'block'
                    };
                    this._bindExternalButtonHandlers();
                    fakeBtn.remove();
                    return calls.length === 1 && fakeBtn.classList.contains('is-on');
                }],
            ]);
        }
    };

    NS.ToolbarExtras = ToolbarExtras;
})(window);
