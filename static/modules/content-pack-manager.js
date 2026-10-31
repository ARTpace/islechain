/**
 * 资产库 · 内容包管理（角色包 / 画师包）
 *
 * 角色与画师的全量数据都不随仓库分发：程序内置一个精简种子包，其余按热度分档
 * 打成 zip，用户在这里一键安装或导入自己的包。安装后落在用户目录，可卸载、
 * 升级不丢，也不进 git。
 *
 * 两种包的接口完全同构（列表 / 导入 / 安装 / 导出 / 卸载），所以本模块用
 * KINDS 配置驱动：新增一种内容包只在这里加一条，不用再写一遍 UI。
 *
 * 对外只有 ContentPackManager.render(rootEl) 一个入口，
 * 由 asset-manager.js 在 activeTab === 'content-packs' 时调用。
 */
(function () {
    'use strict';

    const KINDS = [
        {
            key: 'characters',
            label: '角色包',
            unit: '角色',
            api: '/api/characters',
            hint: '支撑角色选择器的搜索与列表；点开某个角色才加载 tags 与出处。',
        },
        {
            key: 'artists',
            label: '画师包',
            unit: '画师',
            api: '/api/artists',
            hint: '画师提示词与预览图；图片直连官方 CDN，不占本地空间。',
        },
    ];

    const state = {
        loaded: false,
        loading: false,
        error: '',
        notice: '',
        busy: '',
        data: {},   // kind -> {installed, official, stats}
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

    async function loadKind(kind) {
        try {
            state.data[kind.key] = await getJson(kind.api + '/packs');
        } catch (err) {
            state.data[kind.key] = { error: err.message || '加载失败' };
        }
    }

    async function load(force) {
        if (state.loading) return;
        if (state.loaded && !force) return;
        state.loading = true;
        state.error = '';
        paint();
        try {
            await Promise.all(KINDS.map(loadKind));
            state.loaded = true;
        } catch (err) {
            state.error = err.message || '内容包列表加载失败';
        } finally {
            state.loading = false;
            paint();
        }
    }

    async function act(key, kind, fn, okText, failText) {
        state.busy = key;
        state.notice = '';
        paint();
        try {
            await fn();
            state.notice = okText;
            await load(true);
        } catch (err) {
            state.notice = failText + '：' + (err.message || '未知错误');
        } finally {
            state.busy = '';
            paint();
        }
    }

    function installPack(kind, packId) {
        return act(packId, kind, () => getJson(kind.api + '/packs/install-official', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ packId: packId, replace: false }),
        }), '已安装 ' + packId, '安装失败');
    }

    function uninstallPack(kind, packId) {
        if (!window.confirm('卸载' + kind.label + ' ' + packId + '？\n\n包里的' + kind.unit +
            '数据会一并移除，你自己添加的条目不受影响。')) return Promise.resolve();
        return act(packId, kind, () => getJson(
            kind.api + '/packs/' + encodeURIComponent(packId), { method: 'DELETE' }),
            '已卸载 ' + packId, '卸载失败');
    }

    function importZip(kind, file) {
        if (!file) return Promise.resolve();
        const form = new FormData();
        form.append('file', file);
        return act('import-' + kind.key, kind, () => getJson(
            kind.api + '/packs/import?replace=false', { method: 'POST', body: form }),
            '已导入 ' + file.name, '导入失败');
    }

    function pickZipFile(kind) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip,application/zip';
        input.addEventListener('change', () => importZip(kind, input.files && input.files[0]));
        input.click();
    }

    function installedOf(kind) {
        const data = state.data[kind.key] || {};
        return data.installed || [];
    }

    function officialOf(kind) {
        const data = state.data[kind.key] || {};
        return (data.official && data.official.packs) || [];
    }

    function totalOf(kind) {
        return installedOf(kind).reduce((sum, p) => sum + Number(p.entryCount || 0), 0);
    }

    function renderInstalledCard(kind, pack) {
        const busy = state.busy === pack.packId;
        const action = pack.builtin
            ? '<button class="asset-btn" type="button" disabled title="内置包不可卸载"><i data-lucide="lock"></i><span>内置</span></button>'
            : `<button class="asset-btn danger" type="button" data-cp-uninstall="${esc(pack.packId)}" data-cp-kind="${kind.key}" ${busy ? 'disabled' : ''}>
                   <i data-lucide="trash-2"></i><span>${busy ? '处理中' : '卸载'}</span>
               </button>`;
        return `<div class="sp-card">
            <div class="sp-card-head">
                <div class="sp-card-title">
                    <strong>${esc(pack.name)}</strong>
                    <span class="sp-badge">${esc(pack.version)}</span>
                    <span class="sp-badge ok">已安装</span>
                </div>
            </div>
            <div class="sp-card-desc">${esc(pack.description || ('随程序的' + kind.label))}</div>
            <div class="sp-card-meta">
                <span><i data-lucide="layers"></i>${fmtNum(pack.entryCount)} 个${esc(kind.unit)}</span>
                <span><i data-lucide="${pack.builtin ? 'package' : 'package-plus'}"></i>${pack.builtin ? '随程序' : '用户安装'}</span>
            </div>
            <div class="sp-card-actions">
                <button class="asset-btn" type="button" data-cp-export="${esc(pack.packId)}" data-cp-kind="${kind.key}"><i data-lucide="download"></i><span>导出</span></button>
                ${action}
            </div>
        </div>`;
    }

    function renderOfficialCard(kind, pack) {
        const busy = state.busy === pack.packId;
        const action = pack.installed
            ? '<button class="asset-btn" type="button" disabled><i data-lucide="check"></i><span>已安装</span></button>'
            : `<button class="asset-btn primary" type="button" data-cp-install="${esc(pack.packId)}" data-cp-kind="${kind.key}" ${busy || !pack.available ? 'disabled' : ''}>
                   <i data-lucide="${busy ? 'loader' : 'download'}"></i><span>${busy ? '安装中' : (pack.available ? '安装' : '未随包分发')}</span>
               </button>`;
        return `<div class="sp-card">
            <div class="sp-card-head">
                <div class="sp-card-title">
                    <strong>${esc(pack.name)}</strong>
                    <span class="sp-badge">${esc(pack.version)}</span>
                </div>
            </div>
            <div class="sp-card-desc">${esc(pack.description || '按热度拆分的扩展包')}</div>
            <div class="sp-card-meta">
                <span><i data-lucide="layers"></i>${fmtNum(pack.entryCount)} 个${esc(kind.unit)}</span>
                <span><i data-lucide="hard-drive"></i>${fmtSize(pack.sizeBytes)}</span>
            </div>
            <div class="sp-card-actions">${action}</div>
        </div>`;
    }

    function renderKind(kind) {
        const data = state.data[kind.key];
        if (!data) return '';
        if (data.error) {
            return `<div class="sp-section">
                <div class="sp-section-head"><strong>${kind.label}</strong></div>
                <div class="sp-notice error">${esc(data.error)}</div>
            </div>`;
        }

        const installed = installedOf(kind);
        const official = officialOf(kind);
        const installable = official.filter((p) => !p.installed).length;

        const installedCards = installed.map((p) => renderInstalledCard(kind, p)).join('');
        const officialCards = official
            .filter((p) => !p.installed)
            .map((p) => renderOfficialCard(kind, p)).join('');

        return `<div class="sp-section">
            <div class="sp-section-head">
                <strong>${kind.label}</strong>
                <span>已装 ${installed.length} 个包 · ${fmtNum(totalOf(kind))} 个${kind.unit}${installable ? ' · 还有 ' + installable + ' 个可装' : ''}</span>
                <span style="margin-left:auto">
                    <button class="asset-btn" type="button" data-cp-import="${kind.key}"><i data-lucide="upload"></i><span>导入 zip</span></button>
                </span>
            </div>
            <div class="sp-hint">${esc(kind.hint)}</div>
            ${installedCards ? `<div class="sp-grid">${installedCards}</div>` : '<div class="empty-state">还没有安装任何' + kind.label + '</div>'}
            ${officialCards ? `<div class="sp-section-head" style="margin-top:16px"><strong>可安装</strong><span>装哪个只占哪个的体积</span></div>
                <div class="sp-grid">${officialCards}</div>` : ''}
        </div>`;
    }

    let rootEl = null;

    function paint() {
        if (!rootEl) return;
        if (!state.loaded && state.loading) {
            rootEl.innerHTML = '<div class="sp-loading">正在读取内容包…</div>';
            return;
        }
        rootEl.innerHTML = `<section class="asset-panel asset-content">
            <div class="content-toolbar">
                <div class="content-heading">
                    <strong>内容包</strong>
                    <span>角色与画师数据按需安装，随用随装，不进仓库</span>
                </div>
                <div class="asset-tools">
                    <button class="asset-btn" type="button" data-cp-refresh><i data-lucide="refresh-cw"></i><span>刷新</span></button>
                </div>
            </div>
            <div class="content-scroll">
                ${state.notice ? `<div class="sp-notice">${esc(state.notice)}</div>` : ''}
                ${state.error ? `<div class="sp-notice error">${esc(state.error)}</div>` : ''}
                ${KINDS.map(renderKind).join('')}
            </div>
        </section>`;
        icons();
    }

    function kindOf(key) {
        return KINDS.find((k) => k.key === key);
    }

    function onClick(event) {
        const target = event.target.closest(
            '[data-cp-install],[data-cp-uninstall],[data-cp-export],[data-cp-import],[data-cp-refresh]');
        if (!target) return;

        const kind = kindOf(target.dataset.cpKind);
        if (target.dataset.cpInstall && kind) {
            installPack(kind, target.dataset.cpInstall);
        } else if (target.dataset.cpUninstall && kind) {
            uninstallPack(kind, target.dataset.cpUninstall);
        } else if (target.dataset.cpExport && kind) {
            window.open(kind.api + '/packs/' + encodeURIComponent(target.dataset.cpExport) + '/download', '_blank');
        } else if (target.dataset.cpImport) {
            pickZipFile(kindOf(target.dataset.cpImport));
        } else if (target.hasAttribute('data-cp-refresh')) {
            load(true);
        }
    }

    function render(root) {
        rootEl = root;
        if (!rootEl.__cpBound) {
            rootEl.__cpBound = true;
            rootEl.addEventListener('click', onClick);
        }
        load(false);
        paint();
    }

    window.ContentPackManager = { render, reload: () => load(true) };
})();
