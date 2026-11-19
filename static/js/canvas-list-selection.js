/* 管理视图：左键选择，中键平移；批量操作复用现有元数据和回收站 API。 */
(() => {
    let selected = new Set(), marquee = null, busy = false;
    const bar = document.createElement('div');
    bar.className = 'ws-selection-tools';
    bar.innerHTML = `<span data-count></span><button data-action="arrange">${L('整理选中','Arrange selected')}</button><select aria-label="${L('移动到项目','Move to project')}"></select><button data-action="delete">${L('删除选中','Delete selected')}</button><button data-action="clear">${L('取消选择','Clear selection')}</button>`;
    document.querySelector('.ws-topbar-right').before(bar);
    const box = document.createElement('div');
    box.className = 'ws-selection-box';
    board.appendChild(box);
    const cards = () => [...boardWorld.querySelectorAll('.ws-card')];
    const chosen = () => canvasesInProject(currentProjectId).filter(c => selected.has(c.id));
    function sync() {
        selected = new Set(chosen().map(c => c.id));
        cards().forEach(card => {
            const on = selected.has(card.dataset.canvasId);
            card.classList.toggle('is-selected', on);
            card.setAttribute('aria-selected', String(on));
        });
        bar.hidden = !selected.size;
        bar.querySelector('[data-count]').textContent = L(`已选 ${selected.size} 个`, `${selected.size} selected`);
        const select = bar.querySelector('select');
        select.innerHTML = `<option value="">${L('移动到项目…','Move to project…')}</option>` + projects.filter(p => p.id !== currentProjectId).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
        bar.querySelectorAll('button,select').forEach(el => { el.disabled = busy; });
    }
    function clear() { selected.clear(); sync(); }
    function intersects(a, b) {
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    }
    board.addEventListener('mousedown', e => {
        if (e.button !== 0 || e.target.closest('button,input,textarea,select,.ws-create-card,.ws-card-delete-confirm') || busy) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        closeCardMenu();
        const card = e.target.closest('.ws-card');
        const add = e.ctrlKey || e.metaKey || e.shiftKey;
        if (card) {
            const id = card.dataset.canvasId;
            if (!add) selected.clear();
            if (add && selected.has(id)) selected.delete(id); else selected.add(id);
            sync();
        } else {
            marquee = { x:e.clientX, y:e.clientY, base:add ? new Set(selected) : new Set() };
            if (!add) clear();
        }
    }, true);
    board.addEventListener('click', e => {
        if (e.target.closest('.ws-card') && !e.target.closest('button,input,textarea,select,.ws-card-delete-confirm')) {
            e.preventDefault(); e.stopImmediatePropagation();
        }
    }, true);
    board.addEventListener('dblclick', e => {
        const card = e.target.closest('.ws-card');
        if (!card || e.target.closest('button,input,textarea,select')) return;
        e.stopImmediatePropagation();
        const canvas = canvases.find(c => c.id === card.dataset.canvasId);
        if (canvas) openCanvas(canvas);
    }, true);
    board.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
    document.addEventListener('mousemove', e => {
        if (!marquee) return;
        const rect = { left:Math.min(e.clientX, marquee.x), top:Math.min(e.clientY, marquee.y), right:Math.max(e.clientX, marquee.x), bottom:Math.max(e.clientY, marquee.y) };
        const local = board.getBoundingClientRect();
        const sx = local.width / board.offsetWidth || 1, sy = local.height / board.offsetHeight || 1;
        Object.assign(box.style, { display:'block', left:`${(rect.left-local.left)/sx}px`, top:`${(rect.top-local.top)/sy}px`, width:`${(rect.right-rect.left)/sx}px`, height:`${(rect.bottom-rect.top)/sy}px` });
        selected = new Set(marquee.base);
        cards().forEach(card => { if (intersects(rect, card.getBoundingClientRect())) selected.add(card.dataset.canvasId); });
        sync();
    });
    function stopMarquee() { marquee = null; box.style.display = 'none'; }
    document.addEventListener('mouseup', stopMarquee);
    window.addEventListener('blur', () => { stopMarquee(); onBoardPanEnd(); });
    async function run(action, projectId) {
        const items = chosen();
        if (!items.length || busy) return;
        if (action === 'clear') { clear(); closeCardMenu(); return; }
        if (action === 'delete' && !(await window.StudioConfirm.ask(L(`将选中的 ${items.length} 个画布移入回收站？`, `Move ${items.length} selected canvases to trash?`)))) return;
        if (action === 'move' && !projects.some(p => p.id === projectId && p.id !== currentProjectId)) return;
        busy = true; sync(); closeCardMenu();
        const origin = { x:Math.min(...items.map(c => c.board_x || 0)), y:Math.min(...items.map(c => c.board_y || 0)) };
        const columns = Math.max(1, Math.min(items.length, Math.floor((board.clientWidth - 80) / 276)));
        let failed = 0;
        try {
            for (const [index, canvas] of items.entries()) {
                let ok = false;
                if (action === 'delete') {
                    try {
                        const res = await fetch(`/api/canvases/${encodeURIComponent(canvas.id)}`, { method:'DELETE' });
                        ok = res.ok;
                        if (ok) canvases = canvases.filter(c => c.id !== canvas.id);
                    } catch (_) { ok = false; }
                } else {
                    const patch = action === 'move' ? { project:projectId } : { board_x:origin.x + index % columns * 276, board_y:origin.y + Math.floor(index / columns) * 252 };
                    ok = await persistMeta(canvas.id, patch);
                    if (ok) Object.assign(canvases.find(c => c.id === canvas.id), patch);
                }
                if (!ok) failed++;
            }
            renderBoard(); renderProjects();
            if (action === 'delete') await refreshTrashCount();
            setStatus(failed ? L(`${failed} 个操作失败，请重试`, `${failed} operations failed; retry`) : L('批量操作完成','Batch operation complete'));
        } finally { busy = false; sync(); }
    }
    bar.querySelectorAll('[data-action]').forEach(button => { button.onclick = async () => (await run(button.dataset.action)); });
    bar.querySelector('select').onchange = async e => { if (e.target.value) (await run('move', e.target.value)); };
    board.addEventListener('contextmenu', e => {
        if (e.target.closest('input,textarea,.ws-create-card') || busy) return;
        e.preventDefault(); closeCardMenu();
        const card = e.target.closest('.ws-card');
        if (card && !selected.has(card.dataset.canvasId)) { selected = new Set([card.dataset.canvasId]); sync(); }
        if (!selected.size) return;
        const pop = document.createElement('div');
        pop.className = 'ws-card-pop';
        pop.innerHTML = `${selected.size === 1 ? `<button class="ws-pop-item" data-action="open">${L('打开画布','Open canvas')}</button>` : ''}<button class="ws-pop-item" data-action="arrange">${L('整理选中','Arrange selected')}</button><select class="ws-pop-project" aria-label="${L('移动到项目','Move to project')}">${bar.querySelector('select').innerHTML}</select><button class="ws-pop-item danger" data-action="delete">${L('删除选中','Delete selected')}</button><button class="ws-pop-item" data-action="clear">${L('取消选择','Clear selection')}</button>`;
        document.body.appendChild(pop);
        pop.style.left = Math.max(8, Math.min(e.clientX, window.innerWidth-pop.offsetWidth-8))+'px';
        pop.style.top = Math.max(8, Math.min(e.clientY, window.innerHeight-pop.offsetHeight-8))+'px';
        pop.querySelectorAll('[data-action]').forEach(button => { button.onclick = async () => {
            if (button.dataset.action === 'open') { closeCardMenu(); openCanvas(chosen()[0]); }
            else (await run(button.dataset.action));
        }; });
        pop.querySelector('select').onchange = async event => { if (event.target.value) (await run('move', event.target.value)); };
    });
    document.addEventListener('keydown', async e => {
        if (e.target.closest('input,textarea,select,[contenteditable="true"]') || busy) return;
        if (e.key === 'Escape') { stopMarquee(); clear(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selected = new Set(canvasesInProject(currentProjectId).map(c => c.id)); sync(); }
        if (e.key === 'Delete' && selected.size) { e.preventDefault(); (await run('delete')); }
    });
    new MutationObserver(sync).observe(boardWorld, {childList:true});
    sync();
})();
