/* ponytail: 节点引用项目的权威工程与固定构建，不复制工作台数据或另建执行器。 */
(() => {
    'use strict';
    const types = ['gameDevelop', 'gameTest', 'gameRelease'];
    const busy = new Set(), notices = new Map(), paused = new Set();
    const progress = new Map(), logs = new Map(), statusTargets = new Map(), logWindows = new Map();
    const players = new Map();
    function activePlayer(node) {
        if(!node) return null;
        const build=output(node), dev=developer(node);
        if(!['gameTest','gamePlay'].includes(node.type) || !build || project()?.id!==node.projectId || project()?.archived || (dev?.builtInput && dev.builtInput!==signature(dev))) return null;
        let player=players.get(node.id);
        if(!player || player.buildId!==build.buildId) {player={buildId:build.buildId,channel:crypto.randomUUID(),enabled:false};players.set(node.id,player);}
        return player;
    }
    function preservePlayer(node, element) {
        if(!activePlayer(node) || !element?.querySelector('.gp-node-game')) return false;
        element.style.left=`${node.x}px`;element.style.top=`${node.y}px`;element.style.width=`${node.w || 440}px`;
        if(node.h) element.style.height=`${node.h}px`;
        element.classList.toggle('selected',selected.has(node.id));
        nodeBody(node,element.querySelector('.node-body'));
        return true;
    }
    const candidateSummary = c => ({candidateId:c.candidateId,kind:c.kind,mode:c.mode,status:c.status,stepCount:c.stepCount || 0,maxSteps:c.maxSteps || 0,failedChecks:c.failedChecks || 0,runtimeFailures:c.runtimeFailures || 0,completedFiles:c.completedFiles || 0,totalFiles:c.engineeringPlan?.files.length || 0,diagnostics:c.diagnostics,lastAction:c.trace?.at(-1)});
    const actionNames = {search:'搜索代码',read:'读取文件',edit:'修改文件',create:'新建文件',delete:'删除文件',move:'移动文件',check:'检查源码',playtest:'试玩回归',inspect_asset:'查看游戏资产',finish:'完成开发'};
    const traceLine = t => `${t.step}. ${actionNames[t.action] || t.action}${t.path ? ' · '+t.path : ''}：${typeof t.outcome === 'string' ? t.outcome : JSON.stringify(t.outcome)}`;
    function progressText(node) {
        const pending=progress.get(node.id), last=node.codeCandidate?.lastAction;
        if(pending) return `${pending.label} · 已等待 ${Math.floor((Date.now()-pending.started)/1000)} 秒${last ? '；上步：'+(actionNames[last.action] || last.action)+(last.path ? ' '+last.path : '') : ''}`;
        return notices.get(node.id) || (last ? traceLine(last) : '');
    }
    function updateProgress(node) {
        const target=statusTargets.get(node.id);
        if(target?.isConnected) target.textContent=progressText(node);
        logWindows.get(node.id)?.update();
    }
    async function openLogs(node) {
        if(logWindows.has(node.id)) {logWindows.get(node.id).dialog.focus();return;}
        const dialog=document.createElement('dialog');dialog.style.cssText='width:min(760px,90vw);max-height:80vh;overflow:auto';
        const title=document.createElement('h3');title.textContent='开发日志';
        const close=document.createElement('button');close.textContent='关闭';close.onclick=()=>dialog.close();
        const status=document.createElement('p'), pre=document.createElement('pre');pre.style.cssText='white-space:pre-wrap;max-height:55vh;overflow:auto';
        const update=()=>{
            status.textContent=progressText(node) || (busy.has(node.id) ? '正在准备开发…' : '当前没有正在执行的请求。');
            const c=logs.get(node.id), lines=c?.trace?.map(traceLine) || [];
            lines.push(...(c?.mcpTrace || []).map(t=>`MCP · ${t.name} · ${t.status==='completed'?'完成':'失败'}`));
            if(c?.kind==='engineering') lines.unshift(`文件进度 ${c.completedFiles || 0}/${c.engineeringPlan?.files.length || 0}`);
            lines.push(...(c?.diagnostics || []));
            const text=lines.join('\n') || '尚无已完成步骤。模型返回并执行后，记录会在这里更新。';
            if(pre.textContent!==text) {const follow=pre.scrollTop+pre.clientHeight>=pre.scrollHeight-24;pre.textContent=text;if(follow) pre.scrollTop=pre.scrollHeight;}
        };
        dialog.append(close,title,status,pre);document.body.append(dialog);logWindows.set(node.id,{dialog,update});update();dialog.showModal();
        // ponytail: reuse persisted candidate trace; no extra generation request or log service.
        let reading=false;
        const refresh=async()=>{
            if(reading || !node.codeCandidate) return;
            reading=true;
            try {const c=await request(node,`/code-candidates/${encodeURIComponent(node.codeCandidate.candidateId)}`);if(logWindows.get(node.id)?.dialog===dialog) {logs.set(node.id,c);update();}}
            catch(error) {status.textContent=error.message;}
            finally {reading=false;}
        };
        const timer=setInterval(()=>{update();if(!busy.has(node.id)) void refresh();},2000);
        dialog.addEventListener('close',()=>{clearInterval(timer);logWindows.delete(node.id);dialog.remove();},{once:true});
        await refresh();
    }
    const esc = value => escapeHtml(String(value ?? ''));
    const project = () => window.GamePipeline?.project;
    const incoming = node => connections.filter(c => c.to === node.id).map(c => nodes.find(n => n.id === c.from)).filter(n => n?.projectId === node.projectId);
    const button = (action, label) => `<button type="button" class="tool-btn" data-dev="${action}">${label}</button>`;
    function signature(node) {
        const p = project();
        return JSON.stringify({inputs: incoming(node).map(n => [n.id, n.type,
            n.type === 'gameTable' ? p?.tables?.find(t => t.id === n.tableId)?.revision : null]),
            plan: p?.plan?.revision, confirmed: p?.planConfirmed, sourceChanged:p?.planSourceChanged,
            assets:p?.assets.map(a => [a.id,a.revision,a.selected?.selectionId,a.selected?.contentHash,a.needsUpdate]),
            projectFiles:(p?.projectFiles||[]).map(f=>[f.id,f.contentHash]), playableGraph:p?.playableGraph,
            mediaAssets:(p?.mediaAssets || []).map(a=>[a.id,a.revision,a.enabled,a.contentHash]),
            tables:incoming(node).filter(n => n.type === 'gameTable').map(n => p?.tables?.find(t => t.id === n.tableId))});
    }
    function output(node, seen = new Set()) {
        if (!node || seen.has(node.id)) return null;
        seen.add(node.id);
        if (node.type === 'gameDevelop') return node.build || null;
        const sources = incoming(node);
        return sources.length === 1 ? output(sources[0], seen) : null;
    }
    function developer(node) {
        if (node.type === 'gameDevelop') return node;
        const sources = incoming(node);
        return sources.length === 1 && ['gameDevelop','gamePlay','gameTest'].includes(sources[0].type) ? developer(sources[0]) : null;
    }
    async function request(node, path, method = 'GET', data) {
        const p = project();
        if (!p || p.id !== node.projectId || p.canvasId !== canvas?.id) throw new Error('当前项目或画布已切换，请回到原项目。');
        const response = await fetch(`/api/game-projects/${encodeURIComponent(p.id)}${path}`, {
            method, headers:{'Content-Type':'application/json','X-Art-MCP':'1'}, ...(data === undefined ? {} : {body:JSON.stringify(data)})});
        const result = await response.json();
        if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : JSON.stringify(result.detail || '操作失败'));
        if (project()?.id !== p.id || canvas?.id !== p.canvasId) throw new Error('项目已切换，结果未写入当前节点。');
        return result;
    }
    function validate(node) {
        const p = project(), sources = incoming(node);
        if (!sources.some(n => n.type === 'gamePlan')) throw new Error('先将策划节点连接到开发节点。');
        const blocked=sources.filter(n=>n.type==='gamePlan').map(n=>window.GameWorkflow.planState(n)).find(state=>!state.ready);
        if(blocked)throw new Error(blocked.message);
        if (p.assets.length && !sources.some(n => n.type === 'gameAssets')) throw new Error('将美术资产节点连接到开发节点，再同步素材。');
        if (sources.some(n => n.tableDraft)) throw new Error('请先保存上游表格草稿。');
        if (p.assets.some(a => a.selected && a.needsUpdate)) throw new Error('已选美术有待更新项，请先在美术节点核对。');
    }
    function mergeLegacy() {
        const p = project();
        if (!p || p.archived || p.canvasId !== canvas?.id) return;
        let changed = false;
        for (const play of [...nodes].filter(n => n.type === 'gamePlay' && n.projectId === p.id)) {
            const outgoing = connections.filter(c => c.from === play.id);
            const test = outgoing.length === 1 && nodes.find(n => n.id === outgoing[0].to && n.type === 'gameTest' && n.projectId === p.id);
            if (!test || connections.filter(c => c.to === test.id).length !== 1) continue;
            if (!changed) pushUndo();
            for (const c of connections.filter(c => c.to === play.id)) c.to = test.id;
            connections.splice(connections.indexOf(outgoing[0]), 1);
            nodes.splice(nodes.indexOf(play), 1);
            changed = true;
        }
        if (changed) scheduleSave();
    }
    function chain(source) {
        const p = project();
        if (!p || p.id !== source.projectId || p.canvasId !== canvas?.id) throw new Error('请先载入当前项目。');
        mergeLegacy();
        pushUndo();
        const added = types.map((type, index) => {
            let node = nodes.find(n => n.projectId === p.id && n.type === type);
            if (!node) { node = {id:uid('node'), type, projectId:p.id, x:source.x + (index + 1) * 510, y:source.y}; nodes.push(node); }
            return node;
        });
        const link = (from, to) => { if (from && !connections.some(c => c.from === from.id && c.to === to.id)) connections.push({id:uid('c'),from:from.id,to:to.id}); };
        link(nodes.find(n => n.projectId === p.id && n.type === 'gamePlan'), added[0]);
        link(source, added[0]);
        for (let i = 1; i < added.length; i++) link(added[i - 1], added[i]);
        scheduleSave();
    }
    async function verifyBuild(node) {
        const build = output(node), dev = developer(node);
        if (!build || !dev) throw new Error('请连接开发节点并先构建试玩版本。');
        validate(dev);
        if (dev.builtInput !== signature(dev)) throw new Error('策划、美术或连线已变化，请先在开发节点更新试玩版本。');
        const workspace = await request(node, '/workspace');
        if (workspace.workspaceEpoch !== build.workspaceEpoch || workspace.revision !== build.workspaceRevision || project().revision !== build.projectRevision) throw new Error('工程或项目已变化，请先更新试玩版本，避免使用旧结果。');
        const list = await request(node, '/workspace/builds');
        if (!list.some(b => b.buildId === build.buildId && b.inputManifestHash === build.inputManifestHash)) throw new Error('固定构建已失效，请重新构建。');
        return build;
    }
    function panel(node, task, build) {
        document.getElementById('gameDevelopmentPanel')?.remove();
        const shell = document.createElement('dialog'); shell.id = 'gameDevelopmentPanel'; shell.className = 'gp-development-panel';
        const header = document.createElement('header'), title = document.createElement('strong'), close = document.createElement('button');
        title.textContent = task === 'preview' ? '试玩当前固定版本' : '游戏' + ({develop:'工作台',project:'源码',data:'数值',test:'测试',release:'交付'}[task] || '编辑');
        close.textContent = '返回画布'; close.className = 'tool-btn'; header.append(title, close);
        const frame = document.createElement('iframe'); frame.title = title.textContent;
        frame.referrerPolicy = 'no-referrer';
        frame.src = task === 'preview'
            ? `/api/game-projects/${encodeURIComponent(node.projectId)}/workspace/builds/${encodeURIComponent(build.buildId)}/preview?channel=${crypto.randomUUID()}`
            : `/static/game-workbench.html?projectId=${encodeURIComponent(node.projectId)}&embedded=1${build ? '&buildId=' + encodeURIComponent(build.buildId) : ''}#${task}`;
        if (task === 'preview') frame.setAttribute('sandbox', 'allow-scripts');
        shell.append(header, frame); document.body.append(shell);
        const dismiss = async () => {
            if (task !== 'preview' && !confirm('返回画布前，请确认已保存侧栏内的修改。关闭会放弃未保存输入。')) return;
            shell.close(); shell.remove(); await window.GamePipeline.canvasLoaded();
        };
        close.onclick = dismiss; shell.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
        shell.showModal();
    }
    async function advanceCandidate(node, c) {
        logs.set(node.id,c);
        notices.set(node.id,'等待模型响应与工具执行 · 正在连接后台开发任务');
        render();
        let task = node.developmentTask?.candidateId === c.candidateId ? node.developmentTask : null;
        if (task) {
            task = await request(node, `/development-tasks/${encodeURIComponent(task.taskId)}`);
            if (['paused','interrupted','failed'].includes(task.status)) task = await request(node, `/development-tasks/${encodeURIComponent(task.taskId)}/resume`, 'POST');
        } else task = await request(node, '/development-tasks', 'POST', {candidateId:c.candidateId,requestId:crypto.randomUUID()});
        notices.set(node.id,'等待模型响应与工具执行 · 后台任务已启动');
        await watchDevelopmentTask(node, task);
    }
    async function watchDevelopmentTask(node, task) {
        let cursor = 0, previousStep = -1;
        const active = status => ['running','pausing','cancelling'].includes(status);
        while (true) {
            node.developmentTask={taskId:task.taskId,candidateId:task.candidateId,status:task.status};
            scheduleSave();
            if (active(task.status) && (paused.has(node.id) || node.candidateInput !== signature(node) || (node.candidateInstruction || '').trim() !== (node.instruction || '').trim())) {
                task = await request(node, `/development-tasks/${encodeURIComponent(task.taskId)}/pause`, 'POST');
                paused.delete(node.id);
            }
            if (task.step !== previousStep || !active(task.status)) {
                const c = await request(node, `/code-candidates/${encodeURIComponent(task.candidateId)}`);
                logs.set(node.id,c); node.codeCandidate=candidateSummary(c); previousStep=task.step;
            }
            notices.set(node.id, active(task.status) ? `后台开发 · 已完成 ${task.step || 0} 步；关闭页面仍继续` :
                ({completed:'开发结束，请审阅候选；仍需完整玩法验收。',paused:'已暂停，可继续。',interrupted:'执行已中断，需显式继续。',cancelled:'任务已取消，候选保留。',stale:'输入已变化，请重新规划。',failed:'开发已停止，请查看候选诊断。'}[task.status] || task.status));
            render();
            updateProgress(node);
            if (!active(task.status)) break;
            cursor = task.nextCursor ?? task.cursor ?? cursor;
            await new Promise(resolve=>setTimeout(resolve,1500));
            if (project()?.id !== node.projectId || !nodes.includes(node)) return;
            task = await request(node, `/development-tasks/${encodeURIComponent(task.taskId)}?after=${cursor}`);
        }
        node.developmentTask.status=task.status; scheduleSave();
    }
    async function buildCurrent(node, workspace) {
        const input=signature(node);
        try {
            const build=await request(node, '/workspace/builds', 'POST', {baseRevision:workspace.revision});
            if (input !== signature(node)) throw new Error('构建时上游连线已变化，请重新构建。');
            node.build=build; node.builtInput=input; delete node.buildFailure;
            notices.set(node.id, `试玩版本已更新${build.missingRequiredAssets.length ? '；部分必需素材尚未选用' : ''}，尚未验证玩法。`);
        } catch (error) {
            try {
                const failure=await request(node, '/workspace/build-diagnostic');
                node.buildFailure=failure?.status === 'failed' && failure.repairable ? {repairable:true} : null;
            } catch (_) { node.buildFailure=null; }
            if(node.buildFailure?.repairable) throw new Error('构建未通过语法检查，可点击「修复构建问题」；详细诊断会带入修复任务。');
            throw error;
        } finally { scheduleSave(); }
    }
    async function execute(node, action) {
        if(action==='logs') {await openLogs(node);return;}
        if(action==='media') {await openMedia(node);return;}
        if(action==='stop-play') {const player=players.get(node.id);if(player) player.enabled=false;render();return;}
        if (busy.size) return;
        busy.add(node.id); notices.delete(node.id); render();
        try {
            await window.GamePipeline.workflow(async () => {
                if (action === 'review') {
                    const c = await request(node, `/code-candidates/${encodeURIComponent(node.codeCandidate.candidateId)}`);
                    node.codeCandidate=candidateSummary(c); scheduleSave();
                    const dialog = document.createElement('dialog'); dialog.style.cssText='width:min(900px,90vw);max-height:85vh;overflow:auto';
                    const close = document.createElement('button'); close.textContent='关闭'; close.onclick=()=>dialog.close(); dialog.append(close);
                    const title=document.createElement('h3'); title.textContent=c.engineeringPlan?.summary || c.summary || '代码候选'; dialog.append(title);
                    if(c.diagnostics?.length) {const diagnostic=document.createElement('p');diagnostic.textContent=c.diagnostics.join('；');dialog.append(diagnostic);}
                    if(c.trace?.length) { const log=document.createElement('details'), summary=document.createElement('summary'), text=document.createElement('pre'); summary.textContent='搜索、读取与检查记录'; text.style.whiteSpace='pre-wrap'; text.textContent=c.trace.map(t=>`${t.step}. ${t.action} ${t.path || ''} · ${typeof t.outcome === 'string' ? t.outcome : JSON.stringify(t.outcome)}`).join('\n'); log.append(summary,text); dialog.append(log); }
                    if(c.validation) {const result=document.createElement('p');result.textContent=c.validation.passed ? '加载清单与语法检查通过。' : JSON.stringify(c.validation.diagnostic);dialog.append(result);}
                    if(c.runtimeReports?.length) {const details=document.createElement('details'), summary=document.createElement('summary'), report=document.createElement('pre');summary.textContent='运行回归与失败证据';report.style.whiteSpace='pre-wrap';report.textContent=c.runtimeReports.map((run,i)=>`第 ${i+1} 次回归 · ${run.passed ? '通过' : '未通过'}\n${run.diagnostic || ''}\n`+(run.cases || []).map(test=>`${test.passed ? '✓' : '✗'} ${test.name}${test.error ? ' · '+test.error : ''}\n`+(test.assertions || []).filter(a=>!a.passed).map(a=>`  ${a.selector}：预期 ${a.text || a.kind}；实际 ${a.actual}`).join('\n')+'\n'+(test.log || []).map(l=>l.message).join('\n')).join('\n')).join('\n\n');details.append(summary,report); for(const run of c.runtimeReports) for(const test of run.cases || []) if(test.screenshot) {const img=document.createElement('img');img.style.maxWidth='100%';img.alt=test.name+' · 运行截图';img.src=`/api/game-projects/${encodeURIComponent(node.projectId)}/workspace/captures/${encodeURIComponent(test.screenshot.evidenceId)}`;details.append(img);}dialog.append(details);}
                    if(c.fileOperations?.length) {const text=document.createElement('p');text.textContent=c.fileOperations.map(o=>`${({create:'新增',delete:'删除',move:'移动'})[o.action]} ${o.path}${o.destination ? ' → '+o.destination : ''}`).join('；');dialog.append(text);}
                    const select=document.createElement('select'), pre=document.createElement('pre'); pre.style.cssText='white-space:pre-wrap;max-height:55vh;overflow:auto';
                    const entries=c.engineeringPlan ? [...c.engineeringPlan.files,...c.changes.filter(f=>!c.engineeringPlan.files.some(p=>p.path===f.path))] : c.changes;
                    entries.forEach(f=>{const o=document.createElement('option');o.value=f.path;o.textContent=({create:'新增 · ',delete:'删除 · ',edit:'修改 · '})[f.changeType] ? ({create:'新增 · ',delete:'删除 · ',edit:'修改 · '})[f.changeType]+f.path : f.path;select.append(o);});
                    let fullSource=false;
                    const show=()=>{const f=entries.find(f=>f.path===select.value), change=c.changes.find(f=>f.path===select.value);pre.textContent=(f?.purpose || '')+'\n'+(f?.interface || '')+'\n\n'+((!fullSource && c.diffs?.[select.value]) || (change?.content === null ? '此文件将在采用时删除。' : change?.content || '尚未生成'));};
                    if(c.kind === 'maintenance') {const toggle=document.createElement('button'); toggle.textContent='切换：修改差异 / 完整候选'; toggle.onclick=()=>{fullSource=!fullSource;show();};dialog.append(toggle);}
                    select.onchange=show; dialog.append(select,pre); document.body.append(dialog); dialog.addEventListener('close',()=>dialog.remove()); show(); dialog.showModal(); return;
                }
                if (action === 'development-chain') { chain(node); return; }
                if (action === 'template-3d') {
                    const workspace=await request(node,'/workspace');
                    if(!workspace.active) throw Error('请先准备工程');
                    if(!confirm('安装 3D 起步场景将替换当前游戏入口，并保存工程恢复点。确认继续？')) return;
                    await request(node,'/workspace/template-3d','POST',{baseRevision:workspace.revision});
                    delete node.build;delete node.codeCandidate;scheduleSave();notices.set(node.id,'已安装 3D 场景，请更新试玩版本；可继续让 AI 开发玩法。');return;
                }
                if (action === 'editor' || action === 'data') { panel(node, action === 'editor' ? 'develop' : 'data'); return; }
                if (action === 'test' || action === 'release' || action === 'play') {
                    const build = await verifyBuild(node);
                    if(action==='play') {activePlayer(node).enabled=true;return;}
                    panel(node, action === 'play' ? 'preview' : action, build); return;
                }
                if (action === 'refresh-tests' || action === 'feedback') {
                    const build = await verifyBuild(node), registry = await request(node, '/testing');
                    const runs = registry.runs.filter(r => r.plan.buildId === build.buildId && r.plan.inputManifestHash === build.inputManifestHash && r.plan.workspaceEpoch === build.workspaceEpoch);
                    if (action === 'feedback') {
                        const run = runs.at(-1);
                        const latest = new Map();
                        for (const attempt of run?.attempts || []) {
                            const key = attempt.caseId + ':' + attempt.profileId;
                            if (!latest.has(key) || latest.get(key).attempt < attempt.attempt) latest.set(key, attempt);
                        }
                        const failures = [...latest.values()].filter(a => ['failed','blocked'].includes(a.result));
                        if (!failures.length) throw new Error('当前版本最近一次测试没有可反馈的失败或阻塞项。');
                        const dev = developer(node);
                        const feedback = failures.map(a => `${a.caseId} / ${a.profileId}：${a.reason || a.result}`).join('\n');
                        dev.instruction = [dev.instruction, `测试反馈（${build.buildId} / ${run.testRunId}）：\n${feedback}`].filter(Boolean).join('\n\n').slice(0, 12000);
                        scheduleSave(); notices.set(node.id, '失败项已添加到开发节点的修改要求，尚未调用模型或修改代码。'); return;
                    }
                    node.testRun = runs.at(-1) ? {id:runs.at(-1).testRunId,state:runs.at(-1).state,buildId:build.buildId} : null;
                    notices.set(node.id, runs.length ? `当前版本有 ${runs.length} 条执行记录；${node.testRun.state}。不代表已批准交付。` : '当前版本尚无测试记录。'); scheduleSave(); return;
                }
                validate(node);
                let workspace = await request(node, '/workspace');
                if (action === 'setup') {
                    if (!workspace.active) workspace = await request(node, '/workspace', 'POST');
                    if (!workspace.files.some(f => f.path === 'game.js')) await request(node, '/workspace/template', 'POST', {baseRevision:workspace.revision});
                    notices.set(node.id, '工程已就绪。模板仅作起点，请按策划修改后试玩。'); return;
                }
                if (!workspace.active) throw new Error('请先点击上方「准备工程（首次使用）」，完成后再生成代码或构建试玩。');
                if (action === 'build') { await buildCurrent(node, workspace); return; }
                if (action === 'modify' || action === 'repair') {
                    const model=window.GameWorkflow.selectedChatModel(node);
                    if (!model) throw new Error('请先选择已配置的聊天模型。');
                    const instruction=node.instruction?.trim() || '';

                    if(!confirm('模型将按需搜索工程、增删移动文件，并在独立浏览器观察画面、运行回归，最多调用32步；关闭页面仍继续，可暂停。候选不会自动采用，可能产生多次渠道费用，是否继续？')) return;
                    const input=signature(node);
                    const c=await request(node, '/code-candidates/maintenance', 'POST', {baseRevision:workspace.revision,requestId:crypto.randomUUID(),instruction:instruction || (action === 'repair' ? '修复当前构建诊断中的源码语法错误，保留原有玩法和其他正确实现。' : '根据已确认策划开发首个可玩版本，按需新建或修改模块，完成核心操作、胜负与重开并用行为回归验证。'),mode:action === 'repair' ? 'repair' : 'edit',provider:model.provider,model:model.model,maxSteps:32});
                    delete node.developmentTask;
                    node.codeCandidate=candidateSummary(c); node.candidateInput=input; node.candidateInstruction=instruction; scheduleSave(); render();
                    paused.delete(node.id); await advanceCandidate(node,c); return;
                }
                if (action === 'generate') {
                    const model = window.GameWorkflow.selectedChatModel(node);
                    if (!model) throw new Error('请先选择已配置的聊天模型。');
                    if (!confirm('调用所选模型规划多文件工程，可能产生渠道费用。候选不会自动应用，是否继续？')) return;
                    const input = signature(node);
                    const instruction = node.instruction?.trim() || '';
                    const tables = incoming(node).filter(n => n.type === 'gameTable').map(n => project().tables.find(t => t.id === n.tableId));
                    const assets = project().assets.map(a => ({id:a.id,name:a.name,kind:'image',usage:a.usage,purpose:a.purpose,selected:!!a.selected})).concat((project().mediaAssets || []).map(a=>({id:a.id,name:a.name,kind:a.kind,usage:'runtime',purpose:a.purpose,selected:a.enabled,metadata:a.metadata})));
                    const candidate = await request(node, '/code-candidates/engineering-plan', 'POST', {baseRevision:workspace.revision,requestId:crypto.randomUUID(), provider:model.provider,model:model.model,
                        instruction:JSON.stringify({request:instruction || '根据已连接并确认的策划，实现首个可玩版本：优先完成策划中的核心玩法、主要操作、胜负与重开以及验收条目；保留已有正确实现，只修改本次必要的代码。',tables,assets,runtime:'window.GAME_CONFIG.assets[assetId] 为已选运行时图片的 data URL；content 为角色/敌人/关卡表。仅使用已选运行时素材；概念图只作参考，不作为运行素材。'})});
                    delete node.developmentTask;
                    node.codeCandidate = candidateSummary(candidate); node.candidateInput = input; node.candidateInstruction = instruction; scheduleSave();
                    notices.set(node.id, candidate.status === 'planned' ? '工程方案已就绪，可查看方案并分文件生成。' : candidate.diagnostics.join('；')); return;
                }
                if (action === 'continue') {
                    if (node.candidateInput !== signature(node) || (node.candidateInstruction || '').trim() !== (node.instruction || '').trim()) throw new Error('输入已变化，请重新规划。');
                    if (!confirm('按工程方案逐文件调用模型，可能产生多次渠道费用。失败后保留进度，不自动重试。是否继续？')) return;
                    paused.delete(node.id);
                    let c = await request(node, `/code-candidates/${encodeURIComponent(node.codeCandidate.candidateId)}`);
                    await advanceCandidate(node,c); return;
                }
                if (action === 'apply') {
                    const c = node.codeCandidate;
                    if(c?.kind === 'engineering' && c.status === 'ready') {if(!confirm('采用前需调用模型补充运行回归，可能产生渠道费用，是否继续？')) return; const updated=await request(node, `/code-candidates/${encodeURIComponent(c.candidateId)}/next`, 'POST', {completed:c.completedFiles}); paused.delete(node.id); await advanceCandidate(node,updated); return;}
                    if (c?.status !== 'ready') throw new Error('没有可采用的代码候选。');
                    if (node.candidateInput !== signature(node)) throw new Error('上游已变化，请重新生成候选。');
                    if ((node.candidateInstruction || '').trim() !== (node.instruction || '').trim()) throw new Error('修改要求已变化，请重新生成候选。');
                    if (!confirm('确认已审阅候选？采用后保存恢复点，仍需重新构建与实际测试。')) return;
                    const applied=await request(node, `/code-candidates/${encodeURIComponent(c.candidateId)}/apply`, 'POST', {baseRevision:workspace.revision});
                    delete node.codeCandidate; delete node.build; scheduleSave(); notices.set(node.id, '已采用代码，尚未验证；请更新试玩版本。');
                    if(c.kind === 'maintenance') await buildCurrent(node, applied);
                }
            });
        } catch (error) { notices.set(node.id, error.message); }
        finally { busy.delete(node.id); updateProgress(node); render(); }
    }
    async function openMedia(node) {
        const dialog=document.createElement('dialog');dialog.style.cssText='width:min(700px,90vw);max-height:80vh;overflow:auto';
        const close=document.createElement('button');close.textContent='关闭';close.onclick=()=>dialog.close();
        const title=document.createElement('h3');title.textContent='游戏资产';
        const help=document.createElement('p');help.textContent='导入图片、MP3/WAV/OGG 或自包含 GLB。勾选的资产可供 AI 使用；替换文件保留资产 ID，旧试玩版本需重新构建。';
        const input=document.createElement('input');input.type='file';input.multiple=true;input.accept='.png,.jpg,.jpeg,.webp,.mp3,.wav,.ogg,.glb';input.setAttribute('aria-label','导入游戏资产');
        const status=document.createElement('p'),list=document.createElement('div');let saving=false;
        const mutate=async task=>{if(saving)return;saving=true;input.disabled=true;status.textContent='正在保存资产…';try{await window.GamePipeline.workflow(task);status.textContent='已保存；请更新试玩版本。';draw();}catch(error){status.textContent=error.message;}finally{saving=false;input.disabled=false;}};
        const upload=async(files,assetId)=>{
            await mutate(async ctx=>{for(const file of files){
                if(!file.size || file.size>(file.name.toLowerCase().endsWith('.glb')?100:32)*1024*1024) throw Error('模型最大 100 MiB，图片/音频最大 32 MiB，文件不能为空');
                const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('文件读取失败'));reader.readAsDataURL(file);});
                const old=ctx.project.mediaAssets?.find(a=>a.id===assetId);
                await ctx.write('/workspace/media-assets','POST',{filename:file.name,purpose:old?.purpose || file.name,contentBase64:encoded,...(assetId?{assetId}:{})});
            }});
        };
        const draw=()=>{
            list.replaceChildren();
            for(const asset of project()?.mediaAssets || []) {
                const row=document.createElement('article');row.style.cssText='padding:12px 0;border-bottom:1px solid #8884;display:grid;gap:8px';
                const label=document.createElement('label'),enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=asset.enabled;label.append(enabled,document.createTextNode(` ${asset.name} · ${{image:'图片',audio:'音频',model:'3D模型'}[asset.kind]} · ${(asset.sizeBytes/1024/1024).toFixed(2)} MiB`));
                const purpose=document.createElement('input');purpose.value=asset.purpose;purpose.setAttribute('aria-label',asset.name+'的用途');purpose.placeholder='告诉 AI 这个素材的用途，例如主角、背景音乐、跳跃音效';
                const save=document.createElement('button');save.textContent='保存用途与启用状态';save.onclick=()=>mutate(ctx=>ctx.write('/workspace/media-assets/'+encodeURIComponent(asset.id),'PATCH',{enabled:enabled.checked,purpose:purpose.value.trim() || asset.name}));
                const replace=document.createElement('input');replace.type='file';replace.accept=input.accept;replace.setAttribute('aria-label','替换'+asset.name);replace.onchange=()=>{if(replace.files?.length)void upload([...replace.files],asset.id);};
                const info=document.createElement('small');info.textContent='ID：'+asset.id+(asset.metadata?.animations?.length ? ' · 动画：'+asset.metadata.animations.join('、') : '');
                row.append(label,purpose,save,replace,info);list.append(row);
            }
            if(!project()?.mediaAssets?.length)list.textContent='尚未导入。现有美术节点中已选的图片仍可直接使用。';
        };
        input.onchange=()=>{if(input.files?.length)void upload([...input.files]);};
        dialog.append(close,title,help,input,status,list);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});draw();dialog.showModal();
    }
    function nodeBody(node, target) {
        const p = project(); target.classList.add('gp-work-node');
        if (!p || p.id !== node.projectId) { target.textContent = '请载入此节点所属项目。'; return; }
        if (p.archived) { target.textContent = '项目已归档。'; return; }
        const build = output(node), dev = developer(node), stale = dev?.builtInput && dev.builtInput !== signature(dev);
        const context = `<p>${incoming(node).map(n => esc(({gamePlan:'策划',gameAssets:'美术素材',gameTable:'配置表',gameDevelop:'开发版本',gamePlay:'试玩版本',gameTest:'测试记录'})[n.type] || n.type)).join(' · ') || '尚未连接上游'}</p>`;
        let body;
        if (node.type === 'gameDevelop') {
            body = `${context}<p>策划 ${esc(incoming(node).filter(n=>n.type==='gamePlan').map(n=>window.GameWorkflow.planState(n)).find(state=>!state.ready)?.label || (p.planConfirmed ? '已确认' : '待确认'))} · 已选素材 ${p.assets.filter(a=>a.selected).length}/${p.assets.length}</p><label>补充要求（可选）<textarea data-instruction placeholder="留空按已确认策划生成；也可填写本次修改要求">${esc(node.instruction)}</textarea></label>${button('setup','准备工程（首次使用）')}${button('modify','开发 / 修改游戏')}<details><summary>模型与工程工具</summary>${button('generate','规划多文件工程')}${window.GameWorkflow.controls({...node,type:'document'})}${button('data','调整运行数值')}</details>${button('editor','打开游戏工作台')}${node.codeCandidate ? `<p>${node.codeCandidate.kind === 'maintenance' ? `开发步骤 ${node.codeCandidate.stepCount}/${node.codeCandidate.maxSteps}` : `工程进度 ${node.codeCandidate.completedFiles || 0}/${node.codeCandidate.totalFiles || 0}`} · ${esc(({working:'开发中',planned:'方案就绪',generating:'处理中',ready:'待审阅',failed:'已停止',stale:'输入已变化',interrupted:'已中断',unchanged:'无需修改'})[node.codeCandidate.status] || node.codeCandidate.status)}</p>${button('review','查看方案与代码')}${(node.codeCandidate.totalFiles || node.codeCandidate.maxSteps) && (node.codeCandidate.kind !== 'maintenance' || (node.codeCandidate.stepCount < node.codeCandidate.maxSteps && node.codeCandidate.failedChecks < 3 && node.codeCandidate.runtimeFailures < 3)) && !['ready','applied','stale','unchanged'].includes(node.codeCandidate.status) ? (busy.has(node.id) ? button('pause','暂停生成') : button('continue','继续处理')) : ''}${node.codeCandidate.status === 'ready' ? button('apply','采用已审阅工程') : ''}` : ''}${button('build','更新试玩版本')}${node.buildFailure?.repairable ? button('repair','修复构建问题') : ''}`;
        } else if (node.type === 'gamePlay') body = `${context}<p>键鼠试玩当前固定版本；是否满足策划仍需实际验收。</p>${button('play','开始试玩')}`;
        else if (node.type === 'gameTest') body = `${window.GameExtraNodes?.modeControl(node)||''}<details><summary>测试与问题反馈</summary><p>${node.testRun && build && node.testRun.buildId === build.buildId ? '执行状态：' + esc(node.testRun.state) : '当前版本尚未读取测试记录'}</p>${button('test','准备与执行测试')}${button('refresh-tests','读取当前版本结果')}${button('feedback','将失败项反馈给开发')}</details>`;
        else body = `${context}<p>核对测试、来源和许可证后交付。未通过检查不能导出正式包。</p>${button('release','检查并交付')}`;
        const content = `${body}${node.type==='gameDevelop' ? button('media',`游戏资产 · ${(p.mediaAssets || []).filter(a=>a.enabled).length} 项已接入`)+(p.mediaAssets?.some(a=>a.enabled && a.kind==='model') ? button('template-3d','安装 3D 起步场景') : '') : ''}${node.type==='gameDevelop' && node.codeCandidate ? button('logs','查看开发日志') : ''}<small>${build ? `固定版本 r${build.workspaceRevision} · ${esc(build.buildId.slice(-6))}` : '尚无开发构建'}${stale ? ' · 上游已变化，需要更新' : ''}</small><p role="status">${esc(progressText(node) || (busy.has(node.id) ? '正在处理…' : ''))}</p>`;
        const controls=target.querySelector('[data-game-controls]');
        if(controls) controls.innerHTML=content;
        else target.innerHTML=`<div data-game-controls>${content}</div>`;
        const player=activePlayer(node), existing=target.querySelector('.gp-node-game');
        let screen=target.querySelector('.gp-game-screen');
        if(['gameTest','gamePlay'].includes(node.type) && !screen) {screen=document.createElement('div');screen.className='gp-game-screen';target.append(screen);}
        if(screen) {
            screen.querySelector('.gp-game-switch')?.remove();screen.querySelector('.gp-game-hint')?.remove();
            const toggle=document.createElement('button');toggle.className='gp-game-switch';toggle.textContent='⏻';toggle.setAttribute('aria-label',player?.enabled ? '暂停试玩' : '开启试玩');toggle.title=player?.enabled ? '暂停试玩' : '开启试玩';toggle.disabled=!player;toggle.setAttribute('aria-pressed',String(!!player?.enabled));toggle.onclick=e=>{e.stopPropagation();void execute(node,player?.enabled ? 'stop-play' : 'play');};screen.append(toggle);
            if(!player?.enabled) {const hint=document.createElement('div');hint.className='gp-game-hint';hint.textContent=player ? '点击 ⏻ 开始试玩' : '连接开发节点并更新试玩版本';screen.append(hint);}
        }
        if(!player) existing?.remove();
        else if(!existing || existing.dataset.channel!==player.channel) {
            existing?.remove();
            const frame=document.createElement('iframe');frame.className='gp-node-game';frame.title='节点内游戏试玩';frame.dataset.channel=player.channel;
            frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';
            frame.src=`/api/game-projects/${encodeURIComponent(node.projectId)}/workspace/builds/${encodeURIComponent(player.buildId)}/preview?channel=${encodeURIComponent(player.channel)}&embedded=true`;
            frame.onload=()=>frame.contentWindow?.postMessage({type:'game-node-control',channel:player.channel,enabled:player.enabled},'*');
            screen.append(frame);
        }
        const frame=screen?.querySelector('.gp-node-game');
        if(frame && player) {frame.style.pointerEvents=player.enabled ? 'auto' : 'none';frame.tabIndex=player.enabled ? 0 : -1;if(frame.dataset.enabled!==String(player.enabled)){frame.dataset.enabled=String(player.enabled);frame.contentWindow?.postMessage({type:'game-node-control',channel:player.channel,enabled:player.enabled},'*');}}
        window.GameExtraNodes?.bindMode(node,target);
        statusTargets.set(node.id,target.querySelector('[role="status"]'));
        target.querySelector('[data-instruction]')?.addEventListener('input', e => { node.instruction = e.target.value; scheduleSave(); });
        target.querySelector('[data-chat-model]')?.addEventListener('change', e => { const [provider,model] = JSON.parse(e.target.value); Object.assign(node,{provider,model}); scheduleSave(); });
        target.querySelectorAll('[data-dev]').forEach(el => { el.disabled = busy.size > 0 && !['pause','logs','stop-play'].includes(el.dataset.dev); el.onclick = e => { e.stopPropagation(); if (el.dataset.dev === 'pause') { paused.add(node.id); notices.set(node.id,'正在请求暂停后台开发'); return; } execute(node,el.dataset.dev); }; });
        if(node.developmentTask && ['running','pausing','cancelling'].includes(node.developmentTask.status) && !busy.has(node.id)) {
            busy.add(node.id);
            void watchDevelopmentTask(node,node.developmentTask).catch(error=>{node.developmentTask.status='disconnected';notices.set(node.id,error.message+'；后台任务不受断线影响，可点击继续重新连接。');}).finally(()=>{busy.delete(node.id);render();});
        }
        target.onwheel = e => e.stopPropagation();
    }
    window.GameDevelopment = {openWorkbench:projectId=>panel({projectId},'develop'),resetPlayer:node=>players.delete(node.id),nodeBody, execute, signature, output, mergeLegacy, activePlayer, preservePlayer};
})();
