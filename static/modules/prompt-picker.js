/* 提示词选择器：把「风格 / 角色 / 画师 / 预设」四个选择器装进同一个浮层。
 *
 * 来源：static/app/zimage.html 内联实现（原第 1695–2159 行，17 个函数）原样迁出，
 * 业务逻辑未改动，只把 4 处宿主耦合改成可注入：
 *   anchor  —— 浮层对齐的锚点（默认文生图的 #generationComposer，缺失时退回按钮）
 *   button  —— 触发展开的按钮（默认 #promptPickerBtn，用于加 active 态）
 *   upward  —— 是否向上展开（默认按 body.chat-layout 判断）
 *   library —— 提示词库容器 id（默认 #generationPromptLibrary）
 *   onAfterApply —— 每次应用选择后的回调（默认 updatePickerButtonsHighlight）
 *
 * 宿主接入：
 *   <script src="/static/modules/prompt-picker.js"></script>
 *   <button id="promptPickerBtn" onclick="togglePromptPicker()">提示词</button>
 * 其余页面的选择器（preset-picker / anima-*-picker / lora-picker）按原约定挂 window，
 * 本模块用 typeof 守卫按需调用，缺哪个就少哪个 tab。
 *
 * 注意：样式仍留在 static/app/zimage.html 的 <style> 内（.prompt-picker-* 与
 * #promptPickerBody *），尚未抽成 css 文件；其他页面接入前需先迁样式。
 */
(function (global) {
    'use strict';

    var deps = {
        anchor: function () {
            return document.getElementById('generationComposer') || document.getElementById('promptPickerBtn');
        },
        button: function () { return document.getElementById('promptPickerBtn'); },
        upward: function () { return document.body.classList.contains('chat-layout'); },
        library: function () { return document.getElementById('generationPromptLibrary'); },
        onAfterApply: null
    };

    var tab = 'style';
    var visited = new Set();
    var ignoreClick = false;
    var closing = false;
    var closeToken = 0;
    var sortMode = 'heat';
    var sortAsc = false;
    var statusSeen = new Set();
    var statusObs;

    function allowed() {
        // LoRA 已拆成独立按钮，不再占用提示词选择器的标签
        return ['style', 'char', 'artist', 'preset'];
    }

    function afterApply() {
        if (typeof deps.onAfterApply === 'function') deps.onAfterApply();
        else if (typeof global.updatePickerButtonsHighlight === 'function') global.updatePickerButtonsHighlight();
    }

    function syncPromptPickerComfy() {
        var shell = document.getElementById('promptPickerShell');
        if (!shell) return;
        var list = allowed();
        if (shell.classList.contains('is-open') && list.indexOf(tab) < 0) {
            promptPickerShowTab(list[0]);
            return;
        }
        promptPickerMount();
    }

    function installPromptCloseHooks() {
        if (global.__promptCloseHooks) return;
        global.__promptCloseHooks = true;
        // 嵌入面板保持展开，选择变化直接复用各选择器的应用逻辑。
        var selectionGroups = [
            ['pickerApply', ['pickerToggle', 'pickerSelectAll', 'pickerInvertSelection', 'pickerClearAll']],
            ['artistPickerApply', ['artistPickerToggle', 'artistPickerSelectAll', 'artistPickerInvertSelection', 'artistPickerClearAll']],
            ['presetPickerApply', ['presetPickerToggle', 'presetPickerSelectAll', 'presetPickerInvertSelection', 'presetPickerClearAll']]
        ];
        selectionGroups.forEach(function (group) {
            var apply = group[0];
            group[1].forEach(function (name) {
                var original = global[name];
                if (typeof original !== 'function') return;
                global[name] = function () {
                    var result = original.apply(this, arguments);
                    if (document.getElementById('promptPickerShell')?.classList.contains('is-open')) {
                        global[apply]();
                        afterApply();
                    }
                    return result;
                };
            });
        });
        ['pickerClose', 'artistPickerClose', 'presetPickerClose'].forEach(function (name) {
            var orig = global[name];
            if (typeof orig !== 'function') return;
            global['__orig_' + name] = orig;
            global[name] = function () {
                var shell = document.getElementById('promptPickerShell');
                if (shell && shell.classList.contains('is-open') && !global.__promptInternalClose) {
                    closePromptPicker();
                    return;
                }
                return orig.apply(this, arguments);
            };
        });
    }

    function ensurePromptPickerShell() {
        var shell = document.getElementById('promptPickerShell');
        if (shell) return shell;
        shell = document.createElement('div');
        shell.id = 'promptPickerShell';
        shell.className = 'prompt-picker-shell';
        // 不再套任何外壳：没有标签栏、工具条，也没有关闭标题栏，提示词库界面直接铺满（点外面关闭）
        shell.innerHTML = '<div id="promptPickerBody"></div>';
        document.body.appendChild(shell);
        shell.querySelectorAll('[data-prompt-tab]').forEach(function (btn) {
            btn.onclick = function (event) {
                event.stopPropagation();
                promptPickerShowTab(btn.getAttribute('data-prompt-tab'));
            };
        });
        var applySel = shell.querySelector('#promptPickerApply');
        if (applySel) applySel.addEventListener('change', function (event) {
            var item = document.querySelector('#pickerApplyModeList [data-mode="' + event.target.value + '"]');
            if (!item) return;
            item.click();
            global.pickerApply();
            promptPickerSyncStatus();
        });
        var search = shell.querySelector('#promptPickerSearch');
        if (search) {
            search.addEventListener('input', function () { promptPickerSyncSearch(); });
            search.addEventListener('click', function (event) { event.stopPropagation(); });
        }
        shell.querySelectorAll('[data-prompt-act]').forEach(function (btn) {
            btn.onclick = function (event) {
                event.stopPropagation();
                promptPickerAct(btn.getAttribute('data-prompt-act'), btn);
            };
        });
        document.addEventListener('click', function (event) {
            if (!shell.classList.contains('is-open') || ignoreClick) return;
            if (event.composedPath().includes(shell)) return;
            if (event.target.closest && event.target.closest('#promptPickerBtn')) return;
            if (event.target.closest?.('#prompt, .prompt-wrapper, #promptTagsWrap')) return;
            closePromptPicker();
        });
        window.addEventListener('resize', placePromptPickerIfOpen);
        window.addEventListener('studio-ui-scale-change', placePromptPickerIfOpen);
        window.addEventListener('scroll', placePromptPickerIfOpen, true);
        document.addEventListener('fullscreenchange', placePromptPickerIfOpen);
        window.visualViewport?.addEventListener('resize', placePromptPickerIfOpen);
        window.visualViewport?.addEventListener('scroll', placePromptPickerIfOpen);
        var anchorEl = deps.anchor();
        var composer = document.getElementById('generationComposer');
        var observerTarget = composer || (anchorEl && anchorEl.parentElement);
        if (observerTarget && typeof ResizeObserver !== 'undefined') {
            var observer = new ResizeObserver(placePromptPickerIfOpen);
            observer.observe(observerTarget);
            if (observerTarget.parentElement) observer.observe(observerTarget.parentElement);
        }
        return shell;
    }

    function placePromptPicker(animate) {
        var shell = document.getElementById('promptPickerShell');
        var anchor = deps.anchor();
        if (!shell || !anchor) return;
        var rect = anchor.getBoundingClientRect();
        var up = deps.upward();
        var viewport = window.visualViewport;
        var viewLeft = viewport?.offsetLeft || 0;
        var viewTop = viewport?.offsetTop || 0;
        var viewWidth = viewport?.width || window.innerWidth;
        var viewBottom = viewTop + (viewport?.height || window.innerHeight);
        // 主题缩放会让 body 成为 fixed 定位的包含块。rect 是屏幕坐标，
        // 写入面板前必须还原为 body 内部坐标，不能再次乘上页面缩放。
        var bodyRect = document.body.getBoundingClientRect();
        var scaledBody = getComputedStyle(document.body).transform !== 'none';
        var scale = scaledBody && document.body.offsetWidth ? bodyRect.width / document.body.offsetWidth : 1;
        var originX = scaledBody ? bodyRect.left : 0;
        var originY = scaledBody ? bodyRect.top : 0;
        // 窄屏（手机 / 小平板）：铺满宽度，但纵向要给输入栏留出位置，
        // 否则面板会盖住输入框，展开后就没法继续输入了。
        if (viewWidth <= 840) {
            var pad = 8;
            var vh = viewport?.height || window.innerHeight;
            var w = Math.max(240, viewWidth - pad * 2);
            // 输入栏在可视区下半部时，面板只占它上方的空间；在上半部时则从它下方开始。
            var anchorTop = rect.top - viewTop;
            var anchorBelow = anchorTop > vh * 0.4;
            var topEdge = anchorBelow ? viewTop + pad : Math.max(viewTop + pad, rect.bottom + 8);
            var bottomEdge = anchorBelow ? Math.min(viewBottom - pad, rect.top - 8) : viewBottom - pad;
            var h = Math.max(200, bottomEdge - topEdge);
            shell.style.left = ((viewLeft + pad - originX) / scale) + 'px';
            shell.style.width = (w / scale) + 'px';
            shell.style.right = 'auto';
            shell.style.top = ((topEdge - originY) / scale) + 'px';
            shell.style.bottom = 'auto';
            if (animate) {
                shell.style.height = '0px';
                requestAnimationFrame(placePromptPickerIfOpen);
            } else if (shell.classList.contains('is-open')) {
                shell.style.height = (h / scale) + 'px';
            }
            return;
        }
        var width = Math.max(0, Math.min(Math.round(rect.width), viewWidth - 24));
        var left = Math.max(viewLeft + 12, Math.min(Math.round(rect.left), viewLeft + viewWidth - width - 12));
        shell.style.left = ((left - originX) / scale) + 'px';
        shell.style.width = (width / scale) + 'px';
        shell.style.right = 'auto';
        var maxH;
        if (up) {
            var bottom = Math.max(viewTop + 12, Math.min(rect.top - 8, viewBottom - 12));
            maxH = Math.max(0, bottom - viewTop - 12);
            shell.style.top = 'auto';
            shell.style.bottom = (scaledBody ? document.body.clientHeight - (bottom - originY) / scale : window.innerHeight - bottom) + 'px';
        } else {
            var top = Math.max(viewTop + 12, Math.min(Math.round(rect.bottom + 8), viewBottom - 12));
            maxH = Math.max(0, viewBottom - top - 12);
            shell.style.bottom = 'auto';
            shell.style.top = ((top - originY) / scale) + 'px';
        }
        if (animate) {
            shell.style.height = '0px';
            requestAnimationFrame(placePromptPickerIfOpen);
        } else if (shell.classList.contains('is-open')) {
            shell.style.height = (maxH / scale) + 'px';
        }
    }

    function placePromptPickerIfOpen() {
        var shell = document.getElementById('promptPickerShell');
        if (shell && shell.classList.contains('is-open')) placePromptPicker(false);
    }

    function promptPickerMount() {
        var host = document.getElementById('promptPickerBody');
        var library = deps.library();
        if (library) library.style.display = 'block';
        var map = { char: 'characterPickerModal', artist: 'artistPickerModal', preset: 'presetPickerModal' };
        Object.keys(map).forEach(function (key) {
            var el = document.getElementById(map[key]);
            if (!el || !host) return;
            el.classList.add('prompt-embedded');
            if (el.parentElement !== host) host.appendChild(el);
            var on = key === tab || (key === 'preset' && tab === 'style');
            el.classList.toggle('prompt-pane-on', on);
            el.style.display = on ? 'flex' : 'none';
            if (key === 'char') el.classList.toggle('is-open', on);
        });
        var list = allowed();
        document.querySelectorAll('#promptPickerShell [data-prompt-tab]').forEach(function (btn) {
            var name = btn.getAttribute('data-prompt-tab');
            btn.hidden = list.indexOf(name) < 0;
            btn.classList.toggle('on', name === tab);
        });
    }

    function promptPickerApplyRaw(name) {
        if (name === 'lora') {
            if (typeof global.loraPickerClose === 'function') global.loraPickerClose();
            return;
        }
        if (global.GenerationPromptLibrary) return;
        var fn = name === 'char' ? 'pickerClose' : name === 'artist' ? 'artistPickerClose' : 'presetPickerClose';
        var orig = global['__orig_' + fn] || global[fn];
        if (typeof orig !== 'function') return;
        global.__promptInternalClose = true;
        try { orig(); } finally { global.__promptInternalClose = false; }
    }

    async function promptPickerShowTab(next) {
        var list = allowed();
        if (list.indexOf(next) < 0) next = list[0];
        var samePresetPane = ['preset', 'style'].indexOf(tab) >= 0 && ['preset', 'style'].indexOf(next) >= 0;
        if (tab !== next && !samePresetPane && visited.has(tab)) promptPickerApplyRaw(tab);
        tab = next;
        visited.add(next);
        if (next !== 'lora' && global.GenerationPromptLibrary) global.GenerationPromptLibrary.mount(next);
        else if (next === 'char' && typeof global.pickerOpen === 'function') global.pickerOpen();
        else if (next === 'artist' && typeof global.artistPickerOpen === 'function') global.artistPickerOpen();
        else if (next === 'lora') {
            if (typeof global.loraPickerInit === 'function') global.loraPickerInit();
            var pane = document.getElementById('loraPickerShell');
            var body = document.getElementById('promptPickerBody');
            if (pane && body) {
                pane.classList.add('prompt-embedded');
                body.appendChild(pane);
            }
            if (global.LoraManager) await global.LoraManager.togglePanel();
            var shellEl = document.getElementById('promptPickerShell');
            if (tab !== next || !shellEl || !shellEl.classList.contains('is-open')) {
                if (typeof global.loraPickerClose === 'function') global.loraPickerClose();
                return;
            }
        } else if (typeof global.presetPickerOpen === 'function') {
            if (!samePresetPane || !document.querySelector('#presetPickerModal.prompt-pane-on')) global.presetPickerOpen();
            if (typeof global._presetSwitchMode === 'function') global._presetSwitchMode(next === 'style' ? 'style' : 'tag');
        }
        promptPickerMount();
        var search = document.getElementById('promptPickerSearch');
        if (search) search.placeholder = next === 'char' ? '搜索角色' : next === 'artist' ? '搜索画师' : next === 'lora' ? '搜索 LoRA' : next === 'style' ? '搜索风格' : '搜索标签';
        promptPickerSyncSearch();
        promptPickerSyncTools(true);
        setTimeout(promptPickerSyncSearch, 250);
        setTimeout(function () {
            var ae = document.activeElement;
            if (ae && (ae.id === 'pickerSearch' || ae.id === 'artistPickerSearch' || ae.id === 'presetPickerSearch')) {
                document.getElementById('promptPickerSearch')?.focus();
            }
        }, 160);
    }

    function promptPickerSyncSearch() {
        if (global.GenerationPromptLibrary) return;
        var box = document.getElementById('promptPickerSearch');
        if (!box) return;
        var id = tab === 'char' ? 'pickerSearch' : tab === 'artist' ? 'artistPickerSearch' : tab === 'lora' ? 'loraPickerSearch' : 'presetPickerSearch';
        var el = document.getElementById(id);
        if (!el || el.value === box.value) return;
        el.value = box.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function promptPickerApplySort() {
        var label = sortMode === 'name' ? '名称' : '热度';
        var sortBtn = document.getElementById('promptPickerSort');
        var dirBtn = document.getElementById('promptPickerSortDir');
        if (sortBtn) sortBtn.textContent = label;
        if (dirBtn) dirBtn.textContent = sortAsc ? '↑' : '↓';
        if (tab === 'char') {
            var typeBtn = document.getElementById('pickerSortTypeBtn');
            var text = document.getElementById('pickerSortTypeText');
            var guard = 0;
            while (typeBtn && text && text.textContent !== label && guard < 4) { typeBtn.click(); guard++; }
            var icon = document.getElementById('pickerSortDirIcon');
            var nativeAsc = !!(icon && icon.style.transform.indexOf('180') >= 0);
            if (nativeAsc !== sortAsc) document.getElementById('pickerSortDirBtn')?.click();
        } else if (tab === 'artist') {
            var sel = document.getElementById('artistPickerSort');
            if (sel) {
                sel.value = sortMode === 'name' ? 'name' : 'post_count';
                sel.dataset.asc = sortAsc ? '1' : '0';
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
        } else {
            var presetSel = document.getElementById('presetPickerSort');
            if (presetSel) {
                presetSel.value = sortMode === 'name' ? 'name' : 'heat';
                presetSel.dataset.asc = sortAsc ? '1' : '0';
                presetSel.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }

    function promptPickerSyncTools(resetSelected) {
        if (global.GenerationPromptLibrary) {
            // 外层工具条已移除，直接由提示词库自己的界面接管
            var tools = document.querySelector('.prompt-picker-tools');
            var stat = document.getElementById('promptPickerStat');
            var search = document.getElementById('promptPickerSearch');
            if (tools) tools.hidden = true;
            if (stat) stat.hidden = true;
            if (search) search.hidden = true;
            return;
        }
        var toolsEl = document.querySelector('.prompt-picker-tools');
        var statEl = document.getElementById('promptPickerStat');
        if (toolsEl) toolsEl.hidden = tab === 'lora';
        if (statEl) statEl.hidden = tab === 'lora';
        if (tab === 'lora') return;
        var apply = document.getElementById('promptPickerApply');
        if (apply) apply.hidden = tab !== 'char';
        promptPickerApplySort();
        promptPickerWatchStatus();
        promptPickerSyncStatus();
        if (resetSelected) document.getElementById('promptPickerSelected')?.classList.remove('on');
    }

    function promptPickerWatchStatus() {
        if (!statusObs) statusObs = new MutationObserver(function () { promptPickerSyncStatus(); });
        ['pickerTotalCount', 'pickerPageInfo', 'pickerSelectedCount', 'pickerApplyModeText', 'artistPickerPageInfo', 'artistPickerSelectedCount', 'presetPickerTotalCount', 'presetPickerPageInfo', 'presetPickerSelectedCount'].forEach(function (id) {
            if (statusSeen.has(id)) return;
            var el = document.getElementById(id);
            if (!el) return;
            statusObs.observe(el, { childList: true, characterData: true, subtree: true });
            statusSeen.add(id);
        });
    }

    function promptPickerSyncStatus() {
        var el = document.getElementById('promptPickerStat');
        if (!el) return;
        var num = function (text) { return ((text || '').match(/[\d,]+/g) || []).join('').replace(/,/g, ''); };
        var range = '';
        var total = '';
        var selected = '0';
        if (tab === 'char') {
            total = num(document.getElementById('pickerTotalCount')?.textContent);
            var page = document.getElementById('pickerPageInfo')?.textContent || '';
            var m = page.match(/(\d+)\s*[-–]\s*(\d+)/);
            if (m) range = m[1] + '–' + m[2];
            selected = num(document.getElementById('pickerSelectedCount')?.textContent) || '0';
            var mode = document.getElementById('pickerApplyModeText')?.textContent || '';
            var apply = document.getElementById('promptPickerApply');
            if (apply) {
                apply.value = document.querySelector('#pickerApplyModeList .active')?.dataset.mode || 'name';
                apply.title = mode || '角色提示词插入方式';
            }
        } else if (tab === 'artist') {
            var artistPage = document.getElementById('artistPickerPageInfo')?.textContent || '';
            var am = artistPage.match(/(\d+)\s*[-–]\s*(\d+)/);
            var all = artistPage.match(/共\s*([\d,]+)/);
            if (am) range = am[1] + '–' + am[2];
            total = all ? all[1].replace(/,/g, '') : '';
            selected = num(document.getElementById('artistPickerSelectedCount')?.textContent) || '0';
        } else {
            total = num(document.getElementById('presetPickerTotalCount')?.textContent);
            var presetPage = document.getElementById('presetPickerPageInfo')?.textContent || '';
            var pm = presetPage.match(/(\d+)\s*\/\s*(\d+)/);
            if (pm) range = pm[1] + '/' + pm[2];
            selected = num(document.getElementById('presetPickerSelectedCount')?.textContent) || '0';
        }
        var head = range && total && range.indexOf('/') < 0 ? range + '/' + total : (range || total);
        el.textContent = head ? head + ' · ' + selected : selected;
        el.title = '当前范围 / 总数 · 已选';
    }

    function promptPickerAct(act, btn) {
        var current = tab;
        var call = function (name) { if (typeof global[name] === 'function') global[name](); };
        if (act === 'sort') {
            sortMode = sortMode === 'heat' ? 'name' : 'heat';
            promptPickerApplySort();
        } else if (act === 'sortdir') {
            sortAsc = !sortAsc;
            promptPickerApplySort();
        } else if (act === 'pmode') {
            if (typeof global._presetSwitchMode === 'function') global._presetSwitchMode(btn.dataset.mode);
            document.querySelectorAll('#promptPickerShell .prompt-picker-pmode').forEach(function (el) { el.classList.toggle('on', el === btn); });
        } else if (act === 'selected') {
            if (current === 'char') {
                document.getElementById('pickerShowSelBtn')?.click();
                btn.classList.toggle('on', !!document.getElementById('pickerShowSelBtn')?.classList.contains('active'));
            } else if (current === 'artist') {
                call('artistPickerShowSelectedOnly');
                btn.classList.toggle('on');
            } else {
                call('presetPickerShowSelectedOnly');
                btn.classList.toggle('on');
            }
        } else if (act === 'all') {
            call(current === 'char' ? 'pickerSelectAll' : current === 'artist' ? 'artistPickerSelectAll' : 'presetPickerSelectAll');
        } else if (act === 'invert') {
            call(current === 'char' ? 'pickerInvertSelection' : current === 'artist' ? 'artistPickerInvertSelection' : 'presetPickerInvertSelection');
        } else if (act === 'copy') {
            call(current === 'char' ? 'pickerCopySelected' : current === 'artist' ? 'artistPickerCopySelected' : 'presetPickerCopySelected');
        } else if (act === 'clear') {
            call(current === 'char' ? 'pickerClearAll' : current === 'artist' ? 'artistPickerClearAll' : 'presetPickerClearAll');
        }
    }

    function togglePromptPicker() {
        var shell = ensurePromptPickerShell();
        installPromptCloseHooks();
        if (shell.classList.contains('is-open')) {
            closePromptPicker();
            return;
        }
        var list = allowed();
        if (list.indexOf(tab) < 0) tab = list[0];
        visited.clear();
        shell.classList.add('is-open');
        placePromptPicker(true);
        ignoreClick = true;
        setTimeout(function () { ignoreClick = false; }, 0);
        var btn = deps.button();
        if (btn) btn.classList.add('active');
        promptPickerShowTab(tab);
    }

    function closePromptPicker() {
        var shell = document.getElementById('promptPickerShell');
        if (!shell || !shell.classList.contains('is-open')) return;
        var token = ++closeToken;
        closing = true;
        try {
            if (!global.__promptPickerSkipApply) {
                if (visited.has(tab)) promptPickerApplyRaw(tab);
                visited.forEach(function (name) {
                    if (name !== tab && !(['preset', 'style'].indexOf(name) >= 0 && ['preset', 'style'].indexOf(tab) >= 0)) promptPickerApplyRaw(name);
                });
            }
        } catch (err) { /* 选择器未就绪时忽略 */ }
        visited.clear();
        shell.style.height = '0px';
        var finish = function () {
            if (token !== closeToken) return;
            closing = false;
            shell.classList.remove('is-open');
        };
        shell.addEventListener('transitionend', function onEnd(ev) {
            if (ev.propertyName !== 'height') return;
            shell.removeEventListener('transitionend', onEnd);
            finish();
        });
        setTimeout(finish, 340);
        var btn = deps.button();
        if (btn) btn.classList.remove('active');
        afterApply();
    }

    global.PromptPicker = {
        init: function (next) { if (next) Object.keys(next).forEach(function (k) { deps[k] = next[k]; }); },
        open: togglePromptPicker,
        close: closePromptPicker,
        toggle: togglePromptPicker,
        showTab: promptPickerShowTab,
        refresh: syncPromptPickerComfy,
        mount: promptPickerMount,
        placeIfOpen: placePromptPickerIfOpen,
        currentTab: function () { return tab; },
        isOpen: function () {
            var shell = document.getElementById('promptPickerShell');
            return !!(shell && shell.classList.contains('is-open'));
        }
    };

    // 兼容层：宿主内联代码（含 HTML 里的 onclick 属性）仍按裸函数名调用。
    global.togglePromptPicker = togglePromptPicker;
    global.closePromptPicker = closePromptPicker;
    global.syncPromptPickerComfy = syncPromptPickerComfy;
    global.promptPickerShowTab = promptPickerShowTab;
    global.promptPickerMount = promptPickerMount;
    global.placePromptPickerIfOpen = placePromptPickerIfOpen;
    global.installPromptCloseHooks = installPromptCloseHooks;
})(window);
