const vm = require('vm');
const fs = require('fs');
const html = fs.readFileSync('H:\\AI-Tools\\art-canvas\\static\\app\\gaoqingxiufu.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log('no script'); process.exit(1); }
const code = m[1];
const lines = code.split('\n');
try {
    new vm.Script(code, { filename: 'gaoqingxiufu.html' });
    console.log('OK');
} catch(e) {
    const lm = e.stack.match(/gaoqingxiufu\.html:(\d+)/);
    const errLine = lm ? parseInt(lm[1]) : 0;
    console.log('ERROR at line ' + errLine + ' - ' + e.message.substring(0, 150));
    if (errLine > 0) {
        for (let i = Math.max(0, errLine - 4); i < Math.min(lines.length, errLine + 3); i++) {
            console.log('  ' + (i + 1) + ': ' + lines[i].substring(0, 120));
        }
    }
}
