/* 沿用项目 Cookie 身份；所有内容通过 textContent/value 呈现，不执行工程源码。 */
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const projectId = new URLSearchParams(location.search).get('projectId');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(projectId || '')) { $('status').textContent = '缺少有效项目 ID，请从游戏项目进入。'; return; }
    const base = `/api/game-projects/${projectId}/workspace`;
    let state, file = null, dataFile = null, busy = false, builds = [], previewChannel = null, previewBuild = null, diagnostics = [], projectData;
    let fileDirty = false, dataDirty = false, codeCandidate = null;
    async function api(path = '', method = 'GET', data) {
        const response = await fetch(base + path, {method, headers: {'Content-Type': 'application/json'},
            ...(data === undefined ? {} : {body: JSON.stringify(data)})});
        const raw = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof raw.detail === 'string' ? raw.detail : JSON.stringify(raw.detail || '请求失败'));
        return raw;
    }
    async function action(operation) {
        if (busy) return;
        busy = true;
        document.querySelectorAll('button:not([data-native])').forEach(button => { button.disabled = true; });
        try { const result = await operation(); if (result !== false) $('status').textContent = '操作完成'; }
        catch (error) { $('status').textContent = error.message; $('status').scrollIntoView({block:'center'}); }
        finally { busy = false; document.querySelectorAll('button:not([data-native])').forEach(button => { button.disabled = false; }); }
    }
    function protect() { return !(fileDirty || dataDirty) || confirm('存在未保存草稿。确认放弃草稿？'); }
    function render() {
        $('editor').hidden = !state.active; $('dataSection').hidden = !state.active;
        $('buildSection').hidden = !state.active;
        $('create').hidden = !!state.active; $('export').hidden = !state.active;
        $('export').href = base + '/source.zip';
        $('backup').href = base + '/backup.zip';
        $('execution').textContent = `${state.executionReason}。工程修订 ${state.revision} · epoch ${state.workspaceEpoch}`;
        $('files').replaceChildren();
        for (const item of state.files.filter(f => f.path.toLowerCase().includes($('search').value.toLowerCase()))) {
            const button = document.createElement('button'); button.textContent = item.path;
            button.onclick = () => action(async () => {
                if (fileDirty && !confirm('放弃当前文件草稿？')) return;
                file = await api('/file?path=' + encodeURIComponent(item.path));
                $('fileTitle').textContent = file.path; $('content').value = file.content; fileDirty = false; $('diff').textContent = '';
            });
            $('files').append(button);
        }
        $('snapshots').replaceChildren();
        for (const snapshot of [...state.snapshots].reverse()) {
            const option = document.createElement('option'); option.value = snapshot.snapshotId;
            option.textContent = `${snapshot.label} · ${snapshot.snapshotId.slice(-8)}`; $('snapshots').append(option);
        }
    }
    async function reload() {
        const fresh = await api();
        const projectResponse = await fetch(`/api/game-projects/${projectId}`);
        if (!projectResponse.ok) throw new Error('项目不可用，请重载');
        projectData = (await projectResponse.json()).project;
        $('projectTitle').textContent = projectData.title;
        if (state && state.workspaceEpoch !== fresh.workspaceEpoch) {
            $('gamePreview').src = 'about:blank'; $('gamePreview').hidden = true; previewChannel = null;
        }
        state = fresh; file = dataFile = null; fileDirty = dataDirty = false;
        builds = await api('/builds');
        $('builds').replaceChildren();
        for (const build of [...builds].reverse()) {
            const option = document.createElement('option'); option.value = build.buildId;
            option.textContent = `工程版本 r${build.workspaceRevision} · ${build.releaseCandidate ? '正式候选' : '开发试玩'} · ${build.buildId.slice(-6)}`; $('builds').append(option);
        }
        const pinnedBuild = new URLSearchParams(location.search).get('buildId');
        if (pinnedBuild) {
            if (!builds.some(b => b.buildId === pinnedBuild)) throw new Error('画布引用的固定构建已失效，请返回画布重新构建。');
            $('builds').value = pinnedBuild;
        }
        $('content').value = $('data').value = $('diff').textContent = ''; $('fileTitle').textContent = '选择文件'; render();
    }
    function patch(apply, remove = false) {
        if (!file) throw new Error('请先选择或新建文件');
        return api('/patches', 'POST', {baseRevision: file.revision, apply,
            changes: [{path: file.path, baseHash: file.hash, content: remove ? null : $('content').value}]});
    }
    function showDiff(result) { const text = result.changes.map(c => c.diff || `${c.path} 无文本差异`).join('\n'); $('diff').textContent = text; if (document.getElementById('dataDiff') && location.hash === '#data') $('dataDiff').textContent = text; }
    $('search').oninput = () => state && render();
    async function codeApi(path = '', data) {
        const response = await fetch(`/api/game-projects/${projectId}/code-candidates${path}`, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
        const raw = await response.json();
        if (!response.ok) throw new Error(typeof raw.detail === 'string' ? raw.detail : JSON.stringify(raw.detail));
        return raw;
    }
    $('generateCode').onclick = () => action(async () => {
        if (!file) throw new Error('先选择要修改的文件');
        if (fileDirty || dataDirty) throw new Error('先保存相关草稿，模型只读取已保存输入');
        if (!confirm('使用已配置模型生成候选？可能产生渠道费用。')) return;
        codeCandidate = await codeApi('', {baseRevision: state.revision, requestId: crypto.randomUUID(),
            paths: [file.path], instruction: $('codeInstruction').value,
            provider: $('codeProvider').value.trim(), model: $('codeModel').value.trim()});
        $('codeStatus').textContent = `${codeCandidate.status}\n${codeCandidate.diagnostics.join('\n')}`;
        if (codeCandidate.status === 'ready') showDiff(await api('/patches', 'POST', {
            baseRevision: state.revision, apply: false, changes: codeCandidate.changes}));
    });
    $('applyCode').onclick = () => action(async () => {
        if (!codeCandidate || codeCandidate.status !== 'ready') throw new Error('没有可采用的候选');
        if (fileDirty || dataDirty) throw new Error('先处理文件和数据草稿');
        showDiff(await api('/patches', 'POST', {baseRevision: state.revision, apply: false, changes: codeCandidate.changes}));
        if (!confirm('应用所示候选差异？当前源码会先创建保护点；应用后需重新构建和验证。')) return;
        await codeApi(`/${codeCandidate.candidateId}/apply`, {baseRevision: state.revision});
        codeCandidate = null; $('codeStatus').textContent = '已采用，尚未验证功能'; await reload();
    });
    $('content').oninput = () => { fileDirty = true; };
    $('data').oninput = () => { dataDirty = true; renderDataForm(); };
    function renderDataForm() {
        const container = $('dataTable'); container.replaceChildren();
        let content;
        try { content = JSON.parse($('data').value); } catch { container.textContent = '载入数据，或先修正 JSON 格式'; return; }
        const dataset = content.datasets?.find(d => d.datasetId === $('dataset').value);
        if (!dataset) return;
        const table = document.createElement('table'), head = document.createElement('tr');
        for (const title of ['行 ID', ...dataset.fields.map(f => f.title), '操作']) { const cell = document.createElement('th'); cell.textContent = title; head.append(cell); }
        table.append(head);
        const sync = () => { $('data').value = JSON.stringify(content, null, 2); dataDirty = true; };
        for (const row of dataset.rows) {
            const tr = document.createElement('tr'), idCell = document.createElement('td'); idCell.textContent = row.id; tr.append(idCell);
            for (const field of dataset.fields) {
                const cell = document.createElement('td'); let control;
                if (['enum', 'reference', 'asset', 'boolean'].includes(field.type)) {
                    control = document.createElement('select');
                    const choices = field.type === 'enum' ? field.options : field.type === 'reference'
                        ? content.datasets.find(d => d.datasetId === field.referenceDataset)?.rows.map(r => r.id) || []
                        : field.type === 'asset' ? projectData.assets.map(a => a.id) : ['true', 'false'];
                    for (const value of ['', ...choices]) { const option = document.createElement('option'); option.value = value; option.textContent = value || '未设置'; control.append(option); }
                    control.value = row.values[field.id] == null ? '' : String(row.values[field.id]);
                } else {
                    control = document.createElement('input'); control.type = ['number', 'integer'].includes(field.type) ? 'number' : 'text';
                    if (control.type === 'number') { control.step = field.type === 'integer' ? '1' : 'any'; if (field.minimum != null) control.min = field.minimum; if (field.maximum != null) control.max = field.maximum; }
                    control.value = row.values[field.id] ?? '';
                }
                control.setAttribute('aria-label', `${dataset.datasetId}/${row.id}/${field.id}`);
                control.onchange = () => {
                    const value = control.value;
                    row.values[field.id] = value === '' ? null : field.type === 'boolean' ? value === 'true'
                        : ['number', 'integer'].includes(field.type) ? Number(value) : value; sync();
                };
                cell.append(control); tr.append(cell);
            }
            const removeCell = document.createElement('td'), remove = document.createElement('button'); remove.textContent = '删除行';
            remove.onclick = () => { if (!confirm(`删除 ${row.id}？被引用时后端会拒绝保存。`)) return; dataset.rows = dataset.rows.filter(item => item !== row); sync(); renderDataForm(); };
            removeCell.append(remove); tr.append(removeCell); table.append(tr);
        }
        container.append(table);
    }
    $('dataset').onchange = renderDataForm;
    $('addRow').onclick = () => action(async () => {
        if (!dataFile) throw new Error('先载入数据');
        const content = JSON.parse($('data').value), dataset = content.datasets.find(d => d.datasetId === $('dataset').value);
        const id = prompt('填写稳定行 ID（字母、数字、下划线、短横线）：'); if (!id) return;
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || dataset.rows.some(r => r.id === id)) throw new Error('行 ID 无效或重复');
        const values = {};
        for (const field of dataset.fields) values[field.id] = !field.required ? null : field.type === 'boolean' ? false
            : ['number', 'integer'].includes(field.type) ? field.minimum ?? 0 : field.type === 'enum' ? field.options[0]
            : field.type === 'reference' ? content.datasets.find(d => d.datasetId === field.referenceDataset)?.rows[0]?.id || '' : '';
        dataset.rows.push({id, values}); $('data').value = JSON.stringify(content, null, 2); dataDirty = true; renderDataForm();
    });
    $('create').onclick = () => action(async () => { await api('', 'POST'); await reload(); });
    $('adoptBackup').onclick = () => action(async () => {
        const file = $('importBackup').files[0]; if (!file) throw new Error('选择备份 ZIP');
        if (file.size > 100 * 1024 * 1024) throw new Error('备份超过 100 MiB');
        const canvasId = $('importCanvas').value.trim(), title = $('importTitle').value.trim();
        if (!canvasId || !title) throw new Error('填写目标画布 ID 和标题');
        if (!confirm('校验备份并在目标画布创建新项目？不会执行包内脚本。')) return;
        const response = await fetch(`/api/game-projects/import-backup?canvasId=${encodeURIComponent(canvasId)}&title=${encodeURIComponent(title)}`, {method:'POST',body:file});
        const result = await response.json(); if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : JSON.stringify(result.detail));
        $('status').textContent = `新项目已导入：${result.project.id}`;
        const link = document.createElement('a'); link.href = `/static/game-workbench.html?projectId=${result.project.id}`; link.textContent = '打开导入项目'; link.target = '_blank'; link.rel = 'noopener'; $('status').append(' ', link);
        return false;
    });
    $('installTemplate').onclick = () => action(async () => {
        if (!protect() || !confirm('添加原生 Canvas 灰盒模板？已有 game.js 时会阻止覆盖。')) return;
        await api('/template', 'POST', {baseRevision: state.revision}); await reload();
    });
    $('build').onclick = () => action(async () => {
        if (fileDirty || dataDirty) throw new Error('请先保存文件和数据草稿');
        const build = await api('/builds', 'POST', {baseRevision: state.revision});
        await reload(); $('buildDetails').textContent = JSON.stringify(build, null, 2);
    });
    $('buildReleaseCandidate').onclick = () => action(async () => {
        if (fileDirty || dataDirty) throw new Error('请先保存文件和数据草稿');
        const build = await api('/builds', 'POST', {baseRevision: state.revision,
            releaseCandidate: true, licenses: JSON.parse($('releaseLicenses').value)});
        await reload(); $('builds').value = build.buildId;
        $('releaseDetails').textContent = JSON.stringify(build, null, 2);
    });
    $('createRelease').onclick = () => action(async () => {
        const buildId = $('builds').value; if (!buildId) throw new Error('先选择正式候选构建');
        if (fileDirty || dataDirty) throw new Error('先处理未保存草稿');
        $('releaseDownload').hidden = true;
        const lines = name => $(name).value.split('\n').map(value => value.trim()).filter(Boolean);
        const release = await api(`/builds/${buildId}/releases`, 'POST', {
            reportIds: lines('releaseReports'), gameplayConfirmed: $('gameplayConfirmed').checked,
            visualConfirmed: $('visualConfirmed').checked, licensesConfirmed: $('licensesConfirmed').checked,
            knownLimitations: lines('releaseLimitations')});
        $('releaseDownload').href = `${base}/releases/${release.releaseId}`; $('releaseDownload').hidden = false;
        $('releaseDetails').textContent = JSON.stringify(release, null, 2);
    });
    $('previewBuild').onclick = () => action(async () => {
        const buildId = $('builds').value; if (!buildId) throw new Error('先创建构建');
        previewChannel = crypto.randomUUID(); previewBuild = buildId; diagnostics = [];
        $('gamePreview').onload = () => {
            if (!$('gamePreview').hidden && location.hash === '#play') $('gamePreview').scrollIntoView({block:'start'});
        };
        $('gamePreview').src = `${base}/builds/${buildId}/preview?channel=${previewChannel}&fit=true`; $('gamePreview').hidden = false;
        $('exportWeb').href = `${base}/builds/${buildId}/web.zip`; $('exportWeb').hidden = false;
        $('buildDetails').textContent = JSON.stringify(builds.find(b => b.buildId === buildId), null, 2);
    });
    $('stopPreview').onclick = () => { previewChannel = null; $('gamePreview').src = 'about:blank'; $('gamePreview').hidden = true; };
    async function reloadSessions() {
        const records = await api('/sessions'); $('sessions').replaceChildren();
        for (const record of records) { const option = document.createElement('option'); option.value = record.sessionId; option.textContent = `${record.sessionId} · ${record.state}`; $('sessions').append(option); }
    }
    const selectedSession = () => { const id = $('sessions').value; if (!id) throw new Error('先选择独立会话'); return id; };
    $('measureSession').onclick = () => action(async () => {
        $('sessionObservation').textContent = JSON.stringify(await api(`/sessions/${selectedSession()}/frame-intervals`, 'POST'), null, 2);
    });
    $('openSession').onclick = () => action(async () => {
        if (!$('builds').value) throw new Error('先创建固定构建');
        const session = await api('/sessions', 'POST', {buildId: $('builds').value}); await reloadSessions(); $('sessions').value = session.sessionId;
    });
    $('reloadSessions').onclick = () => action(reloadSessions);
    $('inspectSession').onclick = () => action(async () => { $('sessionObservation').textContent = JSON.stringify(await api(`/sessions/${selectedSession()}`), null, 2); });
    $('actSession').onclick = () => action(async () => { $('sessionObservation').textContent = JSON.stringify(await api(`/sessions/${selectedSession()}/actions`, 'POST', {actions: JSON.parse($('sessionActions').value)}), null, 2); });
    $('captureSession').onclick = () => action(async () => {
        const capture = await api(`/sessions/${selectedSession()}/capture`, 'POST');
        const link = document.createElement('a'); link.href = `${base}/captures/${capture.evidenceId}`; link.target = '_blank'; link.rel = 'noopener'; link.textContent = '查看固定构建截图 ' + capture.evidenceId; $('sessionCaptures').append(link, document.createElement('br'));
    });
    $('closeSession').onclick = () => action(async () => { await api(`/sessions/${selectedSession()}`, 'DELETE'); await reloadSessions(); });
    window.addEventListener('message', event => {
        const data = event.data;
        if (event.source !== $('gamePreview').contentWindow || event.origin !== 'null' || !previewChannel
            || data?.type !== 'game-preview-diagnostic' || data.channel !== previewChannel || data.buildId !== previewBuild
            || !['error', 'rejection'].includes(data.kind) || typeof data.message !== 'string' || diagnostics.length >= 100) return;
        diagnostics.push(data.message.slice(0, 1000)); $('buildDetails').textContent = diagnostics.join('\n');
    });
    $('reload').onclick = () => action(async () => { if (protect()) await reload(); });
    $('newFile').onclick = () => action(async () => {
        if (fileDirty && !confirm('放弃当前文件草稿？')) return;
        const path = $('newPath').value.trim(); if (!path) throw new Error('请输入新文件路径');
        if (state.files.some(f => f.path.toLowerCase() === path.toLowerCase())) throw new Error('文件已存在，请在列表中打开');
        file = {path, hash: null, revision: state.revision}; $('content').value = ''; $('fileTitle').textContent = path; fileDirty = true;
    });
    $('preview').onclick = () => action(async () => { showDiff(await patch(false)); });
    $('save').onclick = () => action(async () => {
        if (dataDirty) throw new Error('请先保存数据草稿，避免重新载入时丢失');
        showDiff(await patch(false)); if (!confirm('应用所示差异？更改前会保留恢复点。')) return;
        await patch(true); fileDirty = false; await reload();
    });
    $('remove').onclick = () => action(async () => {
        if (dataDirty) throw new Error('请先保存数据草稿');
        if (!file || !confirm(`删除 ${file.path}？删除前保留恢复点。`)) return;
        await patch(true, true); fileDirty = false; await reload();
    });
    $('restore').onclick = () => action(async () => {
        const fullProject = $('restoreFullProject').checked;
        if (!protect() || !confirm(fullProject ? '恢复工程、策划、文档与资产选择？当前版本先保留保护点，测试历史保留。' : '恢复工程文件？当前文件先保留保护点，策划与测试历史保留。')) return;
        try {
            await api('/restore', 'POST', {baseRevision: state.revision, snapshotId: $('snapshots').value, fullProject});
        } catch (error) {
            $('restoreRecovery').hidden = !(await api('/restore-transaction')).pending;
            throw error;
        }
        await reload();
    });
    for (const [button, decision] of [['continueRestore', 'continue'], ['rollbackRestore', 'rollback']]) {
        $(button).onclick = () => action(async () => {
            await api('/restore-transaction', 'POST', {decision}); $('restoreRecovery').hidden = true; await reload();
        });
    }
    $('loadData').onclick = () => action(async () => {
        if (dataDirty && !confirm('放弃数据草稿？')) return;
        dataFile = await api('/datasets'); $('data').value = dataFile.content; dataDirty = false; renderDataForm();
        if ($('dataNotice')) $('dataNotice').textContent = '已载入当前数据。修改后点击「校验并预览数据差异」。';
    });
    async function saveData(apply) {
        if (!dataFile) throw new Error('请先载入当前数据，再编辑或导入');
        return api('/datasets', 'PUT', {baseRevision: dataFile.revision, baseHash: dataFile.hash,
            content: JSON.parse($('data').value), apply});
    }
    $('previewData').onclick = () => action(async () => {
        showDiff(await saveData(false));
        if ($('dataNotice')) $('dataNotice').textContent = '数据校验通过，尚未保存。确认修改后点击「应用数据」。';
    });
    $('saveData').onclick = () => action(async () => {
        if (fileDirty) throw new Error('请先处理文件草稿，避免重新载入时丢失');
        showDiff(await saveData(false)); if (!confirm('应用校验通过的数据差异？')) return;
        await saveData(true); dataDirty = false; await reload();
        dataFile = await api('/datasets'); $('data').value = dataFile.content; renderDataForm();
        if ($('dataNotice')) $('dataNotice').textContent = '数据已保存。回到「试玩」点击「更新试玩版本」，新数值才会进入新的试玩构建。';
    });
    $('importData').onchange = event => action(async () => {
        const selected = event.target.files[0]; if (!selected) return;
        if (!dataFile) throw new Error('请先载入当前数据');
        if (selected.size > 1048576) throw new Error('JSON 超过 1 MiB');
        const text = await selected.text(); JSON.parse(text); $('data').value = text; dataDirty = true;
        renderDataForm();
        showDiff(await saveData(false));
    });
    $('exportData').onclick = () => action(async () => {
        const data = JSON.stringify(JSON.parse($('data').value), null, 2);
        const url = URL.createObjectURL(new Blob([data], {type: 'application/json'}));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'game-data.json'; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    window.addEventListener('beforeunload', event => {
        if (fileDirty || dataDirty) { event.preventDefault(); event.returnValue = ''; }
    });
    document.addEventListener('game-native-before-operation', event => {
        if (fileDirty || dataDirty) {event.preventDefault();$('status').textContent='请先保存源码和数值草稿，再执行本机工程操作。';}
    });
    document.addEventListener('game-native-source-changed', () => void action(reload));
    document.addEventListener('game-assets-changed', () => void action(reload));
    action(async () => {
        const recovery = await api('/restore-transaction');
        if (recovery.pending) { $('restoreRecovery').hidden = false; $('status').textContent = '请先处理未完成的完整恢复'; return false; }
        await reload();
    });
})();
