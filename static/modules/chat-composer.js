/* 对话图片描述走当前视觉 API；高级参数复用已有控件。 */
window.ChatComposer = (() => {
    function isDescription(text) {
        const value = String(text || '');
        if (/修改|改成|改为|换成|换为|重绘|替换|局部修改|去掉|移除|擦除/.test(value) && !/不要.{0,4}(修改|改图|生成)|只.{0,4}(描述|反推)/.test(value)) return false;
        return /反推|描述.{0,12}(图片|图像|这张图|参考图|画面)|(?:图片|图像|这张图|参考图).{0,12}描述|提取.{0,8}提示词|describe.{0,20}(image|picture)|image.{0,20}prompt/i.test(value);
    }
    function descriptionGuide() {
        const language = document.getElementById('chatDescribeLanguage')?.value || 'zh';
        const detail = document.getElementById('chatDescribeDetail')?.value || 'detailed';
        return '本轮任务是查看对话中的图片并描述或反推提示词，不是生成图片。忽略预设中的自动出图要求，禁止输出 IMAGE 指令。仅根据实际可见图片描述，不编造无法观察的信息；没有可见图片时请用户添加图片；无法读取图片或模型不支持视觉时明确说明。' +
            (language === 'en' ? '提示词用英文。' : '提示词用中文。') +
            (detail === 'concise' ? '输出一段精炼、可直接使用的提示词。' : '输出可直接用于生图的详细提示词，涵盖主体外观、动作、服饰、场景、构图、视角、光线、色彩、材质和风格，避免无关解释。');
    }
    function mount() {
        if (document.getElementById('chatAdvancedBtn')) return;
        const anchor = document.getElementById('reverseSettingsBtn');
        if (!anchor) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'chatAdvancedBtn';
        button.className = 'anima-ctrl reverse-settings-btn';
        button.title = '高级参数';
        button.setAttribute('aria-label', '高级参数');
        button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>';
        button.setAttribute('aria-expanded', 'false');
        anchor.after(button);
        const panel = document.createElement('section');
        panel.id = 'chatAdvancedPanel';
        panel.className = 'generation-options-panel';
        panel.setAttribute('aria-label', '高级参数');
        panel.hidden = true;
        panel.innerHTML = '<div class="chat-advanced-row" id="chatAdvancedSeed"><span>生成种子</span></div>' +
            '<div class="chat-advanced-negative"><label for="extraNegativePrompt">负向提示词（本地生图）</label></div>' +
            '<div class="chat-advanced-row"><span>图片描述 · 当前对话 API</span><label>语言 <select id="chatDescribeLanguage"><option value="zh">中文</option><option value="en">英文</option></select></label><label>详细程度 <select id="chatDescribeDetail"><option value="detailed">详细</option><option value="concise">精简</option></select></label></div>' +
            '<p>添加图片后发送“描述图片”或“反推提示词”即可。请在顶部选择支持看图的 API 模型。</p>';
        document.body.appendChild(panel);
        const positionPanel = () => {
            if (panel.hidden) return;
            GenerationMenuPosition.place(panel, button, {width:520,preferAbove:true,align:'end'});
        };
        new ResizeObserver(positionPanel).observe(panel);
        window.addEventListener('resize', positionPanel);
        window.addEventListener('scroll', positionPanel, true);
        if (!document.body.classList.contains('chat-layout')) {
            const reverse = document.createElement('button');
            reverse.type = 'button';
            reverse.className = 'anima-ctrl';
            reverse.textContent = 'API 图片反推';
            reverse.onclick = () => ReverseImage.open();
            panel.appendChild(reverse);
        }
        for (const id of ['seedToggle', 'seedInput']) {
            const el = document.getElementById(id);
            if (el) panel.querySelector('#chatAdvancedSeed').appendChild(el);
        }
        const negative = document.getElementById('extraNegPanel');
        if (negative) panel.querySelector('.chat-advanced-negative').appendChild(negative);
        for (const id of ['chatDescribeLanguage', 'chatDescribeDetail']) {
            const select = document.getElementById(id);
            try { select.value = localStorage.getItem(id) || select.value; } catch (_) {}
            select.onchange = () => { try { localStorage.setItem(id, select.value); } catch (_) {} };
        }
        button.onclick = () => {
            panel.hidden = !panel.hidden;
            button.setAttribute('aria-expanded', String(!panel.hidden));
            button.classList.toggle('active', !panel.hidden);
            const local = typeof currentEngine === 'undefined' || currentEngine === 'local';
            panel.querySelector('.chat-advanced-negative').hidden = !local;
            positionPanel();
        };
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || event.isComposing) return;
            panel.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            button.classList.remove('active');
        });
        document.addEventListener('click', event => {
            if (event.composedPath().includes(panel) || event.composedPath().includes(button)) return;
            panel.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            button.classList.remove('active');
        }, true);
        window.ChatAssistant?.mountPreferences();
    }
    document.addEventListener('DOMContentLoaded', mount, { once:true });
    return { isDescription, descriptionGuide };
})();
