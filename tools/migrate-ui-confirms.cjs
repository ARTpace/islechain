// 将工具的原生 confirm 调用迁移到共享异步确认，保留原文件格式。
// 使用本机已有 TypeScript 解析器，不增加项目运行依赖。
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require(path.join(process.env.APPDATA, 'npm/node_modules/typescript'));
const changed = [], converted = [];
function walk(dir) { return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]); }
function migrate(source, file) {
    const tree = ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const calls = [], funcs = new Set(), named = new Set(), edits = [], awaited = new Set();
    const isFunction = node => ts.isFunctionLike(node) && node.body;
    const owner = node => { for(let p=node.parent;p;p=p.parent) if(isFunction(p)) return p; };
    const visit = node => { if(ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node,visit); };
    visit(tree);
    function mark(fn) {
        if(!fn) throw new Error(`Top-level confirmation requires review: ${file}`);
        if(funcs.has(fn)) return;
        funcs.add(fn);
        if(fn.name && ts.isIdentifier(fn.name)) named.add(fn.name.text);
        if(ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) named.add(fn.parent.name.text);
    }
    function awaitCall(call) {
        if(awaited.has(call) || ts.isAwaitExpression(call.parent)) return;
        awaited.add(call);
        edits.push([call.getStart(tree),call.getStart(tree),'(await '],[call.end,call.end,')']);
        mark(owner(call));
    }
    for(const call of calls) {
        const expr = call.expression;
        const native = ts.isIdentifier(expr) && expr.text === 'confirm' || ts.isPropertyAccessExpression(expr) && ['window','global'].includes(expr.expression.getText(tree)) && expr.name.text === 'confirm';
        if(!native || file.endsWith('canvas-list.js')) continue; // 该文件的 confirm 是局部“创建画布”函数。
        edits.push([expr.getStart(tree),expr.end,'window.StudioConfirm.ask']);
        awaitCall(call);
    }
    if(!edits.length) return source;
    // 同步返回布尔值的保护函数也必须传播 await，不能把 Promise 当成 true。
    let previous = -1;
    while(previous !== named.size) {
        previous = named.size;
        for(const call of calls) if(ts.isIdentifier(call.expression) && named.has(call.expression.text)) awaitCall(call);
    }
    for(const fn of funcs) {
        if(!fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) edits.push([fn.getStart(tree),fn.getStart(tree),'async ']);
        converted.push(`${file}: ${fn.name?.getText(tree) || (ts.isVariableDeclaration(fn.parent) ? fn.parent.name.getText(tree) : '(callback)')}`);
    }
    let output=source;
    for(const [start,end,text] of edits.sort((a,b)=>b[0]-a[0] || b[1]-a[1])) output=output.slice(0,start)+text+output.slice(end);
    if(!/^\s*(?:import\s|export\s)/m.test(output)) new vm.Script(output,{filename:file});
    return output;
}
for(const file of walk('static')) {
    if(!/\.(js|html)$/.test(file) || file.endsWith('.min.js') || file.endsWith('ui-confirm.js')) continue;
    const original=fs.readFileSync(file,'utf8');
    let output=original;
    if(file.endsWith('.html')) {
        output=output.replace(/(<script\b([^>]*)>)([\s\S]*?)(<\/script>)/g,(all,open,attrs,code,close)=> /\bsrc\s*=|application\/json/.test(attrs) ? all : open+migrate(code,file)+close);
        if(/<head(?:\s[^>]*)?>/i.test(output) && !output.includes('/static/js/ui-confirm.js')) output=output.replace(/<head(?:\s[^>]*)?>/i,head=>head+'\n<script src="/static/js/ui-confirm.js?v=20261119001"></script>');
    } else output=migrate(output,file);
    if(output!==original) { fs.writeFileSync(file,output); changed.push(file); }
}
// 源模块及实际使用的 bundle 一起更新引用版本，避免桌面 iframe 复用旧脚本。
const assets = new Set(walk('static').filter(file => file.endsWith('.js') && fs.readFileSync(file,'utf8').includes('window.StudioConfirm.ask')).map(file => '/' + file.replaceAll('\\','/')));
assets.add('/static/js/ui-confirm.js');
for(const file of walk('static').filter(file => /\.(html|js)$/.test(file) && !file.endsWith('.min.js'))) {
    const original=fs.readFileSync(file,'utf8');
    const updated=original.replace(/(\/static\/[a-zA-Z0-9_./-]+\.js)(\?[^\s"'<>`]*)?/g,(all,url,query='') => {
        if(!assets.has(url)) return all;
        return url + (query.includes('v=') ? query.replace(/([?&]v=)[^&]*/,'$120261119002') : (query ? query+'&' : '?')+'v=20261119002');
    });
    if(updated!==original) fs.writeFileSync(file,updated);
}
console.log('Updated:',changed.length,'files');
console.log(converted.join('\n'));
