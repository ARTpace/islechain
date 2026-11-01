/* 所有内容包共用 GitHub 清单与安全安装器；支持同时挂多个仓库，可逐个启用/停用。 */
(function () {
    'use strict';
    const API = '/api/content-repositories';
    const kinds = [
        {key:'tags', label:'标签包', installed:'/api/tag-packs', remove:'/api/tag-packs/'},
        {key:'styles', label:'风格包', installed:'/api/style-packs', remove:'/api/style-packs/'},
        {key:'artists', label:'画师包', installed:'/api/artists/packs', remove:'/api/artists/packs/'},
        {key:'characters', label:'角色包', installed:'/api/characters/packs', remove:'/api/characters/packs/'},
    ];
    const state = {repos:[], packs:[], installed:{}, assetLibs:[], category:'all', busy:false, loaded:false, notice:'', enabledOnly:false};
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let host;
    async function request(url, method, body) {
        const res = await fetch(url, method ? {method, headers:{'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})} : undefined);
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || '请求失败');
        return data;
    }
    function applyRepository(payload) {
        state.repos = payload.repos || [];
        state.packs = payload.packs || [];
    }
    async function load(check = false) {
        const results = await Promise.all([request(API + (check ? '?check=true' : '')), ...kinds.map(k => request(k.installed)),
            request('/api/asset-library').catch(() => ({library:{libraries:[]}}))]);
        applyRepository(results[0]);
        kinds.forEach((kind, i) => { state.installed[kind.key] = results[i + 1].installed || results[i + 1].packs || []; });
        // 直连资产仓库（PoseAtlas 等）没有安装/卸载概念，只做启用开关
        state.assetLibs = (results[results.length - 1].library?.libraries || []).filter(lib => lib.repository_source);
        state.loaded = true;
        if (results[0].checkError) state.notice = results[0].checkError;
    }
    async function act(fn) {
        if (state.busy) return;
        state.busy = true; state.notice = ''; paint();
        try { await fn(); }
        catch (err) { state.notice = err.message; }
        finally { state.busy = false; paint(); }
    }
    function repoCard(repo) {
        const disabled = state.busy ? 'disabled' : '';
        return `<div class="cp-repo ${repo.enabled ? '' : 'is-off'}">
            <div class="cp-repo-main"><strong>${esc(repo.name || repo.url)}</strong><span>${esc(repo.url)}</span></div>
            <span class="cp-repo-meta">${Number(repo.packCount || 0)} 个包</span>
            <label class="cp-switch" title="${repo.enabled ? '已启用（点击停用）' : '已停用（点击启用）'}">
                <input type="checkbox" data-cp-toggle="${esc(repo.id)}" ${repo.enabled ? 'checked' : ''} ${disabled}>
                <span class="cp-switch-track" aria-hidden="true"></span>
            </label>
            <div class="cp-repo-actions">
                <button class="cp-mini" type="button" data-cp-action="refresh-repo" data-repo="${esc(repo.id)}" ${disabled}>刷新</button>
                <button class="cp-mini danger" type="button" data-cp-action="remove-repo" data-repo="${esc(repo.id)}" ${disabled}>移除</button>
            </div>
        </div>`;
    }
    function card(kind, pack, remote) {
        const local = (state.installed[kind.key] || []).find(p => p.packId === pack.packId);
        const installed = !!local;
        const update = remote && pack.updateAvailable;
        const blocked = pack.blockedBy?.length;
        const off = remote && pack.repoEnabled === false;
        const disabled = state.busy || off ? 'disabled' : '';
        return `<div class="sp-card ${off ? 'is-off' : ''}"><div class="sp-card-head"><div class="sp-card-title"><strong>${esc(pack.name || pack.packId)}</strong><span class="sp-badge">${esc(pack.version)}</span>${installed ? '<span class="sp-badge ok">已安装</span>' : ''}${remote && pack.repoName ? `<span class="sp-badge repo">${esc(pack.repoName)}</span>` : ''}</div></div>
            <div class="sp-card-desc">${esc(pack.description || '')}</div><div class="sp-card-meta"><span>${Number(pack.entryCount || 0).toLocaleString('zh-CN')} 条</span>${pack.sizeBytes ? `<span>${(pack.sizeBytes / 1048576).toFixed(1)} MB</span>` : ''}${update ? `<span>当前 ${esc(local.version)}</span>` : ''}</div>
            ${off ? '<div class="sp-hint">来源仓库已停用，启用后即可安装</div>' : ''}
            ${blocked ? `<div class="sp-hint">请先卸载旧整库包：${esc(pack.blockedBy.join('、'))}</div>` : ''}
            <div class="sp-card-actions">${remote && (!installed || update) ? `<button class="asset-btn primary" data-cp-action="install" data-id="${esc(pack.packId)}" data-kind="${kind.key}" data-repo="${esc(pack.repoId || '')}" ${disabled} ${blocked ? 'disabled' : ''}>${update ? '更新此包' : '从仓库安装'}</button>` : ''}
            ${installed ? `<button class="asset-btn danger" data-cp-action="uninstall" data-id="${esc(pack.packId)}" data-kind="${kind.key}" ${state.busy ? 'disabled' : ''}>卸载</button>` : ''}</div></div>`;
    }
    function section(kind) {
        const remote = state.packs.filter(p => (p.kind || 'styles') === kind.key);
        const ids = new Set(remote.map(p => p.packId));
        const local = (state.installed[kind.key] || []).filter(p => !ids.has(p.packId));
        return `<section class="sp-section"><div class="sp-section-head"><strong>${kind.label}</strong><span>${remote.length} 个仓库包 · 已安装 ${(state.installed[kind.key] || []).length} 个包</span></div><div class="sp-grid">${remote.map(p => card(kind,p,true)).join('')}${local.map(p => card(kind,p,false)).join('')}</div>${!remote.length && !local.length ? '<div class="empty-state">暂无内容，先添加一个 GitHub 内容仓库。</div>' : ''}</section>`;
    }
    function paint() {
        if (!host) return;
        const disabled = state.busy ? 'disabled' : '';
        const repoBlock = state.repos.length
            ? `<div class="cp-repo-list">${state.repos.map(repoCard).join('')}</div>`
            : '<div class="empty-state">还没有添加仓库。可添加官方仓库或任意符合内容包协议的第三方仓库。</div>';
        const offRepos = window.AssetRepoPrefs?.disabled?.() || new Set();
        const assetBlock = state.assetLibs.length
            ? `<section class="sp-section"><div class="sp-section-head"><strong>直连资产仓库</strong><span>不需要安装，启用后各自成为一个标签</span></div>
                <div class="cp-repo-list">${state.assetLibs.map(lib => {
                    const count = (lib.categories || []).reduce((n, cat) => n + (cat.items || []).length, 0);
                    const on = !offRepos.has(lib.id);
                    return `<div class="cp-repo ${on ? '' : 'is-off'}"><div class="cp-repo-main"><strong>${esc((lib.name || '').replace(/^PoseAtlas\s*·\s*/, ''))}</strong><span>${esc(lib.repository_url || '直连索引')}</span></div>
                        <span class="cp-repo-meta">${count} 条</span>
                        <label class="cp-switch" title="${on ? '已启用（点击停用）' : '已停用（点击启用）'}"><input type="checkbox" data-cp-asset-toggle="${esc(lib.id)}" ${on ? 'checked' : ''} ${state.busy ? 'disabled' : ''}><span class="cp-switch-track" aria-hidden="true"></span></label></div>`;
                }).join('')}</div></section>` : '';
        host.innerHTML = `<section class="asset-panel asset-content"><div class="content-toolbar"><div class="content-heading"><strong>内容包管理</strong><span>可同时挂多个仓库 · 按包安装与更新</span></div></div><div class="content-scroll">
            <section class="sp-section"><div class="sp-section-head"><strong>资源仓库</strong><span>${state.repos.length} 个仓库${state.repos.some(r => !r.enabled) ? ' · 停用的仓库不参与安装' : ''}</span></div>
            ${repoBlock}
            <div class="asset-tools">
            <button class="asset-btn primary" data-cp-action="add-repo" ${disabled}><i data-lucide="plus"></i><span>添加仓库</span></button>
            ${state.repos.length ? `<button class="asset-btn" data-cp-action="check" ${disabled}>检查更新</button>` : ''}</div></section>
            ${assetBlock}
            <div class="prompt-filter-bar">${[['all','全部'], ...kinds.map(k => [k.key,k.label])].map(([key,label]) => `<button class="prompt-chip ${state.category === key ? 'is-on' : ''}" data-cp-category="${key}">${label}</button>`).join('')}</div>
            ${state.notice ? `<div class="sp-notice">${esc(state.notice)}</div>` : ''}${!state.loaded && state.busy ? '<div class="sp-loading">正在读取内容包…</div>' : ''}
            ${kinds.filter(k => state.category === 'all' || state.category === k.key).map(section).join('')}</div></section>`;
        window.lucide?.createIcons();
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
        const action = button.dataset.cpAction, id = button.dataset.id, repoId = button.dataset.repo;
        const kind = kinds.find(k => k.key === button.dataset.kind);
        const pack = state.packs.find(p => p.packId === id && (!repoId || p.repoId === repoId));
        if (action === 'add-repo') {
            const url = window.prompt('公开 GitHub 内容仓库地址（可重复添加多个）：', 'https://github.com/ARTpace/Art-prompt-library');
            if (!url?.trim()) return;
            act(async () => {
                applyRepository(await request(API, 'POST', {url:url.trim()}));
                state.notice = '仓库已添加';
                await load(); changed();
            });
            return;
        }
        if (action === 'refresh-repo' && repoId) {
            act(async () => { applyRepository(await request(API + '/' + encodeURIComponent(repoId) + '/refresh', 'POST')); state.notice = '仓库已刷新'; });
            return;
        }
        if (action === 'remove-repo' && repoId) {
            const repo = state.repos.find(r => r.id === repoId);
            if (!window.confirm('移除仓库「' + (repo?.name || repoId) + '」？已安装的内容包会保留。')) return;
            act(async () => { applyRepository(await request(API + '/' + encodeURIComponent(repoId), 'DELETE')); state.notice = '仓库已移除，已安装的内容保留'; });
            return;
        }
        if (action === 'check') {
            act(async () => { applyRepository(await request(API + '?check=true')); state.notice = '仓库检查完成'; });
            return;
        }
        if (action === 'install' && pack?.installed && !window.confirm('更新「' + pack.name + '」？仅替换此包，其他包保留。')) return;
        if (action === 'uninstall' && !window.confirm('卸载这个内容包？')) return;
        act(async () => {
            if (action === 'install') {
                await request('/api/content-packs/repository/install', 'POST', {packId:id, replace:!!pack?.installed, repoId:repoId || ''});
                await load(); changed(); state.notice = '已安装／更新 ' + id;
            } else if (action === 'uninstall' && kind) {
                await request(kind.remove + encodeURIComponent(id), 'DELETE');
                await load(); changed(); state.notice = '已卸载 ' + id;
            }
        });
    }
    function onChange(event) {
        const assetToggle = event.target.closest('[data-cp-asset-toggle]');
        if (assetToggle) {
            if (!window.AssetRepoPrefs) return;
            window.AssetRepoPrefs.set(assetToggle.dataset.cpAssetToggle, assetToggle.checked);
            state.notice = assetToggle.checked ? '资产仓库已启用' : '资产仓库已停用，可从「管理」重新开启';
            paint();
            return;
        }
        const toggle = event.target.closest('[data-cp-toggle]');
        if (!toggle || state.busy) return;
        const repoId = toggle.dataset.cpToggle, enabled = toggle.checked;
        act(async () => {
            applyRepository(await request(API + '/' + encodeURIComponent(repoId) + '/enabled', 'POST', {enabled}));
            state.notice = enabled ? '仓库已启用' : '仓库已停用，它的包不会出现在安装列表里';
        });
    }
    function render(root) {
        host = root;
        if (!host.__cpBound) {
            host.__cpBound = true;
            host.addEventListener('click', onClick);
            host.addEventListener('change', onChange);
        }
        paint(); act(() => load(true));
    }
    window.ContentPackManager = {render, reload:() => act(() => load(true))};
})();
