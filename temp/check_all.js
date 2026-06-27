const fs = require('fs');
const path = require('path');
const dir = 'H:\\AI-Tools\\art-canvas\\static\\app';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
for (const file of files) {
    const html = fs.readFileSync(path.join(dir, file), 'utf8');
    const re = /<script>([\s\S]*?)<\/script>/g;
    let m, idx = 0;
    while ((m = re.exec(html)) !== null) {
        const js = m[1];
        try {
            new Function(js);
        } catch(e) {
            console.log(`${file} Block${idx}: ERROR - ${e.message.substring(0,120)}`);
            const lines = js.split('\n');
            const charPos = parseInt(e.message.match(/position (\d+)/)?.[1] || '0');
            let pos = 0;
            for (let i = 0; i < lines.length; i++) {
                pos += lines[i].length + 1;
                if (pos >= charPos) {
                    console.log(`  Line ${i+1}: ${lines[i].trim().substring(0,100)}`);
                    break;
                }
            }
        }
        idx++;
    }
}
console.log('Done.');
