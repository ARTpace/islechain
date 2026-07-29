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
            '    display: flex !important; flex-direction: column !important; overflow: hidden;',
            '    transform: translateY(10px); transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);',
            '    position: relative;',
            '}',
            '.sp-picker-window > .sp-picker-head { order: 0; flex-shrink: 0; }',
            '.sp-picker-window > .sp-picker-list-view { order: 1; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }',
            '.sp-picker-window > .sp-picker-edit-view { order: 2; flex: 1 1 auto; min-height: 0; overflow-y: auto; }',
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
            '.sp-channel-toggle { display: flex; gap: 2px; padding: 3px; background: rgba(0,0,0,0.05); border-radius: 10px; flex-shrink: 0; }',
            '.sp-channel-btn { height: 24px; padding: 0 10px; border: none; border-radius: 7px; background: transparent; color: #888; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.15s; }',
            '.sp-channel-btn:hover { color: #333; }',
            '.sp-channel-btn.active { background: #fff; color: var(--accent, #00b4d8); box-shadow: 0 1px 4px rgba(0,0,0,0.08); }',
            'body.studio-theme-dark .sp-channel-toggle { background: rgba(255,255,255,0.06); }',
            'body.studio-theme-dark .sp-channel-btn { color: #888; }',
            'body.studio-theme-dark .sp-channel-btn:hover { color: #e0e7ef; }',
            'body.studio-theme-dark .sp-channel-btn.active { background: rgba(0,240,255,0.12); color: #00f0ff; box-shadow: 0 0 0 1px rgba(0,240,255,0.2); }',
            '.sp-global-model-row { display: flex; align-items: center; gap: 8px; padding: 8px 20px; border-bottom: 1px solid rgba(0,0,0,0.06); flex-shrink: 0; }',
            '.sp-global-model-row label { font-size: 11px; color: #888; font-weight: 700; white-space: nowrap; }',
            '.sp-global-model-row select { flex: 1; min-width: 0; height: 28px; padding: 0 8px; border: 1px solid rgba(0,0,0,0.08); border-radius: 8px; background: var(--bg-base,#fff); color: var(--text-main,#1a1a1a); font-size: 12px; outline: none; }',
            '.sp-global-model-row select:focus { border-color: var(--accent,#00b4d8); }',
            'body.studio-theme-dark .sp-global-model-row { border-bottom-color: rgba(255,255,255,0.06); }',
            'body.studio-theme-dark .sp-global-model-row label { color: #888; }',
            'body.studio-theme-dark .sp-global-model-row select { background: #0d1520; border-color: rgba(255,255,255,0.08); color: #e0e7ef; }',
            'body.studio-theme-dark .sp-global-model-row select:focus { border-color: #00f0ff; }',
            '.sp-test-btn { height: 28px; padding: 0 12px; border: 1px solid var(--accent,#00b4d8); border-radius: 8px; background: transparent; color: var(--accent,#00b4d8); font-size: 11px; font-weight: 800; cursor: pointer; transition: all 0.15s; flex-shrink: 0; }',
            '.sp-test-btn:hover { background: var(--accent,#00b4d8); color: #fff; }',
            '.sp-test-btn:disabled { opacity: 0.6; cursor: default; }',
            'body.studio-theme-dark .sp-test-btn { border-color: #00f0ff; color: #00f0ff; }',
            'body.studio-theme-dark .sp-test-btn:hover { background: rgba(0,240,255,0.15); color: #00f0ff; }',
            '.sp-picker-head-left { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }',
            '.sp-picker-head-search { display:flex;align-items:center;gap:4px;flex:1;max-width:220px;margin:0 8px; }',
            '.sp-picker-head-search input { flex:1;height:24px;padding:0 8px;border:none;border-radius:6px;background:rgba(0,0,0,0.04);font-size:11px;font-weight:600;color:var(--text-main,#1a1a1a);outline:none; }',
            '.sp-picker-head-search input:focus { background:rgba(0,0,0,0.07); }',
            'body.studio-theme-dark .sp-picker-head-search input { background:rgba(255,255,255,0.06); color:#e0e7ef; }',
            'body.studio-theme-dark .sp-picker-head-search input:focus { background:rgba(255,255,255,0.1); }',
            '.sp-picker-add-btn {',
            '    width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center;',
            '    background: var(--accent, #00b4d8); color: #fff; transition: all 0.15s; cursor: pointer; border: none;',
            '    box-shadow: 0 2px 6px rgba(0,180,216,0.25);',
            '}',
            '.sp-picker-add-btn:hover { opacity: 0.85; transform: scale(1.05); }',
            '.sp-picker-add-btn:active { transform: scale(0.95); }',
            'body.studio-theme-dark .sp-picker-add-btn { background: #00f0ff; color: #0a0e17; box-shadow: 0 2px 6px rgba(0,240,255,0.3); }',
            '.spe-group-chip {',
            '    height:24px;padding:0 10px;border-radius:10px;font-size:10px;font-weight:700;',
            '    border:1px solid rgba(0,0,0,0.1);background:transparent;color:#999;',
            '    cursor:pointer;transition:.15s;display:inline-flex;align-items:center;gap:4px;',
            '}',
            '.spe-group-chip:hover { border-color:var(--accent,#00b4d8); color:var(--accent,#00b4d8); }',
            '.spe-group-chip.active { background:var(--accent,#00b4d8); color:#fff; border-color:var(--accent,#00b4d8); }',
            'body.studio-theme-dark .spe-group-chip { border-color:rgba(255,255,255,0.15); color:#777; }',
            'body.studio-theme-dark .spe-group-chip:hover { border-color:#00f0ff; color:#00f0ff; }',
            'body.studio-theme-dark .spe-group-chip.active { background:#00f0ff; color:#0a0e17; border-color:#00f0ff; }',
            '.sp-picker-body { flex: 1; overflow-y: auto; padding: 8px 12px 12px; }',
            '.sp-picker-search {',
            '    display: flex; align-items: center; gap: 6px; padding: 6px 14px 4px;',
            '    border-bottom: 1px solid rgba(0,0,0,0.04);',
            '}',
            'body.studio-theme-dark .sp-picker-search { border-bottom-color: rgba(255,255,255,0.04); }',
            '.sp-picker-search input {',
            '    flex:1;height:28px;padding:0 10px;border:1px solid rgba(0,0,0,0.08);border-radius:8px;',
            '    font-size:11px;font-weight:600;background:var(--bg-base,#fff);color:var(--text-main,#1a1a1a);',
            '    outline:none;transition:border-color .15s;',
            '}',
            '.sp-picker-search input:focus { border-color:var(--accent,#00b4d8); }',
            'body.studio-theme-dark .sp-picker-search input { background:#0d1520; border-color:rgba(255,255,255,0.1); color:#e0e7ef; }',
            '.sp-picker-search svg { color:#ccc; flex-shrink:0; }',
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
            '.sp-sidebar-item.active { background:var(--accent,#00b4d8); color:#fff; }',
            'body.studio-theme-dark .sp-sidebar-item.active { background:#00f0ff; color:#0a0e17; }',
            '.sp-sidebar-label { font-size:11px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }',
            '.sp-sidebar-count { font-size:9px;font-weight:800;opacity:0.5;flex-shrink:0; }',
            '.sp-sidebar-item.active .sp-sidebar-count { opacity:0.8; }',
            '.sp-sidebar-actions { display:none; align-items:center; gap:1px; flex-shrink:0; margin-left:2px; }',
            '.sp-sidebar-item:hover .sp-sidebar-actions { display:flex; }',
            '.sp-sidebar-item:hover .sp-sidebar-count { display:none; }',
            '.sp-sa-btn { width:18px;height:18px;border:none;background:transparent;border-radius:4px;cursor:pointer;font-size:10px;line-height:1;display:flex;align-items:center;justify-content:center;color:#999;padding:0;transition:.1s; }',
            '.sp-sa-btn:hover { background:rgba(0,0,0,0.06); color:var(--text-main,#1a1a1a); }',
            'body.studio-theme-dark .sp-sa-btn { color:#555; }',
            'body.studio-theme-dark .sp-sa-btn:hover { background:rgba(255,255,255,0.08); color:#e0e7ef; }',
            '.sp-sa-del:hover { background:#ef4444!important; color:#fff!important; }',
            '.sp-sidebar-item.drag-over { border-top:2px solid var(--accent,#00b4d8); }',
            'body.studio-theme-dark .sp-sidebar-item.drag-over { border-top-color:#00f0ff; }',
            '.sp-sidebar-item[draggable="true"]:active { cursor:grabbing; }',
            '.sp-picker-edit-view { overflow-y:auto;padding:8px 14px; min-height:0; }',
            '.sp-picker-list-view { display:flex;flex-direction:column;min-height:0; }',
            '.spe-back {',
            '    display:flex;align-items:center;gap:4px;padding:4px 0 10px;cursor:pointer;',
            '    font-size:11px;font-weight:700;color:var(--accent,#00b4d8);border-bottom:1px solid rgba(0,0,0,0.04);margin-bottom:10px;',
            '}',
            '.spe-back:hover { opacity:0.75; }',
            'body.studio-theme-dark .spe-back { color:#00f0ff; border-bottom-color:rgba(255,255,255,0.04); }',
            '.spe-edit-head { display:flex;align-items:center;justify-content:space-between;padding:4px 0 10px;border-bottom:1px solid rgba(0,0,0,0.04);margin-bottom:10px; }',
            'body.studio-theme-dark .spe-edit-head { border-bottom-color:rgba(255,255,255,0.04); }',
            '.spe-group-trigger { display:flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#999;cursor:pointer;padding:4px 8px;border-radius:6px;transition:.12s; }',
            '.spe-group-trigger:hover { background:rgba(0,0,0,0.04); color:var(--accent,#00b4d8); }',
            'body.studio-theme-dark .spe-group-trigger:hover { background:rgba(255,255,255,0.06); color:#00f0ff; }',
            '.sp-group-menu-item { display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;transition:.1s; }',
            '.sp-group-menu-item:hover { background:rgba(0,0,0,0.04); }',
            'body.studio-theme-dark .sp-group-menu-item:hover { background:rgba(255,255,255,0.06); }',
            '.sp-group-menu-check { width:16px;height:16px;border-radius:4px;border:1.5px solid #ccc;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;flex-shrink:0;color:var(--accent,#00b4d8); }',
            'body.studio-theme-dark .sp-group-menu-check { border-color:#555; }',
            '.sp-sidebar-add { padding:8px 10px;margin-top:4px;border-radius:8px;font-size:10px;font-weight:800;color:var(--accent,#00b4d8);cursor:pointer;text-align:center;transition:.1s; }',
            '.sp-sidebar-add:hover { background:rgba(0,0,0,0.04); }',
            'body.studio-theme-dark .sp-sidebar-add:hover { background:rgba(255,255,255,0.05); }',
            '.sp-picker-group-head {',
            '    display: flex; align-items: center; gap: 8px; padding: 10px 6px 4px;',
            '}',
            '.sp-picker-group-name {',
            '    font-size: 9px; font-weight: 800; color: #999; text-transform: uppercase; letter-spacing: 0.08em;',
            '}',
            'body.studio-theme-dark .sp-picker-group-name { color: #666; }',
            '.sp-picker-group-count {',
            '    font-size: 9px; font-weight: 800; color: #ccc; padding: 1px 6px; border-radius: 8px;',
            '    background: rgba(0,0,0,0.04);',
            '}',
            'body.studio-theme-dark .sp-picker-group-count { color: #555; background: rgba(255,255,255,0.04); }',
            '.sp-picker-group-del {',
            '    width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;',
            '    border:none;background:rgba(0,0,0,0.04);color:#ccc;cursor:pointer;font-size:8px;line-height:1;',
            '    transition:.15s;opacity:0;flex-shrink:0;margin-left:auto;',
            '}',
            '.sp-picker-group-head:hover .sp-picker-group-del { opacity:1; }',
            '.sp-picker-group-del:hover { background:#ef4444; color:#fff; }',
            'body.studio-theme-dark .sp-picker-group-del { background:rgba(255,255,255,0.06); color:#555; }',
            'body.studio-theme-dark .sp-picker-group-del:hover { background:#ef4444; color:#fff; }',
            '.spe-chip-del {',
            '    display:none;width:12px;height:12px;border-radius:50%;align-items:center;justify-content:center;',
            '    font-size:7px;line-height:1;background:rgba(0,0,0,0.1);color:#fff;margin-left:2px;cursor:pointer;',
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
            'body.studio-theme-dark .sp-picker-item.active { background: rgba(0,240,255,0.06); border-color: rgba(0,240,255,0.2); }',
            '.sp-picker-dot {',
            '    width: 10px; height: 10px; border-radius: 50%; border: 2px solid #ccc;',
            '    flex-shrink: 0; transition: all 0.15s;',
            '}',
            '.sp-picker-item.active .sp-picker-dot { background: #00b4d8; border-color: #00b4d8; }',
            'body.studio-theme-dark .sp-picker-item.active .sp-picker-dot { background: #00f0ff; border-color: #00f0ff; }',
            '.sp-picker-info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; overflow: hidden; }',
            '.sp-picker-name { font-size: 13px; font-weight: 700; color: var(--text-main, #1a1a1a); flex-shrink: 0; }',
            'body.studio-theme-dark .sp-picker-name { color: #e0e7ef; }',
            '.sp-picker-sep { color: #ccc; font-size: 10px; flex-shrink: 0; }',
            'body.studio-theme-dark .sp-picker-sep { color: #555; }',
            '.sp-picker-desc-inline { font-size: 11px; color: #999; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }',
            '.sp-picker-desc { font-size: 11px; color: #999; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            '.sp-picker-item-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }',
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
            '    margin-left: auto;',
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

            /* ---- 预设选择器集成编辑区 ---- */
            '.sp-picker-editor {',
            '    border-top: 1px solid rgba(0,0,0,0.06); padding: 10px 14px 8px;',
            '    max-height: 440px; overflow-y: auto;',
            '}',
            'body.studio-theme-dark .sp-picker-editor { border-top-color: rgba(255,255,255,0.06); }',
            '.sp-picker-editor .spe-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }',
            '.sp-picker-editor .spe-title { font-size:11px; font-weight:800; color:#999; text-transform:uppercase; letter-spacing:.06em; }',
            '.spe-row { display:flex; gap:8px; margin-bottom:6px; }',
            '.spe-field { flex:1; min-width:0; }',
            '.spe-field label { display:block; font-size:9px; font-weight:800; color:#aaa; text-transform:uppercase; letter-spacing:.05em; margin-bottom:2px; }',
            'body.studio-theme-dark .spe-field label { color:#666; }',
            '.spe-field input,.spe-field select {',
            '    width:100%; height:28px; padding:0 8px; box-sizing:border-box;',
            '    border:1px solid rgba(0,0,0,0.1); border-radius:7px;',
            '    font-size:11px; font-weight:600; background:var(--bg-base,#fff); color:var(--text-main,#1a1a1a);',
            '    outline:none; transition:border-color .15s;',
            '}',
            'body.studio-theme-dark .spe-field input,body.studio-theme-dark .spe-field select {',
            '    background:#0d1520; border-color:rgba(255,255,255,0.1); color:#e0e7ef;',
            '}',
            '.spe-field input:focus,.spe-field select:focus { border-color:var(--accent,#00b4d8); }',
            '.spe-actions { display:flex; gap:6px; margin-top:6px; }',
            '.spe-actions button { height:28px; padding:0 12px; border-radius:8px; font-size:10px; font-weight:800; border:1px solid rgba(0,0,0,0.1); background:transparent; color:#999; cursor:pointer; transition:.15s; display:flex; align-items:center; gap:4px; }',
            '.spe-actions button:hover { background:rgba(0,0,0,0.04); }',
            'body.studio-theme-dark .spe-actions button { border-color:rgba(255,255,255,0.1); color:#777; }',
            'body.studio-theme-dark .spe-actions button:hover { background:rgba(255,255,255,0.05); }',
            '.spe-actions .spe-del-btn { color:#ef4444; border-color:rgba(239,68,68,0.3); }',
            '.spe-actions .spe-del-btn:hover { background:#ef4444!important; color:#fff!important; }',
            'body.studio-theme-dark .spe-actions .spe-del-btn { color:#f87171; border-color:rgba(248,113,113,0.3); }',
            'body.studio-theme-dark .spe-actions .spe-del-btn:hover { background:#ef4444!important; color:#fff!important; }',
            '.spe-picker-edit-btn {',
            '    width:24px;height:24px;border-radius:6px;flex-shrink:0;',
            '    display:flex;align-items:center;justify-content:center;',
            '    border:none;background:transparent;color:#ccc;cursor:pointer;',
            '    transition:.15s;opacity:0;',
            '}',
            '.sp-picker-item:hover .spe-picker-edit-btn { opacity:1; }',
            '.spe-picker-edit-btn:hover { background:rgba(0,0,0,0.06); color:#666; }',
            'body.studio-theme-dark .spe-picker-edit-btn { color:#444; }',
            'body.studio-theme-dark .spe-picker-edit-btn:hover { background:rgba(255,255,255,0.08); color:#aaa; }',
            '.spe-picker-del-btn {',
            '    width:24px;height:24px;border-radius:6px;flex-shrink:0;',
            '    display:flex;align-items:center;justify-content:center;',
            '    border:none;background:transparent;color:#ccc;cursor:pointer;',
            '    transition:.15s;opacity:0;',
            '}',
            '.sp-picker-item:hover .spe-picker-del-btn { opacity:1; }',
            '.spe-picker-del-btn:hover { background:rgba(239,68,68,0.12); color:#ef4444; }',
            'body.studio-theme-dark .spe-picker-del-btn { color:#555; }',
            'body.studio-theme-dark .spe-picker-del-btn:hover { background:rgba(239,68,68,0.18); color:#f87171; }',
            '.spe-picker-del-btn.is-confirming { background:#ef4444!important; color:#fff!important; box-shadow:0 0 0 3px rgba(239,68,68,0.3); animation:spDelPulse 0.6s ease-in-out infinite alternate; }',
            '@keyframes spDelPulse { from { transform:scale(1); } to { transform:scale(1.12); } }',

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
                }
                var res = await fetch(pmApi('/generate'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(_body)
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
                // [2026-07-28] picker 设置的通道写入 window, 这里保持同步
                if (opts.channel) window.localPromptChannel = opts.channel;
                btn = createButton();
                container.appendChild(btn);
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
            body.innerHTML = '<div style="text-align:center;padding:40px 12px;color:#999;font-size:12px;">没有匹配的预设</div>';
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
            '<div class="spe-field"><label style="color:var(--accent,#00b4d8);">AI 规则（System Prompt）</label><textarea id="speSystemPrompt" rows="8" style="width:100%;min-height:200px;box-sizing:border-box;padding:8px 10px;border:1px solid rgba(0,180,216,0.3);border-radius:7px;font-size:11px;font-weight:600;background:var(--bg-base,#fff);color:var(--text-main,#1a1a1a);outline:none;resize:vertical;font-family:inherit;line-height:1.5;" oninput="spEditorAutoSave()">' + sSysPrompt + '</textarea></div>',
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
        input.style.cssText = 'width:calc(100% - 12px);margin:4px 6px;height:28px;padding:0 8px;border:1px solid var(--accent,#00b4d8);border-radius:8px;font-size:11px;font-weight:600;background:var(--bg-base,#fff);color:var(--text-main,#1a1a1a);outline:none;box-sizing:border-box;';
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
        input.style.cssText = 'width:100%;height:22px;padding:0 4px;border:1px solid var(--accent,#00b4d8);border-radius:5px;font-size:11px;font-weight:600;background:var(--bg-base,#fff);color:var(--text-main,#1a1a1a);outline:none;box-sizing:border-box;';
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
        menu.style.cssText = 'position:absolute;top:100%;right:0;z-index:999;min-width:150px;background:var(--bg-base,#fff);border:1px solid rgba(0,0,0,0.1);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:6px;';
        var p = spPickerPresets.find(function(x) { return x.id === _spEditingId; });
        var tags = p ? (p.tags || []) : [];
        if (spPickerGroups.length === 0) {
            menu.innerHTML = '<div style="padding:14px 10px;font-size:11px;color:#999;text-align:center;">暂无分组<br>在左侧栏创建</div>';
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
            el.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:8px;font-size:10px;font-weight:800;background:#059669;color:#fff;z-index:10;transition:opacity .3s;opacity:0;pointer-events:none;white-space:nowrap;';
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
            '<div class="sp-picker-head-search"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;color:#aaa;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="spSearchInput" placeholder="搜索..." oninput="spPickerSearch()"></div>',
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
            spToast((ok ? '✓ ' : '✗ ') + (data.detail || (ok ? '可用' : '不可用')));
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

    // [2026-07-28] 全局 toast (修复: 原 spToast 全项目未定义，导致"已保存"等提示抛 ReferenceError)
    window.spToast = function(msg) {
        var el = document.getElementById('spToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'spToast';
            el.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:8px;font-size:11px;font-weight:800;background:#059669;color:#fff;z-index:50;transition:opacity .3s;opacity:0;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
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
