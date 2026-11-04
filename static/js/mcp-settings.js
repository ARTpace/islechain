// MCP 工具设置页：服务增删改、启停、授权工具、信任开关、导入配置。
(function () {
    'use strict';
    const RISK_LABEL = {readonly:'只读',mutating:'写入',destructive:'危险',trusted:'已信任'};
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const $ = id => document.getElementById(id);
    let configs = [];
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

    async function refresh() {
        configs = (await api('/servers')).servers;
        render();
        $('status').textContent = configs.length ? configs.length + ' 个服务' : '';
    }

    function render() {
        $('servers').innerHTML = configs.length ? configs.map(config => {
            const endpoint = config.transport === 'stdio' ? config.command : config.url;
            return `<details class="server" data-server="${esc(config.id)}">
              <summary>${esc(config.id)}<small>${esc(config.transport)} · ${config.enabled ? config.enabledTools.length + ' 个工具已授权' : '已停用'}</small></summary>
              <div class="server-meta">${esc(endpoint)}${config.hasHeaders || config.hasEnv ? ' · 已保存认证/环境变量' : ''}</div>
              <div class="server-actions">
                <button class="btn" type="button" data-action="tools">连接 / 查看工具</button>
                <button class="btn" type="button" data-action="toggle">${config.enabled ? '停用' : '启用'}</button>
                <button class="btn" type="button" data-action="edit">编辑配置</button>
                <button class="btn danger" type="button" data-action="delete">删除连接</button>
              </div>
              <div class="checks">
                <label><input type="checkbox" data-game ${config.gameEnabled ? 'checked' : ''}> 游戏代码开发也可使用已授权工具</label>
                <label><input type="checkbox" data-trust ${config.trustTools ? 'checked' : ''}> 信任此服务（跳过工具执行前确认）</label>
              </div>
              <div class="tool-list" data-tools></div>
            </details>`;
        }).join('') : '<div class="empty">还没有配置 MCP 服务。</div>';

        $('servers').querySelectorAll('[data-server]').forEach(section => {
            const config = configs.find(item => item.id === section.dataset.server);
            section.querySelector('[data-game]').onchange = async event => {
                try {
                    await update(config, {gameEnabled: event.target.checked});
                    notice('已保存：后续新建的开发候选使用此设置。');
                } catch (error) {
                    event.target.checked = !event.target.checked;
                    notice(error.message);
                }
            };
            section.querySelector('[data-trust]').onchange = async event => {
                try {
                    await update(config, {trustTools: event.target.checked});
                    notice(event.target.checked ? '已信任该服务：调用工具前不再逐次确认。' : '已取消信任：危险工具调用前会再次确认。');
                } catch (error) {
                    event.target.checked = !event.target.checked;
                    notice(error.message);
                }
            };
            section.querySelectorAll('[data-action]').forEach(button => button.onclick = async () => {
                button.disabled = true;
                try {
                    const action = button.dataset.action;
                    if (action === 'tools') await showTools(section, config);
                    if (action === 'toggle') { await update(config, {enabled: !config.enabled}); await refresh(); }
                    if (action === 'delete') { await api('/servers/' + encodeURIComponent(config.id), 'DELETE'); await refresh(); }
                    if (action === 'edit') {
                        const {hasHeaders, hasEnv, ...data} = config;
                        $('config').value = JSON.stringify(data, null, 2);
                        $('import').open = true;
                        notice('未显示的 headers/env 会保留；需要清除时显式填写空对象 {}。');
                    }
                } catch (error) {
                    notice(error.message);
                } finally {
                    button.disabled = false;
                }
            });
        });
    }

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

    async function showTools(section, config) {
        notice('正在连接 ' + config.id + '…');
        const {tools} = await api('/servers/' + encodeURIComponent(config.id) + '/tools', 'POST', {});
        const host = section.querySelector('[data-tools]');
        host.innerHTML = tools.length ? tools.map((tool, index) => `<label class="tool">
              <input type="checkbox" data-tool-index="${index}" ${config.enabledTools.includes(tool.name) ? 'checked' : ''}>
              <span><span class="tool-name">${esc(tool.name)}<span class="risk" data-risk="${esc(tool.risk || 'destructive')}">${esc(RISK_LABEL[tool.risk] || '危险')}</span></span>
              ${tool.description ? `<small class="tool-desc">${esc(tool.description)}</small>` : ''}</span>
            </label>`).join('') : '<div class="empty">服务未提供工具。</div>';
        host.querySelectorAll('[data-tool-index]').forEach(input => input.onchange = async () => {
            host.querySelectorAll('[data-tool-index]').forEach(el => el.disabled = true);
            const name = tools[Number(input.dataset.toolIndex)].name;
            const selected = new Set(config.enabledTools);
            if (input.checked) selected.add(name); else selected.delete(name);
            try {
                await update(config, {enabledTools: [...selected]});
                section.querySelector('summary small').textContent = `${config.transport} · ${config.enabledTools.length} 个工具已授权`;
                notice('已保存工具授权。画布 AI 里勾选此服务即可调用。');
            } catch (error) {
                input.checked = !input.checked;
                notice(error.message);
            } finally {
                host.querySelectorAll('[data-tool-index]').forEach(el => el.disabled = false);
            }
        });
        notice(`已连接 ${config.id}，发现 ${tools.length} 个工具。勾选后 AI 才能调用。`);
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
        await refresh();
        notice('配置已保存。展开服务，连接并勾选需要授权的工具。');
    }

    $('save').onclick = () => importConfig().catch(error => notice(error.message));
    refresh().catch(error => notice(error.message));
    window.lucide?.createIcons();
})();
