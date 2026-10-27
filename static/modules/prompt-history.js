/* 文字与 File 引用使用同一历史栈；不依赖浏览器对脚本删除的原生撤销。 */
window.PromptHistory = (() => {
    function createStack(initial, key, limit = 60) {
        let current = initial, undo = [], redo = [];
        return {
            record(next, merge = false) {
                if (key(next) === key(current)) return false;
                if (!merge || !undo.length) undo.push(current);
                if (undo.length > limit) undo.shift();
                current = next; redo = []; return true;
            },
            sync(next) { current = next; },
            undo() { if (!undo.length) return null; redo.push(current); return current = undo.pop(); },
            redo() { if (!redo.length) return null; undo.push(current); return current = redo.pop(); }
        };
    }
    function mount() {
        const input = document.getElementById('prompt');
        const manager = window._refImgMgr;
        if (!input || !manager || input._promptHistory) return;
        input._promptHistory = true;
        let applying = false, composing = false, lastTyped = 0;
        function selection() {
            const sel = window.getSelection();
            if (!sel?.rangeCount || !input.contains(sel.anchorNode) || !input.contains(sel.focusNode)) return null;
            const range = sel.getRangeAt(0);
            function offset(node, value) {
                const prefix = document.createRange(); prefix.selectNodeContents(input); prefix.setEnd(node, value);
                const fragment = prefix.cloneContents(); fragment.querySelectorAll('.ref-chip').forEach(node => node.remove());
                return fragment.textContent.length;
            }
            return [offset(range.startContainer, range.startOffset), offset(range.endContainer, range.endOffset)];
        }
        function snapshot() {
            return { text:input.value || '', files:manager.getFiles().map(({url, ...item}) => ({...item})), selection:selection() };
        }
        const signature = state => JSON.stringify([state.text, state.files.map(item => item.id)]);
        const stack = createStack(snapshot(), signature);
        function record(event) {
            if (applying || composing) return;
            const typing = event?.type === 'input' && event.inputType === 'insertText';
            const now = Date.now();
            if (stack.record(snapshot(), typing && now - lastTyped < 650)) lastTyped = typing ? now : 0;
        }
        let scheduled = false, pendingEvent = null;
        function schedule(event) {
            if (applying || composing) return;
            if (event?.type === 'input') pendingEvent = event;
            if (event?.type === 'ref-images-changed') pendingEvent = null;
            if (scheduled) return;
            scheduled = true;
            queueMicrotask(() => { scheduled = false; const next = pendingEvent; pendingEvent = null; record(next); });
        }
        function restoreSelection(saved) {
            const nodes = [];
            const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT, {
                acceptNode:node => node.parentElement?.closest('.ref-chip') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
            });
            while (walker.nextNode()) nodes.push(walker.currentNode);
            if (!nodes.length) { input.appendChild(document.createTextNode('')); nodes.push(input.lastChild); }
            function point(offset) {
                for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length; }
                return [nodes.at(-1), nodes.at(-1).length];
            }
            const range = document.createRange();
            range.setStart(...point(saved?.[0] ?? input.value.length)); range.setEnd(...point(saved?.[1] ?? input.value.length));
            const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        }
        function travel(redo) {
            record();
            const state = redo ? stack.redo() : stack.undo();
            if (!state) return;
            applying = true;
            try {
                const currentIds = manager.getFiles().map(item => item.id);
                if (JSON.stringify(currentIds) !== JSON.stringify(state.files.map(item => item.id))) manager.restoreFiles(state.files);
                input.value = state.text;
                input.dispatchEvent(new Event('input', {bubbles:true}));
                input.focus(); restoreSelection(state.selection);
                stack.sync(snapshot());
            } finally { applying = false; lastTyped = 0; }
        }
        input.addEventListener('input', schedule);
        input.addEventListener('compositionstart', () => { composing = true; });
        input.addEventListener('compositionend', () => { composing = false; schedule(); });
        input.addEventListener('beforeinput', event => {
            if (!['historyUndo','historyRedo'].includes(event.inputType)) { if (!composing) { record(); stack.sync(snapshot()); } return; }
            event.preventDefault(); event.stopImmediatePropagation(); travel(event.inputType === 'historyRedo');
        }, true);
        document.addEventListener('ref-images-changed', event => { schedule(event); if (!applying) input.focus(); });
        new MutationObserver(() => schedule()).observe(input, {subtree:true, childList:true, characterData:true});
        document.addEventListener('keydown', event => {
            if (event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return;
            const key = event.key.toLowerCase();
            if (key !== 'z' && key !== 'y') return;
            if (!(event.target === input || input.contains(event.target))) return;
            event.preventDefault(); event.stopImmediatePropagation(); travel(key === 'y' || event.shiftKey);
        }, true);
    }
    document.addEventListener('DOMContentLoaded', mount, {once:true});
    return { createStack };
})();
