/* 视频裁剪组件（就地取片段的通用弹层）
 *
 * 谁在用：
 *   - static/js/canvas.js：双击画布上的视频节点打开，裁完把结果落成新的视频节点
 *   - 以后任何需要「从一段视频里截一段」的页面/节点都能直接调：
 *       CanvasVideoTrimmer.open({ url, name, start, end, onApply })
 *     onApply 收到后端返回的 { url, name, kind, start, end }
 *
 * 后端：POST /api/media/trim  { url, start, end, filename }
 * 只接受本地素材（/output 与 /assets 下的文件），远端地址请先入库。
 */
(function () {
    'use strict';

    var instance = null;

    function pad(value) { return String(Math.floor(value)).padStart(2, '0'); }

    function formatTime(seconds) {
        var total = Math.max(0, Number(seconds) || 0);
        var minutes = Math.floor(total / 60);
        var rest = total - minutes * 60;
        return pad(minutes) + ':' + (rest < 10 ? '0' : '') + rest.toFixed(1);
    }

    function element(tag, className, text) {
        var el = document.createElement(tag);
        if (className) el.className = className;
        if (text != null) el.textContent = text;
        return el;
    }

    function close() {
        if (!instance) return;
        if (instance.video) {
            try { instance.video.pause(); } catch (error) { /* 已卸载 */ }
        }
        instance.root.remove();
        document.removeEventListener('keydown', instance.onKey, true);
        instance = null;
    }

    function open(options) {
        var opts = options || {};
        if (!opts.url) return;
        close();

        var root = element('div', 'vt-overlay');
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', '裁剪视频');

        var panel = element('div', 'vt-panel');
        var header = element('div', 'vt-header');
        header.append(element('strong', 'vt-title', opts.name || '裁剪视频'));
        var closeBtn = element('button', 'vt-close');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', '关闭');
        closeBtn.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
        header.append(closeBtn);

        var stage = element('div', 'vt-stage');
        var video = document.createElement('video');
        video.src = opts.url;
        video.preload = 'metadata';
        video.playsInline = true;
        video.controls = false;
        stage.append(video);

        var playBtn = element('button', 'vt-play');
        playBtn.type = 'button';
        playBtn.innerHTML = '<i data-lucide="play" aria-hidden="true"></i><span>播放选区</span>';
        stage.append(playBtn);

        var track = element('div', 'vt-track');
        var range = element('div', 'vt-range');
        var handleA = element('div', 'vt-handle is-start');
        var handleB = element('div', 'vt-handle is-end');
        var playhead = element('div', 'vt-playhead');
        range.append(handleA, handleB);
        track.append(range, playhead);

        var readout = element('div', 'vt-readout');
        var startLabel = element('span', 'vt-time', '00:00.0');
        var endLabel = element('span', 'vt-time', '00:00.0');
        var lengthLabel = element('span', 'vt-length', '0.0s');
        readout.append(element('span', 'vt-tag', '起'), startLabel,
            element('span', 'vt-tag', '止'), endLabel,
            element('span', 'vt-tag', '时长'), lengthLabel);

        var footer = element('div', 'vt-footer');
        var status = element('span', 'vt-status', '拖动两端选择要保留的片段');
        var resetBtn = element('button', 'vt-btn', '重置');
        resetBtn.type = 'button';
        var applyBtn = element('button', 'vt-btn is-primary', '裁剪并保存');
        applyBtn.type = 'button';
        footer.append(status, element('span', 'vt-spacer'), resetBtn, applyBtn);

        panel.append(header, stage, track, readout, footer);
        root.append(panel);
        document.body.append(root);
        if (window.lucide) window.lucide.createIcons({ nameAttr: 'data-lucide' });

        var state = {
            root: root,
            video: video,
            duration: 0,
            start: Math.max(0, Number(opts.start) || 0),
            end: 0,
            onKey: null
        };
        instance = state;

        function pct(value) {
            if (!state.duration) return 0;
            return Math.max(0, Math.min(100, (value / state.duration) * 100));
        }

        function paint() {
            var startPct = pct(state.start);
            var endPct = pct(state.end || state.duration);
            range.style.left = startPct + '%';
            range.style.right = (100 - endPct) + '%';
            playhead.style.left = pct(video.currentTime || 0) + '%';
            startLabel.textContent = formatTime(state.start);
            endLabel.textContent = formatTime(state.end || state.duration);
            lengthLabel.textContent = Math.max(0, (state.end || state.duration) - state.start).toFixed(1) + 's';
        }

        function setDuration() {
            state.duration = Number.isFinite(video.duration) ? video.duration : 0;
            if (!state.duration) return;
            if (!state.end || state.end > state.duration) state.end = state.duration;
            if (state.start >= state.end) state.start = 0;
            video.currentTime = state.start;
            paint();
        }

        function timeAt(clientX) {
            var rect = track.getBoundingClientRect();
            if (!rect.width || !state.duration) return 0;
            var ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            return ratio * state.duration;
        }

        function startDrag(kind) {
            return function (event) {
                event.preventDefault();
                event.stopPropagation();
                var move = function (moveEvent) {
                    var value = timeAt(moveEvent.clientX);
                    if (kind === 'start') state.start = Math.min(Math.max(0, value), state.end - 0.1);
                    else state.end = Math.max(Math.min(state.duration, value), state.start + 0.1);
                    paint();
                };
                var up = function () {
                    window.removeEventListener('pointermove', move);
                    window.removeEventListener('pointerup', up);
                };
                window.addEventListener('pointermove', move);
                window.addEventListener('pointerup', up);
                move(event);
            };
        }

        handleA.addEventListener('pointerdown', startDrag('start'));
        handleB.addEventListener('pointerdown', startDrag('end'));

        // 点轨道空白处：就近跳到起点或终点，省得拖小把手
        track.addEventListener('pointerdown', function (event) {
            if (event.target === handleA || event.target === handleB) return;
            var value = timeAt(event.clientX);
            var toStart = Math.abs(value - state.start) <= Math.abs(value - (state.end || state.duration));
            if (toStart) state.start = Math.min(value, state.end - 0.1);
            else state.end = Math.max(value, state.start + 0.1);
            video.currentTime = toStart ? state.start : Math.max(0, state.end - 0.1);
            paint();
        });

        video.addEventListener('loadedmetadata', setDuration);
        video.addEventListener('timeupdate', function () {
            playhead.style.left = pct(video.currentTime || 0) + '%';
            if (!video.paused && state.end && video.currentTime >= state.end) video.pause();
        });

        playBtn.onclick = function () {
            if (video.paused) {
                if (state.end && video.currentTime >= state.end - 0.05) video.currentTime = state.start;
                if (video.currentTime < state.start) video.currentTime = state.start;
                video.play().catch(function () { /* 浏览器策略拒绝，忽略 */ });
            } else {
                video.pause();
            }
        };

        resetBtn.onclick = function () {
            state.start = 0;
            state.end = state.duration;
            video.currentTime = 0;
            paint();
        };

        applyBtn.onclick = async function () {
            if (!state.duration) { status.textContent = '视频还没加载完'; return; }
            var end = state.end || state.duration;
            if (end - state.start < 0.1) { status.textContent = '选区太短了'; return; }
            applyBtn.disabled = true;
            status.textContent = '裁剪中…';
            try {
                var response = await fetch('/api/media/trim', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: opts.url,
                        start: Number(state.start.toFixed(3)),
                        end: Number(end.toFixed(3)),
                        filename: opts.filename || ''
                    })
                });
                var data = await response.json().catch(function () { return {}; });
                if (!response.ok) throw new Error(data.detail || ('裁剪失败（' + response.status + '）'));
                if (typeof opts.onApply === 'function') await opts.onApply(data);
                close();
            } catch (error) {
                status.textContent = error.message || '裁剪失败';
                applyBtn.disabled = false;
            }
        };

        closeBtn.onclick = close;
        root.addEventListener('pointerdown', function (event) {
            if (event.target === root) close();
        });

        state.onKey = function (event) {
            if (event.key === 'Escape') { event.preventDefault(); close(); }
            else if (event.key === ' ') { event.preventDefault(); playBtn.click(); }
        };
        document.addEventListener('keydown', state.onKey, true);
    }

    window.CanvasVideoTrimmer = { open: open, close: close };
})();
