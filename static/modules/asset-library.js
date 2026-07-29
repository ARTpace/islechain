/*
 * asset-library.js — 资产库选择独立功能模块
 * 把"从资产库选图 / 删除 / 去重"封装成可复用模块，供各页面接入。
 *
 * 用法：
 *   <div id="assetLibraryMount"></div>
 *   <script src="/static/modules/asset-library.js"></script>
 *   <script>
 *     AssetLibrary.init({
 *       mountId:   'assetLibraryMount',   // 面板挂载点（任意容器，浮层 fixed 覆盖全屏）
 *       title:     '从资产库选择',          // 面板标题（可选）
 *       allowDelete: true,                // 是否显示每张图的删除按钮（默认 true）
 *       onApply:   function (url, name) { // 用户点选某资产图时回调（可选）
 *         // 由调用页面决定怎么用，例如转成 File 加到参考图管理器
 *       },
 *       onDeleted: function (url, name) {} // 某资产被删除后回调（可选）
 *     });
 *   </script>
 *   // 触发打开：AssetLibrary.open()
 *   // 关闭：     AssetLibrary.close()
 */
(function () {
  'use strict';

  // ───────────────────────────── CSS ─────────────────────────────
  var CSS = [
    ".asset-picker-overlay { position:fixed; inset:0; background:rgba(15,23,42,.65); z-index:60; display:flex; align-items:center; justify-content:center; padding:24px; backdrop-filter:blur(4px); opacity:0; visibility:hidden; pointer-events:none; transition:opacity .22s ease, visibility .22s ease; }",
    ".asset-picker-overlay.open { display:flex; opacity:1; visibility:visible; pointer-events:auto; }",
    ".asset-picker-panel { background:#fff; border-radius:18px; width:min(900px, 95vw); max-height:88vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 28px 64px rgba(15,23,42,.35); transform:translateY(10px) scale(.98); opacity:0; transition:transform .28s cubic-bezier(.2,.8,.2,1), opacity .28s ease; will-change:transform,opacity; }",
    "body.studio-theme-dark .asset-picker-panel, html.studio-theme-dark body .asset-picker-panel { background:#0f172a; border:1px solid #1f2937; }",
    ".asset-picker-head { display:flex; align-items:center; justify-content:space-between; padding:18px 22px; border-bottom:1px solid rgba(15,23,42,.06); }",
    "body.studio-theme-dark .asset-picker-head, html.studio-theme-dark body .asset-picker-head { border-bottom-color:rgba(255,255,255,.06); }",
    ".asset-picker-title { display:inline-flex; align-items:center; gap:8px; font-size:14px; font-weight:900; color:#0f172a; }",
    "body.studio-theme-dark .asset-picker-title, html.studio-theme-dark body .asset-picker-title { color:#e2e8f0; }",
    ".asset-picker-head-actions { display:flex; align-items:center; gap:6px; }",
    ".asset-picker-dedup { font-size:10px; padding:0 8px; border-radius:6px; background:transparent; border:1px solid #94a3b8; color:#94a3b8; cursor:pointer; height:24px; transition:all .15s ease; }",
    ".asset-picker-dedup:hover { background:rgba(148,163,184,.12); }",
    "body.studio-theme-dark .asset-picker-dedup, html.studio-theme-dark body .asset-picker-dedup { color:#94a3b8; border-color:#475569; }",
    "body.studio-theme-dark .asset-picker-dedup:hover, html.studio-theme-dark body .asset-picker-dedup:hover { background:rgba(148,163,184,.15); }",
    ".asset-picker-close { width:32px; height:32px; border:0; background:transparent; color:#64748b; font-size:24px; line-height:1; border-radius:8px; cursor:pointer; transition:all .15s ease; }",
    ".asset-picker-close:hover { background:#f1f5f9; color:#0f172a; }",
    "body.studio-theme-dark .asset-picker-close:hover, html.studio-theme-dark body .asset-picker-close:hover { background:#1e293b; color:#e2e8f0; }",
    ".asset-picker-content { flex:1; overflow:auto; padding:18px 22px; }",
    ".asset-picker-toolbar { display:flex; align-items:center; gap:12px; padding:10px 22px; border-bottom:1px solid rgba(15,23,42,.06); }",
    "body.studio-theme-dark .asset-picker-toolbar, html.studio-theme-dark body .asset-picker-toolbar { border-bottom-color:rgba(255,255,255,.06); }",
    ".asset-picker-search { flex:1; min-width:0; height:32px; padding:0 12px; border-radius:8px; border:1px solid rgba(15,23,42,.12); background:rgba(15,23,42,.03); color:#0f172a; font-size:12px; outline:none; transition:border-color .15s ease; }",
    ".asset-picker-search:focus { border-color:#3b82f6; }",
    ".asset-picker-search::placeholder { color:#94a3b8; }",
    "body.studio-theme-dark .asset-picker-search, html.studio-theme-dark body .asset-picker-search { background:rgba(255,255,255,.05); border-color:rgba(255,255,255,.12); color:#e2e8f0; }",
    ".asset-picker-size { display:flex; align-items:center; gap:8px; }",
    ".asset-picker-size-label { font-size:11px; font-weight:700; color:#64748b; white-space:nowrap; }",
    "body.studio-theme-dark .asset-picker-size-label, html.studio-theme-dark body .asset-picker-size-label { color:#94a3b8; }",
    ".asset-picker-size-range { width:110px; accent-color:#3b82f6; cursor:pointer; }",
    "body.studio-theme-dark .asset-picker-size-range { accent-color:#38bdf8; }",
    ".asset-picker-empty { padding:36px 0; text-align:center; color:#64748b; font-size:12px; font-weight:700; }",
    "body.studio-theme-dark .asset-picker-empty, html.studio-theme-dark body .asset-picker-empty { color:#94a3b8; }",
    ".asset-picker-grid { columns: 140px; column-gap: 12px; }",
    ".asset-picker-item { display:block; margin:0 0 12px; break-inside:avoid; border:1px solid rgba(15,23,42,.08); border-radius:10px; cursor:pointer; background:rgba(15,23,42,.02); transition:border-color .15s ease, transform .15s ease; overflow:hidden; position:relative; }",
    ".asset-picker-item:hover { border-color:#3b82f6; transform:translateY(-1px); }",
    "body.studio-theme-dark .asset-picker-item, html.studio-theme-dark body .asset-picker-item { background:rgba(255,255,255,.04); border-color:rgba(255,255,255,.1); }",
    ".asset-picker-item img { display:block; width:100%; height:auto; border-radius:0; background:#f1f5f9; }",
    "body.studio-theme-dark .asset-picker-item img, html.studio-theme-dark body .asset-picker-item img { background:#1e293b; }",
    ".asset-picker-item-name { position:absolute; top:0; left:0; right:0; padding:9px 34px 16px 10px; font-size:11px; font-weight:700; color:#f8fafc; background:linear-gradient(to bottom, rgba(15,23,42,.8), rgba(15,23,42,0)); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; pointer-events:none; opacity:0; transition:opacity .15s ease; z-index:3; }",
    ".asset-picker-item:hover .asset-picker-item-name { opacity:1; }",
    ".asset-picker-del { position:absolute; top:8px; right:8px; width:24px; height:24px; border:0; border-radius:50%; background:rgba(15,23,42,.55); color:#fff; font-size:15px; line-height:1; cursor:pointer; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity .15s ease, background .15s ease; z-index:4; }",
    ".asset-picker-item:hover .asset-picker-del { opacity:1; }",
    ".asset-picker-del:hover { background:#ef4444; }",
    "body.studio-theme-dark .asset-picker-del, html.studio-theme-dark body .asset-picker-del { background:rgba(15,23,42,.7); }",
    "body.studio-theme-dark .asset-picker-del:hover, html.studio-theme-dark body .asset-picker-del:hover { background:#ef4444; }",
    ".asset-picker-overlay.open .asset-picker-panel { transform: translateY(0) scale(1); opacity:1; }",
    ".asset-picker-overlay-open { overflow:hidden !important; }",
    "@media (hover: none) { .asset-picker-item:hover { transform:none; border-color:rgba(15,23,42,.08); } body.studio-theme-dark .asset-picker-item:hover { border-color:rgba(255,255,255,.1); } .asset-picker-item-name, .asset-picker-item:hover .asset-picker-item-name { opacity:1; } .asset-picker-del, .asset-picker-item:hover .asset-picker-del { opacity:1; } .asset-picker-item:active { transform:scale(.97); transition:transform .12s ease; } }",
    "@media (max-width: 640px) { .asset-picker-overlay { padding:0; align-items:flex-end; } .asset-picker-panel { width:100%; max-width:100%; height:92vh; max-height:92vh; border-radius:18px 18px 0 0; transform:translateY(100%); transition:transform .3s cubic-bezier(.2,.8,.2,1), opacity .3s ease; } .asset-picker-overlay.open .asset-picker-panel { transform:translateY(0); } .asset-picker-head { padding:14px 16px; } .asset-picker-title { font-size:15px; } .asset-picker-close { width:38px; height:38px; font-size:26px; } .asset-picker-toolbar { flex-wrap:wrap; gap:10px; padding:10px 14px; } .asset-picker-search { flex:1 1 100%; height:38px; font-size:14px; } .asset-picker-size { flex:1 1 100%; justify-content:space-between; } .asset-picker-size-range { flex:1; width:auto; } .asset-picker-content { padding:14px; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; } .asset-picker-grid { column-gap:8px; } .asset-picker-item { margin:0 0 8px; touch-action:manipulation; } .asset-picker-item-name { font-size:12px; } .asset-picker-del { width:30px; height:30px; font-size:18px; } }"
  ].join('\n');

  // ───────────────────────────── HTML 模板（data-act 事件委托）─────────────────────────────
  var HTML = [
    '<div class="asset-picker-overlay" id="assetLibraryOverlay">',
    '    <div class="asset-picker-panel">',
    '        <div class="asset-picker-head">',
    '            <div class="asset-picker-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg><span id="assetLibraryTitle">从资产库选择</span></div>',
    '            <div class="asset-picker-head-actions">',
    '                <button class="asset-picker-dedup" data-act="dedup" title="删除重复资产">去重</button>',
    '                <button class="asset-picker-close" data-act="close" title="关闭">&times;</button>',
    '            </div>',
    '        </div>',
    '        <div class="asset-picker-toolbar">',
    '            <input class="asset-picker-search" id="assetLibrarySearch" type="text" placeholder="搜索资产名称...">',
    '            <div class="asset-picker-size">',
    '                <span class="asset-picker-size-label">大小</span>',
    '                <input class="asset-picker-size-range" id="assetLibrarySize" type="range" min="100" max="280" step="10" value="140">',
    '            </div>',
    '        </div>',
    '        <div class="asset-picker-content" id="assetLibraryContent">',
    '            <div class="asset-picker-empty"><span>加载中...</span></div>',
    '        </div>',
    '    </div>',
    '</div>'
  ].join('\n');

  // ───────────────────────────── 模块状态 ─────────────────────────────
  var _mountId = 'assetLibraryMount';
  var _title = '从资产库选择';
  var _onApply = null;
  var _onDeleted = null;
  var _allowDelete = true;
  var _cssInjected = false;
  var _rendered = false;
  // ── 列表缓存 / 网格已渲染标记（避免每次打开重复请求与重建 DOM）──
  var _cache = null;        // 最近一次拉取的资产列表（img 对象数组）
  var _cacheTs = 0;         // 缓存时间戳
  var _cacheTTL = 60000;    // 缓存新鲜度窗口（毫秒），过期后后台静默刷新
  var _gridBuilt = false;   // 网格是否已渲染到 content 中（已渲染则不重建）
  var _searchTerm = '';     // 当前搜索关键词（按名称过滤，客户端）
  var _colWidth = 140;      // 瀑布流列宽（像素），由大小滑条控制

  // ───────────────────────────── 工具 ─────────────────────────────
  function $(id) { return document.getElementById(id); }

  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function _injectCss() {
    if (_cssInjected) return;
    if (document.getElementById('asset-library-css')) { _cssInjected = true; return; }
    var style = document.createElement('style');
    style.id = 'asset-library-css';
    style.textContent = CSS;
    document.head.appendChild(style);
    _cssInjected = true;
  }

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
    var size = $('assetLibrarySize');
    if (search) {
      search.value = _searchTerm;
      search.addEventListener('input', function () {
        _searchTerm = (search.value || '').trim();
        if (_cache) _renderGrid(_cache);   // 客户端过滤，无需重新请求
      });
    }
    if (size) {
      size.value = String(_colWidth);
      size.addEventListener('input', function () {
        _colWidth = parseInt(size.value, 10) || 140;
        _applySize();
      });
    }
  }

  // 将当前列宽应用到已渲染的网格（大小滑条实时生效）
  function _applySize() {
    var grid = document.querySelector('#assetLibraryContent .asset-picker-grid');
    if (grid) grid.style.columnWidth = _colWidth + 'px';
  }

  function _bindEvents() {
    var overlay = $('assetLibraryOverlay');
    if (!overlay) return;
    overlay.addEventListener('click', function (e) {
      // 点击遮罩空白处关闭
      if (e.target === overlay) { close(); return; }
      var el = e.target.closest('[data-act]');
      if (!el) return;
      var act = el.getAttribute('data-act');
      if (act === 'close') close();
      else if (act === 'dedup') dedupAssets();
      else if (act === 'select') applyAsset(el.getAttribute('data-url'), el.getAttribute('data-name'));
      else if (act === 'delete') deleteAsset(el.getAttribute('data-url'), el.getAttribute('data-name'));
    });
  }

  function _renderIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try { window.lucide.createIcons(); } catch (_) {}
    }
  }

  // ───────────────────────────── 列表加载 / 渲染 ─────────────────────────────
  // 把列表渲染成网格。已渲染(_gridBuilt)且数据未变时不会重建 DOM，
  // 这样再次打开面板时图片仍在 DOM 中，浏览器直接复用、不再重新下载。
  function _renderGrid(images) {
    var content = $('assetLibraryContent');
    if (!content) return;
    // 按搜索词过滤（名称 或 提示词，客户端、不重新请求）
    var list = (images || []).filter(function (img) {
      if (!_searchTerm) return true;
      var t = _searchTerm.toLowerCase();
      return (img.name || '').toLowerCase().indexOf(t) !== -1
          || (img.prompt || '').toLowerCase().indexOf(t) !== -1;
    });
    if (!list.length) {
      content.innerHTML = '<div class="asset-picker-empty"><span>' +
        (_searchTerm ? '无匹配的资产图片' : '暂无资产图片') + '</span></div>';
      _gridBuilt = true;   // 即使为空也标记为已渲染，避免 open() 反复重新请求
      return;
    }
    content.innerHTML = '<div class="asset-picker-grid">' + list.map(function (img) {
      var u = escAttr(img.url || '');
      var n = escAttr(img.name || '');
      var item = '<div class="asset-picker-item" data-act="select" data-url="' + u + '" data-name="' + n + '">';
      if (_allowDelete) {
        item += '<button class="asset-picker-del" title="删除" data-act="delete" data-url="' + u + '" data-name="' + n + '">&times;</button>';
      }
      item += '<div class="asset-picker-item-name">' + n + '</div><img src="' + u + '" alt="' + n + '" loading="lazy"></div>';
      return item;
    }).join('') + '</div>';
    _gridBuilt = true;
    _applySize();   // 让大小滑条设置的列宽对新网格立即生效
  }

  // opts.silent: true 时不显示"加载中"遮罩、不阻塞（用于 init 预加载 / 过期后台刷新）
  function loadAndRender(opts) {
    opts = opts || {};
    var silent = !!opts.silent;
    var content = $('assetLibraryContent');
    if (!content) return;
    // 非静默且网格尚未建立时才显示 loading，避免已有网格被清空闪白
    if (!silent && !_gridBuilt) {
      content.innerHTML = '<div class="asset-picker-empty"><span>加载中...</span></div>';
    }
    _renderIcons();
    fetch('/api/user/assets')
      .then(function (r) {
        if (r.status === 401) {
          content.innerHTML = '<div class="asset-picker-empty"><span>请先登录后再使用资产库</span></div>';
          _gridBuilt = false;
          _cache = null;
          return;
        }
        if (!r.ok) throw new Error('获取资产列表失败');
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        var images = data.files || [];
        _cache = images;
        _cacheTs = Date.now();
        _renderGrid(images);
      })
      .catch(function (err) {
        content.innerHTML = '<div class="asset-picker-empty"><span>加载失败: ' + (err.message || '') + '</span></div>';
      });
  }

  // ───────────────────────────── 去重 / 删除 / 选图 ─────────────────────────────
  function dedupAssets() {
    fetch('/api/user/assets/dedup', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.removed > 0) alert('已删除 ' + d.removed + ' 张重复图片，保留 ' + d.kept + ' 张');
        else alert('没有找到重复图片（共 ' + d.kept + ' 张）');
        loadAndRender();
      })
      .catch(function (e) { alert('去重失败: ' + e.message); });
  }

  function deleteAsset(url, name) {
    if (!confirm('确定从资产库删除「' + (name || '该图片') + '」？此操作不可撤销。')) return;
    fetch('/api/user/assets/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    }).then(function (r) {
      if (!r.ok) throw new Error('删除失败: ' + r.status);
      if (typeof _onDeleted === 'function') { try { _onDeleted(url, name); } catch (_) {} }
      return loadAndRender();
    }).catch(function (e) {
      alert('删除失败: ' + (e.message || ''));
    });
  }

  function applyAsset(url, name) {
    close();
    if (typeof _onApply === 'function') {
      try { _onApply(url, name); } catch (err) { console.error('[AssetLibrary] onApply error:', err); }
    }
  }

  // ───────────────────────────── 公开 API ─────────────────────────────
  function open() {
    if (!_rendered) _render();
    var ov = $('assetLibraryOverlay');
    if (!ov) return;
    ov.classList.add('open');
    document.body.classList.add('asset-picker-overlay-open');
    // 首次打开（无缓存）→ 拉取列表
    if (!_cache) { loadAndRender(); return; }
    // 网格已渲染且缓存新鲜 → 直接展示，零网络请求、图片不重新下载
    if (_gridBuilt && (Date.now() - _cacheTs) < _cacheTTL) return;
    // 网格已渲染但缓存可能过期 → 先即时展示旧网格，后台静默刷新
    if (_gridBuilt) { loadAndRender({ silent: true }); return; }
    // 有缓存但网格未建立（异常分支）→ 重新拉取
    loadAndRender();
  }

  function close() {
    var ov = $('assetLibraryOverlay');
    if (ov) ov.classList.remove('open');
    document.body.classList.remove('asset-picker-overlay-open');
  }

  // 面板当前是否处于打开态
  function _isOpen() {
    var ov = $('assetLibraryOverlay');
    return !!(ov && ov.classList.contains('open'));
  }

  // 使缓存失效：外部（如收藏存资产、其他页面删除）改变资产后调用，
  // 下次打开会重新拉取；若面板正打开则立即刷新，保证用户看到最新资产。
  function invalidate() {
    _cache = null;
    _cacheTs = 0;
    _gridBuilt = false;
    if (_isOpen()) loadAndRender();
  }
  function refresh() { invalidate(); }

  // 监听全局变更事件：任何地方改动资产库后派发该事件即可触发本模块刷新
  if (typeof document !== 'undefined') {
    document.addEventListener('asset:changed', function () { invalidate(); });
  }

  function init(opts) {
    opts = opts || {};
    _mountId = opts.mountId || 'assetLibraryMount';
    _title = opts.title || '从资产库选择';
    _onApply = (typeof opts.onApply === 'function') ? opts.onApply : null;
    _onDeleted = (typeof opts.onDeleted === 'function') ? opts.onDeleted : null;
    _allowDelete = opts.allowDelete !== false;
    if (typeof opts.cacheTTL === 'number' && opts.cacheTTL > 0) _cacheTTL = opts.cacheTTL;
    _injectCss();
    _render();
    // 后台静默预加载资产列表，使首次打开即秒显（隐藏态完成，无闪白）
    loadAndRender({ silent: true });
  }

  // ───────────────────────────── 暴露给外部 ─────────────────────────────
  window.AssetLibrary = {
    init: init,
    open: open,
    close: close,
    invalidate: invalidate,
    refresh: refresh
  };
})();
