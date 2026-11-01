const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('仓库来源加载、添加、确认替换及断开复用现有包管理入口', async () => {
    const calls = [];
    let source = {url: '', packs: []};
    let confirm = false;
    let click;
    const host = {innerHTML: '', addEventListener(name, fn) { click = fn; }};
    const ctx = {
        Event: class {},
        window: {
            prompt: () => 'https://github.com/ARTpace/Art-prompt-library',
            confirm: () => confirm,
            dispatchEvent: () => {},
        },
        fetch: async (url, options = {}) => {
            calls.push({url, ...options});
            let data;
            if (url === '/api/style-packs') data = {packs: [], overlay: {}};
            else if (url.endsWith('/catalog')) data = {packs: []};
            else if (url.endsWith('/repository/install')) data = {success: true};
            else if (options.method === 'POST') {
                source = {url: 'https://raw.githubusercontent.com/ARTpace/Art-prompt-library/main/catalog.json',
                    packs: [{packId: 'test-pack', name: '<script>标题</script>', categoryCount: '<svg/onload=alert(1)>',
                        version: '2.0.0', entryCount: 1, installed: true, updateAvailable: true, available: true}]};
                data = source;
            } else if (options.method === 'DELETE') data = source = {url: '', packs: []};
            else data = source;
            return {ok: true, json: async () => data};
        },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/modules/style-pack-manager.js'), 'utf8'), ctx);
    ctx.window.StylePackManager.render(host);
    await flush();
    assert.match(host.innerHTML, /添加仓库/);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
    function press(dataset, attribute) {
        click({target: {closest: () => ({dataset, hasAttribute: (name) => name === attribute})}});
    }
    press({spRepo: 'set'}, 'data-sp-repo');
    await flush();
    assert.match(host.innerHTML, /检查更新/);
    assert.match(host.innerHTML, /更新此包/);
    assert.match(host.innerHTML, /&lt;script&gt;/);
    assert.doesNotMatch(host.innerHTML, /<script>|<svg\/onload/);
    press({spRepoInstall: 'test-pack'}, 'data-sp-repo-install');
    await flush();
    assert.equal(calls.filter((c) => c.url.endsWith('/repository/install')).length, 0);
    confirm = true;
    press({spRepoInstall: 'test-pack'}, 'data-sp-repo-install');
    await flush();
    assert.deepEqual(JSON.parse(calls.find((c) => c.url.endsWith('/repository/install')).body), {packId: 'test-pack', replace: true});
    press({spRepo: 'disconnect'}, 'data-sp-repo');
    await flush();
    assert.match(host.innerHTML, /已安装的风格包保留/);
    assert.equal(calls.filter((c) => c.method === 'DELETE').length, 1);
    assert.equal(calls.find((c) => c.method === 'DELETE').url, '/api/style-packs/repository');
});
