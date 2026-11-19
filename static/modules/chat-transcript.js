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
    function formatChatTime(ts) {
        const date = new Date(Number(ts) || Date.now());
        if (Number.isNaN(date.getTime())) return '';
        const pad = n => String(n).padStart(2, '0');
        const hm = pad(date.getHours()) + ':' + pad(date.getMinutes());
        if (date.toDateString() === new Date().toDateString()) return hm;
        return (date.getMonth() + 1) + '-' + date.getDate() + ' ' + hm;
    }
    function stampChatTime(host, ts) {
        if (!host) return;
        let el = host.querySelector('.chat-time');
        if (!el) {
            el = document.createElement('div');
            el.className = 'chat-time';
            const foot = host.querySelector(':scope > .chat-user-foot, :scope > .chat-asst-foot') || host;
            const actions = foot.querySelector(':scope > .chat-user-actions');
            if (actions) foot.insertBefore(el, actions);
            else foot.appendChild(el);
        }
        const when = Number(ts) || Date.now();
        el.dataset.ts = String(when);
        el.textContent = formatChatTime(when);
    }
    function create({thread, previewSrc = value => value, onUser = () => {}, onAssistant = () => {}, onAppend = () => {}}) {
        function addUser(text, msgId, ts, attachments) {
            const empty = thread.querySelector('.chat-empty');
            if (empty) empty.remove();
            const row = document.createElement('div');
            row.className = 'chat-row user';
            if (msgId) row.dataset.msgId = msgId;
            const wrap = document.createElement('div');
            wrap.className = 'chat-bubble-wrap';
            const bubble = document.createElement('div');
            bubble.className = 'chat-user';
            const pics = (attachments || []).filter(item => item && item.url);
            if (pics.length) {
                const imgs = document.createElement('div');
                imgs.className = 'chat-imgs';
                pics.forEach((item, index) => {
                    const img = document.createElement('img');
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    img.setAttribute('data-original-src', item.url);
                    img.src = previewSrc(item.url);
                    img.alt = item.name || '参考图';
                    const figure = document.createElement('div');
                    const number = document.createElement('span'); number.className = 'chat-ref-number'; number.textContent = '图 ' + (index + 1);
                    figure.append(img, number); imgs.appendChild(figure);
                });
                bubble.appendChild(imgs);
            }
            if (text) bubble.appendChild(document.createTextNode(text));
            wrap.appendChild(bubble);
            const foot = document.createElement('div');
            foot.className = 'chat-user-foot';
            wrap.appendChild(foot);
            row.appendChild(wrap);
            row._chatRefs = pics.map(item => ({ url: item.url, name: item.name || '' }));
            row.dataset.chatText = text || '';
            stampChatTime(foot, ts || Date.now());
            onUser(row);
            thread.appendChild(row);
            onAppend();
            return row;
        }
        function addAssistant(msgId, ts) {
            const empty = thread.querySelector('.chat-empty');
            if (empty) empty.remove();
            const row = document.createElement('div');
            row.className = 'chat-row';
            if (msgId) row.dataset.msgId = msgId;
            const stack = document.createElement('div');
            stack.className = 'chat-stack';
            const bubble = document.createElement('div');
            bubble.className = 'chat-asst';
            stack.appendChild(bubble);
            row.appendChild(stack);
            const foot = document.createElement('div');
            foot.className = 'chat-asst-foot';
            stack.appendChild(foot);
            stampChatTime(foot, ts || Date.now());
            thread.appendChild(row);
            onAssistant(bubble, '');
            onAppend();
            return bubble;
        }
        return {addUser, addAssistant};
    }
    window.ChatTranscript = {paintThinking, formatChatTime, stampChatTime, create};
})();
