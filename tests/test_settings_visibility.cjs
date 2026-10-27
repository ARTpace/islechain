// 设置内嵌页面必须覆盖主页面的 iframe 隐藏规则。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/modules/settings.js'), 'utf8');
for (const host of ['settings-detail', 'settings-panel']) {
    const rule = source.match(new RegExp(`#${host} iframe\\.settings-embedded\\s*\\{([^}]+)\\}`));
    assert.ok(rule, `${host} 缺少内嵌页面样式`);
    assert.match(rule[1], /visibility\s*:\s*visible\s*;/, `${host} 内嵌页面被全局样式隐藏`);
    assert.match(rule[1], /opacity\s*:\s*1\s*;/);
    assert.match(rule[1], /pointer-events\s*:\s*auto\s*;/);
}
console.log('设置内嵌页面可见性回归检查通过');
