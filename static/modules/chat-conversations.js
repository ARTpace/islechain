/* Conversation history owns its cache and pagination; the page owns message rendering. */
(function (root) {
    'use strict';
    function create({document, fetch, getOwner, getHeaders, getConversationId,
        onLoad, onNew, confirm, onError, preview, escapeChat}) {
        let historyOffset = 0;
        let historyRequest = 0;
        let historyLoadedAt = 0;
        let historyOwner = getOwner();
        let historyRevision = 0;
        let historyLoadedRevision = -1;
        function invalidateHistory() { historyRevision++; }
        async function openHistory(append) {
            append = append === true;
            const panel = document.getElementById('chatHistory');
            if (!panel) return;
            const owner = getOwner();
            if (owner !== historyOwner) { historyOwner = owner; historyLoadedAt = 0; historyRevision++; historyRequest++; panel.innerHTML = ''; }
            if (!append && !panel.classList.toggle('open')) {
                historyRequest++;
                const pendingMore = panel.querySelector('[data-history-more]');
                if (pendingMore) pendingMore.disabled = false;
                return;
            }
            const historyBtn = document.getElementById('chatHistoryBtn');
            if (historyBtn) panel.style.left = historyBtn.offsetLeft + 'px';
            panel.querySelectorAll('[data-cid]').forEach(btn => btn.classList.toggle('active', btn.dataset.cid === getConversationId()));
            // ponytail: 保留已加载 DOM 与分页位置，短时间重开不请求；过期时保留列表再刷新。
            if (!append && historyLoadedAt && historyLoadedRevision === historyRevision && Date.now() - historyLoadedAt < 30000) return;
            const request = ++historyRequest;
            const revision = historyRevision;
            if (!append) historyOffset = 0;
            if (!append && !historyLoadedAt) panel.innerHTML = '<div class="chat-history-empty">正在读取</div>';
            const more = panel.querySelector('[data-history-more]');
            if (more) more.disabled = true;
            try {
                const res = await fetch('/api/conversations?limit=20&offset=' + historyOffset, { headers: getHeaders() });
                if (!res.ok) throw new Error(res.status === 401 ? '请先登录后查看历史对话' : '历史读取失败，请重新打开');
                const data = await res.json();
                if (request !== historyRequest || owner !== getOwner() || !panel.classList.contains('open')) return;
                const list = data.conversations || [];
                if (!append) { historyLoadedAt = Date.now(); historyLoadedRevision = revision; }
                if (!append && !list.length) {
                    panel.innerHTML = '<div class="chat-history-empty">还没有历史对话</div>';
                    return;
                }
                if (more) more.remove();
                if (!append) panel.innerHTML = '';
                historyOffset += list.length;
                panel.insertAdjacentHTML('beforeend', list.map(item => '<div class="chat-history-row"><button type="button" class="chat-history-item' + (item.id === getConversationId() ? ' active' : '') + '" data-cid="' + escapeChat(item.id) + '"><span class="chat-history-title">' + escapeChat(item.title || '新对话') + '</span><span class="chat-history-sub">' + escapeChat(preview(item.last_message || '')) + '</span></button><button type="button" class="chat-history-delete" data-delete-cid="' + escapeChat(item.id) + '" title="删除对话" aria-label="删除对话">×</button></div>').join(''));
                if (data.has_more) {
                    const next = document.createElement('button');
                    next.type = 'button';
                    next.className = 'chat-history-item chat-history-more';
                    next.dataset.historyMore = '1';
                    next.textContent = '加载更多';
                    next.onclick = () => openHistory(true);
                    panel.appendChild(next);
                }
                panel.querySelectorAll('[data-delete-cid]').forEach(btn => {
                    btn.onclick = async (event) => {
                        event.stopPropagation();
                        if (!(await confirm('确定删除这条历史对话吗？'))) return;
                        btn.disabled = true;
                        try {
                            const id = btn.dataset.deleteCid;
                            const res = await fetch('/api/conversations/' + encodeURIComponent(id), { method:'DELETE', headers:getHeaders() });
                            if (!res.ok) throw new Error('删除失败，请重试');
                            btn.closest('.chat-history-row')?.remove();
                            invalidateHistory();
                            if (id === getConversationId()) onNew();
                            panel.classList.remove('open');
                            await openHistory();
                        } catch (e) {
                            onError(e.message || '删除失败');
                        } finally { btn.disabled = false; }
                    };
                });
                panel.querySelectorAll('[data-cid]').forEach(btn => {
                    btn.onclick = () => onLoad(btn.getAttribute('data-cid'));
                });
            } catch (e) {
                if (request !== historyRequest) return;
                if (append && more) { more.disabled = false; more.textContent = '读取失败，点击重试'; }
                else if (!historyLoadedAt) panel.innerHTML = '<div class="chat-history-empty">' + escapeChat(e.message || '历史读取失败，请重新打开') + '</div>';
            }
        }
        return {open: openHistory, invalidate: invalidateHistory};
    }

    // A newer selection, new conversation or account change invalidates old responses.
    function createLoader({fetch, getHeaders, getOwner, isBusy, onLoaded}) {
        let revision = 0;
        let controller = null;
        function cancel() { revision++; controller?.abort(); controller = null; }
        async function load(id) {
            if (!id || isBusy()) return false;
            cancel();
            const request = revision;
            const owner = getOwner();
            const current = new AbortController();
            controller = current;
            try {
                const response = await fetch('/api/conversations/' + encodeURIComponent(id), {
                    headers: getHeaders(), signal: current.signal
                });
                if (!response.ok) return false;
                const data = await response.json();
                if (request !== revision || owner !== getOwner() || isBusy()) return false;
                onLoaded(data, id);
                return true;
            } catch (error) {
                if (current.signal.aborted || request !== revision) return false;
                throw error;
            } finally { if (controller === current) controller = null; }
        }
        return {load, cancel};
    }
    // Snapshot the write target before awaiting I/O; never redirect an old write to a new chat.
    function createPersistence({fetch, getHeaders, getOwner, getConversationId, onRemember, onInvalidate}) {
        async function post(id, action, payload, headers = getHeaders()) {
            return fetch('/api/conversations' + (id ? '/' + encodeURIComponent(id) + '/' + action : ''), {
                method:'POST', headers, body:JSON.stringify(payload)
            });
        }
        async function saveImage(src) {
            if (!src) return;
            const owner = getOwner(), originalId = getConversationId(), headers = getHeaders();
            let id = originalId;
            if (!id) {
                try {
                    const created = await post('', '', {title:'对话生图'}, headers);
                    if (created.ok) id = (await created.json()).conversation?.id || '';
                } catch (_) {}
            }
            if (owner !== getOwner() || originalId !== getConversationId()) throw new Error('对话已切换，图片未写入新对话');
            if (!id) throw new Error('图片已生成，但对话创建失败');
            if (!originalId) onRemember(id);
            const saved = await post(id, 'images', {image_urls:[src]}, headers);
            if (!saved.ok) throw new Error('图片已生成，但对话图片保存失败');
            onInvalidate();
        }
        async function removeMessages(id, ids) {
            if (!id || !ids.length) return true;
            const response = await post(id, 'messages/delete', {message_ids:ids});
            if (!response.ok) return false;
            onInvalidate();
            return true;
        }
        async function markPending(messageId) {
            const id = getConversationId();
            if (!id || !messageId) return null;
            const response = await post(id, 'pending', {message_id:messageId});
            return response.ok ? response.json() : null;
        }
        return {saveImage, removeMessages, markPending};
    }
    root.ChatConversations = {create, createLoader, createPersistence};
})(window);
