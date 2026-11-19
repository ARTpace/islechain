/* ModelPicker 的可用性过滤策略（可替换层）。
 *
 * 把「哪些行该显示」的判断从渲染组件里拿出来：组件只调 rejectXxx / rows()，
 * 检测源可以是 window.ModelAvailability，也可以换成别的策略（比如纯本地规则）。
 * 没加载检测模块时全部放行，行为与升级前完全一致。
 */
(function () {
    'use strict';

    function source() {
        var av = window.ModelAvailability;
        return av && typeof av.isWorkflowAvailable === 'function' ? av : null;
    }

    function rejectWorkflow(name) {
        var av = source();
        return Boolean(av && !av.isWorkflowAvailable(name));
    }

    function rejectProvider(id) {
        var av = source();
        return Boolean(av && !av.isProviderAvailable(id));
    }

    function rejectModel(kind, id, model) {
        var av = source();
        return Boolean(av && !av.isModelAvailable(kind || 'image', id, model));
    }

    function workflows(list) {
        var av = source();
        return av ? (list || []).filter(function (name) {
            return av.isWorkflowAvailable(name);
        }) : (list || []).slice();
    }

    /* 渲染层兜底：宿主即使传了未过滤的 rows，也不会把不可用项画出来。
     * 本地行是「一组档位」，只要有一档可用就保留该行（不可用的档由 workflows() 剔掉）。 */
    function rows(list) {
        var av = source();
        if (!av) return list || [];
        return (list || []).filter(function (row) {
            if (!row || row.kind === 'local') {
                var names = row && row.workflows && row.workflows.length ? row.workflows : [row && row.workflow];
                return names.some(function (name) { return av.isWorkflowAvailable(name); });
            }
            return av.isModelAvailable('image', row.provider, row.model);
        });
    }

    /* 检测是后台异步的：快照到达 / 强制显示变更后，还挂在 DOM 上的菜单就地重绘；
     * 菜单被销毁后自动解绑，不泄漏监听。 */
    function bindRedraw(root, draw) {
        var av = source();
        if (!av || typeof av.subscribe !== 'function') return function () {};
        var off = av.subscribe(function () {
            if (!root.isConnected) { off(); return; }
            draw();
        });
        return off;
    }

    window.ModelPickerAvailability = {
        source: source, rejectWorkflow: rejectWorkflow, rejectProvider: rejectProvider,
        rejectModel: rejectModel, workflows: workflows, rows: rows, bindRedraw: bindRedraw
    };
})();
