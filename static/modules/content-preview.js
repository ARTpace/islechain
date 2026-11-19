/* Shared content cards: model text is data, never executable application code. */
(() => {
'use strict';
    const vendor = '/static/vendor/content-preview/';
    const libraries = new Map();
    const aliases = {md:'markdown',htm:'html',js:'javascript',ts:'typescript',py:'python',sh:'bash',shell:'bash',yml:'yaml',tex:'latex',math:'latex',katex:'latex',patch:'diff'};
    const previewKinds = new Set(['markdown','json','html','svg','mermaid','csv','tsv','yaml','xml','diff','latex']);
    let diagramId = 0, diagramQueue = Promise.resolve();
    let themeObserver;
    function watchTheme() {
        if (themeObserver || typeof MutationObserver === 'undefined') return;
        themeObserver=new MutationObserver(()=>{
            document.querySelectorAll('.chat-text-box-body').forEach(body=>{
                const preview=body._studioDocument;
                if(preview){body.replaceChildren();formatPreview(body,preview.code,preview.kind);}
            });
        });
        themeObserver.observe(document.body,{attributes:true,attributeFilter:['class','data-theme']});
        themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class','data-theme']});
    }
    function loadLibrary(name) {
        const globals = {highlight:'hljs',mermaid:'mermaid',katex:'katex','js-yaml':'jsyaml'};
        if (window[globals[name]]) return Promise.resolve(window[globals[name]]);
        if (!libraries.has(name)) libraries.set(name, new Promise((resolve,reject) => {
            const script = document.createElement('script'); script.src = vendor + name + '.min.js';
            script.onload = () => resolve(window[globals[name]]);
            script.onerror = () => { libraries.delete(name); script.remove(); reject(new Error('预览资源加载失败，可切换源码查看')); };
            document.head.appendChild(script);
            if (name === 'katex') {
                const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = vendor + 'katex.min.css'; document.head.appendChild(link);
            }
        }));
        return libraries.get(name);
    }
    function parseCsv(source, delimiter = ',') {
        const rows = [], row = []; let cell = '', quoted = false;
        const text = String(source).replace(/\r\n?/g,'\n');
        for (let i=0;i<text.length;i++) {
            const char=text[i];
            if (char === '"' && (quoted || !cell)) {
                if (quoted && text[i+1] === '"') { cell += '"'; i++; }
                else quoted = !quoted;
            } else if (!quoted && (char === delimiter || char === '\n')) {
                row.push(cell); cell='';
                if (char === '\n') { rows.push(row.splice(0)); }
            } else cell += char;
        }
        if (cell || row.length) { row.push(cell); rows.push(row); }
        return rows;
    }
    function sourceView(body, code, language, highlighted = true) {
        const pre=document.createElement('pre'); pre.className='studio-code';
        const content=document.createElement('code'); pre.appendChild(content); body.replaceChildren(pre);
        const paint = highlighter => {
            content.replaceChildren();
            let lines;
            if (highlighter?.getLanguage(language)) lines=highlighter.highlight(code,{language,ignoreIllegals:true}).value.split('\n');
            (lines || code.split('\n')).forEach((text,index)=>{
                const line=document.createElement('span'); line.className='studio-code-line'; line.dataset.line=String(index+1);
                if (language === 'diff') line.className += text.startsWith('+') ? ' studio-diff-add' : text.startsWith('-') ? ' studio-diff-remove' : text.startsWith('@@') ? ' studio-diff-hunk' : '';
                if (lines) line.innerHTML=text || ' '; else line.textContent=text || ' ';
                content.appendChild(line);
            });
        };
        paint();
        if (highlighted && language !== 'diff') loadLibrary('highlight').then(lib=>{if(body.isConnected!==false && body.firstChild===pre)paint(lib);}).catch(()=>{});
    }
    function isolatedDocument(source, dark) {
        return '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src data: blob:; font-src data:; base-uri &#39;none&#39;; form-action &#39;none&#39;">'
            + '<style>html{color-scheme:'+(dark?'dark':'light')+'}body{margin:12px;font:14px/1.6 system-ui;overflow-wrap:anywhere;background:'+(dark?'#202124;color:#e8eaed':'#fff;color:#202124')+'}img,svg{max-width:100%;height:auto}</style></head><body>'+source+'</body></html>';
    }
    function xmlPreview(node) {
        if (node.nodeType !== 1) { const span=document.createElement('span');span.textContent=node.textContent;return span; }
        const box=document.createElement('details');box.open=true;
        const title=document.createElement('summary'); title.textContent=node.nodeName + [...node.attributes].map(attr=>' '+attr.name+'="'+attr.value+'"').join('');
        const children=document.createElement('div');children.className='chat-json-children';
        [...node.childNodes].filter(child=>child.nodeType===1 || child.textContent.trim()).forEach(child=>children.appendChild(xmlPreview(child)));
        box.append(title,children);return box;
    }
    function formatPreview(body, code, kind) {
        const token={};body._studioPreview=token;
        body._studioDocument=['html','svg','mermaid'].includes(kind)?{code,kind}:null;
        const dark = document.body.classList.contains('studio-theme-dark') || document.documentElement.dataset.theme==='dark' || getComputedStyle(body).colorScheme==='dark';
        if (kind === 'html' || kind === 'svg') {
            const frame=document.createElement('iframe');frame.className='studio-document-frame';frame.title=kind==='svg'?'SVG 预览':'HTML 预览';
            frame.setAttribute('sandbox','');frame.setAttribute('referrerpolicy','no-referrer');frame.srcdoc=isolatedDocument(code,dark);body.appendChild(frame);return;
        }
        if (kind === 'csv' || kind === 'tsv') {
            const table=document.createElement('table');
            parseCsv(code,kind==='tsv'?'\t':',').forEach((cells,index)=>{
                const row=document.createElement('tr');cells.forEach(value=>{const cell=document.createElement(index?'td':'th');cell.textContent=value;row.appendChild(cell);});table.appendChild(row);
            });body.appendChild(table);return;
        }
        if (kind === 'xml') {
            const doc=new DOMParser().parseFromString(code,'application/xml');
            if (doc.querySelector('parsererror')) { sourceView(body,code,'xml');return; }
            body.appendChild(xmlPreview(doc.documentElement));return;
        }
        if (kind === 'diff') {sourceView(body,code,kind);return;}
        const pending=document.createElement('span');pending.className='studio-preview-status';pending.textContent='正在渲染…';body.appendChild(pending);
        const render = async () => {
            const lib=await loadLibrary(kind==='yaml'?'js-yaml':kind==='latex'?'katex':'mermaid');
            if(body._studioPreview!==token || body.isConnected===false)return;
            if(kind==='yaml') {body.replaceChildren(chatJsonPreview(lib.load(code,{schema:lib.JSON_SCHEMA})));return;}
            if(kind==='latex') {
                const output=document.createElement('div');output.className='studio-math';
                lib.render(code.replace(/^\s*\$\$|\$\$\s*$/g,'').replace(/^\s*\\\[|\\\]\s*$/g,''),output,{displayMode:true,throwOnError:true,trust:false,strict:'warn',maxExpand:1000});
                if(body._studioPreview===token)body.replaceChildren(output);return;
            }
            // Mermaid uses shared configuration; serialize renders so concurrent cards cannot change each other's theme.
            const work=diagramQueue.then(async()=>{
                if(body._studioPreview!==token || body.isConnected===false)return;
                lib.initialize({startOnLoad:false,securityLevel:'strict',theme:dark?'dark':'default',suppressErrorRendering:true,flowchart:{htmlLabels:false},maxTextSize:50000});
                const result=await lib.render('studio-diagram-'+(++diagramId),code);
                if(body._studioPreview===token){
                    const output=document.createElement('iframe');output.className='studio-document-frame';output.title='Mermaid 图表预览';
                    output.setAttribute('sandbox','');output.setAttribute('referrerpolicy','no-referrer');
                    output.srcdoc=isolatedDocument(result.svg,dark);body.replaceChildren(output);
                }
            });
            diagramQueue=work.catch(()=>{});await work;
        };
        render().catch(()=>{
            if(body._studioPreview!==token)return;
            sourceView(body,code,kind);
            const note=document.createElement('div');note.className='studio-preview-status';note.textContent='内容尚未完整或无法预览，暂显示源码';body.appendChild(note);
        });
    }
            function chatReplySegments(text) {
                const segments = [];
                let plain = '', code = '', fence = '', language = '';
                for (const line of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
                    if (fence) {
                        const end = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
                        if (end && end[1][0] === fence[0] && end[1].length >= fence.length) {
                            segments.push({ code:code.replace(/\r?\n$/, ''), language });
                            fence = ''; code = '';
                        } else code += line;
                    } else {
                        const start = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n?$/);
                        if (start) {
                            if (plain) segments.push({ text:plain });
                            plain = ''; fence = start[1]; language = start[2].trim().split(/\s/)[0] || '文本';
                        } else plain += line;
                    }
                }
                if (fence) segments.push({ code, language }); // 流式回复尚未闭合时也使用同一文本框。
                if (plain) {
                    let json = false;
                    try { json = typeof JSON.parse(plain.trim()) === 'object' && plain.trim() !== 'null'; } catch (_) {}
                    segments.push(json || /^\s*(?:\{\s*(?:"|$)|\[\s*(?:\{|$))/.test(plain) ? { code:plain.trim(), language:'json' } : { text:plain });
                }
                return segments;
            }
            function chatPartialJson(text) {
                const stack = [];
                let quoted = false, escaped = false;
                for (const char of text) {
                    if (quoted) {
                        if (escaped) escaped = false;
                        else if (char === '\\') escaped = true;
                        else if (char === '"') quoted = false;
                    } else if (char === '"') quoted = true;
                    else if (char === '{') stack.push('}');
                    else if (char === '[') stack.push(']');
                    else if (char === '}' || char === ']') stack.pop();
                }
                // ponytail: 只补全预览副本，原始回复与复制内容保持不变，不执行模型返回的代码。
                let partial = text + (quoted ? (escaped ? '\\' : '') + '"' : '');
                partial = partial.replace(/,\s*$/, '').replace(/:\s*$/, ':null');
                const suffix = stack.reverse().join('');
                try { return JSON.parse(partial + suffix); } catch (_) {}
                // 正在接收下一个字段名或数字时，先保留此前已完成的字段。
                partial = partial.replace(/(?:,\s*)?"[^"\\]*"\s*$/, '');
                try { return JSON.parse(partial + suffix); } catch (_) { return undefined; }
            }
            function chatJsonPreview(value, key = '数据', depth = 0) {
                if (value === null || typeof value !== 'object') {
                    const row = document.createElement('div'); row.className = 'chat-json-row';
                    const label = document.createElement('span'); label.className = 'chat-json-key'; label.textContent = key;
                    const content = document.createElement('span'); content.textContent = value === null ? 'null' : String(value);
                    row.append(label, content); return row;
                }
                if (depth === 0) {
                    const root = document.createElement('div'); root.className = 'chat-json-root';
                    const entries = Object.entries(value);
                    entries.forEach(([name, item]) => root.appendChild(chatJsonPreview(item, name, depth + 1)));
                    if (!entries.length) root.textContent = Array.isArray(value) ? '空列表' : '空对象';
                    return root;
                }
                const box = document.createElement('details'); box.open = depth < 2;
                const summary = document.createElement('summary');
                summary.textContent = key + ' · ' + (Array.isArray(value) ? '列表' : '对象') + ' · ' + Object.keys(value).length + ' 项';
                const children = document.createElement('div'); children.className = 'chat-json-children';
                // ponytail: 嵌套层级按需展开，避免预览一次性生成大量 DOM。
                let filled = false;
                const fill = () => {
                    if (!box.open || filled) return;
                    filled = true;
                    Object.entries(value).forEach(([name, item]) => children.appendChild(chatJsonPreview(item, name, depth + 1)));
                };
                box.addEventListener('toggle', fill);
                box.append(summary, children); fill(); return box;
            }
            function renderChatReply(host, text, options = {}) {
                watchTheme();
                const optionKey = (options.language || '') + '\n' + (options.title || '');
                if (host.dataset.rawText === text && host._studioOptionKey === optionKey) return;
                host._studioOptionKey = optionKey;
                const previous = [...host.querySelectorAll('.chat-text-box-body')].map(body => [body.scrollTop, body.scrollLeft]);
                host.dataset.rawText = text;
                host._chatBoxModes ||= [];
                host.replaceChildren();
                let index = 0;
                for (const part of options.language ? [{code:String(text),language:options.language}] : chatReplySegments(text)) {
                    if ('text' in part) {
                        const prose = document.createElement('div');
                        prose.className = 'chat-markdown';
                        if (window.CanvasAgentMarkdown) prose.innerHTML = window.CanvasAgentMarkdown.render(part.text);
                        else prose.textContent = part.text;
                        host.appendChild(prose);
                        continue;
                    }
                    const box = document.createElement('section');
                    box.className = 'chat-text-box';
                    const head = document.createElement('div'); head.className = 'chat-text-box-head';
                    const kind = aliases[part.language.toLowerCase()] || part.language.toLowerCase();
                    const markdown = kind === 'markdown', json = kind === 'json';
                    const label = document.createElement('span');
                    const heading = markdown && part.code.match(/^\s*#{1,6}\s+(.+)$/m);
                    let data;
                    if (json) { try { data = JSON.parse(part.code); } catch (_) { data = chatPartialJson(part.code); } }
                    label.textContent = String(options.title || (heading ? heading[1] : json ? data?.title || data?.name || 'JSON 数据' : markdown ? 'Markdown 文档' : part.language)).slice(0, 80);
                    const actions = document.createElement('div'); actions.className = 'chat-text-box-actions';
                    const toggle = document.createElement('button'); toggle.type = 'button';
                    const slot = index;
                    let source = host._chatBoxModes[slot] ?? false;
                    const body = document.createElement('div'); body.className = 'chat-text-box-body'; body.tabIndex = 0;
                    const paint = () => {
                        body._studioPreview = {};
                        body._studioDocument = null;
                        body.replaceChildren();
                        toggle.textContent = source ? '预览' : '源码';
                        toggle.setAttribute('aria-label', source ? '切换到渲染预览' : '切换到源码');
                        toggle.setAttribute('aria-pressed', String(source));
                        if (!source && markdown && window.CanvasAgentMarkdown) body.innerHTML = window.CanvasAgentMarkdown.render(part.code);
                        else if (!source && json && data !== undefined) body.appendChild(chatJsonPreview(data));
                        else if (!source && json) body.textContent = '';
                        else if (!source && previewKinds.has(kind)) formatPreview(body,part.code,kind);
                        else if (!source) sourceView(body,part.code,kind);
                        else {
                            const pre = document.createElement('pre'), code = document.createElement('code');
                            code.textContent = part.code; pre.appendChild(code); body.appendChild(pre);
                        }
                    };
                    toggle.hidden = false;
                    toggle.onclick = () => { source = !source; host._chatBoxModes[slot] = source; paint(); };
                    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '复制';
                    copy.onclick = async () => {
                        try { await navigator.clipboard.writeText(part.code); copy.textContent = '已复制'; }
                        catch (_) { copy.textContent = '复制失败'; }
                    };
                    actions.append(toggle, copy); head.append(label, actions); box.append(head, body); host.appendChild(box);
                    paint();
                    if (previous[index]) { body.scrollTop = previous[index][0]; body.scrollLeft = previous[index][1]; }
                    index++;
                }
            }

window.StudioContentPreview = { render:renderChatReply, segments:chatReplySegments, partialJson:chatPartialJson, jsonPreview:chatJsonPreview, parseCsv, isolatedDocument };
})();
