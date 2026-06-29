/**
 * 卡片进度管理组件（环形进度条 + 计时器）
 * 
 * 使用方法：
 * 
 * // 方式一：在容器中创建进度卡片
 * const progress = CardProgress.attach(placeholderEl);
 * progress.update({ status: 'started' });
 * progress.update({ status: 'sampling', value: 5, max: 10 });
 * progress.destroy();
 * 
 * // 方式二：直接生成 HTML + 后续更新
 * el.innerHTML = CardProgress.HTML;
 * CardProgress.update(el, { status: 'started' });
 */
const CardProgress = (function() {

    // ─────────────────────────────────────────────
    //  计时器存储（全局，按 DOM 元素索引）
    // ─────────────────────────────────────────────
    const _timers = new Map();

    // ─────────────────────────────────────────────
    //  注入全局 CSS keyframes（仅一次）
    // ─────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('card-progress-style')) return;
        const style = document.createElement('style');
        style.id = 'card-progress-style';
        style.textContent = `
            @keyframes cp-spin { to { transform: rotate(360deg); } }
            @keyframes cp-pulse { 0%,100% { transform:scale(1);opacity:1; } 50% { transform:scale(1.4);opacity:0.7; } }
            @keyframes cp-breath-spin {
                0% { transform:rotate(0deg) scale(0.9); opacity:0.4; }
                50% { transform:rotate(180deg) scale(1.05); opacity:1; }
                100% { transform:rotate(360deg) scale(0.9); opacity:0.4; }
            }
        `;
        document.head.appendChild(style);
    }

    // ─────────────────────────────────────────────
    //  格式化经过时间
    // ─────────────────────────────────────────────
    function formatElapsed(ms) {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        return m > 0 ? m + 'm' + (s % 60) + 's' : s + 's';
    }

    // ─────────────────────────────────────────────
    //  获取卡片内的进度元素
    // ─────────────────────────────────────────────
    function getEls(card) {
        return {
            label: card.querySelector('.card-progress-label'),
            pct:   card.querySelector('.card-progress-pct'),
            outer: card.querySelector('.pg-ring-outer'),
            inner: card.querySelector('.pg-ring-inner')
        };
    }

    // ─────────────────────────────────────────────
    //  清除计时器
    // ─────────────────────────────────────────────
    function clearTimer(card) {
        if (_timers.has(card)) {
            clearInterval(_timers.get(card).timer);
            _timers.delete(card);
        }
    }

    // ─────────────────────────────────────────────
    //  启动计时器
    // ─────────────────────────────────────────────
    function startTimer(card, prefix) {
        clearTimer(card);
        const start = Date.now();
        const state = { timer: null, start };
        const els = getEls(card);
        if (els.pct) { els.pct.style.visibility = 'visible'; els.pct.textContent = '0%'; }
        if (els.label) els.label.textContent = prefix + ' ' + formatElapsed(0);
        state.timer = setInterval(() => {
            const elapsed = Date.now() - start;
            const l = card.querySelector('.card-progress-label');
            if (l) l.textContent = prefix + ' ' + formatElapsed(elapsed);
        }, 1000);
        _timers.set(card, state);
    }

    // ─────────────────────────────────────────────
    //  更新卡片进度（核心 API）
    // ─────────────────────────────────────────────
    function update(card, status) {
        if (!card) return;
        const els = getEls(card);
        if (!els.label) return;

        if (status.status === 'started' || status.status === 'executing') {
            if (els.pct) els.pct.style.visibility = 'visible';
            const prefix = status.status === 'started' ? '排队中' : '执行中';
            startTimer(card, prefix);
        } else if (status.status === 'sampling') {
            clearTimer(card);
            const v = status.value || 0, m = status.max || 1;
            const p = Math.round((v / m) * 100);
            if (els.pct) { els.pct.style.visibility = 'visible'; els.pct.textContent = p + '%'; }
            const speed = Math.max(0.3, 1 - p * 0.007);
            if (els.outer) els.outer.style.animationDuration = speed + 's';
            if (els.inner) els.inner.style.animationDuration = (speed * 0.6) + 's';
            els.label.textContent = '采样 ' + v + '/' + m;
        } else if (status.status === 'done') {
            clearTimer(card);
            if (els.pct) { els.pct.style.visibility = 'visible'; els.pct.textContent = '95%'; }
            els.label.textContent = '解码中...';
        } else if (status.status === 'complete') {
            clearTimer(card);
            if (els.outer) {
                els.outer.style.animation = 'cp-breath-spin 3s ease-in-out infinite';
                els.outer.style.borderColor = '#8b5cf6';
            }
            if (els.inner) {
                els.inner.style.animation = 'cp-breath-spin 3s ease-in-out infinite reverse';
                els.inner.style.borderColor = '#06b6d4';
            }
            if (els.pct) { els.pct.style.visibility = 'visible'; els.pct.textContent = '100%'; }
            els.label.textContent = '完成!';
            els.label.style.color = '#8b5cf6';
        }
    }

    // ─────────────────────────────────────────────
    //  生成进度卡片 HTML（替换 placeholder.innerHTML 用）
    // ─────────────────────────────────────────────
    const HTML = `
        <div class="card-progress" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;">
            <div style="position:relative;width:48px;height:48px;display:flex;align-items:center;justify-content:center;">
                <div class="pg-ring-outer" style="position:absolute;inset:0;border:3px solid transparent;border-top-color:#3b82f6;border-right-color:#8b5cf6;border-radius:50%;animation:cp-spin 1s linear infinite;"></div>
                <div class="pg-ring-inner" style="position:absolute;inset:7px;border:2px solid transparent;border-top-color:#06b6d4;border-radius:50%;animation:cp-spin 0.6s linear infinite reverse;"></div>
                <span class="card-progress-pct" style="position:absolute;font-size:9px;font-weight:700;color:#6b7280;">0%</span>
            </div>
            <span class="card-progress-label" style="font-size:8px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em;">排队中...</span>
        </div>
    `;

    // ─────────────────────────────────────────────
    //  创建绑定实例（高级 API）
    // ─────────────────────────────────────────────
    function attach(container) {
        if (!container) return null;
        injectStyles();
        container.innerHTML = HTML;
        // 确保容器相对定位，进度卡片 absolute 定位在里面
        const pos = getComputedStyle(container).position;
        if (pos === 'static') container.style.position = 'relative';

        return {
            /** 更新进度状态 */
            update: function(status) { update(container, status); },
            /** 销毁：移除进度 UI + 清理计时器 */
            destroy: function() {
                clearTimer(container);
                const prog = container.querySelector('.card-progress');
                if (prog) prog.remove();
            },
            /** 获取当前正在显示的元素 */
            getElement: function() { return container.querySelector('.card-progress'); }
        };
    }

    // ─────────────────────────────────────────────
    //  公开 API
    // ─────────────────────────────────────────────
    return {
        /** 注入 keyframes CSS（仅第一次有效） */
        injectStyles,

        /** 进度卡片 HTML 模板字符串 */
        HTML,

        /** 更新已有进度卡片的状态 */
        update,

        /** 在容器上创建新的进度卡片，返回 { update, destroy, getElement } */
        attach
    };
})();
