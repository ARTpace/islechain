/* 可运行网页节点（webapp）：在画布里放一个真实运行的网页（网址 / 内联 HTML）。
 *
 * 设计要点：
 *   1. iframe 常驻 world 下的独立图层（#webNodeLayer），节点重渲染不会重载网页，
 *      网页里的表单、滚动位置、脚本状态都能保住。
 *   2. 非交互态 iframe 不接收指针事件，节点照常可拖动/缩放/连线；
 *      双击或用工具栏「运行」进入交互态，Esc 或点画布空白退出。
 *   3. createViewer() 是通用组件，其他节点或功能也能直接嵌一个可运行网页。
 *
 * 网页侧可用接口（注入到 iframe 的 window.CanvasHost）：
 *   CanvasHost.emit(text)   把文本作为节点输出（node.outputText，下游 LLM 可读）
 *   CanvasHost.title(text)  改节点标题
 *   CanvasHost.input()      读上游输入（{text, images}）
 */
(() => {
'use strict';

const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-same-origin';
const LAYER_ID = 'webNodeLayer';

let deps = null;
const views = new Map();   // nodeId -> { el, iframe, key, node, slot, unlocked, last }
let layer = null;
let raf = 0;
let editorEl = null;

function init(next){ deps = next; }

function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, s => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[s]));
}
function escapeAttr(str){ return escapeHtml(str); }
function refreshIcons(){ if(window.lucide) window.lucide.createIcons(); }
function nodeList(){ return deps?.nodes?.() || []; }
function viewportScale(){
    const value = Number(deps?.viewport?.()?.scale);
    return Number.isFinite(value) && value > 0 ? value : 1;
}
function currentNode(id){ return nodeList().find(n => n.id === id) || null; }

/* ---------- 通用组件：任何容器里跑一个网页 ---------- */
function createViewer(opts = {}){
    const host = document.createElement('div');
    host.className = `web-node-view ${opts.className || ''}`.trim();
    const iframe = document.createElement('iframe');
    iframe.className = 'web-node-frame';
    iframe.setAttribute('sandbox', opts.sandbox || SANDBOX);
    iframe.setAttribute('allow', 'clipboard-write; fullscreen');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    host.appendChild(iframe);
    const api = {
        el: host,
        iframe,
        setContent(mode, content){
            if(mode === 'url'){ iframe.removeAttribute('srcdoc'); iframe.src = content; }
            else { iframe.removeAttribute('src'); iframe.srcdoc = content; }
        },
        reload(){
            if(iframe.hasAttribute('srcdoc')){
                const doc = iframe.srcdoc;
                iframe.srcdoc = '';
                requestAnimationFrame(() => { iframe.srcdoc = doc; });
            } else if(iframe.src){
                try { iframe.contentWindow.location.reload(); } catch { iframe.src = iframe.src; }
            }
        },
        unlock(value = true){ host.classList.toggle('is-unlocked', Boolean(value)); },
        destroy(){ host.remove(); },
    };
    return api;
}

/* ---------- 内容来源 ---------- */
function sourceMode(node){ return node.webMode === 'url' ? 'url' : 'html'; }
function sourceText(node){
    return sourceMode(node) === 'url' ? String(node.webUrl || '').trim() : String(node.webHtml || '');
}
function sourceKey(node){
    const text = sourceText(node);
    return text ? `${sourceMode(node)}:${text}` : '';
}
function sourceLabel(node){
    const text = sourceText(node);
    if(!text) return { short: '未设置内容', full: '点击右侧「编辑」填入网址或 HTML' };
    if(sourceMode(node) === 'url'){
        let host = text;
        try { host = new URL(text).host || text; } catch {}
        return { short: host, full: text };
    }
    return { short: '内联 HTML', full: `内联 HTML · ${text.length} 字符` };
}

/* 注入宿主桥：网页可把输出写回节点，也能拿到上游输入。 */
function bridgeScript(nodeId, input){
    const payload = JSON.stringify(input || { text: '', images: [] }).replace(/</g, '\\u003c');
    return `<script data-canvas-host>(function(){
  var ID=${JSON.stringify(nodeId)};
  var INPUT=${payload};
  function post(type,payload){try{parent.postMessage({__canvasWebNode:true,nodeId:ID,type:type,payload:payload},'*');}catch(e){}}
  window.CanvasHost={
    emit:function(text){post('output',text==null?'':String(text));},
    title:function(text){post('title',text==null?'':String(text));},
    input:function(){return INPUT;},
    ready:function(cb){if(typeof cb==='function')cb(INPUT);}
  };
  post('ready');
})();<\/script>`;
}
function buildDoc(node, input){
    const html = String(node.webHtml || '');
    const bridge = bridgeScript(node.id, input);
    if(/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => `${m}\n${bridge}`);
    if(/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, m => `${m}\n<head>${bridge}</head>`);
    return bridge + html;
}

/* ---------- 图层与位置同步 ---------- */
function layerEl(){
    const world = document.getElementById('world');
    if(!world) return null;
    if(layer && layer.isConnected && layer.parentElement === world) return layer;
    layer = document.getElementById(LAYER_ID);
    if(!layer){
        layer = document.createElement('div');
        layer.id = LAYER_ID;
    }
    world.appendChild(layer);
    return layer;
}

function collectInput(node){
    const connections = deps?.connections?.() || [];
    const sources = connections.filter(c => c.to === node.id)
        .map(c => nodeList().find(n => n.id === c.from)).filter(Boolean);
    const text = sources.map(n => {
        if(n.type === 'prompt') return n.text || '';
        if(n.type === 'llm' || n.type === 'extension' || n.type === 'webapp') return n.outputText || '';
        return '';
    }).filter(Boolean).join('\n\n');
    const images = sources.filter(n => n.type === 'image' && n.url).map(n => ({ url: n.url, name: n.name || '' }));
    return { text, images };
}

function syncView(view){
    const slot = view.slot;
    if(!slot || !slot.isConnected){
        view.el.style.display = 'none';
        return;
    }
    const world = document.getElementById('world');
    if(!world) return;
    const scale = viewportScale();
    const wr = world.getBoundingClientRect();
    const sr = slot.getBoundingClientRect();
    const left = (sr.left - wr.left) / scale;
    const top = (sr.top - wr.top) / scale;
    const width = sr.width / scale;
    const height = sr.height / scale;
    const last = view.last;
    if(!last || Math.abs(last.left - left) > 0.4 || Math.abs(last.top - top) > 0.4
        || Math.abs(last.width - width) > 0.4 || Math.abs(last.height - height) > 0.4){
        Object.assign(view.el.style, {
            display: 'block',
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
        });
        view.last = { left, top, width, height };
    }
    const nodeEl = slot.closest('.node');
    if(nodeEl && !view.unlocked) view.el.style.zIndex = nodeEl.style.zIndex || '';
}

function tick(){
    raf = 0;
    const alive = new Set(nodeList().map(n => n.id));
    for(const [id, view] of views){
        if(!alive.has(id)){ destroyView(id); continue; }
        syncView(view);
    }
    if(views.size) raf = requestAnimationFrame(tick);
}
function ensureTick(){
    if(!raf) raf = requestAnimationFrame(tick);
}

function destroyView(id){
    const view = views.get(id);
    if(!view) return;
    view.iframe.remove();
    view.el.remove();
    views.delete(id);
}

/* ---------- 视图挂载 ---------- */
function mountView(node, slot){
    const key = sourceKey(node);
    if(!key) return null;
    let view = views.get(node.id);
    if(view && view.key !== key){ destroyView(node.id); view = null; }
    if(!view){
        const host = layerEl();
        if(!host) return null;
        const el = document.createElement('div');
        el.className = 'web-node-view';
        const iframe = document.createElement('iframe');
        iframe.className = 'web-node-frame';
        iframe.setAttribute('sandbox', SANDBOX);
        iframe.setAttribute('allow', 'clipboard-write; fullscreen');
        iframe.setAttribute('referrerpolicy', 'no-referrer');
        el.appendChild(iframe);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'web-node-chip';
        chip.innerHTML = '<i data-lucide="mouse-pointer-click"></i><span>点击运行</span>';
        chip.addEventListener('mousedown', e => e.stopPropagation());
        chip.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            const current = currentNode(node.id) || node;
            setUnlocked(current, true);
        });
        el.appendChild(chip);
        host.appendChild(el);
        view = { el, iframe, key, node, slot, unlocked: false, last: null };
        views.set(node.id, view);
        const input = collectInput(node);
        if(sourceMode(node) === 'url'){
            iframe.src = sourceText(node);
        } else {
            iframe.srcdoc = buildDoc(node, input);
        }
    }
    view.node = node;
    view.slot = slot;
    view.el.classList.toggle('is-unlocked', view.unlocked);
    ensureTick();
    return view;
}

function setUnlocked(node, value){
    const view = views.get(node.id);
    if(!view) return;
    view.unlocked = Boolean(value);
    view.el.classList.toggle('is-unlocked', view.unlocked);
    view.el.style.zIndex = view.unlocked ? '9999' : '';
    syncView(view);
    const wrap = document.querySelector(`.node[data-id="${CSS.escape(node.id)}"] .web-node`);
    wrap?.classList.toggle('is-running', view.unlocked);
}

function isUnlocked(node){
    return Boolean(views.get(node?.id)?.unlocked);
}

function reloadNode(node){
    const view = views.get(node.id);
    if(!view){ refreshNode(node); return; }
    if(view.iframe.hasAttribute('srcdoc')){
        const doc = view.iframe.srcdoc;
        view.iframe.srcdoc = '';
        requestAnimationFrame(() => { view.iframe.srcdoc = doc; });
    } else if(view.iframe.src){
        try { view.iframe.contentWindow.location.reload(); } catch { view.iframe.src = view.iframe.src; }
    }
}

function refreshNode(node){
    // 内容变了但节点还没重渲染时，强制重建视图。
    destroyView(node.id);
    deps?.render?.();
}

/* ---------- 节点 body ---------- */
function body(node){
    const label = sourceLabel(node);
    const hasContent = Boolean(sourceKey(node));
    const wrap = document.createElement('div');
    wrap.className = `web-node${hasContent ? ' has-content' : ''}`;
    wrap.innerHTML = `
        <div class="web-node-bar">
            <span class="web-node-src" title="${escapeAttr(label.full)}">
                <i data-lucide="${sourceMode(node) === 'url' ? 'globe' : 'code-xml'}"></i>
                <span>${escapeHtml(label.short)}</span>
            </span>
            <button type="button" class="web-node-btn" data-act="run" title="运行 / 暂停交互"><i data-lucide="mouse-pointer-click"></i></button>
            <button type="button" class="web-node-btn" data-act="reload" title="重新加载"><i data-lucide="rotate-cw"></i></button>
            <button type="button" class="web-node-btn" data-act="edit" title="编辑内容"><i data-lucide="settings-2"></i></button>
            <button type="button" class="web-node-btn" data-act="popout" title="新窗口打开"><i data-lucide="external-link"></i></button>
        </div>
        <div class="web-node-slot">
            <div class="web-node-empty">
                <i data-lucide="${hasContent ? 'play' : 'plus'}"></i>
                <span>${hasContent ? '正在准备网页…' : '点击设置网址或 HTML'}</span>
            </div>
        </div>`;
    const slot = wrap.querySelector('.web-node-slot');
    const empty = wrap.querySelector('.web-node-empty');

    const toggleRun = () => {
        if(!sourceKey(node)){ openEditor(node); return; }
        if(isUnlocked(node)){ setUnlocked(node, false); return; }
        setUnlocked(node, true);
    };

    empty.addEventListener('mousedown', e => e.stopPropagation());
    empty.addEventListener('click', e => { e.stopPropagation(); toggleRun(); });

    wrap.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            const act = btn.dataset.act;
            if(act === 'run') toggleRun();
            else if(act === 'reload') reloadNode(node);
            else if(act === 'edit') openEditor(node);
            else if(act === 'popout') openWindow(node);
        });
    });

    if(hasContent){
        const view = mountView(node, slot);
        wrap.classList.toggle('is-running', Boolean(view?.unlocked));
    }
    return wrap;
}

/* ---------- 打开 / 编辑 ---------- */
function openWindow(node){
    if(!sourceKey(node)){ openEditor(node); return; }
    if(sourceMode(node) === 'url'){ window.open(sourceText(node), '_blank', 'noopener'); return; }
    const blob = new Blob([String(node.webHtml || '')], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function closeEditor(){
    if(!editorEl) return;
    editorEl.remove();
    editorEl = null;
}

function openEditor(node){
    closeEditor();
    let mode = sourceMode(node);
    const modal = document.createElement('div');
    modal.className = 'web-node-modal';
    modal.innerHTML = `
        <div class="web-node-dialog" role="dialog" aria-label="网页节点">
            <header class="web-node-dialog-head">
                <strong>网页节点</strong>
                <button type="button" class="web-node-btn" data-close title="关闭"><i data-lucide="x"></i></button>
            </header>
            <div class="web-node-tabs">
                <button type="button" data-mode="url">网址</button>
                <button type="button" data-mode="html">HTML 源码</button>
                <label class="web-node-pick">选择 .html 文件<input type="file" accept=".html,.htm,text/html" hidden></label>
            </div>
            <input class="web-node-input" type="text" placeholder="https://example.com" spellcheck="false">
            <textarea class="web-node-code" spellcheck="false" placeholder="&lt;!doctype html&gt;&#10;&lt;html&gt;…&lt;/html&gt;"></textarea>
            <label class="web-node-scale">
                <span>节点宽度</span>
                <input type="range" min="320" max="1400" step="20">
                <b>0</b>
            </label>
            <p class="web-node-tip">网页脚本与画布同源运行，只粘贴你信任的代码。网页里可调用 <code>CanvasHost.emit(text)</code> 把结果输出到下游节点。</p>
            <footer class="web-node-dialog-foot">
                <button type="button" class="web-node-ghost" data-act="cancel">取消</button>
                <button type="button" class="web-node-primary" data-act="save">保存并运行</button>
            </footer>
        </div>`;
    document.body.appendChild(modal);
    editorEl = modal;

    const input = modal.querySelector('.web-node-input');
    const code = modal.querySelector('.web-node-code');
    const range = modal.querySelector('.web-node-scale input');
    const rangeValue = modal.querySelector('.web-node-scale b');
    input.value = node.webUrl || '';
    code.value = node.webHtml || '';
    const width = Number(node.w) || 520;
    range.value = String(Math.min(1400, Math.max(320, width)));
    rangeValue.textContent = `${range.value}px`;

    const syncMode = () => {
        modal.querySelectorAll('[data-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
        input.style.display = mode === 'url' ? '' : 'none';
        code.style.display = mode === 'html' ? '' : 'none';
        (mode === 'url' ? input : code).focus();
    };
    modal.querySelectorAll('[data-mode]').forEach(btn => {
        btn.addEventListener('click', () => { mode = btn.dataset.mode; syncMode(); });
    });
    modal.querySelector('input[type=file]').addEventListener('change', async e => {
        const file = e.target.files?.[0];
        if(!file) return;
        try {
            code.value = await file.text();
            mode = 'html';
            syncMode();
            if(!node.webTitle) modal.querySelector('.web-node-dialog-head strong').textContent = `网页节点 · ${file.name}`;
        } catch(err){ alert(err.message || '读取文件失败'); }
        e.target.value = '';
    });
    range.addEventListener('input', () => { rangeValue.textContent = `${range.value}px`; });

    const commit = () => {
        const url = input.value.trim();
        const html = code.value;
        if(mode === 'url' && !url){ alert('请填写网页地址'); return; }
        if(mode === 'html' && !html.trim()){ alert('请粘贴 HTML 源码或选择 .html 文件'); return; }
        deps?.pushUndo?.();
        node.webMode = mode;
        node.webUrl = url;
        node.webHtml = html;
        node.w = Number(range.value) || node.w;
        delete node.h;
        deps?.scheduleSave?.();
        closeEditor();
        destroyView(node.id);
        deps?.render?.();
        setUnlocked(node, true);
    };
    modal.querySelector('[data-act=save]').addEventListener('click', commit);
    modal.querySelector('[data-act=cancel]').addEventListener('click', closeEditor);
    modal.querySelector('[data-close]').addEventListener('click', closeEditor);
    modal.addEventListener('mousedown', e => { if(e.target === modal) closeEditor(); });
    modal.addEventListener('keydown', e => {
        if(e.key === 'Escape'){ e.stopPropagation(); closeEditor(); }
        if(e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
    });
    syncMode();
    refreshIcons();
    input.focus();
}

/* ---------- 创建 ---------- */
function add(point, options = {}){
    const x = point?.x ?? 0;
    const y = point?.y ?? 0;
    const node = deps?.addNode?.({
        id: deps.uid?.('webapp') || `webapp-${Date.now()}`,
        type: 'webapp',
        x, y,
        w: 560, h: 440,
        webMode: options.mode || 'html',
        webUrl: options.url || '',
        webHtml: options.html || '',
        webTitle: options.title || '',
    });
    if(!node) return node;
    deps?.scheduleSave?.();
    deps?.render?.();
    if(options.silent){
        if(sourceKey(node)) setUnlocked(node, true);
    } else {
        requestAnimationFrame(() => openEditor(node));
    }
    return node;
}

function createFromFile(file, point){
    return file.text().then(html => add(point, { mode: 'html', html, title: file.name.replace(/\.html?$/i, ''), silent: true }));
}

/* ---------- 交互态退出 ---------- */
function lockAll(exceptId){
    for(const [id, view] of views){
        if(id === exceptId || !view.unlocked) continue;
        setUnlocked(view.node, false);
        const wrap = document.querySelector(`.node[data-id="${CSS.escape(id)}"] .web-node`);
        wrap?.classList.remove('is-running');
    }
}

document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    if(editorEl){ closeEditor(); e.stopPropagation(); return; }
    let unlocked = false;
    for(const view of views.values()) if(view.unlocked) unlocked = true;
    if(unlocked){ lockAll(null); e.stopPropagation(); }
}, true);

document.addEventListener('mousedown', e => {
    if(!views.size) return;
    if(e.target.closest?.('.web-node-bar, .web-node-modal, #webNodeLayer')) return;
    lockAll(null);
}, true);

window.addEventListener('message', e => {
    const data = e.data;
    if(!data || data.__canvasWebNode !== true) return;
    const view = views.get(data.nodeId);
    if(!view) return;
    if(e.source && view.iframe.contentWindow && e.source !== view.iframe.contentWindow) return;
    const node = currentNode(data.nodeId) || view.node;
    if(!node) return;
    if(data.type === 'output'){
        const text = String(data.payload ?? '');
        if(text === (node.outputText || '')) return;
        node.outputText = text;
        deps?.scheduleSave?.();
    } else if(data.type === 'title'){
        const title = String(data.payload ?? '').trim();
        if(!title || title === node.webTitle) return;
        node.webTitle = title;
        const titleEl = document.querySelector(`.node[data-id="${CSS.escape(node.id)}"] .node-title span`);
        if(titleEl) titleEl.textContent = title;
        deps?.scheduleSave?.();
    }
});

window.CanvasWebNode = {
    type: 'webapp',
    title: '网页',
    init,
    body,
    add,
    openEditor,
    openWindow,
    reloadNode,
    refreshNode,
    createViewer,
    createFromFile,
    isUnlocked,
    destroyView,
    tick,
    _views: views,
};
})();
