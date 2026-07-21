/*!
 * AutoScan - 定时扫描 /api/gallery/scan-new 自动导入新图片
 * 依赖: GalleryDisplay.Base
 * 用法: AutoScan.init({ historyType, initialDelay, intervalMs, getToken })
 */
(function (global) {
    'use strict';
    const NS = global.GalleryDisplay = global.GalleryDisplay || {};
    const Base = NS.Base;
    if (!Base) { console.error('[AutoScan] 缺少 GalleryDisplay.Base'); return; }

    const AutoScan = {
        _config: null,
        _initialized: false,
        _initialTimer: null,
        _intervalTimer: null,
        _scanning: false,

        init(config = {}) {
            if (this._initialized) return;
            this._config = Object.assign({
                historyType: '',
                initialDelay: 3000,    // 页面加载后多久首次扫描
                intervalMs: 60000,     // 之后每多少 ms 扫一次
                getToken: () => (Base.storage.get('xy_auth_token') || ''),
            }, config);

            this._scheduleInitial();
            this._scheduleInterval();
            this._initialized = true;

            if (!this._config.skipSelfTest) this._runSelfTests();
        },

        destroy() {
            if (this._initialTimer) { clearTimeout(this._initialTimer); this._initialTimer = null; }
            if (this._intervalTimer) { clearInterval(this._intervalTimer); this._intervalTimer = null; }
            this._initialized = false;
        },

        _scheduleInitial() {
            this._initialTimer = setTimeout(() => this.scanNewImages(), this._config.initialDelay);
        },

        _scheduleInterval() {
            this._intervalTimer = setInterval(() => this.scanNewImages(), this._config.intervalMs);
        },

        /**
         * 主动触发一次扫描（对外 API；也用于定时回调）
         * 防重入：扫描中再次调用直接忽略
         */
        async scanNewImages() {
            if (this._scanning) return null;
            this._scanning = true;
            try {
                const token = this._config.getToken();
                const url = '/api/gallery/scan-new?type=' + encodeURIComponent(this._config.historyType || '') + '&token=' + encodeURIComponent(token);
                const res = await fetch(url);
                if (!res.ok) return null;
                const data = await res.json();
                if (data.imported > 0) {
                    console.log('[AutoScan] 自动导入 ' + data.imported + ' 张新图片');
                    if (window.GalleryList) GalleryList.load(0);
                    Base.bus.emit('gallery:auto-imported', { count: data.imported });
                }
                return data;
            } catch (_) {
                return null;
            } finally {
                this._scanning = false;
            }
        },

        isScanning() { return this._scanning; },

        _runSelfTests() {
            // 用 fake timer 验证调度，不发真实请求
            let called = 0;
            const origScan = this.scanNewImages.bind(this);
            this.scanNewImages = async () => { called++; return null; };

            Base.Test.suite('AutoScan', [
                ['模块已挂载到 GalleryDisplay', () => NS.AutoScan === this],
                ['_initialized=true', () => this._initialized === true],
                ['初始定时器已设置', () => !!this._initialTimer],
                ['周期定时器已设置', () => !!this._intervalTimer],
                ['getToken 默认从 xy_auth_token 读', () => {
                    // 单元测试必须保留生产环境真实 token,否则会把用户的登录态清掉
                    const orig = Base.storage.get('xy_auth_token');
                    Base.storage.set('xy_auth_token', 'test-token-xyz');
                    const t = this._config.getToken();
                    if (orig == null) {
                        Base.storage.remove('xy_auth_token');
                    } else {
                        Base.storage.set('xy_auth_token', orig);
                    }
                    return t === 'test-token-xyz';
                }],
                ['destroy 清理定时器', () => {
                    this.destroy();
                    const cleaned = !this._initialTimer && !this._intervalTimer && !this._initialized;
                    // 重新初始化
                    this.init(Object.assign({}, this._config, { skipSelfTest: true }));
                    return cleaned;
                }],
            ]);

            this.scanNewImages = origScan;
        }
    };

    NS.AutoScan = AutoScan;
})(window);
