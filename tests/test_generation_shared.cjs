// 公共化后保持图片归档、失败回退、上传事件与页面脚本可用。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const savePages = ['2dstyle','angle','cgstyle','gaoqingxiufu','klein','kuotu','promptgen','textmatting','watermark-removal','yichuwuti','zimage'];
const uploadPages = ['2dstyle','cgstyle','gaoqingxiufu','kuotu','rmbg','textmatting'];
const stylePages = [...new Set([...uploadPages, 'promptgen', 'watermark-removal', 'yichuwuti'])];
const shared = read('static/modules/comfyui-utils.js');
const requests = [];
let response = {ok:true, json:async () => ({url:'/output/test.png'})};
const context = vm.createContext({
    window:{location:{origin:'http://localhost:7000'}}, URL, encodeURIComponent,
    localStorage:{getItem:key => key === 'xy_auth_token' ? 'test & token' : null},
    console:{warn(){}}, fetch:async url => { requests.push(url); if (response instanceof Error) throw response; return response; },
});
vm.runInContext(shared, context);

function target() {
    const events = {};
    const classes = new Set();
    return {events, classes, addEventListener:(name,fn) => {assert.ok(!events[name]); events[name]=fn;},
        classList:{add:name => classes.add(name), remove:name => classes.delete(name)}, click(){this.clicked=true;}};
}

(async () => {
    const original = '/api/comfyui/view?filename=a%20b.png&subfolder=test&type=temp';
    const save = context.window.ComfyOutput.save;
    assert.equal(await save(original,'图片编辑'), '/output/test.png');
    let query = new URL(requests.at(-1), 'http://localhost').searchParams;
    assert.equal(query.get('filename'), 'a b.png');
    assert.equal(query.get('subfolder'), 'test');
    assert.equal(query.get('type'), 'temp');
    assert.equal(query.get('feature'), '图片编辑');
    assert.equal(query.has('token'), false);
    await save(original,'去水印',true);
    query = new URL(requests.at(-1),'http://localhost').searchParams;
    assert.equal(query.get('token'),'test & token');
    for (const fallback of [{ok:false}, {ok:true,json:async()=>({})}, new Error('网络错误'), {ok:true,json:async()=>{throw new Error('响应错误');}}]) {
        response=fallback;
        assert.equal(await save(original,'图片编辑'),original);
    }
    const before=requests.length;
    assert.equal(await save('/output/already.png','图片编辑'),'/output/already.png');
    assert.equal(requests.length,before);

    const doc=target(), zone=target(), input=target(), files=[];
    const uploadContext=vm.createContext({window:{},document:doc});
    vm.runInContext(read('static/modules/upload-zone.js'),uploadContext);
    uploadContext.window.UploadZone.bind(zone,input,file=>files.push(file));
    zone.events.click(); assert.equal(input.clicked,true);
    let prevented=0;
    const preventDefault=()=>prevented++;
    zone.events.dragover({preventDefault}); assert.equal(zone.classes.has('dragover'),true);
    zone.events.dragleave(); assert.equal(zone.classes.has('dragover'),false);
    const image={type:'image/png'};
    zone.events.drop({preventDefault,dataTransfer:{files:[image,{type:'image/jpeg'}]}});
    input.events.change({target:{files:[image]}});
    input.events.change({target:{files:[]}});
    doc.events.paste({preventDefault,clipboardData:{items:[{type:'text/plain'},{type:'image/png',getAsFile:()=>null},{type:'image/png',getAsFile:()=>image}]}});
    doc.events.paste({preventDefault});
    assert.equal(files.length,3); assert.ok(files.every(file=>file===image));
    assert.equal(prevented,3);

    for (const name of new Set([...savePages,...stylePages])) {
        const page=read(`static/app/${name}.html`);
        for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
            if (!/\bsrc=|application\/(?:ld\+)?json/i.test(match[1])) new vm.Script(match[2], {filename:name});
        }
        if (savePages.includes(name)) {
            assert.match(page, /comfyui-utils\.js\?v=20261024008/);
            if (['watermark-removal','zimage'].includes(name)) assert.match(page,/return ComfyOutput\.save\([^;]+true\)/);
            else assert.doesNotMatch(page,/async function saveToUserOutput/);
        }
        if (uploadPages.includes(name)) {
            assert.match(page,/upload-zone\.js\?v=20261024008/);
            assert.match(page,/UploadZone.bind\(uploadZone, fileInput, handleFileUpload\)/);
            assert.ok(page.indexOf('upload-zone.js')<page.indexOf('UploadZone.bind'));
        }
        if (stylePages.includes(name)) assert.match(page,/generation-ui\.css\?v=20261024008/);
    }
    // 原页面的特殊尺寸、遮罩布局及缩小屏幕规则必须继续保留。
    assert.match(read('static/app/gaoqingxiufu.html'),/\.upload-zone\s*\{[^}]*min-height: 96px/);
    assert.match(read('static/app/yichuwuti.html'),/\.upload-zone\s*\{[^}]*position: absolute/);
    assert.match(read('static/app/2dstyle.html'),/\.upload-zone\s*\{[^}]*min-height: 200px/);
    console.log('公共生图组件：保存/令牌/失败回退、上传事件、页面脚本语法与专用布局检查通过');
})().catch(error=>{console.error(error);process.exitCode=1;});
