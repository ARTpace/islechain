(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const projectId = new URLSearchParams(location.search).get('projectId');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(projectId || '')) return;
    const base = `/api/game-projects/${projectId}/testing`;
    let state, project, working = false, dirty = false;
    let pollTimer, polledRun, pollCount = 0;
    const eventCursors = new Map();
    const json = value => JSON.stringify(value, null, 2);
    const id = prefix => prefix + '_' + crypto.randomUUID().replaceAll('-', '');
    async function api(path = '', method = 'GET', data) {
        const response = await fetch(base + path, {method, headers: {'Content-Type': 'application/json'},
            ...(data === undefined ? {} : {body: JSON.stringify(data)})});
        const raw = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof raw.detail === 'string' ? raw.detail : json(raw.detail));
        return raw;
    }
    function options(target, entries, value, label) {
        const selected = target.value; target.replaceChildren();
        for (const entry of entries) {
            const option = document.createElement('option'); option.value = value(entry); option.textContent = label(entry); target.append(option);
        }
        if ([...target.options].some(option => option.value === selected)) target.value = selected;
    }
    function currentRun() { return state?.runs.find(run => run.testRunId === $('testRuns').value); }
    function checkPinnedPlan(planId, revision) {
        const pinned = new URLSearchParams(location.search).get('buildId');
        const plan = state.plans.find(p => p.planId === planId && p.revision === Number(revision));
        if (pinned && plan?.buildId !== pinned) throw new Error('所选计划属于其他构建，请为画布当前版本准备并冻结新计划。');
    }
    function renderRun() {
        const run = currentRun();
        options($('resultCase'), run?.plan.cases || [], c => c.caseId, c => c.title);
        options($('resultProfile'), run?.plan.environments || [], e => e.profileId, e => e.profileId);
        $('testSummary').textContent = run ? json({state: run.state, buildVerification: run.buildVerification, attempts: run.attempts.map(a => ({caseId: a.caseId, attempt: a.attempt, result: a.result}))}) : '';
        $('testEvidence').replaceChildren();
        for (const evidence of run?.evidence || []) {
            const link = document.createElement('a');
            link.href = `${base}/evidence/${evidence.evidenceId}`;
            link.textContent = `${evidence.caseId} · ${evidence.profileId} · 第 ${evidence.attempt} 次 · ${evidence.kind} `;
            link.target = '_blank'; link.rel = 'noopener';
            const line = document.createElement('p'); line.append(link); $('testEvidence').append(line);
        }
    }
    function render() {
        document.dispatchEvent(new CustomEvent('game-test-requirements', {detail:state.requirements?.requirements || []}));
        options($('cases'), state.cases, c => `${c.caseId}:${c.revision}`, c => `${c.title} · r${c.revision}`);
        options($('testPlans'), state.plans, p => `${p.planId}:${p.revision}`, p => `${p.planId} · r${p.revision} · ${p.buildId}`);
        options($('testRuns'), state.runs, r => r.testRunId, r => `${r.testRunId} · ${r.state}`);
        options($('issues'), state.issues || [], i => i.issueId, i => `${i.title} · ${i.severity} · ${i.state}`);
        $('issueDetails').textContent = json(state.issues || []);
        renderRun(); renderVisual(); $('reports').replaceChildren();
        for (const report of state.reports) {
            const paragraph = document.createElement('p'); paragraph.textContent = `${report.reportId} · ${json(report.summary.counts)} · 未批准交付 `;
            for (const format of ['json', 'markdown']) {
                const link = document.createElement('a'); link.href = `${base}/reports/${report.reportId}?format=${format}`;
                link.textContent = ` ${format} `; link.target = '_blank'; link.rel = 'noopener'; paragraph.append(link);
            }
            $('reports').append(paragraph);
        }
    }
    function showVisual() {
        for (const [select, image] of [['visualBaseline', 'visualBefore'], ['visualCurrent', 'visualAfter']]) {
            const evidenceId = $(select).value;
            $(image).hidden = !evidenceId;
            if (evidenceId) $(image).src = `${base}/evidence/${evidenceId}`;
            else $(image).removeAttribute('src');
        }
    }
    function renderVisual() {
        const pictures = state.runs.flatMap(run => run.evidence).filter(e => e.kind === 'screenshot');
        const adopted = new Set((state.visualBaselines || []).map(b => b.evidenceId));
        const label = e => e.evidenceId ? `${adopted.has(e.evidenceId) ? '已采用基线 · ' : ''}${e.caseId} · ${e.profileId} · ${e.buildId} · #${e.attempt}` : '不使用参考截图';
        options($('visualBaseline'), [{evidenceId:''}, ...pictures], e => e.evidenceId, label);
        options($('visualCurrent'), pictures, e => e.evidenceId, label);
        $('visualReviews').textContent = json(state.visualReviews || []);
        showVisual();
    }
    $('visualBaseline').onchange = $('visualCurrent').onchange = showVisual;
    async function reload() {
        state = await api();
        const response = await fetch(`/api/game-projects/${projectId}`);
        if (!response.ok) throw new Error('项目不可用');
        project = (await response.json()).project; render(); schedulePoll();
    }
    function schedulePoll() {
        clearTimeout(pollTimer);
        const run = state?.runs.find(r => r.executionMode === 'automated' && ['preparing', 'running'].includes(r.state));
        if (!run) return;
        if (polledRun !== run.sessionId) { polledRun = run.sessionId; pollCount = 0; }
        if (pollCount >= 240) { $('status').textContent = '执行状态更新已到时限，请手动重载核对'; return; }
        pollTimer = setTimeout(async () => {
            if (working) { schedulePoll(); return; }
            pollCount++;
            try {
                const events = await api(`/automatic-runs/${run.testRunId}/events?after=${eventCursors.get(run.testRunId) || 0}`);
                eventCursors.set(run.testRunId, events.cursor);
                if (!['preparing', 'running'].includes(events.state)) { await reload(); return; }
                if (currentRun()?.testRunId === run.testRunId) $('testSummary').textContent = json(events);
                schedulePoll();
            } catch (error) { $('status').textContent = '执行状态更新失败：' + error.message + '；可手动重载'; }
        }, 1000);
    }
    function bind(name, operation) {
        $(name).onclick = async () => {
            if (working) return; working = true;
            const buttons = $('testingSection').querySelectorAll('button'); buttons.forEach(b => { b.disabled = true; });
            try { if (!state) await reload(); await operation(); $('status').textContent = '测试资料操作完成'; }
            catch (error) { $('status').textContent = error.message; $('status').scrollIntoView({block:'center'}); }
            finally { document.dispatchEvent(new Event('game-test-form-sync')); working = false; buttons.forEach(b => { b.disabled = false; }); }
        };
    }
    bind('testingReload', reload);
    bind('saveVisualReview', async () => {
        if (!$('visualCurrent').value) throw new Error('先选择当前截图');
        await api('/visual-reviews', 'POST', {baseRevision:state.revision, currentEvidenceId:$('visualCurrent').value,
            baselineEvidenceId:$('visualBaseline').value || null, decision:$('visualDecision').value,
            comment:$('visualComment').value, adoptBaseline:$('adoptVisualBaseline').checked});
        $('adoptVisualBaseline').checked = false; dirty = false; await reload();
    });
    bind('mapRequirements', async () => {
        if (!project.plan) throw new Error('请先生成并确认策划');
        const previous = state.requirements?.requirements || [];
        const used = new Set();
        $('requirements').value = json({projectId, planRevision: project.plan.revision,
            requirements: project.plan.acceptanceCriteria.map(text => {
                const old = previous.find(r => r.text === text && !used.has(r.requirementId));
                const requirementId = old?.requirementId || id('req'); used.add(requirementId); return {requirementId, text};
            })}); dirty = true;
    });
    bind('adoptRequirements', async () => { await api('/requirements', 'PUT', {baseRevision: state.revision, requirements: JSON.parse($('requirements').value)}); dirty = false; await reload(); });
    bind('newCase', async () => { $('case').value = json({caseId: id('case'), revision: 1, title: '新人工用例', requirementIds: state.requirements?.requirements.slice(0, 1).map(r => r.requirementId) || [], required: true, executionMode: 'manual', steps: ['填写实际操作'], expectations: ['填写可观察预期']}); dirty = true; });
    bind('newAutoCase', async () => {
        $('case').value = json({caseId: id('case'), revision: 1, title: '自动启动与重开冒烟（需确认需求关联）',
            requirementIds: state.requirements?.requirements.slice(0, 1).map(r => r.requirementId) || [], required: true,
            executionMode: 'automated', requiredCapabilities: ['mouse', 'dom', 'screenshot'],
            steps: ['点击重开'], expectations: ['HUD 显示 playing，收集计数归零'],
            actions: [{type:'click',selector:'#restart'}], domExpectations: [{selector:'#hud',comparison:'contains',expected:'收集 0/'},{selector:'#hud',comparison:'contains',expected:'playing'}]}); dirty = true;
    });
    $('cases').onchange = () => {
        const item = state.cases.find(c => `${c.caseId}:${c.revision}` === $('cases').value);
        if (item) { const next = structuredClone(item); next.revision = Math.max(...state.cases.filter(c => c.caseId === item.caseId).map(c => c.revision)) + 1; $('case').value = json(next); dirty = true; document.dispatchEvent(new Event('game-test-form-sync')); }
    };
    bind('saveCase', async () => {
        const item = JSON.parse($('case').value);
        if (!item.title?.trim()) throw new Error('请填写检查项名称，已保留当前草稿。');
        if (!item.requirementIds?.length) throw new Error('请至少选择一项关联需求。');
        if (!item.steps?.length || !item.expectations?.length) throw new Error('请填写操作步骤和预期结果。');
        await api('/cases', 'POST', {baseRevision: state.revision, case: item}); dirty = false; await reload();
    });
    bind('preparePlan', async () => {
        const cases = [...new Map(state.cases.filter(c => !state.archivedCases?.includes(c.caseId) && c.executionMode === $('planMode').value).map(c => [c.caseId, c])).values()];
        const workspace = await (await fetch(`/api/game-projects/${projectId}/workspace`)).json();
        const builds = await (await fetch(`/api/game-projects/${projectId}/workspace/builds`)).json();
        const pinnedBuild = new URLSearchParams(location.search).get('buildId');
        const build = pinnedBuild ? builds.find(b => b.buildId === pinnedBuild) : builds.at(-1);
        if (!build) throw new Error('请先在开发节点构建有效版本。');
        if (build.workspaceEpoch !== workspace.workspaceEpoch) throw new Error('工程已恢复，返回画布重新构建。');
        $('testPlan').value = json({planId: id('plan'), revision: 1, owner: project.owner, projectId, buildId: build?.buildId || 'replace-with-fixed-build-id', inputManifestHash: build?.inputManifestHash || 'replace-with-64-character-sha256', workspaceEpoch: workspace.workspaceEpoch, requirements: state.requirements, cases,
            environments: [{profileId: 'desktop', browser: 'Chromium（自动执行时记录实际版本）', platform: '请填写实际平台及版本', viewportWidth: innerWidth, viewportHeight: innerHeight, devicePixelRatio, deviceMode: 'desktop', capabilities: ['keyboard', 'mouse', 'screenshot', 'dom', 'viewport']}]}); dirty = true;
    });
    bind('saveTestPlan', async () => { await api('/plans', 'POST', {baseRevision: state.revision, plan: JSON.parse($('testPlan').value)}); dirty = false; await reload(); });
    bind('startManual', async () => {
        const [planId, revision] = $('testPlans').value.split(':');
        if (!planId) throw new Error('先保存固定计划');
        checkPinnedPlan(planId, revision);
        const started = await api('/manual-runs', 'POST', {baseRevision: state.revision, planId, planRevision: Number(revision), requestId: id('request')}); await reload();
        $('testRuns').value = started.run.testRunId; renderRun();
    });
    bind('startAuto', async () => {
        const [planId, revision] = $('testPlans').value.split(':'); if (!planId) throw new Error('先冻结自动计划');
        checkPinnedPlan(planId, revision);
        const started = await api('/automatic-runs', 'POST', {baseRevision: state.revision, planId, planRevision:Number(revision), requestId:id('request')}); await reload();
        $('testRuns').value = started.testRunId; renderRun();
    });
    bind('cancelAuto', async () => { const run = currentRun(); if (!run) throw new Error('选择自动记录'); await api(`/automatic-runs/${run.testRunId}/cancel`,'POST'); await reload(); });
    bind('retryAuto', async () => { const run = currentRun(); if (!run) throw new Error('选择已结束的自动记录'); await api(`/automatic-runs/${run.testRunId}/retry`, 'POST', {baseRevision:state.revision,requestId:id('retry')}); await reload(); });
    bind('testEvents', async () => { const run = currentRun(); if (!run) throw new Error('选择自动记录'); $('testSummary').textContent = json(await api(`/automatic-runs/${run.testRunId}/events`)); });
    $('testRuns').onchange = renderRun;
    bind('recordResult', async () => {
        const run = currentRun(); if (!run) throw new Error('先开始人工记录');
        const screenshot = $('resultScreenshot').files[0];
        let screenshotBase64;
        if (screenshot) {
            if (screenshot.size > 5 * 1024 * 1024) throw new Error('截图最多 5 MiB');
            screenshotBase64 = await new Promise((resolve, reject) => {
                const reader = new FileReader(); reader.onerror = () => reject(new Error('截图读取失败'));
                reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(screenshot);
            });
        }
        await api(`/manual-runs/${run.testRunId}/results`, 'POST', {baseRevision: state.revision, caseId: $('resultCase').value, profileId: $('resultProfile').value, result: $('result').value, observation: $('observation').value, screenshotBase64});
        $('resultScreenshot').value = ''; await reload();
    });
    bind('cancelTest', async () => { const run = currentRun(); if (!run) throw new Error('选择人工记录'); await api(`/manual-runs/${run.testRunId}/cancel`, 'POST', {baseRevision: state.revision}); await reload(); });
    bind('makeReport', async () => { const run = currentRun(); if (!run) throw new Error('选择人工记录'); await api(`/manual-runs/${run.testRunId}/reports`, 'POST', {baseRevision: state.revision}); await reload(); });
    bind('prepareIssue', async () => {
        const run = currentRun(); if (!run) throw new Error('选择人工记录');
        const history = run.attempts.filter(a => a.caseId === $('resultCase').value && a.profileId === $('resultProfile').value && a.result === 'failed');
        const attempt = history.at(-1); if (!attempt) throw new Error('当前用例没有失败 attempt');
        const testCase = run.plan.cases.find(c => c.caseId === attempt.caseId);
        $('issue').value = json({testRunId: run.testRunId, caseId: attempt.caseId, profileId: attempt.profileId,
            attempt: attempt.attempt, title: testCase.title + '未达预期', severity: 'major', expected: testCase.expectations.join('\n'),
            actual: $('observation').value || '请填写实际行为', steps: testCase.steps}); dirty = true;
    });
    bind('saveIssue', async () => { await api('/issues', 'POST', {...JSON.parse($('issue').value), baseRevision: state.revision}); dirty = false; await reload(); });
    bind('updateIssue', async () => {
        const issue = state.issues?.find(i => i.issueId === $('issues').value); if (!issue) throw new Error('选择问题');
        await api(`/issues/${issue.issueId}/state`, 'POST', {baseRevision: state.revision, issueRevision: issue.revision,
            state: $('issueState').value, regressionTestRunId: currentRun()?.testRunId || null}); await reload();
    });
    $('testingSection').addEventListener('input', event => {
        if (event.target.matches('textarea,input[type=file]')) dirty = true;
    });
    window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
    reload().catch(error => { $('status').textContent = '测试资料载入失败：' + error.message; });
})();
