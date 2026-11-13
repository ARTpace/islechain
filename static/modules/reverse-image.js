/*
 * reverse-image.js — 图片反推（interrogate）独立功能模块
 * 用法：
 *   <div id="reverseImageMount"></div>
 *   <script src="/static/modules/reverse-image.js"></script>
 *   <script>
 *     ReverseImage.init({
 *       mountId: 'reverseImageMount',
 *       onApply: function (text, mode) {  // mode: 'replace' | 'append'
 *         // 把反推结果写回你页面的提示词框等
 *       }
 *     });
 *   </script>
 *   // 触发打开：ReverseImage.open()
 */
(function () {
  'use strict';

  // ───────────────────────────── CSS ─────────────────────────────
  var CSS = [
    "/* 浮层：玻璃感(轻) + 浅/深色双适配；PC 居中浮层 / 手机贴底上滑 */",
    ".reverse-modal-overlay { position:fixed; inset:0; background:rgba(23, 23, 22, .35); display:none; align-items:center; justify-content:center; z-index:9999;",
    "    -webkit-backdrop-filter:blur(10px) saturate(140%); backdrop-filter:blur(10px) saturate(140%); }",
    ".reverse-modal-overlay.show { display:flex; animation: reverseFadeIn .18s ease; }",
    "@keyframes reverseFadeIn { from { opacity:0; } to { opacity:1; } }",
    "@keyframes reverseSlideIn { from { opacity:0; transform:translateY(20px) scale(.98); } to { opacity:1; transform:translateY(0) scale(1); } }",
    "@keyframes reverseViewIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }",
    "",
    "/* 浅色：白磨砂玻璃;深色：深蓝磨砂；统一最小高度，三视图尺寸一致；上限 560px */",
    ".reverse-modal { width:min(560px,94vw); min-height:480px; max-height:88vh; overflow:hidden;",
    "    background:rgba(255,255,255,.92); color:#282825;",
    "    border:1px solid rgba(255,255,255,.6); border-radius:18px; padding:20px 22px 18px;",
    "    box-shadow:0 24px 70px rgba(23, 23, 22, .2), 0 0 0 1px rgba(23, 23, 22, .04);",
    "    -webkit-backdrop-filter:blur(22px) saturate(170%); backdrop-filter:blur(22px) saturate(170%);",
    "    animation: reverseSlideIn .22s cubic-bezier(.2,.7,.3,1);",
    "    display:flex; flex-direction:column; box-sizing:border-box; position:relative; }",
    "/* 底部抽屉拖动提示器(仅手机显示) */",
    ".reverse-modal::before { content:''; position:absolute; top:8px; left:50%; transform:translateX(-50%); width:48px; height:5px; border-radius:3px; background:rgba(0,0,0,.32); display:none; }",
    "body.studio-theme-dark .reverse-modal::before { background:rgba(255,255,255,.42); }",
    "body.studio-theme-dark .reverse-modal { background:rgba(31, 31, 29, .78); color:#ebe9e4;",
    "    border:1px solid rgba(250, 249, 247, .08); box-shadow:0 24px 70px rgba(0,0,0,.55), 0 0 0 1px color-mix(in srgb, var(--ui-accent, #00f0ff) 5%, transparent); }",
    "/* 拖入态：整张 modal 染色 + 虚线边框 */",
    ".reverse-modal.is-dragover { border-color:color-mix(in srgb, var(--ui-accent, #06b6d4) 60%, transparent); box-shadow:0 20px 60px color-mix(in srgb, var(--ui-accent, #06b6d4) 20%, transparent), 0 0 0 2px color-mix(in srgb, var(--ui-accent, #06b6d4) 30%, transparent); }",
    "body.studio-theme-dark .reverse-modal.is-dragover { border-color:color-mix(in srgb, var(--ui-accent, #00f0ff) 60%, transparent); box-shadow:0 20px 60px color-mix(in srgb, var(--ui-accent, #00f0ff) 25%, transparent), 0 0 0 2px color-mix(in srgb, var(--ui-accent, #00f0ff) 35%, transparent); }",
    "",
    ".reverse-modal-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; flex-shrink:0; }",
    ".reverse-modal-title { font-size:15px; font-weight:800; letter-spacing:.02em; }",
    ".reverse-modal-header-right { display:flex; align-items:center; gap:4px; }",
    ".reverse-modal-header-btn,",
    ".reverse-modal-close { width:36px; height:36px; border:none; border-radius:10px; background:transparent; color:#828178; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background .12s, color .12s; }",
    ".reverse-modal-header-btn:hover,",
    ".reverse-modal-close:hover { background:rgba(0,0,0,.06); color:#0b0b0a; }",
    ".reverse-modal-header-btn:active,",
    ".reverse-modal-close:active { background:rgba(0,0,0,.12); }",
    "body.studio-theme-dark .reverse-modal-header-btn,",
    "body.studio-theme-dark .reverse-modal-close { color:#a8a69e; }",
    "body.studio-theme-dark .reverse-modal-header-btn:hover,",
    "body.studio-theme-dark .reverse-modal-close:hover { background:rgba(255,255,255,.08); color:#fcfcfb; }",
    "",
    "/* 共享：缩略图条(三视图都显示) — 整体加高，按钮加大 */",
    ".reverse-modal-preview { display:flex; align-items:center; gap:12px; padding:10px 12px;",
    "    border:1.5px dashed rgba(0,0,0,.18); border-radius:12px; background:rgba(255,255,255,.4);",
    "    margin-bottom:16px; min-height:72px; flex-shrink:0; transition:border-color .15s, background .15s; }",
    "body.studio-theme-dark .reverse-modal-preview { background:rgba(255,255,255,.03); border-color:rgba(255,255,255,.16); }",
    ".reverse-modal-preview:hover { border-color:color-mix(in srgb, var(--ui-accent, #06b6d4) 40%, transparent); }",
    ".reverse-modal-preview.is-drop-here { border-color:color-mix(in srgb, var(--ui-accent, #06b6d4) 50%, transparent); background:color-mix(in srgb, var(--ui-accent, #06b6d4) 6%, transparent); }",
    "/* 占位缩略图: 72x72 偏正方, 居中放 image-plus 大图标 */",
    ".reverse-modal-preview-thumb { width:72px; height:72px; border-radius:10px; background-color:#efeeea; background-size:contain; background-repeat:no-repeat; background-position:center; flex-shrink:0; border:1px solid rgba(0,0,0,.08); position:relative; overflow:hidden; cursor:pointer; transition:transform .12s, border-color .12s; }",
    ".reverse-modal-preview-thumb:hover { border-color:color-mix(in srgb, var(--ui-accent, #06b6d4) 40%, transparent); }",
    ".reverse-modal-preview-thumb:active { transform:scale(.96); }",
    "body.studio-theme-dark .reverse-modal-preview-thumb { background-color:#232321; border-color:rgba(255,255,255,.12); }",
    "/* 空态: 浅色十字格底纹 + image-plus 居中图标 */",
    ".reverse-modal-preview-thumb.empty::after { content:''; position:absolute; inset:0; background:",
    "    linear-gradient(45deg, transparent 48%, rgba(0,0,0,.08) 48%, rgba(0,0,0,.08) 52%, transparent 52%),",
    "    linear-gradient(-45deg, transparent 48%, rgba(0,0,0,.08) 48%, rgba(0,0,0,.08) 52%, transparent 52%);",
    "    background-size:14px 14px; pointer-events:none; }",
    "body.studio-theme-dark .reverse-modal-preview-thumb.empty::after { background:",
    "    linear-gradient(45deg, transparent 48%, rgba(255,255,255,.06) 48%, rgba(255,255,255,.06) 52%, transparent 52%),",
    "    linear-gradient(-45deg, transparent 48%, rgba(255,255,255,.06) 48%, rgba(255,255,255,.06) 52%, transparent 52%);",
    "    background-size:14px 14px; }",
    ".reverse-modal-preview-thumb-icon { position:absolute; top:0; left:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:color-mix(in srgb, var(--ui-accent, #0e7490) 62%, #0b0b0a); pointer-events:none; transition:transform .18s, color .18s; }",
    ".reverse-modal-preview-thumb-icon svg { width:34px; height:34px; stroke-width:1.8; }",
    ".reverse-modal-preview:hover .reverse-modal-preview-thumb-icon { transform:scale(1.12); color:color-mix(in srgb, var(--ui-accent, #0e7490) 62%, #0b0b0a); }",
    "body.studio-theme-dark .reverse-modal-preview-thumb-icon { color:var(--ui-accent, #00f0ff); }",
    "body.studio-theme-dark .reverse-modal-preview:hover .reverse-modal-preview-thumb-icon { color:var(--ui-accent, #00f0ff); }",
    "/* 有文件时隐藏 image-plus, 显示 refresh-cw replace icon */",
    ".reverse-modal-preview:not(.is-empty) .reverse-modal-preview-thumb-icon { display:none; }",
    "/* 有文件时: hover 缩略图出现「重选」遮罩 */",
    ".reverse-modal-preview-replace { position:absolute; top:0; left:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.55); color:#fcfcfb; opacity:0; transition:opacity .15s; pointer-events:none; }",
    ".reverse-modal-preview-replace svg { width:20px; height:20px; stroke-width:2.4; }",
    ".reverse-modal-preview-thumb:hover .reverse-modal-preview-replace { opacity:1; }",
    ".reverse-modal-preview.is-empty .reverse-modal-preview-replace { display:none; }",
    ".reverse-modal-preview-clear-side { display:none; align-items:center; gap:4px; padding:6px 10px; height:30px; border-radius:8px; background:transparent; color:#828178; border:1px solid rgba(0,0,0,.12); cursor:pointer; font-size:12px; font-weight:600; transition:all .15s; margin-left:auto; }",
    ".reverse-modal-preview-clear-side:hover { background:rgba(220,38,38,.08); color:#dc2626; border-color:rgba(220,38,38,.3); }",
    ".reverse-modal-preview-clear-side:active { transform:scale(.95); }",
    ".reverse-modal-preview-clear-side svg { width:13px; height:13px; stroke-width:2.4; }",
    "body.studio-theme-dark .reverse-modal-preview-clear-side { color:#9d9b92; border-color:rgba(255,255,255,.16); }",
    "body.studio-theme-dark .reverse-modal-preview-clear-side:hover { background:rgba(220,38,38,.15); color:#ff6b6b; border-color:rgba(220,38,38,.4); }",
    ".reverse-modal-preview:not(.is-empty) .reverse-modal-preview-clear-side { display:flex; }",
    ".reverse-modal-preview-info { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }",
    ".reverse-modal-preview.is-empty { cursor:pointer; }",
    "/* 有文件: 文件名 + 尺寸, 空态下隐藏所有文字 */",
    ".reverse-modal-preview-name { font-size:14px; font-weight:700; color:#282825; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
    "body.studio-theme-dark .reverse-modal-preview-name { color:#ebe9e4; }",
    ".reverse-modal-preview.is-empty .reverse-modal-preview-name { display:none; }",
    ".reverse-modal-preview-meta { font-size:11px; color:#828178; display:flex; align-items:center; gap:8px; }",
    ".reverse-modal-preview.is-empty .reverse-modal-preview-meta { display:none; }",
    "body.studio-theme-dark .reverse-modal-preview-meta { color:#9d9b92; }",
    "",
    "/* 视图容器：flex 1 撑满剩余空间，切换时淡入 */",
    ".reverse-view { flex:1; min-height:0; display:flex; flex-direction:column; animation: reverseViewIn .22s ease; overflow-y:auto; -webkit-overflow-scrolling:touch; }",
    ".reverse-view[hidden] { display:none !important; }",
    "",
    "/* 结果视图：隐藏缩略图条,空间留给 textarea */",
    "#reverseModal.on-result .reverse-modal-preview { display:none; }",
    "#reverseModal.on-result { min-height:0; }",
    "/* header 在结果视图 显示「重新反推」动作 */",
    ".reverse-modal-header-btn.rerun-btn { color:color-mix(in srgb, var(--ui-accent, #0e7490) 62%, #0b0b0a); }",
    ".reverse-modal-header-btn.rerun-btn:hover { background:color-mix(in srgb, var(--ui-accent, #06b6d4) 10%, transparent); color:color-mix(in srgb, var(--ui-accent, #0e7490) 62%, #0b0b0a); }",
    "body.studio-theme-dark .reverse-modal-header-btn.rerun-btn { color:var(--ui-accent, #00f0ff); }",
    "body.studio-theme-dark .reverse-modal-header-btn.rerun-btn:hover { background:color-mix(in srgb, var(--ui-accent, #00f0ff) 12%, transparent); color:var(--ui-accent, #00f0ff); }",
    "",
    ".reverse-modal-section { margin-bottom:16px; }",
    ".reverse-modal-section:last-of-type { margin-bottom:0; }",
    ".reverse-modal-label { display:block; font-size:11px; font-weight:800; color:#828178; text-transform:uppercase; letter-spacing:.08em; margin-bottom:8px; }",
    "body.studio-theme-dark .reverse-modal-label { color:#9d9b92; }",
    "",
    "/* 选项卡：高度统一 56px,大字号 */",
    ".reverse-modal-options { display:flex; gap:8px; }",
    ".reverse-modal-opt { flex:1; min-height:56px; padding:10px 8px; border:1.5px solid rgba(0,0,0,.08); border-radius:10px; background:rgba(255,255,255,.4); color:#5d5c55; font-size:14px; font-weight:700; cursor:pointer; transition:all .15s; text-align:center; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; }",
    ".reverse-modal-opt:hover { background:rgba(255,255,255,.7); color:#0b0b0a; }",
    ".reverse-modal-opt:active { transform:scale(.97); }",
    ".reverse-modal-opt.active { background:color-mix(in srgb, var(--ui-accent, #06b6d4) 14%, transparent); color:color-mix(in srgb, var(--ui-accent, #0e7490) 62%, #0b0b0a); border-color:color-mix(in srgb, var(--ui-accent, #06b6d4) 50%, transparent); }",
    ".reverse-modal-opt-desc { display:block; font-size:10px; font-weight:600; color:#9d9b92; line-height:1.3; }",
    ".reverse-modal-opt.active .reverse-modal-opt-desc { color:color-mix(in srgb, var(--ui-accent, #06b6d4) 75%, transparent); }",
    "body.studio-theme-dark .reverse-modal-opt { background:rgba(255,255,255,.03); border-color:rgba(255,255,255,.08); color:#a8a69e; }",
    "body.studio-theme-dark .reverse-modal-opt:hover { background:rgba(255,255,255,.06); color:#fcfcfb; }",
    "body.studio-theme-dark .reverse-modal-opt.active { background:rgba(74,222,128,.14); color:#4ade80; border-color:rgba(74,222,128,.5); }",
    "body.studio-theme-dark .reverse-modal-opt.active .reverse-modal-opt-desc { color:rgba(74,222,128,.75); }",
    "",
    "/* select：高度 48px,字号 14px,大点选 */",
    ".reverse-modal-select { width:100%; min-height:48px; background:rgba(255,255,255,.5); border:1.5px solid rgba(0,0,0,.1); border-radius:10px; padding:10px 14px; font-size:14px; color:#282825; outline:none; cursor:pointer; appearance:none; -webkit-appearance:none; background-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%23828178' stroke-width='2'><path d='M1 1l5 5 5-5'/></svg>\"); background-repeat:no-repeat; background-position:right 14px center; background-size:12px; padding-right:36px; }",
    ".reverse-modal-select:focus { border-color:color-mix(in srgb, var(--ui-accent, #06b6d4) 50%, transparent); }",
    "body.studio-theme-dark .reverse-modal-select { background-color:rgba(255,255,255,.04); border-color:rgba(255,255,255,.1); color:#d8d6cd; background-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%23a8a69e' stroke-width='2'><path d='M1 1l5 5 5-5'/></svg>\"); }",
    "/* ── 反推规则（自定义指令）区块 ── */",
    ".reverse-modal-rule-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }",
    ".reverse-modal-rule-head .reverse-modal-label { margin-bottom:0; }",
    ".reverse-modal-rule-select { min-height:34px; max-width:160px; background:rgba(255,255,255,.5); border:1.5px solid rgba(0,0,0,.1); border-radius:8px; padding:6px 30px 6px 10px; font-size:12px; color:#282825; outline:none; cursor:pointer; appearance:none; -webkit-appearance:none; background-image:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%23828178' stroke-width='2'><path d='M1 1l5 5 5-5'/></svg>\"); background-repeat:no-repeat; background-position:right 10px center; background-size:10px; }",
    "body.studio-theme-dark .reverse-modal-rule-select { background-color:rgba(255,255,255,.04); border-color:rgba(255,255,255,.1); color:#d8d6cd; }",
    ".reverse-modal-rule-area { width:100%; min-height:76px; resize:vertical; border:1.5px solid rgba(0,0,0,.08); border-radius:10px; padding:10px 12px; font-size:13px; line-height:1.6; color:#282825; box-sizing:border-box; background:rgba(255,255,255,.6); outline:none; font-family:inherit; }",
    ".reverse-modal-rule-area:focus { border-color:color-mix(in srgb, var(--ui-accent, #06b6d4) 40%, transparent); }",
    "body.studio-theme-dark .reverse-modal-rule-area { background:rgba(255,255,255,.04); border-color:rgba(255,255,255,.08); color:#ebe9e4; }",
    ".reverse-modal-rule-area.is-preset { background:rgba(0,0,0,.03); color:#676660; cursor:not-allowed; }",
    "body.studio-theme-dark .reverse-modal-rule-area.is-preset { background:rgba(255,255,255,.02); color:#9b9a91; }",
    "",
    "/* ── 统一按钮风格(主/次/幽灵),所有按钮 48px 高 ── */",
    ".reverse-modal-actions { display:flex; gap:10px; margin-top:auto; padding-top:16px; flex-shrink:0; }",
    ".reverse-modal-actions .btn-primary,",
    ".reverse-modal-actions .btn-secondary,",
    ".reverse-modal-actions .btn-ghost { min-height:48px; padding:12px 16px; border-radius:10px; font-size:14px; font-weight:700; cursor:pointer; transition:all .12s; display:inline-flex; align-items:center; justify-content:center; gap:4px; }",
    ".reverse-modal-actions .btn-primary { flex:1; border:none; background:linear-gradient(135deg,var(--ui-accent, #06b6d4),color-mix(in srgb, var(--ui-accent, #06b6d4) 58%, #000)); color:#fcfcfb; box-shadow:0 2px 8px color-mix(in srgb, var(--ui-accent, #06b6d4) 25%, transparent); }",
    ".reverse-modal-actions .btn-primary:hover { background:linear-gradient(135deg,var(--ui-accent, #06b6d4),color-mix(in srgb, var(--ui-accent, #06b6d4) 72%, #000)); transform:translateY(-1px); box-shadow:0 4px 12px color-mix(in srgb, var(--ui-accent, #06b6d4) 30%, transparent); }",
    ".reverse-modal-actions .btn-primary:active { transform:translateY(0); box-shadow:0 1px 4px color-mix(in srgb, var(--ui-accent, #06b6d4) 20%, transparent); }",
    ".reverse-modal-actions .btn-primary:disabled { opacity:.4; cursor:not-allowed; transform:none; box-shadow:none; }",
    ".reverse-modal-actions .btn-secondary { flex:1; border:1.5px solid rgba(0,0,0,.1); background:rgba(255,255,255,.55); color:#5d5c55; }",
    ".reverse-modal-actions .btn-secondary:hover { background:rgba(255,255,255,.85); color:#0b0b0a; }",
    ".reverse-modal-actions .btn-secondary:active { transform:scale(.97); }",
    "body.studio-theme-dark .reverse-modal-actions .btn-secondary { background:rgba(255,255,255,.04); border-color:rgba(255,255,255,.14); color:#d8d6cd; }",
    "body.studio-theme-dark .reverse-modal-actions .btn-secondary:hover { background:rgba(255,255,255,.08); color:#fcfcfb; }",
    ".reverse-modal-actions .btn-ghost { flex:0 0 auto; padding:12px 14px; border:none; background:transparent; color:#828178; }",
    ".reverse-modal-actions .btn-ghost:hover { background:rgba(0,0,0,.05); color:#282825; }",
    ".reverse-modal-actions .btn-ghost:active { background:rgba(0,0,0,.1); }",
    "body.studio-theme-dark .reverse-modal-actions .btn-ghost { color:#a8a69e; }",
    "body.studio-theme-dark .reverse-modal-actions .btn-ghost:hover { background:rgba(255,255,255,.06); color:#fcfcfb; }",
    ".reverse-modal-hint { font-size:11px; color:#9d9b92; margin-top:12px; line-height:1.55; }",
    "",
    "/* ── 进度视图 ── */",
    ".reverse-progress { text-align:center; padding:24px 4px 6px; flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; }",
    ".reverse-progress-spinner { width:44px; height:44px; margin:0 auto 16px; border:3px solid color-mix(in srgb, var(--ui-accent, #06b6d4) 15%, transparent); border-top-color:var(--ui-accent, #06b6d4); border-radius:50%; animation: reverseSpin .8s linear infinite; }",
    "@keyframes reverseSpin { to { transform:rotate(360deg); } }",
    ".reverse-progress-stage { font-size:15px; font-weight:700; color:#282825; margin-bottom:8px; }",
    ".reverse-progress-file { font-size:12px; color:#9d9b92; margin-bottom:20px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; }",
    ".reverse-progress-bar { width:100%; height:6px; background:rgba(0,0,0,.06); border-radius:3px; overflow:hidden; margin-bottom:10px; }",
    ".reverse-progress-bar > div { height:100%; background:linear-gradient(90deg,var(--ui-accent, #06b6d4),color-mix(in srgb, var(--ui-accent, #06b6d4) 58%, #000)); border-radius:3px; transition:width .3s ease; }",
    ".reverse-progress-percent { font-size:12px; color:#828178; font-variant-numeric:tabular-nums; font-weight:600; }",
    "body.studio-theme-dark .reverse-progress-stage { color:#ebe9e4; }",
    "body.studio-theme-dark .reverse-progress-bar { background:rgba(255,255,255,.06); }",
    "body.studio-theme-dark .reverse-progress-spinner { border-color:color-mix(in srgb, var(--ui-accent, #06b6d4) 20%, transparent); border-top-color:var(--ui-accent, #00f0ff); }",
    "body.studio-theme-dark .reverse-progress-bar > div { background:linear-gradient(90deg,var(--ui-accent, #00f0ff),var(--ui-accent, #06b6d4)); }",
    "",
    "/* ── 结果视图 ── */",
    ".reverse-result-meta { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; font-size:11px; color:#9d9b92; }",
    ".reverse-result-meta-tag { padding:3px 10px; border-radius:10px; background:color-mix(in srgb, var(--ui-accent, #06b6d4) 10%, transparent); color:color-mix(in srgb, var(--ui-accent, #0e7490) 62%, #0b0b0a); font-weight:700; font-size:11px; }",
    "body.studio-theme-dark .reverse-result-meta-tag { background:color-mix(in srgb, var(--ui-accent, #00f0ff) 12%, transparent); color:var(--ui-accent, #00f0ff); }",
    ".reverse-result-text { width:100%; flex:1; min-height:280px; resize:none; border:1.5px solid rgba(0,0,0,.08); border-radius:10px; padding:14px 16px; font-size:14px; line-height:1.75; color:#282825; box-sizing:border-box; background:rgba(255,255,255,.6); outline:none; font-family:inherit; }",
    ".reverse-result-text:focus { border-color:color-mix(in srgb, var(--ui-accent, #06b6d4) 40%, transparent); }",
    "body.studio-theme-dark .reverse-result-text { background:rgba(255,255,255,.04); border-color:rgba(255,255,255,.08); color:#ebe9e4; }",
    "/* 统一 action 行(覆盖 .reverse-modal-actions 默认) */",
    ".reverse-result-actions { margin-top:10px; }",
    ".reverse-result-actions .btn-primary { flex:1.4; }",
    ".reverse-result-actions .btn-secondary { flex:1; }",
    ".reverse-result-actions .btn-ghost { flex:0 0 auto; padding:12px 14px; }",
    ".reverse-result-actions .btn-ghost.copied { color:#10b981; }",
    "body.studio-theme-dark .reverse-result-actions .btn-ghost.copied { color:#34d399; }",
    "",
    "/* ── 移动端适配(< 540px)：贴底上滑、按钮加高 ── */",
    "@media (max-width: 540px) {",
    "    .reverse-modal-overlay { align-items:flex-end; padding:0; }",
    "    .reverse-modal { width:100%; max-width:100%; max-height:92vh; min-height:0; border-radius:18px 18px 0 0; padding:24px 16px calc(14px + env(safe-area-inset-bottom, 0px)); }",
    "    .reverse-modal::before { display:block; }",
    "    .reverse-modal-title { font-size:16px; }",
    "    .reverse-modal-header-btn,",
    "    .reverse-modal-close { width:40px; height:40px; }",
    "    .reverse-modal-preview { min-height:64px; padding:8px 10px; }",
    "    .reverse-modal-preview-thumb { width:64px; height:64px; }",
    "    .reverse-modal-preview-name { font-size:13px; }",
    "    .reverse-modal-preview-meta { font-size:10px; }",
    "    .reverse-modal-section { margin-bottom:18px; }",
    "    .reverse-modal-label { font-size:11px; }",
    "    .reverse-modal-opt { min-height:60px; font-size:14px; }",
    "    .reverse-modal-opt-desc { font-size:10px; }",
    "    .reverse-modal-select { min-height:50px; font-size:15px; }",
    "    .reverse-modal-actions { padding-top:12px; }",
    "    .reverse-modal-actions .btn-primary,",
    "    .reverse-modal-actions .btn-secondary,",
    "    .reverse-modal-actions .btn-ghost { min-height:52px; font-size:15px; }",
    "    .reverse-result-text { font-size:14px; padding:12px 14px; }",
    "    .reverse-progress-spinner { width:48px; height:48px; }",
    "    .reverse-progress-stage { font-size:16px; }",
    "}"
  ].join('\n');

  // ───────────────────────────── HTML 模板（去内联 onclick，改用 data-act 事件委托）─────────────────────────────
  var HTML = [
    '<div class="reverse-modal-overlay" id="reverseModalOverlay">',
    '    <div class="reverse-modal" id="reverseModal" role="dialog" aria-modal="true" aria-label="反推设置">',
    '        <div class="reverse-modal-header">',
    '            <div class="reverse-modal-title" id="revViewTitle">反推设置</div>',
    '            <div class="reverse-modal-header-right">',
    '                <button class="reverse-modal-header-btn rerun-btn" id="revReRunBtn" data-act="rerun" aria-label="重新反推" title="返回设置/重新反推" style="display:none;">',
    '                    <i data-lucide="rotate-ccw" style="width:18px;height:18px;"></i>',
    '                </button>',
    '                <button class="reverse-modal-close" data-act="close" aria-label="关闭">',
    '                    <i data-lucide="x" style="width:18px;height:18px;"></i>',
    '                </button>',
    '            </div>',
    '        </div>',
    '',
    '        <!-- 共享：缩略图条(三视图都显示,作为视觉锚点) -->',
    '        <div class="reverse-modal-preview is-empty" id="revPreview" data-act="pick">',
    '            <input type="file" accept="image/*" id="revFileInput" style="display:none;">',
    '            <div class="reverse-modal-preview-thumb empty" id="revPreviewThumb" title="选择图片">',
    '                <span class="reverse-modal-preview-thumb-icon">',
    '                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
    '                </span>',
    '                <span class="reverse-modal-preview-replace">',
    '                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>',
    '                </span>',
    '            </div>',
    '            <div class="reverse-modal-preview-info">',
    '                <div class="reverse-modal-preview-name empty" id="revPreviewName"></div>',
    '                <div class="reverse-modal-preview-meta" id="revPreviewMeta">',
    '                    <span id="revPreviewSize"></span>',
    '                    <button type="button" class="reverse-modal-preview-clear-side" id="revPreviewClear" data-act="clear" title="清除图片" aria-label="清除图片">',
    '                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    '                        <span>清除</span>',
    '                    </button>',
    '                </div>',
    '            </div>',
    '        </div>',
    '',
    '        <!-- 视图 A: 设置 -->',
    '        <div class="reverse-view" id="revViewSettings">',
    '            <div class="reverse-modal-section">',
    '                <label class="reverse-modal-label">反推提供商</label>',
    '                <div class="reverse-modal-options" id="revProviderOptions">',
    '                    <button class="reverse-modal-opt" data-act="provider" data-value="vision">AI API 多模态<span class="reverse-modal-opt-desc">调用云端模型</span></button>',
    '                </div>',
    '            </div>',
    '',
    '            <div class="reverse-modal-section" id="revVisionProviderSection">',
    '                <label class="reverse-modal-label">AI 平台 / 模型</label>',
    '                <select class="reverse-modal-select" id="reverseVisionProvider">',
    '                    <option value="">自动选择</option>',
    '                </select>',
    '            </div>',
    '',
    '            <div class="reverse-modal-section">',
    '                <label class="reverse-modal-label">反推模式</label>',
    '                <div class="reverse-modal-options" id="revModeOptions">',
    '                    <button class="reverse-modal-opt active" data-act="mode" data-value="auto">自动<span class="reverse-modal-opt-desc">随工作流走</span></button>',
    '                    <button class="reverse-modal-opt" data-act="mode" data-value="caption">描述<span class="reverse-modal-opt-desc">自然语言句子</span></button>',
    '                    <button class="reverse-modal-opt" data-act="mode" data-value="tags">标签<span class="reverse-modal-opt-desc">逗号分隔的词</span></button>',
    '                </div>',
    '            </div>',
    '',
    '            <div class="reverse-modal-section" id="revRuleSection">',
    '                <div class="reverse-modal-rule-head">',
    '                    <label class="reverse-modal-label">反推规则（告诉 AI 怎么反推 / 生成什么类型的提示词）</label>',
    '                    <select class="reverse-modal-rule-select" id="revRulePreset">',
    '                        <option value="">自定义（下方填写）</option>',
    '                        <option value="default">默认（随模式）</option>',
    '                    </select>',
    '                </div>',
    '                <textarea class="reverse-modal-rule-area" id="revRuleText" placeholder="例如：分析这张图，输出一条适合图生视频的英文提示词，包含主体、动作趋势、镜头运动方向、光影与画风，用逗号分隔……"></textarea>',
    '                <div class="reverse-modal-hint" style="margin-top:6px;">留空则使用默认规则；填写后优先按你的规则反推。</div>',
    '            </div>',
    '',
    '            <div class="reverse-modal-hint">调整即时生效；可直接拖入图片到本面板。</div>',
    '',
    '            <div class="reverse-modal-actions">',
    '                <button class="btn-ghost" data-act="reset" title="恢复所有设置为默认">',
    '                    <i data-lucide="rotate-ccw" style="width:16px;height:16px;"></i>重置',
    '                </button>',
    '                <button class="btn-primary" id="revStartBtn" data-act="start" disabled>',
    '                    <i data-lucide="sparkles" style="width:16px;height:16px;"></i>开始反推',
    '                </button>',
    '            </div>',
    '        </div>',
    '',
    '        <!-- 视图 B: 进度 -->',
    '        <div class="reverse-view" id="revViewProgress" hidden>',
    '            <div class="reverse-progress">',
    '                <div class="reverse-progress-spinner"></div>',
    '                <div class="reverse-progress-stage" id="revProgressStage">正在分析图片…</div>',
    '                <div class="reverse-progress-file" id="revProgressFile">文件名</div>',
    '                <div class="reverse-progress-bar"><div id="revProgressBar" style="width:0%;"></div></div>',
    '                <div class="reverse-progress-percent" id="revProgressPercent">0%</div>',
    '            </div>',
    '            <div class="reverse-modal-actions">',
    '                <button class="btn-secondary" data-act="cancel">',
    '                    <i data-lucide="x" style="width:16px;height:16px;"></i>取消',
    '                </button>',
    '            </div>',
    '        </div>',
    '',
    '        <!-- 视图 C: 结果 -->',
    '        <div class="reverse-view" id="revViewResult" hidden>',
    '            <div class="reverse-result-meta">',
    '                <span class="reverse-result-meta-tag" id="revResultFormat">caption</span>',
    '                <span id="revResultProvider">auto</span>',
    '            </div>',
    '            <textarea class="reverse-result-text" id="revResultText" readonly></textarea>',
    '            <div class="reverse-modal-actions reverse-result-actions">',
    '                <button class="btn-primary" data-act="apply" data-mode="replace" title="用反推结果替换当前提示词">',
    '                    <i data-lucide="replace" style="width:16px;height:16px;"></i>替换',
    '                </button>',
    '                <button class="btn-secondary" data-act="apply" data-mode="append" title="把反推结果追加到当前提示词末尾">',
    '                    <i data-lucide="plus" style="width:16px;height:16px;"></i>追加',
    '                </button>',
    '                <button class="btn-ghost" id="revCopyWrap" data-act="copy" title="复制到剪贴板">',
    '                    <i data-lucide="copy" style="width:16px;height:16px;"></i>复制',
    '                </button>',
    '            </div>',
    '        </div>',
    '    </div>',
    '</div>'
  ].join('\n');

  // ───────────────────────────── 模块状态 ─────────────────────────────
  var _mountId = 'reverseImageMount';
  var _onApply = null;
  var _cssInjected = false;
  var _globalBound = false;
  var _rendered = false;

  var _reverseProvider = 'vision';
  var _reverseMode = 'auto';        // 'auto' | 'caption' | 'tags'
  var _reverseVisionProvider = '';
  var _reverseRulePreset = '';      // 当前选中的反推规则预设 key（''=自定义 / 'default'=默认随模式）
  var _reverseRuleText = '';        // 自定义反推规则文本
  var _reverseRuleStorageKey = 'reverse-image-rule-v1';

  // 内置反推规则预设（快速版：视频场景专用，供下拉选择）
  var _REVERSE_RULE_PRESETS = [
    {
      key: 'i2v',
      label: '图生视频 · 运镜',
      rule: '分析这张图，输出一条适合图生视频的英文提示词：描述主体与外观、动作/运动趋势、镜头运动方向（如推进、横移、环绕、上摇），以及光影与画风；用逗号分隔，只输出提示词。'
    },
    {
      key: 'fl2v',
      label: '首尾帧 · 变化',
      rule: '分析这张图，输出一段描述画面从当前状态到下一状态的转场与变化趋势的英文提示词，强调动态变化、运动方向与氛围，只输出提示词。'
    },
    {
      key: 'director',
      label: '导演台 · 分段',
      rule: '作为视频导演，分析这张图，为单个镜头片段输出一段英文运镜提示词，包含主体、动作、景别（特写/中景/全景）、镜头运动与情绪氛围，只输出提示词。'
    },
    {
      key: 'ecommerce',
      label: '电商产品 · 卖点',
      rule: '分析这张产品图，输出一段突出商品主体、材质、质感与卖点的英文提示词，适合商品展示视频，只输出提示词。'
    }
  ];

  function _loadRuleFromStorage() {
    try {
      var raw = localStorage.getItem(_reverseRuleStorageKey);
      if (!raw) return;
      var d = JSON.parse(raw);
      _reverseRulePreset = d.preset || '';
      _reverseRuleText = d.text || '';
    } catch (e) {}
  }

  function _saveRuleToStorage() {
    try {
      localStorage.setItem(_reverseRuleStorageKey, JSON.stringify({
        preset: _reverseRulePreset,
        text: _reverseRuleText
      }));
    } catch (e) {}
  }
  var _reverseFile = null;
  var _reverseFileUrl = null;       // 缩略图 objectURL
  var _reverseProvidersLoaded = false;
  var _reverseAbort = null;         // 当前反推请求的 AbortController
  var _reverseDragDepth = 0;        // 拖入状态嵌套计数（防 dragenter 抖动）

  // ───────────────────────────── 工具 ─────────────────────────────
  function $(id) { return document.getElementById(id); }

  function _injectCss() {
    if (_cssInjected) return;
    if (document.getElementById('reverse-image-css')) { _cssInjected = true; return; }
    var style = document.createElement('style');
    style.id = 'reverse-image-css';
    style.textContent = CSS;
    document.head.appendChild(style);
    _cssInjected = true;
  }

  function _bindGlobal() {
    if (_globalBound) return;
    _globalBound = true;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var ov = $('reverseModalOverlay');
        if (ov && ov.classList.contains('show')) close();
      }
    });
  }

  // ───────────────────────────── 渲染 + 事件绑定 ─────────────────────────────
  function _render() {
    var mount = $(_mountId);
    if (!mount) { console.error('[ReverseImage] mount not found: ' + _mountId); return; }
    mount.innerHTML = HTML;
    _rendered = true;
    _bindEvents();
  }

  function _bindEvents() {
    var overlay = $('reverseModalOverlay');
    if (!overlay) return;

    // 点击委托：关闭 / 各动作
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) { close(); return; }
      var el = e.target.closest('[data-act]');
      if (!el) return;
      var act = el.getAttribute('data-act');
      if (act === 'rerun') backToReverseSettings();
      else if (act === 'close') close();
      else if (act === 'pick') { var fi = $('revFileInput'); if (fi) fi.click(); }
      else if (act === 'clear') clearReverseFile();
      else if (act === 'provider') setReverseProvider(el.getAttribute('data-value'));
      else if (act === 'mode') setReverseMode(el.getAttribute('data-value'));
      else if (act === 'reset') resetReverseSettings();
      else if (act === 'start') startReverseFromModal();
      else if (act === 'cancel') cancelReverseFromModal();
      else if (act === 'apply') applyReverseResult(el.getAttribute('data-mode'));
      else if (act === 'copy') copyReverseResult();
    });

    // file input change
    var fi = $('revFileInput');
    if (fi) fi.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      _setReverseFile(f);
    });

    // vision provider select change
    var sel = $('reverseVisionProvider');
    if (sel) sel.addEventListener('change', function (e) {
      onReverseVisionProviderChange(e.target.value);
    });

    // 反推规则预设下拉
    var rp = $('revRulePreset');
    if (rp) rp.addEventListener('change', function (e) {
      _reverseRulePreset = e.target.value;
      _syncRuleUI();
      _saveRuleToStorage();
    });

    // 反推规则自由输入框
    var rt = $('revRuleText');
    if (rt) rt.addEventListener('input', function (e) {
      _reverseRuleText = e.target.value;
      _saveRuleToStorage();
    });

    _bindReverseDragDrop();
  }

  // ───────────────────────────── 视图切换 ─────────────────────────────
  function _revView(name) {
    var ids = { settings: 'revViewSettings', progress: 'revViewProgress', result: 'revViewResult' };
    Object.keys(ids).forEach(function (k) {
      var el = $(ids[k]);
      if (!el) return;
      if (k === name) {
        if (el.hidden) {
          el.hidden = false;
          void el.offsetWidth;        // 强制 reflow 重启动画
          el.style.animation = 'none';
          void el.offsetWidth;
          el.style.animation = '';
        }
      } else {
        el.hidden = true;
      }
    });
    var title = $('revViewTitle');
    if (title) title.textContent = name === 'settings' ? '反推设置' : (name === 'progress' ? '反推中' : '反推结果');
    var back = $('revReRunBtn');
    if (back) back.style.display = (name === 'result') ? 'flex' : 'none';
    var modal = $('reverseModal');
    if (modal) modal.classList.toggle('on-result', name === 'result');
  }

  // ───────────────────────────── 缩略图 / 拖入 ─────────────────────────────
  function _setReverseFile(file) {
    if (_reverseFileUrl) { try { URL.revokeObjectURL(_reverseFileUrl); } catch (_) {} _reverseFileUrl = null; }
    _reverseFile = file || null;
    var thumb = $('revPreviewThumb');
    var name = $('revPreviewName');
    var size = $('revPreviewSize');
    var preview = $('revPreview');
    if (!file) {
      if (thumb) { thumb.style.backgroundImage = ''; thumb.classList.add('empty'); }
      if (name) { name.textContent = ''; }
      if (size) size.textContent = '';
      if (preview) preview.classList.add('is-empty');
      var b1 = $('revStartBtn'); if (b1) b1.disabled = true;
      return;
    }
    _reverseFileUrl = URL.createObjectURL(file);
    if (thumb) { thumb.style.backgroundImage = 'url(' + _reverseFileUrl + ')'; thumb.classList.remove('empty'); }
    if (name) { name.textContent = file.name; }
    if (size) size.textContent = (file.size / 1024).toFixed(1) + ' KB';
    if (preview) preview.classList.remove('is-empty');
    var b2 = $('revStartBtn'); if (b2) b2.disabled = false;
  }

  function _bindReverseDragDrop() {
    var overlay = $('reverseModalOverlay');
    if (!overlay || overlay._dragBound) return;
    overlay._dragBound = true;
    var onEnter = function (e) {
      e.preventDefault();
      if (!_reverseDragDepth) overlay.classList.add('is-dragover');
      _reverseDragDepth++;
    };
    var onLeave = function (e) {
      e.preventDefault();
      _reverseDragDepth = Math.max(0, _reverseDragDepth - 1);
      if (!_reverseDragDepth) overlay.classList.remove('is-dragover');
    };
    var onOver = function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    var onDrop = function (e) {
      e.preventDefault();
      _reverseDragDepth = 0;
      overlay.classList.remove('is-dragover');
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      var f = files[0];
      if (!/^image\//.test(f.type)) { alert('请拖入图片文件'); return; }
      var prog = $('revViewProgress');
      if (prog && !prog.hidden) return;   // 反推中不允许换图
      _setReverseFile(f);
      _revView('settings');
    };
    overlay.addEventListener('dragenter', onEnter);
    overlay.addEventListener('dragleave', onLeave);
    overlay.addEventListener('dragover', onOver);
    overlay.addEventListener('drop', onDrop);
  }

  // ───────────────────────────── 公开 API ─────────────────────────────
  function open() {
    if (!_rendered) _render();
    var ov = $('reverseModalOverlay');
    if (!ov) return;
    ov.classList.add('show');
    // 首次打开时拉取 provider 列表
    if (!_reverseProvidersLoaded) {
      _reverseProvidersLoaded = true;
      fetch('/api/providers').then(function (r) { return r.json(); }).then(function (d) {
        var sel = $('reverseVisionProvider');
        if (!sel) return;
        sel.innerHTML = '<option value="">自动选择</option>';
        (d.providers || []).forEach(function (p) {
          if (p.enabled === false) return;
          if (!p.chat_models || !p.chat_models.length) return;
          var o = document.createElement('option');
          o.value = p.id;
          o.textContent = p.name + (p.primary ? ' ★' : '');
          if (p.has_key) o.textContent += ' ✓';
          sel.appendChild(o);
        });
        if (_reverseVisionProvider) sel.value = _reverseVisionProvider;
      }).catch(function () {});
    } else {
      var s2 = $('reverseVisionProvider');
      if (s2) s2.value = _reverseVisionProvider || '';
    }
    _revView('settings');
    _initRulePresetSelect();
    _syncRuleUI();
    syncReverseSettingsUI();
    _renderIcons();
  }

  function close() {
    var prog = $('revViewProgress');
    if (prog && !prog.hidden) {
      if (!confirm('反推正在进行中,确定关闭？')) return;
      cancelReverseFromModal();
    }
    var ov = $('reverseModalOverlay');
    if (ov) {
      ov.classList.remove('show');
      ov.classList.remove('is-dragover');
      _reverseDragDepth = 0;
    }
  }

  function init(opts) {
    opts = opts || {};
    _mountId = opts.mountId || 'reverseImageMount';
    _onApply = (typeof opts.onApply === 'function') ? opts.onApply : null;
    _loadRuleFromStorage();
    _injectCss();
    _render();
    _bindGlobal();
  }

  // ───────────────────────────── 设置 UI 同步 ─────────────────────────────
  function syncReverseSettingsUI() {
    var opts = document.querySelectorAll('#revProviderOptions .reverse-modal-opt');
    opts.forEach(function (el) {
      if (el.getAttribute('data-value') === _reverseProvider) el.classList.add('active');
      else el.classList.remove('active');
    });
    var mopts = document.querySelectorAll('#revModeOptions .reverse-modal-opt');
    mopts.forEach(function (el) {
      if (el.getAttribute('data-value') === _reverseMode) el.classList.add('active');
      else el.classList.remove('active');
    });
    var vps = $('revVisionProviderSection');
    if (vps) vps.style.display = (_reverseProvider === 'comfyui') ? 'none' : 'block';
    // 反向设置入口按钮高亮（若页面上有该按钮）
    var btn = document.getElementById('reverseSettingsBtn');
    if (btn) {
      if (_reverseProvider !== 'vision' || _reverseMode !== 'auto' || _reverseVisionProvider || _reverseRulePreset || _reverseRuleText) btn.classList.add('is-in-use');
      else btn.classList.remove('is-in-use');
    }
  }

  function setReverseProvider(val) { _reverseProvider = 'vision'; syncReverseSettingsUI(); }
  function setReverseMode(val) { _reverseMode = val; syncReverseSettingsUI(); }
  function onReverseVisionProviderChange(val) { _reverseVisionProvider = val || ''; syncReverseSettingsUI(); }

  // 初始化反推规则预设下拉（一次性填充内置预设选项）
  function _initRulePresetSelect() {
    var rp = $('revRulePreset');
    if (!rp) return;
    if (rp.getAttribute('data-seeded') === '1') return;
    rp.setAttribute('data-seeded', '1');
    for (var i = 0; i < _REVERSE_RULE_PRESETS.length; i++) {
      var o = document.createElement('option');
      o.value = _REVERSE_RULE_PRESETS[i].key;
      o.textContent = _REVERSE_RULE_PRESETS[i].label;
      rp.appendChild(o);
    }
  }

  // 同步规则 UI 到当前状态（预设下拉选中 + 文本框值/可编辑性）
  function _syncRuleUI() {
    var rp = $('revRulePreset');
    var rt = $('revRuleText');
    if (rp) rp.value = _reverseRulePreset || '';
    if (rt) {
      // 选中内置预设时展示其规则只读；自定义时显示自由输入
      if (_reverseRulePreset && _reverseRulePreset !== 'default') {
        var rule = _resolveRuleText();
        rt.value = rule;
        rt.readOnly = true;
        rt.classList.add('is-preset');
      } else {
        rt.value = _reverseRuleText || '';
        rt.readOnly = false;
        rt.classList.remove('is-preset');
      }
    }
  }

  function onReverseFileChange() { /* 由事件绑定处理 */ }

  function clearReverseFile() {
    var input = $('revFileInput');
    if (input) input.value = '';
    _setReverseFile(null);
  }

  function resetReverseSettings() {
    var hasFile = !!_reverseFile;
    var hasCustom = _reverseProvider !== 'vision' || _reverseMode !== 'auto' || _reverseVisionProvider;
    if (hasFile || hasCustom) {
      if (!confirm('确定重置所有反推设置？这将清空已选图片、恢复默认提供商和模式。')) return;
    }
    _reverseProvider = 'vision';
    _reverseMode = 'auto';
    _reverseVisionProvider = '';
    _reverseRulePreset = '';
    _reverseRuleText = '';
    _saveRuleToStorage();
    _setReverseFile(null);
    var sel = $('reverseVisionProvider');
    if (sel) sel.value = '';
    var fi = $('revFileInput');
    if (fi) fi.value = '';
    _syncRuleUI();
    syncReverseSettingsUI();
  }

  function _resolveReverseMode() {
    if (_reverseMode === 'caption' || _reverseMode === 'tags') return _reverseMode;
    var wf = (window.currentWorkflow || '').toLowerCase();
    return wf.indexOf('anima') >= 0 ? 'tags' : 'caption';
  }

  // 计算最终自定义规则文本：预设 key 命中内置预设则用其规则，否则用自由输入文本
  function _resolveRuleText() {
    if (_reverseRulePreset && _reverseRulePreset !== 'default') {
      for (var i = 0; i < _REVERSE_RULE_PRESETS.length; i++) {
        if (_REVERSE_RULE_PRESETS[i].key === _reverseRulePreset) return _REVERSE_RULE_PRESETS[i].rule;
      }
    }
    return (_reverseRuleText || '').trim();
  }

  function _buildReverseOpts() {
    var ts = '';
    if (window.BUILTIN_WF_META) {
      for (var i = 0; i < window.BUILTIN_WF_META.length; i++) {
        if (window.BUILTIN_WF_META[i].name === window.currentWorkflow) {
          ts = window.BUILTIN_WF_META[i].model_folder || '';
          break;
        }
      }
    }
    return {
      mode: _resolveReverseMode(),
      targetStyle: ts,
      provider: 'vision',
      visionProviderId: _reverseVisionProvider,
      customRule: _resolveRuleText()
    };
  }

  // ───────────────────────────── 进度（真实，SSE 流式）─────────────────────────────
  function _setRevProgress(pct, stage) {
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    var bar = $('revProgressBar');
    var pctEl = $('revProgressPercent');
    var stageEl = $('revProgressStage');
    if (bar) bar.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    if (stageEl && stage) stageEl.textContent = stage;
  }

  function _handleRevEvent(ev) {
    if (!ev || !ev.type) return;
    if (ev.type === 'progress') {
      _setRevProgress(ev.value || 0, ev.stage || '');
    } else if (ev.type === 'result') {
      _setRevProgress(100, '完成');
      _showReverseResult(ev);
    } else if (ev.type === 'error') {
      _revView('settings');
      alert('反推失败: ' + (ev.message || '未知错误'));
    }
  }

  function _startReverseStream(file, opts) {
    var ftext = $('revProgressFile');
    if (ftext) ftext.textContent = file.name + '  ·  ' + (file.size / 1024).toFixed(1) + ' KB';
    _setRevProgress(0, '正在连接…');
    _reverseAbort = new AbortController();
    var fd = new FormData();
    fd.append('file', file);
    if (opts.mode) fd.append('mode', opts.mode);
    if (opts.targetStyle) fd.append('target_style', opts.targetStyle);
    if (opts.provider) fd.append('provider', opts.provider);
    if (opts.visionProviderId) fd.append('vision_provider_id', opts.visionProviderId);
    if (opts.customRule) fd.append('custom_rule', opts.customRule);

    function onStream(res) {
      if (!res.ok) {
        // 极少数非 SSE 响应(如 422),尝试读 JSON 错误
        res.json().then(function (j) {
          _revView('settings');
          alert('反推失败: ' + (j.detail || ('HTTP ' + res.status)));
        }, function () {
          _revView('settings');
          alert('反推失败: HTTP ' + res.status);
        });
        return;
      }
      if (!res.body || !res.body.getReader) {
        // 兜底:当作普通 JSON 响应
        res.json().then(function (result) {
          _setRevProgress(100, '完成');
          _showReverseResult(result);
        }, function () {
          _revView('settings');
          alert('反推失败: 响应解析错误');
        });
        return;
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';
      var pump = function () {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += decoder.decode(r.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            var chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            var lines = chunk.split('\n');
            for (var i = 0; i < lines.length; i++) {
              var ln = lines[i];
              if (ln.indexOf('data:') !== 0) continue;
              var payload = ln.replace(/^data:\s*/, '').trim();
              if (!payload) continue;
              try { _handleRevEvent(JSON.parse(payload)); } catch (e) {}
            }
          }
          return pump();
        });
      };
      pump().catch(function (e) {
        if (e && e.name === 'AbortError') return;
        _revView('settings');
        alert('反推失败: ' + (e && e.message ? e.message : '连接中断'));
      });
    }

    fetch('/api/interrogate', { method: 'POST', body: fd, signal: _reverseAbort.signal })
      .then(onStream)
      .catch(function (e) {
        if (e && e.name === 'AbortError') return;
        _revView('settings');
        alert('反推失败: ' + (e && e.message ? e.message : '网络错误'));
      });
  }

  // ───────────────────────────── 反推请求 ─────────────────────────────
  function startReverseFromModal() {
    if (!_reverseFile) return;
    var file = _reverseFile;
    var opts = _buildReverseOpts();
    _revView('progress');
    _startReverseStream(file, opts);
  }

  function cancelReverseFromModal() {
    if (_reverseAbort) { try { _reverseAbort.abort(); } catch (_) {} _reverseAbort = null; }
    _revView('settings');
  }

  function _showReverseResult(result) {
    var text = (result && result.text) || '';
    var fmt = (result && result.format) || 'caption';
    var provider = (result && result.provider) || _reverseProvider;
    var fmtEl = $('revResultFormat');
    var provEl = $('revResultProvider');
    var txtEl = $('revResultText');
    var copyWrap = $('revCopyWrap');
    if (fmtEl) fmtEl.textContent = fmt;
    if (provEl) provEl.textContent = provider;
    if (txtEl) { txtEl.value = text; txtEl.readOnly = true; }
    if (copyWrap) copyWrap.classList.remove('copied');
    _revView('result');
    _renderIcons();
  }

  function applyReverseResult(mode) {
    var txtEl = $('revResultText');
    var text = txtEl ? txtEl.value : '';
    if (!text) return;   // 无结果不处理（也不关闭），等价原行为
    if (_onApply) {
      try { _onApply(text, mode); } catch (err) { console.error('[ReverseImage] onApply error:', err); }
    }
    close();
  }

  function copyReverseResult() {
    var txtEl = $('revResultText');
    if (!txtEl) return;
    var text = txtEl.value;
    var wrap = $('revCopyWrap');
    var done = function () { if (wrap) { wrap.classList.add('copied'); setTimeout(function () { wrap.classList.remove('copied'); }, 1200); } };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      txtEl.removeAttribute('readonly');
      txtEl.select();
      try { document.execCommand('copy'); } catch (_) {}
      txtEl.setAttribute('readonly', 'readonly');
      done();
    }
  }

  function backToReverseSettings() {
    _revView('settings');
  }

  function _renderIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try { window.lucide.createIcons({ attrs: { class: 'w-3 h-3' } }); } catch (_) {}
    }
  }

  // ───────────────────────────── 暴露给外部 ─────────────────────────────
  window.ReverseImage = {
    init: init,
    open: open,
    close: close,
    setFile: _setReverseFile
  };
})();
