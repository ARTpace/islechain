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
            light: ['#f1eee7', '#fffdf7', '#e9e4da', '#dcd4c6', '#bdb2a0']
        },
        night: {
            dark: ['#0e1626', '#162238', '#1e2d48', '#314466', '#42587f'],
            light: ['#e4ebf4', '#f8fafd', '#d9e3f0', '#c2cfe1', '#96abc8']
        },
        pine: {
            dark: ['#101916', '#17241f', '#20302a', '#334840', '#456056'],
            light: ['#e3ecdf', '#f7fbf2', '#d6e3cf', '#bfceb5', '#94ab87']
        },
        dusk: {
            dark: ['#16141f', '#211c2e', '#2c243d', '#43385a', '#574a72'],
            light: ['#eae3f0', '#fbf8fd', '#dfd5e9', '#ccbedb', '#aa96bf']
        },
        sand: {
            dark: ['#1a1612', '#262018', '#32281e', '#4a3c2e', '#5e4e3c'],
            light: ['#f1ece2', '#fffaf0', '#eae1d2', '#dbcfbb', '#b9a88c']
        }
    };
    /* 强调色表：[主色, 辉光色, 前景色]
     * 主色用作实心背景，辅助色用作描边/光晕，前景色是压在该背景上的文字色。
     * 预设采用柔和中间色，实心按钮使用白色文字。 */
    const ACCENTS = {
        cyan:    ['#377984', '#6cabb4', '#ffffff'],
        violet:  ['#76618e', '#a491b9', '#ffffff'],
        amber:   ['#956731', '#c69b60', '#ffffff'],
        emerald: ['#4a775d', '#87aa8c', '#ffffff'],
        rose:    ['#a15e70', '#c98f9d', '#ffffff']
    };
    const SCALE_OPTIONS = ['auto', '60', '65', '70', '75', '80', '85', '90', '95', '100', '115', '125', '140'];

    function currentTheme(){
        try { return localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY) || (window.STUDIO_DEFAULT_THEME || 'dark'); }
        catch(e) { return window.STUDIO_DEFAULT_THEME || 'dark'; }
    }

    function applyTheme(theme){
        const next = theme === 'dark' ? 'dark' : 'light';
        const dark = next === 'dark';
        document.documentElement.classList.toggle('studio-theme-dark', dark);
        // 浅色由应用自行绘制，禁止浏览器自动深色再次反转颜色。
        document.documentElement.style.colorScheme = dark ? 'dark' : 'only light';
        document.documentElement.classList.toggle('theme-dark', dark);
        if(document.body){
            document.body.classList.toggle('studio-theme-dark', dark);
            document.body.classList.toggle('theme-dark', dark);
        }
        applyLook();
        window.dispatchEvent(new CustomEvent('studio-theme-change', { detail: { theme: next } }));
    }

    // 公共视觉入口：独立页和 iframe 都经同一入口加载，不逐页维护组件样式。
    function ensureDesignSystem(){
        const version = '20261112004';
        let base = document.querySelector('link[href*="/static/css/studio-ui.css"]') || document.getElementById('studio-ui-base');
        if(!base){
            base = document.createElement('link');
            base.id = 'studio-ui-base';
            base.rel = 'stylesheet';
            document.head.appendChild(base);
        }
        const baseUrl = '/static/css/studio-ui.css?v=' + version;
        if(base.getAttribute?.('href') !== baseUrl) base.href = baseUrl;
        let controls = document.getElementById('studio-controls');
        if(!controls){
            controls = document.createElement('link');
            controls.id = 'studio-controls';
            controls.rel = 'stylesheet';
            controls.href = '/static/css/studio-controls.css?v=' + version;
        }
        // 解析结束后放在页面局部样式之后；只兼容外观，不接管业务与布局。
        (document.body || document.head).appendChild(controls);
        if(!document.getElementById('studio-appearance-css')){
            const css = document.createElement('link');
            css.id = 'studio-appearance-css';
            css.rel = 'stylesheet';
            css.href = '/static/css/appearance.css?v=' + version;
            (document.body || document.head).appendChild(css);
        }
        if(!document.getElementById('studio-appearance-runtime')){
            const script = document.createElement('script');
            script.id = 'studio-appearance-runtime';
            script.src = '/static/js/appearance.js?v=' + version;
            document.head.appendChild(script);
        }
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
        // 手机使用真实响应式尺寸，自动缩小桌面布局会导致文字和点击区域过小。
        if(next === 'auto' && window.innerWidth <= 700) return 1;
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
        if(mode !== 'auto' || window.innerWidth <= 700 || scaleOptedOut() || contentFitOptedOut() || Number.isFinite(externalScaleValue)) return;
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
        const steps = dark ? [0.34, 0.48, 0.62, 0.74, 0.84] : [0.25, 0.12, 0.36, 0.48, 0.6];
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
${scope} .stage.stage{z-index:1;}
${scope === 'html:not(.studio-theme-dark) body' ? `${scope} .app-shell.app-shell::before{background:none;}` : ''}`;
    }

    function applyPalette(){
        const style = ensurePaletteStyle();
        const ladders = paletteLadders();
        const write = (list) => `--ui-bg:${list[0]};--ui-panel:${list[1]};--ui-soft:${list[2]};--ui-line:${list[3]};--ui-line-strong:${list[4]};--bg:${list[0]};--bg-base:${list[0]};--stage-bg:${list[0]};--sidebar-bg:${list[1]};--card:${list[2]};--page:${list[0]};--panel:${list[1]};--card-solid:${list[1]};--soft:${list[2]};--soft-2:${list[2]};--line:${list[3]};--line-2:${list[4]};--text:var(--ui-text);--muted:var(--ui-muted);--faint:var(--ui-faint);--scrollbar:color-mix(in srgb, var(--ui-text, #5c5b54) 42%, ${list[3]});--scrollbar-hover:color-mix(in srgb, var(--ui-text, #5c5b54) 64%, ${list[3]});`;
        const dark = ladders.dark;
        const panelOpacity = (100 - panelClear()) + '%';
        [document.documentElement, document.body].filter(Boolean).forEach(el => el.style.setProperty('--studio-panel-opacity', panelOpacity));
        // 行内变量优先于后续页面 CSS；首屏不再先使用默认蓝灰色，且无需隐藏正文。
        const active = document.documentElement.classList.contains('studio-theme-dark') ? dark : ladders.light;
        [document.documentElement, document.body].filter(Boolean).forEach(el => {
            write(active).split(';').filter(Boolean).forEach(declaration => {
                const colon = declaration.indexOf(':');
                el.style.setProperty(declaration.slice(0, colon), declaration.slice(colon + 1));
            });
        });
        if(!document.documentElement.classList.contains('desktop-overlay')) {
            document.documentElement.style.setProperty('background-color', active[0]);
        }
        style.textContent = `:root{${write(ladders.light)}}html.studio-theme-dark,html.studio-theme-dark body,body.theme-dark,body.studio-theme-dark{${write(dark)}}
html.studio-theme-dark body{background:${dark[0]} !important;background-color:${dark[0]} !important;}
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
            return ACCENTS[key] || /^#[0-9a-fA-F]{6}$/.test(key) ? key : '';
        } catch(e) { return ''; }
    }

    function ensureLookStyle(){
        if(document.getElementById('studio-look-style')) return;
        const style = document.createElement('style');
        style.id = 'studio-look-style';
        document.head.appendChild(style);
    }

    // 「外观」强调色统一写入行内自定义属性（内联优先级最高），
    // 这样 index.html 里 :root/body.theme-dark 的写死值、studio-ui 的 --ui-accent 都会被盖掉，
    // 侧边栏 / LOGO / 按钮 / 聚焦环 / iframe 内页面全部跟随同一套颜色。
    const LOOK_VARS = ['--accent','--accent-glow','--accent-ink','--look-accent','--ui-accent','--ui-accent-glow','--ui-accent-soft','--ui-accent-ink'];

    // 用感知明度生成角色色；超出 sRGB 时降低色度，不直接截断通道导致偏色。
    function accentScheme(seed, dark){
        const linear = hexToRgb(seed).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
        const [r,g,b] = linear;
        const l = Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
        const m = Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
        const s = Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
        const a = 1.9779984951*l-2.428592205*m+.4505937099*s;
        const bb = .0259040371*l+.7827717662*m-.808675766*s;
        // 浅色主题降低色度上限，强调色更通透清新；深色保持原有浓度。
        const hue = Math.atan2(bb,a), chroma = Math.min(dark?.14:.09,Math.hypot(a,bb));
        function tone(lightness, saturation){
            let c = saturation, rgb;
            for(let i=0;i<40;i++){
                const aa=c*Math.cos(hue), ab=c*Math.sin(hue);
                const ll=(lightness+.3963377774*aa+.2158037573*ab)**3;
                const mm=(lightness-.1055613458*aa-.0638541728*ab)**3;
                const ss=(lightness-.0894841775*aa-1.291485548*ab)**3;
                rgb=[4.0767416621*ll-3.3077115913*mm+.2309699292*ss,-1.2684380046*ll+2.6097574011*mm-.3413193965*ss,-.0041960863*ll-.7034186147*mm+1.707614701*ss];
                if(rgb.every(v=>v>=0 && v<=1)) break;
                c *= .85;
            }
            return '#'+rgb.map(v=>Math.round(255*Math.max(0,Math.min(1,v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055))).toString(16).padStart(2,'0')).join('');
        }
        return {
            base:tone(dark?.76:.46,chroma), hover:tone(dark?.81:.40,chroma), active:tone(dark?.70:.35,chroma),
            ink:dark?'#171a1f':'#fffdf7', soft:tone(dark?.28:.95,chroma*.18),
            softHover:tone(dark?.33:.91,chroma*.28), text:tone(dark?.85:.38,chroma*.75),
            line:tone(dark?.53:.72,chroma*.45), focus:tone(dark?.76:.46,chroma)
        };
    }
    const ACCENT_ROLES = ['hover','active','soft','soft-hover','text','line','focus'];
    function applyLookVars(pair, scheme){
        document.documentElement.classList.toggle('studio-accent-customized', Boolean(scheme));
        const roots = [document.documentElement, document.body].filter(Boolean);
        roots.forEach(el => {
            const values = scheme ? [scheme.hover,scheme.active,scheme.soft,scheme.softHover,scheme.text,scheme.line,scheme.focus] : [];
            ACCENT_ROLES.forEach((role,i) => {
                const key = '--studio-accent-'+role;
                if(scheme) el.style.setProperty(key,values[i]); else el.style.removeProperty(key);
            });
            if(!pair){
                LOOK_VARS.forEach(k => el.style.removeProperty(k));
                return;
            }
            const base = pair[0], glow = pair[1], ink = pair[2];
            el.style.setProperty('--accent', base);
            el.style.setProperty('--accent-glow', glow);
            el.style.setProperty('--accent-ink', ink);
            el.style.setProperty('--look-accent', glow);
            el.style.setProperty('--ui-accent', scheme ? base : (document.documentElement.classList.contains('studio-theme-dark') ? glow : base));
            el.style.setProperty('--ui-accent-glow', base);
            el.style.setProperty('--ui-accent-ink', ink);
            el.style.setProperty('--ui-accent-soft', scheme ? scheme.soft : `color-mix(in srgb, ${glow} 18%, var(--ui-panel))`);
        });
    }

    function applyLook(){
        const on = scanlinesOn();
        document.documentElement.classList.toggle('scanlines-on', on);
        if(document.body) document.body.classList.toggle('scanlines-on', on);
        const accent = currentAccent();
        // 保留用户主动选择的强调色；浅色默认使用低饱和暖褐，不影响深色默认。
        const fallback = document.documentElement.classList.contains('studio-theme-dark') ? null : ['#795b3c', '#947453', '#fffdf7'];
        const custom = /^#[0-9a-fA-F]{6}$/.test(accent);
        const seed = custom ? accent : (ACCENTS[accent] || [])[0];
        const scheme = seed ? accentScheme(seed, document.documentElement.classList.contains('studio-theme-dark')) : null;
        applyLookVars(scheme ? [scheme.base, scheme.hover, scheme.ink] : fallback, scheme);
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
            const next = ACCENTS[key] || /^#[0-9a-fA-F]{6}$/.test(key) ? key : '';
            try { localStorage.setItem(ACCENT_KEY, next); } catch(e) {}
            applyLook();
            window.dispatchEvent(new CustomEvent('studio-look-change'));
        },
        paletteColors(key){
            const palette = PALETTES[key] || PALETTES.ink;
            return palette[document.documentElement.classList.contains('studio-theme-dark') ? 'dark' : 'light'].slice();
        },
        accentColor(key){ return (ACCENTS[key] || ['#c7501f'])[0]; },
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
        apply(theme = currentTheme()){ applyTheme(theme); applyPalette(); },
        set(theme){
            const next = theme === 'dark' ? 'dark' : 'light';
            localStorage.setItem(KEY, next);
            localStorage.setItem(LEGACY_KEY, next);
            applyTheme(next);
            applyPalette();
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

    if(document.readyState !== 'loading') ensureDesignSystem();
    applyTheme(currentTheme());
    applyScale(currentScaleMode());
    applyLook();
    applyPalette();

    // body 自己也定义主题变量，不能只靠 html 继承，更不能等到 DOMContentLoaded。
    if(!document.body){
        const bodyAppearance = new MutationObserver(() => {
            if(!document.body) return;
            applyTheme(currentTheme());
            applyLook();
            applyPalette();
            bodyAppearance.disconnect();
        });
        bodyAppearance.observe(document.documentElement, {childList:true});
    }

    document.addEventListener('DOMContentLoaded', () => {
        ensureDesignSystem();
        applyTheme(currentTheme());
        applyScale(currentScaleMode());
        applyLook();
        applyPalette();
        if(window.parent && window.parent !== window) requestAnimationFrame(() => {
            window.parent.postMessage({type:'studio-page-ready'}, location.origin);
        });
    });
    window.addEventListener('message', event => {
        if(event.data?.type === 'studio-theme') { applyTheme(event.data.theme); applyPalette(); }
        if(event.data?.type === 'studio-ui-scale') {
            const incomingScale = normalizeExternalScale(event.data.scale);
            if(incomingScale !== null) externalScaleValue = incomingScale;
            setScaleMode(event.data.mode, false);
        }
        if(event.data?.type === 'studio-ui-scale-pause') pauseAutoScale(event.data.duration);
    });
    window.addEventListener('storage', event => {
        if(event.key === KEY || event.key === LEGACY_KEY) { applyTheme(currentTheme()); applyPalette(); }
        if(event.key === SCALE_KEY) applyScale(currentScaleMode());
        if(event.key === SCAN_KEY || event.key === ACCENT_KEY) applyLook();
        if(event.key === PALETTE_KEY || event.key === PALETTE_COLOR_KEY || event.key === PANEL_ALPHA_KEY) applyPalette();
    });
    window.addEventListener('resize', scheduleAutoScaleRefresh);
    window.addEventListener('scroll', lockScaledHorizontalScroll, { passive: true });

    // 仅向内置的沙箱预览传递界面色，不向用户网页或渲染场景发送颜色。
    const previewTokens=['--ui-bg','--ui-panel','--ui-soft','--ui-line','--ui-line-strong','--ui-text','--ui-muted','--ui-faint','--ui-accent','--ui-accent-soft','--ui-accent-ink','--ui-error'];
    function syncPreviewTheme(frame){
        if(!frame?.matches?.('iframe.m3d-viewer'))return;
        const style=getComputedStyle(document.body||document.documentElement);
        const tokens=Object.fromEntries(previewTokens.map(key=>[key,style.getPropertyValue(key).trim()]));
        frame.contentWindow?.postMessage({type:'studio-preview-theme',tokens,dark:document.documentElement.classList.contains('studio-theme-dark')},'*');
    }
    let previewThemeFrame=0;
    function schedulePreviewTheme(){
        if(previewThemeFrame)return;
        previewThemeFrame=requestAnimationFrame(()=>{previewThemeFrame=0;document.querySelectorAll('iframe.m3d-viewer').forEach(syncPreviewTheme);});
    }
    document.addEventListener('load',event=>syncPreviewTheme(event.target),true);
    const watchPreviewTheme=()=>{
        const observer=new MutationObserver(schedulePreviewTheme);
        observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style']});
        if(document.body)observer.observe(document.body,{attributes:true,attributeFilter:['class','style']});
        const palette=document.getElementById('studio-palette-style');
        if(palette)observer.observe(palette,{childList:true,characterData:true,subtree:true});
        schedulePreviewTheme();
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watchPreviewTheme,{once:true});else watchPreviewTheme();
})();
