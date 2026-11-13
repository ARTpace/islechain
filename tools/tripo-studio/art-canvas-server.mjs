import {createServer} from 'node:http'
import {readFileSync} from 'node:fs'
import {createHandler} from './plugin/server/routes.js'
const token=process.env.ART_CANVAS_TRIPO_TOKEN
if(!token)throw new Error('Missing host token')
const handler=createHandler({directory:process.env.TRIPO_STUDIO_DATA_DIR,manageStorage:true,site:'cn'})
const html=readFileSync(new URL('./web/index.html',import.meta.url))
const script=readFileSync(new URL('./web/app.js',import.meta.url))
// Only dependency-free shared contracts are exposed to the unified 3D page.
const sharedModules=new Set(['contracts.js','prompt-policy.js','image-models.js','site.js','local-api.js','credit-estimate.js','model-pricing.js'])
const server=createServer((req,res)=>{
 if(req.headers['x-art-canvas-tripo']!==token){res.writeHead(403);return res.end()}
 delete req.headers['x-art-canvas-tripo']
 const shared=req.url.match(/^\/tripo-studio\/shared\/([a-z-]+\.js)$/)
 if(shared&&sharedModules.has(shared[1])&&['GET','HEAD'].includes(req.method)){
  res.setHeader('content-type','text/javascript; charset=utf-8');res.setHeader('cache-control','no-cache')
  return res.end(req.method==='HEAD'?'':readFileSync(new URL('./plugin/shared/'+shared[1],import.meta.url)))
 }
 if(req.url==='/tripo-studio/'||req.url==='/tripo-studio/app.js'){
  res.setHeader('content-type',req.url.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8')
  res.setHeader('cache-control','no-cache');return res.end(req.url.endsWith('.js')?script:html)
 }
 return handler(req,res)
})
server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({port:server.address().port})+'\n'))
// The host owns this process; a closed stdin also handles abrupt host termination.
process.stdin.resume();process.stdin.on('end',()=>server.close(()=>process.exit(0)))

const hostPid=process.ppid
setInterval(()=>{try{process.kill(hostPid,0)}catch{process.exit(0)}},5000).unref()
