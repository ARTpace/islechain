/* CLI 生图节点：选择 /api/cli/capabilities 里的能力，调用 /api/cli/run，图片结果可存到画布 */
(() => {
    'use strict';
    let deps = null;
    let capsCache = null;
    let wfCache = null;
    // 一个 CLI 一个节点类型：节点类型写死归属，不允许跨 CLI 切换。
    const CLI_NODE_CLI = { cliComfy: 'comfy', cliTripo: 'tripo', cliJimeng: 'jimeng',
                          cliCodex: 'codex', cliGemini: 'gemini-cli' };
    const CLI_LABEL = { comfy: 'Comfy CLI', tripo: 'Tripo CLI', jimeng: '即梦 CLI',
                       codex: 'Codex CLI', 'gemini-cli': 'Antigravity CLI' };
    const DEFAULT_CAP = { comfy: 'local-run', tripo: 'dry-run', jimeng: 'user-credit', codex: 'doctor', 'gemini-cli': 'mcp-list' };
    // 旧 cliGen 节点保留 node.cli（兼容已存画布），新节点一律以 type 为准。
    function cliOf(node) { return CLI_NODE_CLI[node.type] || node.cli || 'comfy'; }

    async function loadWorkflows() {
        if (wfCache) return wfCache;
        try {
            const res = await fetch('/api/cli/workflows');
            const data = await res.json();
            wfCache = data.items || [];
        } catch (e) { wfCache = []; }
        return wfCache;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }
    function allNodes() { return deps ? deps.nodes() : []; }
    function findNode(id) { return allNodes().find(n => n.id === id); }
    function upstreamText(id) {
        if (!deps || !deps.connections) return '';
        return deps.connections().filter(e => e.to === id)
            .map(e => allNodes().find(n => n.id === e.from)).filter(Boolean)
            .map(n => n.text || n.outputText || '').filter(Boolean).join('\n');
    }

    async function loadCaps() {
        if (capsCache) return capsCache;
        try {
            const res = await fetch('/api/cli/capabilities');
            const data = await res.json();
            capsCache = (data.clis || []).flatMap(c => (c.capabilities || []).map(cap => ({
                cli: c.id, id: cap.id, label: cap.label || cap.id,
                billing: !!cap.billing, available: c.available !== false,
                inputs: cap.inputs || []
            })));
        } catch (e) { capsCache = []; }
        return capsCache;
    }

    function addCliNode(point, cli, type) {
        const p = point || defaultPoint(0, 0);
        const cid = cli || CLI_NODE_CLI[type] || 'comfy';
        return addNode({
            id: uid('cli'), type: type || 'cliGen', x: p.x, y: p.y,
            cli: cid, capability: DEFAULT_CAP[cid] || '', prompt: '', model: '', workflow: '',
            status: 'idle', statusText: '', images: [], resultText: '', artifactUrl: '',
            models: [], armed: false, capInput: {}
        });
    }

    function button(label, onClick, primary) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'menu-btn';
        b.textContent = label;
        b.style.cssText = 'flex:1;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;'
            + (primary ? 'border-color:var(--accent,#f59e0b);' : '');
        b.onclick = ev => {
            ev.stopPropagation();
            Promise.resolve().then(onClick).catch(err => alert(err.message || String(err)));
        };
        return b;
    }

    function body(node) {
        const wrap = document.createElement('div');
        wrap.className = 'cli-gen-body';
        wrap.style.cssText = 'padding:10px;display:flex;flex-direction:column;gap:8px;font-size:12px;line-height:1.5';

        const cli = cliOf(node);
        const chip = document.createElement('div');
        chip.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--muted,#8b8b85)';
        chip.innerHTML = '<b style="color:var(--accent,#f59e0b)">' + esc(CLI_LABEL[cli] || cli) + '</b><span>专属节点 · 能力</span>';
        wrap.appendChild(chip);

        const sel = document.createElement('select');
        sel.className = 'setting-input';
        sel.style.cssText = 'width:100%;padding:6px 8px';
        const fallback = document.createElement('option');
        fallback.value = node.capability || '';
        fallback.textContent = node.capability || '载入能力中…';
        sel.appendChild(fallback);
        loadCaps().then(list => {
            const own = list.filter(c => c.cli === cli);
            sel.replaceChildren();
            if (!own.length) {
                const o = document.createElement('option');
                o.value = '';
                o.textContent = '该 CLI 暂未接入能力卡';
                sel.appendChild(o);
                node.capability = '';
            } else {
                own.forEach(cap => {
                    const o = document.createElement('option');
                    o.value = cap.id;
                    o.textContent = cap.label + (cap.billing ? ' · 计费' : '') + (cap.available ? '' : '（不可用）');
                    sel.appendChild(o);
                });
                if (!own.some(c => c.id === node.capability)) {
                    node.capability = own[0].id;
                    scheduleSave();
                }
                sel.value = node.capability;
            }
        });
        sel.onchange = () => {
            node.capability = sel.value;
            scheduleSave();
            render();
        };
        wrap.appendChild(sel);

        if (node.capability === 'workflow-run') {
            const wfSel = document.createElement('select');
            wfSel.className = 'setting-input';
            wfSel.style.cssText = 'width:100%;padding:6px 8px';
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = '选择工作流 · CLI/workflows';
            wfSel.appendChild(emptyOpt);
            loadWorkflows().then(list => {
                list.forEach(w => {
                    const o = document.createElement('option');
                    o.value = w.id;
                    o.textContent = w.name + ((w.tags || []).length ? ' · ' + w.tags.join('/') : '');
                    wfSel.appendChild(o);
                });
                wfSel.value = node.workflow || '';
            });
            wfSel.onchange = () => { node.workflow = wfSel.value; scheduleSave(); };
            wrap.appendChild(wfSel);
        }

        const ta = document.createElement('textarea');
        ta.className = 'setting-input';
        ta.placeholder = '提示词 · 留空则使用上游文本节点';
        ta.value = node.prompt || '';
        ta.style.cssText = 'width:100%;min-height:64px;resize:vertical;padding:6px 8px';
        ta.oninput = () => { node.prompt = ta.value; scheduleSave(); };
        wrap.appendChild(ta);

        // 按能力卡声明自动生成附加参数输入框（如即梦的 submit_id），无需为新 CLI 改节点代码
        loadCaps().then(list => {
            const meta = list.find(c => c.cli === cli && c.id === node.capability);
            ((meta && meta.inputs) || []).forEach(f => {
                if (!f || !f.name || ['prompt', 'model', 'workflow'].indexOf(f.name) >= 0) return;
                if (wrap.querySelector('[data-cap-input="' + f.name + '"]')) return;
                const extra = document.createElement('input');
                extra.className = 'setting-input';
                extra.dataset.capInput = f.name;
                extra.placeholder = (f.label || f.name) + (f.required ? ' · 必填' : ' · 可选');
                extra.value = ((node.capInput || {})[f.name]) || '';
                extra.style.cssText = 'width:100%;padding:6px 8px';
                extra.oninput = () => {
                    node.capInput = node.capInput || {};
                    node.capInput[f.name] = extra.value;
                    scheduleSave();
                };
                wrap.insertBefore(extra, ta);
            });
        });

        const model = document.createElement('input');
        model.className = 'setting-input';
        model.placeholder = '模型别名（可选 · 导出工作流 / 模型参数用）';
        model.value = node.model || '';
        model.style.cssText = 'width:100%;padding:6px 8px';
        model.oninput = () => { node.model = model.value; scheduleSave(); };
        wrap.appendChild(model);

        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;gap:8px;align-items:center';
        bar.appendChild(button(node.status === 'running' ? '运行中…' : (node.armed ? '再点确认' : '运行'), () => run(node.id), true));
        if ((node.images || []).length) bar.appendChild(button('存到画布', () => saveToCanvas(node)));
        wrap.appendChild(bar);

        const status = document.createElement('div');
        status.style.cssText = 'font-size:11px;word-break:break-all;color:'
            + (node.status === 'failed' ? '#f87171' : 'var(--muted,#8b8b85)');
        status.textContent = node.statusText || '';
        wrap.appendChild(status);

        if ((node.models || []).length) {
            const m0 = node.models[0];
            if (m0.ext === 'glb' || m0.ext === 'gltf') {
                const mv = document.createElement('model-viewer');
                mv.setAttribute('src', m0.url);
                mv.setAttribute('camera-controls', '');
                mv.setAttribute('auto-rotate', '');
                mv.setAttribute('shadow-intensity', '1');
                mv.style.cssText = 'width:100%;height:220px;display:block;border-radius:8px;background:var(--ui-panel)';
                wrap.appendChild(mv);
            }
            node.models.forEach(m => {
                const a = document.createElement('a');
                a.href = m.url; a.target = '_blank'; a.rel = 'noopener';
                a.textContent = String(m.ext || '').toUpperCase() + ' · ' + (m.filename || '模型') + ' ↗';
                a.style.cssText = 'display:block;font-size:11px;color:var(--accent,#f59e0b)';
                wrap.appendChild(a);
            });
        }
        if (node.artifactUrl) {
            const a = document.createElement('a');
            a.href = node.artifactUrl;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = '下载产物 ↗';
            a.style.cssText = 'font-size:11px;color:var(--accent,#f59e0b)';
            wrap.appendChild(a);
        }
        if ((node.images || []).length) {
            const grid = document.createElement('div');
            grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:6px';
            node.images.forEach(im => {
                const a = document.createElement('a');
                a.href = im.url;
                a.target = '_blank';
                a.rel = 'noopener';
                const img = document.createElement('img');
                img.src = im.url;
                img.alt = im.filename || '';
                img.style.cssText = 'width:100%;height:110px;object-fit:cover;border-radius:8px;display:block';
                a.appendChild(img);
                grid.appendChild(a);
            });
            wrap.appendChild(grid);
        } else if (node.resultText) {
            const pre = document.createElement('pre');
            pre.style.cssText = 'max-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:10.5px;margin:0;color:var(--muted,#8b8b85)';
            pre.textContent = String(node.resultText).slice(0, 3000);
            wrap.appendChild(pre);
        }
        return wrap;
    }

    async function run(id) {
        const node = findNode(id);
        if (!node || node.status === 'running') return;
        const cli = cliOf(node);
        node.cli = cli;
        const capList = await loadCaps();
        const capMeta = capList.find(c => c.cli === cli && c.id === node.capability);
        if (capMeta && capMeta.billing && !node.armed) {
            node.armed = true;
            node.status = 'idle';
            node.statusText = '计费能力 · 再点一次「运行」确认（会消耗积分或订阅额度）';
            setTimeout(() => { if (node.armed) { node.armed = false; render(); } }, 5000);
            render();
            return;
        }
        node.armed = false;
        if (!node.capability) {
            node.status = 'failed';
            node.statusText = '该 CLI 暂未接入能力卡（设置 → CLI 工具）';
            render();
            return;
        }
        const prompt = (upstreamText(id) || node.prompt || '').trim();
        const capInputs = (capMeta && capMeta.inputs) || [];
        const needsPrompt = node.capability === 'local-run'
            || capInputs.some(f => f.name === 'prompt' && f.required);
        if (!prompt && needsPrompt) {
            node.status = 'failed';
            node.statusText = '请填写提示词，或连接上游文本节点';
            render();
            return;
        }
        if (node.capability === 'workflow-run' && !(node.workflow || '').trim()) {
            node.status = 'failed';
            node.statusText = '请先选择工作流（设置 → CLI 工具 → 工作流库）';
            render();
            return;
        }
        node.status = 'running';
        node.statusText = '调用 CLI 中…';
        node.images = [];
        node.models = [];
        node.resultText = '';
        node.artifactUrl = '';
        render();
        try {
            const res = await fetch('/api/cli/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cli: cli, capability: node.capability,
                    input: Object.assign(
                        { prompt: prompt, model: (node.model || '').trim(), workflow: (node.workflow || '').trim() },
                        node.capInput || {}), params: {}
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || data.message || ('HTTP ' + res.status));
            node.images = data.images || [];
            node.models = data.models || [];
            node.artifactUrl = data.url || '';
            const text = typeof data.data === 'string' ? data.data : JSON.stringify(data.data, null, 2);
            node.resultText = text || '';
            node.statusText = '完成 · ' + (data.elapsed_ms || 0) + 'ms'
                + (node.images.length ? ' · ' + node.images.length + ' 张图' : '')
                + (node.models.length ? ' · ' + node.models.length + ' 个模型' : '')
                + (data.warning ? ' · ' + data.warning : '');
            node.status = 'done';
        } catch (e) {
            node.status = 'failed';
            node.statusText = '失败：' + (e.message || String(e));
        }
        render();
        scheduleSave();
    }

    function saveToCanvas(node) {
        (node.images || []).forEach((im, i) => {
            const n = addImageNode({ x: (node.x || 0) + 420, y: (node.y || 0) + i * 260 });
            if (!n) return;
            n.url = im.url;
            n.name = 'CLI 生图 ' + (i + 1);
        });
        render();
        scheduleSave();
    }

    window.CliGenNode = {
        type: 'cliGen',
        title: 'CLI 生图',
        types: Object.keys(CLI_NODE_CLI),
        cliOf,
        defaults: () => ({
            cli: 'comfy', capability: 'local-run', prompt: '', model: '', workflow: '',
            status: 'idle', statusText: '', images: [], resultText: '', artifactUrl: '',
            models: [], armed: false
        }),
        init(next) { deps = next; },
        addNode: addCliNode,
        body,
        run
    };
})();
