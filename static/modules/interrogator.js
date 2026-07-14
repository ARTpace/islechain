/*
 * 通用反推提示词模块 (Interrogator)
 * ------------------------------------------------------------
 * 设计目标:作为一个"能力模块"被应用内任意功能复用,不耦合任何具体功能。
 *   - reverse(file, opts):  调用后端 /api/interrogate,返回 {text, format, tags, raw, provider}
 *   - mountButton(container, options): 在任意 DOM 容器内挂载"反推提示词"按钮 + 结果弹窗
 * 回填策略(替换 / 追加 / 取消)由宿主通过 options.onApply 回调决定,模块本身不碰任何输入框。
 */
(function (global) {
  'use strict';

  var DEFAULT_ENDPOINT = '/api/interrogate';

  // 注入一次样式,保证模块自包含
  if (!document.getElementById('interrogator-style')) {
    var st = document.createElement('style');
    st.id = 'interrogator-style';
    st.textContent =
      '.interrogator-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;' +
      'border:1px solid rgba(0,0,0,.15);border-radius:8px;background:#fff;color:#1e293b;' +
      'font-size:13px;cursor:pointer;line-height:1;}' +
      '.interrogator-btn:hover{background:#f1f5f9;}' +
      '.interrogator-btn:disabled{opacity:.6;cursor:default;}' +
      '.interrogator-overlay{position:fixed;inset:0;background:rgba(15,23,42,.45);' +
      'display:flex;align-items:center;justify-content:center;z-index:9999;}' +
      '.interrogator-modal{width:min(560px,92vw);background:#fff;border-radius:12px;' +
      'padding:18px;box-shadow:0 10px 40px rgba(0,0,0,.2);}' +
      '.interrogator-title{font-size:14px;font-weight:600;color:#0f172a;margin-bottom:10px;}' +
      '.interrogator-text{width:100%;height:180px;resize:vertical;border:1px solid rgba(0,0,0,.15);' +
      'border-radius:8px;padding:10px;font-size:13px;line-height:1.6;color:#1e293b;box-sizing:border-box;}' +
      '.interrogator-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;}' +
      '.interrogator-actions button{padding:6px 14px;border-radius:8px;border:1px solid rgba(0,0,0,.15);' +
      'background:#fff;color:#1e293b;font-size:13px;cursor:pointer;}' +
      '.interrogator-actions .it-replace{background:#2563eb;color:#fff;border-color:#2563eb;}' +
      '.interrogator-actions button:hover{filter:brightness(.97);}';
    document.head.appendChild(st);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function Interrogator(opts) {
    opts = opts || {};
    this.endpoint = opts.endpoint || DEFAULT_ENDPOINT;
    this.onSubmit = opts.onSubmit || null; // 可选:自定义提交逻辑
  }

  // file: File 对象; opts: { mode, targetStyle, provider }
  Interrogator.prototype.reverse = function (file, opts) {
    opts = opts || {};
    if (this.onSubmit) return this.onSubmit(file, opts);
    var self = this;
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append('file', file);
      if (opts.mode) fd.append('mode', opts.mode);
      if (opts.targetStyle) fd.append('target_style', opts.targetStyle);
      if (opts.provider) fd.append('provider', opts.provider);
      fetch(self.endpoint, { method: 'POST', body: fd })
        .then(function (res) {
          if (!res.ok) {
            return res.json().then(function (j) {
              throw new Error(j.detail || ('HTTP ' + res.status));
            }, function () { throw new Error('HTTP ' + res.status); });
          }
          return res.json();
        })
        .then(resolve)
        .catch(reject);
    });
  };

  // 在 container 内挂载"反推提示词"按钮 + 文件选择 + 结果弹窗
  // options: { label, mode, targetStyle, provider, resolve()=>{mode,targetStyle}, onApply(text, applyMode, result) }
  Interrogator.prototype.mountButton = function (container, options) {
    options = options || {};
    var self = this;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'interrogator-btn';
    btn.textContent = options.label || '反推提示词';

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    btn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      var resolved = (typeof options.resolve === 'function') ? options.resolve() : {};
      var runOpts = {
        mode: resolved.mode || options.mode || 'caption',
        targetStyle: resolved.targetStyle || options.targetStyle || '',
        provider: options.provider || 'auto',
      };
      btn.disabled = true;
      var old = btn.textContent;
      btn.textContent = '反推中…';
      self.reverse(file, runOpts)
        .then(function (result) { self._showResult(result, options); })
        .catch(function (e) { alert('反推失败: ' + e.message); })
        .then(function () { btn.disabled = false; btn.textContent = old; });
    });

    container.appendChild(btn);
    container.appendChild(fileInput);
    return btn;
  };

  Interrogator.prototype._showResult = function (result, options) {
    var text = (result && result.text) || '';
    var overlay = document.createElement('div');
    overlay.className = 'interrogator-overlay';
    var box = document.createElement('div');
    box.className = 'interrogator-modal';
    box.innerHTML =
      '<div class="interrogator-title">反推结果' + (result && result.format ? ' (' + escapeHtml(result.format) + ')' : '') + '</div>' +
      '<textarea class="interrogator-text" readonly>' + escapeHtml(text) + '</textarea>' +
      '<div class="interrogator-actions">' +
      '<button class="it-replace">替换</button>' +
      '<button class="it-append">追加</button>' +
      '<button class="it-copy">复制</button>' +
      '<button class="it-cancel">取消</button>' +
      '</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    var close = function () { overlay.remove(); };
    box.querySelector('.it-cancel').onclick = close;
    overlay.onclick = function (e) { if (e.target === overlay) close(); };
    box.querySelector('.it-copy').onclick = function () {
      if (navigator.clipboard) navigator.clipboard.writeText(text);
    };
    box.querySelector('.it-replace').onclick = function () {
      if (typeof options.onApply === 'function') options.onApply(text, 'replace', result);
      close();
    };
    box.querySelector('.it-append').onclick = function () {
      if (typeof options.onApply === 'function') options.onApply(text, 'append', result);
      close();
    };
  };

  global.Interrogator = Interrogator;
})(window);
