/* 桌面端窗口外壳：无边框 + 圆角 + 自绘窗口按钮 + 关闭收进托盘。
 *
 * 页面每次导航都会把注入的 DOM 丢掉，所以这段脚本由 Rust 侧定时 eval（幂等）：
 * 有就立刻返回，没有就补齐。只作用于顶层文档，iframe 里的模块页不受影响。 */
(function () {
  if (window.top !== window.self) return;
  var ID = 'isle-chain-chrome';
  if (document.getElementById(ID)) return;
  if (!document.body) return;
  if (!(window.__TAURI__ || window.__TAURI_INTERNALS__)) return;

  function invoke(action) {
    try {
      var core = window.__TAURI__ && window.__TAURI__.core;
      if (core && core.invoke) return core.invoke('desktop_chrome', { action: action });
      var internals = window.__TAURI_INTERNALS__;
      if (internals && internals.invoke) {
        return internals.invoke('desktop_chrome', { action: action });
      }
    } catch (error) {
      /* 忽略：非桌面环境 */
    }
    return Promise.reject(new Error('no-tauri'));
  }

  var CSS = [
    /* 圆角交给系统：Win11 的 DWM 会自己把窗口裁成圆角（还带描边和阴影）。
     * 再叠一层 clip-path 就会因为半径对不上，在角上留出「透出桌面」的亮带，
     * 看起来像双圆角。这里只保留根元素底色，防止 body 背景上浮成画布背景。 */
    'html.ic-frameless{--ic-bar:30px;background:var(--ui-bg,#fff)!important}',
    /* 只把工作区往下让 30px（不写死条带底色，看不出有标题栏）：
     * 直接改 body 高度会让页面里 100vh 的容器溢出、底部被裁，所以只动 stage 的外边距。 */
    'html.ic-frameless .stage{margin-top:calc(16px + var(--ic-bar))!important}',
    '#isle-chain-chrome{position:fixed;left:0;top:0;right:0;height:30px;z-index:2147483601;pointer-events:none;',
    'font:12px/1 system-ui,"Segoe UI",sans-serif;-webkit-user-select:none;user-select:none}',
    /* 拖动带 = 整条顶部留白（38px，止于工作区上沿 46px 之前），
     * 这一带本来就没有页面控件，放大到这里既好抓又不会吃掉点击 */
    '#isle-chain-chrome .ic-grip{position:fixed;left:0;right:0;top:0;height:38px;pointer-events:auto}',
    /* 右上角热区：不占视觉、也不画任何底色，鼠标靠近才让按钮浮出来 */
    '#isle-chain-chrome .ic-hot{position:fixed;right:0;top:0;width:160px;height:34px;pointer-events:auto}',
    '#isle-chain-chrome .ic-btns{position:absolute;right:6px;top:1px;display:flex;gap:2px;padding:2px;',
    'border-radius:9px;pointer-events:none;opacity:0;transform:translateY(-3px);background:transparent;',
    'transition:opacity .16s ease,transform .16s ease,background .16s ease}',
    '#isle-chain-chrome .ic-hot:hover .ic-btns{opacity:1;pointer-events:auto;transform:none;background:rgba(128,128,128,.14)}',
    '#isle-chain-chrome .ic-btn{width:25px;height:22px;display:flex;align-items:center;justify-content:center;',
    'border:0;border-radius:7px;background:transparent;color:var(--ui-text,#2c2c2a);cursor:default;padding:0;',
    'transition:background .14s ease,color .14s ease}',
    '#isle-chain-chrome .ic-btn:hover{background:rgba(128,128,128,.3)}',
    '#isle-chain-chrome .ic-btn.ic-close:hover{background:#d13438;color:#fff}',
    '#isle-chain-chrome .ic-btn svg{width:12px;height:12px;display:block}',
    /* 穿透态必须把根元素的底色也撤掉，否则桌面透不过来；外壳一起让位 */
    'html.desktop-overlay,html.ic-overlay{background:transparent!important}',
    'html.desktop-overlay .stage,html.ic-overlay .stage{margin-top:16px!important}',
    'html.desktop-overlay #isle-chain-chrome,html.ic-overlay #isle-chain-chrome{display:none!important}'
  ].join('');

  var style = document.getElementById('isle-chain-chrome-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'isle-chain-chrome-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  var ICONS = {
    min: '<path d="M2.8 6h6.4"/>',
    max: '<rect x="2.9" y="2.9" width="6.2" height="6.2" rx="1.3"/>',
    restore: '<rect x="2.4" y="4" width="5.6" height="5.6" rx="1.2"/><path d="M4.6 4V3.1a.9.9 0 0 1 .9-.9h3.4a.9.9 0 0 1 .9.9v3.4a.9.9 0 0 1-.9.9H8.2"/>',
    close: '<path d="M3.1 3.1l5.8 5.8M8.9 3.1l-5.8 5.8"/>'
  };

  function icon(name) {
    return '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.15" '
      + 'stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
  }

  var root = document.createElement('div');
  root.id = ID;
  root.innerHTML = '<div class="ic-grip"></div>'
    + '<div class="ic-hot"><div class="ic-btns">'
    + '<button class="ic-btn" data-act="minimize" title="最小化">' + icon('min') + '</button>'
    + '<button class="ic-btn" data-act="toggle-maximize" title="最大化">' + icon('max') + '</button>'
    + '<button class="ic-btn ic-close" data-act="close" title="关闭（收进托盘）">' + icon('close') + '</button>'
    + '</div></div>';
  document.body.appendChild(root);
  document.documentElement.classList.add('ic-frameless');

  var grip = root.querySelector('.ic-grip');
  var hot = root.querySelector('.ic-hot');
  var buttons = root.querySelector('.ic-btns');
  var maxButton = root.querySelector('[data-act="toggle-maximize"]');

  // 拖动要等指针真的移动了几个像素再交给系统：一按下就 start_dragging 会让
  // Windows 抢走消息循环，双击最大化就再也收不到了。
  var armed = false;
  var startX = 0;
  var startY = 0;

  function isButton(target) {
    return !!(target && target.closest && target.closest('button'));
  }

  function hookDragArea(el, accepts) {
    el.addEventListener('mousedown', function (event) {
      if (event.button !== 0 || isButton(event.target) || (accepts && !accepts(event.target))) return;
      armed = true;
      startX = event.screenX;
      startY = event.screenY;
      event.preventDefault();
    });
    el.addEventListener('dblclick', function (event) {
      if (isButton(event.target) || (accepts && !accepts(event.target))) return;
      invoke('toggle-maximize').catch(function () {});
    });
  }

  window.addEventListener('mousemove', function (event) {
    if (!armed) return;
    if (Math.abs(event.screenX - startX) < 3 && Math.abs(event.screenY - startY) < 3) return;
    armed = false;
    invoke('drag').catch(function () {});
  });
  window.addEventListener('mouseup', function () {
    armed = false;
  });

  hookDragArea(grip);
  hookDragArea(hot);
  // ponytail: 委托到文档，兼容外壳先注入、侧栏稍后出现；仅空白处复用系统窗口拖动。
  hookDragArea(document, function (target) {
    return !!(target && target.closest && target.closest('.sidebar')
      && !target.closest('.nav-item, .submenu, .logo-ring, .sidebar-status, a, button, input, select, textarea, [role="button"], [draggable="true"]'));
  });

  buttons.addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    invoke(button.getAttribute('data-act')).catch(function () {});
  });

  var lastMax = null;
  function syncMaximized() {
    invoke('state').then(function (value) {
      var maximized = value === 'maximized';
      if (maximized === lastMax) return;
      lastMax = maximized;
      document.documentElement.classList.toggle('ic-maximized', maximized);
      maxButton.innerHTML = icon(maximized ? 'restore' : 'max');
      maxButton.title = maximized ? '还原' : '最大化';
    }).catch(function () {});
  }

  var timer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(timer);
    timer = setTimeout(syncMaximized, 120);
  });
  syncMaximized();
})();
