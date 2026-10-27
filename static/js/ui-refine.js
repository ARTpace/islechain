/* =====================================================================
   ui-refine.js — ART AI 「高定」交互层
   ---------------------------------------------------------------------
   对应 studio-ui.css v3 的行为类铁律：
     · 铁律 4  流式打字：单字 90ms blur(6px)→清晰，相邻字错开 30ms 晕开
     · 铁律 7  丝滑折叠：Grid 0fr→1fr（JS 只切 class，不算高度）
     · 铁律 9  动效性格：拖拽过阻尼弹簧(1200/80) 零回弹 / 点赞对勾欠阻尼(380/18) 微弹
     · 铁律 10 反馈自熄：复制对勾 2.5s 自动淡出恢复
   ---------------------------------------------------------------------
   用法：
     <script src="/static/js/ui-refine.js"></script>
     UIRefine.type(el, text)            一次性打字（整段 30ms 错开）
     UIRefine.stream(el, text)          流式增量打字（新增字符逐个入场）
     UIRefine.copy(text)                复制到剪贴板
     UIRefine.bindCopy(btn, getter)     按钮点击复制 + 自熄对勾
     UIRefine.bindCollapse(btn, panel)  折叠切换（Grid 0fr→1fr）
     UIRefine.springify(el)             拖拽元素套用过阻尼弹簧曲线
   ===================================================================== */
(function (global) {
  'use strict';

  /* ---------- 铁律 4：流式打字 ---------- */
  var CHAR_MS = 90;      /* 单字动画时长 */
  var STAGGER_MS = 30;   /* 相邻字错开 */

  function makeChar(ch, delay) {
    var span = document.createElement('span');
    span.className = 'ui-ch';
    span.textContent = ch;
    if (delay > 0) span.style.setProperty('--d', delay + 'ms');
    return span;
  }

  /**
   * 一次性打字：整段文本按 30ms 逐字错开入场
   * @param {HTMLElement} el
   * @param {string} text
   * @param {{from?:number}} [opts] from=已有可见字符数（新字符才动画）
   */
  function type(el, text, opts) {
    if (!el) return;
    opts = opts || {};
    var from = opts.from == null ? 0 : opts.from;
    var stagger = opts.stagger == null ? STAGGER_MS : opts.stagger;
    var str = text == null ? '' : String(text);
    var frag = document.createDocumentFragment();
    for (var i = 0; i < str.length; i++) {
      frag.appendChild(makeChar(str[i], i >= from ? (i - from) * stagger : 0));
    }
    el.replaceChildren(frag);
    el.__uiTyped = { buf: str };
    return el;
  }

  /**
   * 流式增量打字：只给"新增"的字符做入场动画，已显示内容保持不动
   * 若传入文本与上次不连续（回退/替换），则无动画整体重排
   */
  function stream(el, text) {
    if (!el) return;
    var str = text == null ? '' : String(text);
    var state = el.__uiStream;
    if (!state || str.indexOf(state.buf) !== 0 || str.length < state.buf.length) {
      // 文本不连续 → 直接重排，不做动画
      el.replaceChildren();
      state = el.__uiStream = { buf: '' };
      for (var i = 0; i < str.length; i++) el.appendChild(makeChar(str[i], 0));
      state.buf = str;
      return el;
    }
    var added = str.slice(state.buf.length);
    for (var j = 0; j < added.length; j++) {
      el.appendChild(makeChar(added[j], j === 0 ? 0 : STAGGER_MS * j));
    }
    state.buf = str;
    return el;
  }

  /** 结束流式打字：把剩余字符一次性带动画补齐 */
  function finish(el, text) {
    if (!el) return;
    var str = text == null ? (el.__uiStream ? el.__uiStream.buf : '') : String(text);
    var state = el.__uiStream || { buf: '' };
    if (str.length <= state.buf.length) return el;
    var base = state.buf.length;
    var added = str.slice(base);
    for (var j = 0; j < added.length; j++) {
      el.appendChild(makeChar(added[j], j * STAGGER_MS));
    }
    state.buf = str;
    el.__uiTyped = { buf: str };
    return el;
  }

  /* ---------- 铁律 10：反馈自熄（复制对勾 2.5s 后自动淡出） ---------- */
  var DONE_MS = 2500;

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(String(text == null ? '' : text));
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = String(text == null ? '' : text);
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (e) { reject(e); }
    });
  }

  /**
   * 绑定复制按钮：点击后显示对勾，2.5s 自动淡出恢复
   * @param {HTMLElement} btn
   * @param {() => string} [getter] 取值函数，缺省取 data-copy / data-copy-target
   */
  function bindCopy(btn, getter) {
    if (!btn || btn.__uiCopyBound) return btn;
    btn.__uiCopyBound = true;
    var original = btn.innerHTML;
    btn.classList.add('ui-copy-state');
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      var value = '';
      try {
        if (typeof getter === 'function') value = getter();
        else if (btn.dataset && btn.dataset.copy != null) value = btn.dataset.copy;
        else if (btn.dataset && btn.dataset.copyTarget) {
          var t = document.querySelector(btn.dataset.copyTarget);
          value = t ? (t.value || t.textContent || '') : '';
        }
      } catch (e) { value = ''; }
      if (!value) return;
      copy(value).then(function () {
        btn.innerHTML = original + '<span class="ui-copy-done ui-pop" aria-hidden="true">✓</span>';
        clearTimeout(btn.__uiCopyTimer);
        btn.__uiCopyTimer = setTimeout(function () {
          btn.innerHTML = original;
          btn.classList.remove('ui-copy-state');
        }, DONE_MS);
      }).catch(function () { /* 静默失败，不打断交互 */ });
    });
    return btn;
  }

  /** 给任意元素挂一个自熄对勾反馈 */
  function flashDone(el, mark) {
    if (!el) return;
    el.classList.add('ui-copy-state');
    var tag = document.createElement('span');
    tag.className = 'ui-copy-done ui-pop';
    tag.textContent = mark || '✓';
    tag.setAttribute('aria-hidden', 'true');
    el.appendChild(tag);
    clearTimeout(el.__uiDoneTimer);
    el.__uiDoneTimer = setTimeout(function () {
      if (tag.parentNode) tag.parentNode.removeChild(tag);
      el.classList.remove('ui-copy-state');
    }, DONE_MS);
  }

  /* ---------- 铁律 7：丝滑折叠（Grid 0fr→1fr，JS 不算高度） ---------- */
  function bindCollapse(btn, panel) {
    if (!btn || !panel) return;
    btn.setAttribute('aria-expanded', panel.classList.contains('is-open') ? 'true' : 'false');
    btn.addEventListener('click', function () {
      var open = panel.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* ---------- 铁律 9：动效性格（拖拽零回弹） ---------- */
  function springify(el, prop) {
    if (!el) return el;
    el.style.transitionTimingFunction = 'cubic-bezier(.16, 1, .3, 1)'; /* 1200/80 过阻尼 */
    el.style.transition = (prop || 'transform') + ' 420ms cubic-bezier(.16, 1, .3, 1)';
    return el;
  }

  /* ---------- 自动装配 ---------- */
  function autoBind(root) {
    var scope = root || document;
    scope.querySelectorAll('[data-copy], [data-copy-target]').forEach(function (el) {
      bindCopy(el);
    });
    scope.querySelectorAll('[data-collapse-toggle]').forEach(function (btn) {
      var panel = null;
      var sel = btn.getAttribute('data-collapse-toggle');
      if (sel && sel.charAt(0) === '#') panel = document.querySelector(sel);
      else if (sel) panel = btn.nextElementSibling;
      if (panel) {
        panel.classList.add('ui-collapse');
        if (!panel.firstElementChild) {
          var inner = document.createElement('div');
          inner.className = 'ui-collapse-inner';
          while (panel.firstChild) inner.appendChild(panel.firstChild);
          panel.appendChild(inner);
        }
        bindCollapse(btn, panel);
      }
    });
  }

  var UIRefine = {
    type: type,
    stream: stream,
    finish: finish,
    copy: copy,
    bindCopy: bindCopy,
    flashDone: flashDone,
    bindCollapse: bindCollapse,
    springify: springify,
    autoBind: autoBind,
    CHAR_MS: CHAR_MS,
    STAGGER_MS: STAGGER_MS,
    DONE_MS: DONE_MS
  };

  global.UIRefine = UIRefine;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { autoBind(document); });
  } else {
    autoBind(document);
  }
})(window);
