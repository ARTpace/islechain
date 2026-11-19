/* API 设置页的「模型可用性」面板。
 *
 * 只消费 window.ModelAvailability，不自己拉接口：列出被判定不可用的项 + 原因，
 * 提供「强制显示」开关（误判兜底）与「重新检测」按钮。样式用页面已有的
 * --panel/--line/--text 等语义变量，深浅主题自动跟随。
 */
(function () {
    'use strict';

    var STYLE_ID = 'model-availability-settings-style';
    var CSS = [
        '.ma-wrap{font-size:12px;color:var(--text);}',
        '.ma-summary{color:var(--muted);font-weight:600;margin:2px 0 10px;line-height:1.6;}',
        '.ma-list{max-height:280px;overflow-y:auto;border:1px solid var(--line);border-radius:10px;background:var(--soft);}',
        '.ma-row{display:flex;align-items:flex-start;gap:10px;padding:9px 12px;border-bottom:1px solid var(--line);}',
        '.ma-row:last-child{border-bottom:0;}',
        '.ma-row.is-forced{opacity:.72;}',
        '.ma-switch{flex:0 0 auto;margin-top:2px;accent-color:var(--accent);cursor:pointer;}',
        '.ma-body{min-width:0;flex:1;}',
        '.ma-name{font-weight:700;word-break:break-all;line-height:1.4;}',
        '.ma-reason{color:var(--muted);margin-top:3px;word-break:break-all;line-height:1.45;}',
        '.ma-tag{display:inline-block;flex:0 0 auto;padding:2px 7px;border:1px solid var(--line);border-radius:999px;',
        '  color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.02em;margin-top:1px;}',
        '.ma-empty{padding:18px 12px;text-align:center;color:var(--muted);font-weight:600;}',
        '.ma-hint{color:var(--faint);font-size:11px;margin-top:8px;line-height:1.5;}'
    ].join('');

    var TYPE_LABELS = {
        provider: '平台', chat: '对话', image: '生图', video: '视频', workflow: '本地'
    };

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    function describe(key) {
        var at = key.indexOf(':');
        var type = at > 0 ? key.slice(0, at) : '';
        var body = at > 0 ? key.slice(at + 1) : key;
        if (type === 'workflow') body = body.split('/').pop();
        return { type: TYPE_LABELS[type] || '其它', name: body };
    }

    function render() {
        var host = document.getElementById('modelAvailabilityPanel');
        if (!host) return;
        injectStyle();
        var av = window.ModelAvailability;
        if (!av) {
            host.innerHTML = '<div class="ma-empty">检测模块未加载</div>';
            return;
        }
        var items = av.unavailableList();
        var provider = host.dataset.providerId;
        function belongs(key) {
            return !provider || key === 'provider:' + provider ||
                ['chat:', 'image:', 'video:'].some(function (prefix) { return key.startsWith(prefix + provider + '/'); });
        }
        items = items.filter(function (item) { return belongs(item.key); });
        var forced = items.filter(function (item) { return item.forced; }).length;
        var snap = av.snapshot();
        var when = snap ? new Date(snap.checked_at * 1000).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
        var wrap = document.createElement('div');
        wrap.className = 'ma-wrap';

        var summary = document.createElement('div');
        summary.className = 'ma-summary';
        summary.textContent = av.ready()
            ? '最近检测 ' + when + ' · 共 ' + Object.keys((snap && snap.entries) || {}).filter(belongs).length
              + ' 项 · 已隐藏 ' + items.length + ' 项 · 强制显示 ' + forced + ' 项'
            : '正在检测模型可用性…';
        wrap.appendChild(summary);

        var list = document.createElement('div');
        list.className = 'ma-list';
        if (!items.length) {
            var empty = document.createElement('div');
            empty.className = 'ma-empty';
            empty.textContent = av.ready() ? '没有发现不可用的模型 ✓' : '检测中，菜单暂时按全部可用处理…';
            list.appendChild(empty);
        }
        items.forEach(function (item) {
            var info = describe(item.key);
            var row = document.createElement('label');
            row.className = 'ma-row' + (item.forced ? ' is-forced' : '');
            row.title = item.key;

            var box = document.createElement('input');
            box.type = 'checkbox';
            box.className = 'ma-switch';
            box.checked = item.forced;
            box.setAttribute('aria-label', '强制显示 ' + item.key);
            box.onchange = function () {
                box.disabled = true;
                av.setOverride(item.key, box.checked).catch(function (err) {
                    box.checked = !box.checked;
                    console.warn('[ModelAvailability] 强制显示保存失败:', err.message);
                }).then(function () { box.disabled = false; });
            };

            var body = document.createElement('div');
            body.className = 'ma-body';
            var name = document.createElement('div');
            name.className = 'ma-name';
            name.textContent = info.name;
            var reason = document.createElement('div');
            reason.className = 'ma-reason';
            reason.textContent = item.reason || (item.stage === 'object_info' ? '缺少节点或权重' : '不可用');
            body.append(name, reason);

            var tag = document.createElement('span');
            tag.className = 'ma-tag';
            tag.textContent = info.type;
            row.append(box, body, tag);
            list.appendChild(row);
        });
        wrap.appendChild(list);

        var hint = document.createElement('div');
        hint.className = 'ma-hint';
        hint.textContent = '勾选「强制显示」可把误判的项放回菜单；修改 API 配置后会自动重新检测。';
        wrap.appendChild(hint);
        host.replaceChildren(wrap);
    }

    function mount() {
        var host = document.getElementById('modelAvailabilityPanel');
        if (!host || host.dataset.maMounted === '1') return;
        host.dataset.maMounted = '1';
        render();
        var av = window.ModelAvailability;
        if (av && av.subscribe) av.subscribe(render);
        var button = document.getElementById('modelAvailabilityRefresh');
        if (button) {
            button.onclick = function () {
                button.disabled = true;
                var old = button.textContent;
                button.textContent = '检测中…';
                Promise.resolve(av && av.refresh()).finally(function () {
                    button.disabled = false;
                    button.textContent = old;
                    render();
                });
            };
        }
    }

    window.ModelAvailabilitySettings = { mount: mount, render: render };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
