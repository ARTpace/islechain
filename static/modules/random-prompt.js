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

    // === 状态 ===
    let plans = {};
    let currentPlan = null;
    let onApplyCallback = null;
    let autoRandomEnabled = false;
    let autoRandomPlanName = '';

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
        ['characters', 'artists', 'presets', 'ratios'].forEach(key => {
            const val = plan[key];
            if (!val || Array.isArray(val)) {
                const oldItems = val || [];
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
        if ('characterCount' in plan) { delete plan.characterCount; changed = true; }
        if ('artistCount' in plan) { delete plan.artistCount; changed = true; }
        if ('presetCount' in plan) { delete plan.presetCount; changed = true; }
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

        const btn = createTriggerButton();
        container.appendChild(btn);

        const panel = createMainPanel();
        document.body.appendChild(panel);

        btn.addEventListener('click', () => togglePanel(panel, false));
    }

    // ─────────────────────────────────────────────
    //  触发按钮（🎲）
    // ─────────────────────────────────────────────
    function createTriggerButton() {
        const btn = document.createElement('button');
        btn.className = 'random-prompt-trigger';
        btn.innerHTML = '🎲';
        btn.title = '随机方案管理';
        btn.style.cssText = `
            width:36px;height:36px;border-radius:10px;border:1px solid rgba(0,0,0,0.1);
            background:transparent;cursor:pointer;font-size:18px;
            display:flex;align-items:center;justify-content:center;transition:all 0.15s;flex-shrink:0;
        `;
        btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(0,180,216,0.1)'; btn.style.borderColor = '#00b4d8'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.borderColor = 'rgba(0,0,0,0.1)'; });
        return btn;
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

        panel.innerHTML = `
            <div style="padding:18px 20px;border-bottom:1px solid ${colors.border};display:flex;align-items:center;justify-content:space-between;">
                <div style="font-size:17px;font-weight:800;">🎲 随机方案</div>
                <button id="random-panel-close" style="width:36px;height:36px;border-radius:12px;border:none;background:${colors.bgSoft};cursor:pointer;font-size:18px;color:${colors.textSub};display:flex;align-items:center;justify-content:center;">✕</button>
            </div>
            <div style="padding:16px 20px;overflow-y:auto;max-height:calc(85vh - 140px);">
                <div style="padding:14px;border-radius:14px;border:1px solid ${colors.border};margin-bottom:16px;background:${colors.bgSoft};">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                        <div style="font-size:14px;font-weight:700;">⚡ 自动随机</div>
                        <div id="auto-random-toggle" style="width:44px;height:24px;border-radius:12px;cursor:pointer;transition:all 0.2s;background:${autoRandomEnabled ? colors.accent : colors.border};position:relative;">
                            <div style="position:absolute;top:2px;left:${autoRandomEnabled ? '22px' : '2px'};width:20px;height:20px;background:#fff;border-radius:50%;transition:all 0.2s;box-shadow:0 1px 4px rgba(0,0,0,0.15);"></div>
                        </div>
                    </div>
                    <div style="font-size:12px;color:${colors.textSub};margin-bottom:10px;">开启后，每次生成图片时自动应用随机方案</div>
                    <select id="auto-random-plan" style="width:100%;padding:10px;border:1px solid ${colors.border};border-radius:10px;font-size:13px;background:transparent;color:${colors.text};outline:none;${autoRandomEnabled ? '' : 'opacity:0.5;pointer-events:none;'}">
                        <option value="">选择方案...</option>
                    </select>
                </div>
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

        const autoToggle = panel.querySelector('#auto-random-toggle');
        autoToggle.addEventListener('click', () => {
            autoRandomEnabled = !autoRandomEnabled;
            autoToggle.style.background = autoRandomEnabled ? colors.accent : colors.border;
            autoToggle.querySelector('div').style.left = autoRandomEnabled ? '21px' : '3px';
            const planSelect = panel.querySelector('#auto-random-plan');
            planSelect.style.opacity = autoRandomEnabled ? '1' : '0.5';
            planSelect.style.pointerEvents = autoRandomEnabled ? 'auto' : 'none';
            saveAutoRandomSettings();
        });

        const autoPlanSelect = panel.querySelector('#auto-random-plan');
        autoPlanSelect.addEventListener('change', () => { autoRandomPlanName = autoPlanSelect.value; saveAutoRandomSettings(); });

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

        // 更新自动随机下拉
        const autoPlanSelect = document.getElementById('auto-random-plan');
        if (autoPlanSelect) {
            autoPlanSelect.innerHTML = '<option value="">选择方案...</option>' +
                planNames.map(n => `<option value="${escapeHtml(n)}" ${n === autoRandomPlanName ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
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
            const charCount = flattenCategory(plan.characters).length;
            const artistCount = flattenCategory(plan.artists).length;
            const presetCount = flattenCategory(plan.presets).length;
            const stats = [];
            if (charCount > 0) stats.push(`<span>👤${charCount}</span>`);
            if (artistCount > 0) stats.push(`<span>🎨${artistCount}</span>`);
            if (presetCount > 0) stats.push(`<span>⚙️${presetCount}</span>`);
            const ratioCount = flattenCategory(plan.ratios).length;
            if (ratioCount > 0) stats.push(`<span>📐${ratioCount}</span>`);
            return `
                <div class="random-plan-card" data-name="${escapeHtml(name)}" style="
                    padding:14px 16px;margin-bottom:10px;border-radius:14px;border:1px solid ${colors.border};
                    background:${colors.bgSoft};
                ">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                        <div style="font-size:15px;font-weight:700;">${escapeHtml(name)}</div>
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

        // 绑定事件
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
            lora: plan.lora || false,
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
                    ${groups.length === 0 ? `<div style="text-align:center;padding:16px;color:${colors.textSub};font-size:11px;">暂无分组，点击"+ 新建分组"创建</div>` : ''}
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
        const labels = { characters: ['角色', '👤'], artists: ['画师', '🎨'], presets: ['预设', '⚙️'] };
        const [label, icon] = labels[planKey] || ['', ''];
        const cat = currentPlan[planKey];
        const groups = cat?.groups || [];

        let groupsHtml = '';
        groups.forEach((group, gIdx) => {
            groupsHtml += renderGroupCard(planKey, group, gIdx);
        });

        const container = section.querySelector('.groups-container');
        container.innerHTML = groupsHtml || `<div style="text-align:center;padding:20px;color:${getThemeColors().textSub};font-size:11px;">暂无分组，点击"+ 新建分组"创建</div>`;

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
    let pickerConfirmControl = null;
    let editorPanel = null;

    function hideEditorPanel() {
        editorPanel = document.getElementById('random-plan-editor');
        if (editorPanel) editorPanel.style.display = 'none';
    }
    function showEditorPanel() {
        if (editorPanel) { editorPanel.style.display = 'block'; editorPanel = null; }
    }

    function createConfirmControl(type) {
        const colors = getThemeColors();
        const control = document.createElement('div');
        control.id = 'picker-confirm-control';
        control.style.cssText = `
            position:fixed;top:20px;left:50%;transform:translateX(-50%);padding:12px 20px;
            background:${colors.bg};border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.2);
            z-index:10002;display:flex;align-items:center;gap:12px;
        `;
        const typeNames = { character: '角色', artist: '画师', preset: '预设' };
        control.innerHTML = `
            <span style="font-size:13px;font-weight:600;color:${colors.text};">已选择${typeNames[type] || type}，点击确认添加</span>
            <button id="picker-confirm-btn" style="padding:8px 16px;border-radius:8px;border:none;background:${colors.success};color:#fff;cursor:pointer;font-size:12px;font-weight:700;">✓ 确认</button>
            <button id="picker-cancel-btn" style="padding:8px 16px;border-radius:8px;border:1px solid ${colors.border};background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:${colors.text};">取消</button>
        `;
        document.body.appendChild(control);

        control.querySelector('#picker-confirm-btn').addEventListener('click', () => {
            if (currentPickerType === 'preset' && typeof presetPickerSelected !== 'undefined') {
                const selected = presetPickerSelected.slice();
                const modal = document.getElementById('presetPickerModal');
                if (modal) modal.style.display = 'none';
                if (pickerConfirmControl) { pickerConfirmControl.remove(); pickerConfirmControl = null; }
                showEditorPanel();
                if (selected.length > 0 && currentPlan && currentPickerGroupIdx !== null) {
                    const group = currentPlan.presets.groups[currentPickerGroupIdx];
                    group.items = []; // 覆盖
                    selected.forEach(item => {
                        const name = item.name || item.id || '';
                        if (name) group.items.push(name);
                    });
                    refreshCategory(document.getElementById('random-plan-editor'), 'presets');
                }
                currentPickerType = null; currentPickerGroupIdx = null;
            } else if (currentPickerType === 'artist' && typeof artistPickerSelected !== 'undefined') {
                const selected = artistPickerSelected.slice();
                const modal = document.getElementById('artistPickerModal');
                if (modal) modal.style.display = 'none';
                if (pickerConfirmControl) { pickerConfirmControl.remove(); pickerConfirmControl = null; }
                showEditorPanel();
                if (selected.length > 0 && currentPlan && currentPickerGroupIdx !== null) {
                    const group = currentPlan.artists.groups[currentPickerGroupIdx];
                    group.items = []; // 覆盖
                    selected.forEach(item => {
                        const name = (typeof item === 'string' ? item : item.name || item.danbooru_tag || '').replace(/^@/, '');
                        if (name) group.items.push(name);
                    });
                    refreshCategory(document.getElementById('random-plan-editor'), 'artists');
                }
                currentPickerType = null; currentPickerGroupIdx = null;
            } else {
                pickerClose();
            }
        });

        control.querySelector('#picker-cancel-btn').addEventListener('click', () => {
            currentPickerType = null; currentPickerGroupIdx = null;
            pickerClose();
        });

        return control;
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

    function openPickerForEditor(type) {
        currentPickerType = type;
        hideEditorPanel();
        pickerConfirmControl = createConfirmControl(type);

        // 保存原始 prompt，注入当前组的项目让选择器识别为已选
        const promptEl = document.getElementById('prompt');
        const origPrompt = promptEl ? promptEl.value : '';
        if (promptEl && currentPickerGroupIdx !== null) {
            const planKey = type === 'character' ? 'characters' : type === 'artist' ? 'artists' : 'presets';
            const group = currentPlan[planKey]?.groups[currentPickerGroupIdx];
            if (group && group.items.length > 0) {
                let injection = group.items.join(', ');
                // 画师选择器需要 @ 前缀才能识别
                if (type === 'artist') {
                    injection = group.items.map(i => '@' + i).join(', ');
                }
                const existing = origPrompt.trim();
                promptEl.value = existing ? existing + ', ' + injection : injection;
            }
        }

        // 选择器会在 open 时从 prompt 读取已选项
        // 读完之后立即恢复原始 prompt
        const restorePrompt = () => { if (promptEl) promptEl.value = origPrompt; };

        if (type === 'character' && typeof pickerOpen === 'function') {
            pickerOpen(function(selectedItems) {
                restorePrompt();
                if (pickerConfirmControl) { pickerConfirmControl.remove(); pickerConfirmControl = null; }
                showEditorPanel();
                if (currentPickerType === 'character' && selectedItems && selectedItems.length > 0 && currentPlan && currentPickerGroupIdx !== null) {
                    const group = currentPlan.characters.groups[currentPickerGroupIdx];
                    group.items = []; // 覆盖而非追加，选择器返回的就是完整选中列表
                    selectedItems.forEach(item => {
                        const name = typeof item === 'string' ? item : item.name || item.id;
                        if (name) group.items.push(name);
                    });
                    refreshCategory(document.getElementById('random-plan-editor'), 'characters');
                }
                currentPickerType = null; currentPickerGroupIdx = null;
            });
        } else if (type === 'artist' && typeof artistPickerOpen === 'function') {
            artistPickerOpen(null);
            restorePrompt();
        } else if (type === 'preset' && typeof presetPickerOpen === 'function') {
            presetPickerOpen(null);
            restorePrompt();
        } else {
            restorePrompt();
            if (pickerConfirmControl) { pickerConfirmControl.remove(); pickerConfirmControl = null; }
            showEditorPanel();
            alert('选择器未加载');
        }
    }

    // ─────────────────────────────────────────────
    //  保存方案
    // ─────────────────────────────────────────────
    function savePlanFromEditor() {
        const editor = document.getElementById('random-plan-editor');
        if (!editor || !currentPlan) return;

        const name = editor.querySelector('#editor-plan-name').value.trim();
        if (!name) { alert('请输入方案名称'); return; }

        const hasItems = ['characters', 'artists', 'presets', 'ratios'].some(k => flattenCategory(currentPlan[k]).length > 0);
        if (!hasItems) { alert('请至少在一个分组中添加项目'); return; }

        plans[name] = {
            name,
            characters: currentPlan.characters,
            artists: currentPlan.artists,
            presets: currentPlan.presets,
            ratios: currentPlan.ratios,
            lora: currentPlan.lora,
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
        if (sampled.length === 0) return;
        const picked = sampled[Math.floor(Math.random() * sampled.length)];
        const [w, h] = picked.split(':').map(Number);
        if (!w || !h) return;
        // 应用到全局变量
        try {
            if (typeof selectRatio === 'function') {
                selectRatio(picked, w, h);
            } else {
                window.animaRatioW = w;
                window.animaRatioH = h;
                localStorage.setItem('anima_ratio_w', w);
                localStorage.setItem('anima_ratio_h', h);
            }
        } catch (e) { console.warn('[RandomPrompt] 应用比例失败:', e); }
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
            let positive = parts.filter(Boolean).join(', ');
            positive = mergeWithFixed(positive, plan.fixedPrompt);

            // 随机比例
            applyRandomRatio(plan.ratios);

            if (onApplyCallback) onApplyCallback({ positive, negative: '', raw: {} });

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
        const hasItems = ['characters', 'artists', 'presets'].some(k => flattenCategory(currentPlan[k]).length > 0);
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
            let positive = parts.filter(Boolean).join(', ');
            positive = mergeWithFixed(positive, currentPlan.fixedPrompt);

            // 随机比例
            applyRandomRatio(currentPlan.ratios);

            const promptEl = document.getElementById('prompt');
            if (promptEl && positive) {
                promptEl.value = positive;
                promptEl.dispatchEvent(new Event('input'));
            }
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
            if (!autoRandomEnabled || !autoRandomPlanName || !plans[autoRandomPlanName]) return null;
            const plan = plans[autoRandomPlanName];
            migratePlanData(plan);

            try {
                const parts = [];
                for (const [catKey, apiKey] of [['characters', 'character'], ['artists', 'artist'], ['presets', 'preset']]) {
                    const result = await fetchCategoryFromAPI(apiKey, plan[catKey]);
                    if (result) parts.push(buildPromptFromResult(result));
                }
                let positive = parts.filter(Boolean).join(', ');
                positive = mergeWithFixed(positive, plan.fixedPrompt);
                applyRandomRatio(plan.ratios);
                return { positive, raw: {} };
            } catch (e) {
                console.error('[RandomPrompt] 自动随机失败:', e);
                return null;
            }
        },

        isAutoRandomEnabled: () => autoRandomEnabled && autoRandomPlanName
    };
})();
