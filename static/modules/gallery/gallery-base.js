/*!
 * GalleryBase - Gallery 子模块的公共工具
 * 提供：CSS 注入、localStorage 安全访问、命名空间、事件总线
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
        })()
    };
})(window);
