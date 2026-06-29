/**
 * 智能提示词生成组件（模块化版）
 * 支持自定义挂载、回调解耦，可接入任何工具页面
 * 
 * 使用方法：
 * SmartPrompt.init('containerId', {
 *     getText: () => promptEl.value,
 *     setText: (text) => { promptEl.value = text; },
 *     onResult: (text, data) => { /* 可选 *\/ },
 *     onError: (err) => { /* 可选 *\/ }
 * });
 */
const SmartPrompt = (function() {

    // === 默认配置 ===
    const DEFAULTS = {
        apiEndpoint: '/api/smart-prompt',
        buttonText: 'AI 生成',
        loadingText: '生成中...',
        placeholder: '请先输入中文描述'
    };

    // === 状态 ===
    let options = {};
    let btn = null;

    // ─────────────────────────────────────────────
    //  注入长按动效样式
    // ─────────────────────────────────────────────
    function injectAnimStyles() {
        if (document.getElementById('smart-prompt-anim-style')) return;
        const style = document.createElement('style');
        style.id = 'smart-prompt-anim-style';
        style.textContent = `
            @keyframes sp-long-press-pulse {
                0% { transform: scale(1); }
                40% { transform: scale(1.06); box-shadow: 0 0 0 4px rgba(0,240,255,0.2); }
                70% { transform: scale(1.03); box-shadow: 0 0 0 8px rgba(0,240,255,0.1); }
                100% { transform: scale(1.1); box-shadow: 0 0 0 12px rgba(0,240,255,0); }
            }
            .sp-long-press-active {
                animation: sp-long-press-pulse 0.45s ease-in-out infinite alternate !important;
                position: relative;
                overflow: visible;
            }
            .sp-long-press-active::after {
                content: '';
                position: absolute;
                inset: -3px;
                border-radius: 12px;
                border: 2px solid rgba(0,240,255,0.35);
                animation: sp-long-press-pulse 0.55s ease-out infinite;
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }

    // ─────────────────────────────────────────────
    //  主题检测
    // ─────────────────────────────────────────────
    function isDarkTheme() {
        return document.body.classList.contains('studio-theme-dark') ||
            document.documentElement.classList.contains('studio-theme-dark') ||
            document.body.classList.contains('theme-dark') ||
            document.documentElement.classList.contains('theme-dark');
    }

    // ─────────────────────────────────────────────
    //  注入样式
    // ─────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('smart-prompt-style')) return;
        const style = document.createElement('style');
        style.id = 'smart-prompt-style';
        style.textContent = `
            .smart-prompt-btn {
                display:inline-flex;align-items:center;gap:6px;
                height:32px;padding:0 14px;border-radius:10px;
                font-size:11px;font-weight:700;cursor:pointer;
                background:rgba(0,0,0,0.06);color:#000;
                border:1px solid rgba(0,0,0,0.1);
                transition:all 0.2s;white-space:nowrap;flex-shrink:0;
            }
            .smart-prompt-btn:hover {
                background:rgba(0,0,0,0.1);transform:translateY(-1px);
                box-shadow:0 4px 12px rgba(0,0,0,0.08);
            }
            .smart-prompt-btn:disabled {
                opacity:0.5;cursor:not-allowed;transform:none;box-shadow:none;
            }
            body.studio-theme-dark .smart-prompt-btn,
            body.theme-dark .smart-prompt-btn {
                background:rgba(0,240,255,0.1);color:#00f0ff;
                border-color:rgba(0,240,255,0.2);
            }
            body.studio-theme-dark .smart-prompt-btn:hover,
            body.theme-dark .smart-prompt-btn:hover {
                background:rgba(0,240,255,0.18);
                box-shadow:0 4px 12px rgba(0,240,255,0.15);
            }
        `;
        document.head.appendChild(style);
    }

    // ─────────────────────────────────────────────
    //  创建按钮
    // ─────────────────────────────────────────────
    function createButton() {
        const btn = document.createElement('button');
        btn.className = 'smart-prompt-btn';
        btn.title = '智能生成标签';
        btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/>
                <circle cx="12" cy="15" r="2"/>
            </svg>
            <span class="btn-text">${escapeHtml(options.buttonText)}</span>
        `;

        // ---- 短按：生成 AI 提示词 ----
        btn.addEventListener('click', handleGenerate);

        // ---- 长按：弹出预设选择 ----
        let pressTimer = null;
        let isLongPress = false;

        function startPress() {
            isLongPress = false;
            btn.classList.add('sp-long-press-active');
            pressTimer = setTimeout(() => {
                isLongPress = true;
                pressTimer = null;
                btn.classList.remove('sp-long-press-active');
                if (typeof options.onLongPress === 'function') {
                    options.onLongPress();
                }
            }, 500);
        }
        function endPress() {
            btn.classList.remove('sp-long-press-active');
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
            isLongPress = false;
        }
        function cancelPress() {
            btn.classList.remove('sp-long-press-active');
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        }

        btn.addEventListener('mousedown', startPress);
        btn.addEventListener('mouseup', endPress);
        btn.addEventListener('mouseleave', cancelPress);
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); startPress(); });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); endPress(); });
        btn.addEventListener('touchcancel', cancelPress);

        return btn;
    }

    // ─────────────────────────────────────────────
    //  核心生成逻辑
    // ─────────────────────────────────────────────
    async function handleGenerate() {
        if (!btn || btn.disabled) return;

        const getText = options.getText;
        const setText = options.setText;
        if (typeof getText !== 'function' || typeof setText !== 'function') {
            console.error('[SmartPrompt] getText/setText 未配置');
            return;
        }

        const userText = getText().trim();
        if (!userText) {
            if (options.onError) {
                options.onError(options.placeholder);
            } else {
                alert(options.placeholder);
            }
            return;
        }

        btn.disabled = true;
        const textSpan = btn.querySelector('.btn-text');
        if (textSpan) textSpan.textContent = options.loadingText;

        try {
            const res = await fetch(options.apiEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: userText })
            });
            const data = await res.json();

            if (data.success && data.prompt) {
                // Ideogram4 模式特殊处理
                const isIdeogram = typeof options.isIdeogram4Mode === 'function' && options.isIdeogram4Mode();
                if (isIdeogram) {
                    try {
                        const parsed = JSON.parse(data.prompt);
                        if (typeof options.setIdeogram4Json === 'function') {
                            options.setIdeogram4Json(data.prompt);
                        }
                        setText(parsed.high_level_description || '');
                    } catch(e) {
                        setText(data.prompt);
                        if (typeof options.setIdeogram4Json === 'function') {
                            options.setIdeogram4Json('');
                        }
                    }
                } else {
                    setText(data.prompt);
                    if (typeof options.setIdeogram4Json === 'function') {
                        options.setIdeogram4Json('');
                    }
                }

                // 同步选择器状态
                if (typeof options.syncPicker === 'function') {
                    options.syncPicker();
                }

                // 触发更新标签
                if (typeof options.onPromptUpdate === 'function') {
                    options.onPromptUpdate();
                }

                // 通知调用方
                if (typeof options.onResult === 'function') {
                    options.onResult(data.prompt, data);
                }
            } else {
                const errMsg = data.error || '生成失败';
                if (options.onError) {
                    options.onError(errMsg);
                } else {
                    alert(errMsg);
                }
            }
        } catch(e) {
            const errMsg = '请求失败: ' + e.message;
            if (options.onError) {
                options.onError(errMsg);
            } else {
                alert(errMsg);
            }
        } finally {
            btn.disabled = false;
            if (textSpan) textSpan.textContent = options.buttonText;
        }
    }

    // ─────────────────────────────────────────────
    //  HTML 转义
    // ─────────────────────────────────────────────
    function escapeHtml(str) {
        const d = document.createElement('div');
        d.appendChild(document.createTextNode(str));
        return d.innerHTML;
    }

    // ─────────────────────────────────────────────
    //  公开 API
    // ─────────────────────────────────────────────
    return {
        /**
         * 初始化智能提示词组件
         * @param {string} containerId  挂载容器元素的 ID
         * @param {object} opts         配置选项
         * @param {function} opts.getText         读取当前提示词（必需）
         * @param {function} opts.setText         写入生成结果（必需）
         * @param {function} [ opts.onResult ]    生成成功回调 (text, data)
         * @param {function} [ opts.onError ]     出错回调 (errorMsg)
         * @param {function} [ opts.isIdeogram4Mode ]  Ideogram4 模式检测
         * @param {function} [ opts.setIdeogram4Json ] 设置 Ideogram4 JSON
         * @param {function} [ opts.syncPicker ]   同步选择器状态
         * @param {function} [ opts.onPromptUpdate ] 更新标签
         * @param {function} [ opts.onLongPress ]    长按回调 (弹出预设选择等)
         * @param {string}   [ opts.apiEndpoint ]  API 地址，默认 '/api/smart-prompt'
         * @param {string}   [ opts.buttonText ]   按钮文字，默认 'AI 生成'
         * @param {string}   [ opts.loadingText ]  加载中文字，默认 '生成中...'
         * @param {string}   [ opts.placeholder ]  空输入提示，默认 '请先输入中文描述'
         */
        init: function(containerId, opts = {}) {
            const container = document.getElementById(containerId);
            if (!container) {
                console.error('[SmartPrompt] 容器不存在:', containerId);
                return;
            }

            options = Object.assign({}, DEFAULTS, opts);
            injectStyles();
            injectAnimStyles();

            btn = createButton();
            container.appendChild(btn);
        },

        /**
         * 获取当前按钮元素（用于外部样式微调等）
         */
        getButton: function() { return btn; },

        /**
         * 触发 AI 生成（外部调用）
         */
        generate: function() {
            if (btn) handleGenerate();
        }
    };
})();
