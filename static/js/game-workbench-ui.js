/* 只组织现有控件；切换任务不重新载入资料、不丢弃草稿。 */
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const main = document.querySelector('main');
    if (new URLSearchParams(location.search).get('embedded') === '1') document.body.classList.add('embedded-workbench');
    const make = (tag, text, className) => {
        const node = document.createElement(tag);
        if (text) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    const shell = make('div', '', 'workbench-shell');
    const nav = make('nav', '', 'task-nav'); nav.setAttribute('aria-label', '制作任务');
    const stage = make('div', '', 'task-stage');
    const panels = {};
    const descriptions = {
        develop: ['开发', '说清想法，开发完成后审阅改动，再运行试玩。'],
        play: ['试玩', '选择已构建的版本，打开游戏查看实际效果。'],
        project: ['源码', '需要手动调整时，在这里编辑并保存文件。'],
        data: ['调整数值', '在表格中修改角色、敌人和关卡，然后校验并保存。'],
        test: ['测试', '先准备检查项，再执行测试，最后查看证据与问题。'],
        release: ['交付', '确认测试与素材来源后，生成正式交付包。'],
        settings: ['项目管理', '备份、恢复与工程运行信息。']
    };
    const more = make('details', '', 'task-more'); more.append(make('summary', '更多'));
    for (const [key, [title, hint]] of Object.entries(descriptions)) {
        const link = make('a', title); link.href = '#' + key;
        (['develop','play','project'].includes(key) ? nav : more).append(link);
        const panel = make('section', '', 'task-panel'); panel.id = 'task-' + key;
        panel.append(make('h2', title, 'task-title'), make('p', hint, 'task-hint'));
        panels[key] = panel; stage.append(panel);
    }
    nav.append(more);
    shell.append(nav, stage); main.append(shell);
    const version = make('label', '试玩版本', 'build-context'); version.append($('builds')); panels.play.append(version);
    panels.develop.append($('nativeRuntime'));
    function fold(node, title) {
        const details = make('details', '', 'advanced'); details.append(make('summary', title));
        node.before(details); details.append(node); return details;
    }
    const build = $('buildSection');
    const release = build.querySelector('details');
    release.open = true; release.classList.add('release-form');
    panels.release.append(release);
    panels.play.append($('create'), build);
    build.querySelector('h2').remove(); build.querySelector('p').remove();
    $('previewBuild').textContent = '开始试玩'; $('previewBuild').classList.add('primary');
    $('build').textContent = '更新试玩版本';
    fold($('buildDetails'), '版本与运行详情');
    const empty = make('div', '', 'preview-empty');
    empty.append(make('strong', '看看你的游戏'), make('p', '选择上方版本，点击「开始试玩」。'));
    $('gamePreview').before(empty);
    const playState = make('span', '尚未开始', 'play-state'); playState.setAttribute('role','status');
    $('previewBuild').after(playState);
    const syncPlay = () => {
        const playing = !$('gamePreview').hidden;
        empty.hidden = playing; $('stopPreview').hidden = !playing;
        $('previewBuild').textContent = playing ? '重新开始试玩' : '开始试玩';
        playState.textContent = playing ? '试玩已打开 · 点击游戏后使用键盘操作' : '尚未开始';
    };
    new MutationObserver(syncPlay).observe($('gamePreview'), {attributes:true, attributeFilter:['hidden']}); syncPlay();
    const setup = make('details', '', 'advanced'); setup.append(make('summary', '首次使用：安装游戏模板'), $('installTemplate'));
    build.append(setup);
    panels.data.append($('dataSection')); $('dataSection').querySelector('h2').remove();
    $('dataSection').querySelector('p').textContent = '选择角色、敌人或关卡，直接修改表格中的参数。';
    const dataNotice = make('p', '先点击「载入数据」，再选择要调整的内容。', 'inline-notice');
    dataNotice.id = 'dataNotice'; $('dataTable').before(dataNotice);
    fold($('data'), '高级：查看或编辑 JSON');
    const dataDiff = make('pre'); dataDiff.id = 'dataDiff'; dataDiff.setAttribute('aria-label', '数据差异'); $('dataSection').append(dataDiff);
    fold(dataDiff, '高级：查看数据校验详情');
    panels.test.append($('testingSection')); $('testingSection').querySelector('h2').remove();
    const testing = $('testingSection');
    const children = [...testing.children];
    const tabs = make('nav', '', 'test-nav'); tabs.setAttribute('aria-label', '测试步骤'); testing.prepend(tabs);
    const groups = [['prepare', '1 准备', children[0]], ['execute', '2 执行', [...children].find(n => n.textContent === '固定计划')], ['results', '3 结果', [...children].find(n => n.textContent === '执行记录与人工补充')], ['issues', '4 问题', [...children].find(n => n.textContent === '问题与回归')]];
    const subpanels = [];
    let current;
    for (const child of children) {
        const group = groups.find(g => g[2] === child);
        if (group) {
            current = make('section'); current.id = 'test-' + group[0]; subpanels.push(current); testing.append(current);
            const button = make('button', group[1]); button.type = 'button'; tabs.append(button);
            const target = current;
            button.onclick = () => {
                subpanels.forEach(p => { p.hidden = p !== target; });
                [...tabs.children].forEach(b => b.setAttribute('aria-pressed', String(b === button)));
            };
        }
        current.append(child);
    }
    tabs.firstChild.click();
    const caseForm = make('div', '', 'case-form');
    const association = make('label', '关联需求');
    const requirementSelect = make('select'); requirementSelect.multiple = true; requirementSelect.size = 3;
    requirementSelect.setAttribute('aria-label', '关联需求'); association.append(requirementSelect); caseForm.append(association);
    let mappedRequirements = [];
    document.addEventListener('game-test-requirements', event => { mappedRequirements = event.detail; });
    requirementSelect.onchange = () => {
        try {
            const value = JSON.parse($('case').value);
            value.requirementIds = [...requirementSelect.selectedOptions].map(option => option.value);
            $('case').value = JSON.stringify(value, null, 2); $('case').dispatchEvent(new Event('input', {bubbles:true}));
        } catch { $('status').textContent = '请先新建或选择一个检查项。'; }
    };
    for (const [field, label, multiline] of [['title','检查项名称',false],['steps','操作步骤（每行一步）',true],['expectations','预期结果（每行一项）',true]]) {
        const wrapper = make('label', label);
        const input = make(multiline ? 'textarea' : 'input'); input.id = 'case-form-' + field;
        input.addEventListener('input', () => {
            try {
                const value = JSON.parse($('case').value);
                value[field] = multiline ? input.value.split('\n').filter(Boolean) : input.value;
                $('case').value = JSON.stringify(value, null, 2);
                $('case').dispatchEvent(new Event('input', {bubbles:true}));
            } catch { $('status').textContent = '请先新建或选择一个检查项。'; }
        });
        wrapper.append(input); caseForm.append(wrapper);
    }
    $('case').before(caseForm);
    document.addEventListener('game-test-form-sync', () => {
        try { mappedRequirements = JSON.parse($('requirements').value).requirements; } catch { /* 保留已载入的需求。 */ }
        try {
            const value = JSON.parse($('case').value);
            requirementSelect.replaceChildren();
            for (const requirement of mappedRequirements) {
                const option = make('option', requirement.text); option.value = requirement.requirementId;
                option.selected = value.requirementIds.includes(option.value); requirementSelect.append(option);
            }
            for (const field of ['title','steps','expectations']) $('case-form-' + field).value = Array.isArray(value[field]) ? value[field].join('\n') : value[field] || '';
        } catch { /* 尚未创建用例。 */ }
    });
    $('case').addEventListener('input', () => document.dispatchEvent(new Event('game-test-form-sync')));
    const platformLabel = make('label', '实际测试设备与系统');
    const platform = make('input'); platform.placeholder = '例如：Windows 11 / 桌面电脑';
    platform.setAttribute('aria-label', '实际测试设备与系统'); platformLabel.append(platform);
    $('testPlan').before(platformLabel);
    platform.oninput = () => {
        try {
            const value = JSON.parse($('testPlan').value);
            value.environments[0].platform = platform.value;
            $('testPlan').value = JSON.stringify(value, null, 2);
            $('testPlan').dispatchEvent(new Event('input', {bubbles:true}));
        } catch { $('status').textContent = '请先准备计划草稿，再填写实际设备。'; }
    };
    document.addEventListener('game-test-form-sync', () => {
        try { platform.value = JSON.parse($('testPlan').value).environments[0].platform; } catch { /* 尚未准备计划。 */ }
    });
    for (const [id, label] of [['requirements','需求映射（高级）'],['case','用例原始数据'],['testPlan','计划原始数据'],['testSummary','执行详情'],['issue','问题原始数据'],['issueDetails','问题详情']]) fold($(id), label);
    const editor = $('editor');
    const globalActions = main.querySelector('.actions');
    const backupImport = main.querySelector(':scope > details');
    panels.project.append(editor);
    panels.settings.append(globalActions, backupImport, $('execution'));
    // ponytail: 沿用恢复控件，只将低频恢复操作折叠，不再占用源码侧栏。
    const recovery = make('details', '', 'advanced'); recovery.append(make('summary', '恢复到历史版本'));
    const historyTitle = editor.querySelector('aside h2:last-of-type');
    for (const node of [historyTitle,$('snapshots'),$('restoreFullProject').parentElement,$('restore')]) recovery.append(node);
    editor.querySelector('aside').append(recovery);
    const packages = make('div', '', 'actions'); packages.append($('export')); panels.release.prepend(packages);
    globalActions.append($('backup'));
    function activate() {
        const key = Object.hasOwn(panels, location.hash.slice(1)) ? location.hash.slice(1) : 'develop';
        for (const [id, panel] of Object.entries(panels)) panel.hidden = id !== key;
        nav.querySelectorAll('a').forEach(link => {
            if (link.hash === '#' + key) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        });
        more.classList.toggle('has-current', !['develop','play','project'].includes(key));
        more.open = false;
    }
    addEventListener('hashchange', activate); activate();
})();
