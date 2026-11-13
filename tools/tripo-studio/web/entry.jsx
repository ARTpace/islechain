import React from '../plugin/node_modules/react/index.js'
import {createRoot} from '../plugin/node_modules/react-dom/client.js'
import {apply} from '../plugin/client-src/main.jsx'
const entries=[]
const ctx={slots:{register:(options,component)=>{entries.push({options,component});return()=>{}},inject:(_slot,factory)=>factory()},locale:{register:()=>()=>{}},effect:fn=>fn(),logger:console}
apply(ctx)
const panel=entries.find(entry=>entry.options.name==='main')
createRoot(document.getElementById('root')).render(React.createElement(panel.component))
