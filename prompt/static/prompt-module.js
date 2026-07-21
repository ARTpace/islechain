/**
 * prompt-module.js — 智能提示词模块（合并版）
 *
 * 合并自：
 *   static/modules/smart-prompt.js      → SmartPrompt 生成组件
 *   static/app/smart-prompt-picker.js   → 预设选择器
 *   static/app/smart-prompt-manager.js  → 预设管理
 *   static/app/smart-prompt-picker.css
 *   static/app/smart-prompt-manager.css
 *
 * 完全向后兼容：所有旧全局函数/变量/对象均暴露在 window 上。
 * 用法与之前完全一致，无需修改任何 HTML 模板。
 */

(function() {
    'use strict';

    // =====================================================================
    //  0. 可配置 API 前缀（默认旧路由，切到新路由只需调用 pmConfig）
    // =====================================================================
    var pmApiPrefix = '/api/prompt-module';

    function pmApi(path) {
        // 返回完整 API URL，path 如 '/presets' 或 '/presets/xxx'
        return pmApiPrefix + path;
    }

    window.pmConfig = function(opts) {
        if (opts && opts.apiPrefix) {
            pmApiPrefix = opts.apiPrefix.replace(/\/$/, '');
        }
    };

    // =====================================================================
    //  1. CSS — 内联，避免 link 标签加载延迟
    // =====================================================================

    function injectStyles() {
        if (document.getElementById('prompt-module-styles')) return;
        const style = document.createElement('style');
        style.id = 'prompt-module-styles';
        style.textContent = [
            /* ---- smart-prompt.js 的按钮样式 ---- */
            '@keyframes sp-long-press-pulse {',
            '0% { transform: scale(1); }',
            '40% { transform: scale(1.06); box-shadow: 0 0 0 4px rgba(0,240,255,0.2); }',
            '70% { transform: scale(1.03); box-shadow: 0 0 0 8px rgba(0,240,255,0.1); }',
            '100% { transform: scale(1.1); box-shadow: 0 0 0 12px rgba(0,240,255,0); }',
            '}',
            '.sp-long-press-active {',
            '    animation: sp-long-press-pulse 0.45s ease-in-out infinite alternate !important;',
            '    position: relative; overflow: visible;',
            '}',
            '.sp-long-press-active::after {',
            '    content: \'\'; position: absolute; inset: -3px; border-radius: 12px;',
            '    border: 2px solid rgba(0,240,255,0.35);',
            '    animation: sp-long-press-pulse 0.55s ease-out infinite;',
            '    pointer-events: none;',
            '}',
            '.smart-prompt-btn {',
            '    display: inline-flex; align-items: center; gap: 6px;',
            '    height: 32px; padding: 0 14px; border-radius: 10px;',
            '    font-size: 11px; font-weight: 700; cursor: pointer;',
            '    background: rgba(0,0,0,0.06); color: #000;',
            '    border: 1px solid rgba(0,0,0,0.1);',
            '    transition: all 0.2s; white-space: nowrap; flex-shrink: 0;',
            '}',
            '.smart-prompt-btn:hover {',
            '    background: rgba(0,0,0,0.1); transform: translateY(-1px);',
            '    box-shadow: 0 4px 12px rgba(0,0,0,0.08);',
            '}',
            '.smart-prompt-btn:disabled {',
            '    opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none;',
            '}',
            'body.studio-theme-dark .smart-prompt-btn,',
            'body.theme-dark .smart-prompt-btn {',
            '    background: rgba(0,240,255,0.1); color: #00f0ff;',
            '    border-color: rgba(0,240,255,0.2);',
            '}',
            'body.studio-theme-dark .smart-prompt-btn:hover,',
            'body.theme-dark .smart-prompt-btn:hover {',
            '    background: rgba(0,240,255,0.18);',
            '    box-shadow: 0 4px 12px rgba(0,240,255,0.15);',
            '}',

            /* ---- smart-prompt-picker.css ---- */
            '.sp-picker-shell {',
            '    position: fixed; inset: 0; z-index: 9998;',
            '    background: rgba(0,0,0,0.4); backdrop-filter: blur(6px);',
            '    display: none; align-items: center; justify-content: center;',
            '    opacity: 0; transition: opacity 0.2s;',
            '}',
            '.sp-picker-shell.is-open { display: flex; opacity: 1; }',
            '.sp-picker-window {',
            '    width: 360px; max-height: 70vh; background: var(--bg-base, #fff);',
            '    border: 1px solid rgba(0,0,0,0.08); border-radius: 20px;',
            '    box-shadow: 0 20px 60px rgba(0,0,0,0.15);',
            '    display: flex; flex-direction: column; overflow: hidden;',
            '    transform: translateY(10px); transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);',
            '}',
            '.sp-picker-shell.is-open .sp-picker-window { transform: translateY(0); }',
            'body.studio-theme-dark .sp-picker-window { background: #0d1520; border-color: rgba(0,240,255,0.12); }',
            '.sp-picker-head {',
            '    display: flex; align-items: center; justify-content: space-between;',
            '    padding: 16px 20px 12px; border-bottom: 1px solid rgba(0,0,0,0.06);',
            '}',
            'body.studio-theme-dark .sp-picker-head { border-bottom-color: rgba(255,255,255,0.06); }',
            '.sp-picker-title { font-size: 14px; font-weight: 800; color: var(--text-main, #1a1a1a); }',
            'body.studio-theme-dark .sp-picker-title { color: #e0e7ef; }',
            '.sp-picker-close {',
            '    width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center;',
            '    color: #999; transition: all 0.15s; cursor: pointer; border: none; background: transparent;',
            '}',
            '.sp-picker-close:hover { background: rgba(0,0,0,0.06); color: #333; }',
            'body.studio-theme-dark .sp-picker-close:hover { background: rgba(255,255,255,0.08); color: #fff; }',
            '.sp-picker-body { flex: 1; overflow-y: auto; padding: 8px 12px 12px; }',
            '.sp-picker-item {',
            '    display: flex; align-items: center; gap: 10px; padding: 10px 12px;',
            '    border-radius: 12px; cursor: pointer; transition: all 0.15s;',
            '    border: 1.5px solid transparent; margin-bottom: 4px;',
            '}',
            '.sp-picker-item:hover { background: rgba(0,0,0,0.03); }',
            'body.studio-theme-dark .sp-picker-item:hover { background: rgba(255,255,255,0.04); }',
            '.sp-picker-item.active { background: rgba(0,180,216,0.06); border-color: rgba(0,180,216,0.3); }',
            'body.studio-theme-dark .sp-picker-item.active { background: rgba(0,240,255,0.06); border-color: rgba(0,240,255,0.2); }',
            '.sp-picker-dot {',
            '    width: 10px; height: 10px; border-radius: 50%; border: 2px solid #ccc;',
            '    flex-shrink: 0; transition: all 0.15s;',
            '}',
            '.sp-picker-item.active .sp-picker-dot { background: #00b4d8; border-color: #00b4d8; }',
            'body.studio-theme-dark .sp-picker-item.active .sp-picker-dot { background: #00f0ff; border-color: #00f0ff; }',
            '.sp-picker-info { flex: 1; min-width: 0; }',
            '.sp-picker-name { font-size: 13px; font-weight: 700; color: var(--text-main, #1a1a1a); }',
            'body.studio-theme-dark .sp-picker-name { color: #e0e7ef; }',
            '.sp-picker-desc { font-size: 11px; color: #999; margin-top: 1px; }',
            '.sp-picker-model-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }',
            '.sp-picker-model-label { font-size: 10px; font-weight: 800; color: #aaa; letter-spacing: 0.03em; flex-shrink: 0; }',
            'body.studio-theme-dark .sp-picker-model-label { color: #666; }',
            '.sp-picker-model-select {',
            '    flex: 1; min-width: 0; height: 26px; padding: 0 8px;',
            '    border: 1px solid rgba(0,0,0,0.08); border-radius: 7px;',
            '    font-size: 11px; font-weight: 700; background: transparent;',
            '    color: var(--text-main, #1a1a1a); cursor: pointer; outline: none;',
            '    transition: border-color 0.15s; -webkit-appearance: none; appearance: none;',
            '    background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'%3E%3Cpath d=\'M0 0l5 6 5-6\' fill=\'%23999\'/%3E%3C/svg%3E");',
            '    background-repeat: no-repeat; background-position: right 8px center; padding-right: 22px;',
            '}',
            'body.studio-theme-dark .sp-picker-model-select {',
            '    border-color: rgba(255,255,255,0.1); color: #ccc;',
            '    background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'%3E%3Cpath d=\'M0 0l5 6 5-6\' fill=\'%23666\'/%3E%3C/svg%3E");',
            '}',
            '.sp-picker-model-select:focus { border-color: var(--accent, #00b4d8); }',
            '.sp-picker-foot { padding: 8px 12px 12px; display: flex; gap: 8px; border-top: 1px solid rgba(0,0,0,0.06); }',
            'body.studio-theme-dark .sp-picker-foot { border-top-color: rgba(255,255,255,0.06); }',
            '.sp-picker-foot button {',
            '    flex: 1; height: 36px; border-radius: 10px; font-size: 12px; font-weight: 700;',
            '    border: 1px solid rgba(0,0,0,0.1); background: transparent; color: #666;',
            '    cursor: pointer; transition: all 0.15s; display: flex; align-items: center; justify-content: center; gap: 6px;',
            '}',
            '.sp-picker-foot button:hover { background: rgba(0,0,0,0.04); }',
            'body.studio-theme-dark .sp-picker-foot button { border-color: rgba(255,255,255,0.1); color: #999; }',
            'body.studio-theme-dark .sp-picker-foot button:hover { background: rgba(255,255,255,0.05); }',
            '.sp-picker-foot .sp-manage-btn { background: var(--accent, #00b4d8); color: #fff; border-color: var(--accent, #00b4d8); }',
            '.sp-picker-foot .sp-manage-btn:hover { opacity: 0.9; }',
            'body.studio-theme-dark .sp-picker-foot .sp-manage-btn { background: #00f0ff; color: #0a0e17; border-color: #00f0ff; }',
            'body.studio-theme-dark .sp-picker-foot .sp-manage-btn:hover { background: #33f5ff; }',

            /* ---- smart-prompt-manager.css ---- */
            '.spm-shell {',
            '    position: fixed; inset: 0; z-index: 9999;',
            '    background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);',
            '    display: none; align-items: center; justify-content: center;',
            '    opacity: 0; transition: opacity 0.25s;',
            '}',
            '.spm-shell.is-open { display: flex; opacity: 1; }',
            '.spm-window {',
            '    width: min(860px, 94vw); max-height: 85vh; background: var(--bg-base, #fff);',
            '    border: 1px solid rgba(0,0,0,0.08); border-radius: 20px;',
            '    box-shadow: 0 24px 80px rgba(0,0,0,0.2);',
            '    display: flex; flex-direction: column; overflow: hidden;',
            '    transform: translateY(12px) scale(0.97); transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);',
            '}',
            '.spm-shell.is-open .spm-window { transform: translateY(0) scale(1); }',
            'body.studio-theme-dark .spm-window { background: #0a0e17; border-color: rgba(0,240,255,0.12); }',
            '.spm-head {',
            '    display: flex; align-items: center; justify-content: space-between;',
            '    padding: 14px 24px 10px; border-bottom: 1px solid rgba(0,0,0,0.06); flex-shrink: 0;',
            '}',
            'body.studio-theme-dark .spm-head { border-bottom-color: rgba(255,255,255,0.06); }',
            '.spm-title { font-size: 16px; font-weight: 900; }',
            'body.studio-theme-dark .spm-title { color: #e0e7ef; }',
            '.spm-close {',
            '    width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center;',
            '    color: #999; cursor: pointer; border: none; background: transparent; transition: all 0.15s; font-size: 16px;',
            '}',
            '.spm-close:hover { background: rgba(0,0,0,0.06); color: #333; }',
            'body.studio-theme-dark .spm-close:hover { background: rgba(255,255,255,0.08); color: #fff; }',
            '.spm-body { flex: 1; display: flex; min-height: 0; }',
            '.spm-side {',
            '    width: 220px; flex-shrink: 0; border-right: 1px solid rgba(0,0,0,0.06);',
            '    display: flex; flex-direction: column; overflow: hidden;',
            '}',
            'body.studio-theme-dark .spm-side { border-right-color: rgba(255,255,255,0.06); }',
            '.spm-side-head { padding: 10px; border-bottom: 1px solid rgba(0,0,0,0.06); }',
            'body.studio-theme-dark .spm-side-head { border-bottom-color: rgba(255,255,255,0.06); }',
            '.spm-add-btn {',
            '    width: 100%; height: 32px; border-radius: 10px; border: 1px dashed rgba(0,0,0,0.12);',
            '    background: transparent; color: #999; font-size: 12px; font-weight: 700;',
            '    display: flex; align-items: center; justify-content: center; gap: 4px;',
            '    cursor: pointer; transition: all 0.15s;',
            '}',
            '.spm-add-btn:hover { border-color: var(--accent, #00b4d8); color: var(--accent, #00b4d8); background: rgba(0,180,216,0.04); }',
            'body.studio-theme-dark .spm-add-btn { border-color: rgba(255,255,255,0.1); color: #666; }',
            'body.studio-theme-dark .spm-add-btn:hover { border-color: #00f0ff; color: #00f0ff; background: rgba(0,240,255,0.04); }',
            '.spm-list { flex: 1; overflow-y: auto; padding: 6px; }',
            '.spm-item {',
            '    display: flex; align-items: center; gap: 8px; padding: 7px 10px;',
            '    border-radius: 10px; cursor: pointer; transition: all 0.12s;',
            '    border: 1.5px solid transparent; margin-bottom: 2px;',
            '}',
            '.spm-item:hover { background: rgba(0,0,0,0.03); }',
            'body.studio-theme-dark .spm-item:hover { background: rgba(255,255,255,0.04); }',
            '.spm-item.active { background: rgba(0,180,216,0.06); border-color: rgba(0,180,216,0.25); }',
            'body.studio-theme-dark .spm-item.active { background: rgba(0,240,255,0.06); border-color: rgba(0,240,255,0.2); }',
            '.spm-item-name { font-size: 12px; font-weight: 700; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            'body.studio-theme-dark .spm-item-name { color: #e0e7ef; }',
            '.spm-item-model-badge {',
            '    font-size: 9px; font-weight: 800; letter-spacing: 0.04em;',
            '    padding: 2px 6px; border-radius: 5px;',
            '    background: rgba(0,180,216,0.08); color: #00b4d8;',
            '    flex-shrink: 0; white-space: nowrap;',
            '}',
            'body.studio-theme-dark .spm-item-model-badge {',
            '    background: rgba(0,240,255,0.08); color: #00f0ff;',
            '}',
            '.spm-item-del {',
            '    width: 22px; height: 22px; border-radius: 6px; display: none; align-items: center; justify-content: center;',
            '    color: #ccc; font-size: 12px; border: none; background: transparent; cursor: pointer; flex-shrink: 0;',
            '}',
            '.spm-item:hover .spm-item-del { display: flex; }',
            '.spm-item-del:hover { color: #ef4444; background: rgba(239,68,68,0.08); }',
            '.spm-editor { flex: 1; overflow-y: auto; padding: 14px 24px; min-width: 0; }',
            '.spm-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #ccc; font-size: 13px; }',
            'body.studio-theme-dark .spm-empty { color: #444; }',
            '.sp-field { margin-bottom: 8px; }',
            '.sp-field label { display: block; font-size: 10px; font-weight: 800; color: #999; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.05em; }',
            'body.studio-theme-dark .sp-field label { color: #555; }',
            '.sp-field input, .sp-field textarea, .sp-field select {',
            '    width: 100%; padding: 6px 10px; border: 1px solid rgba(0,0,0,0.08); border-radius: 8px;',
            '    font-size: 12px; font-weight: 600; background: transparent; color: var(--text-main, #1a1a1a);',
            '    outline: none; transition: border-color 0.15s;',
            '}',
            'body.studio-theme-dark .sp-field input, body.studio-theme-dark .sp-field textarea, body.studio-theme-dark .sp-field select {',
            '    border-color: rgba(255,255,255,0.08); color: #e0e7ef;',
            '}',
            '.sp-field input:focus, .sp-field textarea:focus { border-color: var(--accent, #00b4d8); }',
            '.sp-field textarea { min-height: 220px; resize: vertical; font-family: ui-monospace, Menlo, monospace; font-size: 11.5px; line-height: 1.6; }',
            '.sp-field-row { display: grid; grid-template-columns: 1.2fr 1fr 0.8fr 0.8fr; gap: 8px; }',
            '.spm-foot {',
            '    display: flex; align-items: center; justify-content: flex-end; gap: 8px;',
            '    padding: 10px 24px; border-top: 1px solid rgba(0,0,0,0.06); flex-shrink: 0;',
            '}',
            'body.studio-theme-dark .spm-foot { border-top-color: rgba(255,255,255,0.06); }',
            '.spm-foot .save-btn {',
            '    height: 34px; padding: 0 18px; border-radius: 8px; font-size: 12px; font-weight: 800;',
            '    border: none; cursor: pointer; transition: all 0.15s; white-space: nowrap;',
            '    background: var(--accent, #00b4d8); color: #fff;',
            '}',
            '.spm-foot .save-btn:hover { opacity: 0.9; }',
            'body.studio-theme-dark .spm-foot .save-btn { background: #00f0ff; color: #0a0e17; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    // =====================================================================
    //  2. SmartPrompt — AI 生成按钮组件
    // =====================================================================
    var SmartPrompt = (function() {
        var DEFAULTS = {
            apiEndpoint: '/api/smart-prompt',   // 旧版兼容，实际使用时被 pmApi 覆盖
            buttonText: 'AI 生成',
            loadingText: '生成中...',
            placeholder: '请先输入中文描述'
        };
        var options = {};
        var btn = null;

        function isDarkTheme() {
            return document.body.classList.contains('studio-theme-dark') ||
                document.documentElement.classList.contains('studio-theme-dark') ||
                document.body.classList.contains('theme-dark') ||
                document.documentElement.classList.contains('theme-dark');
        }

        function createButton() {
            var b = document.createElement('button');
            b.className = 'smart-prompt-btn';
            b.title = '智能生成标签';
            b.innerHTML = [
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
                '<path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/>',
                '<circle cx="12" cy="15" r="2"/>',
                '</svg>',
                '<span class="btn-text">' + escHtml(options.buttonText) + '</span>'
            ].join('');

            // 短按：生成
            b.addEventListener('click', handleGenerate);

            // 长按：弹出预设选择
            var pressTimer = null;
            var isLongPress = false;

            function startPress() {
                isLongPress = false;
                b.classList.add('sp-long-press-active');
                pressTimer = setTimeout(function() {
                    isLongPress = true;
                    pressTimer = null;
                    b.classList.remove('sp-long-press-active');
                    if (typeof options.onLongPress === 'function') {
                        options.onLongPress();
                    }
                }, 500);
            }
            function endPress() {
                b.classList.remove('sp-long-press-active');
                if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
                isLongPress = false;
            }
            function cancelPress() {
                b.classList.remove('sp-long-press-active');
                if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
            }

            b.addEventListener('mousedown', startPress);
            b.addEventListener('mouseup', endPress);
            b.addEventListener('mouseleave', cancelPress);
            b.addEventListener('touchstart', function(e) { e.preventDefault(); startPress(); });
            b.addEventListener('touchend', function(e) { e.preventDefault(); endPress(); });
            b.addEventListener('touchcancel', cancelPress);

            return b;
        }

        async function handleGenerate() {
            if (!btn || btn.disabled) return;
            var getText = options.getText;
            var setText = options.setText;
            if (typeof getText !== 'function' || typeof setText !== 'function') {
                console.error('[SmartPrompt] getText/setText 未配置');
                return;
            }
            var userText = getText().trim();
            if (!userText) {
                if (options.onError) { options.onError(options.placeholder); }
                else { alert(options.placeholder); }
                return;
            }
            btn.disabled = true;
            var textSpan = btn.querySelector('.btn-text');
            if (textSpan) textSpan.textContent = options.loadingText;

            try {
                var res = await fetch(pmApi('/generate'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: userText })
                });
                var data = await res.json();
                if (data.success && data.prompt) {
                    var isIdeogram = typeof options.isIdeogram4Mode === 'function' && options.isIdeogram4Mode();
                    if (isIdeogram) {
                        try {
                            var parsed = JSON.parse(data.prompt);
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
                    if (typeof options.syncPicker === 'function') { options.syncPicker(); }
                    if (typeof options.onPromptUpdate === 'function') { options.onPromptUpdate(); }
                    if (typeof options.onResult === 'function') { options.onResult(data.prompt, data); }
                } else {
                    var errMsg = data.error || '生成失败';
                    if (options.onError) { options.onError(errMsg); } else { alert(errMsg); }
                }
            } catch(e) {
                var errMsg = '请求失败: ' + e.message;
                if (options.onError) { options.onError(errMsg); } else { alert(errMsg); }
            } finally {
                btn.disabled = false;
                if (textSpan) textSpan.textContent = options.buttonText;
            }
        }

        function escHtml(str) {
            var d = document.createElement('div');
            d.appendChild(document.createTextNode(str));
            return d.innerHTML;
        }

        return {
            init: function(containerId, opts) {
                opts = opts || {};
                var container = document.getElementById(containerId);
                if (!container) { console.error('[SmartPrompt] 容器不存在:', containerId); return; }
                options = Object.assign({}, DEFAULTS, opts);
                btn = createButton();
                container.appendChild(btn);
            },
            getButton: function() { return btn; },
            generate: function() { if (btn) handleGenerate(); }
        };
    })();

    // =====================================================================
    //  3. PresetPicker — 预设选择器（从 smart-prompt-picker.js）
    // =====================================================================
    var spPickerPresets = [];
    var spPickerSelectedId = 'default';
    var spPickerProviders = [];

    async function spPickerLoadPresets() {
        try {
            var results = await Promise.all([
                fetch(pmApi('/presets')).then(function(r) { return r.json(); }),
                fetch(pmApi('/selected-preset')).then(function(r) { return r.json(); })
            ]);
            spPickerPresets = results[0].presets || [];
            spPickerSelectedId = results[1].preset_id || 'default';
        } catch(e) {
            spPickerPresets = [{ id: 'default', name: '默认 Anima', description: '标准 Anima 标签生成' }];
            spPickerSelectedId = 'default';
        }
    }

    async function spPickerLoadProviders() {
        try {
            var data = await fetch('/api/config').then(function(r) { return r.json(); });
            spPickerProviders = [];
            if (data.has_api_key) {
                spPickerProviders.push({ id: 'comfly', label: 'ComfyUI (' + (data.chat_model || '') + ')' });
            }
            if (data.has_ms_key && data.ms_chat_models && data.ms_chat_models.length) {
                spPickerProviders.push({ id: 'modelscope', label: 'ModelScope (' + data.ms_chat_models[0] + ')' });
            }
            (data.chat_providers || []).forEach(function(p) {
                (p.chat_models || []).forEach(function(m) {
                    spPickerProviders.push({ id: p.id + '::' + m, label: p.name + ' (' + m + ')' });
                });
            });
        } catch(e) {
            spPickerProviders = [];
        }
    }

    function spPickerProviderOptionsHtml(selected) {
        var html = '<option value="">自动（全局默认）</option>';
        spPickerProviders.forEach(function(p) {
            html += '<option value="' + escHtml(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + escHtml(p.label) + '</option>';
        });
        return html;
    }

    function spPickerRender() {
        var body = document.getElementById('spPickerBody');
        if (!body) return;
        var currentMode = (typeof getCurrentModelMode === 'function') ? getCurrentModelMode() : '';
        var filtered = spPickerPresets.filter(function(p) {
            return !p.model_mode || p.model_mode === 'all' || p.model_mode === currentMode;
        });
        if (!filtered.length) {
            body.innerHTML = '<div style="text-align:center;padding:24px;color:#999;font-size:12px;">当前模型没有匹配的预设<br>请到管理器中创建</div>';
            return;
        }
        body.innerHTML = filtered.map(function(p) {
            var active = p.id === spPickerSelectedId ? 'active' : '';
            var providerId = p.provider_id || '';
            var providerLabel = spPickerProviders.find(function(x) { return x.id === providerId; });
            providerLabel = providerLabel ? providerLabel.label : '自动';
            return [
                '<div class="sp-picker-item ' + active + '" onclick="spPickerSelect(\'' + p.id + '\')">',
                '<div class="sp-picker-dot"></div>',
                '<div class="sp-picker-info">',
                '<div class="sp-picker-name">' + escHtml(p.name || p.id) + '</div>',
                '<div class="sp-picker-desc">' + escHtml(p.description || '') + '</div>',
                '<div class="sp-picker-model-row">',
                '<span class="sp-picker-model-label">模型</span>',
                '<select class="sp-picker-model-select" onchange="spPickerChangeProvider(\'' + p.id + '\', this.value); event.stopPropagation();" onclick="event.stopPropagation();">' + spPickerProviderOptionsHtml(providerId) + '</select>',
                '</div>',
                '</div>',
                '</div>'
            ].join('');
        }).join('');
    }

    async function spPickerChangeProvider(presetId, providerId) {
        var p = spPickerPresets.find(function(x) { return x.id === presetId; });
        if (!p) return;
        p.provider_id = providerId;
        try {
            await fetch(pmApi('/presets/' + presetId), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(p)
            });
        } catch(e) {}
    }

    async function spPickerSelect(id) {
        spPickerSelectedId = id;
        try {
            await fetch(pmApi('/selected-preset'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preset_id: id })
            });
        } catch(e) {}
        var preset = spPickerPresets.find(function(p) { return p.id === id; });
        var label = document.getElementById('spCurrentLabel');
        if (label && preset) label.textContent = preset.name;
        spPickerClose();
    }

    function spPickerOpen() {
        Promise.all([spPickerLoadPresets(), spPickerLoadProviders()]).then(function() {
            spPickerRender();
            var shell = document.getElementById('spPickerShell');
            if (shell) { shell.style.display = 'flex'; requestAnimationFrame(function() { shell.classList.add('is-open'); }); }
        });
    }

    function spPickerClose() {
        var shell = document.getElementById('spPickerShell');
        if (shell) { shell.classList.remove('is-open'); setTimeout(function() { shell.style.display = 'none'; }, 250); }
    }

    function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function spPickerInit() {
        if (document.getElementById('spPickerShell')) return;
        var shell = document.createElement('div');
        shell.id = 'spPickerShell';
        shell.className = 'sp-picker-shell';
        shell.style.display = 'none';
        shell.onclick = function(e) { if (e.target === shell) spPickerClose(); };
        shell.innerHTML = [
            '<div class="sp-picker-window">',
            '<div class="sp-picker-head">',
            '<div class="sp-picker-title">提示词预设</div>',
            '<button class="sp-picker-close" onclick="spPickerClose()">✕</button>',
            '</div>',
            '<div id="spPickerBody" class="sp-picker-body"></div>',
            '<div class="sp-picker-foot">',
            '<button onclick="spPickerClose()">取消</button>',
            '<button class="sp-manage-btn" onclick="spPickerClose(); spmOpen()">管理预设</button>',
            '</div>',
            '</div>'
        ].join('');
        document.body.appendChild(shell);

        // 加载当前选中的预设名
        Promise.all([spPickerLoadPresets(), spPickerLoadProviders()]).then(function() {
            var preset = spPickerPresets.find(function(p) { return p.id === spPickerSelectedId; });
            var label = document.getElementById('spCurrentLabel');
            if (label && preset) label.textContent = preset.name;
        });
    }

    // =====================================================================
    //  4. PresetManager — 预设管理（从 smart-prompt-manager.js）
    // =====================================================================
    var spmPresets = [];
    var spmEditingId = null;
    var spmProvidersData = null;
    var spmSaveTimer = null;

    async function spmLoad() {
        try {
            var results = await Promise.all([
                fetch(pmApi('/presets')).then(function(r) { return r.json(); }),
                fetch('/api/config').then(function(r) { return r.json(); })
            ]);
            spmPresets = results[0].presets || [];
            spmProvidersData = results[1];
        } catch(e) {
            spmPresets = [];
            spmProvidersData = null;
        }
        spmRenderList();
        if (spmEditingId && spmPresets.find(function(x) { return x.id === spmEditingId; })) {
            spmEdit(spmEditingId);
        } else if (spmPresets.length > 0) {
            spmEdit(spmPresets[0].id);
        } else {
            spmShowEmpty();
        }
    }

    function spmRenderList() {
        var el = document.getElementById('spmList');
        if (!el) return;
        var chatProviders = (spmProvidersData && spmProvidersData.chat_providers) || [];
        function providerLabel(pid) {
            if (!pid) return '自动';
            if (pid === 'comfly') return 'ComfyUI';
            if (pid === 'modelscope') return 'ModelScope';
            if (pid.indexOf('::') !== -1) {
                var parts = pid.split('::');
                var provider = chatProviders.find(function(x) { return x.id === parts[0]; });
                return provider ? provider.name : parts[0];
            }
            return pid;
        }
        el.innerHTML = spmPresets.map(function(p) {
            var delBtn = p.id !== 'default'
                ? '<button class="spm-item-del" onclick="event.stopPropagation();spmDelete(\'' + p.id + '\')" title="删除">✕</button>'
                : '';
            return [
                '<div class="spm-item ' + (p.id === spmEditingId ? 'active' : '') + '" onclick="spmEdit(\'' + p.id + '\')">',
                '<div class="spm-item-name">' + spmEsc(p.name || p.id) + '</div>',
                '<div class="spm-item-model-badge">' + spmEsc(providerLabel(p.provider_id)) + '</div>',
                delBtn,
                '</div>'
            ].join('');
        }).join('');
    }

    function spmShowEmpty() {
        var empty = document.getElementById('spmEmpty');
        var form = document.getElementById('spmForm');
        if (empty) empty.style.display = '';
        if (form) form.style.display = 'none';
    }

    function spmEdit(id) {
        spmEditingId = id;
        var p = spmPresets.find(function(x) { return x.id === id; });
        if (!p) return;
        var empty = document.getElementById('spmEmpty');
        var form = document.getElementById('spmForm');
        if (empty) empty.style.display = 'none';
        if (form) form.style.display = '';
        setField('spmName', p.name || '');
        setField('spmDesc', p.description || '');
        setField('spmModelMode', p.model_mode || 'all');
        setField('spmTemp', p.temperature != null ? p.temperature : 0.3);
        setField('spmTokens', p.max_tokens != null ? p.max_tokens : 1024);
        setField('spmQuality', p.quality_tags || '');
        setField('spmNegative', p.negative_default || '');
        setField('spmSystemPrompt', p.system_prompt || '');
        spmLoadProviders(p.provider_id || '');
        spmRenderList();
    }

    function setField(id, value) {
        var el = document.getElementById(id);
        if (el) el.value = value;
    }

    async function spmLoadProviders(selected) {
        var sel = document.getElementById('spmProvider');
        if (!sel) return;
        sel.innerHTML = '<option value="">自动（第一个可用）</option>';
        try {
            var data = await fetch('/api/config').then(function(r) { return r.json(); });
            (data.chat_providers || []).forEach(function(p) {
                (p.chat_models || []).forEach(function(m) {
                    var opt = document.createElement('option');
                    opt.value = p.id + '::' + m;
                    opt.textContent = p.name + ' (' + m + ')';
                    sel.appendChild(opt);
                });
            });
        } catch(e) {}
        if (selected) sel.value = selected;
    }

    function spmCreate() {
        var id = 'preset-' + Date.now().toString(36);
        var p = {
            id: id,
            name: '新预设',
            description: '',
            provider_id: '',
            model_mode: 'all',
            temperature: 0.3,
            max_tokens: 1024,
            quality_tags: 'masterpiece, best quality, ultra detailed, highres',
            negative_default: 'worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry',
            system_prompt: '',
            output_format: 'tag_only',
            is_default: false,
            created_at: new Date().toISOString().slice(0, 10)
        };
        spmPresets.push(p);
        spmEdit(id);
        spmAutoSave();
    }

    function spmAutoSave() {
        clearTimeout(spmSaveTimer);
        spmSaveTimer = setTimeout(function() { spmSave(); }, 500);
    }

    async function spmSave() {
        if (!spmEditingId) return;
        var p = spmPresets.find(function(x) { return x.id === spmEditingId; });
        if (!p) return;
        p.name = (document.getElementById('spmName').value || '').trim() || p.name;
        p.description = (document.getElementById('spmDesc').value || '').trim();
        p.provider_id = (document.getElementById('spmProvider') || {}).value || '';
        p.model_mode = (document.getElementById('spmModelMode') || {}).value || 'all';
        p.temperature = parseFloat((document.getElementById('spmTemp') || {}).value) || 0.3;
        p.max_tokens = parseInt((document.getElementById('spmTokens') || {}).value) || 1024;
        p.quality_tags = (document.getElementById('spmQuality').value || '').trim();
        p.negative_default = (document.getElementById('spmNegative').value || '').trim();
        p.system_prompt = (document.getElementById('spmSystemPrompt') || {}).value || '';
        try {
            await fetch(pmApi('/presets/' + p.id), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(p)
            });
            spmRenderList();
            // 更新浮动选择器
            spPickerLoadPresets().then(function() {
                var preset = spPickerPresets.find(function(x) { return x.id === spPickerSelectedId; });
                var label = document.getElementById('spCurrentLabel');
                if (label && preset) label.textContent = preset.name;
            });
        } catch(e) {}
    }

    async function spmDelete(id) {
        if (!confirm('确认删除此预设？')) return;
        try { await fetch(pmApi('/presets/' + id), { method: 'DELETE' }); } catch(e) {}
        spmPresets = spmPresets.filter(function(x) { return x.id !== id; });
        if (spmEditingId === id) { spmEditingId = null; spmShowEmpty(); }
        spmRenderList();
    }

    function spmOpen() {
        spmLoad().then(function() {
            var shell = document.getElementById('spmShell');
            if (shell) { shell.style.display = 'flex'; requestAnimationFrame(function() { shell.classList.add('is-open'); }); }
        });
    }

    function spmClose() {
        var shell = document.getElementById('spmShell');
        if (shell) { shell.classList.remove('is-open'); setTimeout(function() { shell.style.display = 'none'; }, 300); }
        // 关闭后刷新浮动选择器
        spPickerLoadPresets().then(function() {
            var preset = spPickerPresets.find(function(x) { return x.id === spPickerSelectedId; });
            var label = document.getElementById('spCurrentLabel');
            if (label && preset) label.textContent = preset.name;
        });
    }

    function spmEsc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function spmInit() {
        if (document.getElementById('spmShell')) return;
        var shell = document.createElement('div');
        shell.id = 'spmShell';
        shell.className = 'spm-shell';
        shell.style.display = 'none';
        shell.onclick = function(e) { if (e.target === shell) spmClose(); };
        shell.innerHTML = [
            '<div class="spm-window">',
            '<div class="spm-head">',
            '<div class="spm-title">提示词预设管理</div>',
            '<button class="spm-close" onclick="spmClose()">✕</button>',
            '</div>',
            '<div class="spm-body">',
            '<div class="spm-side">',
            '<div class="spm-side-head">',
            '<button class="spm-add-btn" onclick="spmCreate()">+ 新建预设</button>',
            '</div>',
            '<div id="spmList" class="spm-list"></div>',
            '</div>',
            '<div class="spm-editor">',
            '<div id="spmEmpty" class="spm-empty" style="flex-direction:column;gap:8px;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;"><path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/><circle cx="12" cy="15" r="2"/></svg><span>选择左侧预设编辑，或点击上方「新建」</span></div>',
            '<div id="spmForm" style="display:none;">',
            '<div class="sp-field-row" style="grid-template-columns:1fr 2fr;">',
            '<div class="sp-field"><label>预设名称</label><input id="spmName" placeholder="如：萌系动漫" oninput="spmAutoSave()"></div>',
            '<div class="sp-field"><label>描述</label><input id="spmDesc" placeholder="简短描述适用场景" oninput="spmAutoSave()"></div>',
            '</div>',
            '<div class="sp-field-row">',
            '<div class="sp-field"><label>AI 模型</label><select id="spmProvider" onchange="spmAutoSave()"></select></div>',
            '<div class="sp-field"><label>适用模型</label><select id="spmModelMode" onchange="spmAutoSave()"><option value="all">全部模型</option><option value="Z-Image">Z-Image</option><option value="ANIMA">ANIMA</option><option value="Anima图生图">Anima图生图</option></select></div>',
            '<div class="sp-field"><label>Temperature</label><input id="spmTemp" type="number" min="0" max="2" step="0.1" value="0.3" oninput="spmAutoSave()"></div>',
            '<div class="sp-field"><label>Max Tokens</label><input id="spmTokens" type="number" min="64" max="4096" step="64" value="1024" oninput="spmAutoSave()"></div>',
            '</div>',
            '<div class="sp-field"><label>质量词模板</label><input id="spmQuality" placeholder="masterpiece, best quality, ultra detailed, highres" oninput="spmAutoSave()"></div>',
            '<div class="sp-field"><label>默认负向提示词</label><input id="spmNegative" placeholder="worst quality, low quality, bad anatomy..." oninput="spmAutoSave()"></div>',
            '<div class="sp-field"><label>自定义 System Prompt（留空用默认规则）</label><textarea id="spmSystemPrompt" placeholder="留空使用内置 Anima 规则，填写则完全替换" oninput="spmAutoSave()"></textarea></div>',
            '</div>',
            '</div>',
            '</div>',
            '<div class="spm-foot">',
            '<div style="flex:1;font-size:10px;color:#999;">编辑后自动保存</div>',
            '</div>',
            '</div>'
        ].join('');
        document.body.appendChild(shell);
    }

    // =====================================================================
    //  5. 注入 CSS 到页面
    // =====================================================================
    injectStyles();

    // =====================================================================
    //  6. 暴露所有全局符号 — 完全向后兼容
    // =====================================================================
    // SmartPrompt
    window.SmartPrompt = SmartPrompt;

    // PresetPicker 全局变量
    window.spPickerPresets = spPickerPresets;
    window.spPickerSelectedId = spPickerSelectedId;
    window.spPickerProviders = spPickerProviders;

    // PresetPicker 全局函数
    window.spPickerLoadPresets = spPickerLoadPresets;
    window.spPickerLoadProviders = spPickerLoadProviders;
    window.spPickerProviderOptionsHtml = spPickerProviderOptionsHtml;
    window.spPickerRender = spPickerRender;
    window.spPickerChangeProvider = spPickerChangeProvider;
    window.spPickerSelect = spPickerSelect;
    window.spPickerOpen = spPickerOpen;
    window.spPickerClose = spPickerClose;
    window.escHtml = escHtml;
    window.spPickerInit = spPickerInit;

    // PresetManager 全局变量
    window.spmPresets = spmPresets;
    window.spmEditingId = spmEditingId;
    window.spmProvidersData = spmProvidersData;
    window.spmSaveTimer = spmSaveTimer;

    // PresetManager 全局函数
    window.spmLoad = spmLoad;
    window.spmRenderList = spmRenderList;
    window.spmShowEmpty = spmShowEmpty;
    window.spmEdit = spmEdit;
    window.spmLoadProviders = spmLoadProviders;
    window.spmCreate = spmCreate;
    window.spmAutoSave = spmAutoSave;
    window.spmSave = spmSave;
    window.spmDelete = spmDelete;
    window.spmOpen = spmOpen;
    window.spmClose = spmClose;
    window.spmEsc = spmEsc;
    window.spmInit = spmInit;

})();
