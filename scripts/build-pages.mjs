import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserShared,browserPlanner} from './browser-shared.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),output=path.join(root,'dist');
// Only this fixed generated directory is removed. No runtime data is read.
if(path.dirname(output)!==root||path.basename(output)!=='dist')throw new Error('Invalid output directory');
fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
function copy(directory,target){for(const item of fs.readdirSync(directory,{withFileTypes:true})){if(item.isSymbolicLink())throw new Error('Site sources must not contain symlinks');const source=path.join(directory,item.name),destination=path.join(target,item.name);if(item.isDirectory()){fs.mkdirSync(destination,{recursive:true});copy(source,destination);continue;}if(!/\.(?:html|css|js|svg|webp)$/.test(item.name))throw new Error('Unexpected site asset: '+item.name);if(/\.(?:html|css|js)$/.test(item.name)){let text=fs.readFileSync(source,'utf8').replaceAll('/assets/','./assets/');if(item.name==='index.html'){text=text.replace(/\b(src|href)="\/(?!api\/)([^"\s]*)"/g,'$1="./$2"').replace('</head>','<link rel="stylesheet" href="./pages.css"></head>').replace('<script src="./scenes.js"','<script src="./pages-runtime.js" defer></script><script src="./scenes.js"').replace('</body>','<script src="./pages-ui.js" defer></script></body>');}if(item.name==='app.js'){const marker='async function api(url, data){';if(!text.includes(marker))throw new Error('API adapter marker missing');text=text.replace(marker,marker+'if(window.ShishiPages)return window.ShishiPages.request(url,data);');}fs.writeFileSync(destination,text);}else fs.copyFileSync(source,destination);}}
copy(path.join(root,'public'),output);
for(const name of ['pages-runtime.js','pages-ai.js','pages-planner.js','pages-ui.js','pages.css'])fs.copyFileSync(path.join(root,'web',name),path.join(output,name));
fs.writeFileSync(path.join(output,'pages-provider.js'),browserShared());
fs.writeFileSync(path.join(output,'pages-planner-core.js'),browserPlanner());
for(const name of ['sql-wasm.js','sql-wasm.wasm'])fs.copyFileSync(path.join(root,'node_modules/sql.js/dist',name),path.join(output,name));
fs.copyFileSync(path.join(root,'node_modules/sql.js/LICENSE'),path.join(output,'sqljs-LICENSE.txt'));
const index=path.join(output,'index.html');
fs.writeFileSync(index,fs.readFileSync(index,'utf8').replace('<head>','<head><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'wasm-unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'self\' https://api.deepseek.com; object-src \'none\'; base-uri \'self\'; form-action \'none\'">').replace('<script src="./pages-runtime.js"','<script src="./pages-provider.js" defer></script><script src="./sql-wasm.js" defer></script><script src="./pages-planner-core.js" defer></script><script src="./pages-planner.js" defer></script><script src="./pages-ai.js" defer></script><script src="./pages-runtime.js"'));
fs.writeFileSync(path.join(output,'.nojekyll'),'');console.log('Static site built in dist/; runtime data and credentials were not read.');
