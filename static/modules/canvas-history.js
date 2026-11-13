/* 撤销 / 重做组件（与画布数据结构解耦）
 *
 * 谁在用：
 *   - static/js/canvas.js：画布编辑的 undo / redo
 *   - 以后任何「有快照能力」的面板（表格编辑器、时间轴、材质参数）都能直接复用，
 *     只需要提供 capture()（拿到当前状态）和 apply(state)（把状态写回去）。
 *
 * 语义约定（和画布原有 pushUndo 一致）：push 记录的是「改动之前」的状态，
 * 所以调用时机是「动手之前」。undo 时把当前状态推进 redo 栈，redo 时反过来。
 * 任何一次新的 push 都会清空 redo 栈（分支被丢弃）。
 *
 * 用法：
 *   const history = CanvasHistory.create({
 *       limit: 60,
 *       capture: () => ({ nodes: deepCopy(nodes), connections: deepCopy(connections) }),
 *       apply: state => { nodes = state.nodes; connections = state.connections; render(); }
 *   });
 *   history.push(); history.undo(); history.redo();
 *   history.canUndo() / history.canRedo() / history.onChange(fn) / history.clear()
 */
(function () {
    'use strict';

    function create(options) {
        var opts = options || {};
        var limit = Math.max(1, Number(opts.limit) || 60);
        var capture = typeof opts.capture === 'function' ? opts.capture : null;
        var apply = typeof opts.apply === 'function' ? opts.apply : function () {};
        var listeners = [];
        var undoStack = [];
        var redoStack = [];

        function notify(reason) {
            listeners.slice().forEach(function (listener) {
                try { listener(reason, api); } catch (error) { console.error('[CanvasHistory]', error); }
            });
        }

        var api = {
            push: function (label) {
                if (!capture) return false;
                undoStack.push({ label: label || '', state: capture() });
                while (undoStack.length > limit) undoStack.shift();
                redoStack.length = 0;
                notify('push');
                return true;
            },
            undo: function () {
                if (!undoStack.length) return false;
                var entry = undoStack.pop();
                if (capture) redoStack.push({ label: entry.label, state: capture() });
                apply(entry.state);
                notify('undo');
                return true;
            },
            redo: function () {
                if (!redoStack.length) return false;
                var entry = redoStack.pop();
                if (capture) undoStack.push({ label: entry.label, state: capture() });
                apply(entry.state);
                notify('redo');
                return true;
            },
            canUndo: function () { return undoStack.length > 0; },
            canRedo: function () { return redoStack.length > 0; },
            /* 给需要「把多次 push 合并成一步」的调用方用（例如 Agent 一次性落多个节点） */
            snapshot: function () {
                return { undo: undoStack.slice(), redo: redoStack.slice() };
            },
            restore: function (snapshot) {
                if (!snapshot) return;
                undoStack = (snapshot.undo || []).slice();
                redoStack = (snapshot.redo || []).slice();
                notify('restore');
            },
            clear: function () {
                undoStack.length = 0;
                redoStack.length = 0;
                notify('clear');
            },
            onChange: function (listener) {
                if (typeof listener !== 'function') return function () {};
                listeners.push(listener);
                return function () {
                    var index = listeners.indexOf(listener);
                    if (index >= 0) listeners.splice(index, 1);
                };
            }
        };
        return api;
    }

    window.CanvasHistory = { create: create };
})();
