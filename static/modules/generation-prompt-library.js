/* 两种生成模式共用真实提示词库；仅记录本选择器写入的词。 */
(function () {
    'use strict';
    const selected = new Map();
    const owned = {positive:new Set(), negative:new Set()};
    let frame;
    let view = 'style';
    let applying = false;
    const tokens = text => String(text || '').split(/[,，\n]+/).map(x => x.trim()).filter(Boolean);
    function reconcile(text, previous, entries) {
        const desired = new Map(entries.flatMap(tokens).map(token => [token.toLowerCase(), token]));
        const keep = tokens(text).filter(token => !previous.has(token.toLowerCase()) || desired.has(token.toLowerCase()));
        const present = new Set(keep.map(token => token.toLowerCase()));
        const nextOwned = new Set([...previous].filter(key => desired.has(key) && present.has(key)));
        for (const [key, token] of desired) if (!present.has(key)) { keep.push(token); present.add(key); nextOwned.add(key); }
        return {text:keep.join(', '), owned:nextOwned};
    }
    function sendState() {
        frame?.contentWindow?.postMessage({type:'prompt-library:state', keys:[...selected.keys()]}, location.origin);
    }
    function apply() {
        applying = true;
        for (const [field, id] of [['positive','prompt'], ['negative','extraNegativePrompt']]) {
            const input = document.getElementById(id);
            if (!input) continue;
            const result = reconcile(input.value, owned[field], [...selected.values()].map(item => item[field]));
            owned[field] = result.owned;
            input.value = result.text;
            input.dispatchEvent(new Event('input', {bubbles:true}));
        }
        applying = false;
        if (typeof updatePromptTags === 'function') updatePromptTags();
        if (typeof updatePickerButtonsHighlight === 'function') updatePickerButtonsHighlight();
        sendState();
    }
    document.addEventListener('input', event => {
        if (applying || event.target?.id !== 'prompt') return;
        const present = new Set(tokens(event.target.value).map(token => token.toLowerCase()));
        for (const [key, item] of selected) {
            if (!tokens(item.positive).every(token => present.has(token.toLowerCase()))) selected.delete(key);
        }
        if (typeof updatePickerButtonsHighlight === 'function') updatePickerButtonsHighlight();
        sendState();
    });
    function sendView() {
        frame?.contentWindow?.postMessage({type:'prompt-library:view', view}, location.origin);
        sendState();
    }
    function mount(tab) {
        view = tab;
        if (!frame) {
            frame = document.createElement('iframe');
            frame.id = 'generationPromptLibrary';
            frame.title = '提示词库';
            frame.style.cssText = 'width:100%;height:100%;border:0;display:block;';
            frame.src = '/static/asset-manager.html?picker=prompt';
            frame.addEventListener('load', sendView);
            document.getElementById('promptPickerBody').appendChild(frame);
        }
        frame.hidden = false;
        frame.style.display = 'block';
        sendView();
    }
    window.addEventListener('message', event => {
        if (event.origin !== location.origin || event.source !== frame?.contentWindow) return;
        if (event.data?.type === 'prompt-library:ready') { sendView(); return; }
        if (event.data?.type !== 'prompt-library:toggle') return;
        const {key, item} = event.data;
        if (typeof key !== 'string' || !item || typeof item.positive !== 'string') return;
        if (selected.has(key)) selected.delete(key); else selected.set(key, item);
        apply();
    });
    window.GenerationPromptLibrary = {mount, reconcile, count:() => selected.size};
})();
