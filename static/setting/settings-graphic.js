/* 设置面板图形化增强器：纯文字动作按钮 -> 图标 + 短标签按键
   作用域：主页面 #settings-detail / iframe body.sk-settings-page（左侧导航与主应用其它按钮不碰）
   只替换按钮内容，id / data-* / onclick / title / aria-label 全部保留，业务逻辑零改动 */
(function () {
    'use strict';
    if (window.__skGraphic) return;
    window.__skGraphic = true;

    var P = {
        trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
        save: '<path d="M4 4h13l3 3v13H4V4zM8 4v6h8V4M8 20v-6h8v6"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        play: '<path d="M6 4l13 8-13 8V4z"/>',
        refresh: '<path d="M20 11a8 8 0 10-2 6M20 4v7h-7"/>',
        power: '<path d="M12 3v9M6.5 6.5a8 8 0 1011 0"/>',
        stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
        help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 115 0c0 2-2.5 2-2.5 4M12 17h.01"/>',
        edit: '<path d="M4 20h4L20 8l-4-4L4 16v4z"/>',
        login: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
        folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>'
    };
    var RULES = [
        [/删除|移除|清空|清除/, 'trash'],
        [/保存|确定|应用|提交|写入/, 'save'],
        [/新增|添加|创建|导入/, 'plus'],
        [/验证|检测|测试|检查|校验/, 'play'],
        [/刷新|重新|重载|同步|拉取|更新|重启/, 'refresh'],
        [/启动|开启|开始|运行/, 'power'],
        [/停止|关闭|断开/, 'stop'],
        [/帮助|文档|说明|查看/, 'help'],
        [/编辑|修改|重命名/, 'edit'],
        [/登录|扫码|授权/, 'login'],
        [/选择|浏览|目录|路径/, 'folder']
    ];
    var SHORT_WORD = { trash: '删除', save: '保存', plus: '添加', play: '验证', refresh: '刷新', power: '启动', stop: '停止', help: '帮助', edit: '编辑', login: '登录', folder: '选择' };
    var svg = function (kind) {
        return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + P[kind] + '</svg>';
    };
    var pick = function (text) {
        for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(text)) return RULES[i][1];
        return null;
    };
    var enhance = function (root) {
        if (!root) return;
        root.querySelectorAll('button').forEach(function (el) {
            if (el.dataset.skDone || el.classList.contains('sk-iconbtn')) return;
            if (el.children.length) return;
            var label = (el.textContent || '').trim();
            if (!label || label.length > 10) return;
            var kind = pick(label);
            if (!kind) return;
            el.dataset.skDone = '1';
            el.classList.add('sk-iconbtn');
            el.setAttribute('title', label);
            el.setAttribute('aria-label', label);
            el.innerHTML = svg(kind) + '<span class="sk-btn-label">' + SHORT_WORD[kind] + '</span>';
        });
    };
    var scope = function () {
        return document.getElementById('settings-detail')
            || (document.body && document.body.classList.contains('sk-settings-page') ? document.body : null);
    };
    var start = function (root) {
        enhance(root);
        var mo = new MutationObserver(function () { enhance(root); });
        mo.observe(root, { childList: true, subtree: true });
    };
    var s = scope();
    if (s) start(s);
    else {
        var wait = new MutationObserver(function () {
            var r = scope();
            if (r) { wait.disconnect(); start(r); }
        });
        wait.observe(document.documentElement, { childList: true, subtree: true });
    }
})();
