import fs from 'node:fs';
// Keep provider validation and pause/cancel semantics shared with the local app.
export function browserShared(){
 const provider=fs.readFileSync(new URL('../deepseek.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/,'const inferDate=()=>({dueAt:null});\n').replace(/export /g,'');
 const jobs=fs.readFileSync(new URL('../ai-jobs.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/,'').replace(/export /g,'').replace("randomBytes(16).toString('hex')",'crypto.randomUUID()');
 return '(() => {\n'+provider+'\n'+jobs+'\nwindow.ShishiProvider={extractDeepSeek,testDeepSeek,requestDeepSeekJSON,DEFAULT_MODEL,MODELS,createAIJobs};\n})();';
}
export function browserPlanner(){
 const tools=fs.readFileSync(new URL('../task-tools.mjs',import.meta.url),'utf8').replace(/export /g,'');
 const backup=fs.readFileSync(new URL('../backup.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
 const store=fs.readFileSync(new URL('../store.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function createStore(path)','function createStore(db)').replace('const db=new DatabaseSync(path);','');
 const planner=fs.readFileSync(new URL('../planning.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
 return `(() => {
 const randomBytes=()=>({toString:()=>crypto.randomUUID()});
 // Fingerprints detect stale calendar previews; they are not authentication tokens.
 const createHash=()=>({update(value){this.value=value;return this},digest(){return this.value}});
 const {requestDeepSeekJSON}=window.ShishiProvider;
 function uploadedFile(file){if(!file||typeof file.name!=='string'||! /\\.(txt|md|csv)$/i.test(file.name)||typeof file.content!=='string'||file.content.length>1500000)throw new Error('网页资料支持 TXT、MD、CSV（1MB 内）；其他格式请使用桌面版');return {...file,id:crypto.randomUUID()};}
 async function readDocument(file){const value=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(file.content),c=>c.charCodeAt(0)));if(value.length>60000)throw new Error('资料超过 60000 字，请分批填写');return value;}
 function documentSources(value,file){const result=[];for(let i=0;i<value.length;i+=20000)result.push({id:crypto.randomUUID(),sender:file.name,text:value.slice(i,i+20000),sentAt:null});return result;}
 ${tools}\nconst idFor=stableBrowserId;\n${store}\n${planner}\n${backup}
 window.ShishiPlannerCore={createStore,createPlanner,exportBackup,previewBackup,importBackup,validateTaskFields,taskDetails,stableBrowserId};})();`;
}
