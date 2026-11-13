/* MiniMax 节点（minimax）：MiniMax H3 多段视频工作台，支持 ComfyUI 本地与 RunningHub 云端两种引擎。
 *
 * 目录内三个文件（加载顺序即此顺序，都在 canvas.js 之前）：
 *   helpers.js     29 个纯工具函数，挂 window.MiniMaxHelpers
 *   runninghub.js  RunningHub 云端工作流，挂 window.MiniMaxRunningHub
 *   index.js       本文件：工作台 UI + 节点 body/run，挂 window.MiniMaxNode
 *
 * 依赖约定见 static/nodes/README.md：
 *   - 画布状态走 deps：nodes / viewport，均只读
 *   - 创建函数 addMiniMaxNode 仍在宿主「节点创建与菜单」区，与其余节点一致
 */
(() => {
let deps = null;

function getNodes(){ return deps.nodes(); }
function getViewport(){ return deps.viewport(); }

const { miniMaxActiveSegmentAt, miniMaxApplyTimelineTime, miniMaxCompactSegments, miniMaxDownloadItem, miniMaxDynamicParams, miniMaxEngine, miniMaxExplicitRefsForSegment, miniMaxLogError, miniMaxReadableError, miniMaxRefsForNode, miniMaxRefsForSegment, miniMaxSegmentRefsByKind, miniMaxSelectedSegment, miniMaxSetSegmentResult, miniMaxTimelineTotal, miniMaxUniqueRefs } = window.MiniMaxHelpers;

function bindMiniMaxWorkbench(wrap, node){
    wrap.querySelectorAll('button,select,input,textarea,.minimax-tl-clip,.minimax-ref-clip,.minimax-material-card').forEach(el => {
        el.onmousedown = e => e.stopPropagation();
        el.onclick = el.onclick || (e => e.stopPropagation());
    });
    wrap.querySelectorAll('[data-minimax-pane-resize]').forEach(handle => {
        handle.onmousedown = e => miniMaxStartPaneResize(e, node, handle.dataset.minimaxPaneResize);
    });
    const addRefToSegment = (seg, item) => {
        if(!seg || !item?.url) return false;
        const kind = mediaKindForRef(item);
        const limits = {image:CANVAS_MINIMAX_REF_IMAGE_MAX, video:CANVAS_MINIMAX_REF_VIDEO_MAX, audio:CANVAS_MINIMAX_REF_AUDIO_MAX};
        if(!limits[kind]) return false;
        const current = miniMaxUniqueRefs(seg.refs || []);
        if(current.some(ref => ref.url === item.url)) return false;
        if(current.filter(ref => mediaKindForRef(ref) === kind).length >= limits[kind]) return false;
        seg.refs = miniMaxUniqueRefs([...current, {...item, kind}]);
        return true;
    };
    const assetsForNode = () => miniMaxUniqueRefs([...node.segments.flatMap(seg => seg.refs || []), ...miniMaxRefsForNode(node).refs]).slice(0, 36);
    const resolveDroppedMiniMaxItem = dataTransfer => {
        const assetIndex = Number(dataTransfer?.getData('application/x-canvas-minimax-asset-index'));
        if(Number.isFinite(assetIndex)) return {item:assetsForNode()[assetIndex], mode:'ref'};
        const materialIndex = Number(dataTransfer?.getData('application/x-canvas-minimax-material-index'));
        if(Number.isFinite(materialIndex)) return {item:node.materials?.[materialIndex], mode:'result'};
        const canvasUrl = dataTransfer?.getData('application/x-canvas-output-image') || dataTransfer?.getData('text/uri-list') || dataTransfer?.getData('text/plain') || '';
        const url = String(canvasUrl || '').split(/\r?\n/).find(Boolean) || '';
        return url ? {item:{url, name:canvasFileNameFromUrl(url) || 'asset', kind:mediaKindForRef({url})}, mode:'ref'} : null;
    };
    wrap.querySelectorAll('[data-minimax-scrub-track], .minimax-ruler, .minimax-video-track').forEach(track => {
        track.onmousedown = e => {
            if(e.button !== 0 || e.target.closest('button,.minimax-tl-clip,.minimax-ref-clip,.minimax-pane-resize')) return;
            e.preventDefault();
            e.stopPropagation();
            const content = wrap.querySelector('.minimax-ruler .minimax-track-content') || track;
            const rect = content.getBoundingClientRect();
            const setFromEvent = ev => {
                ev.preventDefault?.();
                const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
                miniMaxApplyTimelineTime(wrap, node, ratio * miniMaxTimelineTotal(node));
            };
            const onMove = move => setFromEvent(move);
            const onUp = () => {
                window.removeEventListener('mousemove', onMove, true);
                window.removeEventListener('mouseup', onUp, true);
                window.removeEventListener('blur', onUp, true);
                scheduleSave();
            };
            setFromEvent(e);
            window.addEventListener('mousemove', onMove, true);
            window.addEventListener('mouseup', onUp, true);
            window.addEventListener('blur', onUp, true);
        };
    });
    wrap.querySelectorAll('[data-minimax-drop-segment], .minimax-ref-track, .minimax-video-track').forEach(zone => {
        zone.ondragover = e => { e.preventDefault(); e.stopPropagation(); zone.classList.add('drag-over'); };
        zone.ondragleave = e => { e.stopPropagation(); zone.classList.remove('drag-over'); };
        zone.ondrop = e => {
            e.preventDefault();
            e.stopPropagation();
            zone.classList.remove('drag-over');
            let segId = zone.dataset.minimaxDropSegment || zone.closest('[data-minimax-drop-segment]')?.dataset.minimaxDropSegment || '';
            if(!segId){
                const content = wrap.querySelector('.minimax-ruler .minimax-track-content') || wrap.querySelector('.minimax-video-track');
                const rect = content?.getBoundingClientRect?.();
                if(rect){
                    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
                    segId = miniMaxActiveSegmentAt(node, ratio * miniMaxTimelineTotal(node))?.id || '';
                }
            }
            segId = segId || node.selectedSegmentId;
            const seg = node.segments.find(item => item.id === segId) || miniMaxSelectedSegment(node);
            const dropped = resolveDroppedMiniMaxItem(e.dataTransfer);
            if(!dropped?.item?.url || !seg) return;
            pushUndo();
            node.selectedSegmentId = seg.id;
            const intoVideoTrack = Boolean(zone.closest?.('.minimax-video-track,.minimax-tl-clip') || zone.classList?.contains('minimax-video-track') || zone.classList?.contains('minimax-tl-clip'));
            const intoRefTrack = Boolean(zone.closest?.('.minimax-ref-track,.minimax-ref-clip') || zone.classList?.contains('minimax-ref-track') || zone.classList?.contains('minimax-ref-clip'));
            if(dropped.mode === 'result' && intoVideoTrack && !intoRefTrack) miniMaxSetSegmentResult(node, seg, dropped.item);
            else addRefToSegment(seg, dropped.item);
            refreshNodes([node.id]);
            scheduleSave();
        };
    });
    wrap.querySelectorAll('[data-minimax-segment], [data-minimax-ref-segment]').forEach(el => {
        el.onclick = e => {
            if(e.target.closest('button')) return;
            e.stopPropagation();
            node.selectedSegmentId = el.dataset.minimaxSegment || el.dataset.minimaxRefSegment || node.selectedSegmentId;
            const seg = miniMaxSelectedSegment(node);
            node.playhead = Number(seg?.start || 0);
            refreshNodes([node.id]);
            scheduleSave();
        };
    });
    wrap.querySelectorAll('[data-minimax-add-segment]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            pushUndo();
            miniMaxCompactSegments(node);
            const start = miniMaxTimelineTotal(node);
            const duration = Math.max(0.5, Number(node.segments.at(-1)?.duration || node.duration || 8) || 8);
            const seg = {id:uid('seg'), start, duration, prompt:'', refs:[], result:null, results:[], aspectRatio:node.aspectRatio || '16:9', megapixels:Number(node.megapixels || 0.4), trimIn:0, trimOut:duration};
            node.segments.push(seg);
            node.selectedSegmentId = seg.id;
            node.playhead = start;
            miniMaxCompactSegments(node);
            refreshNodes([node.id]);
            scheduleSave();
        };
    });
    wrap.querySelectorAll('[data-minimax-delete-segment]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            if(node.segments.length <= 1) return;
            pushUndo();
            const id = btn.dataset.minimaxDeleteSegment;
            node.segments = node.segments.filter(seg => seg.id !== id);
            node.selectedSegmentId = node.segments[0]?.id || '';
            miniMaxCompactSegments(node);
            refreshNodes([node.id]);
            scheduleSave();
        };
    });
    wrap.querySelectorAll('[data-minimax-delete-ref]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const [segId, rawIndex] = String(btn.dataset.minimaxDeleteRef || '').split(':');
            const seg = node.segments.find(item => item.id === segId);
            const index = Number(rawIndex);
            if(!seg || !Number.isFinite(index)) return;
            pushUndo();
            const refs = miniMaxExplicitRefsForSegment(seg);
            refs.splice(index, 1);
            seg.refs = refs;
            node.selectedSegmentId = seg.id;
            refreshNodes([node.id]);
            scheduleSave();
        };
    });
    const prompt = wrap.querySelector('[data-minimax-prompt]');
    if(prompt){
        bindScrollableText(prompt);
        prompt.oninput = e => {
            e.stopPropagation();
            const seg = miniMaxSelectedSegment(node);
            if(seg) seg.prompt = prompt.value;
            scheduleSave();
        };
    }
    wrap.querySelectorAll('[data-minimax-engine]').forEach(select => {
        select.onchange = e => { e.stopPropagation(); node.minimaxEngine = e.target.value === 'runninghub' ? 'runninghub' : 'comfyui'; refreshNodes([node.id]); scheduleSave(); };
    });
    wrap.querySelectorAll('[data-minimax-payment]').forEach(select => {
        select.onchange = e => { e.stopPropagation(); node.rhPayment = e.target.value === 'wallet' ? 'wallet' : 'free'; scheduleSave(); };
    });
    wrap.querySelectorAll('[data-minimax-select]').forEach(select => {
        select.onchange = e => {
            e.stopPropagation();
            const seg = miniMaxSelectedSegment(node);
            if(seg) seg[select.dataset.minimaxSelect] = select.value;
            node[select.dataset.minimaxSelect] = select.value;
            scheduleSave();
        };
    });
    wrap.querySelectorAll('[data-minimax-seg-number]').forEach(input => {
        input.oninput = input.onchange = e => {
            e.stopPropagation();
            const seg = miniMaxSelectedSegment(node);
            if(!seg) return;
            const value = Number(input.value);
            if(input.dataset.minimaxSegNumber === 'duration'){
                seg.duration = Math.max(0.5, value || 0.5);
                seg.trimOut = Math.min(seg.duration, Math.max(Number(seg.trimOut || seg.duration), Number(seg.trimIn || 0) + 0.1));
                miniMaxCompactSegments(node);
                if(e.type === 'change') refreshNodes([node.id]);
            }
            if(input.dataset.minimaxSegNumber === 'megapixels'){
                seg.megapixels = Math.max(0.1, Math.min(2, value || 0.4));
                node.megapixels = seg.megapixels;
            }
            scheduleSave();
        };
    });
    wrap.querySelectorAll('[data-minimax-run]').forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); runMiniMaxNode(node.id); };
    });
    wrap.querySelectorAll('[data-minimax-download-current]').forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); miniMaxDownloadItem(miniMaxSelectedSegment(node)?.result); };
    });
    wrap.querySelectorAll('[data-minimax-download-material]').forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); miniMaxDownloadItem(node.materials?.[Number(btn.dataset.minimaxDownloadMaterial)]); };
    });
    wrap.querySelectorAll('[data-minimax-use-material]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const item = node.materials?.[Number(btn.dataset.minimaxUseMaterial)];
            const seg = miniMaxSelectedSegment(node);
            if(!item || !seg) return;
            pushUndo();
            miniMaxSetSegmentResult(node, seg, item);
            refreshNodes([node.id]);
            scheduleSave();
        };
    });
    wrap.querySelectorAll('[data-minimax-asset-index]').forEach(card => {
        card.ondragstart = e => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('application/x-canvas-minimax-asset-index', card.dataset.minimaxAssetIndex || '');
        };
    });
    wrap.querySelectorAll('[data-minimax-material-index]').forEach(card => {
        card.ondragstart = e => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('application/x-canvas-minimax-material-index', card.dataset.minimaxMaterialIndex || '');
        };
    });
    wrap.querySelectorAll('[data-minimax-play]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const video = wrap.querySelector('[data-minimax-player]');
            if(video){ video.paused ? video.play?.().catch(() => {}) : video.pause?.(); }
        };
    });
}

function miniMaxStartPaneResize(e, node, pane){
    e.preventDefault();
    e.stopPropagation();
    const wrap = e.currentTarget?.closest?.('.minimax-canvas-workbench');
    const startX = e.clientX;
    const startY = e.clientY;
    const startLibrary = Math.max(170, Math.min(520, Number(node.minimaxLibraryW || 190)));
    const startPreview = Math.max(130, Math.min(760, Number(node.minimaxPreviewH || 220)));
    const startVideo = Math.max(48, Math.min(180, Number(node.minimaxVideoTrackH || 74)));
    const startRefLane = Math.max(30, Math.min(130, Number(node.minimaxRefLaneH || 36)));
    const refLanes = Math.max(1, wrap?.querySelectorAll?.('.minimax-ref-lane')?.length || 1);
    document.body.classList.add('canvas-minimax-pane-resize');
    const applyVars = () => {
        if(!wrap) return;
        wrap.querySelector('.minimax-wb-body')?.style.setProperty('--minimax-library-w', `${Math.max(170, Math.min(520, Number(node.minimaxLibraryW || 190)))}px`);
        const main = wrap.querySelector('.minimax-wb-main');
        if(main){
            main.style.setProperty('--minimax-preview-h', `${Math.max(130, Math.min(760, Number(node.minimaxPreviewH || 220)))}px`);
            main.style.setProperty('--minimax-video-h', `${Math.max(48, Math.min(180, Number(node.minimaxVideoTrackH || 74)))}px`);
            main.style.setProperty('--minimax-ref-lane-h', `${Math.max(30, Math.min(130, Number(node.minimaxRefLaneH || 36)))}px`);
            main.style.setProperty('--minimax-ref-h', `${Math.max(78, refLanes * Math.max(30, Math.min(130, Number(node.minimaxRefLaneH || 36))))}px`);
        }
    };
    const onMove = move => {
        move.preventDefault();
        const dx = (move.clientX - startX) / getViewport().scale;
        const dy = (move.clientY - startY) / getViewport().scale;
        if(pane === 'library') node.minimaxLibraryW = Math.round(Math.max(170, Math.min(520, startLibrary + dx)));
        if(pane === 'preview') node.minimaxPreviewH = Math.round(Math.max(130, Math.min(760, startPreview + dy)));
        if(pane === 'video') node.minimaxVideoTrackH = Math.round(Math.max(48, Math.min(180, startVideo + dy)));
        if(pane === 'refs') node.minimaxRefLaneH = Math.round(Math.max(30, Math.min(130, startRefLane + dy)));
        applyVars();
    };
    const onUp = () => {
        document.body.classList.remove('canvas-minimax-pane-resize');
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
        window.removeEventListener('blur', onUp, true);
        scheduleSave();
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('blur', onUp, true);
}

function renderMiniMaxBody(node){
    const wrap = document.createElement('div');
    wrap.className = 'minimax-canvas-workbench';
    const selected = miniMaxSelectedSegment(node);
    const total = miniMaxTimelineTotal(node);
    const playhead = Math.max(0, Math.min(total, Number(node.playhead || 0)));
    const playheadPct = total > 0 ? (playhead / total) * 100 : 0;
    const fmt = value => `${(Number(value || 0)).toFixed(Number(value || 0) % 1 ? 1 : 0)}s`;
    const previewH = Math.max(130, Math.min(760, Number(node.minimaxPreviewH || 220)));
    const videoTrackH = Math.max(48, Math.min(180, Number(node.minimaxVideoTrackH || 74)));
    const refLaneH = Math.max(30, Math.min(130, Number(node.minimaxRefLaneH || 36)));
    const libraryW = Math.max(170, Math.min(520, Number(node.minimaxLibraryW || 190)));
    const ticks = Array.from({length:Math.min(13, Math.max(3, Math.ceil(total) + 1))}).map((_, i, arr) => {
        const ratio = arr.length <= 1 ? 0 : i / (arr.length - 1);
        return `<span class="minimax-tick" style="left:${ratio * 100}%"><b>${fmt(total * ratio)}</b></span>`;
    }).join('');
    const segmentsHtml = node.segments.map((seg, index) => {
        const left = total ? (Number(seg.start || 0) / total) * 100 : 0;
        const width = total ? Math.max(5, (Number(seg.duration || 1) / total) * 100) : 100;
        const active = seg.id === selected?.id;
        const result = seg.result?.url ? seg.result : null;
        const refCount = miniMaxExplicitRefsForSegment(seg).length;
        return `<div class="minimax-tl-clip ${active ? 'active' : ''} ${result ? 'has-result' : ''}" data-minimax-segment="${escapeAttr(seg.id)}" data-minimax-drop-segment="${escapeAttr(seg.id)}" style="left:${left}%;width:${Math.min(width, 100 - left)}%" title="Clip ${index + 1}">
            <div class="minimax-clip-media">${result ? miniMaxMediaHtml(result, `Clip ${index + 1}`) : `<div class="minimax-clip-empty"><i data-lucide="sparkles"></i></div>`}</div>
            <div class="minimax-clip-meta"><b>Clip ${index + 1}</b><span>${fmt(seg.start)} - ${fmt(Number(seg.start || 0) + Number(seg.duration || 0))}</span></div>
            ${refCount ? `<span class="minimax-clip-ref-count"><i data-lucide="paperclip"></i>${refCount}</span>` : ''}
            ${node.segments.length > 1 ? `<button type="button" class="minimax-clip-delete" data-minimax-delete-segment="${escapeAttr(seg.id)}" title="删除片段"><i data-lucide="trash-2"></i></button>` : ''}
        </div>`;
    }).join('');
    const selectedRefs = miniMaxExplicitRefsForSegment(selected);
    const refLanes = Math.max(1, selectedRefs.length, ...node.segments.map(seg => miniMaxExplicitRefsForSegment(seg).length));
    const refsHtml = Array.from({length:refLanes}).map((_, laneIndex) => {
        const clips = node.segments.map(seg => {
            const left = total ? (Number(seg.start || 0) / total) * 100 : 0;
            const width = total ? Math.max(5, (Number(seg.duration || 1) / total) * 100) : 100;
            const ref = miniMaxExplicitRefsForSegment(seg)[laneIndex] || null;
            const active = seg.id === selected?.id;
            return `<div class="minimax-ref-clip ${active ? 'active' : ''} ${ref ? 'has-ref' : 'is-empty'}" data-minimax-ref-segment="${escapeAttr(seg.id)}" data-minimax-segment="${escapeAttr(seg.id)}" data-minimax-drop-segment="${escapeAttr(seg.id)}" style="left:${left}%;width:${Math.min(width, 100 - left)}%">
                <div class="minimax-ref-media">${ref ? miniMaxMediaHtml(ref, `Ref ${laneIndex + 1}`) : `<div class="minimax-clip-empty"><i data-lucide="paperclip"></i></div>`}</div>
                ${ref ? `<button type="button" data-minimax-delete-ref="${escapeAttr(`${seg.id}:${laneIndex}`)}" title="移除参考"><i data-lucide="x"></i></button>` : ''}
                <span class="minimax-ref-counts">${ref ? escapeHtml(ref.name || `Ref ${laneIndex + 1}`) : `Ref ${laneIndex + 1}`}</span>
            </div>`;
        }).join('');
        return `<div class="minimax-ref-lane">${clips}</div>`;
    }).join('');
    const upstream = miniMaxRefsForNode(node);
    const assets = miniMaxUniqueRefs([...node.segments.flatMap(seg => seg.refs || []), ...upstream.refs]).slice(0, 36);
    const assetsHtml = assets.length ? assets.map((item, index) => `<div class="minimax-material-card minimax-asset-item" draggable="true" data-minimax-asset-index="${index}" title="${escapeAttr(item.name || mediaKindForRef(item))}">
        ${miniMaxMediaHtml(item, item.name || mediaKindForRef(item))}<span>${escapeHtml(mediaKindForRef(item))}</span>
    </div>`).join('') : `<div class="minimax-library-empty"><i data-lucide="database"></i><span>Assets</span></div>`;
    const materialsHtml = (node.materials || []).slice(0, 24).map((item, index) => `<div class="minimax-material-card minimax-output-item" draggable="true" data-minimax-material-index="${index}" title="${escapeAttr(item.name || 'Output')}">
        ${miniMaxMediaHtml(item, 'Output')}
        <button type="button" data-minimax-download-material="${index}" title="下载"><i data-lucide="download"></i></button>
        <button type="button" data-minimax-use-material="${index}" title="设为当前片段"><i data-lucide="replace"></i></button>
    </div>`).join('') || `<div class="minimax-library-empty"><i data-lucide="inbox"></i><span>Output</span></div>`;
    const segDuration = Math.max(0.5, Number(selected?.duration || 8) || 8);
    const imageCount = miniMaxSegmentRefsByKind(selectedRefs, 'image').length;
    const videoCount = miniMaxSegmentRefsByKind(selectedRefs, 'video').length;
    const audioCount = miniMaxSegmentRefsByKind(selectedRefs, 'audio').length;
    const overLimit = imageCount > CANVAS_MINIMAX_REF_IMAGE_MAX || videoCount > CANVAS_MINIMAX_REF_VIDEO_MAX || audioCount > CANVAS_MINIMAX_REF_AUDIO_MAX;
    wrap.innerHTML = `
        <div class="minimax-wb-toolbar">
            <div class="minimax-brand"><i data-lucide="clapperboard"></i><span>MiniMax H3</span><b data-minimax-time-label>${fmt(playhead)} / ${fmt(total)}</b></div>
            <div class="minimax-transport"><button type="button" data-minimax-play title="播放"><i data-lucide="play"></i></button><button type="button" data-minimax-add-segment title="新增片段"><i data-lucide="plus"></i></button></div>
            <div class="minimax-top-actions"><button type="button" data-minimax-download-current ${selected?.result?.url ? '' : 'disabled'} title="下载当前片段"><i data-lucide="download"></i></button></div>
        </div>
        <div class="minimax-wb-body" style="--minimax-library-w:${libraryW}px">
            <div class="minimax-library minimax-asset-bin"><span class="minimax-pane-resize minimax-library-resize" data-minimax-pane-resize="library"></span><div class="minimax-library-head"><i data-lucide="database"></i><span>Assets</span></div><div class="minimax-library-list">${assetsHtml}</div><div class="minimax-library-head minimax-output-head"><i data-lucide="folder-output"></i><span>Output</span></div><div class="minimax-library-list minimax-output-list">${materialsHtml}</div></div>
            <div class="minimax-wb-main" style="--minimax-preview-h:${previewH}px;--minimax-video-h:${videoTrackH}px;--minimax-ref-lane-h:${refLaneH}px;--minimax-ref-h:${Math.max(78, refLanes * refLaneH)}px">
                <div class="minimax-player-stage" data-minimax-player-stage="1" data-minimax-player-segment="${escapeAttr(selected?.id || '')}" data-minimax-player-url="${escapeAttr(selected?.result?.url || '')}"><div class="minimax-player-content" data-minimax-player-content="1">${miniMaxPlayerHtml(selected)}</div><span class="minimax-pane-resize minimax-preview-resize" data-minimax-pane-resize="preview"></span></div>
                <div class="minimax-edit-timeline" data-minimax-scrub-track="1">
                    <span class="minimax-pane-resize minimax-video-resize" data-minimax-pane-resize="video"></span>
                    <span class="minimax-pane-resize minimax-ref-resize" data-minimax-pane-resize="refs"></span>
                    <div class="minimax-timeline-controls"><button type="button" data-minimax-play title="播放"><i data-lucide="play"></i></button></div>
                    <div class="minimax-ruler"><div class="minimax-track-content">${ticks}<span class="minimax-playhead" data-minimax-playhead="1" style="left:${playheadPct}%"></span></div></div>
                    <div class="minimax-add-gutter minimax-ruler-gutter"></div>
                    <div class="minimax-track-label minimax-video-label">Video</div>
                    <div class="minimax-track minimax-video-track"><div class="minimax-track-content">${segmentsHtml}</div></div>
                    <button type="button" class="minimax-video-add" data-minimax-add-segment title="新增片段"><i data-lucide="plus"></i></button>
                    <div class="minimax-track-label minimax-ref-label">Refs</div>
                    <div class="minimax-ref-track"><div class="minimax-ref-content">${refsHtml}</div></div>
                    <div class="minimax-add-gutter minimax-ref-gutter"></div>
                </div>
                <div class="minimax-current-panel">
                    <div class="minimax-current-head"><div class="minimax-current-title"><span class="minimax-current-dot"></span><b>Clip ${Math.max(1, node.segments.findIndex(seg => seg.id === selected?.id) + 1)}</b><span>${fmt(selected?.start)} - ${fmt(Number(selected?.start || 0) + segDuration)}</span></div><div class="minimax-current-refs"><span><i data-lucide="image"></i>${imageCount}</span><span><i data-lucide="film"></i>${videoCount}</span><span><i data-lucide="file-audio"></i>${audioCount}</span></div></div>
                    <label class="minimax-prompt-field"><span><i data-lucide="text-cursor-input"></i>Prompt</span><textarea data-minimax-prompt placeholder="Prompt for selected clip">${escapeHtml(selected?.prompt || '')}</textarea></label>
                    <div class="minimax-clip-parameters"><div class="minimax-section-label"><i data-lucide="sliders-horizontal"></i><span>Clip settings</span></div><div class="minimax-settings minimax-segment-fields">
                        <label class="minimax-wide-setting minimax-engine-setting"><span>Engine</span><select class="minimax-engine-select" data-minimax-engine><option value="comfyui" ${node.minimaxEngine === 'comfyui' ? 'selected' : ''}>ComfyUI</option><option value="runninghub" ${node.minimaxEngine === 'runninghub' ? 'selected' : ''}>RunningHub</option></select></label>
                        <label><span>Duration</span><input type="number" min="0.5" max="60" step="0.1" data-minimax-seg-number="duration" value="${escapeAttr(segDuration)}"><b>s</b></label>
                        <label><span>Megapixels</span><input type="number" min="0.1" max="2" step="0.1" data-minimax-seg-number="megapixels" value="${escapeAttr(selected?.megapixels || node.megapixels || 0.4)}"><b>MP</b></label>
                        <label class="minimax-wide-setting"><span>Aspect ratio</span><select data-minimax-select="aspectRatio">${['16:9','9:16','1:1','4:3','3:4','21:9','9:21'].map(value => `<option value="${value}" ${value === (selected?.aspectRatio || node.aspectRatio) ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
                        <label class="minimax-wide-setting"><span>Payment</span><select data-minimax-payment>${rhPaymentOptions(node)}</select></label>
                        <button class="minimax-run ${node.running ? 'running' : ''}" type="button" data-minimax-run ${node.running || overLimit ? 'disabled' : ''}><i data-lucide="${node.running ? 'loader-2' : 'sparkles'}"></i><span>${node.running ? 'Running' : 'Generate clip'}</span></button>
                    </div></div>
                </div>
            </div>
        </div>
        ${retryBarHtml(node)}
    `;
    bindMiniMaxWorkbench(wrap, node);
    bindCascadeButtons(wrap, node.id);
    return wrap;
}

async function runMiniMaxNode(nodeId, opts={}){
    const node = getNodes().find(n => n.id === nodeId);
    if(!node || (node.running && !opts.cascade)) return;
    const cascadeTargetId = cascadeTargetIdFromOptions(opts);
    const sourceData = miniMaxRefsForNode(node);
    const seg = miniMaxSelectedSegment(node);
    const prompt = String(seg?.prompt || '').trim() || sourceData.prompt;
    const refs = miniMaxRefsForSegment(node, seg);
    const media = {
        sources:sourceData.sources,
        refs,
        image:imageRefsOnly(refs),
        video:videoRefsOnly(refs),
        audio:audioRefsOnly(refs),
        prompt
    };
    if(!media.prompt){
        const msg = 'MiniMax 需要连接提示词';
        if(opts.cascade) throw new Error(msg);
        alert(msg);
        return;
    }
    const engine = miniMaxEngine(node);
    let out = outputForNode(node, 500);
    const pendingId = uid('p');
    const run = runSnapshot(node, media.prompt, media.refs);
    run.taskLabel = engine === 'runninghub' ? 'MiniMax RunningHub' : 'MiniMax ComfyUI';
    if(out) out._pending = [...(out._pending || []), makePendingForRun(pendingId, run, node, {refs:media.refs, cascadeTargetId})];
    if(!opts.cascade) node.running = true;
    refreshRunNodes(node, out);
    try {
        let outputs = [];
        if(engine === 'runninghub'){
            const rhResult = await window.MiniMaxRunningHub.run(node, media, {cascadeTargetId});
            outputs = rhResult.outputs || [];
            run.request = rhResult.request || {};
        } else {
            const params = await miniMaxDynamicParams(node, media.prompt, media.refs);
            const result = await runQueuedComfyGenerate({
                prompt:media.prompt,
                workflow_json:node.workflow || 'video/MiniMax_H3.json',
                params,
                type:'minimax-h3',
                client_id:CLIENT_ID
            }, {cascadeTargetId});
            outputs = resultMediaUrls(result);
            run.request = requestMetaFromResult(result);
        }
        const normalized = (outputs || []).map((item, i) => {
            const url = outputUrlValue(item);
            const explicitKind = typeof item === 'object' && item.kind ? item.kind : '';
            const kind = explicitKind || 'video';
            return item && typeof item === 'object' ? {...item, url, kind} : {url, kind, name:`minimax-${i + 1}.mp4`};
        }).filter(item => item.url);
        if(!normalized.length) throw new Error('MiniMax 未返回视频');
        const meta = collectRunMeta(out, pendingId);
        if(out) out._pending = (out._pending || []).filter(p => p.id !== pendingId);
        appendOutputImages(out, normalized, media.refs[0], [{...meta, kind:'video'}]);
        if(seg) normalized.forEach(item => miniMaxSetSegmentResult(node, seg, item));
        mergeGeneratedOutputs(node, normalized, Boolean(opts.cascade));
        addGenerationLog({run, outputs:normalized, runMs:meta.runMs || 0});
        node.runStatus = 'done';
        node.runError = '';
        refreshRunNodes(node, out);
        scheduleSave();
    } catch(err) {
        const meta = collectRunMeta(out, pendingId);
        const readable = miniMaxReadableError(err, engine);
        addGenerationLog({run, outputs:[], runMs:meta.runMs || 0, error:miniMaxLogError(err, engine)});
        if(out) out._pending = (out._pending || []).filter(p => p.id !== pendingId);
        if(isCascadeAbortError(err)){
            if(opts.cascade) throw err;
            return;
        }
        node.runStatus = 'failed';
        node.runError = readable;
        refreshRunNodes(node, out);
        if(opts.cascade) throw err;
        showErrorModal(readable, 'MiniMax H3');
    } finally {
        node.running = false;
        refreshRunNodes(node, out);
    }
}

window.MiniMaxNode = {
    type: 'minimax',
    title: 'MiniMax',
    init(next){ deps = next; },
    body: renderMiniMaxBody,
    run: runMiniMaxNode,
};
})();
