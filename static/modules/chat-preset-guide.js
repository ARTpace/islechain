/* Preset onboarding: metadata comes from the same preset as its AI instructions. */
(function (global) {
    'use strict';
    const roles = new Map();
    const choices = ['参考图', '可用资产', '布局参考', '白盒布局', '美术风格', '地表布局', '材质风格', '待编辑原图', '补全参考', '目标效果'];
    const escape = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function missing(preset, text, refs) {
        if (!preset?.guide?.required) return '';
        const requiredRole = preset.guide.roles?.[0];
        if (refs.length) {
            const marked = refs.filter(ref => choices.some(role => String(ref.name || '').startsWith(role + ' · ')));
            if (!marked.length || !requiredRole || marked.some(ref => String(ref.name || '').startsWith(requiredRole + ' · '))) return '';
        }
        if (!/(生成|生图|出图|画一|绘制|帮我画|改图|移除|去掉|优化.*图)/i.test(text)) return '';
        if (/(提示词|prompt)/i.test(text) && !/(并|再|直接).*?(出图|生图|生成图片)/.test(text)) return '';
        if (/(只.*提示词|仅.*提示词|不要.*生图|不.*生成|怎么|如何|能否|能不能|为什么|什么)/.test(text)) return '';
        return '请先添加' + preset.guide.inputs[0].replace(/（.*?）/, '') + '，再发送生成要求。';
    }
    function annotate(refs, files = []) {
        return refs.map((ref, index) => {
            const role = roles.get(ref.url) || (files.length === refs.length ? roles.get(files[index]?.url) : '');
            return {...ref, name:role ? role + ' · ' + (ref.name || '参考图') : ref.name};
        });
    }
    let panel = null;
    let composer = null;
    function close() { panel?.remove(); panel = null; }
    function mount(host, preset, input, files) {
        composer = input;
        const urls = new Set(files.map(file => file.url));
        for (const key of roles.keys()) if (!urls.has(key)) roles.delete(key);
        files.forEach((file, index) => { if (!roles.has(file.url)) roles.set(file.url, preset?.guide?.roles?.[index] || '参考图'); });
        // Selection and uploads never open help automatically.
    }
    function open(preset) {
        close(); if (!preset) return;
        const guide = preset.guide || {inputs:['文字描述，参考图可选'], output:preset.description || '按此设定生成提示词与图片。', example:'描述主体、想要的效果，以及需要保留的部分。'};
        panel = document.createElement('aside');
        panel.className = 'preset-guide-sidebar'; panel.setAttribute('aria-label', '预设使用指导');
        panel.innerHTML = '<div class="preset-guide-header"><b>' + escape(preset.name) + '</b><button type="button" data-close aria-label="关闭指导">×</button></div>'
            + '<div class="preset-guide-content"><section><h3>参考图</h3><p>' + (guide.inputs || []).map(escape).join('<br>') + '</p></section>'
            + '<section><h3>可以这样说</h3><p>' + escape(guide.example) + '</p><button type="button" data-fill>使用此示例</button></section>'
            + '<section><h3>输出</h3><p>' + escape(guide.output) + '</p></section>'
            + (guide.cases?.length ? '<details><summary>查看案例</summary>' + guide.cases.map(([id,label]) => '<a href="/static/assets/scene-examples/' + escape(id) + '.jpg" target="_blank" rel="noopener"><img loading="lazy" src="/static/assets/scene-examples/' + escape(id) + '.jpg" alt="' + escape(label) + '"><span>' + escape(label) + '</span></a>').join('') + '<p class="preset-guide-note">' + escape(guide.note) + '</p></details>' : '')
            + '</div>';
        document.body.append(panel);
        panel.querySelector('[data-close]').onclick = close;
        panel.querySelector('[data-fill]').onclick = () => {
            if (!composer) return;
            if (composer.value.trim() && composer.value.trim() !== guide.example && !global.confirm('替换当前输入？已上传图片会保留。')) return;
            global.dispatchEvent(new CustomEvent('chat-preset-guide-use', {detail:{id:preset.id}}));
            composer.value = guide.example;
            composer.dispatchEvent(new Event('input', {bubbles:true})); close(); composer.focus();
        };
    }
    function showMissing(host, message) {
        // Required-input feedback stays by the composer, not in the conversation.
        let status = document.getElementById('presetGuideStatus');
        if (!status) { status = document.createElement('div'); status.id = 'presetGuideStatus'; status.setAttribute('role','status'); composer?.parentElement?.append(status); }
        status.textContent = message;
        composer?.addEventListener('input', () => status.remove(), {once:true});
        global.addEventListener('chat-reference-upload-changed', () => status.remove(), {once:true});
    }
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    global.ChatPresetGuide = {mount, open, close, missing, annotate, showMissing};
})(window);
