// static/modules/settings.js
// 设置面板模块 - 管理 API Key 配置 + 账号登录

class SettingsStorage {
    static STORAGE_KEY = 'art_ai_settings';
    
    static DEFAULTS = {
        comfly_api_key: '',
        comfly_base_url: 'https://ukiyoapi.apifox.cn/',
        modelscope_api_key: ''
    };
    
    static load() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (!raw) return { ...this.DEFAULTS };
            const parsed = JSON.parse(raw);
            return { ...this.DEFAULTS, ...parsed };
        } catch (e) {
            console.error('SettingsStorage.load error:', e);
            return { ...this.DEFAULTS };
        }
    }
    
    static save(data) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.error('SettingsStorage.save error:', e);
        }
    }
}

class AuthManager {
    static TOKEN_KEY = 'xy_auth_token';
    static USER_KEY = 'xy_auth_user';
    
    static getToken() {
        return localStorage.getItem(this.TOKEN_KEY) || '';
    }
    
    static setToken(token) {
        localStorage.setItem(this.TOKEN_KEY, token);
    }
    
    static getUser() {
        try {
            return JSON.parse(localStorage.getItem(this.USER_KEY) || 'null');
        } catch (e) {
            return null;
        }
    }
    
    static setUser(user) {
        localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    }
    
    static isLoggedIn() {
        return !!this.getToken() && !!this.getUser();
    }
    
    static isAdmin() {
        const user = this.getUser();
        return user && user.is_admin === true;
    }
    
    static async verify() {
        const token = this.getToken();
        if (!token) return false;
        try {
            const resp = await fetch('/api/auth/me?token=' + encodeURIComponent(token));
            if (resp.status === 401) {
                // token 无效/过期:清掉 localStorage 并跳登录,避免 UI 卡在'未登录'但脏数据残留
                console.warn('[AuthManager] verify 401, token 已失效,清理并跳转登录');
                this.clear();
                if (!window.location.pathname.endsWith('login.html')) {
                    window.location.replace('/static/login.html');
                }
                return false;
            }
            if (!resp.ok) {
                return false;
            }
            const data = await resp.json();
            this.setUser({ username: data.username, is_admin: data.is_admin });
            this.setToken(token);
            return true;
        } catch (e) {
            return false;
        }
    }
    
    static async login(username, password) {
        const resp = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || '登录失败');
        }
        const data = await resp.json();
        this.setToken(data.token);
        this.setUser({ username: data.username, is_admin: data.is_admin });
        return data;
    }
    
    static async register(username, password) {
        const resp = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || '注册失败');
        }
        const data = await resp.json();
        this.setToken(data.token);
        this.setUser({ username: data.username, is_admin: data.is_admin });
        return data;
    }
    
    static async logout() {
        const token = this.getToken();
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token })
            });
        } catch (e) {}
        this.clear();
    }
    
    static clear() {
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
    }

    static getAuthToken() {
        return this.getToken();
    }

    static getCurrentUsername() {
        const user = this.getUser();
        return user ? user.username : null;
    }

    static authFetch(url, options = {}) {
        const token = this.getToken();
        if (token && typeof url === 'string' && url.startsWith('/api/')) {
            const separator = url.includes('?') ? '&' : '?';
            url = url + separator + 'token=' + encodeURIComponent(token);
        }
        return fetch(url, options);
    }
}

class SettingsUI {
    constructor() {
        this.panelVisible = false;
        this.panelEl = null;
        this.buttonEl = null;
        this.themeBtnEl = null;
        this.loginBtnEl = null;
        this.loginModalEl = null;
    }
    
    init() {
        try {
            this.createButtons();
            this.createPanel();
            this.createLoginModal();
            this.bindEvents();
            this.updateLoginState();
            this.updateSettingsButtonState();
            AuthManager.verify().then(function(ok) {
                if (window._settingsUI) {
                    window._settingsUI.updateLoginState();
                    window._settingsUI.updateSettingsButtonState();
                }
            }).catch(function() {});
        } catch (e) {
            console.error('SettingsUI.init error:', e);
        }
    }
    
    createButtons() {
        const style = document.createElement('style');
        style.textContent = `
            #login-btn.logged-in {
                box-shadow: 0 0 8px var(--accent-glow, #06b6d4), 0 0 20px var(--accent-glow, #06b6d4), 0 4px 20px var(--monitor-shadow, rgba(6, 182, 212, 0.15));
                animation: breatheGlow 2s ease-in-out infinite;
            }
            @keyframes breatheGlow {
                0%, 100% { box-shadow: 0 0 6px var(--accent-glow, #06b6d4), 0 0 14px var(--accent-glow, #06b6d4), 0 4px 20px var(--monitor-shadow, rgba(6, 182, 212, 0.15)); }
                50% { box-shadow: 0 0 12px var(--accent-glow, #06b6d4), 0 0 30px var(--accent-glow, #06b6d4), 0 4px 20px var(--monitor-shadow, rgba(6, 182, 212, 0.15)); }
            }
            /* 系统设置 - 手机 App 风格功能按钮 */
            /* ===== 统一 Tile 样式（顶部入口 & 系统功能共用）===== */
            .sys-tile,
            .set-card {
                width: 100%;
                min-height: 58px;
                border-radius: 16px;
                border: 1px solid var(--border);
                background: rgba(140, 139, 130, 0.10);
                background: linear-gradient(135deg, color-mix(in srgb, var(--tile, var(--sc, #00f0ff)) 14%, transparent), color-mix(in srgb, var(--tile2, var(--sc2, #06b6d4)) 4%, transparent));
                color: var(--text);
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 13px;
                padding: 11px 14px;
                text-align: left;
                transition: transform 0.12s ease, background 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
                -webkit-tap-highlight-color: transparent;
            }
            .sys-tile:hover,
            .set-card:hover {
                border-color: color-mix(in srgb, var(--tile, var(--sc, #00f0ff)) 45%, var(--border));
                box-shadow: 0 6px 18px color-mix(in srgb, var(--tile, var(--sc, #00f0ff)) 22%, transparent);
            }
            .sys-tile:active,
            .set-card:active {
                transform: scale(0.97);
                background: rgba(140, 139, 130, 0.16);
                background: linear-gradient(135deg, color-mix(in srgb, var(--tile, var(--sc, #00f0ff)) 22%, transparent), color-mix(in srgb, var(--tile2, var(--sc2, #06b6d4)) 10%, transparent));
            }

            /* 统一图标容器 */
            .sys-tile-ico,
            .set-card-ico {
                width: 41px;
                height: 41px;
                border-radius: 13px;
                background: linear-gradient(135deg, var(--tile, var(--sc, #00f0ff)), var(--tile2, var(--sc2, #06b6d4)));
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                color: #fcfcfb;
                box-shadow: 0 4px 14px color-mix(in srgb, var(--tile, var(--sc, #00f0ff)) 28%, transparent);
            }

            /* 统一文字区域 */
            .sys-tile-txt,
            .set-card-body {
                flex: 1;
                min-width: 0;
                display: flex;
                flex-direction: column;
                gap: 3px;
            }
            .sys-tile-title,
            .set-card-title {
                font-size: 14px;
                font-weight: 700;
                line-height: 1.25;
                color: var(--text);
            }
            .sys-tile-sub,
            .set-card-sub {
                font-size: 11.5px;
                font-weight: 600;
                color: var(--muted);
                line-height: 1.25;
            }

            /* 统一右侧 trailing 元素（箭头 / 胶囊） */
            .sys-tile-trail,
            .set-card-arrow {
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                min-width: 28px;
                height: 26px;
                padding: 0 10px;
                border-radius: 8px;
                font-size: 11.5px;
                font-weight: 800;
                color: var(--faint);
                transition: color 0.15s, background 0.15s, opacity 0.15s, transform 0.15s;
            }
            .sys-tile:hover .sys-tile-trail,
            .set-card:hover .set-card-arrow {
                color: var(--tile, var(--sc, #00f0ff));
                background: color-mix(in srgb, var(--tile, var(--sc, #00f0ff)) 12%, transparent);
            }



            /* 退出登录强调色 */
            .sys-tile-danger {
                border-color: color-mix(in srgb, #f87171 40%, var(--border));
            }
            .sys-tile-danger:hover {
                border-color: color-mix(in srgb, #f87171 60%, var(--border));
                box-shadow: 0 6px 18px rgba(248,113,113,0.22);
            }
            #settings-panel .settings-split { display:flex; width:100%; height:100%; min-height:0; flex:1; }
            #settings-panel .settings-side { width:340px; flex:0 0 340px; display:flex; flex-direction:column; min-height:0; border-right:1px solid var(--border); background:var(--sidebar-bg); }
            #settings-panel .settings-side-scroll { flex:1; overflow:auto; padding:0 16px 20px; display:flex; flex-direction:column; gap:12px; }
            #settings-panel .set-card.is-on { border-color:var(--sc, var(--accent)); box-shadow:0 0 0 1px var(--sc, var(--accent)); }
            #settings-comfyui-btn .comfy-card-actions { display:flex; align-items:center; gap:6px; flex-shrink:0; }
            #settings-comfyui-btn #comfy-status-dot { width:7px; height:7px; border-radius:50%; background:var(--faint); flex-shrink:0; display:inline-block; }
            #settings-comfyui-btn #comfy-start-btn { height:32px; padding:0 12px; border-radius:10px; border:none; background:var(--accent); color:var(--bg); font-size:12px; font-weight:800; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:5px; }
            #settings-comfyui-btn #comfy-log-btn, #settings-comfyui-btn #comfy-models-btn { width:32px; height:32px; border-radius:10px; border:1px solid var(--border); background:transparent; color:var(--muted); cursor:pointer; display:flex; align-items:center; justify-content:center; }
            #settings-comfyui-btn #comfy-models-btn { width:40px; font-size:11px; }
            #settings-comfyui-btn #comfy-models-btn:disabled { opacity:.45; cursor:default; }
            #settings-detail { position:relative; flex:1; min-width:0; background:var(--stage-bg, #121211); }
            #settings-look-pane { position:absolute; inset:0; overflow:auto; padding:16px; background:var(--stage-bg, #121211); }
            #settings-look-pane[hidden] { display:none !important; }
            #settings-look-pane .look-pane-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:14px; }
            #settings-look-pane .look-block, #settings-look-pane .look-scale-row, #settings-look-pane .sys-tile { min-height:92px; padding:16px 18px; border:1px solid var(--border); border-radius:16px; background:color-mix(in srgb, var(--text) 5%, var(--sidebar-bg, #171716)); box-shadow:none; }
            #settings-look-pane .look-block { display:flex; flex-direction:column; justify-content:center; gap:12px; }
            #settings-look-pane .look-label { font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
            #settings-look-pane [data-look-theme] { flex:1; height:36px; border-radius:10px; border:1px solid var(--border); background:transparent; color:var(--text); font-size:13px; font-weight:800; cursor:pointer; }
            #settings-look-pane #look-accent-row, #settings-look-pane #look-palette-row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
            #settings-look-pane .look-swatch, #settings-look-pane #look-palette-custom { width:32px; height:32px; border-radius:50%; border:2px solid transparent; padding:0; cursor:pointer; background:transparent; }
            #settings-look-pane #look-palette-preview { display:flex; height:22px; border-radius:8px; overflow:hidden; border:1px solid var(--border); }
            #settings-look-pane .look-scale-row { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:14px; font-weight:800; color:var(--text); }
            #settings-look-pane #look-scale { height:36px; border-radius:10px; border:1px solid var(--border); background:var(--stage-bg); color:var(--text); font-size:13px; font-weight:700; padding:0 10px; }
            #settings-users-pane { position:absolute; inset:0; overflow:auto; padding:16px; background:var(--stage-bg, #121211); }
            #settings-users-pane[hidden] { display:none !important; }
            #settings-users-pane .users-pane-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:14px; }
            #settings-users-pane .user-card { min-height:92px; padding:16px 18px; border:1px solid var(--border); border-radius:16px; background:color-mix(in srgb, var(--text) 5%, var(--sidebar-bg, #171716)); display:flex; flex-direction:column; justify-content:center; gap:12px; }
            #settings-users-pane .user-card-main { display:flex; align-items:center; gap:12px; }
            #settings-users-pane .user-card-actions { display:flex; gap:8px; }
            #settings-users-pane .user-card-actions button, #settings-users-pane .user-reset-row button { height:32px; padding:0 12px; border-radius:10px; border:1px solid var(--border); background:transparent; color:var(--text); font-size:12px; font-weight:700; cursor:pointer; }
            #settings-users-pane .user-delete-btn { border-color:#ef4444 !important; color:#ef4444 !important; }
            #settings-users-pane .user-reset-row { display:flex; gap:8px; }
            #settings-users-pane .user-reset-row input { flex:1; height:32px; border-radius:10px; border:1px solid var(--border); background:var(--stage-bg); color:var(--text); padding:0 10px; font-size:13px; }
            #settings-comfy-models-pane { position:absolute; inset:0; overflow:auto; padding:22px 24px 28px; background:var(--stage-bg, #121211); display:flex; flex-direction:column; gap:16px; }
            #settings-comfy-models-pane[hidden] { display:none !important; }
            #settings-comfy-models-pane .comfy-models-title { font-size:22px; font-weight:800; color:var(--text); }
            #settings-comfy-models-pane .comfy-models-sub { margin-top:4px; color:var(--muted); font-size:13px; }
            #settings-comfy-models-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:14px; align-content:start; }
            #settings-modules-pane { position:absolute; inset:0; overflow:auto; padding:14px 16px 16px; background:var(--stage-bg, #121211); display:flex; flex-direction:column; gap:10px; }
            #settings-modules-pane[hidden] { display:none !important; }
            #settings-modules-pane .comfy-models-title { font-size:18px; line-height:1.2; }
            #settings-modules-pane .comfy-models-sub { margin-top:2px; font-size:12px; }
            #settings-modules-list { display:flex; flex-direction:column; gap:10px; }
            .module-group { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 310px), 1fr)); gap:8px; }
            .module-group-title { grid-column:1 / -1; font-size:11px; font-weight:800; letter-spacing:.08em; color:var(--muted); }
            .module-row { display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:36px; padding:0 8px 0 10px; border:1px solid var(--border); border-radius:10px; background:color-mix(in srgb, var(--text) 5%, var(--sidebar-bg, #171716)); color:var(--muted); font-size:13px; font-weight:700; cursor:pointer; }
            .module-row > span:first-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .module-switch { position:relative; width:44px; height:24px; flex:0 0 auto; border-radius:999px; border:1px solid #6e6e68; background:#2a2a28; }
            .module-switch::after { content:''; position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#d4d4ce; transition:transform .15s ease; }
            .module-switch input { position:absolute; inset:0; margin:0; opacity:0; cursor:pointer; }
            .module-row:has(input:checked) { color:var(--text); border-color:rgba(0, 240, 255, .55); }
            .module-switch:has(input:checked) { background:#00f0ff; border-color:#00f0ff; }
            .module-switch:has(input:checked)::after { transform:translateX(20px); background:#0b0b0a; }
            .module-switch:has(input:disabled) { cursor:default; opacity:.5; }
            .module-toggle-label { display:grid; justify-items:center; gap:4px; padding:7px 0; font-size:10px; cursor:pointer; }
            .module-toggle-pair { display:flex; gap:12px; flex-shrink:0; }
            .module-order-controls { display:grid; gap:2px; margin-left:2px; }
            .module-order-controls button { width:24px; height:22px; padding:0; border:1px solid var(--border); border-radius:5px; background:transparent; color:var(--text); font-size:13px; cursor:pointer; }
            .module-order-controls button:hover:not(:disabled) { border-color:var(--accent); color:var(--accent); }
            .module-order-controls button:disabled { opacity:.25; cursor:default; }
            .module-select-label { display:flex; align-items:center; gap:7px; min-width:0; cursor:pointer; }
            .module-select-label input,.module-bulk input,.module-group-title input { accent-color:var(--accent); margin:0; flex-shrink:0; }
            .module-select-label span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .module-group-title label { display:inline-flex; align-items:center; gap:7px; cursor:pointer; }
            .module-bulk { display:flex; flex-wrap:wrap; align-items:center; gap:10px 16px; padding:12px; border:1px solid var(--border); border-radius:10px; background:var(--sidebar-bg); font-size:12px; }
            .module-bulk label,.module-bulk-target { display:flex; align-items:center; gap:7px; }
            .module-bulk button { padding:5px 9px; border:1px solid var(--border); border-radius:6px; background:transparent; color:var(--text); cursor:pointer; font:inherit; }
            .module-bulk button:hover:not(:disabled) { border-color:var(--accent); }
            .module-bulk button:disabled { opacity:.35; cursor:default; }
            .module-groups { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-items:start; gap:16px; }
            .module-group { grid-template-columns:minmax(0,1fr); min-width:0; padding:8px; border:1px solid var(--border); border-radius:12px; }
            .module-group-title { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:4px 12px; }
            .module-group-level { font-size:11px; font-weight:500; letter-spacing:normal; }
            .module-groups .module-row > .module-name { min-width:0; }
            .module-groups .module-toggle-pair { margin-left:auto; }
            @media(max-width:700px) { .module-groups { grid-template-columns:minmax(0,1fr); } }
            .module-row { position:relative; display:grid; grid-template-columns:44px minmax(0,1fr) auto; min-height:52px; gap:6px; padding:3px 6px 3px 2px; touch-action:pan-y; transition:transform .18s ease; }
            .module-row.is-selected { border-color:var(--accent); background:color-mix(in srgb,var(--accent) 12%,var(--sidebar-bg)); }
            .module-row.is-dragging { z-index:3; opacity:.95; box-shadow:0 8px 22px #0005; border-color:var(--accent); transition:none; cursor:grabbing; }
            .module-row.drop-before { box-shadow:0 -3px 0 var(--accent); }
            .module-row.drop-after { box-shadow:0 3px 0 var(--accent); }
            .module-name { min-width:0; overflow:hidden; }
            .module-select-label { min-height:44px; gap:6px; }
            .module-select-label input,.module-bulk input,.module-group-title input { width:22px; height:22px; }
            .module-toggle-label { min-height:44px; justify-content:center; }
            .module-group-title label { min-height:48px; }
            .module-order-controls { display:flex; }
            .module-drag { width:44px; min-height:44px; border:1px solid var(--border); border-radius:8px; color:var(--text); background:transparent; touch-action:none; cursor:grab; font-size:24px; }
            .module-bulk { position:sticky; bottom:0; z-index:2; box-shadow:0 -6px 20px #0002; padding-bottom:max(12px,env(safe-area-inset-bottom)); }
            .module-bulk button,.module-bulk label { min-height:44px; }
            .module-bulk-target { flex-wrap:wrap; }
            @media(prefers-reduced-motion:reduce) { .module-row { transition:none; } }
            .module-touch-hint { color:var(--muted); font-size:12px; margin:0; }
            @media(max-width:600px) {
                .module-toggle-pair { gap:10px; margin-left:auto; }
                .module-toggle-pair { gap:6px; }
                .module-bulk { gap:6px 12px; }
            }
            #settings-detail iframe.settings-embedded { position:absolute; inset:0; width:100%; height:100%; border:0; opacity:1; visibility:visible; filter:none; transform:none; pointer-events:auto; }
            #settings-panel .settings-shell { display:flex; flex-direction:column; height:100%; min-height:0; }
            #settings-panel .settings-top { display:flex; align-items:center; justify-content:space-between; padding:18px 22px; border-bottom:1px solid var(--border); }
            #settings-panel .settings-top h2 { margin:0; font-size:16px; font-weight:800; color:var(--text); }
            #settings-panel .settings-body { display:grid; grid-template-columns:196px minmax(0,1fr); flex:1; min-height:0; }
            #settings-panel .settings-nav { display:flex; flex-direction:column; gap:4px; padding:14px 12px; border-right:1px solid var(--border); overflow:auto; }
            #settings-panel .settings-nav button { height:36px; border:0; border-radius:10px; background:transparent; color:var(--muted); text-align:left; padding:0 12px; font-size:13px; font-weight:700; cursor:pointer; }
            #settings-panel .settings-nav button.is-on { background:color-mix(in srgb, var(--accent) 18%, transparent); color:var(--text); }
            #settings-panel .settings-main { min-width:0; min-height:0; overflow:auto; padding:22px 24px 28px; display:flex; flex-direction:column; gap:14px; }
            #settings-panel .settings-pane { display:flex; flex-direction:column; gap:14px; }
            #settings-panel .settings-pane[hidden] { display:none !important; }
            #settings-panel .settings-pane-title { font-size:22px; font-weight:800; color:var(--text); }
            #settings-panel .settings-pane-sub { margin-top:4px; color:var(--muted); font-size:13px; }
            #settings-panel .settings-frame-host { position:relative; flex:1; min-height:420px; border:1px solid var(--border); border-radius:14px; overflow:hidden; background:var(--stage-bg); }
            #settings-panel .settings-frame-host[hidden] { display:none !important; }
            #settings-panel iframe.settings-embedded { position:absolute; inset:0; width:100%; height:100%; border:0; opacity:1; visibility:visible; filter:none; transform:none; pointer-events:auto; }
            #settings-panel .settings-stack { display:flex; flex-direction:column; gap:12px; max-width:560px; }
        `;
        document.head.appendChild(style);

        // 检测侧边栏设置按钮是否已存在
        const sbSettings = document.getElementById('sidebar-settings-btn');
        if (sbSettings) {
            this._useSidebar = true;
            this.buttonEl = sbSettings;
            // 主题/登录/重启已移至设置面板内的"系统设置"卡片，侧边栏不再单独展示
            this.themeBtnEl = null;
            this.loginBtnEl = null;
            this.updateThemeIcon();
            return; // 跳过浮动按钮创建
        }
        this._useSidebar = false;

        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            z-index: 1000;
            display: flex;
            gap: 10px;
            align-items: center;
        `;
        
        // 设置按钮
        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'settings-toggle-btn';
        settingsBtn.title = '设置';
        settingsBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
        `;
        settingsBtn.style.cssText = `
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: var(--monitor-bg, rgba(6, 182, 212, 0.1));
            backdrop-filter: blur(12px);
            border: 1px solid var(--monitor-border, rgba(6, 182, 212, 0.3));
            box-shadow: 0 4px 20px var(--monitor-shadow, rgba(6, 182, 212, 0.15));
            color: var(--text, #141414);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
        `;
        settingsBtn.onmouseenter = () => {
            if (!settingsBtn.classList.contains('disabled')) {
                settingsBtn.style.transform = 'scale(1.08)';
                settingsBtn.style.boxShadow = '0 6px 25px rgba(6, 182, 212, 0.25)';
            }
        };
        settingsBtn.onmouseleave = () => {
            settingsBtn.style.transform = 'scale(1)';
            settingsBtn.style.boxShadow = '0 4px 20px var(--monitor-shadow, rgba(6, 182, 212, 0.15))';
        };
        
        // 主题切换按钮
        const themeBtn = document.createElement('button');
        themeBtn.id = 'theme-toggle-btn';
        themeBtn.title = '切换夜间模式';
        themeBtn.innerHTML = `
            <svg id="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
            <svg id="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
        `;
        themeBtn.style.cssText = `
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: var(--monitor-bg, rgba(6, 182, 212, 0.1));
            backdrop-filter: blur(12px);
            border: 1px solid var(--monitor-border, rgba(6, 182, 212, 0.3));
            box-shadow: 0 4px 20px var(--monitor-shadow, rgba(6, 182, 212, 0.15));
            color: var(--text, #141414);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
        `;
        themeBtn.onmouseenter = () => {
            themeBtn.style.transform = 'scale(1.08)';
            themeBtn.style.boxShadow = '0 6px 25px rgba(6, 182, 212, 0.25)';
        };
        themeBtn.onmouseleave = () => {
            themeBtn.style.transform = 'scale(1)';
            themeBtn.style.boxShadow = '0 4px 20px var(--monitor-shadow, rgba(6, 182, 212, 0.15))';
        };
        
        // 登录按钮
        const loginBtn = document.createElement('button');
        loginBtn.id = 'login-btn';
        loginBtn.title = '登录';
        loginBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
            </svg>
        `;
        loginBtn.style.cssText = `
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: var(--monitor-bg, rgba(6, 182, 212, 0.1));
            backdrop-filter: blur(12px);
            border: 1px solid var(--monitor-border, rgba(6, 182, 212, 0.3));
            box-shadow: 0 4px 20px var(--monitor-shadow, rgba(6, 182, 212, 0.15));
            color: var(--text, #141414);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
            font-size: 12px;
            font-weight: 700;
        `;
        loginBtn.onmouseenter = () => {
            loginBtn.style.transform = 'scale(1.08)';
            loginBtn.style.boxShadow = '0 6px 25px rgba(6, 182, 212, 0.25)';
        };
        loginBtn.onmouseleave = () => {
            loginBtn.style.transform = 'scale(1)';
            loginBtn.style.boxShadow = '0 4px 20px var(--monitor-shadow, rgba(6, 182, 212, 0.15))';
        };
        
        container.appendChild(settingsBtn);
        container.appendChild(themeBtn);
        container.appendChild(loginBtn);
        
        // 重启按钮
        const restartBtn = document.createElement('button');
        restartBtn.id = 'restart-server-btn';
        restartBtn.title = '重启服务';
        restartBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
        `;
        restartBtn.style.cssText = `
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: var(--monitor-bg, rgba(6, 182, 212, 0.1));
            backdrop-filter: blur(12px);
            border: 1px solid var(--monitor-border, rgba(6, 182, 212, 0.3));
            box-shadow: 0 4px 20px var(--monitor-shadow, rgba(6, 182, 212, 0.15));
            color: var(--text, #141414);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
        `;
        restartBtn.onmouseenter = () => {
            restartBtn.style.transform = 'scale(1.08)';
            restartBtn.style.boxShadow = '0 6px 25px rgba(239, 68, 68, 0.25)';
        };
        restartBtn.onmouseleave = () => {
            restartBtn.style.transform = 'scale(1)';
            restartBtn.style.boxShadow = '0 4px 20px var(--monitor-shadow, rgba(6, 182, 212, 0.15))';
        };
        restartBtn.onclick = () => {
            restartBtn.style.opacity = '0.5';
            restartBtn.style.pointerEvents = 'none';
            fetch('/api/restart', { method: 'POST' }).catch(() => {});
            setTimeout(() => location.reload(), 2000);
        };
        container.appendChild(restartBtn);
        document.body.appendChild(container);
        
        this.buttonEl = settingsBtn;
        this.themeBtnEl = themeBtn;
        this.loginBtnEl = loginBtn;
        
    }
    
    createPanel() {
        // 全屏遮罩：点击空白处关闭面板（可穿透 iframe 捕获点击）
        const backdrop = document.createElement('div');
        backdrop.id = 'settings-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 998;
            background: rgba(15, 15, 14, 0.5);
            backdrop-filter: blur(3px);
            -webkit-backdrop-filter: blur(3px);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.22s ease;
        `;
        document.body.appendChild(backdrop);
        backdrop.addEventListener('click', () => this.hidePanel());
        this.backdropEl = backdrop;

        const panel = document.createElement('div');
        panel.id = 'settings-panel';
        panel.style.cssText = `
            position: fixed;
            inset: 16px;
            width: auto;
            height: auto;
            z-index: 999;
            background: var(--sidebar-bg);
            border: 1px solid var(--border);
            border-radius: 18px;
            box-shadow: 0 28px 90px rgba(0, 0, 0, 0.5);
            padding: 0;
            display: none;
            flex-direction: column;
            opacity: 0;
            overflow: hidden;
            transition: opacity 0.22s ease;
        `;
        panel.innerHTML = `
            <div class="settings-split">
            <aside class="settings-side">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 16px 14px;">
                <h2 style="margin:0;font-size:16px;font-weight:700;color:var(--text);">设置</h2>
                <button id="settings-close-btn" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:4px;" title="关闭">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div class="settings-side-scroll">
                <button id="settings-api-btn" class="set-card" style="--sc:#06b6d4;--sc2:#00f0ff;">
                    <span class="set-card-ico"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg></span>
                    <span class="set-card-body"><span class="set-card-title">API 设置</span><span class="set-card-sub">配置 API Key 和模型参数</span></span>
                    <span class="set-card-arrow">›</span>
                </button>
                <button id="settings-lan-btn" class="set-card" style="--sc:#84cc16;--sc2:#d9f99d;">
                    <span class="set-card-ico"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg></span>
                    <span class="set-card-body"><span class="set-card-title">局域网共享</span><span class="set-card-sub">让同一局域网的人访问本机</span></span>
                    <span class="set-card-arrow">›</span>
                </button>
                <div id="settings-comfyui-btn" class="set-card" style="--sc:#8b5cf6;--sc2:#c084fc;">
                    <span class="set-card-ico"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line></svg></span>
                    <span class="set-card-body"><span class="set-card-title">ComfyUI</span><span class="set-card-sub" style="display:flex;align-items:center;gap:6px;"><span id="comfy-status-dot"></span><span id="comfy-status-text">检查中...</span></span></span>
                    <span class="comfy-card-actions">
                        <button id="comfy-start-btn" type="button" title="启动 ComfyUI">
                            <svg data-role="icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            <span data-role="label">启动</span>
                        </button>
                        <button id="comfy-models-btn" type="button" title="选择在菜单中显示的 ComfyUI 模型">模型</button>
                        <button id="comfy-log-btn" type="button" title="查看日志">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        </button>
                    </span>
                </div>
                <div id="comfy-log-panel" style="display:none;width:100%;flex-direction:column;gap:6px;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span id="comfy-log-path" style="font-size:11px;color:var(--muted);flex:1;font-family:ui-monospace,monospace;">logs/comfyui-…log</span>
                        <button id="comfy-log-refresh" title="刷新" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;">↻</button>
                        <button id="comfy-log-clear" title="清空" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;">清</button>
                        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--muted);"><input type="checkbox" id="comfy-log-auto" checked>自动</label>
                    </div>
                    <pre id="comfy-log-content" style="margin:0;padding:10px;background:#141414;color:#e1dfd6;border-radius:8px;font-size:10.5px;max-height:160px;overflow:auto;white-space:pre-wrap;">(加载中...)</pre>
                </div>
                <button id="settings-users-btn" class="set-card" style="--sc:#f59e0b;--sc2:#fbbf24;display:none;">
                    <span class="set-card-ico"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></span>
                    <span class="set-card-body"><span class="set-card-title">用户管理</span><span class="set-card-sub">管理用户和重置密码</span></span>
                    <span class="set-card-arrow">›</span>
                </button>
                <button id="settings-look-btn" class="set-card" type="button" style="--sc:#a78bfa;--sc2:#cbc9c0;">
                    <span class="set-card-ico"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg></span>
                    <span class="set-card-body"><span class="set-card-title">界面外观</span><span class="set-card-sub">主题、底色、透明和缩放</span></span>
                    <span class="set-card-arrow">›</span>
                </button>
                <button id="settings-modules-btn" class="set-card" type="button" style="--sc:#38bdf8;--sc2:#00f0ff;display:none;">
                    <span class="set-card-ico"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect></svg></span>
                    <span class="set-card-body"><span class="set-card-title">功能模块</span><span class="set-card-sub">开启或关闭左侧功能入口</span></span>
                    <span class="set-card-arrow">›</span>
                </button>
                <button id="sys-restart-btn" class="set-card" type="button" style="--sc:#fb923c;--sc2:#f97316;"><span class="set-card-ico"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#141414" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg></span><span class="set-card-body"><span class="set-card-title">重启服务</span><span class="set-card-sub">立即重启生效</span></span><span class="set-card-arrow">›</span></button>
            </div>
            </aside>
            <div id="settings-detail">
                <div id="settings-comfy-models-pane" hidden>
                    <div>
                        <div class="comfy-models-title">ComfyUI 模型</div>
                        <div class="comfy-models-sub">开关在卡片右侧。关闭后模型仍留在这里，生成菜单里不再出现。</div>
                    </div>
                    <div id="settings-comfy-models-grid"></div>
                </div>
                <div id="settings-modules-pane" hidden>
                    <div>
                        <div class="comfy-models-title">功能模块</div>
                        <div class="comfy-models-sub">勾选功能或整组后可批量开关；用 ↑ ↓ 调整组内顺序。本机设置保存在当前浏览器，访客权限由主机统一设置。固定开启项和仅限本机项不会被批量操作改变。</div>
                    </div>
                    <div id="settings-modules-list"></div>
                </div>
                <div id="settings-look-pane" hidden>
                    <div class="look-pane-grid">
                        <div class="look-block">
                            <div class="look-label">主题</div>
                            <div style="display:flex;gap:8px;" id="look-theme-row">
                                <button type="button" data-look-theme="light">浅色</button>
                                <button type="button" data-look-theme="dark">深色</button>
                            </div>
                        </div>
                        <button id="look-scan-btn" class="sys-tile" type="button" style="--tile:#00f0ff;--tile2:#06b6d4;"><span class="sys-tile-txt"><span class="sys-tile-title">背景扫描线</span><span id="look-scan-status" class="sys-tile-sub">关闭</span></span><span class="sys-tile-trail" id="look-scan-trail">关</span></button>
                        <button id="sys-lock-btn" class="sys-tile" type="button" style="--tile:#00f0ff;--tile2:#06b6d4;"><span class="sys-tile-ico"><svg id="sys-icon-lock-open" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg><svg id="sys-icon-lock-closed" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg></span><span class="sys-tile-txt"><span class="sys-tile-title">锁定侧边栏</span><span id="sys-lock-status" class="sys-tile-sub">关闭</span></span><span class="sys-tile-trail" id="sys-lock-trail">关</span></button>
                        <div class="look-block" style="grid-column:1 / -1;">
                            <div class="look-label">界面底色</div>
                            <div id="look-palette-row">
                                <button type="button" class="look-swatch" data-look-palette="ink" title="墨灰" style="background:linear-gradient(135deg,#14161c 0 34%,#1c202a 34% 67%,#252b38 67% 100%);"></button>
                                <button type="button" class="look-swatch" data-look-palette="night" title="夜蓝" style="background:linear-gradient(135deg,#0e1626 0 34%,#162238 34% 67%,#1e2d48 67% 100%);"></button>
                                <button type="button" class="look-swatch" data-look-palette="pine" title="松绿" style="background:linear-gradient(135deg,#101916 0 34%,#17241f 34% 67%,#20302a 67% 100%);"></button>
                                <button type="button" class="look-swatch" data-look-palette="dusk" title="暮紫" style="background:linear-gradient(135deg,#16141f 0 34%,#211c2e 34% 67%,#2c243d 67% 100%);"></button>
                                <button type="button" class="look-swatch" data-look-palette="sand" title="暖棕" style="background:linear-gradient(135deg,#1a1612 0 34%,#262018 34% 67%,#32281e 67% 100%);"></button>
                                <input id="look-palette-custom" type="color" title="自定义颜色" value="#1a2744">
                            </div>
                            <div id="look-palette-preview" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
                        </div>
                        <label class="look-scale-row" style="grid-column:1 / -1;"><span>面板透明</span><span style="display:flex;align-items:center;gap:10px;"><input id="look-panel-alpha" type="range" min="0" max="40" step="1" value="20" style="width:148px;accent-color:var(--accent);"><span id="look-panel-alpha-val">20%</span></span></label>
                        <div class="look-block">
                            <div class="look-label">强调色</div>
                            <div id="look-accent-row"><button type="button" data-look-accent="" title="默认" style="width:32px;height:32px;border-radius:50%;border:2px solid var(--border);background:conic-gradient(#0891b2,#7c3aed,#d97706,#059669,#e11d48,#0891b2);cursor:pointer;"></button><button type="button" data-look-accent="cyan" title="青" style="width:32px;height:32px;border-radius:50%;border:2px solid transparent;background:#06b6d4;cursor:pointer;"></button><button type="button" data-look-accent="violet" title="紫" style="width:32px;height:32px;border-radius:50%;border:2px solid transparent;background:#a78bfa;cursor:pointer;"></button><button type="button" data-look-accent="amber" title="琥珀" style="width:32px;height:32px;border-radius:50%;border:2px solid transparent;background:#fbbf24;cursor:pointer;"></button><button type="button" data-look-accent="emerald" title="绿" style="width:32px;height:32px;border-radius:50%;border:2px solid transparent;background:#34d399;cursor:pointer;"></button><button type="button" data-look-accent="rose" title="玫红" style="width:32px;height:32px;border-radius:50%;border:2px solid transparent;background:#fb7185;cursor:pointer;"></button></div>
                        </div>
                        <label class="look-scale-row"><span>界面缩放</span><select id="look-scale"></select></label>
                    </div>
                </div>
                <div id="settings-users-pane" hidden>
                    <div class="users-pane-grid" id="settings-users-grid"></div>
                </div>
            </div>
            </div>
        `;
        document.body.appendChild(panel);
        this.panelEl = panel;
    }
    
    createLoginModal() {
        const modal = document.createElement('div');
        modal.id = 'login-modal';
        modal.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 2000;
            display: none;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(4px);
        `;
        
        modal.innerHTML = `
            <div id="login-modal-box" style="
                width: 320px;
                background: var(--sidebar-bg, #ebe9e4);
                border: 1px solid var(--border, #d4d2c9);
                border-radius: 20px;
                padding: 28px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
            ">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
                    <h2 style="margin:0;font-size:16px;font-weight:700;color:var(--text);">账号</h2>
                    <button id="login-modal-close" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:4px;" title="关闭">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <form id="login-form" style="margin:0;" onsubmit="return false;">
                <div style="margin-bottom:16px;">
                    <label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;">用户名</label>
                    <input id="login-username" type="text" placeholder="输入用户名" autocomplete="username" style="
                        width:100%;height:42px;padding:0 14px;border-radius:10px;
                        border:1px solid var(--border);background:var(--stage-bg);
                        color:var(--text);font-size:14px;outline:none;box-sizing:border-box;
                    ">
                </div>
                <div style="margin-bottom:20px;">
                    <label style="display:block;font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;">密码</label>
                    <input id="login-password" type="password" placeholder="输入密码" autocomplete="current-password" style="
                        width:100%;height:42px;padding:0 14px;border-radius:10px;
                        border:1px solid var(--border);background:var(--stage-bg);
                        color:var(--text);font-size:14px;outline:none;box-sizing:border-box;
                    ">
                </div>
                </form>
                <div id="login-error" style="color:#ef4444;font-size:12px;margin-bottom:12px;display:none;"></div>
                <div style="display:flex;gap:10px;">
                    <button id="login-submit-btn" style="
                        flex:1;height:42px;border-radius:10px;border:none;
                        background:linear-gradient(135deg,#06b6d4,#00f0ff);
                        color:#141414;font-size:13px;font-weight:700;cursor:pointer;
                        transition:all 0.2s;
                    ">登录</button>
                    <button id="login-register-btn" style="
                        flex:1;height:42px;border-radius:10px;
                        border:1px solid var(--border);background:transparent;
                        color:var(--text);font-size:13px;font-weight:700;cursor:pointer;
                        transition:all 0.2s;
                    ">注册</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        this.loginModalEl = modal;
    }
    
    bindEvents() {
        this.bindAccountMenu();
        this.buttonEl.onclick = (e) => {
            e.stopPropagation();
            if (this.buttonEl.classList.contains('disabled')) return;
            this.togglePanel();
        };

        if (this.themeBtnEl) {
            this.themeBtnEl.onclick = () => {
                if (typeof toggleTheme === 'function') {
                    toggleTheme();
                    this.updateThemeIcon();
                }
            };
        }

        if (this.loginBtnEl) {
            this.loginBtnEl.onclick = (e) => {
                e.stopPropagation();
                if (AuthManager.isLoggedIn()) {
                    this.confirmLogout();
                } else {
                    this.showLoginModal();
                }
            };
        }
        
        document.getElementById('settings-close-btn').onclick = () => this.hidePanel();
        const apiBtn = document.getElementById('settings-api-btn');
        const lanBtn = document.getElementById('settings-lan-btn');
        const comfyBtn = document.getElementById('settings-comfyui-btn');
        if (apiBtn) apiBtn.onclick = (e) => { e.stopPropagation(); this.showSection('api'); };
        if (lanBtn) lanBtn.onclick = (e) => { e.stopPropagation(); this.showSection('lan'); };
        if (comfyBtn) comfyBtn.onclick = (e) => { e.stopPropagation(); this.showSection('comfy'); };
        const lookBtn = document.getElementById('settings-look-btn');
        if (lookBtn) lookBtn.onclick = (e) => { e.stopPropagation(); this.showSection('look'); };
        const modulesBtn = document.getElementById('settings-modules-btn');
        if (modulesBtn) modulesBtn.onclick = (e) => { e.stopPropagation(); this.showSection('modules'); };
        
        const usersBtn = document.getElementById('settings-users-btn');
        if (usersBtn) usersBtn.onclick = (e) => { e.stopPropagation(); this.showSection('users'); };
        
        document.addEventListener('click', (e) => {
            if (this.panelVisible && 
                !this.panelEl.contains(e.target) && 
                e.target !== this.buttonEl) {
                this.hidePanel();
            }
        });
        
        document.getElementById('login-modal-close').onclick = () => this.hideLoginModal();
        
        this.loginModalEl.addEventListener('click', (e) => {
            if (e.target === this.loginModalEl) {
                this.hideLoginModal();
            }
        });
        
        document.getElementById('login-submit-btn').onclick = () => this.handleLogin();
        
        document.getElementById('login-register-btn').onclick = () => this.handleRegister();
        
        const usernameInput = document.getElementById('login-username');
        const passwordInput = document.getElementById('login-password');
        [usernameInput, passwordInput].forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.handleLogin();
            });
        });

        // ---- 系统设置卡片事件绑定 ----
        const sysLockBtn = document.getElementById('sys-lock-btn');
        const sysRestartBtn = document.getElementById('sys-restart-btn');

        if (sysLockBtn) {
            sysLockBtn.onclick = () => {
                if (typeof toggleSidebarLock === 'function') toggleSidebarLock();
                this.updateSysSettingsState();
            };
        }
        this.bindLookSettings();
        this.renderModules();
        if (sysRestartBtn) {
            sysRestartBtn.onclick = () => {
                fetch('/api/restart', { method: 'POST' }).catch(() => {});
                setTimeout(() => location.reload(), 2000);
            };
        }
    }
    
    async renderModules() {
        const host = document.getElementById('settings-modules-list');
        const mods = window.FeatureModules;
        if (!host || !mods) return;
        await mods.ready;
        const access = mods.access;
        const canManageGuests = access && !access.visitor;
        const selected = this.moduleSelection ||= new Set();
        const groups = mods.orderedGroups();
        const allItems = groups.flatMap(group => group.items);
        const busy = !!this.moduleSaving;
        const bulk = '<div class="module-bulk"><label><input type="checkbox" data-module-select-all>全选</label><span data-module-selected-count></span><button type="button" data-module-clear>清空选择</button><span class="module-bulk-target">本机显示<button type="button" data-module-bulk="local-on">开启</button><button type="button" data-module-bulk="local-off">关闭</button></span>' + (canManageGuests ? '<span class="module-bulk-target">访客可用<button type="button" data-module-bulk="guest-on">开启</button><button type="button" data-module-bulk="guest-off">关闭</button></span>' : '') + '</div>';
        host.innerHTML = '<p class="module-touch-hint">点选整行可多选；按住左侧手柄拖动排序。手柄聚焦后可用方向键或 Home / End 排序。</p><div class="module-groups">' + groups.map((group, groupIndex) => {
            const rows = group.items.map((item, index) => {
                const on = mods.isOn(item.id);
                const guestOn = access && !access.guest_disabled.includes(item.id);
                return '<div class="module-row" data-module-row="' + item.id + '"><span class="module-order-controls"><button type="button" class="module-drag" data-module-drag="' + item.id + '" aria-label="拖动排序' + item.name + '"' + (busy ? ' disabled' : '') + '>⠿</button></span><span class="module-name"><label class="module-select-label"><input type="checkbox" data-module-select="' + item.id + '" aria-label="选择' + item.name + '"><span>' + item.name + '</span></label></span><span class="module-toggle-pair"><label class="module-toggle-label">本机显示<span class="module-switch"><input aria-label="' + item.name + '本机显示" type="checkbox" data-module-toggle="' + item.id + '"' + (on ? ' checked' : '') + (item.locked || busy ? ' disabled' : '') + '></span></label>' + (canManageGuests ? '<label class="module-toggle-label">访客可用<span class="module-switch"><input aria-label="' + item.name + '访客可用" type="checkbox" data-guest-module-toggle="' + item.id + '"' + (guestOn ? ' checked' : '') + (item.id === 'training' || busy ? ' disabled' : '') + '></span></label>' : '') + '</span></div>';
            }).join('');
            return '<div class="module-group"><div class="module-group-title"><label><input type="checkbox" data-module-select-group="' + groupIndex + '">' + group.title + '</label><span class="module-group-level">' + (groupIndex === 0 ? '一级 · 主导航' : '二级 · ComfyUI 子功能') + '</span></div>' + rows + '</div>';
        }).join('') + '</div>' + bulk;
        const syncSelection = () => {
            host.querySelectorAll('[data-module-select]').forEach(input => { input.checked = selected.has(input.dataset.moduleSelect); input.closest('.module-row').classList.toggle('is-selected', input.checked); });
            const syncCheck = (input, items) => {
                const count = items.filter(item => selected.has(item.id)).length;
                input.checked = count === items.length;
                input.indeterminate = count > 0 && count < items.length;
                input.disabled = busy;
            };
            syncCheck(host.querySelector('[data-module-select-all]'), allItems);
            host.querySelectorAll('[data-module-select-group]').forEach(input => syncCheck(input, groups[Number(input.dataset.moduleSelectGroup)].items));
            host.querySelector('[data-module-selected-count]').textContent = busy ? '正在保存…' : '已选 ' + selected.size + ' 项';
            host.querySelectorAll('[data-module-bulk]').forEach(button => {
                const guest = button.dataset.moduleBulk.startsWith('guest');
                button.disabled = busy || !allItems.some(item => selected.has(item.id) && (guest ? item.id !== 'training' : !item.locked));
            });
            host.querySelector('[data-module-clear]').disabled = busy || !selected.size;
            host.querySelectorAll('[data-module-select]').forEach(input => { input.disabled = busy; });
        };
        host.querySelectorAll('[data-module-select]').forEach(input => {
            input.onchange = () => { input.checked ? selected.add(input.dataset.moduleSelect) : selected.delete(input.dataset.moduleSelect); syncSelection(); };
        });
        const selectItems = (items, on) => { items.forEach(item => on ? selected.add(item.id) : selected.delete(item.id)); syncSelection(); };
        host.querySelector('[data-module-select-all]').onchange = event => selectItems(allItems, event.target.checked);
        host.querySelectorAll('[data-module-select-group]').forEach(input => { input.onchange = () => selectItems(groups[Number(input.dataset.moduleSelectGroup)].items, input.checked); });
        host.querySelector('[data-module-clear]').onclick = () => { selected.clear(); syncSelection(); };
        host.querySelectorAll('[data-module-bulk]').forEach(button => {
            button.onclick = () => this.applyModuleBatch(button.dataset.moduleBulk);
        });
        syncSelection();
        host.querySelectorAll('[data-module-row]').forEach(row => {
            row.onclick = event => {
                if (busy || event.target.closest('label,button,input')) return;
                const input = row.querySelector('[data-module-select]');
                input.checked = !input.checked;
                input.onchange();
            };
        });
        host.querySelectorAll('[data-module-drag]').forEach(handle => {
            const id = handle.dataset.moduleDrag;
            handle.onkeydown = event => {
                if (busy) return;
                const group = groups.find(g => g.items.some(item => item.id === id));
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') mods.move(id, event.key === 'ArrowUp' ? -1 : 1);
                else if (event.key === 'Home' || event.key === 'End') mods.moveTo(id, group.items[event.key === 'Home' ? 0 : group.items.length - 1].id, event.key === 'End');
                else return;
                event.preventDefault();
                this.renderModules().then(() => host.querySelector('[data-module-drag="' + id + '"]')?.focus());
            };
            handle.onpointerdown = event => {
                if (busy || !event.isPrimary || event.button !== 0) return;
                event.preventDefault();
                const row = handle.closest('.module-row');
                const peers = [...row.parentElement.querySelectorAll('[data-module-row]')].filter(peer => peer !== row);
                const scroller = host.closest('.settings-main');
                const ordered = [row, ...peers].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
                const boxes = new Map(ordered.map(peer => [peer, peer.getBoundingClientRect()]));
                const origin = boxes.get(row), startIndex = ordered.indexOf(row);
                const initialScroll = scroller ? scroller.scrollTop : 0;
                const step = ordered.length > 1 ? boxes.get(ordered[1]).top - boxes.get(ordered[0]).top : origin.height;
                let target = null, after = false, y = event.clientY, frame;
                handle.setPointerCapture(event.pointerId);
                row.classList.add('is-dragging');
                const update = () => {
                    const scrollDelta = (scroller ? scroller.scrollTop : 0) - initialScroll;
                    const pointerY = y + scrollDelta;
                    target = peers.reduce((best, peer) => {
                        const box = boxes.get(peer);
                        return !best || Math.abs(pointerY - (box.top + box.height / 2)) < Math.abs(pointerY - (boxes.get(best).top + boxes.get(best).height / 2)) ? peer : best;
                    }, null);
                    if (!target) return;
                    const box = boxes.get(target);
                    after = pointerY > box.top + box.height / 2;
                    const remaining = ordered.filter(peer => peer !== row);
                    const insertIndex = remaining.indexOf(target) + (after ? 1 : 0);
                    peers.forEach(peer => {
                        const oldIndex = ordered.indexOf(peer);
                        const shift = insertIndex > startIndex && oldIndex > startIndex && oldIndex <= insertIndex ? -step
                            : insertIndex < startIndex && oldIndex >= insertIndex && oldIndex < startIndex ? step : 0;
                        peer.style.transform = 'translateY(' + shift + 'px)';
                    });
                    const min = boxes.get(ordered[0]).top - origin.top;
                    const max = boxes.get(ordered[ordered.length - 1]).top - origin.top;
                    row.style.transform = 'translateY(' + Math.max(min, Math.min(max, y - event.clientY + scrollDelta)) + 'px)';
                };
                const scroll = () => {
                    if (scroller) {
                        const box = scroller.getBoundingClientRect();
                        const delta = y < box.top + 64 ? -10 : y > box.bottom - 96 ? 10 : 0;
                        if (delta) { scroller.scrollTop += delta; update(); }
                    }
                    frame = requestAnimationFrame(scroll);
                };
                handle.onpointermove = move => { if (move.pointerId === event.pointerId) { y = move.clientY; update(); } };
                const finish = end => {
                    if (end.pointerId !== event.pointerId) return;
                    cancelAnimationFrame(frame);
                    handle.onpointermove = handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = null;
                    row.classList.remove('is-dragging');
                    ordered.forEach(peer => { peer.style.transform = ''; });
                    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
                    if (end.type === 'pointerup' && target) {
                        mods.moveTo(id, target.dataset.moduleRow, after);
                        this.renderModules();
                    }
                };
                handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = finish;
                frame = requestAnimationFrame(scroll);
            };
        });
        host.querySelectorAll('[data-module-toggle]').forEach(input => {
            input.onchange = () => {
                if (!window.FeatureModules) return;
                window.FeatureModules.set(input.getAttribute('data-module-toggle'), input.checked);
            };
        });
        host.querySelectorAll('[data-guest-module-toggle]').forEach(input => {
            input.onchange = async () => {
                const disabled = [...host.querySelectorAll('[data-guest-module-toggle]')].filter(item => !item.checked).map(item => item.getAttribute('data-guest-module-toggle'));
                await this.saveGuestModules(disabled);
            };
        });
    }

    async applyModuleBatch(action) {
        if (this.moduleSaving || !this.moduleSelection?.size) return;
        const mods = window.FeatureModules;
        const ids = [...this.moduleSelection];
        if (action === 'local-on' || action === 'local-off') {
            mods.setMany(ids, action === 'local-on');
            await this.renderModules();
        } else if ((action === 'guest-on' || action === 'guest-off') && mods.access && !mods.access.visitor) {
            const disabled = new Set(mods.access.guest_disabled);
            ids.forEach(id => { if (id !== 'training') action === 'guest-on' ? disabled.delete(id) : disabled.add(id); });
            await this.saveGuestModules([...disabled]);
        }
    }

    async saveGuestModules(disabled) {
        if (this.moduleSaving) return;
        this.moduleSaving = true;
        try {
            await this.renderModules();
            const response = await fetch('/api/feature-access', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({guest_disabled:disabled}) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || '访客权限保存失败');
            window.FeatureModules.access = data;
        } catch (error) {
            alert(error.message);
        } finally {
            this.moduleSaving = false;
            await this.renderModules();
        }
    }

    bindLookSettings() {
        const paint = () => {
            const dark = document.body.classList.contains('theme-dark') ||
                document.documentElement.classList.contains('studio-theme-dark');
            document.querySelectorAll('[data-look-theme]').forEach(btn => {
                const on = btn.dataset.lookTheme === (dark ? 'dark' : 'light');
                btn.style.background = on ? 'var(--accent)' : 'transparent';
                btn.style.color = on ? '#141414' : 'var(--text)';
                btn.style.borderColor = on ? 'var(--accent)' : 'var(--border)';
            });
            const scan = window.StudioLook ? window.StudioLook.scanlines() : false;
            const scanStatus = document.getElementById('look-scan-status');
            const scanTrail = document.getElementById('look-scan-trail');
            if (scanStatus) scanStatus.textContent = scan ? '开启，深色界面会叠一层细横线' : '关闭';
            if (scanTrail) scanTrail.textContent = scan ? '开' : '关';
            const accent = window.StudioLook ? window.StudioLook.accent() : '';
            document.querySelectorAll('[data-look-accent]').forEach(btn => {
                const on = btn.dataset.lookAccent === accent;
                btn.style.outline = on ? '2px solid var(--text)' : 'none';
                btn.style.outlineOffset = '2px';
            });
            const palette = window.StudioLook && window.StudioLook.palette ? window.StudioLook.palette() : 'ink';
            document.querySelectorAll('[data-look-palette]').forEach(btn => {
                const on = btn.dataset.lookPalette === palette;
                btn.style.outline = on ? '2px solid var(--text)' : 'none';
                btn.style.outlineOffset = '2px';
            });
            const custom = document.getElementById('look-palette-custom');
            if (custom && window.StudioLook && window.StudioLook.paletteColor && document.activeElement !== custom) {
                custom.value = window.StudioLook.paletteColor();
            }
            const preview = document.getElementById('look-palette-preview');
            if (preview) {
                const root = getComputedStyle(document.documentElement);
                ['--ui-bg', '--ui-panel', '--ui-soft', '--ui-line'].forEach((name, i) => {
                    const chip = preview.children[i];
                    if (chip) chip.style.flex = '1';
                    if (chip) chip.style.background = root.getPropertyValue(name).trim() || 'transparent';
                });
            }
            const alpha = document.getElementById('look-panel-alpha');
            const alphaVal = document.getElementById('look-panel-alpha-val');
            if (alpha && window.StudioLook && window.StudioLook.panelAlpha && document.activeElement !== alpha) {
                const current = window.StudioLook.panelAlpha();
                alpha.value = String(current);
                if (alphaVal) alphaVal.textContent = current + '%';
            }
            const scale = document.getElementById('look-scale');
            if (scale && window.StudioScale && !scale.dataset.ready) {
                const opts = window.StudioScale.options.slice();
                scale.innerHTML = opts.map(v => `<option value="${v}">${v === 'auto' ? '自动' : v + '%'}</option>`).join('');
                scale.dataset.ready = '1';
                scale.value = window.StudioScale.getMode();
                scale.onchange = () => window.StudioScale.set(scale.value);
            } else if (scale && window.StudioScale && document.activeElement !== scale) {
                scale.value = window.StudioScale.getMode();
            }
        };
        document.querySelectorAll('[data-look-theme]').forEach(btn => {
            btn.onclick = () => {
                if (typeof broadcastTheme === 'function') broadcastTheme(btn.dataset.lookTheme);
                else if (window.StudioTheme) window.StudioTheme.set(btn.dataset.lookTheme);
                this.updateThemeIcon();
                paint();
            };
        });
        const scanBtn = document.getElementById('look-scan-btn');
        if (scanBtn) {
            scanBtn.onclick = () => {
                if (window.StudioLook) window.StudioLook.setScanlines(!window.StudioLook.scanlines());
                paint();
            };
        }
        document.querySelectorAll('[data-look-accent]').forEach(btn => {
            btn.onclick = () => {
                if (window.StudioLook) window.StudioLook.setAccent(btn.dataset.lookAccent);
                paint();
            };
        });
        document.querySelectorAll('[data-look-palette]').forEach(btn => {
            btn.onclick = () => {
                if (window.StudioLook && window.StudioLook.setPalette) window.StudioLook.setPalette(btn.dataset.lookPalette);
                paint();
            };
        });
        const panelAlpha = document.getElementById('look-panel-alpha');
        if (panelAlpha) {
            panelAlpha.oninput = () => {
                const next = Number(panelAlpha.value);
                const label = document.getElementById('look-panel-alpha-val');
                if (label) label.textContent = next + '%';
                if (window.StudioLook && window.StudioLook.setPanelAlpha) window.StudioLook.setPanelAlpha(next);
            };
        }
        const paletteCustom = document.getElementById('look-palette-custom');
        if (paletteCustom) {
            paletteCustom.oninput = () => {
                if (window.StudioLook && window.StudioLook.setPaletteColor) window.StudioLook.setPaletteColor(paletteCustom.value);
                paint();
            };
        }
        window.addEventListener('studio-theme-change', paint);
        window.addEventListener('studio-look-change', paint);
        paint();
    }

    togglePanel() {
        if (this.panelVisible) {
            this.hidePanel();
        } else {
            this.showPanel();
        }
    }
    
    updateThemeIcon() {
        const isDark = document.body.classList.contains('theme-dark') ||
                       document.documentElement.classList.contains('studio-theme-dark');
        // 更新浮动按钮图标
        const moonIcon = document.getElementById('icon-moon');
        const sunIcon = document.getElementById('icon-sun');
        if (moonIcon && sunIcon) {
            moonIcon.style.display = isDark ? 'none' : 'block';
            sunIcon.style.display = isDark ? 'block' : 'none';
        }
        // 同步侧边栏图标
        const sbMoon = document.getElementById('sidebar-icon-moon');
        const sbSun = document.getElementById('sidebar-icon-sun');
        if (sbMoon && sbSun) {
            sbMoon.style.display = isDark ? 'none' : 'block';
            sbSun.style.display = isDark ? 'block' : 'none';
        }
        // 同步系统设置卡片图标
        this.updateSysThemeStatus();
    }

    updateSysThemeStatus() {
        const isDark = document.body.classList.contains('theme-dark') ||
                       document.documentElement.classList.contains('studio-theme-dark');
        const sysMoon = document.getElementById('sys-icon-moon');
        const sysSun = document.getElementById('sys-icon-sun');
        const sysStatus = document.getElementById('sys-theme-status');
        const sysTrail = document.getElementById('sys-theme-trail');
        if (sysMoon) sysMoon.style.display = isDark ? 'none' : 'block';
        if (sysSun) sysSun.style.display = isDark ? 'block' : 'none';
        if (sysStatus) sysStatus.textContent = isDark ? '深色' : '浅色';
        if (sysTrail) sysTrail.textContent = isDark ? '深色' : '浅色';
    }
    
    showPanel() {
        this.backdropEl.style.opacity = '1';
        this.backdropEl.style.pointerEvents = 'auto';
        this.panelEl.style.display = 'flex';
        this.panelEl.style.opacity = '1';
        this.panelVisible = true;
        this.updateSysSettingsState();
        const preferred = AuthManager.isAdmin() ? (this.currentSection || 'api') : 'look';
        this.showSection(preferred === 'translate' ? 'api' : preferred);
    }

    hidePanel() {
        this.backdropEl.style.opacity = '0';
        this.backdropEl.style.pointerEvents = 'none';
        this.panelEl.style.opacity = '0';
        setTimeout(() => { if (!this.panelVisible) this.panelEl.style.display = 'none'; }, 220);
        this.panelVisible = false;
    }

    showSection(name) {
        const adminOnly = name === 'api' || name === 'lan' || name === 'comfy' || name === 'modules' || name === 'users' || name === 'comfy-models' || name === 'translate';
        if (adminOnly && !AuthManager.isAdmin()) name = 'look';
        this.currentSection = name;
        ['settings-api-btn', 'settings-lan-btn', 'settings-comfyui-btn', 'settings-look-btn', 'settings-modules-btn', 'settings-users-btn'].forEach(id => {
            const btn = document.getElementById(id);
            if (!btn) return;
            const on = (name === 'api' && id === 'settings-api-btn')
                || (name === 'lan' && id === 'settings-lan-btn')
                || (name === 'comfy' && id === 'settings-comfyui-btn')
                || (name === 'look' && id === 'settings-look-btn')
                || (name === 'modules' && id === 'settings-modules-btn')
                || (name === 'users' && id === 'settings-users-btn');
            btn.classList.toggle('is-on', on);
        });
        const lookPane = document.getElementById('settings-look-pane');
        const modulesPane = document.getElementById('settings-modules-pane');
        const usersPane = document.getElementById('settings-users-pane');
        const modelsPane = document.getElementById('settings-comfy-models-pane');
        if (modelsPane) modelsPane.hidden = true;
        const hideEmbedded = () => {
            const host = document.getElementById('settings-detail');
            if (host) host.querySelectorAll('iframe').forEach(frame => frame.classList.remove('settings-embedded'));
        };
        if (name === 'look') {
            hideEmbedded();
            if (usersPane) usersPane.hidden = true;
            if (modulesPane) modulesPane.hidden = true;
            if (lookPane) lookPane.hidden = false;
            return;
        }
        if (name === 'modules') {
            hideEmbedded();
            if (usersPane) usersPane.hidden = true;
            if (lookPane) lookPane.hidden = true;
            if (modulesPane) modulesPane.hidden = false;
            this.renderModules();
            return;
        }
        if (name === 'users') {
            hideEmbedded();
            if (lookPane) lookPane.hidden = true;
            if (modulesPane) modulesPane.hidden = true;
            if (usersPane) usersPane.hidden = false;
            this.showUserList();
            return;
        }
        if (lookPane) lookPane.hidden = true;
        if (modulesPane) modulesPane.hidden = true;
        if (usersPane) usersPane.hidden = true;
        if (name === 'api' || name === 'lan') this.mountSettingsFrame('api-settings', name);
        if (name === 'comfy') this.mountSettingsFrame('comfyui-settings');
    }

    async showComfyModels() {
        if (!AuthManager.isAdmin()) {
            this.showSection('look');
            return;
        }
        this._modelsReturn = this.currentSection && this.currentSection !== 'comfy-models' ? this.currentSection : (this._modelsReturn || 'api');
        this.currentSection = 'comfy-models';
        ['settings-api-btn', 'settings-lan-btn', 'settings-comfyui-btn', 'settings-look-btn', 'settings-modules-btn', 'settings-users-btn'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.classList.toggle('is-on', id === 'settings-comfyui-btn');
        });
        const lookPane = document.getElementById('settings-look-pane');
        const modulesPane = document.getElementById('settings-modules-pane');
        const usersPane = document.getElementById('settings-users-pane');
        const modelsPane = document.getElementById('settings-comfy-models-pane');
        const host = document.getElementById('settings-detail');
        if (lookPane) lookPane.hidden = true;
        if (modulesPane) modulesPane.hidden = true;
        if (usersPane) usersPane.hidden = true;
        if (host) host.querySelectorAll('iframe').forEach(frame => frame.classList.remove('settings-embedded'));
        if (modelsPane) modelsPane.hidden = false;
        const grid = document.getElementById('settings-comfy-models-grid');
        if (grid && window.ModelVisibility) await ModelVisibility.mount(grid);
    }

    mountSettingsFrame(id, section) {
        const target = document.getElementById('frame-' + id);
        const host = document.getElementById('settings-detail');
        if (!target || !host) return;
        if (id === 'api-settings') this._apiSection = section;
        const firstPlace = target.parentElement !== host;
        host.querySelectorAll('iframe').forEach(frame => {
            if (frame !== target) frame.classList.remove('settings-embedded');
        });
        if (firstPlace) host.appendChild(target);
        target.classList.add('settings-embedded');
        target.classList.remove('active');
        const base = target.dataset.src || '';
        const needsLoad = !target.getAttribute('src') || target.src.includes('embed=1');
        if (needsLoad) {
            target.addEventListener('load', () => {
                if (id === 'api-settings') this.applyFrameSection(target, this._apiSection);
            }, { once: true });
            target.src = base;
        } else if (id === 'api-settings') {
            this.applyFrameSection(target, section);
        }
        if (typeof syncThemeToFrame === 'function') syncThemeToFrame(target);
    }

    applyFrameSection(target, section) {
        const page = target.contentWindow;
        if (!page || typeof page.applySettingsSection !== 'function') return;
        try { page.applySettingsSection(section === 'translate' || section === 'lan' ? section : ''); } catch (e) {}
    }

    // --- 登录相关 ---
    
    showLoginModal() {
        document.getElementById('login-error').style.display = 'none';
        document.getElementById('login-username').value = '';
        document.getElementById('login-password').value = '';
        this.loginModalEl.style.display = 'flex';
    }
    
    hideLoginModal() {
        this.loginModalEl.style.display = 'none';
    }
    
    showError(msg) {
        const el = document.getElementById('login-error');
        el.textContent = msg;
        el.style.display = 'block';
    }

    showToast(msg) {
        var toast = document.createElement('div');
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;padding:12px 24px;border-radius:12px;background:var(--sidebar-bg);border:1px solid #10b981;color:var(--text);font-size:14px;font-weight:600;box-shadow:0 8px 30px rgba(0,0,0,0.15);opacity:0;transition:opacity 0.3s ease;';
        document.body.appendChild(toast);
        requestAnimationFrame(function() { toast.style.opacity = '1'; });
        setTimeout(function() {
            toast.style.opacity = '0';
            setTimeout(function() { toast.remove(); }, 300);
        }, 2000);
    }

    async handleLogin() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        if (!username || !password) {
            this.showError('请输入用户名和密码');
            return;
        }
        try {
            await AuthManager.login(username, password);
            this.hideLoginModal();
            this.updateLoginState();
            this.updateSettingsButtonState();
        } catch (e) {
            this.showError(e.message);
        }
    }
    
    async handleRegister() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        if (!username || !password) {
            this.showError('请输入用户名和密码');
            return;
        }
        try {
            await AuthManager.register(username, password);
            this.hideLoginModal();
            this.showToast('注册成功');
            this.updateLoginState();
            this.updateSettingsButtonState();
        } catch (e) {
            this.showError(e.message);
        }
    }
    
    async confirmLogout() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 2100;
            display: flex; align-items: center; justify-content: center;
            background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
        `;
        overlay.innerHTML = `
            <div style="width:300px;background:var(--sidebar-bg);border:1px solid var(--border);border-radius:20px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
                <h2 style="margin:0 0 8px;font-size:16px;font-weight:700;color:var(--text);">退出登录</h2>
                <p style="font-size:13px;color:var(--muted);margin-bottom:20px;">确定要退出当前账号吗？</p>
                <div style="display:flex;gap:10px;">
                    <button id="logout-cancel-btn" style="flex:1;height:40px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:13px;font-weight:700;cursor:pointer;">取消</button>
                    <button id="logout-confirm-btn" style="flex:1;height:40px;border-radius:10px;border:none;background:#ef4444;color:#fcfcfb;font-size:13px;font-weight:700;cursor:pointer;">确认退出</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.getElementById('logout-cancel-btn').onclick = () => overlay.remove();
        document.getElementById('logout-confirm-btn').onclick = async () => {
            overlay.remove();
            if (this.loginBtnEl) this.loginBtnEl.title = '退出中...';
            await AuthManager.logout();
            window.location.href = '/static/login.html';
        };
    }
    
    updateLoginState() {
        // 侧边栏模式下 loginBtnEl 为空（登录功能已移至设置面板内），仅同步卡片状态
        if (!this.loginBtnEl) {
            this.updateSysAuthState();
            return;
        }
        const isSidebar = this._useSidebar;
        if (AuthManager.isLoggedIn()) {
            const user = AuthManager.getUser();
            if (isSidebar) {
                this.loginBtnEl.title = '点击退出登录 (' + this.escapeHtml(user.username) + ')';
                this.loginBtnEl.classList.add('logged-in');
            } else {
                this.loginBtnEl.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                `;
                this.loginBtnEl.title = '点击退出登录 (' + this.escapeHtml(user.username) + ')';
                this.loginBtnEl.style.width = '40px';
                this.loginBtnEl.style.padding = '0';
                this.loginBtnEl.style.borderRadius = '50%';
                this.loginBtnEl.classList.add('logged-in');
            }
        } else {
            if (isSidebar) {
                this.loginBtnEl.title = '登录';
                this.loginBtnEl.classList.remove('logged-in');
            } else {
                this.loginBtnEl.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                `;
                this.loginBtnEl.title = '登录';
                this.loginBtnEl.style.width = '40px';
                this.loginBtnEl.style.padding = '0';
                this.loginBtnEl.style.borderRadius = '50%';
                this.loginBtnEl.classList.remove('logged-in');
            }
        }
        // 同步系统设置卡片登录状态
        this.updateSysAuthState();
    }

    updateSysSettingsState() {
        this.updateSysLockStatus();
        this.updateSysThemeStatus();
        this.updateSysAuthState();
    }

    updateSysLockStatus() {
        const isLocked = localStorage.getItem('sidebarLocked') === 'true';
        const iconOpen = document.getElementById('sys-icon-lock-open');
        const iconClosed = document.getElementById('sys-icon-lock-closed');
        const status = document.getElementById('sys-lock-status');
        const trail = document.getElementById('sys-lock-trail');
        const tile = document.getElementById('sys-lock-btn');
        if (iconOpen) iconOpen.style.display = isLocked ? 'none' : 'block';
        if (iconClosed) iconClosed.style.display = isLocked ? 'block' : 'none';
        if (status) status.textContent = isLocked ? '已锁定' : '关闭';
        if (trail) trail.textContent = isLocked ? '开' : '关';
        if (tile) tile.style.setProperty('--tile', isLocked ? '#f59e0b' : '#00f0ff'),
                 tile.style.setProperty('--tile2', isLocked ? '#d97706' : '#06b6d4');
    }

    updateSysAuthState() {
        const accountName = document.getElementById('sidebar-account-name');
        const accountBtn = document.getElementById('sidebar-account-btn');
        if (typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn()) {
            const user = AuthManager.getUser();
            if (accountName) accountName.textContent = user.username || '账号';
            if (accountBtn) accountBtn.title = '账号：' + (user.username || '');
        } else {
            if (accountName) accountName.textContent = '登录';
            if (accountBtn) accountBtn.title = '登录';
        }
    }

    bindAccountMenu() {
        const btn = document.getElementById('sidebar-account-btn');
        if (!btn || btn.dataset.bound) return;
        btn.dataset.bound = '1';
        const menu = document.createElement('div');
        menu.id = 'account-menu';
        menu.style.cssText = 'display:none;position:fixed;z-index:1200;min-width:168px;padding:8px;border-radius:14px;border:1px solid var(--border);background:var(--sidebar-bg);box-shadow:0 16px 40px rgba(0,0,0,.28);';
        menu.innerHTML = `
            <div id="account-menu-name" style="padding:6px 8px 8px;font-size:12px;font-weight:800;color:var(--text);"></div>
            <button type="button" id="account-switch-btn" style="width:100%;height:34px;border:0;border-radius:10px;background:transparent;color:var(--text);font-size:12px;font-weight:800;text-align:left;padding:0 8px;cursor:pointer;">切换用户</button>
            <button type="button" id="account-logout-btn" style="width:100%;height:34px;border:0;border-radius:10px;background:transparent;color:#f87171;font-size:12px;font-weight:800;text-align:left;padding:0 8px;cursor:pointer;">退出登录</button>
        `;
        document.body.appendChild(menu);
        const place = () => {
            const rect = btn.getBoundingClientRect();
            menu.style.left = (rect.right + 8) + 'px';
            menu.style.top = Math.max(8, rect.bottom - 96) + 'px';
        };
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof AuthManager === 'undefined' || !AuthManager.isLoggedIn()) {
                this.showLoginModal();
                return;
            }
            const name = document.getElementById('account-menu-name');
            const user = AuthManager.getUser();
            if (name) name.textContent = user && user.username ? user.username : '已登录';
            place();
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        });
        document.getElementById('account-switch-btn').onclick = async (e) => {
            e.stopPropagation();
            await AuthManager.logout();
            window.location.href = '/static/login.html';
        };
        document.getElementById('account-logout-btn').onclick = (e) => {
            e.stopPropagation();
            menu.style.display = 'none';
            this.confirmLogout();
        };
        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && e.target !== btn) menu.style.display = 'none';
        });
    }
    
    updateSettingsButtonState() {
        const loggedIn = AuthManager.isLoggedIn();
        if (!loggedIn) {
            this.buttonEl.classList.add('disabled');
            this.buttonEl.title = '请先登录';
            this.buttonEl.style.opacity = '0.4';
            this.buttonEl.style.cursor = 'not-allowed';
        } else {
            this.buttonEl.classList.remove('disabled');
            this.buttonEl.title = '设置';
            this.buttonEl.style.opacity = '1';
            this.buttonEl.style.cursor = 'pointer';
        }
        const admin = loggedIn && AuthManager.isAdmin();
        ['settings-api-btn', 'settings-lan-btn', 'settings-comfyui-btn', 'settings-modules-btn', 'settings-users-btn', 'sys-restart-btn'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (!admin) el.style.display = 'none';
            else if (id === 'settings-users-btn') el.style.display = 'flex';
            else el.style.display = '';
        });
        if (!admin && ['api', 'lan', 'comfy', 'modules', 'users', 'comfy-models', 'translate'].includes(this.currentSection)) this.showSection('look');
    }
    
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    showUsersPanel() {
        this.showSection('users');
    }

    async showUserList() {
        const grid = document.getElementById('settings-users-grid');
        if (!grid) return;
        const token = AuthManager.getToken();
        if (!token) {
            grid.innerHTML = '<div class="user-card">请先登录</div>';
            return;
        }
        let users = [];
        try {
            const resp = await fetch('/api/auth/admin/users?token=' + encodeURIComponent(token));
            if (!resp.ok) throw new Error('获取用户列表失败');
            const data = await resp.json();
            users = data.users || [];
        } catch (e) {
            grid.innerHTML = '<div class="user-card">' + this.escapeHtml(e.message || '获取用户列表失败') + '</div>';
            return;
        }
        const currentUser = AuthManager.getUser() || {};
        if (!users.length) {
            grid.innerHTML = '<div class="user-card">还没有用户</div>';
            return;
        }
        grid.innerHTML = users.map(u => {
            const isSelf = u.username === currentUser.username;
            const canDelete = !u.is_admin;
            const name = this.escapeHtml(u.username);
            return `
                <div class="user-card" data-username="${name}">
                    <div class="user-card-main">
                        <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#fbbf24);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#141414;flex-shrink:0;">${name.charAt(0).toUpperCase()}</div>
                        <div style="min-width:0;">
                            <div style="font-size:14px;font-weight:700;color:var(--text);">${name}</div>
                            <div style="font-size:12px;color:var(--muted);margin-top:4px;">${isSelf ? '当前账号' : ''}${isSelf && u.is_admin ? ' · ' : ''}${u.is_admin ? '管理员' : (isSelf ? '' : '普通用户')}</div>
                        </div>
                    </div>
                    <div class="user-card-actions">
                        <button type="button" class="user-reset-btn">重置密码</button>
                        ${canDelete ? '<button type="button" class="user-delete-btn">删除</button>' : ''}
                    </div>
                    <div class="user-reset-row" hidden>
                        <input type="password" placeholder="输入新密码" autocomplete="new-password">
                        <button type="button" class="user-reset-save">确认</button>
                    </div>
                    <div class="user-card-error" style="display:none;color:#ef4444;font-size:12px;"></div>
                </div>
            `;
        }).join('');
        grid.querySelectorAll('.user-card').forEach(card => {
            const username = card.dataset.username;
            const error = card.querySelector('.user-card-error');
            const showCardError = (message) => {
                error.textContent = message;
                error.style.display = message ? 'block' : 'none';
            };
            card.querySelector('.user-reset-btn').onclick = () => {
                const row = card.querySelector('.user-reset-row');
                row.hidden = !row.hidden;
            };
            card.querySelector('.user-reset-save').onclick = async () => {
                const newPwd = card.querySelector('.user-reset-row input').value;
                if (!newPwd) {
                    showCardError('请输入新密码');
                    return;
                }
                try {
                    const resp = await fetch('/api/auth/admin/reset-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: AuthManager.getToken(), username, new_password: newPwd })
                    });
                    if (!resp.ok) {
                        const err = await resp.json();
                        throw new Error(err.detail || '重置失败');
                    }
                    card.querySelector('.user-reset-row').hidden = true;
                    card.querySelector('.user-reset-row input').value = '';
                    showCardError('');
                    this.showToast('密码已重置');
                } catch (e) {
                    showCardError(e.message);
                }
            };
            const deleteBtn = card.querySelector('.user-delete-btn');
            if (deleteBtn) {
                deleteBtn.onclick = async () => {
                    if (deleteBtn.dataset.confirm !== '1') {
                        deleteBtn.dataset.confirm = '1';
                        deleteBtn.textContent = '确认删除';
                        return;
                    }
                    try {
                        const resp = await fetch('/api/auth/admin/delete-user', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ token: AuthManager.getToken(), username })
                        });
                        if (!resp.ok) {
                            const err = await resp.json();
                            throw new Error(err.detail || '删除失败');
                        }
                        this.showToast('账号已删除');
                        this.showUserList();
                    } catch (e) {
                        showCardError(e.message);
                    }
                };
            }
        });
    }

    showResetPasswordModal(username, parentOverlay) {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed; inset: 0; z-index: 2100;
            display: flex; align-items: center; justify-content: center;
            background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
        `;
        modal.innerHTML = `
            <div style="width:320px;background:var(--sidebar-bg);border:1px solid var(--border);border-radius:20px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                    <h2 style="margin:0;font-size:16px;font-weight:700;color:var(--text);">重置密码</h2>
                    <button id="reset-modal-close" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:4px;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <p style="font-size:13px;color:var(--muted);margin-bottom:16px;">为用户 <strong style="color:var(--text);">${this.escapeHtml(username)}</strong> 设置新密码</p>
                <form id="reset-password-form" style="margin:0;" onsubmit="return false;">
                <input id="reset-new-password" type="password" placeholder="输入新密码" style="width:100%;height:42px;padding:0 14px;border-radius:10px;border:1px solid var(--border);background:var(--stage-bg);color:var(--text);font-size:14px;outline:none;box-sizing:border-box;">
                <div id="reset-error" style="color:#ef4444;font-size:12px;margin:12px 0;display:none;"></div>
                <button id="reset-confirm-btn" style="width:100%;height:42px;border-radius:10px;border:none;background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#141414;font-size:13px;font-weight:700;cursor:pointer;margin-top:12px;transition:all 0.2s;">确认重置</button>
                </form>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('reset-modal-close').onclick = () => modal.remove();
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        document.getElementById('reset-confirm-btn').onclick = async () => {
            const newPwd = document.getElementById('reset-new-password').value;
            if (!newPwd) {
                document.getElementById('reset-error').textContent = '请输入新密码';
                document.getElementById('reset-error').style.display = 'block';
                return;
            }
            try {
                const token = AuthManager.getToken();
                const resp = await fetch('/api/auth/admin/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, username, new_password: newPwd })
                });
                if (!resp.ok) {
                    const err = await resp.json();
                    throw new Error(err.detail || '重置失败');
                }
                modal.remove();
                parentOverlay.remove();
            } catch (e) {
                document.getElementById('reset-error').textContent = e.message;
                document.getElementById('reset-error').style.display = 'block';
            }
        };

        document.getElementById('reset-new-password').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('reset-confirm-btn').click();
        });
    }

    showDeleteConfirmModal(username, parentOverlay) {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed; inset: 0; z-index: 2100;
            display: flex; align-items: center; justify-content: center;
            background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
        `;
        modal.innerHTML = `
            <div style="width:320px;background:var(--sidebar-bg);border:1px solid var(--border);border-radius:20px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                    <h2 style="margin:0;font-size:16px;font-weight:700;color:var(--text);">删除账号</h2>
                    <button id="delete-modal-close" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:4px;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <p style="font-size:13px;color:var(--muted);margin-bottom:20px;">确定要删除用户 <strong style="color:var(--text);">${this.escapeHtml(username)}</strong> 吗？此操作不可恢复。</p>
                <div style="display:flex;gap:10px;">
                    <button id="delete-cancel-btn" style="flex:1;height:40px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:13px;font-weight:700;cursor:pointer;">取消</button>
                    <button id="delete-confirm-btn" style="flex:1;height:40px;border-radius:10px;border:none;background:#ef4444;color:#fcfcfb;font-size:13px;font-weight:700;cursor:pointer;">确认删除</button>
                </div>
                <div id="delete-error" style="color:#ef4444;font-size:12px;margin-top:12px;display:none;"></div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('delete-modal-close').onclick = () => modal.remove();
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        document.getElementById('delete-cancel-btn').onclick = () => modal.remove();
        document.getElementById('delete-confirm-btn').onclick = async () => {
            try {
                const token = AuthManager.getToken();
                const resp = await fetch('/api/auth/admin/delete-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, username })
                });
                if (!resp.ok) {
                    const err = await resp.json();
                    throw new Error(err.detail || '删除失败');
                }
                modal.remove();
                parentOverlay.remove();
                this.showToast('账号已删除');
            } catch (e) {
                document.getElementById('delete-error').textContent = e.message;
                document.getElementById('delete-error').style.display = 'block';
            }
        };
    }
}

// ---- ComfyUI 进程管理 (侧边栏 + 浮动面板) ----
class ComfyProcessManager {
    constructor() {
        this.pollTimer = null;
        this.logPollTimer = null;
        this.startBtn = document.getElementById('comfy-start-btn');
        this.modelsBtn = document.getElementById('comfy-models-btn');
        this.statusDot = document.getElementById('comfy-status-dot');
        this.statusText = document.getElementById('comfy-status-text');
        this.logBtn = document.getElementById('comfy-log-btn');
        this.logPanel = document.getElementById('comfy-log-panel');
        this.logContent = document.getElementById('comfy-log-content');
        this.logPath = document.getElementById('comfy-log-path');
        this.logRefresh = document.getElementById('comfy-log-refresh');
        this.logClear = document.getElementById('comfy-log-clear');
        this.logAuto = document.getElementById('comfy-log-auto');
        this.initialized = false;
        this.logOpen = false;
        this.lastLogSize = 0;
        this.mode = 'stopped';
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;

        // 绑定按钮事件
        if (this.startBtn) {
            this.startBtn.onclick = (e) => {
                e.stopPropagation();
                if (this.mode === 'stopped') this.startComfy();
                else this.stopComfy();
            };
        }

        if (this.modelsBtn) {
            this.modelsBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleModelVisibility();
            };
        }

        // 绑定日志面板
        if (this.logBtn) {
            this.logBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleLogPanel();
            };
        }
        if (this.logRefresh) {
            this.logRefresh.onclick = () => this.refreshLog();
        }
        if (this.logClear) {
            this.logClear.onclick = () => this.clearLog();
        }
        if (this.logAuto) {
            this.logAuto.onchange = () => {
                if (this.logAuto.checked) this.startLogPolling();
                else this.stopLogPolling();
            };
        }

        // 绑定侧边栏重启按钮
        const sbRestart = document.getElementById('sidebar-restart-btn');
        if (sbRestart) {
            // 保留原来的重启服务功能，加一个右键菜单
            sbRestart.onclick = () => { fetch('/api/restart', { method: 'POST' }).catch(() => {}); setTimeout(() => location.reload(), 2000); };
        }

        // 初始状态轮询
        this.pollStatus();
    }

    toggleLogPanel() {
        if (!this.logPanel) return;
        this.logOpen = !this.logOpen;
        this.logPanel.style.display = this.logOpen ? 'flex' : 'none';
        if (this.logOpen) {
            this.refreshLog();
            if (this.logAuto && this.logAuto.checked) this.startLogPolling();
        } else {
            this.stopLogPolling();
        }
    }

    startLogPolling() {
        this.stopLogPolling();
        this.logPollTimer = setInterval(() => this.refreshLog(), 2000);
    }

    stopLogPolling() {
        if (this.logPollTimer) {
            clearInterval(this.logPollTimer);
            this.logPollTimer = null;
        }
    }

    async refreshLog() {
        if (!this.logContent) return;
        try {
            const resp = await fetch('/api/comfyui/log-tail?lines=100');
            if (!resp.ok) return;
            const data = await resp.json();
            // 检查是否需要滚动到底部（只有用户在底部时才自动跟随）
            const pre = this.logContent;
            const wasAtBottom = (pre.scrollHeight - pre.scrollTop - pre.clientHeight) < 30;

            if (this.logPath) {
                this.logPath.textContent = data.path ? data.path.split(/[\\/]/).pop() : '(暂无)';
            }
            pre.textContent = data.content || '(空)';

            if (wasAtBottom || this.lastLogSize === 0) {
                pre.scrollTop = pre.scrollHeight;
            }
            this.lastLogSize = data.size || 0;
        } catch (e) {
            this.logContent.textContent = '加载失败: ' + e.message;
        }
    }

    async clearLog() {
        if (!confirm('清空当前 ComfyUI 日志？')) return;
        try {
            await fetch('/api/comfyui/log-clear', { method: 'POST' });
            this.refreshLog();
        } catch (e) {
            alert('清空失败: ' + e.message);
        }
    }

    async pollStatus() {
        try {
            const resp = await fetch('/api/comfyui/process-status');
            if (!resp.ok) throw new Error('status failed');
            const data = await resp.json();
            this.updateUI(data);
        } catch (e) {
            this.updateUI({ running: false, reachable: false });
        }

        // 继续轮询
        this.pollTimer = setTimeout(() => this.pollStatus(), 5000);
    }

    updateUI(data) {
        const isRunning = data.running === true;
        const isReachable = data.reachable === true;
        this.mode = isReachable ? 'running' : (isRunning ? 'starting' : 'stopped');

        if (this.startBtn) {
            const label = this.startBtn.querySelector('[data-role="label"]');
            const icon = this.startBtn.querySelector('[data-role="icon"]');
            this.startBtn.style.display = 'flex';
            if (this.mode === 'running') {
                if (label) label.textContent = '运行中';
                this.startBtn.title = '点击关闭 ComfyUI';
                this.startBtn.style.background = '#059669';
                this.startBtn.style.color = '#f8f8f6';
                if (icon) icon.innerHTML = '<rect x="5" y="5" width="14" height="14" rx="2"/>';
            } else if (this.mode === 'starting') {
                if (label) label.textContent = '启动中';
                this.startBtn.title = '正在启动，点击可关闭';
                this.startBtn.style.background = '#d97706';
                this.startBtn.style.color = '#faf9f7';
                if (icon) icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
            } else {
                if (label) label.textContent = '启动';
                this.startBtn.title = '启动 ComfyUI';
                this.startBtn.style.background = 'var(--accent)';
                this.startBtn.style.color = 'var(--bg)';
                if (icon) icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
            }
        }

        if (this.statusDot) {
            if (isReachable) {
                this.statusDot.style.background = '#10b981';
                this.statusDot.style.boxShadow = '0 0 6px rgba(16,185,129,0.8)';
            } else if (isRunning) {
                this.statusDot.style.background = '#f59e0b';
                this.statusDot.style.boxShadow = '0 0 6px rgba(245,158,11,0.8)';
            } else {
                this.statusDot.style.background = 'var(--faint)';
                this.statusDot.style.boxShadow = 'none';
            }
        }

        if (this.statusText) {
            if (isReachable) this.statusText.textContent = '运行中';
            else if (isRunning) this.statusText.textContent = '启动中...';
            else this.statusText.textContent = '已停止';
        }
    }

    async startComfy() {
        if (this.mode !== 'stopped') return;
        if (this.startBtn) { this.startBtn.disabled = true; this.startBtn.style.opacity = '0.5'; }
        try {
            const resp = await fetch('/api/comfyui/start', { method: 'POST' });
            if (!resp.ok) {
                const err = await resp.json();
                alert(err.detail || '启动失败');
                return;
            }
            const data = await resp.json();
            if (data.status === 'already_running') {
                this.updateUI({ running: true, reachable: true });
            } else {
                // 启动后立即轮询等待
                this.updateUI({ running: true, reachable: false });
                this.waitForReady();
            }
        } catch (e) {
            alert('启动失败: ' + e.message);
        } finally {
            if (this.startBtn) { this.startBtn.disabled = false; this.startBtn.style.opacity = '1'; }
        }
    }

    async waitForReady(attempts = 30) {
        for (let i = 0; i < attempts; i++) {
            await new Promise(r => setTimeout(r, 2000));
            try {
                const resp = await fetch('/api/comfyui/process-status');
                const data = await resp.json();
                this.updateUI(data);
                if (data.reachable) return;
            } catch (e) {}
        }
    }

    async toggleModelVisibility() {
        const ui = window._settingsUI;
        if (!ui) return;
        if (ui.currentSection === 'comfy-models') {
            ui.showSection(ui._modelsReturn || 'api');
            return;
        }
        await ui.showComfyModels();
    }

    async stopComfy() {
        if (this.startBtn) { this.startBtn.disabled = true; this.startBtn.style.opacity = '0.5'; }
        try {
            const resp = await fetch('/api/comfyui/stop', { method: 'POST' });
            if (!resp.ok) {
                const err = await resp.json();
                alert(err.detail || '停止失败');
                return;
            }
            this.updateUI({ running: false, reachable: false });
        } catch (e) {
            alert('停止失败: ' + e.message);
        } finally {
            if (this.startBtn) { this.startBtn.disabled = false; this.startBtn.style.opacity = '1'; }
        }
    }
}

window._settingsUI = new SettingsUI();
window._settingsUI.init();

// 延迟初始化进程管理器（等 DOM 渲染 + 面板就绪）
setTimeout(() => {
    if (!window._comfyProcMgr) {
        window._comfyProcMgr = new ComfyProcessManager();
        window._comfyProcMgr.init();
    }
}, 500);
