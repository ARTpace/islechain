/* 人设详情悬浮卡：点「手册」按钮，看这个人设的职责说明 + 它默认配的建模作业手册全文。
 *
 * 用法：window.PresetInfo.open(anchorEl, presetId)
 * 卡片挂 document.body 上而不是节点里 —— 画布节点每次 render 都会整体重建，卡片会被一起销毁。
 * 数据来 /api/game-projects/preset-detail：人设名单接口刻意不带 prompt（太长），点开才取。
 */
(() => {
let pop = null;
let owner = null;
let seq = 0;

const CARD = [
    'position:fixed', 'z-index:4200', 'width:min(460px,calc(100vw - 24px))', 'max-height:62vh',
    'overflow:auto', 'padding:12px 14px', 'border-radius:12px', 'background:var(--ui-panel)',
    'border:1px solid var(--ui-line-strong)', 'box-shadow:0 18px 48px rgba(0,0,0,.55)', 'color:var(--ui-text)',
    'font-size:11.5px', 'line-height:1.6', 'overscroll-behavior:contain'
].join(';');

function esc(value){
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(text){
    return esc(text)
        .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:var(--ui-text)">$1</strong>')
        .replace(/`([^`]+)`/g, '<code style="padding:0 4px;border-radius:4px;background:var(--ui-panel);border:1px solid var(--ui-line-strong);font-size:10.5px;color:var(--ui-accent)">$1</code>');
}

/* 极简 markdown：标题 / 列表 / 代码块 / 表格行。手册是给自己看的，不做完整渲染。 */
function md(src){
    const out = [];
    let code = false;
    let list = false;
    const closeList = () => { if(list){ out.push('</ul>'); list = false; } };
    for(const raw of String(src || '').split('\n')){
        const line = raw.replace(/\s+$/, '');
        if(/^\s*```/.test(line)){
            closeList();
            code = !code;
            out.push(code
                ? '<pre style="margin:6px 0;padding:8px 10px;border-radius:8px;background:var(--ui-panel);border:1px solid var(--ui-line-strong);overflow:auto;font-size:10.5px;line-height:1.55;color:var(--ui-text);white-space:pre">'
                : '</pre>');
            continue;
        }
        if(code){ out.push(esc(line) + '\n'); continue; }
        const head = /^(#{1,4})\s+(.+)$/.exec(line);
        if(head){
            closeList();
            const size = head[1].length <= 2 ? 12.5 : 11.5;
            out.push(`<div style="margin:10px 0 3px;font-size:${size}px;font-weight:600;color:var(--ui-muted);letter-spacing:.3px">${inline(head[2])}</div>`);
            continue;
        }
        if(/^\s*[-*]\s+/.test(line)){
            if(!list){ out.push('<ul style="margin:3px 0 6px;padding-left:16px">'); list = true; }
            out.push(`<li style="margin:2px 0">${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
            continue;
        }
        if(/^\s*\|/.test(line)){
            closeList();
            out.push(`<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--ui-muted);white-space:pre-wrap">${esc(line)}</div>`);
            continue;
        }
        if(!line){ closeList(); continue; }
        closeList();
        out.push(`<p style="margin:4px 0">${inline(line)}</p>`);
    }
    closeList();
    return out.join('');
}

function card(data){
    const preset = data.preset || {};
    const skill = data.skill;
    return `
        <div style="display:flex;align-items:flex-start;gap:8px">
            <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600;color:var(--ui-text)">${esc(preset.name || preset.id || '人设')}</div>
                <div style="margin-top:2px;font-size:10.5px;color:var(--ui-muted)">${esc(preset.description || '')}</div>
            </div>
            <button type="button" data-preset-info-close title="关闭" style="flex:0 0 auto;width:22px;height:22px;border-radius:6px;border:1px solid var(--ui-line-strong);background:var(--ui-panel);color:var(--ui-muted);font-size:13px;line-height:1;cursor:pointer">×</button>
        </div>
        <div style="height:1px;background:var(--ui-panel);margin:9px 0 2px"></div>
        <div style="margin-top:8px;font-size:10px;color:var(--ui-muted);letter-spacing:.4px">职责与判断标准</div>
        <div>${md(preset.prompt || '该人设没有额外的职责约束。')}</div>
        ${skill ? `<div style="height:1px;background:var(--ui-panel);margin:10px 0 2px"></div>
        <div style="margin-top:8px;font-size:10px;color:var(--ui-muted);letter-spacing:.4px">工作手册 · ${esc(skill.name || skill.id)}</div>
        <div>${md(skill.body)}</div>` : ''}
    `;
}

function place(anchor){
    if(!pop || !anchor || !anchor.isConnected) return;
    const box = anchor.getBoundingClientRect();
    const gap = 8;
    pop.style.left = '0px';
    pop.style.top = '0px';
    const rect = pop.getBoundingClientRect();
    let left = box.left;
    if(left + rect.width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - rect.width - 12);
    let top = box.bottom + gap;
    if(top + rect.height > window.innerHeight - 12){
        const above = box.top - gap - rect.height;
        top = above >= 12 ? above : Math.max(12, window.innerHeight - rect.height - 12);
    }
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
}

function ensure(){
    if(pop) return pop;
    pop = document.createElement('div');
    pop.id = 'presetInfoPopover';
    pop.style.cssText = CARD;
    // 卡片浮在画布上，别让画布的框选/缩放把手势接走
    ['pointerdown', 'mousedown', 'click', 'wheel'].forEach(type => {
        pop.addEventListener(type, event => event.stopPropagation());
    });
    pop.addEventListener('click', event => {
        if(event.target.closest('[data-preset-info-close]')) close();
    });
    document.body.appendChild(pop);
    return pop;
}

function close(){
    owner = null;
    seq += 1;
    if(pop){
        pop.remove();
        pop = null;
    }
}

async function open(anchor, presetId){
    if(owner === anchor){ close(); return; }
    ensure();
    owner = anchor;
    const ticket = ++seq;
    pop.innerHTML = `<div style="padding:2px 0;color:var(--ui-muted);font-size:11px">正在读取人设说明…</div>`;
    place(anchor);
    try {
        const res = await fetch(`/api/game-projects/preset-detail?id=${encodeURIComponent(presetId || 'default')}`);
        if(!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if(ticket !== seq || !pop) return;
        pop.innerHTML = card(data);
        place(anchor);
    } catch(err) {
        if(ticket !== seq || !pop) return;
        // 老后端没有 preset-detail（新接口需要重启服务）：退回用名单里的说明，至少能看人设简介
        let fallback = null;
        try {
            const list = await fetch('/api/game-projects/presets').then(r => r.ok ? r.json() : null);
            fallback = (list?.presets || []).find(item => item.id === presetId) || null;
        } catch(_) {}
        if(ticket !== seq || !pop) return;
        pop.innerHTML = fallback
            ? `${card({preset:fallback, skill:null})}
               <div style="margin-top:8px;font-size:10px;color:var(--ui-muted)">工作手册需要新接口，重启后端服务后可查看全文。</div>`
            : `<div style="color:var(--ui-error);font-size:11px">人设说明读取失败：${esc(err.message || err)}</div>`;
        place(anchor);
    }
}

document.addEventListener('pointerdown', event => {
    if(!pop) return;
    if(pop.contains(event.target)) return;
    if(owner && owner.contains(event.target)) return;
    close();
}, true);
document.addEventListener('keydown', event => {
    if(event.key === 'Escape' && pop){ close(); }
}, true);
window.addEventListener('resize', () => { if(pop && owner) place(owner); });

window.PresetInfo = { open, close };
})();
