/**
 * 提示词翻译 Toggle UI 组件（模块化版）
 * 依赖：window.PromptTranslate（/static/js/prompt-translate.js）
 * 
 * 使用方法：
 *   PromptTranslateUI.init('containerId', {
 *       getText: () => promptEl.value,
 *       onApply: function(text) { promptEl.value = text; },
 *       onLangChange: function(mode) { /* 同步标签语言 *\/ }
 *   });
 */
const PromptTranslateUI = (function() {

    // ─────────────────────────────────────────────
    //  状态
    // ─────────────────────────────────────────────
    let _opts = {};
    let _btn = null;
    let _lastOriginal = null;
    let _lastTranslated = null;

    // ─────────────────────────────────────────────
    //  注入样式
    // ─────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('ptui-style')) return;
        const s = document.createElement('style');
        s.id = 'ptui-style';
        s.textContent = `
            .prompt-translate-corner { width:28px !important; height:28px !important; border:none; border-radius:8px; cursor:pointer; display:none; align-items:center; justify-content:center; padding:0; margin:0; background:rgba(0,0,0,0.08); color:#999; transition:all .15s; line-height:0; box-sizing:border-box; }
            .prompt-translate-corner.ptui-visible { display:flex !important; }
            .prompt-translate-corner[data-state="loading"] svg { animation:ptui-spin 0.6s linear infinite; }
            .prompt-translate-corner[data-state="ok"] { color:#16a34a!important; }
            .prompt-translate-corner[data-state="fail"] { color:#dc2626!important; }
            .prompt-translate-corner:hover { background:rgba(0,180,216,0.12) !important; color:#00b4d8 !important; }
            body.studio-theme-dark .prompt-translate-corner { background:rgba(255,255,255,0.12); color:#6a8fa8; }
            body.studio-theme-dark .prompt-translate-corner:hover { background:rgba(0,240,255,0.12) !important; color:#00f0ff !important; }
            @keyframes ptui-spin { to { transform: rotate(360deg); } }
        `;
        document.head.appendChild(s);
    }

    // ─────────────────────────────────────────────
    //  创建按钮
    // ─────────────────────────────────────────────
    function createButton() {
        const btn = document.createElement('button');
        btn.className = 'prompt-translate-corner';
        btn.title = '翻译提示词（自动同步标签语言）';
        btn.oncontextmenu = (e) => e.preventDefault();
        btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m5 8 6 6"/>
                <path d="m4 14 6-6 2-3"/>
                <path d="M2 5h12"/>
                <path d="M7 2h1"/>
                <path d="m22 22-5-10-5 10"/>
                <path d="M14 18h6"/>
            </svg>`;
        btn.addEventListener('click', handleTranslate);
        return btn;
    }

    // ─────────────────────────────────────────────
    //  设置按钮状态
    // ─────────────────────────────────────────────
    function setState(state) {
        if (!_btn) return;
        _btn.setAttribute('data-state', state || '');
    }

    // ─────────────────────────────────────────────
    //  应用翻译结果
    // ─────────────────────────────────────────────
    function applyResult(text) {
        const normalized = String(text)
            .replace(/[，、；;]/g, ', ')
            .replace(/\s*,\s*/g, ', ')
            .replace(/\s+/g, ' ')
            .trim();
        if (typeof _opts.onApply === 'function') {
            _opts.onApply(normalized);
        }
        // 同步标签语言 + 按钮 data-lang
        const hasChinese = /[\u4e00-\u9fa5]/.test(normalized);
        const mode = hasChinese ? 'cn' : 'en';
        if (_btn) _btn.setAttribute('data-lang', mode);
        if (typeof _opts.onLangChange === 'function') {
            _opts.onLangChange(mode);
        }
    }

    // ─────────────────────────────────────────────
    //  核心翻译逻辑
    // ─────────────────────────────────────────────
    async function handleTranslate(e) {
        if (e) e.stopPropagation();
        if (!_btn) return;
        if (typeof _opts.getText !== 'function') return;
        if (typeof window.PromptTranslate === 'undefined') return;

        const text = _opts.getText().trim();
        if (!text) return;

        // ① Toggle：当前是译文 → 切回原文（0 API）
        if (_lastTranslated !== null && _lastOriginal !== null && text === _lastTranslated) {
            applyResult(_lastOriginal);
            setState('ok');
            setTimeout(() => setState(''), 1200);
            return;
        }
        // ② Toggle：当前是原文 → 切到译文（0 API）
        if (_lastOriginal !== null && _lastTranslated !== null && text === _lastOriginal) {
            applyResult(_lastTranslated);
            setState('ok');
            setTimeout(() => setState(''), 1200);
            return;
        }

        // ③ 都不匹配 → 调用 API 翻译
        setState('loading');
        _btn.disabled = true;
        try {
            const hasChinese = /[\u4e00-\u9fa5]/.test(text);
            const targetDir = hasChinese ? 'zh2en' : 'en2zh';
            if (typeof window.PromptTranslate.setDirection === 'function') {
                window.PromptTranslate.setDirection(targetDir);
            }
            const result = await window.PromptTranslate.translate(text, null, { cacheSource: null });
            if (result) {
                applyResult(result.text);
                _lastOriginal = text;
                _lastTranslated = result.text;
                setState('ok');
            } else {
                setState('fail');
            }
            setTimeout(() => setState(''), 1200);
        } catch (err) {
            console.error('[PromptTranslateUI] 错误:', err);
            setState('fail');
            setTimeout(() => setState(''), 1500);
        } finally {
            _btn.disabled = false;
            _btn.style.opacity = '';
        }
    }

    // ─────────────────────────────────────────────
    //  更新按钮可见性（外部调用：当 prompt 内容变化时）
    // ─────────────────────────────────────────────
    function updateVisibility() {
        if (!_btn) return;
        const hasText = typeof _opts.getText === 'function' && !!_opts.getText().trim();
        _btn.classList.toggle('ptui-visible', hasText);
    }

    // ─────────────────────────────────────────────
    //  公开 API
    // ─────────────────────────────────────────────
    return {
        /**
         * 初始化翻译 Toggle UI
         * @param {string|Element} container  容器 ID 或 DOM 元素
         * @param {object} opts
         * @param {function} opts.getText     读取当前提示词（必需）
         * @param {function} opts.onApply     写入翻译结果（必需）
         * @param {function} [ opts.onLangChange ] 语言模式变化回调 (mode: 'cn'|'en')
         */
        init: function(container, opts = {}) {
            const el = typeof container === 'string' ? document.getElementById(container) : container;
            if (!el) { console.error('[PromptTranslateUI] 容器不存在:', container); return; }
            _opts = opts;
            injectStyles();
            _btn = createButton();
            el.appendChild(_btn);
            // 初始 data-lang
            const initialText = typeof _opts.getText === 'function' ? _opts.getText() : '';
            _btn.setAttribute('data-lang', /[\u4e00-\u9fa5]/.test(initialText) ? 'cn' : 'en');
            // 初始隐藏（无文本时不显示）
            updateVisibility();
        },

        /** 获取按钮元素（外部样式微调） */
        getButton: () => _btn,

        /** 更新可见性（在 prompt input 事件中调用） */
        updateVisibility,

        /** 手动触发翻译（外部调用） */
        translate: function() { if (_btn) handleTranslate(); }
    };
})();
