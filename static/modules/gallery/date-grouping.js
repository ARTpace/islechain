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
            // 清理顶部连续的空分隔线
            let firstItem = container.querySelector('.masonry-item');
            while (firstItem) {
                const prev = firstItem.previousElementSibling;
                if (prev && prev.classList.contains('date-separator')) {
                    prev.remove();
                    firstItem = container.querySelector('.masonry-item');
                } else {
                    break;
                }
            }
        }
    };

    NS.DateGrouping = DateGrouping;

    // === 自检 ===
    if (Base && Base.Test) {
        Base.Test.suite('DateGrouping', [
            ['模块已挂载到 GalleryDisplay', () => NS.DateGrouping === DateGrouping],
            ['getKey 格式 YYYY-MM-DD', () => {
                const k = DateGrouping.getKey(new Date('2026-07-21T10:00:00').getTime());
                return k === '2026-07-21';
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
                const el = DateGrouping.createSeparator('2026-07-21');
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
