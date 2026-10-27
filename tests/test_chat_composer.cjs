const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ctx = { window:{}, document:{ addEventListener(){}, getElementById(){ return null; } } };
vm.runInNewContext(fs.readFileSync('static/modules/chat-composer.js', 'utf8'), ctx);
const composer = ctx.window.ChatComposer;
for (const text of ['帮我描述下图片', '反推这张图的提示词', '提取图片提示词', 'describe this image']) assert.equal(composer.isDescription(text), true, text);
for (const text of ['画一只小猫', '把图片改成夜景', '根据这段描述修改图片左边的树', '你好']) assert.equal(composer.isDescription(text), false, text);
assert.match(composer.descriptionGuide(), /禁止输出 IMAGE/);
const reverse = fs.readFileSync('static/modules/reverse-image.js', 'utf8');
assert.match(reverse, /provider: 'vision'/);
assert.doesNotMatch(reverse, /data-act="provider" data-value="comfyui"/);
const html = fs.readFileSync('static/app/zimage.html', 'utf8');
assert.match(html, /const spec = descriptionOnly \? null : readImageSpec\(full\)/);
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/\bsrc\s*=/.test(m[1]) && !/type\s*=\s*["'](?:module|application\/json)/.test(m[1])) new Function(m[2]);
}
console.log('对话反推意图、API 限制与脚本语法检查通过');
