(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const labels = {image:'在线生图',comfy:'ComfyUI',video:'视频',audio:'语音',succeeded:'成功',failed:'失败',running:'进行中',interrupted:'结果未知'};
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let page = 1, current = null, controller = null;
    const fields = ['start','end','user','kind','provider','model','status'];
    function params() { const q = new URLSearchParams(); fields.forEach(k => { if ($(k).value) q.set(k,$(k).value); }); q.set('page',page); return q; }
    function localDate(date) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date); }
    function range(days) {
        const now = new Date(); $('end').value = days ? localDate(now) : '';
        $('start').value = days ? localDate(new Date(now.getTime()-(days-1)*86400000)) : '';
        document.querySelectorAll('[data-days]').forEach(b => b.classList.toggle('selected',Number(b.dataset.days)===days));
    }
    const duration = ms => ms == null ? '—' : ms < 60000 ? `${(ms/1000).toFixed(1)} 秒` : `${(ms/60000).toFixed(1)} 分钟`;
    function options(data) {
        ['user','kind','provider','model'].forEach(k => {
            const value = $(k).value, first = $(k).options[0].text;
            $(k).innerHTML = `<option value="">${esc(first)}</option>` + data.options[k].map(v => `<option value="${esc(v)}">${esc(labels[v] || v)}</option>`).join('');
            $(k).value = value;
        });
        $('user-field').hidden = data.scope !== 'all';
        $('scope').textContent = data.scope === 'all' ? '全部用户 · 汇总访问本服务的局域网生成记录' : '我的生成 · 仅显示当前登录账号的记录';
    }
    function render(data) {
        current = data; const s = data.summary;
        const cards = [['生成任务',s.total,'当前筛选范围'],['成功率',s.success_rate == null ? '—' : `${s.success_rate}%`,`${s.succeeded} 成功 / ${s.failed} 失败`],['生成产物',s.outputs,'按实际返回媒体数量统计'],['平均耗时',duration(s.avg_ms),'仅统计成功任务'],['参与用户',s.users,'当前范围内活跃用户'],['未完成',s.running+s.interrupted,`${s.running} 进行中 / ${s.interrupted} 未知`]];
        $('metrics').innerHTML = cards.map(([label,value,note]) => `<article class="metric"><label>${label}</label><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join('');
        options(data);
        const max = Math.max(1,...data.trend.map(d=>d.total));
        $('trend').innerHTML = data.trend.length ? data.trend.map(d => `<div class="day" title="${esc(d.day)}：${d.total} 次，成功 ${d.succeeded}，失败 ${d.failed}"><div class="bars"><div class="bar pending" style="height:${(d.total-d.succeeded-d.failed)/max*145}px"></div><div class="bar failure" style="height:${d.failed/max*145}px"></div><div class="bar" style="height:${d.succeeded/max*145}px"></div></div><small>${esc(d.day.slice(5))}</small></div>`).join('') : '<p class="empty">暂无生成记录</p>';
        const peak = Math.max(1,...data.groups.model.map(x=>x.total));
        $('models').innerHTML = data.groups.model.map(x=>`<div class="rank-row"><div class="rank-label"><span title="${esc(x.name)}">${esc(x.name || '未指定模型')}</span><b>${x.total}</b></div><div class="track"><div style="width:${x.total/peak*100}%"></div></div></div>`).join('') || '<p class="empty">暂无模型用量</p>';
        $('users').innerHTML = data.groups.user.map(x=>`<div class="user-card"><strong>${esc(x.name)}</strong><span>${x.total} 次 · ${x.succeeded} 成功 · ${x.failed} 失败 · ${x.outputs} 个产物</span></div>`).join('') || '<p class="empty">暂无用户用量</p>';
        $('records').innerHTML = data.records.map((r,i)=>`<tr><td>${esc(new Date(r.started*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))}</td><td>${esc(r.user)}</td><td>${esc(labels[r.kind] || r.kind)}<small>${esc(r.provider || '—')}</small></td><td title="${esc(r.model)}">${esc(r.model || '未指定')}</td><td><span class="badge ${esc(r.status)}">${esc(labels[r.status] || r.status)}</span></td><td>${duration(r.elapsed_ms)}</td><td>${r.output_count}</td><td><button data-detail="${i}">详情</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">当前条件下没有记录</td></tr>';
        const pages = Math.max(1,Math.ceil(s.total/data.page_size));
        $('total').textContent = `共 ${s.total} 条任务`;
        $('paging').textContent = `第 ${data.page} / ${pages} 页 · 每页 ${data.page_size} 条`;
        $('prev').disabled = page <= 1; $('next').disabled = page >= pages;
        $('updated').textContent = '更新于 ' + new Date().toLocaleTimeString('zh-CN',{hour12:false});
    }
    async function load() {
        if(controller) controller.abort(); controller = new AbortController();
        $('message').textContent = ''; $('refresh').disabled = true;
        try { const response = await fetch('/api/generation-data?'+params(),{signal:controller.signal}); const data = await response.json(); if(!response.ok) throw new Error(data.detail || '读取失败'); render(data); }
        catch(e) { if(e.name !== 'AbortError') { $('message').textContent = e.message; $('metrics').innerHTML=''; $('records').innerHTML=''; current=null; } }
        finally { $('refresh').disabled = false; }
    }
    $('filters').addEventListener('submit',e=>{e.preventDefault(); page=1; load();});
    document.querySelectorAll('[data-days]').forEach(b=>b.addEventListener('click',()=>{range(Number(b.dataset.days));page=1;load();}));
    $('refresh').onclick = load;
    $('prev').onclick = ()=>{if(page>1){page--;load();}};
    $('next').onclick = ()=>{page++;load();};
    $('records').addEventListener('click',e=>{const button=e.target.closest('[data-detail]');if(!button || !current)return; const record=current.records[Number(button.dataset.detail)]; $('detail-content').textContent=JSON.stringify(record,null,2);$('detail').showModal();});
    $('close-detail').onclick = ()=>$('detail').close();
    $('export').onclick = async()=>{try{const q=params();q.set('export','true');const response=await fetch('/api/generation-data?'+q);if(!response.ok){const error=await response.json();throw new Error(error.detail || '导出失败');}const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download='生成数据.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){$('message').textContent=e.message;}};
    range(7); load();
    setInterval(()=>{if(!document.hidden && current?.summary.running && !$('detail').open)load();},10000);
})();
