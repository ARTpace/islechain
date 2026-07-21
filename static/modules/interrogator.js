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

  // 注入一次样式:玻璃感 + 浅/深色双适配 + 紧凑按钮组
  if (!document.getElementById('interrogator-style')) {
    var st = document.createElement('style');
    st.id = 'interrogator-style';
    st.textContent =
      // 触发按钮(独立使用时)
      '.interrogator-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;' +
      'border:1px solid rgba(0,0,0,.12);border-radius:8px;background:rgba(255,255,255,.6);color:#1e293b;' +
      'font-size:13px;cursor:pointer;line-height:1;transition:all .15s;}' +
      '.interrogator-btn:hover{background:rgba(255,255,255,.9);}' +
      '.interrogator-btn:disabled{opacity:.6;cursor:default;}' +
      'body.studio-theme-dark .interrogator-btn{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.12);color:#e0e7ef;}' +
      'body.studio-theme-dark .interrogator-btn:hover{background:rgba(255,255,255,.08);}' +
      // 玻璃遮罩
      '.interrogator-overlay{position:fixed;inset:0;background:rgba(15,23,42,.35);' +
      'display:flex;align-items:center;justify-content:center;z-index:10000;' +
      '-webkit-backdrop-filter:blur(10px) saturate(140%);backdrop-filter:blur(10px) saturate(140%);' +
      'animation:igFadeIn .18s ease;}' +
      '@keyframes igFadeIn{from{opacity:0}to{opacity:1}}' +
      '@keyframes igSlideIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}' +
      // 模态:磨砂玻璃卡片
      '.interrogator-modal{width:min(520px,92vw);background:rgba(255,255,255,.82);color:#1e293b;' +
      'border:1px solid rgba(255,255,255,.6);border-radius:16px;padding:18px 20px 16px;' +
      'box-shadow:0 20px 60px rgba(15,23,42,.18),0 0 0 1px rgba(15,23,42,.04);' +
      '-webkit-backdrop-filter:blur(20px) saturate(160%);backdrop-filter:blur(20px) saturate(160%);' +
      'animation:igSlideIn .2s cubic-bezier(.2,.7,.3,1);}' +
      'body.studio-theme-dark .interrogator-modal{background:rgba(22,32,48,.72);color:#e0e7ef;' +
      'border:1px solid rgba(240,255,255,.08);' +
      'box-shadow:0 20px 60px rgba(0,0,0,.5),0 0 0 1px rgba(0,240,255,.05);}' +
      // 头部
      '.interrogator-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}' +
      '.interrogator-title{font-size:14px;font-weight:800;letter-spacing:.02em;}' +
      '.interrogator-close{width:28px;height:28px;border:none;border-radius:8px;background:transparent;' +
      'color:#6a7a8a;cursor:pointer;display:flex;align-items:center;justify-content:center;}' +
      '.interrogator-close:hover{background:rgba(0,0,0,.06);color:#000;}' +
      'body.studio-theme-dark .interrogator-close{color:#9aa8b8;}' +
      'body.studio-theme-dark .interrogator-close:hover{background:rgba(255,255,255,.08);color:#fff;}' +
      // meta 行
      '.interrogator-meta{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:10px;color:#8a9bb0;}' +
      '.interrogator-meta-tag{padding:2px 8px;border-radius:10px;background:rgba(0,180,216,.1);color:#0077b6;font-weight:700;}' +
      'body.studio-theme-dark .interrogator-meta-tag{background:rgba(0,240,255,.12);color:#00f0ff;}' +
      // 文本区
      '.interrogator-text{width:100%;height:180px;resize:vertical;border:1px solid rgba(0,0,0,.08);' +
      'border-radius:8px;padding:10px;font-size:12px;line-height:1.6;color:#1e293b;box-sizing:border-box;' +
      'background:rgba(255,255,255,.6);outline:none;}' +
      '.interrogator-text:focus{border-color:rgba(0,180,216,.4);}' +
      'body.studio-theme-dark .interrogator-text{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.08);color:#e0e7ef;}' +
      // 操作区
      '.interrogator-actions{display:flex;gap:6px;margin-top:12px;}' +
      '.interrogator-actions .ig-btn{padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s;}' +
      '.interrogator-actions .ig-primary{flex:1;border:none;background:linear-gradient(135deg,#00b4d8,#0077b6);color:#fff;}' +
      '.interrogator-actions .ig-primary:hover{filter:brightness(1.08);}' +
      '.interrogator-actions .ig-secondary{flex:1;border:1px solid rgba(0,0,0,.1);background:rgba(255,255,255,.4);color:#4a5a6a;}' +
      '.interrogator-actions .ig-secondary:hover{background:rgba(255,255,255,.7);}' +
      '.interrogator-actions .ig-ghost{padding:8px 10px;border:none;background:transparent;color:#6a7a8a;font-size:12px;font-weight:600;cursor:pointer;}' +
      '.interrogator-actions .ig-ghost:hover{color:#1e293b;}' +
      'body.studio-theme-dark .interrogator-actions .ig-secondary{background:transparent;border-color:rgba(255,255,255,.12);color:#9aa8b8;}' +
      'body.studio-theme-dark .interrogator-actions .ig-secondary:hover{background:rgba(255,255,255,.06);color:#fff;}' +
      'body.studio-theme-dark .interrogator-actions .ig-ghost{color:#8a9bb0;}' +
      'body.studio-theme-dark .interrogator-actions .ig-ghost:hover{color:#fff;}' +
      '.interrogator-copy.copied .ig-ghost{color:#10b981;}';
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
      if (opts.visionProviderId) fd.append('vision_provider_id', opts.visionProviderId);
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
    var fmt = (result && result.format) || '';
    var prov = (result && result.provider) || '';
    var overlay = document.createElement('div');
    overlay.className = 'interrogator-overlay';
    var box = document.createElement('div');
    box.className = 'interrogator-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', '反推结果');
    box.innerHTML =
      '<div class="interrogator-header">' +
        '<div class="interrogator-title">反推结果</div>' +
        '<button class="interrogator-close" aria-label="关闭">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="interrogator-meta">' +
        (fmt ? '<span class="interrogator-meta-tag">' + escapeHtml(fmt) + '</span>' : '') +
        (prov ? '<span>' + escapeHtml(prov) + '</span>' : '') +
      '</div>' +
      '<textarea class="interrogator-text" readonly>' + escapeHtml(text) + '</textarea>' +
      '<div class="interrogator-actions">' +
        '<button class="ig-btn ig-primary ig-replace">替换到提示词</button>' +
        '<button class="ig-btn ig-secondary ig-append">追加</button>' +
        '<span class="interrogator-copy">' +
          '<button class="ig-btn ig-ghost ig-copy" title="复制到剪贴板">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
            '复制' +
          '</button>' +
        '</span>' +
      '</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    var close = function () { overlay.remove(); };
    var onEsc = function (e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); } };
    document.addEventListener('keydown', onEsc);
    box.querySelector('.interrogator-close').onclick = close;
    overlay.onclick = function (e) { if (e.target === overlay) { close(); document.removeEventListener('keydown', onEsc); } };
    box.querySelector('.ig-copy').onclick = function () {
      var btn = box.querySelector('.ig-copy');
      var wrap = box.querySelector('.interrogator-copy');
      var done = function () {
        if (wrap) { wrap.classList.add('copied'); setTimeout(function(){ wrap.classList.remove('copied'); }, 1200); }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = box.querySelector('.interrogator-text');
        if (ta) { ta.removeAttribute('readonly'); ta.select(); try { document.execCommand('copy'); } catch (_) {} ta.setAttribute('readonly', 'readonly'); }
        done();
      }
    };
    box.querySelector('.ig-replace').onclick = function () {
      if (typeof options.onApply === 'function') options.onApply(text, 'replace', result);
      close();
      document.removeEventListener('keydown', onEsc);
    };
    box.querySelector('.ig-append').onclick = function () {
      if (typeof options.onApply === 'function') options.onApply(text, 'append', result);
      close();
      document.removeEventListener('keydown', onEsc);
    };
  };

  global.Interrogator = Interrogator;
})(window);
