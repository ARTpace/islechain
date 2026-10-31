/* 登录页背景引擎 · 极光流体
 *
 * 设计约束（可演进，不写死）：
 *  1. 颜色全部从 CSS 变量派生（--ui-bg / --accent / --ui-accent），自动跟随
 *     theme.js 的 5 套调色板与明暗态，换主题即时生效，无需改本文件；
 *  2. 预设走注册表 PRESETS，新增风格只需加一个 factory；
 *     切换入口：URL ?bg=xxx 或 localStorage 'login_bg_preset'；
 *  3. 低分辨率离屏渲染 + 浏览器插值放大，单帧开销约为原星空方案的 1/50；
 *  4. 尊重 prefers-reduced-motion，页面隐藏时停帧。
 */
(function () {
    'use strict';

    var PRESET_KEY = 'login_bg_preset';
    var FRAME_MS = 1000 / 30;          // 极光很慢，30fps 足够
    var BUFFER_SCALE = 5;              // 1/5 分辨率渲染后拉伸，天然柔化
    var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    /* ---------------------------- 颜色工具 ---------------------------- */

    function parseColor(input) {
        if (!input) return null;
        var s = String(input).trim();
        var m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (m) {
            var h = m[1];
            if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
            return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
        }
        m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
        return m ? [+m[1], +m[2], +m[3]] : null;
    }

    function rgbToHsl(rgb) {
        var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var l = (max + min) / 2, h = 0, s = 0;
        if (max !== min) {
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h /= 6;
        }
        return [h, s, l];
    }

    function hslToRgb(h, s, l) {
        h = ((h % 1) + 1) % 1;
        s = Math.max(0, Math.min(1, s));
        l = Math.max(0, Math.min(1, l));
        if (s === 0) {
            var v = Math.round(l * 255);
            return [v, v, v];
        }
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        function channel(t) {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        }
        return [Math.round(channel(h + 1 / 3) * 255), Math.round(channel(h) * 255), Math.round(channel(h - 1 / 3) * 255)];
    }

    /* 色相偏移 + 饱和度/明度微调，用来在同一主题下派生出一组协调色 */
    function shiftHue(rgb, deg, satMul, lightMul) {
        var hsl = rgbToHsl(rgb);
        return hslToRgb(hsl[0] + deg / 360, hsl[1] * (satMul == null ? 1 : satMul), hsl[2] * (lightMul == null ? 1 : lightMul));
    }

    function rgba(rgb, a) {
        return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a.toFixed(3) + ')';
    }

    function solid(rgb) {
        return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
    }

    /* ---------------------------- 主题读取 ---------------------------- */

    function readPalette() {
        var root = document.documentElement;
        var cs = window.getComputedStyle(root);
        var dark = root.classList.contains('studio-theme-dark') || root.classList.contains('theme-dark');
        var bg = parseColor(cs.getPropertyValue('--ui-bg')) ||
                 parseColor(cs.getPropertyValue('--bg')) ||
                 (dark ? [20, 22, 28] : [247, 246, 244]);
        var accent = parseColor(cs.getPropertyValue('--accent')) ||
                     parseColor(cs.getPropertyValue('--ui-accent')) ||
                     [14, 116, 144];
        /* 调色板身份色：各套 palette 的 --ui-line-strong 差异明显（紫/绿/蓝/棕），
           用它派生主色才能真正做到「换调色板背景跟着变」；accent 各深色主题下相同，
           只用来做品牌点缀。浅色模式下该值过浅，不参与。 */
        var hint = dark ? (parseColor(cs.getPropertyValue('--ui-line-strong')) ||
                           parseColor(cs.getPropertyValue('--ui-line'))) : null;
        return { bg: bg, accent: accent, hint: hint, dark: dark };
    }

    /* ------------------------- 极光：光团定义 ------------------------- */
    /* 归一化坐标，resize 无关。x/y 为基准位，ax/ay 为漂移幅度，period 为周期(秒) */
    var ORBS = [
        { x: 0.18, y: 0.24, rx: 0.54, ry: 0.66, ax: 0.14, ay: 0.10, period: 29, phase: 0.00, c: 0 },
        { x: 0.76, y: 0.18, rx: 0.48, ry: 0.58, ax: 0.12, ay: 0.11, period: 37, phase: 1.35, c: 1 },
        { x: 0.50, y: 0.78, rx: 0.60, ry: 0.44, ax: 0.17, ay: 0.08, period: 43, phase: 2.60, c: 2 },
        { x: 0.90, y: 0.70, rx: 0.36, ry: 0.42, ax: 0.10, ay: 0.12, period: 33, phase: 4.10, c: 3 },
        { x: 0.08, y: 0.84, rx: 0.40, ry: 0.36, ax: 0.11, ay: 0.09, period: 39, phase: 5.20, c: 1 }
    ];
    /* 竖长光帘：细而高，做纵深质感 */
    var VEILS = [
        { x: 0.30, rx: 0.16, ry: 0.92, amp: 0.16, period: 47, phase: 0.6, c: 0 },
        { x: 0.62, rx: 0.12, ry: 0.86, amp: 0.20, period: 53, phase: 2.2, c: 2 },
        { x: 0.84, rx: 0.14, ry: 0.78, amp: 0.13, period: 41, phase: 3.9, c: 1 }
    ];

    function createAurora(ctx) {
        var colors = [[14, 116, 144]];
        var bgColor = [20, 22, 28];
        var dark = true;
        var intensity = 0.5;

        /* 焦点收束（光之解锁）：focusX/Y 为归一化目标坐标，strength 平滑 0→1。
           不写死拉拽系数，留给策略层通过 setFocus 调节；这里只用保守默认值。 */
        var focusX = 0.5, focusY = 0.45;
        var focusStrength = 0, focusTarget = 0;

        /* 色相夹角（0-180），用于判断两色是否冷暖对撞 */
        function hueGap(x, y) {
            var hx = rgbToHsl(x)[0] * 360;
            var hy = rgbToHsl(y)[0] * 360;
            return Math.abs(((hx - hy + 540) % 360) - 180);
        }

        function setPalette(pal) {
            dark = pal.dark;
            bgColor = pal.bg;
            var a = pal.accent;
            var h = pal.hint || a;
            if (dark) {
                /* 主色取调色板身份色（提亮 + 提饱和，才够“极光”）；
                   品牌色只做点缀且压暗 —— #00f0ff 这类高亮青直接叠加会过曝成荧光色。
                   色相偏移一律控制在 ±50° 内，避免跳进绿/红互补区。 */
                intensity = 0.52;
                if (hueGap(h, a) > 100) {
                    /* 冷暖对撞（如 sand 的暖棕底 + 冷青品牌色）会在中间混出浑浊的橄榄绿，
                       此时整组改用调色板同族色，保证画面干净；品牌色退为极弱点缀 */
                    colors = [
                        shiftHue(h, 0, 1.65, 1.48),
                        shiftHue(h, 26, 1.60, 1.58),
                        shiftHue(h, -24, 1.70, 1.42),
                        shiftHue(h, 46, 1.45, 1.34)
                    ];
                } else {
                    colors = [
                        shiftHue(h, 0, 1.65, 1.48),
                        shiftHue(a, 0, 0.80, 0.74),
                        shiftHue(h, 30, 1.70, 1.56),
                        shiftHue(a, 46, 0.72, 0.68)
                    ];
                }
            } else {
                /* 浅色：单一 accent 派生。降饱和 + 大幅提明度，做成淡彩水彩雾，
                   否则高饱和色在浅底上会显得像廉价渐变壁纸 */
                intensity = 0.30;
                colors = [
                    shiftHue(a, 0, 0.80, 1.98),
                    shiftHue(a, 30, 0.78, 2.06),
                    shiftHue(a, -22, 0.82, 1.92),
                    shiftHue(a, 58, 0.74, 2.02)
                ];
            }
        }

        /* 焦点收束入口：nx/ny 为归一化[0,1]坐标（由 login.js 传入输入框中心），
           active 控制是否收束。坐标缺省时只切换 active 不移动焦点位置。
           instant=true 时强度直接跳到目标态（无障碍：prefers-reduced-motion 下
           不播收敛动画；截图/演示也能在一帧内成型，不依赖连续多帧爬升）。 */
        function setFocus(nx, ny, active, instant) {
            if (typeof nx === 'number' && isFinite(nx)) { focusX = nx; focusY = ny; }
            focusTarget = active ? 1 : 0;
            if (instant || reduceMotion) focusStrength = focusTarget;
        }

        function paintOrb(cx, cy, rx, ry, color, alpha) {
            if (alpha <= 0.002) return;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(1, ry / rx);
            var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
            g.addColorStop(0, rgba(color, alpha));
            g.addColorStop(0.40, rgba(color, alpha * 0.58));
            g.addColorStop(0.72, rgba(color, alpha * 0.18));
            g.addColorStop(1, rgba(color, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(0, 0, rx, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        function frame(t, w, h) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = solid(bgColor);
            ctx.fillRect(0, 0, w, h);

            /* 深色用叠加发光；浅色用普通叠加，否则会全部冲白 */
            ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';

            // 焦点收束（光之解锁）：强度平滑过渡，光团向焦点轻拉
            focusStrength += (focusTarget - focusStrength) * 0.08;
            var fx = focusX * w, fy = focusY * h;
            var pull = focusStrength * 0.5;

            var i, o, ang, cx, cy, breath;
            for (i = 0; i < ORBS.length; i++) {
                o = ORBS[i];
                ang = (t / o.period + o.phase) * Math.PI * 2;
                cx = (o.x + Math.sin(ang) * o.ax + Math.sin(ang * 1.7 + 1.1) * o.ax * 0.45) * w;
                cy = (o.y + Math.cos(ang * 0.8) * o.ay + Math.sin(ang * 2.3) * o.ay * 0.35) * h;
                cx += (fx - w / 2) * pull;
                cy += (fy - h / 2) * pull;
                breath = 0.80 + 0.20 * Math.sin(ang * 1.3 + o.phase);
                paintOrb(cx, cy, o.rx * w, o.ry * h, colors[o.c % colors.length], intensity * breath);
            }

            for (i = 0; i < VEILS.length; i++) {
                o = VEILS[i];
                ang = (t / o.period + o.phase) * Math.PI * 2;
                cx = (o.x + Math.sin(ang) * o.amp) * w;
                cy = (0.5 + Math.cos(ang * 0.7) * 0.06) * h;
                breath = 0.55 + 0.45 * Math.sin(ang * 1.1 + 0.9);
                paintOrb(cx, cy, o.rx * w, o.ry * h, colors[(o.c + 1) % colors.length], intensity * 0.30 * breath);
            }

            // 焦点光环：在输入框背后聚出一道光，呼应「被光包住」的解锁仪式感
            if (focusStrength > 0.01) {
                var fr = (0.36 + 0.10 * (1 - focusStrength)) * w;
                paintOrb(fx, fy, fr, fr * 1.22, colors[0], intensity * 0.92 * focusStrength);
                paintOrb(fx, fy, fr * 0.52, fr * 0.6, colors[1] || colors[0], intensity * 0.66 * focusStrength);
            }

            ctx.globalCompositeOperation = 'source-over';
        }

        return { setPalette: setPalette, frame: frame, setFocus: setFocus };
    }

    var PRESETS = {
        aurora: createAurora
    };

    function resolvePresetName() {
        try {
            var q = new URLSearchParams(window.location.search).get('bg');
            if (q && PRESETS[q]) return q;
            var saved = window.localStorage.getItem(PRESET_KEY);
            if (saved && PRESETS[saved]) return saved;
        } catch (e) { /* 隐私模式等场景静默降级 */ }
        return 'aurora';
    }

    /* ----------------------------- 引擎 ----------------------------- */

    var state = null;

    function resize() {
        if (!state) return;
        var canvas = state.canvas;
        var w = document.documentElement.clientWidth || window.innerWidth;
        var h = document.documentElement.clientHeight || window.innerHeight;
        var bw = Math.max(64, Math.round(w / BUFFER_SCALE));
        var bh = Math.max(64, Math.round(h / BUFFER_SCALE));
        canvas.width = bw;
        canvas.height = bh;
        state.width = bw;
        state.height = bh;
        if (reduceMotion && state.impl) state.impl.frame(0, bw, bh);
    }

    function loop(now) {
        if (!state) return;
        state.raf = window.requestAnimationFrame(loop);
        if (document.hidden) return;
        if (state.last && now - state.last < FRAME_MS) return;
        var dt = state.last ? (now - state.last) / 1000 : 0;
        state.last = now;
        state.clock += Math.min(0.2, dt);
        state.impl.frame(state.clock, state.width, state.height);
    }

    function refreshPalette() {
        if (!state) return;
        var pal = readPalette();
        state.impl.setPalette(pal);
        document.documentElement.setAttribute('data-login-bg-dark', pal.dark ? '1' : '0');
        if (reduceMotion) state.impl.frame(state.clock, state.width, state.height);
    }

    var LoginBg = {
        presets: function () { return Object.keys(PRESETS); },

        mount: function (canvas, options) {
            if (!canvas) return null;
            var opts = options || {};
            var name = opts.preset || resolvePresetName();
            var factory = PRESETS[name] || PRESETS.aurora;
            var ctx = canvas.getContext('2d', { alpha: false });
            if (!ctx) return null;

            if (state && state.raf) window.cancelAnimationFrame(state.raf);

            state = {
                canvas: canvas,
                impl: factory(ctx),
                clock: 0,
                last: 0,
                raf: 0,
                width: 0,
                height: 0,
                preset: name
            };

            resize();
            refreshPalette();

            window.addEventListener('resize', resize);
            /* studio-theme-change：明暗切换；studio-look-change：调色板/强调色/面板透明度 */
            window.addEventListener('studio-theme-change', refreshPalette);
            window.addEventListener('studio-look-change', refreshPalette);
            window.addEventListener('storage', function (e) {
                if (e.key === 'studio_palette' || e.key === 'studio_palette_color' || e.key === 'studio_accent' || e.key === 'studio_theme') {
                    refreshPalette();
                }
            });

            if (reduceMotion) {
                state.impl.frame(0, state.width, state.height);
            } else {
                state.raf = window.requestAnimationFrame(loop);
            }
            return name;
        },

        setPreset: function (name) {
            if (!PRESETS[name] || !state) return false;
            try { window.localStorage.setItem(PRESET_KEY, name); } catch (e) { /* ignore */ }
            var canvas = state.canvas;
            if (state.raf) window.cancelAnimationFrame(state.raf);
            state = null;
            LoginBg.mount(canvas, { preset: name });
            return true;
        },

        current: function () { return state ? state.preset : null; },

        /* 焦点收束（光之解锁）：nx/ny 归一化坐标，active 是否收束，instant 是否瞬间成型 */
        setFocus: function (nx, ny, active, instant) {
            if (!state || !state.impl || !state.impl.setFocus) return;
            state.impl.setFocus(nx, ny, active, instant);
        },

        stop: function () {
            if (state && state.raf) window.cancelAnimationFrame(state.raf);
            state = null;
        }
    };

    window.LoginBg = LoginBg;
})();
