/*!
 * GenerationControls - 生成参数控制模块
 * 合并种子模式、比例/分辨率、批量生成数量
 *
 * 依赖：无（纯 JS，操作已知 DOM 元素）
 * 加载顺序：在 zimage.html 中 <body> 末尾 script 标签之前加载
 *
 * API:
 *   GenerationControls.init(options)       初始化（读取 localStorage、更新 UI）
 *   GenerationControls.getState()          获取当前状态
 *   GenerationControls.setState(s)         设置状态（用于从历史记录恢复）
 *   GenerationControls.getSize()           计算实际像素尺寸
 *
 *   // 种子
 *   GenerationControls.toggleSeedMode()    切换随机/固定种子
 *   GenerationControls.updateSeedUI()      更新种子 UI
 *   GenerationControls.onSeedInput(v)      种子输入处理
 *
 *   // 比例
 *   GenerationControls.selectRatio(label, w, h)
 *   GenerationControls.compactRatioToggle()
 *
 *   // 分辨率
 *   GenerationControls.selectRes(res)
 *   GenerationControls.compactResToggle()
 *
 *   // 批量
 *   GenerationControls.selectBatchCount(count)
 *   GenerationControls.compactBatchToggle()
 *   GenerationControls.updateBatchCountUI()
 *
 *   // 菜单辅助（提取自 inline closeAllMenus / setActiveMenuItem / toggleMenu）
 *   GenerationControls.setMenuIds(ids)      注册所有菜单 ID
 *   GenerationControls.closeAllMenus()      关闭所有注册的菜单
 *   GenerationControls.toggleMenu(menuId)   切换单个菜单
 *   GenerationControls.setActiveMenuItem(menuId, dataKey, val)  设置菜单选中项
 */
(function (global) {
    'use strict';

    /* ============================================================
     *  状态
     * ============================================================ */
    const _state = {
        seedMode: 'random',   // 'random' | 'fixed'
        fixedSeed: 0,
        ratioW: 9,
        ratioH: 16,
        res: 1,               // 1 = 1K, 2 = 2K, 3 = 3K, 4 = 4K
        batchCount: 1,
    };

    const RATIO_OPTIONS = [['1:1',1,1],['4:3',4,3],['3:4',3,4],['16:9',16,9],['9:16',9,16],['3:2',3,2],['2:3',2,3],['21:9',21,9]];
    const RES_OPTIONS = [1, 2];
    const BATCH_OPTIONS = [1, 2, 3, 4];

    /* ============================================================
     *  菜单辅助（通用：所有 anima-ctrl-wrap 下拉菜单共享）
     * ============================================================ */
    let _allMenuIds = ['batchCountMenu', 'modelMenu', 'engineMenu', 'ratioMenu', 'resMenu', 'qualityMenu', 'booguQualityMenu'];

    function setMenuIds(ids) {
        if (Array.isArray(ids)) _allMenuIds = ids;
    }

    /**
     * 菜单显隐统一走 class 驱动（2026-10-31）。
     * 共享样式表已用 display/opacity/visibility 接管 .anima-ctrl-menu 的显隐，
     * 内联 style.display 会被其 !important 压制而失效，故此处只切 class。
     */
    function setMenuOpen(menu, open) {
        if (!menu) return;
        menu.classList.toggle('is-open', !!open);
        if (!open) {
            // zimage 的统一模型菜单用 force-open 作为展开信号，关闭时一并清除
            menu.classList.remove('force-open');
        }
        // 清除可能残留的内联 display，交回样式表控制
        if (menu.style.display) menu.style.display = '';
    }

    function isMenuOpen(menu) {
        return !!menu && menu.classList.contains('is-open');
    }

    function toggleMenu(menuId) {
        const menu = document.getElementById(menuId);
        if (!menu) return;
        const wasOpen = isMenuOpen(menu);
        closeAllMenus();
        // 强制关闭自身：即使 menuId 不在 _allMenuIds 列表中也能收起，
        // 避免某些菜单（如 booguQualityMenu）点选后无法关闭的问题
        setMenuOpen(menu, false);
        if (!wasOpen) setMenuOpen(menu, true);
    }

    function closeAllMenus() {
        _allMenuIds.forEach(id => {
            const m = document.getElementById(id);
            if (m) setMenuOpen(m, false);
        });
    }

    function setActiveMenuItem(menuId, dataKey, val) {
        const menu = document.getElementById(menuId);
        if (!menu) return;
        const target = String(val);
        menu.querySelectorAll('.anima-ctrl-menu-item').forEach(item => {
            const isActive = item.getAttribute('data-' + dataKey) === target;
            item.classList.toggle('active', isActive);
            const chk = item.querySelector('.chk');
            if (chk) chk.style.opacity = isActive ? '1' : '0';
        });
    }

    /* ============================================================
     *  初始化
     * ============================================================ */
    function init(options) {
        _loadState();
        if (options) {
            if (typeof options.onCloseMenus === 'function') _onCloseMenus = options.onCloseMenus;
            if (typeof options.onSetActiveMenuItem === 'function') _onSetActiveMenuItem = options.onSetActiveMenuItem;
            if (typeof options.isCompact === 'function') _isCompact = options.isCompact;
            if (Array.isArray(options.menuIds)) _allMenuIds = options.menuIds;
        }
        // 初始渲染
        updateSeedUI();
        updateBatchCountUI();
    }

    // 菜单辅助回调（默认使用内置实现，可被覆盖）
    let _onCloseMenus = closeAllMenus;
    let _onSetActiveMenuItem = setActiveMenuItem;
    let _isCompact = function() {
        return document.querySelector('.control-bar')?.classList.contains('compact-toggle') || window.innerWidth <= 900;
    };

    function _loadState() {
        try {
            _state.ratioW = parseInt(localStorage.getItem('anima_ratio_w')) || 9;
            _state.ratioH = parseInt(localStorage.getItem('anima_ratio_h')) || 16;
            _state.res = parseInt(localStorage.getItem('anima_res')) || 1;
        } catch (e) {}
    }

    /* ============================================================
     *  公开 API
     * ============================================================ */

    /** 获取当前状态副本 */
    function getState() {
        return {
            seedMode: _state.seedMode,
            fixedSeed: _state.fixedSeed,
            ratioW: _state.ratioW,
            ratioH: _state.ratioH,
            res: _state.res,
            batchCount: _state.batchCount,
        };
    }

    /** 设置状态（合并方式） */
    function setState(s) {
        if (!s) return;
        if (s.seedMode !== undefined) _state.seedMode = s.seedMode;
        if (s.fixedSeed !== undefined) _state.fixedSeed = s.fixedSeed;
        if (s.ratioW !== undefined) _state.ratioW = s.ratioW;
        if (s.ratioH !== undefined) _state.ratioH = s.ratioH;
        if (s.res !== undefined) _state.res = s.res;
        if (s.batchCount !== undefined) _state.batchCount = s.batchCount;
    }

    /**
     * 根据比例和分辨率计算实际像素尺寸
     * @returns {{ width: number, height: number }}
     */
    function getSize() {
        const baseSize = ({ 1: 1024, 2: 2048, 3: 3072, 4: 4096 })[_state.res] || 1024;
        const ratio = _state.ratioW / _state.ratioH;
        let w, h;
        if (ratio > 1) {
            w = baseSize;
            h = Math.round(baseSize / ratio);
        } else {
            h = baseSize;
            w = Math.round(baseSize * ratio);
        }
        // 确保是 8 的倍数
        w = Math.round(w / 8) * 8;
        h = Math.round(h / 8) * 8;
        return { width: w, height: h };
    }

    /* ---- 种子 ---- */

    function toggleSeedMode() {
        _state.seedMode = _state.seedMode === 'random' ? 'fixed' : 'random';
        updateSeedUI();
    }

    function updateSeedUI() {
        const btn = document.getElementById('seedToggle');
        const inp = document.getElementById('seedInput');
        if (!btn || !inp) return;
        const isFixed = _state.seedMode === 'fixed';
        btn.classList.toggle('seed-locked', isFixed);
        btn.innerHTML = isFixed
            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
            : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>';
        if (isFixed && _state.fixedSeed > 0) inp.value = _state.fixedSeed;
        else if (!isFixed) inp.value = '';
        inp.disabled = !isFixed;
        inp.style.opacity = isFixed ? '1' : '0.5';
        inp.style.cursor = isFixed ? 'text' : 'not-allowed';
    }

    function onSeedInput(v) {
        _state.fixedSeed = parseInt(v) || 0;
    }

    /* ---- 比例 ---- */

    function selectRatio(label, w, h) {
        _state.ratioW = w;
        _state.ratioH = h;
        localStorage.setItem('anima_ratio_w', w);
        localStorage.setItem('anima_ratio_h', h);
        document.getElementById('ratioText').textContent = label;
        _onSetActiveMenuItem('ratioMenu', 'ratio-key', label);
        _onCloseMenus();
    }

    function compactRatioToggle() {
        if (!_isCompact()) return false;
        try {
            const cur = _state.ratioW + ':' + _state.ratioH;
            let idx = RATIO_OPTIONS.findIndex(r => r[0] === cur);
            if (idx < 0) idx = 0;
            const next = (idx + 1) % RATIO_OPTIONS.length;
            const r = RATIO_OPTIONS[next];
            selectRatio(r[0], r[1], r[2]);
        } catch (e) { console.error('compactRatioToggle error:', e); }
        return true;
    }

    /* ---- 分辨率 ---- */

    function selectRes(res) {
        _state.res = res;
        localStorage.setItem('anima_res', res);
        const label = document.getElementById('resText');
        if (label) label.textContent = res + 'K';
        _onSetActiveMenuItem('resMenu', 'res-key', String(res));
        _onCloseMenus();
    }

    function compactResToggle() {
        if (!_isCompact()) return false;
        try {
            let idx = RES_OPTIONS.indexOf(_state.res);
            if (idx < 0) idx = 0;
            const next = (idx + 1) % RES_OPTIONS.length;
            selectRes(RES_OPTIONS[next]);
        } catch (e) { console.error('compactResToggle error:', e); }
        return true;
    }

    /* ---- 批量生成数量 ---- */

    function selectBatchCount(v) {
        _state.batchCount = v;
        updateBatchCountUI();
        _onCloseMenus();
    }

    function updateBatchCountUI() {
        const btn = document.getElementById('batchCountText');
        if (btn) btn.textContent = '×' + _state.batchCount;
        document.querySelectorAll('#batchCountMenu .anima-ctrl-menu-item').forEach(it => {
            const key = parseInt(it.getAttribute('data-batch-key'));
            const chk = it.querySelector('.chk');
            if (chk) chk.style.opacity = (key === _state.batchCount) ? '1' : '0';
        });
    }

    function compactBatchToggle() {
        if (!_isCompact()) return false;
        const idx = BATCH_OPTIONS.indexOf(_state.batchCount);
        const next = (idx + 1) % BATCH_OPTIONS.length;
        selectBatchCount(BATCH_OPTIONS[next]);
        return true;
    }

    /* ============================================================
     *  暴露全局
     * ============================================================ */
    const GC = {
        init,
        getState,
        setState,
        getSize,

        // 种子
        toggleSeedMode,
        updateSeedUI,
        onSeedInput,

        // 比例
        selectRatio,
        compactRatioToggle,

        // 分辨率
        selectRes,
        compactResToggle,

        // 批量
        selectBatchCount,
        updateBatchCountUI,
        compactBatchToggle,

        // 菜单辅助
        setMenuIds,
        closeAllMenus,
        toggleMenu,
        setActiveMenuItem,
    };

    global.GenerationControls = GC;

    /* ============================================================
     *  兼容别名（旧 inline onclick 直接引用）
     * ============================================================ */
    global.toggleSeedMode = GC.toggleSeedMode;
    global.updateSeedUI = GC.updateSeedUI;
    global.onSeedInput = GC.onSeedInput;
    global.selectRatio = GC.selectRatio;
    global.selectRes = GC.selectRes;
    global.getAnimaSize = GC.getSize;
    global.selectBatchCount = GC.selectBatchCount;
    global.updateBatchCountUI = GC.updateBatchCountUI;
    global.compactRatioToggle = GC.compactRatioToggle;
    global.compactResToggle = GC.compactResToggle;
    global.compactBatchToggle = GC.compactBatchToggle;
    global.closeAllMenus = GC.closeAllMenus;
    global.toggleMenu = GC.toggleMenu;
    global.setActiveMenuItem = GC.setActiveMenuItem;

})(window);
