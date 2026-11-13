import {build} from './plugin/node_modules/esbuild/lib/main.js'
await build({entryPoints:[new URL('./web/entry.jsx',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')],outfile:new URL('./web/app.js',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),bundle:true,minify:true,platform:'browser',target:'chrome120',define:{'process.env.NODE_ENV':'"production"'},legalComments:'eof'})
