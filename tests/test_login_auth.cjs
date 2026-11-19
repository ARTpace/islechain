const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const elements = {};
function element(id) {
    return elements[id] ||= { value: '', checked: true, type: 'password', hidden: false,
        classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
        events: {}, addEventListener(name, fn) { this.events[name] = fn; },
        focus() {}, setAttribute() {}, querySelector() { return element('buttonLabel'); },
        firstElementChild: { textContent: '' } };
}
const requests = [];
const storage = new Map();
const window = { localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) }, location: {}, setTimeout };
vm.runInNewContext(fs.readFileSync('static/js/login.js', 'utf8'), {
    document: { getElementById: element }, window,
    fetch: async (url, options) => { requests.push({url, body: JSON.parse(options.body)}); return {ok: true, json: async () => ({token: 'test-token', username: 'test', is_admin: false})}; }
});
(async () => {
    element('authSwitch').events.click();
    assert.equal(element('confirmPasswordField').hidden, false);
    element('username').value = ' test ';
    element('password').value = 'secret';
    element('confirmPassword').value = 'different';
    element('loginForm').events.submit({preventDefault() {}});
    assert.equal(requests.length, 0, 'mismatched passwords must not submit');
    element('confirmPassword').value = 'secret';
    element('loginForm').events.submit({preventDefault() {}});
    element('loginForm').events.submit({preventDefault() {}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1, 'busy form must prevent duplicate submission');
    assert.equal(requests[0].url, '/api/auth/register');
    assert.equal(requests[0].body.username, 'test');
    assert.equal(storage.get('xy_auth_token'), 'test-token');
    assert.equal(window.location.href, '/static/index.html');
    element('authSwitch').events.click();
    assert.equal(element('confirmPasswordField').hidden, true);
    element('loginForm').events.submit({preventDefault() {}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests[1].url, '/api/auth/login');
    console.log('登录/注册切换、密码校验、防重复提交和认证跳转检查通过');
})().catch(error => { console.error(error); process.exitCode = 1; });
