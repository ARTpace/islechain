/* 对话任务只保留实际提交的参数；重试复用工作流，不读取已变化的界面。 */
window.ChatTasks = (() => {
    const clone = value => JSON.parse(JSON.stringify(value));
    const AGAIN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/></svg>';
    const ANSWER_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="m9 10 3 3 3-3"/></svg>';
    function iconButton() {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chat-task-act';
        button.hidden = true;
        return button;
    }
    function labelButton(button, label, icon) {
        button.dataset.tip = label;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.innerHTML = icon;
    }
    function park(host, buttons) {
        const stack = host.closest && host.closest('.chat-stack');
        const bar = stack && stack.querySelector('.chat-prompt-bar');
        if (!bar) return;
        stack.querySelectorAll('.chat-task-act').forEach(node => {
            if (!buttons.includes(node)) node.remove();
        });
        const copy = bar.querySelector('.chat-prompt-copy');
        buttons.forEach(button => {
            if (copy) bar.insertBefore(button, copy);
            else bar.appendChild(button);
        });
    }
    function create(host) {
        const task = { host, controller:new AbortController(), cancelled:false, promptId:null, snapshot:null };
        const bar = document.createElement('div');
        bar.className = 'chat-task-bar';
        const label = document.createElement('span');
        const stop = document.createElement('button');
        stop.type = 'button'; stop.textContent = '停止';
        const retry = iconButton();
        const answer = iconButton();
        labelButton(retry, '重新回答', ANSWER_ICON);
        labelButton(answer, '重新回答', ANSWER_ICON);
        bar.append(label, stop); host.appendChild(bar);
        park(host, [retry, answer]);
        task.setStage = stage => { label.hidden = !stage; label.textContent = stage; };
        task.cancelRemote = async () => {
            if (!task.promptId) return;
            const response = await fetch('/api/comfyui/cancel-task', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({ prompt_id:task.promptId, client_id:task.clientId })
            });
            if (!response.ok) throw new Error('本地任务取消失败，请检查 ComfyUI 状态');
        };
        stop.onclick = async () => {
            if (task.cancelled) return;
            task.cancelled = true; task.controller.abort();
            stop.disabled = true; task.setStage('正在停止');
            try {
                await task.cancelRemote();
                task.setStage(task.engine === 'cloud' ? '已停止等待（上游 API 可能继续执行）' : '已停止');
            } catch (error) { task.setStage(error.message); }
        };
        task.finish = (error) => {
            stop.hidden = true;
            if (error) task.setStage('失败：' + error.message);
            else if (task.cancelled && !task.promptId && !task.engine) task.setStage('已停止');
            else task.setStage('');
            const retryLabel = task.snapshot ? (error || task.cancelled ? '原参数重试' : '相同参数再出一张') : '重新回答';
            labelButton(retry, retryLabel, task.snapshot ? AGAIN_ICON : ANSWER_ICON);
            retry.hidden = false;
            answer.hidden = !task.snapshot || !task.answerAgain;
            retry.onclick = () => task.rerun?.();
            answer.onclick = () => task.answerAgain?.();
            park(host, [retry, answer]);
        };
        task.bar = bar;
        task.check = () => { if (task.cancelled) throw new DOMException('任务已停止', 'AbortError'); };
        task.setStage('正在理解');
        return task;
    }
    function isEdit(text) { return /改成|改为|换成|换为|其他不变|其它不变|保持.{0,8}不变|修改|调整|编辑|重绘|变成|换个|改.{0,6}(颜色|白|黑|红|蓝|绿|黄|紫)|替换|去掉|移除|擦除|调亮|调暗|再.{0,8}一点|这张|这幅|图\s*(?:\d+|[一二三四五六七八九十])/i.test(text || ''); }
    function numberedReferences(text, previousRefs) {
        const numbers = [...String(text || '').matchAll(/图\s*(\d+|[一二三四五六七八九十])/g)].map(match => {
            const chinese = '一二三四五六七八九十'.indexOf(match[1]);
            return chinese < 0 ? Number(match[1]) : chinese + 1;
        });
        return numbers.length && previousRefs.length >= Math.max(...numbers) ? previousRefs : null;
    }
    function referenceGuide(refs) {
        return refs.length ? '\n本轮参考图按附件顺序编号：' + refs.map((_, i) => '图 ' + (i + 1)).join('、') + '。严格对应用户指定的角色、构图等来源；修改任务应输出 IMAGE 指令和完整修改要求，未要求改变的内容保持不变。' : '';
    }
    return { create, clone, isEdit, referenceGuide, numberedReferences };
})();
