/* 画布对齐组件（纯几何 + 参考线覆盖层 + 多选对齐条）
 *
 * 谁在用：
 *   - static/js/canvas.js：节点拖拽时的网格吸附 / 参考线，以及多选时的对齐与均分
 *   - 以后任何「把一堆矩形摆整齐」的面板、节点、模态框都能直接调，
 *     不依赖画布的 nodes 数组、DOM 结构或 viewport 实现。
 *
 * 坐标约定：输入输出一律世界坐标（画布坐标）；覆盖层内部按传入的
 * viewport({x,y,scale}) 换算成屏幕坐标再画，所以画布缩放时参考线仍是 1px。
 *
 * 用法：
 *   CanvasAlignment.resolve({x,y,w,h}, others, {grid:true})
 *     -> {x, y, dx, dy, guides:{vertical:[{x,from,to}], horizontal:[{y,from,to}]}}
 *   CanvasAlignment.align(rects, 'left'|'centerX'|'right'|'top'|'centerY'|'bottom')
 *     -> [{id, x, y}]（原样返回全部矩形的新坐标）
 *   CanvasAlignment.distribute(rects, 'x'|'y') -> [{id, x, y}]
 *   const layer = CanvasAlignment.createGuideLayer(boardEl)
 *   layer.render(guides, viewport); layer.clear(); layer.destroy();
 *   selectionHub.append(CanvasAlignment.createAlignBar({onAlign, onDistribute}))
 */
(function () {
    'use strict';

    var GRID_SIZE = 10;      // 网格吸附步长
    var SNAP_DISTANCE = 6;   // 参考线吸附阈值（世界坐标）
    var MATCH_EPSILON = 0.5; // 判定「落在同一条参考线」的容差

    var X_ANCHORS = ['left', 'centerX', 'right'];
    var Y_ANCHORS = ['top', 'centerY', 'bottom'];

    function roundToGrid(value, grid) {
        var size = Number(grid) || GRID_SIZE;
        return Math.round(value / size) * size;
    }

    /* 归一化成六条边 / 中心线，之后所有比较都用这个名字 */
    function boxOf(rect) {
        var x = Number(rect && rect.x) || 0;
        var y = Number(rect && rect.y) || 0;
        var w = Number(rect && rect.w) || 0;
        var h = Number(rect && rect.h) || 0;
        return {
            id: rect && rect.id,
            x: x, y: y, w: w, h: h,
            left: x, centerX: x + w / 2, right: x + w,
            top: y, centerY: y + h / 2, bottom: y + h
        };
    }

    function anchorsOf(box, axis) {
        var keys = axis === 'y' ? Y_ANCHORS : X_ANCHORS;
        return keys.map(function (key) { return { key: key, value: box[key] }; });
    }

    /* 找最近的一条可对齐线；只保留位移最小的那一条，避免多线互相拉扯 */
    function nearest(box, others, axis, threshold) {
        var own = anchorsOf(box, axis);
        var best = null;
        others.forEach(function (other) {
            anchorsOf(other, axis).forEach(function (target) {
                own.forEach(function (anchor) {
                    var delta = target.value - anchor.value;
                    if (Math.abs(delta) > threshold) return;
                    if (!best || Math.abs(delta) < Math.abs(best.delta) - MATCH_EPSILON) {
                        best = { delta: delta };
                    }
                });
            });
        });
        return best;
    }

    /* 吸附生效后，把「落在同一位置」的所有框汇总成一条贯穿线 */
    function guideLines(moved, others, axis) {
        var own = anchorsOf(moved, axis);
        var lines = new Map();
        others.forEach(function (other) {
            anchorsOf(other, axis).forEach(function (target) {
                var hit = own.some(function (anchor) {
                    return Math.abs(anchor.value - target.value) <= MATCH_EPSILON;
                });
                if (!hit) return;
                var span = axis === 'x'
                    ? { from: Math.min(moved.top, other.top), to: Math.max(moved.bottom, other.bottom) }
                    : { from: Math.min(moved.left, other.left), to: Math.max(moved.right, other.right) };
                var previous = lines.get(target.value);
                if (previous) {
                    span = { from: Math.min(previous.from, span.from), to: Math.max(previous.to, span.to) };
                }
                lines.set(target.value, span);
            });
        });
        return Array.from(lines.entries()).map(function (entry) {
            return axis === 'x'
                ? { x: entry[0], from: entry[1].from, to: entry[1].to }
                : { y: entry[0], from: entry[1].from, to: entry[1].to };
        });
    }

    /* 拖拽时调用：先试参考线吸附，没吸上再落网格 */
    function resolve(rect, others, options) {
        var opts = options || {};
        var list = (others || []).map(boxOf);
        var box = boxOf(rect);
        var threshold = opts.threshold == null ? SNAP_DISTANCE : opts.threshold;
        var snapX = nearest(box, list, 'x', threshold);
        var snapY = nearest(box, list, 'y', threshold);
        var x = box.x + (snapX ? snapX.delta : 0);
        var y = box.y + (snapY ? snapY.delta : 0);
        if (!snapX && opts.grid !== false) x = roundToGrid(x, opts.gridSize);
        if (!snapY && opts.grid !== false) y = roundToGrid(y, opts.gridSize);
        var moved = boxOf({ id: box.id, x: x, y: y, w: box.w, h: box.h });
        return {
            x: x, y: y,
            dx: x - box.x, dy: y - box.y,
            guides: {
                vertical: snapX ? guideLines(moved, list, 'x') : [],
                horizontal: snapY ? guideLines(moved, list, 'y') : []
            }
        };
    }

    function align(rects, mode) {
        var boxes = (rects || []).map(boxOf);
        if (boxes.length < 2) return [];
        var left = Math.min.apply(null, boxes.map(function (b) { return b.left; }));
        var right = Math.max.apply(null, boxes.map(function (b) { return b.right; }));
        var top = Math.min.apply(null, boxes.map(function (b) { return b.top; }));
        var bottom = Math.max.apply(null, boxes.map(function (b) { return b.bottom; }));
        var centerX = (left + right) / 2;
        var centerY = (top + bottom) / 2;
        return boxes.map(function (box) {
            var x = box.x;
            var y = box.y;
            if (mode === 'left') x = left;
            else if (mode === 'centerX') x = centerX - box.w / 2;
            else if (mode === 'right') x = right - box.w;
            else if (mode === 'top') y = top;
            else if (mode === 'centerY') y = centerY - box.h / 2;
            else if (mode === 'bottom') y = bottom - box.h;
            return { id: box.id, x: x, y: y };
        });
    }

    /* 均分：首尾不动，中间按等间距重排（至少 3 个才有意义） */
    function distribute(rects, axis) {
        var boxes = (rects || []).map(boxOf);
        if (boxes.length < 3) return [];
        var horizontal = axis !== 'y';
        var sorted = boxes.slice().sort(function (a, b) {
            return horizontal ? a.left - b.left : a.top - b.top;
        });
        var start = horizontal ? sorted[0].left : sorted[0].top;
        var last = sorted[sorted.length - 1];
        var end = horizontal ? last.right : last.bottom;
        var total = sorted.reduce(function (sum, b) { return sum + (horizontal ? b.w : b.h); }, 0);
        var gap = (end - start - total) / (sorted.length - 1);
        var cursor = start;
        var placed = new Map();
        sorted.forEach(function (box) {
            placed.set(box.id, horizontal ? { x: cursor, y: box.y } : { x: box.x, y: cursor });
            cursor += (horizontal ? box.w : box.h) + gap;
        });
        return boxes.map(function (box) {
            var spot = placed.get(box.id);
            return { id: box.id, x: spot.x, y: spot.y };
        });
    }

    /* 参考线覆盖层：挂在 board 上，按屏幕坐标画，缩放时不失真 */
    function createGuideLayer(host) {
        if (!host) return { render: function () {}, clear: function () {}, destroy: function () {} };
        var layer = document.createElement('div');
        layer.className = 'canvas-align-guides';
        layer.setAttribute('aria-hidden', 'true');
        host.appendChild(layer);
        return {
            render: function (guides, viewport) {
                var view = viewport || { x: 0, y: 0, scale: 1 };
                var scale = Number(view.scale) || 1;
                var ox = Number(view.x) || 0;
                var oy = Number(view.y) || 0;
                var html = [];
                ((guides && guides.vertical) || []).forEach(function (line) {
                    var top = line.from * scale + oy;
                    html.push('<i class="canvas-align-guide is-v" style="left:' + (line.x * scale + ox).toFixed(1)
                        + 'px;top:' + top.toFixed(1) + 'px;height:' + Math.max(0, (line.to - line.from) * scale).toFixed(1) + 'px"></i>');
                });
                ((guides && guides.horizontal) || []).forEach(function (line) {
                    var left = line.from * scale + ox;
                    html.push('<i class="canvas-align-guide is-h" style="top:' + (line.y * scale + oy).toFixed(1)
                        + 'px;left:' + left.toFixed(1) + 'px;width:' + Math.max(0, (line.to - line.from) * scale).toFixed(1) + 'px"></i>');
                });
                layer.innerHTML = html.join('');
            },
            clear: function () { layer.innerHTML = ''; },
            destroy: function () { layer.remove(); }
        };
    }

    /* 多选对齐条：纯 DOM，挂到任何容器里都能用 */
    function createAlignBar(handlers) {
        var hooks = handlers || {};
        var bar = document.createElement('div');
        bar.className = 'canvas-align-bar';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', '排列与对齐');
        bar.onmousedown = function (event) { event.stopPropagation(); };

        function button(label, icon, action) {
            var el = document.createElement('button');
            el.type = 'button';
            el.className = 'canvas-align-btn';
            el.title = label;
            el.setAttribute('aria-label', label);
            el.innerHTML = '<i data-lucide="' + icon + '" aria-hidden="true"></i>';
            el.onclick = function (event) {
                event.stopPropagation();
                action();
            };
            bar.appendChild(el);
            return el;
        }
        function divider() {
            var el = document.createElement('span');
            el.className = 'canvas-align-divider';
            bar.appendChild(el);
        }

        button('左对齐', 'align-start-vertical', function () { hooks.onAlign && hooks.onAlign('left'); });
        button('水平居中', 'align-center-vertical', function () { hooks.onAlign && hooks.onAlign('centerX'); });
        button('右对齐', 'align-end-vertical', function () { hooks.onAlign && hooks.onAlign('right'); });
        divider();
        button('顶对齐', 'align-start-horizontal', function () { hooks.onAlign && hooks.onAlign('top'); });
        button('垂直居中', 'align-center-horizontal', function () { hooks.onAlign && hooks.onAlign('centerY'); });
        button('底对齐', 'align-end-horizontal', function () { hooks.onAlign && hooks.onAlign('bottom'); });
        divider();
        button('水平等距', 'align-horizontal-distribute-center', function () { hooks.onDistribute && hooks.onDistribute('x'); });
        button('垂直等距', 'align-vertical-distribute-center', function () { hooks.onDistribute && hooks.onDistribute('y'); });
        return bar;
    }

    window.CanvasAlignment = {
        GRID_SIZE: GRID_SIZE,
        SNAP_DISTANCE: SNAP_DISTANCE,
        boxOf: boxOf,
        roundToGrid: roundToGrid,
        resolve: resolve,
        align: align,
        distribute: distribute,
        createGuideLayer: createGuideLayer,
        createAlignBar: createAlignBar
    };
})();
