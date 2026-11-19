const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function node(tag){return {tag,children:[],dataset:{},scrollTop:0,scrollLeft:0,
    get firstChild(){return this.children[0];},
    append(...nodes){this.children.push(...nodes);},appendChild(child){this.children.push(child);},
    replaceChildren(...nodes){this.children=nodes;this.innerHTML='';},
    setAttribute(key,value){this[key]=value;},addEventListener(){},
    querySelectorAll(){return this.children.filter(n=>n.className==='chat-text-box').map(n=>n.children[1]);}};}
const context={window:{},document:{createElement:node,createTextNode:text=>({textContent:text}),head:node('head'),body:{classList:{contains:()=>false}},documentElement:{dataset:{}}},getComputedStyle:()=>({colorScheme:'light'}),navigator:{clipboard:{writeText:async text=>{context.copied=text;}}}};
vm.createContext(context);
for(const file of ['static/vendor/content-preview/highlight.min.js','static/vendor/content-preview/js-yaml.min.js','static/vendor/content-preview/katex.min.js','static/js/canvas-agent-markdown.js','static/modules/content-preview.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
Object.assign(context.window,{hljs:context.hljs,jsyaml:context.jsyaml,katex:context.katex});
const api=context.window.StudioContentPreview;
assert.deepEqual(JSON.parse(JSON.stringify(api.parseCsv('name,count,note\r\na,2,"one,two"\r\nb,1,"a""b\nline"'))),[['name','count','note'],['a','2','one,two'],['b','1','a"b\nline']]);
assert.deepEqual(JSON.parse(JSON.stringify(api.parseCsv('a\tb\n1\t2','\t'))),[['a','b'],['1','2']]);
assert.match(context.hljs.highlight('def greet(name):\n    return "hi"',{language:'python'}).value,/hljs-keyword/);
assert.equal(context.jsyaml.load('name: room\nitems: [table, vase]').items.length,2);
assert.match(context.katex.renderToString('\\frac{1}{3}',{trust:false}),/katex/);
const html=api.isolatedDocument('<script>parent.alert(1)</script><b>test</b>',true);
assert.match(html,/script-src &#39;none&#39;/);assert.match(html,/default-src &#39;none&#39;/);
assert.match(html,/base-uri &#39;none&#39;/);assert.match(html,/color-scheme:dark/);
async function run(){
    const prose=node('div');
    api.render(prose,'### 判断标准\n\n**网络配置**\n\n| 配置 | 可访问 |\n| --- | --- |\n| `0.0.0.0` | 是 |\n\n<script>alert(1)</script>');
    assert.equal(prose.children[0].className,'chat-markdown');
    assert.match(prose.children[0].innerHTML,/<h5>判断标准<\/h5>/);
    assert.match(prose.children[0].innerHTML,/<strong>网络配置<\/strong>/);
    assert.match(prose.children[0].innerHTML,/<table>/);
    assert.match(prose.children[0].innerHTML,/<code>0.0.0.0<\/code>/);
    assert(!prose.children[0].innerHTML.includes('<script>'));
    for(const kind of ['html','svg']){
        const host=node('div');api.render(host,'<b>safe preview</b>',{language:kind});
        const frame=host.children[0].children[1].children[0];
        assert.equal(frame.tag,'iframe');assert.equal(frame.sandbox,'');assert.equal(frame.referrerpolicy,'no-referrer');
    }
    const host=node('div');api.render(host,'name,count\npig,2',{language:'csv',title:'List'});
    assert.equal(host.children[0].children[0].children[0].textContent,'List');
    assert.equal(host.children[0].children[1].children[0].tag,'table');
    const actions=host.children[0].children[0].children[1];actions.children[0].onclick();
    assert.equal(host.children[0].children[1].children[0].tag,'pre');
    await actions.children[1].onclick();assert.equal(context.copied,'name,count\npig,2');
    const diff=node('div');api.render(diff,'- old\n+ new',{language:'diff'});
    const lines=diff.children[0].children[1].children[0].children[0].children;
    assert.match(lines[0].className,/studio-diff-remove/);assert.match(lines[1].className,/studio-diff-add/);
    const yaml=node('div');api.render(yaml,'name: room',{language:'yaml'});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(yaml.children[0].children[1].children[0].className,'chat-json-root');
    const unknown=node('div');api.render(unknown,'<script>bad()</script>',{language:'unknown-language'});
    assert.equal(unknown.children[0].children[1].children[0].children[0].children[0].textContent,'<script>bad()</script>');
    const css=fs.readFileSync('static/vendor/content-preview/katex.min.css','utf8');
    for(const match of css.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g))assert(fs.existsSync('static/vendor/content-preview/'+match[1]));
    console.log('Shared preview: isolated documents, CSV/TSV, YAML, diff, code highlighting, math assets, source toggle and copy OK');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
