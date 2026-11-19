/* Chat generation controls and sequential submission; page adapters own UI and engine calls. */
(function (root) {
    'use strict';
    function chatControlSuffix(raw, partial = false) {
        const text = String(raw || '');
        const pattern = partial ? /^[ \t]*(IMAGE|VIDEO|PARAMS|PREFS)\b[ \t]*(\{[\s\S]*|$)/gim : /^[ \t]*(IMAGE|VIDEO|PARAMS|PREFS)[ \t]*(\{[\s\S]*\})\s*$/gim;
        for (const match of text.matchAll(pattern)) {
            // 代码块中的示例指令属于正文，不能当作实际控制指令。
            let fence = null;
            for (const line of text.slice(0, match.index).split('\n')) {
                const token = line.match(/^\s*(`{3,}|~{3,})/);
                if (!token) continue;
                if (!fence) fence = token[1];
                else if (token[1][0] === fence[0] && token[1].length >= fence.length) fence = null;
            }
            if (fence) continue;
            try { return { index:match.index, kind:match[1].toUpperCase(), value:JSON.parse(match[2]) }; }
            catch (_) { if (partial) return { index:match.index, kind:match[1].toUpperCase(), value:null }; }
        }
        return null;
    }
    function readImageSpec(raw, request = '') {
        const control = chatControlSuffix(raw);
        if (control) return control.kind === 'IMAGE' && control.value && control.value.prompt ? control.value : null;
        // 兼容模型漏写 IMAGE 的纯 JSON，仅对明确生图请求启用，正文示例仍保留为文本。
        if (/(?:不要|别|不需要|无需|不用)|\b(?:don't|do not)\b/i.test(request) || !/(?:生图|出图|画一|画个|画张|绘制|画图|改图|生成\s*(?:[一二两三四1234]\s*张)|生成[^\n]*(?:图片|图像|照片|插画)|\b(?:generate|draw|create)\b[^\n]*\b(?:image|picture|photo|illustration)\b)/i.test(request)) return null;
        let json = String(raw || '').trim();
        const fenced = json.match(/^(`{3,}|~{3,})(?:json)?\s*\n([\s\S]*?)\n\1\s*$/i);
        if (fenced) json = fenced[2].trim();
        try {
            const value = JSON.parse(json);
            return value && !Array.isArray(value) && typeof value.prompt === 'string' && value.prompt.trim() ? value : null;
        } catch (_) { return null; }
    }

    async function run(task, {website, beforeRound, render}) {
        const rounds = task.engine === 'cloud' && !website
            ? Math.min(4, Math.max(1, task.snapshot.controls.batchCount || 1)) : 1;
        for (let index = 0; index < rounds; index++) {
            task.check();
            beforeRound(rounds, index);
            await render();
            task.check();
            await Promise.all(task.saves || []);
            if (task.saveError) throw task.saveError;
        }
        task.check();
        await Promise.all(task.saves || []);
        if (task.saveError) throw task.saveError;
    }
    root.ChatImageGeneration = {chatControlSuffix, readImageSpec, run};
})(window);
