/* 统一模型选择菜单 —— 画布图像生成节点 / 文生图页共用。
 * 分工：本组件管档位识别 / 按 title 归并 / DOM / 搜索 / 选中态；宿主提供数据、徽章与 onPick。
 * 多档模型：几份 .config.json 的 title 完全一致，文件名加 -fast/-turbo/-4step/-6step 即可。
 * 可用性过滤是可替换策略，见 model-availability-filter.js；未加载时全部放行。
 */
(function () {
    'use strict';
    var filter = window.ModelPickerAvailability;

    // 文件名后缀 → 档位名。'' 表示默认档（高质量档，无后缀）
    // 第 5 条是通用兜底：任何「-N步」写法（-1step / -8step ……）都算极速档，
    // 以后加一份蒸馏版本不用再回来改这张表。
    var TIER_SUFFIXES = [
        ['-turbo', '极速'],
        ['-4step', '极速'],
        ['-6step', '极速'],
        ['-fast', '低']
    ];
    var TIER_STEP_RE = /-(\d+)step$/i;

    function baseName(name) {
        return String(name || '').split('/').pop().replace(/\.json$/i, '');
    }

    function tierOfWorkflow(name) {
        var base = baseName(name).toLowerCase();
        for (var i = 0; i < TIER_SUFFIXES.length; i++) {
            if (base.slice(-TIER_SUFFIXES[i][0].length) === TIER_SUFFIXES[i][0]) {
                return TIER_SUFFIXES[i][1];
            }
        }
        if (TIER_STEP_RE.test(base)) return '极速';
        return '';
    }

    // 档位判定优先级：工作流 config 显式声明的 tier → 文件名后缀。
    // 配置文件走数据缝，特殊命名（如 -lightning / 中文档位名）也能直接标，不用改代码。
    function tierOfItem(item) {
        if (!item) return '';
        var declared = String(item.tier || '').trim();
        if (declared) return declared;
        return tierOfWorkflow(item.name || item.workflow || '');
    }

    // 档位在 UI 里的展示顺序：高 → 低 → 极速。未知档位排最后。
    // 不排的话会按 API 返回顺序显示成「低/极速/高」，参数面板的档位选项会很别扭。
    var TIER_ORDER = { '': 0, '低': 1, '极速': 2 };

    function tierRank(name) {
        var tier = tierOfWorkflow(name);
        return Object.prototype.hasOwnProperty.call(TIER_ORDER, tier) ? TIER_ORDER[tier] : 9;
    }

    // 本地工作流 → 一行一个模型（按 title 归并同模型的各档）
    function localRows(workflows, options) {
        var current = (options && options.currentWorkflow) || '';
        var order = [];
        var byTitle = {};

        (workflows || []).forEach(function (item) {
            if (!item || !item.name) return;
            if (filter && filter.rejectWorkflow(item.name)) return;
            var title = item.title || baseName(item.name);
            if (!byTitle[title]) { byTitle[title] = []; order.push(title); }
            byTitle[title].push(item);
        });

        return order.map(function (title) {
            var group = byTitle[title].slice().sort(function (a, b) {
                return tierRank(a.name) - tierRank(b.name);
            });
            // 先把「文件名 / 配置 → 档位」算一次，宿主和档位选择器都用这一份，避免两处判断漂移
            var tiers = group.map(function (item) {
                return { name: item.name, tier: tierOfItem(item) };
            });
            var primary = null;
            for (var i = 0; i < tiers.length; i++) {
                if (!tiers[i].tier) { primary = tiers[i]; break; }
            }
            if (!primary) primary = tiers[0];

            var picked = null;
            for (var j = 0; j < tiers.length; j++) {
                if (tiers[j].name === current) { picked = tiers[j]; break; }
            }

            return {
                kind: 'local',
                key: title,
                label: title,
                workflow: primary.name,
                // 用户当前真正选中的那一档（可能不是默认档）；没有选中时为 ''
                selected: picked ? picked.name : '',
                workflows: tiers.map(function (item) { return item.name; }),
                tiers: tiers,
                tier: picked ? picked.tier : '',
                active: Boolean(picked),
                multi: tiers.length > 1
            };
        });
    }

    // 速度档位选项：给「生成参数」面板等宿主共用的一份实现。
    // 入参可以是工作流数组，也可以直接是 localRows() 产出的一行（宿主已按可见性筛过时用后者）。
    // 返回 [{value: 工作流名, label: 档位名}]，按 高 → 低 → 极速 排序并去重；
    // 只有多档模型才返回内容，单档模型返回空数组（宿主据此隐藏整组控件）。
    function tierOptions(source, current) {
        var row = null;
        if (source && source.tiers) {
            row = source;
        } else {
            row = findRow(localRows(source, { currentWorkflow: current }), current);
        }
        if (!row || !row.multi) return [];
        var seen = {};
        var options = [];
        // 当前档优先占位：两档标签重名时（如 -4step 与 -6step 都叫「极速」）保留用户当前那份
        var ordered = row.tiers.slice().sort(function (a, b) {
            if (a.name === current) return -1;
            if (b.name === current) return 1;
            return 0;
        });
        ordered.forEach(function (item) {
            var label = item.tier || '高';
            if (seen[label]) return;
            seen[label] = true;
            options.push({ value: item.name, label: label });
        });
        return options.sort(function (a, b) {
            return tierSortRank(a.label) - tierSortRank(b.label);
        });
    }
    // 「高」在内部表示成无后缀档（TIER_ORDER 的 '' 键），排序前先换算一次
    function tierSortRank(label) {
        var key = label === '高' ? '' : label;
        return Object.prototype.hasOwnProperty.call(TIER_ORDER, key) ? TIER_ORDER[key] : 9;
    }

    // 在线 provider → 分组（provider.models 支持字符串或 {id,label}）
    function cloudGroups(providers, options) {
        var currentProvider = (options && options.currentProvider) || '';
        var currentModel = (options && options.currentModel) || '';
        var kind = (options && options.kind) || 'image';
        var groups = [];

        (providers || []).forEach(function (provider) {
            if (!provider || provider.enabled === false) return;
            if (filter && filter.rejectProvider(provider.id)) return;
            var rows = (provider.models || []).map(function (model) {
                var id = typeof model === 'string' ? model : (model.id || model.name || '');
                var label = typeof model === 'string' ? model : (model.label || model.displayName || id);
                return {
                    kind: 'cloud',
                    key: provider.id + '/' + id,
                    label: label,
                    provider: provider.id,
                    model: id,
                    active: provider.id === currentProvider && id === currentModel,
                    disabled: Boolean(model && model.disabled)
                };
            }).filter(function (row) {
                return !filter || !filter.rejectModel(kind, provider.id, row.model);
            });
            // 整组模型都被过滤掉时，不留一个空的分组标题
            if (rows.length) groups.push({ title: provider.name || provider.id, rows: rows });
        });
        return groups;
    }

    // 按工作流文件名找它属于哪一行（宿主用来生成按钮上的模型名）
    function findRow(rows, workflow) {
        if (!workflow) return null;
        for (var i = 0; i < (rows || []).length; i++) {
            var list = rows[i].workflows;
            if (list && list.indexOf(workflow) >= 0) return rows[i];
        }
        return null;
    }

    function render(container, options) {
        var opts = options || {};
        var features = opts.features || {};
        var rows = opts.rows || [];
        var groups = opts.groups || [];
        var onPick = typeof opts.onPick === 'function' ? opts.onPick : function () {};
        var onSettings = typeof opts.onSettings === 'function' ? opts.onSettings : null;
        var badgeOf = typeof opts.badgeOf === 'function' ? opts.badgeOf : null;
        // ComfyUI 没运行时，本地行一律置灰并标出来；点不进去，避免选了一个根本跑不了的模型。
        var comfyOffline = Boolean(opts.comfyOffline);
        var offlineText = opts.offlineText || 'ComfyUI 未运行';
        var query = '';

        container.replaceChildren();

        var root = document.createElement('div');
        root.className = 'mp-menu';
        root.dataset.mpHost = opts.host || 'canvas';

        if (features.search || features.refresh) {
            var searchRow = document.createElement('div');
            searchRow.className = 'mp-search-row';

            if (features.search) {
                var input = document.createElement('input');
                input.className = 'mp-search';
                input.type = 'text';
                input.placeholder = features.searchPlaceholder || '搜索模型';
                input.setAttribute('aria-label', '搜索模型');
                input.oninput = function () {
                    query = input.value.trim().toLowerCase();
                    draw();
                };
                searchRow.append(input);
            }

            if (features.refresh) {
                var refresh = document.createElement('button');
                refresh.type = 'button';
                refresh.className = 'mp-refresh';
                refresh.textContent = '↻';
                refresh.title = '刷新模型列表';
                refresh.setAttribute('aria-label', '刷新模型列表');
                refresh.onclick = function () {
                    if (typeof opts.onRefresh !== 'function') return;
                    refresh.disabled = true;
                    Promise.resolve(opts.onRefresh()).finally(function () {
                        refresh.disabled = false;
                    });
                };
                searchRow.append(refresh);
            }
            root.append(searchRow);
        }

        var list = document.createElement('div');
        list.className = 'mp-list';
        root.append(list);
        container.append(root);

        function makeRow(row) {
            var offline = comfyOffline && row.kind === 'local';
            var disabled = Boolean(row.disabled) || offline;
            var item = document.createElement('div');
            item.className = 'mp-item';
            var node = document.createElement('div');
            node.className = 'mp-row'
                + (row.active ? ' is-active' : '')
                + (disabled ? ' is-disabled' : '');
            node.setAttribute('role', 'option');
            node.setAttribute('aria-selected', row.active ? 'true' : 'false');
            node.tabIndex = 0;
            item.append(node);

            var label = document.createElement('span');
            label.className = 'mp-row-label';
            label.textContent = row.label;
            node.append(label);

            // 多档模型：档位标签本身就是切换器。
            // 以前组件只会「显示」档位，切档得由每个宿主自己补一套下拉（文生图补了 200 行），
            // 现在点这里就地展开，宿主只处理 onPick，两边交互和列表自然一致。
            var tierBtn = null;
            if (row.multi && !disabled) {
                tierBtn = document.createElement('button');
                tierBtn.type = 'button';
                tierBtn.className = 'mp-tier is-switch';
                tierBtn.textContent = row.tier || '高';
                tierBtn.title = '切换画质档位';
                tierBtn.setAttribute('aria-haspopup', 'true');
                tierBtn.setAttribute('aria-expanded', 'false');
                tierBtn.setAttribute('aria-label', row.label + ' 画质档位：' + (row.tier || '高'));
                tierBtn.onclick = function (ev) {
                    ev.stopPropagation();
                    if (!sub) return;
                    sub.hidden = !sub.hidden;
                    tierBtn.setAttribute('aria-expanded', String(!sub.hidden));
                };
                node.append(tierBtn);
            } else if (row.tier) {
                var tier = document.createElement('span');
                tier.className = 'mp-tier';
                tier.textContent = row.tier;
                tier.title = '当前档位：' + row.tier;
                node.append(tier);
            }

            if (badgeOf) {
                var text = badgeOf(row);
                if (text) {
                    var badge = document.createElement('span');
                    badge.className = 'mp-badge';
                    badge.textContent = text;
                    badge.title = text;
                    node.append(badge);
                }
            }

            if (offline) {
                var off = document.createElement('span');
                off.className = 'mp-badge is-offline';
                off.textContent = offlineText;
                off.title = '本地模型需要 ComfyUI 在线才能使用';
                node.append(off);
            }

            if (onSettings) {
                var gear = document.createElement('button');
                gear.type = 'button';
                gear.className = 'mp-settings';
                gear.title = '模型设置';
                gear.setAttribute('aria-label', row.label + ' 的模型设置');
                gear.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
                gear.onclick = function (ev) {
                    ev.stopPropagation();
                    onSettings(row);
                };
                node.append(gear);
            }

            var check = document.createElement('span');
            check.className = 'mp-check';
            check.textContent = row.active ? '✓' : '';
            node.append(check);

            // 档位子项：只有多档模型才有，默认收起
            var sub = null;
            if (row.multi && !disabled) {
                sub = document.createElement('div');
                sub.className = 'mp-subrows';
                sub.hidden = true;
                // row.workflow 是默认档；用户当前实际选中的可能是别的档，以 selected 为准。
                // 缺权重的档位不能留在切换器里，否则点下去照样跑不起来。
                var selectable = filter ? filter.workflows(row.workflows || []) : (row.workflows || []).slice();
                var currentWorkflow = row.selected || row.workflow;
                var tierMap = {};
                (row.tiers || []).forEach(function (item) { tierMap[item.name] = item.tier; });
                selectable.forEach(function (name, index) {
                    var pill = document.createElement('button');
                    pill.type = 'button';
                    pill.className = 'mp-subrow' + (name === currentWorkflow ? ' is-active' : '');
                    pill.textContent = tierMap[name] || tierOfWorkflow(name) || '高';
                    pill.title = baseName(name);
                    pill.dataset.tierIndex = String(index);
                    pill.onclick = function (ev) {
                        ev.stopPropagation();
                        row.workflow = name;
                        row.tier = tierMap[name] || tierOfWorkflow(name);
                        row.active = true;
                        // 就地更新选中态，不重绘 —— 重绘会收起子行，连续对比档位很别扭
                        markActive(index);
                        sub.hidden = true;
                        tierBtn.setAttribute('aria-expanded', 'false');
                        onPick(row, { fromTier: true });
                    };
                    sub.append(pill);
                });
                item.append(sub);
            }

            function markActive(index) {
                var rows = list.querySelectorAll('.mp-row');
                for (var i = 0; i < rows.length; i++) {
                    rows[i].classList.remove('is-active');
                    rows[i].setAttribute('aria-selected', 'false');
                    var mark = rows[i].querySelector('.mp-check');
                    if (mark) mark.textContent = '';
                }
                node.classList.add('is-active');
                node.setAttribute('aria-selected', 'true');
                check.textContent = '✓';
                if (tierBtn) tierBtn.textContent = row.tier || '高';
                if (sub) {
                    var pills = sub.querySelectorAll('.mp-subrow');
                    for (var j = 0; j < pills.length; j++) {
                        pills[j].classList.toggle('is-active', Number(pills[j].dataset.tierIndex) === index);
                    }
                }
            }

            node.onclick = function () {
                if (disabled) return;
                // 点行主体：保持用户上次选的那档，别粗暴回落到默认档
                if (row.selected) row.workflow = row.selected;
                onPick(row);
            };
            node.onkeydown = function (ev) {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    node.click();
                }
            };
            return item;
        }

        function draw() {
            list.replaceChildren();
            var hit = 0;
            var sections = [{ title: features.localTitle || '本地 ComfyUI', rows: rows }].concat(groups);

            sections.forEach(function (section) {
                var source = filter ? filter.rows(section.rows || []) : (section.rows || []);
            var matched = source.filter(function (row) {
                    if (!query) return true;
                    return (section.title + ' ' + row.label).toLowerCase().indexOf(query) >= 0;
                });
                if (!matched.length) return;

                var head = document.createElement('div');
                head.className = 'mp-group';
                var span = document.createElement('span');
                span.textContent = section.title;
                head.append(span);
                list.append(head);

                matched.forEach(function (row) {
                    list.append(makeRow(row));
                    hit++;
                });
            });

            if (!hit) {
                var empty = document.createElement('div');
                empty.className = 'mp-empty';
                empty.textContent = opts.emptyText || '没有匹配的模型';
                list.append(empty);
            }
        }

        draw();
        if (filter && filter.bindRedraw) filter.bindRedraw(root, draw);
        return root;
    }

    // 最高支持几 K。以前文生图和画布各写一份同样的正则，加一个 4K 模型要改两处。
    function maxResFor(model) {
        return /^agnes-image-2\.[015](?:-|$)/i.test(String(model || '')) ? 4 : 2;
    }

    // 画面比例：两个宿主共用一份，数组顺序就是菜单里的展示顺序（1:1 最常用，排第一）
    var RATIOS = [
        { l: '1:1', w: 1, h: 1 }, { l: '16:9', w: 16, h: 9 }, { l: '9:16', w: 9, h: 16 },
        { l: '4:3', w: 4, h: 3 }, { l: '3:4', w: 3, h: 4 }, { l: '3:2', w: 3, h: 2 },
        { l: '2:3', w: 2, h: 3 }, { l: '21:9', w: 21, h: 9 }
    ];

    window.ModelPicker = {
        tierOfWorkflow: tierOfWorkflow,
        tierOfItem: tierOfItem,
        tierOptions: tierOptions,
        maxResFor: maxResFor,
        RATIOS: RATIOS,
        localRows: localRows,
        cloudGroups: cloudGroups,
        findRow: findRow,
        render: render
    };
})();
