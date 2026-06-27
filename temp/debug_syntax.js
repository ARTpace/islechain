const vm = require('vm');
const fs = require('fs');
const path = require('path');
const dir = 'H:\\AI-Tools\\art-canvas\\static\\app';

['kuotu.html', 'yichuwuti.html', 'textmatting.html', 'angle.html', 'promptgen.html'].forEach(f => {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!m) return;
    const code = m[1];
    const lines = code.split('\n');
    try {
        new vm.Script(code, { filename: f });
        console.log(f + ': OK');
    } catch(e) {
        // Extract line number from stack
        const stackLines = e.stack.split('\n');
        let errLine = 0;
        for (const sl of stackLines) {
            const match = sl.match(new RegExp(f.replace('.', '\\.') + ':(\\d+)'));
            if (match) { errLine = parseInt(match[1]); break; }
        }
        console.log(f + ': ERROR at line ' + errLine + ' - ' + e.message.substring(0, 100));
        if (errLine > 0) {
            for (let i = Math.max(0, errLine - 3); i < Math.min(lines.length, errLine + 2); i++) {
                console.log('  ' + (i + 1) + ': ' + lines[i].substring(0, 120));
            }
        }
    }
});
