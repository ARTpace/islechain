/* 画布快速开始（模型感知的快捷新建）
 *
 * 谁在用：
 *   - static/js/canvas.js 的「新建节点」菜单顶部
 *   - 以后任何需要「按已配置的模型给直达入口」的面板都能 mount 到自己的容器里
 *
 * 只负责渲染，不负责取数据：可用性由调用方算好传进来，
 * 这样组件不依赖画布的 provider 函数。
 *
 *   CanvasQuickStart.mount(host, {
 *       title: '快速开始',
 *       items: [{ key:'imageGen', label:'图像生成', icon:'sparkles', disabled:false, reason:'未配置图像模型' }],
 *       onPick: key => { ... }
 *   });
 */
(function () {
    'use strict';

    function render(options) {
        var opts = options || {};
        var items = opts.items || [];
        var root = document.createElement('div');
        root.className = 'canvas-quick-start';
        if (!items.length) return root;

        if (opts.title) {
            var title = document.createElement('div');
            title.className = 'canvas-quick-start-title';
            title.textContent = opts.title;
            root.appendChild(title);
        }

        var grid = document.createElement('div');
        grid.className = 'canvas-quick-start-grid';
        items.forEach(function (item) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'canvas-quick-start-btn' + (item.disabled ? ' is-disabled' : '');
            button.dataset.quickStart = item.key;
            button.title = item.disabled ? (item.reason || '当前不可用') : (item.hint || item.label);
            button.disabled = Boolean(item.disabled);
            button.innerHTML = '<i data-lucide="' + (item.icon || 'plus') + '" aria-hidden="true"></i><span>'
                + (item.label || item.key) + '</span>';
            button.onclick = function (event) {
                event.stopPropagation();
                if (button.disabled) return;
                if (typeof opts.onPick === 'function') opts.onPick(item.key, item);
            };
            grid.appendChild(button);
        });
        root.appendChild(grid);

        if (items.some(function (item) { return item.disabled; })) {
            var hint = document.createElement('div');
            hint.className = 'canvas-quick-start-hint';
            hint.textContent = items.filter(function (item) { return item.disabled; })
                .map(function (item) { return item.reason || (item.label + ' 不可用'); })
                .join(' · ');
            root.appendChild(hint);
        }
        return root;
    }

    function mount(host, options) {
        if (!host) return null;
        var existing = host.querySelector(':scope > .canvas-quick-start');
        if (existing) existing.remove();
        var node = render(options);
        host.insertBefore(node, host.firstChild);
        if (window.lucide && node.querySelector('svg') === null) {
            window.lucide.createIcons({ nameAttr: 'data-lucide' });
        }
        return node;
    }

    window.CanvasQuickStart = { render: render, mount: mount };
})();
