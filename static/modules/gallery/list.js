/*!
 * GalleryList - 列表加载 + 分页 + 滚动加载 + 批量选择状态管理
 */
(function (global) {
    'use strict';

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
        observer: null
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
        const cfg = global.GALLERY_CONFIG || {};
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
    }

    // === 日期分组 ===
    function getDateKey(timestamp) {
        const d = new Date(timestamp);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }

    function formatDateLabel(dateKey) {
        const today = new Date();
        const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth()+1).padStart(2,'0')}-${String(yesterday.getDate()).padStart(2,'0')}`;

        if (dateKey === todayKey) return '今天';
        if (dateKey === yesterdayKey) return '昨天';

        const [y, m, d] = dateKey.split('-');
        const dt = new Date(parseInt(y), parseInt(m)-1, parseInt(d));
        const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
        return `${m}月${d}日 ${weekdays[dt.getDay()]}`;
    }

    function createDateSeparator(dateKey) {
        const el = document.createElement('div');
        el.className = 'date-separator';
        el.innerHTML = `<div class="sep-line"></div><span class="sep-label">${formatDateLabel(dateKey)}</span><div class="sep-line"></div>`;
        return el;
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
                const res = await fetch(`/api/history?type=${encodeURIComponent(state.type)}&page=0&page_size=${state.pageSize}`);
                if (!res.ok) throw new Error('History API ' + res.status);
                const json = await res.json();
                const norm = normalizeHistoryResponse(json);
                state.allHistory = norm.items;
                state.hasMore = norm.hasMore;
            } else {
                if (trigger) trigger.innerText = 'Loading...';
                await new Promise(r => setTimeout(r, 200));
                const nextPage = state.currentPage + 1;
                const res = await fetch(`/api/history?type=${encodeURIComponent(state.type)}&page=${nextPage}&page_size=${state.pageSize}`);
                if (!res.ok) throw new Error('History API ' + res.status);
                const json = await res.json();
                const norm = normalizeHistoryResponse(json);
                // 防御：后端重复返回首页/旧数据时跳过
                const knownTs = new Set(state.allHistory.map(x => String(x.timestamp)));
                const fresh = norm.items.filter(x => !knownTs.has(String(x.timestamp)));
                state.allHistory = state.allHistory.concat(fresh);
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
                    // 重置 isLoading 再重拉（避免守卫拦截重入）
                    state.isLoading = false;
                    // 标记为"刚清理过"，防止重入循环
                    _purgeRan = true;
                    // 释放当前 try 的资源，然后重拉首页
                    try { await load(0); } catch (e) { console.error('[GalleryList] reload after purge error:', e); }
                    return;
                }
            }
        } catch (e) {
            console.error('[GalleryList] load error:', e);
            if (trigger) trigger.innerText = 'Error Loading History';
        } finally {
            state.isLoading = false;
        }
    }

    /**
     * 接收到后端推送的新图片时调用
     * 新图 prepend 到容器最前,根据"容器内第一张旧图"的日期决定是否需要分隔线
     */
    function pushNewImage(record) {
        if (!record || !record.timestamp) return;
        if (document.getElementById(`history-${record.timestamp}`)) return;
        state.allHistory.unshift(record);
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
            global.GalleryCard.render({ container: state.container, record, isNew: true });
        }
        state.currentIndex++;
    }

    /**
     * 批量选择
     */
    function bindBatchSelect() {
        const cfg = global.GALLERY_CONFIG || {};
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
        const cfg = global.GALLERY_CONFIG || {};
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
        const cfg = global.GALLERY_CONFIG || {};
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
        const cfg = global.GALLERY_CONFIG || {};
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
        pushNewImage,
        toggleBatchSelect,
        toggleItemSelection,
        clearSelection,
        get allHistory() { return state.allHistory; },
        set allHistory(v) { state.allHistory = v; }
    };
})(window);
