/* CLI 工具统一管理页：识别 / 安装 / 验证。数据源 /api/cli/*，注册表 CLI/cli_registry.json */
(function () {
    'use strict';

    var state = { clis: [], busy: {}, poll: null, qrPoll: null, after: 0, cacheTs: 0,
                  view: 'list', activeId: '',
                  wf: { items: [], total: 0, workspace: '', sel: '', q: '', prompt: '',
                        check: null, result: '', armed: false, armTimer: null, searchTimer: null },
              capArm: { key: '', timer: null } };
    var $ = function (id) { return document.getElementById(id); };
    var esc = function (s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    };
    var STATE_TEXT = { ready: '就绪', unauthorized: '未登录', outdated: '版本过低', missing: '未安装' };

    function setStatus(text) { if ($('topStatus')) $('topStatus').textContent = text || ''; }
    function setNotice(text) { if ($('notice')) $('notice').textContent = text || ''; }

    function log(tag, text) {
        var box = $('logBox');
        if (!box) return;
        var det = $('logDetails'); if (det) det.open = true;
        var stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        box.textContent += (box.textContent ? '\n' : '') + '[' + stamp + '] ' + (tag ? tag + ' ' : '') + (text == null ? '' : text);
        box.scrollTop = box.scrollHeight;
    }

    function clearLog() { if ($('logBox')) $('logBox').textContent = ''; }

    async function api(url, options) {
        var res = await fetch(url, options);
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(data.detail || data.message || ('HTTP ' + res.status));
        return data;
    }

    function post(url, body) {
        return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    }

    // ---------------------------------------------------------------- 渲染

    var ICON_PATH = {
        verify: '<path d="M6 4l13 8-13 8V4z"/>',
        install: '<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 20h16"/>',
        'qr-login': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 19h2v2"/>',
        logout: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
        credit: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 10h6M9 14h6"/>',
        terminal: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 9l3 3-3 3M12 15h5"/>',
        help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 115 0c0 2-2.5 2-2.5 4M12 17h.01"/>',
        'add-provider': '<path d="M12 5v14M5 12h14"/>',
        scan: '<path d="M4 9V4h5M20 15v5h-5M4 15v5h5M20 9V4h-5"/><circle cx="12" cy="12" r="3"/>',
        'verify-all': '<path d="M3 12l4 4 7-8M16 12l4 4"/>',
        'clear-log': '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'
    };
    var svg = function (name) {
        return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON_PATH[name] || ICON_PATH.help) + '</svg>';
    };
    var chipIcon = function (kind) {
        var d = {
            cmd: '<path d="M4 6l4 4-4 4M10 14h8"/>',
            path: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>',
            version: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
            min: '<path d="M4 17l6-6 4 4 6-8M16 7h4v4"/>'
        }[kind];
        return '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
    };
    var SHORT_LABEL = {
        verify: '验证', install: '安装', 'qr-login': '登录', logout: '退出',
        credit: '积分', terminal: '终端', help: '帮助', 'add-provider': '添加',
        scan: '扫描', 'verify-all': '全检', 'clear-log': '清空'
    };
    var shortLabel = function (act, fallback) {
        if (SHORT_LABEL[act]) return SHORT_LABEL[act];
        return String(fallback || '').replace(/[\s\/·（）()]/g, '').slice(0, 2) || '操作';
    };
    var CHECK_LABEL = { '可执行文件': '文件', '版本探测': '版本', '登录状态': '登录' };
    var shortPath = function (p) {
        if (!p || p === '未找到') return '—';
        var parts = String(p).split(/[\\/]/);
        return parts[parts.length - 1] || String(p);
    };
    function enhanceStaticButtons() {
        document.querySelectorAll('[data-act]').forEach(function (el) {
            if (el.classList.contains('sk-iconbtn')) return;
            var label = el.textContent.trim();
            if (!label) return;
            el.classList.add('sk-iconbtn');
            el.setAttribute('title', label);
            el.setAttribute('aria-label', label);
            el.innerHTML = svg(el.dataset.act) + '<span class="sk-btn-label">' + esc(shortLabel(el.dataset.act, label)) + '</span>';
        });
    }

    function renderSummary() {
        var counts = { ready: 0, unauthorized: 0, outdated: 0, missing: 0 };
        state.clis.forEach(function (c) { counts[c.state] = (counts[c.state] || 0) + 1; });
        var el = $('summary');
        if (!el) return;
        el.className = 'sk-stats';
        var items = [
            ['total', state.clis.length, '工具'],
            ['ready', counts.ready, '就绪'],
            ['unauthorized', counts.unauthorized, '未登录'],
            ['outdated', counts.outdated, '过低'],
            ['missing', counts.missing, '未装']
        ];
        el.innerHTML = items.map(function (it) {
            return '<div class="sk-stat" data-state="' + it[0] + '"' + (it[1] ? '' : ' is-zero')
                + ' title="' + it[2] + ' ' + it[1] + '">' + (it[0] === 'total' ? '' : '<i></i>')
                + '<b>' + it[1] + '</b><span>' + it[2] + '</span></div>';
        }).join('');
    }

    function renderChecks(status) {
        var checks = (status && status.checks) || [];
        if (!checks.length) return '<div class="sk-checks"><span class="sk-check idle" title="尚无检查结果"><i></i>待检</span></div>';
        return '<div class="sk-checks">' + checks.map(function (c) {
            var label = CHECK_LABEL[c.name] || String(c.name).slice(0, 2);
            return '<span class="sk-check ' + (c.ok ? 'ok' : 'bad') + '" title="'
                + esc(c.name) + '：' + esc(c.detail) + '"><i></i>' + esc(label) + '</span>';
        }).join('') + '</div>';
    }

    // ---------------------------------------------------------------- 能力卡
    state.caps = {};
    state.capSel = {};
    state.capInput = {};
    state.capResult = {};
    state.capText = {};

    var CAP_SHORT = {
        'make-3d': '3D',
        'workflow-run': '流图',
        whoami: '状态', 'list-models': '模型', 'model-schema': '参数', 'emit-workflow': '导出',
        balance: '积分', doctor: '自检', models: '模型', usage: '用量', history: '历史', 'dry-run': '预演',
        'user-credit': '积分', 'list-task': '任务', 'query-result': '查询', text2image: '生图',
        version: '版本', 'mcp-list': 'MCP', 'plugin-list': '插件', agents: '代理',
        help: '帮助', exec: '执行', print: '单次'
    };
    var CAP_ICON = {
        status: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
        param: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
        out: '<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 20h16"/>',
        run: '<path d="M6 4l13 8-13 8V4z"/>'
    };
    function capIcon(id) {
        var k = /whoami|doctor|status/.test(id) ? 'status'
            : /schema|param/.test(id) ? 'param'
            : /workflow|emit|export/.test(id) ? 'out'
            : /list|models|usage|history/.test(id) ? 'list' : 'run';
        return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + CAP_ICON[k] + '</svg>';
    }
    function capLabel(field) {
        return field === 'model' ? '模型' : field === 'prompt' ? '提示'
            : field === 'workflow' ? '工作' : field === 'submit_id' ? '任务'
            : String(field || '参数').slice(0, 2);
    }
    function capById(id, capId) {
        var pack = state.caps[id] || {};
        return (pack.capabilities || []).find(function (c) { return c.id === capId; }) || {};
    }
    function saveCapInputs(box, id) {
        if (!box) return;
        box.querySelectorAll('[data-capinput]').forEach(function (inp) {
            state.capInput[id + ':' + (state.capSel[id] || '') + ':' + inp.dataset.capinput] = inp.value;
        });
    }
    function renderCaps(cli) {
        var id = cli.id;
        var pack = state.caps[id];
        var caps = (pack && pack.capabilities) || [];
        if (!caps.length) return '';
        var cur = state.capSel[id];
        if (!caps.some(function (c) { return c.id === cur; })) cur = state.capSel[id] = caps[0].id;
        var active = capById(id, cur);
        var grid = caps.map(function (c) {
            return '<button type="button" class="sk-cap' + (c.id === cur ? ' is-active' : '') + '"'
                + ' data-capact="select" data-cli="' + esc(id) + '" data-cap="' + esc(c.id) + '"'
                + ' title="' + esc(c.label + (c.note ? ' · ' + c.note : '')) + '">'
                + capIcon(c.id) + '<span>' + esc(CAP_SHORT[c.id] || String(c.label || '能力').slice(0, 2)) + '</span></button>';
        }).join('');
        var fields = (active.inputs || []).map(function (f) {
            var key = id + ':' + cur + ':' + f.name;
            if (f.type === 'workflow') {
                var v = state.capInput[key] || state.wf.sel || '';
                var opts = (state.wf.items || []).map(function (w) {
                    return '<option value="' + esc(w.id) + '"' + (w.id === v ? ' selected' : '') + '>' + esc(w.name) + '</option>';
                }).join('');
                return '<label class="sk-cap-field" title="从 CLI/workflows 选择"><span>' + esc(capLabel(f.name)) + '</span>'
                    + '<select data-capinput="workflow" data-sk-done="1">' + (opts || '<option value="">（工作流库为空）</option>') + '</select></label>';
            }
            return '<label class="sk-cap-field" title="' + esc(f.name) + (f.required ? ' · 必填' : '') + '">'
                + '<span>' + esc(capLabel(f.name)) + '</span>'
                + '<input type="text" data-capinput="' + esc(f.name) + '" value="' + esc(state.capInput[key] || '') + '"'
                + ' placeholder="' + esc(f.type === 'alias' ? '如 flux-2' : '输入内容') + '"></label>';
        }).join('');
        var extraKey = id + ':' + cur + ':__params';
        fields += '<label class="sk-cap-field is-extra" title="可选：key=value 追加为 --key value">'
            + '<span>附加</span><input type="text" data-capinput="__params" value="' + esc(state.capInput[extraKey] || '')
            + '" placeholder="width=1024 steps=20"></label>';
        var run = '<button type="button" class="sk-cap-run' + (active.billing ? ' is-billing' : '') + '" data-capact="run" data-cli="' + esc(id) + '"'
            + (pack && pack.available ? '' : ' disabled title="可执行文件未找到"') + '>'
            + capIcon('run') + '<span>运行</span></button>';
        return '<div class="sk-caps" data-capbox="' + esc(id) + '">'
            + '<div class="sk-caps-head">' + capIcon('list') + '<b>能力</b><span class="sk-caps-count">' + caps.length + '</span>'
            + '<i class="sk-cap-dot ' + (pack && pack.available ? 'ok' : 'bad') + '"></i>'
            + '<span class="sk-caps-hint">' + (pack && pack.available ? '离线可执行 · 不扣额度' : '可执行文件未找到') + '</span></div>'
            + '<div class="sk-cap-grid">' + grid + '</div>'
            + '<div class="sk-cap-form">' + fields + run + '</div>'
            + '<div class="sk-cap-result">' + (state.capResult[id] || '') + '</div></div>';
    }
    function setCapResult(id, html) {
        state.capResult[id] = html;
        var host = document.querySelector('[data-capbox="' + id + '"] .sk-cap-result');
        if (host) host.innerHTML = html;
    }
    function resetCapArm() {
        clearTimeout(state.capArm.timer);
        state.capArm.key = '';
        document.querySelectorAll('.sk-cap-run.is-armed').forEach(function (b) {
            b.classList.remove('is-armed');
            var sp = b.querySelector('span'); if (sp) sp.textContent = '运行';
        });
    }
    function parseParams(text) {
        var out = {};
        String(text || '').split(/[\s,;，；]+/).forEach(function (tok) {
            var i = tok.indexOf('=');
            if (i > 0) out[tok.slice(0, i)] = tok.slice(i + 1);
        });
        return out;
    }
    async function runCapability(id, btn) {
        var box = btn.closest('[data-capbox]');
        var capId = state.capSel[id];
        var input = {}, params = {};
        box.querySelectorAll('[data-capinput]').forEach(function (inp) {
            var v = inp.value.trim();
            if (!v) return;
            if (inp.dataset.capinput === '__params') params = parseParams(v);
            else input[inp.dataset.capinput] = v;
        });
        saveCapInputs(box, id);
        btn.disabled = true;
        btn.classList.add('is-running');
        log('[能力]', id + ' / ' + capId + ' 开始 ...');
        try {
            var data = await post('/api/cli/run', { cli: id, capability: capId, input: input, params: params });
            var text = typeof data.data === 'string' ? data.data : JSON.stringify(data.data, null, 2);
            state.capText[id] = text || '';
            log('[能力]', id + ' / ' + capId + ' 完成 · ' + (data.elapsed_ms || 0) + 'ms\n' + String(text || '').slice(0, 4000));
            var modelLinks = (data.models || []).map(function (mo) {
                return '<a class="sk-cap-link" href="' + esc(mo.url) + '" target="_blank" rel="noopener">'
                    + esc(String(mo.ext || 'model').toUpperCase()) + ' · ' + esc(String(mo.filename || '模型')) + ' ↗</a>';
            }).join('');
            var firstModel = (data.models || [])[0];
            var viewer = firstModel && /^(glb|gltf)$/.test(firstModel.ext || '')
                ? '<model-viewer class="sk-cap-viewer" src="' + esc(firstModel.url) + '" camera-controls auto-rotate shadow-intensity="1"></model-viewer>' : '';
            var link = data.url && !(data.models || []).length
                ? '<a class="sk-cap-link" href="' + esc(data.url) + '" target="_blank" rel="noopener">' + esc(data.type || '产物') + ' ↗</a>' : '';
            var shots = (data.images || []).map(function (im) {
                return '<a class="sk-cap-shot" href="' + esc(im.url) + '" target="_blank" rel="noopener">'
                    + '<img src="' + esc(im.url) + '" alt="' + esc(im.filename || '') + '"></a>';
            }).join('');
            var warn = data.warning ? '<span class="sk-cap-bad">' + esc(data.warning) + '</span>' : '';
            setCapResult(id, '<span class="sk-cap-ok">完成 ' + (data.elapsed_ms || 0) + 'ms'
                + (data.images ? ' · ' + data.images.length + ' 张图' : '') + '</span>' + link + modelLinks + warn
                + '<button type="button" class="sk-cap-copy" data-capact="copy" data-cli="' + esc(id) + '"><span>复制结果</span></button>'
                + (shots ? '<div class="sk-cap-shots">' + shots + '</div>' : '') + viewer);
        } catch (e) {
            log('[能力]', id + ' / ' + capId + ' 失败：' + (e.message || e));
            setCapResult(id, '<span class="sk-cap-bad">' + esc(e.message || String(e)) + '</span>');
        } finally {
            btn.disabled = false;
            btn.classList.remove('is-running');
        }
    }
    function copyCapText(id) {
        var text = state.capText[id] || '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function () {});
        } else {
            var ta = document.createElement('textarea');
            ta.value = text; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); } catch (e) {}
            ta.remove();
        }
        log('[能力]', id + '：结果已复制到剪贴板');
    }
    async function loadCaps() {
        try {
            var data = await api('/api/cli/capabilities');
            (data.clis || []).forEach(function (c) { state.caps[c.id] = c; });
            if (state.clis.length) render();
        } catch (e) {
            log('[能力]', '能力卡接口不可用，请重启服务：' + (e.message || e));
        }
        loadWorkflows();
    }
    document.addEventListener('click', function (ev) {
        var el = ev.target.closest('[data-capact]');
        if (!el) { if (state.capArm.key) resetCapArm(); return; }
        if (el.disabled) return;
        var act = el.dataset.capact, id = el.dataset.cli;
        if (act === 'select') {
            var box = el.closest('[data-capbox]');
            saveCapInputs(box, id);
            state.capSel[id] = el.dataset.cap;
            if (box) box.outerHTML = renderCaps({ id: id });
        } else if (act === 'run') {
            var cap = capById(id, state.capSel[id]);
            if (cap.billing) {
                var key = id + '/' + state.capSel[id];
                if (state.capArm.key !== key) {
                    resetCapArm();
                    state.capArm.key = key;
                    el.classList.add('is-armed');
                    var sp = el.querySelector('span'); if (sp) sp.textContent = '再点确认';
                    state.capArm.timer = setTimeout(resetCapArm, 4000);
                    return;
                }
                resetCapArm();
            }
            runCapability(id, el);
        }
        else if (act === 'copy') copyCapText(id);
    });
    loadCaps();

    function renderCard(cli) {
        var id = esc(cli.id);
        var st = cli.status || {};
        var login = cli.login || {};
        var help = cli.help || {};
        var busy = !!state.busy[cli.id];
        var off = cli.enabled === false;
        var btn = function (act, label, cls, disabled) {
            var short = act === 'install' && st.installed ? '更新' : shortLabel(act, label);
            return '<button class="btn small sk-iconbtn ' + (cls || '') + '" type="button" data-act="' + act
                + '" data-id="' + id + '"' + ((disabled || busy || off) ? ' disabled' : '')
                + ' title="' + esc(label) + '" aria-label="' + esc(label) + '">'
                + svg(act) + '<span class="sk-btn-label">' + esc(short) + '</span></button>';
        };
        var chips = [
            ['cmd', cli.command || '—', '命令：' + (cli.command || '—')],
            ['path', shortPath(st.path), '路径：' + (st.path || '未找到')],
            ['version', st.version || '—', '版本：' + (st.version || '未知')],
            ['min', cli.min_version ? '≥' + cli.min_version : '—', '最低版本：' + (cli.min_version || '不限')]
        ].map(function (c) {
            return '<span class="sk-chip" title="' + esc(c[2]) + '">' + chipIcon(c[0]) + '<b>' + esc(c[1]) + '</b></span>';
        }).join('');
        var actions = '';
        actions += btn('verify', '验证', 'is-main');
        if (cli.can_install) actions += btn('install', st.installed ? '重新安装 / 更新' : '安装', 'primary', !cli.can_install);
        if (login.mode === 'qr') {
            actions += btn('qr-login', '扫码登录');
            if (login.logout) actions += btn('logout', '退出登录', 'is-danger');
            if (login.credit) actions += btn('credit', '查询积分');
        }
        if (cli.can_terminal) actions += btn('terminal', '打开登录终端');
        if (help.endpoint) {
            var options = (help.commands || ['']).map(function (cmd) {
                return '<option value="' + esc(cmd) + '">' + esc(cmd || (cli.command + ' --help')) + '</option>';
            }).join('');
            actions += '<span class="spacer"></span><select data-role="help-cmd" data-id="' + id + '">' + options + '</select>';
            actions += btn('help', '命令帮助');
        }
        if (cli.provider) {
            actions += '<span class="spacer"></span>';
            actions += cli.provider_added
                ? '<span class="sk-added" title="已添加为生图通道"><i></i></span>'
                : btn('add-provider', '添加为生图通道');
        }
        var qr = login.mode === 'qr'
            ? '<div class="qr-box" id="qr-' + id + '"><img alt="登录二维码"><pre></pre></div>' : '';
        var stateLabel = STATE_TEXT[cli.state] || cli.state;
        return '<section class="cli-card" data-card="' + id + '">'
            + (off ? '<div class="sk-msg" style="margin-bottom:10px">此 CLI 已停用；启用后才能识别、安装与执行。</div>' : '')
            + '<div class="cli-head">'
            + '<span class="sk-toolmark" aria-hidden="true">' + esc(String(cli.name || '?').slice(0, 1)) + '</span>'
            + '<div class="sk-cardid"><span class="cli-name">' + esc(cli.name) + '</span>'
            + '<button type="button" class="sk-info" title="' + esc(cli.desc || '') + '" aria-label="说明">i</button></div>'
            + '<span class="sk-state" data-state="' + esc(cli.state) + '" title="' + esc(stateLabel) + '" aria-label="' + esc(stateLabel) + '"><i></i></span>'
            + '</div>'
            + '<div class="sk-chips">' + chips + '</div>'
            + renderChecks(st)
            + (st.message ? '<div class="sk-msg" title="' + esc(st.message) + '">' + esc(st.message) + '</div>' : '')
            + '<div class="actions">' + actions + '</div>'
            + (off ? '' : renderCaps(cli) + renderWorkflows(cli))
            + qr + '</section>';
    }

    function renderTile(cli) {
        var st = cli.status || {};
        var off = cli.enabled === false;
        var label = off ? '已停用' : (STATE_TEXT[cli.state] || cli.state || '未知');
        return '<div class="cli-tile' + (off ? ' is-off' : '') + '" data-open="' + esc(cli.id)
            + '" role="button" tabindex="0" title="点击查看详情">'
            + '<div class="cli-tile-top">'
            + '<span class="cli-tile-mark">' + esc(String(cli.name || '?').slice(0, 1)) + '</span>'
            + '<span class="cli-tile-name">' + esc(cli.name) + '</span>'
            + '<span class="sk-state" data-state="' + esc(off ? 'off' : cli.state) + '" title="' + esc(label) + '"><i></i></span>'
            + '</div>'
            + '<div class="cli-tile-meta">'
            + '<span><b>' + esc(cli.command || '—') + '</b></span>'
            + '<span>版本 <b>' + esc(st.version || '—') + '</b></span>'
            + '<span>' + esc(label) + '</span>'
            + (cli.provider_added ? '<span class="cli-tile-tag">通道</span>' : '')
            + '</div>'
            + '<div class="cli-tile-foot">'
            + '<span class="cli-tile-hint">' + (off ? '停用中 · 不参与识别' : '点击查看详情 ›') + '</span>'
            + '<span class="sk-switch' + (off ? '' : ' is-on') + '" data-toggle="' + esc(cli.id)
            + '" data-enabled="' + (off ? 'false' : 'true') + '" role="switch" aria-checked="'
            + (off ? 'false' : 'true') + '" title="' + (off ? '启用' : '停用') + '"></span>'
            + '</div></div>';
    }

    function render() {
        var host = $('cliList'), home = $('cliHome'), detail = $('cliDetail');
        if (!host) return;
        var inDetail = state.view === 'detail'
            && state.clis.some(function (c) { return c.id === state.activeId; });
        if (!inDetail) state.view = 'list';
        if (home) home.hidden = inDetail;
        if (detail) detail.hidden = !inDetail;
        if (inDetail) {
            var cli = state.clis.find(function (c) { return c.id === state.activeId; });
            var card = $('cliDetailCard');
            if (card) card.innerHTML = renderCard(cli);
            var t = $('detailTitle'); if (t) t.textContent = cli.name || cli.id;
            var ds = $('detailState');
            if (ds) ds.textContent = cli.enabled === false ? '已停用' : (STATE_TEXT[cli.state] || cli.state || '');
        } else {
            host.innerHTML = state.clis.length
                ? state.clis.map(renderTile).join('')
                : '<section class="block"><div class="block-desc">注册表为空，请在 CLI/cli_registry.json 中添加 CLI。</div></section>';
        }
        renderSummary();
    }

    function showDetail(id) {
        if (!state.clis.some(function (c) { return c.id === id; })) return;
        state.view = 'detail'; state.activeId = id; render();
        try { window.scrollTo(0, 0); } catch (e) {}
    }
    function showList() { state.view = 'list'; state.activeId = ''; render(); }
    async function toggleCli(id, next) {
        try {
            var d = await post('/api/cli/toggle', { id: id, enabled: next });
            patch(d.cli ? [d.cli] : []);
            setStatus(id + (next ? ' 已启用' : ' 已停用'));
            log('[启停]', id + (next ? ' 已启用，下次识别会包含它' : ' 已停用，不再参与识别'));
        } catch (e) {
            setNotice(e.message || String(e));
            log('[启停]', '失败：' + (e.message || e));
        }
    }

    function patch(clis) {
        clis.forEach(function (item) {
            var target = state.clis.find(function (c) { return c.id === item.id; });
            if (!target) return;
            Object.keys(item).forEach(function (k) { target[k] = item[k]; });
        });
        render();
    }

    // ---------------------------------------------------------------- 识别 / 验证

    async function scan(force) {
        setStatus(force ? '正在重新识别...' : '正在读取已记住的识别结果...');
        try {
            var data = await api('/api/cli/list' + (force ? '?refresh=1' : ''));
            state.clis = data.clis || [];
            state.cacheTs = data.cache_ts || 0;
            render();
            var stamp = state.cacheTs
                ? new Date(state.cacheTs * 1000).toLocaleString('zh-CN', { hour12: false })
                : '未知';
            setStatus((data.cached ? '已记住 · 上次识别 ' + stamp : '识别完成 · ' + stamp) + ' · ' + data.platform);
            setNotice(data.cached
                ? '已载入上次识别结果，不会自动重新识别。只有上次中断、出错，或点「全部识别」才会重探。'
                : '本次识别结果已记住，下次打开直接显示。');
            log('[识别]', (data.cached ? '读取记住的结果' : '完成并记住') + '，共 '
                + state.clis.length + ' 个 CLI · ' + stamp);
        } catch (e) {
            setStatus('识别失败');
            setNotice(e.message || String(e));
            log('[识别]', '失败：' + (e.message || e));
        }
    }

    async function verify(id) {
        var label = id === '*' ? '全部 CLI' : id;
        log('[验证]', '开始验证 ' + label + ' ...');
        try {
            var data = await post('/api/cli/verify', { id: id });
            patch(data.clis || []);
            (data.clis || []).forEach(function (c) {
                log('[验证]', c.id + ' → ' + (STATE_TEXT[c.state] || c.state)
                    + '（installed=' + !!(c.status && c.status.installed)
                    + ', auth_ok=' + (c.status ? c.status.auth_ok : '?') + '）');
            });
            setStatus('验证完成');
        } catch (e) {
            setNotice(e.message || String(e));
            log('[验证]', '失败：' + (e.message || e));
        }
    }

    // ---------------------------------------------------------------- 安装任务

    function stopPoll() {
        if (state.poll) { clearInterval(state.poll); state.poll = null; }
    }

    async function install(id) {
        state.busy[id] = true;
        render();
        log('[安装]', id + '：启动后台安装任务 ...');
        try {
            var data = await post('/api/cli/install', { id: id, action: 'install' });
            if (data.reused) log('[安装]', '该 CLI 已有运行中的任务，继续显示其日志');
            state.after = 0;
            stopPoll();
            state.poll = setInterval(function () { pollTask(data.task_id); }, 600);
            pollTask(data.task_id);
        } catch (e) {
            state.busy[id] = false;
            render();
            setNotice(e.message || String(e));
            log('[安装]', '启动失败：' + (e.message || e));
        }
    }

    async function pollTask(taskId) {
        try {
            var data = await api('/api/cli/task?id=' + encodeURIComponent(taskId) + '&after=' + state.after);
            state.after = data.next;
            (data.lines || []).forEach(function (line) { log('', line); });
            if (data.status !== 'running') {
                stopPoll();
                state.busy[data.cli] = false;
                if (data.log_file) log('[安装]', '完整日志：' + data.log_file);
                if (data.verify) {
                    patch([{ id: data.cli, status: data.verify.status, state: data.verify.state }]);
                    log('[安装]', '自动验证结果：' + (STATE_TEXT[data.verify.state] || data.verify.state));
                }
                setStatus('安装任务结束 · ' + data.status + ' · ' + data.elapsed + 's');
                await scan();
            }
        } catch (e) {
            stopPoll();
            Object.keys(state.busy).forEach(function (k) { state.busy[k] = false; });
            render();
            log('[安装]', '日志轮询失败：' + (e.message || e));
        }
    }

    // ---------------------------------------------------------------- 登录 / 帮助 / 积分

    function findCli(id) { return state.clis.find(function (c) { return c.id === id; }) || {}; }

    function showQr(id, text, qrUrl) {
        var box = $('qr-' + id);
        if (!box) return;
        var img = box.querySelector('img');
        var pre = box.querySelector('pre');
        if (qrUrl && img) { img.src = qrUrl; img.style.display = ''; } else if (img) { img.removeAttribute('src'); img.style.display = 'none'; }
        if (pre) pre.textContent = text || '等待 CLI 输出登录二维码...';
        box.classList.add('show');
    }

    function stopQrPoll() {
        if (state.qrPoll) { clearInterval(state.qrPoll); state.qrPoll = null; }
    }

    async function qrLogin(id) {
        var cli = findCli(id);
        var login = cli.login || {};
        log('[登录]', cli.name + '：发起扫码登录 ...');
        try {
            var data = await post(login.start, {});
            showQr(id, data.text, data.qr_url);
            if (data.running) {
                stopQrPoll();
                state.qrPoll = setInterval(async function () {
                    try {
                        var st = await api(login.poll);
                        showQr(id, st.text, st.qr_url);
                        if (!st.running) {
                            stopQrPoll();
                            log('[登录]', '登录流程结束，开始验证');
                            await verify(id);
                        }
                    } catch (e) { log('[登录]', '轮询失败：' + (e.message || e)); }
                }, 3000);
            } else {
                await verify(id);
            }
        } catch (e) {
            setNotice(e.message || String(e));
            log('[登录]', '失败：' + (e.message || e));
        }
    }

    async function simpleAction(id, kind) {
        var cli = findCli(id);
        var login = cli.login || {};
        if (kind === 'terminal') {
            try {
                var data = await post('/api/cli/terminal', { id: id });
                log('[终端]', '已打开 ' + data.path + '，完成登录后点「验证」刷新状态');
            } catch (e) { log('[终端]', '失败：' + (e.message || e)); }
            return;
        }
        if (kind === 'logout') {
            if (!confirm('确认退出 ' + cli.name + ' 登录？')) return;
            try { await post(login.logout, {}); log('[登出]', cli.name + ' 已退出'); await verify(id); }
            catch (e) { log('[登出]', '失败：' + (e.message || e)); }
            return;
        }
        if (kind === 'credit') {
            try {
                var cr = await api(login.credit);
                log('[积分]', cli.name + '：' + (typeof cr.raw === 'string' ? cr.raw : JSON.stringify(cr.raw)));
            } catch (e) { log('[积分]', '失败：' + (e.message || e)); }
            return;
        }
        if (kind === 'help') {
            var card = document.querySelector('[data-card="' + id + '"]');
            var sel = card && card.querySelector('[data-role="help-cmd"]');
            var cmd = sel ? sel.value : '';
            try {
                var hp = await post((cli.help || {}).endpoint, { command: cmd || undefined });
                log('[帮助]', cli.name + ' / ' + (cmd || cli.command) + '\n' + (hp.output || hp.text || hp.message || '无输出'));
            } catch (e) { log('[帮助]', '失败：' + (e.message || e)); }
        }
    }

    async function addProviderChannel(id) {
        state.busy[id] = true; render();
        try {
            var data = await post('/api/cli/add-provider', { id: id });
            if (data.cli) patch([data.cli]);
            setStatus(data.added ? '已添加为生图通道' : '通道已存在');
            setNotice(data.message || '');
            log('[通道]', data.message || (data.added ? '添加成功' : '已存在'));
            if (data.added) {
                try { new BroadcastChannel('studio-api').postMessage({ type: 'providers-changed' }); } catch (e) {}
            }
        } catch (e) {
            setNotice(e.message || String(e));
            log('[通道]', '失败：' + (e.message || e));
        } finally {
            state.busy[id] = false; render();
        }
    }

    // ---------------------------------------------------------------- 事件

    document.addEventListener('click', function (ev) {
        var nav = ev.target.closest('[data-nav]');
        if (nav) { if (nav.dataset.nav === 'back') showList(); return; }
        var tog = ev.target.closest('[data-toggle]');
        if (tog) { toggleCli(tog.dataset.toggle, tog.dataset.enabled !== 'true'); return; }
        var open = ev.target.closest('[data-open]');
        if (open) { showDetail(open.dataset.open); return; }
        var el = ev.target.closest('[data-act]');
        if (!el || el.disabled) return;
        var act = el.dataset.act;
        var id = el.dataset.id;
        if (act === 'scan') scan(true);
        else if (act === 'verify-all') verify('*');
        else if (act === 'verify') verify(id);
        else if (act === 'install') install(id);
        else if (act === 'clear-log') clearLog();
        else if (act === 'add-provider') addProviderChannel(id);
        else if (act === 'qr-login') qrLogin(id);
        else if (['terminal', 'logout', 'credit', 'help'].indexOf(act) >= 0) simpleAction(id, act);
    });
    document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        var el = ev.target.closest && ev.target.closest('[data-open]');
        if (el) { ev.preventDefault(); showDetail(el.dataset.open); }
    });

    enhanceStaticButtons();
    scan();
    // ---------------------------------------------------------------- 工作流库（Comfy）

    function refreshWfBox() {
        var box = document.querySelector('[data-wfbox="comfy"]');
        if (box) box.outerHTML = renderWorkflows({ id: 'comfy' });
    }
    function refreshCapBox() {
        var box = document.querySelector('[data-capbox="comfy"]');
        if (box) box.outerHTML = renderCaps({ id: 'comfy' });
    }
    function setWfResult(html) {
        state.wf.result = html || '';
        var host = document.querySelector('[data-wfbox="comfy"] .sk-wf-result');
        if (host) host.innerHTML = state.wf.result;
    }
    function wfCheckRows(c) {
        var rows = '';
        (c.missing_nodes || []).forEach(function (n) {
            rows += '<label class="sk-wf-row"><input type="checkbox" data-wfitem="node" value="' + esc(n.name) + '" checked>'
                + '<span>' + esc(n.name) + '</span>' + (n.source ? '<small>' + esc(n.source) + '</small>' : '<small>插件</small>') + '</label>';
        });
        (c.missing_models || []).forEach(function (m) {
            rows += '<label class="sk-wf-row' + (m.installable ? '' : ' is-off') + '"><input type="checkbox" data-wfitem="model" value="' + esc(m.name) + '"'
                + (m.installable ? ' checked' : ' disabled') + '><span>' + esc(m.name) + '</span>'
                + '<small>' + (m.installable ? esc(m.path) : '需手动放置') + '</small></label>';
        });
        return rows;
    }
    function renderWorkflows(cli) {
        if (cli.id !== 'comfy') return '';
        var wf = state.wf, items = wf.items || [];
        var cur = items.find(function (x) { return x.id === wf.sel; }) || items[0] || null;
        if (cur) wf.sel = cur.id;
        var c = wf.check;
        var canInstall = !!(c && c.online && c.workspace_valid);
        var list = items.length ? items.map(function (x) {
            return '<button type="button" data-sk-done="1" class="sk-wf-item' + (cur && x.id === cur.id ? ' is-active' : '') + '"'
                + ' data-wfact="select" data-wfid="' + esc(x.id) + '" title="' + esc(x.desc || x.id) + '">'
                + capIcon('workflow') + '<span class="sk-wf-name">' + esc(x.name) + '</span>'
                + (x.tags || []).slice(0, 2).map(function (tag) { return '<i class="sk-wf-tag">' + esc(tag) + '</i>'; }).join('')
                + '<em>' + esc(String(x.format || 'api').toUpperCase()) + '</em></button>';
        }).join('') : '<div class="sk-wf-empty">把工作流 .json 放进 CLI/workflows/ 后点「刷新」</div>';
        var meta = cur
            ? '<span class="sk-wf-meta">' + esc(cur.id) + ' · ' + esc(String(cur.format).toUpperCase())
              + ' · ' + (cur.node_count || 0) + ' 节点 / ' + (cur.model_count || 0) + ' 模型'
              + ((cur.tags || []).length ? ' · ' + esc((cur.tags || []).join(' / ')) : '') + '</span>'
            : '';
        var checkHtml = c
            ? '<div class="sk-wf-check"><div class="sk-wf-group">缺 ' + (c.missing_nodes || []).length + ' 插件 / '
                + (c.missing_models || []).length + ' 模型 · 勾选后两段式确认安装</div>'
                + (wfCheckRows(c) || '<div class="sk-wf-note">没有缺失项，可直接运行</div>')
                + '<div class="sk-wf-note">' + esc(c.note || '') + '</div></div>'
            : '';
        var hint = wf.workspace ? esc(wf.workspace.replace(/^.*[\\/]/, '..' + '/')) : '未配置 workspace';
        return '<div class="sk-wf" data-wfbox="comfy">'
            + '<div class="sk-wf-head">' + capIcon('workflow') + '<b>工作流库</b>'
            + '<span class="sk-caps-count">' + (wf.total || items.length) + '</span>'
            + '<i class="sk-cap-dot ' + (c ? (c.online ? 'ok' : 'bad') : '') + '"></i>'
            + '<span class="sk-caps-hint">' + (c ? (c.online ? 'ComfyUI 在线' : 'ComfyUI 离线') : hint) + '</span></div>'
            + '<div class="sk-wf-bar"><input type="text" class="sk-wf-search" data-wfsearch value="' + esc(wf.q) + '"'
            + ' placeholder="标签 / 名称 · 自动选最匹配" title="输入标签或关键词，自动按标签>名称>描述排序">'
            + '<button type="button" data-sk-done="1" class="sk-wf-btn" data-wfact="reload">' + capIcon('refresh') + '<span>刷新</span></button></div>'
            + '<div class="sk-wf-list">' + list + '</div>' + meta
            + '<div class="sk-wf-bar"><input type="text" class="sk-wf-search" data-wfprompt value="' + esc(wf.prompt) + '"'
            + ' placeholder="提示词（写入 CLIPTextEncode，可留空用工作流原值）"></div>'
            + '<div class="sk-wf-actions">'
            + '<button type="button" data-sk-done="1" class="sk-wf-btn" data-wfact="pick"' + (cur ? '' : ' disabled') + '>' + capIcon('list') + '<span>自动选</span></button>'
            + '<button type="button" data-sk-done="1" class="sk-wf-btn" data-wfact="check"' + (cur ? '' : ' disabled') + '>' + capIcon('status') + '<span>检查依赖</span></button>'
            + '<button type="button" data-sk-done="1" class="sk-wf-btn is-main" data-wfact="run"' + (cur ? '' : ' disabled') + '>' + capIcon('run') + '<span>运行</span></button>'
            + '<button type="button" data-sk-done="1" class="sk-wf-btn is-danger' + (wf.armed ? ' is-armed' : '') + '" data-wfact="install"'
            + (canInstall ? '' : ' disabled') + '>' + capIcon('install') + '<span>' + (wf.armed ? '再点确认' : '安装勾选') + '</span></button>'
            + '</div>' + checkHtml + '<div class="sk-wf-result">' + (wf.result || '') + '</div></div>';
    }

    async function loadWorkflows(keepFocus) {
        try {
            var data = await api('/api/cli/workflows?q=' + encodeURIComponent(state.wf.q || ''));
            state.wf.items = data.items || [];
            state.wf.total = data.total || 0;
            state.wf.workspace = data.workspace || '';
            if (!state.wf.items.some(function (x) { return x.id === state.wf.sel; })) {
                state.wf.sel = state.wf.items.length ? state.wf.items[0].id : '';
                state.wf.check = null;
            }
            state.capInput['comfy:workflow-run:workflow'] = state.wf.sel;
            if (state.clis.length) render();
            if (keepFocus) {
                var inp = document.querySelector('[data-wfsearch]');
                if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
            }
        } catch (e) {
            log('[工作流]', '列表接口不可用，请重启服务：' + (e.message || e));
        }
    }

    async function pickWorkflow() {
        try {
            var data = await api('/api/cli/workflows?q=' + encodeURIComponent(state.wf.q || '') + '&pick=1');
            var best = data.best;
            if (best && best.id) {
                state.wf.sel = best.id; state.wf.check = null;
                state.capInput['comfy:workflow-run:workflow'] = best.id;
                state.wf.result = '<span class="sk-cap-ok">已选 ' + esc(best.name || best.id) + '</span><span class="sk-wf-note">' + esc(best.id) + '</span>';
            } else {
                state.wf.result = '<span class="sk-cap-bad">没有匹配的工作流</span>';
            }
            refreshCapBox(); refreshWfBox();
            log('[工作流]', '自动选：' + (best ? best.id : '无匹配'));
        } catch (e) { setWfResult('<span class="sk-cap-bad">' + esc(e.message || String(e)) + '</span>'); }
    }

    async function checkWorkflow() {
        if (!state.wf.sel) return;
        try {
            var c = await api('/api/cli/workflows/check?id=' + encodeURIComponent(state.wf.sel));
            state.wf.check = c;
            state.wf.armed = false;
            state.wf.result = '<span class="sk-cap-ok">检查完成</span><span class="sk-wf-note">缺 '
                + (c.missing_nodes || []).length + ' 插件 / ' + (c.missing_models || []).length + ' 模型</span>';
            refreshWfBox();
            log('[工作流]', c.id + ' · ' + (c.note || ''));
        } catch (e) {
            setWfResult('<span class="sk-cap-bad">' + esc(e.message || String(e)) + '</span>');
        }
    }

    async function runWorkflow(btn) {
        if (!state.wf.sel) return;
        btn.disabled = true; btn.classList.add('is-running');
        log('[工作流]', '运行 ' + state.wf.sel + ' ...');
        try {
            var data = await post('/api/cli/run', {
                cli: 'comfy', capability: 'workflow-run',
                input: { workflow: state.wf.sel, prompt: state.wf.prompt || '' }, params: {}
            });
            var shots = (data.images || []).map(function (im) {
                return '<a class="sk-cap-shot" href="' + esc(im.url) + '" target="_blank" rel="noopener">'
                    + '<img src="' + esc(im.url) + '" alt="' + esc(im.filename || '') + '"></a>';
            }).join('');
            var warn = data.warning ? '<span class="sk-cap-bad">' + esc(data.warning) + '</span>' : '';
            setWfResult('<span class="sk-cap-ok">完成 ' + (data.elapsed_ms || 0) + 'ms'
                + (data.images ? ' · ' + data.images.length + ' 张图' : '') + '</span>' + warn
                + (shots ? '<div class="sk-cap-shots">' + shots + '</div>' : ''));
            log('[工作流]', '完成 · ' + (data.elapsed_ms || 0) + 'ms');
        } catch (e) {
            setWfResult('<span class="sk-cap-bad">' + esc(e.message || String(e)) + '</span>');
            log('[工作流]', '失败：' + (e.message || e));
        } finally {
            btn.disabled = false; btn.classList.remove('is-running');
        }
    }

    function resetWfArm() {
        clearTimeout(state.wf.armTimer);
        state.wf.armed = false;
        var b = document.querySelector('[data-wfact="install"]');
        if (b) { b.classList.remove('is-armed'); var s = b.querySelector('span'); if (s) s.textContent = '安装勾选'; }
    }
    async function installWorkflow(btn) {
        if (!state.wf.armed) {
            state.wf.armed = true;
            btn.classList.add('is-armed');
            var s = btn.querySelector('span'); if (s) s.textContent = '再点确认';
            state.wf.armTimer = setTimeout(resetWfArm, 4000);
            return;
        }
        resetWfArm();
        var box = btn.closest('[data-wfbox]');
        var items = [];
        box.querySelectorAll('[data-wfitem]').forEach(function (inp) {
            if (inp.checked) items.push({ kind: inp.dataset.wfitem, name: inp.value });
        });
        if (!items.length) { setWfResult('<span class="sk-cap-bad">没有勾选可安装项</span>'); return; }
        btn.disabled = true;
        log('[工作流]', '确认安装 ' + items.length + ' 项 ...');
        try {
            var data = await post('/api/cli/workflows/install', { id: state.wf.sel, items: items });
            var html = (data.results || []).map(function (r) {
                return '<span class="' + (r.ok ? 'sk-cap-ok' : 'sk-cap-bad') + '">' + esc(r.name) + ' · '
                    + (r.ok ? '已提交' : '失败') + '</span>';
            }).join('');
            setWfResult(html + '<span class="sk-wf-note">' + esc(data.note || '') + '</span>');
            (data.results || []).forEach(function (r) { log('[安装]', r.name + ' · ' + String(r.message || '').slice(0, 400)); });
        } catch (e) {
            setWfResult('<span class="sk-cap-bad">' + esc(e.message || String(e)) + '</span>');
            log('[安装]', '失败：' + (e.message || e));
        } finally { btn.disabled = false; }
    }

    document.addEventListener('click', function (ev) {
        var el = ev.target.closest('[data-wfact]');
        if (!el) { if (state.wf.armed) resetWfArm(); return; }
        if (el.disabled) return;
        var act = el.dataset.wfact, wf = state.wf;
        if (act === 'select') {
            wf.sel = el.dataset.wfid; wf.check = null; wf.result = ''; resetWfArm();
            state.capInput['comfy:workflow-run:workflow'] = wf.sel;
            refreshCapBox(); refreshWfBox();
        } else if (act === 'reload') { wf.check = null; loadWorkflows(false); }
        else if (act === 'pick') pickWorkflow();
        else if (act === 'check') checkWorkflow();
        else if (act === 'run') runWorkflow(el);
        else if (act === 'install') installWorkflow(el);
    });
    document.addEventListener('input', function (ev) {
        var el = ev.target;
        if (!el.dataset) return;
        if (el.dataset.wfsearch !== undefined) {
            state.wf.q = el.value;
            clearTimeout(state.wf.searchTimer);
            state.wf.searchTimer = setTimeout(function () { loadWorkflows(true); }, 350);
        } else if (el.dataset.wfprompt !== undefined) {
            state.wf.prompt = el.value;
        }
    });
    document.addEventListener('change', function (ev) {
        var el = ev.target;
        if (el.dataset && el.dataset.capinput === 'workflow') {
            state.wf.sel = el.value; state.wf.check = null; state.wf.result = '';
            state.capInput['comfy:workflow-run:workflow'] = el.value;
            refreshWfBox();
        }
    });
})();
