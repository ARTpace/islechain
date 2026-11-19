/* Message presentation only; no conversation or generation state. */
(() => {
    'use strict';
    function paintThinking(bubble, text) {
        const shown = String(text || '')
            .replace(/\r\n?/g, '\n')
            .replace(/[ \t\u00a0\u3000]+$/gm, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        let box = bubble.querySelector('.chat-think');
        if (!shown) {
            if (box) { box.remove(); }
            return;
        }
        if (!box) {
            box = document.createElement('details');
            box.className = 'chat-think';
            const head = document.createElement('summary');
            head.className = 'chat-think-head';
            head.textContent = '思考过程';
            const body = document.createElement('div');
            body.className = 'chat-think-body';
            box.append(head, body);
            const replyEl = bubble.querySelector('.chat-reply');
            bubble.insertBefore(box, replyEl || bubble.firstChild);
        }
        const body = box.querySelector('.chat-think-body');
        if (body.textContent !== shown) {
            const stick = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
            body.textContent = shown;
            if (box.open && stick) body.scrollTop = body.scrollHeight;
        }
    }
    window.ChatTranscript = {paintThinking};
})();
