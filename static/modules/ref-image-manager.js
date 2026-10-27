/*
 * 参考图管理器 (RefImageManager)
 * ------------------------------------------------------------
 * 可复用的"图片上传 + 缩略图预览 + 反推提示词 + 删除"功能模块。
 * 不耦合任何具体业务逻辑,通过 options 回调与宿主交互。
 *
 * 用法:
 *   new RefImageManager('#refImagePreview', {
 *     inputId: 'refImageInput',
 *     onReverseApply: function(text, mode) { /* 回填提示词 *\/ },
 *     getReverseOptions: function() { return {mode:'tags', targetStyle:'', provider:'auto'}; },
 *     onChange: function(count) { /* 更新按钮高亮等 *\/ }
 *   });
 *
 * 依赖: interrogator.js (window.Interrogator)
 */
(function (global) {
  'use strict';

  // ── 注入一次样式 ──
  if (!document.getElementById('ref-img-mgr-style')) {
    var st = document.createElement('style');
    st.id = 'ref-img-mgr-style';
    st.textContent =
      // ── 缩略图 80x80 基础样式（更大） ──
      '.ref-thumb{width:80px;height:80px;border-radius:10px;' +
      'border:1px solid rgba(128,128,128,0.3);background:#1f1f1d;flex-shrink:0;cursor:pointer;' +
      'position:relative;transition:border-color 0.18s,box-shadow 0.18s;}' +
      // ref-thumb 自身不裁切(避免遮罩 loading 气泡);只对内部 img 裁切
      '.ref-thumb img{border-radius:9px;}' +
      '.ref-thumb:hover{border-color:rgba(6, 182, 212, 0.7);box-shadow:0 4px 12px rgba(0,0,0,0.4);}' +
      // is-loading 时 ref-thumb 持续显示操作条(避免鼠标移走导致操作条消失,用户看不到进度)
      '.ref-thumb.is-loading{border-color:rgba(6, 182, 212, 0.7);box-shadow:0 4px 12px rgba(0,0,0,0.4);}' +
      '.ref-thumb.is-loading .ref-action-bar{opacity:1;transform:translateY(0);pointer-events:auto;}' +
      '.ref-thumb img{width:100%;height:100%;object-fit:cover;pointer-events:none;display:block;}' +
      // ── 堆叠容器（固定 108x108px，padding 6px 容纳操作条溢出） ──
      '.ref-stack{position:relative;flex-shrink:0;display:inline-block;width:108px;height:108px;}' +
      '.ref-stack .ref-thumb-stack{position:absolute;left:6px;top:6px;transition:border-color 0.18s,box-shadow 0.18s;}' +
      // N 张图按索引错位堆叠（5px 一格，紧凑；最大 4 张图 + 第 5 张同位）
      '.ref-stack .ref-thumb-stack:nth-child(1){z-index:10;}' +
      '.ref-stack .ref-thumb-stack:nth-child(2){transform:translate(5px,5px);z-index:9;}' +
      '.ref-stack .ref-thumb-stack:nth-child(3){transform:translate(10px,10px);z-index:8;}' +
      '.ref-stack .ref-thumb-stack:nth-child(4){transform:translate(15px,15px);z-index:7;}' +
      '.ref-stack .ref-thumb-stack:nth-child(5){transform:translate(15px,15px);z-index:6;}' +
      '.ref-stack .ref-thumb-stack:nth-child(n+6){transform:translate(15px,15px);z-index:5;}' +
      // hover 仅高亮边框和加阴影，不改变位置
      '.ref-stack .ref-thumb-stack:hover{box-shadow:0 4px 12px rgba(0,0,0,0.5);}' +
      // ── 底部操作条（仅图标） ──
      '.ref-action-bar{position:absolute;left:0;right:0;bottom:0;height:22px;' +
      'display:flex;background:linear-gradient(to top,rgba(0,0,0,0.78),rgba(0,0,0,0));' +
      'opacity:0;transform:translateY(4px);transition:opacity 0.18s,transform 0.18s;' +
      'pointer-events:none;z-index:3;border-radius:0 0 7px 7px;}' +
      '.ref-thumb:hover .ref-action-bar,.ref-thumb.is-active .ref-action-bar{opacity:1;transform:translateY(0);pointer-events:auto;}' +
      '.ref-act{flex:1;display:flex;align-items:center;justify-content:center;' +
      'color:#fcfcfb;background:transparent;border:none;cursor:pointer;padding:0;' +
      'transition:background 0.12s;height:100%;}' +
      '.ref-act:hover{background:rgba(255,255,255,0.18);}' +
      '.ref-act:active{background:rgba(255,255,255,0.32);}' +
      '.ref-act-del:hover{background:rgba(239,68,68,0.75)!important;}' +
      '.ref-act-rev:hover{background:rgba(6, 182, 212, 0.75)!important;}' +
      '.ref-act svg{width:13px;height:13px;stroke-width:2;}' +
      // ── 反推 loading 状态：spinner + 阶段文字(浮在缩略图上方,不挡 SVG) ──
      // ref-act 在缩略图底部(操作条内),气泡基于 ref-thumb 定位
      '.ref-thumb > .ref-btn-loading{position:absolute;left:50%;top:-6px;transform:translate(-50%,-100%);' +
      'display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;' +
      'color:#fcfcfb;background:rgba(6, 182, 212, 0.95);padding:3px 8px;border-radius:10px;' +
      'white-space:nowrap;pointer-events:none;z-index:20;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.4);animation:refBtnLoadingSlide 0.3s ease;}' +
      '.ref-btn-loading::after{content:"";display:inline-block;width:8px;height:8px;' +
      'border:1.5px solid #fcfcfb;border-top-color:transparent;border-radius:50%;' +
      'animation:refBtnLoadingSpin 0.8s linear infinite;}' +
      '.ref-btn-loading.is-done{background:rgba(34,197,94,0.95);}' +
      '.ref-btn-loading.is-done::after{display:none;}' +
      '.ref-btn-loading.is-error{background:rgba(239,68,68,0.95);}' +
      '.ref-btn-loading.is-error::after{display:none;}' +
      '@keyframes refBtnLoadingSlide{from{opacity:0;transform:translateX(-50%) translateY(4px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}' +
      '@keyframes refBtnLoadingSpin{to{transform:rotate(360deg);}}' +
      // ── 全屏顶部进度条(更醒目的反推反馈) ──
      '.ref-top-progress{position:fixed;top:0;left:0;right:0;height:3px;background:transparent;z-index:99999;pointer-events:none;}' +
      '.ref-top-progress-bar{height:100%;width:0;background:linear-gradient(90deg,rgba(6, 182, 212, 0.8),rgba(6, 182, 212, 1));' +
      'box-shadow:0 0 10px rgba(6, 182, 212, 0.5);transition:width 0.4s ease;}' +
      '.ref-top-progress.is-done .ref-top-progress-bar{background:rgba(34,197,94,0.9);}' +
      '.ref-top-progress.is-error .ref-top-progress-bar{background:rgba(239,68,68,0.9);}' +
      // ── 二次确认 armed 状态：按钮变红 + 轻微脉冲动画 ──
      '.ref-act-clear.is-armed{background:rgba(239,68,68,0.85)!important;color:#fcfcfb;animation:refArmPulse 0.6s ease-in-out infinite;}' +
      '.ref-act-clear.is-armed svg{stroke-width:2.5;}' +
      '@keyframes refArmPulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(239,68,68,0.4);}50%{transform:scale(1.08);box-shadow:0 0 0 6px rgba(239,68,68,0);}}' +
      // 长按弹出菜单（移动端）
      '.ref-context-menu{position:fixed;z-index:99999;min-width:140px;background:rgba(21, 21, 21, 0.96);' +
      'backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.1);border-radius:10px;' +
      'box-shadow:0 8px 32px rgba(0,0,0,0.5);padding:4px;display:none;}' +
      '.ref-context-menu.show{display:block;}' +
      '.ref-context-item{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;' +
      'border:none;background:transparent;color:#fcfcfb;font-size:12px;border-radius:6px;cursor:pointer;text-align:left;}' +
      '.ref-context-item:hover{background:rgba(255,255,255,0.1);}' +
      '.ref-context-item.del{color:#ef4444;}' +
      '.ref-context-item svg{width:14px;height:14px;stroke-width:2;}' +
      // 提示词框内的参考图 chip（直接嵌入 contenteditable 提示词框）
      '.ref-chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 5px 0 3px;' +
      'background:transparent;border:1px solid rgba(128,128,128,0.3);border-radius:5px;' +
      'margin:0 2px;vertical-align:middle;cursor:pointer;user-select:none;position:relative;transition:all 0.15s;' +
      'font-size:13px;line-height:1;color:inherit;font-weight:500;}' +
      '.ref-chip:hover{background:rgba(6, 182, 212, 0.12);border-color:rgba(6, 182, 212, 0.6);}' +
      '.ref-chip:hover .ref-chip-x{opacity:1;}' +
      '.ref-chip-thumb{width:18px;height:18px;border-radius:3px;object-fit:cover;display:block;flex-shrink:0;}' +
      '.ref-chip .ref-chip-x{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;' +
      'border:none;background:transparent;color:inherit;opacity:0.4;cursor:pointer;border-radius:50%;padding:0;transition:all 0.12s;flex-shrink:0;}' +
      '.ref-chip .ref-chip-x:hover{background:rgba(239,68,68,0.9);color:#fcfcfb;opacity:1;}' +
      '.ref-chip .ref-chip-x svg{width:9px;height:9px;stroke-width:2.5;}' +
      // ── chip 大图 hover preview（fixed 定位 + 智能翻转避免被裁切） ──
      '.ref-chip-preview{position:fixed;width:200px;padding:8px;background:rgba(18, 18, 18, 0.97);' +
      'border:1px solid rgba(255,255,255,0.15);border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,0.7);' +
      'opacity:0;pointer-events:none;transition:opacity 0.18s;z-index:99999;}' +
      '.ref-chip-preview img{width:100%;height:auto;max-height:200px;object-fit:contain;border-radius:4px;display:block;background:#0b0b0a;}' +
      '.ref-chip-preview-name{margin-top:6px;font-size:11px;color:rgba(255,255,255,0.8);text-align:center;' +
      'word-break:break-all;line-height:1.3;max-height:2.6em;overflow:hidden;}' +
      // 深色模式
      'body.studio-theme-dark .ref-chip{border-color:rgba(255,255,255,0.25);}' +
      'body.studio-theme-dark .ref-chip:hover{background:rgba(6, 182, 212, 0.2);border-color:rgba(6, 182, 212, 0.7);}' +
      // contenteditable placeholder
      '.prompt-editable:empty::before{content:attr(data-placeholder);color:rgba(128,128,128,0.5);pointer-events:none;}' +
      // ── 占位（保留旧 API 兼容，实际不再使用） ──
      // 侧边栏容器（宽 120px 容纳 108px 堆叠 + 边距）
      '.ref-img-sidebar{width:120px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:6px;' +
      'max-height:280px;overflow-y:auto;padding:6px;}' +
      '.ref-img-sidebar::-webkit-scrollbar{width:3px;}' +
      '.ref-img-sidebar::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:2px;}';
    document.head.appendChild(st);
  }

  function RefImageManager(containerElOrId, options) {
    options = options || {};

    // 容器
    this.container = (typeof containerElOrId === 'string')
      ? document.querySelector(containerElOrId)
      : containerElOrId;
    if (!this.container) throw new Error('RefImageManager: container not found');

    // 以当前容器为 scope, 查找或创建文件 input
    var inputId = options.inputId || (this.container.id + '-input');
    this.fileInput = document.getElementById(inputId);
    if (!this.fileInput) {
      this.fileInput = document.createElement('input');
      this.fileInput.type = 'file';
      this.fileInput.accept = 'image/*';
      this.fileInput.multiple = true;
      this.fileInput.style.display = 'none';
      this.fileInput.id = inputId;
      this.container.parentNode.insertBefore(this.fileInput, this.container.nextSibling);
    }

    // 状态
    this._images = []; // { file, url, name }
    this._ig = null;

    // 回调
    this._onReverseApply = options.onReverseApply || null;
    this._getReverseOptions = options.getReverseOptions || null;
    this._onChange = options.onChange || null;

    // 绑定事件
    var self = this;
    this.fileInput.addEventListener('change', function () {
      self._handleFiles(Array.from(this.files));
      this.value = '';
    });

    // ── 剪贴板粘贴 ──
    document.addEventListener('paste', function (e) {
      // 找出事件实际发生的元素（兼容 focus 在 body 时的处理）
      var ae = document.activeElement;
      var tag = ae && ae.tagName;

      // 仅当焦点在提示词输入框时才接管粘贴
      var isPromptInput = ae && (ae.id === 'prompt' || ae.id === 'negativePrompt' || (ae.classList && ae.classList.contains('prompt-textarea')));
      if (!isPromptInput) return;
      if (e.__refPasteHandled) return;

      // 避免处理已经由输入框处理的纯文本粘贴
      var items = (e.clipboardData || window.clipboardData) && (e.clipboardData || window.clipboardData).items;
      if (!items) return;
      var hasImage = false;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) { hasImage = true; break; }
      }
      if (!hasImage) return;
      e.__refPasteHandled = true;

      e.preventDefault();
      var files = [];
      for (var j = 0; j < items.length; j++) {
        if (items[j].type && items[j].type.indexOf('image/') === 0) {
          var file = items[j].getAsFile();
          if (file) {
            var ext = (file.type.split('/')[1] || 'png').replace(/[^a-zA-Z0-9]/g, '');
            files.push(new File([file], 'clipboard_' + Date.now() + '.' + ext, { type: file.type }));
          }
        }
      }
      if (files.length > 0) self._handleFiles(files);
    });

    // ── 拖拽上传 ──
    var _dragCounter = 0;
    this.container.addEventListener('dragenter', function (e) {
      e.preventDefault();
      e.stopPropagation();
      _dragCounter++;
      if (_dragCounter === 1) self.container.classList.add('ref-mgr-dragover');
    });
    this.container.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
    });
    this.container.addEventListener('dragleave', function (e) {
      e.preventDefault();
      e.stopPropagation();
      _dragCounter--;
      if (_dragCounter <= 0) { _dragCounter = 0; self.container.classList.remove('ref-mgr-dragover'); }
    });
    this.container.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      _dragCounter = 0;
      self.container.classList.remove('ref-mgr-dragover');
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) self._handleFiles(Array.from(files));
    });

    // 已渲染的缩略图点击 → 委托
    this.container.classList.add('ref-img-mgr-wrap');
  }

  // ── 懒加载 Interrogator ──
  RefImageManager.prototype._getInterrogator = function () {
    if (!this._ig && global.Interrogator) this._ig = new Interrogator();
    return this._ig;
  };

  // ── 工具：计算文件指纹（去重） ──
  RefImageManager.prototype._fileFingerprint = function (file) {
    // 用 name + size + type 做指纹；剪贴板粘贴的图片 name 都相同，
    // 这种情况仍允许（用户可能确实想重复粘贴）—— 改用 name+size 即可
    return (file.name || '') + '|' + (file.size || 0);
  };

  // ── 处理文件 ──
  RefImageManager.prototype._handleFiles = function (files) {
    var self = this;
    var added = false;
    var skipped = 0;
    files.forEach(function (file) {
      if (!file.type.startsWith('image/')) return;
      // 去重：相同 name+size 的图片不能重复添加
      var fp = self._fileFingerprint(file);
      var dup = self._images.some(function (x) { return x.fingerprint === fp; });
      if (dup) { skipped++; return; }
      var url = URL.createObjectURL(file);
      // 给每张图分配唯一 id（避免同名冲突）
      var id = 'ref_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      self._images.push({ id: id, file: file, url: url, name: file.name, fingerprint: fp });
      added = true;
    });
    if (skipped > 0) console.log('[RefImgMgr] skipped', skipped, 'duplicates');
    if (!added) return;
    this.render();
    if (typeof this._onChange === 'function') this._onChange(this._images.length);
    document.dispatchEvent(new Event('ref-images-changed'));
  };

  // ── 上传（公开 API） ──
  RefImageManager.prototype.addFiles = function (files) {
    this._handleFiles(files ? Array.from(files) : []);
  };
  RefImageManager.prototype.getFiles = function () {
    return this._images;
  };
  RefImageManager.prototype.restoreFiles = function (items) {
    if (this._hideChipPreview) this._hideChipPreview();
    this._images.forEach(function (img) { URL.revokeObjectURL(img.url); });
    this._images = items.map(function (item) {
      return Object.assign({}, item, { url: URL.createObjectURL(item.file) });
    });
    this.render();
    if (typeof this._onChange === 'function') this._onChange(this._images.length);
    document.dispatchEvent(new Event('ref-images-changed'));
  };
  RefImageManager.prototype.getCount = function () {
    return this._images.length;
  };

  // ── id → idx 工具（避免重渲染时索引错位） ──
  RefImageManager.prototype._indexOf = function (id) {
    for (var i = 0; i < this._images.length; i++) {
      if (this._images[i].id === id) return i;
    }
    return -1;
  };
  RefImageManager.prototype._viewById = function (id) {
    var idx = this._indexOf(id);
    if (idx >= 0) this._view(idx);
  };
  RefImageManager.prototype._removeById = function (id) {
    var idx = this._indexOf(id);
    if (idx >= 0) this._remove(idx);
  };
  RefImageManager.prototype._reverseById = function (id) {
    var idx = this._indexOf(id);
    if (idx >= 0) this._reverse(idx);
  };

  // ── 激活（移到堆叠顶部） ──
  RefImageManager.prototype._activateById = function (id) {
    var idx = this._indexOf(id);
    if (idx <= 0) return; // 已在顶部或不存在
    var img = this._images[idx];
    this._images.splice(idx, 1);
    this._images.unshift(img);
    this.render();
    if (typeof this._onChange === 'function') this._onChange(this._images.length);
    document.dispatchEvent(new Event('ref-images-changed'));
  };

  // ── 清空 ──
  RefImageManager.prototype.clear = function () {
    this._images.forEach(function (img) { URL.revokeObjectURL(img.url); });
    this._images = [];
    this.render();
    if (typeof this._onChange === 'function') this._onChange(0);
    document.dispatchEvent(new Event('ref-images-changed'));
  };

  // ── 渲染缩略图 ──
  RefImageManager.prototype.render = function () {
    var self = this;
    var container = this.container;

    // 无图 → 隐藏面板 + 清空 prompt 里的残留 chip
    if (this._images.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      // 关键修复：清掉 #prompt 里残留的 chip（不调 _renderChips 因为要走简化路径）
      var promptEl0 = document.getElementById('prompt');
      if (promptEl0) {
        promptEl0.querySelectorAll('.ref-chip').forEach(function (c) { c.remove(); });
      }
      return;
    }

    container.style.display = 'flex';

    // 有图 → 渲染缩略图（底部操作条悬停时浮现）+ chip 列表 + 清除按钮
    // ── SVG 图标 ──
    var ICON_REV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
    var ICON_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
    var ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
    var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

    // ── 堆叠式缩略图（多张图片紧凑层叠展示） ──
    var thumbsStackHtml = this._images.map(function (img) {
      return '<div class="ref-thumb ref-thumb-stack" data-id="' + img.id + '">'
        + '<img src="' + img.url + '" />'
        + '<div class="ref-action-bar" data-id="' + img.id + '">'
        + '<button class="ref-act ref-act-rev" data-id="' + img.id + '" data-act="reverse" title="反推提示词">' + ICON_REV + '</button>'
        + '<button class="ref-act ref-act-clear" data-id="' + img.id + '" data-act="clear-all" title="删除全部参考图">' + ICON_TRASH + '</button>'
        + '</div>'
        + '</div>';
    }).join('');

    container.innerHTML = '<div class="ref-stack">' + thumbsStackHtml + '</div>';
    // 容器尺寸由 CSS 固定为 108x108，无需 JS 动态调整
    this._renderChips();

    // ── 事件委托 ──
    // ── 缩略图点击（放大/长按菜单） ──
    container.querySelectorAll('.ref-thumb').forEach(function (el) {
      var pressTimer = null;
      var pressStart = 0;

      // 长按检测（移动端）
      el.addEventListener('touchstart', function (e) {
        pressStart = Date.now();
        pressTimer = setTimeout(function () {
          self._showContextMenu(el, parseInt(el.dataset.idx, 10));
        }, 350);
      }, { passive: true });
      el.addEventListener('touchend', function () {
        if (pressTimer) clearTimeout(pressTimer);
      });
      el.addEventListener('touchmove', function () {
        if (pressTimer) clearTimeout(pressTimer);
      });

      // 单击放大（短按）
      el.addEventListener('click', function (e) {
        // 如果点击的是操作条内的按钮，不触发放大
        if (e.target.closest('.ref-action-bar')) return;
        // 短按（避免长按后误触发放大）
        if (Date.now() - pressStart < 350) {
          self._viewById(el.dataset.id);
        }
      });
    });

    // ── 操作条按钮（桌面 hover / 移动端点击空白处） ──
    container.querySelectorAll('.ref-act').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.dataset.id;
        var act = btn.dataset.act;
        if (act === 'remove') self._removeById(id);
        else if (act === 'reverse') self._reverseById(id);
        else if (act === 'clear-all') self._confirmClearAll(btn);
      });
    });
  };

  // ── 二次确认删除全部 ──
  // 第一次点击：按钮变红 + title 改提示，3 秒倒计时
  // 第二次点击（3 秒内）：真正清除
  // 3 秒不点：自动恢复
  RefImageManager.prototype._confirmClearAll = function (btn) {
    var self = this;
    if (btn.dataset.armed === '1') {
      // 已 armed → 第二次点击 → 真正清除
      self.clear();
      return;
    }
    // 第一次点击 → 武装
    btn.dataset.armed = '1';
    btn.classList.add('is-armed');
    btn.setAttribute('data-orig-title', btn.title);
    btn.title = '再次点击确认删除全部';
    // 3 秒后自动解除
    if (btn._armTimer) clearTimeout(btn._armTimer);
    btn._armTimer = setTimeout(function () {
      btn.dataset.armed = '';
      btn.classList.remove('is-armed');
      var orig = btn.getAttribute('data-orig-title');
      if (orig) btn.title = orig;
      btn.removeAttribute('data-orig-title');
      btn._armTimer = null;
    }, 3000);
  };

  // ── 长按弹出菜单 ──
  RefImageManager.prototype._showContextMenu = function (thumbEl, idx) {
    var self = this;
    // 移除旧菜单
    var old = document.getElementById('refContextMenu');
    if (old) old.remove();

    var menu = document.createElement('div');
    menu.id = 'refContextMenu';
    menu.className = 'ref-context-menu show';
    var ICON_VIEW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    var ICON_REV_M = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
    var ICON_DEL_M = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
    menu.innerHTML =
      '<button class="ref-context-item" data-act="view">' + ICON_VIEW + '<span>查看大图</span></button>' +
      '<button class="ref-context-item" data-act="reverse">' + ICON_REV_M + '<span>反推提示词</span></button>' +
      '<button class="ref-context-item del" data-act="remove">' + ICON_DEL_M + '<span>删除图片</span></button>';

    // 定位
    var rect = thumbEl.getBoundingClientRect();
    var menuWidth = 160;
    var left = rect.right + 8; // 默认在右侧
    if (left + menuWidth > window.innerWidth) {
      left = rect.left - menuWidth - 8; // 空间不够则放左侧
    }
    var top = rect.top;
    if (top + 120 > window.innerHeight) top = window.innerHeight - 130;
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';

    // 事件
    menu.querySelectorAll('.ref-context-item').forEach(function (it) {
      it.addEventListener('click', function (e) {
        e.stopPropagation();
        var act = it.dataset.act;
        if (act === 'view') self._view(idx);
        else if (act === 'remove') self._remove(idx);
        else if (act === 'reverse') self._reverse(idx);
        menu.remove();
      });
    });

    document.body.appendChild(menu);

    // 点击空白处关闭
    setTimeout(function () {
      function close(ev) {
        if (menu.contains(ev.target)) return;
        menu.remove();
        document.removeEventListener('click', close);
        document.removeEventListener('touchstart', close);
      }
      document.addEventListener('click', close);
      document.addEventListener('touchstart', close);
    }, 0);

    // 标记当前 thumb 为 active（让操作条保持显示）
    thumbEl.classList.add('is-active');
    setTimeout(function () { thumbEl.classList.remove('is-active'); }, 2500);
  };

  // ── 渲染 chip 列表（直接内联到 contenteditable 提示词框） ──
  RefImageManager.prototype._renderChips = function () {
    var self = this;
    if (self._hideChipPreview) self._hideChipPreview();
    if (!self._chipPreviewDismissBound) {
      self._chipPreviewDismissBound = true;
      document.addEventListener('click', function (event) {
        if (!event.target.closest('.ref-chip') || event.target.closest('.ref-chip-x')) self._hideChipPreview?.();
      }, true);
      document.addEventListener('keydown', function (event) { if (event.key === 'Escape') self._hideChipPreview?.(); });
      window.addEventListener('resize', function () { self._hideChipPreview?.(); });
      window.addEventListener('scroll', function () { self._hideChipPreview?.(); }, true);
    }
    var promptEl = document.getElementById('prompt');
    if (!promptEl || !promptEl.isContentEditable) {
      // 兼容旧版：若还是 textarea，则使用独立的 chip bar
      this._renderChipsLegacy();
      return;
    }

    var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

    // 1) 移除不再存在的 chip（按 id 匹配）
    var currentIds = {};
    this._images.forEach(function (img) { currentIds[img.id] = true; });
    var chips = Array.prototype.slice.call(promptEl.querySelectorAll('.ref-chip'));
    chips.forEach(function (chip) {
      if (!currentIds[chip.getAttribute('data-id')]) chip.remove();
    });

    // 2) 按 this._images 顺序插入/重排 chip
    //    策略：把光标移到 prompt 末尾，先 append 所有缺失的 chip 到末尾
    var lastChip = null;
    this._images.forEach(function (img, i) {
      // 用"图1/图2/图3"作为显示名
      var label = '图' + (i + 1);

      // 查找已存在的同 id chip
      var chip = promptEl.querySelector('.ref-chip[data-id="' + img.id + '"]');
      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'ref-chip';
        chip.setAttribute('data-id', img.id);
        chip.setAttribute('data-name', img.name);
        chip.setAttribute('data-idx', i);
        chip.setAttribute('contenteditable', 'false');
        // 大图 hover preview
        var previewHtml = '<div class="ref-chip-preview">'
          + '<img src="' + img.url + '" />'
          + '<div class="ref-chip-preview-name">' + img.name.replace(/</g, '&lt;') + '</div>'
          + '</div>';
        chip.innerHTML = previewHtml
          + '<img class="ref-chip-thumb" src="' + img.url + '" />'
          + '<span class="ref-chip-name">' + label + '</span>'
          + '<button class="ref-chip-x" type="button" data-id="' + img.id + '" title="删除" aria-label="删除">' + ICON_X + '</button>';
        // 插入到 prompt 末尾（不抢用户当前光标）
        promptEl.appendChild(chip);
        // 加个空格分隔（让 chip 后面能继续输入文字）
        promptEl.appendChild(document.createTextNode(' '));

        // ── 智能定位 preview（fixed + 屏幕空间自适应） ──
        var preview = chip.querySelector('.ref-chip-preview');
        if (preview) {
          var pinned = false;
          function hidePreview() {
            pinned = false;
            preview.style.opacity = '0';
            preview.style.visibility = 'hidden';
            chip.appendChild(preview);
            if (self._hideChipPreview === hidePreview) self._hideChipPreview = null;
          }
          function positionPreview() {
            var rect = chip.getBoundingClientRect();
            var pw = Math.min(240, window.innerWidth - 24);
            preview.style.width = pw + 'px';
            preview.style.maxHeight = Math.max(60, rect.top - 20) + 'px';
            preview.style.overflow = 'auto';
            preview.style.top = Math.max(8, rect.top - preview.offsetHeight - 10) + 'px';
            preview.style.left = Math.max(12, Math.min(rect.left + rect.width / 2 - pw / 2, window.innerWidth - pw - 12)) + 'px';
          }
          function showPreview() {
            if (self._hideChipPreview && self._hideChipPreview !== hidePreview) self._hideChipPreview();
            self._hideChipPreview = hidePreview;
            document.body.appendChild(preview);
            preview.style.opacity = '1';
            preview.style.visibility = 'visible';
            positionPreview();
          }
          preview.querySelector('img').addEventListener('load', function () {
            if (self._hideChipPreview === hidePreview) positionPreview();
          });
          chip.addEventListener('mouseenter', showPreview);
          chip.addEventListener('mouseleave', function () { if (!pinned) hidePreview(); });
          chip._togglePreview = function () {
            if (pinned) hidePreview();
            else { pinned = true; showPreview(); }
          };
        }
      } else {
        // 已存在：更新标签和大图（位置可能因 _images 重排而变）
        var nameEl = chip.querySelector('.ref-chip-name');
        if (nameEl) nameEl.textContent = label;
        chip.setAttribute('data-idx', i);
        var previewImg = chip.querySelector('.ref-chip-preview img');
        if (previewImg) previewImg.src = img.url;
        var previewName = chip.querySelector('.ref-chip-preview-name');
        if (previewName) previewName.textContent = img.name;
        var thumbImg = chip.querySelector('.ref-chip-thumb');
        if (thumbImg) thumbImg.src = img.url;
      }
      lastChip = chip;
    });

    // 4) chip 点击 → 把对应图片显示在侧边栏堆叠的最顶部
    if (!promptEl._refChipActivateHandler) {
      promptEl._refChipActivateHandler = function (e) {
        // 只处理 chip 本身或缩略图点击（不处理 ✕ 按钮，那个有专门 handler）
        if (e.target.closest('.ref-chip-x')) return;
        var chip = e.target.closest('.ref-chip');
        if (!chip) return;
        e.preventDefault();
        e.stopPropagation();
        if (document.body.classList.contains('chat-layout') && chip._togglePreview) { chip._togglePreview(); return; }
        var id = chip.getAttribute('data-id');
        if (id && self._activateById) self._activateById(id);
      };
      // 监听 click，但要保证 ✕ 按钮先处理
      promptEl.addEventListener('click', promptEl._refChipActivateHandler);
    }

    // 3) 绑定删除事件（用事件委托）
    if (!promptEl._refChipHandler) {
      promptEl._refChipHandler = function (e) {
        var xBtn = e.target.closest('.ref-chip-x');
        if (!xBtn) return;
        e.preventDefault();
        e.stopPropagation();
        var id = xBtn.getAttribute('data-id');
        if (!id) return;
        // 在 _images 里找到该 id 的索引
        var idx = -1;
        for (var i = 0; i < self._images.length; i++) {
          if (self._images[i].id === id) { idx = i; break; }
        }
        if (idx >= 0) self._remove(idx);
      };
      promptEl.addEventListener('click', promptEl._refChipHandler);
    }

    // 3.5) 绑定键盘事件:Backspace / Delete 在 ref-chip 旁边/上面时,交给我们处理
    //      （避免浏览器原生删除 chip DOM 但 _images 不同步,导致左侧 ref-stack 还在）
    if (!promptEl._refChipKeydownHandler) {
      promptEl._refChipKeydownHandler = function (e) {
        if (e.key !== 'Backspace' && e.key !== 'Delete') return;
        var sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        var node = sel.anchorNode;
        if (!node) return;
        var offset = sel.anchorOffset;
        var targetChip = null;

        // === Backspace:删前一个兄弟(光标在文本节点最前/头部,前兄弟是 chip) ===
        if (e.key === 'Backspace') {
          // a) 光标直接在 chip 内(防御)
          if (node.nodeType === 1 && node.classList && node.classList.contains('ref-chip')) {
            targetChip = node;
          } else if (node.nodeType === 3) {
            // 文本节点:offset=0 时,前一个字符是 prevSibling
            if (offset === 0) {
              var prev = node.previousSibling;
              if (prev && prev.nodeType === 1 && prev.classList && prev.classList.contains('ref-chip')) {
                targetChip = prev;
              }
            }
          }
        }
        // === Delete:删后一个兄弟(光标在文本节点最末/尾部,后兄弟是 chip) ===
        else if (e.key === 'Delete') {
          if (node.nodeType === 1 && node.classList && node.classList.contains('ref-chip')) {
            targetChip = node;
          } else if (node.nodeType === 3) {
            // 文本节点:offset === length 时,后一个字符是 nextSibling
            var len = node.textContent ? node.textContent.length : 0;
            if (offset >= len) {
              var next = node.nextSibling;
              if (next && next.nodeType === 1 && next.classList && next.classList.contains('ref-chip')) {
                targetChip = next;
              }
            }
          }
        }

        if (!targetChip) return;
        var id = targetChip.getAttribute('data-id');
        if (!id) return;
        // 阻止浏览器原生删除
        e.preventDefault();
        e.stopPropagation();
        var idx = -1;
        for (var i = 0; i < self._images.length; i++) {
          if (self._images[i].id === id) { idx = i; break; }
        }
        if (idx >= 0) {
          self._remove(idx);
        } else {
          // _images 已被外部清掉(例如按了清理提示词),仅清 DOM
          targetChip.remove();
        }
      };
      promptEl.addEventListener('keydown', promptEl._refChipKeydownHandler);
    }
  };

  // 兼容旧版：textarea 上方独立 chip bar（当 prompt 不是 contenteditable 时）
  RefImageManager.prototype._renderChipsLegacy = function () {
    var self = this;
    var promptEl = document.getElementById('prompt');
    if (!promptEl) return;
    var bar = document.getElementById('refChipBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'refChipBar';
      bar.className = 'ref-chip-bar';
      promptEl.parentNode.insertBefore(bar, promptEl);
    }
    if (this._images.length === 0) { bar.innerHTML = ''; return; }
    var ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    bar.innerHTML = this._images.map(function (img, index) {
      var display = (img.name || 'image').replace(/\.[^.]+$/, '');
      if (display.length > 16) display = display.slice(0, 16) + '…';
      return '<span class="ref-chip" data-id="' + img.id + '" data-name="' + img.name.replace(/"/g, '&quot;') + '">'
        + '<img src="' + img.url + '" />'
        + '<span class="ref-chip-name">图 ' + (index + 1) + ' · ' + display.replace(/</g, '&lt;') + '</span>'
        + '<button class="ref-chip-x" type="button" data-id="' + img.id + '">' + ICON_X + '</button>'
        + '</span>';
    }).join('');
    bar.onclick = function (e) {
      var xBtn = e.target.closest('.ref-chip-x');
      if (!xBtn) return;
      var id = xBtn.getAttribute('data-id');
      if (!id) return;
      var idx = -1;
      for (var i = 0; i < self._images.length; i++) {
        if (self._images[i].id === id) { idx = i; break; }
      }
      if (idx >= 0) self._remove(idx);
    };
  };

  // 挂载占位（兼容层已处理）— 保留函数以免旧调用报错
  RefImageManager.prototype._mountChipBar = function (bar, promptEl) { /* no-op */ };
  RefImageManager.prototype._bindChipEvents = function (bar) { /* no-op */ };

  // ── 放大查看 ──
  RefImageManager.prototype._view = function (index) {
    var img = this._images[index];
    if (!img) return;
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(8px);';
    overlay.innerHTML = '<img src="' + img.url + '" style="max-width:90vw;max-height:90vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.5);" />'
      + '<div style="position:absolute;top:16px;right:20px;color:#fcfcfb;font-size:28px;cursor:pointer;width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,0.1);transition:background 0.2s;" onmouseenter="this.style.background=\'rgba(255,255,255,0.2)\'" onmouseleave="this.style.background=\'rgba(255,255,255,0.1)\'">&times;</div>'
      + '<div style="position:absolute;bottom:20px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.6);font-size:12px;">' + img.name.replace(/"/g, '&quot;') + '</div>';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.tagName === 'IMG') overlay.remove();
    });
    overlay.querySelector('div:first-of-type')?.addEventListener('click', function () { overlay.remove(); });
    document.body.appendChild(overlay);
  };
  RefImageManager.prototype.view = function (index) {
    this._view(index);
  };

  // ── 删除单张 ──
  RefImageManager.prototype._remove = function (index) {
    var self = this;
    if (this._images[index]) {
      URL.revokeObjectURL(this._images[index].url);
      this._images.splice(index, 1);
      this.render();
      if (typeof this._onChange === 'function') this._onChange(this._images.length);
      document.dispatchEvent(new Event('ref-images-changed'));
    }
  };
  RefImageManager.prototype.remove = function (index) {
    this._remove(index);
  };

  // ── 反推提示词 ──
  RefImageManager.prototype._reverse = function (index) {
    var self = this;
    var img = this._images[index];
    if (!img || !img.file) return;
    var ig = this._getInterrogator();
    if (!ig) return;

    // 获取反推参数
    var revOpts = (typeof this._getReverseOptions === 'function')
      ? this._getReverseOptions() : { mode: 'caption', targetStyle: '', provider: 'auto' };

    var btn = this.container.querySelector('.ref-rev-btn[data-idx="' + index + '"]');
    // 阶段提示:不同阶段用不同文字, 增强用户感知
    // 反推完整流程: 上传(~1s) + 提交(1-2s) + 模型加载(10-30s) + 推理(60-120s)
    var STAGES = [
      { at: 0,     label: '上传中…', pct: 5 },
      { at: 2000,  label: '提交任务…', pct: 10 },
      { at: 5000,  label: '加载模型…', pct: 30 },
      { at: 20000, label: '分析图像…', pct: 60 },
      { at: 60000, label: '生成中…', pct: 80 }
    ];
    var startTime = Date.now();

    // 全屏顶部进度条(强烈视觉反馈,用户一眼能看到反推在进行)
    var topProgress = document.createElement('div');
    topProgress.className = 'ref-top-progress';
    var topBar = document.createElement('div');
    topBar.className = 'ref-top-progress-bar';
    topProgress.appendChild(topBar);
    document.body.appendChild(topProgress);
    // 强制 reflow 后再设置 width 才能触发动画
    void topBar.offsetWidth;
    topBar.style.width = '5%';

    var stageEl = null;
    var thumb = null;
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-loading');
      // 找到最近的外层 ref-thumb 容器,loading 气泡加到这里(浮在缩略图上方)
      thumb = btn.closest('.ref-thumb');
      if (thumb) {
        thumb.classList.add('is-loading');
        stageEl = document.createElement('span');
        stageEl.className = 'ref-btn-loading';
        stageEl.textContent = '…';
        thumb.appendChild(stageEl);
      }
    }
    var stageTimer = setInterval(function () {
      var elapsed = Date.now() - startTime;
      var label = STAGES[0].label;
      var pct = STAGES[0].pct;
      for (var i = STAGES.length - 1; i >= 0; i--) {
        if (elapsed >= STAGES[i].at) { label = STAGES[i].label; pct = STAGES[i].pct; break; }
      }
      if (stageEl) stageEl.textContent = label;
      // 进度条带不确定性增长:到达当前阶段值后慢慢往下一阶段涨,直到 95%
      var now = Date.now();
      var cur = elapsed;
      // 找到下一阶段的时间点
      var nextAt = null;
      for (var j = 0; j < STAGES.length; j++) {
        if (STAGES[j].at > elapsed) { nextAt = STAGES[j].at; break; }
      }
      if (nextAt) {
        // 在当前阶段内,从 pct 涨到下一阶段的 pct (用 elapsed 比例)
        var stageStart = elapsed;
        var nextStageIdx = 0;
        for (var k = 0; k < STAGES.length; k++) {
          if (STAGES[k].at >= elapsed) { nextStageIdx = k; break; }
        }
        var nextStage = STAGES[nextStageIdx];
        var prevStage = STAGES[Math.max(0, nextStageIdx - 1)];
        var stageDur = nextStage.at - prevStage.at;
        var stageProgress = stageDur > 0 ? Math.min(1, (elapsed - prevStage.at) / stageDur) : 1;
        var fromPct = prevStage.pct;
        var toPct = nextStage.pct;
        var actualPct = fromPct + (toPct - fromPct) * stageProgress;
        topBar.style.width = actualPct + '%';
      } else {
        // 已经过了所有阶段,缓慢增长到 95%
        var overflow = Math.min(95, pct + (elapsed - 60000) / 1000);
        topBar.style.width = overflow + '%';
      }
    }, 500);

    ig.reverse(img.file, {
      mode: revOpts.mode || 'caption',
      targetStyle: revOpts.targetStyle || '',
      provider: revOpts.provider || 'auto',
      visionProviderId: revOpts.visionProviderId || ''
    })
      .then(function (result) {
        clearInterval(stageTimer);
        if (stageEl) {
          stageEl.textContent = '✓ 完成';
          stageEl.classList.add('is-done');
        }
        // 顶部进度条满格 + 绿色,1.2s 后消失
        if (topProgress) {
          topBar.style.width = '100%';
          topProgress.classList.add('is-done');
          setTimeout(function () {
            if (topProgress && topProgress.parentNode) topProgress.parentNode.removeChild(topProgress);
          }, 1200);
        }
        setTimeout(function () {
          if (stageEl && stageEl.parentNode) stageEl.parentNode.removeChild(stageEl);
          if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); }
          if (thumb) thumb.classList.remove('is-loading');
        }, 1200);
        ig._showResult(result, {
          onApply: function (text, applyMode) {
            if (typeof self._onReverseApply === 'function') {
              self._onReverseApply(text, applyMode);
            }
          }
        });
      })
      .catch(function (e) {
        clearInterval(stageTimer);
        if (stageEl) {
          stageEl.textContent = '✗ 失败';
          stageEl.classList.add('is-error');
          setTimeout(function () {
            if (stageEl && stageEl.parentNode) stageEl.parentNode.removeChild(stageEl);
          }, 2000);
        }
        // 顶部进度条变红,2s 后消失
        if (topProgress) {
          topProgress.classList.add('is-error');
          setTimeout(function () {
            if (topProgress && topProgress.parentNode) topProgress.parentNode.removeChild(topProgress);
          }, 2000);
        }
        if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); }
        if (thumb) thumb.classList.remove('is-loading');
        alert('反推失败: ' + e.message);
      });
  };
  RefImageManager.prototype.reverse = function (index) {
    this._reverse(index);
  };

  // ── 打开文件选择器 ──
  RefImageManager.prototype.upload = function () {
    this.fileInput.click();
  };

  global.RefImageManager = RefImageManager;
})(window);
