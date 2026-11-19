/*
 * 内部图片拖拽桥 (InternalImageDrag)
 * ------------------------------------------------------------
 * 把应用内展示的图片（对话消息图、生成展示区/画廊图）标注成统一拖拽源，
 * 供提示词输入框等接收端消费。与 RefImageManager 只通过 dataTransfer MIME 解耦，
 * 双方都不 import 对方，任一模块缺失都自动退回原有行为。
 *
 * 用法：
 *   <script src="/static/modules/internal-image-drag.js" defer></script>  // 加载即自动 install
 *   InternalImageDrag.install({ selectors: [...] });   // 可选：覆盖选择器，幂等
 *   InternalImageDrag.isInternal(dt)                   // 接收端判断是否接管
 *   InternalImageDrag.collect(dt)                     // 取出原图 URL 数组
 *
 * 约定：自定义 MIME 的 payload 为 JSON {url, name} 或纯 URL 字符串；
 * 兼容画布已有拖拽源 application/x-canvas-output-image（纯 URL）。
 */
(function (global) {
  'use strict';

  var MIME = 'application/x-islechain-image';
  var COMPAT_MIMES = [
    MIME,
    'application/x-canvas-output-image',
    'application/x-canvas-asset',
    'application/x-canvas-input',
    'application/x-smart-image'
  ];

  // 声明式选择器：新增一种展示区只需加一行，不用改渲染代码
  var DEFAULT_SELECTORS = [
    '.chat-image-card img',   // 对话里的生成图
    '.chat-imgs img',         // 对话里上传的参考图
    '.masonry-item img',      // 生成展示区 / 画廊卡片
    'img[data-original-src]', // 通用兜底：展示区图片几乎都带原图地址
    '[data-image-url]'        // 通用声明式入口
  ];

  var installed = false;
  var selectors = DEFAULT_SELECTORS.slice();
  var lastSource = null;      // 最近一次 dragstart 的源，供接收端在 MIME 丢失时兜底

  function nodeFrom(target) {
    if (!target) return null;
    return target.nodeType === 1 ? target : (target.parentElement || null);
  }

  // 缩略图包裹 /api/media-preview?url=... 还原成原始图片 URL。
  // /api/comfyui/view?filename=... 本身就是可 fetch 的原图地址，不能解成裸文件名。
  function originalUrl(raw) {
    var u = String(raw || '').trim();
    if (!u || /^data:/i.test(u)) return u;
    try {
      var parsed = new URL(u, global.location.href);
      var inner = parsed.searchParams.get('url') || '';
      if (inner && parsed.pathname === '/api/media-preview') return originalUrl(inner);
    } catch (_) {}
    return u;
  }

  function fileName(u) {
    if (/^data:/i.test(u)) return '';
    try {
      var parsed = new URL(u, global.location.href);
      var tail = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
      if (/\.[a-z0-9]{2,5}$/i.test(tail)) return tail;
      var named = parsed.searchParams.get('filename') || '';
      return /\.[a-z0-9]{2,5}$/i.test(named) ? named : '';
    } catch (_) { return ''; }
  }

  function urlFrom(el) {
    if (!el || !el.getAttribute) return '';
    return originalUrl(
      el.getAttribute('data-original-src') ||
      el.getAttribute('data-image-url') ||
      el.getAttribute('data-url') ||
      el.getAttribute('src') ||
      el.currentSrc || ''
    );
  }

  // 命中展示区容器后，还要落到真正的 <img>：dragstart 的 target 常常是卡片 div
  // （closest 只向上找，不会向下找子元素），不落到 img 就拿不到 src / 位图。
  function match(target) {
    var node = nodeFrom(target);
    if (!node || !node.closest) return null;
    var hit = null;
    try { hit = node.closest(selectors.join(',')); } catch (_) { return null; }
    // 图片常被操作按钮 / 遮罩层盖住，dragstart 的 target 是覆盖层而不是 img。
    // 向上找到展示容器再取内部图片，避免「按在图上却标不到拖拽源」。
    if (!hit && node.closest) {
      try { hit = node.closest('.chat-image-card, .chat-imgs figure, .chat-imgs, .masonry-item'); } catch (_) {}
    }
    if (!hit) return null;
    if (hit.tagName === 'IMG') return hit;
    var inner = hit.querySelector ? hit.querySelector('img') : null;
    return inner || hit;
  }

  function hasType(dt, type) {
    try { return Array.prototype.indexOf.call(dt.types || [], type) >= 0; } catch (_) { return false; }
  }

  function install(options) {
    options = options || {};
    // 配置缝：宿主可替换展示区选择器，重复调用不会重复绑定事件
    if (options.selectors && options.selectors.length) selectors = options.selectors.slice();
    if (installed) return;
    installed = true;

    // 显式标注可拖：img 默认虽可拖，但 CSS -webkit-user-drag / 父级 draggable=false
    // 会让真实拖拽根本起不来。按下时补一次，渲染时也由 observer 提前补一次。
    var armImage = function (img) {
      if (!img || img.tagName !== 'IMG') return;
      if (img.getAttribute('draggable') !== 'true') img.setAttribute('draggable', 'true');
      try { img.style.webkitUserDrag = 'element'; } catch (_) {}
    };
    var prepare = function (e) {
      var el = match(e.target);
      if (el && el.tagName === 'IMG') armImage(el);
    };
    document.addEventListener('pointerdown', prepare, true);
    document.addEventListener('mousedown', prepare, true);

    // 新增展示区节点时提前标好：批量节流，避免画廊一次性渲染几百张时逐张处理
    var armAdded = function (root) {
      if (!root || !root.querySelectorAll) return;
      var list = root.querySelectorAll(selectors.join(','));
      Array.prototype.forEach.call(list, function (hit) {
        armImage(hit.tagName === 'IMG' ? hit : (hit.querySelector ? hit.querySelector('img') : null));
      });
    };
    var queue = [], timer = null;
    var schedule = function (node) {
      if (queue.indexOf(node) < 0) queue.push(node);
      if (timer) return;
      timer = setTimeout(function () {
        timer = null;
        var batch = queue; queue = [];
        batch.forEach(function (n) { if (n.isConnected) armAdded(n); });
      }, 60);
    };
    try {
      new MutationObserver(function (records) {
        records.forEach(function (r) {
          Array.prototype.forEach.call(r.addedNodes || [], function (n) {
            if (n.nodeType === 1) schedule(n.parentElement || n);
          });
        });
      }).observe(document.documentElement, { childList: true, subtree: true });
      armAdded(document);
    } catch (_) {}

    // 捕获阶段只补充数据，不 preventDefault / 不 stopPropagation：
    // 画布、卡片排序等已有拖拽语义照常运行，接收端多了一个可识别的 MIME
    document.addEventListener('dragstart', function (e) {
      var el = match(e.target);
      var dt = e.dataTransfer;
      if (!el || !dt) return;
      var u = urlFrom(el);
      if (!u) return;
      var name = fileName(u) || (el.getAttribute && el.getAttribute('alt') || 'image');
      lastSource = { url: u, name: name, el: el.tagName === 'IMG' ? el : null, ts: Date.now() };
      try {
        dt.setData(MIME, JSON.stringify({ url: u, name: name }));
        // 兼容只读 text/uri-list 的其它接收端（画布节点等）
        if (!hasType(dt, 'text/uri-list')) dt.setData('text/uri-list', u);
        // effectAllowed 与接收端 dropEffect 必须兼容，否则浏览器直接不触发 drop
        var eff = '';
        try { eff = String(dt.effectAllowed || ''); } catch (_) {}
        if (!eff || eff === 'uninitialized' || eff === 'none') dt.effectAllowed = 'copyMove';
      } catch (_) {}
    }, true);
  }

  function isInternal(dt) {
    if (!dt) return false;
    return COMPAT_MIMES.some(function (m) { return hasType(dt, m); });
  }

  // 从 dataTransfer 里提取内部图片 URL（JSON / 纯 URL / 多行都兼容）
  function collect(dt) {
    var out = [];
    var push = function (u) {
      u = originalUrl(String(u || '').trim());
      if (!u || out.indexOf(u) >= 0) return;
      if (!/^https?:\/\/|^\/|^blob:|^data:image\//i.test(u)) return;
      out.push(u);
    };
    COMPAT_MIMES.forEach(function (m) {
      var raw = '';
      try { raw = (dt && dt.getData(m)) || ''; } catch (_) {}
      if (!raw) return;
      if (raw.charAt(0) === '{' || raw.charAt(0) === '[') {
        try {
          var data = JSON.parse(raw);
          (Array.isArray(data) ? data : [data]).forEach(function (item) {
            push(item && (item.url || item.src || item.image) || (typeof item === 'string' ? item : ''));
          });
        } catch (_) { push(raw); }
      } else {
        raw.split(/\r?\n/).forEach(push);
      }
    });
    return out;
  }

  global.InternalImageDrag = {
    MIME: MIME,
    MIMES: COMPAT_MIMES.slice(),
    DEFAULT_SELECTORS: DEFAULT_SELECTORS.slice(),
    install: install,
    isInternal: isInternal,
    collect: collect,
    lastSource: function () { return lastSource; },
    originalUrl: originalUrl,
    fileName: fileName
  };

  // 加载即生效：宿主只需引入脚本，不依赖初始化时机
  install();
})(window);
