/**
 * 随机提示词配置组件
 * 支持方案管理，复用现有选择器
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
    const FIXED_PROMPT_KEY = 'random_fixed_prompt';
    
    // === 状态 ===
    let plans = {};
    let currentPlan = null;
    let onApplyCallback = null;
    let autoRandomEnabled = false;
    let autoRandomPlanName = '';
    let fixedPrompt = '';
    
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
            text: dark ? '#e0e7ef' : '#1a1a1a',
            textSub: dark ? '#666' : '#999',
            border: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
            shadow: dark ? '0 20px 60px rgba(0,0,0,0.5)' : '0 20px 60px rgba(0,0,0,0.3)',
            accent: '#00b4d8',
            success: '#10b981',
            danger: '#ef4444'
        };
    }
    
    // === 初始化 ===
    function init(containerId, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('[RandomPrompt] 容器不存在:', containerId);
            return;
        }
        
        onApplyCallback = options.onApply || null;
        
        // 加载保存的方案
        loadPlans();
        
        // 创建触发按钮
        const btn = createTriggerButton();
        container.appendChild(btn);
        
        // 创建主面板
        const panel = createMainPanel();
        document.body.appendChild(panel);
        
        // 绑定事件
        btn.addEventListener('click', () => togglePanel(panel, false));
    }
    
    // === 创建触发按钮 ===
    function createTriggerButton() {
        const btn = document.createElement('button');
        btn.className = 'random-prompt-trigger';
        btn.innerHTML = '🎲';
        btn.title = '随机方案管理';
        btn.style.cssText = `
            width: 36px;
            height: 36px;
            border-radius: 10px;
            border: 1px solid rgba(0,0,0,0.1);
            background: transparent;
            cursor: pointer;
            font-size: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s;
            flex-shrink: 0;
        `;
        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(0,180,216,0.1)';
            btn.style.borderColor = '#00b4d8';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'transparent';
            btn.style.borderColor = 'rgba(0,0,0,0.1)';
        });
        return btn;
    }
    
    // === 创建主面板 ===
    function createMainPanel() {
        const colors = getThemeColors();
        const panel = document.createElement('div');
        panel.id = 'random-main-panel';
        panel.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 560px;
            max-height: 80vh;
            background: ${colors.bg};
            border-radius: 16px;
            box-shadow: ${colors.shadow};
            z-index: 10000;
            display: none;
            overflow: hidden;
            color: ${colors.text};
        `;
        
        panel.innerHTML = `
            <div style="padding:16px 20px;border-bottom:1px solid ${colors.border};display:flex;align-items:center;justify-content:space-between;">
                <div style="font-size:15px;font-weight:800;">🎲 随机方案管理</div>
                <button id="random-panel-close" style="width:28px;height:28px;border-radius:8px;border:none;background:transparent;cursor:pointer;font-size:18px;color:${colors.textSub};">✕</button>
            </div>
            
            <div style="padding:16px 20px;overflow-y:auto;max-height:60vh;">
                <!-- 自动随机开关 -->
                <div style="padding:12px;border-radius:10px;border:1px solid ${colors.border};margin-bottom:16px;background:${colors.bg};">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <div style="font-size:13px;font-weight:700;">⚡ 自动随机</div>
                        <div id="auto-random-toggle" style="width:40px;height:22px;border-radius:11px;cursor:pointer;transition:all 0.2s;background:${autoRandomEnabled ? colors.accent : colors.border};position:relative;">
                            <div style="position:absolute;top:3px;left:${autoRandomEnabled ? '21px' : '3px'};width:16px;height:16px;background:#fff;border-radius:50%;transition:all 0.2s;"></div>
                        </div>
                    </div>
                    <div style="font-size:11px;color:${colors.textSub};margin-bottom:8px;">开启后，每次生成图片时自动应用随机方案</div>
                    <select id="auto-random-plan" style="width:100%;padding:8px;border:1px solid ${colors.border};border-radius:8px;font-size:12px;background:transparent;color:${colors.text};outline:none;${autoRandomEnabled ? '' : 'opacity:0.5;pointer-events:none;'}">
                        <option value="">选择方案...</option>
                    </select>
                </div>
                
                <div id="random-plan-list"></div>
            </div>
            
            <div style="padding:12px 20px;border-top:1px solid ${colors.border};display:flex;gap:8px;">
                <button id="random-new-plan" style="flex:1;padding:10px;border-radius:10px;border:1px solid ${colors.border};background:transparent;cursor:pointer;font-size:12px;font-weight:700;color:${colors.text};display:flex;align-items:center;justify-content:center;gap:6px;">
                    <span style="font-size:16px;">+</span> 新建方案
                </button>
            </div>
        `;
        
        // 绑定关闭按钮
        panel.querySelector('#random-panel-close').addEventListener('click', () => {
            panel.style.display = 'none';
        });
        
        // 绑定新建方案
        panel.querySelector('#random-new-plan').addEventListener('click', () => {
            openPlanEditor(null);
        });

        
        // 绑定自动随机开关
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
        
        // 绑定方案选择
        const autoPlanSelect = panel.querySelector('#auto-random-plan');
        autoPlanSelect.addEventListener('change', () => {
            autoRandomPlanName = autoPlanSelect.value;
            saveAutoRandomSettings();
        });
        
        return panel;
    }
    
    // === 渲染方案列表 ===
    function renderPlanList() {
        const container = document.getElementById('random-plan-list');
        if (!container) return;
        
        const colors = getThemeColors();
        const planNames = Object.keys(plans);
        
        // 更新自动随机方案下拉框
        const autoPlanSelect = document.getElementById('auto-random-plan');
        if (autoPlanSelect) {
            autoPlanSelect.innerHTML = '<option value="">选择方案...</option>' + 
                planNames.map(name => `<option value="${escapeHtml(name)}" ${name === autoRandomPlanName ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
        }
        
        if (planNames.length === 0) {
            container.innerHTML = `
                <div style="text-align:center;padding:40px 20px;color:${colors.textSub};">
                    <div style="font-size:32px;margin-bottom:8px;opacity:0.5;">📋</div>
                    <div style="font-size:13px;font-weight:600;">暂无方案</div>
                    <div style="font-size:11px;margin-top:4px;">点击"新建方案"创建你的第一个随机方案</div>
                </div>
            `;
            return;
        }
        
        container.innerHTML = planNames.map(name => {
            const plan = plans[name];
            const charCount = plan.characters?.length || 0;
            const artistCount = plan.artists?.length || 0;
            const presetCount = plan.presets?.length || 0;
            
            return `
                <div class="random-plan-card" data-name="${escapeHtml(name)}" style="
                    padding:12px 16px;
                    margin-bottom:8px;
                    border-radius:12px;
                    border:1px solid ${colors.border};
                    background:${colors.bg};
                    cursor:pointer;
                    transition:all 0.15s;
                ">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <div style="font-size:13px;font-weight:700;">${escapeHtml(name)}</div>
                        <div style="display:flex;gap:4px;">
                            <button class="plan-edit-btn" data-name="${escapeHtml(name)}" style="padding:4px 8px;border-radius:6px;border:none;background:rgba(0,180,216,0.1);color:${colors.accent};cursor:pointer;font-size:11px;font-weight:600;">编辑</button>
                            <button class="plan-delete-btn" data-name="${escapeHtml(name)}" style="padding:4px 8px;border-radius:6px;border:none;background:rgba(239,68,68,0.1);color:${colors.danger};cursor:pointer;font-size:11px;font-weight:600;">删除</button>
                        </div>
                    </div>
                    <div style="font-size:11px;color:${colors.textSub};display:flex;gap:12px;">
                        ${charCount > 0 ? `<span>👤 ${charCount}个角色</span>` : ''}
                        ${artistCount > 0 ? `<span>🎨 ${artistCount}个画师</span>` : ''}
                        ${presetCount > 0 ? `<span>⚙️ ${presetCount}个预设</span>` : ''}
                    </div>
                    <button class="plan-apply-btn" data-name="${escapeHtml(name)}" style="
                        width:100%;
                        margin-top:10px;
                        padding:8px;
                        border-radius:8px;
                        border:1px solid ${colors.border};
                        background:transparent;
                        cursor:pointer;
                        font-size:12px;
                        font-weight:600;
                        color:${colors.text};
                        transition:all 0.15s;
                    ">应用此方案</button>
                </div>
            `;
        }).join('');
        
        // 绑定编辑按钮
        container.querySelectorAll('.plan-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const name = btn.dataset.name;
                openPlanEditor(name);
            });
        });
        
        // 绑定删除按钮
        container.querySelectorAll('.plan-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const name = btn.dataset.name;
                if (confirm(`确定删除方案"${name}"吗？`)) {
                    deletePlan(name);
                }
            });
        });
        
        // 绑定应用按钮
        container.querySelectorAll('.plan-apply-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const name = btn.dataset.name;
                applyPlan(name);
            });
        });
    }
    
    // === 打开方案编辑器 ===
    function openPlanEditor(planName) {
        const isEdit = planName !== null;
        const plan = isEdit ? plans[planName] : { characters: [], artists: [], presets: [], lora: false };
        
        // 存储当前编辑的方案
        currentPlan = {
            name: isEdit ? planName : '',
            characters: [...(plan.characters || [])],
            artists: [...(plan.artists || [])],
            presets: [...(plan.presets || [])],
            lora: plan.lora || false,
            characterCount: plan.characterCount || 1,
            artistCount: plan.artistCount || 1,
            presetCount: plan.presetCount || 1,
            fixedPrompt: plan.fixedPrompt || ''
        };
        
        // 隐藏主面板
        document.getElementById('random-main-panel').style.display = 'none';
        
        // 删除旧的编辑器（如果存在）
        const oldEditor = document.getElementById('random-plan-editor');
        if (oldEditor) {
            oldEditor.remove();
        }
        
        // 创建并显示新编辑器
        const editor = createPlanEditor(isEdit);
        document.body.appendChild(editor);
        editor.style.display = 'block';
    }
    
    // === 创建方案编辑器 ===
    function createPlanEditor(isEdit) {
        const colors = getThemeColors();
        const editor = document.createElement('div');
        editor.id = 'random-plan-editor';
        editor.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 600px;
            max-height: 85vh;
            background: ${colors.bg};
            border-radius: 16px;
            box-shadow: ${colors.shadow};
            z-index: 10001;
            display: none;
            overflow: hidden;
            color: ${colors.text};
        `;
        
        editor.innerHTML = `
            <div style="padding:16px 20px;border-bottom:1px solid ${colors.border};display:flex;align-items:center;justify-content:space-between;">
                <div style="font-size:15px;font-weight:800;">${isEdit ? '编辑方案' : '新建方案'}</div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <button id="editor-test" title="测试方案：随机生成提示词到提示词框" style="padding:6px 14px;border-radius:8px;border:1px solid ${colors.accent};background:transparent;cursor:pointer;font-size:12px;font-weight:700;color:${colors.accent};display:flex;align-items:center;gap:5px;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/></svg>
                        测试
                    </button>
                    <button id="editor-close" style="width:28px;height:28px;border-radius:8px;border:none;background:transparent;cursor:pointer;font-size:18px;color:${colors.textSub};">✕</button>
                </div>
            </div>
            
            <div style="padding:16px 20px;overflow-y:auto;max-height:65vh;">
                <div style="margin-bottom:16px;">
                    <label style="display:block;font-size:11px;font-weight:700;color:${colors.textSub};margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em;">方案名称</label>
                    <input id="editor-plan-name" type="text" value="${escapeHtml(currentPlan.name)}" placeholder="输入方案名称" style="
                        width:100%;
                        padding:10px 12px;
                        border:1px solid ${colors.border};
                        border-radius:10px;
                        font-size:13px;
                        font-weight:600;
                        background:transparent;
                        color:${colors.text};
                        outline:none;
                        box-sizing:border-box;
                    ">
                </div>
                
                <div style="margin-bottom:16px;">
                    <label style="display:block;font-size:11px;font-weight:700;color:${colors.textSub};margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em;">📌 固定提示词</label>
                    <div style="font-size:11px;color:${colors.textSub};margin-bottom:6px;">每次生成都会保留，不会被随机替换</div>
                    <textarea id="editor-fixed-prompt" placeholder="输入固定提示词，如: masterpiece, best quality" style="width:100%;padding:8px;border:1px solid ${colors.border};border-radius:8px;font-size:12px;background:transparent;color:${colors.text};outline:none;resize:none;min-height:56px;font-family:ui-monospace,Menlo,monospace;box-sizing:border-box;">${escapeHtml(currentPlan.fixedPrompt)}</textarea>
                </div>
                
                <div style="margin-bottom:16px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <label style="font-size:11px;font-weight:700;color:${colors.textSub};text-transform:uppercase;letter-spacing:0.05em;">角色</label>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:11px;color:${colors.textSub};">每次随机</span>
                            <input type="number" id="character-count" value="${currentPlan.characterCount}" min="1" max="10" style="width:40px;padding:4px 6px;border:1px solid ${colors.border};border-radius:6px;font-size:11px;text-align:center;background:transparent;color:${colors.text};outline:none;">
                            <span style="font-size:11px;color:${colors.textSub};">个</span>
                            <button id="add-characters" style="padding:4px 10px;border-radius:6px;border:1px solid ${colors.border};background:transparent;cursor:pointer;font-size:11px;font-weight:600;color:${colors.text};">+ 添加</button>
                        </div>
                    </div>
                    <div id="editor-characters" style="
                        min-height:50px;
                        padding:10px;
                        border:1px solid ${colors.border};
                        border-radius:10px;
                        display:flex;
                        flex-wrap:wrap;
                        gap:6px;
                    ">
                        ${renderSelectedItems(currentPlan.characters, 'character')}
                    </div>
                </div>
                
                <div style="margin-bottom:16px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <label style="font-size:11px;font-weight:700;color:${colors.textSub};text-transform:uppercase;letter-spacing:0.05em;">画师</label>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:11px;color:${colors.textSub};">每次随机</span>
                            <input type="number" id="artist-count" value="${currentPlan.artistCount}" min="1" max="10" style="width:40px;padding:4px 6px;border:1px solid ${colors.border};border-radius:6px;font-size:11px;text-align:center;background:transparent;color:${colors.text};outline:none;">
                            <span style="font-size:11px;color:${colors.textSub};">个</span>
                            <button id="add-artists" style="padding:4px 10px;border-radius:6px;border:1px solid ${colors.border};background:transparent;cursor:pointer;font-size:11px;font-weight:600;color:${colors.text};">+ 添加</button>
                        </div>
                    </div>
                    <div id="editor-artists" style="
                        min-height:50px;
                        padding:10px;
                        border:1px solid ${colors.border};
                        border-radius:10px;
                        display:flex;
                        flex-wrap:wrap;
                        gap:6px;
                    ">
                        ${renderSelectedItems(currentPlan.artists, 'artist')}
                    </div>
                </div>
                
                <div style="margin-bottom:16px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <label style="font-size:11px;font-weight:700;color:${colors.textSub};text-transform:uppercase;letter-spacing:0.05em;">预设</label>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="font-size:11px;color:${colors.textSub};">每次随机</span>
                            <input type="number" id="preset-count" value="${currentPlan.presetCount}" min="1" max="10" style="width:40px;padding:4px 6px;border:1px solid ${colors.border};border-radius:6px;font-size:11px;text-align:center;background:transparent;color:${colors.text};outline:none;">
                            <span style="font-size:11px;color:${colors.textSub};">个</span>
                            <button id="add-presets" style="padding:4px 10px;border-radius:6px;border:1px solid ${colors.border};background:transparent;cursor:pointer;font-size:11px;font-weight:600;color:${colors.text};">+ 添加</button>
                        </div>
                    </div>
                    <div id="editor-presets" style="
                        min-height:50px;
                        padding:10px;
                        border:1px solid ${colors.border};
                        border-radius:10px;
                        display:flex;
                        flex-wrap:wrap;
                        gap:6px;
                    ">
                        ${renderSelectedItems(currentPlan.presets, 'preset')}
                    </div>
                </div>
            </div>
            
            <div style="padding:12px 20px;border-top:1px solid ${colors.border};display:flex;gap:8px;justify-content:flex-end;">
                <button id="editor-cancel" style="padding:10px 20px;border-radius:10px;border:1px solid ${colors.border};background:transparent;cursor:pointer;font-size:12px;font-weight:700;color:${colors.text};">取消</button>
                <button id="editor-save" style="padding:10px 20px;border-radius:10px;border:none;background:${colors.accent};cursor:pointer;font-size:12px;font-weight:700;color:#fff;">保存方案</button>
            </div>
        `;
        
        // 绑定关闭按钮
        editor.querySelector('#editor-close').addEventListener('click', () => {
            editor.remove();
            document.getElementById('random-main-panel').style.display = 'block';
        });
        
        // 绑定取消按钮
        editor.querySelector('#editor-cancel').addEventListener('click', () => {
            editor.remove();
            document.getElementById('random-main-panel').style.display = 'block';
        });
        
        // 绑定保存按钮
        editor.querySelector('#editor-save').addEventListener('click', () => {
            savePlanFromEditor();
        });
        
        // 绑定测试按钮
        editor.querySelector('#editor-test').addEventListener('click', () => {
            testCurrentPlan();
        });
        
        // 绑定固定提示词输入
        editor.querySelector('#editor-fixed-prompt').addEventListener('input', (e) => {
            currentPlan.fixedPrompt = e.target.value;
        });
        
        // 绑定添加角色按钮
        editor.querySelector('#add-characters').addEventListener('click', () => {
            openPickerForEditor('character');
        });
        
        // 绑定添加画师按钮
        editor.querySelector('#add-artists').addEventListener('click', () => {
            openPickerForEditor('artist');
        });
        
        // 绑定添加预设按钮
        editor.querySelector('#add-presets').addEventListener('click', () => {
            openPickerForEditor('preset');
        });
        
        // 绑定数量输入框
        editor.querySelector('#character-count').addEventListener('change', (e) => {
            currentPlan.characterCount = parseInt(e.target.value) || 1;
        });
        editor.querySelector('#artist-count').addEventListener('change', (e) => {
            currentPlan.artistCount = parseInt(e.target.value) || 1;
        });
        editor.querySelector('#preset-count').addEventListener('change', (e) => {
            currentPlan.presetCount = parseInt(e.target.value) || 1;
        });
        
        // 绑定移除按钮
        editor.querySelectorAll('.remove-item-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                const name = btn.dataset.name;
                removeItemFromEditor(type, name);
            });
        });
        
        // 绑定拖拽排序
        setupSortable(editor.querySelector('#editor-characters'), 'characters');
        setupSortable(editor.querySelector('#editor-artists'), 'artists');
        setupSortable(editor.querySelector('#editor-presets'), 'presets');
        
        return editor;
    }
    
    // === 拖拽排序 ===
    function setupSortable(container, planKey) {
        if (!container) return;
        let dragIdx = null;
        
        container.addEventListener('dragstart', (e) => {
            const item = e.target.closest('.sortable-item');
            if (!item) return;
            dragIdx = parseInt(item.dataset.idx);
            item.style.opacity = '0.4';
            e.dataTransfer.effectAllowed = 'move';
        });
        
        container.addEventListener('dragend', (e) => {
            const item = e.target.closest('.sortable-item');
            if (item) item.style.opacity = '1';
            container.querySelectorAll('.sortable-item').forEach(el => {
                el.style.borderLeft = '';
                el.style.borderRight = '';
            });
            dragIdx = null;
        });
        
        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const target = e.target.closest('.sortable-item');
            if (!target) return;
            container.querySelectorAll('.sortable-item').forEach(el => {
                el.style.borderLeft = '';
                el.style.borderRight = '';
            });
            const rect = target.getBoundingClientRect();
            const mid = rect.left + rect.width / 2;
            if (e.clientX < mid) {
                target.style.borderLeft = '2px solid ' + getThemeColors().accent;
            } else {
                target.style.borderRight = '2px solid ' + getThemeColors().accent;
            }
        });
        
        container.addEventListener('drop', (e) => {
            e.preventDefault();
            const target = e.target.closest('.sortable-item');
            if (!target || dragIdx === null) return;
            const targetIdx = parseInt(target.dataset.idx);
            if (dragIdx === targetIdx) return;
            
            const arr = currentPlan[planKey];
            const [moved] = arr.splice(dragIdx, 1);
            const rect = target.getBoundingClientRect();
            const mid = rect.left + rect.width / 2;
            let insertIdx = e.clientX < mid ? targetIdx : targetIdx + 1;
            if (dragIdx < targetIdx) insertIdx--;
            arr.splice(insertIdx, 0, moved);
            
            updateEditorDisplay();
        });
    }
    
    // === 渲染已选项目 ===
    function renderSelectedItems(items, type) {
        const colors = getThemeColors();
        
        if (!items || items.length === 0) {
            return `<div style="color:${colors.textSub};font-size:11px;">暂未选择，点击上方"+ 添加"按钮</div>`;
        }
        
        return items.map((item, idx) => `
            <div class="sortable-item" draggable="true" data-type="${type}" data-idx="${idx}" style="
                display:inline-flex;
                align-items:center;
                gap:4px;
                padding:4px 10px;
                border-radius:6px;
                background:${colors.accent}20;
                font-size:11px;
                font-weight:600;
                color:${colors.accent};
                cursor:grab;
                user-select:none;
                transition:opacity 0.15s, transform 0.15s;
            ">
                <span style="opacity:0.4;font-size:10px;letter-spacing:1px;">⋮⋮</span>
                <span>${escapeHtml(item)}</span>
                <button class="remove-item-btn" data-type="${type}" data-name="${escapeHtml(item)}" style="
                    width:14px;
                    height:14px;
                    border-radius:50%;
                    border:none;
                    background:${colors.accent}40;
                    color:${colors.accent};
                    cursor:pointer;
                    font-size:10px;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    padding:0;
                    line-height:1;
                ">✕</button>
            </div>
        `).join('');
    }
    
    // === 当前正在编辑的类型 ===
    let currentPickerType = null;
    let pickerConfirmControl = null;
    let editorPanel = null;
    
    // === 创建确认控件 ===
    function createConfirmControl(type) {
        const colors = getThemeColors();
        
        // 创建悬浮确认控件
        const control = document.createElement('div');
        control.id = 'picker-confirm-control';
        control.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 20px;
            background: ${colors.bg};
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
            z-index: 10002;
            display: flex;
            align-items: center;
            gap: 12px;
        `;
        
        const typeNames = { character: '角色', artist: '画师', preset: '预设' };
        
        control.innerHTML = `
            <span style="font-size:13px;font-weight:600;color:${colors.text};">已选择${typeNames[type] || type}，点击确认添加</span>
            <button id="picker-confirm-btn" style="padding:8px 16px;border-radius:8px;border:none;background:${colors.success};color:#fff;cursor:pointer;font-size:12px;font-weight:700;">✓ 确认</button>
            <button id="picker-cancel-btn" style="padding:8px 16px;border-radius:8px;border:1px solid ${colors.border};background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:${colors.text};">取消</button>
        `;
        
        document.body.appendChild(control);
        
        // 绑定确认按钮
        control.querySelector('#picker-confirm-btn').addEventListener('click', () => {
            console.log('[RandomPrompt] 确认按钮被点击，currentPickerType:', currentPickerType);
            
            // 如果是预设类型，需要手动获取选中的预设
            if (currentPickerType === 'preset' && typeof presetPickerSelected !== 'undefined') {
                const selectedPresets = presetPickerSelected.slice();
                console.log('[RandomPrompt] 从 presetPickerSelected 获取预设:', selectedPresets);
                
                // 关闭选择器（不调用 apply）
                const modal = document.getElementById('presetPickerModal');
                if (modal) modal.style.display = 'none';
                
                // 移除确认控件
                if (pickerConfirmControl) {
                    pickerConfirmControl.remove();
                    pickerConfirmControl = null;
                }
                
                // 显示编辑器面板
                showEditorPanel();
                
                // 添加选中的预设到方案
                if (selectedPresets.length > 0 && currentPlan) {
                    console.log('[RandomPrompt] 添加预设:', selectedPresets);
                    selectedPresets.forEach(item => {
                        const name = item.name || item.id || '';
                        if (name && !currentPlan.presets.includes(name)) {
                            currentPlan.presets.push(name);
                        }
                    });
                    updateEditorDisplay();
                }
                currentPickerType = null;
            } else if (currentPickerType === 'artist' && typeof artistPickerSelected !== 'undefined') {
                // 画师类型，需要手动获取选中的画师
                const selectedArtists = artistPickerSelected.slice();
                console.log('[RandomPrompt] 从 artistPickerSelected 获取画师:', selectedArtists);
                
                // 关闭选择器（不调用 apply）
                const modal = document.getElementById('artistPickerModal');
                if (modal) modal.style.display = 'none';
                
                // 移除确认控件
                if (pickerConfirmControl) {
                    pickerConfirmControl.remove();
                    pickerConfirmControl = null;
                }
                
                // 显示编辑器面板
                showEditorPanel();
                
                // 添加选中的画师到方案
                if (selectedArtists.length > 0 && currentPlan) {
                    console.log('[RandomPrompt] 添加画师:', selectedArtists);
                    selectedArtists.forEach(item => {
                        const name = typeof item === 'string' ? item : item.name || item.danbooru_tag || '';
                        // 去掉 @ 前缀
                        const cleanName = name.replace(/^@/, '');
                        if (cleanName && !currentPlan.artists.includes(cleanName)) {
                            currentPlan.artists.push(cleanName);
                        }
                    });
                    updateEditorDisplay();
                }
                currentPickerType = null;
            } else {
                // 角色类型，关闭选择器并应用
                pickerClose();
            }
        });
        
        // 绑定取消按钮
        control.querySelector('#picker-cancel-btn').addEventListener('click', () => {
            console.log('[RandomPrompt] 取消按钮被点击');
            // 关闭选择器不应用
            currentPickerType = null; // 标记为取消
            pickerClose();
        });
        
        return control;
    }
    
    // === 隐藏/显示编辑器面板 ===
    function hideEditorPanel() {
        editorPanel = document.getElementById('random-plan-editor');
        if (editorPanel) {
            editorPanel.style.display = 'none';
        }
    }
    
    function showEditorPanel() {
        if (editorPanel) {
            editorPanel.style.display = 'block';
            editorPanel = null;
        }
    }
    
    // === 打开选择器 ===
    function openPickerForEditor(type) {
        currentPickerType = type;
        
        // 隐藏编辑器面板
        hideEditorPanel();
        
        // 创建确认控件
        pickerConfirmControl = createConfirmControl(type);
        
        // 使用选择器的回调函数获取选中结果
        if (type === 'character' && typeof pickerOpen === 'function') {
            pickerOpen(function(selectedItems, applyText) {
                console.log('[RandomPrompt] 角色选择器回调，selectedItems:', selectedItems, 'currentPickerType:', currentPickerType);
                // 移除确认控件
                if (pickerConfirmControl) {
                    pickerConfirmControl.remove();
                    pickerConfirmControl = null;
                }
                
                // 显示编辑器面板
                showEditorPanel();
                
                // 只有在确认模式下才添加
                if (currentPickerType === 'character' && selectedItems && selectedItems.length > 0 && currentPlan) {
                    console.log('[RandomPrompt] 添加角色:', selectedItems);
                    selectedItems.forEach(item => {
                        const name = typeof item === 'string' ? item : item.name || item.id;
                        if (name && !currentPlan.characters.includes(name)) {
                            currentPlan.characters.push(name);
                        }
                    });
                    updateEditorDisplay();
                } else {
                    console.log('[RandomPrompt] 跳过添加，currentPickerType:', currentPickerType, 'selectedItems:', selectedItems);
                }
                currentPickerType = null;
            });
        } else if (type === 'artist' && typeof artistPickerOpen === 'function') {
            // 画师选择器需要特殊处理，因为 artistPickerOpen 不返回选中列表
            // 我们在确认时从 artistPickerSelected 获取
            artistPickerOpen(null);
        } else if (type === 'preset' && typeof presetPickerOpen === 'function') {
            // 标签预设选择器（不使用回调，直接从 presetPickerSelected 获取）
            presetPickerOpen(null);
        } else {
            // 选择器未加载，恢复面板
            if (pickerConfirmControl) {
                pickerConfirmControl.remove();
                pickerConfirmControl = null;
            }
            showEditorPanel();
            alert('选择器未加载');
        }
    }
    
    // === 更新编辑器显示 ===
    function updateEditorDisplay() {
        const editor = document.getElementById('random-plan-editor');
        if (!editor || !currentPlan) return;
        
        const charContainer = editor.querySelector('#editor-characters');
        const artistContainer = editor.querySelector('#editor-artists');
        const presetContainer = editor.querySelector('#editor-presets');
        
        if (charContainer) {
            charContainer.innerHTML = renderSelectedItems(currentPlan.characters, 'character');
        }
        if (artistContainer) {
            artistContainer.innerHTML = renderSelectedItems(currentPlan.artists, 'artist');
        }
        if (presetContainer) {
            presetContainer.innerHTML = renderSelectedItems(currentPlan.presets, 'preset');
        }
        
        // 重新绑定移除按钮
        editor.querySelectorAll('.remove-item-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                const name = btn.dataset.name;
                removeItemFromEditor(type, name);
            });
        });
        
        // 重新绑定拖拽排序
        setupSortable(charContainer, 'characters');
        setupSortable(artistContainer, 'artists');
        setupSortable(presetContainer, 'presets');
    }
    
    // === 从编辑器移除项目 ===
    function removeItemFromEditor(type, name) {
        if (!currentPlan) return;
        
        if (type === 'character') {
            currentPlan.characters = currentPlan.characters.filter(c => c !== name);
        } else if (type === 'artist') {
            currentPlan.artists = currentPlan.artists.filter(a => a !== name);
        } else if (type === 'preset') {
            currentPlan.presets = currentPlan.presets.filter(p => p !== name);
        }
        
        updateEditorDisplay();
    }
    
    // === 从编辑器保存方案 ===
    function savePlanFromEditor() {
        const editor = document.getElementById('random-plan-editor');
        if (!editor || !currentPlan) return;
        
        const nameInput = editor.querySelector('#editor-plan-name');
        const name = nameInput.value.trim();
        
        if (!name) {
            alert('请输入方案名称');
            return;
        }
        
        if (currentPlan.characters.length === 0 && currentPlan.artists.length === 0 && currentPlan.presets.length === 0) {
            alert('请至少选择一个角色、画师或预设');
            return;
        }
        
        // 保存方案
        plans[name] = {
            name: name,
            characters: currentPlan.characters,
            artists: currentPlan.artists,
            presets: currentPlan.presets,
            lora: currentPlan.lora,
            characterCount: currentPlan.characterCount,
            artistCount: currentPlan.artistCount,
            presetCount: currentPlan.presetCount,
            fixedPrompt: currentPlan.fixedPrompt || ''
        };
        
        savePlans();
        
        // 关闭编辑器，返回主面板
        editor.remove();
        document.getElementById('random-main-panel').style.display = 'block';
        renderPlanList();
        
        currentPlan = null;
    }
    
    // === 删除方案 ===
    function deletePlan(name) {
        delete plans[name];
        savePlans();
        renderPlanList();
    }
    
    // === 应用方案 ===
    async function applyPlan(name) {
        const plan = plans[name];
        if (!plan) return;
        
        try {
            // 构建配置
            const config = {
                character: {
                    enabled: plan.characters && plan.characters.length > 0,
                    names: plan.characters,
                    count: plan.characterCount || 1
                },
                artist: {
                    enabled: plan.artists && plan.artists.length > 0,
                    names: plan.artists,
                    count: plan.artistCount || 1
                },
                preset: {
                    enabled: plan.presets && plan.presets.length > 0,
                    names: plan.presets,
                    count: plan.presetCount || 1
                },
                lora: { enabled: plan.lora || false }
            };
            
            const res = await fetch(`${API_BASE}/apply-plan`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + (window.AUTH_TOKEN || '')
                },
                body: JSON.stringify(config)
            });
            
            const result = await res.json();
            
            // 构建提示词
            let positive = buildPrompt(result);
            
            // 拼接方案的固定提示词
            if (plan.fixedPrompt && plan.fixedPrompt.trim()) {
                const fixed = plan.fixedPrompt.trim();
                const random = positive.trim();
                const parts = [...fixed.split(',').map(s => s.trim()), ...random.split(',').map(s => s.trim())];
                const seen = new Set();
                const merged = parts.filter(p => {
                    if (!p) return false;
                    const lower = p.toLowerCase();
                    if (seen.has(lower)) return false;
                    seen.add(lower);
                    return true;
                });
                positive = merged.join(', ');
            }
            
            // 调用回调
            if (onApplyCallback) {
                onApplyCallback({ positive, negative: '', raw: result });
            }
            
            // 关闭面板
            document.getElementById('random-main-panel').style.display = 'none';
            showToast('已应用方案: ' + name, 'success');
            
        } catch (e) {
            console.error('[RandomPrompt] 应用方案失败:', e);
            showToast('应用失败: ' + e.message, 'error');
        }
    }
    
    // === 快速随机 ===
    async function quickRandom() {
        const planNames = Object.keys(plans);
        
        if (planNames.length === 0) {
            alert('请先创建一个方案');
            return;
        }
        
        // 随机选择一个方案
        const randomPlanName = planNames[Math.floor(Math.random() * planNames.length)];
        await applyPlan(randomPlanName);
    }
    
    // === 测试当前编辑的方案 ===
    async function testCurrentPlan() {
        if (!currentPlan) return;
        
        const hasContent = (currentPlan.characters && currentPlan.characters.length > 0)
            || (currentPlan.artists && currentPlan.artists.length > 0)
            || (currentPlan.presets && currentPlan.presets.length > 0);
        
        if (!hasContent) {
            showToast('请先添加角色、画师或预设', 'error');
            return;
        }
        
        const btn = document.getElementById('editor-test');
        const origHTML = btn ? btn.innerHTML : '';
        if (btn) { btn.innerHTML = '生成中…'; btn.disabled = true; }
        
        try {
            const config = {
                character: {
                    enabled: currentPlan.characters && currentPlan.characters.length > 0,
                    names: currentPlan.characters,
                    count: currentPlan.characterCount || 1
                },
                artist: {
                    enabled: currentPlan.artists && currentPlan.artists.length > 0,
                    names: currentPlan.artists,
                    count: currentPlan.artistCount || 1
                },
                preset: {
                    enabled: currentPlan.presets && currentPlan.presets.length > 0,
                    names: currentPlan.presets,
                    count: currentPlan.presetCount || 1
                },
                lora: { enabled: currentPlan.lora || false }
            };
            
            const res = await fetch(`${API_BASE}/apply-plan`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + (window.AUTH_TOKEN || '')
                },
                body: JSON.stringify(config)
            });
            
            const result = await res.json();
            let positive = buildPrompt(result);
            
            // 拼接当前编辑的固定提示词
            if (currentPlan.fixedPrompt && currentPlan.fixedPrompt.trim()) {
                const fixed = currentPlan.fixedPrompt.trim();
                const random = positive.trim();
                const parts = [...fixed.split(',').map(s => s.trim()), ...random.split(',').map(s => s.trim())];
                const seen = new Set();
                const merged = parts.filter(p => {
                    if (!p) return false;
                    const lower = p.toLowerCase();
                    if (seen.has(lower)) return false;
                    seen.add(lower);
                    return true;
                });
                positive = merged.join(', ');
            }
            
            // 覆盖到提示词框
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
    
    // === 构建提示词 ===
    function buildPrompt(result) {
        const parts = [];
        
        // 角色
        if (result.character) {
            if (result.character.trigger) {
                parts.push(result.character.trigger);
            } else if (result.character.name) {
                parts.push(result.character.name);
            }
        }
        
        // 画师
        if (result.artist) {
            if (Array.isArray(result.artist)) {
                result.artist.forEach(a => {
                    if (a.danbooru_tag) parts.push(a.danbooru_tag);
                });
            } else if (result.artist.danbooru_tag) {
                parts.push(result.artist.danbooru_tag);
            }
        }
        
        // 预设
        if (result.preset) {
            if (result.preset.prompt) {
                parts.push(result.preset.prompt);
            }
        }
        
        return parts.join(', ');
    }
    
    // === 加载方案 ===
    function loadPlans() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                plans = JSON.parse(saved);
            }
            // 加载自动随机设置
            autoRandomEnabled = localStorage.getItem(AUTO_RANDOM_KEY) === 'true';
            autoRandomPlanName = localStorage.getItem(AUTO_RANDOM_PLAN_KEY) || '';
            fixedPrompt = localStorage.getItem(FIXED_PROMPT_KEY) || '';
        } catch (e) {
            console.error('[RandomPrompt] 加载方案失败:', e);
            plans = {};
        }
    }
    
    // === 保存方案 ===
    function savePlans() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
        } catch (e) {
            console.error('[RandomPrompt] 保存方案失败:', e);
        }
    }
    
    // === 保存自动随机设置 ===
    function saveAutoRandomSettings() {
        localStorage.setItem(AUTO_RANDOM_KEY, autoRandomEnabled.toString());
        localStorage.setItem(AUTO_RANDOM_PLAN_KEY, autoRandomPlanName);
        localStorage.setItem(FIXED_PROMPT_KEY, fixedPrompt);
    }
    
    // === 切换面板显示 ===
    function togglePanel(panel, forceClose) {
        if (forceClose) {
            panel.style.display = 'none';
        } else {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            if (panel.style.display === 'block') {
                renderPlanList();
            }
        }
    }
    
    // === Toast 提示 ===
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 10px;
            font-size: 12px;
            font-weight: 600;
            z-index: 10001;
            transform: translateX(120%);
            transition: transform 0.3s ease;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#00b4d8'};
            color: #fff;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.style.transform = 'translateX(0)', 10);
        setTimeout(() => {
            toast.style.transform = 'translateX(120%)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    // === 工具函数 ===
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // === 公共 API ===
    return {
        init,
        applyPlan,
        quickRandom,
        getPlans: () => plans,
        getPlan: (name) => plans[name],
        
        // 供生成流程调用：如果启用了自动随机，返回随机结果
        applyAutoRandom: async function() {
            if (!autoRandomEnabled || !autoRandomPlanName || !plans[autoRandomPlanName]) {
                return null;
            }
            console.log('[RandomPrompt] 自动随机应用方案:', autoRandomPlanName);
            const plan = plans[autoRandomPlanName];
            
            try {
                const config = {
                    character: {
                        enabled: plan.characters && plan.characters.length > 0,
                        names: plan.characters,
                        count: plan.characterCount || 1
                    },
                    artist: {
                        enabled: plan.artists && plan.artists.length > 0,
                        names: plan.artists,
                        count: plan.artistCount || 1
                    },
                    preset: {
                        enabled: plan.presets && plan.presets.length > 0,
                        names: plan.presets,
                        count: plan.presetCount || 1
                    },
                    lora: { enabled: plan.lora || false }
                };
                
                const res = await fetch(`${API_BASE}/apply-plan`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + (window.AUTH_TOKEN || '')
                    },
                    body: JSON.stringify(config)
                });
                
                const result = await res.json();
                let positive = buildPrompt(result);
                
                // 拼接方案的固定提示词
                if (plan.fixedPrompt && plan.fixedPrompt.trim()) {
                    const fixed = plan.fixedPrompt.trim();
                    const random = positive.trim();
                    // 合并并去重
                    const parts = [...fixed.split(',').map(s => s.trim()), ...random.split(',').map(s => s.trim())];
                    const seen = new Set();
                    const merged = parts.filter(p => {
                        if (!p) return false;
                        const lower = p.toLowerCase();
                        if (seen.has(lower)) return false;
                        seen.add(lower);
                        return true;
                    });
                    positive = merged.join(', ');
                }
                
                console.log('[RandomPrompt] 自动随机结果:', positive);
                return { positive, raw: result };
            } catch (e) {
                console.error('[RandomPrompt] 自动随机失败:', e);
                return null;
            }
        },
        
        // 检查是否启用了自动随机
        isAutoRandomEnabled: () => autoRandomEnabled && autoRandomPlanName
    };
})();
