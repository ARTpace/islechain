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
                success: { bg: '#10b981', fg: '#fff' },
                info:    { bg: '#111827', fg: '#fff' },
                warn:    { bg: '#f59e0b', fg: '#fff' },
                error:   { bg: '#ef4444', fg: '#fff' }
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
            const before = document.getElementById('galleryToast');
            Base.toast('hello', 'info');
            const el = document.getElementById('galleryToast');
            const ok = el && el.textContent === 'hello';
            if (el) el.remove(); // 清理
            return ok;
        }],
        ['toast 颜色按 type 切换', () => {
            Base.toast('x', 'success');
            const c1 = document.getElementById('galleryToast').style.background;
            Base.toast('x', 'error');
            const c2 = document.getElementById('galleryToast').style.background;
            const ok = c1 && c2 && c1 !== c2;
            const el = document.getElementById('galleryToast');
            if (el) el.remove();
            return ok;
        }],
    ]);
})();
