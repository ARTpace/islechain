// MCP 工具设置页：紧凑卡片列表 + 详情；服务增删改、启停、授权工具、信任开关、导入配置。
(function () {
    'use strict';
    const RISK_LABEL = {readonly:'只读',mutating:'写入',destructive:'危险',trusted:'已信任'};
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const $ = id => document.getElementById(id);
    const state = {configs: [], view: 'list', activeId: '', tools: {}};
    const saves = new Map();

    async function api(path, method = 'GET', body) {
        const options = {method, headers:{'Content-Type':'application/json','X-Art-MCP':'1'}};
        if (body !== undefined) options.body = JSON.stringify(body);
        const response = await fetch('/api/mcp' + path, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'MCP 请求失败');
        return data;
    }
    function notice(message) { $('notice').textContent = message || ''; }
    function endpoint(config) { return config.transport === 'stdio' ? config.command : config.url; }
    function activeConfig() { return state.configs.find(item => item.id === state.activeId); }
    function toolCount(config) { return (config.enabledTools || []).length; }

    async function refresh() {
        const data = await api('/servers');
        state.configs = data.servers || [];
        render();
    }

    function renderTile(config) {
        const off = !config.enabled;
        const ep = endpoint(config) || '—';
        return '<div class="mcp-tile' + (off ? ' is-off' : '') + '" data-open="' + esc(config.id)
            + '" role="button" tabindex="0" title="点击查看详情">'
            + '<div class="mcp-tile-top">'
            + '<span class="mcp-tile-mark">' + esc(String(config.id || '?').slice(0, 1).toUpperCase()) + '</span>'
            + '<span class="mcp-tile-name">' + esc(config.id) + '</span>'
            + '<span class="sk-state" data-state="' + (off ? 'off' : 'ready') + '" title="' + (off ? '已停用' : '已启用') + '"><i></i></span>'
            + '</div>'
            + '<div class="mcp-tile-meta">'
            + '<span><b>' + esc(config.transport || 'http') + '</b></span>'
            + '<span>工具 <b>' + toolCount(config) + '</b> 已授权</span>'
            + (config.trustTools ? '<span class="mcp-tile-tag">已信任</span>' : '')
            + (config.gameEnabled ? '<span class="mcp-tile-tag">游戏</span>' : '')
            + '</div>'
            + '<div class="mcp-tile-endpoint" title="' + esc(ep) + '">' + esc(ep) + '</div>'
            + '<div class="mcp-tile-foot">'
            + '<span class="mcp-tile-hint">' + (off ? '停用中' : '点击查看详情 ›') + '</span>'
            + '<span class="sk-switch' + (off ? '' : ' is-on') + '" data-toggle="' + esc(config.id)
            + '" data-enabled="' + (off ? 'false' : 'true') + '" role="switch" aria-checked="' + (off ? 'false' : 'true')
            + '" title="' + (off ? '启用' : '停用') + '"></span>'
            + '</div></div>';
    }

    function renderToolList(config) {
        const tools = state.tools[config.id];
        if (!tools) return '<div class="empty">点击「连接 / 查看工具」加载该服务提供的工具。</div>';
        if (!tools.length) return '<div class="empty">服务未提供工具。</div>';
        const selected = new Set(config.enabledTools || []);
        return tools.map((tool, index) => '<label class="tool">'
            + '<input type="checkbox" data-tool-index="' + index + '"' + (selected.has(tool.name) ? ' checked' : '') + '>'
            + '<span><span class="tool-name">' + esc(tool.name)
            + '<span class="risk" data-risk="' + esc(tool.risk || 'destructive') + '">' + esc(RISK_LABEL[tool.risk] || '危险') + '</span></span>'
            + (tool.description ? '<small class="tool-desc">' + esc(tool.description) + '</small>' : '')
            + '</span></label>').join('');
    }

    function renderDetail(config) {
        const off = !config.enabled;
        const ep = endpoint(config) || '—';
        return '<section class="mcp-card">'
            + '<div class="mcp-head">'
            + '<span class="sk-toolmark" aria-hidden="true">M</span>'
            + '<div class="sk-cardid"><span class="mcp-name">' + esc(config.id) + '</span></div>'
            + '<span class="sk-state" data-state="' + (off ? 'off' : 'ready') + '"><i></i></span>'
            + '</div>'
            + '<div class="server-meta">' + esc(ep) + (config.hasHeaders || config.hasEnv ? ' · 已保存认证/环境变量' : '') + '</div>'
            + (off ? '<div class="sk-msg" style="margin-bottom:10px">此服务已停用；启用后 AI 才能调用其工具。</div>' : '')
            + '<div class="server-actions">'
            + '<button class="btn" type="button" data-act="tools" data-id="' + esc(config.id) + '">连接 / 查看工具</button>'
            + '<button class="btn" type="button" data-act="toggle" data-id="' + esc(config.id) + '">' + (off ? '启用' : '停用') + '</button>'
            + '<button class="btn" type="button" data-act="edit" data-id="' + esc(config.id) + '">编辑配置</button>'
            + '<button class="btn danger" type="button" data-act="delete" data-id="' + esc(config.id) + '">删除连接</button>'
            + '</div>'
            + '<div class="checks">'
            + '<label><input type="checkbox" data-game' + (config.gameEnabled ? ' checked' : '') + '> 游戏代码开发也可使用已授权工具</label>'
            + '<label><input type="checkbox" data-trust' + (config.trustTools ? ' checked' : '') + '> 信任此服务（跳过工具执行前确认）</label>'
            + '</div>'
            + '<div class="tool-list" data-tools>' + renderToolList(config) + '</div>'
            + '</section>';
    }

    function render() {
        const home = $('mcpHome'), detail = $('mcpDetail'), host = $('servers');
        if (!host) return;
        const inDetail = state.view === 'detail' && state.configs.some(item => item.id === state.activeId);
        if (!inDetail) state.view = 'list';
        home.hidden = inDetail;
        detail.hidden = !inDetail;
        const enabled = state.configs.filter(item => item.enabled).length;
        const trusted = state.configs.filter(item => item.trustTools).length;
        $('summary').textContent = state.configs.length
            ? '共 ' + state.configs.length + ' 个服务 · 已启用 ' + enabled + ' · 已信任 ' + trusted
            : '还没有配置 MCP 服务，点击「添加服务」导入配置。';
        $('status').textContent = state.configs.length ? state.configs.length + ' 个服务' : '';
        if (inDetail) {
            const config = activeConfig();
            $('detailTitle').textContent = config.id;
            $('detailState').textContent = (config.enabled ? '已启用' : '已停用') + ' · '
                + (config.transport || 'http') + ' · ' + toolCount(config) + ' 个工具已授权';
            $('mcpDetailCard').innerHTML = renderDetail(config);
        } else {
            host.innerHTML = state.configs.length
                ? state.configs.map(renderTile).join('')
                : '<section class="block"><div class="block-desc">还没有配置 MCP 服务。点击「添加服务」导入 mcpServers 配置。</div></section>';
        }
    }

    function showDetail(id) {
        if (!state.configs.some(item => item.id === id)) return;
        state.view = 'detail';
        state.activeId = id;
        render();
        try { window.scrollTo(0, 0); } catch (e) {}
    }
    function showList() { state.view = 'list'; state.activeId = ''; render(); }

    async function update(config, changes) {
        // 同一服务的连续保存排队，避免后到的请求覆盖先到的。
        const task = (saves.get(config.id) || Promise.resolve()).catch(() => {}).then(async () => {
            const {hasHeaders, hasEnv, ...data} = config;
            const result = await api('/servers', 'POST', {...data, ...changes});
            Object.assign(config, result.server);
        });
        saves.set(config.id, task);
        await task;
    }

    async function toggle(config, next) {
        try {
            notice('正在' + (next ? '启用' : '停用') + ' ' + config.id + '…');
            await update(config, {enabled: next});
            render();
            notice(config.id + (next ? ' 已启用。' : ' 已停用。'));
        } catch (error) { notice(error.message); }
    }

    async function showTools(config) {
        notice('正在连接 ' + config.id + '…');
        try {
            const data = await api('/servers/' + encodeURIComponent(config.id) + '/tools', 'POST', {});
            state.tools[config.id] = data.tools || [];
            render();
            notice('已连接 ' + config.id + '，发现 ' + state.tools[config.id].length + ' 个工具。勾选后 AI 才能调用。');
        } catch (error) { notice(error.message); }
    }

    async function changeTool(config, index, checked) {
        const tools = state.tools[config.id];
        if (!tools || !tools[index]) return;
        const name = tools[index].name;
        const selected = new Set(config.enabledTools || []);
        if (checked) selected.add(name); else selected.delete(name);
        try {
            await update(config, {enabledTools: [...selected]});
            render();
            notice('已保存工具授权。画布 AI 里勾选此服务即可调用。');
        } catch (error) { render(); notice(error.message); }
    }

    async function deleteConfig(config) {
        try {
            await api('/servers/' + encodeURIComponent(config.id), 'DELETE');
            delete state.tools[config.id];
            showList();
            await refresh();
            notice('已删除 ' + config.id + '。');
        } catch (error) { notice(error.message); }
    }

    function editConfig(config) {
        const {hasHeaders, hasEnv, ...data} = config;
        $('config').value = JSON.stringify(data, null, 2);
        showList();
        $('import').open = true;
        $('config').focus();
        notice('未显示的 headers/env 会保留；需要清除时显式填写空对象 {}。');
    }

    async function importConfig() {
        let data;
        try { data = JSON.parse($('config').value); } catch { throw new Error('配置不是有效 JSON'); }
        const entries = data.mcpServers || data.mcp_servers;
        const incoming = entries ? Object.entries(entries).map(([id, value]) => ({id, ...value})) : [data];
        if (!incoming.length || incoming.length > 16) throw new Error('一次可导入 1–16 个服务');
        const normalized = incoming.map(item => {
            if (!item || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id || '')) throw new Error('服务 ID 只能包含字母、数字、下划线和短横线');
            const {type, ...rest} = item;
            let transport = item.transport || type || (item.command ? 'stdio' : 'http');
            if (['streamable-http', 'streamable_http'].includes(transport)) transport = 'http';
            return {...rest, transport};
        });
        for (const item of normalized) await api('/servers', 'POST', item);
        $('config').value = '';
        showList();
        await refresh();
        notice('配置已保存。点击服务卡片，连接并勾选需要授权的工具。');
    }

    document.addEventListener('click', async function (ev) {
        const nav = ev.target.closest('[data-nav]');
        if (nav) { if (nav.dataset.nav === 'back') showList(); return; }
        const tog = ev.target.closest('[data-toggle]');
        if (tog) {
            const config = state.configs.find(item => item.id === tog.dataset.toggle);
            if (config) await toggle(config, tog.dataset.enabled !== 'true');
            return;
        }
        const open = ev.target.closest('[data-open]');
        if (open) { showDetail(open.dataset.open); return; }
        const el = ev.target.closest('[data-act]');
        if (!el || el.disabled) return;
        const act = el.dataset.act;
        if (act === 'add') { $('import').open = true; $('config').focus(); return; }
        if (act === 'reload') { refresh().catch(error => notice(error.message)); return; }
        const config = state.configs.find(item => item.id === el.dataset.id) || activeConfig();
        if (!config) return;
        el.disabled = true;
        try {
            if (act === 'tools') await showTools(config);
            else if (act === 'toggle') await toggle(config, !config.enabled);
            else if (act === 'edit') editConfig(config);
            else if (act === 'delete') await deleteConfig(config);
        } finally { el.disabled = false; }
    });
    document.addEventListener('change', function (ev) {
        const target = ev.target;
        const config = activeConfig();
        if (!config) return;
        if (target.hasAttribute('data-game')) {
            update(config, {gameEnabled: target.checked})
                .then(() => { render(); notice('已保存：后续新建的开发候选使用此设置。'); })
                .catch(error => { target.checked = !target.checked; notice(error.message); });
        } else if (target.hasAttribute('data-trust')) {
            const trusted = target.checked;
            update(config, {trustTools: trusted})
                .then(() => { render(); notice(trusted ? '已信任该服务：调用工具前不再逐次确认。' : '已取消信任：危险工具调用前会再次确认。'); })
                .catch(error => { target.checked = !target.checked; notice(error.message); });
        } else if (target.hasAttribute('data-tool-index')) {
            changeTool(config, Number(target.dataset.toolIndex), target.checked);
        }
    });
    document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        const el = ev.target.closest && ev.target.closest('[data-open]');
        if (el) { ev.preventDefault(); showDetail(el.dataset.open); }
    });

    $('save').onclick = () => importConfig().catch(error => notice(error.message));
    refresh().catch(error => notice(error.message));
    window.lucide?.createIcons();
})();
