/*!
 * Favorites - 收藏过滤 + 收藏状态
 * 依赖: GalleryDisplay.Base
 * 用法: Favorites.init({ storageKey, filterStorageKey, filterButtonSelector })
 */
(function (global) {
    'use strict';
    const NS = global.GalleryDisplay = global.GalleryDisplay || {};
    const Base = NS.Base;
    if (!Base) { console.error('[Favorites] 缺少 GalleryDisplay.Base'); return; }

    const Favorites = {
        _config: null,
        _initialized: false,
        _filterOn: false,

        init(config = {}) {
            if (this._initialized) return;
            this._config = Object.assign({
                storageKey: 'gallery_favorites',
                filterStorageKey: 'gallery_fav_mode',
            }, config);

            this._loadFromStorage();
            this._restoreFilterMode();
            this._initialized = true;

            if (!this._config.skipSelfTest) this._runSelfTests();
        },

        destroy() {
            document.body.classList.remove('fav-mode');
            this._initialized = false;
        },

        /** 读取 localStorage 到 window.__galleryFavorites（兼容 actions.js 写入路径） */
        _loadFromStorage() {
            try {
                const raw = Base.storage.get(this._config.storageKey, '[]');
                const arr = JSON.parse(raw) || [];
                // 迁移旧格式：纯数字 timestamp
                if (arr.length > 0 && arr.every(s => /^\d+$/.test(String(s)))) {
                    console.log('[Favorites] 迁移旧收藏格式, 已清空');
                    Base.storage.remove(this._config.storageKey);
                    window.__galleryFavorites = new Set();
                } else {
                    window.__galleryFavorites = new Set(arr.map(String));
                }
            } catch (_) {
                window.__galleryFavorites = new Set();
            }
        },

        _restoreFilterMode() {
            const v = Base.storage.get(this._config.filterStorageKey, '0');
            this._filterOn = (v === '1');
            document.body.classList.toggle('fav-mode', this._filterOn);
        },

        // === 查询 API ===

        isFav(url) {
            return (window.__galleryFavorites || new Set()).has(url);
        },

        has(url) { return this.isFav(url); },

        getAll() {
            return Array.from(window.__galleryFavorites || []);
        },

        getFilterMode() { return this._filterOn; },

        // === 过滤模式 ===

        setFilterMode(on, { silent = false } = {}) {
            this._filterOn = !!on;
            document.body.classList.toggle('fav-mode', this._filterOn);
            if (!silent) {
                Base.storage.set(this._config.filterStorageKey, this._filterOn ? '1' : '0');
            }
            Base.bus.emit('fav:filter', { on: this._filterOn });
        },

        toggleFilter() { this.setFilterMode(!this._filterOn); },

        // === 工具栏按钮绑定 ===

        bindFilterButton(btn) {
            if (!btn) return;
            // 初始高亮
            btn.classList.toggle('is-on', this._filterOn);
            btn.addEventListener('click', () => {
                this.toggleFilter();
                btn.classList.toggle('is-on', this._filterOn);
                if (this._filterOn) this._triggerLazyLoad();
            });
        },

        // 开启过滤后强制懒加载图片（兼容原行为）
        _triggerLazyLoad() {
            setTimeout(() => {
                document.querySelectorAll('.masonry-item[data-fav="1"] img[loading="lazy"]').forEach(img => {
                    if (!img.complete) { const src = img.src; img.src = ''; img.src = src; }
                });
            }, 50);
        },

        _runSelfTests() {
            const snapshot = {
                bodyFav: document.body.classList.contains('fav-mode'),
                storage: Base.storage.get(this._config.filterStorageKey),
                set: [...(window.__galleryFavorites || [])],
            };
            const restore = () => {
                document.body.classList.toggle('fav-mode', snapshot.bodyFav);
                if (snapshot.storage === null) Base.storage.remove(this._config.filterStorageKey);
                else Base.storage.set(this._config.filterStorageKey, snapshot.storage);
                window.__galleryFavorites = new Set(snapshot.set);
            };

            Base.Test.suite('Favorites', [
                ['模块已挂载到 GalleryDisplay', () => NS.Favorites === this],
                ['init 后 _initialized=true', () => this._initialized],
                ['window.__galleryFavorites 是 Set', () => window.__galleryFavorites instanceof Set],
                ['isFav() 对未收藏 url 返回 false', () => this.isFav('http://test/never') === false],
                ['isFav() 对已收藏 url 返回 true', () => {
                    const url = 'http://test/fav-' + Date.now();
                    window.__galleryFavorites.add(url);
                    const r = this.isFav(url);
                    window.__galleryFavorites.delete(url);
                    return r;
                }],
                ['setFilterMode 切换 body class', () => {
                    document.body.classList.remove('fav-mode');
                    this.setFilterMode(true, { silent: true });
                    const onState = this.getFilterMode() && document.body.classList.contains('fav-mode');
                    this.setFilterMode(false, { silent: true });
                    const offState = !this.getFilterMode() && !document.body.classList.contains('fav-mode');
                    return onState && offState;
                }],
                ['setFilterMode 持久化（speak false）', () => {
                    this.setFilterMode(true);
                    const wrote = Base.storage.get(this._config.filterStorageKey) === '1';
                    this.setFilterMode(false);
                    const cleared = Base.storage.get(this._config.filterStorageKey) === '0';
                    return wrote && cleared;
                }],
                ['setFilterMode silent 不写 localStorage', () => {
                    Base.storage.remove(this._config.filterStorageKey);
                    this.setFilterMode(true, { silent: true });
                    const notWrote = Base.storage.get(this._config.filterStorageKey) === null;
                    this.setFilterMode(false, { silent: true });
                    return notWrote;
                }],
                ['toggleFilter 反转状态', () => {
                    const before = this.getFilterMode();
                    this.toggleFilter();
                    const after = this.getFilterMode();
                    this.toggleFilter(); // 还原
                    return before !== after;
                }],
                ['getAll() 返回数组', () => Array.isArray(this.getAll())],
                ['事件总线 emit "fav:filter"', () => {
                    let received = null;
                    const off = Base.bus.on('fav:filter', p => { received = p; });
                    this.setFilterMode(true, { silent: true });
                    off();
                    this.setFilterMode(false, { silent: true });
                    return received && received.on === true;
                }],
            ]);

            restore();
        }
    };

    NS.Favorites = Favorites;
})(window);
