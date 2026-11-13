/**
 * 提示词方案配置组件（分组版）
 * 支持方案管理、分组控制、复用现有选择器
 * 
 * 使用方法：
 * 1. 引入本文件
 * 2. 在提示词框旁边调用 RandomPrompt.init(containerId, options)
 */

const RandomPrompt = (function() {
    // === 配置 ===
    const API_BASE = '/api/random';
const STORAGE_KEY = 'random_plans';
const AUTO_RANDOM_KEY = 'random_auto_enabled';
const AUTO_RANDOM_PLAN_KEY = 'random_auto_plan';
const RANDOM_ENABLED_KEY = 'random_global_enabled';
const ACTIVE_PLAN_KEY = 'random_active_plan';
const SEQUENTIAL_STATE_KEY = 'random_sequential_state';

    // === 状态 ===
    let plans = {};
    let currentPlan = null;
    let onApplyCallback = null;
    let autoRandomEnabled = false;
    let autoRandomPlanName = '';
    let randomEnabled = false;       // 随机全局开关（点击按钮切换）
    let activePlanName = '';         // 当前选中的方案名
    let triggerButton = null;        // 🎲 按钮引用

    // ─────────────────────────────────────
    //  方案列表视图状态（搜索 / 滚动）
    // ─────────────────────────────────────
    let planListFilter = '';         // 当前搜索关键字
    let planListScrollTop = 0;       // 虚拟滚动位置
    const PLAN_ROW_HEIGHT = 78;      // 方案卡预估高度（紧凄卡）
    const PLAN_VIRT_THRESHOLD = 50;  // 超过此数量启用虚拟滚动
    let planListFilterTimer = null;  // 搜索防抖
    let planListScrollPending = false; // raf 调度标志

    // 顺序模式位置状态：{ `${planName}_${planKey}_${groupId}`: currentIndex }
    let sequentialState = {};

    function loadSequentialState() {
        try {
            const saved = localStorage.getItem(SEQUENTIAL_STATE_KEY);
            if (saved) sequentialState = JSON.parse(saved);
        } catch (e) { sequentialState = {}; }
    }

    function saveSequentialState() {
        try { localStorage.setItem(SEQUENTIAL_STATE_KEY, JSON.stringify(sequentialState)); } catch (e) {}
    }

    function getSeqKey(planName, planKey, groupId) {
        return `${planName}_${planKey}_${groupId}`;
    }

    function getSeqPosition(planName, planKey, groupId) {
        const key = getSeqKey(planName, planKey, groupId);
        return sequentialState[key] || 0;
    }

    function setSeqPosition(planName, planKey, groupId, pos) {
        sequentialState[getSeqKey(planName, planKey, groupId)] = pos;
    }

    function updateSeqPosition(planName, planKey, groupId, count, total) {
        const key = getSeqKey(planName, planKey, groupId);
        const current = sequentialState[key] || 0;
        const next = (current + count) % total;
        sequentialState[key] = next;
        saveSequentialState();
    }

    // ─────────────────────────────────────────────
    //  自动生成引擎状态
    // ─────────────────────────────────────────────
    const AUTO_STORAGE_KEY = 'random_auto_gen_config';

    let autoGenState = {
        running: false,
        mode: 'count',           // 'count' | 'timer'
        totalCount: 10,           // 目标总次数
        currentCount: 0,          // 已完成次数
        timerMinutes: 1,          // 定时模式间隔（分钟）
        timerBatch: 4,            // 定时模式每批次数
        timerRunningCount: 0,     // 定时模式累加计数
        abortController: new AbortController(),
        timerId: null,            // setTimeout for count mode
        intervalId: null,         // setInterval for timer mode
        planAtStart: ''           // 开始时锁定的方案名
    };

    function loadAutoGenConfig() {
        try {
            const saved = localStorage.getItem(AUTO_STORAGE_KEY);
            if (saved) {
                const cfg = JSON.parse(saved);
                if (cfg.mode) autoGenState.mode = cfg.mode;
                if (cfg.totalCount) autoGenState.totalCount = cfg.totalCount;
                if (cfg.timerMinutes) autoGenState.timerMinutes = cfg.timerMinutes;
                if (cfg.timerBatch) autoGenState.timerBatch = cfg.timerBatch;
            }
        } catch(e) {}
    }

    function saveAutoGenConfig() {
        try {
            localStorage.setItem(AUTO_STORAGE_KEY, JSON.stringify({
                mode: autoGenState.mode,
                totalCount: autoGenState.totalCount,
                timerMinutes: autoGenState.timerMinutes,
                timerBatch: autoGenState.timerBatch
            }));
        } catch(e) {}
    }

    // 清理已删除分组的顺序状态
    function cleanSeqState(planName, planKey, validGroupIds) {
        const validKeys = new Set(validGroupIds.map(id => getSeqKey(planName, planKey, id)));
        let changed = false;
        Object.keys(sequentialState).forEach(k => {
            if (k.startsWith(`${planName}_${planKey}_`) && !validKeys.has(k)) {
                delete sequentialState[k];
                changed = true;
            }
        });
        if (changed) saveSequentialState();
    }

    // === 主题检测 ===
    function isDarkTheme() {
        return document.body.classList.contains('studio-theme-dark') ||
            document.documentElement.classList.contains('studio-theme-dark') ||
            document.body.classList.contains('theme-dark') ||
            document.documentElement.classList.contains('theme-dark');
    }

    function getThemeColors() {
        const dark = isDarkTheme();
        return {
            bg: dark ? '#141414' : '#fcfcfb',
            bgSoft: dark ? '#1b1b1a' : '#f9f8f6',
            text: dark ? '#ebe9e4' : '#1a1a1a',
            textSub: dark ? '#666666' : '#999999',
            border: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
            shadow: dark ? '0 20px 60px rgba(0,0,0,0.5)' : '0 20px 60px rgba(0,0,0,0.3)',
            accent: '#06b6d4',
            success: '#10b981',
            danger: '#ef4444'
        };
    }

    // === 工具函数 ===
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function genId() {
        return 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:10px;
            font-size:12px;font-weight:600;z-index:10001;transform:translateX(120%);
            transition:transform 0.3s ease;
            background:${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#06b6d4'};
            color:#fcfcfb;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.style.transform = 'translateX(0)', 10);
        setTimeout(() => {
            toast.style.transform = 'translateX(120%)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ─────────────────────────────────────────────
    //  数据迁移：旧格式(扁平数组) → 新格式(分组)
    // ─────────────────────────────────────────────
    function migratePlanData(plan) {
        let changed = false;
        ['characters', 'artists', 'presets', 'ratios', 'texts', 'loras'].forEach(key => {
            const val = plan[key];
            if (!val || Array.isArray(val) || typeof val === 'boolean') {
                const oldItems = (Array.isArray(val) || typeof val === 'string') ? val : [];
                plan[key] = {
                    groups: oldItems.length > 0
                        ? [{ id: genId(), name: '默认', items: [...oldItems], enabled: true, count: 1, color: GROUP_COLORS[0] }]
                        : []
                };
                changed = true;
            }
            // 给没有 color 的组补上
                if (plan[key]?.groups) {
                plan[key].groups.forEach((g, i) => {
                    if (!g.color) { g.color = GROUP_COLORS[i % GROUP_COLORS.length]; changed = true; }
                    if (!g.mode) { g.mode = 'random'; changed = true; }
                });
            }
        });
        // LoRA items 迁移：旧格式 ["lora_a", "lora_b"] → 新格式 [{name, strength}]
        if (plan.loras?.groups) {
            plan.loras.groups.forEach(g => {
                if (!Array.isArray(g.items)) return;
                const migrated = [];
                const seen = new Set();
                g.items.forEach(it => {
                    if (typeof it === 'string') {
                        const k = it.toLowerCase();
                        if (!k || seen.has(k)) return;
                        seen.add(k);
                        migrated.push({ name: it, strength: 1 });
                    } else if (it && typeof it === 'object' && it.name) {
                        const k = String(it.name).toLowerCase();
                        if (!k || seen.has(k)) return;
                        seen.add(k);
                        migrated.push({
                            name: it.name,
                            strength: (typeof it.strength === 'number') ? it.strength : 1
                        });
                    }
                });
                if (JSON.stringify(migrated) !== JSON.stringify(g.items)) {
                    g.items = migrated;
                    changed = true;
                }
            });
        }
        if ('characterCount' in plan) { delete plan.characterCount; changed = true; }
        if ('artistCount' in plan) { delete plan.artistCount; changed = true; }
        if ('presetCount' in plan) { delete plan.presetCount; changed = true; }
        // 旧版 lora 是 boolean，迁移后置为未启用即可
        if (typeof plan.lora === 'boolean') { plan.lora = { groups: [] }; changed = true; }
        return changed;
    }

    // 获取大类下所有 items 的摊平数组
    function flattenCategory(cat) {
        if (!cat || !cat.groups) return [];
        return cat.groups.flatMap(g => g.items || []);
    }

    // ─────────────────────────────────────────────
    //  初始化
    // ─────────────────────────────────────────────
    function init(containerId, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) { console.error('[RandomPrompt] 容器不存在:', containerId); return; }
        onApplyCallback = options.onApply || null;
        loadPlans();

        // 从旧 autoRandom 配置迁移（仅一次：迁移后清除旧 key）
        if (autoRandomEnabled && !randomEnabled && autoRandomPlanName) {
            randomEnabled = true;
            activePlanName = autoRandomPlanName;
            // 立即保存新状态并清除旧 key，防止每次加载都迁移
            saveRandomEnabled();
            saveActivePlan();
            localStorage.removeItem(AUTO_RANDOM_KEY);
            localStorage.removeItem(AUTO_RANDOM_PLAN_KEY);
            autoRandomEnabled = false;
            autoRandomPlanName = '';
        }

        const btn = createTriggerButton();
        container.appendChild(btn);

        const panel = createMainPanel();
        document.body.appendChild(panel);

        // 加载自动生成配置 + 预渲染自动生成面板内容（第一次打开才不空白）
        loadAutoGenConfig();
        renderAutoGenPanel();

        // 页面关闭时停止自动生成
        window.addEventListener('beforeunload', () => {
            if (autoGenState.running) {
                autoGenState.running = false;
                autoGenState.abortController.abort();
            }
        });

        // createTriggerButton 内部已调用 updateTriggerButtonStyle，无需重复
    }

    // ─────────────────────────────────────────────
    //  触发按钮（🎲）
    // ─────────────────────────────────────────────
    function createTriggerButton() {
        // 注入长按动效样式
        if (!document.getElementById('random-prompt-anim-style')) {
            const style = document.createElement('style');
            style.id = 'random-prompt-anim-style';
            style.textContent = `
                @keyframes rp-long-press-pulse {
                    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(6, 182, 212, 0); }
                    40% { transform: scale(1.08); box-shadow: 0 0 0 6px rgba(6, 182, 212, 0.2); }
                    70% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(6, 182, 212, 0.1); }
                    100% { transform: scale(1.12); box-shadow: 0 0 0 14px rgba(6, 182, 212, 0); }
                }
                @keyframes rp-long-press-fill {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .rp-long-press-active {
                    animation: rp-long-press-pulse 0.5s ease-in-out infinite alternate !important;
                    position: relative;
                    overflow: visible;
                }
                .rp-long-press-active::after {
                    content: '';
                    position: absolute;
                    inset: -4px;
                    border-radius: 14px;
                    border: 2px solid rgba(6, 182, 212, 0.4);
                    animation: rp-long-press-pulse 0.6s ease-out infinite;
                    pointer-events: none;
                }
            `;
            document.head.appendChild(style);
        }

        const btn = document.createElement('button');
        btn.className = 'random-prompt-trigger';
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" ry="3"/>
            <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/>
            <circle cx="16" cy="8" r="1.3" fill="currentColor" stroke="none"/>
            <circle cx="8" cy="16" r="1.3" fill="currentColor" stroke="none"/>
            <circle cx="16" cy="16" r="1.3" fill="currentColor" stroke="none"/>
            <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>
        </svg>`;
        btn.style.cssText = `
            width:34px;height:30px;border-radius:10px;border:none;
            cursor:pointer;
            display:flex;align-items:center;justify-content:center;transition:all 0.2s;flex-shrink:0;
        `;
        updateTriggerButtonStyle(btn);

        initButtonHover(btn);

        // ---- 长按检测 ----
        let pressTimer = null;
        let isLongPress = false;

        function startPress(e) {
            isLongPress = false;
            btn.classList.add('rp-long-press-active');
            pressTimer = setTimeout(() => {
                isLongPress = true;
                pressTimer = null;
                btn.classList.remove('rp-long-press-active');
                // 长按 → 打开方案管理面板
                const panel = document.getElementById('random-main-panel');
                if (panel) togglePanel(panel, false);
            }, 500);
        }
        function endPress() {
            btn.classList.remove('rp-long-press-active');
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
            if (!isLongPress) {
                // 短按 → 切换随机开关
                toggleRandomSwitch(btn);
            }
            isLongPress = false;
        }
        function cancelPress() {
            btn.classList.remove('rp-long-press-active');
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        }

        btn.addEventListener('mousedown', startPress);
        btn.addEventListener('mouseup', endPress);
        btn.addEventListener('mouseleave', cancelPress);

        // touch 支持
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); startPress(); });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); endPress(); });
        btn.addEventListener('touchcancel', cancelPress);

        triggerButton = btn;
        return btn;
    }

    function toggleRandomSwitch(btn) {
        const planNames = Object.keys(plans);
        if (!randomEnabled && planNames.length === 0) {
            showToast('请先创建提示词方案', 'error');
            return;
        }
        randomEnabled = !randomEnabled;
        // 如果开启但没有激活方案，自动选择第一个
        if (randomEnabled && (!activePlanName || !plans[activePlanName])) {
            activePlanName = planNames[0];
            saveActivePlan();
        }
        updateTriggerButtonStyle(btn);
        saveRandomEnabled();
    }

    function updateTriggerButtonStyle(btn) {
        if (!btn) return;
        btn.setAttribute('aria-pressed', String(randomEnabled));
        const dark = isDarkTheme();
        // 色子正面颜色：暗色主题用浅灰，亮色主题用深灰
        const faceBase = dark ? '#cbcac1' : '#555555';
        if (randomEnabled) {
            btn.style.background = 'rgba(6, 182, 212, 0.3)';
            btn.style.borderColor = 'rgba(6, 182, 212, 0.45)';
            btn.style.color = '#06b6d4';
            btn.title = '随机已开启（点击关闭，长按管理方案）';
        } else {
            // 采用 .anima-ctrl 统一的淡色底 + 圆角样式
            btn.style.background = dark ? 'rgba(255,255,255,0.08)' : '#f1f1f1';
            btn.style.borderColor = 'transparent';
            btn.style.color = faceBase;
            btn.title = '随机已关闭（点击开启，长按管理方案）';
        }
    }

    function initButtonHover(btn) {
        btn.addEventListener('mouseenter', () => {
            if (!randomEnabled) {
                btn.style.background = isDarkTheme()
                    ? 'rgba(255,255,255,0.14)'
                    : '#e5e5e5';
            }
        });
        btn.addEventListener('mouseleave', () => {
            if (!randomEnabled) {
                btn.style.background = isDarkTheme()
                    ? 'rgba(255,255,255,0.08)'
                    : '#f1f1f1';
            }
        });
    }

    // ─────────────────────────────────────────────
    //  主面板
    // ─────────────────────────────────────────────
    function createMainPanel() {
        const colors = getThemeColors();
        const panel = document.createElement('div');
        panel.id = 'random-main-panel';
        panel.style.cssText = `
            position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
            width:min(92vw,560px);max-height:85vh;background:${colors.bg};border-radius:20px;
            box-shadow:${colors.shadow};z-index:10000;display:none;overflow:hidden;color:${colors.text};
        `;

        const activePlanDisplay = activePlanName && plans[activePlanName]
            ? `<span id="active-plan-badge" style="font-size:11px;font-weight:600;color:${colors.accent};background:${colors.accent}15;padding:4px 10px;border-radius:8px;margin-left:8px;">当前: ${escapeHtml(activePlanName)}</span>`
            : '<span id="active-plan-badge" style="display:none;"></span>';

        panel.innerHTML = `
            <div style="padding:14px 20px;border-bottom:1px solid ${colors.border};display:flex;align-items:center;justify-content:space-between;">
                <div style="display:flex;align-items:center;">
                    <div style="font-size:17px;font-weight:800;">📝 提示词方案</div>
                    ${activePlanDisplay}
                </div>
                <button id="random-panel-close" style="width:36px;height:36px;border-radius:12px;border:none;background:${colors.bgSoft};cursor:pointer;font-size:18px;color:${colors.textSub};display:flex;align-items:center;justify-content:center;">✕</button>
            </div>
            <div style="padding:16px 20px;overflow-y:auto;max-height:calc(85vh - 80px);">
                <!-- 方案列表区 -->
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                    <div style="font-size:12px;font-weight:700;color:${colors.textSub};letter-spacing:0.05em;">方案列表</div>
                    <div style="display:flex;gap:6px;">
                        <button id="random-ai-gen-plan" style="
                            padding:6px 10px;border-radius:10px;border:1.5px solid ${colors.accent}60;
                            background:${colors.accent}10;cursor:pointer;font-size:12px;font-weight:700;color:${colors.accent};
                            display:flex;align-items:center;gap:4px;
                        " title="让 AI 根据描述生成方案">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5L19 9.5 13.5 11 12 16l-1.5-5L5 9.5 10.5 8z"/></svg>
                            AI 生成
                        </button>
                        <button id="random-new-plan" style="
                            padding:6px 12px;border-radius:10px;border:1.5px dashed ${colors.accent}60;
                            background:transparent;cursor:pointer;font-size:12px;font-weight:700;color:${colors.accent};
                            display:flex;align-items:center;gap:4px;
                        ">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            新建方案
                        </button>
                    </div>
                </div>

                <!-- 搜索框（仅在有方案时显示）-->
                <div id="random-plan-search-wrap" style="display:none;margin-bottom:10px;">
                    <div style="position:relative;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${colors.textSub}" stroke-width="2" stroke-linecap="round" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);pointer-events:none;">
                            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <input id="random-plan-search" type="text" placeholder="搜索方案名…" style="
                            width:100%;height:36px;padding:0 36px 0 36px;border:1.5px solid ${colors.border};border-radius:10px;
                            background:transparent;color:${colors.text};font-size:13px;outline:none;box-sizing:border-box;
                        ">
                        <button id="random-plan-search-clear" style="display:none;position:absolute;right:8px;top:50%;transform:translateY(-50%);width:20px;height:20px;border-radius:50%;border:none;background:${colors.textSub}30;color:${colors.text};cursor:pointer;padding:0;font-size:12px;line-height:1;">✕</button>
                    </div>
                    <div id="random-plan-count" style="font-size:11px;color:${colors.textSub};margin-top:6px;padding-left:2px;"></div>
                </div>

                <div id="random-plan-list" style="position:relative;max-height:340px;overflow-y:auto;"></div>

                <!-- 自动生成分区 -->
                <div style="margin-top:24px;padding-top:18px;border-top:1px solid ${colors.border};">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                        <div style="font-size:12px;font-weight:700;color:${colors.textSub};letter-spacing:0.05em;">🔄 自动生成</div>
                    </div>
                    <div id="random-auto-panel"></div>
                </div>
            </div>
        `;

        panel.querySelector('#random-panel-close').addEventListener('click', () => panel.style.display = 'none');
        panel.querySelector('#random-new-plan').addEventListener('click', () => openPlanEditor(null));

        // ✨ AI 生成方案
        panel.querySelector('#random-ai-gen-plan').addEventListener('click', () => openAIGenDialog());

        // 搜索框输入（防抖 120ms）
        const searchInput = panel.querySelector('#random-plan-search');
        const searchClear = panel.querySelector('#random-plan-search-clear');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const v = e.target.value;
                if (searchClear) searchClear.style.display = v ? 'block' : 'none';
                clearTimeout(planListFilterTimer);
                planListFilterTimer = setTimeout(() => {
                    planListFilter = v.trim().toLowerCase();
                    planListScrollTop = 0;
                    renderPlanList();
                }, 120);
            });
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    searchInput.value = '';
                    if (searchClear) searchClear.style.display = 'none';
                    planListFilter = '';
                    planListScrollTop = 0;
                    renderPlanList();
                }
            });
        }
        if (searchClear) {
            searchClear.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                searchClear.style.display = 'none';
                planListFilter = '';
                planListScrollTop = 0;
                renderPlanList();
            });
        }

        // 虚拟滚动监听（在列表容器上）
        const planList = panel.querySelector('#random-plan-list');
        if (planList) {
            planList.addEventListener('scroll', () => {
                if (planListScrollPending) return;
                planListScrollPending = true;
                requestAnimationFrame(() => {
                    planListScrollTop = planList.scrollTop;
                    planListScrollPending = false;
                    // 只有超过阈值才虚拟滚动
                    if (getSortedFilteredPlans().length > PLAN_VIRT_THRESHOLD) {
                        renderPlanList();
                    }
                });
            });
        }

        return panel;
    }

    // ─────────────────────────────────────────────
    //  自动生成面板渲染
    // ─────────────────────────────────────────────
    function renderAutoGenPanel() {
        const container = document.getElementById('random-auto-panel');
        if (!container) return;
        const colors = getThemeColors();
        const s = autoGenState;
        const isCount = s.mode === 'count';

        container.innerHTML = `
            <div style="margin-bottom:14px;">
                <div style="font-size:12px;font-weight:700;color:${colors.textSub};margin-bottom:8px;">模式选择</div>
                <div style="display:flex;gap:10px;">
                    <div id="auto-mode-count" class="auto-mode-option" style="
                        flex:1;padding:14px;border-radius:14px;cursor:pointer;
                        border:2px solid ${isCount ? colors.accent : colors.border};
                        background:${isCount ? colors.accent + '12' : 'transparent'};
                    ">
                        <div style="text-align:center;margin-bottom:10px;">
                            <div style="font-size:20px;margin-bottom:4px;">🔢</div>
                            <div style="font-size:13px;font-weight:700;color:${isCount ? colors.accent : colors.text};">计次模式</div>
                            <div style="font-size:10px;color:${colors.textSub};margin-top:2px;">生成指定次数后停止</div>
                        </div>
                        <div style="display:flex;gap:6px;align-items:center;justify-content:center;" onclick="event.stopPropagation();">
                            <span style="font-size:12px;font-weight:600;color:${colors.text};">生成</span>
                            <input id="auto-count-total" type="number" min="1" max="999" value="${s.totalCount}" style="
                                width:54px;height:28px;padding:0;border:1.5px solid ${colors.border};border-radius:8px;
                                font-size:13px;text-align:center;background:transparent;color:${colors.text};outline:none;font-weight:700;
                            ">
                            <span style="font-size:12px;font-weight:600;color:${colors.text};">次</span>
                        </div>
                    </div>
                    <div id="auto-mode-timer" class="auto-mode-option" style="
                        flex:1;padding:14px;border-radius:14px;cursor:pointer;
                        border:2px solid ${!isCount ? colors.accent : colors.border};
                        background:${!isCount ? colors.accent + '12' : 'transparent'};
                    ">
                        <div style="text-align:center;margin-bottom:10px;">
                            <div style="font-size:20px;margin-bottom:4px;">⏰</div>
                            <div style="font-size:13px;font-weight:700;color:${!isCount ? colors.accent : colors.text};">定时模式</div>
                            <div style="font-size:10px;color:${colors.textSub};margin-top:2px;">按固定间隔持续生成</div>
                        </div>
                        <div style="display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap;" onclick="event.stopPropagation();">
                            <span style="font-size:12px;font-weight:600;color:${colors.text};">每</span>
                            <input id="auto-timer-minutes" type="number" min="1" max="120" value="${s.timerMinutes}" style="
                                width:46px;height:28px;padding:0;border:1.5px solid ${colors.border};border-radius:8px;
                                font-size:13px;text-align:center;background:transparent;color:${colors.text};outline:none;font-weight:700;
                            ">
                            <span style="font-size:12px;font-weight:600;color:${colors.text};">分</span>
                            <span style="font-size:12px;font-weight:600;color:${colors.textSub};">×</span>
                            <input id="auto-timer-batch" type="number" min="1" max="20" value="${s.timerBatch}" style="
                                width:40px;height:28px;padding:0;border:1.5px solid ${colors.border};border-radius:8px;
                                font-size:13px;text-align:center;background:transparent;color:${colors.text};outline:none;font-weight:700;
                            ">
                            <span style="font-size:12px;font-weight:600;color:${colors.text};">轮</span>
                        </div>
                    </div>
                </div>
            </div>

            <div id="auto-gen-progress" style="display:none;margin-bottom:14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <span id="auto-progress-text" style="font-size:12px;font-weight:700;color:${colors.accent};">0/0</span>
                    <span id="auto-progress-status" style="font-size:11px;color:${colors.textSub};">准备中...</span>
                </div>
                <div style="width:100%;height:6px;background:${colors.border};border-radius:3px;overflow:hidden;">
                    <div id="auto-progress-bar" style="width:0%;height:100%;background:${colors.accent};border-radius:3px;transition:width 0.3s ease;"></div>
                </div>
            </div>

            <button id="auto-gen-start-btn" style="
                width:100%;padding:14px;border-radius:14px;border:none;cursor:pointer;
                font-size:15px;font-weight:800;
                background:${s.running ? colors.danger : colors.accent};
                color:#fcfcfb;display:flex;align-items:center;justify-content:center;gap:8px;
            ">
                ${s.running
                    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> 停止`
                    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> 开始自动生成`
                }
            </button>
        `;

        // 绑定事件
        bindAutoGenEvents(container);
    }

    function bindAutoGenEvents(container) {
        // 模式切换
        container.querySelector('#auto-mode-count')?.addEventListener('click', () => {
            autoGenState.mode = 'count';
            saveAutoGenConfig();
            renderAutoGenPanel();
        });
        container.querySelector('#auto-mode-timer')?.addEventListener('click', () => {
            autoGenState.mode = 'timer';
            saveAutoGenConfig();
            renderAutoGenPanel();
        });

        // 输入框保存
        const countInput = container.querySelector('#auto-count-total');
        if (countInput) countInput.addEventListener('change', () => {
            autoGenState.totalCount = Math.max(1, parseInt(countInput.value) || 10);
            saveAutoGenConfig();
        });
        const timerMinutesInput = container.querySelector('#auto-timer-minutes');
        if (timerMinutesInput) timerMinutesInput.addEventListener('change', () => {
            autoGenState.timerMinutes = Math.max(1, parseInt(timerMinutesInput.value) || 1);
            saveAutoGenConfig();
        });
        const timerBatchInput = container.querySelector('#auto-timer-batch');
        if (timerBatchInput) timerBatchInput.addEventListener('change', () => {
            autoGenState.timerBatch = Math.max(1, parseInt(timerBatchInput.value) || 4);
            saveAutoGenConfig();
        });

        // 开始/停止按钮
        const btn = container.querySelector('#auto-gen-start-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                if (autoGenState.running) {
                    stopAutoGen();
                } else {
                    startAutoGen();
                }
            });
        }
    }

    function updateAutoGenProgress(text, status, pct) {
        const textEl = document.getElementById('auto-progress-text');
        const statusEl = document.getElementById('auto-progress-status');
        const barEl = document.getElementById('auto-progress-bar');
        if (textEl) textEl.textContent = text;
        if (statusEl) statusEl.textContent = status;
        if (barEl) barEl.style.width = Math.min(100, pct) + '%';
        const progress = document.getElementById('auto-gen-progress');
        if (progress) progress.style.display = '';
    }

    function hideAutoGenProgress() {
        const progress = document.getElementById('auto-gen-progress');
        if (progress) progress.style.display = 'none';
    }

    // ─────────────────────────────────────────────
    //  自动生成引擎 - 启动
    // ─────────────────────────────────────────────
    async function startAutoGen() {
        if (autoGenState.running) return;
        if (!activePlanName || !plans[activePlanName]) {
            showToast('请先选择提示词方案', 'error');
            return;
        }
        if (!randomEnabled) {
            showToast('请先开启 🎲 随机开关', 'error');
            return;
        }

        const s = autoGenState;
        s.running = true;
        s.currentCount = 0;
        s.timerRunningCount = 0;
        s.completedRounds = 0;
        s.nextTickAt = 0;
        s.planAtStart = activePlanName;
        s.abortController = new AbortController();

        // 关闭面板，只保留进度指示和 🎲 按钮动画
        const panel = document.getElementById('random-main-panel');
        if (panel) panel.style.display = 'none';

        showToast('🔄 自动生成已启动', 'success');
        addAutoGenButtonAnim(true);

        if (s.mode === 'count') {
            await runCountMode();
        } else {
            await runTimerMode();
        }
    }

    // ─────────────────────────────────────────────
    //  计次模式 - 连续生成
    // ─────────────────────────────────────────────
    async function runCountMode() {
        const s = autoGenState;
        const target = s.totalCount;

        // 重新渲染面板显示进度
        const panel = document.getElementById('random-auto-panel');
        if (panel) renderAutoGenPanel();

        updateAutoGenProgress('0/' + target, '准备中...', 0);

        for (let i = 0; i < target; i++) {
            if (!s.running) break;
            if (s.abortController.signal.aborted) break;

            updateAutoGenProgress(
                (i + 1) + '/' + target,
                '正在生成第 ' + (i + 1) + ' 次...',
                ((i) / target) * 100
            );

            const ok = await doOneAutoRound();
            if (!ok) {
                // 失败跳过
                continue;
            }
            s.currentCount = i + 1;

            if (i < target - 1) {
                // 每次生成后等待 2 秒
                await sleep(2000);
            }
        }

        if (s.running) {
            finishAutoGen('✅ 完成！共生成 ' + s.currentCount + ' 次');
        }
    }

    // ─────────────────────────────────────────────
    //  定时模式
    // ─────────────────────────────────────────────
    async function runTimerMode() {
        const s = autoGenState;
        const minutes = s.timerMinutes;
        const batch = s.timerBatch;

        // 立即执行一轮
        const panel = document.getElementById('random-auto-panel');
        if (panel) renderAutoGenPanel();

        s.timerRunningCount = 0;
        updateAutoGenProgress('第 1 轮', '正在生成...', 5);

        // 先执行第一轮
        for (let i = 0; i < batch; i++) {
            if (!s.running) break;
            if (s.abortController.signal.aborted) break;
            const ok = await doOneAutoRound();
            if (ok) s.timerRunningCount++;
            // 每轮内部间隔 1.5 秒
            if (i < batch - 1 && s.running) await sleep(1500);
        }
        s.completedRounds = 1;
        s.currentCount = s.timerRunningCount;

        // 后续按间隔周期执行
        while (s.running && !s.abortController.signal.aborted) {
            const nextMs = minutes * 60 * 1000;
            updateAutoGenProgress(
                '第 ' + (s.completedRounds + 1) + ' 轮',
                '下一轮 ' + minutes + ' 分钟后...',
                Math.min(95, (s.completedRounds % 20) * 5)
            );

            await sleepOrAbort(nextMs);
            if (!s.running || s.abortController.signal.aborted) break;

            s.completedRounds++;
            updateAutoGenProgress(
                '第 ' + s.completedRounds + ' 轮',
                '正在生成...',
                5
            );

            for (let i = 0; i < batch; i++) {
                if (!s.running) break;
                if (s.abortController.signal.aborted) break;
                const ok = await doOneAutoRound();
                if (ok) s.timerRunningCount++;
                if (i < batch - 1 && s.running) await sleep(1500);
            }
            s.currentCount = s.timerRunningCount;
        }

        if (s.running) {
            finishAutoGen('✅ 定时生成已停止，共 ' + s.timerRunningCount + ' 轮');
        }
    }

    // ─────────────────────────────────────────────
    //  执行单轮自动生成
    // ─────────────────────────────────────────────
    async function doOneAutoRound() {
        const s = autoGenState;
        if (!s.running || s.abortController.signal.aborted) return false;

        // 检查方案是否仍有效
        if (!plans[activePlanName] || !randomEnabled) {
            stopAutoGen();
            showToast('⚠ 方案已失效或随机已关闭，自动生成停止', 'error');
            return false;
        }

        // 1. 执行自动随机：生成新的提示词
        try {
            const result = await _internalApplyAutoRandom();
            if (!result || !result.positive) {
                console.warn('[AutoGen] _internalApplyAutoRandom 返回空');
                return false;
            }

            // 2. 将提示词写入文本框（handleRender 从这里读取）
            const promptEl = document.getElementById('prompt');
            if (promptEl) {
                promptEl.value = result.positive;
                promptEl.dispatchEvent(new Event('input'));
            }

            // 3. 应用负向提示词
            if (result.negative) {
                const negEl = document.getElementById('negativePrompt');
                if (negEl) {
                    negEl.value = result.negative;
                }
            }

            // 4. 应用 LoRA 触发词（必须在 prompt 写入后调用）
            if (result.plan && result.plan.loras && result.plan.loras.length > 0) {
                applyRandomLoras(result.plan.loras, activePlanName);
            }
        } catch (e) {
            console.error('[AutoGen] 应用随机提示词失败:', e);
            return false;
        }

        return new Promise((resolve) => {
            let done = false;

            window.__autoGenNotifyDone = () => {
                if (done) return;
                done = true;
                window.__autoGenNotifyDone = null;
                window.__autoGenNotifyError = null;
                window.__autoGenNotifyFinally = null;
                resolve(true);
            };

            window.__autoGenNotifyError = (msg) => {
                if (done) return;
                done = true;
                window.__autoGenNotifyDone = null;
                window.__autoGenNotifyError = null;
                window.__autoGenNotifyFinally = null;
                console.warn('[AutoGen] 单轮生成失败:', msg);
                resolve(false);
            };

            window.__autoGenNotifyFinally = () => {
                // 仅用于清理
            };

            // 调用 handleRender
            if (typeof handleRender === 'function') {
                handleRender();
            } else {
                console.error('[AutoGen] handleRender 未定义');
                window.__autoGenNotifyError('handleRender 未定义');
            }

            // 超时保护（10 分钟）
            setTimeout(() => {
                if (!done) {
                    done = true;
                    window.__autoGenNotifyDone = null;
                    window.__autoGenNotifyError = null;
                    window.__autoGenNotifyFinally = null;
                    console.warn('[AutoGen] 单轮超时');
                    resolve(false);
                }
            }, 10 * 60 * 1000);
        });
    }

    // ─────────────────────────────────────────────
    //  完成 / 停止
    // ─────────────────────────────────────────────
    function finishAutoGen(msg) {
        autoGenState.running = false;
        addAutoGenButtonAnim(false);

        const panel = document.getElementById('random-auto-panel');
        if (panel) renderAutoGenPanel();

        updateAutoGenProgress('100%', msg, 100);
        setTimeout(() => {
            hideAutoGenProgress();
            showToast(msg, 'success');
        }, 2000);
    }

    function stopAutoGen() {
        if (!autoGenState.running) return;
        const s = autoGenState;
        s.running = false;
        s.abortController.abort();

        if (s.timerId) {
            clearTimeout(s.timerId);
            s.timerId = null;
        }
        if (s.intervalId) {
            clearInterval(s.intervalId);
            s.intervalId = null;
        }

        // 清理渲染钩子
        window.__autoGenNotifyDone = null;
        window.__autoGenNotifyError = null;
        window.__autoGenNotifyFinally = null;

        addAutoGenButtonAnim(false);

        const count = s.mode === 'count' ? s.currentCount : s.timerRunningCount;
        const msg = s.mode === 'count'
            ? '⏹ 已停止，完成 ' + count + '/' + s.totalCount + ' 次'
            : '⏹ 已停止，共完成 ' + count + ' 次';

        const panel = document.getElementById('random-auto-panel');
        if (panel) renderAutoGenPanel();
        hideAutoGenProgress();
        showToast(msg, 'info');
    }

    // ─────────────────────────────────────────────
    //  工具函数
    // ─────────────────────────────────────────────
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function sleepOrAbort(ms) {
        return new Promise((resolve) => {
            const s = autoGenState;
            // 记录预计唤醒时间戳，供外部读取（UI 倒计时）
            s.nextTickAt = Date.now() + ms;
            const tid = setTimeout(resolve, ms);
            s.timerId = tid;

            // 如果被中断，清除 timer
            const check = setInterval(() => {
                if (!s.running || s.abortController.signal.aborted) {
                    clearTimeout(tid);
                    clearInterval(check);
                    resolve();
                }
            }, 500);
        });
    }

    function addAutoGenButtonAnim(active) {
        const btn = triggerButton;
        if (!btn) return;
        if (active) {
            btn.dataset.autoGen = '1';
            // 注入呼吸动画
            if (!document.getElementById('auto-gen-pulse-style')) {
                const st = document.createElement('style');
                st.id = 'auto-gen-pulse-style';
                st.textContent = `
                    [data-auto-gen="1"] {
                        animation: auto-gen-pulse 1.2s ease-in-out infinite !important;
                        box-shadow: 0 0 0 0 rgba(16,185,129,0);
                    }
                    @keyframes auto-gen-pulse {
                        0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.5); }
                        50% { box-shadow: 0 0 0 8px rgba(16,185,129,0); }
                    }
                `;
                document.head.appendChild(st);
            }
            btn.style.background = 'rgba(16,185,129,0.25)';
            btn.style.color = '#10b981';
            btn.title = '🔄 自动生成运行中（点击面板停止）';
        } else {
            delete btn.dataset.autoGen;
            updateTriggerButtonStyle(btn);
        }
    }

    // ─────────────────────────────────────────────
    //  (已移除 Tab 切换 — 方案 / 自动生成 合并为单页)
    // ─────────────────────────────────────────────
    function refreshMainPanel() {
        const plansList = document.getElementById('random-plan-list');
        const autoPanel = document.getElementById('random-auto-panel');
        if (plansList) renderPlanList();
        if (autoPanel) renderAutoGenPanel();
    }

    // ─────────────────────────────────────────────
    //  方案列表渲染
    // ─────────────────────────────────────────────
    function renderPlanList() {
        const container = document.getElementById('random-plan-list');
        if (!container) return;
        const colors = getThemeColors();

        // 更新面板标题中的"当前方案"徽章
        const badge = document.getElementById('active-plan-badge');
        if (badge) {
            if (activePlanName && plans[activePlanName]) {
                badge.style.display = '';
                badge.textContent = '当前: ' + activePlanName;
                badge.style.cssText = `font-size:11px;font-weight:600;color:${colors.accent};background:${colors.accent}15;padding:4px 10px;border-radius:8px;margin-left:8px;`;
            } else {
                badge.style.display = 'none';
            }
        }

        // 搜索框可见性 + 计算过滤后的方案
        const allNames = Object.keys(plans);
        const searchWrap = document.getElementById('random-plan-search-wrap');
        const countEl = document.getElementById('random-plan-count');
        if (searchWrap) searchWrap.style.display = allNames.length >= 1 ? '' : 'none';

        // 空状态
        if (allNames.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:${colors.textSub};">
                <div style="font-size:32px;margin-bottom:8px;opacity:0.5;">📋</div>
                <div style="font-size:13px;font-weight:600;">暂无方案</div>
                <div style="font-size:11px;margin-top:4px;">点击"新建方案"创建你的第一个提示词方案</div>
            </div>`;
            if (countEl) countEl.textContent = '';
            return;
        }

        // 取过滤 + 排序后的列表
        const sortedFiltered = getSortedFilteredPlans();
        if (countEl) {
            if (planListFilter) {
                countEl.textContent = `匹配 ${sortedFiltered.length} / ${allNames.length} 个方案`;
            } else {
                countEl.textContent = `共 ${allNames.length} 个方案 · 按最近使用排序`;
            }
        }

        // 过滤后为空
        if (sortedFiltered.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:30px 20px;color:${colors.textSub};">
                <div style="font-size:28px;margin-bottom:6px;opacity:0.5;">🔍</div>
                <div style="font-size:12px;font-weight:600;">没有匹配的方案</div>
                <div style="font-size:11px;margin-top:4px;">试试别的关键字，或按 Esc 清除搜索</div>
            </div>`;
            return;
        }

        // 虚拟滚动判断
        const useVirt = sortedFiltered.length > PLAN_VIRT_THRESHOLD;

        if (!useVirt) {
            // 直接全量渲染
            container.style.height = '';
            container.innerHTML = sortedFiltered.map(name => renderPlanCard(name, colors)).join('');
        } else {
            // 虚拟滚动：上下 padding 占位 + 只渲染可见区
            const viewportH = container.clientHeight || 480;
            const overscan = 4;
            const visibleCount = Math.ceil(viewportH / PLAN_ROW_HEIGHT) + overscan * 2;
            const startIdx = Math.max(0, Math.floor(planListScrollTop / PLAN_ROW_HEIGHT) - overscan);
            const endIdx = Math.min(sortedFiltered.length, startIdx + visibleCount);
            const totalH = sortedFiltered.length * PLAN_ROW_HEIGHT;
            const offsetTop = startIdx * PLAN_ROW_HEIGHT;

            const visibleCards = sortedFiltered.slice(startIdx, endIdx).map(name => renderPlanCard(name, colors)).join('');
            container.innerHTML = `
                <div style="height:${totalH}px;position:relative;">
                    <div style="position:absolute;top:${offsetTop}px;left:0;right:0;">${visibleCards}</div>
                </div>`;
        }

        bindPlanListEvents(container);
    }

    // 过滤 + 排序：按 lastUsedAt DESC，未使用过放最后
    function getSortedFilteredPlans() {
        const q = planListFilter;
        const all = Object.keys(plans);
        const filtered = q
            ? all.filter(n => n.toLowerCase().includes(q))
            : all;
        return filtered.sort((a, b) => {
            const ta = plans[a].lastUsedAt || 0;
            const tb = plans[b].lastUsedAt || 0;
            if (tb !== ta) return tb - ta;           // 最近使用优先
            return (plans[b].useCount || 0) - (plans[a].useCount || 0); // 再按频次
        });
    }

    // 单张方案卡 HTML（保持原样）
    function renderPlanCard(name, colors) {
        const plan = plans[name];
        const isActive = name === activePlanName;
        const charCount = flattenCategory(plan.characters).length;
        const artistCount = flattenCategory(plan.artists).length;
        const presetCount = flattenCategory(plan.presets).length;
        const textCount = flattenCategory(plan.texts).length;
        const loraCount = flattenCategory(plan.loras).length;
        const ratioCount = flattenCategory(plan.ratios).length;
        const stats = [];
        if (charCount > 0)  stats.push(`<span title="角色 ${charCount}">👤${charCount}</span>`);
        if (artistCount > 0) stats.push(`<span title="画师 ${artistCount}">🎨${artistCount}</span>`);
        if (presetCount > 0) stats.push(`<span title="预设 ${presetCount}">⚙️${presetCount}</span>`);
        if (textCount > 0)   stats.push(`<span title="文本 ${textCount}">📝${textCount}</span>`);
        if (loraCount > 0)   stats.push(`<span title="LoRA ${loraCount}">🧬${loraCount}</span>`);
        if (ratioCount > 0)  stats.push(`<span title="比例 ${ratioCount}">📐${ratioCount}</span>`);
        // 高亮搜索匹配
        const displayName = planListFilter
            ? escapeHtml(name).replace(new RegExp(escapeRegex(planListFilter), 'gi'), m => `<mark style="background:${colors.accent}30;color:${colors.accent};padding:0 2px;border-radius:3px;">${m}</mark>`)
            : escapeHtml(name);
        return `
            <div class="random-plan-card ${isActive ? 'plan-active' : ''}" data-name="${escapeHtml(name)}" style="
                padding:14px 16px;margin-bottom:10px;border-radius:14px;
                border:1.5px solid ${isActive ? colors.accent : colors.border};
                background:${isActive ? colors.accent + '08' : colors.bgSoft};
                cursor:pointer;transition:all 0.15s;
            ">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                    <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                        ${isActive ? `<span style="width:20px;height:20px;border-radius:50%;background:${colors.accent};color:#fcfcfb;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;">✓</span>` : `<span style="width:20px;height:20px;border-radius:50%;border:2px solid ${colors.border};flex-shrink:0;"></span>`}
                        <div style="font-size:15px;font-weight:700;color:${isActive ? colors.accent : colors.text};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${displayName}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button class="plan-edit-btn" data-name="${escapeHtml(name)}" style="
                            width:34px;height:34px;border-radius:10px;border:none;
                            background:rgba(6, 182, 212, 0.1);color:${colors.accent};cursor:pointer;
                            display:flex;align-items:center;justify-content:center;padding:0;
                        " title="编辑">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                        </button>
                        <button class="plan-delete-btn" data-name="${escapeHtml(name)}" style="
                            width:34px;height:34px;border-radius:10px;border:none;
                            background:rgba(239,68,68,0.08);color:${colors.textSub};cursor:pointer;
                            display:flex;align-items:center;justify-content:center;padding:0;
                        " title="删除">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                        </button>
                    </div>
                </div>
                ${stats.length > 0 ? `<div style="font-size:12px;color:${colors.textSub};display:flex;gap:12px;">${stats.join('')}</div>` : ''}
            </div>`;
    }

    // 转义正则特殊字符
    function escapeRegex(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // 绑定方案列表事件
    function bindPlanListEvents(container) {
        container.querySelectorAll('.random-plan-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.plan-edit-btn') || e.target.closest('.plan-delete-btn')) return;
                const name = card.dataset.name;
                if (name === activePlanName) return;
                activePlanName = name;
                saveActivePlan();
                renderPlanList();
                if (triggerButton) updateTriggerButtonStyle(triggerButton);
                showToast('已选择方案: ' + name, 'success');
            });
        });
        container.querySelectorAll('.plan-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); openPlanEditor(btn.dataset.name); });
        });
        container.querySelectorAll('.plan-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); if (confirm('确定删除方案"' + btn.dataset.name + '"？')) deletePlan(btn.dataset.name); });
        });
    }

    // ─────────────────────────────────────
    //  ✨ AI 生成方案
    // ─────────────────────────────────────
    function openAIGenDialog() {
        const colors = getThemeColors();
        // 如果已有弹窗则移除
        const old = document.getElementById('random-ai-gen-dialog');
        if (old) old.remove();

        const dlg = document.createElement('div');
        dlg.id = 'random-ai-gen-dialog';
        dlg.style.cssText = `
            position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
            width:min(90vw,440px);background:${colors.bg};border-radius:18px;
            box-shadow:${colors.shadow};z-index:10010;padding:22px;color:${colors.text};
        `;
        dlg.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
                <div style="font-size:16px;font-weight:800;display:flex;align-items:center;gap:8px;">
                    <span style="color:${colors.accent};">✨</span> AI 生成方案
                </div>
                <button id="ai-gen-close" style="width:30px;height:30px;border-radius:10px;border:none;background:${colors.bgSoft};cursor:pointer;color:${colors.textSub};font-size:16px;">✕</button>
            </div>
            <div style="font-size:12px;color:${colors.textSub};margin-bottom:10px;line-height:1.5;">
                描述你想要的方案主题，AI 会自动填充角色、画师、预设。<br>
                <span style="opacity:0.7;">示例："原神女性角色立绘" / "赛博朋克风格场景" / "日系校园少女"</span>
            </div>
            <textarea id="ai-gen-input" placeholder="输入方案主题描述…" style="
                width:100%;height:80px;padding:10px 12px;border:1.5px solid ${colors.border};border-radius:12px;
                background:transparent;color:${colors.text};font-size:13px;outline:none;resize:none;font-family:inherit;box-sizing:border-box;
            "></textarea>
            <div id="ai-gen-error" style="display:none;color:${colors.danger};font-size:12px;margin-top:8px;"></div>
            <button id="ai-gen-submit" style="
                width:100%;margin-top:14px;padding:12px;border-radius:12px;border:none;cursor:pointer;
                background:${colors.accent};color:#fcfcfb;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;
            ">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5L19 9.5 13.5 11 12 16l-1.5-5L5 9.5 10.5 8z"/></svg>
                开始生成
            </button>
        `;
        document.body.appendChild(dlg);

        const close = () => dlg.remove();
        dlg.querySelector('#ai-gen-close').addEventListener('click', close);
        dlg.querySelector('#ai-gen-input').focus();

        // Enter 提交（Shift+Enter 换行）
        dlg.querySelector('#ai-gen-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                dlg.querySelector('#ai-gen-submit').click();
            }
        });

        dlg.querySelector('#ai-gen-submit').addEventListener('click', async () => {
            const desc = dlg.querySelector('#ai-gen-input').value.trim();
            const errEl = dlg.querySelector('#ai-gen-error');
            errEl.style.display = 'none';
            if (!desc) {
                errEl.textContent = '请输入方案描述';
                errEl.style.display = '';
                return;
            }
            // 检查 API Key 配置（通过 /api/smart-prompt/config 间接判断）
            const btn = dlg.querySelector('#ai-gen-submit');
            const oldHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="spin" style="animation:spin 0.8s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 生成中…`;

            try {
                const resp = await fetch('/api/random-plan/ai-generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description: desc })
                });
                const data = await resp.json();
                if (!data.success) {
                    throw new Error(data.error || '生成失败');
                }
                const plan = data.plan;
                // 生成成功：创建新方案并打开编辑器
                const baseName = plan.name || 'AI 方案';
                let uniqueName = baseName;
                let i = 1;
                while (plans[uniqueName]) {
                    uniqueName = `${baseName} (${i++})`;
                }
                // 构造符合 migratePlanData 的初始结构
                plans[uniqueName] = {
                    characters: { groups: [{ id: genId(), name: '默认', items: plan.characters || [], enabled: true, count: 1, mode: 'random', color: GROUP_COLORS[0] }] },
                    artists: { groups: [{ id: genId(), name: '默认', items: plan.artists || [], enabled: true, count: 1, mode: 'random', color: GROUP_COLORS[0] }] },
                    presets: { groups: [{ id: genId(), name: '默认', items: plan.presets || [], enabled: true, count: 1, mode: 'random', color: GROUP_COLORS[0] }] },
                    ratios: { groups: [] },
                    texts: { groups: [] },
                    loras: { groups: [] },
                    fixedPrompt: plan.fixedPrompt || '',
                    lastUsedAt: Date.now(),
                    useCount: 0
                };
                savePlans();
                activePlanName = uniqueName;
                saveActivePlan();
                renderPlanList();
                close();
                showToast(`✨ AI 已生成方案「${uniqueName}」`, 'success');
                // 打开编辑器让用户检查 / 调整
                openPlanEditor(uniqueName);
            } catch (err) {
                errEl.textContent = err.message || '生成失败，请检查 API Key 配置';
                errEl.style.display = '';
                btn.disabled = false;
                btn.innerHTML = oldHTML;
            }
        });

        // 点击遮罩关闭
        setTimeout(() => {
            dlg.addEventListener('click', (e) => {
                if (e.target === dlg) close();
            });
        }, 0);
    }

    // ─────────────────────────────────────────────
    //  打开方案编辑器
    // ─────────────────────────────────────────────
    function openPlanEditor(planName) {
        const isEdit = planName !== null;
        const rawPlan = isEdit ? plans[planName] : {};
        // 深拷贝 + 迁移
        const plan = JSON.parse(JSON.stringify(rawPlan));
        migratePlanData(plan);

        currentPlan = {
            name: isEdit ? planName : '',
            characters: plan.characters,
            artists: plan.artists,
            presets: plan.presets,
            ratios: plan.ratios || { groups: [] },
            texts: plan.texts || { groups: [] },
            loras: plan.loras || { groups: [] },
            fixedPrompt: plan.fixedPrompt || ''
        };

        document.getElementById('random-main-panel').style.display = 'none';
        const oldEditor = document.getElementById('random-plan-editor');
        if (oldEditor) oldEditor.remove();

        const editor = createPlanEditor(isEdit);
        document.body.appendChild(editor);
        editor.style.display = 'block';
    }

    // ─────────────────────────────────────────────
    //  创建方案编辑器
    // ─────────────────────────────────────────────
    function createPlanEditor(isEdit) {
        const colors = getThemeColors();
        const editor = document.createElement('div');
        editor.id = 'random-plan-editor';
        editor.style.cssText = `
            position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
            width:620px;max-height:85vh;background:${colors.bg};border-radius:16px;
            box-shadow:${colors.shadow};z-index:10001;display:none;overflow:hidden;color:${colors.text};
        `;

        editor.innerHTML = `
            <div style="padding:12px 20px;border-bottom:1px solid ${colors.border};display:flex;align-items:center;gap:8px;">
                <div style="flex:1;display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;background:${colors.bgSoft};border:1px solid ${colors.border};min-width:0;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:0.5;"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                    <input id="editor-plan-name" type="text" value="${escapeHtml(currentPlan.name)}" placeholder="输入方案名称" style="
                        flex:1;min-width:0;border:none;background:transparent;font-size:14px;font-weight:700;
                        color:${colors.text};outline:none;padding:0;
                    ">
                </div>
                <button id="editor-test" title="测试方案" style="padding:6px 14px;border-radius:8px;border:1px solid ${colors.accent};background:transparent;cursor:pointer;font-size:12px;font-weight:700;color:${colors.accent};display:flex;align-items:center;gap:5px;flex-shrink:0;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/></svg>
                    测试
                </button>
                <button id="editor-close" style="width:28px;height:28px;border-radius:8px;border:none;background:transparent;cursor:pointer;font-size:18px;color:${colors.textSub};flex-shrink:0;">✕</button>
            </div>
            <div style="padding:16px 20px;overflow-y:auto;max-height:68vh;">
                <div class="collapsible-section" style="margin-bottom:16px;">
                    <div class="section-toggle" style="
                        display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;padding:4px 0;
                    ">
                        <svg class="section-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transition:transform 0.2s;transform:rotate(-90deg);"><path d="m6 9 6 6 6-6"/></svg>
                        <span style="font-size:11px;font-weight:700;color:${colors.textSub};text-transform:uppercase;letter-spacing:0.05em;">📌 固定提示词</span>
                        <span style="font-size:10px;color:${colors.textSub};margin-left:2px;">每次生成保留，不被随机替换</span>
                    </div>
                    <div class="section-body" style="display:none;padding-top:8px;">
                        <textarea id="editor-fixed-prompt" placeholder="输入固定提示词，如: masterpiece, best quality" style="width:100%;padding:8px;border:1px solid ${colors.border};border-radius:8px;font-size:12px;background:transparent;color:${colors.text};outline:none;resize:none;min-height:52px;font-family:ui-monospace,Menlo,monospace;box-sizing:border-box;">${escapeHtml(currentPlan.fixedPrompt)}</textarea>
                    </div>
                </div>
                ${renderCategorySection('characters', '角色', '👤')}
                ${renderCategorySection('artists', '画师', '🎨')}
                ${renderCategorySection('presets', '预设', '⚙️')}
                ${renderCategorySection('texts', '文本', '📝')}
                ${renderCategorySection('loras', 'LoRA', '🧬')}
                ${renderCategorySection('ratios', '比例', '📐')}
            </div>
            <div style="padding:12px 20px;border-top:1px solid ${colors.border};display:flex;gap:8px;justify-content:flex-end;">
                <button id="editor-cancel" style="padding:10px 20px;border-radius:10px;border:1px solid ${colors.border};background:transparent;cursor:pointer;font-size:12px;font-weight:700;color:${colors.text};">取消</button>
                <button id="editor-save" style="padding:10px 20px;border-radius:10px;border:none;background:${colors.accent};cursor:pointer;font-size:12px;font-weight:700;color:#fcfcfb;">保存方案</button>
            </div>
        `;

        // 绑定事件
        editor.querySelector('#editor-close').addEventListener('click', () => { editor.remove(); document.getElementById('random-main-panel').style.display = 'block'; });
        editor.querySelector('#editor-cancel').addEventListener('click', () => { editor.remove(); document.getElementById('random-main-panel').style.display = 'block'; });
        editor.querySelector('#editor-save').addEventListener('click', () => savePlanFromEditor());
        editor.querySelector('#editor-test').addEventListener('click', () => testCurrentPlan());
        editor.querySelector('#editor-fixed-prompt').addEventListener('input', (e) => { currentPlan.fixedPrompt = e.target.value; });

        // 折叠展开
        editor.querySelector('.section-toggle').addEventListener('click', () => {
            const body = editor.querySelector('.section-body');
            const arrow = editor.querySelector('.section-arrow');
            const open = body.style.display === 'none';
            body.style.display = open ? 'block' : 'none';
            arrow.style.transform = open ? 'rotate(0deg)' : 'rotate(-90deg)';
        });

        // 绑定分组事件
        bindCategoryEvents(editor, 'characters');
        bindCategoryEvents(editor, 'artists');
        bindCategoryEvents(editor, 'presets');
        bindCategoryEvents(editor, 'texts');
        bindCategoryEvents(editor, 'loras');
        bindCategoryEvents(editor, 'ratios');

        return editor;
    }

    // ─────────────────────────────────────────────
    //  渲染一个大类（含分组）
    // ─────────────────────────────────────────────
    // 分组颜色预设
    const GROUP_COLORS = ['#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#6366f1','#06b6d4'];

    // 可选比例
    const RATIO_OPTIONS = ['1:1','4:3','3:4','16:9','9:16','3:2','2:3','21:9'];

    function renderCategorySection(planKey, label, icon) {
        const colors = getThemeColors();
        const cat = currentPlan[planKey];
        const groups = cat?.groups || [];

        let groupsHtml = '';
        groups.forEach((group, gIdx) => {
            groupsHtml += renderGroupCard(planKey, group, gIdx);
        });

        return `
            <div class="category-section" data-plan-key="${planKey}" style="margin-bottom:16px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                    <label style="font-size:12px;font-weight:700;color:${colors.textSub};">${icon} ${label}</label>
                    <button class="add-group-btn" data-plan-key="${planKey}" style="
                        padding:6px 14px;border-radius:10px;border:1.5px dashed ${colors.accent}60;
                        background:transparent;cursor:pointer;font-size:12px;font-weight:700;color:${colors.accent};
                        display:flex;align-items:center;gap:4px;
                    ">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                        新建分组
                    </button>
                </div>
                <div class="groups-container" data-plan-key="${planKey}" style="max-height:${3 * 50}px;overflow-y:auto;scrollbar-width:thin;">
                    ${groupsHtml}
                    ${groups.length === 0 ? `<div style="text-align:center;padding:16px;color:${colors.textSub};font-size:11px;">${planKey === 'texts' ? '点 + 新建分组后，再点 + 直接粘贴多行提示词（每行一条）' : planKey === 'loras' ? '点 + 新建分组后，再点 + 从 LoRA 选择器勾选' : '暂无分组，点击"+ 新建分组"创建'}</div>` : ''}
                </div>
            </div>`;
    }

    // 渲染单个分组（单行紧凑布局）
    function renderGroupCard(planKey, group, gIdx) {
        const colors = getThemeColors();
        const items = group.items || [];
        const enabled = group.enabled !== false;
        const count = group.count || 1;
        const gColor = group.color || GROUP_COLORS[gIdx % GROUP_COLORS.length];
        const mode = group.mode || 'random';

        return `
            <div class="group-card" data-plan-key="${planKey}" data-g-idx="${gIdx}" style="
                display:flex;align-items:center;gap:8px;padding:8px 10px;
                border-bottom:1px solid ${colors.border};min-height:48px;
            ">
                <span class="group-drag-handle" style="opacity:0.25;font-size:14px;cursor:grab;user-select:none;flex-shrink:0;">⠿</span>
                <div class="group-toggle" data-plan-key="${planKey}" data-g-idx="${gIdx}" style="
                    width:38px;height:22px;border-radius:11px;cursor:pointer;transition:all 0.2s;flex-shrink:0;
                    background:${enabled ? gColor : colors.border};position:relative;
                ">
                    <div style="position:absolute;top:2px;left:${enabled ? '18px' : '2px'};width:18px;height:18px;background:#fcfcfb;border-radius:50%;transition:all 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.15);"></div>
                </div>
                <div class="group-color-dot" data-plan-key="${planKey}" data-g-idx="${gIdx}" title="点击换色" style="
                    width:14px;height:14px;border-radius:50%;background:${gColor};cursor:pointer;flex-shrink:0;
                    box-shadow:0 0 0 2px ${gColor}30;
                "></div>
                <input class="group-name-input" data-plan-key="${planKey}" data-g-idx="${gIdx}" value="${escapeHtml(group.name)}" style="
                    width:52px;border:none;background:transparent;font-size:13px;font-weight:700;
                    color:${colors.text};outline:none;flex-shrink:0;padding:0;
                ">
                <span style="
                    padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;
                    background:${gColor}18;color:${enabled ? gColor : colors.textSub};flex-shrink:0;min-width:36px;text-align:center;
                ">${items.length}项</span>
                <button class="add-item-btn" data-plan-key="${planKey}" data-g-idx="${gIdx}" style="
                    width:36px;height:36px;border-radius:12px;border:none;
                    background:${gColor}15;cursor:pointer;flex-shrink:0;
                    display:flex;align-items:center;justify-content:center;padding:0;
                " title="添加">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${gColor}" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10" fill="${gColor}12"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                </button>
                <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;padding:0 2px;">
                    <span style="font-size:14px;color:${colors.textSub};font-weight:600;">×</span>
                    <input type="number" class="group-count-input" data-plan-key="${planKey}" data-g-idx="${gIdx}" value="${count}" min="1" max="10" style="
                        width:38px;height:32px;padding:0;border:1.5px solid ${colors.border};border-radius:10px;
                        font-size:14px;text-align:center;background:transparent;color:${colors.text};outline:none;font-weight:700;
                    ">
                </div>
                <button class="group-mode-btn" data-plan-key="${planKey}" data-g-idx="${gIdx}" title="${mode === 'sequential' ? '顺序模式：按列表顺序依次生成' : '随机模式：从列表中随机抽取'}" style="
                    width:32px;height:32px;border-radius:10px;border:none;
                    background:${mode === 'sequential' ? `${gColor}20` : `${gColor}10`};
                    cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:0;
                    transition:all 0.2s;
                ">
                    ${mode === 'sequential'
                        ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${gColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>`
                        : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${gColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`
                    }
                </button>
                <button class="delete-group-btn" data-plan-key="${planKey}" data-g-idx="${gIdx}" title="删除分组" style="
                    width:32px;height:32px;border-radius:10px;border:none;background:rgba(239,68,68,0.08);
                    cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;padding:0;
                ">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${colors.textSub}" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
            </div>`;
    }

    // ─────────────────────────────────────────────
    //  绑定分组相关事件
    // ─────────────────────────────────────────────
    function bindCategoryEvents(editor, planKey) {
        const section = editor.querySelector(`.category-section[data-plan-key="${planKey}"]`);
        if (!section) return;

        // 新建分组
        section.querySelector('.add-group-btn')?.addEventListener('click', () => {
            const cat = currentPlan[planKey];
            if (!cat.groups) cat.groups = [];
            cat.groups.push({ id: genId(), name: '新分组', items: [], enabled: true, count: 1, color: GROUP_COLORS[cat.groups.length % GROUP_COLORS.length], mode: 'random' });
            refreshCategory(editor, planKey);
        });

        bindGroupEvents(editor, planKey);
    }

    function bindGroupEvents(editor, planKey) {
        const section = editor.querySelector(`.category-section[data-plan-key="${planKey}"]`);
        if (!section) return;

        // 开关
        section.querySelectorAll('.group-toggle').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const gIdx = parseInt(el.dataset.gIdx);
                const group = currentPlan[planKey].groups[gIdx];
                group.enabled = !group.enabled;
                refreshCategory(editor, planKey);
            });
        });

        // 颜色切换
        section.querySelectorAll('.group-color-dot').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const gIdx = parseInt(el.dataset.gIdx);
                const group = currentPlan[planKey].groups[gIdx];
                const curIdx = GROUP_COLORS.indexOf(group.color);
                group.color = GROUP_COLORS[(curIdx + 1) % GROUP_COLORS.length];
                refreshCategory(editor, planKey);
            });
        });

        // 名称修改
        section.querySelectorAll('.group-name-input').forEach(el => {
            el.addEventListener('change', () => {
                const gIdx = parseInt(el.dataset.gIdx);
                currentPlan[planKey].groups[gIdx].name = el.value.trim() || '未命名';
            });
        });

        // count 修改
        section.querySelectorAll('.group-count-input').forEach(el => {
            el.addEventListener('change', () => {
                const gIdx = parseInt(el.dataset.gIdx);
                currentPlan[planKey].groups[gIdx].count = Math.max(1, parseInt(el.value) || 1);
            });
        });

        // 删除分组
        section.querySelectorAll('.delete-group-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const gIdx = parseInt(el.dataset.gIdx);
                const group = currentPlan[planKey].groups[gIdx];
                if (confirm(`确定删除分组"${group.name}"？`)) {
                    currentPlan[planKey].groups.splice(gIdx, 1);
                    refreshCategory(editor, planKey);
                }
            });
        });

        // 模式切换（随机 ↔ 顺序）
        section.querySelectorAll('.group-mode-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const gIdx = parseInt(el.dataset.gIdx);
                const group = currentPlan[planKey].groups[gIdx];
                group.mode = group.mode === 'sequential' ? 'random' : 'sequential';
                refreshCategory(editor, planKey);
            });
        });

        // 添加项目
        section.querySelectorAll('.add-item-btn').forEach(el => {
            el.addEventListener('click', () => {
                currentPickerGroupIdx = parseInt(el.dataset.gIdx);
                if (planKey === 'ratios') {
                    openRatioPicker(planKey, currentPickerGroupIdx);
                } else if (planKey === 'texts') {
                    openTextEditor(planKey, currentPickerGroupIdx);
                } else if (planKey === 'loras') {
                    openLoraPicker(planKey, currentPickerGroupIdx);
                } else {
                    currentPickerType = planKey === 'characters' ? 'character' : planKey === 'artists' ? 'artist' : 'preset';
                    openPickerForEditor(currentPickerType);
                }
            });
        });

        // 组间拖拽
        setupGroupDrag(section, planKey);
    }

    // ─────────────────────────────────────────────
    //  刷新单个大类区域
    // ─────────────────────────────────────────────
    function refreshCategory(editor, planKey) {
        const section = editor.querySelector(`.category-section[data-plan-key="${planKey}"]`);
        if (!section) return;
        const labels = { characters: ['角色', '👤'], artists: ['画师', '🎨'], presets: ['预设', '⚙️'], ratios: ['比例', '📐'], texts: ['文本', '📝'] };
        const [label, icon] = labels[planKey] || ['', ''];
        const cat = currentPlan[planKey];
        const groups = cat?.groups || [];

        let groupsHtml = '';
        groups.forEach((group, gIdx) => {
            groupsHtml += renderGroupCard(planKey, group, gIdx);
        });

        const container = section.querySelector('.groups-container');
        container.innerHTML = groupsHtml || `<div style="text-align:center;padding:20px;color:${getThemeColors().textSub};font-size:11px;">暂无分组，点击"+ 新建分组"创建</div>`;

        // 注："新建分组"按钮的 click 已在 bindCategoryEvents 里通过 addEventListener 绑定
        //     （createPlanEditor 时绑 1 次，DOM 元素不变，listener 持续有效）
        //     这里不重复设置 onclick，避免双触发 → 一次点击 +2 个分组的 bug

        bindGroupEvents(editor, planKey);
    }

    // ─────────────────────────────────────────────
    //  组间拖拽（分组卡片排序）— 使用 AbortController 避免重复绑定
    // ─────────────────────────────────────────────
    let groupDragController = null;
    function setupGroupDrag(section, planKey) {
        const container = section.querySelector('.groups-container');
        if (!container) return;
        // 清除上一次的事件监听
        if (groupDragController) groupDragController.abort();
        groupDragController = new AbortController();
        const signal = groupDragController.signal;
        let dragIdx = null;

        container.addEventListener('dragstart', (e) => {
            const handle = e.target.closest('.group-drag-handle');
            if (!handle) { e.preventDefault(); return; }
            const card = handle.closest('.group-card');
            if (!card) return;
            dragIdx = parseInt(card.dataset.gIdx);
            card.style.opacity = '0.4';
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'group');
        }, { signal });

        container.addEventListener('dragend', (e) => {
            const card = e.target.closest('.group-card');
            if (card) card.style.opacity = '1';
            container.querySelectorAll('.group-card').forEach(el => { el.style.borderTop = ''; });
            dragIdx = null;
        }, { signal });

        container.addEventListener('dragover', (e) => {
            if (e.dataTransfer.getData('text/plain') !== 'group') return;
            e.preventDefault();
            const card = e.target.closest('.group-card');
            if (!card) return;
            container.querySelectorAll('.group-card').forEach(el => { el.style.borderTop = ''; });
            const rect = card.getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) {
                card.style.borderTop = '2px solid ' + getThemeColors().accent;
            }
        }, { signal });

        container.addEventListener('drop', (e) => {
            if (e.dataTransfer.getData('text/plain') !== 'group') return;
            e.preventDefault();
            const card = e.target.closest('.group-card');
            if (!card || dragIdx === null) return;
            const targetIdx = parseInt(card.dataset.gIdx);
            if (dragIdx === targetIdx) return;

            const groups = currentPlan[planKey].groups;
            const [moved] = groups.splice(dragIdx, 1);
            const rect = card.getBoundingClientRect();
            let insertIdx = e.clientY < rect.top + rect.height / 2 ? targetIdx : targetIdx + 1;
            if (dragIdx < targetIdx) insertIdx--;
            groups.splice(insertIdx, 0, moved);

            refreshCategory(document.getElementById('random-plan-editor'), planKey);
        }, { signal });
    }

    // ─────────────────────────────────────────────
    //  组内拖拽（项目排序）
    // ─────────────────────────────────────────────
    function setupItemDrag(container, planKey) {
        let dragIdx = null;
        let dragGIdx = null;

        container.addEventListener('dragstart', (e) => {
            const item = e.target.closest('.sortable-item');
            if (!item) return;
            dragIdx = parseInt(item.dataset.iIdx);
            dragGIdx = parseInt(item.dataset.gIdx);
            item.style.opacity = '0.4';
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'item');
        });

        container.addEventListener('dragend', (e) => {
            const item = e.target.closest('.sortable-item');
            if (item) item.style.opacity = '1';
            container.querySelectorAll('.sortable-item').forEach(el => { el.style.borderLeft = ''; el.style.borderRight = ''; });
            dragIdx = null;
            dragGIdx = null;
        });

        container.addEventListener('dragover', (e) => {
            if (e.dataTransfer.getData('text/plain') !== 'item') return;
            e.preventDefault();
            const target = e.target.closest('.sortable-item');
            if (!target) return;
            container.querySelectorAll('.sortable-item').forEach(el => { el.style.borderLeft = ''; el.style.borderRight = ''; });
            const rect = target.getBoundingClientRect();
            if (e.clientX < rect.left + rect.width / 2) {
                target.style.borderLeft = '2px solid ' + getThemeColors().accent;
            } else {
                target.style.borderRight = '2px solid ' + getThemeColors().accent;
            }
        });

        container.addEventListener('drop', (e) => {
            if (e.dataTransfer.getData('text/plain') !== 'item') return;
            e.preventDefault();
            const target = e.target.closest('.sortable-item');
            if (!target || dragIdx === null) return;
            const targetIdx = parseInt(target.dataset.iIdx);
            if (dragIdx === targetIdx && dragGIdx === parseInt(target.dataset.gIdx)) return;

            const arr = currentPlan[planKey].groups[dragGIdx].items;
            const [moved] = arr.splice(dragIdx, 1);
            const rect = target.getBoundingClientRect();
            let insertIdx = e.clientX < rect.left + rect.width / 2 ? targetIdx : targetIdx + 1;
            if (dragIdx < targetIdx) insertIdx--;
            arr.splice(insertIdx, 0, moved);

            refreshCategory(document.getElementById('random-plan-editor'), planKey);
        });
    }

    // ─────────────────────────────────────────────
    //  选择器集成
    // ─────────────────────────────────────────────
    let currentPickerType = null;
    let currentPickerGroupIdx = null;
    let editorPanel = null;
    let lastPickerOrigPrompt = '';   // 打开 picker 前保存的 prompt，callback 里恢复（picker 可能直接改 prompt）

    function hideEditorPanel() {
        editorPanel = document.getElementById('random-plan-editor');
        if (editorPanel) editorPanel.style.display = 'none';
    }
    function showEditorPanel() {
        if (editorPanel) { editorPanel.style.display = 'block'; editorPanel = null; }
    }

    // === 比例选择器（checkbox 弹窗）===
    function openRatioPicker(planKey, gIdx) {
        const colors = getThemeColors();
        const group = currentPlan[planKey].groups[gIdx];
        const selected = new Set(group.items || []);

        hideEditorPanel();

        const modal = document.createElement('div');
        modal.style.cssText = `
            position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
            width:min(90vw,360px);background:${colors.bg};border-radius:16px;
            box-shadow:${colors.shadow};z-index:10002;overflow:hidden;color:${colors.text};
        `;

        const renderOptions = () => {
            modal.innerHTML = `
                <div style="padding:16px 20px;border-bottom:1px solid ${colors.border};display:flex;align-items:center;justify-content:space-between;">
                    <div style="font-size:15px;font-weight:700;">选择比例</div>
                    <button id="ratio-picker-close" style="width:32px;height:32px;border-radius:10px;border:none;background:${colors.bgSoft};cursor:pointer;font-size:16px;color:${colors.textSub};display:flex;align-items:center;justify-content:center;">✕</button>
                </div>
                <div style="padding:16px 20px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    ${RATIO_OPTIONS.map(r => {
                        const active = selected.has(r);
                        const [w, h] = r.split(':').map(Number);
                        const isVertical = h > w;
                        const boxW = isVertical ? 16 : 24;
                        const boxH = isVertical ? 24 : 16;
                        return `
                            <div class="ratio-option" data-ratio="${r}" style="
                                display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;
                                border:1.5px solid ${active ? colors.accent : colors.border};
                                background:${active ? colors.accent + '10' : 'transparent'};cursor:pointer;
                            ">
                                <div style="width:${boxW}px;height:${boxH}px;border:2px solid ${active ? colors.accent : colors.textSub};border-radius:3px;flex-shrink:0;"></div>
                                <span style="font-size:14px;font-weight:700;color:${active ? colors.accent : colors.text};">${r}</span>
                            </div>`;
                    }).join('')}
                </div>
                <div style="padding:12px 20px;border-top:1px solid ${colors.border};display:flex;justify-content:flex-end;">
                    <button id="ratio-picker-confirm" style="
                        padding:10px 24px;border-radius:10px;border:none;
                        background:${colors.accent};color:#fcfcfb;cursor:pointer;font-size:13px;font-weight:700;
                    ">确认</button>
                </div>
            `;

            modal.querySelectorAll('.ratio-option').forEach(el => {
                el.addEventListener('click', () => {
                    const r = el.dataset.ratio;
                    if (selected.has(r)) selected.delete(r); else selected.add(r);
                    renderOptions();
                });
            });

            modal.querySelector('#ratio-picker-close').addEventListener('click', () => {
                modal.remove(); showEditorPanel();
            });
            modal.querySelector('#ratio-picker-confirm').addEventListener('click', () => {
                group.items = [...selected];
                modal.remove();
                showEditorPanel();
                refreshCategory(document.getElementById('random-plan-editor'), planKey);
            });
        };

        document.body.appendChild(modal);
        renderOptions();
    }

    // === 文本编辑器（多行 textarea，每行一条）===
    function openTextEditor(planKey, gIdx) {
        const colors = getThemeColors();
        const group = currentPlan[planKey].groups[gIdx];
        const existing = (group.items || []).join('\n');

        hideEditorPanel();

        const modal = document.createElement('div');
        modal.style.cssText = `
            position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
            width:min(92vw,560px);max-height:86vh;background:${colors.bg};border-radius:16px;
            box-shadow:${colors.shadow};z-index:10002;overflow:hidden;color:${colors.text};
            display:flex;flex-direction:column;
        `;

        modal.innerHTML = `
            <div style="padding:14px 20px;border-bottom:1px solid ${colors.border};display:flex;align-items:center;gap:10px;flex-shrink:0;">
                <div style="font-size:15px;font-weight:700;flex:1;">📝 编辑文本提示词</div>
                <button id="text-edit-close" style="width:32px;height:32px;border-radius:10px;border:none;background:${colors.bgSoft};cursor:pointer;font-size:16px;color:${colors.textSub};display:flex;align-items:center;justify-content:center;">✕</button>
            </div>
            <div style="padding:12px 20px;flex:1;display:flex;flex-direction:column;gap:8px;min-height:0;">
                <div style="font-size:11px;color:${colors.textSub};line-height:1.6;">
                    💡 每行一条提示词。生成时从本组随机抽 <b>${group.count || 1}</b> 条（可调"× N"），自动拼到正向提示词末尾。<br>
                    支持空行和 <code># 注释</code>；支持 <code>__通配符名__</code>、<code>{a|b|c}</code>、<code>[可选词]</code> 语法（来自通配符引擎）。
                </div>
                <textarea id="text-edit-area" placeholder="例如：&#10;school uniform&#10;kimono&#10;gothic lolita dress&#10;# 也可以加注释&#10;{red|blue|green} hair" style="
                    flex:1;min-height:240px;padding:12px;border:1px solid ${colors.border};border-radius:10px;
                    font-size:13px;background:${colors.bgSoft};color:${colors.text};outline:none;resize:none;
                    font-family:ui-monospace,Menlo,monospace;line-height:1.6;box-sizing:border-box;
                ">${escapeHtml(existing)}</textarea>
                <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:${colors.textSub};">
                    <span id="text-edit-count">0 条</span>
                    <button id="text-edit-clear" style="background:none;border:none;color:${colors.textSub};cursor:pointer;font-size:11px;text-decoration:underline;">清空</button>
                </div>
            </div>
            <div style="padding:12px 20px;border-top:1px solid ${colors.border};display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;">
                <button id="text-edit-cancel" style="padding:9px 20px;border-radius:10px;border:1px solid ${colors.border};background:transparent;cursor:pointer;font-size:12px;font-weight:700;color:${colors.text};">取消</button>
                <button id="text-edit-confirm" style="padding:9px 24px;border-radius:10px;border:none;background:${colors.accent};color:#fcfcfb;cursor:pointer;font-size:12px;font-weight:700;">保存</button>
            </div>
        `;

        document.body.appendChild(modal);
        const textarea = modal.querySelector('#text-edit-area');
        const counter = modal.querySelector('#text-edit-count');
        textarea.focus();
        const updateCount = () => {
            const lines = parseTextLines(textarea.value);
            counter.textContent = lines.length + ' 条';
        };
        textarea.addEventListener('input', updateCount);
        updateCount();

        const closeAndResume = () => { modal.remove(); showEditorPanel(); };
        const confirmAndSave = () => {
            const lines = parseTextLines(textarea.value);
            group.items = lines;
            closeAndResume();
            refreshCategory(document.getElementById('random-plan-editor'), planKey);
            if (lines.length === 0) showToast('已清空该分组文本', 'info');
            else showToast(`已保存 ${lines.length} 条文本`, 'success');
        };

        modal.querySelector('#text-edit-close').addEventListener('click', closeAndResume);
        modal.querySelector('#text-edit-cancel').addEventListener('click', closeAndResume);
        modal.querySelector('#text-edit-confirm').addEventListener('click', confirmAndSave);
        modal.querySelector('#text-edit-clear').addEventListener('click', () => { textarea.value = ''; updateCount(); textarea.focus(); });
        textarea.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + Enter 快速保存
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); confirmAndSave(); }
            // Esc 关闭
            if (e.key === 'Escape') { e.preventDefault(); closeAndResume(); }
        });
    }

    // 解析多行文本为非空、非纯注释条目数组
    function parseTextLines(text) {
        return (text || '')
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map(s => s.trim())
            .filter(s => s && !s.startsWith('#'));
    }

    // === LoRA 选择器（复用 lora-picker.js）===
    //  方案分组里 items 存的是 LoRA 名称数组（字符串）。
    //  打开前临时把已选项注入到 loraState.active，关闭后回写覆盖整组。
    function openLoraPicker(planKey, gIdx) {
        if (typeof loraPickerOpen !== 'function') {
            alert('LoRA 选择器未加载');
            return;
        }
        const group = currentPlan[planKey].groups[gIdx];
        hideEditorPanel();

        // 备份 loraState.active，注入当前组已选项
        // 重要：loraState 是 zimage.html 顶层 let，不挂在 window 上
        const hasState = typeof loraState !== 'undefined' && loraState;
        const origActive = (hasState && Array.isArray(loraState.active))
            ? loraState.active.map(l => ({ ...l })) : [];
        if (hasState) {
            // 注入时去重：group.items 可能历史脏数据有重复，去重后 loraState.active 干净
            // → loraPickerOpen 从 active 复制时也不会重复 → callback 收到的 selected 也不重复
            // 强度回填：从 g.items 的对象里读 strength（默认 1），保证 picker 顶部已选条显示正确强度
            const seen = new Set();
            const dedupItems = [];
            (group.items || []).forEach(item => {
                const name = typeof item === 'string' ? item : (item && item.name ? item.name : '');
                if (!name) return;
                const key = name.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                dedupItems.push(item);
            });
            loraState.active = dedupItems.map(item => {
                const name = typeof item === 'string' ? item : item.name;
                const strength = (typeof item === 'object' && item && typeof item.strength === 'number')
                    ? item.strength : 1;
                return { name, strength };
            });
        }

        try {
            loraPickerOpen(function(selected) {
                // 选中后：把 [{name, strength, ...}] 回写到 group.items（保留 strength 供 applyRandomLoras 使用）
                if (Array.isArray(selected) && currentPlan && currentPickerGroupIdx !== null) {
                    const g = currentPlan[planKey].groups[currentPickerGroupIdx];
                    const seen = new Set();
                    g.items = selected.map(s => {
                        if (typeof s === 'string') return { name: s, strength: 1 };
                        if (s && s.name) {
                            return { name: s.name, strength: (typeof s.strength === 'number') ? s.strength : 1 };
                        }
                        return null;
                    }).filter(Boolean).filter(it => {
                        const k = it.name.toLowerCase();
                        if (seen.has(k)) return false;
                        seen.add(k);
                        return true;
                    });
                }
                // 恢复 loraState.active（避免污染主界面）
                if (hasState) {
                    loraState.active = origActive;
                    if (typeof _loraSyncTriggerWords === 'function') {
                        try { _loraSyncTriggerWords(origActive); } catch (e) { /* 忽略 */ }
                    }
                    if (typeof saveLoraConfig === 'function') { try { saveLoraConfig(); } catch (e) {} }
                    if (typeof updateLoraSwitcherVisibility === 'function') { try { updateLoraSwitcherVisibility(); } catch (e) {} }
                }
                showEditorPanel();
                refreshCategory(document.getElementById('random-plan-editor'), planKey);
                currentPickerType = null; currentPickerGroupIdx = null;
            });
        } catch (e) {
            console.error('[RandomPrompt] 打开 LoRA 选择器失败:', e);
            if (hasState) loraState.active = origActive;
            showEditorPanel();
            showToast('打开 LoRA 选择器失败: ' + e.message, 'error');
        }
    }

    function openPickerForEditor(type) {
        currentPickerType = type;
        hideEditorPanel();

        // 保存原始 prompt，注入当前组的项目让选择器识别为已选
        const promptEl = document.getElementById('prompt');
        lastPickerOrigPrompt = promptEl ? promptEl.value : '';

        if (promptEl && currentPickerGroupIdx !== null) {
            const planKey = type === 'character' ? 'characters' : type === 'artist' ? 'artists' : 'presets';
            const group = currentPlan[planKey]?.groups[currentPickerGroupIdx];
            if (group) {
                if (group.items.length > 0) {
                    // 有已选项：注入到 prompt 让 picker 打开时自动勾选
                    // 先去掉 prompt 中该类型的已有匹配项，避免 picker 解析时出现重复 token
                    let existing = lastPickerOrigPrompt.split(',').map(p => p.trim()).filter(p => p);
                    if (type === 'character' && typeof window.ANIMA_CHAR_DB !== 'undefined' && Array.isArray(window.ANIMA_CHAR_DB) && window.ANIMA_CHAR_DB.length > 0) {
                        const nameSet = new Set(window.ANIMA_CHAR_DB.map(c => (c.name || '').toLowerCase()).filter(Boolean));
                        const triggerSet = new Set();
                        window.ANIMA_CHAR_DB.forEach(c => {
                            if (Array.isArray(c.triggers)) c.triggers.forEach(t => triggerSet.add(String(t).toLowerCase()));
                            else if (typeof c.trigger === 'string') triggerSet.add(c.trigger.toLowerCase());
                        });
                        existing = existing.filter(p => {
                            if (p.startsWith('@') || p.startsWith('by ')) return false;
                            const pl = p.toLowerCase();
                            return !(nameSet.has(pl) || triggerSet.has(pl));
                        });
                    } else if (type === 'artist' && typeof window.ANIMA_ARTIST_DB !== 'undefined' && Array.isArray(window.ANIMA_ARTIST_DB) && window.ANIMA_ARTIST_DB.length > 0) {
                        const nameSet = new Set(window.ANIMA_ARTIST_DB.map(a => {
                            const n = a.name || a.danbooru_tag || '';
                            return n.replace(/^@/, '').toLowerCase();
                        }).filter(Boolean));
                        existing = existing.filter(p => {
                            if (!(p.startsWith('@') || p.startsWith('by '))) return false;
                            return !nameSet.has(p.replace(/^@/, '').toLowerCase());
                        });
                    } else if (type === 'preset' && typeof window.ANIMA_PRESET_DB !== 'undefined' && Array.isArray(window.ANIMA_PRESET_DB) && window.ANIMA_PRESET_DB.length > 0) {
                        const nameSet = new Set(window.ANIMA_PRESET_DB.map(p => (p.name || '').toLowerCase()).filter(Boolean));
                        existing = existing.filter(p => !nameSet.has(p.toLowerCase()));
                    }
                    // 注入 group.items
                    const uniqInj = [];
                    const seenInj = new Set();
                    group.items.forEach(t => {
                        const tl = String(t).toLowerCase();
                        if (!seenInj.has(tl)) { seenInj.add(tl); uniqInj.push(t); }
                    });
                    let injection = uniqInj.join(', ');
                    if (type === 'artist') injection = uniqInj.map(i => '@' + i).join(', ');
                    promptEl.value = existing.length > 0 ? existing.join(', ') + ', ' + injection : injection;
                } else {
                    // 新分组（items 为空）：清空 prompt，让 picker 从零开始选择
                    // pickerCallback 关闭后会通过 lastPickerOrigPrompt 恢复原始值
                    promptEl.value = '';
                }
            }
        }

        // 三个 picker 统一传 callback（让 picker 关闭时把 selectedItems 交回，由 callback 写 group.items + 恢复 prompt）
        //   - 确认：用 picker 自带 × / 关闭并应用 按钮 = 接受当前选择
        //   - 放弃：关闭方案编辑器（右上角 × / 底部"取消"）= 未保存即放弃
        if (type === 'character' && typeof pickerOpen === 'function') {
            pickerOpen(pickerCallback);
        } else if (type === 'artist' && typeof artistPickerOpen === 'function') {
            artistPickerOpen(pickerCallback);
        } else if (type === 'preset' && typeof presetPickerOpen === 'function') {
            presetPickerOpen(pickerCallback);
        } else {
            // picker 未加载，恢复 prompt + 显示编辑器
            if (promptEl) promptEl.value = lastPickerOrigPrompt;
            showEditorPanel();
            currentPickerType = null; currentPickerGroupIdx = null;
            alert('选择器未加载');
        }
    }

    // picker 关闭统一 callback（character / artist / preset）
    function pickerCallback(selectedItems) {
        const promptEl = document.getElementById('prompt');
        if (promptEl) promptEl.value = lastPickerOrigPrompt;  // 恢复（picker 内部可能改过 prompt）
        showEditorPanel();

        if (currentPlan && currentPickerGroupIdx !== null && Array.isArray(selectedItems)) {
            const planKey = currentPickerType === 'character' ? 'characters'
                          : currentPickerType === 'artist' ? 'artists'
                          : 'presets';
            const group = currentPlan[planKey]?.groups[currentPickerGroupIdx];
            if (group) {
                group.items = []; // 覆盖：picker 返回的就是完整选中列表
                const seen = new Set();

                if (currentPickerType === 'character') {
                    // 角色：trigger 词 / name → 统一转成 DB 的 name（后端按 name 匹配）
                    const db = (typeof window.ANIMA_CHAR_DB !== 'undefined' && Array.isArray(window.ANIMA_CHAR_DB)) ? window.ANIMA_CHAR_DB : [];
                    selectedItems.forEach(item => {
                        const token = typeof item === 'string' ? item : item.name || item.id;
                        if (!token) return;
                        const tl = token.toLowerCase();
                        const found = db.find(c => {
                            if ((c.name || '').toLowerCase() === tl) return true;
                            if (Array.isArray(c.triggers) && c.triggers.some(t => String(t).toLowerCase() === tl)) return true;
                            if (typeof c.trigger === 'string' && c.trigger.toLowerCase() === tl) return true;
                            return false;
                        });
                        const finalName = found && found.name ? found.name : token;
                        if (seen.has(finalName.toLowerCase())) return;
                        seen.add(finalName.toLowerCase());
                        group.items.push(finalName);
                    });
                } else if (currentPickerType === 'artist') {
                    // 画师：去 @ 前缀，按小写去重
                    selectedItems.forEach(item => {
                        const name = (typeof item === 'string' ? item : item.name || item.danbooru_tag || '').replace(/^@/, '');
                        if (!name) return;
                        if (seen.has(name.toLowerCase())) return;
                        seen.add(name.toLowerCase());
                        group.items.push(name);
                    });
                } else if (currentPickerType === 'preset') {
                    // 预设:优先 name_key(category_id::id 跨文件唯一),向下兼容 name / id
                    selectedItems.forEach(item => {
                        const key = item.name_key || item.name || item.id || '';
                        if (!key) return;
                        if (seen.has(key.toLowerCase())) return;
                        seen.add(key.toLowerCase());
                        group.items.push(key);
                    });
                }
            }
            refreshCategory(document.getElementById('random-plan-editor'), planKey);
        }
        currentPickerType = null; currentPickerGroupIdx = null;
    }

    // ─────────────────────────────────────────────
    //  保存方案
    // ─────────────────────────────────────────────
    function savePlanFromEditor() {
        const editor = document.getElementById('random-plan-editor');
        if (!editor || !currentPlan) return;

        const name = editor.querySelector('#editor-plan-name').value.trim();
        if (!name) { alert('请输入方案名称'); return; }

        const hasItems = ['characters', 'artists', 'presets', 'ratios', 'texts', 'loras'].some(k => flattenCategory(currentPlan[k]).length > 0);
        if (!hasItems) { alert('请至少在一个分组中添加项目'); return; }

        plans[name] = {
            name,
            characters: currentPlan.characters,
            artists: currentPlan.artists,
            presets: currentPlan.presets,
            ratios: currentPlan.ratios,
            texts: currentPlan.texts,
            loras: currentPlan.loras,
            fixedPrompt: currentPlan.fixedPrompt || ''
        };

        savePlans();
        editor.remove();
        document.getElementById('random-main-panel').style.display = 'block';
        renderPlanList();
        currentPlan = null;
    }

    function deletePlan(name) {
        // 清除该方案的顺序状态
        Object.keys(sequentialState).forEach(k => {
            if (k.startsWith(name + '_')) delete sequentialState[k];
        });
        saveSequentialState();

        delete plans[name];
        if (activePlanName === name) {
            const planNames = Object.keys(plans);
            activePlanName = planNames.length > 0 ? planNames[0] : '';
            saveActivePlan();
        }
        savePlans();
        renderPlanList();
    }

    // ─────────────────────────────────────────────
    //  分组抽样 + 提示词构建
    // ─────────────────────────────────────────────
    function sampleFromGroups(cat, planName, planKey) {
        if (!cat || !cat.groups) return [];
        const result = [];
        cat.groups.forEach(group => {
            if (group.enabled === false) return;
            if (!group.items || group.items.length === 0) return;
            const count = Math.min(group.count || 1, group.items.length);
            const mode = group.mode || 'random';
            
            if (mode === 'sequential' && planName && planKey && group.id) {
                // 顺序模式：从上次位置依次取 count 个
                const startPos = getSeqPosition(planName, planKey, group.id);
                for (let i = 0; i < count; i++) {
                    const idx = (startPos + i) % group.items.length;
                    result.push(group.items[idx]);
                }
                updateSeqPosition(planName, planKey, group.id, count, group.items.length);
            } else {
                // 随机模式：随机洗牌取 count 个
                const shuffled = [...group.items].sort(() => Math.random() - 0.5);
                result.push(...shuffled.slice(0, count));
            }
        });
        return result;
    }

    function mergeWithFixed(positive, fixedPrompt) {
        if (!fixedPrompt || !fixedPrompt.trim()) return positive;
        const parts = [...fixedPrompt.trim().split(',').map(s => s.trim()), ...positive.trim().split(',').map(s => s.trim())];
        const seen = new Set();
        return parts.filter(p => { if (!p) return false; const l = p.toLowerCase(); if (seen.has(l)) return false; seen.add(l); return true; }).join(', ');
    }

    // 从比例分组中随机选一个并应用
    function applyRandomRatio(ratios, planName) {
        if (!ratios?.groups) return;
        const sampled = sampleFromGroups(ratios, planName, 'ratios');
        if (sampled.length === 0) { console.log('[RandomPrompt] 比例分组无样本'); return; }
        const picked = sampled[Math.floor(Math.random() * sampled.length)];
        const [w, h] = picked.split(':').map(Number);
        if (!w || !h) { console.warn('[RandomPrompt] 比例解析失败:', picked); return; }
        // 应用到全局变量（与 loraState 一样：animaRatioW/H 是顶层 let，不挂 window）
        try {
            if (typeof selectRatio === 'function') {
                console.log('[RandomPrompt] 比例 → selectRatio', picked, w, h);
                selectRatio(picked, w, h);
            } else if (typeof animaRatioW !== 'undefined') {
                console.log('[RandomPrompt] 比例 → 直接赋值', picked, w, h);
                animaRatioW = w;
                animaRatioH = h;
                try { localStorage.setItem('anima_ratio_w', w); } catch (e) {}
                try { localStorage.setItem('anima_ratio_h', h); } catch (e) {}
                const ratioTextEl = document.getElementById('ratioText');
                if (ratioTextEl) ratioTextEl.textContent = picked;
            } else {
                console.warn('[RandomPrompt] animaRatioW / selectRatio 都不可用，比例未应用');
            }
        } catch (e) { console.warn('[RandomPrompt] 应用比例失败:', e); }
    }

    // 从 LoRA 分组中抽样，写到 loraState.active；触发词自动同步到 prompt
    function applyRandomLoras(loras, planName) {
        if (!loras?.groups) return;
        const sampled = sampleFromGroups(loras, planName, 'loras');
        if (sampled.length === 0) return;
        // 重要：loraState 是 zimage.html 顶层 let，不挂在 window 上，必须用裸引用 + typeof 守卫
        if (typeof loraState === 'undefined' || !loraState) {
            console.warn('[RandomPrompt] loraState 未初始化，跳过 LoRA 应用');
            return;
        }
        // 解析 g.items 为 {name, strength}：兼容旧字符串 + 新对象
        // 强度：① 优先 g.items 里存的（用户在 LoRA 选择器里调的）
        //      ② 否则沿用 loraState.active 同名 LoRA 的 strength
        //      ③ 否则默认 1
        const prevMap = new Map((loraState.active || []).map(l => [l.name, l.strength]));
        const nextActive = sampled.map(item => {
            const name = typeof item === 'string' ? item : (item && item.name ? item.name : '');
            let strength;
            if (typeof item === 'object' && item && typeof item.strength === 'number') {
                strength = item.strength;            // ① 用户在 picker 里设的
            } else if (prevMap.has(name)) {
                strength = prevMap.get(name);         // ② 主界面残留
            } else {
                strength = 1;                         // ③ 默认
            }
            return { name, strength };
        });
        loraState.active = nextActive;
        try {
            if (typeof _loraSyncTriggerWords === 'function') _loraSyncTriggerWords(nextActive);
            if (typeof saveLoraConfig === 'function') saveLoraConfig();
            if (typeof updateLoraSwitcherVisibility === 'function') updateLoraSwitcherVisibility();
        } catch (e) { console.warn('[RandomPrompt] LoRA 同步失败:', e); }
    }

    // 对单个大类调用 API
    // 从各组本地抽样，然后调 API 查元数据
    async function fetchCategoryFromAPI(catKey, cat, planName) {
        if (!cat?.groups) return null;

        // 每组独立抽样（支持 random / sequential 两种模式）
        const sampledNames = sampleFromGroups(cat, planName, catKey);
        if (sampledNames.length === 0) return null;

        // 一次性交给 API 查元数据（触发词/danbooru_tag/预设文本）
        const config = {};
        config[catKey] = { enabled: true, names: sampledNames, count: sampledNames.length };
        config.lora = { enabled: false };
        if (catKey !== 'character') config.character = { enabled: false, names: [], count: 1 };
        if (catKey !== 'artist') config.artist = { enabled: false, names: [], count: 1 };
        if (catKey !== 'preset') config.preset = { enabled: false, names: [], count: 1 };

        const res = await fetch(`${API_BASE}/apply-plan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (window.AUTH_TOKEN || '') },
            body: JSON.stringify(config)
        });
        return res.json();
    }

    function buildPromptFromResult(result) {
        const parts = [];
        if (result.character) {
            const chars = Array.isArray(result.character) ? result.character : [result.character];
            chars.forEach(c => {
                if (c.trigger) parts.push(c.trigger);
                else if (c.name) parts.push(c.name);
            });
        }
        if (result.artist) {
            const artists = Array.isArray(result.artist) ? result.artist : [result.artist];
            artists.forEach(a => { if (a.danbooru_tag) parts.push(a.danbooru_tag); });
        }
        if (result.preset) {
            const presets = Array.isArray(result.preset) ? result.preset : [result.preset];
            presets.forEach(p => { if (p.prompt) parts.push(p.prompt); });
        }
        return parts.join(', ');
    }

    async function applyPlan(name) {
        const plan = plans[name];
        if (!plan) return;
        migratePlanData(plan);

        try {
            const parts = [];
            for (const [catKey, apiKey] of [['characters', 'character'], ['artists', 'artist'], ['presets', 'preset']]) {
                const result = await fetchCategoryFromAPI(apiKey, plan[catKey], name);
                if (result) parts.push(buildPromptFromResult(result));
            }
            // 文本类（本地抽样，每行一条，不走 API）
            const textParts = sampleFromGroups(plan.texts, name, 'texts');
            textParts.forEach(t => { if (t) parts.push(t); });
            let positive = parts.filter(Boolean).join(', ');
            positive = mergeWithFixed(positive, plan.fixedPrompt);

            // 比例
            applyRandomRatio(plan.ratios, name);

            // 先把 positive 抛给 onApplyCallback，外部会把它写入 prompt 框
            if (onApplyCallback) onApplyCallback({ positive, negative: '', raw: {} });

            // LoRA：必须等 prompt 框被新 positive 覆盖之后再调，
            // 否则 _loraSyncTriggerWords 会基于旧 prompt 拼触发词，被新 positive 覆盖
            applyRandomLoras(plan.loras, name);

            document.getElementById('random-main-panel').style.display = 'none';
            showToast('已应用方案: ' + name, 'success');
        } catch (e) {
            console.error('[RandomPrompt] 应用方案失败:', e);
            showToast('应用失败: ' + e.message, 'error');
        }
    }

    async function quickRandom() {
        const planNames = Object.keys(plans);
        if (planNames.length === 0) { alert('请先创建一个方案'); return; }
        await applyPlan(planNames[Math.floor(Math.random() * planNames.length)]);
    }

    async function testCurrentPlan() {
        if (!currentPlan) return;
        const hasItems = ['characters', 'artists', 'presets', 'texts', 'loras'].some(k => flattenCategory(currentPlan[k]).length > 0);
        if (!hasItems) { showToast('请先在分组中添加项目', 'error'); return; }

        const btn = document.getElementById('editor-test');
        const origHTML = btn ? btn.innerHTML : '';
        if (btn) { btn.innerHTML = '生成中…'; btn.disabled = true; }

        try {
            const parts = [];
            for (const [catKey, apiKey] of [['characters', 'character'], ['artists', 'artist'], ['presets', 'preset']]) {
                const result = await fetchCategoryFromAPI(apiKey, currentPlan[catKey], currentPlan.name);
                if (result) parts.push(buildPromptFromResult(result));
            }
            // 文本类本地抽样
            const textParts = sampleFromGroups(currentPlan.texts, currentPlan.name, 'texts');
            textParts.forEach(t => { if (t) parts.push(t); });
            let positive = parts.filter(Boolean).join(', ');
            positive = mergeWithFixed(positive, currentPlan.fixedPrompt);

            // 比例
            applyRandomRatio(currentPlan.ratios, currentPlan.name);

            // 先把 positive 写入 prompt 框
            const promptEl = document.getElementById('prompt');
            if (promptEl && positive) {
                promptEl.value = positive;
                promptEl.dispatchEvent(new Event('input'));
            }

            // LoRA：必须等 prompt 框被新 positive 覆盖之后再调，
            // 否则 _loraSyncTriggerWords 会基于旧 prompt 拼触发词，被新 positive 覆盖
            applyRandomLoras(currentPlan.loras, currentPlan.name);

            showToast('测试已应用到提示词框', 'success');
        } catch (e) {
            console.error('[RandomPrompt] 测试失败:', e);
            showToast('测试失败: ' + e.message, 'error');
        } finally {
            if (btn) { btn.innerHTML = origHTML; btn.disabled = false; }
        }
    }

    // ─────────────────────────────────────────────
    //  持久化
    // ─────────────────────────────────────────────
    function loadPlans() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                plans = JSON.parse(saved);
                // 迁移所有旧方案
                Object.values(plans).forEach(p => migratePlanData(p));
                savePlans();
            }
            loadSequentialState();
            autoRandomEnabled = localStorage.getItem(AUTO_RANDOM_KEY) === 'true';
            autoRandomPlanName = localStorage.getItem(AUTO_RANDOM_PLAN_KEY) || '';
            randomEnabled = localStorage.getItem(RANDOM_ENABLED_KEY) === 'true';
            activePlanName = localStorage.getItem(ACTIVE_PLAN_KEY) || '';
            // 如果激活的方案不存在，重置
            if (activePlanName && !plans[activePlanName]) {
                activePlanName = '';
            }
        } catch (e) {
            console.error('[RandomPrompt] 加载方案失败:', e);
            plans = {};
        }
    }

    function savePlans() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(plans)); } catch (e) { console.error('[RandomPrompt] 保存方案失败:', e); }
    }

    function saveAutoRandomSettings() {
        localStorage.setItem(AUTO_RANDOM_KEY, autoRandomEnabled.toString());
        localStorage.setItem(AUTO_RANDOM_PLAN_KEY, autoRandomPlanName);
    }

    function saveRandomEnabled() {
        localStorage.setItem(RANDOM_ENABLED_KEY, randomEnabled.toString());
    }

    function saveActivePlan() {
        localStorage.setItem(ACTIVE_PLAN_KEY, activePlanName);
        // 记录 lastUsedAt / useCount（供“最近使用”排序）
        if (activePlanName && plans[activePlanName]) {
            const p = plans[activePlanName];
            p.lastUsedAt = Date.now();
            p.useCount = (p.useCount || 0) + 1;
            // 方案量多时 JSON.stringify 会比较重，防抖 500ms
            clearTimeout(saveActivePlan._t);
            saveActivePlan._t = setTimeout(savePlans, 500);
        }
    }

    function togglePanel(panel, forceClose) {
        if (forceClose) { panel.style.display = 'none'; }
        else {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            if (panel.style.display === 'block') refreshMainPanel();
        }
    }

    // ─────────────────────────────────────────────
    //  内部自动随机逻辑（供导出 API 和自动生成引擎共用）
    // ─────────────────────────────────────────────
    async function _internalApplyAutoRandom() {
        if (!randomEnabled || !activePlanName || !plans[activePlanName]) return null;
        const plan = plans[activePlanName];
        migratePlanData(plan);

        try {
            const parts = [];
            for (const [catKey, apiKey] of [['characters', 'character'], ['artists', 'artist'], ['presets', 'preset']]) {
                const result = await fetchCategoryFromAPI(apiKey, plan[catKey], activePlanName);
                if (result) parts.push(buildPromptFromResult(result));
            }
            // 文本类（本地抽样，每行一条，不走 API）
            const textParts = sampleFromGroups(plan.texts, activePlanName, 'texts');
            textParts.forEach(t => { if (t) parts.push(t); });
            let positive = parts.filter(Boolean).join(', ');
            positive = mergeWithFixed(positive, plan.fixedPrompt);

            // 比例
            applyRandomRatio(plan.ratios, activePlanName);

            // 注意：LoRA 不在这里调！必须等调用方把 positive 写入 prompt 框之后再调，
            // 否则 _loraSyncTriggerWords 会基于旧 prompt 拼触发词，被新 positive 覆盖
            return { positive, plan };
        } catch (e) {
            console.error('[RandomPrompt] 自动随机失败:', e);
            return null;
        }
    }

    // ─────────────────────────────────────────────
    //  公共 API
    // ─────────────────────────────────────────────
    return {
        init,
        applyPlan,
        quickRandom,
        getPlans: () => plans,
        getPlan: (name) => plans[name],

        applyAutoRandom: async function() {
            return _internalApplyAutoRandom();
        },

        // 在 prompt 框已写入新 positive 之后调用，把 LoRA 触发词拼到末尾
        applyLoras: function(loras) {
            return applyRandomLoras(loras, activePlanName);
        },

        isAutoRandomEnabled: () => autoRandomEnabled && autoRandomPlanName,

        // == 新 API：随机开关 ==
        isRandomEnabled: () => randomEnabled,
        getActivePlanName: () => activePlanName,
        getActivePlan: () => plans[activePlanName] || null,

        // == 外部调用：切换自动生成状态 ==
        toggleAutoGen: function() {
            if (autoGenState.running) {
                stopAutoGen();
            } else if (randomEnabled && activePlanName && plans[activePlanName]) {
                startAutoGen();
            } else {
                const panel = document.getElementById('random-main-panel');
                if (panel) {
                    panel.style.display = 'block';
                    refreshMainPanel();
                }
                if (!randomEnabled) {
                    showToast('请先打开随机开关', 'error');
                } else if (!activePlanName || !plans[activePlanName]) {
                    showToast('请先选择提示词方案', 'error');
                }
            }
        },

        // == 外部调用：读取自动生成状态快照 ==
        getAutoGenSnapshot: function() {
            const s = autoGenState;
            const now = Date.now();
            const remainingMs = s.nextTickAt && s.running ? Math.max(0, s.nextTickAt - now) : 0;
            return {
                running: !!s.running,
                mode: s.mode,
                currentCount: s.currentCount || 0,
                totalCount: s.totalCount,
                completedRounds: s.completedRounds || 0,
                timerMinutes: s.timerMinutes,
                timerBatch: s.timerBatch,
                timerRunningCount: s.timerRunningCount || 0,
                planName: s.planAtStart || '',
                nextTickAt: s.nextTickAt || 0,
                remainingMs
            };
        }
    };
})();
