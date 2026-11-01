/*
 * asset-library.js — 资产库选择/管理模块（统一版）
 *
 * 与资源库页面（asset-manager.html / /api/asset-library）共用同一套后端，
 * UI 风格也与资源库页面保持一致（卡片网格、库/分组导航、类型筛选、暗色主题）。
 * 支持图片 / 视频 / 音频资产：网格内视频可预览、音频可播放，可按类型筛选。
 *
 * 用法：
 *   <div id="assetLibraryMount"></div>
 *   <script src="/static/modules/asset-library.js"></script>
 *   <script>
 *     AssetLibrary.init({
 *       mountId:      'assetLibraryMount',                 // 挂载点
 *       title:        '从资产库选择',                       // 面板标题
 *       allowDelete:  true,                               // 显示删除按钮
 *       multiSelect:  false,                              // 多选模式（默认单选）
 *       onApply:      function (url, name) { ... },       // 单选回调（url, name）
 *       onApplyMulti: function (list) { ... },            // 多选回调（[{id,url,name,kind}]）
 *       onDeleted:    function (id, url, name) { ... }    // 删除后回调
 *     });
 *     AssetLibrary.open();      // 打开
 *     AssetLibrary.close();     // 关闭
 *     AssetLibrary.invalidate();// 使缓存失效（外部改动资产后调用）
 *     // 收藏迁移辅助：
 *     AssetLibrary.saveFavorite(url, name).then(res => { res.id, res.url, res.dedup });
 *     AssetLibrary.removeFavorite(id);
 *   </script>
 */
(function () {
  'use strict';

  // ───────────────────────────── CSS（自包含，匹配资源库页面视觉，含暗色主题）─────────────────────────────
  var CSS = [
    ".ap-overlay { position:fixed; inset:0; z-index:60; background:rgba(23, 23, 22, .6); display:none; align-items:center; justify-content:center; padding:24px; opacity:0; visibility:hidden; pointer-events:none; transition:opacity .2s ease, visibility .2s ease; backdrop-filter:blur(4px); }",
    ".ap-overlay.open { display:flex; opacity:1; visibility:visible; pointer-events:auto; }",
    ".ap-panel { --card:#fcfcfb; --line:#eceae5; --line-2:#dcdad1; --soft:#f6f6f4; --soft-2:#f0efec; --text:#181817; --muted:#7d7c74; --faint:#a19f97; --strong:#181817; --strong-text:#fcfcfb; --danger:#dc2626; --shadow:rgba(23, 23, 22, .06); width:min(1040px, 96vw); height:min(84vh, 880px); background:var(--card); border-radius:18px; border:1px solid var(--line); display:flex; flex-direction:column; overflow:hidden; box-shadow:0 28px 64px rgba(23, 23, 22, .35); transform:translateY(10px) scale(.98); opacity:0; transition:transform .26s cubic-bezier(.2,.8,.2,1), opacity .26s ease; }",
    ".ap-overlay.open .ap-panel { transform:translateY(0) scale(1); opacity:1; }",
    "body.theme-dark .ap-panel, body.studio-theme-dark .ap-panel, html.theme-dark .ap-panel { --card:#141414; --line:#2d2d2a; --line-2:#595851; --soft:#1b1b1a; --soft-2:#262623; --text:#edebe7; --muted:#a6a59c; --faint:#7d7c74; --strong:#00f0ff; --strong-text:#141414; --danger:#f87171; --shadow:rgba(0,0,0,.3); border-color:rgba(255,255,255,.06); }",
    ".ap-head { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid var(--line); }",
    ".ap-title { display:inline-flex; align-items:center; gap:8px; font-size:15px; font-weight:900; color:var(--text); }",
    ".ap-title svg { width:16px; height:16px; }",
    ".ap-close { width:32px; height:32px; border:0; background:transparent; color:var(--muted); font-size:24px; line-height:1; border-radius:8px; cursor:pointer; transition:all .15s ease; }",
    ".ap-close:hover { background:var(--soft); color:var(--text); }",
    ".ap-body { flex:1; min-height:0; min-width:0; display:flex; }",
    ".ap-nav { flex:0 0 232px; border-right:1px solid var(--line); overflow:auto; padding:12px; display:flex; flex-direction:column; gap:10px; scrollbar-width:thin; }",
    ".ap-nav-all { width:100%; min-height:34px; border-radius:9px; padding:6px 10px; border:1px solid transparent; background:transparent; color:var(--text); text-align:left; font-size:12px; font-weight:900; cursor:pointer; }",
    ".ap-nav-all:hover { background:var(--soft); border-color:var(--line); }",
    ".ap-nav-all.active { background:var(--card); border-color:var(--strong); box-shadow:0 0 0 1px var(--strong); }",
    ".ap-nav-group { display:flex; flex-direction:column; gap:5px; }",
    ".ap-nav-lib { display:flex; align-items:center; gap:6px; color:var(--muted); font-size:10.5px; font-weight:900; letter-spacing:.04em; text-transform:uppercase; padding:2px 4px; }",
    ".ap-nav-lib svg { width:13px; height:13px; }",
    ".ap-nav-cat { width:100%; min-height:30px; border-radius:8px; padding:6px 10px; border:1px solid transparent; background:transparent; color:var(--muted); text-align:left; font-size:11.5px; font-weight:850; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
    ".ap-nav-cat:hover { background:var(--soft); border-color:var(--line); color:var(--text); }",
    ".ap-nav-cat.active { background:var(--card); border-color:var(--strong); box-shadow:0 0 0 1px var(--strong); color:var(--text); }",
    ".ap-content { flex:1; min-width:0; display:flex; flex-direction:column; }",
    ".ap-toolbar { flex:0 0 auto; display:flex; align-items:center; gap:12px; padding:12px 16px; border-bottom:1px solid var(--line); flex-wrap:wrap; }",
    ".ap-search { flex:1; min-width:140px; height:32px; padding:0 12px; border-radius:8px; border:1px solid var(--line); background:var(--soft); color:var(--text); font-size:12px; outline:none; transition:border-color .15s ease; }",
    ".ap-search:focus { border-color:var(--line-2); }",
    ".ap-search::placeholder { color:var(--faint); }",
    ".ap-tabs { display:flex; align-items:center; gap:4px; padding:4px; border-radius:13px; background:var(--soft); }",
    ".ap-tabs button { height:30px; padding:0 12px; border-radius:9px; background:transparent; color:var(--muted); font-size:11.5px; font-weight:850; border:0; cursor:pointer; transition:all .14s ease; }",
    ".ap-tabs button:hover { color:var(--text); }",
    ".ap-tabs button.active { background:var(--strong); color:var(--strong-text); }",
    ".ap-size { display:flex; align-items:center; gap:8px; }",
    ".ap-size-label { font-size:11px; font-weight:700; color:var(--muted); white-space:nowrap; }",
    ".ap-size-range { width:110px; accent-color:var(--strong); cursor:pointer; }",
    ".ap-grid { flex:1; min-height:0; overflow:auto; padding:16px; width:100%; min-width:0; box-sizing:border-box; column-width:148px; column-gap:12px; scrollbar-width:thin; }",
    ".ap-card { position:relative; border:1px solid var(--line); border-radius:12px; background:var(--card); overflow:hidden; cursor:pointer; transition:border-color .14s ease, box-shadow .14s ease, transform .14s ease; display:block; width:100%; break-inside:avoid; -webkit-column-break-inside:avoid; page-break-inside:avoid; margin:0 0 12px; }",
    ".ap-card:hover { border-color:var(--line-2); box-shadow:0 12px 24px var(--shadow); transform:translateY(-1px); }",
    ".ap-card.selected { border-color:var(--strong); box-shadow:0 0 0 1px var(--strong); }",
    ".ap-thumb { width:100%; min-height:120px; display:flex; align-items:center; justify-content:center; background:var(--soft); overflow:hidden; }",
    ".ap-thumb img { width:100%; height:auto; display:block; }",
    ".ap-thumb video { width:100%; height:auto; aspect-ratio:16/9; max-height:380px; object-fit:cover; background:#0b0b0a; display:block; }",
    ".ap-thumb audio { width:100%; padding:8px; box-sizing:border-box; background:var(--soft); }",
    ".ap-card-body { padding:8px; }",
    ".ap-name { font-size:11px; font-weight:900; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
    ".ap-card--image .ap-card-body { display:none; }",
    ".ap-card--image .ap-thumb { min-height:0; }",
    ".ap-card--image .ap-badge { display:none; }",
    ".ap-card--image { border-radius:10px; }",
    ".ap-card--video .ap-thumb { min-height:0; background:#0b0b0a; }",
    ".ap-card--video .ap-thumb video { width:100%; height:auto; aspect-ratio:16/9; object-fit:contain; max-height:320px; background:#0b0b0a; display:block; }",
    ".ap-card--video .ap-card-body { display:none; }",
    ".ap-sound { position:absolute; right:8px; bottom:8px; z-index:5; width:30px; height:30px; border:0; border-radius:50%; background:rgba(23, 23, 22, .55); color:#fcfcfb; display:flex; align-items:center; justify-content:center; cursor:pointer; opacity:0; transition:opacity .14s ease, background .14s ease; }",
    ".ap-card:hover .ap-sound { opacity:1; }",
    ".ap-sound:hover { background:rgba(23, 23, 22, .8); }",
    "body.theme-dark .ap-sound { background:rgba(0,0,0,.6); }",
    ".ap-badge { position:absolute; left:8px; bottom:8px; z-index:3; font-size:10px; font-weight:900; padding:2px 7px; border-radius:999px; background:rgba(23, 23, 22, .62); color:#fcfcfb; pointer-events:none; }",
    "body.theme-dark .ap-badge, body.studio-theme-dark .ap-badge { background:rgba(0,0,0,.6); }",
    ".ap-del { position:absolute; right:8px; top:8px; z-index:4; width:24px; height:24px; border:0; border-radius:50%; background:rgba(23, 23, 22, .55); color:#fcfcfb; font-size:15px; line-height:1; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity .14s ease, background .14s ease; cursor:pointer; }",
    ".ap-card:hover .ap-del { opacity:1; }",
    ".ap-del:hover { background:var(--danger); }",
    "body.theme-dark .ap-del, body.studio-theme-dark .ap-del { background:rgba(0,0,0,.6); }",
    ".ap-check { position:absolute; left:8px; top:8px; z-index:4; width:18px; height:18px; accent-color:var(--strong); cursor:pointer; }",
    ".ap-empty { column-span:all; min-height:200px; display:flex; align-items:center; justify-content:center; color:var(--muted); font-size:12px; font-weight:800; text-align:center; padding:20px; }",
    ".ap-footer { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; padding:12px 18px; border-top:1px solid var(--line); }",
    ".ap-sel-count { font-size:12px; font-weight:800; color:var(--muted); }",
    ".ap-footer-actions { display:flex; gap:8px; }",
    ".ap-btn { height:32px; padding:0 16px; border-radius:9px; border:1px solid var(--line); background:var(--card); color:var(--muted); font-size:12px; font-weight:850; cursor:pointer; transition:all .14s ease; }",
    ".ap-btn:hover { border-color:var(--line-2); color:var(--text); }",
    ".ap-btn.primary { background:var(--strong); color:var(--strong-text); border-color:var(--strong); }",
    ".ap-btn.primary:disabled { opacity:.5; cursor:not-allowed; }",
    ".ap-overlay-open { overflow:hidden !important; }",
    "@media (max-width: 720px) { .ap-overlay { padding:0; align-items:flex-end; } .ap-panel { width:100%; max-width:100%; height:92vh; max-height:92vh; border-radius:18px 18px 0 0; } .ap-body { flex-direction:column; } .ap-nav { flex:0 0 auto; max-height:160px; border-right:0; border-bottom:1px solid var(--line); flex-direction:row; flex-wrap:wrap; gap:6px; } .ap-nav-all { width:auto; } .ap-nav-group { flex-direction:row; flex-wrap:wrap; align-items:center; } .ap-nav-lib { display:none; } .ap-toolbar { flex-wrap:wrap; gap:10px; } .ap-search { flex:1 1 100%; } }"
  ].join('\n');

  // ───────────────────────────── HTML 模板 ─────────────────────────────
  var HTML = [
    '<div class="ap-overlay" id="assetLibraryOverlay">',
    '    <div class="ap-panel" role="dialog" aria-modal="true" aria-label="资产库">',
    '        <div class="ap-head">',
    '            <div class="ap-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg><span id="assetLibraryTitle">从资产库选择</span></div>',
    '            <div class="ap-head-actions"><button class="ap-close" data-act="close" title="关闭">&times;</button></div>',
    '        </div>',
    '        <div class="ap-body">',
    '            <div class="ap-nav" id="assetLibraryNav"></div>',
    '            <div class="ap-content">',
    '                <div class="ap-toolbar">',
    '                    <input class="ap-search" id="assetLibrarySearch" type="text" placeholder="搜索资产名称...">',
    '                    <div class="ap-tabs" id="assetLibraryTabs">',
    '                        <button data-kind="all" class="active">全部</button>',
    '                        <button data-kind="image">图片</button>',
    '                        <button data-kind="video">视频</button>',
    '                        <button data-kind="audio">音频</button>',
    '                    </div>',
    '                    <div class="ap-size"><span class="ap-size-label">大小</span><input class="ap-size-range" id="assetLibrarySize" type="range" min="72" max="260" step="8" value="148"></div>',
    '                </div>',
    '                <div class="ap-grid" id="assetLibraryGrid"><div class="ap-empty"><span>加载中...</span></div></div>',
    '            </div>',
    '        </div>',
    '        <div class="ap-footer" id="assetLibraryFooter" style="display:none">',
    '            <span class="ap-sel-count" id="assetLibrarySelCount">已选 0 项</span>',
    '            <div class="ap-footer-actions"><button class="ap-btn" data-act="cancel">取消</button><button class="ap-btn primary" data-act="confirm" id="assetLibraryConfirm">确定</button></div>',
    '        </div>',
    '    </div>',
    '</div>'
  ].join('\n');

  // ───────────────────────────── 模块状态 ─────────────────────────────
  var _mountId = 'assetLibraryMount';
  var _title = '从资产库选择';
  var _onApply = null;
  var _onApplyMulti = null;
  var _onDeleted = null;
  var _allowDelete = true;
  var _multiSelect = false;
  var _cssInjected = false;
  var _rendered = false;
  var _cacheTTL = 60000;
  // 库数据缓存（/api/asset-library 返回的对象）
  var _library = null;
  var _cacheTs = 0;
  var _gridBuilt = false;
  var _searchTerm = '';
  var _kindFilter = 'all';
  var _activeCatId = '';
  var _colWidth = 148;
  var _selectedIds = {};          // 多选：id -> true
  var _initialKind = 'all';       // init 时可指定默认类型筛选
  var _itemsById = {};            // id -> item（含 _libraryId/_categoryId）

  // ───────────────────────────── 工具 ─────────────────────────────
  function $(id) { return document.getElementById(id); }
  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // 视频卡片音量按钮 SVG（与历史展示区风格一致的扬声器图标：静音=带叉 / 有声=声波）
  var SOUND_OFF_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
  var SOUND_ON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
  // 资产库视频卡片音量开关：默认静音，点击切换（需用户手势才允许出声）
  function assetLibraryToggleSound(btn) {
    var card = btn && btn.closest ? btn.closest('.ap-card--video') : null;
    var v = card ? card.querySelector('video.ap-video-el') : null;
    if (!v) return;
    v.muted = !v.muted;
    btn.innerHTML = v.muted ? SOUND_OFF_SVG : SOUND_ON_SVG;
  }
  window.assetLibraryToggleSound = assetLibraryToggleSound;
  function _injectCss() {
    var existing = document.getElementById('asset-library-css');
    if (existing) {
      /* 始终覆盖内容，避免旧版本 CSS 残留（多列→flex 等变更不生效） */
      existing.textContent = CSS;
      _cssInjected = true;
      return;
    }
    var style = document.createElement('style');
    style.id = 'asset-library-css';
    style.textContent = CSS;
    document.head.appendChild(style);
    _cssInjected = true;
  }
  function assetKind(item) {
    if (item && item.kind) return item.kind;
    var u = String((item && item.url) || '').toLowerCase();
    if (/\.(mp4|webm|mov|m4v|mkv|avi)(\?|#|$)/i.test(u)) return 'video';
    if (/\.(mp3|wav|flac|ogg|m4a|aac)(\?|#|$)/i.test(u)) return 'audio';
    if (/\.(txt|md|json|srt|vtt)(\?|#|$)/i.test(u)) return 'text';
    return 'image';
  }
  function kindLabel(k) {
    if (k === 'video') return '视频';
    if (k === 'audio') return '音频';
    if (k === 'text') return '文本';
    return '图片';
  }
  function thumbHtml(item) {
    var kind = assetKind(item);
    var u = escAttr(item.url || '');
    var n = escAttr(item.name || 'asset');
    if (kind === 'video') return '<video src="' + u + '" muted preload="metadata" playsinline controls></video>';
    if (kind === 'audio') return '<audio src="' + u + '" preload="metadata" controls></audio>';
    return '<img src="' + escAttr(item.thumbnail || item.url || '') + '" alt="' + n + '" loading="lazy" decoding="async">';
  }
  function flattenItems(library) {
    var out = [];
    (library && library.libraries || []).forEach(function (lib) {
      (lib.categories || []).forEach(function (cat) {
        (cat.items || []).forEach(function (it) {
          out.push(Object.assign({}, it, { _libraryId: lib.id, _categoryId: cat.id }));
        });
      });
    });
    return out;
  }

  // ───────────────────────────── 渲染 ─────────────────────────────
  function _render() {
    var mount = $(_mountId);
    if (!mount) { console.error('[AssetLibrary] mount not found: ' + _mountId); return; }
    mount.innerHTML = HTML;
    _rendered = true;
    var titleEl = $('assetLibraryTitle');
    if (titleEl) titleEl.textContent = _title;
    _bindEvents();
    _bindToolbar();
  }

  function _bindToolbar() {
    var search = $('assetLibrarySearch');
    if (search) {
      search.value = _searchTerm;
      search.addEventListener('input', function () {
        _searchTerm = (search.value || '').trim();
        _renderGridIfReady();
      });
    }
    var size = $('assetLibrarySize');
    if (size) {
      size.value = String(_colWidth);
      size.addEventListener('input', function () {
        _colWidth = parseInt(size.value, 10) || 148;
        _applySize();
      });
    }
    var tabs = $('assetLibraryTabs');
    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-kind]');
        if (!b) return;
        _kindFilter = b.getAttribute('data-kind');
        Array.prototype.forEach.call(tabs.children, function (c) { c.classList.toggle('active', c === b); });
        _renderGridIfReady();
      });
    }
  }
  function _applySize() {
    var grid = $('assetLibraryGrid');
    if (grid) {
      var w = Math.max(72, Math.min(260, parseInt(_colWidth, 10) || 148));
      /* 瀑布流（CSS multi-column）：列宽由滑块控制，卡片自动填满列、按列紧凑排列不拉伸 */
      grid.style.columnWidth = w + 'px';
      console.log('[AssetLibrary][DEBUG] _applySize: 列宽=' + w + 'px, 卡片数=' + grid.querySelectorAll('.ap-card').length);
    }
  }
  function _applyKindFilter() {
    if (_kindFilter === 'all' && _initialKind === 'all') return;
    if (_initialKind !== 'all') _kindFilter = _initialKind;
    var tabs = $('assetLibraryTabs');
    if (tabs) {
      Array.prototype.forEach.call(tabs.children, function (c) {
        c.classList.toggle('active', c.getAttribute('data-kind') === _kindFilter);
      });
    }
  }
  function _bindEvents() {
    var overlay = $('assetLibraryOverlay');
    if (!overlay) return;
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) { close(); return; }
      var el = e.target.closest('[data-act]');
      if (!el) return;
      var act = el.getAttribute('data-act');
      if (act === 'close' || act === 'cancel') { close(); }
      else if (act === 'confirm') { applyMulti(); }
      else if (act === 'select') { onCardClick(el); }
      else if (act === 'check') { onCardClick(el); }
      else if (act === 'delete') { deleteItem(el.getAttribute('data-id'), el.getAttribute('data-url'), el.getAttribute('data-name')); }
      else if (act === 'nav-all') { _activeCatId = ''; renderNav(); _renderGridIfReady(); }
      else if (act === 'nav-cat') { _activeCatId = el.getAttribute('data-id'); renderNav(); _renderGridIfReady(); }
    });
  }

  function renderNav() {
    var nav = $('assetLibraryNav');
    if (!nav) return;
    var lib = _library || { libraries: [] };
    var html = '<button class="ap-nav-all' + (!_activeCatId ? ' active' : '') + '" data-act="nav-all">全部资产</button>';
    (lib.libraries || []).forEach(function (l) {
      var mediaCats = (l.categories || []).filter(function (c) { return c.type !== 'workflow'; });
      if (!mediaCats.length) return;
      html += '<div class="ap-nav-group">';
      html += '<div class="ap-nav-lib"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>' + escHtml(l.name || '资产库') + '</div>';
      mediaCats.forEach(function (c) {
        html += '<button class="ap-nav-cat' + (_activeCatId === c.id ? ' active' : '') + '" data-act="nav-cat" data-id="' + escAttr(c.id) + '">' + escHtml(c.name || '分组') + '</button>';
      });
      html += '</div>';
    });
    nav.innerHTML = html;
  }

  function _currentItems() {
    var items = flattenItems(_library);
    _itemsById = {};
    items.forEach(function (it) { _itemsById[it.id] = it; });
    var t = _searchTerm.toLowerCase();
    return items.filter(function (it) {
      if (_activeCatId && it._categoryId !== _activeCatId) return false;
      if (_kindFilter !== 'all' && assetKind(it) !== _kindFilter) return false;
      if (t && (it.name || '').toLowerCase().indexOf(t) === -1) return false;
      return true;
    });
  }

  function _renderGridIfReady() {
    if (!_library || !_gridBuilt) return;
    _renderGrid();
  }

  function _renderGrid() {
    var grid = $('assetLibraryGrid');
    if (!grid) return;
    var list = _currentItems();
    if (!list.length) {
      grid.innerHTML = '<div class="ap-empty"><span>' + (_searchTerm || _activeCatId || _kindFilter !== 'all' ? '没有匹配的资产' : '暂无资产，可到资源库页面上传') + '</span></div>';
      return;
    }
    grid.innerHTML = list.map(function (item) {
      var sel = !!_selectedIds[item.id];
      var id = escAttr(item.id);
      var u = escAttr(item.url || '');
      var n = escAttr(item.name || '');
      var kind = assetKind(item);
      var isVideo = kind === 'video';
      var imgCls = kind === 'image' ? ' ap-card--image' : '';
      var videoCls = isVideo ? ' ap-card--video' : '';
      var card = '<div class="ap-card' + imgCls + videoCls + (sel ? ' selected' : '') + '" data-act="select" data-id="' + id + '" data-url="' + u + '" data-name="' + n + '">';
      if (_multiSelect) {
        card += '<input class="ap-check" type="checkbox" ' + (sel ? 'checked' : '') + ' data-act="check" data-id="' + id + '">';
      } else {
        card += '<span class="ap-badge">' + kindLabel(kind) + '</span>';
      }
      if (_allowDelete) {
        card += '<button class="ap-del" title="删除" data-act="delete" data-id="' + id + '" data-url="' + u + '" data-name="' + n + '">&times;</button>';
      }
      if (isVideo) {
        // 视频卡片：和历史展示区一致 —— 悬停播放（默认静音）、无进度条、不显示名称、右下角音量键（默认关闭）
        card += '<div class="ap-thumb">' +
          '<video class="ap-video-el" src="' + u + '" data-original-src="' + u + '" muted loop playsinline preload="metadata" style="display:block;width:100%;height:auto;object-fit:contain;background:#0b0b0a;" onloadedmetadata="this.style.aspectRatio=(this.videoWidth/this.videoHeight||16/9).toFixed(4)"></video>' +
          '<button class="ap-sound" title="声音开关" aria-label="声音开关" onclick="event.stopPropagation();assetLibraryToggleSound(this)">' + SOUND_OFF_SVG + '</button>' +
          '</div>';
        // 视频卡片不输出 .ap-card-body（名称），由 CSS .ap-card--video .ap-card-body 兜底隐藏
      } else {
        card += '<div class="ap-thumb">' + thumbHtml(item) + '</div>';
        card += '<div class="ap-card-body"><div class="ap-name">' + escHtml(item.name || '未命名') + '</div></div>';
      }
      card += '</div>';   // 闭合 .ap-card（之前漏掉导致所有卡片被嵌套进首张卡片 → 单列）
      return card;
    }).join('');
    /* 关键布局属性改为内联样式（最高优先级，绝不依赖外部 <style> 是否生效）：
       瀑布流：列宽由 _applySize 设置，卡片 width:100% 填满列、break-inside:avoid 不跨列断裂 */
    grid.style.columnWidth = (_colWidth || 148) + 'px';
    _applySize();
    console.log('[AssetLibrary][DEBUG] _renderGrid: 卡片数=' + grid.querySelectorAll('.ap-card').length +
      ', grid.offsetWidth=' + grid.offsetWidth + ', grid.clientWidth=' + grid.clientWidth);
    _bindVideoHover(grid);
  }
  // 视频卡片：悬停即在卡片内播放（默认静音，浏览器允许自动播放），移开暂停并复位
  function _bindVideoHover(grid) {
    if (!grid) return;
    grid.querySelectorAll('.ap-card--video').forEach(function (card) {
      var v = card.querySelector('video.ap-video-el');
      if (!v) return;
      card.addEventListener('mouseenter', function () {
        try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
      }, { passive: true });
      card.addEventListener('mouseleave', function () {
        try { v.pause(); } catch (e) {}
        try { v.currentTime = 0; } catch (e) {}
      }, { passive: true });
    });
  }

  // ───────────────────────────── 列表加载 ─────────────────────────────
  function loadLibrary(opts) {
    opts = opts || {};
    var silent = !!opts.silent;
    var grid = $('assetLibraryGrid');
    if (!silent && !_gridBuilt && grid) grid.innerHTML = '<div class="ap-empty"><span>加载中...</span></div>';
    return fetch('/api/asset-library')
      .then(function (r) { if (!r.ok) throw new Error('获取资产库失败'); return r.json(); })
      .then(function (data) {
        _library = (data && data.library) || { libraries: [] };
        _cacheTs = Date.now();
        renderNav();
        _applyKindFilter();
        _renderGrid();
        _gridBuilt = true;
        return _library;
      })
      .catch(function (err) {
        if (grid) grid.innerHTML = '<div class="ap-empty"><span>加载失败: ' + escHtml(err.message || '') + '</span></div>';
        if (silent) return null;
        throw err;
      });
  }

  // ───────────────────────────── 选图 / 删除 ─────────────────────────────
  function onCardClick(el) {
    var id = el.getAttribute('data-id');
    if (_multiSelect) {
      if (_selectedIds[id]) delete _selectedIds[id]; else _selectedIds[id] = true;
      var card = el.closest('.ap-card');
      if (card) card.classList.toggle('selected', !!_selectedIds[id]);
      var check = card && card.querySelector('.ap-check');
      if (check) check.checked = !!_selectedIds[id];
      _updateSelCount();
      return;
    }
    var item = _itemsById[id];
    if (!item) return;
    applySingle(item);
  }
  function applySingle(item) {
    close();
    if (typeof _onApply === 'function') {
      try { _onApply(item.url, item.name); } catch (err) { console.error('[AssetLibrary] onApply error:', err); }
    }
  }
  function _updateSelCount() {
    var count = Object.keys(_selectedIds).length;
    var el = $('assetLibrarySelCount');
    if (el) { el.textContent = '已选 ' + count + ' 项'; el.style.color = ''; }
    var btn = $('assetLibraryConfirm');
    if (btn) btn.disabled = false; // 始终可点：未选时点击给出提示，而非静默禁用
  }
  function applyMulti() {
    var ids = Object.keys(_selectedIds);
    if (!ids.length) {
      // 未选择任何素材：给出明确反馈，且不关闭弹窗，方便继续选择
      var el = $('assetLibrarySelCount');
      if (el) { el.textContent = '请先选择要导入的素材'; el.style.color = 'var(--danger)'; }
      return;
    }
    var list = ids.map(function (id) { return _itemsById[id]; }).filter(Boolean)
      .map(function (it) { return { id: it.id, url: it.url, name: it.name, kind: assetKind(it) }; });
    close();
    if (typeof _onApplyMulti === 'function') {
      try { _onApplyMulti(list); } catch (err) { console.error('[AssetLibrary] onApplyMulti error:', err); }
    } else if (typeof _onApply === 'function') {
      list.forEach(function (it) { try { _onApply(it.url, it.name); } catch (_) {} });
    }
  }
  function deleteItem(id, url, name) {
    if (!confirm('确定从资产库删除「' + (name || '该资产') + '」？此操作不可撤销。')) return;
    fetch('/api/asset-library/items/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function (r) { if (!r.ok) throw new Error('删除失败: ' + r.status); if (typeof _onDeleted === 'function') { try { _onDeleted(id, url, name); } catch (_) {} } return loadLibrary(); })
      .catch(function (e) { alert('删除失败: ' + (e.message || '')); });
  }

  // ───────────────────────────── 公开 API ─────────────────────────────
  function open(opts) {
    opts = opts || {};
    if (opts.kind) { _initialKind = opts.kind; _kindFilter = opts.kind; }
    if (!_rendered) _render();
    var ov = $('assetLibraryOverlay');
    if (!ov) return;
    ov.classList.add('open');
    document.body.classList.add('ap-overlay-open');
    var footer = $('assetLibraryFooter');
    if (footer) footer.style.display = _multiSelect ? 'flex' : 'none';
    if (_multiSelect) { _selectedIds = {}; _updateSelCount(); }
    if (_library && (Date.now() - _cacheTs) < _cacheTTL) { renderNav(); _applyKindFilter(); _renderGrid(); return; }
    loadLibrary();
  }
  function close() {
    var ov = $('assetLibraryOverlay');
    if (ov) ov.classList.remove('open');
    document.body.classList.remove('ap-overlay-open');
  }
  function _isOpen() {
    var ov = $('assetLibraryOverlay');
    return !!(ov && ov.classList.contains('open'));
  }
  function invalidate() {
    _library = null;
    _cacheTs = 0;
    _gridBuilt = false;
    if (_isOpen()) loadLibrary();
  }
  function refresh() { invalidate(); }

  // ───────────────────────────── 收藏迁移辅助（写入同一套资产库）─────────────────────────────
  function getLibrary(force) {
    if (_library && !force && (Date.now() - _cacheTs) < _cacheTTL) return Promise.resolve(_library);
    return fetch('/api/asset-library').then(function (r) { if (!r.ok) throw new Error('获取资产库失败'); return r.json(); })
      .then(function (data) { _library = (data && data.library) || { libraries: [] }; _cacheTs = Date.now(); return _library; });
  }
  function _activeLibrary(lib) {
    var libs = lib.libraries || [];
    return libs.filter(function (l) { return l.id === lib.active_library_id; })[0] || libs[0] || null;
  }
  function ensureFavCategory() {
    return getLibrary().then(function (lib) {
      var act = _activeLibrary(lib);
      if (!act) throw new Error('没有可用的资产库');
      var fav = (act.categories || []).filter(function (c) { return c.type !== 'workflow'; })
        .filter(function (c) { return c.name === '收藏'; })[0];
      if (fav) return { library_id: act.id, category_id: fav.id };
      return fetch('/api/asset-library/categories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ library_id: act.id, name: '收藏', type: 'image' })
      }).then(function (r) { if (!r.ok) throw new Error('创建收藏分组失败'); return r.json(); })
        .then(function (d) { _library = null; return { library_id: act.id, category_id: d.category.id }; });
    });
  }
  // 保存收藏：先按 URL 去重，命中则记为 dedup（不新建、取消收藏时不删）；否则写入「收藏」分组
  function saveFavorite(url, name) {
    return getLibrary().then(function (lib) {
      var hit = flattenItems(lib).filter(function (it) { return it.url === url; })[0];
      if (hit) return { id: hit.id, url: url, dedup: true };
      return ensureFavCategory().then(function (t) {
        return fetch('/api/asset-library/items', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url, name: name || '收藏', category_id: t.category_id, library_id: t.library_id })
        }).then(function (r) { if (!r.ok) throw new Error('保存收藏失败'); return r.json(); })
          .then(function (d) { _library = null; var it = d.item || {}; return { id: it.id, url: url, dedup: false }; });
      });
    });
  }
  function removeFavorite(id) {
    if (!id) return Promise.resolve();
    return fetch('/api/asset-library/items/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function (r) { if (r.ok) _library = null; return r; });
  }

  function init(opts) {
    console.log('[AssetLibrary][DEBUG] init 调用，模块版本 = 20260811-15');
    opts = opts || {};
    _mountId = opts.mountId || 'assetLibraryMount';
    _title = opts.title || '从资产库选择';
    _onApply = (typeof opts.onApply === 'function') ? opts.onApply : null;
    _onApplyMulti = (typeof opts.onApplyMulti === 'function') ? opts.onApplyMulti : null;
    _onDeleted = (typeof opts.onDeleted === 'function') ? opts.onDeleted : null;
    _allowDelete = opts.allowDelete !== false;
    _multiSelect = !!opts.multiSelect;
    if (typeof opts.cacheTTL === 'number' && opts.cacheTTL > 0) _cacheTTL = opts.cacheTTL;
    _initialKind = opts.kind || opts.initialKind || 'all';
    if (_initialKind !== 'all') _kindFilter = _initialKind;
    _injectCss();
    _render();
    _applyKindFilter();
    // 数据在 open() 时按需读取，隐藏的素材库不参与首屏请求和渲染。
  }

  // 监听全局变更事件：任何地方改动资产库后派发该事件即可触发本模块刷新
  if (typeof document !== 'undefined') {
    document.addEventListener('asset:changed', function () { invalidate(); });
  }

  console.log('[AssetLibrary][DEBUG] 脚本已加载，版本 = 20260811-15');
  window.AssetLibrary = {
    init: init,
    open: open,
    close: close,
    invalidate: invalidate,
    refresh: refresh,
    saveFavorite: saveFavorite,
    removeFavorite: removeFavorite,
    loadLibrary: loadLibrary
  };
})();
