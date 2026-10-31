(function(){
    const KEY = 'studio_theme';
    const LEGACY_KEY = 'canvas_theme';
    const SCALE_KEY = 'studio_ui_scale_mode';
    const SCAN_KEY = 'studio_scanlines';
    const ACCENT_KEY = 'studio_accent';
    const PALETTE_KEY = 'studio_palette';
    const PALETTE_COLOR_KEY = 'studio_palette_color';
    const PANEL_ALPHA_KEY = 'studio_panel_alpha';
    const PALETTES = {
        ink: {
            dark: ['#14161c', '#1c202a', '#252b38', '#343b4c', '#445066'],
            light: ['#f7f6f4', '#fbfaf9', '#f3f2ef', '#e7e5de', '#d9d6cc']
        },
        night: {
            dark: ['#0e1626', '#162238', '#1e2d48', '#314466', '#42587f'],
            light: ['#f3f6fb', '#f8fafd', '#eaf0f8', '#d5e0ee', '#c3d0e4']
        },
        pine: {
            dark: ['#101916', '#17241f', '#20302a', '#334840', '#456056'],
            light: ['#f3f7f4', '#f8fbf8', '#e7f0ea', '#d3e2d8', '#bdd0c4']
        },
        dusk: {
            dark: ['#16141f', '#211c2e', '#2c243d', '#43385a', '#574a72'],
            light: ['#f6f4f9', '#fbf9fd', '#efeaf6', '#ddd4ea', '#cbbfdc']
        },
        sand: {
            dark: ['#1a1612', '#262018', '#32281e', '#4a3c2e', '#5e4e3c'],
            light: ['#f8f5f1', '#fbf9f6', '#f3ece4', '#e6d9cb', '#d4c3b0']
        }
    };
    const ACCENTS = {
        cyan: ['#0891b2', '#06b6d4'],
        violet: ['#7c3aed', '#a78bfa'],
        amber: ['#d97706', '#fbbf24'],
        emerald: ['#059669', '#34d399'],
        rose: ['#e11d48', '#fb7185']
    };
    const SCALE_OPTIONS = ['auto', '60', '65', '70', '75', '80', '85', '90', '95', '100', '115', '125', '140'];

    function currentTheme(){
        return localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY) || (window.STUDIO_DEFAULT_THEME || 'dark');
    }

    function applyTheme(theme){
        const next = theme === 'dark' ? 'dark' : 'light';
        const dark = next === 'dark';
        document.documentElement.classList.toggle('studio-theme-dark', dark);
        document.documentElement.classList.toggle('theme-dark', dark);
        if(document.body){
            document.body.classList.toggle('studio-theme-dark', dark);
            document.body.classList.toggle('theme-dark', dark);
        }
        window.dispatchEvent(new CustomEvent('studio-theme-change', { detail: { theme: next } }));
    }

    function ensureScaleStyle(){
        if(document.getElementById('studio-scale-style')) return;
        const style = document.createElement('style');
        style.id = 'studio-scale-style';
        style.textContent = `
            html.studio-scale-managed {
                --studio-ui-scale: 1;
            }
            html.studio-ui-scaled,
            html.studio-ui-scaled body {
                overscroll-behavior-x: none;
            }
            html.studio-ui-scaled {
                overflow-x: hidden !important;
            }
            html.studio-ui-scaled::-webkit-scrollbar:horizontal,
            html.studio-ui-scaled body::-webkit-scrollbar:horizontal {
                height: 0 !important;
            }
            html.studio-ui-scaled body:not(.studio-scale-host) {
                width: calc(100% / var(--studio-ui-scale)) !important;
                min-height: calc(100vh / var(--studio-ui-scale)) !important;
                transform: scale(var(--studio-ui-scale));
                transform-origin: 0 0;
            }
            html.studio-ui-scaled body.studio-scale-viewport:not(.studio-scale-host) {
                height: calc(100vh / var(--studio-ui-scale)) !important;
            }
            html.studio-ui-scaled body:not(.studio-scale-host) > .app-shell,
            html.studio-ui-scaled body:not(.studio-scale-host) > .shell,
            html.studio-ui-scaled body:not(.studio-scale-host) > .asset-page {
                width: 100% !important;
            }
            html.studio-ui-scaled body:not(.studio-scale-host) > .app-shell,
            html.studio-ui-scaled body:not(.studio-scale-host) > .shell {
                height: calc(100vh / var(--studio-ui-scale)) !important;
            }
            html.studio-ui-scaled body:not(.studio-scale-host) > .asset-page {
                min-height: calc(100vh / var(--studio-ui-scale)) !important;
            }
        `;
        document.head.appendChild(style);
    }

    function isFramed(){
        try {
            return window.self !== window.top;
        } catch(e) {
            return true;
        }
    }

    function normalizeScaleMode(mode){
        return SCALE_OPTIONS.includes(mode) ? mode : 'auto';
    }

    function currentScaleMode(){
        try {
            return normalizeScaleMode(localStorage.getItem(SCALE_KEY) || 'auto');
        } catch(e) {
            return 'auto';
        }
    }

    function autoScale(){
        const dpr = Math.max(1, Number(window.devicePixelRatio || 1));
        const viewportWidth = Math.max(320, Number(window.innerWidth || 0));
        const viewportHeight = Math.max(320, Number(window.innerHeight || 0));
        const compactRatio = Math.min(viewportWidth / 1500, viewportHeight / 940);
        if(compactRatio < 1) {
            return Math.max(0.68, Math.min(1, compactRatio));
        }
        const screenLong = Math.max(window.screen?.width || 0, window.screen?.height || 0);
        const viewportLong = Math.max(viewportWidth, viewportHeight);
        const longEdge = Math.max(screenLong, viewportLong);
        if(dpr >= 1.35) return 1;
        if(longEdge >= 3600) return 1.22;
        if(longEdge >= 3000) return 1.16;
        if(longEdge >= 2500 && dpr <= 1.15) return 1.1;
        return 1;
    }

    function scaleForMode(mode){
        const next = normalizeScaleMode(mode);
        if(next === 'auto' && Number.isFinite(externalScaleValue)) return externalScaleValue;
        if(next === 'auto') return autoScale();
        return Math.max(0.58, Math.min(1.4, Number(next) / 100));
    }

    let externalScaleValue = null;
    function normalizeExternalScale(value){
        const next = Number(value);
        return Number.isFinite(next) ? Math.max(0.58, Math.min(1.4, next)) : null;
    }

    function appliedScale(){
        const cssValue = Number(getComputedStyle(document.documentElement).getPropertyValue('--studio-ui-scale'));
        return Number.isFinite(cssValue) && cssValue > 0 ? cssValue : scaleForMode(currentScaleMode());
    }

    function updateScaleBodyClasses(){
        if(!document.body) return;
        const hasFrameHost = !!document.querySelector('.app-shell iframe, iframe.active');
        document.body.classList.toggle('studio-scale-host', hasFrameHost && !isFramed());
        const computed = window.getComputedStyle(document.body);
        const viewportLocked = computed.overflow === 'hidden' || computed.overflowY === 'hidden' || !!document.querySelector('.app-shell, .shell');
        document.body.classList.toggle('studio-scale-viewport', viewportLocked);
    }

    function scaleOptedOut(){
        if(document.documentElement.dataset.studioScale === 'off') return true;
        return !!(document.querySelector && document.querySelector('.app-shell'));
    }

    function contentFitOptedOut(){
        return document.documentElement.dataset.studioFitScale === 'off';
    }

    let horizontalScrollLockPending = false;
    function lockScaledHorizontalScroll(){
        if(horizontalScrollLockPending || !document.documentElement.classList.contains('studio-ui-scaled')) return;
        if(Math.abs(window.scrollX || 0) < 1) return;
        horizontalScrollLockPending = true;
        requestAnimationFrame(() => {
            horizontalScrollLockPending = false;
            if(document.documentElement.classList.contains('studio-ui-scaled') && Math.abs(window.scrollX || 0) >= 1) {
                window.scrollTo(0, window.scrollY || 0);
            }
        });
    }

    let contentFitTimer = null;
    function scheduleContentFit(mode){
        clearTimeout(contentFitTimer);
        if(mode !== 'auto' || scaleOptedOut() || contentFitOptedOut() || Number.isFinite(externalScaleValue)) return;
        contentFitTimer = setTimeout(() => {
            const root = document.documentElement;
            if(!root.classList.contains('studio-ui-scaled')) return;
            const current = Number(getComputedStyle(root).getPropertyValue('--studio-ui-scale')) || 1;
            const viewportWidth = Math.max(320, Number(window.innerWidth || 0));
            const contentWidth = Math.max(
                viewportWidth,
                root.scrollWidth || 0,
                document.body?.scrollWidth || 0,
                document.body?.offsetWidth || 0
            );
            const fitted = Math.max(0.58, Math.min(current, viewportWidth / contentWidth));
            if(fitted < current - 0.006) {
                root.style.setProperty('--studio-ui-scale', fitted.toFixed(3));
                lockScaledHorizontalScroll();
            }
        }, 80);
    }

    function applyScale(mode){
        ensureScaleStyle();
        const next = normalizeScaleMode(mode);
        const optedOut = scaleOptedOut();
        const value = scaleForMode(next);
        const scaled = !optedOut && Math.abs(value - 1) > 0.01;
        document.documentElement.classList.add('studio-scale-managed');
        document.documentElement.classList.toggle('studio-ui-scaled', scaled);
        document.documentElement.style.setProperty('--studio-ui-scale', value.toFixed(3));
        updateScaleBodyClasses();
        lockScaledHorizontalScroll();
        scheduleContentFit(next);
        window.dispatchEvent(new CustomEvent('studio-ui-scale-change', { detail: { mode: next, scale: value } }));
    }

    function broadcastScale(mode){
        const scale = appliedScale();
        document.querySelectorAll('iframe').forEach(frame => {
            try {
                frame.contentWindow?.postMessage({ type: 'studio-ui-scale', mode, scale }, '*');
            } catch(e) {}
        });
    }

    function setScaleMode(mode, shouldBroadcast = true){
        const next = normalizeScaleMode(mode);
        try {
            localStorage.setItem(SCALE_KEY, next);
        } catch(e) {}
        applyScale(next);
        if(shouldBroadcast) broadcastScale(next);
    }

    let resizeTimer = null;
    let autoScalePausedUntil = 0;
    function pauseAutoScale(duration = 650){
        autoScalePausedUntil = Math.max(autoScalePausedUntil, Date.now() + Math.max(0, Number(duration) || 0));
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(scheduleAutoScaleRefresh, Math.max(0, autoScalePausedUntil - Date.now()) + 40);
    }

    function scheduleAutoScaleRefresh(){
        clearTimeout(resizeTimer);
        const wait = autoScalePausedUntil - Date.now();
        if(wait > 0) {
            resizeTimer = setTimeout(scheduleAutoScaleRefresh, wait + 40);
            return;
        }
        resizeTimer = setTimeout(() => {
            if(currentScaleMode() === 'auto') {
                applyScale('auto');
                broadcastScale('auto');
            }
        }, 160);
    }

    function scanlinesOn(){
        try { return localStorage.getItem(SCAN_KEY) === '1'; } catch(e) { return false; }
    }

    function hexToRgb(hex){
        const raw = String(hex || '').replace('#', '');
        const full = raw.length === 3 ? raw.split('').map(ch => ch + ch).join('') : raw;
        if(!/^[0-9a-fA-F]{6}$/.test(full)) return [26, 39, 68];
        return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
    }

    function rgbToHex(rgb){
        return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
    }

    function mixRgb(a, b, t){
        return a.map((v, i) => v + (b[i] - v) * t);
    }

    function ladderFrom(hex, dark){
        const base = hexToRgb(hex);
        const toward = dark ? [8, 10, 16] : [247, 246, 244];
        const steps = dark ? [0.34, 0.48, 0.62, 0.74, 0.84] : [0.07, 0.03, 0.12, 0.2, 0.28];
        return steps.map(t => rgbToHex(mixRgb(toward, base, t)));
    }

    function currentPalette(){
        try {
            const key = localStorage.getItem(PALETTE_KEY) || 'ink';
            return key === 'custom' || PALETTES[key] ? key : 'ink';
        } catch(e) { return 'ink'; }
    }

    function currentPaletteColor(){
        try {
            const value = localStorage.getItem(PALETTE_COLOR_KEY) || '#1a2744';
            return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : '#1a2744';
        } catch(e) { return '#1a2744'; }
    }

    function paletteLadders(){
        const key = currentPalette();
        if(key === 'custom') {
            const color = currentPaletteColor();
            return { dark: ladderFrom(color, true), light: ladderFrom(color, false), color };
        }
        const found = PALETTES[key] || PALETTES.ink;
        return { dark: found.dark, light: found.light, color: found.dark[1] };
    }

    function ensurePaletteStyle(){
        let style = document.getElementById('studio-palette-style');
        if(!style){
            style = document.createElement('style');
            style.id = 'studio-palette-style';
        }
        (document.body || document.head).appendChild(style);
        return style;
    }

    function panelClear(){
        try {
            const raw = localStorage.getItem(PANEL_ALPHA_KEY);
            if(raw == null || raw === '') return 20;
            const n = Math.round(Number(raw));
            return Number.isFinite(n) ? Math.max(0, Math.min(40, n)) : 20;
        } catch(e) { return 20; }
    }

    function rgba(hex, alpha){
        const [r, g, b] = hexToRgb(hex);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    function surfaceCss(list, scope){
        const clear = panelClear();
        const panelAlpha = (1 - clear / 100).toFixed(3);
        const softAlpha = Math.min(1, 1 - Math.max(0, clear - 6) / 100).toFixed(3);
        const wash = Math.round(clear * 1.5);
        const accentWash = Math.round(clear * 0.65);
        return `${scope} .sidebar.sidebar,${scope} #settings-panel{background:${rgba(list[1], panelAlpha)} !important;background-color:${rgba(list[1], panelAlpha)} !important;backdrop-filter:none;-webkit-backdrop-filter:none;}
${scope} #settings-panel .settings-side,${scope} #settings-detail,${scope} #settings-look-pane,${scope} #settings-users-pane{background:transparent !important;background-color:transparent !important;}
${scope} .console-card.console-card,${scope} .history-bulk-toolbar.history-bulk-toolbar,${scope} .chat-drawer.chat-drawer,${scope} .chat-history.chat-history{background:${rgba(list[2], softAlpha)} !important;background-color:${rgba(list[2], softAlpha)} !important;backdrop-filter:none;-webkit-backdrop-filter:none;}
${scope} .app-shell.app-shell::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(920px 560px at 0% 0%, color-mix(in srgb, ${list[4]} ${wash}%, transparent), transparent 72%),radial-gradient(640px 420px at 0% 100%, color-mix(in srgb, var(--accent, #06b6d4) ${accentWash}%, transparent), transparent 70%);}
${scope} .stage.stage{z-index:1;}`;
    }

    function applyPalette(){
        const style = ensurePaletteStyle();
        const ladders = paletteLadders();
        const write = (list) => `--ui-bg:${list[0]};--ui-panel:${list[1]};--ui-soft:${list[2]};--ui-line:${list[3]};--ui-line-strong:${list[4]};--bg:${list[0]};--bg-base:${list[0]};--stage-bg:${list[0]};--sidebar-bg:${list[1]};--card:${list[2]};--scrollbar:color-mix(in srgb, var(--ui-text, #5c5b54) 42%, ${list[3]});--scrollbar-hover:color-mix(in srgb, var(--ui-text, #5c5b54) 64%, ${list[3]});`;
        const dark = ladders.dark;
        style.textContent = `:root{${write(ladders.light)}}html.studio-theme-dark,html.studio-theme-dark body,body.theme-dark,body.studio-theme-dark{${write(dark)}}
html.studio-theme-dark body.studio-theme-dark{background:${dark[0]} !important;background-color:${dark[0]} !important;}
html.studio-theme-dark body .app-shell.app-shell,html.studio-theme-dark body .stage.stage{background:${dark[0]} !important;background-color:${dark[0]} !important;}
${surfaceCss(ladders.light, 'html:not(.studio-theme-dark) body')}
${surfaceCss(dark, 'html.studio-theme-dark body')}
*{scrollbar-color:var(--scrollbar) transparent !important;}
*::-webkit-scrollbar-track,*::-webkit-scrollbar-corner{background:transparent !important;}
*::-webkit-scrollbar-thumb{background-color:var(--scrollbar) !important;border:3px solid transparent !important;background-clip:padding-box !important;border-radius:10px !important;}
*::-webkit-scrollbar-thumb:hover{background-color:var(--scrollbar-hover) !important;}`;
    }
    function currentAccent(){
        try {
            const key = localStorage.getItem(ACCENT_KEY) || '';
            return ACCENTS[key] ? key : '';
        } catch(e) { return ''; }
    }

    function ensureLookStyle(){
        if(document.getElementById('studio-look-style')) return;
        const style = document.createElement('style');
        style.id = 'studio-look-style';
        document.head.appendChild(style);
    }

    function applyLook(){
        const on = scanlinesOn();
        document.documentElement.classList.toggle('scanlines-on', on);
        if(document.body) document.body.classList.toggle('scanlines-on', on);
        ensureLookStyle();
        const style = document.getElementById('studio-look-style');
        const accent = currentAccent();
        if(!accent){
            style.textContent = '';
            return;
        }
        const pair = ACCENTS[accent];
        const glow = pair[1];
        style.textContent = `html, body, body.theme-dark, html.studio-theme-dark, html.studio-theme-dark body { --accent:${pair[0]}; --accent-glow:${glow}; --look-accent:${glow}; }
body.studio-theme-dark .btn-render, body.theme-dark .btn-render, body.studio-theme-dark .anima-ctrl.active, body.theme-dark .anima-ctrl.active { color:#141414 !important; border-color:${glow} !important; background:${glow} !important; }`;
    }

    window.StudioLook = {
        accents: Object.keys(ACCENTS),
        scanlines(){ return scanlinesOn(); },
        setScanlines(on){
            try { localStorage.setItem(SCAN_KEY, on ? '1' : '0'); } catch(e) {}
            applyLook();
            window.dispatchEvent(new CustomEvent('studio-look-change'));
        },
        accent: currentAccent,
        setAccent(key){
            const next = ACCENTS[key] ? key : '';
            try { localStorage.setItem(ACCENT_KEY, next); } catch(e) {}
            applyLook();
            window.dispatchEvent(new CustomEvent('studio-look-change'));
        },
        palettes: Object.keys(PALETTES),
        palette: currentPalette,
        paletteColor: currentPaletteColor,
        panelAlpha: panelClear,
        setPanelAlpha(value){
            const next = Math.max(0, Math.min(40, Math.round(Number(value) || 0)));
            try { localStorage.setItem(PANEL_ALPHA_KEY, String(next)); } catch(e) {}
            applyPalette();
            window.dispatchEvent(new CustomEvent('studio-look-change'));
        },
        setPalette(key){
            const next = key === 'custom' || PALETTES[key] ? key : 'ink';
            try { localStorage.setItem(PALETTE_KEY, next); } catch(e) {}
            applyPalette();
            window.dispatchEvent(new CustomEvent('studio-look-change'));
        },
        setPaletteColor(hex){
            const next = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex) ? hex : '#1a2744';
            try {
                localStorage.setItem(PALETTE_COLOR_KEY, next);
                localStorage.setItem(PALETTE_KEY, 'custom');
            } catch(e) {}
            applyPalette();
            window.dispatchEvent(new CustomEvent('studio-look-change'));
        }
    };

    window.StudioTheme = {
        key: KEY,
        get: currentTheme,
        apply: applyTheme,
        set(theme){
            const next = theme === 'dark' ? 'dark' : 'light';
            localStorage.setItem(KEY, next);
            localStorage.setItem(LEGACY_KEY, next);
            applyTheme(next);
        }
    };

    window.StudioScale = {
        key: SCALE_KEY,
        options: SCALE_OPTIONS.slice(),
        getMode: currentScaleMode,
        getScale: () => scaleForMode(currentScaleMode()),
        apply: applyScale,
        set: setScaleMode
    };

    applyTheme(currentTheme());
    applyScale(currentScaleMode());
    applyLook();
    applyPalette();

    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(currentTheme());
        applyScale(currentScaleMode());
        applyLook();
        applyPalette();
    });
    window.addEventListener('message', event => {
        if(event.data?.type === 'studio-theme') applyTheme(event.data.theme);
        if(event.data?.type === 'studio-ui-scale') {
            const incomingScale = normalizeExternalScale(event.data.scale);
            if(incomingScale !== null) externalScaleValue = incomingScale;
            setScaleMode(event.data.mode, false);
        }
        if(event.data?.type === 'studio-ui-scale-pause') pauseAutoScale(event.data.duration);
    });
    window.addEventListener('storage', event => {
        if(event.key === KEY || event.key === LEGACY_KEY) applyTheme(currentTheme());
        if(event.key === SCALE_KEY) applyScale(currentScaleMode());
        if(event.key === SCAN_KEY || event.key === ACCENT_KEY) applyLook();
        if(event.key === PALETTE_KEY || event.key === PALETTE_COLOR_KEY || event.key === PANEL_ALPHA_KEY) applyPalette();
    });
    window.addEventListener('resize', scheduleAutoScaleRefresh);
    window.addEventListener('scroll', lockScaledHorizontalScroll, { passive: true });
})();
