/**
 * 提示词标签系统（模块化版）
 * 渲染 + 拖拽排序 + 悬浮预览 + 预设 i18n
 * 
 * 使用方法：
 *   PromptTags.init();           // 启动（加载 i18n + 注入 CSS）
 *   PromptTags.update();         // 刷新标签（替代原 updatePromptTags）
 *   PromptTags.toggleLang();     // 中英文切换
 *   PromptTags.toggleExpand();   // 展开/收起
 *   PromptTags.removeTag(tag);   // 删除单个标签
 */
const PromptTags = (function() {

    // ─────────────────────────────────────────────
    //  常量
    // ─────────────────────────────────────────────
    const TAG_SPLITTER = /[，,、；;]/;
    const PREVIEW_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">' +
        '<rect width="180" height="180" fill="#1f2235"/>' +
        '<g fill="none" stroke="#3b3f5a" stroke-width="1.5">' +
        '<circle cx="90" cy="75" r="22"/>' +
        '<path d="M55 130 Q90 100 125 130"/>' +
        '</g>' +
        '<text x="90" y="160" fill="#525a78" font-family="sans-serif" font-size="11" text-anchor="middle">无缩略图</text>' +
        '</svg>'
    );

    // ─────────────────────────────────────────────
    //  状态
    // ─────────────────────────────────────────────
    let PRESET_I18N_MAP = null;
    let PRESET_NAME_TO_ID = null;
    let PRESET_CN_TO_EN = null;
    let __presetPromptSet = null;
    let promptTagsExpanded = false;
    let _dragState = null;
    let animaTagPreviewEl = null;
    let _previewHovered = false;
    let _hidePreviewTimer = null;

    // ─────────────────────────────────────────────
    //  工具函数
    // ─────────────────────────────────────────────
    function hasChinese(s) {
        return /[\u4e00-\u9fa5]/.test(s);
    }
    function normalizePresetKey(token) {
        return token.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }

    // ─────────────────────────────────────────────
    //  预设 i18n
    // ─────────────────────────────────────────────
    function loadI18n() {
        if (PRESET_I18N_MAP !== null && PRESET_NAME_TO_ID !== null && PRESET_CN_TO_EN !== null) {
            return Promise.resolve(PRESET_I18N_MAP);
        }
        return Promise.all([
            fetch('/api/preset-i18n').then(r => r.json()),
            fetch('/api/preset-bidir').then(r => r.json())
        ]).then(([i18n, bidir]) => {
            PRESET_I18N_MAP = i18n || {};
            PRESET_NAME_TO_ID = (bidir && bidir.name_to_id) || {};
            const cn2en = {};
            Object.keys(PRESET_I18N_MAP).forEach(k => {
                const cn = PRESET_I18N_MAP[k];
                if (cn && !cn2en[cn]) cn2en[cn] = k;
            });
            if (bidir && bidir.id_to_name) {
                Object.keys(bidir.id_to_name).forEach(id => {
                    const cn = bidir.id_to_name[id];
                    if (cn && !cn2en[cn]) cn2en[cn] = id;
                });
            }
            PRESET_CN_TO_EN = cn2en;
            return PRESET_I18N_MAP;
        }).catch(e => {
            PRESET_I18N_MAP = {}; PRESET_NAME_TO_ID = {}; PRESET_CN_TO_EN = {};
            return PRESET_I18N_MAP;
        });
    }

    function i18nText(token) {
        if (!PRESET_I18N_MAP) return null;
        return PRESET_I18N_MAP[normalizePresetKey(token)] || null;
    }

    function translateToCn(prompt) {
        if (!prompt) return '';
        const i18n = PRESET_I18N_MAP || {};
        return prompt.split(TAG_SPLITTER).map(p => p.trim()).filter(Boolean).map(token => {
            if (hasChinese(token)) return token;
            const key = normalizePresetKey(token);
            return i18n[key] || token;
        }).join(', ');
    }

    function translateToEn(prompt) {
        if (!prompt) return '';
        const cn2en = PRESET_CN_TO_EN || {};
        return prompt.split(TAG_SPLITTER).map(p => p.trim()).filter(Boolean).map(token => {
            if (hasChinese(token)) {
                if (PRESET_NAME_TO_ID && PRESET_NAME_TO_ID[token]) return PRESET_NAME_TO_ID[token];
                if (cn2en[token]) return cn2en[token];
            }
            return token;
        }).join(', ');
    }

    function resolveDisplay(token) {
        const mode = window.PROMPT_TAGS_LANG_MODE || 'cn';
        if (mode === 'en') {
            if (hasChinese(token)) {
                if (PRESET_NAME_TO_ID && PRESET_NAME_TO_ID[token]) return { display: PRESET_NAME_TO_ID[token], original: token };
                return { display: token, original: null };
            }
            return { display: token, original: null };
        }
        if (hasChinese(token)) return { display: token, original: null };
        const cn = i18nText(token);
        if (cn) return { display: cn, original: token };
        if (typeof presetPickerData !== 'undefined' && presetPickerData.categories) {
            for (const cat of presetPickerData.categories) {
                if (cat.subcategories) {
                    for (const sub of cat.subcategories) {
                        if (sub.presets) {
                            for (const p of sub.presets) {
                                if (p.prompt && p.prompt.trim() === token.trim()) {
                                    if (p.name && hasChinese(p.name)) return { display: p.name, original: token };
                                }
                            }
                        }
                    }
                }
            }
        }
        return { display: token, original: null };
    }

    // ─────────────────────────────────────────────
    //  预设 Prompt Set（懒加载单例）
    // ─────────────────────────────────────────────
    function getPresetPromptSet() {
        if (__presetPromptSet) return __presetPromptSet;
        const map = new Map();
        try {
            if (typeof presetPickerData !== 'undefined' && presetPickerData && Array.isArray(presetPickerData.categories)) {
                presetPickerData.categories.forEach(cat => {
                    if (!cat || !Array.isArray(cat.subcategories)) return;
                    cat.subcategories.forEach(sub => {
                        if (!sub || !Array.isArray(sub.presets)) return;
                        sub.presets.forEach(p => {
                            if (p && p.prompt && p.prompt.includes(',')) {
                                const k = p.prompt.trim();
                                if (k && !map.has(k)) map.set(k, p.id);
                            }
                        });
                    });
                });
            }
        } catch (_) {}
        __presetPromptSet = map;
        return map;
    }

    function mergePresets(tokens) {
        const presetPromptSet = getPresetPromptSet();
        const merged = [];
        let i = 0;
        while (i < tokens.length) {
            let matched = false;
            for (let len = Math.min(8, tokens.length - i); len >= 2; len--) {
                const candidate = tokens.slice(i, i + len).join(', ');
                if (presetPromptSet.has(candidate)) { merged.push(candidate); i += len; matched = true; break; }
            }
            if (!matched) { merged.push(tokens[i]); i++; }
        }
        return merged;
    }

    // ─────────────────────────────────────────────
    //  注入 CSS
    // ─────────────────────────────────────────────
    function injectStyles() {
        if (!document.getElementById('pt-drag-css')) {
            const s = document.createElement('style');
            s.id = 'pt-drag-css';
            s.textContent =
                '.prompt-tag-dragging{opacity:0.25!important;transform:scale(0.92)!important}' +
                '.prompt-tag-drop-left{box-shadow:-3px 0 0 0 #a855f7!important}' +
                '.prompt-tag-drop-right{box-shadow:3px 0 0 0 #a855f7!important}' +
                '@keyframes tagDropBounce{0%{transform:scale(0.9);opacity:0.5}50%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}' +
                '.prompt-tag-just-dropped{animation:tagDropBounce 0.3s cubic-bezier(0.2,1,0.3,1)}';
            document.head.appendChild(s);
        }
        if (!document.getElementById('pt-slider-css')) {
            const s = document.createElement('style');
            s.id = 'pt-slider-css';
            s.textContent =
                '#animaTagPreview input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:linear-gradient(to right,rgba(255,140,50,0.7) 0%,rgba(255,140,50,0.7) var(--lora-preview-pct,50%),rgba(255,140,50,0.15) var(--lora-preview-pct,50%),rgba(255,140,50,0.15) 100%)}' +
                '#animaTagPreview input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:linear-gradient(135deg,#ff8c32,#ff6b1a);box-shadow:0 2px 8px rgba(255,100,20,0.5),0 0 0 2px rgba(255,140,50,0.3);margin-top:-5px;transition:transform 0.15s}' +
                '#animaTagPreview input[type=range]::-webkit-slider-thumb:hover{transform:scale(1.15)}' +
                '#animaTagPreview input[type=range]::-moz-range-track{height:6px;border-radius:999px;background:rgba(255,140,50,0.15)}' +
                '#animaTagPreview input[type=range]::-moz-range-progress{height:6px;border-radius:999px;background:rgba(255,140,50,0.7)}' +
                '#animaTagPreview input[type=range]::-moz-range-thumb{width:16px;height:16px;border-radius:50%;border:none;background:linear-gradient(135deg,#ff8c32,#ff6b1a);box-shadow:0 2px 8px rgba(255,100,20,0.5),0 0 0 2px rgba(255,140,50,0.3)}';
            document.head.appendChild(s);
        }
    }

    // ─────────────────────────────────────────────
    //  LoRA 相关辅助
    // ─────────────────────────────────────────────
    function isLoraFallbackTag(tagLower) {
        if (!tagLower || !loraState || !loraState.loraMap) return false;
        for (const key of Object.keys(loraState.loraMap)) {
            const entry = loraState.loraMap[key];
            if (!entry) continue;
            const tw = entry.triggerWords || [];
            if (tw.some(w => String(w).toLowerCase().replace(/^@/, '') === tagLower)) return true;
            const dn = (entry.displayName || key.split('/').pop().replace(/\.safetensors$/i, '')).toLowerCase();
            if (dn === tagLower) return true;
        }
        return false;
    }

    function findActiveLoraByTrigger(triggerName) {
        if (!triggerName || !loraState) return null;
        const lower = triggerName.toLowerCase().replace(/^@/, '');
        if (loraState.active) {
            for (let i = 0; i < loraState.active.length; i++) {
                const a = loraState.active[i];
                if (!a || !a.name) continue;
                const meta = loraState.loraMap && loraState.loraMap[a.name];
                if (!meta) continue;
                const tw = meta.triggerWords || [];
                if (tw.some(w => String(w).toLowerCase().replace(/^@/, '') === lower)) return { index: i, entry: a, meta };
                const dn = (meta.displayName || '').toLowerCase();
                const fn = a.name.split('/').pop().replace(/\.safetensors$/i, '').toLowerCase();
                if (dn === lower || fn === lower) return { index: i, entry: a, meta };
            }
        }
        if (loraState.loraMap) {
            for (const key of Object.keys(loraState.loraMap)) {
                const entry = loraState.loraMap[key];
                if (!entry) continue;
                const tw = entry.triggerWords || [];
                if (tw.some(w => String(w).toLowerCase().replace(/^@/, '') === lower)) return { index: -1, entry: { name: key, strength: 0.8 }, meta: entry };
                const dn = (entry.displayName || '').toLowerCase();
                const fn = key.split('/').pop().replace(/\.safetensors$/i, '').toLowerCase();
                if (dn === lower || fn === lower) return { index: -1, entry: { name: key, strength: 0.8 }, meta: entry };
            }
        }
        return null;
    }

    // ─────────────────────────────────────────────
    //  悬浮预览
    // ─────────────────────────────────────────────
    function buildThumbUrl(type, name) {
        if (type === 'artist') {
            if (typeof ANIMA_ARTIST_DB === 'undefined' || !ANIMA_ARTIST_DB.length) return '';
            const item = ANIMA_ARTIST_DB.find(a => a.name && a.name.toLowerCase() === name.toLowerCase());
            return (item && item.image_url) ? item.image_url : '';
        }
        if (type === 'char') {
            if (typeof ANIMA_CHAR_DB === 'undefined' || !ANIMA_CHAR_DB.length) return '';
            const item = ANIMA_CHAR_DB.find(c => c.name && c.name.toLowerCase() === name.toLowerCase());
            if (!item) return '';
            if (item.thumb_url) return item.thumb_url;
            const raw = item.trigger || (item.copyright ? item.name + ', ' + item.copyright : item.name);
            const encoded = encodeURIComponent(raw).replace(/%28/g, '(').replace(/%29/g, ')');
            return 'https://blobs.animadex.net/Outputs/thumbs/' + encoded + '.webp';
        }
        if (type === 'lora') {
            const lowerName = name.toLowerCase().replace(/^@/, '');
            if (loraState && loraState.triggerWordMap && loraState.triggerWordMap[lowerName]) {
                return loraState.triggerWordMap[lowerName].preview || '';
            }
            if (loraState && loraState.loraMap) {
                for (const key of Object.keys(loraState.loraMap)) {
                    const entry = loraState.loraMap[key];
                    if (!entry) continue;
                    const tw = entry.triggerWords || [];
                    if (tw.some(w => String(w).toLowerCase().replace(/^@/, '') === lowerName)) return entry.preview || '';
                    const dn = (entry.displayName || '').toLowerCase();
                    const fn = key.split('/').pop().replace(/\.safetensors$/i, '').toLowerCase();
                    if (dn === lowerName || fn === lowerName) return entry.preview || '';
                }
            }
            return '';
        }
        return '';
    }

    function getPreviewEl() {
        if (animaTagPreviewEl) return animaTagPreviewEl;
        const el = document.createElement('div');
        el.id = 'animaTagPreview';
        el.style.cssText = 'position:absolute;z-index:9999;opacity:0;transform:translate(-50%,8px);transition:opacity 0.15s;background:rgba(15,20,35,0.92);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:6px;box-shadow:0 10px 30px rgba(0,0,0,0.5);';
        el.onmouseenter = () => { _previewHovered = true; cancelHidePreview(); };
        el.onmouseleave = () => { _previewHovered = false; hidePreview(); };
        document.body.appendChild(el);
        animaTagPreviewEl = el;
        return el;
    }

    function cancelHidePreview() {
        clearTimeout(_hidePreviewTimer);
        _hidePreviewTimer = null;
    }

    function showPreview(tagEl) {
        _previewHovered = false;
        const type = tagEl.dataset.tagType;
        const name = tagEl.dataset.tagName;
        if (!type || !name) return;
        const url = buildThumbUrl(type, name);
        const el = getPreviewEl();
        const label = type === 'artist' ? '画师' : type === 'lora' ? 'LoRA' : '角色';
        const safeName = name.replace(/</g, '&lt;');
        const imgHeight = 200;
        const imgWidth = Math.round(imgHeight * 2 / 3);

        let strengthHtml = '';
        if (type === 'lora') {
            const found = findActiveLoraByTrigger(name);
            if (found) {
                const s = found.entry.strength || 0.8;
                const pct = ((s - 0.2) / 1.0 * 100).toFixed(1);
                const idx = found.index;
                strengthHtml =
                    '<div style="padding:6px 4px 2px;max-width:' + imgWidth + 'px;" onclick="event.stopPropagation()">' +
                    '<div style="display:flex;align-items:center;gap:6px;">' +
                    '<span style="font-size:9px;font-weight:700;color:#ff8c32;flex-shrink:0;">STR</span>' +
                    '<div style="flex:1;position:relative;height:20px;display:flex;align-items:center;">' +
                    '<input type="range" min="0.2" max="1.2" step="0.05" value="' + s + '"' +
                    ' style="width:100%;height:6px;appearance:none;-webkit-appearance:none;background:transparent;cursor:pointer;--lora-preview-pct:' + pct + '%;"' +
                    ' data-lora-name="' + (found.entry.name || '').replace(/"/g, '&quot;') + '"' +
                    ' oninput="PromptTags.onLoraStrength(this,' + idx + ')"' +
                    '/>' +
                    '</div>' +
                    '<span class="lora-preview-strength-val" style="font-size:10px;font-weight:900;color:#e0e7ef;background:rgba(255,140,50,0.18);padding:2px 6px;border-radius:6px;min-width:32px;text-align:center;flex-shrink:0;">' + s.toFixed(2) + '</span>' +
                    '</div>';
            }
        }

        el.innerHTML =
            '<div style="font-size:10px;font-weight:700;color:' + (type === 'artist' ? '#00b4d8' : type === 'lora' ? '#ff8c32' : '#a855f7') + ';text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;padding:0 4px;">' + label + '</div>' +
            '<div style="position:relative;width:' + imgWidth + 'px;height:' + imgHeight + 'px;border-radius:8px;overflow:hidden;background:#1f2235;">' +
            (url
                ? '<img src="' + url + '" style="width:100%;height:100%;object-fit:contain;display:block;" onerror="this.onerror=null;this.src=\'' + PREVIEW_SVG + '\';this.style.objectFit=\'contain\';this.style.opacity=\'0.55\';"/>'
                : '<img src="' + PREVIEW_SVG + '" style="width:100%;height:100%;object-fit:contain;opacity:0.7;display:block;"/>') +
            '</div>' +
            '<div style="font-size:12px;font-weight:600;color:#e0e7ef;padding:6px 4px 2px;text-align:center;max-width:' + imgWidth + 'px;word-break:break-word;">' + safeName + '</div>' +
            strengthHtml;

        const rect = tagEl.getBoundingClientRect();
        el.style.left = (rect.left + rect.width / 2 + window.scrollX) + 'px';
        el.style.top = (rect.bottom + window.scrollY) + 'px';
        el.style.opacity = '1';
    }

    function hidePreview() {
        if (_previewHovered) return;
        clearTimeout(_hidePreviewTimer);
        _hidePreviewTimer = setTimeout(() => {
            if (_previewHovered) return;
            const el = animaTagPreviewEl || document.getElementById('animaTagPreview');
            if (el) el.style.opacity = '0';
        }, 150);
    }

    function bindHover() {
        const tags = document.querySelectorAll('.prompt-tag-anima');
        tags.forEach(t => {
            t.onmouseenter = () => { cancelHidePreview(); showPreview(t); };
            t.onmouseleave = hidePreview;
        });
    }

    // ─────────────────────────────────────────────
    //  LoRA 强度滑块
    // ─────────────────────────────────────────────
    function onLoraStrength(inputEl, idx) {
        const v = parseFloat(inputEl.value);
        const p = ((v - 0.2) / 1.0 * 100).toFixed(1);
        inputEl.style.setProperty('--lora-preview-pct', p + '%');
        const valEl = inputEl.closest('#animaTagPreview').querySelector('.lora-preview-strength-val');
        if (valEl) valEl.textContent = v.toFixed(2);
        if (idx === -1) {
            const name = inputEl.dataset.loraName;
            if (name && loraState && loraState.active) {
                loraState.active.push({ name, strength: v });
                inputEl.dataset.loraPreviewIdx = loraState.active.length - 1;
            }
        } else if (loraState && loraState.active && loraState.active[idx]) {
            loraState.active[idx].strength = v;
        }
    }

    // ─────────────────────────────────────────────
    //  拖放排序
    // ─────────────────────────────────────────────
    function clearDragVisuals() {
        document.querySelectorAll('.prompt-tag-dragging,.prompt-tag-drop-left,.prompt-tag-drop-right').forEach(el => {
            el.classList.remove('prompt-tag-dragging', 'prompt-tag-drop-left', 'prompt-tag-drop-right');
        });
    }

    function dragStart(e) {
        const el = e.target.closest('[data-idx]');
        if (!el) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
        const fromIdx = parseInt(el.dataset.idx);
        const promptInput = document.getElementById('prompt');
        if (!promptInput) return;
        const tokens = promptInput.value.split(TAG_SPLITTER).map(p => p.trim()).filter(p => p);
        const tags = mergePresets(tokens);
        _dragState = { fromIdx, tags, promptOriginal: promptInput.value, lastOverIdx: -1, lastSide: '' };
        el.classList.add('prompt-tag-dragging');
    }

    function dragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!_dragState) return;
        const allTags = document.querySelectorAll('#promptTags [data-idx]');
        if (!allTags.length) return;
        let closestEl = null, closestDist = Infinity;
        allTags.forEach(tag => {
            const rect = tag.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dist = Math.abs(e.clientX - cx) + Math.abs(e.clientY - cy) * 0.5;
            if (dist < closestDist) { closestDist = dist; closestEl = tag; }
        });
        if (!closestEl || closestDist > 200) return;
        const overIdx = parseInt(closestEl.dataset.idx);
        const rect = closestEl.getBoundingClientRect();
        const side = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
        if (overIdx === _dragState.lastOverIdx && side === _dragState.lastSide) return;
        _dragState.lastOverIdx = overIdx;
        _dragState.lastSide = side;
        document.querySelectorAll('.prompt-tag-drop-left,.prompt-tag-drop-right').forEach(s => s.classList.remove('prompt-tag-drop-left', 'prompt-tag-drop-right'));
        if (overIdx !== _dragState.fromIdx) {
            closestEl.classList.add(side === 'left' ? 'prompt-tag-drop-left' : 'prompt-tag-drop-right');
        }
    }

    function drop(e) {
        e.preventDefault();
        if (!_dragState) return;
        const allTags = document.querySelectorAll('#promptTags [data-idx]');
        if (!allTags.length) return;
        let closestEl = null, closestDist = Infinity;
        allTags.forEach(tag => {
            const rect = tag.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dist = Math.abs(e.clientX - cx) + Math.abs(e.clientY - cy) * 0.5;
            if (dist < closestDist) { closestDist = dist; closestEl = tag; }
        });
        if (!closestEl) return;
        const toIdx = parseInt(closestEl.dataset.idx);
        const promptInput = document.getElementById('prompt');
        if (!promptInput) return;
        const tags = [..._dragState.tags];
        const [moved] = tags.splice(_dragState.fromIdx, 1);
        const rect = closestEl.getBoundingClientRect();
        const insertIdx = e.clientX < rect.left + rect.width / 2 ? toIdx : toIdx + 1;
        const adjustedIdx = _dragState.fromIdx < insertIdx ? insertIdx - 1 : insertIdx;
        tags.splice(adjustedIdx, 0, moved);
        promptInput.value = tags.join(', ');
        const droppedIdx = adjustedIdx;
        _dragState = null;
        clearDragVisuals();
        update();
        requestAnimationFrame(() => {
            const dropped = document.querySelector('[data-idx="' + droppedIdx + '"]');
            if (dropped) {
                dropped.classList.add('prompt-tag-just-dropped');
                dropped.addEventListener('animationend', () => dropped.classList.remove('prompt-tag-just-dropped'), { once: true });
            }
        });
    }

    function dragEnd(e) {
        if (_dragState) {
            const promptInput = document.getElementById('prompt');
            if (promptInput) {
                promptInput.value = _dragState.promptOriginal;
                update();
            }
        }
        clearDragVisuals();
        _dragState = null;
    }

    // ─────────────────────────────────────────────
    //  标签操作
    // ─────────────────────────────────────────────
    function removeTag(tag) {
        const promptInput = document.getElementById('prompt');
        if (!promptInput) return;
        let raw = promptInput.value;
        if (raw.includes(tag)) raw = raw.replace(tag, '');
        raw = raw.split(TAG_SPLITTER).map(p => p.trim()).filter(p => p).join(', ');
        promptInput.value = raw;
        hidePreview();
        if (typeof syncPickerStatesFromPrompt === 'function') syncPickerStatesFromPrompt();
        update();
    }

    function toggleExpand() {
        const tags = document.getElementById('promptTags');
        const text = document.getElementById('promptTagsToggleText');
        const icon = document.getElementById('promptTagsToggleIcon');
        if (!tags) return;
        promptTagsExpanded = !promptTagsExpanded;
        tags.style.maxHeight = promptTagsExpanded ? '200px' : '80px';
        if (text) text.textContent = promptTagsExpanded ? '收起' : '展开';
        if (icon) icon.style.transform = promptTagsExpanded ? 'rotate(180deg)' : '';
    }

    function toggleLang() {
        window.PROMPT_TAGS_LANG_MODE = (window.PROMPT_TAGS_LANG_MODE || 'cn') === 'en' ? 'cn' : 'en';
        update();
    }

    // ─────────────────────────────────────────────
    //  核心：更新标签
    // ─────────────────────────────────────────────
    function update() {
        const promptInput = document.getElementById('prompt');
        const tagsContainer = document.getElementById('promptTags');
        if (!promptInput || !tagsContainer) return;

        // 翻译按钮状态
        const tBtn = document.getElementById('translateBtn');
        if (tBtn) tBtn.setAttribute('data-lang', /[\u4e00-\u9fa5]/.test(promptInput.value) ? 'cn' : 'en');

        // 清空/翻译按钮可见性
        const hasText = !!promptInput.value.trim();
        const clearBtn = document.getElementById('clearPromptBtn');
        if (clearBtn) clearBtn.style.display = hasText ? 'flex' : 'none';
        if (tBtn) tBtn.style.display = hasText ? 'inline-flex' : 'none';

        // i18n 懒加载保护
        if (PRESET_I18N_MAP === null) {
            loadI18n().then(() => update());
            return;
        }

        // 拆 token + 合并多词预设
        const raw = promptInput.value;
        const simpleTokens = raw.split(TAG_SPLITTER).map(p => p.trim()).filter(p => p);
        const parts = mergePresets(simpleTokens);
        const filteredParts = parts.filter(p => p && p.trim());

        // 角色名称集合
        const charNames = new Set();
        if (typeof ANIMA_CHAR_DB !== 'undefined' && ANIMA_CHAR_DB && ANIMA_CHAR_DB.length > 0) {
            ANIMA_CHAR_DB.forEach(c => charNames.add(c.name.toLowerCase()));
        }

        // 渲染 HTML
        let html = '';
        filteredParts.forEach((part, idx) => {
            const safePart = part.replace(/'/g, "\\'");
            const lowerPart = part.toLowerCase();
            const dd = 'draggable="true" data-idx="' + idx + '" ondragstart="PromptTags.dragStart(event)" ondragover="PromptTags.dragOver(event)" ondrop="PromptTags.drop(event)" ondragend="PromptTags.dragEnd(event)"';

            if (part.startsWith('@') || part.startsWith('by ')) {
                const name = part.replace(/^@/, '').replace(/^by /, '');
                const nameLower = name.toLowerCase();
                const isKnownArtist = (typeof ANIMA_ARTIST_DB !== 'undefined' && ANIMA_ARTIST_DB && ANIMA_ARTIST_DB.length > 0)
                    ? ANIMA_ARTIST_DB.some(a => (a.name || '').toLowerCase() === nameLower) : false;
                if (isKnownArtist) {
                    html += '<span class="prompt-tag-anima prompt-tag-drag" ' + dd + ' data-tag-type="artist" data-tag-name="' + name.replace(/"/g, '&quot;') + '" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:rgba(0,180,216,0.3);color:#fff;border:1px solid rgba(0,180,216,0.4);cursor:grab;">@' + name + '<button onclick="event.stopPropagation();PromptTags.removeTag(\'' + safePart + '\')" style="margin-left:2px;background:none;border:none;color:inherit;cursor:pointer;padding:0;font-size:14px;line-height:1;opacity:0.7;">&times;</button></span>';
                } else {
                    html += '<span class="prompt-tag-anima prompt-tag-lora prompt-tag-drag" ' + dd + ' data-tag-type="lora" data-tag-name="' + name.replace(/"/g, '&quot;') + '" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:rgba(255,140,50,0.3);color:#fff;border:1px solid rgba(255,140,50,0.4);cursor:grab;">' + part + '<button onclick="event.stopPropagation();PromptTags.removeTag(\'' + safePart + '\')" style="margin-left:2px;background:none;border:none;color:inherit;cursor:pointer;padding:0;font-size:14px;line-height:1;opacity:0.7;">&times;</button></span>';
                }
            } else if (charNames.has(lowerPart)) {
                html += '<span class="prompt-tag-anima prompt-tag-drag" ' + dd + ' data-tag-type="char" data-tag-name="' + part.replace(/"/g, '&quot;') + '" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:rgba(168,85,247,0.3);color:#fff;border:1px solid rgba(168,85,247,0.4);cursor:grab;">' + part + '<button onclick="event.stopPropagation();PromptTags.removeTag(\'' + safePart + '\')" style="margin-left:2px;background:none;border:none;color:inherit;cursor:pointer;padding:0;font-size:14px;line-height:1;opacity:0.7;">&times;</button></span>';
            } else if (isLoraFallbackTag(lowerPart)) {
                html += '<span class="prompt-tag-anima prompt-tag-lora prompt-tag-drag" ' + dd + ' data-tag-type="lora" data-tag-name="' + part.replace(/"/g, '&quot;') + '" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:rgba(255,140,50,0.3);color:#fff;border:1px solid rgba(255,140,50,0.4);cursor:grab;">' + part + '<button onclick="event.stopPropagation();PromptTags.removeTag(\'' + safePart + '\')" style="margin-left:2px;background:none;border:none;color:inherit;cursor:pointer;padding:0;font-size:14px;line-height:1;opacity:0.7;">&times;</button></span>';
            } else {
                const { display, original } = resolveDisplay(part);
                const safeDisplay = display.replace(/</g, '&lt;');
                const titleHtml = original ? (original.replace(/</g, '&lt;') + ' / ' + display) : part.replace(/</g, '&lt;');
                const color = original ? '#e0e7ef' : (hasChinese(part) ? '#e0e7ef' : '#9aa3b2');
                html += '<span title="' + titleHtml + '" class="prompt-tag-drag" ' + dd + ' style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:rgba(255,255,255,0.1);color:' + color + ';border:1px solid rgba(255,255,255,0.15);cursor:grab;">' +
                    '<span>' + safeDisplay + '</span>' +
                    '<button onclick="PromptTags.removeTag(\'' + safePart + '\')" style="margin-left:2px;background:none;border:none;color:inherit;cursor:pointer;padding:0;font-size:14px;line-height:1;opacity:0.7;">&times;</button>' +
                    '</span>';
            }
        });

        tagsContainer.innerHTML = html;

        // 控制可见性和展开按钮
        const tagsWrap = document.getElementById('promptTagsWrap');
        const toggleBtn = document.getElementById('promptTagsToggle');
        if (tagsWrap) {
            const hasTags = !!html;
            tagsWrap.style.display = hasTags ? '' : 'none';
            const tagCount = filteredParts.length;
            if (toggleBtn) toggleBtn.style.display = tagCount > 5 ? '' : 'none';
            promptTagsExpanded = false;
            tagsContainer.style.maxHeight = '80px';
            const toggleText = document.getElementById('promptTagsToggleText');
            const toggleIcon = document.getElementById('promptTagsToggleIcon');
            if (toggleText) toggleText.textContent = '展开';
            if (toggleIcon) toggleIcon.style.transform = '';
        }
        bindHover();
    }

    // ─────────────────────────────────────────────
    //  初始化
    // ─────────────────────────────────────────────
    function init() {
        injectStyles();
        // 懒加载 i18n
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', loadI18n);
        } else {
            loadI18n();
        }
    }

    // ─────────────────────────────────────────────
    //  公开 API
    // ─────────────────────────────────────────────
    return {
        init,
        update,
        loadI18n,
        toggleLang,
        toggleExpand,
        removeTag,
        translateToCn,
        translateToEn,
        // 拖放事件（暴露到 window 供内联事件处理器调用）
        dragStart,
        dragOver,
        drop,
        dragEnd,
        // 悬浮预览 + 强度滑块
        onLoraStrength,
        showPreview,
        hidePreview,
        cancelHidePreview,
        // 内部状态 getter（外部代码兼容用）
        i18nMap: () => PRESET_I18N_MAP,
        nameToId: () => PRESET_NAME_TO_ID,
        cnToEn: () => PRESET_CN_TO_EN
    };
})();
