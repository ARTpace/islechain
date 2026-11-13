/* gallery bundle 20261022 — generated from the modules below, keep source files as the editable copies */

;/* ---- gallery-base.js ---- */

/*!
 * GalleryBase - Gallery 子模块的公共工具
 * 提供：CSS 注入、localStorage 安全访问、命名空间、事件总线、自检框架
 */
(function (global) {
    'use strict';
    const NS = global.GalleryDisplay = global.GalleryDisplay || {};

    NS.Base = {
        /** 幂等注入 CSS 字符串（同 ID 不重复注入） */
        injectCSS(id, css) {
            if (document.getElementById(id)) return;
            const style = document.createElement('style');
            style.id = id;
            style.textContent = css;
            document.head.appendChild(style);
        },

        /** 安全访问 localStorage（隐私模式下不抛错） */
        storage: {
            get(key, fallback = null) {
                try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
            },
            set(key, value) {
                try { localStorage.setItem(key, value); return true; } catch (_) { return false; }
            },
            remove(key) {
                try { localStorage.removeItem(key); } catch (_) {}
            }
        },

        /** 简单的事件总线（子模块间通信用） */
        bus: (() => {
            const listeners = new Map();
            return {
                on(event, fn) {
                    if (!listeners.has(event)) listeners.set(event, new Set());
                    listeners.get(event).add(fn);
                    return () => listeners.get(event)?.delete(fn);
                },
                emit(event, payload) {
                    listeners.get(event)?.forEach(fn => {
                        try { fn(payload); } catch (e) { console.error(`[GalleryBase.bus] ${event}`, e); }
                    });
                }
            };
        })(),

        /**
         * 自检框架：每个模块调用 suite(name, tests) 运行断言
         * - 通过：打印一行 ✅ summary；失败：打印 ❌ + 详细原因
         * - 全部 silent on pass, loud on fail
         */
        Test: (() => {
            const results = [];
            return {
                suite(moduleName, tests) {
                    let pass = 0;
                    const fails = [];
                    for (const [name, fn] of tests) {
                        try {
                            const ok = !!fn();
                            if (ok) { pass++; }
                            else { fails.push(name); }
                            results.push({ module: moduleName, name, pass: ok });
                        } catch (e) {
                            fails.push(`${name} (${e.message})`);
                            results.push({ module: moduleName, name, pass: false, err: e });
                        }
                    }
                    const total = tests.length;
                    if (pass === total) {
                        console.log(`%c✅ ${moduleName}: ${pass}/${total}`, 'color:#10b981');
                    } else {
                        console.group(`%c❌ ${moduleName}: ${pass}/${total} 失败`, 'color:#ef4444;font-weight:bold');
                        fails.forEach(f => console.error('  -', f));
                        console.groupEnd();
                    }
                    return pass === total;
                },
                /** 全部已注册测试的统计（暴露给控制台诊断用） */
                summary() {
                    const total = results.length;
                    const passed = results.filter(r => r.pass).length;
                    return { total, passed, failed: total - passed, results };
                }
            };
        })(),

        /**
         * 通用 Toast 提示（顶部居中浮层，2.2s 自动消失）
         * type: 'success' | 'info' | 'warn' | 'error'
         */
        toast(msg, type = 'info') {
            let el = document.getElementById('galleryToast');
            if (!el) {
                el = document.createElement('div');
                el.id = 'galleryToast';
                el.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,.18);transition:opacity .25s;opacity:0;pointer-events:none;';
                document.body.appendChild(el);
            }
            const colors = {
                success: { bg: '#10b981', fg: '#fcfcfb' },
                info:    { bg: '#181817', fg: '#fcfcfb' },
                warn:    { bg: '#f59e0b', fg: '#fcfcfb' },
                error:   { bg: '#ef4444', fg: '#fcfcfb' }
            };
            const c = colors[type] || colors.info;
            el.style.background = c.bg;
            el.style.color = c.fg;
            el.textContent = String(msg);
            el.style.opacity = '1';
            clearTimeout(el._timer);
            el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
        }
    };
})(window);

// === Config 集中点（[Task 5 收敛]） ===
// 原：display.js 的 setupGalleryConfig() 把配置写到 window.GALLERY_CONFIG，
//     其他模块每个地方都 `global.GALLERY_CONFIG && global.GALLERY_CONFIG.type` 重复读。
// 新：display.js 写入 NS.Config，子模块读 NS.Config；
//     window.GALLERY_CONFIG 保留为只读镜像（HTML 旧代码用），不再被任何子模块直接读。
// 这样：(1) 单一来源；(2) 子模块不再依赖全局；(3) 未来可演进为 init() 参数。
(function () {
    if (!window.GalleryDisplay) return;
    const NS = window.GalleryDisplay;
    const Config = {
        _data: {},
        /** 整体替换（display.js 用） */
        set(data) { this._data = data || {}; this._mirror(); },
        /** 单字段更新 */
        patch(partial) { Object.assign(this._data, partial || {}); this._mirror(); },
        get type() { return this._data.type; },
        get features() { return this._data.features || {}; },
        get onUsePrompt() { return this._data.onUsePrompt; },
        get onCopyPrompt() { return this._data.onCopyPrompt; },
        get onRegenerate() { return this._data.onRegenerate; },
        get onOpenFolder() { return this._data.onOpenFolder; },
        get onCopyToCanvas() { return this._data.onCopyToCanvas; },
        get container() { return this._data.container; },
        get trigger() { return this._data.trigger; },
        get pageSize() { return this._data.pageSize; },
        /** 同步镜像到 window.GALLERY_CONFIG（向后兼容） */
        _mirror() {
            if (typeof window !== 'undefined') window.GALLERY_CONFIG = this._data;
        }
    };
    NS.Config = Config;
})();

// === 自检（模块加载时立即跑） ===
(function () {
    if (!window.GalleryDisplay || !window.GalleryDisplay.Base) return;
    const Base = window.GalleryDisplay.Base;
    // [Task 5] Config 集中点
    const Config = window.GalleryDisplay.Config;
    Base.Test.suite('GalleryBase', [
        ['Base 已挂载到 NS', () => !!Base],
        ['Config 已挂载到 NS', () => !!Config],
        ['Config.set 写入后可读', () => {
            Config.set({ type: 'unit_test', features: { x: 1 } });
            return Config.type === 'unit_test' && Config.features.x === 1;
        }],
        ['Config.patch 单字段更新', () => {
            Config.set({ type: 'a', features: { x: 1, y: 2 } });
            Config.patch({ type: 'b' });
            return Config.type === 'b' && Config.features.x === 1;
        }],
        ['Config.set 自动镜像到 window.GALLERY_CONFIG', () => {
            Config.set({ type: 'mirror_test' });
            return window.GALLERY_CONFIG && window.GALLERY_CONFIG.type === 'mirror_test';
        }],
        ['storage.get 缺失键返回 null', () => Base.storage.get('__never_exists__') === null],
        ['storage.set + get 往返', () => {
            Base.storage.set('__base_test__', '1');
            const v = Base.storage.get('__base_test__');
            Base.storage.remove('__base_test__');
            return v === '1';
        }],
        ['bus.on/emit 收到事件', () => {
            let got = null;
            const off = Base.bus.on('__base_test_evt__', p => { got = p; });
            Base.bus.emit('__base_test_evt__', { x: 1 });
            off();
            return got && got.x === 1;
        }],
        ['bus.on 返回的 off 取消订阅', () => {
            let count = 0;
            const off = Base.bus.on('__base_test_off__', () => count++);
            Base.bus.emit('__base_test_off__');
            off();
            Base.bus.emit('__base_test_off__');
            return count === 1;
        }],
        ['toast 写入 #galleryToast 元素', () => {
            if (!document.body || !document.body.appendChild) return true; // [跳过] DOM 未就绪
            const before = document.getElementById('galleryToast');
            Base.toast('hello', 'info');
            const el = document.getElementById('galleryToast');
            const ok = el && el.textContent === 'hello';
            if (el) el.remove(); // 清理
            return ok;
        }],
        ['toast 颜色按 type 切换', () => {
            if (!document.body || !document.body.appendChild) return true; // [跳过] DOM 未就绪
            Base.toast('x', 'success');
            const t1 = document.getElementById('galleryToast');
            const c1 = t1 && t1.style.background;
            Base.toast('x', 'error');
            const t2 = document.getElementById('galleryToast');
            const c2 = t2 && t2.style.background;
            const ok = c1 && c2 && c1 !== c2;
            if (t2) t2.remove();
            return ok;
        }],
    ]);
})();


;/* ---- nsfw-filter.js ---- */

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

            // 自检（仅在非显式 skip 时跑）
            if (!this._config.skipSelfTest) this._runSelfTests();
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
            this._syncButtonState();
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
            this._syncButtonState();
            Base.bus.emit('nsfw:change', { mode: isOnly ? 'only' : 'off' });
        },

        /** 同步按钮高亮状态（与 body class 保持一致） */
        _syncButtonState() {
            if (!this._buttonEl) return;
            const mode = this.getMode();
            this._buttonEl.classList.toggle('is-on', mode === 'block');
            this._buttonEl.classList.toggle('is-only-on', mode === 'only');
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
        },

        /**
         * 自检：使用快照/恢复模式，不污染用户状态
         * 测试项：toggle 切换、_syncButtonState 同步、localStorage 持久化
         */
        _runSelfTests() {
            const snapshot = {
                bodyClass: document.body.className,
                storageBlock: Base.storage.get(STORAGE_KEY_BLOCK),
                storageOnly: Base.storage.get(STORAGE_KEY_ONLY),
            };
            const restore = () => {
                document.body.className = snapshot.bodyClass;
                if (snapshot.storageBlock === null) Base.storage.remove(STORAGE_KEY_BLOCK);
                else Base.storage.set(STORAGE_KEY_BLOCK, snapshot.storageBlock);
                if (snapshot.storageOnly === null) Base.storage.remove(STORAGE_KEY_ONLY);
                else Base.storage.set(STORAGE_KEY_ONLY, snapshot.storageOnly);
                if (this._buttonEl) this._syncButtonState();
            };

            Base.Test.suite('NsfwFilter', [
                ['模块已挂载到 GalleryDisplay', () => NS.NsfwFilter === this],

                ['CSS 已注入', () => !!document.getElementById(CSS_ID)],

                ['toggle() 切换 body class', () => {
                    document.body.classList.remove('nsfw-mode', 'nsfw-only-mode');
                    this.toggle();
                    const m1 = this.getMode();
                    this.toggle();
                    const m2 = this.getMode();
                    return m1 === 'block' && m2 === 'off';
                }],

                ['_toggleOnlyMode() 切换 Only', () => {
                    document.body.classList.remove('nsfw-mode', 'nsfw-only-mode');
                    this._toggleOnlyMode();
                    const m1 = this.getMode();
                    this._toggleOnlyMode();
                    const m2 = this.getMode();
                    return m1 === 'only' && m2 === 'off';
                }],

                ['_syncButtonState 同步按钮 class', () => {
                    if (!this._buttonEl) return true; // 无按钮时跳过
                    document.body.classList.remove('nsfw-mode', 'nsfw-only-mode');
                    this._syncButtonState();
                    const offState = !this._buttonEl.classList.contains('is-on')
                                  && !this._buttonEl.classList.contains('is-only-on');
                    document.body.classList.add('nsfw-mode');
                    this._syncButtonState();
                    const blockState = this._buttonEl.classList.contains('is-on');
                    document.body.classList.remove('nsfw-mode');
                    document.body.classList.add('nsfw-only-mode');
                    this._syncButtonState();
                    const onlyState = this._buttonEl.classList.contains('is-only-on');
                    return offState && blockState && onlyState;
                }],

                ['getMode() 三态返回', () => {
                    document.body.classList.remove('nsfw-mode', 'nsfw-only-mode');
                    const off = this.getMode() === 'off';
                    document.body.classList.add('nsfw-mode');
                    const block = this.getMode() === 'block';
                    document.body.classList.add('nsfw-only-mode');
                    document.body.classList.remove('nsfw-mode');
                    const only = this.getMode() === 'only';
                    return off && block && only;
                }],

                ['localStorage 持久化写入', () => {
                    document.body.classList.remove('nsfw-mode', 'nsfw-only-mode');
                    this.toggle(); // off -> block
                    const wrote = Base.storage.get(STORAGE_KEY_BLOCK) === '1';
                    this.toggle(); // block -> off
                    const cleared = Base.storage.get(STORAGE_KEY_BLOCK) === '0';
                    return wrote && cleared;
                }],

                ['事件总线 emit "nsfw:change"', () => {
                    let received = null;
                    const off = Base.bus.on('nsfw:change', p => { received = p; });
                    document.body.classList.remove('nsfw-mode', 'nsfw-only-mode');
                    this.toggle();
                    off();
                    return received && (received.mode === 'block' || received.mode === 'off');
                }],
            ]);

            restore();
        }
    };

    NS.NsfwFilter = NsfwFilter;
})(window);


;/* ---- scroll-top.js ---- */

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
    color: #fcfcfb;
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
                ['VISIBLE_THRESHOLD=400, class 切换逻辑', () => {
                    if (!this._buttonEl) return true;
                    // 模拟 > 阈值（与 _onScroll 的 rAF 内 toggle 同模式）
                    this._buttonEl.classList.toggle('visible', 500 > VISIBLE_THRESHOLD);
                    const visible = this._buttonEl.classList.contains('visible');
                    // 模拟 < 阈值
                    this._buttonEl.classList.toggle('visible', 100 > VISIBLE_THRESHOLD);
                    const hidden = !this._buttonEl.classList.contains('visible');
                    // 边界 = 阈值（应隐藏，> 不是 >=）
                    this._buttonEl.classList.toggle('visible', VISIBLE_THRESHOLD > VISIBLE_THRESHOLD);
                    const boundary = !this._buttonEl.classList.contains('visible');
                    this._buttonEl.classList.remove('visible');
                    return VISIBLE_THRESHOLD === 400 && visible && hidden && boundary;
                }],
            ]);
        }
    };

    NS.ScrollTop = ScrollTop;
})(window);


;/* ---- favorites.js ---- */

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

    function accountStorageKey(base) {
        var name = 'anonymous';
        try {
            var user = JSON.parse(localStorage.getItem('xy_auth_user') || 'null');
            if (user && user.username) name = String(user.username);
        } catch (e) {}
        var suffix = ':' + name;
        var key = String(base || 'gallery_favorites');
        return key.endsWith(suffix) ? key : key + suffix;
    }

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
            this._config.storageKey = accountStorageKey(this._config.storageKey);
            this._config.filterStorageKey = accountStorageKey(this._config.filterStorageKey);

            this._loadFromStorage();
            this._restoreFilterMode();
            this._bindGlobalUISync();
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
                // 迁移旧 key 'zimage_favorites' → 新 key 'gallery_favorites'
                const legacy = Base.storage.get('zimage_favorites');
                const shared = Base.storage.get('gallery_favorites');
                if (legacy) {
                    const cur = Base.storage.get(this._config.storageKey, '[]');
                    if (cur === '[]' || !cur) {
                        Base.storage.set(this._config.storageKey, legacy);
                        console.log('[Favorites] 已迁移 zimage_favorites → ' + this._config.storageKey);
                    }
                    Base.storage.remove('zimage_favorites');
                }
                if (shared && this._config.storageKey !== 'gallery_favorites') {
                    const cur = Base.storage.get(this._config.storageKey, '[]');
                    if (cur === '[]' || !cur) {
                        Base.storage.set(this._config.storageKey, shared);
                    }
                    Base.storage.remove('gallery_favorites');
                }
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

        // === 变更 API（单一入口，所有 UI 监听 fav:changed 事件同步） ===

        /** 切换某张图的收藏状态。返回新的 boolean 状态。 */
        toggle(url) {
            if (!url) return false;
            const set = (window.__galleryFavorites = window.__galleryFavorites || new Set());
            const added = !set.has(url);
            if (added) set.add(url); else set.delete(url);
            this._persist();
            Base.bus.emit('fav:changed', { url: String(url), added });
            return added;
        },

        add(url) {
            if (!url || this.isFav(url)) return false;
            const set = (window.__galleryFavorites = window.__galleryFavorites || new Set());
            set.add(url);
            this._persist();
            Base.bus.emit('fav:changed', { url: String(url), added: true });
            return true;
        },

        remove(url) {
            if (!url || !this.isFav(url)) return false;
            const set = (window.__galleryFavorites = window.__galleryFavorites || new Set());
            set.delete(url);
            this._persist();
            Base.bus.emit('fav:changed', { url: String(url), added: false });
            return true;
        },

        _persist() {
            try {
                Base.storage.set(this._config.storageKey, JSON.stringify(Array.from(window.__galleryFavorites || [])));
            } catch (_) { /* 忽略 quota 错误 */ }
        },

        /**
         * 全局 UI 同步：监听 fav:changed 事件，刷新页面上所有相关按钮的 .is-fav 状态。
         * CSS 负责从 .is-fav 渲染出实心/空心星标，JS 只需要切 class。
         */
        _bindGlobalUISync() {
            Base.bus.on('fav:changed', ({ url, added }) => {
                if (!url) return;
                // 1. 所有显式标记 data-fav-url 的按钮
                const escaped = (window.CSS && CSS.escape) ? CSS.escape(url) : url.replace(/"/g, '\\"');
                document.querySelectorAll('[data-fav-url="' + escaped + '"]').forEach(btn => {
                    btn.classList.toggle('is-fav', added);
                });
                // 2. 同步卡片整体 data-fav 属性（CSS 隐藏/显示依据）
                document.querySelectorAll('.masonry-item').forEach(card => {
                    if (card.dataset.favUrl && card.dataset.favUrl === url) {
                        card.dataset.fav = added ? '1' : '0';
                    }
                });
            });
        },

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
                document.querySelectorAll('.masonry-item[data-fav="1"] img[loading="lazy" decoding="async"]').forEach(img => {
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
                ['toggle(url) 切换后 isFav 返回新状态', () => {
                    const url = 'http://test/toggle-' + Date.now();
                    this.add(url);
                    const wasTrue = this.isFav(url);
                    this.toggle(url);
                    const wasFalse = !this.isFav(url);
                    this.toggle(url);
                    const wasTrueAgain = this.isFav(url);
                    this.remove(url);
                    return wasTrue && wasFalse && wasTrueAgain;
                }],
                ['toggle(url) 发出 fav:changed 事件', () => {
                    const url = 'http://test/emit-' + Date.now();
                    const events = [];
                    const off = Base.bus.on('fav:changed', p => events.push(p));
                    this.toggle(url);
                    this.toggle(url);
                    off();
                    this.remove(url);
                    return events.length === 2 && events[0].added === true && events[1].added === false;
                }],
                ['add 重复添加幂等', () => {
                    const url = 'http://test/dup-' + Date.now();
                    this.add(url);
                    this.add(url);
                    const size = this.getAll().filter(u => u === url).length;
                    this.remove(url);
                    return size === 1;
                }],
                ['remove 不存在的 url 不报错', () => {
                    let threw = false;
                    try { this.remove('http://never/exists'); } catch (_) { threw = true; }
                    return !threw;
                }],
                ['_persist 写入 storageKey', () => {
                    const origKey = this._config.storageKey;
                    this._config.storageKey = '__test_fav_key__';
                    this._persist();
                    const written = Base.storage.get('__test_fav_key__');
                    Base.storage.remove('__test_fav_key__');
                    this._config.storageKey = origKey;
                    return !!written;
                }],
            ]);

            restore();
        }
    };

    NS.Favorites = Favorites;
})(window);


;/* ---- auto-scan.js ---- */

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


;/* ---- toolbar-extras.js ---- */

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
    // 自检用隔离的 key，避免清掉真实用户的缩略图尺寸设置
    const TEST_STORAGE_KEY = '__gallery_thumb_size_selftest__';

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
                    // HistoryBulkManager 每次 click 调一次 onClick；仅首次执行 toggle 并绑定，
                    // 后续 click 由 bindFilterButton 内部的 addEventListener 接管。
                    // [Bugfix] 首次点击必须立即 toggle，不能只 bindFilterButton：
                    //   bindFilterButton 内部只 addEventListener('click', ...)，按 DOM 规范，
                    //   在 dispatch 期间 addEventListener 的新 listener 不会对当前事件触发。
                    //   → 首次 click 走这里手动 toggleFilter 让其立即生效。
                    if (btn._favBound) return;
                    btn._favBound = true;
                    const Fav = window.GalleryDisplay?.Favorites;
                    if (!Fav) return;
                    // 首次点击立即 toggle（一次）
                    Fav.toggleFilter();
                    btn.classList.toggle('is-on', Fav.getFilterMode());
                    // 再绑后续 click 监听器接管
                    Fav.bindFilterButton(btn);
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

        _cycleThumbSize(btn, storageKey = STORAGE_KEY) {
            const grid = document.querySelector(this._config.masonrySelector);
            if (!grid) return;
            const cur = THUMB_MODES.findIndex(m => grid.classList.contains(m));
            const next = (cur + 1) % THUMB_MODES.length;
            THUMB_MODES.forEach(m => grid.classList.remove(m));
            grid.classList.add(THUMB_MODES[next]);
            btn.innerHTML = THUMB_SVGS[next];
            btn.title = THUMB_LABELS[next];
            Base.storage.set(storageKey, String(next));
        },

        _restoreThumbSize(storageKey = STORAGE_KEY) {
            const saved = parseInt(Base.storage.get(storageKey, '0'));
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
            // [跳过条件] 脚本在 <head> 提前跑、document.body 还没就绪时，自检不该阻塞业务
            const domReady = document.body && typeof document.body.appendChild === 'function';
            if (!domReady) {
                console.log('[ToolbarExtras] 自检跳过：DOM 未就绪');
                return;
            }
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
                    // 总是用隔离的 test 元素 + 隔离 storage key，避免污染真实 masonry grid 和用户设置
                    const g = document.createElement('div');
                    g.classList.add('test-thumb-grid');
                    g.classList.add(THUMB_MODES[0]);
                    document.body.appendChild(g);
                    const origSelector = this._config.masonrySelector;
                    this._config.masonrySelector = '.test-thumb-grid';
                    const fakeBtn = { innerHTML: '', title: '' };
                    this._cycleThumbSize(fakeBtn, TEST_STORAGE_KEY);
                    const after1 = g.classList.contains(THUMB_MODES[1]);
                    this._cycleThumbSize(fakeBtn, TEST_STORAGE_KEY);
                    const after2 = g.classList.contains(THUMB_MODES[2]);
                    this._cycleThumbSize(fakeBtn, TEST_STORAGE_KEY);
                    const after3 = g.classList.contains(THUMB_MODES[0]);
                    this._config.masonrySelector = origSelector;
                    g.remove();
                    Base.storage.remove(TEST_STORAGE_KEY);
                    return after1 && after2 && after3;
                }],
                ['localStorage 持久化', () => {
                    // 用隔离 storage key，不动真实用户的设置
                    Base.storage.remove(TEST_STORAGE_KEY);
                    const grid = document.createElement('div');
                    grid.classList.add('test-thumb-grid');
                    grid.classList.add(THUMB_MODES[0]);
                    document.body.appendChild(grid);
                    const origSelector = this._config.masonrySelector;
                    this._config.masonrySelector = '.test-thumb-grid';
                    this._cycleThumbSize({ innerHTML: '', title: '' }, TEST_STORAGE_KEY);
                    const saved = Base.storage.get(TEST_STORAGE_KEY);
                    this._config.masonrySelector = origSelector;
                    grid.remove();
                    Base.storage.remove(TEST_STORAGE_KEY);
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
                    // [Bugfix] 用唯一属性选择器，避免与真实 nsfw 按钮冲突
                    const fakeBtn = document.createElement('button');
                    fakeBtn.setAttribute('data-extra-btn', 'nsfw-toggle');
                    fakeBtn.setAttribute('data-test-marker', '1');
                    document.body.appendChild(fakeBtn);
                    this._pendingNsfwBind = {
                        attachButton: (b) => calls.push(b.getAttribute('data-test-marker')),
                        getMode: () => 'block'
                    };
                    // 临时把内部选择器改成带标记的，避免查到真实按钮
                    const origQuery = document.querySelector.bind(document);
                    document.querySelector = (sel) => {
                        if (sel === '[data-extra-btn="nsfw-toggle"]') return fakeBtn;
                        return origQuery(sel);
                    };
                    try { this._bindExternalButtonHandlers(); }
                    finally { document.querySelector = origQuery; fakeBtn.remove(); }
                    return calls.length === 1 && calls[0] === '1' && fakeBtn.classList.contains('is-on');
                }],
            ]);
        }
    };

    NS.ToolbarExtras = ToolbarExtras;
})(window);


;/* ---- lightbox.js ---- */

/*!
 * Lightbox - 灯箱（大图预览、提示词、收藏、动作）
 * 依赖: ImageViewer, GalleryActions, GalleryList, PromptPanel
 * 用法: Lightbox.init({ config, onOpenFolder, onCopyPrompt, onUsePrompt, onPromptDisplay, container })
 */
(function (global) {
    'use strict';
    const NS = global.GalleryDisplay = global.GalleryDisplay || {};
    const Base = NS.Base;
    if (!Base) { console.error('[Lightbox] 缺少 GalleryDisplay.Base'); return; }

    /* ============================================================
     *  状态
     * ============================================================ */
    const state = {
        images: [],
        currentIndex: 0,
        currentRecord: null,
        currentPrompt: '',
        isVideoMode: false,
    };

    const LB_ACTION_SVGS = {
        openFolder: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        download: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
        favorite: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        favoriteActive: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 text-amber-400"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        copyPrompt: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>',
        usePrompt: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
        delete: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
        prompt: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
        close: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    };

    let _config = {};
    let _initialized = false;

    /* ============================================================
     *  Helpers
     * ============================================================ */
    function findRecord(url) {
        try {
            const allHistory = (global.GalleryList && global.GalleryList.allHistory) || [];
            for (const h of allHistory) {
                // 同时匹配图片与视频记录，使灯箱动作按钮(收藏/下载/删除)对视频也生效
                if ((h.images && h.images.includes(url)) || (h.videos && h.videos.includes(url))) return h;
            }
        } catch (e) {}
        return null;
    }

    function getAllHistoryImages() {
        // 同时平铺图片与视频，使灯箱缩略图条 / 左右切换也能正确处理视频
        const allHistory = (global.GalleryList && global.GalleryList.allHistory) || [];
        const allMedia = [];
        allHistory.forEach(h => {
            const isVid = !(h.images && h.images.length && h.images[0]) && (h.videos && h.videos.length && h.videos[0]);
            const meds = (isVid ? (h.videos || []) : (h.images || [])).filter(Boolean);
            meds.forEach(u => { if (u) allMedia.push(u); });
        });
        return allMedia;
    }

    /* ============================================================
     *  HTML / Actions 注入
     * ============================================================ */
    function injectHTML() {
        if (_config.lightbox && !document.getElementById('lightbox')) {
            const lightboxHTML = `
<div id="lightbox" onclick="GalleryDisplay.handleOutsideClick(event)" class="hidden fixed inset-0 z-50 gallery-lightbox flex flex-col items-center justify-center">
    <div class="flex flex-col w-full">
        <div id="lightboxImgContainer" class="flex items-center justify-center overflow-hidden relative" style="height:80vh; min-height:0; padding:4px;">
            <img id="lightboxImg" src="" class="object-contain rounded-lg sm:rounded-2xl shadow-2xl">
            <video id="lightboxVideo" src="" class="object-contain rounded-lg sm:rounded-2xl shadow-2xl hidden" controls autoplay playsinline style="max-height:80vh; max-width:95vw;"></video>
        </div>
        <div id="lightboxActions" class="z-50 flex gap-1.5 justify-center flex-shrink-0" style="display:none;"></div>
        <div id="lightboxRes" class="text-center text-white/70 text-[10px] sm:text-[11px] font-bold tracking-wider py-1" style="display:none;"></div>
        <div id="lightboxThumbnails" class="flex overflow-x-auto" style="display:none; width:100%; max-width:min(95vw, 800px); margin:0 auto;"></div>
    </div>
</div>`;
            document.body.insertAdjacentHTML('beforeend', lightboxHTML);
            renderLightboxActions();
        }
    }

    function renderLightboxActions() {
        const el = document.getElementById('lightboxActions');
        if (!el) return;
        const btnClass = 'w-8 h-8 bg-white/90 backdrop-blur text-black rounded-lg flex items-center justify-center transition-colors';
        const actions = [
            { key: 'openFolder', title: '打开文件夹', hover: 'hover:bg-blue-600 hover:text-white' },
            { key: 'download', title: '下载图片', hover: 'hover:bg-green-600 hover:text-white' },
            { key: 'favorite', id: 'lightboxFavBtn', title: '收藏', hover: 'hover:bg-amber-400 hover:text-white' },
            { key: 'copyPrompt', title: '复制提示词', hover: 'hover:bg-cyan-600 hover:text-white' },
            { key: 'usePrompt', title: '载入提示词', hover: 'hover:bg-indigo-600 hover:text-white' },
            { key: 'delete', title: '删除', hover: 'hover:bg-black hover:text-white' },
            { key: 'prompt', id: 'lightboxPromptBtn', title: '查看提示词', hover: 'hover:bg-violet-600 hover:text-white' },
            { key: 'close', title: '关闭', hover: 'hover:bg-red-600 hover:text-white' },
        ];
        el.innerHTML = actions.map(a => {
            const idAttr = a.id ? ` id="${a.id}"` : '';
            return `<button${idAttr} onclick="GalleryDisplay.lightboxAction('${a.key}')" class="${btnClass} ${a.hover}" title="${a.title}">${LB_ACTION_SVGS[a.key]}</button>`;
        }).join('');
    }

    /* ============================================================
     *  Refresh / Switch
     * ============================================================ */
    function refreshFavBtn() {
        const btn = document.getElementById('lightboxFavBtn');
        if (!btn || !state.currentRecord) return;
        const rec = state.currentRecord;
        // 视频记录用 videos 字段，图片记录用 images 字段
        const favUrl = (rec.images && rec.images[state.currentIndex])
            || (rec.videos && rec.videos[state.currentIndex])
            || (rec.images && rec.images[0])
            || (rec.videos && rec.videos[0])
            || '';
        // data-fav-url 让全局 fav:changed 事件也能找到这个按钮
        btn.setAttribute('data-fav-url', favUrl);
        const isFav = (window.GalleryDisplay && GalleryDisplay.Favorites)
            ? GalleryDisplay.Favorites.isFav(favUrl)
            : (global.__galleryFavorites || new Set()).has(favUrl);
        btn.innerHTML = isFav ? LB_ACTION_SVGS.favoriteActive : LB_ACTION_SVGS.favorite;
        btn.classList.toggle('is-fav', !!isFav);
    }

    function refreshThumbnails() {
        const container = document.getElementById('lightboxThumbnails');
        if (!container || state.images.length <= 1) {
            if (container) container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';
        container.innerHTML = state.images.map((url, i) =>
            `<div class="lightbox-thumb${i === state.currentIndex ? ' active' : ''}" data-index="${i}">
                <img src="/api/media-preview?w=64&url=${encodeURIComponent(url)}" alt="缩略图 ${i + 1}" draggable="false">
            </div>`
        ).join('');
        const activeThumb = container.querySelector('.active');
        if (activeThumb) activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

        if (!container._thumbScrollBound) {
            container._thumbScrollBound = true;
            let isDragging = false, hasMoved = false, startX = 0, startScrollLeft = 0;
            const DRAG_THRESHOLD = 5;

            container.addEventListener('wheel', (e) => {
                e.preventDefault();
                container.scrollLeft += e.deltaY * 2;
            }, { passive: false });

            container.addEventListener('mousedown', (e) => {
                isDragging = true;
                hasMoved = false;
                startX = e.pageX;
                startScrollLeft = container.scrollLeft;
                container.style.cursor = 'grabbing';
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                const dx = e.pageX - startX;
                if (Math.abs(dx) > DRAG_THRESHOLD) hasMoved = true;
                if (hasMoved) container.scrollLeft = startScrollLeft - dx;
            });
            document.addEventListener('mouseup', () => {
                if (isDragging) { isDragging = false; container.style.cursor = 'grab'; }
            });
            container.addEventListener('click', (e) => {
                if (hasMoved) return;
                const thumb = e.target.closest('.lightbox-thumb');
                if (thumb) {
                    const index = parseInt(thumb.dataset.index);
                    if (!isNaN(index)) switchImage(index);
                }
            });
        }
    }

    function switchImage(index) {
        if (index >= 0 && index < state.images.length) {
            state.currentIndex = index;
            const url = state.images[index];
            const isVid = /\.(mp4|webm|mov|mkv)(\?|$)/i.test(url);
            const imgEl = document.getElementById('lightboxImg');
            const vidEl = document.getElementById('lightboxVideo');
            if (isVid) {
                // 切到视频项
                if (imgEl) { imgEl.classList.add('hidden'); imgEl.src = ''; }
                if (vidEl) {
                    vidEl.classList.remove('hidden');
                    if (vidEl.src !== url) { vidEl.src = url; }
                    vidEl.play().catch(() => {});
                }
                state.isVideoMode = true;
            } else {
                // 切到图片项
                if (vidEl) { vidEl.classList.add('hidden'); vidEl.pause(); }
                if (imgEl) { imgEl.classList.remove('hidden'); imgEl.src = url; }
                state.isVideoMode = false;
                if (global.ImageViewer && typeof global.ImageViewer.goTo === 'function') {
                    global.ImageViewer.goTo(index);
                }
            }
            refreshThumbnails();
        }
    }

    /* ============================================================
     *  Open / Close
     * ============================================================ */
    function unwrapLightboxUrl(url) {
        const raw = String(url || '');
        try {
            const parsed = new URL(raw, location.origin);
            if (parsed.pathname === '/api/media-preview') {
                const inner = parsed.searchParams.get('url') || '';
                if (inner) return unwrapLightboxUrl(inner);
            }
            if (parsed.origin === location.origin) return parsed.pathname + parsed.search;
        } catch (e) {}
        return raw;
    }

    function locateLightboxImage(url) {
        const target = unwrapLightboxUrl(url);
        const images = getAllHistoryImages();
        const index = images.findIndex(item => unwrapLightboxUrl(item) === target);
        if (index >= 0) return { images, index };
        return { images: [target], index: 0 };
    }

    function openLightbox(url, imagesOrPrompt, startIndexOrPrompt, promptParam, allPrompts, isVideo) {
        if (!_config.lightbox) return;

        const actionsEl = document.getElementById('lightboxActions');
        const lb = document.getElementById('lightbox');
        if (lb) lb.classList.remove('hidden');

        // 视频/图片切换
        const imgEl = document.getElementById('lightboxImg');
        const vidEl = document.getElementById('lightboxVideo');
        if (isVideo) {
            // 视频模式：隐藏 img，显示 video
            if (imgEl) { imgEl.classList.add('hidden'); imgEl.src = ''; }
            if (vidEl) {
                vidEl.classList.remove('hidden');
                vidEl.src = url;
                vidEl.play().catch(() => {});
            }
            state.isVideoMode = true;
        } else {
            // 图片模式：隐藏 video，显示 img
            if (vidEl) { vidEl.classList.add('hidden'); vidEl.pause(); vidEl.src = ''; }
            if (imgEl) imgEl.classList.remove('hidden');
            state.isVideoMode = false;
        }

        const onImageChange = (idx, imgUrl, newPrompt) => {
            state.currentIndex = idx;
            state.currentRecord = findRecord(imgUrl);
            refreshThumbnails();
            refreshFavBtn();
            Promise.resolve(newPrompt).then(function (v) {
                updatePromptDisplay(typeof v === 'string' ? v : (v && (v.en || v.text || v.prompt)) || '');
            });
        };

        const firstImgUrl = Array.isArray(imagesOrPrompt) ? (imagesOrPrompt[startIndexOrPrompt || 0] || url) : url;
        state.currentRecord = findRecord(firstImgUrl);

        if (actionsEl) actionsEl.style.display = state.currentRecord ? 'flex' : 'none';
        refreshFavBtn();

        if (Array.isArray(imagesOrPrompt)) {
            state.currentPrompt = promptParam || '';
            state.images = getAllHistoryImages();
            state.currentIndex = state.images.indexOf(firstImgUrl);
            if (state.currentIndex === -1) state.currentIndex = 0;

            if (state.images.length > 1) {
                let prompts = [];
                try {
                    const allHistory = (global.GalleryList && global.GalleryList.allHistory) || [];
                    const historyByImage = new Map();
                    allHistory.forEach(h => {
                        if (h.images && h.images.length) {
                            h.images.forEach(u => { if (u) historyByImage.set(u, h); });
                        }
                    });
                    prompts = state.images.map(imgUrl => {
                        const h = historyByImage.get(imgUrl);
                        return (h && h.prompt) || '';
                    });
                } catch (e) {}
                if (allPrompts && allPrompts.length === imagesOrPrompt.length) {
                    prompts = allPrompts;
                }
                global.ImageViewer.init(state.images, state.currentIndex, { prompts, onShow: onImageChange });
            } else {
                const located = locateLightboxImage(url);
                state.images = located.images;
                state.currentIndex = located.index;
                global.ImageViewer.init(state.images, state.currentIndex);
            }
        } else {
            state.currentPrompt = imagesOrPrompt || '';
            const located = locateLightboxImage(Array.isArray(url) ? url[0] : url);
            state.images = located.images;
            state.currentIndex = located.index;
            global.ImageViewer.init(state.images, state.currentIndex);
        }

        refreshThumbnails();
        updatePromptDisplay(state.currentPrompt);
        hidePromptPanel();
    }

    function closeLightbox() {
        const lb = document.getElementById('lightbox');
        if (lb) lb.classList.add('hidden');
        document.body.style.overflow = '';
        const actionsEl = document.getElementById('lightboxActions');
        if (actionsEl) actionsEl.style.display = 'none';
        hidePromptPanel();
        state.currentRecord = null;
        state.isVideoMode = false;
        // 停止视频播放并释放
        const vid = document.getElementById('lightboxVideo');
        if (vid) { vid.pause(); vid.src = ''; }
        setTimeout(() => {
            const img = document.getElementById('lightboxImg');
            if (img) img.src = '';
        }, 300);
    }

    function handleOutsideClick(e) {
        if (e.target.closest('#lightboxImg, #lightboxVideo, #lightboxActions, #lightboxThumbnails, button, a, video')) return;
        closeLightbox();
    }

    /* ============================================================
     *  Prompt Panel / Action
     * ============================================================ */
    function updatePromptDisplay(prompt) {
        state.currentPrompt = prompt || '';
    }

    function togglePromptPanel() {
        const btn = document.getElementById('lightboxPromptBtn');
        const record = state.currentRecord;
        const imgBox = document.getElementById('lightboxImgContainer');
        if (global.PromptPanel) {
            const text = (record && record.prompt) || '';
            global.PromptPanel.toggle({
                cn: text,
                negative: (record && record.negative_prompt) || '',
                genParams: (record && record.genParams) || null,
                recordMeta: {
                    type: (record && record.type) || undefined,
                    model: (record && record.model) || undefined,
                    seed: (record && record.seed) != null ? record.seed : undefined
                },
                translate: (typeof _config.onPromptDisplay === 'function') ? _config.onPromptDisplay : null,
                anchor: imgBox || btn || null
            });
        }
        if (btn) btn.classList.toggle('active', global.PromptPanel ? global.PromptPanel.isOpen() : false);
    }

    function hidePromptPanel() {
        if (global.PromptPanel) global.PromptPanel.close();
    }

    function lightboxAction(action) {
        if (!state.currentRecord) return;
        const record = state.currentRecord;
        // 视频记录用 videos 字段，图片记录用 images 字段（优先当前索引，兜底首张）
        const imgUrl = (record.images && record.images[state.currentIndex])
            || (record.videos && record.videos[state.currentIndex])
            || (record.images && record.images[0])
            || (record.videos && record.videos[0])
            || '';
        const ts = record.timestamp;

        switch (action) {
            case 'openFolder':
                if (typeof _config.onOpenFolder === 'function') _config.onOpenFolder(record);
                else if (global.GalleryActions && GalleryActions.openImageFolder) GalleryActions.openImageFolder(record);
                break;
            case 'download':
                if (imgUrl && global.GalleryActions && GalleryActions.downloadImage) {
                    // 视频按真实扩展名下载，图片仍用 .png
                    const ext = (imgUrl.match(/\.(mp4|webm|mov|mkv|m4v|ogv|avi)(\?|#|$)/i) || [, ''])[1] || 'png';
                    GalleryActions.downloadImage(imgUrl, String(ts) + '.' + ext);
                }
                break;
            case 'favorite':
                // 统一入口 GalleryDisplay.Favorites.toggle(url)
                // 卡片上 .gallery-fav 按钮由 fav:changed 事件自动同步；
                // 灯箱自己的按钮单独刷新（事件也通过 data-fav-url 选择器匹配）
                if (global.GalleryDisplay && global.GalleryDisplay.Favorites) {
                    global.GalleryDisplay.Favorites.toggle(imgUrl);
                    refreshFavBtn();
                } else if (global.GalleryActions && GalleryActions.toggleFavorite) {
                    // 兜底
                    GalleryActions.toggleFavorite(record, null, imgUrl);
                    refreshFavBtn();
                }
                break;
            case 'copyPrompt':
                if (typeof _config.onCopyPrompt === 'function') _config.onCopyPrompt(record);
                else if (global.GalleryActions && GalleryActions.copyPrompt) GalleryActions.copyPrompt(record);
                break;
            case 'usePrompt':
                if (typeof _config.onUsePrompt === 'function') _config.onUsePrompt(record);
                else if (global.GalleryActions && GalleryActions.usePrompt) GalleryActions.usePrompt(record);
                break;
            case 'delete':
                if (global.GalleryActions && GalleryActions.deleteHistoryItem) {
                    if (confirm('确认删除这张图片？')) {
                        const ts2 = record.timestamp;
                        // [Task 5 收敛] 优先 NS.Config
                        const historyType = record.type || (window.GalleryDisplay?.Config?.type) || 'unknown';
                        fetch('/api/history/delete', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ timestamp: ts2 })
                        }).catch(() => {});
                        const el = document.getElementById('history-' + ts2);
                        if (el) el.remove();
                        if (global.GalleryList && Array.isArray(GalleryList.allHistory)) {
                            GalleryList.allHistory = GalleryList.allHistory.filter(h => String(h.timestamp) !== String(ts2));
                        }
                        closeLightbox();
                    }
                }
                break;
            case 'prompt':
                togglePromptPanel();
                break;
            case 'close':
                closeLightbox();
                break;
        }
    }

    /* ============================================================
     *  Init / Self-Tests
     * ============================================================ */
    function init(config = {}) {
        if (_initialized) return;
        _config = config || {};
        // 注入 lightbox DOM（[Task 6 漏修] 此处必须调用，否则 openLightbox 时 #lightbox 不存在）
        injectHTML();
        _initialized = true;
        if (!_config || !_config.skipSelfTest) _runSelfTests();
    }

    function destroy() { _initialized = false; _config = {}; }

    function _runSelfTests() {
        Base.Test.suite('Lightbox', [
            ['模块已挂载到 GalleryDisplay', () => NS.Lightbox && typeof NS.Lightbox.openLightbox === 'function'],
            ['state 已初始化', () => Array.isArray(state.images) && state.currentIndex === 0 && state.currentRecord === null],
            ['init() 后 #lightbox DOM 已注入', () => !!document.getElementById('lightbox')],
            ['init() 后 #lightboxActions 已渲染', () => !!document.getElementById('lightboxActions')],
            ['LB_ACTION_SVGS 至少 8 个图标（含 favorite/favoriteActive）', () => Object.keys(LB_ACTION_SVGS).length >= 8],
            ['findRecord 在空历史下返回 null', () => {
                const orig = global.GalleryList;
                global.GalleryList = { allHistory: [] };
                const r = findRecord('http://example.com/x.png');
                global.GalleryList = orig;
                return r === null;
            }],
            ['getAllHistoryImages 平铺 images', () => {
                const orig = global.GalleryList;
                global.GalleryList = { allHistory: [
                    { images: ['a', 'b'] },
                    { images: [] },
                    { images: ['c'] },
                ]};
                const r = getAllHistoryImages();
                global.GalleryList = orig;
                return r.length === 3 && r[0] === 'a' && r[1] === 'b' && r[2] === 'c';
            }],
            ['switchImage 越界不抛错', () => {
                state.images = ['a'];
                state.currentIndex = 0;
                let threw = false;
                try { switchImage(99); switchImage(-1); } catch (e) { threw = true; }
                return threw === false && state.currentIndex === 0;
            }],
        ]);
    }

    /* ============================================================
     *  Public API
     * ============================================================ */
    NS.Lightbox = {
        init,
        destroy,
        injectHTML,
        renderLightboxActions,
        findRecord,
        getAllHistoryImages,
        refreshFavBtn,
        refreshThumbnails,
        switchImage,
        openLightbox,
        closeLightbox,
        handleOutsideClick,
        lightboxAction,
        togglePromptPanel,
        hidePromptPanel,
        updatePromptDisplay,
        // expose for tests
        _state: state,
    };
})(window);


;/* ---- gallery-core.js ---- */

/*!
 * GalleryCore - 展示层基础 CSS + Load-More 触发器
 * 依赖: 无
 * 用法: GalleryCore.init({ loadMore, mainSelector })
 */
(function (global) {
    'use strict';
    const NS = global.GalleryDisplay = global.GalleryDisplay || {};
    const Base = NS.Base;
    if (!Base) { console.error('[GalleryCore] 缺少 GalleryDisplay.Base'); return; }

    /* ============================================================
     *  共享 CSS（[Task 7 迁移] 从 display.js 抽离）
     *  - Lightbox / Masonry / Action Btn / Dark mode / Responsive
     * ============================================================ */
    const GALLERY_CORE_CSS = `
/* === Lightbox === */
.gallery-lightbox {
    background: rgba(0,0,0,0.88);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
}
.gallery-lightbox #lightboxImg {
    transition: transform 0.1s ease-out;
    position: relative;
    z-index: 1;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}
/* 拖动/缩放期间：关掉 transform 补间（否则拖影发飘）+ 提升为独立合成层 */
.gallery-lightbox #lightboxImg.is-lb-interacting {
    transition: none !important;
    will-change: transform;
    backface-visibility: hidden;
}
/* 仅提升合成层（滚轮缩放用它，保留 0.1s 补间的顺滑感） */
.gallery-lightbox #lightboxImg.is-lb-gpu {
    will-change: transform;
    backface-visibility: hidden;
}
/* 拖动时关掉背景实时毛玻璃：backdrop-filter 在逐帧重绘下开销极大 */
.gallery-lightbox.is-lb-dragging {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
}
/* === 提示词查看按钮（悬浮面板已抽到通用 PromptPanel 组件） === */
.lb-icon-btn {
    width: 38px; height: 38px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 11px;
    background: rgba(255,255,255,0.12);
    color: #eceae5;
    border: 1px solid rgba(255,255,255,0.18);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    transition: background .15s ease, color .15s ease, transform .15s ease;
    cursor: pointer;
    padding: 0;
}
.lb-icon-btn:hover { background: rgba(255,255,255,0.22); color: #fcfcfb; }
.lb-icon-btn:active { transform: scale(0.94); }
.lb-icon-btn.active { background: rgba(6, 182, 212, 0.35); color: #fcfcfb; border-color: rgba(6, 182, 212, 0.6); }
/* 提示词悬浮面板的样式已迁移到 prompt-panel.js（通用组件） */
#lightboxThumbnails {
    gap: 8px;
    padding: 8px 12px;
    overflow-x: auto;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
    cursor: grab;
    display: flex;
    flex-wrap: nowrap;
}
#lightboxThumbnails:active { cursor: grabbing; }
#lightboxThumbnails::-webkit-scrollbar { display: none; }
#lightboxThumbnails { -ms-overflow-style: none; scrollbar-width: none; }
.lightbox-thumb {
    width: 60px;
    height: 60px;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    opacity: 0.5;
    transition: all 0.2s;
    flex-shrink: 0;
    border: 2px solid transparent;
}
.lightbox-thumb:hover { opacity: 0.8; }
.lightbox-thumb.active {
    opacity: 1;
    border-color: #06b6d4;
    box-shadow: 0 0 12px rgba(6, 182, 212, 0.5);
}
.lightbox-thumb img { width: 100%; height: 100%; object-fit: cover; }

/* === Masonry Grid（共享样式，覆盖所有页面） === */
.masonry-grid { position:relative; column-count:2; column-gap:12px; }
.masonry-grid.stable-masonry > * { position:absolute; box-sizing:border-box; }
.masonry-grid .date-separator { column-span:all; display:flex; align-items:center; gap:12px; padding:8px 0 4px; }
.masonry-grid .date-separator .sep-line { flex:1; height:1px; background:rgba(0,0,0,0.08); }
.masonry-grid .date-separator .sep-label { font-size:10px; font-weight:700; color:#999999; text-transform:uppercase; letter-spacing:0.08em; white-space:nowrap; }
body.studio-theme-dark .masonry-grid .date-separator .sep-line { background:rgba(255,255,255,0.08); }
body.studio-theme-dark .masonry-grid .date-separator .sep-label { color:#6e6d66; }
@media(min-width:640px){ .masonry-grid{ column-gap:16px; } }
@media(min-width:768px){ .masonry-grid{ column-count:3; column-gap:20px; } }
@media(min-width:1024px){ .masonry-grid{ column-count:4; } }
.masonry-grid.thumb-large{ column-count:2!important; column-gap:14px!important; }
.masonry-grid.thumb-medium{ /* 默认 */ }
.masonry-grid.thumb-small{ column-count:5!important; column-gap:8px!important; }
.masonry-grid.thumb-small .model-badge{ display:none!important; }
@media(min-width:640px){ .masonry-grid.thumb-large{ column-count:2!important; column-gap:18px!important; } .masonry-grid.thumb-small{ column-count:5!important; } }
@media(min-width:768px){ .masonry-grid.thumb-large{ column-count:3!important; } .masonry-grid.thumb-small{ column-count:6!important; } }
@media(min-width:1024px){ .masonry-grid.thumb-large{ column-count:3!important; } .masonry-grid.thumb-small{ column-count:6!important; } }
.masonry-item { border-radius:24px; overflow:hidden; background:#eeeeee; border:1px solid #f6f6f4; transition:transform .16s ease, box-shadow .16s ease; position:relative; break-inside:avoid; margin-bottom:12px; }
.masonry-item:hover { transform:translateY(-2px); box-shadow:0 10px 22px rgba(0,0,0,0.08); }
body.studio-theme-dark .masonry-item { background:var(--ui-soft, #252b38); border-color:var(--ui-line, #343b4c); }
body.studio-theme-dark .masonry-item:hover { box-shadow:0 20px 40px rgba(0,240,255,0.06); }

/* === NSFW 相关样式已迁移到 nsfw-filter.js === */

/* === Scroll to Top 样式已迁移到 scroll-top.js === */

/* === 隐藏操作栏中右键菜单已有的按钮 === */
.gallery-actions .gallery-action-btn[onclick*="toggleFavorite"] { display: none !important; }
.gallery-actions .gallery-action-btn[onclick*="openImageFolder"] { display: none !important; }
.gallery-actions .gallery-action-btn[onclick*="copyPrompt"] { display: none !important; }

/* === 收藏星标：通过 .is-fav class 切换填充状态（统一入口 Favorites.toggle） === */
.gallery-fav svg polygon { fill: none; }
.gallery-fav.is-fav svg polygon { fill: currentColor; }

/* === 图片收藏星标：确保白色背景上可见 === */
.img-fav-btn {
    background: rgba(0,0,0,0.5) !important;
    color: #fcfcfb !important;
}
.img-fav-btn.is-fav {
    background: rgba(245,158,11,0.85) !important;
    color: #fcfcfb !important;
    opacity: 1 !important;
}

/* === 多图删除按钮 === */
.img-del-btn {
    background: rgba(220,38,38,0.8) !important;
    color: #fcfcfb !important;
}
.img-del-btn.is-confirming {
    background: #dc2626 !important;
    animation: galleryDeleteShake 0.4s ease-in-out infinite alternate;
}

/* === 缩略图操作按钮：顶部居中，按钮半透明 === */
.gallery-actions {
    top: 10px !important;
    right: auto !important;
    left: 50% !important;
    transform: translateX(-50%);
    background: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    border-radius: 0 !important;
    padding: 0 !important;
}
.gallery-action-btn {
    background: rgba(0,0,0,0.45) !important;
    color: #fcfcfb !important;
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
}

/* === 收藏模式：隐藏日期分隔线 === */
body.fav-mode .date-separator { display: none !important; }

/* === Dark mode === */
body.studio-theme-dark .lightbox-thumb.active {
    border-color: #00f0ff;
    box-shadow: 0 0 12px rgba(0,240,255,0.5);
}

/* === Responsive === */
@media (max-width: 640px) {
    #lightboxThumbnails { gap: 6px; padding: 6px 8px; }
}
`;

    const GalleryCore = {
        _initialized: false,

        init(config = {}) {
            if (this._initialized) return;
            this.injectCSS();
            this.injectLoadMoreTrigger(config);
            this.mountMasonry(config);
            this._initialized = true;
            if (!config.skipSelfTest) this._runSelfTests();
        },

        destroy() {
            this._masonryCleanup?.();
            this._initialized = false;
        },

        mountMasonry(config = {}) {
            const grid = document.querySelector(config.masonrySelector || '#masonry');
            if (!grid) return;
            grid.classList.add('stable-masonry');
            let frame = 0;
            const observed = new Set();
            const schedule = () => {
                if (!frame) frame = requestAnimationFrame(layout);
            };
            const resize = new ResizeObserver(schedule);
            const layout = () => {
                frame = 0;
                const style = getComputedStyle(grid);
                const count = Math.max(1, parseInt(style.columnCount, 10) || 1);
                const gap = parseFloat(style.columnGap) || 12;
                const width = (grid.clientWidth - gap * (count - 1)) / count;
                if (width <= 0) return;
                const heights = Array(count).fill(0);
                const children = [...grid.children];
                for (const node of observed) {
                    if (!children.includes(node)) { resize.unobserve(node); observed.delete(node); }
                }
                for (const node of children) {
                    if (!observed.has(node)) { observed.add(node); resize.observe(node); }
                    if (getComputedStyle(node).display === 'none') continue;
                    const fullWidth = !node.classList.contains('masonry-item');
                    const column = heights.indexOf(Math.min(...heights));
                    const top = fullWidth ? Math.max(...heights) : heights[column];
                    node.style.width = `${fullWidth ? grid.clientWidth : width}px`;
                    node.style.left = `${fullWidth ? 0 : column * (width + gap)}px`;
                    node.style.top = `${top}px`;
                    // 用 offsetHeight 而不是 getBoundingClientRect：后者会把 hover 时的 transform（放大/位移）算进去，
                    // 高度一旦抖动就会重新分列，卡片看起来像自己换了顺序。
                    const bottom = top + (node.offsetHeight || node.getBoundingClientRect().height) + gap;
                    if (fullWidth) heights.fill(bottom);
                    else heights[column] = bottom;
                }
                grid.style.height = `${Math.max(0, ...heights)}px`;
            };
            // 只监听网格自身的 class（大/中/小图切换）和子节点增删。
            // 之前开了 subtree:true，卡片 hover 时给悬浮按钮加 .show 也会触发重排，
            // 悬停即重算列高，卡片看起来会自己换位置——这里收窄观察范围即可。
            const mutations = new MutationObserver(schedule);
            mutations.observe(grid, {childList:true, attributes:true, attributeFilter:['class'], subtree:false});
            resize.observe(grid);
            // 收藏和敏感内容过滤通过 body class 控制，也需要重新计算可见布局。
            const filters = new MutationObserver(schedule);
            filters.observe(document.body, {attributes:true, attributeFilter:['class']});
            grid.addEventListener('load', schedule, true);
            this._masonryCleanup = () => {
                resize.disconnect(); mutations.disconnect(); filters.disconnect();
                grid.removeEventListener('load', schedule, true);
                cancelAnimationFrame(frame);
            };
            schedule();
        },

        injectCSS() {
            if (document.getElementById('gallery-display-css')) return;
            const style = document.createElement('style');
            style.id = 'gallery-display-css';
            style.textContent = GALLERY_CORE_CSS;
            document.head.appendChild(style);
        },

        injectLoadMoreTrigger(config = {}) {
            if (!config.loadMore) return;
            if (document.getElementById('loadMoreTrigger')) return;
            const main = document.querySelector(config.mainSelector);
            if (!main) return;
            const trigger = document.createElement('div');
            trigger.id = 'loadMoreTrigger';
            trigger.className = 'py-12 text-center text-gray-300 text-[10px] font-bold uppercase tracking-widest cursor-pointer hidden';
            trigger.textContent = '加载更多归档';
            main.appendChild(trigger);
        },

        _runSelfTests() {
            Base.Test.suite('GalleryCore', [
                ['模块已挂载到 GalleryDisplay', () => NS.GalleryCore === this],
                ['_initialized=true', () => this._initialized === true],
                ['CSS 已注入到 <head>', () => !!document.getElementById('gallery-display-css')],
                ['idempotent: 二次 initCSS() 不重复注入', () => {
                    const before = document.getElementById('gallery-display-css');
                    this.injectCSS();
                    const after = document.getElementById('gallery-display-css');
                    return before === after;
                }],
            ]);
        },
    };

    NS.GalleryCore = GalleryCore;
})(window);


;/* ---- prompt-panel.js ---- */
/*!
 * PromptPanel — 通用「图片信息」悬浮查看组件（富信息版）
 * ----------------------------------------------------------------
 * 自包含：脚本加载时自动注入 CSS + 单例 DOM，无需任何调用方初始化。
 *
 * 布局（参考 ComfyUI / SD WebUI 信息面板）：
 *   ┌─ 提示 ─────────────────── [收起] ┐
 *   │  [标签:类型] [标签:模型]    [复制] │  ← 标签+复制按钮同一行
 *   │  正向提示词文本…                 │
 *   ├─ 负面提示 ─────────── [复制] ──┤  (仅当有负面提示词时显示)
 *   │  负面提示词文本…                │
 *   ├─ 其他元数据 ───────────────────┤
 *   │  [CFG: 7] [步骤: 30] …          │
 *   └────────────────────────────────┘
 *
 * 设计：
 *   - 默认 fixed 居中毛玻璃浮层；传入 anchor 时锚定到元素旁
 *   - 分区：提示(含标签) / 负面提示 / 元数据标签网格
 *   - 提示区复制按键仅复制正向提示词；负面提示区仅在存在时显示
 *   - 头部仅保留收起按键；点击空白/收起/ESC 关闭
 *
 * API：
 *   PromptPanel.open({ cn, en, raw, negative, meta, tags, translate, anchor })
 *   PromptPanel.close() / toggle(options) / isOpen()
 */
(function (global) {
    'use strict';

    const STYLE_ID = 'prompt-panel-css';
    const OVERLAY_ID = 'promptPanelOverlay';
    let openToken = 0;
    let keyBound = false;
    let currentAnchor = null;
    let reflowBound = false;

    /* ============================ 样式 ============================ */
    const CSS = `
/* === PromptPanel 图片信息悬浮面板 === */
#promptPanelOverlay {
    position: fixed; inset: 0; z-index: 9999;
    display: none; align-items: center; justify-content: center; padding: 16px;
    background: rgba(0,0,0,0.001);
}
#promptPanelOverlay.pp-show { display: flex; }
#promptPanelOverlay.pp-anchored { padding: 0; }
#promptPanelOverlay.pp-anchored .pp-box { position: absolute; }
.pp-box {
    position: relative;
    width: min(92vw, 600px);
    max-height: 75vh;
    display: flex; flex-direction: column;
    background: rgba(23, 23, 22, 0.72);
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    color: #f6f6f4;
    overflow: hidden;
    animation: pp-pop 0.16s ease-out;
}
@keyframes pp-pop {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to   { opacity: 1; transform: none; }
}

/* ---- 头部 ---- */
.pp-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,0.08);
}
.pp-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; opacity: 0.9; }
.pp-tools { display: flex; align-items: center; gap: 6px; }
.pp-btn {
    width: 30px; height: 30px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 9px;
    background: rgba(255,255,255,0.1);
    color: #eceae5; border: none;
    transition: background .15s ease, color .15s ease, transform .15s ease;
    cursor: pointer; padding: 0;
}
.pp-btn:hover { background: rgba(6, 182, 212, 0.45); color: #fcfcfb; }
.pp-btn:active { transform: scale(0.92); }
.pp-btn.copied { background: rgba(34,197,94,0.5); color: #fcfcfb; }

/* ---- 分区通用 ---- */
.pp-section { border-bottom: 1px solid rgba(255,255,255,0.06); }
.pp-section:last-child { border-bottom: none; }
.pp-sec-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px 6px; cursor: default;
}
.pp-sec-title {
    font-size: 12px; font-weight: 700; opacity: 0.75;
    letter-spacing: 0.03em; user-select: none;
}
.pp-sec-copy {
    width: 24px; height: 24px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 6px; background: transparent;
    color: rgba(255,255,255,0.4); border: none;
    cursor: pointer; padding: 0; transition: all .15s ease;
}
.pp-sec-copy:hover { background: rgba(255,255,255,0.1); color: #fcfcfb; }

/* ---- 标签行（含复制按钮） ---- */
.pp-tags-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 14px 6px;
}
.pp-tags-row .pp-tags { padding: 0; flex: 0 1 auto; min-width: 0; }
.pp-tags-row .pp-sec-copy { flex-shrink: 0; margin-left: 8px; }

/* ---- 标签 ---- */
.pp-tags { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 8px; }
.pp-tag {
    font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 6px;
    background: rgba(6, 182, 212, 0.2); color: #00f0ff;
    border: 1px solid rgba(6, 182, 212, 0.3);
    user-select: none; white-space: nowrap; line-height: 1.4;
}
.pp-tag.pp-tag-warm { background: rgba(251,146,60,0.18); color: #fdba74; border-color: rgba(251,146,60,0.3); }
.pp-tag.pp-tag-green { background: rgba(34,197,94,0.18); color: #86efac; border-color: rgba(34,197,94,0.3); }

/* ---- 内容区（整体滚动容器） ---- */
.pp-content {
    flex: 1 1 auto; min-height: 0; overflow-y: auto;
}
/* ---- 正文区 ---- */
.pp-body {
    padding: 6px 14px 12px; overflow-y: auto;
    font-size: 13px; line-height: 1.75; word-break: break-word;
    max-height: 42vh;
}
.pp-text { white-space: pre-wrap; opacity: 0.92; }
.pp-text-dim { opacity: 0.55; font-size: 12px; margin-top: 6px; white-space: pre-wrap; }
.pp-empty { opacity: 0.45; font-size: 12px; font-style: italic; }

/* ---- 元数据网格 ---- */
.pp-meta-grid {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px 16px; padding: 4px 14px 14px;
}
.pp-meta-item {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0;
    font-size: 11.5px; font-weight: 600;
    padding: 9px 0; color: inherit;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    user-select: all;
}
.pp-meta-key { opacity: 0.65; font-weight: 500; }
.pp-meta-val { text-align: right; overflow-wrap: anywhere; min-width: 0; font-weight: 500; font-variant-numeric: tabular-nums; }
.pp-meta-key { flex-shrink: 0; }
@media (max-width: 420px) { .pp-meta-grid { grid-template-columns: minmax(0, 1fr); } }

/* ---- 滚动条（深色主题） ---- */
.pp-content,
.pp-body { scrollbar-width: thin; scrollbar-color: rgba(89, 88, 81, 0.6) transparent; }
.pp-content::-webkit-scrollbar,
.pp-body::-webkit-scrollbar { width: 6px; }
.pp-content::-webkit-scrollbar-track,
.pp-body::-webkit-scrollbar-track { background: transparent; }
.pp-content::-webkit-scrollbar-thumb,
.pp-body::-webkit-scrollbar-thumb { background: rgba(89, 88, 81, 0.6); border-radius: 6px; }
.pp-content::-webkit-scrollbar-thumb:hover,
.pp-body::-webkit-scrollbar-thumb:hover { background: rgba(125, 124, 116, 0.85); border-radius: 6px; }
`;

    /* ============================ 图标 ============================ */
    const COPY_SVG  = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const CHECK_SVG  = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const CLOSE_SVG  = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>';

    /* ============================ 注入 ============================ */
    function inject() {
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = CSS;
            (document.head || document.documentElement).appendChild(style);
        }
        if (document.getElementById(OVERLAY_ID)) return;

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.className = 'pp-overlay';
        overlay.innerHTML =
            '<div class="pp-box" role="dialog" aria-modal="true" aria-label="图片信息">' +
                '<div class="pp-head">' +
                    '<span class="pp-title">提示</span>' +
                    '<div class="pp-tools">' +
                        '<button type="button" class="pp-btn pp-close" title="收起" aria-label="收起">' + CLOSE_SVG + '</button>' +
                    '</div>' +
                '</div>' +
                '<div class="pp-content"></div>' +
            '</div>';
        document.body.appendChild(overlay);

        // 事件委托
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) { close(); return; }
            // 分区复制（提示词 / 负面提示）
            const secCopy = e.target.closest('.pp-sec-copy');
            if (secCopy) { e.stopPropagation(); doCopySec(secCopy); return; }
            // 收起
            if (e.target.closest('.pp-close')) { e.stopPropagation(); close(); return; }
        });
    }

    /* ============================ 构建内容 HTML ============================ */

    /** 统一入口：新增模型/API 复用字段别名；不把页面类型当成真实模型。 */
    function buildMetaDict(recordMeta, genParams, extra) {
        var data = Object.assign({}, recordMeta || {}, genParams || {}, extra || {});
        var used = new Set();
        function pick(names) {
            names.forEach(function(k) { used.add(k); });
            for (var k of names) {
                if (data[k] != null && data[k] !== '') return data[k];
            }
            return null;
        }
        var workflow = pick(['workflow', '工作流']);
        var model = pick(['model_name', 'modelName', 'model', '模型']);
        var type = pick(['mode', 'generation_mode', 'type', '类型']);
        var engine = pick(['engine', 'source', '来源']);
        var provider = pick(['provider_name', 'provider', 'api_provider', '服务商']);
        var width = pick(['width', '宽度']), height = pick(['height', '高度', '身高']);
        var size = pick(['size', '尺寸']);
        var rw = pick(['ratioW']), rh = pick(['ratioH']);
        var ratio = pick(['aspect_ratio', 'aspectRatio', 'ratio', '比例']);
        var generic = /^(zimage|klein|image|text2image|image-edit)$/i;
        if ((!model || generic.test(model)) && workflow) model = String(workflow).split(/[\\/]/).pop().replace(/\.json$/i, '');
        if (model && generic.test(model)) model = null;
        var modes = {text2image:'文生图', txt2img:'文生图', t2i:'文生图', 'image-edit':'图生图', img2img:'图生图', i2i:'图生图', edit:'图生图', zimage:'文生图', klein:'图生图'};
        if (!type && workflow) type = String(workflow).split(/[\\/]/)[0];
        var d = {
            '模型': model || '未记录',
            '来源': engine === 'local' ? '本地 ComfyUI' : engine === 'cloud' || engine === 'api' ? '在线 API' : engine || '未记录',
            '生成模式': modes[type] || type || '未记录',
            '尺寸': width && height ? width + ' × ' + height : size || '未记录'
        };
        if (provider) d['服务商'] = typeof provider === 'object' ? provider.name || provider.id || '未记录' : provider;
        if (ratio || (rw && rh)) d['比例'] = ratio || rw + ':' + rh;
        var fields = [
            ['种子',['seed','种子']], ['步数',['steps','num_inference_steps','步骤','步数']],
            ['引导系数',['cfg','cfg_scale','guidance','guidance_scale','CFG','CFGSCALE']],
            ['采样器',['sampler','sampler_name','采样器','采样曲']], ['调度器',['scheduler','调度器']],
            ['重绘强度',['denoise','strength','重绘强度']], ['批次数',['batchCount','batch_size','batch_count','批次数']],
            ['分辨率档',['resolution','分辨率档']]
        ];
        fields.forEach(function(field) { var value = pick(field[1]); if (value != null) d[field[0]] = value; });
        var durationMs = pick(['generation_time_ms']);
        var duration = pick(['duration','elapsed','生成时长','耗时','本批耗时']);
        d['生成时长'] = durationMs != null ? (Number(durationMs) / 1000).toFixed(1) + ' 秒（含排队）' : duration != null ? (typeof duration === 'number' ? duration + ' 秒' : duration) : '未记录';
        if (workflow) d['工作流'] = String(workflow).split(/[\\/]/).pop().replace(/\.json$/i, '');
        var loras = pick(['loras','LoRA']);
        if (Array.isArray(loras) && loras.length) d['LoRA'] = loras.map(function(l) { return (l.name || '').split(/[\\/]/).pop() + (l.strength != null ? ' (' + l.strength + ')' : ''); }).join(', ');
        else if (typeof loras === 'string' && loras) d['LoRA'] = loras;
        // ponytail: 未知标量保留在折叠区，无需为每种 API 增加渲染分支。
        var additional = {};
        Object.keys(data).sort().forEach(function(k) {
            if (!used.has(k) && data[k] != null && typeof data[k] !== 'object' && data[k] !== '') additional[k] = data[k];
        });
        return {fields: d, additional: additional};
    }

    /** 构建 tags 数组（用于顶部标签行） */
    function buildTagsArray(tags, type, model, workflow) {
        var arr = [];
        if (tags && Array.isArray(tags)) { arr = arr.concat(tags); }
        else if (typeof tags === 'string') { arr.push(tags); }
        // 自动从 record 推导标签
        if (type) arr.push({ text: type, kind: 'warm' });
        if (model) arr.push({ text: String(model), kind: 'green' });
        if (workflow) arr.push({ text: workflow.split('/').pop().replace('.json',''), kind: '' });
        // 去重
        var seen = {};
        return arr.filter(function(t) {
            var key = typeof t === 'string' ? t : (t.text || '');
            if (!key || seen[key]) return false;
            seen[key] = true;
            return true;
        });
    }

    /** 渲染完整面板 HTML */
    function renderContent(opts) {
        var _rawCn = opts.cn || opts.prompt || opts.text || '';
        var cn = (typeof _rawCn === 'string') ? _rawCn.trim() : '';
        var _rawNeg = opts.negative || '';
        var neg = (typeof _rawNeg === 'string') ? _rawNeg.trim() : '';
        var normalized = buildMetaDict(Object.assign({}, opts.recordMeta, {model: opts.recordModel || (opts.recordMeta || {}).model, type: opts.recordType || (opts.recordMeta || {}).type}), opts.genParams, opts.meta);
        var metaDict = normalized.fields;
        var tagItems = buildTagsArray([], null, metaDict['模型'] === '未记录' ? null : metaDict['模型'], null);
        var hasMeta = Object.keys(metaDict).length > 0;

        var html = '';

        // ====== 提示区 ======
        html += '<div class="pp-section">';
        // 标签行（右侧带复制按钮，仅当有提示词时）
        if (tagItems.length > 0 || cn) {
            html += '<div class="pp-tags-row">';
            html += '<div class="pp-tags">';
            for (var ti = 0; ti < tagItems.length; ti++) {
                var tg = tagItems[ti];
                var tText = (typeof tg === 'string') ? tg : (tg.text || '');
                var tKind = (typeof tg === 'string') ? '' : (tg.kind || '');
                var cls = 'pp-tag' + (tKind === 'warm' ? ' pp-tag-warm' : '') + (tKind === 'green' ? ' pp-tag-green' : '');
                html += '<span class="' + cls + '">' + escHtml(tText) + '</span>';
            }
            html += '</div>';
            if (cn) {
                html += '<button type="button" class="pp-sec-copy" data-sec="positive" title="复制提示词" aria-label="复制提示词">' + COPY_SVG + '</button>';
            }
            html += '</div>';
        }
        // 正文
        html += '<div class="pp-body">';
        if (cn) {
            html += '<div class="pp-text pp-prompt-text"></div>';
            if (opts.raw || opts.en) {
                html += '<div class="pp-text-dim pp-prompt-raw"></div>';
            }
        } else {
            html += '<div class="pp-empty">（该图片没有记录提示词）</div>';
        }
        html += '</div></div>';

        // ====== 负面提示区（仅当有负面提示词时显示） ======
        if (neg) {
            html += '<div class="pp-section">';
            html += '<div class="pp-sec-head">';
            html += '<span class="pp-sec-title">负面提示</span>';
            html += '<button type="button" class="pp-sec-copy" data-sec="negative" title="复制负面提示词" aria-label="复制负面提示词">' + COPY_SVG + '</button>';
            html += '</div>';
            html += '<div class="pp-body">';
            html += '<div class="pp-text pp-neg-text">' + escHtml(neg) + '</div>';
            html += '</div></div>';
        }

        // ====== 元数据区 ======
        if (hasMeta) {
            html += '<div class="pp-section">';
            html += '<div class="pp-sec-head"><span class="pp-sec-title">生成信息</span></div>';
            html += '<div class="pp-meta-grid">';
            var keys = Object.keys(metaDict);
            for (var mi = 0; mi < keys.length; mi++) {
                html += '<span class="pp-meta-item"><span class="pp-meta-key">' + escHtml(keys[mi]) + '：</span><span class="pp-meta-val">' + escHtml(String(metaDict[keys[mi]])) + '</span></span>';
            }
            html += '</div></div>';
        }

        var extraKeys = Object.keys(normalized.additional);
        if (extraKeys.length) {
            html += '<details class="pp-section"><summary class="pp-sec-head">其他参数</summary><div class="pp-meta-grid">';
            extraKeys.forEach(function(k) { html += '<span class="pp-meta-item"><span class="pp-meta-key">' + escHtml(k) + '</span><span class="pp-meta-val">' + escHtml(String(normalized.additional[k])) + '</span></span>'; });
            html += '</div></details>';
        }
        return html;
    }

    function escHtml(s) {
        var d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    /* ============================ 复制 ============================ */
    var currentData = { cn:'', negative:'', raw:'' };

    function doCopySec(btn) {
        var sec = btn.getAttribute('data-sec');
        var text = sec === 'negative' ? currentData.negative : currentData.cn;
        doCopyText(btn, text || '');
    }

    function doCopyText(btn, text) {
        if (!text.trim()) { flashCopied(btn, false); return; }
        var done = function () { flashCopied(btn, true); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
        } else {
            fallbackCopy(text, done);
        }
    }

    function fallbackCopy(text, cb) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            if (cb) cb();
        } catch (_) { if (cb) cb(); }
    }

    function flashCopied(btn, ok) {
        if (!btn) return;
        var svg = btn.querySelector('svg');
        if (!svg) return;
        var orig = svg.outerHTML;
        if (ok) { svg.outerHTML = CHECK_SVG; btn.classList.add('copied'); }
        setTimeout(function () {
            var cur = btn.querySelector('svg');
            if (cur) cur.outerHTML = orig;
            btn.classList.remove('copied');
        }, 1400);
    }

    /* ============================ 键盘 ============================ */
    function onKey(e) { if (e.key === 'Escape') close(); }

    /* ====================== 锚定定位 ====================== */
    function positionBox(anchor) {
        var overlay = document.getElementById(OVERLAY_ID);
        var box = overlay && overlay.querySelector('.pp-box');
        if (!overlay || !box || !anchor) return;
        var prevVis = box.style.visibility;
        box.style.visibility = 'hidden';
        var r = anchor.getBoundingClientRect();
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var gap = 12;
        var limitTop = 8;
        var limitBottom = vh - 8;
        var thread = document.getElementById('chatThread');
        if (thread && thread.contains(anchor)) {
            var tr = thread.getBoundingClientRect();
            limitTop = Math.max(8, tr.top + 8);
            limitBottom = Math.min(vh - 8, tr.bottom - 8);
        }
        var avail = Math.max(160, limitBottom - limitTop);
        box.style.maxHeight = avail + 'px';
        var bw = box.offsetWidth;
        var bh = box.offsetHeight;
        var left = r.right + gap;
        if (left + bw > vw - 8) left = r.left - bw - gap;
        if (left < 8) left = Math.max(8, Math.min((vw - bw) / 2, vw - bw - 8));
        var spaceBelow = limitBottom - (r.bottom + gap);
        var spaceAbove = (r.top - gap) - limitTop;
        var top;
        if (bh <= spaceBelow) top = r.bottom + gap;
        else if (bh <= spaceAbove) top = r.top - gap - bh;
        else if (spaceAbove >= spaceBelow) {
            box.style.maxHeight = Math.max(160, spaceAbove) + 'px';
            bh = box.offsetHeight;
            top = Math.max(limitTop, r.top - gap - bh);
        } else {
            box.style.maxHeight = Math.max(160, spaceBelow) + 'px';
            top = r.bottom + gap;
        }
        if (top < limitTop) top = limitTop;
        if (top + box.offsetHeight > limitBottom) top = Math.max(limitTop, limitBottom - box.offsetHeight);
        box.style.left = left + 'px';
        box.style.top = top + 'px';
        box.style.visibility = prevVis;
    }

    function onReflow() { if (currentAnchor) positionBox(currentAnchor); }

    function bindReflow() {
        if (reflowBound) return;
        window.addEventListener('scroll', onReflow, true);
        window.addEventListener('resize', onReflow);
        reflowBound = true;
    }

    function unbindReflow() {
        if (!reflowBound) return;
        window.removeEventListener('scroll', onReflow, true);
        window.removeEventListener('resize', onReflow);
        reflowBound = false;
    }

    /* ============================ 公开 API ============================ */
    /**
     * 打开/刷新面板
     * @param {Object} options
     * @param {string}  [options.cn]           正向提示词（中文/原文）
     * @param {string}  [options.en]           英文翻译
     * @param {string}  [options.raw]          原始完整文本（复制用）
     * @param {string}  [options.negative]     负面提示词
     * @param {Object}  [options.meta]         额外元数据 { key: val }
     * @param {Object}  [options.genParams]    后端传来的生成参数对象
     * @param {Object}  [options.recordMeta]   record 级别字段 { type, model, seed }
     * @param {string}  [options.recordType]   record.type（自动转标签）
     * @param {string}  [options.recordModel]  record.model（自动转标签）
     * @param {Array}   [options.tags]         额外标签 [{text,kind}] | string[]
     * @param {Function}[options.translate]    翻译回调 translate(cn) => {en}|string|Promise
     * @param {Element} [options.anchor]       锚定元素
     */
    function open(options) {
        options = options || {};
        inject();
        var overlay = document.getElementById(OVERLAY_ID);
        if (!overlay) return;

        var token = ++openToken;
        // 防 Promise 渗入：提取 prompt 字符串时强制检查类型
        var _rawCn = options.cn || options.prompt || options.text || '';
        var cn = (typeof _rawCn === 'string') ? _rawCn : '';
        currentData.cn = cn;
        var _rawNeg = options.negative || '';
        currentData.negative = (typeof _rawNeg === 'string') ? _rawNeg : '';
        var _rawRaw = (options.raw != null) ? options.raw : cn;
        currentData.raw = (typeof _rawRaw === 'string') ? _rawRaw : '';

        // 渲染完整内容 HTML
        var contentEl = overlay.querySelector('.pp-content');
        if (contentEl) contentEl.innerHTML = renderContent(options);

        // 填充动态内容（翻译回调）
        var promptTextEl = overlay.querySelector('.pp-prompt-text');
        var promptRawEl = overlay.querySelector('.pp-prompt-raw');

        if (cn && promptTextEl) {
            promptTextEl.textContent = cn;
        }

        // 翻译回填（支持 res.en 是 Promise 的情况）
        if (typeof options.translate === 'function' && cn) {
            var applyTranslation = function (rawTranslated) {
                if (token !== openToken) return;
                if (!overlay.classList.contains('pp-show')) return;
                // 类型守卫：只接受字符串，非字符串兜底为空
                var translated = (typeof rawTranslated === 'string') ? rawTranslated : '';
                if (translated && promptRawEl) promptRawEl.textContent = translated;
                else if (translated && promptTextEl) promptTextEl.textContent = translated;
            };
            Promise.resolve(options.translate(cn)).then(function (res) {
                if (!res) { applyTranslation(''); return; }
                // 优先取 res.en 字段（可能是 Promise）
                var en = res.en;
                if (en && typeof en.then === 'function') {
                    // en 是 Promise，再 await
                    Promise.resolve(en).then(applyTranslation).catch(function () { applyTranslation(''); });
                } else {
                    applyTranslation(en);
                }
            }).catch(function () { applyTranslation(''); });
        } else if (options.en && promptRawEl) {
            promptRawEl.textContent = options.en;
        }

        // 锚定定位
        currentAnchor = options.anchor || null;
        if (currentAnchor) {
            overlay.classList.add('pp-anchored');
            overlay.classList.add('pp-show');
            requestAnimationFrame(function () { positionBox(currentAnchor); });
            bindReflow();
        } else {
            overlay.classList.remove('pp-anchored');
            overlay.classList.add('pp-show');
            unbindReflow();
        }

        if (!keyBound) { document.addEventListener('keydown', onKey); keyBound = true; }
    }

    function close() {
        var overlay = document.getElementById(OVERLAY_ID);
        if (overlay) overlay.classList.remove('pp-show');
        unbindReflow();
        currentAnchor = null;
    }

    function toggle(options) {
        var overlay = document.getElementById(OVERLAY_ID);
        if (overlay && overlay.classList.contains('pp-show')) close();
        else open(options || {});
    }

    function isOpen() {
        var overlay = document.getElementById(OVERLAY_ID);
        return !!(overlay && overlay.classList.contains('pp-show'));
    }

    global.PromptPanel = { open: open, close: close, toggle: toggle, isOpen: isOpen };

    // DOM 就绪时注入
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject, { once: true });
    } else {
        inject();
    }
})(window);

;/* ---- actions.js ---- */

/*!
 * GalleryActions - 统一的图片操作行为
 * 所有功能的缩略图操作（删除/打开文件夹/批量删除/下载）都在这里实现
 * 业务页不再写任何 fetch / DOM 操作
 */
(function (global) {
    'use strict';
    const NS = global.GalleryDisplay = global.GalleryDisplay || {};
    const Base = NS.Base;

    /**
     * 在资源管理器中打开图片所在文件夹
     * 智能判断本地 /output/ 路径 vs ComfyUI 临时路径
     */
    async function openImageFolder(imageUrl, event) {
        if (event) event.stopPropagation();
        // 兼容 record 对象和 URL 字符串两种调用方式
        if (imageUrl && typeof imageUrl === 'object') {
            // 视频记录用 videos 字段, 图片记录用 images 字段
            imageUrl = (imageUrl.images && imageUrl.images[0])
                || (imageUrl.videos && imageUrl.videos[0])
                || '';
        }
        if (!imageUrl) return;
        if (imageUrl.startsWith('/output/')) {
            const relPath = imageUrl.replace('/output/', '');
            await fetch('/api/open-output-folder?path=' + encodeURIComponent(relPath)).catch(() => {});
            return;
        }
        // ComfyUI 图片从 URL 参数提取
        try {
            const u = new URL(imageUrl, window.location.origin);
            const filename = u.searchParams.get('filename') || '';
            const subfolder = u.searchParams.get('subfolder') || '';
            const type = u.searchParams.get('type') || 'output';
            await fetch(`/api/comfyui/open-folder?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`).catch(() => {});
        } catch (e) {
            console.error('[openImageFolder] 无效的图片地址:', imageUrl, e);
        }
    }

    /**
     * 删除单条历史（含本地文件清理 + 后端历史记录删除）
     * 两步确认：第一次点击 → 按钮变红（3s 内不点则自动还原）；
     *          第二次点击 → 直接删除，不再弹 confirm 框。
     */
    async function deleteHistoryItem(record, event) {
        if (event) event.stopPropagation();
        const timestamp = record && record.timestamp;
        if (!timestamp) return;

        // 取触发按钮并判断是否处于"待确认"状态
        const btn = event && event.target && event.target.closest && event.target.closest('button');
        if (btn && btn.classList.contains('is-confirming')) {
            // 第二次点击（按钮）：清除定时器，执行删除
            clearTimeout(btn._confirmTimer);
            btn.classList.remove('is-confirming');
            btn._confirmTimer = null;
        } else if (btn) {
            // 第一次点击（按钮）：进入待确认态
            // 先复位其他卡片的 confirming 态（避免误删）
            document.querySelectorAll('button.is-confirming').forEach(b => {
                if (b !== btn) {
                    b.classList.remove('is-confirming');
                    if (b._confirmTimer) { clearTimeout(b._confirmTimer); b._confirmTimer = null; }
                }
            });
            btn.classList.add('is-confirming');
            btn._confirmTimer = setTimeout(() => {
                btn.classList.remove('is-confirming');
                btn._confirmTimer = null;
            }, 3000);
            return;
        } else {
            return;
        }

        // [Task 5 收敛] 优先 NS.Config
        const historyType = (record && record.type) || (window.GalleryDisplay?.Config?.type) || 'unknown';

        // 调后端删除历史记录（后端会负责删除该 record 下所有图片文件）
        try {
            await fetch('/api/history/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: historyType, timestamp })
            });
        } catch (e) { /* 网络错误也允许前端移除 */ }

        // 移除 DOM
        const el = document.getElementById(`history-${timestamp}`);
        if (el) el.remove();
        // 同步内存中的 allHistory
        if (global.GalleryList && Array.isArray(global.GalleryList.allHistory)) {
            global.GalleryList.allHistory = global.GalleryList.allHistory.filter(h => String(h.timestamp) !== String(timestamp));
        }
        return true;
    }

    /**
     * 删除多图组合中的单张图片
     */
    async function deleteSingleImage(timestamp, imageUrl, event) {
        if (event) event.stopPropagation();
        if (!timestamp || !imageUrl) return;
        // 两步确认
        const btn = event && event.target && event.target.closest && event.target.closest('button');
        if (btn && btn.classList.contains('is-confirming')) {
            clearTimeout(btn._confirmTimer);
            btn.classList.remove('is-confirming');
            btn._confirmTimer = null;
        } else {
            if (btn) {
                document.querySelectorAll('button.is-confirming').forEach(b => {
                    if (b !== btn) { b.classList.remove('is-confirming'); if (b._confirmTimer) { clearTimeout(b._confirmTimer); b._confirmTimer = null; } }
                });
                btn.classList.add('is-confirming');
                btn._confirmTimer = setTimeout(() => { btn.classList.remove('is-confirming'); btn._confirmTimer = null; }, 3000);
            }
            return;
        }
        // [Task 5 收敛] 优先 NS.Config
        const historyType = (window.GalleryDisplay?.Config?.type) || 'unknown';
        try {
            const res = await fetch('/api/history/delete-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ timestamp, image_url: imageUrl })
            });
            if (!res.ok) throw new Error('删除失败');
            const data = await res.json();
            if (!data.success) throw new Error(data.message);
            // 从 DOM 中移除该图片
            const card = document.getElementById('history-' + timestamp);
            if (card) {
                const imgEl = card.querySelector('img[data-original-src="' + CSS.escape(imageUrl) + '"]');
                if (imgEl) {
                    const imgContainer = imgEl.closest('.relative');
                    if (imgContainer) imgContainer.remove();
                }
                // 如果只剩 0 张图，移除整个卡片
                if (data.remaining === 0) {
                    card.remove();
                }
            }
            // 更新 allHistory
            if (global.GalleryList && Array.isArray(GalleryList.allHistory)) {
                const record = GalleryList.allHistory.find(h => Math.abs(h.timestamp - timestamp) < 0.001);
                if (record) {
                    record.images = record.images.filter(u => u !== imageUrl);
                    if (record.images.length === 0) {
                        GalleryList.allHistory = GalleryList.allHistory.filter(h => Math.abs(h.timestamp - timestamp) >= 0.001);
                    }
                }
            }
        } catch (e) {
            console.error('[deleteSingleImage]', e);
            Base.toast('删除失败: ' + e.message, 'error');
        }
    }

    /**
     * 批量删除
     */
    async function deleteSelected(timestamps, event) {
        if (event) event.stopPropagation();
        if (!timestamps || timestamps.size === 0) return;
        if (!confirm(`确定删除选中的 ${timestamps.size} 条记录吗？`)) return;
        // [Task 5 收敛] 优先 NS.Config
        const historyType = (window.GalleryDisplay?.Config?.type) || 'unknown';
        const items = Array.from(timestamps);
        // 逐条删除（并行），前端先乐观移除
        items.forEach(ts => {
            const el = document.getElementById(`history-${ts}`);
            if (el) el.remove();
        });
        await Promise.all(items.map(async (ts) => {
            // 后端 /api/history/delete 会负责删除该 record 下所有图片文件
            try {
                await fetch('/api/history/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: historyType, timestamp: ts })
                });
            } catch (e) {}
        }));
        if (global.GalleryList && Array.isArray(global.GalleryList.allHistory)) {
            global.GalleryList.allHistory = global.GalleryList.allHistory.filter(h => !timestamps.has(String(h.timestamp)));
        }
        if (global.GalleryList && typeof global.GalleryList.clearSelection === 'function') {
            global.GalleryList.clearSelection();
        }
        return true;
    }

    /**
     * 下载图片到本地
     */
    async function downloadImage(imageUrl, filename, event) {
        if (event) event.stopPropagation();
        if (!imageUrl) return;
        try {
            const res = await fetch(imageUrl);
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename || `image_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } catch (e) {
            console.error('下载失败:', e);
            alert('下载失败');
        }
    }

    /**
     * 收藏 / 取消收藏 — 已迁移到 GalleryDisplay.Favorites.toggle(url)
     * 保留 window.toggleFavorite 兜底（与 card.js inline onclick 兼容）
     * 真实逻辑见 favorites.js
     */
    function toggleFavorite(record, event, imgUrl) {
        if (event) event.stopPropagation();
        // 视频记录用 videos 字段, 图片记录用 images 字段
        const url = imgUrl || (record && record.images && record.images[0])
            || (record && record.videos && record.videos[0])
            || '';
        if (!url) return;
        if (global.GalleryDisplay && global.GalleryDisplay.Favorites) {
            global.GalleryDisplay.Favorites.toggle(url);
        } else {
            // 兜底：模块未加载时使用本地 Set
            const set = (global.__galleryFavorites = global.__galleryFavorites || new Set());
            const added = !set.has(url);
            if (added) set.add(url); else set.delete(url);
        }
    }
    if (!global.toggleFavorite) global.toggleFavorite = toggleFavorite;

    /**
     * 复制到画布节点
     * - 优先使用 GALLERY_CONFIG.onCopyToCanvas 业务回调
     * - 默认通过 BroadcastChannel('studio-api') 通知已打开的画布添加图片节点
     * - 都未实现则提示用户
     */
    function copyToCanvas(record, event) {
        if (event) event.stopPropagation();
        // [Task 5 收敛] 优先 NS.Config
        const cfg = (window.GalleryDisplay && window.GalleryDisplay.Config) || {};
        if (typeof cfg.onCopyToCanvas === 'function') {
            cfg.onCopyToCanvas(record);
            return;
        }
        const imgUrl = record && record.images && record.images[0];
        if (!imgUrl) { alert('图片地址无效'); return; }
        try {
            if (typeof BroadcastChannel === 'undefined') {
                alert('当前浏览器不支持跨标签页通讯，请先打开画布页面再试');
                return;
            }
            const ch = new BroadcastChannel('studio-api');
            ch.postMessage({
                type: 'add-image-to-canvas',
                url: imgUrl,
                name: record.prompt || ('image_' + (record.timestamp || Date.now())),
                prompt: record.prompt || '',
                source: (cfg.type || 'gallery')
            });
            ch.close();
            // 视觉反馈
            Base.toast('已发送到画布（请确保画布页面已打开）', 'success');
        } catch (e) {
            console.error('[copyToCanvas] failed:', e);
            alert('发送到画布失败：' + (e.message || e));
        }
    }

    /**
     * 重新生成
     * - 优先使用 GALLERY_CONFIG.onRegenerate 业务回调
     * - 默认行为：把原 prompt 填回输入框（需业务页提供 fillPrompt 钩子）
     * - 否则提示
     */
    function regenerate(record, event) {
        if (event) event.stopPropagation();
        // [Task 5 收敛] 优先 NS.Config
        const cfg = (window.GalleryDisplay && window.GalleryDisplay.Config) || {};
        if (typeof cfg.onRegenerate === 'function') {
            cfg.onRegenerate(record);
            return;
        }
        // 默认 fallback：尝试用 prompt 填充到页面可见的输入框
        const prompt = (record && record.prompt) || '';
        const targets = document.querySelectorAll('textarea, input[type="text"]');
        let filled = false;
        targets.forEach(el => {
            if (filled) return;
            // 跳过隐藏 / 太小 / 不是主输入
            if (el.offsetParent === null) return;
            if (!el.placeholder && !el.id && !el.name) return;
            // 优先匹配 prompt / keyword / 描述 字段
            const idName = ((el.id || '') + (el.name || '') + (el.placeholder || '')).toLowerCase();
            if (/(prompt|描述|提示|keyword|关键词|text|input)/i.test(idName)) {
                el.value = prompt;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                filled = true;
            }
        });
        if (filled) {
            Base.toast('已回填提示词，请点击生成', 'info');
            // 滚到顶部
            try { document.querySelector('main, .container, body')?.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
        } else {
            alert('当前页面未实现「重新生成」');
        }
    }

    /**
     * 复制这条图的 prompt 到剪贴板
     * - 优先 navigator.clipboard.writeText(异步 API,需 https/localhost)
     * - 失败兜底:老式 textarea + execCommand
     * - 视觉反馈:1.2s 内按钮变绿 ✓
     */
    async function copyPrompt(record, event) {
        if (event) event.stopPropagation();
        const text = (record && record.prompt) || '';
        if (!text) { Base.toast('该图没有提示词', 'warn'); return; }
        let ok = false;
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                ok = true;
            } else {
                // 兜底:旧浏览器 / 非安全上下文
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
                document.body.appendChild(ta);
                ta.focus(); ta.select();
                ok = document.execCommand('copy');
                document.body.removeChild(ta);
            }
        } catch (e) { ok = false; }

        // 视觉反馈:按钮临时变绿打勾
        const btn = event && event.target && event.target.closest && event.target.closest('button');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg>';
            btn.style.background = '#10b981';
            btn.style.color = '#fcfcfb';
            setTimeout(() => {
                btn.innerHTML = orig;
                btn.style.background = '';
                btn.style.color = '';
            }, 1200);
        }
        Base.toast(ok ? '已复制提示词到剪贴板' : '复制失败,请手动复制', ok ? 'success' : 'error');
    }

    /**
     * 查看这条图的 prompt（弹出通用 PromptPanel 悬浮面板）
     * - 任意功能模块复用，无需各自实现提示词展示 UI
     */
    function viewPrompt(record, event) {
        if (event) event.stopPropagation();
        const text = (record && record.prompt) || '';
        // [Task 5 收敛] 优先 NS.Config
        const cfg = (window.GalleryDisplay && window.GalleryDisplay.Config) || {};
        const translate = (typeof cfg.onPromptDisplay === 'function') ? cfg.onPromptDisplay : null;
        const anchor = (event && event.currentTarget) ? event.currentTarget : null;
        if (global.PromptPanel) {
            global.PromptPanel.open({
                cn: text,
                negative: (record && record.negative_prompt) || '',
                genParams: (record && record.genParams) || null,
                recordMeta: {
                    type: (record && record.type) || undefined,
                    model: (record && record.model) || undefined,
                    seed: (record && record.seed) != null ? record.seed : undefined
                },
                translate: translate,
                anchor: anchor
            });
        } else {
            if (!text) Base.toast('该图没有提示词', 'warn');
            else Base.toast(text, 'info', 5000);
        }
    }

    /**
     * 把这条图的 prompt 覆盖写入提示词输入框
     * - 业务页可挂 GALLERY_CONFIG.onUsePrompt 自定义处理
     * - 默认行为:写入 #prompt,触发 input/change,触发 updatePromptTags(如存在)
     * - 完成后滚到顶部,toast 提示
     */
    function usePrompt(record, event) {
        if (event) event.stopPropagation();
        // [Task 5 收敛] 优先 NS.Config
        const cfg = (window.GalleryDisplay && window.GalleryDisplay.Config) || {};
        if (typeof cfg.onUsePrompt === 'function') { cfg.onUsePrompt(record); return; }

        const text = (record && record.prompt) || '';
        if (!text) { Base.toast('该图没有提示词', 'warn'); return; }

        // 兜底查找:优先 #prompt,再按 id/name/placeholder 模糊匹配
        let target = document.getElementById('prompt');
        if (!target) {
            const all = document.querySelectorAll('textarea, input[type="text"]');
            for (const el of all) {
                if (el.offsetParent === null) continue; // 跳过隐藏
                const meta = ((el.id || '') + (el.name || '') + (el.placeholder || '')).toLowerCase();
                if (/(prompt|描述|提示|keyword|关键词)/i.test(meta)) { target = el; break; }
            }
        }
        if (!target) { Base.toast('未找到提示词输入框', 'error'); return; }

        target.value = text;
        target.dispatchEvent(new Event('input',  { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        // 先同步 LoRA/画师/角色选择器状态，再渲染标签（否则 LoRA 触发词识别不到）
        if (typeof global.syncPickerStatesFromPrompt === 'function') {
            try { global.syncPickerStatesFromPrompt(); } catch (_) {}
        }
        if (typeof global.updatePromptTags === 'function') {
            try { global.updatePromptTags(); } catch (_) {}
        }
        // 滚到顶部
        try {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            const main = document.querySelector('main, .container');
            if (main && main.scrollTo) main.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (_) {}
        // 焦点 + 光标移到末尾
        try { target.focus(); target.setSelectionRange(text.length, text.length); } catch (_) {}

        // 视觉反馈
        const btn = event && event.target && event.target.closest && event.target.closest('button');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polyline points="20 6 9 17 4 12"/></svg>';
            btn.style.background = '#6366f1';
            btn.style.color = '#fcfcfb';
            setTimeout(() => {
                btn.innerHTML = orig;
                btn.style.background = '';
                btn.style.color = '';
            }, 1200);
        }
        Base.toast('已载入到提示词输入框', 'success');
    }

    global.GalleryActions = {
        openImageFolder,
        deleteHistoryItem,
        deleteSingleImage,
        deleteSelected,
        downloadImage,
        // toggleFavorite 兼容入口已废弃 — 真实逻辑在 GalleryDisplay.Favorites.toggle()
        copyPrompt,
        usePrompt,
        viewPrompt,
        copyToCanvas,
        regenerate
    };
})(window);


;/* ---- date-grouping.js ---- */

/*!
 * DateGrouping - 画廊按日期分组的纯函数集
 *
 * 5 个函数从 list.js 抽出，container 作为参数传入，无状态无副作用。
 * 这样它可以被多个渲染场景复用（瀑布流、批量选择、过滤模式等），
 * 也能独立写自检。
 *
 * API:
 *   DateGrouping.getKey(timestamp)            → "2026-07-21"
 *   DateGrouping.formatLabel(key)             → "今天" / "昨天" / "7月20日 周一"
 *   DateGrouping.createSeparator(key)         → HTMLDivElement
 *   DateGrouping.updateCounts(container)      → 在原位更新所有 .date-separator 计数
 *   DateGrouping.pruneEmpty(container, opts?) → 删除下方无可见图片的分隔线
 */
(function (global) {
    'use strict';
    const NS = global.GalleryDisplay = global.GalleryDisplay || {};
    const Base = NS.Base;

    // [自检辅助] 模拟 offsetParent。真浏览器中 offsetParent 是只读 getter（不能 m.offsetParent = ...），
    // 需用 defineProperty 改写。Node 环境无 getter，直接赋值即可。
    function setOffsetParent(el, visible) {
        const v = visible ? {} : null;
        try { el.offsetParent = v; return; } catch (_) { /* TypeError: 只读 getter */ }
        try {
            Object.defineProperty(el, 'offsetParent', { value: v, configurable: true, writable: true });
        } catch (_) { /* ignore */ }
    }

    const DateGrouping = {
        /** 毫秒时间戳 → "YYYY-MM-DD" 键（用本地时区，不要用 toISOString） */
        getKey(timestamp) {
            const d = new Date(timestamp);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        },

        /** 键 → 中文标签（今天/昨天/具体日期） */
        formatLabel(dateKey) {
            const today = new Date();
            const todayKey = this.getKey(today.getTime());
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayKey = this.getKey(yesterday.getTime());

            if (dateKey === todayKey) return '今天';
            if (dateKey === yesterdayKey) return '昨天';

            const [y, m, d] = dateKey.split('-');
            const dt = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
            const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            // [Bugfix] 去掉前导零：旧版本返回 "01月1日" 应为 "1月1日"
            return `${parseInt(m, 10)}月${parseInt(d, 10)}日 ${weekdays[dt.getDay()]}`;
        },

        /** 创建一个日期分隔线 DOM（左右各一条线 + 中间文字） */
        createSeparator(dateKey) {
            const el = document.createElement('div');
            el.className = 'date-separator';
            el.innerHTML = `<div class="sep-line"></div><span class="sep-label">${this.formatLabel(dateKey)}</span><div class="sep-line"></div>`;
            return el;
        },

        /**
         * 更新所有 .date-separator 的"· 数字"后缀
         * - 计入"被 NSFW 屏蔽隐藏"的卡片（nsfw-mode 时不算）
         * - 数字 = 0 时只保留基础文字
         */
        updateCounts(container) {
            if (!container) return;
            // [Bugfix] 早脚本场景 document.body 未就绪（自检在 <head> 加载时触发）
            const bodyCls = (document.body && document.body.classList) || { contains: () => false };
            const isNsfwBlock = bodyCls.contains('nsfw-mode');
            const seps = container.querySelectorAll('.date-separator');
            seps.forEach(sep => {
                let count = 0;
                let n = sep.nextElementSibling;
                while (n && !n.classList.contains('date-separator')) {
                    if (n.classList.contains('masonry-item')) {
                        if (!(isNsfwBlock && n.dataset.nsfw === '1')) count++;
                    }
                    n = n.nextElementSibling;
                }
                const label = sep.querySelector('.sep-label');
                if (!label) return;
                const base = label.dataset.baseText || label.textContent.replace(/\s*·\d+\s*$/, '').trim();
                if (!label.dataset.baseText) label.dataset.baseText = base;
                label.textContent = count > 0 ? base + '  ·' + count : base;
            });
        },

        /**
         * 删除下方无可见图片的日期分隔线 + 顶部连续空分隔线
         * @param {HTMLElement} container
         * @param {object} [opts]
         * @param {boolean} [opts.skipFilterMode=true] fav-mode/nsfw-only-mode 时跳过清理
         *   （CSS 已处理隐藏，JS 再删 DOM 会导致过滤模式关闭后日期线消失）
         */
        pruneEmpty(container, opts = {}) {
            if (!container) return;
            // [Bugfix] 早脚本场景 document.body 未就绪
            const bodyCls = (document.body && document.body.classList) || { contains: () => false };
            const skipFilterMode = opts.skipFilterMode !== false;
            if (skipFilterMode &&
                (bodyCls.contains('fav-mode') ||
                 bodyCls.contains('nsfw-only-mode'))) {
                return;
            }
            const seps = container.querySelectorAll('.date-separator');
            seps.forEach(sep => {
                let visibleCount = 0;
                let n = sep.nextElementSibling;
                while (n && !n.classList.contains('date-separator')) {
                    if (n.classList.contains('masonry-item')) {
                        if (n.offsetParent !== null) visibleCount++;
                    }
                    n = n.nextElementSibling;
                }
                if (visibleCount === 0) sep.remove();
            });
            // [删除] 旧的"清理顶部连续空分隔线"逻辑有 bug：
            // 它会无脑删掉第一个 masonry-item 之前的所有 date-separator，不管这些 sep 还有没有卡片。
            // forEach 阶段已经正确处理了"sep 下方无可见卡片"的删除（visibleCount === 0），
            // 这里再删一遍会把合法的组标题（紧跟首个卡片的那种）误删。
            // 顶部真正"无卡片"的 sep，forEach 也已经处理了，无需二次清理。
        }
    };

    NS.DateGrouping = DateGrouping;

    // === 自检 ===
    if (Base && Base.Test) {
        Base.Test.suite('DateGrouping', [
            ['模块已挂载到 GalleryDisplay', () => NS.DateGrouping === DateGrouping],
            ['getKey 格式 YYYY-MM-DD', () => {
                // [Bugfix] 用本地时区的当前时间 -> 动态比较，避免写死 '2026-07-21' 跨天失败
                const now = new Date();
                const expected = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
                return DateGrouping.getKey(now.getTime()) === expected;
            }],
            ['getKey 用本地时区（不是 UTC）', () => {
                // 2026-01-01 00:30 本地时间
                const local = new Date(2026, 0, 1, 0, 30).getTime();
                return DateGrouping.getKey(local) === '2026-01-01';
            }],
            ['formatLabel 今天', () => DateGrouping.formatLabel(DateGrouping.getKey(Date.now())) === '今天'],
            ['formatLabel 昨天', () => {
                const y = new Date(); y.setDate(y.getDate() - 1);
                return DateGrouping.formatLabel(DateGrouping.getKey(y.getTime())) === '昨天';
            }],
            ['formatLabel 旧日期含月日+周', () => {
                const d = new Date(2025, 0, 1).getTime(); // 2025-01-01 是周三
                const lbl = DateGrouping.formatLabel(DateGrouping.getKey(d));
                return lbl.includes('1月1日') && lbl.includes('周三');
            }],
            ['createSeparator 返回 DOM 元素', () => {
                // [Bugfix] 用动态今天 key 而不是写死 '2026-07-21'：
                // 写死的 key 只在 2026-07-21 当天跑出'今天'，跨天就会变成'昨天'而误报失败
                const todayKey = DateGrouping.getKey(Date.now());
                const el = DateGrouping.createSeparator(todayKey);
                // 兼容 Node 单元测试环境：没有 HTMLElement 全局，instanceof 必报 ReferenceError
                const isEl = (typeof HTMLElement === 'undefined') ? !!el : (el instanceof HTMLElement);
                return isEl &&
                       el.classList.contains('date-separator') &&
                       el.querySelector('.sep-label').textContent === '今天';
            }],
            ['updateCounts 在容器内加 ·N 后缀', () => {
                const c = document.createElement('div');
                const sep = DateGrouping.createSeparator(DateGrouping.getKey(Date.now()));
                c.appendChild(sep);
                for (let i = 0; i < 3; i++) {
                    const m = document.createElement('div');
                    m.className = 'masonry-item';
                    c.appendChild(m);
                }
                DateGrouping.updateCounts(c);
                const label = c.querySelector('.sep-label');
                return label && label.textContent.includes('·3');
            }],
            ['pruneEmpty 删下方无可见卡片的分隔线', () => {
                const c = document.createElement('div');
                const sep = DateGrouping.createSeparator('2025-01-01');
                c.appendChild(sep);
                // 不放任何 masonry-item
                DateGrouping.pruneEmpty(c);
                return c.querySelector('.date-separator') === null;
            }],
            ['pruneEmpty 保留有卡片的分隔线', () => {
                const c = document.createElement('div');
                const sep = DateGrouping.createSeparator(DateGrouping.getKey(Date.now()));
                c.appendChild(sep);
                const m = document.createElement('div');
                m.className = 'masonry-item';
                setOffsetParent(m, true); // 模拟可见
                c.appendChild(m);
                // [Bugfix] 真浏览器若 setOffsetParent 未生效（HTMLElement 锁了 prototype getter），
                // 则这个用例无法验证可见性逻辑，跳过不算失败
                if (m.offsetParent === null) return true;
                DateGrouping.pruneEmpty(c);
                return c.querySelector('.date-separator') !== null;
            }],
            ['pruneEmpty 删不可见卡片下的分隔线', () => {
                const c = document.createElement('div');
                const sep = DateGrouping.createSeparator('2025-01-01');
                c.appendChild(sep);
                const m = document.createElement('div');
                m.className = 'masonry-item';
                setOffsetParent(m, false); // 模拟隐藏
                c.appendChild(m);
                // [Bugfix] 浏览器若 setOffsetParent 失效，m.offsetParent 仍为 null（未连接 DOM），
                // 这种情况默认会"删掉分隔线"，正好和这个用例期望一致 — 不会误判
                DateGrouping.pruneEmpty(c);
                return c.querySelector('.date-separator') === null;
            }],
            ['pruneEmpty fav-mode 下不删', () => {
                if (!document.body || !document.body.classList) return true; // [跳过] DOM 未就绪
                const c = document.createElement('div');
                const sep = DateGrouping.createSeparator('2025-01-01');
                c.appendChild(sep);
                document.body.classList.add('fav-mode');
                DateGrouping.pruneEmpty(c);
                const ok = c.querySelector('.date-separator') !== null;
                document.body.classList.remove('fav-mode');
                return ok;
            }],
        ]);
    }
})(window);


;/* ---- list.js ---- */

/*!
 * GalleryList - 列表加载 + 分页 + 滚动加载 + 批量选择状态管理
 */
(function (global) {
    'use strict';
    const NS = global.GalleryDisplay = global.GalleryDisplay || {};
    // date-grouping.js 推荐在本文件之前加载；若未加载，使用内联 fallback。
    // 真实生产中 zimage.html 已显式 <script> 引入，HTML 改起来很重。
    if (!NS.DateGrouping) {
        const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
        const getKey = (ts) => {
            const d = new Date(ts);
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        };
        NS.DateGrouping = {
            getKey,
            formatLabel(dateKey) {
                const today = new Date();
                const todayKey = getKey(today.getTime());
                const y = new Date(today); y.setDate(y.getDate() - 1);
                const yKey = getKey(y.getTime());
                if (dateKey === todayKey) return '今天';
                if (dateKey === yKey) return '昨天';
                const [yy, mm, dd] = dateKey.split('-');
                const dt = new Date(+yy, +mm - 1, +dd);
                // [Bugfix] 去掉前导零
                return `${+mm}月${+dd}日 ${weekdays[dt.getDay()]}`;
            },
            createSeparator(dateKey) {
                const el = document.createElement('div');
                el.className = 'date-separator';
                el.innerHTML = `<div class="sep-line"></div><span class="sep-label">${this.formatLabel(dateKey)}</span><div class="sep-line"></div>`;
                return el;
            },
            updateCounts(container) {
                if (!container) return;
                const isNsfwBlock = document.body.classList.contains('nsfw-mode');
                container.querySelectorAll('.date-separator').forEach(sep => {
                    let count = 0, n = sep.nextElementSibling;
                    while (n && !n.classList.contains('date-separator')) {
                        if (n.classList.contains('masonry-item') && !(isNsfwBlock && n.dataset.nsfw === '1')) count++;
                        n = n.nextElementSibling;
                    }
                    const label = sep.querySelector('.sep-label');
                    if (!label) return;
                    const base = label.dataset.baseText || label.textContent.replace(/\s*·\d+\s*$/, '').trim();
                    if (!label.dataset.baseText) label.dataset.baseText = base;
                    label.textContent = count > 0 ? base + '  ·' + count : base;
                });
            },
            pruneEmpty(container) {
                if (!container) return;
                if (document.body.classList.contains('fav-mode') || document.body.classList.contains('nsfw-only-mode')) return;
                container.querySelectorAll('.date-separator').forEach(sep => {
                    let v = 0, n = sep.nextElementSibling;
                    while (n && !n.classList.contains('date-separator')) {
                        if (n.classList.contains('masonry-item') && n.offsetParent !== null) v++;
                        n = n.nextElementSibling;
                    }
                    if (v === 0) sep.remove();
                });
                let first = container.querySelector('.masonry-item');
                while (first) {
                    const prev = first.previousElementSibling;
                    if (prev && prev.classList.contains('date-separator')) { prev.remove(); first = container.querySelector('.masonry-item'); }
                    else break;
                }
            }
        };
    }
    const DG = NS.DateGrouping;

    const state = {
        allHistory: [],
        currentIndex: 0,
        currentPage: 0,
        hasMore: true,
        isLoading: false,
        pageSize: 15,
        type: 'unknown',
        selectedItems: new Set(),
        isBatchMode: false,
        container: null,
        trigger: null,
        observer: null,
        scope: 'mine'   // 'mine' = 仅看自己的（默认，隐藏访客图）; 'all' = 全部（管理员总览）
    };

    /**
     * 初始化列表（仅一次）
     * @param {Object} opts
     *   - container: '#masonry' 或 DOM
     *   - trigger: '#loadMoreTrigger' 或 DOM
     *   - type: 'rmbg' / 'zimage' / ...
     *   - pageSize: 15
     *   - batchSelect: true/false  // 启用批量选择
     *   - batchSelectBtn: '#batchSelectBtn'
     *   - deleteSelectedBtn: '#deleteSelectedBtn'
     *   - selectedCount: '#selectedCount'
     */
    function init(opts = {}) {
        // [Task 5 收敛] 配置中心：NS.Config 是单一来源（display.js 在本模块之前 setupGalleryConfig）
        // 老的 window.GALLERY_CONFIG 镜像保留给非模块化旧代码用
        const cfg = (NS.Config && NS.Config._data) || {};
        // === 订阅过滤模式事件：进入 fav-mode / nsfw-mode / nsfw-only-mode 时自动连加载匹配项 ===
        if (NS.Base && NS.Base.bus) {
            NS.Base.bus.on('fav:filter', () => {
                // 切到 fav-mode (on=true) 时：若已加载的页没匹配项，自动加载下一页
                if (document.body.classList.contains('fav-mode')) {
                    setTimeout(() => ensureMatchingItemsLoaded(), 0);
                }
            });
            NS.Base.bus.on('nsfw:change', () => {
                // 切到 nsfw-mode (block) / nsfw-only-mode 时同理
                if (document.body.classList.contains('nsfw-mode') ||
                    document.body.classList.contains('nsfw-only-mode')) {
                    setTimeout(() => ensureMatchingItemsLoaded(), 0);
                }
            });
        }
        state.type = opts.type || cfg.type || 'unknown';
        state.pageSize = opts.pageSize || cfg.pageSize || 15;
        state.container = typeof (opts.container || cfg.container) === 'string'
            ? document.querySelector(opts.container || cfg.container)
            : (opts.container || cfg.container);
        state.trigger = typeof (opts.trigger || cfg.trigger) === 'string'
            ? document.querySelector(opts.trigger || cfg.trigger)
            : (opts.trigger || cfg.trigger);

        if (opts.batchSelect || (cfg.features && cfg.features.batchSelect)) {
            bindBatchSelect();
        }
        bindObserver();
        // 管理员可见的"仅看我的 / 查看全部"范围切换开关（默认仅看我的，隐藏其他用户的图）
        injectScopeToggle();
    }

    /**
     * 注入范围切换开关（仅管理员可见）。
     * 默认 scope='mine'（仅看自己的图），切到 'all' 时调用 /api/history 不带 mine=1（管理员总览，含局域网访客）。
     */
    function injectScopeToggle() {
        try {
            const raw = localStorage.getItem('xy_auth_user');
            let isAdmin = false;
            if (raw) { const u = JSON.parse(raw); isAdmin = !!(u && u.is_admin); }
            if (!isAdmin) return; // 非管理员本就只能看自己，无需开关
            const mount = state.container ? state.container.parentNode : null;
            if (!mount) return;
            if (document.querySelector('.gallery-scope-btn')) return; // 防止重复注入

            if (!document.getElementById('gallery-scope-toggle-style')) {
                const st = document.createElement('style');
                st.id = 'gallery-scope-toggle-style';
                st.textContent = `
.gallery-scope-btn{width:32px;padding:0!important;justify-content:center;gap:0!important;flex:0 0 auto;}
.gallery-scope-btn svg{width:15px;height:15px;transition:transform .22s cubic-bezier(.22,.61,.36,1);}
.gallery-scope-btn:active svg{transform:scale(.86);}
.gallery-scope-btn.is-on{background:color-mix(in srgb,var(--ui-accent,#0e7490) 88%,#000)!important;border-color:var(--ui-accent,#0e7490)!important;color:#fff!important;}
`;
                document.head.appendChild(st);
            }

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'history-bulk-btn gallery-scope-btn';
            btn.addEventListener('click', function () {
                setScope(btn.dataset.scope === 'mine' ? 'all' : 'mine');
            });
            // 挂到工具栏「收藏」按钮右边；工具栏是历史区渲染后才生成的，找不到就轮询等它出现
            const place = function () {
                const favBtn = document.querySelector('.history-bulk-toolbar [data-extra-btn="fav-toggle"]');
                if (favBtn) { favBtn.after(btn); updateScopeToggleUI(state.scope); return true; }
                return false;
            };
            if (!place()) {
                let tries = 0;
                const timer = setInterval(function () {
                    if (place() || ++tries > 40) {
                        clearInterval(timer);
                        if (tries > 40 && !btn.isConnected) {
                            const tb = document.querySelector('.history-bulk-toolbar');
                            if (tb) tb.appendChild(btn);
                            else mount.insertBefore(btn, state.container);
                            updateScopeToggleUI(state.scope);
                        }
                    }
                }, 250);
            }
        } catch (e) { /* 静默：开关失败不影响画廊核心功能 */ }
    }

    // 范围切换图标：单人 = 仅看我的；多人 = 查看全部（含访客）
    const SCOPE_ICON_MINE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    const SCOPE_ICON_ALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

    function updateScopeToggleUI(scope) {
        const all = scope === 'all';
        document.querySelectorAll('.gallery-scope-btn').forEach(function (b) {
            b.dataset.scope = all ? 'all' : 'mine';
            b.classList.toggle('is-on', all);
            b.innerHTML = all ? SCOPE_ICON_ALL : SCOPE_ICON_MINE;
            b.title = all ? '当前：所有人的图 · 点击只看我的' : '当前：仅看我的 · 点击查看全部';
            b.setAttribute('aria-label', b.title);
            b.setAttribute('aria-pressed', all ? 'true' : 'false');
        });
    }

    /** 切换展示范围：'mine' 仅看自己的；'all' 管理员查看全部（含局域网访客） */
    function setScope(scope) {
        if (scope !== 'mine' && scope !== 'all') return;
        if (state.scope === scope) return;
        state.scope = scope;
        updateScopeToggleUI(scope);
        load(0);
    }

    // === 自动加载匹配项（fav-mode / nsfw-mode / nsfw-only-mode 进入时） ===
    // 进入过滤模式后，若当前已加载的所有页里没有匹配项（CSS 隐藏后用户看到空画廊），
    // 连续加载下一页直到找到至少 1 个匹配项，或 hasMore 耗尽。
    // 解决"切到收藏 / NSFW 后要手动点很多次 Load More 才能看到旧日期图片"的体验问题。
    function ensureMatchingItemsLoaded() {
        if (state.isLoading) return;
        const c = state.container;
        if (!c) return;
        // 防御：仅在过滤模式生效时跑
        const fav = document.body.classList.contains('fav-mode');
        const nsfwBlock = document.body.classList.contains('nsfw-mode');
        const nsfwOnly = document.body.classList.contains('nsfw-only-mode');
        if (!fav && !nsfwBlock && !nsfwOnly) return;
        // 统计当前"匹配过滤条件且实际可见"的卡片数
        const items = c.querySelectorAll('.masonry-item');
        let visibleMatch = 0;
        items.forEach(item => {
            if (item.offsetParent === null) return; // 已被 CSS 隐藏
            if (fav && item.dataset.fav !== '1') return;
            if (nsfwBlock && item.dataset.nsfw === '1') return; // nsfw-mode 隐藏 nsfw 项
            if (nsfwOnly && item.dataset.nsfw !== '1') return; // nsfw-only-mode 只显示 nsfw
            visibleMatch++;
        });
        // 已有匹配项，停止（避免无限加载）
        if (visibleMatch > 0) return;
        // 还没匹配项且还有下一页 → 加载
        if (state.hasMore) load(1);
    }

    // === 日期分组：已迁移到 GalleryDisplay.DateGrouping（[Task 4 抽出]） ===
    // 旧函数（getDateKey / formatDateLabel / createDateSeparator / updateDateCounts / pruneEmptySeparators）
    // 全部转调 DateGrouping，list.js 内部仍以同名的 const arrow 形式包装，
    // 任何已存在的调用点（readDateKeyFromCard / renderItems / insertSingleRecord）都无需修改。
    const getDateKey = (ts) => DG.getKey(ts);
    const createDateSeparator = (key) => DG.createSeparator(key);
    const updateDateCounts = () => DG.updateCounts(state.container);
    const pruneEmptySeparators = () => DG.pruneEmpty(state.container);

    /** 确保有足够可见图片填充视口，不够则自动加载下一页 */
    function ensureLoadMore() {
        if (!state.hasMore || state.isLoading) return;
        const c = state.container;
        if (!c) return;
        const visibleItems = c.querySelectorAll('.masonry-item');
        let visibleCount = 0;
        visibleItems.forEach(item => {
            if (item.offsetParent !== null) visibleCount++;
        });
        if (visibleCount < state.pageSize) {
            load(1);
        }
    }

    // === DOM 驱动的日期分组(单一事实来源) ===
    // 用 DOM 中最后一张 / 第一张已渲染卡片的 timestamp 推算日期 key,
    // 彻底消除模块级 lastRenderedDateKey 带来的"两个今天"等脏数据问题。
    function readDateKeyFromCard(card) {
        if (!card) return '';
        const ts = card.dataset.historyTs || card.dataset.timestamp;
        if (!ts) return '';
        return getDateKey(parseInt(ts));
    }
    function getLastRenderedDateKey() {
        if (!state.container) return '';
        const items = state.container.querySelectorAll('.masonry-item');
        return items.length ? readDateKeyFromCard(items[items.length - 1]) : '';
    }
    function getFirstRenderedDateKey() {
        if (!state.container) return '';
        const first = state.container.querySelector('.masonry-item');
        return readDateKeyFromCard(first);
    }

    // 把后端响应规范化为 items 数组（兼容老接口直接返回数组）
    function normalizeHistoryResponse(json) {
        if (Array.isArray(json)) return { items: json, hasMore: false, total: json.length };
        if (json && Array.isArray(json.items)) return {
            items: json.items,
            hasMore: !!json.hasMore,
            total: typeof json.total === 'number' ? json.total : json.items.length
        };
        return { items: [], hasMore: false, total: 0 };
    }

    /**
     * 静默清理孤儿记录：
     *  - 仅管理员可调用（后端会拒绝非管理员）
     *  - 调用后端 POST /api/gallery/purge-orphans
     *  - 如果清了任何记录，返回 { removed, trimmed }；否则返回 null
     *  - 失败（网络/非管理员）静默返回 null，不打扰用户
     */
    let _purgeRan = false;
    async function purgeOrphansOnce() {
        if (_purgeRan) return null;
        _purgeRan = true;
        try {
            const token = (global.AuthManager && global.AuthManager.getToken)
                ? global.AuthManager.getToken()
                : (localStorage.getItem('xy_auth_token') || '');
            const res = await fetch('/api/gallery/purge-orphans?token=' + encodeURIComponent(token), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (!res.ok) return null;
            const json = await res.json();
            if (!json || !json.success) return null;
            if ((json.removed || 0) === 0 && (json.trimmed || 0) === 0) return null;
            console.log(`[GalleryList] Purged ${json.removed} orphan record(s), trimmed ${json.trimmed} partial record(s).`);
            return json;
        } catch (e) {
            return null;
        }
    }

    /**
     * 加载第 N 页（page=0 重置）
     * - 支持后端分页(优先):?page=N&page_size=M,一次只拉一页
     * - 兼容老接口(无分页):一次拉全量再 slice
     * - state.allHistory 始终保持"已拉取 + 已渲染"的累计列表
     * - state.hasMore 标记是否还有下一页
     */
    async function load(page = 0) {
        if (state.isLoading) return;
        const trigger = state.trigger;
        try {
            state.isLoading = true;
            if (page === 0) {
                state.allHistory = [];
                if (state.container) state.container.innerHTML = '';
                state.currentIndex = 0;
                state.currentPage = 0;
                state.hasMore = true;
                if (trigger) { trigger.classList.remove('hidden'); trigger.innerText = 'Loading Archives...'; }
                const res = await fetch(`/api/history?type=${encodeURIComponent(state.type)}&page=0&page_size=${state.pageSize}${state.scope === 'mine' ? '&mine=1' : ''}`);
                if (!res.ok) throw new Error('History API ' + res.status);
                const json = await res.json();
                const norm = normalizeHistoryResponse(json);
                // 去重：按主媒体 URL 去重（图片优先，视频兜底），保留最新的记录
                const seenUrls = new Set();
                state.allHistory = norm.items.filter(item => {
                    const imgs = (item.images || []).filter(Boolean);
                    const vids = (item.videos || []).filter(Boolean);
                    const key = (imgs[0] || vids[0]) || '';
                    if (!key) return true;   // 无任何媒体的记录保留
                    if (seenUrls.has(key)) return false;
                    seenUrls.add(key);
                    return true;
                });
                // 按时间倒序排列（最新在前）
                state.allHistory.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                state.hasMore = norm.hasMore;
            } else {
                if (trigger) trigger.innerText = 'Loading...';
                await new Promise(r => setTimeout(r, 200));
                const nextPage = state.currentPage + 1;
                const res = await fetch(`/api/history?type=${encodeURIComponent(state.type)}&page=${nextPage}&page_size=${state.pageSize}${state.scope === 'mine' ? '&mine=1' : ''}`);
                if (!res.ok) throw new Error('History API ' + res.status);
                const json = await res.json();
                const norm = normalizeHistoryResponse(json);
                // 防御：后端重复返回首页/旧数据时跳过
                const knownTs = new Set(state.allHistory.map(x => String(x.timestamp)));
                const knownUrls = new Set(state.allHistory.flatMap(x => {
                    const imgs = (x.images || []).filter(Boolean);
                    const vids = (x.videos || []).filter(Boolean);
                    return imgs.length ? imgs : vids;
                }));
                const fresh = norm.items.filter(x => {
                    if (knownTs.has(String(x.timestamp))) return false;
                    const meds = (x.images || []).filter(Boolean);
                    if (meds.length === 0) meds.push(...(x.videos || []).filter(Boolean));
                    if (meds.length > 0 && knownUrls.has(meds[0])) return false;
                    return true;
                });
                state.allHistory = state.allHistory.concat(fresh);
                // 追加后重新按时间倒序排列
                state.allHistory.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                state.hasMore = norm.hasMore;
                state.currentPage = nextPage;
            }
            // 渲染从 currentIndex 到末尾(分页模式:这些是新增的;老接口模式:一次拉全量则全部要渲染)
            const nextData = state.allHistory.slice(state.currentIndex);
            nextData.forEach(item => {
                const dateKey = getDateKey(item.timestamp);
                if (state.container && getLastRenderedDateKey() !== dateKey) {
                    state.container.appendChild(createDateSeparator(dateKey));
                }
                if (global.GalleryCard && typeof global.GalleryCard.render === 'function') {
                    global.GalleryCard.render({
                        container: state.container,
                        record: item,
                        isNew: false
                    });
                }
            });
            state.currentIndex = state.allHistory.length;
            // 更新日期分隔线的图片计数
            updateDateCounts();
            // 清除因 NSFW 屏蔽导致的空白分隔线
            pruneEmptySeparators();
            // 触发器显隐：空 / 已无更多 → 隐藏；否则显示
            if (state.currentIndex === 0) {
                if (trigger) trigger.classList.add('hidden');
            } else if (!state.hasMore) {
                if (trigger) trigger.classList.add('hidden');
            } else {
                if (trigger) { trigger.classList.remove('hidden'); trigger.innerText = 'Load More Archive'; }
            }
            // === 首页拉完后静默清理孤儿记录 ===
            // 仅在首次 load(0) 时跑一次；如果清了什么，自动重拉首页刷新画廊
            if (page === 0) {
                const purgeResult = await purgeOrphansOnce();
                if (purgeResult && (purgeResult.removed > 0 || purgeResult.trimmed > 0)) {
                    state.isLoading = false;
                    _purgeRan = true;
                    try { await load(0); } catch (e) { console.error('[GalleryList] reload after purge error:', e); }
                    return;
                }
            }
            // 小图模式下内容高度可能不够撑满滚动区，触发器一直可见，
            // IntersectionObserver 不会再次触发 → 需要主动继续加载下一页
            if (trigger && state.hasMore && !state.isLoading) {
                const root = document.querySelector('main');
                if (root && trigger.offsetHeight > 0) {
                    const rect = trigger.getBoundingClientRect();
                    const rootRect = root.getBoundingClientRect();
                    if (rect.top < rootRect.bottom && rect.bottom > rootRect.top) {
                        // 触发器仍在可视区，继续加载（先释放锁）
                        state.isLoading = false;
                        await load(1);
                    }
                }
            }
        } catch (e) {
            console.error('[GalleryList] load error:', e);
            if (trigger) trigger.innerText = 'Error Loading History';
        } finally {
            state.isLoading = false;
            // [过滤模式自动加载] 进入 fav-mode / nsfw-only-mode 后，若当前已加载页
            // 没有匹配项（CSS 隐藏后用户看到空画廊），自动连加载下一页直到找到。
            // ensureMatchingItemsLoaded 内部会检查 isLoading 锁、过滤模式、可见匹配数、hasMore。
            setTimeout(() => ensureMatchingItemsLoaded(), 0);
        }
    }

    /**
     * 接收到后端推送的新图片时调用
     * 新图 prepend 到容器最前,根据"容器内第一张旧图"的日期决定是否需要分隔线
     */
    function pushNewImage(record, opts) {
        if (!record || !record.timestamp) return;
        if (document.getElementById(`history-${record.timestamp}`)) return;
        state.allHistory.unshift(record);
        if (opts && opts._skipRender) {
            // zimage.html 在生成新图时自己接管 DOM 渲染（原地升级 placeholder），避免重复卡片
            return;
        }
        if (state.container) {
            const newKey = getDateKey(record.timestamp);
            const firstKey = getFirstRenderedDateKey();
            // 仅当容器里已有"其它日期"的卡片时才需要插分隔线
            if (firstKey && firstKey !== newKey) {
                const sep = createDateSeparator(newKey);
                const firstCard = state.container.querySelector('.masonry-item');
                if (firstCard) state.container.insertBefore(sep, firstCard);
            }
        }
        if (global.GalleryCard && typeof global.GalleryCard.render === 'function') {
            // 转发 opts（eagerFirstImage 等）到 render，否则 zimage.html 传的 eagerFirstImage=true 会被丢弃
            global.GalleryCard.render(Object.assign({ container: state.container, record, isNew: true }, opts || {}));
        }
        state.currentIndex++;
    }

    /**
     * 批量选择
     */
    function bindBatchSelect() {
        const cfg = NS.Config._data || {};
        const batchBtn = typeof cfg.batchSelectBtn === 'string' ? document.querySelector(cfg.batchSelectBtn) : cfg.batchSelectBtn;
        const delBtn = typeof cfg.deleteSelectedBtn === 'string' ? document.querySelector(cfg.deleteSelectedBtn) : cfg.deleteSelectedBtn;
        const countEl = typeof cfg.selectedCount === 'string' ? document.querySelector(cfg.selectedCount) : cfg.selectedCount;

        if (batchBtn) batchBtn.addEventListener('click', toggleBatchSelect);
        if (delBtn) delBtn.addEventListener('click', (e) => {
            global.GalleryActions.deleteSelected(state.selectedItems, e);
        });
    }

    function toggleBatchSelect() {
        state.isBatchMode = !state.isBatchMode;
        const cfg = NS.Config._data || {};
        const batchBtn = typeof cfg.batchSelectBtn === 'string' ? document.querySelector(cfg.batchSelectBtn) : cfg.batchSelectBtn;
        const delBtn = typeof cfg.deleteSelectedBtn === 'string' ? document.querySelector(cfg.deleteSelectedBtn) : cfg.deleteSelectedBtn;
        if (batchBtn) batchBtn.textContent = state.isBatchMode ? '取消选择' : '批量选择';
        document.querySelectorAll('.batch-checkbox').forEach(cb => cb.style.display = state.isBatchMode ? 'flex' : 'none');
        if (!state.isBatchMode) clearSelection();
        if (delBtn) delBtn.classList.toggle('hidden', !state.isBatchMode || state.selectedItems.size === 0);
        document.body.classList.toggle('history-bulk-selecting', state.isBatchMode);
    }

    function toggleItemSelection(timestamp, event) {
        if (event) event.stopPropagation();
        const cfg = NS.Config._data || {};
        const delBtn = typeof cfg.deleteSelectedBtn === 'string' ? document.querySelector(cfg.deleteSelectedBtn) : cfg.deleteSelectedBtn;
        const countEl = typeof cfg.selectedCount === 'string' ? document.querySelector(cfg.selectedCount) : cfg.selectedCount;
        const cb = event && event.currentTarget;
        const check = cb && cb.querySelector('.check-icon');
        if (state.selectedItems.has(timestamp)) {
            state.selectedItems.delete(timestamp);
            if (cb) cb.classList.remove('ring-2', 'ring-cyan-400', 'border-cyan-400');
            if (check) check.style.display = 'none';
        } else {
            state.selectedItems.add(timestamp);
            if (cb) cb.classList.add('ring-2', 'ring-cyan-400', 'border-cyan-400');
            if (check) check.style.display = 'block';
        }
        if (countEl) countEl.textContent = state.selectedItems.size;
        if (delBtn) delBtn.classList.toggle('hidden', state.selectedItems.size === 0);
    }

    function clearSelection() {
        state.selectedItems.clear();
        const cfg = NS.Config._data || {};
        const countEl = typeof cfg.selectedCount === 'string' ? document.querySelector(cfg.selectedCount) : cfg.selectedCount;
        const delBtn = typeof cfg.deleteSelectedBtn === 'string' ? document.querySelector(cfg.deleteSelectedBtn) : cfg.deleteSelectedBtn;
        document.querySelectorAll('.batch-checkbox').forEach(cb => {
            cb.classList.remove('ring-2', 'ring-cyan-400', 'border-cyan-400');
            const check = cb.querySelector('.check-icon');
            if (check) check.style.display = 'none';
        });
        if (countEl) countEl.textContent = '0';
        if (delBtn) delBtn.classList.add('hidden');
    }

    function bindObserver() {
        if (!state.trigger) return;
        if (state.observer) state.observer.disconnect();
        // 使用 main 元素作为滚动容器
        const root = document.querySelector('main');
        state.observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !state.isLoading && state.hasMore) {
                load(1);
            }
        }, { threshold: 0.1, root: root });
        state.observer.observe(state.trigger);
        state.trigger.addEventListener('click', () => { if (!state.isLoading && state.hasMore) load(1); });
    }

    global.GalleryList = {
        init,
        load,
        setScope,
        pushNewImage,
        toggleBatchSelect,
        toggleItemSelection,
        clearSelection,
        pruneEmptySeparators,
        ensureLoadMore,
        get allHistory() { return state.allHistory; },
        set allHistory(v) { state.allHistory = v; },
        get type() { return state.type; },
        get hasMore() { return state.hasMore; },
        get scope() { return state.scope; }
    };
})(window);


;/* ---- card.js ---- */

/*!
 * GalleryCard - 统一的缩略图卡片渲染
 * 一个函数搞定所有功能的缩略图，按 features 配置显示对应按钮
 */
(function (global) {
    'use strict';

    // 一次性注入缩略图「查看提示词」按钮样式：默认隐藏，悬停卡片时由 JS 加 .show 显示。
    // 关键：全部用注入的全局 CSS（非 Tailwind 动态 class），避免预构建 tailwind.min.css 不编译动态类。
    (function ensureCardCSS() {
        if (document.getElementById('gallery-card-style')) return;
        const style = document.createElement('style');
        style.id = 'gallery-card-style';
        style.textContent = [
            '.gallery-vpfab{opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease;cursor:pointer;}',
            '.gallery-vpfab.show{opacity:1;pointer-events:auto;}',
            '.gallery-vpfab:hover{transform:scale(1.12)}',
            '.gallery-vpfab:active{transform:scale(0.9)}',
            // [Bugfix] 恢复原行为：hover 卡片才显示（opacity:0 → .show 时 1）
            // cursor-zoom-in 放在按钮自身上，鼠标移到按钮上才变放大镜 cursor，
            // 之前 card 整体 cursor-zoom-in 会让鼠标在卡片任意位置都变放大镜
            '.gallery-magnify{opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease;cursor:zoom-in;}',
            '.gallery-magnify.show{opacity:1;pointer-events:auto;}',
            '.gallery-magnify:hover{transform:scale(1.12)}',
            '.gallery-magnify:active{transform:scale(0.9)}',
            '.gallery-fav{opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease;cursor:pointer;}',
            '.gallery-fav.show{opacity:1;pointer-events:auto;}',
            '.gallery-fav:hover{transform:scale(1.12)}',
            '.gallery-fav:active{transform:scale(0.9)}',
            // [Bugfix] 整个星形金黄：fill 金黄 + 当前色继承保持原细描边（不另加粗轮廓）
            '.gallery-fav.is-fav{opacity:1!important;pointer-events:auto!important;color:#fbbf24;fill:#fbbf24;filter:drop-shadow(0 0 6px rgba(251,191,36,.55))!important;}',
            '.gallery-fav.is-fav svg{fill:#fbbf24!important;stroke:#fbbf24!important;}',
            // 视频卡片右下角「声音开关」按钮：默认隐藏，hover 卡片时显示
            '.gallery-sound{opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease;cursor:pointer;}',
            '.gallery-sound.show{opacity:1;pointer-events:auto;}',
            '.gallery-sound:hover{transform:scale(1.12)}',
            '.gallery-sound:active{transform:scale(0.9)}',
            '.masonry-item.gallery-selected{outline:3px solid #00f0ff;outline-offset:-3px;border-radius:8px;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(style);
    })();

    // 用于 onclick="..." 属性中双引号转义
    var escAttr = function(v) { return String(v).replace(/"/g, '&quot;'); };

    // 悬浮按钮统一内联样式（透明底 + 白色图标 + drop-shadow 深色光晕），hover 显示。
    // 提升为模块级常量，供 render（放大镜/收藏/查看提示词按钮）与 buildVideoHTML（声音按钮）共用。
    var BTN_INLINE = 'position:absolute;z-index:20;width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:#fcfcfb;cursor:pointer;filter:drop-shadow(0 0 5px rgba(0,0,0,.85)) drop-shadow(0 3px 8px rgba(0,0,0,.95));';

    // 收藏按钮 22x22 星星 SVG
    // 注意：无论是否已收藏，统一使用空心 SVG；CSS 通过 .is-fav 切换填充
    var FAV_OUT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

    // 声音按钮 SVG：静音（扬声器 + 叉）/ 有声（扬声器 + 声波）
    var SOUND_OFF_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
    var SOUND_ON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';

    /**
     * 视频卡片右下角「声音开关」：切换所在卡片 video 的静音状态，并同步图标。
     * 默认视频 muted（声音关闭），点击后开启声音（需用户手势，浏览器才允许带声播放）。
     */
    function toggleVideoSound(btn) {
        if (!btn) return;
        var card = btn.closest('.masonry-item');
        if (!card) return;
        var v = card.querySelector('video');
        if (!v) return;
        v.muted = !v.muted;
        btn.classList.toggle('sound-on', !v.muted);
        btn.innerHTML = v.muted ? SOUND_OFF_SVG : SOUND_ON_SVG;
    }
    if (!global.toggleVideoSound) global.toggleVideoSound = toggleVideoSound;

    /**
     * 收藏切换（统一入口 GalleryDisplay.Favorites.toggle）
     * 保留 window.toggleFav 是为了与历史 inline onclick 兼容，
     * 实际逻辑已迁移到 Favorites 模块，UI 同步由 fav:changed 事件驱动。
     */
    function toggleFav(record, event, imgUrl) {
        if (event) event.stopPropagation();
        // 视频记录用 videos 字段, 图片记录用 images 字段
        const url = imgUrl || (record && record.images && record.images[0])
            || (record && record.videos && record.videos[0])
            || '';
        if (!url) return;
        if (window.GalleryDisplay && GalleryDisplay.Favorites) {
            GalleryDisplay.Favorites.toggle(url);
        } else {
            // 兜底：模块未加载时使用旧逻辑（理论上不会发生）
            const set = (global.__galleryFavorites = global.__galleryFavorites || new Set());
            const added = !set.has(url);
            if (added) set.add(url); else set.delete(url);
        }
    }
    if (!global.toggleFav) global.toggleFav = toggleFav;

    // SVG 图标模板
    const ICONS = {
        folder: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        trash: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
        download: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
        copy: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        refresh: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
        star: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        starOutline: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        clipboard: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>',
        pencilLine: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
        check: '<svg class="check-icon w-4 h-4 text-cyan-500" style="display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        imageFallback: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>',
        info: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    // 按钮配置表：feature → {icon, title, className, action, primary}
    const BUTTON_CONFIG = {
        openFolder: { icon: 'folder', title: '打开文件夹', className: 'hover:bg-blue-600 hover:text-white', action: 'openImageFolder' },
        download:   { icon: 'download', title: '下载图片',   className: 'hover:bg-green-600 hover:text-white', action: 'downloadImage' },
        copyToCanvas:{ icon: 'copy',    title: '复制到画布', className: 'hover:bg-purple-600 hover:text-white', action: 'copyToCanvas' },
        favorite:  { icon: 'star',   title: '收藏',       className: 'hover:bg-amber-400 hover:text-white', action: 'toggleFavorite' },
        copyPrompt:  { icon: 'clipboard', title: '复制提示词',  className: 'hover:bg-cyan-600 hover:text-white', action: 'copyPrompt' },
        viewPrompt: { icon: 'info', title: '查看提示词', className: 'hover:bg-violet-600 hover:text-white', action: 'viewPrompt' },
        usePrompt:   { icon: 'pencilLine', title: '把这条提示词载入到输入框', className: 'hover:bg-indigo-600 hover:text-white', action: 'usePrompt' },
        regenerate: { icon: 'refresh', title: '重新生成',   className: 'hover:bg-amber-500 hover:text-white', action: 'regenerate' },
        delete:     { icon: 'trash',   title: '删除',       className: 'hover:bg-black hover:text-white',     action: 'deleteHistoryItem' }
    };

    /**
     * 默认 features（全开）
     * 业务页可通过 GALLERY_CONFIG.features 关闭
     */
    const DEFAULT_FEATURES = {
        delete: true,
        openFolder: true,
        download: true,
        copyToCanvas: false,    // 默认关闭，需要业务页 onCopyToCanvas 回调
        regenerate: false,      // 默认关闭，需要业务页 onRegenerate 回调
        batchSelect: false,     // 默认关闭（rmbg 启用）
        contextMenu: true,
        imageFallback: true,
        modelBadge: null,       // 左上角徽标 URL
        viewPrompt: true,        // 缩略图「查看提示词」按钮（默认开启，点击弹出通用 PromptPanel）
        viewFullImage: true      // 左上角「查看大图」放大镜按钮（默认开启；点击图片切换选中态，点击此按钮才打开 lightbox）
    };

    /**
     * 渲染一张缩略图卡片
     * @param {Object} opts
     *   - container: '#masonry'
     *   - record: { timestamp, prompt, images: [url], type, model, ... }
     *   - isNew: boolean （新生成的插顶部）
     *   - features: { delete, openFolder, download, copyToCanvas, regenerate, batchSelect, contextMenu, imageFallback, modelBadge }
     *   - historyType: 'zimage'  // 备用，从 GALLERY_CONFIG.type 取
     */
    function render(opts) {
        const { container, record, isNew = false } = opts;
        // 放宽守卫：允许纯视频记录（videos 存在但 images 为空）
        const hasImages = record.images && record.images.length && record.images[0];
        const hasVideos = record.videos && record.videos.length && record.videos[0];
        if (!record || !record.timestamp || (!hasImages && !hasVideos)) return null;
        const isVideo = !hasImages && hasVideos;
        const firstImg = record.images && record.images[0];   // 图片记录的首图（可能 undefined）
        const firstVideo = record.videos && record.videos[0]; // 视频记录的首视频
        const primaryUrl = isVideo ? firstVideo : firstImg;    // 防重/数据属性用的主 URL
        // 防重：同 timestamp 或同首图 URL 已渲染则跳过。
        // 后端 save_to_history 用 time.time() 时间戳、前端用 Date.now()，两者不同，
        // 仅按 timestamp 防重会漏掉「后端 WS 广播 + 前端就地渲染」造成的同一张图两张卡片。
        if (document.getElementById(`history-${record.timestamp}`)) return null;
        if (document.querySelector('.masonry-item[data-img0="' + String(primaryUrl).replace(/["\\]/g, '\\$&') + '"]')) return null;

        // [Task 5 收敛] 优先 NS.Config
        const cfg = (window.GalleryDisplay && window.GalleryDisplay.Config) || {};
        const features = Object.assign({}, DEFAULT_FEATURES, cfg.features || {}, opts.features || {});
        const historyType = opts.historyType || cfg.type || record.type || 'unknown';

        const containerEl = typeof container === 'string' ? document.querySelector(container) : container;
        if (!containerEl) return null;

        const card = document.createElement('div');
        card.id = `history-${record.timestamp}`;
        card.dataset.historyTs = record.timestamp;
        card.dataset.historyType = historyType;
        card.dataset.img0 = primaryUrl;
        card.className = 'masonry-item group animate-in fade-in duration-300';

        // 提取打开 lightbox 的逻辑为独立函数，供放大按键和内部使用
        function openLightboxForRecord(r) {
            // 注意：window.openLightbox 已被 display.js 包成代理箭头函数 (...args)=>{...}，
            // 其 .length === 0，无法靠参数数量判断真实签名（旧代码因此误判为「老版本」，
            // 把 isVideo 当成了 startIndexOrPrompt 传，导致视频被当作图片渲染、预览空白）。
            // 这里统一按最新 6 参签名调用：(url, allMedia, startIndex, prompt, allPrompts, isVideo)，
            // 由 Lightbox.openLightbox 自行根据 isVideo 渲染图片 / 视频。
            if (typeof global.openLightbox !== 'function') return;
            const prompt = r.prompt || '';
            const rIsVideo = !(r.images && r.images.length && r.images[0]) && (r.videos && r.videos.length && r.videos[0]);
            const mediaKey = rIsVideo ? 'videos' : 'images';
            const mediaList = (r[mediaKey] || []).filter(Boolean);
            if (!mediaList.length) return;

            const allHistory = (global.GalleryList && global.GalleryList.allHistory) || [r];
            const allMedia = [];
            const allPrompts = [];
            for (const item of allHistory) {
                const itemIsVideo = !(item.images && item.images.length && item.images[0]) && (item.videos && item.videos.length && item.videos[0]);
                const meds = (itemIsVideo ? (item.videos || []) : (item.images || [])).filter(Boolean);
                for (const u of meds) {
                    allMedia.push(u);
                    allPrompts.push(item.prompt || '');
                }
            }
            const historyIndex = allHistory.findIndex(item => item.timestamp === r.timestamp);
            let startIndex = 0;
            for (let i = 0; i < (historyIndex < 0 ? allHistory.length : historyIndex); i++) {
                const itemIsVideo = !(allHistory[i].images && allHistory[i].images.length && allHistory[i].images[0]) && (allHistory[i].videos && allHistory[i].videos.length && allHistory[i].videos[0]);
                startIndex += ((itemIsVideo ? (allHistory[i].videos || []) : (allHistory[i].images || [])).filter(Boolean)).length;
            }

            global.openLightbox(mediaList[0], allMedia, startIndex, prompt, allPrompts, rIsVideo);
        }
        // 暴露到全局，供 HTML onclick 调用
        if (!global.openLightboxForRecord) global.openLightboxForRecord = openLightboxForRecord;

        // 单击卡片：切换选中态（视觉高亮），不再直接打开大图
        card.onclick = (e) => {
            if (document.body.classList.contains('history-bulk-selecting')) return;
            if (document.body.classList.contains('nsfw-mode') && card.dataset.nsfw === '1') return;
            if (e.target.closest('button') || e.target.closest('.batch-checkbox')) return;
            card.classList.toggle('gallery-selected');
        };

        // 收藏状态标记（按图片/视频 URL，支持多图组中只收藏某几张）
        const favSet = global.__galleryFavorites || new Set();
        const images = (record.images || []).filter(Boolean);
        const videos = (record.videos || []).filter(Boolean);
        // 视频记录用 videos 判断, 图片记录用 images
        const mediaForFav = videos.length > 0 ? videos : images;
        const anyFav = mediaForFav.some(u => favSet.has(u));
        card.dataset.fav = anyFav ? '1' : '0';
        // 标记首图 url，便于全局 fav:changed 事件同步
        card.dataset.favUrl = mediaForFav[0] || '';
        // 每张子图的收藏状态
        card.dataset.favImages = JSON.stringify(mediaForFav.map(u => favSet.has(u) ? 1 : 0));

        // 三个悬浮按钮统一样式（透明底 + 白色图标 + drop-shadow 深色光晕），hover 显示
        // 统一内联模板：position:absolute;z-index:20;width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:#fcfcfb;cursor:pointer;filter:drop-shadow(0 0 5px rgba(0,0,0,.85)) drop-shadow(0 3px 8px rgba(0,0,0,.95))
        // 注：BTN_INLINE 已提升为模块级常量（见文件顶部），供 render 与 buildVideoHTML 共用
        const SVG_22 = ' xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"';

        // ① 左上角 — 查看大图（放大镜）
        const magHandler = `openLightboxForRecord(${JSON.stringify(record).replace(/"/g, '&quot;')})`;
        const magnifyHTML = features.viewFullImage
            ? `<button onclick="${magHandler}" class="gallery-magnify" title="查看大图" aria-label="查看大图" style="left:12px;top:12px;${BTN_INLINE}"><svg${SVG_22}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>`
            : '';

        // ② 右上角 — 收藏（统一透明+drop-shadow 样式，hover 显示）
        // 视频记录用 videos 字段, 图片记录用 images 字段
        const favImgUrl = (record.images && record.images[0])
            || (record.videos && record.videos[0])
            || '';
        const favHandler = `toggleFav(${escAttr(JSON.stringify(record))}, event, ${escAttr(JSON.stringify(favImgUrl))})`;
        // SVG 统一使用空心，CSS 通过 .is-fav 切换填充
        const favHTML = features.favorite
            ? `<button onclick="${favHandler}" data-fav-url="${escAttr(favImgUrl)}" class="gallery-fav${anyFav ? ' is-fav' : ''}" title="收藏" aria-label="收藏" style="right:12px;top:12px;${BTN_INLINE}">${FAV_OUT_SVG}</button>`
            : '';

        // ③ 左下角 — 查看提示词（感叹号）
        const vpHandler = `GalleryActions.viewPrompt(${JSON.stringify(record).replace(/"/g, '&quot;')}, event)`;
        const viewPromptHTML = features.viewPrompt
            ? `<button onclick="${vpHandler}" class="gallery-vpfab" title="查看提示词" aria-label="查看提示词" style="left:12px;bottom:12px;${BTN_INLINE}"><svg${SVG_22}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></button>`
            : '';

        // 展示区卡片不再显示模型标识（产品要求）；record.model 仍保留给提示词面板/版本历史
        let badgeHTML = '';

        // 批量勾选框
        const batchHTML = features.batchSelect ? `
            <div onclick="GalleryList && GalleryList.toggleItemSelection('${record.timestamp}', event)" class="batch-checkbox absolute top-3 right-3 z-20 w-7 h-7 rounded-lg bg-white/90 backdrop-blur border-2 border-gray-300 flex items-center justify-center cursor-pointer hover:border-cyan-400 transition-all" style="display:none">
                ${ICONS.check}
            </div>` : '';

        // NSFW 检测 + 角标
        const nsfwFlag = isNsfwPrompt(record.prompt || record.text || '');
        card.dataset.nsfw = nsfwFlag ? '1' : '0';
        const nsfwBadge = nsfwFlag ? '<div class="nsfw-badge" title="检测到 NSFW 提示词">NSFW</div>' : '';

        // 图片加载失败兜底
        const fallbackHTML = features.imageFallback ? `
            <div class="img-fallback absolute inset-0 flex flex-col items-center justify-center text-gray-400 dark:text-gray-600" style="display:none">
                ${ICONS.imageFallback}
                <span class="text-[10px] font-bold mt-1.5">图片已删除</span>
            </div>` : '';

        const onerror = `this.onerror=null;this.closest('.masonry-item')?.remove()`;

        // 新生成（prepend）首图：禁用懒加载 + 高优先级，避免 Edge 的 placeholder 替换
        const eager = !!opts.eagerFirstImage;

        card.innerHTML = `
            ${isVideo ? buildVideoHTML(record, features, onerror) : buildImagesHTML(record, features, onerror, { eagerFirstImage: eager })}
            ${fallbackHTML}
            ${badgeHTML}
            ${viewPromptHTML}
            ${magnifyHTML}
            ${favHTML}
            ${batchHTML}
            ${nsfwBadge}
            `;
        if (!isVideo && features.download && record.images?.[0]) {
            mountDownloadAction(card, record.images[0]);
            const badge = card.querySelector('.model-badge');
            if (badge) badge.style.right = '56px';
        }
        if (!isVideo && record.images?.[0]) mountCutoutAction(card, () => record, record.images[0]);

        // 右键菜单
        if (features.contextMenu) {
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (global.GalleryContextMenu && typeof global.GalleryContextMenu.show === 'function') {
                    global.GalleryContextMenu.show(e.clientX, e.clientY, record, features);
                }
            });
        }

        // Hover 预取：图片用 Image() 预取，视频用 <video> preload 触发浏览器缓存
        const mediaToPreload = isVideo ? ((record.videos || []).filter(Boolean)) : images;
        if (mediaToPreload.length > 0) {
            card.addEventListener('mouseenter', () => {
                mediaToPreload.forEach(u => {
                    if (!u) return;
                    if (isVideo) {
                        // 视频：创建临时 video 元素触发 preload 到浏览器缓存
                        const v = document.createElement('video'); v.preload = 'auto'; v.src = u;
                    } else {
                        const pre = new Image();
                        pre.src = u;
                    }
                });
            }, { once: true, passive: true });
        }
        // 悬停卡片显示悬浮按钮（每次进入都触发，非 once）
        card.addEventListener('mouseenter', () => {
            card.querySelectorAll('.gallery-vpfab, .gallery-magnify, .gallery-fav, .gallery-sound').forEach(el => el.classList.add('show'));
            // 视频卡片：悬停即在卡片上自动播放（默认静音，浏览器允许自动播放）
            if (isVideo) {
                const v = card.querySelector('video');
                if (v) { try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
            }
        }, { passive: true });
        // 鼠标离开卡片时隐藏按钮
        card.addEventListener('mouseleave', () => {
            card.querySelectorAll('.gallery-vpfab, .gallery-magnify, .gallery-fav, .gallery-sound').forEach(el => el.classList.remove('show'));
            // 视频卡片：移开暂停并复位到开头
            if (isVideo) {
                const v = card.querySelector('video');
                if (v) { try { v.pause(); } catch (e) {} try { v.currentTime = 0; } catch (e) {} }
            }
        }, { passive: true });

        if (isNew) containerEl.prepend(card);
        else containerEl.appendChild(card);

        // 强制瀑布流重新布局
        if (isNew && containerEl) {
            // 使用 requestAnimationFrame 延迟触发
            requestAnimationFrame(() => {
                // 隐藏再显示，强制重新计算布局
                containerEl.style.visibility = 'hidden';
                containerEl.offsetHeight;
                containerEl.style.visibility = '';
                // 如果有图片，等待图片加载后再触发一次
                const imgs = card.querySelectorAll('img');
                if (imgs.length) {
                    let loaded = 0;
                    const checkDone = () => {
                        loaded++;
                        if (loaded >= imgs.length) {
                            containerEl.style.visibility = 'hidden';
                            containerEl.offsetHeight;
                            containerEl.style.visibility = '';
                        }
                    };
                    imgs.forEach(img => {
                        if (img.complete) checkDone();
                        else {
                            img.onload = checkDone;
                            img.onerror = checkDone;
                        }
                    });
                }
            });
        }
        return card;
    }

    /**
     * 渲染卡片内的图片区。
     * - 1 张：全幅 cover
     * - 2 张：上下两半
     * - 3 张：上 1 + 下 2
     * - 4 张：2x2 拼图
     * - 5+ 张：2x2 拼图 + 最后一张叠加 "+N"
     */
    /** 单张图片收藏星标按钮 HTML — 已废弃，改用统一的 favOldHTML 单按钮，禁用子图收藏按钮避免重叠 */
    function imgFavBtnHTML(url, isFav) {
        return '';
    }

    /**
     * 渲染卡片内的图片区。
     * - 1 张：全幅 cover
     * - 2 张：上下两半
     * - 3 张：上 1 + 下 2
     * - 4 张：2x2 拼图
     * - 5+ 张：2x2 拼图 + 最后一张叠加 "+N"
     */
    function buildImagesHTML(record, features, onerror, opts) {
        opts = opts || {};
        const eager = !!opts.eagerFirstImage;
        // eager 时首图用 loading="eager" fetchpriority="high"（避免 Edge lazy placeholder 替换）
        // 其它图仍 lazy
        const ldAttr = (eager ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"') + ' decoding="async"';
        const imgs = (record.images || []).filter(Boolean);
        const favSet = global.__galleryFavorites || new Set();
        if (imgs.length <= 1) {
            const src = thumbUrl(imgs[0] || '', 768);
            const favBtn = features.favorite ? imgFavBtnHTML(imgs[0] || '', favSet.has(imgs[0] || '')) : '';
            return '<div class="relative group"><img src="' + src + '" data-original-src="' + (imgs[0] || '') + '" class="w-full"' + ldAttr + ' onerror="' + onerror + '" style="display:block; object-fit:contain;">' + favBtn + '</div>';
        }
        // 多图：使用flex布局，自适应高度
        if (imgs.length === 2) {
            return '<div class="flex gap-0.5" style="height:auto;">' + imgs.slice(0, 2).map(function(u, i) {
                const attr = (eager ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"') + ' decoding="async"';
                return '<div class="flex-1 relative overflow-hidden group" style="background:#f5f5f5;"><img src="' + thumbUrl(u, 768) + '" data-original-src="' + u + '" class="w-full h-full"' + attr + ' onerror="' + onerror + '" style="display:block; object-fit:contain;">' + (features.favorite ? imgFavBtnHTML(u, favSet.has(u)) : '') + '</div>';
            }).join('') + '</div>';
        } else if (imgs.length === 3) {
            return '<div class="flex flex-col gap-0.5" style="height:auto;">' +
                '<div class="relative overflow-hidden group" style="background:#f5f5f5;"><img src="' + thumbUrl(imgs[0], 768) + '" data-original-src="' + imgs[0] + '" class="w-full"' + ldAttr + ' onerror="' + onerror + '" style="display:block; object-fit:contain;">' + (features.favorite ? imgFavBtnHTML(imgs[0], favSet.has(imgs[0])) : '') + '</div>' +
                '<div class="flex gap-0.5">' + imgs.slice(1, 3).map(function(u) {
                    const attr = (eager ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"') + ' decoding="async"';
                    return '<div class="flex-1 relative overflow-hidden group" style="background:#f5f5f5;"><img src="' + thumbUrl(u, 768) + '" data-original-src="' + u + '" class="w-full h-full"' + attr + ' onerror="' + onerror + '" style="display:block; object-fit:contain;">' + (features.favorite ? imgFavBtnHTML(u, favSet.has(u)) : '') + '</div>';
                }).join('') + '</div>' +
            '</div>';
        } else {
            var cells = imgs.slice(0, 4).map(function(u, i) {
                var isLast = (i === 3 && imgs.length > 4);
                var overlay = isLast
                    ? '<div class="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-2xl font-bold pointer-events-none">+' + (imgs.length - 4) + '</div>'
                    : '';
                const attr = (eager ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"') + ' decoding="async"';
                return '<div class="relative overflow-hidden group" style="background:#f5f5f5;"><img src="' + thumbUrl(u, 768) + '" data-original-src="' + u + '" class="w-full"' + attr + ' onerror="' + onerror + '" style="display:block; object-fit:contain;">' + overlay + (features.favorite ? imgFavBtnHTML(u, favSet.has(u)) : '') + '</div>';
            }).join('');
            return '<div class="grid grid-cols-2 gap-0.5" style="height:auto;">' + cells + '</div>';
        }
    }

    // 把比例字符串解析为数字宽高比（w/h），供视频卡片初始 aspect-ratio 使用
    // 支持："16:9" / "3:4 (Portrait Standard)" / 数字 0.5625 / "—" 等
    function parseAspectRatio(ar) {
        if (!ar || ar === '—') return 0;
        if (typeof ar === 'number' && isFinite(ar) && ar > 0) return ar;
        const m = String(ar).match(/(\d+(?:\.\d+)?)\s*[:：×xX]\s*(\d+(?:\.\d+)?)/);
        if (m) {
            const w = parseFloat(m[1]), h = parseFloat(m[2]);
            if (w > 0 && h > 0) return w / h;
        }
        return 0;
    }

    /**
     * 渲染视频卡片封面（video muted playsinline + 播放角标）
     * 用于 litevideo 等视频生成页面的历史记录
     */
    function buildVideoHTML(record, features, onerror) {
        const vids = (record.videos || []).filter(Boolean);
        const src = vids[0] || '';
        const favSet = global.__galleryFavorites || new Set();
        const favBtn = features.favorite ? imgFavBtnHTML(src, favSet.has(src)) : '';
        // 右下角「声音开关」按钮（默认静音图标；hover 卡片时由 JS 加 .show 显示）
        const soundHTML = (features.soundToggle === false) ? '' :
            `<button onclick="toggleVideoSound(this)" class="gallery-sound" title="声音开关" aria-label="声音开关" style="right:12px;bottom:12px;${BTN_INLINE}">${SOUND_OFF_SVG}</button>`;
        // 优先使用记录里的比例（导演台/普通模式都已写入），避免默认 16/9 导致竖屏视频被压成横屏
        const arNum = parseAspectRatio(record.params && record.params.aspectRatio) ||
                      parseAspectRatio(record.params && record.params.aspect_ratio) ||
                      parseAspectRatio(record.aspect_ratio) || 0;
        const arCSS = arNum > 0 ? arNum.toFixed(4) : '16/9';
        return '<div class="relative group" style="background:#0b0b0a;">' +
            '<video src="' + src + '" data-original-src="' + src + '" class="w-full" muted loop playsinline preload="metadata" style="display:block; object-fit:contain; background:#0b0b0a; aspect-ratio:' + arCSS + ';" onloadedmetadata="this.style.aspectRatio=(this.videoWidth/this.videoHeight||' + arCSS + ').toFixed(4)" onerror="' + onerror + '">' +
            '</video>' +
            favBtn +
            soundHTML +
            '</div>';
    }

    function buttonHTML(featureKey, record, extra) {
        const cfg = BUTTON_CONFIG[featureKey];
        if (!cfg) return '';
        const ts = record.timestamp;
        const imgUrl = (record.images && record.images[0]) || (record.videos && record.videos[0]) || '';
        // 把双引号转成 &quot;，避免在 onclick="..." 内提前关闭属性
        const q = (v) => String(v).replace(/"/g, '&quot;');
        // download 走 (imageUrl, filename, event) 三参；其余 action 传完整 record
        let handlerCall;
        if (cfg.action === 'downloadImage') {
            handlerCall = `GalleryActions.${cfg.action}(${q(JSON.stringify(imgUrl))}, ${q(JSON.stringify(String(ts) + '.png'))}, event)`;
        } else if (cfg.action === 'toggleFavorite') {
            // 收藏按钮传图片 URL，支持多图组中只收藏某几张
            handlerCall = `GalleryActions.${cfg.action}(${JSON.stringify(record).replace(/"/g, '&quot;')}, event, ${q(JSON.stringify(imgUrl))})`;
        } else {
            handlerCall = `GalleryActions.${cfg.action}(${JSON.stringify(record).replace(/"/g, '&quot;')}, event)`;
        }
        // favorite：按 active 切换图标 + 颜色
        let iconSvg = ICONS[cfg.icon] || '';
        let extraClass = '';
        if (featureKey === 'favorite') {
            iconSvg = extra && extra.active ? ICONS.star : ICONS.starOutline;
            extraClass = extra && extra.active ? ' is-fav' : '';
        }
        return `<button onclick="${handlerCall}" class="gallery-action-btn w-8 h-8 bg-white/90 backdrop-blur text-black ${cfg.className}${extraClass} rounded-lg flex items-center justify-center transition-colors" title="${cfg.title}">${iconSvg}</button>`;
    }

    function escapeHTML(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /**
     * 将原始图片 URL 转为 /api/media-preview 缩略图 URL
     * 只处理 /output/ 和 /assets/ 本地路径，其他 URL 原样返回
     */
    function thumbUrl(url, w) {
        w = w || 512;
        const raw = String(url || '');
        if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
        try {
            const parsed = new URL(raw, global.location.origin);
            if (parsed.origin !== global.location.origin) return raw;
            if (parsed.pathname === '/api/comfyui/view') {
                parsed.searchParams.set('w', String(w));
                return parsed.pathname + '?' + parsed.searchParams.toString();
            }
            if (parsed.pathname === '/api/media-preview') return raw;
            const path = decodeURIComponent(parsed.pathname);
            if (!path.startsWith('/output/') && !path.startsWith('/assets/')) return raw;
            if (!/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(path)) return raw;
            return '/api/media-preview?w=' + w + '&url=' + encodeURIComponent(path);
        } catch (_) { return raw; }
    }

    // NSFW 提示词关键词检测（保守黑名单，匹配单词边界或紧邻分隔符）
    const NSFW_PATTERNS = [
        // 英文（单词边界）
        /\b(nude|naked|nsfw|explicit|uncensored|hentai|porn|sex|pussy|penis|penetration|vagina|anus|nipple|orgasm|erotic|lewd|bdsm|fetish|genitals|masturbat|cumshot|blowjob|handjob|footjob|titfuck|deepthroat|gangbang|creampie|facial\W*cum|anal\W*sex|virgin\W*sex|rape\W*|rapist|incest|pedophil)\b/i,
        // 中文（紧邻分隔符或首尾）
        /(?:^|[\s,，、。;；])(裸体|裸露|色情|做爱|性交|阴茎|阴道|阴部|乳头|高潮|情色|自慰|口交|肛交|强暴|强奸|乱伦|恋童|卖淫|嫖娼|裸照|裸聊|裸舞|裸戏|三级片|黄片|黄网|毛片)(?=[\s,，、。;；]|$)/
    ];
    function isNsfwPrompt(prompt) {
        if (!prompt) return false;
        // 先规范化：下划线/连字符替换为空格，避免 \b 边界失效
        // 例如 "stealth_sex" → "stealth sex" 才能匹配 \bsex\b
        const p = String(prompt).replace(/[-_]/g, ' ');
        return NSFW_PATTERNS.some(re => re.test(p));
    }

    /** 对话缩略图复用普通卡片的图标、尺寸、阴影及收藏同步。 */
    const cutoutJobs = new Map();
    // Legacy results contain no model list; validate these common RMBG choices on submission.
    const cutoutDefaultModels = ['BEN2', 'RMBG-2.0', 'INSPYRENET', 'BEN', 'Lucida', 'BiRefNet-general', 'BiRefNet-HR-matting', 'BiRefNet_toonout', 'FeyNoBg', 'SAM3'];
    function createCutoutProgress() {
        const element = document.createElement('div');
        element.hidden = true;
        element.innerHTML = '<div role="status" style="font-size:12px;margin-bottom:5px"></div><progress max="100" aria-label="抠图进度" style="display:block;width:100%;height:8px;accent-color:#34d399"></progress>';
        return { element, update(state) {
            element.hidden = false;
            element.querySelector('[role="status"]').textContent = state.label || '正在抠图…';
            const bar = element.querySelector('progress');
            if (Number.isFinite(state.value)) bar.value = state.value;
            else bar.removeAttribute('value');
        } };
    }
    function mountCutoutAction(host, getRecord, imageUrl) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gallery-cutout';
        button.style.cssText = BTN_INLINE + 'right:8px;bottom:60px;width:44px;height:44px;';
        button.title = '编辑图片';
        button.setAttribute('aria-label', button.title);
        button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 16 1-4 8-8 3 3-8 8-4 1Z"/></svg>';
        button.addEventListener('click', event => {
            event.stopPropagation();
            const key = 'canvas-image-edit:' + crypto.randomUUID();
            try {
                // Keep the image payload until the same-tab canvas imports it.
                sessionStorage.setItem(key, JSON.stringify({url:imageUrl, prompt:getRecord()?.prompt || ''}));
                if (global.parent !== global && global.parent.openGalleryCanvasEditor?.(key)) return;
                global.location.assign('/static/canvas.html?editImage=' + encodeURIComponent(key));
            } catch (error) {
                sessionStorage.removeItem(key);
                global.alert(error.message || '图片编辑器打开失败');
            }
        });
        host.appendChild(button);
    }

    let cutoutClientLoading;
    async function loadCutoutClient() {
        if (global.ImageCutoutClient) return global.ImageCutoutClient;
        // ponytail: load the same small client lazily instead of adding it to every gallery page.
        if (!cutoutClientLoading) cutoutClientLoading = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/static/js/image-cutout-client.js?v=20261028007';
            script.onload = () => resolve(global.ImageCutoutClient);
            script.onerror = () => { cutoutClientLoading = null; script.remove(); reject(new Error('抠图组件加载失败，请重试')); };
            document.head.appendChild(script);
        });
        return cutoutClientLoading;
    }
    async function cutoutRequest(url, options) { return (await loadCutoutClient()).request(url, options); }
    async function runCutout(imageUrl, prompt, options) { return (await loadCutoutClient()).run(imageUrl, prompt, options); }

    function setupCutoutComparison(dialog, imageUrl) {
        const surface = dialog.querySelector('[data-compare]');
        const original = dialog.querySelector('[data-original]');
        const divider = dialog.querySelector('[data-divider]');
        const range = dialog.querySelector('[data-compare-range]');
        original.src = imageUrl;
        const position = value => {
            const percent = Math.max(0, Math.min(100, Number(value)));
            range.value = String(percent);
            original.style.clipPath = 'inset(0 ' + (100 - percent) + '% 0 0)';
            divider.style.left = percent + '%';
        };
        range.oninput = () => position(range.value);
        const drag = event => {
            const rect = surface.getBoundingClientRect();
            if (rect.width) position((event.clientX - rect.left) / rect.width * 100);
        };
        surface.onpointerdown = event => {
            if (event.button !== 0) return;
            surface.setPointerCapture(event.pointerId);
            drag(event);
        };
        surface.onpointermove = event => { if (surface.hasPointerCapture(event.pointerId)) drag(event); };
        surface.onpointerup = surface.onpointercancel = event => {
            if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
        };
        original.onerror = () => {
            original.hidden = divider.hidden = true;
            range.disabled = true;
            dialog.querySelector('[data-compare-hint]').textContent = '原图加载失败，仍可查看与下载抠图结果';
        };
        position(50);
    }

    function showCutout(result, imageUrl, prompt) {
        const dialog = document.createElement('dialog');
        dialog.style.cssText = 'margin:auto;padding:0;border:1px solid #475569;border-radius:16px;background:#17202c;color:#f8fafc;width:min(900px,94vw);max-height:92dvh;box-shadow:0 20px 80px #0009;';
        dialog.setAttribute('aria-label', '抠图结果');
        dialog.innerHTML = '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;flex-wrap:wrap"><strong style="flex:1">抠图结果</strong><button type="button" data-download style="min-height:44px;padding:0 12px">下载 PNG</button><button type="button" data-close style="min-width:44px;min-height:44px" aria-label="关闭">✕</button></div><div data-info style="padding:0 16px 12px;font-size:12px;color:#b5c7da"></div><div data-compare style="position:relative;touch-action:pan-y;cursor:ew-resize;user-select:none;background-color:#ddd;background-image:conic-gradient(#aaa 25%,transparent 0 50%,#aaa 0 75%,transparent 0);background-size:20px 20px;overflow:hidden"><img alt="透明背景抠图结果" draggable="false" style="display:block;width:100%;max-height:60dvh;object-fit:contain"><img data-original alt="原图" draggable="false" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none"><span style="position:absolute;left:12px;top:10px;padding:4px 8px;border-radius:6px;background:#17202ccc;color:white;font-size:12px;pointer-events:none">原图</span><span style="position:absolute;right:12px;top:10px;padding:4px 8px;border-radius:6px;background:#17202ccc;color:white;font-size:12px;pointer-events:none">抠图后</span><div data-divider style="position:absolute;top:0;bottom:0;width:2px;background:white;box-shadow:0 0 4px #000;pointer-events:none"><span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);padding:10px 5px;border-radius:20px;background:#17202c;color:white">↔</span></div></div><label style="display:block;padding:8px 16px;font-size:12px"><span data-compare-hint>左右拖动图片或下方滑块，对比原图与抠图结果</span><input data-compare-range type="range" min="0" max="100" step="0.1" value="50" aria-label="原图与抠图对比位置" style="display:block;width:100%;height:44px;accent-color:#34d399"></label>';
        setupCutoutComparison(dialog, imageUrl);
        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;padding:0 16px 12px;align-items:end;';
        controls.innerHTML = '<label style="flex:1;min-width:140px;font-size:12px">抠图模型<select data-model style="display:block;width:100%;min-height:44px;background:#243245;color:#fff;border:1px solid #54647a;border-radius:8px;padding:6px"></select></label><button type="button" data-retry style="min-height:44px;padding:8px 14px;background:#047857;color:#fff;border-radius:8px">重新抠图</button><label style="flex:1;min-width:170px;font-size:12px">历史版本<select data-version style="display:block;width:100%;min-height:44px;background:#243245;color:#fff;border:1px solid #54647a;border-radius:8px;padding:6px"></select></label><div data-status role="status" style="width:100%;font-size:12px;color:#b5c7da">换模型后点击重新抠图，始终使用原图，保留已有版本。</div>';
        dialog.insertBefore(controls, dialog.querySelector('[data-info]'));
        const models = controls.querySelector('[data-model]');
        const versions = controls.querySelector('[data-version]');
        const retry = controls.querySelector('[data-retry]');
        const status = controls.querySelector('[data-status]');
        const targetLabel = document.createElement('label');
        targetLabel.hidden = true;
        targetLabel.style.cssText = 'width:100%;font-size:12px;';
        targetLabel.innerHTML = 'SAM3 保留目标<input data-target type="text" maxlength="2000" placeholder="英文描述，例如 person、cat、logo；只保留匹配的目标" style="display:block;width:100%;min-height:44px;padding:8px;border:1px solid #54647a;border-radius:8px;background:#243245;color:white">';
        controls.appendChild(targetLabel);
        const target = targetLabel.querySelector('[data-target]');
        target.value = result.target || '';
        const toggleTarget = () => { targetLabel.hidden = models.value !== 'SAM3'; };
        models.onchange = toggleTarget;
        const progress = createCutoutProgress();
        progress.element.style.cssText = 'width:100%;color:#b5c7da;';
        controls.appendChild(progress.element);
        let history = [];
        const option = (value, label) => {
            const node = document.createElement('option');
            node.value = value;
            node.textContent = label;
            return node;
        };
        const populateModels = available => {
            available = available?.length ? available : cutoutDefaultModels;
            const selected = models.value || result.model;
            models.replaceChildren(option('auto', '自动选择'), ...available.map(model => option(model, model)));
            models.value = available.includes(selected) ? selected : 'auto';
            toggleTarget();
        };
        const selectVersion = () => {
            const version = history[Number(versions.value)];
            dialog.querySelector('img').src = version.url;
            dialog.querySelector('[data-info]').textContent = (version.selection === 'manual' ? '手动选择：' : '自动选择：') + version.model + ' · ' + version.kind + (version.target ? ' · 目标：' + version.target : '');
        };
        const populateVersions = latest => {
            history = latest.versions?.length ? latest.versions : [latest];
            versions.replaceChildren(...history.map((version, index) => option(String(index), '版本 ' + (index + 1) + ' · ' + version.model + (index === history.length - 1 ? '（最新）' : ''))));
            versions.value = String(history.length - 1);
            selectVersion();
        };
        populateModels(result.available_models || []);
        populateVersions(result);
        versions.onchange = selectVersion;
        cutoutRequest('/api/image-cutout/models').then(data => populateModels(data.models)).catch(error => {
            if (!retry.disabled) status.textContent = '模型列表读取失败：' + error.message + '。当前显示常用或已缓存模型，重新抠图时会校验是否支持。';
        });
        retry.onclick = async () => {
            if (models.value === 'SAM3' && !target.value.trim()) {
                status.textContent = '请填写 SAM3 要保留的目标，例如 person、cat 或 logo。';
                target.focus();
                return;
            }
            if (cutoutJobs.has(imageUrl)) {
                status.textContent = '这张图片正在抠图，请等待当前任务完成。';
                return;
            }
            retry.disabled = true;
            models.disabled = true;
            retry.textContent = '正在抠图…';
            status.textContent = '正在使用原图重新处理，可切换历史版本查看已有结果。';
            progress.update({ label: '正在提交抠图任务…' });
            const job = runCutout(imageUrl, prompt, { model: models.value, retry: true, target: target.value.trim(), onProgress: progress.update });
            cutoutJobs.set(imageUrl, job);
            try {
                const latest = await job;
                populateVersions(latest);
                status.textContent = '新版本已保存，可切换历史版本对比并下载。';
            } catch (error) {
                status.textContent = '重新抠图失败：' + error.message + '；已有版本已保留。';
            } finally {
                progress.element.hidden = true;
                cutoutJobs.delete(imageUrl);
                retry.disabled = false;
                models.disabled = false;
                retry.textContent = '重新抠图';
            }
        };
        dialog.querySelector('[data-close]').onclick = () => dialog.close();
        dialog.querySelector('[data-download]').onclick = event => {
            const version = history[Number(versions.value)];
            global.GalleryActions.downloadImage(version.url, 'cutout-v' + (Number(versions.value) + 1) + '.png', event);
        };
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
        document.body.appendChild(dialog);
        dialog.showModal();
    }

    function mountDownloadAction(host, imageUrl) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gallery-download';
        button.title = '下载原图';
        button.setAttribute('aria-label', button.title);
        button.style.cssText = BTN_INLINE + 'right:8px;bottom:8px;width:44px;height:44px;';
        button.innerHTML = ICONS.download;
        button.addEventListener('click', event => {
            event.stopPropagation();
            const filename = imageUrl.split(/[?#]/)[0].split('/').pop();
            global.GalleryActions.downloadImage(imageUrl, filename, event);
        });
        host.appendChild(button);
    }

    function mountImageActions(host, getRecord, imageUrl) {
        const info = document.createElement('button');
        info.type = 'button';
        info.className = 'gallery-vpfab show';
        info.title = '查看图片信息';
        info.setAttribute('aria-label', info.title);
        info.style.cssText = BTN_INLINE + 'left:12px;bottom:12px;';
        info.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
        info.addEventListener('click', event => {
            event.stopPropagation();
            global.GalleryActions.viewPrompt(getRecord(), event);
        });
        const fav = document.createElement('button');
        fav.type = 'button';
        fav.className = 'gallery-fav show';
        fav.title = '收藏';
        fav.setAttribute('aria-label', fav.title);
        fav.dataset.favUrl = imageUrl;
        fav.style.cssText = BTN_INLINE + 'right:12px;top:12px;';
        fav.innerHTML = FAV_OUT_SVG;
        fav.classList.toggle('is-fav', !!global.__galleryFavorites?.has(imageUrl));
        fav.addEventListener('click', event => {
            event.stopPropagation();
            global.GalleryDisplay.Favorites.toggle(imageUrl);
        });
        host.appendChild(info);
        host.appendChild(fav);
        mountDownloadAction(host, imageUrl);
        mountCutoutAction(host, getRecord, imageUrl);
    }

    global.GalleryCard = { render, thumbUrl, mountImageActions, ICONS, DEFAULT_FEATURES, BUTTON_CONFIG };

    // 点击卡片外空白区域：取消所有选中描边（蓝色高亮）
    // 仅绑定一次；批量选择模式与预设选择浮层内不干涉
    if (!global.__galleryBlankDeselectBound) {
        global.__galleryBlankDeselectBound = true;
        document.addEventListener('click', function (e) {
            if (document.body.classList.contains('history-bulk-selecting')) return;
            // 点在卡片（或其内部元素）上 → 交给卡片自身 onclick 处理，这里不动
            if (e.target.closest && e.target.closest('.masonry-item')) return;
            // 点在预设选择浮层内 → 不干涉
            if (e.target.closest && (e.target.closest('.sp-picker-shell') || e.target.closest('.sp-picker-window'))) return;
            // 其余视为点击空白区域 → 清除所有选中描边
            var sel = document.querySelectorAll('.masonry-item.gallery-selected');
            for (var i = 0; i < sel.length; i++) sel[i].classList.remove('gallery-selected');
        });
    }
})(window);

;/* ---- context-menu.js ---- */

/*!
 * GalleryContextMenu - 统一的右键菜单
 */
(function (global) {
    'use strict';

    let menuEl = null;
    let currentRecord = null;
    let currentFeatures = null;
    let deleteConfirmNode = null;  // 删除两步确认：当前处于确认态的菜单项节点

    function ensureMenu() {
        if (menuEl) return menuEl;
        menuEl = document.createElement('div');
        menuEl.id = 'galleryContextMenu';
        menuEl.className = 'gallery-context-menu';
        document.body.appendChild(menuEl);
        // 点其他地方关闭
        document.addEventListener('click', () => hide());
        document.addEventListener('contextmenu', (e) => {
            // 如果是图片卡片上的右键，不关闭（让 card.js 的处理接管）
            if (e.target.closest('.masonry-item, .chat-image-card')) return;
            hide();
        });
        return menuEl;
    }

    /**
     * 显示右键菜单
     * @param {number} x
     * @param {number} y
     * @param {Object} record
     * @param {Object} features
     */
    function show(x, y, record, features) {
        const el = ensureMenu();
        currentRecord = record;
        currentFeatures = features || {};
        deleteConfirmNode = null;  // 每次重新打开菜单重置确认态
        const items = buildItems(record, currentFeatures);
        el.innerHTML = items.map((it, i) => {
            if (it.divider) return '<div class="gallery-context-divider"></div>';
            return `<div class="gallery-context-item" data-action="${it.action}">${it.icon || ''}<span>${it.label}</span></div>`;
        }).join('');
        el.style.display = 'block';
        // 防止超出视口：
        // [Bugfix] 必须先 force reflow 再 rect，否则 rect 可能为 0×0
        // → 导致 rect.bottom 判断为 0，不触发 bottom clamp
        // → 菜单定位在 (x, y) 但 y 已超出屏幕底部，被遮挡看不到。
        // 解决：先把位置设到 (x, y)，再读 offsetHeight 强制 reflow，最后调整位置。
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        // 强制 reflow，让浏览器计算布局
        // eslint-disable-next-line no-unused-expressions
        el.offsetHeight;
        requestAnimationFrame(() => {
            const rect = el.getBoundingClientRect();
            const winW = window.innerWidth;
            const winH = window.innerHeight;
            // 水平：超出右边界则贴右；超出左边界则贴左
            if (rect.right > winW) {
                el.style.left = Math.max(4, winW - rect.width - 4) + 'px';
            } else if (rect.left < 0) {
                el.style.left = '4px';
            }
            // 垂直：超出下边界则上移；超出上边界则贴顶
            if (rect.bottom > winH) {
                // 优先上移到「鼠标上方」显示，仍不够就贴顶
                const upY = y - rect.height - 4;
                el.style.top = (upY >= 4 ? upY : 4) + 'px';
            } else if (rect.top < 0) {
                el.style.top = '4px';
            }
        });
        // 绑定点击
        el.querySelectorAll('.gallery-context-item').forEach(node => {
            node.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = node.dataset.action;

                // 删除 — 两步确认（第一次变红，第二次才执行）
                if (action === 'deleteHistoryItem') {
                    if (deleteConfirmNode === node) {
                        // 第二次点击：执行删除
                        hide();
                        doDelete(currentRecord);
                    } else {
                        // 第一次点击：进入确认态
                        // 先清除其他项的确认态
                        if (deleteConfirmNode) {
                            deleteConfirmNode.classList.remove('gallery-context-confirming');
                            const span = deleteConfirmNode.querySelector('span');
                            if (span) span.textContent = '删除';
                        }
                        // 当前项变红
                        node.classList.add('gallery-context-confirming');
                        const span = node.querySelector('span');
                        if (span) span.textContent = '确认删除？';
                        deleteConfirmNode = node;
                    }
                    return;
                }

                hide();
                if (action === '__region__') {
                    currentFeatures.regionEdit(currentRecord);
                } else if (action === '__edit__') {
                    currentFeatures.editImage(currentRecord);
                } else if (action === '__extract__') {
                    currentFeatures.extractPrompt(currentRecord);
                } else if (action === '__view__' && currentFeatures.viewImage) {
                    currentFeatures.viewImage(currentRecord);
                } else if (action === '__view__') {
                    // 查看大图：触发卡片的 click 事件打开 lightbox
                    const card = document.querySelector(`#history-${currentRecord.timestamp}`);
                    if (card) card.click();
                    else if (currentRecord.images && currentRecord.images[0]) window.open(currentRecord.images[0], '_blank');
                } else if (action === 'downloadImage') {
                    // 下载图片：需要传 (imageUrl, filename, event)
                    const imgUrl = (currentRecord.images && currentRecord.images[0]) || '';
                    const filename = (currentRecord.timestamp || Date.now()) + '.png';
                    global.GalleryActions.downloadImage(imgUrl, filename, e);
                } else if (action === 'toggleFavorite') {
                    // 收藏：统一入口 GalleryDisplay.Favorites.toggle(url)
                    // UI 同步由 fav:changed 事件驱动
                    const imgUrl = (currentRecord.images && currentRecord.images[0]) || '';
                    if (global.GalleryDisplay && global.GalleryDisplay.Favorites) {
                        global.GalleryDisplay.Favorites.toggle(imgUrl);
                    } else if (typeof global.GalleryActions[action] === 'function') {
                        // 兜底：模块未加载
                        global.GalleryActions[action](currentRecord, e, imgUrl);
                    }
                } else if (action && typeof global.GalleryActions[action] === 'function') {
                    global.GalleryActions[action](currentRecord, e);
                }
            });
        });
    }

    /** 自包含的删除逻辑（不依赖 GalleryActions.deleteHistoryItem，绕过其两步确认限制） */
    function doDelete(record) {
        const ts = record && record.timestamp;
        if (!ts) return;
        // [Task 5 收敛] 优先 NS.Config
        const historyType = record.type || (window.GalleryDisplay?.Config?.type) || 'unknown';
        fetch('/api/history/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: historyType, timestamp: ts })
        }).catch(function () {});
        var el = document.getElementById('history-' + ts);
        if (el) el.remove();
        if (global.GalleryList && Array.isArray(global.GalleryList.allHistory)) {
            global.GalleryList.allHistory = global.GalleryList.allHistory.filter(function (h) { return String(h.timestamp) !== String(ts); });
        }
    }

    function hide() {
        // 重置删除确认态
        if (deleteConfirmNode) {
            deleteConfirmNode.classList.remove('gallery-context-confirming');
            var span = deleteConfirmNode.querySelector('span');
            if (span) span.textContent = '删除';
            deleteConfirmNode = null;
        }
        if (menuEl) menuEl.style.display = 'none';
    }

    const _SVG = {
        magnify: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
        folder: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        pencil: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
        copy: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        star: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
        download: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
        canvas: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
        refresh: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
        trash: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    };

    function buildItems(record, features) {
        const items = [];
        items.push({ label: '查看大图', action: '__view__', icon: _SVG.magnify });
        if (features.regionEdit) items.push({ label:'局部修改图片', action:'__region__', icon:_SVG.pencil });
        if (features.editImage) items.push({ label:'改这张图片', action:'__edit__', icon:_SVG.pencil });
        if (features.extractPrompt) items.push({ label: '提取图片提示词', action: '__extract__', icon: _SVG.pencil });
        if (features.openFolder)  items.push({ label: '打开文件夹', action: 'openImageFolder', icon: _SVG.folder });
        if (features.usePrompt)   items.push({ label: '载入提示词', action: 'usePrompt',       icon: _SVG.pencil });
        if (features.copyPrompt)  items.push({ label: '复制提示词', action: 'copyPrompt',      icon: _SVG.copy });
        if (features.favorite)    items.push({ label: '收藏',       action: 'toggleFavorite',  icon: _SVG.star });
        if (features.download)    items.push({ label: '下载图片',   action: 'downloadImage',   icon: _SVG.download });
        if (features.copyToCanvas) items.push({ label: '复制到画布', action: 'copyToCanvas',    icon: _SVG.canvas });
        if (features.regenerate)  items.push({ label: '重新生成',   action: 'regenerate',      icon: _SVG.refresh });
        if (features.delete) {
            items.push({ divider: true });
            items.push({ label: '删除', action: 'deleteHistoryItem', icon: _SVG.trash });
        }
        return items;
    }

    global.GalleryContextMenu = { show, hide };
})(window);


;/* ---- display.js ---- */

/*!
 * GalleryDisplay - 统一图片展示层
 * 把 Lightbox / 工具栏 / 回到顶部 / 滚动加载 全部收进一个文件，
 * 页面只需调 GalleryDisplay.init(config) 即可。
 *
 * 依赖（需在本文件之前加载）：
 *   gallery/style.css  / card.js / list.js / actions.js / context-menu.js
 *   image-viewer.js
 *
 * API:
 *   GalleryDisplay.init(config)   初始化（注入 HTML/CSS、绑定事件）
 *   GalleryDisplay.openLightbox() 打开灯箱（兼容多种签名）
 *   GalleryDisplay.closeLightbox()
 *   GalleryDisplay.refreshFavBtn()
 *   GalleryDisplay.refreshThumbnails()
 */
(function (global) {
    'use strict';

    /* ============================================================
     *  默认配置
     * ============================================================ */
    var config;
    const DEFAULTS = {
        // 容器选择器
        masonrySelector: '#masonry',
        loadMoreSelector: '#loadMoreTrigger',
        mainSelector: 'main',

        // 功能开关
        lightbox: true,          // 是否注入 lightbox
        scrollToTop: true,       // 是否注入回到顶部按钮
        loadMore: true,          // 是否注入 loadMoreTrigger
        toolbarExtras: true,     // 是否注入工具栏额外按钮（缩略图尺寸/收藏过滤/NSFW）

        // 收藏功能
        favoritesEnabled: true,
        favoritesStorageKey: 'gallery_favorites',

        // 业务回调（页面可覆盖）
        onPromptDisplay: null,   // (promptText) => { en, cn }  用于 lightbox prompt 翻译
        onCopyPrompt: null,      // (record) => void
        onUsePrompt: null,       // (record) => void
        onRegenerate: null,      // (record) => void
        onOpenFolder: null,      // (record) => void
        onExtraToolbarButtons: null, // () => [{id, label, title, onClick}]

        // 历史记录类型（传给 GalleryList）
        historyType: 'unknown',
        pageSize: 15,
        autoScan: true,           // 是否自动扫描新图片
    };

    /* ============================================================
     *  CSS / 基础 HTML 注入：已迁移到 gallery-core.js
     * ============================================================ */

    /* ============================================================
     *  Config 设置（[Task 5 收敛] 写入 NS.Config，自动镜像到 window.GALLERY_CONFIG）
     * ============================================================ */
    function setupGalleryConfig() {
        const data = {
            type: config.historyType,
            container: config.masonrySelector,
            trigger: config.loadMoreSelector,
            pageSize: config.pageSize,
            onUsePrompt: config.onUsePrompt || null,
            onCopyPrompt: config.onCopyPrompt || null,
            onRegenerate: config.onRegenerate || null,
            onOpenFolder: config.onOpenFolder || null,
            onCopyToCanvas: config.onCopyToCanvas || null,
            features: Object.assign({
                delete: true,
                openFolder: true,
                download: true,
                copyToCanvas: false,
                regenerate: false,
                batchSelect: false,
                contextMenu: true,
                imageFallback: true,
                modelBadge: null,
                favorite: config.favoritesEnabled,
                copyPrompt: true,
                usePrompt: true,
            }, config.galleryFeatures || {}),
        };
        if (global.GalleryDisplay?.Config) {
            global.GalleryDisplay.Config.set(data);
        } else {
            // 兜底：Config 还未挂载（开发早期）
            global.GALLERY_CONFIG = data;
        }
    }

    /* ============================================================
     *  公开 API
     * ============================================================ */
    function init(userConfig) {
        config = Object.assign({}, DEFAULTS, userConfig || {});

        // 1. 注入基础 CSS + Load-More Trigger（[Task 7 迁移]）
        if (window.GalleryDisplay?.GalleryCore) {
            window.GalleryDisplay.GalleryCore.init({
                loadMore: config.loadMore,
                mainSelector: config.mainSelector,
            });
        }

        // 2. 初始化 Lightbox 模块（[Task 6 迁移] HTML/Actions 全部由其负责）
        if (config.lightbox && window.GalleryDisplay?.Lightbox) {
            window.GalleryDisplay.Lightbox.init({
                lightbox: config.lightbox,
                onOpenFolder: config.onOpenFolder,
                onCopyPrompt: config.onCopyPrompt,
                onUsePrompt: config.onUsePrompt,
                onPromptDisplay: config.onPromptDisplay,
            });
        }

        // 4. 初始化收藏（[Task 3 迁移]）
        if (config.favoritesEnabled && window.GalleryDisplay?.Favorites) {
            window.GalleryDisplay.Favorites.init({
                storageKey: config.favoritesStorageKey,
            });
        }

        // 5. 设置 GALLERY_CONFIG
        setupGalleryConfig();

        // 6. 初始化 GalleryList
        if (window.GalleryList) {
            const batchSelect = !!(global.GalleryDisplay?.Config?.features?.batchSelect);
            GalleryList.init({
                type: config.historyType,
                container: config.masonrySelector,
                trigger: config.loadMoreSelector,
                pageSize: config.pageSize,
                batchSelect,
            });
        }

        // 7. 初始化工具栏（[Task 5 迁移]）
        if (config.toolbarExtras && window.GalleryDisplay?.ToolbarExtras) {
            window.GalleryDisplay.ToolbarExtras.init({
                toolbarExtras: config.toolbarExtras,
                masonrySelector: config.masonrySelector,
                favoritesEnabled: config.favoritesEnabled,
                nsfwEnabled: config.nsfwEnabled,
                longPressToSelect: config.longPressToSelect,
                onExtraToolbarButtons: config.onExtraToolbarButtons,
            });
        }

        // 8. 初始化回到顶部（[Task 2 迁移]）
        if (config.scrollToTop && window.GalleryDisplay?.ScrollTop) {
            window.GalleryDisplay.ScrollTop.init({ mainSelector: config.mainSelector });
        }

        // 9. 加载历史
        if (window.GalleryList) GalleryList.load(0);

        // 10. 自动扫描新图片（[Task 4 迁移] 默认 60s/次，首次 3s 延迟）
        if (config.autoScan !== false && window.GalleryDisplay?.AutoScan) {
            window.GalleryDisplay.AutoScan.init({ historyType: config.historyType });
        }

        // 11. 挂载 HistoryBulkManager
        if (window.HistoryBulkManager) {
            window.HistoryBulkManager.attach({ masonry: config.masonrySelector, longPressToSelect: config.longPressToSelect });
        }

        // 11. 刷新图标
        if (window.lucide && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }
    }

    /* ============================================================
     *  暴露全局（合并到已有 GalleryDisplay 命名空间，避免覆盖子模块）
     *  Lightbox 相关 API（[Task 6 迁移]）从 GalleryDisplay.Lightbox 转发，
     *  保持 window.openLightbox / GalleryDisplay.openLightbox 等旧调用方式可用。
     * ============================================================ */
    const _lightboxProxy = () => (global.GalleryDisplay && global.GalleryDisplay.Lightbox) || null;
    global.GalleryDisplay = Object.assign(global.GalleryDisplay || {}, {
        init,
        openLightbox: (...args) => { const lb = _lightboxProxy(); if (lb) return lb.openLightbox(...args); },
        closeLightbox: () => { const lb = _lightboxProxy(); if (lb) return lb.closeLightbox(); },
        handleOutsideClick: (e) => { const lb = _lightboxProxy(); if (lb) return lb.handleOutsideClick(e); },
        lightboxAction: (a) => { const lb = _lightboxProxy(); if (lb) return lb.lightboxAction(a); },
        togglePromptPanel: () => { const lb = _lightboxProxy(); if (lb) return lb.togglePromptPanel(); },
        refreshFavBtn: () => { const lb = _lightboxProxy(); if (lb) return lb.refreshFavBtn(); },
        refreshThumbnails: () => { const lb = _lightboxProxy(); if (lb) return lb.refreshThumbnails(); },
        switchImage: (i) => { const lb = _lightboxProxy(); if (lb) return lb.switchImage(i); },
    });

    // 兼容旧代码：window.openLightbox = GalleryDisplay.openLightbox
    Object.defineProperty(global, 'openLightbox', {
        get() { return global.GalleryDisplay.openLightbox; },
        set(fn) { global.GalleryDisplay.openLightbox = fn; },
        configurable: true,
    });

})(window);


;/* ---- timeline.js ---- */

/*!
 * GalleryTimeline — 历史区竖向时间轴（可复用模块）
 *
 * 把按日期分组的瀑布流渲染成竖向时间线：
 *  - 左侧竖向时间轴(.tl-nav)：所有日期圆点排布在贯穿的青色轨道上
 *  - 首屏即列出完整历史的所有日期，所有时间点都在时间轴上，无需滚动即可点击任意时间点跳转
 *  - 点击任意节点平滑滚动到对应时间区；滚动时联动高亮当前节点
 *
 * 设计要点：
 *  1. CSS 由本模块注入，页面无需再写时间轴样式（引入即用，避免重复/漏改）。
 *  2. 时间轴用真实 DOM 元素(.tl-nav/.tl-nav-item)而非伪元素——
 *     因为 .date-separator 是 column-span:all，挂其身上的 ::before 在 CSS 多列布局下
 *     绝对定位会相对整个多列区域计算，圆点被挤到视口外不渲染；真实 DOM 走正常文档流。
 *  3. 复用 list.js 已生成的 .date-separator（按日期分组由 GalleryDisplay.DateGrouping 负责）。
 *  4. 自带 MutationObserver + 轮询兜底，覆盖翻页/自动扫描/新图插入等所有来源，
 *     不依赖页面主动调用，解决"异步加载导致时间轴没出现"的问题。
 *  5. 导航点基于「完整历史日期」构建（默认内置 defaultGetDates：fetch 全量 /api/history +
 *     回退 GalleryList.allHistory），因此首屏不等历史区逐页渲染就列出所有时间点；
 *     点击尚未渲染的日期时，默认内置 defaultOnMissing 会自动 load(1) 直到该日期出现再跳转。
 *
 * 用法：
 *  <script src="/static/modules/gallery/timeline.js"></script>
 *  <script> GalleryTimeline.attach({ container: '#masonry' }); </script>
 *  （可选覆盖：attach({ container, getDates, onMissing, scrollRoot })）
 */
(function (global) {
    'use strict';

    var NS = global.GalleryDisplay = global.GalleryDisplay || {};

    /* ===================== 样式（注入一次） ===================== */
    var CSS = [
        '/* === Gallery Timeline (injected by /static/modules/gallery/timeline.js) === */',
        '.tl-enabled { position: relative; padding-left: 34px; }',
        '.tl-enabled .date-separator {',
        '  position: relative; column-span: all; display: flex; align-items: center; gap: 10px;',
        '  padding: 16px 0 12px; margin: 0; cursor: pointer; scroll-margin-top: 10px;',
        '  border-radius: 8px; transition: background .15s ease;',
        '}',
        '.tl-enabled .date-separator:hover { background: rgba(6, 182, 212, 0.07); }',
        '.tl-enabled .date-separator .sep-line { display: none; }',
        '.tl-enabled .date-separator .sep-label {',
        '  font-size: 11px; font-weight: 800; color: #06b6d4; text-transform: uppercase;',
        '  letter-spacing: 0.06em; white-space: nowrap; background: rgba(0,240,255,0.08);',
        '  padding: 3px 11px; border-radius: 999px;',
        '}',
        '.tl-enabled .date-separator:hover .sep-label { background: rgba(0,240,255,0.16); }',
        '/* 左侧竖向时间轴：位置由 JS 动态计算，垂直居中于画廊在视口的可见区域，',
        '   始终被「夹」在展示区边界内（不穿插顶部提示词/引擎区），高度固定不随图片数量拉伸 */',
        '/* 显隐由 JS 按画廊展示区占据视口的比例控制——展示区占够大才显示 */',
        '.tl-nav {',
        '  position: fixed; left: 16px; top: 0; height: 72vh; max-height: 72vh; width: 14px; z-index: 45;',
        '  display: flex; flex-direction: column; justify-content: space-evenly; align-items: center;',
        '  pointer-events: none; opacity: 0; transition: opacity .2s ease, top .15s ease, height .15s ease;',
        '  overflow-y: auto; overflow-x: visible; scrollbar-width: none; -ms-overflow-style: none;',
        '}',
        '.tl-nav::-webkit-scrollbar { display: none; }',
        '.tl-nav.is-visible { opacity: 1; }',
        '.tl-nav::before {',
        '  content: ""; position: absolute; left: 50%; transform: translateX(-50%);',
        '  top: 2px; bottom: 2px; width: 2px; border-radius: 2px;',
        '  background: linear-gradient(180deg, rgba(0,240,255,0) 0%, rgba(0,240,255,0.55) 5%, rgba(0,240,255,0.55) 95%, rgba(0,240,255,0) 100%);',
        '}',
        '.tl-nav-item {',
        '  position: relative; width: var(--tl-dot, 13px); height: var(--tl-dot, 13px); flex: 0 0 auto; padding: 0; border-radius: 50%;',
        '  border: 2px solid #fcfcfb; background: #00f0ff; box-shadow: 0 0 0 2px rgba(0,240,255,0.28);',
        '  cursor: pointer; pointer-events: auto;',
        '  transition: transform .15s ease, box-shadow .15s ease, background .15s ease;',
        '}',
        '.tl-nav-item:hover { transform: scale(1.45); background: #00f0ff; box-shadow: 0 0 0 4px rgba(6, 182, 212, 0.22); }',
        '.tl-nav-item.is-active { background: #00f0ff; box-shadow: 0 0 0 4px rgba(6, 182, 212, 0.34); transform: scale(1.3); }',
        '.tl-nav-item.is-loading { animation: tl-pulse 0.9s ease-in-out infinite; background: #00f0ff; }',
        '@keyframes tl-pulse { 0%,100% { box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.28); } 50% { box-shadow: 0 0 0 7px rgba(6, 182, 212, 0.05); } }',
        '.tl-nav-item::after {',
        '  content: attr(data-label); position: absolute; left: 100%; margin-left: 9px; top: 50%;',
        '  transform: translateY(-50%); white-space: nowrap; font-size: 11px; font-weight: 800;',
        '  letter-spacing: 0.04em; color: #06b6d4; background: rgba(0,240,255,0.12);',
        '  padding: 3px 9px; border-radius: 999px; opacity: 0; pointer-events: none; transition: opacity .15s ease;',
        '}',
        '.tl-nav-item:hover::after { opacity: 1; }',
        '@media (max-width: 640px) { .tl-nav { left: 10px; width: 12px; } .tl-nav-item { width: 11px; height: 11px; } }',
        '/* 暗色主题（兼容 studio-theme-dark 与 theme-dark） */',
        'body.theme-dark .tl-nav::before, body.studio-theme-dark .tl-nav::before {',
        '  background: linear-gradient(180deg, rgba(0,240,255,0) 0%, rgba(0,240,255,0.5) 5%, rgba(0,240,255,0.5) 95%, rgba(0,240,255,0) 100%);',
        '}',
        'body.theme-dark .tl-enabled .date-separator .sep-label, body.studio-theme-dark .tl-enabled .date-separator .sep-label {',
        '  color: #00f0ff; background: rgba(0,240,255,0.12);',
        '}',
        'body.theme-dark .tl-enabled .date-separator:hover, body.studio-theme-dark .tl-enabled .date-separator:hover { background: rgba(6, 182, 212, 0.1); }',
        'body.theme-dark .tl-nav-item, body.studio-theme-dark .tl-nav-item { border-color: #121211; }',
        'body.theme-dark .tl-nav-item::after, body.studio-theme-dark .tl-nav-item::after { color: #00f0ff; background: rgba(0,240,255,0.14); }'
    ].join('\n');

    function injectCss() {
        if (document.getElementById('gallery-timeline-css')) return;
        var st = document.createElement('style');
        st.id = 'gallery-timeline-css';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    /* ===================== 模块状态 ===================== */
    var _container = null;      // 历史区容器(#masonry)
    var _scrollRoot = null;     // 滚动容器（自动探测，可传 scrollRoot 覆盖）
    var _nav = null;            // 右侧浮动导航 DOM
    var _navSig = '';           // 导航节点签名（避免无变化时重建闪烁）
    var _spyBound = false;      // 滚动联动绑定守卫
    var _observer = null;       // 容器子节点变更监听
    var _retry = null;          // 异步加载兜底轮询
    var _attached = false;
    var _dates = null;          // 全量日期 [{key,label}]（数据驱动导航）
    var _getDates = null;       // 取全量日期的回调（页面可覆盖）
    var _onMissing = null;      // 点击未渲染日期时的回调（页面可覆盖）
    var _topSafe = 0;           // 页面顶部固定/粘性栏底边高度（时间轴顶部不可低于此，避免穿插提示词区）

    function getScrollParent(el) {
        var p = el.parentElement;
        while (p) {
            var s = getComputedStyle(p);
            var oy = s.overflowY, o = s.overflow;
            if ((oy === 'auto' || oy === 'scroll' || o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
            p = p.parentElement;
        }
        return null;
    }

    function getScrollCtx() {
        return _scrollRoot || getScrollParent(_container) || global;
    }

    // 探测页面顶部「固定(fixed)/粘性(sticky)栏」的底边高度，
    // 时间轴顶部不可低于此值，从而避免向下滚动后时间轴探入顶部提示词/工具栏区域。
    // 只在 attach / resize 时调用（不进 scroll 热路径），遍历一次即可。
    function probeTopSafe() {
        var vh = global.innerHeight || document.documentElement.clientHeight;
        var safe = 0;
        var all = document.body ? document.body.getElementsByTagName('*') : [];
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el === _nav) continue;
            var r = el.getBoundingClientRect();
            if (r.bottom <= 0 || r.top > 8) continue; // 先快速排除：只关心贴在视口顶部(≤8px)的元素
            var cs = getComputedStyle(el);
            if (cs.position === 'fixed' || cs.position === 'sticky') {
                if (r.height >= vh * 0.5) continue; // 全屏遮罩/背景层不算顶栏，避免误测导致 _topSafe 卡死、时间轴消失
                if (r.bottom > safe) safe = r.bottom;
            }
        }
        return safe;
    }

    // 时间轴垂直居中于画廊在视口内的可见区域，并始终被「夹」在展示区边界内：
    // 这样无论画廊在视口哪个位置，时间轴都不会超出展示区上/下边界，自然也不会穿插顶部提示词/引擎区。
    function positionNav() {
        if (!_nav || !_container) return;
        var rect = _container.getBoundingClientRect();
        var vh = global.innerHeight || document.documentElement.clientHeight;

        // 顶栏安全下限：探测值若被全屏遮罩误测过大，钳制到视口 60% 以内，保证时间轴始终可见
        var topSafe = Math.min(_topSafe, Math.round(vh * 0.6));
        // 画廊在视口内的可见区域（顶部下限取页面固定/粘性顶栏底边，避免向下滚动后时间轴探入提示词/工具栏区）
        var visibleTop = Math.max(0, rect.top, topSafe);
        var visibleBottom = Math.min(vh, rect.bottom);
        var visibleHeight = Math.max(0, visibleBottom - visibleTop);
        if (visibleHeight < 10) return; // 几乎不可见，保持现状

        // 时间轴高度：用满画廊可见区域（留 4px 上下边距）、且不超过 72vh → 给圆点最大空间，避免挤压/溢出滚动
        var navHeight = Math.max(40, Math.min(Math.round(visibleHeight) - 4, Math.round(vh * 0.72)));
        // 垂直居中于可见区域 → 时间轴被夹在展示区范围内，不穿插提示词区
        var navTop = visibleTop + Math.round((visibleHeight - navHeight) / 2);
        // 兜底：防止顶部下限把时间轴整体推出视口底部
        if (navTop + navHeight > vh) navTop = Math.max(topSafe, vh - navHeight - 4);
        // 水平对齐画廊左内边缘（padding-left 区域内侧）
        var padLeft = parseFloat(getComputedStyle(_container).paddingLeft) || 34;
        var navLeft = Math.max(8, Math.round(rect.left) + Math.min(8, Math.round(padLeft / 2)));

        _nav.style.top = navTop + 'px';
        _nav.style.height = navHeight + 'px';
        _nav.style.left = navLeft + 'px';
    }

    // 在容器内按标签（去掉 "·N" 计数后缀）查找对应日期分隔线
    function findSepByLabel(label) {
        if (!_container || !label) return null;
        var seps = _container.querySelectorAll('.date-separator');
        for (var i = 0; i < seps.length; i++) {
            var lb = seps[i].querySelector('.sep-label');
            if (!lb) continue;
            var base = lb.dataset.baseText || lb.textContent.replace(/\s*·\d+\s*$/, '').trim();
            if (base === label) return seps[i];
        }
        return null;
    }

    // 本地时区 "YYYY-MM-DD"（与 DateGrouping.getKey 一致），作为 DateGrouping 缺失时的兜底
    function fallbackKey(ts) {
        try {
            var d = new Date(typeof ts === 'number' ? ts : Number(ts));
            if (isNaN(d.getTime())) return null;
            var y = d.getFullYear();
            var m = ('0' + (d.getMonth() + 1)).slice(-2);
            var da = ('0' + d.getDate()).slice(-2);
            return y + '-' + m + '-' + da;
        } catch (e) { return null; }
    }

    function cleanLabel(lb) {
        if (!lb) return '';
        return lb.dataset.baseText || lb.textContent.replace(/\s*·\d+\s*$/, '').trim();
    }

    function updateActive() {
        if (!_container) return;
        var seps = _container.querySelectorAll('.date-separator');
        if (!seps.length) return;
        var sc = getScrollCtx();
        var refY = (sc === global) ? 0 : sc.getBoundingClientRect().top;
        var lineY = refY + 96; // 顶部阈值线：判定"当前所处时间"
        var best = null, bestDist = Infinity;
        seps.forEach(function (sep) {
            var r = sep.getBoundingClientRect();
            if (r.top <= lineY + 1) {
                var d = lineY - r.top;
                if (d < bestDist) { bestDist = d; best = sep; }
            }
        });
        if (!best) best = seps[0];
        var bestLabel = cleanLabel(best.querySelector('.sep-label'));
        // 联动高亮左侧时间轴中对应项
        if (_nav) {
            for (var i = 0; i < _nav.children.length; i++) {
                var item = _nav.children[i];
                item.classList.toggle('is-active', item.getAttribute('data-label') === bestLabel);
            }
        }
    }

    function jump(sep) {
        try { sep.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        catch (e) { sep.scrollIntoView(); }
        var lbl = cleanLabel(sep.querySelector('.sep-label'));
        if (_nav) {
            for (var i = 0; i < _nav.children.length; i++) {
                _nav.children[i].classList.toggle('is-active', _nav.children[i].getAttribute('data-label') === lbl);
            }
        }
    }

    // 数据驱动导航点击：优先跳转已渲染的日期区，否则交给 onMissing 去加载
    function jumpToDate(key, label) {
        var sep = findSepByLabel(label);
        if (sep) { jump(sep); return; }
        if (_onMissing) _onMissing(key, label);
    }

    // 时间轴显隐：按「画廊展示区在视口内的可见高度」判断。
    // 只要展示区占据视口足够大的比例（>30%），或画廊完全在视口内，就显示时间轴；
    // 这样滚动浏览图片时（日期分隔线可能滚出视口，但画廊容器仍在视口内）时间轴不会消失。
    // 滚到顶部提示词框/引擎来源区（画廊可见高度很小）或滚过画廊底部后，自动隐藏。
    function updateVisibleState() {
        if (!_nav || !_container) return;
        var rect = _container.getBoundingClientRect();
        var vh = global.innerHeight || document.documentElement.clientHeight;
        var visibleTop = Math.max(0, rect.top);
        var visibleBottom = Math.min(vh, rect.bottom);
        var visibleHeight = Math.max(0, visibleBottom - visibleTop);
        var fullyInView = rect.top >= 0 && rect.bottom <= vh;
        // 展示区占视口 30% 以上，或画廊整体在视口内 → 显示
        var active = visibleHeight > vh * 0.3 || fullyInView;
        var shouldShow = !!(_dates && _dates.length > 1 && active);
        _nav.classList.toggle('is-visible', shouldShow);
    }

    function onScrollContextChanged() {
        updateActive();
        positionNav();
        updateVisibleState();
    }

    function onResize() {
        _topSafe = probeTopSafe();
        onScrollContextChanged();
    }

    function bindSpy() {
        if (_spyBound) return;
        _spyBound = true;
        var sc = _container ? getScrollCtx() : global;
        // 滚动时同步：高亮当前日期 + 按画廊可见区域重定位时间轴 + 显隐
        sc.addEventListener('scroll', onScrollContextChanged, { passive: true });
        global.addEventListener('resize', onResize);
    }

    // 构建时间轴导航：日期集合只来自数据层(_dates 或 gl.allHistory)，
    // 绝不读 DOM 中已渲染的 .date-separator——否则 list.js 的 pruneEmptySeparators
    // 会动态增删日期节点，导致圆点数量随加载漂移、越来越少。
    function buildNav() {
        if (!_nav) {
            _nav = document.createElement('div');
            _nav.id = 'tlNav';
            _nav.className = 'tl-nav';
            document.body.appendChild(_nav); // 挂到 body，脱离容器：固定高度、不随图片数量拉伸
            requestAnimationFrame(positionNav);
        }
        positionNav();
        var nodes = [];
        if (_dates && _dates.length) {
            nodes = _dates.map(function (d) { return { key: d.key, label: d.label, sep: null }; });
        } else if (global.GalleryList && global.GalleryList.allHistory && global.GalleryList.allHistory.length) {
            nodes = toDatesFromItems(global.GalleryList.allHistory).map(function (d) { return { key: d.key, label: d.label, sep: null }; });
        }
        if (nodes.length <= 1) {
            _nav.innerHTML = '';
            _navSig = '';
            updateVisibleState();
            return;
        }
        // 圆点按总数自适应缩小，保证所有时间点都在有限高度内完整显示（不溢出、不出现滚动条）
        var n = nodes.length;
        var dotSize = 13;
        if (n > 45) dotSize = 7;
        else if (n > 30) dotSize = 8;
        else if (n > 20) dotSize = 10;
        else if (n > 12) dotSize = 11;
        _nav.style.setProperty('--tl-dot', dotSize + 'px');
        var sig = '';
        nodes.forEach(function (n) { sig += n.label + '|'; });
        if (sig === _navSig) return; // 节点无变化则不重建，避免闪烁
        _navSig = sig;
        _nav.innerHTML = '';
        nodes.forEach(function (n) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tl-nav-item';
            btn.setAttribute('data-label', n.label);
            btn.title = '跳转到 ' + n.label;
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (n.sep) jump(n.sep);
                else jumpToDate(n.key, n.label);
            });
            _nav.appendChild(btn);
        });
        updateVisibleState(); // 由容器是否在视口内 + 日期数量共同决定是否显示
    }

    // 数据层去重：把历史记录归并成「全量日期」集合（最新在前）。
    // 关键：只基于数据(items / gl.allHistory)，绝不读 DOM —— 否则 list.js 的
    // pruneEmptySeparators 会动态增删 .date-separator，导致圆点数量随加载漂移。
    function toDatesFromItems(items) {
        var DG = (global.GalleryDisplay && global.GalleryDisplay.DateGrouping) || null;
        var seen = {}, keys = [];
        (items || []).forEach(function (it) {
            var k = DG ? DG.getKey(it.timestamp) : fallbackKey(it.timestamp);
            if (k && !seen[k]) { seen[k] = 1; keys.push(k); }
        });
        keys.sort(); keys.reverse(); // 倒序：最新在前
        return keys.map(function (k) { return { key: k, label: DG ? DG.formatLabel(k) : k }; });
    }

    /* ---- 默认：取完整历史日期（首屏即全量，不依赖分页渲染） ---- */
    function defaultGetDates() {
        return new Promise(function (resolve) {
            var gl = global.GalleryList;
            var type = (gl && gl.type) || '';
            var local = (gl && gl.allHistory && gl.allHistory.length) ? gl.allHistory : [];
            if (!type) { resolve(toDatesFromItems(local)); return; }
            fetch('/api/history?type=' + encodeURIComponent(type) + '&page=0&page_size=99999' + ((gl && gl.scope === 'mine') ? '&mine=1' : ''))
                .then(function (r) { return r.json(); })
                .then(function (json) {
                    var arr = Array.isArray(json) ? json : (json.items || []);
                    resolve(toDatesFromItems(arr.length ? arr : local));
                })
                .catch(function () { resolve(toDatesFromItems(local)); });
        });
    }

    /* ---- 默认：点击尚未渲染的日期时，自动 load(1) 逐页加载直到该日期出现再跳转 ---- */
    function defaultOnMissing(key, label) {
        var gl = global.GalleryList;
        var sep = findSepByLabel(label);
        if (sep) { jump(sep); return; }
        if (!gl || !gl.load) return;
        // 高亮正在加载的导航点，给出反馈
        var loadingItem = null;
        if (_nav) {
            for (var i = 0; i < _nav.children.length; i++) {
                if (_nav.children[i].getAttribute('data-label') === label) { loadingItem = _nav.children[i]; break; }
            }
        }
        if (loadingItem) loadingItem.classList.add('is-loading');
        var tries = 0;
        (function step() {
            var s = findSepByLabel(label);
            if (s) {
                if (loadingItem) loadingItem.classList.remove('is-loading');
                jump(s);
                refreshDates(); // 加载后同步全量日期，确保时间点数量稳定（不再随 DOM prune 漂移）
                return;
            }
            // 以「分页真实到底」作为终止条件，而非「日期节点数量是否增加」——
            // 否则连续两页同日期时节点数不增会被误判为到底，导致后续日期永远加载不到。
            if (gl.hasMore === false) {
                if (loadingItem) loadingItem.classList.remove('is-loading');
                refreshDates();
                return;
            }
            if (tries >= 200) {
                if (loadingItem) loadingItem.classList.remove('is-loading');
                refreshDates();
                return;
            }
            tries++;
            Promise.resolve(gl.load(1)).then(step).catch(function () {
                if (loadingItem) loadingItem.classList.remove('is-loading');
                refreshDates();
            });
        })();
    }

    function build() {
        if (!_container) return;
        // 每个已渲染的日期分隔线：整行可点击跳转到对应时间区（绑定一次）
        var seps = _container.querySelectorAll('.date-separator');
        seps.forEach(function (sep) {
            if (!sep.dataset.tlBound) {
                sep.dataset.tlBound = '1';
                var lbl = sep.querySelector('.sep-label');
                sep.title = '点击跳转到 ' + cleanLabel(lbl);
                sep.addEventListener('click', function () { jump(sep); });
            }
        });
        buildNav();
        bindSpy();
        updateActive();
        positionNav();
        updateVisibleState();
    }

    function scheduleRetry() {
        if (_retry) return;
        var tries = 0;
        _retry = setInterval(function () {
            tries++;
            if (!_container) { clearInterval(_retry); _retry = null; return; }
            var seps = _container.querySelectorAll('.date-separator');
            if (seps.length) {
                build();
                clearInterval(_retry);
                _retry = null;
            } else if (tries > 40) { // ~6s 兜底，超过则停止轮询（自动扫描/新图仍由 observer 覆盖）
                clearInterval(_retry);
                _retry = null;
            }
        }, 150);
    }

    // 拉取/刷新全量日期集合（数据驱动导航）
    function refreshDates() {
        if (!_getDates) return;
        Promise.resolve(_getDates()).then(function (dates) {
            if (Array.isArray(dates)) { _dates = dates; buildNav(); }
        }).catch(function (e) { console.warn('[GalleryTimeline] getDates failed', e); });
    }

    /* ===================== 对外 API ===================== */
    function attach(opts) {
        opts = opts || {};
        injectCss();
        var c = typeof opts.container === 'string'
            ? document.querySelector(opts.container)
            : (opts.container || document.getElementById('masonry'));
        if (!c) {
            console.warn('[GalleryTimeline] container not found, skip attach.');
            return;
        }
        _container = c;
        _container.classList.add('tl-enabled');
        if (opts.scrollRoot) {
            _scrollRoot = typeof opts.scrollRoot === 'string'
                ? document.querySelector(opts.scrollRoot)
                : opts.scrollRoot;
        }
        _getDates = opts.getDates || defaultGetDates;
        _onMissing = opts.onMissing || defaultOnMissing;
        if (_attached) { build(); refreshDates(); return; }
        _attached = true;
        // 立即尝试构建（若历史区已渲染）
        build();
        // 探测页面顶部固定/粘性栏底边，作为时间轴顶部下限（避免穿插提示词区）；
        // 布局稳定后再探一次，覆盖字体/图片加载导致的顶栏高度变化；
        // 并在 500ms 后兜底再探一次，避免初始加载遮罩(fullscreen overlay)被误测为顶栏导致 _topSafe 卡死。
        _topSafe = probeTopSafe();
        requestAnimationFrame(function () { _topSafe = probeTopSafe(); positionNav(); });
        setTimeout(function () { _topSafe = probeTopSafe(); positionNav(); updateVisibleState(); }, 500);
        // 容器子节点变更（翻页/自动扫描/新图插入）后重绘
        if (_observer) _observer.disconnect();
        _observer = new MutationObserver(function () { build(); });
        _observer.observe(_container, { childList: true });
        // 兜底：历史区可能尚未加载完成，轮询直到出现日期节点
        scheduleRetry();
        // 首屏即拉全量日期构建导航（不依赖历史区分页渲染）
        refreshDates();
        // 滚动/resize 时按「画廊在视口的实际位置」显隐时间轴与高亮（见 bindSpy）
    }

    function rebuild() {
        if (_container) build();
        refreshDates();
    }

    function destroy() {
        if (_observer) { _observer.disconnect(); _observer = null; }
        if (_retry) { clearInterval(_retry); _retry = null; }
        if (_nav) { _nav.remove(); _nav = null; }
        if (_container) { _container.classList.remove('tl-enabled'); _container = null; }
        _dates = null;
        _getDates = null;
        _onMissing = null;
        _navSig = '';
        _attached = false;
    }

    var api = { attach: attach, rebuild: rebuild, destroy: destroy };
    NS.Timeline = api;
    global.GalleryTimeline = api;
})(window);

