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
                this.clear();
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
                box-shadow: 0 0 8px var(--accent-glow, #06B6D4), 0 0 20px var(--accent-glow, #06B6D4), 0 4px 20px var(--monitor-shadow, rgba(0,180,216,0.15));
                animation: breatheGlow 2s ease-in-out infinite;
            }
            @keyframes breatheGlow {
                0%, 100% { box-shadow: 0 0 6px var(--accent-glow, #06B6D4), 0 0 14px var(--accent-glow, #06B6D4), 0 4px 20px var(--monitor-shadow, rgba(0,180,216,0.15)); }
                50% { box-shadow: 0 0 12px var(--accent-glow, #06B6D4), 0 0 30px var(--accent-glow, #06B6D4), 0 4px 20px var(--monitor-shadow, rgba(0,180,216,0.15)); }
            }
            /* 系统设置 - 手机 App 风格功能按钮 */
            /* ===== 统一 Tile 样式（顶部入口 & 系统功能共用）===== */
            .sys-tile,
            .set-card {
                width: 100%;
                min-height: 58px;
                border-radius: 16px;
                border: 1px solid var(--border);
                background: rgba(120, 130, 150, 0.10);
                background: linear-gradient(135deg, color-mix(in srgb, var(--tile, var(--sc, #38bdf8)) 14%, transparent), color-mix(in srgb, var(--tile2, var(--sc2, #0ea5e9)) 4%, transparent));
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
                border-color: color-mix(in srgb, var(--tile, var(--sc, #38bdf8)) 45%, var(--border));
                box-shadow: 0 6px 18px color-mix(in srgb, var(--tile, var(--sc, #38bdf8)) 22%, transparent);
            }
            .sys-tile:active,
            .set-card:active {
                transform: scale(0.97);
                background: rgba(120, 130, 150, 0.16);
                background: linear-gradient(135deg, color-mix(in srgb, var(--tile, var(--sc, #38bdf8)) 22%, transparent), color-mix(in srgb, var(--tile2, var(--sc2, #0ea5e9)) 10%, transparent));
            }

            /* 统一图标容器 */
            .sys-tile-ico,
            .set-card-ico {
                width: 41px;
                height: 41px;
                border-radius: 13px;
                background: linear-gradient(135deg, var(--tile, var(--sc, #38bdf8)), var(--tile2, var(--sc2, #0ea5e9)));
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                color: #fff;
                box-shadow: 0 4px 14px color-mix(in srgb, var(--tile, var(--sc, #38bdf8)) 28%, transparent);
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
                color: var(--tile, var(--sc, #38bdf8));
                background: color-mix(in srgb, var(--tile, var(--sc, #38bdf8)) 12%, transparent);
            }



            /* 退出登录强调色 */
            .sys-tile-danger {
                border-color: color-mix(in srgb, #f87171 40%, var(--border));
            }
            .sys-tile-danger:hover {
                border-color: color-mix(in srgb, #f87171 60%, var(--border));
                box-shadow: 0 6px 18px rgba(248,113,113,0.22);
            }
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
            background: var(--monitor-bg, rgba(0, 180, 216, 0.1));
            backdrop-filter: blur(12px);
            border: 1px solid var(--monitor-border, rgba(0, 180, 216, 0.3));
            box-shadow: 0 4px 20px var(--monitor-shadow, rgba(0, 180, 216, 0.15));
            color: var(--text, #0a1628);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
        `;
        settingsBtn.onmouseenter = () => {
            if (!settingsBtn.classList.contains('disabled')) {
                settingsBtn.style.transform = 'scale(1.08)';
                settingsBtn.style.boxShadow = '0 6px 25px rgba(0, 180, 216, 0.25)';
            }
        };
        settingsBtn.onmouseleave = () => {
            settingsBtn.style.transform = 'scale(1)';
            settingsBtn.style.boxShadow = '0 4px 20px var(--monitor-shadow, rgba(0, 180, 216, 0.15))';
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
            background: var(--monitor-bg, rgba(0, 180, 216, 0.1));
            backdrop-filter: blur(12px);
            border: 1px solid var(--monitor-border, rgba(0, 180, 216, 0.3));
            box-shadow: 0 4px 20px var(--monitor-shadow, rgba(0, 180, 216, 0.15));
            color: var(--text, #0a1628);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
        `;
        themeBtn.onmouseenter = () => {
            themeBtn.style.transform = 'scale(1.08)';
            themeBtn.style.boxShadow = '0 6px 25px rgba(0, 180, 216, 0.25)';
        };
        themeBtn.onmouseleave = () => {
            themeBtn.style.transform = 'scale(1)';
            themeBtn.style.boxShadow = '0 4px 20px var(--monitor-shadow, rgba(0, 180, 216, 0.15))';
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
            background: var(--monitor-bg, rgba(0, 180, 216, 0.1));
            backdrop-filter: blur(12px);
            border: 1px solid var(--monitor-border, rgba(0, 180, 216, 0.3));
            box-shadow: 0 4px 20px var(--monitor-shadow, rgba(0, 180, 216, 0.15));
            color: var(--text, #0a1628);
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
            loginBtn.style.boxShadow = '0 6px 25px rgba(0, 180, 216, 0.25)';
        };
        loginBtn.onmouseleave = () => {
            loginBtn.style.transform = 'scale(1)';
            loginBtn.style.boxShadow = '0 4px 20px var(--monitor-shadow, rgba(0, 180, 216, 0.15))';
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
            background: var(--monitor-bg, rgba(0, 180, 216, 0.1));
            backdrop-filter: blur(12px);
            border: 1px solid var(--monitor-border, rgba(0, 180, 216, 0.3));
            box-shadow: 0 4px 20px var(--monitor-shadow, rgba(0, 180, 216, 0.15));
            color: var(--text, #0a1628);
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
            restartBtn.style.boxShadow = '0 4px 20px var(--monitor-shadow, rgba(0, 180, 216, 0.15))';
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
            background: rgba(8, 15, 30, 0.5);
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
            bottom: 80px;
            left: 20px;
            z-index: 999;
            width: min(340px, calc(100vw - 40px));
            max-height: calc(100vh - 120px);
            overflow-y: auto;
            background: var(--sidebar-bg);
            border: 1px solid var(--border);
            border-radius: 22px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
            padding: 22px;
            display: none;
            opacity: 0;
            transform: translateY(16px) scale(0.97);
            transition: opacity 0.22s ease, transform 0.22s ease;
        `;
        
        panel.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                <h2 style="margin:0;font-size:16px;font-weight:700;color:var(--text);">设置</h2>
                <button id="settings-close-btn" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:4px;" title="关闭">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            
            <div style="display:flex;flex-direction:column;gap:12px;">
                <button id="settings-api-btn" class="set-card" style="--sc:#00b4d8;--sc2:#00f0ff;">
                    <span class="set-card-ico">
                        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#0a1628" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                        </svg>
                    </span>
                    <span class="set-card-body">
                        <span class="set-card-title">API 设置</span>
                        <span class="set-card-sub">配置 API Key 和模型参数</span>
                    </span>
                    <span class="set-card-arrow">›</span>
                </button>
                
                <button id="settings-comfyui-btn" class="set-card" style="--sc:#8b5cf6;--sc2:#c084fc;">
                    <span class="set-card-ico">
                        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#0a1628" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                        </svg>
                    </span>
                    <span class="set-card-body">
                        <span class="set-card-title">ComfyUI 设置</span>
                        <span class="set-card-sub">管理工作流和节点配置</span>
                    </span>
                    <span class="set-card-arrow">›</span>
                </button>

                <!-- ComfyUI 启动/停止控制（统一样式卡片） -->
                <div id="comfy-start-control" class="sys-tile" style="--tile:#06b6d4;--tile2:#22d3ee;cursor:default;flex-direction:column;align-items:stretch;gap:0;padding:0;min-height:auto;">
                    <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;">
                        <div id="comfy-status-dot" style="width:8px;height:8px;border-radius:50%;background:var(--faint);flex-shrink:0;"></div>
                        <span style="font-size:12px;font-weight:700;color:var(--text);flex:1;">ComfyUI</span>
                        <span id="comfy-status-text" style="font-size:11px;font-weight:700;color:var(--muted);">检查中...</span>
                    </div>
                    <div style="display:flex;gap:6px;padding:0 14px 12px;">
                        <button id="comfy-start-btn" style="flex:1;height:34px;border-radius:10px;border:none;background:var(--accent);color:var(--bg);font-size:12px;font-weight:800;cursor:pointer;display:none;align-items:center;justify-content:center;gap:6px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            <span>启动</span>
                        </button>
                        <button id="comfy-stop-btn" style="flex:1;height:34px;border-radius:10px;border:1px solid #ef4444;background:transparent;color:#ef4444;font-size:12px;font-weight:800;cursor:pointer;display:none;align-items:center;justify-content:center;gap:6px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                            <span>停止</span>
                        </button>
                        <button id="comfy-log-btn" title="查看日志" style="width:34px;height:34px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:12px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                        </button>
                    </div>
                </div>

                <!-- ComfyUI 日志面板 (默认隐藏，点击日志按钮展开) -->
                <div id="comfy-log-panel" style="display:none;width:100%;flex-direction:column;gap:6px;padding:0 16px 10px;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:11px;color:var(--muted);flex:1;font-family:ui-monospace,monospace;" id="comfy-log-path">logs/comfyui-…log</span>
                        <button id="comfy-log-refresh" title="刷新" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                        </button>
                        <button id="comfy-log-clear" title="清空" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                        </button>
                        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--muted);cursor:pointer;">
                            <input type="checkbox" id="comfy-log-auto" checked style="cursor:pointer;">自动
                        </label>
                    </div>
                    <pre id="comfy-log-content" style="margin:0;padding:10px;background:#0a1628;color:#a7f3d0;border-radius:8px;font-size:10.5px;font-family:ui-monospace,Consolas,monospace;line-height:1.45;max-height:280px;overflow:auto;white-space:pre-wrap;word-break:break-all;border:1px solid rgba(16,185,129,0.2);">(加载中...)</pre>
                </div>

                <button id="settings-users-btn" class="set-card" style="--sc:#f59e0b;--sc2:#fbbf24;display:none;">
                    <span class="set-card-ico">
                        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#0a1628" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                    </span>
                    <span class="set-card-body">
                        <span class="set-card-title">用户管理</span>
                        <span class="set-card-sub">管理用户和重置密码</span>
                    </span>
                    <span class="set-card-arrow">›</span>
                </button>

                <!-- 系统设置（统一样式容器） -->
                <div class="set-card" style="--sc:#6366f1;--sc2:#818cf8;cursor:default;overflow:hidden;flex-direction:column;align-items:stretch;gap:0;padding:0;min-height:auto;">
                    <!-- 头部 -->
                    <div style="display:flex;align-items:center;gap:13px;padding:11px 14px 6px;">
                        <span class="set-card-ico">
                            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#0a1628" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2.83 0 l.06.06 a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06-.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                            </svg>
                        </span>
                        <span class="set-card-body">
                            <span class="set-card-title">系统设置</span>
                            <span class="set-card-sub">外观、侧边栏与服务</span>
                        </span>
                    </div>
                    <!-- 分割线 -->
                    <div style="height:1px;background:var(--border);margin:0 14px;opacity:0.5;"></div>
                    <!-- 功能行 -->
                    <div style="display:flex;flex-direction:column;padding:8px 10px 12px;gap:8px;" id="sys-settings-rows">
                        <!-- 侧边栏锁定 -->
                        <button id="sys-lock-btn" class="sys-tile" style="--tile:#38bdf8;--tile2:#0ea5e9;">
                            <span class="sys-tile-ico">
                                <svg id="sys-icon-lock-open" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                                <svg id="sys-icon-lock-closed" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg>
                            </span>
                            <span class="sys-tile-txt">
                                <span class="sys-tile-title">锁定侧边栏</span>
                                <span id="sys-lock-status" class="sys-tile-sub">关闭</span>
                            </span>
                            <span class="sys-tile-trail" id="sys-lock-trail">关</span>
                        </button>
                        <!-- 深浅主题 -->
                        <button id="sys-theme-btn" class="sys-tile" style="--tile:#a78bfa;--tile2:#8b5cf6;">
                            <span class="sys-tile-ico">
                                <svg id="sys-icon-moon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                                <svg id="sys-icon-sun" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                            </span>
                            <span class="sys-tile-txt">
                                <span class="sys-tile-title">切换主题</span>
                                <span id="sys-theme-status" class="sys-tile-sub">深色</span>
                            </span>
                            <span class="sys-tile-trail" id="sys-theme-trail">深色</span>
                        </button>
                        <!-- 登录/退出 -->
                        <button id="sys-auth-btn" class="sys-tile" style="--tile:#34d399;--tile2:#10b981;">
                            <span class="sys-tile-ico">
                                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                            </span>
                            <span class="sys-tile-txt">
                                <span class="sys-tile-title" id="sys-auth-label">登录</span>
                                <span id="sys-auth-hint" class="sys-tile-sub">未登录</span>
                            </span>
                            <span class="sys-tile-trail" id="sys-auth-trail">›</span>
                        </button>
                        <!-- 重启服务 -->
                        <button id="sys-restart-btn" class="sys-tile" style="--tile:#fb923c;--tile2:#f97316;">
                            <span class="sys-tile-ico">
                                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
                            </span>
                            <span class="sys-tile-txt">
                                <span class="sys-tile-title">重启服务</span>
                                <span class="sys-tile-sub">立即重启生效</span>
                            </span>
                            <span class="sys-tile-trail">›</span>
                        </button>
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
                background: var(--sidebar-bg, #D4ECF2);
                border: 1px solid var(--border, #B0D4E0);
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
                        background:linear-gradient(135deg,#00b4d8,#00f0ff);
                        color:#0a1628;font-size:13px;font-weight:700;cursor:pointer;
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
        
        document.getElementById('settings-api-btn').onclick = () => {
            this.switchToSettings('api-settings');
        };
        
        document.getElementById('settings-comfyui-btn').onclick = () => {
            this.switchToSettings('comfyui-settings');
        };
        
        const usersBtn = document.getElementById('settings-users-btn');
        if (usersBtn) {
            usersBtn.onclick = () => {
                this.showUsersPanel();
            };
        }
        
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
        const sysThemeBtn = document.getElementById('sys-theme-btn');
        const sysAuthBtn = document.getElementById('sys-auth-btn');
        const sysRestartBtn = document.getElementById('sys-restart-btn');

        if (sysLockBtn) {
            sysLockBtn.onclick = () => {
                if (typeof toggleSidebarLock === 'function') toggleSidebarLock();
                this.updateSysSettingsState();
            };
        }
        if (sysThemeBtn) {
            sysThemeBtn.onclick = () => {
                if (typeof toggleTheme === 'function') toggleTheme();
                this.updateThemeIcon();
                this.updateSysThemeStatus();
            };
        }
        if (sysAuthBtn) {
            sysAuthBtn.onclick = () => {
                if (AuthManager.isLoggedIn()) {
                    this.confirmLogout();
                } else {
                    this.showLoginModal();
                }
            };
        }
        if (sysRestartBtn) {
            sysRestartBtn.onclick = () => {
                fetch('/api/restart', { method: 'POST' }).catch(() => {});
                setTimeout(() => location.reload(), 2000);
            };
        }
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
        this.panelEl.style.display = 'block';
        requestAnimationFrame(() => {
            this.panelEl.style.opacity = '1';
            this.panelEl.style.transform = 'translateY(0) scale(1)';
        });
        this.panelVisible = true;
        // 同步系统设置卡片内所有状态
        this.updateSysSettingsState();
    }

    hidePanel() {
        this.backdropEl.style.opacity = '0';
        this.backdropEl.style.pointerEvents = 'none';
        this.panelEl.style.opacity = '0';
        this.panelEl.style.transform = 'translateY(16px) scale(0.97)';
        setTimeout(() => {
            this.panelEl.style.display = 'none';
        }, 220);
        this.panelVisible = false;
    }
    
    switchToSettings(id) {
        this.hidePanel();
        
        const target = document.getElementById('frame-' + id);
        if (!target) {
            console.error('Settings iframe not found: frame-' + id);
            return;
        }
        
        document.querySelectorAll('iframe').forEach(f => f.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => {
            n.classList.remove('active', 'submenu-active', 'has-active-child');
        });
        
        target.classList.add('active');
        if (!target.src) target.src = target.dataset.src;
        
        if (typeof syncThemeToFrame === 'function') {
            syncThemeToFrame(target);
        }
        
        localStorage.setItem('lastSelectedApp', JSON.stringify({ id: id, parentId: null }));
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
                    <button id="logout-confirm-btn" style="flex:1;height:40px;border-radius:10px;border:none;background:#ef4444;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">确认退出</button>
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
        if (tile) tile.style.setProperty('--tile', isLocked ? '#f59e0b' : '#38bdf8'),
                 tile.style.setProperty('--tile2', isLocked ? '#d97706' : '#0ea5e9');
    }

    updateSysAuthState() {
        const label = document.getElementById('sys-auth-label');
        const hint = document.getElementById('sys-auth-hint');
        const trail = document.getElementById('sys-auth-trail');
        const tile = document.getElementById('sys-auth-btn');
        if (!label || !hint) return;
        if (typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn()) {
            const user = AuthManager.getUser();
            label.textContent = '退出登录';
            hint.textContent = this.escapeHtml(user.username);
            if (trail) trail.textContent = '退出';
            if (tile) tile.classList.add('sys-tile-danger');
        } else {
            label.textContent = '登录';
            hint.textContent = '未登录';
            if (trail) trail.textContent = '›';
            if (tile) tile.classList.remove('sys-tile-danger');
        }
    }
    
    updateSettingsButtonState() {
        if (!AuthManager.isLoggedIn() || !AuthManager.isAdmin()) {
            this.buttonEl.classList.add('disabled');
            this.buttonEl.title = '需要管理员权限';
            this.buttonEl.style.opacity = '0.4';
            this.buttonEl.style.cursor = 'not-allowed';
        } else {
            this.buttonEl.classList.remove('disabled');
            this.buttonEl.title = '设置';
            this.buttonEl.style.opacity = '1';
            this.buttonEl.style.cursor = 'pointer';
        }
        const usersBtn = document.getElementById('settings-users-btn');
        if (usersBtn) {
            usersBtn.style.display = AuthManager.isLoggedIn() && AuthManager.isAdmin() ? 'flex' : 'none';
        }
    }
    
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    showUsersPanel() {
        this.hidePanel();
        this.showUserList();
    }

    async showUserList() {
        const token = AuthManager.getToken();
        if (!token) return;
        let users = [];
        try {
            const resp = await fetch('/api/auth/admin/users?token=' + encodeURIComponent(token));
            if (!resp.ok) throw new Error('获取用户列表失败');
            const data = await resp.json();
            users = data.users || [];
        } catch (e) {
            console.error(e);
            return;
        }
        const overlay = document.createElement('div');
        overlay.id = 'users-panel-overlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 2000;
            display: flex; align-items: center; justify-content: center;
            background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
        `;
        const box = document.createElement('div');
        box.style.cssText = `
            width: 360px; max-height: 500px; overflow-y: auto;
            background: var(--sidebar-bg); border: 1px solid var(--border);
            border-radius: 20px; padding: 24px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.2);
        `;
        let html = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
                <h2 style="margin:0;font-size:16px;font-weight:700;color:var(--text);">用户管理</h2>
                <button id="users-panel-close" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:4px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
        `;
        const currentUser = AuthManager.getUser() || {};
        users.forEach(u => {
            const isSelf = u.username === currentUser.username;
            const canDelete = !u.is_admin;
            html += `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border);">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#00b4d8,#00f0ff);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#0a1628;flex-shrink:0;">${this.escapeHtml(u.username.charAt(0).toUpperCase())}</div>
                        <span style="font-size:14px;font-weight:600;color:var(--text);">${this.escapeHtml(u.username)}</span>
                        ${isSelf ? '<span style="font-size:11px;color:var(--muted);background:var(--monitor-bg);padding:2px 8px;border-radius:8px;">当前</span>' : ''}
                        ${u.is_admin ? '<span style="font-size:11px;color:var(--muted);background:rgba(251,191,36,0.15);padding:2px 8px;border-radius:8px;">管理员</span>' : ''}
                    </div>
                    <div style="display:flex;gap:6px;">
                        <button class="user-reset-btn" data-username="${this.escapeHtml(u.username)}" style="height:32px;padding:0 14px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;">重置密码</button>
                        ${canDelete ? `<button class="user-delete-btn" data-username="${this.escapeHtml(u.username)}" style="height:32px;padding:0 14px;border-radius:8px;border:1px solid #ef4444;background:transparent;color:#ef4444;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s;">删除</button>` : ''}
                    </div>
                </div>
            `;
        });
        box.innerHTML = html;
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        document.getElementById('users-panel-close').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        overlay.querySelectorAll('.user-reset-btn').forEach(btn => {
            btn.onclick = () => {
                const username = btn.dataset.username;
                this.showResetPasswordModal(username, overlay);
            };
        });

        overlay.querySelectorAll('.user-delete-btn').forEach(btn => {
            btn.onclick = () => {
                const username = btn.dataset.username;
                this.showDeleteConfirmModal(username, overlay);
            };
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
                <button id="reset-confirm-btn" style="width:100%;height:42px;border-radius:10px;border:none;background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#0a1628;font-size:13px;font-weight:700;cursor:pointer;margin-top:12px;transition:all 0.2s;">确认重置</button>
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
                    <button id="delete-confirm-btn" style="flex:1;height:40px;border-radius:10px;border:none;background:#ef4444;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">确认删除</button>
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
        this.stopBtn = document.getElementById('comfy-stop-btn');
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
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;

        // 绑定按钮事件
        if (this.startBtn) {
            this.startBtn.onclick = () => this.startComfy();
        }
        if (this.stopBtn) {
            this.stopBtn.onclick = () => this.stopComfy();
        }

        // 绑定日志面板
        if (this.logBtn) {
            this.logBtn.onclick = () => this.toggleLogPanel();
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

        if (this.startBtn) this.startBtn.style.display = isRunning ? 'none' : 'flex';
        if (this.stopBtn) this.stopBtn.style.display = isRunning ? 'flex' : 'none';

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

    async stopComfy() {
        if (this.stopBtn) { this.stopBtn.disabled = true; this.stopBtn.style.opacity = '0.5'; }
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
            if (this.stopBtn) { this.stopBtn.disabled = false; this.stopBtn.style.opacity = '1'; }
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
