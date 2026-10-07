import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist'),port=Number(process.env.SHISHI_PAGES_PORT||14321);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp'};
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:'+port);if(!url.pathname.startsWith('/shishi/')){res.writeHead(404);return res.end('Use /shishi/');}
 let relative;try{relative=decodeURIComponent(url.pathname.slice('/shishi/'.length))||'index.html';}catch{res.writeHead(400);return res.end();}
 const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('Not found');}
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log('Pages preview: http://127.0.0.1:'+port+'/shishi/'));
