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
      '.ref-thumb{width:64px;height:64px;border-radius:8px;overflow:hidden;' +
      'border:1px solid rgba(255,255,255,0.15);flex-shrink:0;cursor:pointer;' +
      'position:relative;transition:border-color 0.2s;}' +
      '.ref-thumb:hover{border-color:rgba(0,180,216,0.6)!important;}' +
      '.ref-thumb img{width:100%;height:100%;object-fit:cover;pointer-events:none;}' +
      '.ref-thumb .ref-overlay{position:absolute;inset:0;pointer-events:none;}' +
      '.ref-thumb .ref-overlay>*{pointer-events:auto;}' +
      '.ref-del-btn,.ref-rev-btn{position:absolute;width:16px;height:16px;' +
      'border-radius:50%;border:none;font-size:10px;line-height:1;' +
      'display:flex;align-items:center;justify-content:center;cursor:pointer;' +
      'opacity:0;transition:opacity 0.15s;z-index:2;}' +
      '.ref-del-btn{top:2px;right:2px;background:rgba(239,68,68,0.85);color:#fff;}' +
      '.ref-rev-btn{bottom:2px;right:2px;background:rgba(50,140,255,0.8);color:#fff;font-size:9px;}' +
      '.ref-rev-btn:disabled{opacity:0.5;}' +
      '.ref-thumb:hover .ref-del-btn,.ref-thumb:hover .ref-rev-btn{opacity:1!important;}' +
      '.ref-clear-btn{width:64px;height:64px;border-radius:8px;' +
      'border:1px dashed rgba(255,255,255,0.2);background:rgba(255,255,255,0.03);' +
      'color:rgba(255,255,255,0.4);font-size:18px;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;flex-shrink:0;' +
      'transition:all 0.2s;}' +
      '.ref-clear-btn:hover{border-color:rgba(239,68,68,0.5)!important;color:#ef4444!important;}' +
      '.ref-filename{position:absolute;bottom:0;left:0;right:0;text-align:center;' +
      'font-size:8px;color:#fff;overflow:hidden;white-space:nowrap;' +
      'text-overflow:ellipsis;background:rgba(0,0,0,0.5);padding:0 2px;z-index:1;}' +
      '.ref-img-mgr-wrap{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}';
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

    // 已渲染的缩略图点击 → 委托
    this.container.classList.add('ref-img-mgr-wrap');
  }

  // ── 懒加载 Interrogator ──
  RefImageManager.prototype._getInterrogator = function () {
    if (!this._ig && global.Interrogator) this._ig = new Interrogator();
    return this._ig;
  };

  // ── 处理文件 ──
  RefImageManager.prototype._handleFiles = function (files) {
    var self = this;
    var added = false;
    files.forEach(function (file) {
      if (!file.type.startsWith('image/')) return;
      var url = URL.createObjectURL(file);
      self._images.push({ file: file, url: url, name: file.name });
      added = true;
    });
    if (!added) return;
    this.render();
    if (typeof this._onChange === 'function') this._onChange(this._images.length);
  };

  // ── 上传（公开 API） ──
  RefImageManager.prototype.addFiles = function (files) {
    this._handleFiles(files ? Array.from(files) : []);
  };
  RefImageManager.prototype.getFiles = function () {
    return this._images;
  };
  RefImageManager.prototype.getCount = function () {
    return this._images.length;
  };

  // ── 清空 ──
  RefImageManager.prototype.clear = function () {
    this._images.forEach(function (img) { URL.revokeObjectURL(img.url); });
    this._images = [];
    this.render();
    if (typeof this._onChange === 'function') this._onChange(0);
  };

  // ── 渲染缩略图 ──
  RefImageManager.prototype.render = function () {
    var self = this;
    var container = this.container;
    if (this._images.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }
    container.style.display = 'flex';
    var html = this._images.map(function (img, i) {
      return '<div class="ref-thumb" data-idx="' + i + '">'
        + '<img src="' + img.url + '" />'
        + '<div class="ref-overlay">'
        + '<button class="ref-del-btn" data-idx="' + i + '">&times;</button>'
        + '<button class="ref-rev-btn" data-idx="' + i + '">&#x1F50D;</button>'
        + '</div>'
        + '<div class="ref-filename">' + img.name.replace(/"/g, '&quot;') + '</div>'
        + '</div>';
    }).join('') + '<button class="ref-clear-btn" title="清空全部参考图">🗑</button>';

    container.innerHTML = html;

    // ── 事件委托 ──
    container.querySelectorAll('.ref-thumb').forEach(function (el) {
      // 点击放大
      el.addEventListener('click', function (e) {
        if (e.target.closest('.ref-overlay')) return;
        self._view(parseInt(el.dataset.idx, 10));
      });
    });
    container.querySelectorAll('.ref-del-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        self._remove(parseInt(btn.dataset.idx, 10));
      });
    });
    container.querySelectorAll('.ref-rev-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        self._reverse(parseInt(btn.dataset.idx, 10));
      });
    });
    var clearBtn = container.querySelector('.ref-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () { self.clear(); });
    }
  };

  // ── 放大查看 ──
  RefImageManager.prototype._view = function (index) {
    var img = this._images[index];
    if (!img) return;
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(8px);';
    overlay.innerHTML = '<img src="' + img.url + '" style="max-width:90vw;max-height:90vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.5);" />'
      + '<div style="position:absolute;top:16px;right:20px;color:#fff;font-size:28px;cursor:pointer;width:40px;height:40px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,0.1);transition:background 0.2s;" onmouseenter="this.style.background=\'rgba(255,255,255,0.2)\'" onmouseleave="this.style.background=\'rgba(255,255,255,0.1)\'">&times;</div>'
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
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    ig.reverse(img.file, {
      mode: revOpts.mode || 'caption',
      targetStyle: revOpts.targetStyle || '',
      provider: revOpts.provider || 'auto',
      visionProviderId: revOpts.visionProviderId || ''
    })
      .then(function (result) {
        ig._showResult(result, {
          onApply: function (text, applyMode) {
            if (typeof self._onReverseApply === 'function') {
              self._onReverseApply(text, applyMode);
            }
          }
        });
      })
      .catch(function (e) { alert('反推失败: ' + e.message); })
      .then(function () {
        if (btn) { btn.disabled = false; btn.textContent = '🔍'; }
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
