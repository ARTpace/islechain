/* ponytail: escape-first renderer — model output never reaches the DOM as raw HTML. */
(() => {
    'use strict';
    const ESCAPES = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ESCAPES[char]);
    const indentOf = line => {
        let width = 0;
        for (const char of line) {
            if (char === ' ') width += 1;
            else if (char === '\t') width += 2;
            else break;
        }
        return width;
    };
    const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,3}[.)])\s+(.*)$/;

    function inline(text) {
        const codes = [];
        let out = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
            codes.push(code);
            return `\u0000${codes.length - 1}\u0000`;
        });
        out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
            const target = /^https?:\/\//i.test(href) || /^mailto:/i.test(href) ? href : '';
            return target ? `<a href="${target}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
        });
        out = out.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
        out = out.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>');
        out = out.replace(/(^|[\s(（，。：；、])\u005f(?=\S)([^_]*?\S)\u005f(?=$|[\s)）,.，。;；:：!?！？])/g, '$1<em>$2</em>');
        out = out.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
        return out.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
    }

    function renderList(entries) {
        const open = [];
        let html = '';
        const opening = entry => {
            const start = entry.ordered && entry.number > 1 ? ` start="${entry.number}"` : '';
            return `<${entry.ordered ? 'ol' : 'ul'}${start}>`;
        };
        for (const entry of entries) {
            const tag = entry.ordered ? 'ol' : 'ul';
            while (open.length && entry.indent < open[open.length - 1].indent) html += `</li></${open.pop().tag}>`;
            if (!open.length) {
                html += opening(entry);
                open.push({indent: entry.indent, tag});
            } else {
                const top = open[open.length - 1];
                if (entry.indent > top.indent) {
                    html += opening(entry);
                    open.push({indent: entry.indent, tag});
                } else if (top.tag !== tag) {
                    html += `</li></${top.tag}>${opening(entry)}`;
                    open.pop();
                    open.push({indent: entry.indent, tag});
                } else {
                    html += '</li>';
                }
            }
            html += `<li>${inline(entry.text)}`;
        }
        while (open.length) html += `</li></${open.pop().tag}>`;
        return html;
    }

    function splitRow(line) {
        const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
        return body.split('|').map(cell => cell.trim());
    }

    function renderTable(head, rows) {
        const cell = (tag, value) => `<${tag}>${inline(value)}</${tag}>`;
        return `<div class="ca-md-table"><table><thead><tr>${head.map(value => cell('th', value)).join('')}</tr></thead>`
            + `<tbody>${rows.map(row => `<tr>${head.map((_, index) => cell('td', row[index] || '')).join('')}</tr>`).join('')}</tbody></table></div>`;
    }

    function render(source) {
        const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
        let html = '';
        let index = 0;
        while (index < lines.length) {
            const line = lines[index];
            if (!line.trim()) { index += 1; continue; }

            const fence = line.match(/^[ \t]*(```+|~~~+)[ \t]*([\w+#.-]*)[ \t]*$/);
            if (fence) {
                const marker = fence[1];
                const body = [];
                index += 1;
                while (index < lines.length && !lines[index].trim().startsWith(marker)) {
                    body.push(lines[index]);
                    index += 1;
                }
                index += 1;
                html += `<pre class="ca-md-code"><code>${escapeHtml(body.join('\n'))}</code></pre>`;
                continue;
            }

            const heading = line.match(/^[ \t]*(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/);
            if (heading) {
                const level = Math.min(6, heading[1].length + 2);
                html += `<h${level}>${inline(heading[2])}</h${level}>`;
                index += 1;
                continue;
            }

            if (/^[ \t]*([-*_])[ \t]*(\1[ \t]*){2,}$/.test(line)) {
                html += '<hr>';
                index += 1;
                continue;
            }

            if (/^[ \t]*>/.test(line)) {
                const quoted = [];
                while (index < lines.length && /^[ \t]*>/.test(lines[index])) {
                    quoted.push(lines[index].replace(/^[ \t]*>[ \t]?/, ''));
                    index += 1;
                }
                html += `<blockquote>${render(quoted.join('\n'))}</blockquote>`;
                continue;
            }

            if (line.includes('|') && index + 1 < lines.length && /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/.test(lines[index + 1])) {
                const head = splitRow(line);
                const rows = [];
                index += 2;
                while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
                    rows.push(splitRow(lines[index]));
                    index += 1;
                }
                html += renderTable(head, rows);
                continue;
            }

            if (LIST_ITEM.test(line)) {
                const entries = [];
                while (index < lines.length) {
                    const item = lines[index].match(LIST_ITEM);
                    if (item) {
                        const ordered = /\d/.test(item[2]);
                        entries.push({indent: indentOf(item[1]), ordered, number: ordered ? parseInt(item[2], 10) : 1, text: item[3].trim()});
                        index += 1;
                        continue;
                    }
                    const previous = entries[entries.length - 1];
                    if (previous && lines[index].trim() && indentOf(lines[index]) > previous.indent) {
                        previous.text += ' ' + lines[index].trim();
                        index += 1;
                        continue;
                    }
                    break;
                }
                html += renderList(entries);
                continue;
            }

            const paragraph = [];
            while (index < lines.length) {
                const current = lines[index];
                if (!current.trim() || LIST_ITEM.test(current) || /^[ \t]*(#{1,6})[ \t]+/.test(current)
                    || /^[ \t]*(```+|~~~+)/.test(current) || /^[ \t]*>/.test(current)) break;
                paragraph.push(current.trim());
                index += 1;
            }
            html += `<p>${paragraph.map(inline).join('<br>')}</p>`;
        }
        return html;
    }

    window.CanvasAgentMarkdown = {render, inline};
})();
