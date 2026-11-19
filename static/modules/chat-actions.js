/* Direct message actions; application persistence and input adapters stay in the page. */
(function (root) {
    'use strict';
    const CHAT_PROMPT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    const CHAT_COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const CHAT_CHECK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
    const CHAT_DELETE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
    const CHAT_RESEND_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/></svg>';
    const CHAT_TO_INPUT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"/></svg>';

    function create({thread, onResend, onToInput, onViewPrompt, onDelete,
        isPromptOpen = () => false, copyText = text => root.navigator.clipboard.writeText(text)}) {
        const document = thread.ownerDocument || root.document;
        const timers = new Set();
        let disposed = false;
        function later(callback, delay) {
            if (disposed) return;
            const id = setTimeout(() => { timers.delete(id); if (!disposed) callback(); }, delay);
            timers.add(id);
            return id;
        }
        function cancelTimer(id) { clearTimeout(id); timers.delete(id); }
        function conversationCopyText() {
            const lines = [];
            thread.querySelectorAll('.chat-row').forEach(row => {
                if (row.classList.contains('user')) {
                    const text = (row.querySelector('.chat-user')?.innerText || '').trim();
                    if (text) lines.push('用户：\n' + text);
                    return;
                }
                const replyNode = row.querySelector('.chat-reply');
                const reply = (replyNode?.dataset.rawText ?? replyNode?.innerText ?? '').trim();
                const prompt = (row.querySelector('.chat-prompt-body')?.textContent || '').trim();
                if (reply) lines.push('助手：\n' + reply);
                if (prompt) lines.push('提示词：\n' + prompt);
            });
            return lines.join('\n\n');
        }
        function ensureUserActions(row) {
            const foot = row && row.querySelector('.chat-user-foot');
            if (!foot || foot.querySelector('.chat-user-actions')) return;
            const bar = document.createElement('div');
            bar.className = 'chat-user-actions';
            bar.innerHTML = '<button type="button" class="chat-user-act" data-act="resend" data-tip="重新发送" aria-label="重新发送">' + CHAT_RESEND_ICON + '</button><button type="button" class="chat-user-act" data-act="to-input" data-tip="复制到对话栏" aria-label="复制到对话栏">' + CHAT_TO_INPUT_ICON + '</button>';
            const resendBtn = bar.querySelector('[data-act="resend"]');
            const copyBtn = bar.querySelector('[data-act="to-input"]');
            bar.querySelectorAll('button').forEach(btn => btn.addEventListener('mousedown', (e) => e.preventDefault()));
            resendBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                onResend({ text: row.dataset.chatText || '', refs: row._chatRefs || [] });
            });
            copyBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await onToInput(row);
                copyBtn.innerHTML = CHAT_CHECK_ICON;
                copyBtn.dataset.tip = '已放入对话栏';
                later(() => {
                    copyBtn.innerHTML = CHAT_TO_INPUT_ICON;
                    copyBtn.dataset.tip = '复制到对话栏';
                }, 1200);
            });
            foot.appendChild(bar);
        }
        function chatActionBox(bubble) {
            const stack = (bubble && bubble.closest('.chat-stack')) || (bubble && bubble.parentElement);
            const boxes = stack ? [...stack.querySelectorAll('.chat-prompt')] : [];
            boxes.slice(1).forEach(extra => extra.remove());
            return boxes[0] || null;
        }
        function turnCopyText(bubble) {
            const row = bubble.closest('.chat-row');
            const lines = [];
            const prev = row && row.previousElementSibling;
            if (prev && prev.classList.contains('user')) {
                const text = (prev.querySelector('.chat-user')?.innerText || '').trim();
                if (text) lines.push('用户：\n' + text);
            }
            const replyNode = bubble.querySelector('.chat-reply');
            const reply = (replyNode?.dataset.rawText ?? replyNode?.innerText ?? '').trim();
            const prompt = (chatActionBox(bubble)?.querySelector('.chat-prompt-body')?.textContent || '').trim();
            if (reply) lines.push('助手：\n' + reply);
            if (prompt) lines.push('提示词：\n' + prompt);
            return lines.join('\n\n');
        }
        function syncPromptAction(box) {
            const toggle = box.querySelector('.chat-prompt-toggle');
            const body = box.querySelector('.chat-prompt-body');
            if (toggle) toggle.hidden = !(body && body.textContent.trim());
        }
        function ensureChatActions(bubble, promptText) {
            let box = chatActionBox(bubble);
            if (!box) {
                box = document.createElement('div');
                box.className = 'chat-prompt';
                box.innerHTML = '<div class="chat-prompt-bar"><button type="button" class="chat-prompt-toggle" data-tip="提示词" aria-label="提示词" hidden>' + CHAT_PROMPT_ICON + '</button><button type="button" class="chat-prompt-copy" data-tip="复制这次对话" aria-label="复制这次对话">' + CHAT_COPY_ICON + '</button><button type="button" class="chat-prompt-delete" data-tip="删除这次对话" aria-label="删除这次对话">' + CHAT_DELETE_ICON + '</button></div><pre class="chat-prompt-body" hidden></pre>';
                const toggle = box.querySelector('.chat-prompt-toggle');
                const copyBtn = box.querySelector('.chat-prompt-copy');
                const deleteBtn = box.querySelector('.chat-prompt-delete');
                const body = box.querySelector('.chat-prompt-body');
                box.querySelectorAll('button').forEach(btn => btn.addEventListener('mousedown', (e) => e.preventDefault()));
                toggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const text = (body.textContent || '').trim();
                    if (!text) return;
                    box.classList.add('is-open');
                    onViewPrompt(bubble, text, toggle, e);
                });
                copyBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const text = turnCopyText(bubble);
                    try {
                        await copyText(text);
                        copyBtn.innerHTML = CHAT_CHECK_ICON;
                        copyBtn.dataset.tip = '已复制';
                    } catch (err) {
                        copyBtn.dataset.tip = '复制失败';
                    }
                    later(() => {
                        copyBtn.innerHTML = CHAT_COPY_ICON;
                        copyBtn.dataset.tip = '复制这次对话';
                    }, 1200);
                });
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!deleteBtn.classList.contains('is-confirming')) {
                        deleteBtn.classList.add('is-confirming');
                        deleteBtn.dataset.tip = '再点一次删除';
                        cancelTimer(deleteBtn._confirmTimer);
                        deleteBtn._confirmTimer = later(() => {
                            deleteBtn.classList.remove('is-confirming');
                            deleteBtn.dataset.tip = '删除这次对话';
                        }, 3000);
                        return;
                    }
                    cancelTimer(deleteBtn._confirmTimer);
                    onDelete(bubble);
                });
            }
            if (promptText) box.querySelector('.chat-prompt-body').textContent = promptText;
            syncPromptAction(box);
            const stack = bubble.parentElement && bubble.parentElement.classList.contains('chat-stack') ? bubble.parentElement : bubble;
            const foot = stack.querySelector ? stack.querySelector(':scope > .chat-asst-foot') : null;
            (foot || stack).appendChild(box);
        }
        function closePrompts() {
            if (isPromptOpen()) return;
            thread.querySelectorAll('.chat-prompt.is-open').forEach(box => box.classList.remove('is-open'));
        }
        document.addEventListener('click', closePrompts);
        function dispose() {
            disposed = true;
            timers.forEach(id => clearTimeout(id));
            timers.clear();
            document.removeEventListener('click', closePrompts);
        }
        return {ensureUserActions, ensureChatActions, chatActionBox, conversationCopyText, dispose};
    }
    root.ChatActions = {create};
})(window);
