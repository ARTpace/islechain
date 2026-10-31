/**
 * 资产库 · 风格包管理
 *
 * 完整风格数据不随仓库分发：程序内置一个精简种子包，其余按来源平台打成 zip，
 * 用户在资产库这里一键安装或导入自己的包。安装后落在用户目录，可卸载、升级不丢。
 *
 * 对外只有 StylePackManager.render(rootEl) 一个入口，由 asset-manager.js 在
 * activeTab === 'style-packs' 时调用。
 */
(function () {
    'use strict';

    const API = {
        installed: '/api/style-packs',
        catalog: '/api/style-packs/catalog',
        install: '/api/style-packs/install-official',
        importZip: '/api/style-packs/import',
        uninstall: (id) => '/api/style-packs/' + encodeURIComponent(id),
        download: (id) => '/api/style-packs/' + encodeURIComponent(id) + '/download',
    };

    const state = {
        loaded: false,
        loading: false,
        error: '',
        packs: [],
        overlay: null,
        catalog: { packs: [], totalEntries: 0, source: '' },
        selected: '',
        busy: '',
        notice: '',
    };

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    function fmtSize(bytes) {
        const n = Number(bytes || 0);
        if (!n) return '—';
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    function fmtNum(n) {
        return Number(n || 0).toLocaleString('zh-CN');
    }

    function icons() {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            try { window.lucide.createIcons(); } catch (e) { /* 图标失败不影响功能 */ }
        }
    }

    async function getJson(url, options) {
        const res = await fetch(url, options);
        let data = {};
        try { data = await res.json(); } catch (e) { data = {}; }
        if (!res.ok) throw new Error(data.detail || data.message || ('请求失败 ' + res.status));
        return data;
    }

    async function load(force) {
        if (state.loading) return;
        if (state.loaded && !force) return;
        state.loading = true;
        state.error = '';
        paint();
        try {
            const [installed, catalog] = await Promise.all([
                getJson(API.installed),
                getJson(API.catalog).catch(() => ({ packs: [] })),
            ]);
            state.packs = installed.packs || [];
            state.overlay = installed.overlay || null;
            state.catalog = catalog || { packs: [] };
            if (!state.selected && state.packs.length) state.selected = state.packs[0].packId;
            state.loaded = true;
        } catch (err) {
            state.error = err.message || '风格包列表加载失败';
        } finally {
            state.loading = false;
            paint();
        }
    }

    async function postJson(url, body) {
        return getJson(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
        });
    }

    async function installPack(packId) {
        state.busy = packId;
        state.notice = '';
        paint();
        try {
            await postJson(API.install, { packId: packId, replace: false });
            state.notice = '已安装 ' + packId;
            await load(true);
        } catch (err) {
            state.notice = '安装失败：' + (err.message || '未知错误');
        } finally {
            state.busy = '';
            paint();
        }
    }

    async function uninstallPack(packId) {
        if (!window.confirm('卸载风格包 ' + packId + '？\n\n该包里的风格条目会一并移除，你自己新增的单条风格不受影响。')) return;
        state.busy = packId;
        state.notice = '';
        paint();
        try {
            await getJson(API.uninstall(packId), { method: 'DELETE' });
            state.notice = '已卸载 ' + packId;
            if (state.selected === packId) state.selected = '';
            await load(true);
        } catch (err) {
            state.notice = '卸载失败：' + (err.message || '未知错误');
        } finally {
            state.busy = '';
            paint();
        }
    }

    async function importZip(file) {
        if (!file) return;
        state.busy = 'import';
        state.notice = '正在导入 ' + file.name + '…';
        paint();
        try {
            const form = new FormData();
            form.append('file', file);
            const data = await getJson(API.importZip + '?replace=false', { method: 'POST', body: form });
            state.notice = '已导入 ' + ((data.pack && data.pack.name) || file.name);
            await load(true);
        } catch (err) {
            state.notice = '导入失败：' + (err.message || '未知错误');
        } finally {
            state.busy = '';
            paint();
        }
    }

    function pickZipFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,application/zip';
        input.addEventListener('change', () => importZip(input.files && input.files[0]));
        input.click();
    }

    function totalEntries() {
        return state.packs.reduce((sum, p) => sum + Number(p.entryCount || 0), 0);
    }

    function renderNav() {
        const rows = state.packs.map((pack) => {
            const active = pack.packId === state.selected ? 'active' : '';
            return `<button class="tree-row tree-child ${active}" type="button" data-sp-select="${esc(pack.packId)}">
                <span class="tree-elbow"></span>
                <span class="tree-row-icon"><i data-lucide="${pack.builtin ? 'package' : 'package-plus'}"></i></span>
                <span class="tree-row-name">${esc(pack.name)}</span>
                <span class="tree-row-count">${fmtNum(pack.entryCount)}</span>
            </button>`;
        }).join('');
        return `<aside class="asset-panel asset-nav">
            <div class="panel-head">
                <div class="panel-title"><strong>已安装风格包</strong><span>${state.packs.length} 个包 · ${fmtNum(totalEntries())} 条风格</span></div>
                <div class="panel-actions compact-actions">
                    <button class="asset-icon-btn" type="button" data-sp-import title="导入本地风格包 zip"><i data-lucide="upload"></i></button>
                </div>
            </div>
            <div class="nav-scroll"><div class="nav-tree">
                ${rows || '<div class="tree-empty">还没有任何风格包</div>'}
            </div></div>
        </aside>`;
    }

    function renderOfficialCard(pack) {
        const busy = state.busy === pack.packId;
        const action = pack.installed
            ? `<button class="asset-btn" type="button" disabled><i data-lucide="check"></i><span>已安装</span></button>`
            : `<button class="asset-btn primary" type="button" data-sp-install="${esc(pack.packId)}" ${busy || !pack.available ? 'disabled' : ''}>
                   <i data-lucide="${busy ? 'loader' : 'download'}"></i><span>${busy ? '安装中' : (pack.available ? '安装' : '未随包分发')}</span>
               </button>`;
        return `<div class="sp-card">
            <div class="sp-card-head">
                <div class="sp-card-title">
                    <strong>${esc(pack.name)}</strong>
                    <span class="sp-badge">${esc(pack.version)}</span>
                    ${pack.installed ? '<span class="sp-badge ok">已安装</span>' : ''}
                </div>
            </div>
            <div class="sp-card-desc">${esc(pack.description || '按来源平台拆分的风格扩展包')}</div>
            <div class="sp-card-meta">
                <span><i data-lucide="layers"></i>${fmtNum(pack.entryCount)} 条</span>
                <span><i data-lucide="folder-tree"></i>${pack.categoryCount} 分类</span>
                <span><i data-lucide="hard-drive"></i>${fmtSize(pack.sizeBytes)}</span>
            </div>
            <div class="sp-card-actions">${action}</div>
        </div>`;
    }

    function renderContent() {
        const official = (state.catalog && state.catalog.packs) || [];
        const installable = official.filter((p) => !p.installed).length;
        return `<section class="asset-panel asset-content">
            <div class="content-toolbar">
                <div class="content-heading">
                    <strong>风格包</strong>
                    <span>${official.length ? '还有 ' + installable + ' 个官方包可安装' : '把 zip 放进目录即可扩展提示词资产'}</span>
                </div>
                <div class="asset-tools">
                    <button class="asset-btn" type="button" data-sp-refresh><i data-lucide="refresh-cw"></i><span>刷新</span></button>
                    <button class="asset-btn primary" type="button" data-sp-import><i data-lucide="upload"></i><span>导入 zip</span></button>
                </div>
            </div>
            <div class="content-scroll">
                ${state.notice ? `<div class="sp-notice">${esc(state.notice)}</div>` : ''}
                ${state.error ? `<div class="sp-notice error">${esc(state.error)}</div>` : ''}
                <div class="sp-section">
                    <div class="sp-section-head">
                        <strong>官方可选风格包</strong>
                        <span>${official.length ? '按来源平台拆分，装哪个只占哪个的体积' : '当前安装包未附带可选风格包'}</span>
                    </div>
                    ${official.length
                        ? `<div class="sp-grid">${official.map(renderOfficialCard).join('')}</div>`
                        : '<div class="empty-state">没有可安装的官方包。可以点右上角「导入 zip」加载自己或别人分享的风格包。</div>'}
                </div>
                <div class="sp-section">
                    <div class="sp-section-head">
                        <strong>自己扩展</strong>
                        <span>不想打包？也可以逐条添加，只写增量</span>
                    </div>
                    <div class="sp-hint">
                        在风格选择器里新增的条目会写进用户增量层（几 KB），不进安装包、升级不丢。
                        想整包分享给别人时，在左侧选中包后点「导出」即可拿到 zip。
                    </div>
                </div>
            </div>
        </section>`;
    }

    function renderDetail() {
        const pack = state.packs.find((p) => p.packId === state.selected);
        if (!pack) {
            return `<aside class="asset-panel asset-detail"><div class="detail-empty">选择左侧的风格包查看详情</div></aside>`;
        }
        const busy = state.busy === pack.packId;
        return `<aside class="asset-panel asset-detail">
            <div class="panel-head">
                <div class="panel-title"><strong>${esc(pack.name)}</strong><span>${pack.builtin ? '随程序内置' : '用户导入'}</span></div>
            </div>
            <div class="detail-scroll">
                <div class="sp-detail">
                    <div class="sp-kv"><span>包标识</span><code>${esc(pack.packId)}</code></div>
                    <div class="sp-kv"><span>版本</span><b>${esc(pack.version)}</b></div>
                    <div class="sp-kv"><span>作者</span><b>${esc(pack.author || '—')}</b></div>
                    <div class="sp-kv"><span>条目</span><b>${fmtNum(pack.entryCount)} 条</b></div>
                    <div class="sp-kv"><span>分类</span><b>${pack.categoryCount} 个</b></div>
                    <div class="sp-desc">${esc(pack.description || '（无描述）')}</div>
                    <div class="sp-card-actions">
                        <button class="asset-btn" type="button" data-sp-export="${esc(pack.packId)}"><i data-lucide="download"></i><span>导出 zip</span></button>
                        ${pack.builtin
                            ? '<button class="asset-btn" type="button" disabled title="内置包不可卸载"><i data-lucide="lock"></i><span>内置</span></button>'
                            : `<button class="asset-btn danger" type="button" data-sp-uninstall="${esc(pack.packId)}" ${busy ? 'disabled' : ''}><i data-lucide="trash-2"></i><span>${busy ? '处理中' : '卸载'}</span></button>`}
                    </div>
                </div>
            </div>
        </aside>`;
    }

    let rootEl = null;

    function paint() {
        if (!rootEl) return;
        if (!state.loaded && state.loading) {
            rootEl.innerHTML = '<div class="sp-loading">正在读取风格包…</div>';
            return;
        }
        rootEl.innerHTML = renderNav() + renderContent() + renderDetail();
        icons();
    }

    function onClick(event) {
        const target = event.target.closest('[data-sp-select],[data-sp-install],[data-sp-uninstall],[data-sp-export],[data-sp-import],[data-sp-refresh]');
        if (!target) return;
        if (target.dataset.spSelect) {
            state.selected = target.dataset.spSelect;
            paint();
        } else if (target.dataset.spInstall) {
            installPack(target.dataset.spInstall);
        } else if (target.dataset.spUninstall) {
            uninstallPack(target.dataset.spUninstall);
        } else if (target.dataset.spExport) {
            window.open(API.download(target.dataset.spExport), '_blank');
        } else if (target.hasAttribute('data-sp-import')) {
            pickZipFile();
        } else if (target.hasAttribute('data-sp-refresh')) {
            load(true);
        }
    }

    function render(root) {
        rootEl = root;
        if (!rootEl.__spBound) {
            rootEl.__spBound = true;
            rootEl.addEventListener('click', onClick);
        }
        load(false);
        paint();
    }

    window.StylePackManager = { render, reload: () => load(true) };
})();
