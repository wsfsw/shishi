import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {extractDocumentDeepSeek} from './deepseek.mjs';
import {idFor} from './extract.mjs';

export const FILE_TYPES=['.pdf','.docx','.xlsx','.txt','.md','.csv','.png','.jpg','.jpeg'];
export const MAX_FILE_BYTES=10*1024*1024;
const root=path.dirname(fileURLToPath(import.meta.url));

export function uploadedFile(input){
 if(typeof input?.name!=='string'||!input.name.trim()||input.name.length>160||/[\\/\x00-\x1f]/.test(input.name))throw new Error('文件名称不正确');
 const name=input.name.trim(),extension=path.extname(name).toLowerCase();
 if(!FILE_TYPES.includes(extension))throw new Error('请选择 PDF、DOCX、XLSX、TXT、MD、CSV、PNG 或 JPG 文件');
 if(typeof input.content!=='string'||!input.content.length||input.content.length%4||input.content.length>Math.ceil(MAX_FILE_BYTES/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.content))throw new Error('文件内容不正确或超过 10MB');
 const buffer=Buffer.from(input.content,'base64');if(!buffer.length||buffer.length>MAX_FILE_BYTES)throw new Error('单个文件不能超过 10MB');
 return {name,extension,content:input.content,size:buffer.length,id:createHash('sha256').update(buffer).digest('hex')};
}

export async function readDocument(file,{signal}={}){
 signal?.throwIfAborted();
 const python=process.env.SHISHI_PYTHON||path.join(root,'.wechat-venv','Scripts','python.exe');
 if(!fs.existsSync(python))throw new Error('文档读取组件未就绪，请检查项目 Python 环境');
 return new Promise((resolve,reject)=>{
  const child=spawn(python,['-X','utf8',path.join(root,'scripts','read_document.py')],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',settled=false;
  const finish=(error,text)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(text);};
  const abort=()=>{child.kill();finish(signal.reason);};
  const timer=setTimeout(()=>{child.kill();finish(new Error('文件解析超过 30 秒，请拆分或另存为文本后重试'));},30000);
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{output+=data;if(output.length>1_500_000){child.kill();finish(new Error('文件文字过多，请拆分后重试'));}});
  child.stderr.resume();child.on('error',()=>finish(new Error('无法启动文档读取组件')));
  child.on('close',code=>{if(settled)return;try{const result=JSON.parse(output);if(code!==0||result.error)throw new Error(result.error||'文件读取失败');if(typeof result.text!=='string'||!result.text.trim())throw new Error('文件中没有可整理的文字');finish(null,result.text);}catch(error){finish(new Error(error instanceof SyntaxError?'文件解析失败，请另存为普通文档':error.message));}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({extension:file.extension,content:file.content}));
 });
}

export function documentSources(text,file){
 const chunks=[];let rest=text;
 while(rest.length){let end=Math.min(16000,rest.length);if(end<rest.length){const newline=rest.lastIndexOf('\n',end);if(newline>end/2)end=newline+1;}chunks.push(rest.slice(0,end));rest=rest.slice(end);}
 return chunks.map((text,index)=>({id:idFor('file',file.id,String(index)),sender:`${['.png','.jpg','.jpeg'].includes(file.extension)?'图片识别文字':'文件原文'} · 第 ${index+1} 段`,text,sentAt:null}));
}

export async function organizeFile(store,file,{referenceDate,remindMinutes=15},aiOptions){
 if(typeof referenceDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)||!Number.isFinite(Date.parse(referenceDate))||new Date(referenceDate).toISOString().slice(0,10)!==referenceDate)throw new Error('请填写有效的文件日期参考');
 if(!Number.isInteger(remindMinutes)||remindMinutes<0||remindMinutes>10080)throw new Error('提醒间隔不正确');
 const previous=store.db.prepare('SELECT * FROM file_imports WHERE id=?').get(file.id);
 if(previous){await aiOptions.beforeCommit?.();return {ok:true,duplicate:true,added:0,scheduled:0,inbox:0,taskIds:JSON.parse(previous.task_ids),name:previous.name,message:'这个文件已经整理过；保留已有事项和你的修改'};}
 aiOptions.onProgress?.('正在读取文件文字…');
 const text=await readDocument(file,aiOptions),messages=documentSources(text,file);
 aiOptions.onProgress?.('DeepSeek 正在提取事项和日期…');
 const result=await extractDocumentDeepSeek(messages,{...aiOptions,name:file.name,referenceDate});
 const group=`文件 · ${file.name}`;
 await aiOptions.beforeCommit?.();aiOptions.signal?.throwIfAborted();
 const concurrent=store.db.prepare('SELECT * FROM file_imports WHERE id=?').get(file.id);
 if(concurrent)return {ok:true,duplicate:true,added:0,scheduled:0,inbox:0,taskIds:JSON.parse(concurrent.task_ids),name:concurrent.name,message:'这个文件已经整理过；保留已有事项和你的修改'};
 store.ingest({group,messages,...result},{file:{id:file.id,name:file.name,referenceDate,textChars:text.length,remindMinutes}});
 const record=store.db.prepare('SELECT * FROM file_imports WHERE id=?').get(file.id),tasks=JSON.parse(record.task_ids).map(id=>store.getTask(id));
 const scheduled=tasks.filter(t=>t.status==='pending').length,inbox=tasks.filter(t=>t.status==='inbox').length;
 return {ok:true,name:file.name,added:tasks.length,scheduled,inbox,taskIds:tasks.map(t=>t.id),textChars:text.length,message:`已加入日历 ${scheduled} 项，${inbox} 项日期待确认`};
}
