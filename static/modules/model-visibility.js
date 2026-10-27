// ponytail: 显示偏好保存在当前浏览器，复用工作流元数据，不改变模型文件或加载状态。
(function () {
    const KEY = 'comfy_hidden_models';
    const EVENT = 'comfy-model-visibility-change';
    const editModels = {
        klein: 'FLUX Klein', qwen: 'Qwen Edit', qwen21: 'Qwen 2.1',
        moss: 'MOSS 重绘', boogu: 'Boogu Edit', krea2: 'Krea2 Edit',
    };
    function hidden() {
        try {
            const value = JSON.parse(localStorage.getItem(KEY) || '[]');
            return new Set(Array.isArray(value) ? value : []);
        } catch (_) { return new Set(); }
    }
    function isVisible(key) { return !hidden().has(key); }
    function setVisible(key, visible) {
        const values = hidden();
        if (visible) values.delete(key); else values.add(key);
        localStorage.setItem(KEY, JSON.stringify([...values]));
        window.dispatchEvent(new Event(EVENT));
    }
    function subscribe(callback) {
        window.addEventListener(EVENT, callback);
        window.addEventListener('storage', event => {
            if (event.key === KEY || event.key === null) callback();
        });
    }
    async function mount(container) {
        container.textContent = '加载模型列表…';
        try {
            const response = await fetch('/api/workflows/builtin');
            if (!response.ok) throw new Error('加载模型列表失败');
            const data = await response.json();
            container.textContent = '';
            const wide = container.id === 'settings-comfy-models-grid';
            if (!wide) {
                const hint = document.createElement('div');
                hint.textContent = '用右侧开关控制是否出现在模型菜单。';
                hint.style.cssText = 'color:var(--muted);line-height:1.6;margin-bottom:10px;';
                container.appendChild(hint);
            }
            const textModels = new Map();
            for (const model of data.workflows || []) {
                if (model.has_unet && model.name.startsWith('text2image/')) {
                    textModels.set('text:' + model.title, model.title);
                }
            }
            const groups = [
                ['文生图', [...textModels]],
                ['图生图', Object.entries(editModels).map(([key, label]) => ['edit:' + key, label])],
            ];
            for (const [heading, models] of groups) {
                const title = document.createElement('div');
                title.textContent = heading;
                title.style.cssText = wide
                    ? 'grid-column:1 / -1;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-top:4px;'
                    : 'font-weight:700;margin:10px 0 6px;';
                container.appendChild(title);
                for (const [key, name] of models) {
                    const on = isVisible(key);
                    const card = document.createElement('div');
                    card.style.cssText = wide
                        ? 'display:flex;align-items:center;gap:12px;min-height:112px;padding:16px 18px;border:1px solid var(--border,var(--ui-line,#e7e5de));border-radius:16px;background:color-mix(in srgb, var(--text, #111) 5%, var(--sidebar-bg, var(--ui-panel, #fbfaf9)));' + (on ? '' : 'opacity:.5;')
                        : 'display:flex;align-items:center;gap:10px;min-height:58px;margin:6px 0;padding:10px 12px;border:1px solid var(--ui-line,#e7e5de);border-radius:14px;background:var(--ui-panel,#fbfaf9);' + (on ? '' : 'opacity:.5;');
                    const mark = document.createElement('span');
                    mark.textContent = 'C';
                    mark.style.cssText = 'width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:var(--ui-soft,#f3f2ef);color:var(--ui-muted,#828178);font-size:11px;font-weight:800;';
                    const copy = document.createElement('span');
                    copy.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;';
                    const nameEl = document.createElement('span');
                    nameEl.textContent = name;
                    nameEl.style.cssText = 'font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
                    const meta = document.createElement('span');
                    meta.textContent = heading;
                    meta.style.cssText = 'font-size:10px;font-weight:700;color:var(--ui-muted,#828178);';
                    copy.append(nameEl, meta);
                    const toggle = document.createElement('button');
                    toggle.type = 'button';
                    toggle.title = on ? '关闭' : '开启';
                    toggle.style.cssText = 'position:relative;width:34px;height:20px;flex:0 0 auto;border:0;border-radius:999px;background:' + (on ? '#06b6d4' : 'var(--ui-line,#d5d3cb)') + ';cursor:pointer;padding:0;';
                    const knob = document.createElement('span');
                    knob.style.cssText = 'position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .18s ease;transform:translateX(' + (on ? '14px' : '0') + ');';
                    toggle.appendChild(knob);
                    toggle.onclick = (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const next = !isVisible(key);
                        try { setVisible(key, next); }
                        catch (_) { alert('保存显示设置失败，请检查浏览器存储权限'); return; }
                        mount(container);
                    };
                    card.append(mark, copy, toggle);
                    container.appendChild(card);
                }
            }
        } catch (error) { container.textContent = error.message; }
    }
    window.ModelVisibility = { isVisible, setVisible, subscribe, mount, editModels };
})();
