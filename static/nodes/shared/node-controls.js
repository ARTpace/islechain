/* 画布节点共享控件（static/nodes/shared/node-controls.js）
 *
 * 背景：generator / msgen / video 三个节点的设置区（provider、模型、分辨率、
 * 比例、质量、数量步进、运行按钮）此前各自手写一遍 innerHTML + 事件绑定。
 * 加一个节点要复制一次，改一处就漏两处。这里把「结构 + 通用绑定」抽出来，
 * 节点只声明字段：
 *
 *   const ui = NodeControls.settings();
 *   ui.append(NodeControls.row([
 *       NodeControls.select(node, { key:'apiProvider', options:providerOptions(node.apiProvider) }),
 *       NodeControls.select(node, { key:'model', options:imageModelOptions(node.model, node.apiProvider) })
 *   ]));
 *   wrap.appendChild(ui.el);
 *
 * 业务联动（例如 generator 的 resolution↔ratio↔自定义宽高）仍写在节点里，
 * 通过 handle 操作：{ el, sync(), setOptions(html), setDisabled(bool) }。
 *
 * 全局工具 tr / scheduleSave / escapeHtml 是 canvas.js 的 function 声明，直接调用。
 */
(() => {
    const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || min));

    /** 节点被拖动时，控件上的指针事件不能穿透到画布 */
    function stop(el) {
        el.onmousedown = e => e.stopPropagation();
        el.onclick = e => e.stopPropagation();
    }

    /** 设置行容器 .gen-settings-row */
    function row(children, opts = {}) {
        const el = document.createElement('div');
        el.className = 'gen-settings-row' + (opts.className ? ' ' + opts.className : '');
        if (opts.hidden) el.style.display = 'none';
        (children || []).forEach(child => child && el.appendChild(child.el || child));
        return el;
    }

    /** 设置区容器 .gen-settings */
    function settings(rows) {
        const el = document.createElement('div');
        el.className = 'gen-settings';
        const api = {
            el,
            append(item) { el.appendChild(item && item.el ? item.el : item); return api; },
            row(children, opts) { return api.append(row(children, opts)); }
        };
        (rows || []).forEach(item => api.append(item));
        return api;
    }

    /**
     * 下拉框：值自动读写 node[key]，带 stopPropagation 与 scheduleSave。
     * @returns {{el: HTMLSelectElement, sync: Function, setOptions: Function, setDisabled: Function}}
     */
    function select(node, opts) {
        const el = document.createElement('select');
        el.className = 'select-lite' + (opts.className ? ' ' + opts.className : '');
        if (opts.style) el.style.cssText = opts.style;
        if (opts.dataField) el.dataset.field = opts.dataField;
        if (opts.title) el.title = opts.title;
        if (opts.ariaLabel) el.setAttribute('aria-label', opts.ariaLabel);
        el.innerHTML = opts.options || '';
        stop(el);
        const api = {
            el,
            sync() {
                const raw = node[opts.key];
                const value = raw == null ? '' : String(raw);
                const has = Array.prototype.some.call(el.options, opt => opt.value === value);
                el.value = has ? value : (opts.fallback != null ? String(opts.fallback) : (el.options[0]?.value ?? ''));
                return el.value;
            },
            setOptions(html) { el.innerHTML = html; return api.sync(); },
            setDisabled(value) { el.disabled = Boolean(value); return api; }
        };
        api.sync();
        el.onchange = e => {
            e.stopPropagation();
            node[opts.key] = el.value;
            if (opts.onChange) opts.onChange(el.value, api);
            scheduleSave();
        };
        return api;
    }

    /**
     * 数量步进器（左右按钮 + 数字框），值写 node[key]。
     * @returns {{el: HTMLElement, sync: Function}}
     */
    function stepper(node, opts = {}) {
        const min = opts.min != null ? opts.min : 1;
        const max = opts.max != null ? opts.max : 8;
        const el = document.createElement('div');
        el.className = 'gen-stepper';
        el.innerHTML = `
            <button class="gen-step-btn" data-step="-1" type="button" title="${escapeHtml(opts.decreaseTitle || '减少')}" aria-label="${escapeHtml(opts.decreaseLabel || '减少数量')}"><i data-lucide="chevron-left" class="w-3.5 h-3.5"></i></button>
            <input class="gen-count-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${clamp(node[opts.key], min, max)}">
            <button class="gen-step-btn" data-step="1" type="button" title="${escapeHtml(opts.increaseTitle || '增加')}" aria-label="${escapeHtml(opts.increaseLabel || '增加数量')}"><i data-lucide="chevron-right" class="w-3.5 h-3.5"></i></button>`;
        stop(el);
        const input = el.querySelector('.gen-count-input');
        const api = {
            el,
            sync() { input.value = String(clamp(node[opts.key], min, max)); return api; }
        };
        api.sync();
        input.oninput = e => {
            node[opts.key] = clamp(e.target.value, min, max);
            if (opts.onChange) opts.onChange(node[opts.key], api);
            scheduleSave();
        };
        input.onblur = () => api.sync();
        el.querySelectorAll('[data-step]').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                node[opts.key] = clamp(Number(node[opts.key] || min) + Number(btn.dataset.step || 0), min, max);
                api.sync();
                if (opts.onChange) opts.onChange(node[opts.key], api);
                scheduleSave();
            };
        });
        return api;
    }

    /**
     * 带标题的数字输入（自定义宽高、自定义比例用）。纯 UI，不绑定 node 字段，
     * 由调用方在 onInput 里同时写多个字段并联动。
     * @returns {{el: HTMLElement, input: HTMLInputElement}}
     */
    function numberField(opts = {}) {
        const el = document.createElement('label');
        el.className = 'field';
        el.innerHTML = `<div class="setting-title">${escapeHtml(opts.title || '')}</div>
            <input class="setting-input ${opts.className || ''}" type="number" min="${opts.min != null ? opts.min : 1}" step="${opts.step != null ? opts.step : 1}" value="${escapeHtml(opts.value == null ? '' : opts.value)}" placeholder="${escapeHtml(opts.placeholder || '')}">`;
        const input = el.querySelector('input');
        if (opts.ariaLabel) input.setAttribute('aria-label', opts.ariaLabel);
        stop(el);
        if (opts.onInput) input.oninput = e => { opts.onInput(input.value, e); };
        if (opts.onBlur) input.onblur = e => { opts.onBlur(input.value, e); };
        return { el, input };
    }

    /** 带标题的容器，用来包下拉等无标题控件（.field + .setting-title） */
    function labeled(title, control, opts = {}) {
        const el = document.createElement('label');
        el.className = 'field' + (opts.className ? ' ' + opts.className : '');
        if (opts.style) el.style.cssText = opts.style;
        el.innerHTML = `<div class="setting-title">${escapeHtml(title)}</div>`;
        el.appendChild(control && control.el ? control.el : control);
        return { el, control };
    }

    /**
     * 开关胶囊组（.setting-check）：点一下翻转 node[key]。
     * opts.onToggle(key, value) 处理互斥等业务；opts.rerender 需要整节点重绘时传入。
     */
    function togglePills(node, specs, opts = {}) {
        const el = document.createElement('div');
        el.className = 'gen-settings-row' + (opts.className ? ' ' + opts.className : '');
        if (opts.wrap !== false) el.style.flexWrap = 'wrap';
        (specs || []).forEach(spec => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'setting-check' + (node[spec.key] ? ' active' : '');
            btn.dataset.toggle = spec.key;
            btn.innerHTML = `<span class="check-dot"></span>${escapeHtml(spec.label || '')}`;
            stop(btn);
            btn.onclick = e => {
                e.stopPropagation();
                node[spec.key] = !node[spec.key];
                if (opts.onToggle) opts.onToggle(spec.key, node[spec.key], btn);
                scheduleSave();
                if (opts.rerender) opts.rerender();
                else btn.classList.toggle('active', Boolean(node[spec.key]));
            };
            el.appendChild(btn);
        });
        return { el };
    }

    /** 次要按钮（整行用），例如「读取图片尺寸」 */
    function ghostButton(opts = {}) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'secondary-btn ' + (opts.className || '');
        el.style.cssText = 'height:32px;align-self:flex-end;padding:0 10px;font-size:11px';
        el.textContent = opts.label || '';
        stop(el);
        if (opts.onClick) el.onclick = e => { e.stopPropagation(); opts.onClick(e); };
        return { el };
    }

    /**
     * 运行按钮行：图标 + 文案 + 运行中态。
     * @returns {{el: HTMLElement, setRunning: Function, button: HTMLButtonElement}}
     */
    function runBar(node, opts = {}) {
        const label = typeof opts.label === 'function' ? opts.label : () => (opts.label || '生成');
        const runningLabel = typeof opts.runningLabel === 'function' ? opts.runningLabel : () => (opts.runningLabelText || label());
        const el = document.createElement('div');
        el.className = opts.className || 'gen-run-row';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gen-btn';
        const api = {
            el,
            button,
            setRunning(running) {
                button.classList.toggle('running', Boolean(running));
                button.disabled = Boolean(running);
                button.innerHTML = `<i data-lucide="${escapeHtml(opts.icon || 'zap')}" class="w-4 h-4"></i>${escapeHtml(running ? runningLabel() : label())}`;
                refreshIcons();
                return api;
            }
        };
        api.setRunning(Boolean(node && node.running));
        button.onclick = e => {
            e.stopPropagation();
            if (opts.onRun) opts.onRun(api);
        };
        el.appendChild(button);
        if (opts.extra) {
            const extra = document.createElement('span');
            extra.className = 'gen-run-extra';
            extra.innerHTML = typeof opts.extra === 'function' ? opts.extra() : opts.extra;
            el.appendChild(extra);
        }
        return api;
    }

    window.NodeControls = { stop, row, settings, select, stepper, numberField, labeled, togglePills, ghostButton, runBar };
})();
