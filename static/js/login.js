/* 登录页交互 —— 与表单结构解耦的纯 DOM 操作，无框架依赖。
 * 关键约定：
 *   1. 错误提示用 class 折叠（#loginError.is-on），不在 JS 里算高度；
 *   2. 提交按钮的加载态用 class（.is-busy），文字与转圈由 CSS 切换；
 *   3. 显示密码只切 input.type，不改 DOM 结构，焦点与光标位置不丢。
 */
(function () {
'use strict';

var loginForm = document.getElementById('loginForm');
var loginBtn = document.getElementById('loginBtn');
var rememberMe = document.getElementById('rememberMe');
var forgotPassword = document.getElementById('forgotPassword');

/* 前端仅记住账号；不保存密码，也不改变现有令牌的存储契约。 */
try {
    var savedUsername = window.localStorage.getItem('xy_login_username');
    if (savedUsername) document.getElementById('username').value = savedUsername;
} catch (e) { /* 存储被浏览器禁用时仍允许登录。 */ }
rememberMe.addEventListener('change', function () {
    if (!rememberMe.checked) {
        try { window.localStorage.removeItem('xy_login_username'); } catch (e) { /* 不阻断输入。 */ }
    }
});
var loginError = document.getElementById('loginError');
var usernameInput = document.getElementById('username');
var passwordInput = document.getElementById('password');
var togglePwd = document.getElementById('togglePwd');

/* 背景引擎：预设由 login-bg.js 注册表提供（?bg= 或 localStorage 可切换） */
if (window.LoginBg) window.LoginBg.mount(document.getElementById('bgCanvas'));

var errorText = loginError.firstElementChild;

function showError(msg, field) {
    errorText.textContent = msg;
    loginError.classList.add('is-on');
    if (field) field.focus();
}
function hideError() {
    if (!loginError.classList.contains('is-on')) return;
    loginError.classList.remove('is-on');
    // 等折叠过渡结束再清文字，避免残影
    window.setTimeout(function () {
        if (!loginError.classList.contains('is-on')) errorText.textContent = '';
    }, 240);
}
function setBusy(busy) {
    loginBtn.classList.toggle('is-busy', busy);
    loginBtn.disabled = busy;
    forgotPassword.disabled = busy;
    loginBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
}
function enterApp(data) {
    try {
        if (rememberMe.checked) window.localStorage.setItem('xy_login_username', usernameInput.value.trim());
        else window.localStorage.removeItem('xy_login_username');
    } catch (e) { /* 记住账号失败不阻断登录。 */ }
    window.localStorage.setItem('xy_auth_token', data.token);
    window.localStorage.setItem('xy_auth_user', JSON.stringify({ username: data.username, is_admin: data.is_admin }));
    window.location.href = '/static/index.html';
}

async function submitAuth(path, label) {
    var username = usernameInput.value.trim();
    var password = passwordInput.value;
    if (!username) { showError('请输入用户名', usernameInput); return; }
    if (!password) { showError('请输入密码', passwordInput); return; }
    hideError();
    setBusy(true);
    try {
        var resp = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        });
        if (!resp.ok) {
            var err = await resp.json().catch(function () { return {}; });
            showError(err.detail || (label + '失败'));
            return;
        }
        enterApp(await resp.json());
    } catch (e) {
        showError('网络错误，请稍后重试');
    } finally {
        setBusy(false);
    }
}

function doLogin() { return submitAuth('/api/auth/login', '登录'); }


loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    doLogin();
});
forgotPassword.addEventListener('click', function () {
    showError('密码找回暂未接入，请联系管理员重置密码。');
});

/* 开始修正输入时立刻收起错误，不打断输入 */
[usernameInput, passwordInput].forEach(function (el) {
    el.addEventListener('input', hideError);
});

/* 显示/隐藏密码：只切 type，焦点与光标位置保持不变 */
togglePwd.addEventListener('click', function () {
    var show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    togglePwd.setAttribute('aria-pressed', show ? 'true' : 'false');
    togglePwd.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    passwordInput.focus();
});

usernameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
});
passwordInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
});

/* 光之解锁：聚焦输入框时让背景极光收束包裹它；离开表单才散开 */
function focusFieldAt(el) {
    if (!window.LoginBg || !el) return;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var nx = (r.left + r.width / 2) / window.innerWidth;
    var ny = (r.top + r.height / 2) / window.innerHeight;
    window.LoginBg.setFocus(nx, ny, true);
}
function maybeUnfocus() {
    if (!window.LoginBg) return;
    window.setTimeout(function () {
        var a = document.activeElement;
        if (a !== usernameInput && a !== passwordInput) {
            window.LoginBg.setFocus(null, null, false);
        }
    }, 0);
}
usernameInput.addEventListener('focus', function () { focusFieldAt(usernameInput); });
passwordInput.addEventListener('focus', function () { focusFieldAt(passwordInput); });
usernameInput.addEventListener('blur', maybeUnfocus);
passwordInput.addEventListener('blur', maybeUnfocus);
})();
