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
                const res = await fetch(`/api/history?type=${encodeURIComponent(state.type)}&page=0&page_size=${state.pageSize}`);
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
                const res = await fetch(`/api/history?type=${encodeURIComponent(state.type)}&page=${nextPage}&page_size=${state.pageSize}`);
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
        pushNewImage,
        toggleBatchSelect,
        toggleItemSelection,
        clearSelection,
        pruneEmptySeparators,
        ensureLoadMore,
        get allHistory() { return state.allHistory; },
        set allHistory(v) { state.allHistory = v; },
        get type() { return state.type; },
        get hasMore() { return state.hasMore; }
    };
})(window);
