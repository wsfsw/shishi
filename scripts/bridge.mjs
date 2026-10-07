import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {idFor} from '../extract.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const token=fs.readFileSync(path.join(root,'data','agent-token'),'utf8').trim();
const action=process.argv[2]||'context';const endpoints={context:'/api/bridge/context',discover:'/api/bridge/discover',status:'/api/bridge/status',ingest:'/api/import'};
if(!endpoints[action])throw new Error('只支持 context、discover、status、ingest');
let payload;const filename=process.argv[process.argv.indexOf('--file')+1];if(action!=='context'){if(!process.argv.includes('--file')||!filename)throw new Error('写入需要 --file 指向 UTF-8 JSON 文件');payload=JSON.parse(fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,''));if(action==='ingest'){payload.messages=payload.messages.map(m=>({...m,id:m.id||idFor(payload.group,m.sender||'',m.sentAt||'',m.text)}));}}
const response=await fetch('http://127.0.0.1:4317'+endpoints[action],{method:action==='context'?'GET':'POST',headers:{'X-Agent-Token':token,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});const result=await response.json();if(!response.ok)throw new Error(result.error);console.log(JSON.stringify(result,null,2));
