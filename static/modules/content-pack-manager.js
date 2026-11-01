/* 所有内容包共用 GitHub 清单与安全安装器；本地资产只展示安装状态。 */
(function () {
    'use strict';
    const API = '/api/content-packs/repository';
    const kinds = [
        {key:'tags', label:'标签包', installed:'/api/tag-packs', remove:'/api/tag-packs/'},
        {key:'styles', label:'风格包', installed:'/api/style-packs', remove:'/api/style-packs/'},
        {key:'artists', label:'画师包', installed:'/api/artists/packs', remove:'/api/artists/packs/'},
        {key:'characters', label:'角色包', installed:'/api/characters/packs', remove:'/api/characters/packs/'},
    ];
    const state = {repository:{url:'', packs:[]}, installed:{}, category:'all', busy:false, loaded:false, notice:''};
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let host;
    async function request(url, method, body) {
        const res = await fetch(url, method ? {method, headers:{'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})} : undefined);
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || '请求失败');
        return data;
    }
    async function load(check = false) {
        const results = await Promise.all([request(API + (check ? '?check=true' : '')), ...kinds.map(k => request(k.installed))]);
        state.repository = results[0];
        kinds.forEach((kind, i) => { state.installed[kind.key] = results[i + 1].installed || results[i + 1].packs || []; });
        state.loaded = true;
        if (state.repository.checkError) state.notice = state.repository.checkError;
    }
    async function act(fn) {
        if (state.busy) return;
        state.busy = true; state.notice = ''; paint();
        try { await fn(); }
        catch (err) { state.notice = err.message; }
        finally { state.busy = false; paint(); }
    }
    function card(kind, pack, remote) {
        const local = (state.installed[kind.key] || []).find(p => p.packId === pack.packId);
        const installed = !!local;
        const update = remote && pack.updateAvailable;
        const blocked = pack.blockedBy?.length;
        const disabled = state.busy ? 'disabled' : '';
        return `<div class="sp-card"><div class="sp-card-head"><div class="sp-card-title"><strong>${esc(pack.name || pack.packId)}</strong><span class="sp-badge">${esc(pack.version)}</span>${installed ? '<span class="sp-badge ok">已安装</span>' : ''}</div></div>
            <div class="sp-card-desc">${esc(pack.description || '')}</div><div class="sp-card-meta"><span>${Number(pack.entryCount || 0).toLocaleString('zh-CN')} 条</span>${pack.sizeBytes ? `<span>${(pack.sizeBytes / 1048576).toFixed(1)} MB</span>` : ''}${update ? `<span>当前 ${esc(local.version)}</span>` : ''}</div>
            ${blocked ? `<div class="sp-hint">请先卸载旧整库包：${esc(pack.blockedBy.join('、'))}</div>` : ''}
            <div class="sp-card-actions">${remote && (!installed || update) ? `<button class="asset-btn primary" data-cp-action="install" data-id="${esc(pack.packId)}" data-kind="${kind.key}" ${disabled} ${blocked ? 'disabled' : ''}>${update ? '更新此包' : '从仓库安装'}</button>` : ''}
            ${installed ? `<button class="asset-btn danger" data-cp-action="uninstall" data-id="${esc(pack.packId)}" data-kind="${kind.key}" ${disabled}>卸载</button>` : ''}</div></div>`;
    }
    function section(kind) {
        const remote = state.repository.packs.filter(p => (p.kind || 'styles') === kind.key);
        const ids = new Set(remote.map(p => p.packId));
        const local = (state.installed[kind.key] || []).filter(p => !ids.has(p.packId));
        return `<section class="sp-section"><div class="sp-section-head"><strong>${kind.label}</strong><span>${remote.length} 个仓库包 · 已安装 ${(state.installed[kind.key] || []).length} 个包</span></div><div class="sp-grid">${remote.map(p => card(kind,p,true)).join('')}${local.map(p => card(kind,p,false)).join('')}</div>${!remote.length && !local.length ? '<div class="empty-state">暂无内容，请加载 GitHub 仓库。</div>' : ''}</section>`;
    }
    function paint() {
        if (!host) return;
        const disabled = state.busy ? 'disabled' : '';
        host.innerHTML = `<section class="asset-panel asset-content"><div class="content-toolbar"><div class="content-heading"><strong>内容包管理</strong><span>风格、画师、角色 · 按包安装与更新</span></div></div><div class="content-scroll">
            <section class="sp-section"><div class="sp-section-head"><strong>GitHub 资产仓库</strong><span>${esc(state.repository.url || '尚未连接仓库')}</span></div><div class="asset-tools">
            <button class="asset-btn primary" data-cp-action="connect" ${disabled}>${state.repository.url ? '更换仓库' : '加载仓库'}</button>
            ${state.repository.url ? `<button class="asset-btn" data-cp-action="check" ${disabled}>检查更新${state.repository.updateCount ? '（' + state.repository.updateCount + '）' : ''}</button><button class="asset-btn" data-cp-action="disconnect" ${disabled}>断开仓库</button>` : ''}</div></section>
            <div class="prompt-filter-bar">${[['all','全部'], ...kinds.map(k => [k.key,k.label])].map(([key,label]) => `<button class="prompt-chip ${state.category === key ? 'is-on' : ''}" data-cp-category="${key}">${label}</button>`).join('')}</div>
            ${state.notice ? `<div class="sp-notice">${esc(state.notice)}</div>` : ''}${!state.loaded && state.busy ? '<div class="sp-loading">正在读取内容包…</div>' : ''}
            ${kinds.filter(k => state.category === 'all' || state.category === k.key).map(section).join('')}</div></section>`;
    }
    function changed() {
        window.dispatchEvent(new Event('style-packs-changed'));
        window.dispatchEvent(new Event('content-packs-changed'));
    }
    function onClick(event) {
        const category = event.target.closest('[data-cp-category]');
        if (category) { state.category = category.dataset.cpCategory; paint(); return; }
        const button = event.target.closest('[data-cp-action]');
        if (!button || state.busy) return;
        const action = button.dataset.cpAction, id = button.dataset.id;
        const kind = kinds.find(k => k.key === button.dataset.kind);
        let url = state.repository.url;
        if (action === 'connect') {
            url = window.prompt('公开 GitHub 资产仓库地址：', url || 'https://github.com/ARTpace/Art-prompt-library');
            if (!url?.trim()) return;
        }
        const pack = state.repository.packs.find(p => p.packId === id);
        if (action === 'install' && pack?.installed && !window.confirm('更新「' + pack.name + '」？仅替换此包，其他包保留。')) return;
        if (action === 'uninstall' && !window.confirm('卸载这个内容包？')) return;
        act(async () => {
            if (action === 'connect' || action === 'check') {
                state.repository = await request(API, 'POST', {url:url.trim()});
                state.notice = '仓库检查完成';
            } else if (action === 'disconnect') {
                state.repository = await request(API, 'DELETE');
                state.notice = '已断开仓库，已安装内容保留';
            } else if (action === 'install') {
                await request(API + '/install', 'POST', {packId:id, replace:!!pack?.installed});
                await load(); changed(); state.notice = '已安装／更新 ' + id;
            } else if (action === 'uninstall' && kind) {
                await request(kind.remove + encodeURIComponent(id), 'DELETE');
                await load(); changed(); state.notice = '已卸载 ' + id;
            }
        });
    }
    function render(root) {
        host = root;
        if (!host.__cpBound) { host.__cpBound = true; host.addEventListener('click', onClick); }
        paint(); act(() => load(true));
    }
    window.ContentPackManager = {render, reload:() => act(() => load(true))};
})();
