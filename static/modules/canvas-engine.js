/**
 * CanvasEngine - 统一画布核心引擎
 * 从 js/canvas.js、modules/canvas-all.js、js/smart-canvas.js、js/canvas-list.js 提取的公共逻辑
 * 版本：P1 收敛版 2026-10-21
 * 约束：零 window 依赖、零 DOM 耦合（接收 canvas/context 作为参数）
 */

// ===== 视口数学 =====

/**
 * 将客户端坐标转换为世界坐标
 * @param {number} clientX - 客户端 X
 * @param {number} clientY - 客户端 Y
 * @param {DOMRect} rect - 容器边界框
 * @param {Object} viewport - {x, y, scale}
 * @returns {{x: number, y: number}}
 */
export function screenToWorld(clientX, clientY, rect, viewport) {
    return {
        x: (clientX - rect.left - viewport.x) / viewport.scale,
        y: (clientY - rect.top - viewport.y) / viewport.scale
    };
}

/**
 * 应用视口变换到世界元素
 * @param {HTMLElement} worldEl - 世界容器元素
 * @param {Object} viewport - {x, y, scale}
 * @param {Function} [onRenderMinimap] - 可选：渲染缩略图回调
 */
export function applyViewport(worldEl, viewport, onRenderMinimap) {
    worldEl.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
    if (onRenderMinimap) onRenderMinimap();
}

/**
 * 计算鼠标滚轮缩放因子
 * @param {WheelEvent} event
 * @param {number} pageSize
 * @returns {number}
 */
export function canvasWheelZoomFactor(event, pageSize) {
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? pageSize : 1;
    const isMac = /^Mac/.test(navigator.platform || '');
    const sensitivity = 0.0008;
    const macMultiplier = isMac ? 1.15 : 1;
    return Math.exp(-event.deltaY * unit * sensitivity * macMultiplier);
}

/**
 * 以鼠标为中心缩放视口
 * @param {WheelEvent} event
 * @param {Object} viewport - {x, y, scale} 会被修改
 * @param {HTMLElement} boardEl - 画布容器
 * @param {Function} applyViewportFn - 应用视口的函数
 */
export function zoomAtMouse(event, viewport, boardEl, applyViewportFn) {
    event.preventDefault();
    const before = screenToWorld(event.clientX, event.clientY, boardEl.getBoundingClientRect(), viewport);
    const factor = canvasWheelZoomFactor(event, boardEl.clientHeight);
    viewport.scale = Math.max(0.1, Math.min(10, viewport.scale * factor));
    const rect = boardEl.getBoundingClientRect();
    viewport.x = event.clientX - rect.left - before.x * viewport.scale;
    viewport.y = event.clientY - rect.top - before.y * viewport.scale;
    applyViewportFn();
}

// ===== 节点渲染 =====

/** 默认节点尺寸表 */
const DEFAULT_NODE_SIZES = {
    image: { w: 260, h: 160 },
    prompt: { w: 320, h: 120 },
    promptGroup: { w: 320, h: 120 },
    group: { w: 300, h: 220 },
    output: { w: 280, h: 180 },
    llm: { w: 360, h: 240 },
    comfy: { w: 360, h: 280 },
    msgen: { w: 360, h: 280 },
    loop: { w: 320, h: 180 },
    video: { w: 360, h: 280 },
    audio: { w: 320, h: 200 },
    'upload-video': { w: 360, h: 280 },
    ps: { w: 360, h: 280 },
    generator: { w: 360, h: 280 },
    ltxDirector: { w: 360, h: 280 },
    rh: { w: 360, h: 280 },
    minimax: { w: 360, h: 280 }
};

export function defaultNodeSize(type) {
    return DEFAULT_NODE_SIZES[type] || { w: 260, h: 160 };
}

/**
 * 估算节点矩形（用于缩略图/碰撞检测）
 * @param {Object} node
 * @param {HTMLElement} [nodesEl] - 可选：用于测量实际 DOM 尺寸
 * @returns {{x, y, w, h}}
 */
export function estimatedNodeRect(node, nodesEl) {
    const el = nodesEl?.querySelector?.(`.node[data-id="${CSS.escape(node.id)}"]`);
    const size = defaultNodeSize(node.type);
    const w = el?.offsetWidth || node.w || size.w || 260;
    const h = el?.offsetHeight || node.h || size.h || 160;
    return { x: node.x || 0, y: node.y || 0, w, h };
}

/**
 * 创建基础节点 DOM 元素（不包含 body 内容，由调用方扩展）
 * @param {Object} node
 * @param {Set} selected - 选中 ID 集合
 * @param {Object} opts - 扩展选项
 * @returns {HTMLElement}
 */
export function createBaseNodeEl(node, selected, opts = {}) {
    const { isNodeControl, escapeHtml, tr, onClick, onContextMenu, onDragStart } = opts;
    const size = defaultNodeSize(node.type);
    const hasFixedSize = Boolean(node.h || size.h);
    
    const el = document.createElement('div');
    el.className = `node ${node.type}-node ${node.url ? 'has-image' : ''} ${hasFixedSize ? 'sized' : ''} ${selected.has(node.id) ? 'selected' : ''}`;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.width = `${node.w || size.w}px`;
    if (node.h || size.h) el.style.height = `${node.h || size.h}px`;
    el.dataset.id = node.id;
    
    if (onClick) el.onclick = (e) => onClick(e, node, selected);
    if (onContextMenu) el.oncontextmenu = (e) => onContextMenu(e, node);
    if (onDragStart) {
        el.onmousedown = (e) => {
            if (!isNodeControl?.(e.target)) onDragStart(e, node);
        };
    }
    
    return el;
}

/**
 * 渲染节点标题栏（通用）
 * @param {Object} node
 * @param {Object} opts - { escapeHtml, tr, showStatus, onDeleteClick }
 * @returns {string} innerHTML
 */
export function renderNodeHead(node, opts = {}) {
    const { escapeHtml = (s) => s, tr = (k) => k, showStatus = false, onDeleteClick } = opts;
    
    const typeTitles = {
        image: 'Image', prompt: 'Prompt', promptGroup: 'Prompts',
        group: 'Group', output: 'Output', llm: 'LLM',
        comfy: 'ComfyUI', msgen: 'Modelscope', loop: '循环',
        video: '视频生成', audio: '音频', 'upload-video': '视频',
        ps: 'Photoshop', generator: 'API生成', ltxDirector: 'LTX Director',
        rh: 'RunningHub', minimax: 'MiniMax H3'
    };
    const title = typeTitles[node.type] || 'Node';
    
    let statusHtml = '';
    if (showStatus && node.runStatus) {
        const labels = { queued: '排队中', running: '运行中', done: '完成', failed: '失败' };
        const label = labels[node.runStatus] || node.runStatus;
        statusHtml = `<span class="node-run-status ${node.runStatus}"><span class="dot"></span>${escapeHtml(label)}${node._cascadeIdx ? ' ' + node._cascadeIdx : ''}</span>`;
    }
    
    const deleteBtn = onDeleteClick 
        ? `<button onclick="${onDeleteClick}('${node.id}', event)" class="text-gray-300 hover:text-red-500"><i data-lucide="x" class="w-4 h-4"></i></button>`
        : '';
    
    return `<div class="node-head"><span class="node-title">${escapeHtml(title)}</span><div style="display:flex;align-items:center;gap:8px">${statusHtml}${deleteBtn}</div></div>`;
}

// ===== 连线渲染 =====

/**
 * 获取端口世界坐标
 * @param {string} nodeId
 * @param {'in'|'out'} kind
 * @param {Array} nodes
 * @param {HTMLElement} nodesEl
 * @param {Function} screenToWorldFn
 * @param {HTMLElement} boardEl
 * @param {Object} viewport
 * @returns {{x, y}}
 */
export function portPoint(nodeId, kind, nodes, nodesEl, screenToWorldFn, boardEl, viewport) {
    const n = nodes.find(x => x.id === nodeId);
    if (!n) return { x: 0, y: 0 };
    const el = nodesEl.querySelector(`.node[data-id="${CSS.escape(nodeId)}"]`);
    const port = el?.querySelector(`.port.${kind}`);
    if (port) {
        const r = port.getBoundingClientRect();
        return screenToWorldFn(r.left + r.width / 2, r.top + r.height / 2, boardEl.getBoundingClientRect(), viewport);
    }
    // 兜底：用节点几何中心
    const w = (el?.offsetWidth) || n.w || 260;
    const h = (el?.offsetHeight) || n.h || 160;
    const nx = Number(n.x) || 0, ny = Number(n.y) || 0;
    return kind === 'out' ? { x: nx + w, y: ny + h / 2 } : { x: nx, y: ny + h / 2 };
}

/**
 * 检查端口是否可解析（节点存在）
 * @param {string} nodeId
 * @param {Array} nodes
 * @returns {boolean}
 */
export function canResolvePort(nodeId, nodes) {
    return Boolean(nodes.find(x => x.id === nodeId));
}

/**
 * 生成贝塞尔曲线路径
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @returns {SVGPathElement}
 */
export function createLinkPath(x1, y1, x2, y2, cls) {
    const dx = Math.max(80, Math.abs(x2 - x1) * 0.45);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`);
    p.setAttribute('class', cls);
    return p;
}

/**
 * 批量渲染连线（读写分离，避免 layout thrashing）
 * @param {Array} connections
 * @param {Array} nodes
 * @param {HTMLElement} nodesEl
 * @param {HTMLElement} linksEl
 * @param {HTMLElement} linkControlsEl
 * @param {HTMLElement} boardEl
 * @param {Object} viewport
 * @param {Function} screenToWorldFn
 * @param {Object} opts - { isSelected, onDeleteClick, tempLink }
 */
export function renderLinks(connections, nodes, nodesEl, linksEl, linkControlsEl, boardEl, viewport, screenToWorldFn, opts = {}) {
    const { isSelected = () => false, onDeleteClick, tempLink } = opts;
    
    linksEl.innerHTML = '';
    linkControlsEl.innerHTML = '';
    
    // 先批量读取所有端点坐标
    const segments = [];
    connections.forEach(c => {
        if (!canResolvePort(c.from, nodes) || !canResolvePort(c.to, nodes)) return;
        segments.push({
            c,
            a: portPoint(c.from, 'out', nodes, nodesEl, screenToWorldFn, boardEl, viewport),
            b: portPoint(c.to, 'in', nodes, nodesEl, screenToWorldFn, boardEl, viewport)
        });
    });
    
    // 再统一写入 DOM
    segments.forEach(({ c, a, b }) => {
        const relClass = isSelected(c) ? ' link-active' : '';
        linksEl.appendChild(createLinkPath(a.x, a.y, b.x, b.y, `link${relClass}`));
        if (onDeleteClick) {
            const btn = document.createElement('button');
            btn.className = `link-delete ${isSelected(c) ? 'visible' : ''}`;
            btn.type = 'button';
            btn.title = '删除连线';
            btn.dataset.connectionId = c.id;
            btn.style.left = `${(a.x + b.x) / 2}px`;
            btn.style.top = `${(a.y + b.y) / 2}px`;
            btn.textContent = '×';
            btn.onclick = (e) => onDeleteClick(c.id, e);
            linkControlsEl.appendChild(btn);
        }
        // hit area
        const hit = createLinkPath(a.x, a.y, b.x, b.y, 'link-hit');
        hit.dataset.connectionId = c.id;
        linksEl.appendChild(hit);
    });
    
    if (tempLink) {
        linksEl.appendChild(createLinkPath(tempLink.x1, tempLink.y1, tempLink.x2, tempLink.y2, 'link temp'));
    }
}

// ===== 节点删除 =====

/**
 * 删除节点及其连线
 * @param {string} id
 * @param {Array} nodes - 会被修改
 * @param {Array} connections - 会被修改
 * @param {Set} selected - 会被修改
 * @param {Function} [pushUndo] - 撤销栈回调
 * @param {Function} [scheduleSave] - 保存调度回调
 * @param {Function} [render] - 重渲染回调
 * @returns {boolean} 是否删除了
 */
export function deleteNode(id, nodes, connections, selected, { pushUndo, scheduleSave, render } = {}) {
    pushUndo?.();
    nodes = nodes.filter(n => n.id !== id);
    connections = connections.filter(c => c.from !== id && c.to !== id);
    selected.delete(id);
    render?.();
    scheduleSave?.();
    return true;
}

/**
 * 删除节点前尝试清空内容（图片/输出节点）
 * @param {string} id
 * @param {Array} nodes
 * @param {Function} [pushUndo]
 * @param {Function} [render]
 * @param {Function} [scheduleSave]
 * @returns {boolean} 是否已处理（清空内容而非删除节点）
 */
export function clearNodeContentBeforeDelete(id, nodes, { pushUndo, render, scheduleSave, tr = (k) => k } = {}) {
    const node = nodes.find(n => n.id === id);
    if (!node) return false;
    
    if (node.type === 'image' && node.url) {
        pushUndo?.();
        node.url = '';
        node.mediaKind = 'image';
        node.name = tr('canvas.imageCard') || 'Image';
        render?.();
        scheduleSave?.();
        return true;
    }
    if (node.type === 'output' && ((node.images || []).length || (node._pending || []).length)) {
        pushUndo?.();
        node.images = [];
        node._pending = [];
        node.imageComparisons = {};
        render?.();
        scheduleSave?.();
        return true;
    }
    return false;
}

export function deleteNodeFromButton(id, nodes, connections, selected, { pushUndo, scheduleSave, render, clearNodeContentBeforeDelete: clearFn } = {}) {
    if (clearFn?.(id, nodes, { pushUndo, render, scheduleSave })) return;
    deleteNode(id, nodes, connections, selected, { pushUndo, scheduleSave, render });
}

// ===== 连线删除 =====

export function deleteConnection(id, connections, { syncGeneratorInputs, pushUndo, scheduleSave, render } = {}) {
    pushUndo?.();
    connections = connections.filter(c => c.id !== id);
    syncGeneratorInputs?.();
    render?.();
    scheduleSave?.();
}

// ===== CanvasEngine 类：组合式 API =====

export class CanvasEngine {
    /**
     * @param {Object} deps - 依赖注入
     * @param {HTMLElement} deps.boardEl - 画布容器
     * @param {HTMLElement} deps.worldEl - 世界容器
     * @param {HTMLElement} deps.nodesEl - 节点容器
     * @param {HTMLElement} deps.linksEl - 连线 SVG 容器
     * @param {HTMLElement} deps.linkControlsEl - 连线控制按钮容器
     * @param {Object} deps.viewport - {x, y, scale} 响应式对象
     * @param {Array} deps.nodes - 节点数组（响应式）
     * @param {Array} deps.connections - 连线数组（响应式）
     * @param {Set} deps.selected - 选中 ID 集合
     * @param {Function} deps.escapeHtml
     * @param {Function} deps.tr
     * @param {Function} [deps.pushUndo]
     * @param {Function} [deps.scheduleSave]
     * @param {Function} [deps.render]
     * @param {Function} [deps.syncGeneratorInputs]
     * @param {Function} [deps.onRenderMinimap]
     * @param {Object} [deps.tempLink] - 临时连线状态 {x1,y1,x2,y2}
     */
    constructor(deps) {
        this.boardEl = deps.boardEl;
        this.worldEl = deps.worldEl;
        this.nodesEl = deps.nodesEl;
        this.linksEl = deps.linksEl;
        this.linkControlsEl = deps.linkControlsEl;
        this.viewport = deps.viewport;
        this.nodes = deps.nodes;
        this.connections = deps.connections;
        this.selected = deps.selected;
        this.escapeHtml = deps.escapeHtml;
        this.tr = deps.tr;
        this.pushUndo = deps.pushUndo;
        this.scheduleSave = deps.scheduleSave;
        this.render = deps.render;
        this.syncGeneratorInputs = deps.syncGeneratorInputs;
        this.onRenderMinimap = deps.onRenderMinimap;
        this.tempLink = deps.tempLink;
    }
    
    // 视口
    screenToWorld(clientX, clientY) {
        return screenToWorld(clientX, clientY, this.boardEl.getBoundingClientRect(), this.viewport);
    }
    
    applyViewport() {
        applyViewport(this.worldEl, this.viewport, this.onRenderMinimap);
    }
    
    zoomAtMouse(event) {
        zoomAtMouse(event, this.viewport, this.boardEl, () => this.applyViewport());
    }
    
    // 节点
    createNodeEl(node, opts = {}) {
        return createBaseNodeEl(node, this.selected, {
            ...opts,
            escapeHtml: this.escapeHtml,
            tr: this.tr,
            onClick: opts.onClick,
            onContextMenu: opts.onContextMenu,
            onDragStart: opts.onDragStart
        });
    }
    
    renderNodeHead(node, opts = {}) {
        return renderNodeHead(node, { ...opts, escapeHtml: this.escapeHtml, tr: this.tr });
    }
    
    // 连线
    portPoint(nodeId, kind) {
        return portPoint(nodeId, kind, this.nodes, this.nodesEl, 
            (x, y, rect, vp) => screenToWorld(x, y, rect, vp), 
            this.boardEl, this.viewport);
    }
    
    renderLinks(opts = {}) {
        renderLinks(this.connections, this.nodes, this.nodesEl, this.linksEl, 
            this.linkControlsEl, this.boardEl, this.viewport,
            (x, y, rect, vp) => screenToWorld(x, y, rect, vp),
            {
                isSelected: opts.isSelected || ((c) => this.selected.has(c.from) || this.selected.has(c.to)),
                onDeleteClick: opts.onDeleteClick || ((id, e) => this.deleteConnection(id, e)),
                tempLink: this.tempLink
            }
        );
    }
    
    // 删除
    deleteNode(id) {
        deleteNode(id, this.nodes, this.connections, this.selected, {
            pushUndo: this.pushUndo,
            scheduleSave: this.scheduleSave,
            render: this.render
        });
    }
    
    deleteNodeFromButton(id, clearFn) {
        deleteNodeFromButton(id, this.nodes, this.connections, this.selected, {
            pushUndo: this.pushUndo,
            scheduleSave: this.scheduleSave,
            render: this.render,
            clearNodeContentBeforeDelete: clearFn
        });
    }
    
    deleteConnection(id, e) {
        deleteConnection(id, this.connections, {
            syncGeneratorInputs: this.syncGeneratorInputs,
            pushUndo: this.pushUndo,
            scheduleSave: this.scheduleSave,
            render: this.render
        });
    }
}

// 兼容 window 全局（过渡期）
if (typeof window !== 'undefined') {
    window.CanvasEngine = CanvasEngine;
    window.screenToWorld = screenToWorld;
    window.applyViewport = applyViewport;
    window.canvasWheelZoomFactor = canvasWheelZoomFactor;
    window.zoomAtMouse = zoomAtMouse;
    window.defaultNodeSize = defaultNodeSize;
    window.estimatedNodeRect = estimatedNodeRect;
    window.createBaseNodeEl = createBaseNodeEl;
    window.renderNodeHead = renderNodeHead;
    window.portPoint = portPoint;
    window.canResolvePort = canResolvePort;
    window.createLinkPath = createLinkPath;
    window.renderLinks = renderLinks;
    window.deleteNode = deleteNode;
    window.clearNodeContentBeforeDelete = clearNodeContentBeforeDelete;
    window.deleteNodeFromButton = deleteNodeFromButton;
    window.deleteConnection = deleteConnection;
}

export default CanvasEngine;