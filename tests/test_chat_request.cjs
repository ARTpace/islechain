const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
vm.runInNewContext(fs.readFileSync('static/modules/chat-session.js', 'utf8'), {window});
const request = window.ChatSession.request;
const unavailableError = message => Object.assign(new Error(message), {fallback: true});
(async () => {
    const payload = {message:'你好', reference_images:[{url:'/image.png'}]};
    const controller = new AbortController();
    const base = {payload, headers:{'X-Test':'yes'}, signal:controller.signal, unavailableError};
    const response = {ok:true};
    assert.equal(await request({...base, fetch:async (url, options) => {
        assert.equal(url, '/api/chat/stream');
        assert.equal(options.signal, controller.signal);
        assert.deepEqual(JSON.parse(options.body), payload);
        assert.equal(options.headers['X-Test'], 'yes');
        return response;
    }}), response);
    for (const [status, detail, fallback] of [[422,'invalid',false], [401,'请重新登录',false],
        [403,'unauthorized',false], [401,'upstream key missing',true], [502,'upstream offline',true]]) {
        await assert.rejects(request({...base, fetch:async () => ({ok:false, status, json:async () => ({detail})})}),
            error => error.message === detail && !!error.fallback === fallback);
    }
    await assert.rejects(request({...base, fetch:async () => {throw new Error('network');}}), error => error.fallback);
    const cancelled = new Error('cancelled'); controller.abort();
    await assert.rejects(request({...base, fetch:async () => {throw cancelled;}}), error => error === cancelled);
    console.log('Chat request payload, cancellation and fallback policy passed');
})().catch(error => {console.error(error); process.exitCode=1;});
