/* 场景工作区：复用现有建模链路，未接通阶段不发起任务。 */
(() => {
const steps = [['model','box','建模'],['uv','scan','UV'],['material','palette','材质'],['scene','layout-dashboard','布局'],['lighting','sun','灯光'],['render','camera','渲染']];
function body(node, legacyBody){
    const root = document.createElement('div');
    root.className = 'blender-workspace';
    const selected = steps.find(s => s[0] === node.workspaceStep) || steps[0];
    root.innerHTML = `<nav class="bw-nav" aria-label="制作工序">${steps.map(([id,icon,label]) => `<button type="button" data-step="${id}" title="${label}" aria-label="${label}" aria-pressed="${selected[0]===id}" class="${selected[0]===id?'active':''}"><i data-lucide="${icon}"></i><span>${label}</span></button>`).join('')}</nav><section class="bw-content"><header><strong>${selected[2]}</strong><button type="button" class="bw-expand" title="${node.workspaceExpanded?'收起':'展开'}工作区" aria-label="切换工作区大小"><i data-lucide="maximize-2"></i></button></header><div class="bw-preview"></div><div class="bw-editor"></div></section>`;
    root.classList.toggle('expanded', !!node.workspaceExpanded);
    const preview = root.querySelector('.bw-preview');
    const url = window.BlenderGenNode.previewUrl(node) || (node.status === 'awaiting_approval' && node.jobId
        ? '/api/dcc/jobs/' + encodeURIComponent(node.jobId) + '/products/model.glb?stage=blockout' : '');
    if(!url) preview.innerHTML = '<i data-lucide="box"></i><span>连接参考或模型开始制作</span>';
    const editor = root.querySelector('.bw-editor');
    if(selected[0] === 'model'){
        const controls = legacyBody(node);
        controls.classList.add('bw-model-controls');
        // 旧面板先生成缓存查看器，再搬到主预览，避免同 id 的 DOM 被移回隐藏区域。
        const modelMain = document.createElement('div');
        modelMain.className='bw-model-main';
        const stage = controls.querySelector('.blender-stage');
        if(stage && url){
            while(stage.firstChild) modelMain.appendChild(stage.firstChild);
            preview.appendChild(modelMain);
            stage.remove();
        }
        // 主图和缩略图分离，点击只切换查看，不改变参考用途或建模输入。
        const refs = controls.querySelector('.blender-refs');
        if(refs || url){
            const strip = refs || document.createElement('div');
            strip.classList.add('blender-refs');
            if(!url) preview.replaceChildren();
            preview.classList.add('bw-has-references');
            const image = document.createElement('img');
            image.className='bw-reference-main'; image.draggable=false;
            preview.appendChild(image);
            const links = Array.from(strip.querySelectorAll('.blender-ref'));
            let modelButton=null;
            const show = value => {
                const active = links.find(link => link.getAttribute('href') === value);
                image.hidden=!active;
                modelMain.hidden=!!active;
                if(modelButton){ modelButton.classList.toggle('active', !active); modelButton.setAttribute('aria-pressed', String(!active)); }
                preview.classList.toggle('bw-show-reference', !!active);
                if(active){ image.src=active.getAttribute('href'); image.alt=active.querySelector('img')?.alt || '参考图'; }
                links.forEach(link => {
                    const selected=link === active;
                    link.classList.toggle('active', selected);
                    link.setAttribute('aria-pressed', String(selected));
                });
                node.workspaceReferenceUrl=active ? value : '';
            };
            links.forEach(link => {
                link.title='预览参考图'; link.setAttribute('role','button');
                link.onclick=e => { e.preventDefault(); e.stopPropagation(); show(link.getAttribute('href')); scheduleSave(); };
                link.onpointerdown=e => e.stopPropagation();
                link.onkeydown=e => { if(e.key === ' '){ e.preventDefault(); link.click(); } };
            });
            if(url){
                modelButton=document.createElement('button');
                modelButton.type='button'; modelButton.className='blender-ref bw-model-thumbnail';
                const thumbnail=document.createElement('model-viewer');
                thumbnail.setAttribute('src',url);
                thumbnail.setAttribute('alt','模型参考');
                thumbnail.setAttribute('aria-hidden','true');
                thumbnail.setAttribute('interaction-prompt','none');
                thumbnail.setAttribute('loading','eager');
                modelButton.appendChild(thumbnail);
                modelButton.title='查看模型'; modelButton.setAttribute('aria-label','查看模型');
                modelButton.onclick=e => { e.stopPropagation(); show(''); scheduleSave(); };
                modelButton.onpointerdown=e => e.stopPropagation();
                strip.prepend(modelButton);
            }
            preview.appendChild(strip);
            const chosen=links.find(link => link.getAttribute('href') === node.workspaceReferenceUrl);
            show(chosen ? chosen.getAttribute('href') : (!url ? links[0]?.getAttribute('href') : ''));
        }
        controls.querySelector('.blender-ref-hint')?.remove();
        editor.appendChild(controls);
        const qa = controls.querySelector('.blender-qa');
        if(qa){
            const report = document.createElement('details');
            const label = document.createElement('summary'); label.textContent='质量报告';
            report.className='bw-settings'; report.appendChild(label); report.appendChild(qa);
            controls.appendChild(report);
        }
    } else {
        if(url) preview.appendChild(model3dViewerElement({id:node.id, url, spinPaused:node.spinPaused}));
        editor.innerHTML = `<div class="bw-unavailable"><i data-lucide="construction"></i><strong>${selected[2]}尚未接通</strong><span>当前可使用建模；本页不会调用其他工序。</span></div>`;
    }
    root.querySelectorAll('[data-step]').forEach(button => {
        button.onclick = e => { e.stopPropagation(); node.workspaceStep=button.dataset.step; scheduleSave(); render(); };
        button.onpointerdown = e => e.stopPropagation();
    });
    root.querySelector('.bw-expand').onclick = e => {
        e.stopPropagation();
        if(!node.workspaceExpanded){
            node.workspaceCompactSize = {w:node.w || 360,h:node.h || 512};
            node.w=600; node.h=760;
        } else {
            node.w=node.workspaceCompactSize?.w || 360; node.h=node.workspaceCompactSize?.h || 512;
        }
        node.workspaceExpanded=!node.workspaceExpanded; scheduleSave(); render();
    };
    return root;
}
window.BlenderWorkspace = {body, steps};
})();
