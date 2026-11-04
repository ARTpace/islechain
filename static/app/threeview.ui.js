/* 三视图 · 控制条与参数面板
 * ------------------------------------------------------------------
 * 形态：
 *   [模型/工作流 ▾] [⚡生成]      ← 一行工具条
 *   视角预设 / 一致性 / 步数 / 宽高种子   ← 直接铺在右栏（.is-inline，不开浮层）
 *   两行摘要
 * 这里只管「读配置 → 渲染控件 + 同步摘要」，不碰工作流与提交。
 */
(function () {
    const ENGINES = window.TV_ENGINES;
    const PRESETS = window.TV_PRESETS;
    const $ = id => document.getElementById(id);

    const state = {
        engine: Object.keys(ENGINES)[0],
        preset: Object.keys(PRESETS)[0],
        steps: 0
    };

    function currentEngine() { return ENGINES[state.engine] || ENGINES[Object.keys(ENGINES)[0]]; }
    function presetMap() { return currentEngine().presets || PRESETS; }
    function currentPreset() {
        const map = presetMap();
        return map[state.preset] || map[Object.keys(map)[0]];
    }

    /* ---------- 引擎菜单（模型 / 工作流切换） ---------- */
    function renderEngineMenu() {
        const menu = $('engineMenu');
        menu.innerHTML = Object.keys(ENGINES).map(id => {
            const e = ENGINES[id];
            return `<button type="button" class="gen-menu-item" role="menuitemradio"
                        aria-checked="${id === state.engine}" data-engine="${id}">
                        <i data-lucide="boxes"></i>
                        <span class="gen-menu-text">${e.label}
                            <span class="gen-menu-sub">${e.views.length} 视角 · ${e.defaults.steps} 步</span>
                        </span>
                        <i data-lucide="check" class="gen-menu-check"></i>
                    </button>`;
        }).join('');
        if (typeof lucide !== 'undefined') lucide.createIcons();
        menu.querySelectorAll('[data-engine]').forEach(btn => {
            btn.onclick = () => selectEngine(btn.dataset.engine);
        });
    }

    function selectEngine(id) {
        if (!ENGINES[id]) return;
        state.engine = id;
        const map = presetMap();
        if (!map[state.preset]) state.preset = Object.keys(map)[0];
        applyDefaults();
        syncAll();
        closeMenu();
    }

    function openMenu() {
        const menu = $('engineMenu'), btn = $('engineBtn');
        renderEngineMenu();
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        if (window.GenerationMenuPosition) GenerationMenuPosition.place(menu, btn, { width: 320 });
    }
    function closeMenu() {
        $('engineMenu').hidden = true;
        $('engineBtn').setAttribute('aria-expanded', 'false');
    }

    /* ---------- 预设 / 步数 段控 ---------- */
    function renderPresetSeg() {
        const map = presetMap();
        const seg = $('presetSeg');
        seg.innerHTML = Object.entries(map).map(([key, p]) =>
            `<button type="button" data-preset="${key}" aria-pressed="${key === state.preset}">${p.badge}</button>`
        ).join('');
        seg.querySelectorAll('[data-preset]').forEach(btn => {
            btn.onclick = () => { state.preset = btn.dataset.preset; syncAll(); };
        });
    }

    function renderStepsSeg() {
        const d = currentEngine().defaults || {};
        const list = Array.from(new Set([2, 4, 6, 8, 12, Number(d.steps) || 4]))
            .filter(n => n >= 2).sort((a, b) => a - b);
        const seg = $('stepsSeg');
        seg.innerHTML = list.map(n =>
            `<button type="button" data-steps="${n}" aria-pressed="${n === state.steps}">${n}</button>`
        ).join('');
        seg.querySelectorAll('[data-steps]').forEach(btn => {
            btn.onclick = () => { state.steps = Number(btn.dataset.steps); syncAll(); };
        });
    }

    /* ---------- 同步：标题 / 能力显隐 / 两行摘要 ---------- */
    function syncAll() {
        const e = currentEngine();
        const d = e.defaults || {};

        $('engineBtnText').textContent = e.label;
        $('engineBtn').title = e.note || '切换模型 / 工作流';

        // 能力开关：一个 supports 字段控制一组控件显隐，不用改 DOM
        document.querySelectorAll('[data-cap]').forEach(el => {
            el.style.display = (e.supports && e.supports[el.dataset.cap] === false) ? 'none' : '';
        });

        $('loraVal').textContent = Number(parseFloat($('loraRange').value) || d.consistency).toFixed(2);
        renderPresetSeg();
        renderStepsSeg();
        syncSummary();
    }

    /* 摘要只保留两行（用户明确要求）：
     *   1) 视角名 → 张数
     *   2) 尺寸 · 步数 · 预计耗时
     * 宽高改动只走这里，避免每按一次数字就重建整个段控。
     */
    function syncSummary() {
        const e = currentEngine();
        const d = e.defaults || {};
        const w = parseInt($('widthInput').value, 10) || d.width;
        const h = parseInt($('heightInput').value, 10) || d.height;
        const size = (e.supports && e.supports.size === false) ? '引擎固定尺寸' : `${w} × ${h}`;
        const steps = state.steps || d.steps;

        $('metaViews').textContent = `${e.views.join(' · ')} → ${e.views.length} 张`;
        $('metaSpecs').textContent = `${size} · ${steps} 步 · 约 ${estimateSec(e, steps)} 秒`;
    }

    /* 耗时估算：引擎可给 secPerStep（每张每步秒数），没给就按 7.5 秒估。
     * 4 步 × 3 视角 → 90 秒，与本地 3080Ti 实测（70~93 秒）对得上。 */
    function estimateSec(engine, steps) {
        const per = Number(engine.secPerStep) || 7.5;
        const raw = steps * (engine.views || []).length * per;
        return Math.max(5, Math.round(raw / 5) * 5);
    }

    function applyDefaults() {
        const d = currentEngine().defaults || {};
        const set = (id, v) => { if (v !== undefined && $(id)) $(id).value = v; };
        set('loraRange', d.consistency);
        set('widthInput', d.width);
        set('heightInput', d.height);
        set('seedInput', d.seed);
        state.steps = Number(d.steps) || 4;
    }

    /* ---------- 参数读取（提交时唯一入口） ---------- */
    function readParams() {
        const d = currentEngine().defaults || {};
        const num = (id, def) => parseInt($(id).value, 10) || def;
        return {
            consistency: parseFloat($('loraRange').value) || d.consistency,
            steps: Math.max(2, Math.min(60, state.steps || d.steps)),
            width: Math.max(512, Math.min(2048, num('widthInput', d.width))),
            height: Math.max(512, Math.min(2048, num('heightInput', d.height))),
            seed: Math.max(0, num('seedInput', d.seed))
        };
    }

    function randomizeSeed() {
        $('seedInput').value = Math.floor(Math.random() * 1000000000000000);
    }

    /* ---------- 事件绑定 ---------- */
    function bind() {
        $('engineBtn').setAttribute('aria-expanded', 'false');
        $('engineBtn').onclick = e => {
            e.stopPropagation();
            if ($('engineMenu').hidden) openMenu(); else closeMenu();
        };

        document.addEventListener('click', e => {
            if (!e.target.closest('#engineMenu, #engineBtn')) closeMenu();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeMenu();
        });
        window.addEventListener('resize', closeMenu);

        $('loraRange').addEventListener('input', () => {
            $('loraVal').textContent = Number($('loraRange').value).toFixed(2);
        });
        ['widthInput', 'heightInput'].forEach(id =>
            $(id).addEventListener('input', syncSummary));
        $('seedRandomBtn').onclick = randomizeSeed;
    }

    window.TVUI = {
        init() { applyDefaults(); syncAll(); bind(); renderEngineMenu(); },
        refresh: syncAll,
        currentEngine,
        currentPreset,
        readParams,
        engineId: () => state.engine,
        presetKey: () => state.preset
    };
})();
