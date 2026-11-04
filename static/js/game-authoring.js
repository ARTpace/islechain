/* ponytail: 使用原生 dialog 和项目表格契约；不引入富文本/电子表格框架。 */
(() => {
    'use strict';
    const esc = value => escapeHtml(String(value ?? ''));
    const copy = value => JSON.parse(JSON.stringify(value));
    const safeUrl = value => /^(https?:\/\/|\/(?:assets\/|output\/|api\/game-projects\/))[^\s<>"']+$/i.test(value) ? value : '';
    function inline(text) {
        const tokens = [];
        const token = html => `\u0000${tokens.push(html) - 1}\u0000`;
        text = String(text).replace(/`([^`]+)`/g, (_, body) => token(`<code>${esc(body)}</code>`));
        text = text.replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g, (_, image, label, url) => {
            const safe = safeUrl(url);
            if (!safe) return label;
            return token(image ? `<img src="${esc(safe)}" alt="${esc(label)}" loading="lazy">` : `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`);
        });
        return esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] || '');
    }
    function markdown(text) {
        let code = false, list = '', html = '';
        const closeList = () => { if (list) { html += `</${list}>`; list = ''; } };
        for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
            if (/^\s*```/.test(line)) { closeList(); html += code ? '</code></pre>' : '<pre><code>'; code = !code; continue; }
            if (code) { html += esc(line) + '\n'; continue; }
            const heading = line.match(/^(#{1,6})\s+(.+)$/), item = line.match(/^\s*(?:([-*+])|\d+\.)\s+(.+)$/);
            if (item) {
                const kind = item[1] ? 'ul' : 'ol';
                if (list !== kind) { closeList(); html += `<${kind}>`; list = kind; }
                html += `<li>${inline(item[2])}</li>`; continue;
            }
            closeList();
            if (heading) html += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
            else if (/^>\s?/.test(line)) html += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`;
            else if (line.trim()) html += `<p>${inline(line)}</p>`;
        }
        closeList();
        return html + (code ? '</code></pre>' : '');
    }
    function parseDelimited(text, separator = ',') {
        // 同一解析器处理带引号、嵌入换行的 CSV 与矩形 TSV。
        const rows = [], row = []; let cell = '', quoted = false, closed = false;
        text = String(text).replace(/^\uFEFF/, '');
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (quoted) {
                if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
                else if (ch === '"') { quoted = false; closed = true; }
                else cell += ch;
            } else if (ch === '"' && !cell && !closed) quoted = true;
            else if (ch === separator || ch === '\n' || ch === '\r') {
                row.push(cell); cell = ''; closed = false;
                if (ch !== separator) {
                    rows.push(row.splice(0));
                    if (ch === '\r' && text[i + 1] === '\n') i++;
                }
            } else {
                if (closed || ch === '"') throw new Error('CSV/TSV 引号格式无效');
                cell += ch;
            }
        }
        if (quoted) throw new Error('CSV/TSV 引号未闭合');
        if (cell || row.length || closed) { row.push(cell); rows.push(row); }
        return rows;
    }
    function fromDelimited(text, separator, previous) {
        const rows = parseDelimited(text, separator), header = rows.shift();
        if (!header?.length || header.length > 100 || rows.length > 1000) throw new Error('表格限 100 列、1000 行，第一行为列标题');
        if (rows.some(row => row.length > header.length)) throw new Error('数据列数超过标题列数');
        if (rows.flat().some(value => value.length > 10000)) throw new Error('单元格超过 10000 字符');
        const columns = header.map((title, i) => ({id: 'col_' + i, title: (title || '列 ' + (i + 1)).slice(0, 200), type: 'text'}));
        return {...copy(previous), columns, rows: rows.map((row, i) => ({id: 'row_' + i,
            cells: Object.fromEntries(columns.map((col, j) => [col.id, row[j] ?? '']))}))};
    }
    function csv(table) {
        const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
        return [table.columns.map(c => c.title), ...table.rows.map(r => table.columns.map(c => r.cells[c.id]))]
            .map(row => row.map(quote).join(',')).join('\r\n');
    }
    function download(name, content, type) {
        const url = URL.createObjectURL(new Blob([content], {type})), link = document.createElement('a');
        link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function preview(table) {
        return `<div class="gp-table-scroll"><table><thead><tr>${table.columns.map(c => `<th>${esc(c.title)}</th>`).join('')}</tr></thead><tbody>${table.rows.slice(0, 8).map(r => `<tr>${table.columns.map(c => `<td>${esc(r.cells[c.id])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><small>${table.rows.length} 行 · ${table.columns.length} 列</small>`;
    }
    function dialog(title) {
        const el = document.createElement('dialog'); el.className = 'gp-editor gp-work-node';
        el.innerHTML = `<header><h2>${esc(title)}</h2><button type="button" class="tool-btn" data-close>关闭，保留草稿</button></header><p role="status" data-status></p><div data-editor></div>`;
        el.querySelector('[data-close]').onclick = () => el.close();
        el.addEventListener('close', () => { el.remove(); render(); });
        document.body.append(el); el.showModal(); return el;
    }
    function editDocument(node, doc) {
        const el = dialog('编辑文档'), body = el.querySelector('[data-editor]');
        let sourceRevision = node.documentDraftRevision ?? doc.revision;
        body.innerHTML = `<label>标题<input data-title value="${esc(node.documentTitle ?? doc.title)}"></label><div class="gp-actions"><button class="tool-btn" data-insert>插入连接图片</button><button class="tool-btn" data-save>保存正文</button><button class="tool-btn" data-export>导出 Markdown</button></div><div class="gp-document-columns"><textarea aria-label="Markdown 正文" data-text></textarea><article class="gp-markdown" data-preview></article></div>`;
        const textarea = body.querySelector('[data-text]'), result = body.querySelector('[data-preview]');
        textarea.value = node.documentDraft ?? doc.lastSavedContent;
        const update = () => { node.documentDraftRevision = sourceRevision; node.documentDraft = textarea.value; result.innerHTML = markdown(textarea.value); scheduleSave(); };
        result.innerHTML = markdown(textarea.value);
        textarea.oninput = update;
        body.querySelector('[data-title]').oninput = event => { node.documentDraftRevision = sourceRevision; node.documentTitle = event.target.value; scheduleSave(); };
        body.querySelector('[data-insert]').onclick = () => {
            const urls = window.GameWorkflow.referenceImages(node);
            if (!urls.length) { el.querySelector('[data-status]').textContent = '先将图片节点连接到文档节点。'; return; }
            textarea.setRangeText(urls.map(url => `\n![参考图片](${url})\n`).join(''), textarea.selectionStart, textarea.selectionEnd, 'end'); update();
        };
        body.querySelector('[data-save]').onclick = async () => {
            await window.GameWorkflow.execute(node, 'save-document');
            if (node.documentDraftRevision === undefined) sourceRevision = window.GamePipeline.project.documents.find(d => d.id === doc.id)?.revision ?? sourceRevision;
            el.querySelector('[data-status]').textContent = node.documentDraft === undefined ? '已保存' : '未保存，请检查画布节点的错误提示';
        };
        body.querySelector('[data-export]').onclick = () => download('document.md', textarea.value, 'text/markdown;charset=utf-8');
    }
    function typed(value, column) {
        if (value === '' || value === null) return null;
        if (column.type === 'text') return String(value);
        if (column.type === 'number') {
            const number = Number(value);
            if (!Number.isFinite(number)) throw new Error('数字列需要有限数字');
            return number;
        }
        if (value === true || value === 'true') return true;
        if (value === false || value === 'false') return false;
        throw new Error('布尔列只接受 true、false 或空值');
    }
    function editTable(node, saved) {
        const el = dialog('编辑策划表格'), body = el.querySelector('[data-editor]'), undo = [], redo = [];
        let table = copy(node.tableDraft || saved);
        let sourceRevision = node.tableDraftRevision ?? saved.revision;
        const remember = () => { undo.push(copy(table)); if (undo.length > 30) undo.shift(); redo.length = 0; };
        const persist = () => { node.tableDraftRevision = sourceRevision; node.tableDraft = copy(table); scheduleSave(); };
        const status = message => { el.querySelector('[data-status]').textContent = message; };
        const change = (fn, redraw = true) => {
            const before = copy(table);
            try {
                fn(); rememberBefore(before); persist();
                if (redraw) draw();
                else {
                    body.querySelector('[data-action="undo"]').disabled = !undo.length;
                    body.querySelector('[data-action="redo"]').disabled = !redo.length;
                }
                status('草稿尚未保存');
            }
            catch (error) { table = before; status(error.message); if (redraw) draw(); }
        };
        const rememberBefore = before => { undo.push(before); if (undo.length > 30) undo.shift(); redo.length = 0; };
        function draw() {
            body.innerHTML = `<label>表格标题<input data-title value="${esc(table.title)}"></label><div class="gp-actions"><button class="tool-btn" data-action="save">保存表格</button><button class="tool-btn" data-action="row">添加行</button><button class="tool-btn" data-action="column">添加列</button><button class="tool-btn" data-action="undo" ${!undo.length ? 'disabled' : ''}>撤销</button><button class="tool-btn" data-action="redo" ${!redo.length ? 'disabled' : ''}>重做</button><label>导入 CSV/TSV<input type="file" accept=".csv,.tsv" data-import></label><button class="tool-btn" data-action="export">导出 CSV</button></div><small>CSV 导入按文本保留前导零；支持从单元格粘贴矩形 TSV。数字及布尔列不支持公式。</small><div class="gp-table-scroll"><table><thead><tr><th></th>${table.columns.map((c, i) => `<th><input aria-label="列标题" data-column="${i}" value="${esc(c.title)}"><select aria-label="列类型" data-type="${i}">${['text', 'number', 'boolean'].map(t => `<option ${t === c.type ? 'selected' : ''}>${t}</option>`).join('')}</select><button type="button" data-delete-column="${i}">删除列</button></th>`).join('')}</tr></thead><tbody>${table.rows.map((r, i) => `<tr><th><button type="button" data-delete-row="${i}">删除 ${i + 1}</button></th>${table.columns.map((c, j) => `<td><input aria-label="第 ${i + 1} 行 ${esc(c.title)}" data-row="${i}" data-col="${j}" value="${esc(r.cells[c.id])}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
            body.querySelector('[data-title]').oninput = event => change(() => { table.title = event.target.value; }, false);
            body.querySelectorAll('[data-column]').forEach(input => { input.oninput = () => change(() => { table.columns[+input.dataset.column].title = input.value; }, false); });
            body.querySelectorAll('[data-type]').forEach(input => { input.onchange = () => change(() => {
                const col = table.columns[+input.dataset.type]; col.type = input.value;
                table.rows.forEach(row => { row.cells[col.id] = typed(row.cells[col.id] ?? null, col); });
            }); });
            body.querySelectorAll('[data-delete-column]').forEach(button => { button.onclick = () => change(() => {
                if (table.columns.length === 1) throw new Error('至少保留一列');
                const [col] = table.columns.splice(+button.dataset.deleteColumn, 1); table.rows.forEach(row => { delete row.cells[col.id]; });
            }); });
            body.querySelectorAll('[data-delete-row]').forEach(button => { button.onclick = () => change(() => { table.rows.splice(+button.dataset.deleteRow, 1); }); });
            body.querySelectorAll('[data-row]').forEach(input => {
                input.oninput = () => change(() => {
                    if (input.value.length > 10000) throw new Error('单元格超过 10000 字符');
                    const col = table.columns[+input.dataset.col]; table.rows[+input.dataset.row].cells[col.id] = typed(input.value, col);
                }, false);
                input.onpaste = event => {
                    const text = event.clipboardData.getData('text/plain');
                    if (!/[\t\n\r]/.test(text)) return;
                    event.preventDefault();
                    change(() => {
                        const rows = parseDelimited(text, '\t'), top = +input.dataset.row, left = +input.dataset.col;
                        if (top + rows.length > 1000 || rows.some(row => left + row.length > table.columns.length)) throw new Error('粘贴超出列数或 1000 行上限');
                        while (table.rows.length < top + rows.length) table.rows.push({id: uid('row'), cells: {}});
                        rows.forEach((row, i) => row.forEach((value, j) => {
                            if (value.length > 10000) throw new Error('单元格超过 10000 字符');
                            const col = table.columns[left + j]; table.rows[top + i].cells[col.id] = typed(value, col);
                        }));
                    });
                };
            });
            body.querySelector('[data-import]').onchange = async event => {
                const file = event.target.files[0]; if (!file) return;
                try {
                    if (file.size > 4 * 1024 * 1024) throw new Error('导入文件超过 4 MiB');
                    const imported = fromDelimited(new TextDecoder('utf-8', {fatal: true}).decode(await file.arrayBuffer()), /\.tsv$/i.test(file.name) ? '\t' : ',', table);
                    remember(); table = imported; persist(); draw(); status('已导入为草稿，保存后生效');
                } catch (error) { status(error.message); }
            };
            body.querySelectorAll('[data-action]').forEach(button => { button.onclick = async () => {
                const action = button.dataset.action;
                if (action === 'row') change(() => { if (table.rows.length >= 1000) throw new Error('最多 1000 行'); table.rows.push({id: uid('row'), cells: {}}); });
                if (action === 'column') change(() => { if (table.columns.length >= 100) throw new Error('最多 100 列'); table.columns.push({id: uid('col'), title: '新列', type: 'text'}); });
                if (action === 'undo' && undo.length) { redo.push(copy(table)); table = undo.pop(); persist(); draw(); }
                if (action === 'redo' && redo.length) { undo.push(copy(table)); table = redo.pop(); persist(); draw(); }
                if (action === 'export') download('table.csv', '\uFEFF' + csv(table), 'text/csv;charset=utf-8');
                if (action === 'save') {
                    // ponytail: 保存时显式收集输入，不能依赖失焦 change 事件。
                    try {
                        const next = copy(table);
                        next.title = body.querySelector('[data-title]').value;
                        body.querySelectorAll('[data-row]').forEach(input => {
                            if (input.value.length > 10000) throw new Error('单元格超过 10000 字符');
                            const col = next.columns[+input.dataset.col]; next.rows[+input.dataset.row].cells[col.id] = typed(input.value, col);
                        });
                        table = next;
                    } catch (error) { status(error.message); return; }
                    persist(); await window.GameWorkflow.execute(node, 'save-table');
                    if (node.tableDraftRevision === undefined) sourceRevision = window.GamePipeline.project.tables.find(t => t.id === saved.id)?.revision ?? sourceRevision;
                    status(node.tableDraft === undefined ? '已保存' : '未保存，请检查画布节点的错误提示');
                }
            }; });
        }
        draw();
    }
    async function history(node) {
        const el = dialog('历史版本'), body = el.querySelector('[data-editor]');
        const path = '/' + (node.type === 'document' ? 'documents/' + node.docId : 'tables/' + node.tableId);
        const status = message => { el.querySelector('[data-status]').textContent = message; };
        try {
            const result = await window.GamePipeline.workflow(ctx => ctx.read(path + '/history'));
            body.innerHTML = `<label>已保存版本<select data-version>${result.revisions.map(r => `<option value="${r}">v${r}${r === result.current ? '（当前）' : ''}</option>`).join('')}</select></label><button type="button" class="tool-btn" data-restore>恢复为新版本</button><article class="gp-markdown" data-version-preview></article>`;
            const select = body.querySelector('[data-version]');
            let reading = 0;
            const show = async () => {
                const request = ++reading, revision = select.value;
                try {
                    const version = await window.GamePipeline.workflow(ctx => ctx.read(path + '/history/' + revision));
                    if (request !== reading) return;
                    body.querySelector('[data-version-preview]').innerHTML = node.type === 'document' ? markdown(version.item.lastSavedContent) : preview(version.item);
                    status('保留最近 30 个旧版本；恢复会创建新修订。');
                } catch (error) { status(error.message); }
            };
            select.onchange = show;
            body.querySelector('[data-restore]').onclick = async () => {
                await window.GameWorkflow.execute(node, 'restore-content', select.value);
                status('恢复结果请查看画布节点；失败或取消时原内容保留。');
            };
            await show();
        } catch (error) { status(error.message); }
    }
    window.GameAuthoring = {markdown, parseDelimited, fromDelimited, csv, preview, editDocument, editTable, typed, history};
})();
