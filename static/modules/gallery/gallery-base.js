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
        })()
    };
})(window);
