/* 外部资源拖入（内置）：从系统 / AssetVault 桌面端拖入图片与模型文件。
 * 图片 → 拖到任意输入栏（input/textarea/contenteditable）→ 上传资产库并插入引用。
 * 模型 → 拖到主/智能画布 → 交由对应画布注册的钩子创建 3D 资产节点；游戏画布由 game-workflow 自行处理。
 * 仅响应真正的外部文件拖拽（dataTransfer.types 含 Files 且无内部自定义类型），不干扰画布内部节点拖拽。 */
(() => {
  'use strict';

  const IMAGE_EXT = ['png','jpg','jpeg','webp','gif','bmp','avif','heic','heif','tif','tiff'];
  const MODEL_EXT = ['glb','gltf','fbx','obj','stl','dae','3ds','ply'];
  // 画布内部拖拽使用的自定义 MIME，命中其一就说明是内部拖拽，不应拦截。
  const INTERNAL_TYPES = [
    'application/x-canvas-input', 'application/x-canvas-asset',
    'application/x-canvas-output-image', 'application/x-smart-manual-ref',
    'application/x-smart-input-thumb', 'application/x-smart-image'
  ];

  const extOf = name => (String(name || '').split('.').pop() || '').toLowerCase();
  const isImageFile = f => IMAGE_EXT.includes(extOf(f.name)) || (f.type || '').startsWith('image/');
  const isModelFile = f => MODEL_EXT.includes(extOf(f.name)) || /(model|gltf|fbx|octet-stream)/i.test(f.type || '');
  const isExternalDrag = dt => {
    if (!dt) return false;
    const types = Array.from(dt.types || []);
    if (!types.includes('Files')) return false;
    return !INTERNAL_TYPES.some(t => types.includes(t));
  };
  const inGameCanvas = el => !!(el && el.closest && el.closest('.gp-work-node, [data-game-canvas], #game-canvas, .game-pipeline'));

  let overlay = null;
  let lastDragOverAt = 0;
  let watchdogTimer = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'external-asset-drop-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999', 'pointer-events:none',
      'display:none', 'align-items:center', 'justify-content:center',
      'background:rgba(20,28,38,0.55)', 'backdrop-filter:blur(2px)'
    ].join(';');
    const box = document.createElement('div');
    box.style.cssText = [
      'padding:18px 28px', 'border:2px dashed #4a6273', 'border-radius:14px',
      'color:#cdd9e5', 'font:600 15px/1.4 system-ui,sans-serif', 'text-align:center',
      'background:rgba(15,21,29,0.7)', 'box-shadow:0 8px 30px rgba(0,0,0,0.4)'
    ].join(';');
    box.id = 'external-asset-drop-hint';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return overlay;
  }
  function startWatchdog() {
    if (watchdogTimer) return;
    // 兜底：拖拽事件流中断（松手后没收到 drop / 拖出窗口 / 拖拽被系统取消）时，
    // 只要超过 800ms 没有新的 dragover 就强制收起提示，避免提示残留。
    watchdogTimer = setInterval(() => {
      if (Date.now() - lastDragOverAt > 800) hideOverlay();
    }, 300);
  }
  function stopWatchdog() {
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  }
  function showOverlay(label) {
    const o = ensureOverlay();
    const hint = o.querySelector('#external-asset-drop-hint');
    const text = label || '松开以导入资产';
    if (hint && hint.textContent !== text) hint.textContent = text;
    if (o.style.display !== 'flex') o.style.display = 'flex';
    startWatchdog();
  }
  function hideOverlay() {
    stopWatchdog();
    if (overlay && overlay.style.display !== 'none') overlay.style.display = 'none';
  }

  async function uploadAssets(files) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    const res = await fetch('/api/local-assets/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error('上传失败 ' + res.status);
    const data = await res.json().catch(() => ({ files: [] }));
    return (data.files || []).map(it => ({
      url: it.url || ('/assets/library/_local/' + encodeURIComponent(it.file || '')),
      name: it.name || (it.file || '').split('/').pop() || 'asset',
      kind: it.kind || 'image'
    }));
  }

  function resolveInput(el) {
    if (!el || !el.closest) return null;
    return el.closest('input, textarea, [contenteditable="true"], [data-prompt-input]');
  }

  function insertReference(input, items) {
    if (!input) return;
    const md = items.map(it => `![${it.name}](${it.url})`).join('\n');
    if (input.isContentEditable) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const frag = document.createDocumentFragment();
        items.forEach((it, i) => {
          if (i) frag.appendChild(document.createElement('br'));
          const img = document.createElement('img');
          img.src = it.url; img.alt = it.name; img.style.maxWidth = '120px'; img.style.verticalAlign = 'middle';
          frag.appendChild(img);
        });
        range.insertNode(frag);
      } else {
        items.forEach(it => { const img = document.createElement('img'); img.src = it.url; img.alt = it.name; input.appendChild(img); });
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      const before = input.value.slice(0, start);
      const after = input.value.slice(end);
      const sep = before && !before.endsWith('\n') && !before.endsWith(' ') ? '\n' : '';
      input.value = before + sep + md + after;
      const pos = (before + sep + md).length;
      try { input.setSelectionRange(pos, pos); } catch (_) {}
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }
  }

  async function handleDrop(e) {
    // 松手即收起拖拽提示：无论后续走哪条分支（输入栏插入 / 画布建节点 / 忽略），都不能残留。
    hideOverlay();
    const dt = e.dataTransfer;
    if (!isExternalDrag(dt)) return;
    const files = Array.from(dt?.files || []);
    if (!files.length) return;
    const target = e.target;
    // 游戏画布：完全交给 game-workflow 的接收区处理（图片/模型均变为 media 资产）。
    if (inGameCanvas(target)) return;

    const images = files.filter(isImageFile);
    const models = files.filter(isModelFile);
    const clientX = e.clientX, clientY = e.clientY;

    // 图片：要求落在输入栏上，上传资产库并插入引用。
    if (images.length) {
      const input = resolveInput(target);
      if (input) {
        e.preventDefault();
        try {
          const items = await uploadAssets(images);
          if (items.length) { insertReference(input, items); toast(`已上传 ${items.length} 张图片到资产库并插入引用`); }
        } catch (err) { toast('图片导入失败：' + err.message); }
        return;
      }
      // 图片落在非输入区：交给画布自身的图片拖入逻辑（如智能画布建图节点），不处理。
    }

    // 模型：交给当前画布注册的钩子创建模型资产节点。
    if (models.length) {
      const hook = window.__assetDropCreateModelNode;
      if (typeof hook === 'function') {
        e.preventDefault();
        try { await hook(models, { x: clientX, y: clientY }); }
        catch (err) { toast('模型导入失败：' + err.message); }
      } else {
        // 没有画布钩子时，至少把模型上传到资产库，避免用户困惑。
        e.preventDefault();
        try {
          const items = await uploadAssets(models);
          if (items.length) toast(`已上传 ${items.length} 个模型到资产库（当前页面不支持直接建 3D 节点）`);
        } catch (err) { toast('模型导入失败：' + err.message); }
      }
    }
  }

  function onDragOver(e) {
    if (!isExternalDrag(e.dataTransfer)) { hideOverlay(); return; }
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
    lastDragOverAt = Date.now();
    if (inGameCanvas(e.target)) { hideOverlay(); return; }
    // dragover 阶段浏览器出于安全不暴露文件名，files 往往为空；能读到就按后缀判断，读不到按图片处理。
    const files = Array.from(e.dataTransfer.files || []);
    const hasModel = files.some(isModelFile);
    const hasImage = !files.length || files.some(isImageFile);
    if (!hasModel && !hasImage) { hideOverlay(); return; }
    showOverlay(hasModel ? '松开以创建 3D 资产节点' : '松开以上传图片到输入栏');
  }
  function onDragLeave(e) {
    // 指针离开视口边界：立即收起。
    if (e.clientX <= 0 || e.clientY <= 0) { hideOverlay(); return; }
    // relatedTarget 为空时无法区分「离开窗口」和「在子元素间移动」，交给 watchdog 兜底，避免闪烁。
  }

  document.addEventListener('dragover', onDragOver, false);
  document.addEventListener('dragleave', onDragLeave, false);
  document.addEventListener('drop', handleDrop, false);
  document.addEventListener('dragend', hideOverlay, true);

  // 多重兜底：任何一次松手、拖拽结束、切窗口、按 Esc、页面隐藏都收起提示，
  // 保证提示不会卡在界面上（这是之前 drop 后提示残留的根因）。
  window.addEventListener('drop', hideOverlay, true);
  window.addEventListener('dragend', hideOverlay, true);
  window.addEventListener('mouseup', hideOverlay, true);
  window.addEventListener('pointerup', hideOverlay, true);
  window.addEventListener('blur', hideOverlay);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideOverlay(); }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) hideOverlay(); });

  function toast(msg) {
    if (typeof window.toast === 'function') { window.toast(msg); return; }
    // 极简兜底：短暂浮层。
    let t = document.getElementById('asset-drop-toast');
    if (!t) { t = document.createElement('div'); t.id = 'asset-drop-toast'; t.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:100000;background:#10151d;color:#cdd9e5;padding:10px 16px;border-radius:10px;border:1px solid #33454f;font:500 13px system-ui;box-shadow:0 6px 20px rgba(0,0,0,.4)'; document.body.appendChild(t); }
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.style.display = 'none'; }, 2600);
  }

  window.__assetDropExternalReady = true;

  /* 3D 预览器：用 <model-viewer>（CDN 渐进增强）渲染 glb/gltf；非 glb 先用 window.GameModelImport 转 glb 再预览；离线或失败降级为下载。 */
  function openModel3dViewer(url, name){
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(8,12,18,.88);display:flex;align-items:center;justify-content:center';
    const panel = document.createElement('div');
    panel.style.cssText = 'width:min(880px,92vw);height:min(660px,86vh);background:#0c1118;border:1px solid #223;border-radius:12px;position:relative;overflow:hidden;display:flex;flex-direction:column';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #223;color:#cdd9e5;font:600 13px system-ui';
    const titleEl = document.createElement('span');
    titleEl.textContent = name || '3D 模型';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'background:#1b2530;color:#cdd9e5;border:1px solid #33454f;border-radius:8px;padding:6px 12px;cursor:pointer';
    closeBtn.onclick = () => overlay.remove();
    bar.append(titleEl, closeBtn);
    const stage = document.createElement('div');
    stage.style.cssText = 'flex:1;position:relative;background:radial-gradient(circle at 50% 40%,#16202c,#0a0e14)';
    const loading = document.createElement('div');
    loading.textContent = '正在加载 3D 预览…';
    loading.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#5b7686;font:500 13px system-ui';
    stage.appendChild(loading);
    panel.append(bar, stage);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const finalize = (srcUrl) => {
      loading.remove();
      const mv = document.createElement('model-viewer');
      mv.src = srcUrl;
      mv.style.cssText = 'width:100%;height:100%';
      mv.setAttribute('camera-controls', '');
      mv.setAttribute('auto-rotate', '');
      mv.setAttribute('shadow-intensity', '1');
      mv.setAttribute('environment-image', 'neutral');
      mv.addEventListener('error', () => {
        stage.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#cdd9e5;font:500 13px system-ui;text-align:center;padding:20px">无法内嵌预览该格式。<br>请用「下载」按钮获取文件后在专业软件中打开。</div>';
      });
      stage.appendChild(mv);
    };
    const tryModelViewer = (srcUrl) => {
      if (customElements.get('model-viewer')) { finalize(srcUrl); return; }
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js';
      s.onload = () => finalize(srcUrl);
      s.onerror = () => {
        loading.remove();
        stage.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#cdd9e5;font:500 13px system-ui;text-align:center;padding:20px">3D 预览组件加载失败（可能离线）。<br>请用「下载」按钮获取文件。</div>';
      };
      document.head.appendChild(s);
    };
    const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
    if (ext === 'glb' || ext === 'gltf') { tryModelViewer(url); }
    else if (window.GameModelImport && window.GameModelImport.isModel && window.GameModelImport.isModel(url)) {
      loading.textContent = '正在转换模型格式…';
      fetch(url).then(r => r.blob()).then(b => {
        const f = new File([b], (name || 'model') + '.' + (ext || 'obj'), {type: 'application/octet-stream'});
        return window.GameModelImport.convert(f);
      }).then(glb => { tryModelViewer(URL.createObjectURL(glb)); })
      .catch(err => {
        loading.remove();
        stage.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#cdd9e5;font:500 13px system-ui;text-align:center;padding:20px">格式转换失败：' + err.message + '</div>';
      });
    } else {
      loading.remove();
      stage.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#cdd9e5;font:500 13px system-ui;text-align:center;padding:20px">该格式不支持内嵌预览。</div>';
    }
  }
  window.openModel3dViewer = openModel3dViewer;
})();
