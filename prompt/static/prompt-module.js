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
            '40% { transform: scale(1.06); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ui-accent, #00f0ff) 20%, transparent); }',
            '70% { transform: scale(1.03); box-shadow: 0 0 0 8px color-mix(in srgb, var(--ui-accent, #00f0ff) 10%, transparent); }',
            '100% { transform: scale(1.1); box-shadow: 0 0 0 12px color-mix(in srgb, var(--ui-accent, #00f0ff) 0%, transparent); }',
            '}',
            '.sp-long-press-active {',
            '    animation: sp-long-press-pulse 0.45s ease-in-out infinite alternate !important;',
            '    position: relative; overflow: visible;',
            '}',
            '.sp-long-press-active::after {',
            '    content: \'\'; position: absolute; inset: -3px; border-radius: 12px;',
            '    border: 2px solid color-mix(in srgb, var(--ui-accent, #00f0ff) 35%, transparent);',
            '    animation: sp-long-press-pulse 0.55s ease-out infinite;',
            '    pointer-events: none;',
            '}',
            '.smart-prompt-btn {',
            '    display: inline-flex; align-items: center; gap: 6px;',
            '    height: 32px; padding: 0 14px; border-radius: 10px;',
            '    font-size: 11px; font-weight: 700; cursor: pointer;',
            '    background: rgba(0,0,0,0.06); color: #0b0b0a;',
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
            '    background: color-mix(in srgb, var(--ui-accent, #00f0ff) 10%, transparent); color: var(--ui-accent, #00f0ff);',
            '    border-color: color-mix(in srgb, var(--ui-accent, #00f0ff) 20%, transparent);',
            '}',
            'body.studio-theme-dark .smart-prompt-btn:hover,',
            'body.theme-dark .smart-prompt-btn:hover {',
            '    background: color-mix(in srgb, var(--ui-accent, #00f0ff) 18%, transparent);',
            '    box-shadow: 0 4px 12px color-mix(in srgb, var(--ui-accent, #00f0ff) 15%, transparent);',
            '}',
            '.smart-prompt-btn .sp-switch { width: 28px; height: 16px; border-radius: 99px; background: rgba(255,255,255,0.16); position: relative; flex: none; }',
            '.smart-prompt-btn .sp-switch i { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #a8a69e; transition: left .15s ease; }',
            '.smart-prompt-btn.is-on { background: color-mix(in srgb, var(--ui-accent, #00f0ff) 22%, transparent); color: var(--ui-accent, #00f0ff); border-color: var(--ui-accent, #00f0ff); }',
            '.smart-prompt-btn.is-on .sp-switch { background: var(--ui-accent, #00f0ff); }',
            '.smart-prompt-btn.is-on .sp-switch i { left: 14px; background: #0d0d0d; }',
            '#smartPromptContainer { position: relative; }',
            '.smart-prompt-btn .sp-ai-name { opacity: .72; font-weight: 800; }',
            '.smart-prompt-btn .btn-text { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }',
            '.smart-prompt-btn.is-toggle { width: auto; height: 32px; padding: 0 10px 0 8px; gap: 6px; justify-content: center; }',
            '.smart-prompt-btn.is-toggle:hover { transform: none; }',
            '.smart-prompt-btn.is-toggle .btn-text { max-width: 120px; }',
            '.sp-bot { display: block; width: 20px; height: 20px; shape-rendering: crispEdges; image-rendering: pixelated; overflow: visible; }',
            '.sp-bot-hop { transform-box: fill-box; transform-origin: center bottom; animation: sp-bot-bob .7s steps(2, end) infinite; }',
            '.sp-bot-ant { transform-box: fill-box; animation: sp-bot-ping 1.4s steps(2, end) infinite; }',
            '.sp-bot-eyes { transform-box: fill-box; transform-origin: center; animation: sp-bot-blink 3.4s steps(1, end) infinite; }',
            '.sp-bot-foot { transform-box: fill-box; transform-origin: center bottom; }',
            '.smart-prompt-btn.is-toggle:hover .sp-bot-foot.l, .smart-prompt-btn.is-on .sp-bot-foot.l { animation: sp-bot-step .36s steps(2, end) infinite; }',
            '.smart-prompt-btn.is-toggle:hover .sp-bot-foot.r, .smart-prompt-btn.is-on .sp-bot-foot.r { animation: sp-bot-step .36s steps(2, end) infinite reverse; }',
            '.smart-prompt-btn.is-on .sp-bot-hop { animation-duration: .45s; }',
            '.smart-prompt-btn.is-on .sp-bot-ant { animation-duration: .6s; }',
            '@keyframes sp-bot-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }',
            '@keyframes sp-bot-ping { 0%, 100% { opacity: 1; } 50% { opacity: .2; } }',
            '@keyframes sp-bot-blink { 0%, 88%, 100% { transform: scaleY(1); } 92%, 96% { transform: scaleY(.15); } }',
            '@keyframes sp-bot-step { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }',
            '@media (prefers-reduced-motion: reduce) { .sp-bot-hop, .sp-bot-ant, .sp-bot-eyes, .sp-bot-foot { animation: none !important; } }',
            '.sp-ai-drawer { position: fixed; z-index: 80; width: min(460px, calc(100vw - 24px)); max-height: min(430px, 62vh); overflow: hidden; padding: 8px; border-radius: 16px; border: 1px solid var(--ui-line, #343b4c); background: var(--ui-panel, #1c202a); box-shadow: 0 -16px 40px rgba(0,0,0,.35); transform-origin: bottom left; transform: translateY(8px) scaleY(.92); opacity: 0; pointer-events: none; transition: transform .18s ease, opacity .18s ease; display: flex; flex-direction: column; }',
            '.sp-ai-drawer.open { transform: none; opacity: 1; pointer-events: auto; }',
            '.sp-ai-drawer button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 40px; margin: 0 0 6px; padding: 8px 12px; border-radius: 12px; border: 1px solid transparent; background: var(--ui-soft, rgba(127,127,127,.08)); color: var(--ui-text, #f6f6f4); font-size: 13px; font-weight: 700; text-align: left; cursor: pointer; }',
            '.sp-ai-drawer button:hover { border-color: var(--ui-line, #343b4c); }',
            '.sp-ai-drawer button span { color: var(--ui-muted, #9a998f); font-size: 11px; font-weight: 600; }',
            '.sp-ai-drawer button.is-on { border-color: var(--ui-accent, #00f0ff); background: color-mix(in srgb, var(--ui-accent, #00f0ff) 12%, transparent); color: var(--ui-accent, #00f0ff); }',
            '.sp-ai-drawer .sp-ai-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex: 0 0 auto; }',
            '.sp-ai-drawer .sp-ai-head .sp-ai-off { flex: 1 1 auto; margin: 0; }',
            '.sp-ai-drawer .sp-ai-head .sp-ai-manage-icon { flex: 0 0 36px; width: 36px; min-height: 40px; margin: 0; padding: 0; justify-content: center; background: transparent; border: 1px solid var(--ui-line, #343b4c); color: var(--ui-muted, #9a998f); }',
            '.sp-ai-drawer .sp-ai-head .sp-ai-manage-icon:hover { color: var(--ui-accent, #00f0ff); border-color: color-mix(in srgb, var(--ui-accent, #00f0ff) 45%, transparent); }',
            '.sp-ai-drawer .sp-ai-head .sp-ai-manage-icon svg { width: 15px; height: 15px; }',
            '.sp-ai-drawer .sp-ai-body { display: flex; gap: 8px; min-height: 0; flex: 1 1 auto; margin-bottom: 6px; }',
            '.sp-ai-drawer .sp-ai-side { flex: 0 0 104px; width: 104px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; scrollbar-width: thin; padding-right: 6px; border-right: 1px solid var(--ui-line, #343b4c); }',
            '.sp-ai-drawer .sp-ai-side button.sp-ai-side-item { width: 100%; min-height: 30px; margin: 0; padding: 5px 9px; border-radius: 9px; background: transparent; font-size: 12px; font-weight: 600; color: var(--ui-muted, #9a998f); }',
            '.sp-ai-drawer .sp-ai-side button.sp-ai-side-item b { font-size: 12px; font-weight: 600; }',
            '.sp-ai-drawer .sp-ai-side button.sp-ai-side-item span { font-size: 10px; opacity: .75; }',
            '.sp-ai-drawer .sp-ai-side button.sp-ai-side-item.is-on { border-color: transparent; background: color-mix(in srgb, var(--ui-accent, #00f0ff) 16%, transparent); color: var(--ui-accent, #00f0ff); }',
            '.sp-ai-drawer .sp-ai-side button.sp-ai-side-item.is-on span { color: inherit; }',
            '.sp-ai-drawer .sp-ai-list { flex: 1 1 auto; min-width: 0; overflow-y: auto; scrollbar-width: thin; padding-right: 2px; }',
            '.sp-ai-drawer .sp-ai-list button { margin-bottom: 4px; }',
            '.sp-ai-drawer .sp-ai-list button b { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.sp-ai-drawer .sp-ai-list button span { flex: 0 1 auto; max-width: 56%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.sp-ai-drawer .sp-ai-empty { padding: 24px 8px; text-align: center; font-size: 12px; color: var(--ui-muted, #9a998f); }',

            /* ---- smart-prompt-picker.css ---- */
            '.sp-picker-shell {',
            '    position: fixed; inset: 0; z-index: 9998;',
            '    background: rgba(0,0,0,0.4); backdrop-filter: blur(6px);',
            '    display: none; align-items: center; justify-content: center;',
            '    opacity: 0; transition: opacity 0.2s;',
            '}',
            '.sp-picker-shell.is-open { display: flex; opacity: 1; }',
            '.sp-picker-window {',
            '    width: 360px; max-height: 70vh; background: var(--bg-base, #fcfcfb);',
            '    border: 1px solid rgba(0,0,0,0.08); border-radius: 20px;',
            '    box-shadow: 0 20px 60px rgba(0,0,0,0.15);',
            '    display: flex !important; flex-direction: column !important; overflow: hidden;',
            '    transform: translateY(10px); transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);',
            '    position: relative;',
            '}',
            '.sp-picker-window > .sp-picker-head { order: 0; flex-shrink: 0; }',
            '.sp-picker-window > .sp-picker-list-view { order: 1; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }',
            '.sp-picker-window > .sp-picker-edit-view { order: 2; flex: 1 1 auto; min-height: 0; overflow-y: auto; }',
            '.sp-picker-shell.is-open .sp-picker-window { transform: translateY(0); }',
            'body.studio-theme-dark .sp-picker-window { background: #141414; border-color: color-mix(in srgb, var(--ui-accent, #00f0ff) 12%, transparent); }',
            '.sp-picker-head {',
            '    display: flex; align-items: center; justify-content: space-between;',
            '    padding: 16px 20px 12px; border-bottom: 1px solid rgba(0,0,0,0.06);',
            '}',
            'body.studio-theme-dark .sp-picker-head { border-bottom-color: rgba(255,255,255,0.06); }',
            '.sp-picker-title { font-size: 14px; font-weight: 800; color: var(--text-main, #1a1a1a); }',
            'body.studio-theme-dark .sp-picker-title { color: #ebe9e4; }',
            '.sp-picker-close {',
            '    width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center;',
            '    color: #999999; transition: all 0.15s; cursor: pointer; border: none; background: transparent;',
            '}',
            '.sp-picker-close:hover { background: rgba(0,0,0,0.06); color: #333333; }',
            'body.studio-theme-dark .sp-picker-close:hover { background: rgba(255,255,255,0.08); color: #fcfcfb; }',
            '.sp-channel-toggle { display: flex; gap: 2px; padding: 3px; background: rgba(0,0,0,0.05); border-radius: 10px; flex-shrink: 0; }',
            '.sp-channel-btn { height: 24px; padding: 0 10px; border: none; border-radius: 7px; background: transparent; color: #888888; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.15s; }',
            '.sp-channel-btn:hover { color: #333333; }',
            '.sp-channel-btn.active { background: #fcfcfb; color: var(--accent, var(--ui-accent, #06b6d4)); box-shadow: 0 1px 4px rgba(0,0,0,0.08); }',
            'body.studio-theme-dark .sp-channel-toggle { background: rgba(255,255,255,0.06); }',
            'body.studio-theme-dark .sp-channel-btn { color: #888888; }',
            'body.studio-theme-dark .sp-channel-btn:hover { color: #ebe9e4; }',
            'body.studio-theme-dark .sp-channel-btn.active { background: color-mix(in srgb, var(--ui-accent, #00f0ff) 12%, transparent); color: var(--ui-accent, #00f0ff); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-accent, #00f0ff) 20%, transparent); }',
            '.sp-global-model-row { display: flex; align-items: center; gap: 8px; padding: 8px 20px; border-bottom: 1px solid rgba(0,0,0,0.06); flex-shrink: 0; }',
            '.sp-global-model-row label { font-size: 11px; color: #888888; font-weight: 700; white-space: nowrap; }',
            '.sp-global-model-row select { flex: 1; min-width: 0; height: 28px; padding: 0 8px; border: 1px solid rgba(0,0,0,0.08); border-radius: 8px; background: var(--bg-base,#fcfcfb); color: var(--text-main,#1a1a1a); font-size: 12px; outline: none; }',
            '.sp-global-model-row select:focus { border-color: var(--accent,var(--ui-accent, #06b6d4)); }',
            'body.studio-theme-dark .sp-global-model-row { border-bottom-color: rgba(255,255,255,0.06); }',
            'body.studio-theme-dark .sp-global-model-row label { color: #888888; }',
            'body.studio-theme-dark .sp-global-model-row select { background: #141414; border-color: rgba(255,255,255,0.08); color: #ebe9e4; }',
            'body.studio-theme-dark .sp-global-model-row select:focus { border-color: var(--ui-accent, #00f0ff); }',
            '.sp-test-btn { height: 28px; padding: 0 12px; border: 1px solid var(--accent,var(--ui-accent, #06b6d4)); border-radius: 8px; background: transparent; color: var(--accent,var(--ui-accent, #06b6d4)); font-size: 11px; font-weight: 800; cursor: pointer; transition: all 0.15s; flex-shrink: 0; }',
            '.sp-test-btn:hover { background: var(--accent,var(--ui-accent, #06b6d4)); color: #fcfcfb; }',
            '.sp-test-btn:disabled { opacity: 0.6; cursor: default; }',
            'body.studio-theme-dark .sp-test-btn { border-color: var(--ui-accent, #00f0ff); color: var(--ui-accent, #00f0ff); }',
            'body.studio-theme-dark .sp-test-btn:hover { background: color-mix(in srgb, var(--ui-accent, #00f0ff) 15%, transparent); color: var(--ui-accent, #00f0ff); }',
            '.sp-picker-head-left { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }',
            '.sp-picker-head-search { display:flex;align-items:center;gap:4px;flex:1;max-width:220px;margin:0 8px; }',
            '.sp-picker-head-search input { flex:1;height:24px;padding:0 8px;border:none;border-radius:6px;background:rgba(0,0,0,0.04);font-size:11px;font-weight:600;color:var(--text-main,#1a1a1a);outline:none; }',
            '.sp-picker-head-search input:focus { background:rgba(0,0,0,0.07); }',
            'body.studio-theme-dark .sp-picker-head-search input { background:rgba(255,255,255,0.06); color:#ebe9e4; }',
            'body.studio-theme-dark .sp-picker-head-search input:focus { background:rgba(255,255,255,0.1); }',
            '.sp-picker-add-btn {',
            '    width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center;',
            '    background: var(--accent, var(--ui-accent, #06b6d4)); color: #fcfcfb; transition: all 0.15s; cursor: pointer; border: none;',
            '    box-shadow: 0 2px 6px rgba(0,180,216,0.25);',
            '}',
            '.sp-picker-add-btn:hover { opacity: 0.85; transform: scale(1.05); }',
            '.sp-picker-add-btn:active { transform: scale(0.95); }',
            'body.studio-theme-dark .sp-picker-add-btn { background: var(--ui-accent, #00f0ff); color: #0e0e0d; box-shadow: 0 2px 6px color-mix(in srgb, var(--ui-accent, #00f0ff) 30%, transparent); }',
            '.spe-group-chip {',
            '    height:24px;padding:0 10px;border-radius:10px;font-size:10px;font-weight:700;',
            '    border:1px solid rgba(0,0,0,0.1);background:transparent;color:#999999;',
            '    cursor:pointer;transition:.15s;display:inline-flex;align-items:center;gap:4px;',
            '}',
            '.spe-group-chip:hover { border-color:var(--accent,var(--ui-accent, #06b6d4)); color:var(--accent,var(--ui-accent, #06b6d4)); }',
            '.spe-group-chip.active { background:var(--accent,var(--ui-accent, #06b6d4)); color:#fcfcfb; border-color:var(--accent,var(--ui-accent, #06b6d4)); }',
            'body.studio-theme-dark .spe-group-chip { border-color:rgba(255,255,255,0.15); color:#777777; }',
            'body.studio-theme-dark .spe-group-chip:hover { border-color:var(--ui-accent, #00f0ff); color:var(--ui-accent, #00f0ff); }',
            'body.studio-theme-dark .spe-group-chip.active { background:var(--ui-accent, #00f0ff); color:#0e0e0d; border-color:var(--ui-accent, #00f0ff); }',
            '.sp-picker-body { flex: 1; overflow-y: auto; padding: 8px 12px 12px; }',
            '.sp-picker-search {',
            '    display: flex; align-items: center; gap: 6px; padding: 6px 14px 4px;',
            '    border-bottom: 1px solid rgba(0,0,0,0.04);',
            '}',
            'body.studio-theme-dark .sp-picker-search { border-bottom-color: rgba(255,255,255,0.04); }',
            '.sp-picker-search input {',
            '    flex:1;height:28px;padding:0 10px;border:1px solid rgba(0,0,0,0.08);border-radius:8px;',
            '    font-size:11px;font-weight:600;background:var(--bg-base,#fcfcfb);color:var(--text-main,#1a1a1a);',
            '    outline:none;transition:border-color .15s;',
            '}',
            '.sp-picker-search input:focus { border-color:var(--accent,var(--ui-accent, #06b6d4)); }',
            'body.studio-theme-dark .sp-picker-search input { background:#141414; border-color:rgba(255,255,255,0.1); color:#ebe9e4; }',
            '.sp-picker-search svg { color:#cccccc; flex-shrink:0; }',
            '.sp-picker-main { display:flex; flex:1; min-height:0; overflow:hidden; }',
            '.sp-picker-sidebar {',
            '    width:150px;flex-shrink:0;overflow-y:auto;padding:8px 6px;',
            '    border-right:1px solid rgba(0,0,0,0.04);',
            '}',
            'body.studio-theme-dark .sp-picker-sidebar { border-right-color:rgba(255,255,255,0.04); }',
            '.sp-sidebar-item {',
            '    display:flex;align-items:center;justify-content:space-between;gap:4px;',
            '    padding:7px 10px;border-radius:8px;cursor:pointer;',
            '    transition:all .1s;margin-bottom:2px;',
            '}',
            '.sp-sidebar-item:hover { background:rgba(0,0,0,0.04); }',
            'body.studio-theme-dark .sp-sidebar-item:hover { background:rgba(255,255,255,0.05); }',
            '.sp-sidebar-item.active { background:var(--accent,var(--ui-accent, #06b6d4)); color:#fcfcfb; }',
            'body.studio-theme-dark .sp-sidebar-item.active { background:var(--ui-accent, #00f0ff); color:#0e0e0d; }',
            '.sp-sidebar-label { font-size:11px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }',
            '.sp-sidebar-count { font-size:9px;font-weight:800;opacity:0.5;flex-shrink:0; }',
            '.sp-sidebar-item.active .sp-sidebar-count { opacity:0.8; }',
            '.sp-sidebar-actions { display:none; align-items:center; gap:1px; flex-shrink:0; margin-left:2px; }',
            '.sp-sidebar-item:hover .sp-sidebar-actions { display:flex; }',
            '.sp-sidebar-item:hover .sp-sidebar-count { display:none; }',
            '.sp-sa-btn { width:18px;height:18px;border:none;background:transparent;border-radius:4px;cursor:pointer;font-size:10px;line-height:1;display:flex;align-items:center;justify-content:center;color:#999999;padding:0;transition:.1s; }',
            '.sp-sa-btn:hover { background:rgba(0,0,0,0.06); color:var(--text-main,#1a1a1a); }',
            'body.studio-theme-dark .sp-sa-btn { color:#555555; }',
            'body.studio-theme-dark .sp-sa-btn:hover { background:rgba(255,255,255,0.08); color:#ebe9e4; }',
            '.sp-sa-del:hover { background:#ef4444!important; color:#fcfcfb!important; }',
            '.sp-sidebar-item.drag-over { border-top:2px solid var(--accent,var(--ui-accent, #06b6d4)); }',
            'body.studio-theme-dark .sp-sidebar-item.drag-over { border-top-color:var(--ui-accent, #00f0ff); }',
            '.sp-sidebar-item[draggable="true"]:active { cursor:grabbing; }',
            '.sp-picker-edit-view { overflow-y:auto;padding:8px 14px; min-height:0; }',
            '.sp-picker-list-view { display:flex;flex-direction:column;min-height:0; }',
            '.spe-back {',
            '    display:flex;align-items:center;gap:4px;padding:4px 0 10px;cursor:pointer;',
            '    font-size:11px;font-weight:700;color:var(--accent,var(--ui-accent, #06b6d4));border-bottom:1px solid rgba(0,0,0,0.04);margin-bottom:10px;',
            '}',
            '.spe-back:hover { opacity:0.75; }',
            'body.studio-theme-dark .spe-back { color:var(--ui-accent, #00f0ff); border-bottom-color:rgba(255,255,255,0.04); }',
            '.spe-edit-head { display:flex;align-items:center;justify-content:space-between;padding:4px 0 10px;border-bottom:1px solid rgba(0,0,0,0.04);margin-bottom:10px; }',
            'body.studio-theme-dark .spe-edit-head { border-bottom-color:rgba(255,255,255,0.04); }',
            '.spe-group-trigger { display:flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#999999;cursor:pointer;padding:4px 8px;border-radius:6px;transition:.12s; }',
            '.spe-group-trigger:hover { background:rgba(0,0,0,0.04); color:var(--accent,var(--ui-accent, #06b6d4)); }',
            'body.studio-theme-dark .spe-group-trigger:hover { background:rgba(255,255,255,0.06); color:var(--ui-accent, #00f0ff); }',
            '.sp-group-menu-item { display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;transition:.1s; }',
            '.sp-group-menu-item:hover { background:rgba(0,0,0,0.04); }',
            'body.studio-theme-dark .sp-group-menu-item:hover { background:rgba(255,255,255,0.06); }',
            '.sp-group-menu-check { width:16px;height:16px;border-radius:4px;border:1.5px solid #cccccc;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;flex-shrink:0;color:var(--accent,var(--ui-accent, #06b6d4)); }',
            'body.studio-theme-dark .sp-group-menu-check { border-color:#555555; }',
            '.sp-sidebar-add { padding:8px 10px;margin-top:4px;border-radius:8px;font-size:10px;font-weight:800;color:var(--accent,var(--ui-accent, #06b6d4));cursor:pointer;text-align:center;transition:.1s; }',
            '.sp-sidebar-add:hover { background:rgba(0,0,0,0.04); }',
            'body.studio-theme-dark .sp-sidebar-add:hover { background:rgba(255,255,255,0.05); }',
            '.sp-picker-group-head {',
            '    display: flex; align-items: center; gap: 8px; padding: 10px 6px 4px;',
            '}',
            '.sp-picker-group-name {',
            '    font-size: 9px; font-weight: 800; color: #999999; text-transform: uppercase; letter-spacing: 0.08em;',
            '}',
            'body.studio-theme-dark .sp-picker-group-name { color: #666666; }',
            '.sp-picker-group-count {',
            '    font-size: 9px; font-weight: 800; color: #cccccc; padding: 1px 6px; border-radius: 8px;',
            '    background: rgba(0,0,0,0.04);',
            '}',
            'body.studio-theme-dark .sp-picker-group-count { color: #555555; background: rgba(255,255,255,0.04); }',
            '.sp-picker-group-del {',
            '    width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;',
            '    border:none;background:rgba(0,0,0,0.04);color:#cccccc;cursor:pointer;font-size:8px;line-height:1;',
            '    transition:.15s;opacity:0;flex-shrink:0;margin-left:auto;',
            '}',
            '.sp-picker-group-head:hover .sp-picker-group-del { opacity:1; }',
            '.sp-picker-group-del:hover { background:#ef4444; color:#fcfcfb; }',
            'body.studio-theme-dark .sp-picker-group-del { background:rgba(255,255,255,0.06); color:#555555; }',
            'body.studio-theme-dark .sp-picker-group-del:hover { background:#ef4444; color:#fcfcfb; }',
            '.spe-chip-del {',
            '    display:none;width:12px;height:12px;border-radius:50%;align-items:center;justify-content:center;',
            '    font-size:7px;line-height:1;background:rgba(0,0,0,0.1);color:#fcfcfb;margin-left:2px;cursor:pointer;',
            '}',
            '.spe-group-chip:hover .spe-chip-del { display:inline-flex; }',
            '.spe-chip-del:hover { background:#ef4444!important; }',
            '.sp-picker-item {',
            '    display: flex; align-items: center; gap: 10px; padding: 10px 12px;',
            '    border-radius: 12px; cursor: pointer; transition: all 0.15s;',
            '    border: 1.5px solid transparent; margin-bottom: 4px;',
            '}',
            '.sp-picker-item:hover { background: rgba(0,0,0,0.03); }',
            'body.studio-theme-dark .sp-picker-item:hover { background: rgba(255,255,255,0.04); }',
            '.sp-picker-item.active { background: rgba(0,180,216,0.06); border-color: rgba(0,180,216,0.3); }',
            'body.studio-theme-dark .sp-picker-item.active { background: color-mix(in srgb, var(--ui-accent, #00f0ff) 6%, transparent); border-color: color-mix(in srgb, var(--ui-accent, #00f0ff) 20%, transparent); }',
            '.sp-picker-dot {',
            '    width: 10px; height: 10px; border-radius: 50%; border: 2px solid #cccccc;',
            '    flex-shrink: 0; transition: all 0.15s;',
            '}',
            '.sp-picker-item.active .sp-picker-dot { background: var(--ui-accent, #06b6d4); border-color: var(--ui-accent, #06b6d4); }',
            'body.studio-theme-dark .sp-picker-item.active .sp-picker-dot { background: var(--ui-accent, #00f0ff); border-color: var(--ui-accent, #00f0ff); }',
            '.sp-picker-info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; overflow: hidden; }',
            '.sp-picker-name { font-size: 13px; font-weight: 700; color: var(--text-main, #1a1a1a); flex-shrink: 0; }',
            'body.studio-theme-dark .sp-picker-name { color: #ebe9e4; }',
            '.sp-picker-sep { color: #cccccc; font-size: 10px; flex-shrink: 0; }',
            'body.studio-theme-dark .sp-picker-sep { color: #555555; }',
            '.sp-picker-desc-inline { font-size: 11px; color: #999999; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }',
            '.sp-picker-desc { font-size: 11px; color: #999999; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.sp-picker-item-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }',
            '.sp-picker-desc { font-size: 11px; color: #999999; margin-top: 1px; }',
            '.sp-picker-model-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }',
            '.sp-picker-model-label { font-size: 10px; font-weight: 800; color: #aaaaaa; letter-spacing: 0.03em; flex-shrink: 0; }',
            'body.studio-theme-dark .sp-picker-model-label { color: #666666; }',
            '.sp-picker-model-select {',
            '    flex: 1; min-width: 0; height: 26px; padding: 0 8px;',
            '    border: 1px solid rgba(0,0,0,0.08); border-radius: 7px;',
            '    font-size: 11px; font-weight: 700; background: transparent;',
            '    color: var(--text-main, #1a1a1a); cursor: pointer; outline: none;',
            '    transition: border-color 0.15s; -webkit-appearance: none; appearance: none;',
            '    background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'%3E%3Cpath d=\'M0 0l5 6 5-6\' fill=\'%23999\'/%3E%3C/svg%3E");',
            '    background-repeat: no-repeat; background-position: right 8px center; padding-right: 22px;',
            '    margin-left: auto;',
            '}',
            'body.studio-theme-dark .sp-picker-model-select {',
            '    border-color: rgba(255,255,255,0.1); color: #cccccc;',
            '    background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'%3E%3Cpath d=\'M0 0l5 6 5-6\' fill=\'%23666\'/%3E%3C/svg%3E");',
            '}',
            '.sp-picker-model-select:focus { border-color: var(--accent, var(--ui-accent, #06b6d4)); }',
            '.sp-picker-foot { padding: 8px 12px 12px; display: flex; gap: 8px; border-top: 1px solid rgba(0,0,0,0.06); }',
            'body.studio-theme-dark .sp-picker-foot { border-top-color: rgba(255,255,255,0.06); }',
            '.sp-picker-foot button {',
            '    flex: 1; height: 36px; border-radius: 10px; font-size: 12px; font-weight: 700;',
            '    border: 1px solid rgba(0,0,0,0.1); background: transparent; color: #666666;',
            '    cursor: pointer; transition: all 0.15s; display: flex; align-items: center; justify-content: center; gap: 6px;',
            '}',
            '.sp-picker-foot button:hover { background: rgba(0,0,0,0.04); }',
            'body.studio-theme-dark .sp-picker-foot button { border-color: rgba(255,255,255,0.1); color: #999999; }',
            'body.studio-theme-dark .sp-picker-foot button:hover { background: rgba(255,255,255,0.05); }',
            '.sp-picker-foot .sp-manage-btn { background: var(--accent, var(--ui-accent, #06b6d4)); color: #fcfcfb; border-color: var(--accent, var(--ui-accent, #06b6d4)); }',
            '.sp-picker-foot .sp-manage-btn:hover { opacity: 0.9; }',
            'body.studio-theme-dark .sp-picker-foot .sp-manage-btn { background: var(--ui-accent, #00f0ff); color: #0e0e0d; border-color: var(--ui-accent, #00f0ff); }',
            'body.studio-theme-dark .sp-picker-foot .sp-manage-btn:hover { background: var(--ui-accent, #00f0ff); }',

            /* ---- 预设选择器集成编辑区 ---- */
            '.sp-picker-editor {',
            '    border-top: 1px solid rgba(0,0,0,0.06); padding: 10px 14px 8px;',
            '    max-height: 440px; overflow-y: auto;',
            '}',
            'body.studio-theme-dark .sp-picker-editor { border-top-color: rgba(255,255,255,0.06); }',
            '.sp-picker-editor .spe-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }',
            '.sp-picker-editor .spe-title { font-size:11px; font-weight:800; color:#999999; text-transform:uppercase; letter-spacing:.06em; }',
            '.spe-row { display:flex; gap:8px; margin-bottom:6px; }',
            '.spe-field { flex:1; min-width:0; }',
            '.spe-field label { display:block; font-size:9px; font-weight:800; color:#aaaaaa; text-transform:uppercase; letter-spacing:.05em; margin-bottom:2px; }',
            'body.studio-theme-dark .spe-field label { color:#666666; }',
            '.spe-field input,.spe-field select {',
            '    width:100%; height:28px; padding:0 8px; box-sizing:border-box;',
            '    border:1px solid rgba(0,0,0,0.1); border-radius:7px;',
            '    font-size:11px; font-weight:600; background:var(--bg-base,#fcfcfb); color:var(--text-main,#1a1a1a);',
            '    outline:none; transition:border-color .15s;',
            '}',
            'body.studio-theme-dark .spe-field input,body.studio-theme-dark .spe-field select {',
            '    background:#141414; border-color:rgba(255,255,255,0.1); color:#ebe9e4;',
            '}',
            '.spe-field input:focus,.spe-field select:focus { border-color:var(--accent,var(--ui-accent, #06b6d4)); }',
            '.spe-actions { display:flex; gap:6px; margin-top:6px; }',
            '.spe-actions button { height:28px; padding:0 12px; border-radius:8px; font-size:10px; font-weight:800; border:1px solid rgba(0,0,0,0.1); background:transparent; color:#999999; cursor:pointer; transition:.15s; display:flex; align-items:center; gap:4px; }',
            '.spe-actions button:hover { background:rgba(0,0,0,0.04); }',
            'body.studio-theme-dark .spe-actions button { border-color:rgba(255,255,255,0.1); color:#777777; }',
            'body.studio-theme-dark .spe-actions button:hover { background:rgba(255,255,255,0.05); }',
            '.spe-actions .spe-del-btn { color:#ef4444; border-color:rgba(239,68,68,0.3); }',
            '.spe-actions .spe-del-btn:hover { background:#ef4444!important; color:#fcfcfb!important; }',
            'body.studio-theme-dark .spe-actions .spe-del-btn { color:#f87171; border-color:rgba(248,113,113,0.3); }',
            'body.studio-theme-dark .spe-actions .spe-del-btn:hover { background:#ef4444!important; color:#fcfcfb!important; }',
            '.spe-picker-edit-btn {',
            '    width:24px;height:24px;border-radius:6px;flex-shrink:0;',
            '    display:flex;align-items:center;justify-content:center;',
            '    border:none;background:transparent;color:#cccccc;cursor:pointer;',
            '    transition:.15s;opacity:0;',
            '}',
            '.sp-picker-item:hover .spe-picker-edit-btn { opacity:1; }',
            '.spe-picker-edit-btn:hover { background:rgba(0,0,0,0.06); color:#666666; }',
            'body.studio-theme-dark .spe-picker-edit-btn { color:#444444; }',
            'body.studio-theme-dark .spe-picker-edit-btn:hover { background:rgba(255,255,255,0.08); color:#aaaaaa; }',
            '.spe-picker-del-btn {',
            '    width:24px;height:24px;border-radius:6px;flex-shrink:0;',
            '    display:flex;align-items:center;justify-content:center;',
            '    border:none;background:transparent;color:#cccccc;cursor:pointer;',
            '    transition:.15s;opacity:0;',
            '}',
            '.sp-picker-item:hover .spe-picker-del-btn { opacity:1; }',
            '.spe-picker-del-btn:hover { background:rgba(239,68,68,0.12); color:#ef4444; }',
            'body.studio-theme-dark .spe-picker-del-btn { color:#555555; }',
            'body.studio-theme-dark .spe-picker-del-btn:hover { background:rgba(239,68,68,0.18); color:#f87171; }',
            '.spe-picker-del-btn.is-confirming { background:#ef4444!important; color:#fcfcfb!important; box-shadow:0 0 0 3px rgba(239,68,68,0.3); animation:spDelPulse 0.6s ease-in-out infinite alternate; }',
            '@keyframes spDelPulse { from { transform:scale(1); } to { transform:scale(1.12); } }',

            '/* ---- 提示词预设管理 ---- */',
            '.spm-shell {',
            '    position: fixed; inset: 0; z-index: 9999;',
            '    background: rgba(0,0,0,0.5); backdrop-filter: blur(8px);',
            '    display: none; align-items: center; justify-content: center;',
            '    opacity: 0; transition: opacity 0.25s;',
            '}',
            '.spm-shell.is-open { display: flex; opacity: 1; }',
            '.spm-window {',
            '    width: min(960px, 94vw); max-height: 88vh; background: var(--bg-base, #fcfcfb);',
            '    border: 1px solid rgba(0,0,0,0.08); border-radius: 18px;',
            '    box-shadow: 0 24px 80px rgba(0,0,0,0.2);',
            '    display: flex; flex-direction: column; overflow: hidden;',
            '    transform: translateY(12px) scale(0.97); transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);',
            '}',
            '.spm-shell.is-open .spm-window { transform: translateY(0) scale(1); }',
            'body.studio-theme-dark .spm-window { background: var(--ui-panel, #1c202a); border-color: rgba(255,255,255,0.08); }',
            '.spm-head {',
            '    display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;',
            '    padding: 18px 22px 14px; border-bottom: 1px solid rgba(0,0,0,0.06); flex-shrink: 0;',
            '}',
            'body.studio-theme-dark .spm-head { border-bottom-color: rgba(255,255,255,0.07); }',
            '.spm-title { font-size: 15px; font-weight: 800; letter-spacing: 0.01em; }',
            'body.studio-theme-dark .spm-title { color: #eceae5; }',
            '.spm-subtitle { margin-top: 3px; font-size: 11px; font-weight: 600; color: #9c9b94; }',
            'body.studio-theme-dark .spm-subtitle { color: #6f6e69; }',
            '.spm-close {',
            '    width: 30px; height: 30px; border-radius: 9px; display: flex; align-items: center; justify-content: center;',
            '    color: #9c9b94; cursor: pointer; border: none; background: transparent; transition: all 0.15s; font-size: 14px; flex-shrink: 0;',
            '}',
            '.spm-close:hover { background: rgba(0,0,0,0.06); color: #333333; }',
            'body.studio-theme-dark .spm-close:hover { background: rgba(255,255,255,0.08); color: #fcfcfb; }',
            '.spm-body { flex: 1; display: flex; min-height: 0; }',
            '.spm-side {',
            '    width: 224px; flex-shrink: 0; border-right: 1px solid rgba(0,0,0,0.06);',
            '    display: flex; flex-direction: column; overflow: hidden;',
            '}',
            'body.studio-theme-dark .spm-side { border-right-color: rgba(255,255,255,0.07); background: rgba(255,255,255,0.012); }',
            '.spm-side-head { padding: 12px 12px 8px; border-bottom: 1px solid rgba(0,0,0,0.05); display: flex; flex-direction: column; gap: 8px; }',
            'body.studio-theme-dark .spm-side-head { border-bottom-color: rgba(255,255,255,0.06); }',
            '.spm-head-row { display: grid; grid-template-columns: 1fr auto; gap: 6px; }',
            '.spm-add-btn {',
            '    height: 30px; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.1);',
            '    background: transparent; color: #6f6e69; font-size: 12px; font-weight: 700;',
            '    display: flex; align-items: center; justify-content: center; gap: 4px;',
            '    cursor: pointer; transition: all 0.15s; white-space: nowrap; min-width: 0;',
            '}',
            '.spm-add-btn.is-primary { border-color: transparent; background: rgba(0,0,0,0.055); color: #33322e; }',
            '.spm-add-btn.is-primary:hover { background: rgba(0,0,0,0.09); color: #1a1a19; }',
            'body.studio-theme-dark .spm-add-btn { border-color: rgba(255,255,255,0.1); color: #8d8c85; }',
            'body.studio-theme-dark .spm-add-btn.is-primary { border-color: transparent; background: rgba(255,255,255,0.08); color: #e6e4de; }',
            'body.studio-theme-dark .spm-add-btn.is-primary:hover { background: rgba(255,255,255,0.13); color: #ffffff; }',
            'body.studio-theme-dark .spm-add-btn.is-ghost:hover { border-color: rgba(255,255,255,0.2); color: #e6e4de; }',
            '.spm-filter-row { display: flex; gap: 2px; }',
            '.spm-filter-chip { height: 24px; padding: 0 8px; border-radius: 6px; border: none; background: transparent; color: #9c9b94; font-size: 11px; font-weight: 700; cursor: pointer; transition: all .12s; }',
            '.spm-filter-chip:hover { color: #4a4944; }',
            '.spm-filter-chip.is-on { background: rgba(0,0,0,0.055); color: #33322e; }',
            'body.studio-theme-dark .spm-filter-chip { color: #85847d; }',
            'body.studio-theme-dark .spm-filter-chip:hover { color: #c9c7c0; }',
            'body.studio-theme-dark .spm-filter-chip.is-on { background: rgba(255,255,255,0.08); color: #e6e4de; }',
            '.spm-list { flex: 1; overflow-y: auto; padding: 6px 8px 14px; }',
            '.spm-group-head { display: flex; align-items: center; gap: 4px; margin: 6px 0 1px; padding: 6px 6px 4px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700; color: #9c9b94; }',
            '.spm-group-head:hover { color: #4a4944; }',
            '.spm-group-head.is-active { color: var(--accent, var(--ui-accent, #06b6d4)); }',
            'body.studio-theme-dark .spm-group-head { color: #77766f; }',
            'body.studio-theme-dark .spm-group-head:hover { color: #c9c7c0; }',
            'body.studio-theme-dark .spm-group-head.is-active { color: var(--ui-accent, #00f0ff); }',
            '.spm-group-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.spm-group-count { font-size: 10px; opacity: .55; flex-shrink: 0; font-variant-numeric: tabular-nums; }',
            '.spm-group-ops { display: flex; gap: 1px; flex-shrink: 0; opacity: 0; transition: opacity .12s; }',
            '.spm-group-head:hover .spm-group-ops, .spm-group-head.is-active .spm-group-ops { opacity: 1; }',
            '.spm-group-ops button { width: 18px; height: 18px; padding: 0; border: none; border-radius: 4px; background: transparent; color: #b3b2ab; font-size: 10px; line-height: 1; cursor: pointer; }',
            '.spm-group-ops button:hover { background: rgba(0,0,0,0.08); color: #333333; }',
            'body.studio-theme-dark .spm-group-ops button { color: #6d6c66; }',
            'body.studio-theme-dark .spm-group-ops button:hover { background: rgba(255,255,255,0.1); color: #ebe9e4; }',
            '.spm-item {',
            '    position: relative; display: flex; align-items: center; gap: 8px; padding: 7px 8px 7px 10px;',
            '    border-radius: 8px; cursor: pointer; transition: background .12s; margin: 0 0 1px 6px; border: none;',
            '}',
            '.spm-item:hover { background: rgba(0,0,0,0.035); }',
            'body.studio-theme-dark .spm-item:hover { background: rgba(255,255,255,0.045); }',
            '.spm-item.active { background: rgba(0,0,0,0.055); }',
            'body.studio-theme-dark .spm-item.active { background: rgba(255,255,255,0.075); }',
            '.spm-item.active::before {',
            '    content: ""; position: absolute; left: -6px; top: 50%; transform: translateY(-50%);',
            '    width: 2px; height: 14px; border-radius: 2px; background: var(--accent, var(--ui-accent, #06b6d4));',
            '}',
            'body.studio-theme-dark .spm-item.active::before { background: var(--ui-accent, #00f0ff); }',
            '.spm-item-name { font-size: 12px; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            'body.studio-theme-dark .spm-item-name { color: #d9d7d0; }',
            '.spm-item.active .spm-item-name { font-weight: 700; }',
            'body.studio-theme-dark .spm-item.active .spm-item-name { color: #f2f0eb; }',
            '.spm-item-model-badge {',
            '    font-size: 9px; font-weight: 800; letter-spacing: 0.04em;',
            '    padding: 2px 6px; border-radius: 5px;',
            '    background: rgba(0,180,216,0.08); color: var(--ui-accent, #06b6d4);',
            '    flex-shrink: 0; white-space: nowrap;',
            '}',
            'body.studio-theme-dark .spm-item-model-badge {',
            '    background: color-mix(in srgb, var(--ui-accent, #00f0ff) 8%, transparent); color: var(--ui-accent, #00f0ff);',
            '}',
            '.spm-item-del { width: 22px; height: 22px; border-radius: 6px; display: none; align-items: center; justify-content: center; color: #b3b2ab; font-size: 12px; border: none; background: transparent; cursor: pointer; flex-shrink: 0; }',
            '.spm-item:hover .spm-item-del { display: flex; }',
            '.spm-item-del:hover { color: #ef4444; background: rgba(239,68,68,0.08); }',
            '.spm-list-empty { padding: 22px 10px; text-align: center; font-size: 11px; color: #b3b2ab; }',
            '.spm-tags { position: relative; }',
            '.spm-tags.is-open { z-index: 6; }',
            '.spm-tag-trigger {',
            '    display: flex; align-items: center; gap: 8px; width: 100%; height: 34px; box-sizing: border-box;',
            '    padding: 0 10px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.1);',
            '    background: rgba(0,0,0,0.02); color: #33322e; font-size: 12px; font-weight: 700;',
            '    text-align: left; cursor: pointer; transition: border-color .18s ease, box-shadow .18s ease;',
            '}',
            '.spm-tag-trigger:hover { border-color: rgba(0,0,0,0.2); }',
            '.spm-tags.is-open .spm-tag-trigger { border-color: rgba(0,0,0,0.24); box-shadow: 0 0 0 3px rgba(0,0,0,0.05); }',
            '.spm-tag-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.spm-tag-value.is-empty { color: #a3a29b; }',
            '.spm-tag-caret { flex: 0 0 auto; opacity: .5; transition: transform .18s ease; }',
            '.spm-tags.is-open .spm-tag-caret { transform: rotate(180deg); opacity: .8; }',
            '.spm-tag-menu {',
            '    display: none; position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 30;',
            '    padding: 5px; border-radius: 10px; border: 1px solid rgba(0,0,0,0.1); background: #ffffff;',
            '    box-shadow: 0 14px 32px rgba(0,0,0,0.14); max-height: 216px; overflow-y: auto;',
            '}',
            '.spm-tags.is-open .spm-tag-menu { display: block; }',
            '.spm-tag-opt {',
            '    display: flex; align-items: center; gap: 8px; width: 100%; min-height: 30px;',
            '    padding: 5px 8px; border: none; border-radius: 7px; background: transparent;',
            '    color: #7f7e78; font-size: 12px; font-weight: 600; text-align: left; cursor: pointer; transition: background .12s, color .12s;',
            '}',
            '.spm-tag-opt:hover { background: rgba(0,0,0,0.05); color: #33322e; }',
            '.spm-tag-check { flex: 0 0 12px; width: 12px; font-size: 11px; font-weight: 900; color: var(--accent, var(--ui-accent, #06b6d4)); text-align: center; }',
            '.spm-tag-opt.is-on { color: #1a1a19; }',
            '.spm-tag-opt.is-legacy { font-style: italic; }',
            '.spm-tag-new { margin-top: 3px; border-top: 1px solid rgba(0,0,0,0.07); border-radius: 0 0 7px 7px; color: #a3a29b; }',
            'body.studio-theme-dark .spm-tag-trigger { background: rgba(255,255,255,0.035); border-color: rgba(255,255,255,0.1); color: #e6e4de; }',
            'body.studio-theme-dark .spm-tag-trigger:hover { border-color: rgba(255,255,255,0.22); }',
            'body.studio-theme-dark .spm-tags.is-open .spm-tag-trigger { border-color: rgba(255,255,255,0.26); box-shadow: 0 0 0 3px rgba(255,255,255,0.06); }',
            'body.studio-theme-dark .spm-tag-value.is-empty { color: #77766f; }',
            'body.studio-theme-dark .spm-tag-menu { background: var(--ui-panel, #1c202a); border-color: rgba(255,255,255,0.1); box-shadow: 0 16px 36px rgba(0,0,0,0.5); }',
            'body.studio-theme-dark .spm-tag-opt { color: #9d9b94; }',
            'body.studio-theme-dark .spm-tag-opt:hover { background: rgba(255,255,255,0.07); color: #f2f0ea; }',
            'body.studio-theme-dark .spm-tag-opt.is-on { color: #f2f0ea; }',
            'body.studio-theme-dark .spm-tag-new { border-top-color: rgba(255,255,255,0.08); color: #77766f; }',
            '.spm-tag { height: 26px; padding: 0 10px; border-radius: 7px; border: 1px solid rgba(0,0,0,0.1); background: transparent; color: #7f7e78; font-size: 11px; font-weight: 700; cursor: pointer; transition: all .12s; }',
            '.spm-tag:hover { border-color: var(--accent, var(--ui-accent, #06b6d4)); color: var(--accent, var(--ui-accent, #06b6d4)); }',
            '.spm-tag.is-on { border-color: transparent; background: rgba(0,0,0,0.06); color: #33322e; }',
            '.spm-tag.is-legacy { border-style: dashed; }',
            '.spm-tag-add { border-style: dashed; color: #a3a29b; }',
            'body.studio-theme-dark .spm-tag { border-color: rgba(255,255,255,0.12); color: #8d8c85; }',
            'body.studio-theme-dark .spm-tag:hover { border-color: var(--ui-accent, #00f0ff); color: var(--ui-accent, #00f0ff); }',
            'body.studio-theme-dark .spm-tag.is-on { border-color: transparent; background: rgba(255,255,255,0.1); color: #ecebe5; }',
            'body.studio-theme-dark .spm-tag-add { border-color: rgba(255,255,255,0.12); color: #77766f; }',
            '.spm-editor { flex: 1; display: flex; flex-direction: column; overflow-y: auto; padding: 0 22px 20px; min-width: 0; }',
            '.spm-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #b3b2ab; font-size: 12px; }',
            'body.studio-theme-dark .spm-empty { color: #55544f; }',
            '.sp-section { padding: 16px 0 2px; border-top: 1px solid rgba(0,0,0,0.06); }',
            '.sp-section:first-of-type { border-top: none; }',
            'body.studio-theme-dark .sp-section { border-top-color: rgba(255,255,255,0.06); }',
            '.sp-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }',
            '.sp-section-title { font-size: 11px; font-weight: 800; letter-spacing: 0.06em; color: #6f6e69; }',
            'body.studio-theme-dark .sp-section-title { color: #9d9b94; }',
            '.sp-section-note { font-size: 10.5px; font-weight: 600; color: #a3a29b; }',
            'body.studio-theme-dark .sp-section-note { color: #61605b; }',
            '.sp-field { margin-bottom: 12px; }',
            '.sp-field label { display: flex; align-items: baseline; gap: 6px; font-size: 11px; font-weight: 700; color: #6f6e69; margin-bottom: 5px; }',
            'body.studio-theme-dark .sp-field label { color: #9d9b94; }',
            '.sp-hint { margin-left: auto; font-size: 10px; font-weight: 600; color: #a3a29b; }',
            'body.studio-theme-dark .sp-hint { color: #63625c; }',
            '.sp-field input, .sp-field textarea, .sp-field select {',
            '    width: 100%; min-height: 34px; padding: 7px 10px; border: 1px solid rgba(0,0,0,0.09); border-radius: 9px;',
            '    font-size: 12.5px; font-weight: 600; background: rgba(0,0,0,0.025); color: var(--text-main, #1a1a1a);',
            '    outline: none; transition: border-color .15s, background .15s, box-shadow .15s;',
            '}',
            'body.studio-theme-dark .sp-field input, body.studio-theme-dark .sp-field textarea, body.studio-theme-dark .sp-field select {',
            '    border-color: rgba(255,255,255,0.09); background: rgba(255,255,255,0.035); color: #ebe9e4;',
            '}',
            '.sp-field input:focus, .sp-field textarea:focus, .sp-field select:focus {',
            '    border-color: var(--accent, var(--ui-accent, #06b6d4)); background: rgba(0,0,0,0.03);',
            '    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, var(--ui-accent, #06b6d4)) 14%, transparent);',
            '}',
            'body.studio-theme-dark .sp-field input:focus, body.studio-theme-dark .sp-field textarea:focus, body.studio-theme-dark .sp-field select:focus {',
            '    border-color: var(--ui-accent, #00f0ff); background: rgba(255,255,255,0.05);',
            '    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent, #00f0ff) 14%, transparent);',
            '}',
            '.sp-field textarea { min-height: 240px; resize: vertical; font-family: ui-monospace, Menlo, monospace; font-size: 12px; line-height: 1.7; }',
            '.sp-field-row { display: grid; gap: 10px; }',
            '.sp-row-2 { grid-template-columns: 1fr 1fr; }',
            '.sp-row-3 { grid-template-columns: 1.1fr 0.75fr 0.75fr; }',
            '.spm-foot {',
            '    display: flex; align-items: center; justify-content: space-between; gap: 12px;',
            '    padding: 12px 22px; border-top: 1px solid rgba(0,0,0,0.06); flex-shrink: 0;',
            '}',
            'body.studio-theme-dark .spm-foot { border-top-color: rgba(255,255,255,0.07); }',
            '.spm-status { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 600; color: #9c9b94; }',
            'body.studio-theme-dark .spm-status { color: #77766f; }',
            '.spm-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent, var(--ui-accent, #06b6d4)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, var(--ui-accent, #06b6d4)) 14%, transparent); }',
            'body.studio-theme-dark .spm-dot { background: var(--ui-accent, #00f0ff); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent, #00f0ff) 14%, transparent); }',
            '.spm-foot .save-btn, .spm-done {',
            '    height: 32px; padding: 0 16px; border-radius: 8px; font-size: 12px; font-weight: 800;',
            '    border: 1px solid rgba(0,0,0,0.1); background: transparent; color: #4a4944; cursor: pointer; transition: all .15s; white-space: nowrap;',
            '}',
            '.spm-foot .save-btn:hover, .spm-done:hover { background: rgba(0,0,0,0.055); color: #1a1a19; }',
            'body.studio-theme-dark .spm-foot .save-btn, body.studio-theme-dark .spm-done { border-color: rgba(255,255,255,0.12); color: #d9d7d0; }',
            'body.studio-theme-dark .spm-foot .save-btn:hover, body.studio-theme-dark .spm-done:hover { background: rgba(255,255,255,0.08); color: #ffffff; }',
            '/* 规则为主体，参数与模板默认折叠 */',
            '.spm-form { flex:1 1 auto; display:flex; flex-direction:column; gap:12px; min-height:0; padding-top:16px; }',
            '.spm-meta { flex:0 0 auto; }',
            '.spm-meta .sp-field { margin-bottom:0; }',
            '.spm-main { flex:1 1 auto; display:flex; flex-direction:column; min-height:240px; }',
            '.sp-main { flex:1 1 auto; display:flex; flex-direction:column; min-height:240px; }',
            '.sp-main .sp-section-head { margin-bottom:8px; }',
            '#spmSystemPrompt {',
            '    flex:1 1 auto; width:100%; min-height:220px; box-sizing:border-box; padding:11px 13px;',
            '    border-radius:9px; border:1px solid rgba(0,0,0,0.1); background:rgba(0,0,0,0.02); color:#33322e;',
            '    font-family:ui-monospace, Menlo, monospace; font-size:12px; line-height:1.75; resize:vertical;',
            '    transition:border-color .18s ease, box-shadow .18s ease;',
            '}',
            '#spmSystemPrompt:focus { outline:none; border-color:rgba(0,0,0,0.24); box-shadow:0 0 0 3px rgba(0,0,0,0.05); }',
            'body.studio-theme-dark #spmSystemPrompt { background:rgba(255,255,255,0.035); border-color:rgba(255,255,255,0.1); color:#e6e4de; }',
            'body.studio-theme-dark #spmSystemPrompt:focus { border-color:rgba(255,255,255,0.26); box-shadow:0 0 0 3px rgba(255,255,255,0.06); }',
            '.sp-fold { flex:0 0 auto; border-top:1px solid rgba(0,0,0,0.06); }',
            'body.studio-theme-dark .sp-fold { border-top-color:rgba(255,255,255,0.06); }',
            '.sp-fold > summary { display:flex; align-items:baseline; gap:7px; padding:11px 0; cursor:pointer; list-style:none; user-select:none; }',
            '.sp-fold > summary::-webkit-details-marker { display:none; }',
            '.sp-fold > summary::before { content:""; width:0; height:0; border-left:4px solid currentColor; border-top:3.5px solid transparent; border-bottom:3.5px solid transparent; opacity:.35; transform:translateY(-1px); transition:transform .18s ease, opacity .18s ease; }',
            '.sp-fold[open] > summary::before { transform:translateY(-1px) rotate(90deg); opacity:.6; }',
            '.sp-fold-title { font-size:11px; font-weight:800; letter-spacing:0.06em; color:#6f6e69; transition:color .18s ease; }',
            'body.studio-theme-dark .sp-fold-title { color:#9d9b94; }',
            '.sp-fold > summary:hover .sp-fold-title { color:#1a1a19; }',
            'body.studio-theme-dark .sp-fold > summary:hover .sp-fold-title { color:#ffffff; }',
            '.sp-fold-sum { margin-left:auto; font-style:normal; font-size:10.5px; font-weight:600; color:#b3b2ab; max-width:62%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
            'body.studio-theme-dark .sp-fold-sum { color:#6f6e69; }',
            '.sp-fold-body { padding:0 0 10px; }',
            '.sp-fold-body .sp-field:last-child { margin-bottom:2px; }'
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
            placeholder: '请先输入中文描述',
            channel: 'api'   // [2026-07-28] 'api' | 'comfyui' (本地 ComfyUI 工作流)
        };
        var options = {};
        var btn = null;
        // 长按状态提升到 IIFE 作用域，供 createButton 与 handleGenerate 共享
        var pressTimer = null;
        var isLongPress = false;

        function isDarkTheme() {
            return document.body.classList.contains('studio-theme-dark') ||
                document.documentElement.classList.contains('studio-theme-dark') ||
                document.body.classList.contains('theme-dark') ||
                document.documentElement.classList.contains('theme-dark');
        }

        var AI_SET_KEY = 'studio_ai_setting';
        var drawer = null;

        function savedAiSetting() {
            try { return localStorage.getItem(AI_SET_KEY) || ''; } catch (e) { return ''; }
        }

        function currentAiPreset() {
            var id = savedAiSetting();
            if (!id) return null;
            return (window.spPickerPresets || []).find(function(item) { return item.id === id; }) || null;
        }

        function paintToggle() {
            if (!btn || !options.toggle) return;
            var preset = currentAiPreset();
            var on = !!preset;
            window.studioPresetInject = on;
            if (on) window.spPickerSelectedId = preset.id;
            btn.classList.toggle('is-on', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            var text = btn.querySelector('.btn-text');
            if (text) text.textContent = preset ? (preset.name || '未命名预设') : '无设定';
            btn.title = preset ? (preset.name || '未命名预设') : '无设定，用模型自己';
            btn.setAttribute('aria-label', preset ? (preset.name || '未命名预设') : '无设定');
            if (typeof window.refreshChatPresetHint === 'function') window.refreshChatPresetHint();
        }

        function placeDrawer() {
            if (!drawer || !btn) return;
            var rect = btn.getBoundingClientRect();
            var width = Math.min(460, window.innerWidth - 24);
            var left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
            drawer.style.width = width + 'px';
            drawer.style.left = left + 'px';
            drawer.style.bottom = Math.max(8, window.innerHeight - rect.top + 8) + 'px';
        }

        var drawerHtml = '';
        var aiDrawerGroup = '';   // '' = 全部，其余为分组 id（与文生图预设选择器同一套分组）

        function aiPresetGroupKey(item) {
            return (item && item.tags && item.tags.length > 0) ? item.tags[0] : '__ungrouped__';
        }
        function aiGroupName(gid) {
            if (gid === '__ungrouped__') return '未分组';
            var groups = window.spPickerGroups || [];
            for (var i = 0; i < groups.length; i++) {
                if (groups[i] && groups[i].id === gid) return groups[i].name || gid;
            }
            return gid;
        }

        function renderDrawer() {
            if (!drawer) return;
            var current = savedAiSetting();
            var presets = (window.spPickerPresets || []).filter(function(item) {
                return item && item.id && item.id !== 'default';
            });
            // 分组统计：与文生图预设选择器保持一致，取 tags[0] 作为分组
            var counts = {};
            var seen = [];
            presets.forEach(function(item) {
                var gid = aiPresetGroupKey(item);
                if (!counts[gid]) { counts[gid] = 0; seen.push(gid); }
                counts[gid]++;
            });
            var groupOrder = [];
            (window.spPickerGroups || []).forEach(function(g) {
                if (g && g.id && counts[g.id] && groupOrder.indexOf(g.id) === -1) groupOrder.push(g.id);
            });
            seen.forEach(function(gid) {
                if (gid !== '__ungrouped__' && groupOrder.indexOf(gid) === -1) groupOrder.push(gid);
            });
            if (counts['__ungrouped__']) groupOrder.push('__ungrouped__');
            if (aiDrawerGroup && !counts[aiDrawerGroup]) aiDrawerGroup = '';

            var MANAGE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10"/><path d="M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h4"/><path d="M12 12h8"/><circle cx="10" cy="12" r="2"/><path d="M4 18h10"/><path d="M18 18h2"/><circle cx="16" cy="18" r="2"/></svg>';
            var html = '<div class="sp-ai-head">'
                + '<button type="button" class="sp-ai-manage-icon" data-ai-manage="1" title="管理预设" aria-label="管理预设">' + MANAGE_ICON + '</button>'
                + '<button type="button" class="sp-ai-off' + (current ? '' : ' is-on') + '" data-ai-id=""><b>无设定</b><span>用模型自己</span></button>'
                + '</div>';
            function presetBtn(item) {
                return '<div class="sp-ai-preset-row"><button type="button" data-ai-id="' + escHtml(item.id) + '" class="' + (item.id === current ? 'is-on' : '') + '"><b>' + escHtml(item.name || item.id) + '</b>' + (item.description ? '<span>' + escHtml(item.description) + '</span>' : '') + '</button><button type="button" class="sp-ai-guide-button" data-ai-guide="' + escHtml(item.id) + '" title="使用指导" aria-label="' + escHtml(item.name || item.id) + ' 使用指导"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 3.5"/><path d="M12 16v1"/></svg></button></div>';
            }
            function sideBtn(label, gid, count, isOn) {
                return '<button type="button" class="sp-ai-side-item' + (isOn ? ' is-on' : '') + '" data-ai-group="' + escHtml(gid) + '"><b>' + escHtml(label) + '</b><span>' + count + '</span></button>';
            }
            if (!presets.length) {
                html += '<div class="sp-ai-empty">还没有预设，去「管理预设」里新建</div>';
            } else {
                html += '<div class="sp-ai-body">';
                // 左侧分组栏（与文生图预设选择器一致）
                html += '<div class="sp-ai-side">';
                html += sideBtn('全部', '', presets.length, !aiDrawerGroup);
                groupOrder.forEach(function(gid) {
                    html += sideBtn(aiGroupName(gid), gid, counts[gid], aiDrawerGroup === gid);
                });
                html += '</div>';
                // 右侧预设列表
                html += '<div class="sp-ai-list">';
                var list = aiDrawerGroup
                    ? presets.filter(function(item) { return aiPresetGroupKey(item) === aiDrawerGroup; })
                    : presets;
                list.forEach(function(item) { html += presetBtn(item); });
                html += '</div>';
                html += '</div>';
            }
            if (html === drawerHtml) return;
            drawerHtml = html;
            drawer.innerHTML = html;
        }

        function closeDrawer() {
            if (drawer) drawer.classList.remove('open');
        }

        function openDrawer() {
            renderDrawer();
            placeDrawer();
            requestAnimationFrame(function() {
                if (drawer) drawer.classList.add('open');
            });
            if (!window.spPickerLoadPresets) return;
            window.spPickerLoadPresets().then(function() {
                if (!drawer || !drawer.classList.contains('open')) return;
                renderDrawer();
                placeDrawer();
                paintToggle();
            });
        }

        window.addEventListener('chat-preset-guide-use', function(event) { chooseAiSetting(event.detail.id); });
        function chooseAiSetting(id) {
            var preset = (window.spPickerPresets || []).find(function(item) { return item.id === id; });
            try { localStorage.setItem(AI_SET_KEY, preset ? preset.id : ''); } catch (e) {}
            if (preset) window.spPickerSelectedId = preset.id;
            window.studioPresetInject = !!preset;
            paintToggle();
            renderDrawer();
            closeDrawer();
        }

        function handleToggle(e) {
            if (e) e.stopPropagation();
            if (drawer && drawer.classList.contains('open')) closeDrawer();
            else openDrawer();
        }

        function createButton() {
            var b = document.createElement('button');
            b.className = 'smart-prompt-btn' + (options.toggle ? ' is-toggle' : '');
            b.title = options.toggle ? '选择对话设定' : '智能生成标签';
            b.innerHTML = options.toggle ? [
                '<svg class="sp-bot" viewBox="0 0 16 16" aria-hidden="true">',
                '<g class="sp-bot-hop">',
                '<rect class="sp-bot-ant" x="7" y="0" width="2" height="2" fill="currentColor"/>',
                '<rect x="7" y="2" width="2" height="1" fill="currentColor"/>',
                '<rect x="2" y="3" width="12" height="8" fill="currentColor"/>',
                '<g class="sp-bot-eyes" fill="#071016">',
                '<rect x="4" y="5" width="2" height="2"/>',
                '<rect x="10" y="5" width="2" height="2"/>',
                '</g>',
                '<rect x="6" y="8" width="4" height="1" fill="#071016"/>',
                '<rect class="sp-bot-foot l" x="3" y="12" width="3" height="2" fill="currentColor"/>',
                '<rect class="sp-bot-foot r" x="10" y="12" width="3" height="2" fill="currentColor"/>',
                '</g></svg>',
                '<span class="btn-text">无设定</span>'
            ].join('') : [
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
                '<path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/>',
                '<circle cx="12" cy="15" r="2"/>',
                '</svg>',
                '<span class="btn-text">' + escHtml(options.buttonText) + '</span>'
            ].join('');

            b.addEventListener('click', options.toggle ? handleToggle : handleGenerate);
            if (options.toggle) {
                drawer = document.createElement('div');
                drawer.className = 'sp-ai-drawer';
                drawer.addEventListener('click', function(e) {
                    // 抽屉内部点击一律不让事件冒到 document：
                    // 分组筛选会重渲染 innerHTML，e.target 变成游离节点，
                    // 那时 document 上的“点外面就关”判断会把抽屉误关掉。
                    e.stopPropagation();
                    var help = e.target.closest('[data-ai-guide]');
                    if (help) {
                        var guidePreset = (window.spPickerPresets || []).find(function(p) { return p.id === help.getAttribute('data-ai-guide'); });
                        closeDrawer();
                        if (window.ChatPresetGuide) window.ChatPresetGuide.open(guidePreset);
                        return;
                    }
                    var manage = e.target.closest('[data-ai-manage]');
                    if (manage) {
                        closeDrawer();
                        if (typeof window.spmOpen === 'function') window.spmOpen();
                        return;
                    }
                    // 分组筛选（只切列表，不关闭抽屉）
                    var grp = e.target.closest('[data-ai-group]');
                    if (grp) {
                        var gid = grp.getAttribute('data-ai-group') || '';
                        if (gid !== aiDrawerGroup) {
                            aiDrawerGroup = gid;
                            renderDrawer();
                            var listEl = drawer && drawer.querySelector('.sp-ai-list');
                            if (listEl) listEl.scrollTop = 0;
                        }
                        return;
                    }
                    var item = e.target.closest('[data-ai-id]');
                    if (!item || item.disabled) return;
                    chooseAiSetting(item.getAttribute('data-ai-id') || '');
                });
                document.body.appendChild(drawer);
                document.addEventListener('click', function(e) {
                    if (!drawer.classList.contains('open')) return;
                    if (e.target === b || b.contains(e.target) || drawer.contains(e.target)) return;
                    closeDrawer();
                });
                window.addEventListener('resize', function() { if (drawer.classList.contains('open')) placeDrawer(); });
                return b;
            }

            // 长按：弹出预设选择
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
                // [Bugfix] 不重置 isLongPress——让紧随的 click 能判断是否由长按触发，
                // 避免长按设置后误触发 AI 生成
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
            // [Bugfix] 跳过长按后的误触 click（长按已触发 onLongPress，不再生成）
            if (isLongPress) { isLongPress = false; return; }
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
            // [2026-08-13] 支持额外上下文（如 H3 视频模式/参考素材/时长），拼到用户输入后一起交给 LLM
            // getContext 可为 async，用于生成前先读参考图（视觉反推）拿到内容描述
            if (typeof options.getContext === 'function') {
                var _ctx = await options.getContext();
                if (_ctx) userText = userText + '\n\n' + _ctx;
            }
            btn.disabled = true;
            var textSpan = btn.querySelector('.btn-text');
            if (textSpan) textSpan.textContent = options.loadingText;

            try {
                // [2026-07-28] 支持本地 ComfyUI 通道: 从 window.localPromptChannel 读取 (api|comfyui)
                var _channel = (typeof window.localPromptChannel === 'string' && window.localPromptChannel) ? window.localPromptChannel : 'api';
                var _body = { prompt: userText };
                if (_channel === 'comfyui') {
                    _body.channel = 'comfyui';
                    _body.comfyui_workflow = (typeof window.localComfyuiWorkflow === 'string' && window.localComfyuiWorkflow) ? window.localComfyuiWorkflow : '';
                    if (typeof window.localComfyuiModel === 'string' && window.localComfyuiModel) {
                        _body.comfyui_model = window.localComfyuiModel;
                    }
                } else {
                    _body.channel = 'api';
                    var _providerId = (typeof window.localPromptProvider === 'string') ? window.localPromptProvider : '';
                    if (_providerId) _body.provider_id = _providerId;
                    if (options.presetId) _body.preset_id = options.presetId;
                }

                // [2026-08-13] 多模态看图生成：options.getImages 返回 File[] 时，走 multipart 端点
                // 直接把参考图交给多模态模型（无需先反推），最多 9 张
                var _imgs = null;
                if (typeof options.getImages === 'function') {
                    try { _imgs = await options.getImages(); } catch (e) { _imgs = null; }
                }
                var _useMulti = !!(_imgs && _imgs.length);

                var res, data;
                if (_useMulti) {
                    var fd = new FormData();
                    fd.append('prompt', userText);
                    if (options.presetId) fd.append('preset_id', options.presetId);
                    var _pid2 = (typeof window.localPromptProvider === 'string') ? window.localPromptProvider : '';
                    if (_pid2) fd.append('provider_id', _pid2);
                    _imgs.forEach(function (f) { fd.append('files', f); });
                    res = await fetch(pmApi('/generate-multimodal'), { method: 'POST', body: fd });
                    data = await res.json();
                } else {
                    res = await fetch(pmApi('/generate'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(_body)
                    });
                    data = await res.json();
                }
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
                options.toggle = !!opts.toggle || document.body.classList.contains('chat-layout');
                if (options.toggle) {
                    window.studioPresetInject = false;
                } else {
                    try { window.studioPresetInject = localStorage.getItem('studio_preset_inject') === '1'; } catch (e) { window.studioPresetInject = false; }
                }
                // [2026-07-28] picker 设置的通道写入 window, 这里保持同步
                if (opts.channel) window.localPromptChannel = opts.channel;
                btn = createButton();
                container.appendChild(btn);
                paintToggle();
                if (options.toggle && window.spPickerLoadPresets) {
                    window.spPickerLoadPresets().then(function() {
                        if (savedAiSetting() && !currentAiPreset()) {
                            try { localStorage.setItem(AI_SET_KEY, ''); } catch (e) {}
                        }
                        paintToggle();
                    });
                }
            },
            getButton: function() { return btn; },
            generate: function() { if (btn) handleGenerate(); },
            // [2026-07-28] 暴露通道切换 API
            setChannel: function(channel) {
                window.localPromptChannel = (channel === 'comfyui') ? 'comfyui' : 'api';
                if (options) options.channel = window.localPromptChannel;
            },
            getChannel: function() {
                return window.localPromptChannel || 'api';
            }
        };
    })();

    // =====================================================================
    //  3. PresetPicker — 预设选择器（从 smart-prompt-picker.js）
    // =====================================================================
    var spPickerPresets = [];
    var spPickerGroups = [];  // [{id, name}]
    var spPickerGroupFilter = '';    // '' = 全部
    var spPickerSearchQuery = '';
    var spPickerSelectedId = 'default';
    var spPickerProviders = [];

    async function spPickerLoadPresets() {
        try {
            var results = await Promise.all([
                fetch(pmApi('/presets')).then(function(r) { return r.json(); }),
                fetch(pmApi('/selected-preset')).then(function(r) { return r.json(); })
            ]);
            var data = results[0] || {};
            spPickerPresets = data.presets || [];
            // 从后端加载分组，如果为空则尝试 localStorage 暂存
            spPickerGroups = data.groups || [];
            // 后端返回了分组，同步到 localStorage（保证不会一直存旧数据）
            if (spPickerGroups.length) {
                try { localStorage.setItem('spPickerGroups', JSON.stringify(spPickerGroups)); } catch(e) {}
            } else {
                try {
                    var ls = JSON.parse(localStorage.getItem('spPickerGroups') || '[]');
                    if (ls.length) spPickerGroups = ls;
                } catch(e) {}
            }
            spPickerSelectedId = results[1].preset_id || 'default';
            publishPickerState();
        } catch(e) {
            spPickerPresets = [{ id: 'default', name: '默认 Anima', description: '标准 Anima 标签生成' }];
            spPickerSelectedId = 'default';
            publishPickerState();
        }
    }

    function publishPickerState() {
        window.spPickerSelectedId = spPickerSelectedId;
        window.spPickerPresets = spPickerPresets;
        window.spPickerGroups = spPickerGroups;   // AI 设定抽屉按分组展示时要用到分组名
        if (typeof window.refreshChatPresetHint === 'function') window.refreshChatPresetHint();
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
        var sidebar = document.getElementById('spPickerSidebar');
        if (!body || !sidebar) return;
        var currentMode = (typeof getCurrentModelMode === 'function') ? getCurrentModelMode() : '';
        var filtered = spPickerPresets.filter(function(p) {
            return !p.model_mode || p.model_mode === 'all' || p.model_mode === currentMode;
        });
        // 搜索过滤
        var q = spPickerSearchQuery.trim().toLowerCase();
        if (q) {
            filtered = filtered.filter(function(p) {
                var name = (p.name || '').toLowerCase();
                var desc = (p.description || '').toLowerCase();
                var quality = (p.quality_tags || '').toLowerCase();
                var sys = (p.system_prompt || '').toLowerCase();
                return name.indexOf(q) !== -1 || desc.indexOf(q) !== -1 || quality.indexOf(q) !== -1 || sys.indexOf(q) !== -1;
            });
        }
        // 侧边栏分组列表
        var groupCounts = {};
        filtered.forEach(function(p) {
            var gid = (p.tags && p.tags.length > 0) ? p.tags[0] : '__ungrouped__';
            groupCounts[gid] = (groupCounts[gid] || 0) + 1;
        });
        function sidebarItem(label, id, count, isActive) {
            return '<div class="sp-sidebar-item' + (isActive ? ' active' : '') + '" onclick="spPickerSetGroupFilter(\'' + escHtml(id) + '\')"><span class="sp-sidebar-label">' + escHtml(label) + '</span><span class="sp-sidebar-count">' + count + '</span></div>';
        }
        function sidebarGroupItem(g, count, isActive) {
            return '<div class="sp-sidebar-item' + (isActive ? ' active' : '') + '" draggable="true" data-gid="' + escHtml(g.id) + '" onclick="spPickerSetGroupFilter(\'' + escHtml(g.id) + '\')">'
                + '<span class="sp-sidebar-label">' + escHtml(g.name) + '</span>'
                + '<span class="sp-sidebar-actions">'
                + '<button class="sp-sa-btn" onclick="event.stopPropagation();spPickerRenameGroup(\'' + escHtml(g.id) + '\')" title="重命名"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>'
                + '<button class="sp-sa-btn sp-sa-del" onclick="event.stopPropagation();spPickerDeleteGroup(\'' + escHtml(g.id) + '\')" title="删除分组"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>'
                + '</span>'
                + '<span class="sp-sidebar-count">' + count + '</span></div>';
        }
        var sidebarHtml = sidebarItem('全部', '', filtered.length, spPickerGroupFilter === '');
        spPickerGroups.forEach(function(g) {
            sidebarHtml += sidebarGroupItem(g, groupCounts[g.id] || 0, spPickerGroupFilter === g.id);
        });
        var ungroupedCnt = groupCounts['__ungrouped__'] || 0;
        sidebarHtml += sidebarItem('未分组', '__ungrouped__', ungroupedCnt, spPickerGroupFilter === '__ungrouped__');
        sidebarHtml += '<div class="sp-sidebar-add" onclick="spPickerQuickAddGroup()">＋ 创建分组</div>';
        sidebar.innerHTML = sidebarHtml;
        // 按分组过滤
        if (spPickerGroupFilter) {
            if (spPickerGroupFilter === '__ungrouped__') {
                filtered = filtered.filter(function(p) { return !p.tags || p.tags.length === 0; });
            } else {
                filtered = filtered.filter(function(p) { return p.tags && p.tags.indexOf(spPickerGroupFilter) !== -1; });
            }
        }
        if (!filtered.length) {
            body.innerHTML = '<div style="text-align:center;padding:40px 12px;color:#999999;font-size:12px;">没有匹配的预设</div>';
            return;
        }
        body.innerHTML = filtered.map(function(p) {
            var active = p.id === spPickerSelectedId ? 'active' : '';
            return [
                '<div class="sp-picker-item ' + active + '" onclick="spPickerSelect(\'' + p.id + '\')" ondblclick="spPickerSelectAndClose(\'' + p.id + '\')" title="双击选择并关闭">',
                '<div class="sp-picker-dot"></div>',
                '<div class="sp-picker-info">',
                '<span class="sp-picker-name">' + escHtml(p.name || p.id) + '</span>',
                (p.description ? '<span class="sp-picker-sep">·</span><span class="sp-picker-desc-inline">' + escHtml(p.description) + '</span>' : ''),
                '</div>',
                '<div class="sp-picker-item-actions">',
                '<button class="spe-picker-edit-btn" onclick="event.stopPropagation();spPickerOpenEdit(\'' + p.id + '\')" title="编辑预设">',
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
                '</button>',
                '<button class="spe-picker-del-btn' + (_delConfirmMap[p.id] ? ' is-confirming' : '') + '" onclick="event.stopPropagation();spPickerDeleteClick(\'' + p.id + '\')" title="删除预设">',
                '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
                '</button>',
                '</div>',
                '</div>'
            ].join('');
        }).join('');
    }

    function spPickerSetGroupFilter(id) {
        spPickerGroupFilter = id;
        spPickerRender();
    }

    // ── 侧边栏拖拽排序 ──
    var _spDragGid = null;

    document.addEventListener('dragstart', function(e) {
        var item = e.target.closest('.sp-sidebar-item[data-gid]');
        if (!item) return;
        _spDragGid = item.getAttribute('data-gid');
        item.style.opacity = '0.4';
        e.dataTransfer.effectAllowed = 'move';
    });

    document.addEventListener('dragend', function(e) {
        var item = e.target.closest('.sp-sidebar-item[data-gid]');
        if (item) item.style.opacity = '';
        _spDragGid = null;
        document.querySelectorAll('.sp-sidebar-item.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
    });

    document.addEventListener('dragover', function(e) {
        var item = e.target.closest('.sp-sidebar-item[data-gid]');
        if (!item || !_spDragGid) return;
        e.preventDefault();
        document.querySelectorAll('.sp-sidebar-item.drag-over').forEach(function(el) { if (el !== item) el.classList.remove('drag-over'); });
        item.classList.add('drag-over');
    });

    document.addEventListener('drop', function(e) {
        var target = e.target.closest('.sp-sidebar-item[data-gid]');
        if (!target || !_spDragGid || _spDragGid === target.getAttribute('data-gid')) return;
        e.preventDefault();
        var fromIdx = -1, toIdx = -1;
        for (var i = 0; i < spPickerGroups.length; i++) {
            if (spPickerGroups[i].id === _spDragGid) fromIdx = i;
            if (spPickerGroups[i].id === target.getAttribute('data-gid')) toIdx = i;
        }
        if (fromIdx === -1 || toIdx === -1) return;
        var item = spPickerGroups.splice(fromIdx, 1)[0];
        spPickerGroups.splice(toIdx, 0, item);
        spPickerSyncGroups();
        spPickerRender();
    });

    function spPickerSearch() {
        var input = document.getElementById('spSearchInput');
        spPickerSearchQuery = input ? input.value : '';
        spPickerRender();
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
        _spEditingId = null;
        document.getElementById('spPickerEditView').style.display = 'none';
        document.getElementById('spPickerListView').style.display = '';
    }

    // ── 内联编辑：展开/关闭 ──
    var _spEditingId = null;
    var _spEditTimer = null;

    function spPickerOpenEdit(id) {
        // 如果点击的是当前已展开的预设 → 收起编辑
        if (_spEditingId === id) {
            spEditorClose();
            return;
        }
        _spEditingId = id;
        spPickerSelect(id, true);  // silent=true: 只选中不关闭
        var p = spPickerPresets.find(function(x) { return x.id === id; });
        if (!p) return;
        // 切换视图：隐藏列表，显示编辑
        document.getElementById('spPickerListView').style.display = 'none';
        var editView = document.getElementById('spPickerEditView');
        editView.style.display = '';
        var sName = escHtml(p.name || '');
        var sDesc = escHtml(p.description || '');
        var temp = p.temperature != null ? p.temperature : 0.3;
        var tokens = p.max_tokens != null ? p.max_tokens : 1024;
        var sQuality = escHtml(p.quality_tags || '');
        var sNeg = escHtml(p.negative_default || '');
        var sSysPrompt = escHtml(p.system_prompt || '');
        var modelMode = p.model_mode || 'all';
        var modeOpts = ['all','Z-Image','ANIMA','Anima图生图'].map(function(m) {
            return '<option value="' + m + '"' + (m === modelMode ? ' selected' : '') + '>' + m + '</option>';
        }).join('');
        var editView = document.getElementById('spPickerEditView');
        editView.innerHTML = [
            '<div class="spe-edit-head"><div class="spe-back" onclick="spEditorClose()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg><span>返回</span></div><span class="spe-group-trigger" onclick="spPickerShowGroupMenu(event)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>分组<span style="font-size:8px;margin-left:2px;">▼</span></span></div>',
            '<div class="spe-row">',
            '<div class="spe-field" style="flex:1;"><label>名称</label><input id="speName" value="' + sName + '" oninput="spEditorAutoSave()" onchange="spEditorAutoSave()"></div>',
            '<div class="spe-field" style="flex:2.5;"><label>描述</label><input id="speDesc" value="' + sDesc + '" oninput="spEditorAutoSave()"></div>',
            '</div>',
            '<div class="spe-row">',
            '<div class="spe-field" style="flex:2;"><label>适用模型</label><select id="speModelMode" onchange="spEditorAutoSave()">' + modeOpts + '</select></div>',
            '<div class="spe-field" style="flex:0.7;"><label>温度</label><input id="speTemp" type="number" min="0" max="2" step="0.1" value="' + temp + '" oninput="spEditorAutoSave()"></div>',
            '<div class="spe-field" style="flex:1;"><label>Max Tokens</label><input id="speTokens" type="number" min="64" max="4096" step="64" value="' + tokens + '" oninput="spEditorAutoSave()"></div>',
            '</div>',
            '<div class="spe-row">',
            '<div class="spe-field" style="flex:1;"><label>质量词模板</label><input id="speQuality" value="' + sQuality + '" oninput="spEditorAutoSave()"></div>',
            '<div class="spe-field" style="flex:1;"><label>默认负向提示词</label><input id="speNegative" value="' + sNeg + '" oninput="spEditorAutoSave()"></div>',
            '</div>',
            '<div class="spe-field"><label style="color:var(--accent,var(--ui-accent, #06b6d4));">AI 规则（System Prompt）</label><textarea id="speSystemPrompt" rows="8" style="width:100%;min-height:200px;box-sizing:border-box;padding:8px 10px;border:1px solid rgba(0,180,216,0.3);border-radius:7px;font-size:11px;font-weight:600;background:var(--bg-base,#fcfcfb);color:var(--text-main,#1a1a1a);outline:none;resize:vertical;font-family:inherit;line-height:1.5;" oninput="spEditorAutoSave()">' + sSysPrompt + '</textarea></div>',
        ].join('');
    }

    // ── 通过 PUT 预设同步分组到后端（不依赖分组专用 API）──
    function spPickerSyncGroups() {
        fetch(pmApi('/presets/default'), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ _sync_groups: spPickerGroups })
        }).catch(function(e) { console.error('[group] sync failed', e); });
        try { localStorage.setItem('spPickerGroups', JSON.stringify(spPickerGroups)); } catch(e) {}
    }

    function spPickerQuickAddGroup() {
        var sidebar = document.getElementById('spPickerSidebar');
        if (!sidebar) return;
        // 创建内联输入框
        var input = document.createElement('input');
        input.className = 'sp-sidebar-input';
        var btn = sidebar.querySelector('.sp-sidebar-add');
        if (btn) btn.style.display = 'none';
        input.placeholder = '输入分组名称后回车';
        input.style.cssText = 'width:calc(100% - 12px);margin:4px 6px;height:28px;padding:0 8px;border:1px solid var(--accent,var(--ui-accent, #06b6d4));border-radius:8px;font-size:11px;font-weight:600;background:var(--bg-base,#fcfcfb);color:var(--text-main,#1a1a1a);outline:none;box-sizing:border-box;';
        sidebar.appendChild(input);
        input.focus();
        input.onkeydown = function(e) {
            if (e.key === 'Enter') {
                var name = input.value.trim();
                if (!name) { input.remove(); if (btn) btn.style.display = ''; return; }
                var gid = 'group-' + name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-');
                if (spPickerGroups.find(function(x) { return x.id === gid; })) { spToast('分组已存在'); input.remove(); if (btn) btn.style.display = ''; return; }
                spPickerGroups.push({ id: gid, name: name });
                spPickerSyncGroups();
                spPickerRender();
                spToast('分组已创建');
                input.remove();
                if (btn) btn.style.display = '';
            } else if (e.key === 'Escape') {
                input.remove();
                if (btn) btn.style.display = '';
            }
        };
        input.onblur = function() {
            setTimeout(function() {
                if (input.parentNode) { input.remove(); if (btn) btn.style.display = ''; }
            }, 200);
        };
    }

    function spPickerRenameGroup(gid) {
        var g = spPickerGroups.find(function(x) { return x.id === gid; });
        if (!g) return;
        // 在侧边栏中找到对应项，将标签替换为输入框
        var sidebar = document.getElementById('spPickerSidebar');
        if (!sidebar) return;
        var items = sidebar.querySelectorAll('.sp-sidebar-item[data-gid="' + gid.replace(/"/g, '\\"') + '"]');
        var item = items[0];
        if (!item) return;
        var label = item.querySelector('.sp-sidebar-label');
        if (!label) return;
        var oldName = g.name;
        var input = document.createElement('input');
        input.className = 'sp-sidebar-rename-input';
        input.value = oldName;
        input.style.cssText = 'width:100%;height:22px;padding:0 4px;border:1px solid var(--accent,var(--ui-accent, #06b6d4));border-radius:5px;font-size:11px;font-weight:600;background:var(--bg-base,#fcfcfb);color:var(--text-main,#1a1a1a);outline:none;box-sizing:border-box;';
        label.style.display = 'none';
        label.parentNode.insertBefore(input, label.nextSibling);
        input.focus();
        input.select();
        function finish(save) {
            var val = input.value.trim();
            if (save && val && val !== oldName) {
                g.name = val;
                spPickerSyncGroups();
                spPickerRender();
                spToast('分组已重命名');
            } else {
                input.remove();
                label.style.display = '';
            }
        }
        input.onkeydown = function(e) {
            if (e.key === 'Enter') { finish(true); }
            else if (e.key === 'Escape') { finish(false); }
        };
        input.onblur = function() { finish(true); };
    }

    function spPickerMoveGroup(gid, dir) {
        var idx = -1;
        for (var i = 0; i < spPickerGroups.length; i++) {
            if (spPickerGroups[i].id === gid) { idx = i; break; }
        }
        if (idx === -1) return;
        var newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= spPickerGroups.length) return;
        var tmp = spPickerGroups[idx];
        spPickerGroups[idx] = spPickerGroups[newIdx];
        spPickerGroups[newIdx] = tmp;
        spPickerSyncGroups();
        spPickerRender();
    }

    function spPickerShowGroupMenu(event) {
        var old = document.getElementById('speGroupMenu');
        if (old) old.remove();
        var menu = document.createElement('div');
        menu.id = 'speGroupMenu';
        menu.style.cssText = 'position:absolute;top:100%;right:0;z-index:999;min-width:150px;background:var(--bg-base,#fcfcfb);border:1px solid rgba(0,0,0,0.1);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:6px;';
        var p = spPickerPresets.find(function(x) { return x.id === _spEditingId; });
        var tags = p ? (p.tags || []) : [];
        if (spPickerGroups.length === 0) {
            menu.innerHTML = '<div style="padding:14px 10px;font-size:11px;color:#999999;text-align:center;">暂无分组<br>在左侧栏创建</div>';
        } else {
            menu.innerHTML = spPickerGroups.map(function(g) {
                var checked = tags.indexOf(g.id) !== -1;
                return '<div class="sp-group-menu-item" onclick="spPickerToggleGroup(\'' + escHtml(g.id) + '\');event.stopPropagation();"><span class="sp-group-menu-check">' + (checked ? '✓' : '') + '</span><span>' + escHtml(g.name) + '</span></div>';
            }).join('');
        }
        var trigger = event.currentTarget;
        trigger.style.position = 'relative';
        trigger.appendChild(menu);
        document.addEventListener('click', function _close(e) { if (!menu.contains(e.target) && e.target !== trigger) { menu.remove(); document.removeEventListener('click', _close); } });
        event.stopPropagation();
    }

    function spPickerToggleGroup(gid) {
        var p = spPickerPresets.find(function(x) { return x.id === _spEditingId; });
        if (!p) return;
        var tags = p.tags || [];
        var idx = tags.indexOf(gid);
        var added = false;
        if (idx === -1) { tags.push(gid); added = true; } else { tags.splice(idx, 1); }
        p.tags = tags;
        spEditorAutoSave();
        spPickerRender();
        // 关闭分组菜单，让用户看到下次打开的更新
        var menu = document.getElementById('speGroupMenu');
        if (menu) menu.remove();
        spToast(added ? '已添加到分组' : '已从分组移除');
    }

    function spPickerAddGroup() {
        spPickerQuickAddGroup();
    }

    function spPickerDeleteGroup(gid) {
        // 从所有预设中移除该分组 tag
        spPickerPresets.forEach(function(p) {
            if (p.tags) {
                p.tags = p.tags.filter(function(t) { return t !== gid; });
                // 同步到后端
                fetch(pmApi('/presets/' + p.id), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(p)
                }).catch(function() {});
            }
        });
        // 从 spPickerGroups 中移除
        spPickerGroups = spPickerGroups.filter(function(x) { return x.id !== gid; });
        spPickerSyncGroups();
        spPickerRender();
        spToast('分组已删除');
    }

    function spEditorClose() {
        _spEditingId = null;
        var editView = document.getElementById('spPickerEditView');
        if (editView) editView.style.display = 'none';
        document.getElementById('spPickerListView').style.display = '';
        spPickerRender();
    }

    function spEditorAutoSave() {
        clearTimeout(_spEditTimer);
        _spEditTimer = setTimeout(function() {
            var p = spPickerPresets.find(function(x) { return x.id === _spEditingId; });
            if (!p) return;
            p.name = (document.getElementById('speName') || {}).value || p.name;
            p.description = (document.getElementById('speDesc') || {}).value || '';
            p.model_mode = (document.getElementById('speModelMode') || {}).value || 'all';
            p.temperature = parseFloat((document.getElementById('speTemp') || {}).value) || 0.3;
            p.max_tokens = parseInt((document.getElementById('speTokens') || {}).value) || 1024;
            p.quality_tags = (document.getElementById('speQuality') || {}).value || '';
            p.negative_default = (document.getElementById('speNegative') || {}).value || '';
            p.system_prompt = (document.getElementById('speSystemPrompt') || {}).value || '';
            p.tags = p.tags || [];  // tags 由分组 chips 管理，保持已设置的值
            // 保存到后端
            fetch(pmApi('/presets/' + p.id), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(p)
            }).then(function(r) {
                if (r.ok) { spToast('已保存'); }
                else { console.error('[spEditor] save failed', r.status); }
            }).catch(function(e) { console.error('[spEditor] save error', e); });
            // 刷新列表（名称可能变了）
            spPickerRender();
        }, 400);
    }

    function spPickerQuickAddGroup() {
        if (!el) {
            el = document.createElement('div');
            el.id = 'spToast';
            el.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:8px;font-size:10px;font-weight:800;background:#059669;color:#fcfcfb;z-index:10;transition:opacity .3s;opacity:0;pointer-events:none;white-space:nowrap;';
            var win = document.querySelector('.sp-picker-window');
            if (win) { win.style.position = 'relative'; win.appendChild(el); }
        }
        el.textContent = '✓ ' + msg;
        el.style.opacity = '1';
        _spToastTimer = setTimeout(function() { el.style.opacity = '0'; }, 1500);
    }

    function spEditorDelete() {
        var id = _spEditingId;
        if (!id) return;
        fetch(pmApi('/presets/' + id), { method: 'DELETE' }).catch(function() {});
        spPickerPresets = spPickerPresets.filter(function(x) { return x.id !== id; });
        _spEditingId = null;
        var editor = document.getElementById('spPickerEditor');
        if (editor) editor.style.display = 'none';
        // 自动选中第一个剩余的预设
        if (spPickerPresets.length > 0) {
            spPickerSelect(spPickerPresets[0].id, true);
            spPickerOpenEdit(spPickerPresets[0].id);
        } else {
            spPickerRender();
        }
    }

    function spPickerCreate() {
        var id = 'preset-' + Date.now().toString(36);
        var p = {
            id: id, name: '新预设', description: '',
            model_mode: 'all',
            temperature: 0.3, max_tokens: 1024,
            quality_tags: 'masterpiece, best quality, ultra detailed, highres',
            negative_default: 'worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry',
            system_prompt: '', output_format: 'tag_only',
            is_default: false, created_at: new Date().toISOString().slice(0, 10)
        };
        // 先 POST 到后端创建预设文件，否则后续 PUT（自动保存）会因文件不存在而静默丢弃
        fetch(pmApi('/presets'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(p)
        }).then(function(r) {
            if (!r.ok) console.error('[spPicker] create failed', r.status);
        }).catch(function(e) { console.error('[spPicker] create error', e); });
        spPickerPresets.push(p);
        spPickerRender();
        spPickerOpenEdit(id);
        spEditorAutoSave();
    }

    // ── 删除确认状态 ──
    var _delConfirmMap = {};
    var _delConfirmTimer = null;

    function spPickerDeleteClick(id) {
        if (_delConfirmMap[id]) {
            // 第二次点击 → 确认删除
            clearTimeout(_delConfirmTimer);
            _delConfirmMap = {};
            spPickerDelete(id);
        } else {
            // 第一次点击 → 进入确认态（变红）
            _delConfirmMap = {};
            _delConfirmMap[id] = true;
            spPickerRender();
            // 3 秒后自动取消确认态
            clearTimeout(_delConfirmTimer);
            _delConfirmTimer = setTimeout(function() {
                _delConfirmMap = {};
                spPickerRender();
            }, 3000);
        }
    }

    function spPickerDelete(id) {
        fetch(pmApi('/presets/' + id), { method: 'DELETE' }).catch(function() {});
        spPickerPresets = spPickerPresets.filter(function(x) { return x.id !== id; });
        if (spPickerSelectedId === id && spPickerPresets.length > 0) {
            spPickerSelect(spPickerPresets[0].id, true);
        }
        var editView = document.getElementById('spPickerEditView');
        if (editView) editView.style.display = 'none';
        document.getElementById('spPickerListView').style.display = '';
        _spEditingId = null;
        spPickerRender();
    }

    function spPickerSelect(id, silent) {
        spPickerSelectedId = id;
        try {
            fetch(pmApi('/selected-preset'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preset_id: id })
            }).catch(function() {});
        } catch(e) {}
        var preset = spPickerPresets.find(function(p) { return p.id === id; });
        var label = document.getElementById('spCurrentLabel');
        if (label && preset) label.textContent = preset.name;
        publishPickerState();
        spPickerRender();  // 刷新选中态高亮
    }

    // 双击预设：选中并关闭选择界面
    function spPickerSelectAndClose(id) {
        spPickerSelect(id);
        spPickerClose();
    }

    function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function spPickerInit() {
        if (document.getElementById('spPickerShell')) return;
        var shell = document.createElement('div');
        shell.id = 'spPickerShell';
        shell.className = 'sp-picker-shell';
        shell.style.display = 'none';
        shell.innerHTML = [
            '<div class="sp-picker-window" style="width:650px;height:560px;">',
            '<div class="sp-picker-head">',
            '<div class="sp-picker-head-left">',
            '<div class="sp-picker-title">提示词预设</div>',
            '<button class="sp-picker-add-btn" onclick="spPickerCreate()" title="新建预设">',
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
            '</button>',
            '<div id="spChannelToggle" class="sp-channel-toggle">',
            '<button class="sp-channel-btn" data-channel="api" onclick="spPickerChangeChannel(this, \'api\')">API</button>',
            '<button class="sp-channel-btn" data-channel="comfyui" onclick="spPickerChangeChannel(this, \'comfyui\')">本地 ComfyUI</button>',
            '</div>',
            '</div>',
            '<div class="sp-picker-head-search"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;color:#aaaaaa;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="spSearchInput" placeholder="搜索..." oninput="spPickerSearch()"></div>',
            '<button class="sp-picker-close" onclick="spPickerClose()">✕</button>',
            '</div>',
            '<div id="spGlobalModelRow" class="sp-global-model-row">',
            '<label id="spGlobalModelLabel">模型</label>',
            '<select id="spGlobalModelSelect" onchange="spPickerChangeModel(this.value)"></select>',
            '<label id="spGlobalComfyModelLabel" style="display:none;">模型</label>',
            '<select id="spGlobalComfyModelSelect" onchange="spPickerChangeComfyModel(this.value)" style="display:none;"></select>',
            '<button id="spGlobalTestBtn" class="sp-test-btn" onclick="spPickerTestModel()">测试</button>',
            '</div>',
            '<div id="spPickerListView" class="sp-picker-list-view">',
            '<div class="sp-picker-main">',
            '<div id="spPickerSidebar" class="sp-picker-sidebar"></div>',
            '<div id="spPickerBody" class="sp-picker-body"></div>',
            '</div>',
            '</div>',
            '<div id="spPickerEditView" class="sp-picker-edit-view" style="display:none;"></div>',
            '</div>'
        ].join('');
        document.body.appendChild(shell);

        // 加载当前选中的预设名
        Promise.all([spPickerLoadPresets(), spPickerLoadProviders()]).then(function() {
            var preset = spPickerPresets.find(function(p) { return p.id === spPickerSelectedId; });
            var label = document.getElementById('spCurrentLabel');
            if (label && preset) label.textContent = preset.name;
        });

        // [2026-07-28] 初始化通道 toggle: 优先读后端 /api/smart-prompt/config, 回退 localStorage
        spPickerLoadGlobalConfig();
    }

    // [2026-07-28] 从后端加载全局 channel 配置并同步到 toggle + 全局模型下拉
    async function spPickerLoadGlobalConfig() {
        var cfg = { channel: 'api', provider_id: '', comfyui_workflow: '提示词/文生提示词.json', comfyui_model: '' };
        try {
            var res = await fetch('/api/smart-prompt/config');
            cfg = Object.assign(cfg, await res.json());
        } catch(e) {
            try { cfg.channel = localStorage.getItem('spChannel') || 'api'; } catch(e2) {}
        }
        if (cfg.channel !== 'api' && cfg.channel !== 'comfyui') cfg.channel = 'api';
        window.localPromptChannel = cfg.channel;
        window.localPromptProvider = cfg.provider_id || '';
        // ComfyUI 工作流固定为文生提示词，不在前端提供选择（用户要求）
        window.localComfyuiWorkflow = '提示词/文生提示词.json';
        window.localComfyuiModel = cfg.comfyui_model || '';
        try { localStorage.setItem('spChannel', cfg.channel); } catch(e) {}

        var btns = document.querySelectorAll('#spChannelToggle .sp-channel-btn');
        btns.forEach(function(b) {
            if (b.getAttribute('data-channel') === cfg.channel) b.classList.add('active');
            else b.classList.remove('active');
        });

        spPickerUpdateGlobalModelUI(cfg.channel);
        if (cfg.channel === 'api') {
            await spPickerLoadApiProviders();
            var sel = document.getElementById('spGlobalModelSelect');
            if (sel) sel.value = window.localPromptProvider || '';
        } else {
            // ComfyUI 通道：工作流固定为文生提示词，不提供选择，仅加载本地 llama 模型
            await spPickerLoadComfyuiModels();
            var mSel = document.getElementById('spGlobalComfyModelSelect');
            if (mSel) mSel.value = window.localComfyuiModel || '';
        }
    }

    // [2026-07-28] 加载 API provider 列表到全局模型下拉
    async function spPickerLoadApiProviders() {
        if (!spPickerProviders.length) await spPickerLoadProviders();
        var sel = document.getElementById('spGlobalModelSelect');
        if (!sel) return;
        sel.innerHTML = spPickerProviderOptionsHtml(window.localPromptProvider || '');
    }

    // [2026-07-28] 加载 ComfyUI llama 模型列表
    async function spPickerLoadComfyuiModels() {
        var sel = document.getElementById('spGlobalComfyModelSelect');
        if (!sel) return;
        var models = [];
        try {
            var data = await fetch('/api/comfyui/llama-models').then(function(r) { return r.json(); });
            models = data.models || [];
        } catch(e) {}
        var selected = window.localComfyuiModel || '';
        var html = '<option value="">默认模型</option>';
        models.forEach(function(m) {
            html += '<option value="' + escHtml(m) + '"' + (m === selected ? ' selected' : '') + '>' + escHtml(m) + '</option>';
        });
        sel.innerHTML = html;
    }

    // [2026-07-28] 根据 channel 切换全局模型下拉 UI
    function spPickerUpdateGlobalModelUI(channel) {
        var label = document.getElementById('spGlobalModelLabel');
        var sel = document.getElementById('spGlobalModelSelect');
        var comfyLabel = document.getElementById('spGlobalComfyModelLabel');
        var comfySel = document.getElementById('spGlobalComfyModelSelect');
        if (!label || !sel || !comfyLabel || !comfySel) return;
        if (channel === 'api') {
            // API 通道：显示「模型」下拉（provider）
            label.textContent = '模型';
            label.style.display = '';
            sel.style.display = '';
            comfyLabel.style.display = 'none';
            comfySel.style.display = 'none';
        } else {
            // ComfyUI 通道：工作流固定为文生提示词，不提供选择；仅保留本地 llama 模型下拉
            label.style.display = 'none';
            sel.style.display = 'none';
            comfyLabel.textContent = '模型';
            comfyLabel.style.display = '';
            comfySel.style.display = '';
        }
    }

    // [2026-07-28] 统一保存全局配置到后端
    function spPickerSaveGlobalConfig() {
        try {
            fetch('/api/smart-prompt/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channel: window.localPromptChannel || 'api',
                    provider_id: window.localPromptProvider || '',
                    comfyui_workflow: window.localComfyuiWorkflow || '提示词/文生提示词.json',
                    comfyui_model: window.localComfyuiModel || ''
                })
            }).catch(function(){});
        } catch(e) {}
    }

    // [2026-07-28] 全局模型切换（仅 API 通道使用；ComfyUI 工作流固定，不提供切换）
    window.spPickerChangeModel = function(value) {
        if (window.localPromptChannel === 'api') {
            window.localPromptProvider = value;
            spPickerSaveGlobalConfig();
            console.log('[SmartPrompt] 全局模型切换为:', value);
        }
    };

    // [2026-07-28] ComfyUI 模型切换
    window.spPickerChangeComfyModel = function(value) {
        window.localComfyuiModel = value;
        spPickerSaveGlobalConfig();
        console.log('[SmartPrompt] ComfyUI 模型切换为:', value);
    };

    // [2026-07-28] 测试当前选中的模型/工作流是否可用
    window.spPickerTestModel = async function() {
        var btn = document.getElementById('spGlobalTestBtn');
        var channel = window.localPromptChannel || 'api';
        var body = { channel: channel };
        if (channel === 'api') {
            body.provider_id = window.localPromptProvider || '';
        } else {
            body.comfyui_workflow = window.localComfyuiWorkflow || '提示词/文生提示词.json';
            body.comfyui_model = window.localComfyuiModel || '';
        }
        var oldText = btn ? btn.textContent : '测试';
        if (btn) { btn.disabled = true; btn.textContent = '测试中…'; }
        try {
            var res = await fetch('/api/smart-prompt/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            var data = await res.json();
            var ok = data.success === true;
            var detail = data.detail;
            if (detail && typeof detail === 'object') {
                // FastAPI 校验错误时 detail 是数组/对象，转成字符串避免显示 [object Object]
                try { detail = JSON.stringify(detail); } catch (e2) { detail = String(detail); }
            }
            spToast((ok ? '✓ 连接成功，模型可用' : '✗ ') + (detail || (ok ? '连接成功' : '不可用')));
            console.log('[SmartPrompt] 测试结果:', data);
        } catch(e) {
            spToast('✗ 测试请求失败: ' + e);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = oldText; }
        }
    };

    // [2026-07-28] 通道切换全局函数 (picker head toggle 调用) — 写后端 + 更新 window 全局变量
    window.spPickerChangeChannel = function(btn, channel) {
        var btns = document.querySelectorAll('#spChannelToggle .sp-channel-btn');
        btns.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        window.localPromptChannel = channel;
        try { localStorage.setItem('spChannel', channel); } catch(e) {}
        spPickerUpdateGlobalModelUI(channel);
        if (channel === 'api') {
            spPickerLoadApiProviders().then(function() {
                var sel = document.getElementById('spGlobalModelSelect');
                if (sel) sel.value = window.localPromptProvider || '';
                spPickerSaveGlobalConfig();
            });
        } else {
            // ComfyUI 通道：工作流固定，仅加载本地 llama 模型
            spPickerLoadComfyuiModels().then(function() {
                var mSel = document.getElementById('spGlobalComfyModelSelect');
                if (mSel) mSel.value = window.localComfyuiModel || '';
                spPickerSaveGlobalConfig();
            });
        }
        console.log('[SmartPrompt] 通道切换为:', channel);
    };

    // =====================================================================
    //  4. PresetManager — 预设管理（从 smart-prompt-manager.js）
    // =====================================================================
    var spmPresets = [];
    var spmEditingId = null;
    var spmProvidersData = null;
    var spmSaveTimer = null;
    var spmGroups = [];          // [{id, name}]，与预设 tags 对应
    var spmGroupFilter = '';     // '' 全部 / '__none__' 未分组 / 具体分组 id

    async function spmLoad() {
        try {
            var results = await Promise.all([
                fetch(pmApi('/presets')).then(function(r) { return r.json(); }),
                fetch('/api/config').then(function(r) { return r.json(); })
            ]);
            spmPresets = results[0].presets || [];
            spmGroups = results[0].groups || [];
            spmProvidersData = results[1];
        } catch(e) {
            spmPresets = [];
            spmGroups = [];
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

    // 预设归属哪个分组（tags 里第一个命中的分组 id）；无则返回 ''
    function spmGroupOfPreset(p) {
        var known = {};
        spmGroups.forEach(function(g) { known[g.id] = true; });
        var tags = (p && p.tags) || [];
        for (var i = 0; i < tags.length; i++) {
            if (known[tags[i]]) return tags[i];
        }
        return '';
    }

    function spmEnc(s) { return encodeURIComponent(String(s == null ? '' : s)); }

    function spmRenderList() {
        var el = document.getElementById('spmList');
        if (!el) return;
        var buckets = {};
        spmGroups.forEach(function(g) { buckets[g.id] = []; });
        var ungrouped = [];
        spmPresets.forEach(function(p) {
            var gid = spmGroupOfPreset(p);
            if (gid && buckets[gid]) buckets[gid].push(p);
            else ungrouped.push(p);
        });

        function itemHtml(p) {
            var delBtn = p.id !== 'default'
                ? '<button class="spm-item-del" onclick="event.stopPropagation();spmDelete(\'' + p.id + '\')" title="删除">✕</button>'
                : '';
            return [
                '<div class="spm-item ' + (p.id === spmEditingId ? 'active' : '') + '" onclick="spmEdit(\'' + p.id + '\')">',
                '<div class="spm-item-name">' + spmEsc(p.name || p.id) + '</div>',
                delBtn,
                '</div>'
            ].join('');
        }

        function headHtml(g, list, idx) {
            var gid = g.id || '';
            var isNone = !gid;
            var ops = '';
            if (!isNone) {
                if (idx > 0) ops += '<button onclick="event.stopPropagation();spmMoveGroup(decodeURIComponent(\'' + spmEnc(gid) + '\'),-1)" title="上移">↑</button>';
                if (idx < spmGroups.length - 1) ops += '<button onclick="event.stopPropagation();spmMoveGroup(decodeURIComponent(\'' + spmEnc(gid) + '\'),1)" title="下移">↓</button>';
                ops += '<button onclick="event.stopPropagation();spmRenameGroup(decodeURIComponent(\'' + spmEnc(gid) + '\'))" title="重命名分组">✎</button>';
                ops += '<button onclick="event.stopPropagation();spmDeleteGroup(decodeURIComponent(\'' + spmEnc(gid) + '\'))" title="删除分组（预设保留）">✕</button>';
            }
            var key = isNone ? '__none__' : gid;
            return '<div class="spm-group-head' + (spmGroupFilter === key ? ' is-active' : '') + '" onclick="spmSetGroupFilter(decodeURIComponent(\'' + spmEnc(key) + '\'))">' +
                '<span class="spm-group-name">' + spmEsc(g.name || '未分组') + '</span>' +
                '<span class="spm-group-count">' + list.length + '</span>' +
                (ops ? '<span class="spm-group-ops">' + ops + '</span>' : '') +
                '</div>' + list.map(itemHtml).join('');
        }

        var html = '';
        if (!spmGroupFilter) {
            spmGroups.forEach(function(g, i) { html += headHtml(g, buckets[g.id], i); });
            if (ungrouped.length) html += headHtml({ id: '', name: '未分组' }, ungrouped, -1);
        } else if (spmGroupFilter === '__none__') {
            html += headHtml({ id: '', name: '未分组' }, ungrouped, -1);
        } else {
            var gi = -1;
            spmGroups.forEach(function(g, i) { if (g.id === spmGroupFilter) gi = i; });
            if (gi >= 0) html += headHtml(spmGroups[gi], buckets[spmGroups[gi].id], gi);
            else { spmGroupFilter = ''; html = ''; spmGroups.forEach(function(g, i) { html += headHtml(g, buckets[g.id], i); }); if (ungrouped.length) html += headHtml({ id: '', name: '未分组' }, ungrouped, -1); }
        }
        el.innerHTML = html || '<div class="spm-list-empty">还没有预设</div>';
        spmRenderFilterBar();
    }

    function spmRenderFilterBar() {
        var bar = document.getElementById('spmFilterRow');
        if (!bar) return;
        var noneCount = spmPresets.filter(function(p) { return !spmGroupOfPreset(p); }).length;
        bar.innerHTML =
            '<button class="spm-filter-chip' + (spmGroupFilter ? '' : ' is-on') + '" onclick="spmSetGroupFilter(\'\')">全部 ' + spmPresets.length + '</button>' +
            '<button class="spm-filter-chip' + (spmGroupFilter === '__none__' ? ' is-on' : '') + '" onclick="spmSetGroupFilter(\'__none__\')">未分组 ' + noneCount + '</button>';
    }

    function spmSetGroupFilter(gid) {
        var next = String(gid || '');
        spmGroupFilter = (spmGroupFilter === next) ? '' : next;
        spmRenderList();
    }

    function spmShowEmpty() {
        var empty = document.getElementById('spmEmpty');
        var form = document.getElementById('spmForm');
        if (empty) empty.style.display = '';
        if (form) form.style.display = 'none';
    }

    function spmEdit(id) {
        spmEditingId = id;
        spmTagMenuOpen = false;
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
        spmRenderTagPicker();
        spmRenderList();
        spmSyncFoldSummary();
    }

    // 折叠区的即时摘要 + 规则状态提示（只读展示，不参与保存）
    function spmSyncFoldSummary() {
        try {
            var val = function(id) { var el = document.getElementById(id); return el ? String(el.value || '') : ''; };
            var modelMap = { 'all': '全部模型', 'Z-Image': 'Z-Image', 'ANIMA': 'ANIMA', 'Anima图生图': 'Anima 图生图' };
            var params = document.getElementById('spmFoldParams');
            if (params) {
                params.textContent = (modelMap[val('spmModelMode')] || '全部模型')
                    + ' · 温度 ' + (val('spmTemp') || '0.3')
                    + ' · 上限 ' + (val('spmTokens') || '1024');
            }
            var tpl = document.getElementById('spmFoldTemplates');
            if (tpl) {
                var parts = [];
                if (val('spmQuality')) parts.push('质量词已填');
                if (val('spmNegative')) parts.push('负向已填');
                tpl.textContent = parts.length ? parts.join(' · ') : '未填写';
            }
            var state = document.getElementById('spmRuleState');
            if (state) {
                var len = val('spmSystemPrompt').trim().length;
                state.textContent = len ? ('自定义规则 · ' + len + ' 字') : '留空则用内置 Anima 规则';
            }
        } catch (e) {}
    }

    // ── 分组归属：折叠式多选下拉（点外部收起） ──
    var spmTagMenuOpen = false;

    function spmRenderTagPicker() {
        var box = document.getElementById('spmTags');
        if (!box) return;
        var p = spmPresets.find(function(x) { return x.id === spmEditingId; });
        var tags = (p && p.tags) || [];
        var known = {};
        spmGroups.forEach(function(g) { known[g.id] = true; });
        var names = tags.map(function(t) {
            var g = spmGroups.find(function(x) { return x.id === t; });
            return g ? g.name : t;
        });
        var label = names.length ? names.join('、') : '未分组';
        var html = spmGroups.map(function(g) {
            var on = tags.indexOf(g.id) >= 0;
            return '<button type="button" class="spm-tag-opt' + (on ? ' is-on' : '') + '" onclick="spmToggleTag(decodeURIComponent(\'' + spmEnc(g.id) + '\'))">'
                + '<span class="spm-tag-check">' + (on ? '✓' : '') + '</span>' + spmEsc(g.name) + '</button>';
        }).join('');
        // 不在分组表里的旧标签（如早期写入的中文名）也显示出来，点一下即可移除
        tags.filter(function(t) { return !known[t]; }).forEach(function(t) {
            html += '<button type="button" class="spm-tag-opt is-on is-legacy" title="旧标签，点击移除" onclick="spmToggleTag(decodeURIComponent(\'' + spmEnc(t) + '\'))">'
                + '<span class="spm-tag-check">✓</span>' + spmEsc(t) + '</button>';
        });
        html += '<button type="button" class="spm-tag-opt spm-tag-new" onclick="spmNewGroup()">+ 新建分组</button>';
        box.className = 'spm-tags' + (spmTagMenuOpen ? ' is-open' : '');
        box.innerHTML =
            '<button type="button" class="spm-tag-trigger" onclick="spmToggleTagMenu(event)" title="' + spmEsc(label) + '">'
            + '<span class="spm-tag-value' + (names.length ? '' : ' is-empty') + '">' + spmEsc(label) + '</span>'
            + '<svg class="spm-tag-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>'
            + '</button>'
            + '<div class="spm-tag-menu" onclick="event.stopPropagation()">' + html + '</div>';
    }

    window.spmToggleTagMenu = function(e) {
        if (e) { e.stopPropagation(); e.preventDefault(); }
        spmTagMenuOpen = !spmTagMenuOpen;
        spmRenderTagPicker();
    };

    // 点空白处收起分组下拉（只注册一次）
    if (!window.__spmTagMenuBound) {
        window.__spmTagMenuBound = true;
        document.addEventListener('click', function() {
            if (!spmTagMenuOpen) return;
            spmTagMenuOpen = false;
            spmRenderTagPicker();
        });
    }

    function spmToggleTag(tag) {
        var p = spmPresets.find(function(x) { return x.id === spmEditingId; });
        if (!p) return;
        var tags = (p.tags || []).slice();
        var i = tags.indexOf(tag);
        if (i >= 0) tags.splice(i, 1); else tags.push(tag);
        p.tags = tags;
        spmRenderTagPicker();
        spmAutoSave();
    }

    async function spmNewGroup() {
        var name = (window.prompt('新建分组名称（可把当前预设放进去）') || '').trim();
        if (!name) return;
        if (spmGroups.some(function(g) { return g.name === name; })) { alert('已有同名分组'); return; }
        var gid = 'group-' + Date.now().toString(36);
        spmGroups.push({ id: gid, name: name });
        try {
            await fetch(pmApi('/groups'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: gid, name: name })
            });
        } catch(e) {}
        var p = spmPresets.find(function(x) { return x.id === spmEditingId; });
        if (p) {
            p.tags = (p.tags || []).concat([gid]);
            spmSave();
        }
        spmRenderTagPicker();
        spmRenderList();
        spPickerLoadPresets();
    }

    async function spmRenameGroup(gid) {
        var g = spmGroups.find(function(x) { return x.id === gid; });
        if (!g) return;
        var name = (window.prompt('重命名分组', g.name) || '').trim();
        if (!name || name === g.name) return;
        if (spmGroups.some(function(x) { return x.id !== gid && x.name === name; })) { alert('已有同名分组'); return; }
        g.name = name;
        try {
            await fetch(pmApi('/groups/' + encodeURIComponent(gid)), {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name })
            });
        } catch(e) {}
        spmRenderTagPicker();
        spmRenderList();
        spPickerLoadPresets();
    }

    async function spmDeleteGroup(gid) {
        var g = spmGroups.find(function(x) { return x.id === gid; });
        if (!g) return;
        if (!confirm('删除分组「' + g.name + '」？组内预设不会被删除，只会变成未分组。')) return;
        try { await fetch(pmApi('/groups/' + encodeURIComponent(gid)), { method: 'DELETE' }); } catch(e) {}
        spmGroups = spmGroups.filter(function(x) { return x.id !== gid; });
        // 从所有预设的 tags 里摘掉这个分组
        var affected = spmPresets.filter(function(p) { return (p.tags || []).indexOf(gid) >= 0; });
        for (var i = 0; i < affected.length; i++) {
            var p = affected[i];
            p.tags = (p.tags || []).filter(function(t) { return t !== gid; });
            try {
                await fetch(pmApi('/presets/' + p.id), {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(p)
                });
            } catch(e) {}
        }
        if (spmGroupFilter === gid) spmGroupFilter = '';
        spmRenderTagPicker();
        spmRenderList();
        spPickerLoadPresets();
    }

    async function spmMoveGroup(gid, dir) {
        var idx = -1;
        for (var i = 0; i < spmGroups.length; i++) { if (spmGroups[i].id === gid) { idx = i; break; } }
        var to = idx + dir;
        if (idx < 0 || to < 0 || to >= spmGroups.length) return;
        var tmp = spmGroups[idx]; spmGroups[idx] = spmGroups[to]; spmGroups[to] = tmp;
        spmRenderList();
        try {
            await fetch(pmApi('/groups/reorder'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: spmGroups.map(function(g) { return g.id; }) })
            });
        } catch(e) {}
        spPickerLoadPresets();
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

    async function spmCreate() {
        var id = 'preset-' + Date.now().toString(36);
        var p = {
            id: id,
            name: '新预设',
            description: '',
            model_mode: 'all',
            temperature: 0.3,
            max_tokens: 1024,
            quality_tags: 'masterpiece, best quality, ultra detailed, highres',
            negative_default: 'worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, cropped, lowres, blurry',
            system_prompt: '',
            output_format: 'tag_only',
            tags: (spmGroupFilter && spmGroupFilter !== '__none__') ? [spmGroupFilter] : [],
            is_default: false,
            created_at: new Date().toISOString().slice(0, 10)
        };
        spmPresets.push(p);
        spmEdit(id);
        // 走 POST 真正落盘：PUT 只更新已存在的预设，新建必须 POST
        try {
            await fetch(pmApi('/presets'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(p)
            });
        } catch(e) {}
        spmAutoSave();
    }

    function spmAutoSave() {
        spmSyncFoldSummary();
        clearTimeout(spmSaveTimer);
        spmSaveTimer = setTimeout(function() { spmSave(); }, 500);
    }

    async function spmSave() {
        if (!spmEditingId) return;
        var p = spmPresets.find(function(x) { return x.id === spmEditingId; });
        if (!p) return;
        p.name = (document.getElementById('spmName').value || '').trim() || p.name;
        p.description = (document.getElementById('spmDesc').value || '').trim();
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
        spPickerLoadPresets();
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
            '<div>',
            '<div class="spm-title">提示词预设管理</div>',
            '<div class="spm-subtitle">AI 扩写时使用的规则与模板</div>',
            '</div>',
            '<button class="spm-close" onclick="spmClose()" title="关闭">✕</button>',
            '</div>',
            '<div class="spm-body">',
            '<div class="spm-side">',
            '<div class="spm-side-head">',
            '<div class="spm-head-row">',
            '<button class="spm-add-btn is-primary" onclick="spmCreate()">新建预设</button>',
            '<button class="spm-add-btn is-ghost" onclick="spmNewGroup()" title="新建分组">+ 分组</button>',
            '</div>',
            '<div class="spm-filter-row" id="spmFilterRow"></div>',
            '</div>',
            '<div id="spmList" class="spm-list"></div>',
            '</div>',
            '<div class="spm-editor">',
            '<div id="spmEmpty" class="spm-empty" style="flex-direction:column;gap:10px;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;"><path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/><circle cx="12" cy="15" r="2"/></svg><span>从左侧选一个预设开始编辑</span></div>',
            '<div id="spmForm" class="spm-form" style="display:none;">',
            '<div class="spm-meta sp-field-row sp-row-3">',
            '<div class="sp-field"><label>预设名称</label><input id="spmName" placeholder="如：萌系动漫" oninput="spmAutoSave()"></div>',
            '<div class="sp-field"><label>描述</label><input id="spmDesc" placeholder="简短描述适用场景" oninput="spmAutoSave()"></div>',
            '<div class="sp-field"><label>所属分组<span class="sp-hint">可多选</span></label><div id="spmTags" class="spm-tags"></div></div>',
            '</div>',
            '<section class="sp-main">',
            '<div class="sp-section-head"><span class="sp-section-title">规则</span><span class="sp-section-note" id="spmRuleState">留空则用内置 Anima 规则</span></div>',
            '<textarea id="spmSystemPrompt" placeholder="留空使用内置 Anima 规则，填写则完全替换" oninput="spmAutoSave()"></textarea>',
            '</section>',
            '<details class="sp-fold">',
            '<summary><span class="sp-fold-title">生成参数</span><em class="sp-fold-sum" id="spmFoldParams"></em></summary>',
            '<div class="sp-fold-body">',
            '<div class="sp-field-row sp-row-3">',
            '<div class="sp-field"><label>适用模型</label><select id="spmModelMode" onchange="spmAutoSave()"><option value="all">全部模型</option><option value="Z-Image">Z-Image</option><option value="ANIMA">ANIMA</option><option value="Anima图生图">Anima图生图</option></select></div>',
            '<div class="sp-field"><label>采样温度</label><input id="spmTemp" type="number" min="0" max="2" step="0.1" value="0.3" oninput="spmAutoSave()"></div>',
            '<div class="sp-field"><label>最大长度</label><input id="spmTokens" type="number" min="64" max="4096" step="64" value="1024" oninput="spmAutoSave()"></div>',
            '</div>',
            '</div>',
            '</details>',
            '<details class="sp-fold">',
            '<summary><span class="sp-fold-title">质量词与负向提示词</span><em class="sp-fold-sum" id="spmFoldTemplates"></em></summary>',
            '<div class="sp-fold-body">',
            '<div class="sp-field-row sp-row-2">',
            '<div class="sp-field"><label>质量词模板</label><input id="spmQuality" placeholder="masterpiece, best quality, ultra detailed, highres" oninput="spmAutoSave()"></div>',
            '<div class="sp-field"><label>默认负向提示词</label><input id="spmNegative" placeholder="worst quality, low quality, bad anatomy..." oninput="spmAutoSave()"></div>',
            '</div>',
            '</div>',
            '</details>',
            '</div>',
            '</div>',
            '</div>',
            '<div class="spm-foot">',
            '<div class="spm-status"><span class="spm-dot"></span>改动自动保存</div>',
            '<button class="spm-done" onclick="spmClose()">完成</button>',
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
    window.spPickerGroups = spPickerGroups;
    window.spPickerSelectedId = spPickerSelectedId;
    window.spPickerProviders = spPickerProviders;

    // PresetPicker 全局函数
    window.spPickerLoadPresets = spPickerLoadPresets;
    window.spPickerLoadProviders = spPickerLoadProviders;
    window.spPickerProviderOptionsHtml = spPickerProviderOptionsHtml;
    window.spPickerRender = spPickerRender;
    window.spPickerChangeProvider = spPickerChangeProvider;
    window.spPickerSelect = spPickerSelect;
    window.spPickerSelectAndClose = spPickerSelectAndClose;
    window.spPickerOpen = spPickerOpen;
    window.spPickerClose = spPickerClose;
    window.escHtml = escHtml;
    window.spPickerInit = spPickerInit;

    // 内联编辑函数（供 onclick 调用）
    window.spPickerOpenEdit = spPickerOpenEdit;
    window.spEditorClose = spEditorClose;
    window.spEditorAutoSave = spEditorAutoSave;
    window.spEditorDelete = spEditorDelete;
    window.spPickerCreate = spPickerCreate;
    window.spPickerDelete = spPickerDelete;
    window.spPickerDeleteClick = spPickerDeleteClick;
    window.spPickerSetGroupFilter = spPickerSetGroupFilter;
    window.spPickerSearch = spPickerSearch;
    window.spPickerToggleGroup = spPickerToggleGroup;
    window.spPickerToggleGroup = spPickerToggleGroup;
    window.spPickerAddGroup = spPickerAddGroup;
    window.spPickerQuickAddGroup = spPickerQuickAddGroup;
    window.spPickerSyncGroups = spPickerSyncGroups;
    window.spPickerShowGroupMenu = spPickerShowGroupMenu;
    window.spPickerRenameGroup = spPickerRenameGroup;
    window.spPickerMoveGroup = spPickerMoveGroup;
    window.spPickerDeleteGroup = spPickerDeleteGroup;

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
    // 分组管理
    window.spmGroups = spmGroups;
    window.spmSetGroupFilter = spmSetGroupFilter;
    window.spmRenderTagPicker = spmRenderTagPicker;
    window.spmToggleTag = spmToggleTag;
    window.spmNewGroup = spmNewGroup;
    window.spmRenameGroup = spmRenameGroup;
    window.spmDeleteGroup = spmDeleteGroup;
    window.spmMoveGroup = spmMoveGroup;

    // [2026-07-28] 全局 toast (修复: 原 spToast 全项目未定义，导致"已保存"等提示抛 ReferenceError)
    window.spToast = function(msg) {
        var el = document.getElementById('spToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'spToast';
            el.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:8px;font-size:11px;font-weight:800;background:#059669;color:#fcfcfb;z-index:50;transition:opacity .3s;opacity:0;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
            var win = document.querySelector('.sp-picker-window');
            if (win) { win.style.position = 'relative'; win.appendChild(el); }
            else { document.body.appendChild(el); }
        }
        el.textContent = msg;
        el.style.opacity = '1';
        if (window._spToastTimer) clearTimeout(window._spToastTimer);
        window._spToastTimer = setTimeout(function() { el.style.opacity = '0'; }, 1800);
    };

})();
