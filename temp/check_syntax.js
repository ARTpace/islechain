const fs = require('fs');
const html = fs.readFileSync('H:\\AI-Tools\\art-canvas\\static\\app\\gaoqingxiufu.html', 'utf8');
// Extract all script blocks (not src ones)
const re = /<script>([\s\S]*?)<\/script>/g;
let m, idx = 0;
while ((m = re.exec(html)) !== null) {
    const js = m[1];
    try {
        new Function(js);
        console.log(`Block ${idx}: OK`);
    } catch(e) {
        console.log(`Block ${idx}: ERROR - ${e.message}`);
        // find line number
        const lines = js.split('\n');
        const charPos = parseInt(e.message.match(/position (\d+)/)?.[1] || '0');
        let pos = 0;
        for (let i = 0; i < lines.length; i++) {
            pos += lines[i].length + 1;
            if (pos >= charPos) {
                console.log(`  At line ${i+1}: ${lines[i].trim().substring(0,80)}`);
                break;
            }
        }
    }
    idx++;
}
