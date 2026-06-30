/**
 * 随机提示词配置组件（分组版）
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

    // === 状态 ===
    let plans = {};
    let currentPlan = null;
    let onApplyCallback = null;
    let autoRandomEnabled = false;
    let autoRandomPlanName = '';
    let randomEnabled = false;       // 随机全局开关（点击按钮切换）
    let activePlanName = '';         // 当前选中的方案名
    let triggerButton = null;        // 🎲 按钮引用

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
            bg: dark ? '#0d1520' : '#fff',
            bgSoft: dark ? '#141c2b' : '#f8f9fa',
            text: dark ? '#e0e7ef' : '#1a1a1a',
            textSub: dark ? '#666' : '#999',
            border: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
            shadow: dark ? '0 20px 60px rgba(0,0,0,0.5)' : '0 20px 60px rgba(0,0,0,0.3)',
            accent: '#00b4d8',
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
            background:${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#00b4d8'};
            color:#fff;
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
                    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(0,180,216,0); }
                    40% { transform: scale(1.08); box-shadow: 0 0 0 6px rgba(0,180,216,0.2); }
                    70% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(0,180,216,0.1); }
                    100% { transform: scale(1.12); box-shadow: 0 0 0 14px rgba(0,180,216,0); }
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
                    border: 2px solid rgba(0,180,216,0.4);
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
            showToast('请先创建随机方案', 'error');
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
        const dark = isDarkTheme();
        // 色子正面颜色：暗色主题用浅灰，亮色主题用深灰
        const faceBase = dark ? '#b8c4d6' : '#555';
        if (randomEnabled) {
            btn.style.background = 'rgba(0,180,216,0.3)';
            btn.style.borderColor = 'rgba(0,180,216,0.45)';
            btn.style.color = '#00b4d8';
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
            <div style="padding:18px 20px;border-bottom:1px solid ${colors.border};display:flex;align-items:center;justify-content:space-between;">
                <div style="display:flex;align-items:center;">
                    <div style="font-size:17px;font-weight:800;">🎲 随机方案</div>
                    ${activePlanDisplay}
                </div>
                <button id="random-panel-close" style="width:36px;height:36px;border-radius:12px;border:none;background:${colors.bgSoft};cursor:pointer;font-size:18px;color:${colors.textSub};display:flex;align-items:center;justify-content:center;">✕</button>
            </div>
            <div style="padding:16px 20px;overflow-y:auto;max-height:calc(85vh - 140px);">
                <div id="random-plan-list"></div>
            </div>
            <div style="padding:14px 20px;border-top:1px solid ${colors.border};">
                <button id="random-new-plan" style="
                    width:100%;padding:14px;border-radius:14px;border:1.5px dashed ${colors.accent}60;
                    background:transparent;cursor:pointer;font-size:14px;font-weight:700;color:${colors.accent};
                    display:flex;align-items:center;justify-content:center;gap:8px;
                ">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                    新建方案
                </button>
            </div>
        `;

        panel.querySelector('#random-panel-close').addEventListener('click', () => panel.style.display = 'none');
        panel.querySelector('#random-new-plan').addEventListener('click', () => openPlanEditor(null));

        return panel;
    }

    // ─────────────────────────────────────────────
    //  方案列表渲染
    // ─────────────────────────────────────────────
    function renderPlanList() {
        const container = document.getElementById('random-plan-list');
        if (!container) return;
        const colors = getThemeColors();
        const planNames = Object.keys(plans);

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

        if (planNames.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:${colors.textSub};">
                <div style="font-size:32px;margin-bottom:8px;opacity:0.5;">📋</div>
                <div style="font-size:13px;font-weight:600;">暂无方案</div>
                <div style="font-size:11px;margin-top:4px;">点击"新建方案"创建你的第一个随机方案</div>
            </div>`;
            return;
        }

        container.innerHTML = planNames.map(name => {
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
            return `
                <div class="random-plan-card ${isActive ? 'plan-active' : ''}" data-name="${escapeHtml(name)}" style="
                    padding:14px 16px;margin-bottom:10px;border-radius:14px;
                    border:1.5px solid ${isActive ? colors.accent : colors.border};
                    background:${isActive ? colors.accent + '08' : colors.bgSoft};
                    cursor:pointer;transition:all 0.15s;
                ">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            ${isActive ? `<span style="width:20px;height:20px;border-radius:50%;background:${colors.accent};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;">✓</span>` : `<span style="width:20px;height:20px;border-radius:50%;border:2px solid ${colors.border};flex-shrink:0;"></span>`}
                            <div style="font-size:15px;font-weight:700;color:${isActive ? colors.accent : colors.text};">${escapeHtml(name)}</div>
                        </div>
                        <div style="display:flex;gap:8px;">
                            <button class="plan-edit-btn" data-name="${escapeHtml(name)}" style="
                                width:38px;height:38px;border-radius:12px;border:none;
                                background:rgba(0,180,216,0.1);color:${colors.accent};cursor:pointer;
                                display:flex;align-items:center;justify-content:center;padding:0;
                            " title="编辑">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                            </button>
                            <button class="plan-delete-btn" data-name="${escapeHtml(name)}" style="
                                width:38px;height:38px;border-radius:12px;border:none;
                                background:rgba(239,68,68,0.08);color:${colors.textSub};cursor:pointer;
                                display:flex;align-items:center;justify-content:center;padding:0;
                            " title="删除">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                            </button>
                        </div>
                    </div>
                    ${stats.length > 0 ? `<div style="font-size:12px;color:${colors.textSub};display:flex;gap:14px;">${stats.join('')}</div>` : ''}
                </div>`;
        }).join('');

        // 绑定事件：点击卡片选择激活方案
        container.querySelectorAll('.random-plan-card').forEach(card => {
            card.addEventListener('click', (e) => {
                // 如果点击的是按钮，不触发选择
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

        // 绑定编辑/删除事件
        container.querySelectorAll('.plan-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); openPlanEditor(btn.dataset.name); });
        });
        container.querySelectorAll('.plan-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); if (confirm('确定删除方案"' + btn.dataset.name + '"？')) deletePlan(btn.dataset.name); });
        });
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
                <button id="editor-save" style="padding:10px 20px;border-radius:10px;border:none;background:${colors.accent};cursor:pointer;font-size:12px;font-weight:700;color:#fff;">保存方案</button>
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
    const GROUP_COLORS = ['#00b4d8','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#6366f1','#14b8a6'];

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
                    <div style="position:absolute;top:2px;left:${enabled ? '18px' : '2px'};width:18px;height:18px;background:#fff;border-radius:50%;transition:all 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.15);"></div>
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
            cat.groups.push({ id: genId(), name: '新分组', items: [], enabled: true, count: 1, color: GROUP_COLORS[cat.groups.length % GROUP_COLORS.length] });
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
                        background:${colors.accent};color:#fff;cursor:pointer;font-size:13px;font-weight:700;
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
                <button id="text-edit-confirm" style="padding:9px 24px;border-radius:10px;border:none;background:${colors.accent};color:#fff;cursor:pointer;font-size:12px;font-weight:700;">保存</button>
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
    function sampleFromGroups(cat) {
        if (!cat || !cat.groups) return [];
        const result = [];
        cat.groups.forEach(group => {
            if (group.enabled === false) return;
            if (!group.items || group.items.length === 0) return;
            const count = Math.min(group.count || 1, group.items.length);
            const shuffled = [...group.items].sort(() => Math.random() - 0.5);
            result.push(...shuffled.slice(0, count));
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
    function applyRandomRatio(ratios) {
        if (!ratios?.groups) return;
        const sampled = [];
        ratios.groups.forEach(g => {
            if (g.enabled === false || !g.items?.length) return;
            const count = Math.min(g.count || 1, g.items.length);
            const shuffled = [...g.items].sort(() => Math.random() - 0.5);
            sampled.push(...shuffled.slice(0, count));
        });
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
    function applyRandomLoras(loras) {
        if (!loras?.groups) return;
        const sampled = [];
        loras.groups.forEach(g => {
            if (g.enabled === false || !g.items?.length) return;
            const count = Math.min(g.count || 1, g.items.length);
            const shuffled = [...g.items].sort(() => Math.random() - 0.5);
            sampled.push(...shuffled.slice(0, count));
        });
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
    async function fetchCategoryFromAPI(catKey, cat) {
        if (!cat?.groups) return null;

        // 每组独立抽样
        const sampledNames = [];
        cat.groups.forEach(g => {
            if (g.enabled === false || !g.items?.length) return;
            const count = Math.min(g.count || 1, g.items.length);
            const shuffled = [...g.items].sort(() => Math.random() - 0.5);
            sampledNames.push(...shuffled.slice(0, count));
        });
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
                const result = await fetchCategoryFromAPI(apiKey, plan[catKey]);
                if (result) parts.push(buildPromptFromResult(result));
            }
            // 文本类（本地抽样，每行一条，不走 API）
            const textParts = sampleFromGroups(plan.texts);
            textParts.forEach(t => { if (t) parts.push(t); });
            let positive = parts.filter(Boolean).join(', ');
            positive = mergeWithFixed(positive, plan.fixedPrompt);

            // 比例
            applyRandomRatio(plan.ratios);

            // 先把 positive 抛给 onApplyCallback，外部会把它写入 prompt 框
            if (onApplyCallback) onApplyCallback({ positive, negative: '', raw: {} });

            // LoRA：必须等 prompt 框被新 positive 覆盖之后再调，
            // 否则 _loraSyncTriggerWords 会基于旧 prompt 拼触发词，被新 positive 覆盖
            applyRandomLoras(plan.loras);

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
                const result = await fetchCategoryFromAPI(apiKey, currentPlan[catKey]);
                if (result) parts.push(buildPromptFromResult(result));
            }
            // 文本类本地抽样
            const textParts = sampleFromGroups(currentPlan.texts);
            textParts.forEach(t => { if (t) parts.push(t); });
            let positive = parts.filter(Boolean).join(', ');
            positive = mergeWithFixed(positive, currentPlan.fixedPrompt);

            // 比例
            applyRandomRatio(currentPlan.ratios);

            // 先把 positive 写入 prompt 框
            const promptEl = document.getElementById('prompt');
            if (promptEl && positive) {
                promptEl.value = positive;
                promptEl.dispatchEvent(new Event('input'));
            }

            // LoRA：必须等 prompt 框被新 positive 覆盖之后再调，
            // 否则 _loraSyncTriggerWords 会基于旧 prompt 拼触发词，被新 positive 覆盖
            applyRandomLoras(currentPlan.loras);

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
    }

    function togglePanel(panel, forceClose) {
        if (forceClose) { panel.style.display = 'none'; }
        else {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            if (panel.style.display === 'block') renderPlanList();
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
            if (!randomEnabled || !activePlanName || !plans[activePlanName]) return null;
            const plan = plans[activePlanName];
            migratePlanData(plan);

            try {
                const parts = [];
                for (const [catKey, apiKey] of [['characters', 'character'], ['artists', 'artist'], ['presets', 'preset']]) {
                    const result = await fetchCategoryFromAPI(apiKey, plan[catKey]);
                    if (result) parts.push(buildPromptFromResult(result));
                }
                // 文本类（本地抽样，每行一条，不走 API）
                const textParts = sampleFromGroups(plan.texts);
                textParts.forEach(t => { if (t) parts.push(t); });
                let positive = parts.filter(Boolean).join(', ');
                positive = mergeWithFixed(positive, plan.fixedPrompt);

                // 比例
                applyRandomRatio(plan.ratios);

                // 注意：LoRA 不在这里调！必须等调用方把 positive 写入 prompt 框之后再调，
                // 否则 _loraSyncTriggerWords 会基于旧 prompt 拼触发词，被新 positive 覆盖
                return { positive, plan };
            } catch (e) {
                console.error('[RandomPrompt] 自动随机失败:', e);
                return null;
            }
        },

        // 在 prompt 框已写入新 positive 之后调用，把 LoRA 触发词拼到末尾
        applyLoras: function(loras) {
            return applyRandomLoras(loras);
        },

        isAutoRandomEnabled: () => autoRandomEnabled && autoRandomPlanName,

        // == 新 API：随机开关 ==
        isRandomEnabled: () => randomEnabled,
        getActivePlanName: () => activePlanName,
        getActivePlan: () => plans[activePlanName] || null
    };
})();
