import fs from 'node:fs';
// Keep provider validation and pause/cancel semantics shared with the local app.
export function browserShared(){
 const provider=fs.readFileSync(new URL('../deepseek.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/,'const inferDate=()=>({dueAt:null});\n').replace(/export /g,'');
 const jobs=fs.readFileSync(new URL('../ai-jobs.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/,'').replace(/export /g,'').replace("randomBytes(16).toString('hex')",'crypto.randomUUID()');
 return '(() => {\n'+provider+'\n'+jobs+'\nwindow.ShishiProvider={extractDeepSeek,testDeepSeek,DEFAULT_MODEL,MODELS,createAIJobs};\n})();';
}
