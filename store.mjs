import { DatabaseSync } from 'node:sqlite';
import { idFor } from './extract.mjs';
import {taskDetails,validateTaskFields,nextOccurrence,extractionIdentity,validTaskDue} from './task-tools.mjs';
export function createStore(path){
 const db=new DatabaseSync(path);db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,enabled INTEGER DEFAULT 1);
 CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,group_name TEXT NOT NULL,sender TEXT NOT NULL,text TEXT NOT NULL,sent_at TEXT,captured_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,group_name TEXT, status TEXT NOT NULL,priority TEXT NOT NULL,due_at TEXT,precision TEXT NOT NULL,audience TEXT NOT NULL,reason TEXT NOT NULL,source_ids TEXT NOT NULL,remind_minutes INTEGER DEFAULT 15,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS summaries(id TEXT PRIMARY KEY,group_name TEXT NOT NULL,category TEXT NOT NULL,text TEXT NOT NULL,source_ids TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,scheduled_at TEXT NOT NULL,created_at TEXT NOT NULL,read INTEGER DEFAULT 0,desktop_status TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS snoozes(task_id TEXT PRIMARY KEY,scheduled_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS task_trash(task_id TEXT PRIMARY KEY,previous_status TEXT NOT NULL,deleted_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS file_imports(id TEXT PRIMARY KEY,name TEXT NOT NULL,reference_date TEXT NOT NULL,text_chars INTEGER NOT NULL,task_ids TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS task_details(task_id TEXT PRIMARY KEY,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS extraction_keys(signature TEXT PRIMARY KEY,task_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ingestion_runs(id TEXT PRIMARY KEY,body TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS tasks_due ON tasks(status,due_at);`);
 const setting=(key,fallback)=>{const row=db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(row.value):fallback;};
 const setSetting=(key,value)=>db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
 const details=id=>taskDetails(JSON.parse(db.prepare('SELECT body FROM task_details WHERE task_id=?').get(id)?.body||'{}'));
 const setDetails=(id,value)=>db.prepare('INSERT INTO task_details VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET body=excluded.body').run(id,JSON.stringify(value));
 const task=row=>row?{id:row.id,title:row.title,category:row.category,group:row.group_name,status:row.status,priority:row.priority,dueAt:row.due_at,precision:row.precision,audience:row.audience,reason:row.reason,sourceIds:JSON.parse(row.source_ids),remindMinutes:row.remind_minutes,createdAt:row.created_at,updatedAt:row.updated_at,...details(row.id),...(row.status==='deleted'?{deletedFromStatus:db.prepare('SELECT previous_status FROM task_trash WHERE task_id=?').get(row.id)?.previous_status||'inbox'}:{})}:null;
 function addTask(input){const now=new Date().toISOString();const id=input.id||idFor(input.group||'',...(input.sourceIds||[]),input.title);const status=input.status||'inbox',d=taskDetails(input);if(d.repeat!=='none'&&!input.dueAt)throw new Error('重复事务需要安排日期');const result=db.prepare('INSERT OR IGNORE INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.title,input.category||'其他',input.group||null,status,input.priority||'normal',input.dueAt||null,input.precision||'uncertain',input.audience||'me',input.reason||'',JSON.stringify(input.sourceIds||[]),input.remindMinutes??15,now,now);if(result.changes)setDetails(id,d);return {id,inserted:Number(result.changes)>0};}
 function updateTask(input){const old=task(db.prepare('SELECT * FROM tasks WHERE id=?').get(input.id));if(!old||old.status==='deleted')throw new Error('事务不存在或已在回收站，请先恢复');const fields=validateTaskFields(input),d=taskDetails(input,old);if(d.repeat!=='none'&&!fields.dueAt)throw new Error('重复事务需要安排日期');db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE tasks SET title=?,category=?,status=?,priority=?,due_at=?,precision=?,remind_minutes=?,reason=?,updated_at=? WHERE id=?').run(fields.title,fields.category,fields.status,fields.priority,fields.dueAt,fields.precision,fields.remindMinutes,fields.reason,new Date().toISOString(),input.id);setDetails(input.id,d);if(old.status!=='done'&&fields.status==='done')repeatNext(input.id);db.exec('COMMIT');return {ok:true,id:input.id};}catch(e){db.exec('ROLLBACK');throw e;}}
 function repeatNext(id){const t=task(db.prepare('SELECT * FROM tasks WHERE id=?').get(id));if(!t||t.repeat==='none'||!t.dueAt)return;const series=t.repeatSeriesId||t.id,anchor=t.repeatAnchor||t.dueAt,dueAt=nextOccurrence(t.dueAt,t.repeat,anchor);return addTask({...t,id:idFor('repeat',series,dueAt),status:'pending',dueAt,deadlineAt:null,repeatSeriesId:series,repeatAnchor:anchor,checklist:t.checklist.map(c=>({...c,done:false}))});}
 function setStatus(id,status){return batchTasks([id],status);}
 function recordRun(run){const now=new Date().toISOString();db.prepare('INSERT INTO ingestion_runs VALUES(?,?,?)').run(idFor('run',now,Math.random()),JSON.stringify(run),now);return run;}
 function ingest(input,options={}){let added=0,duplicates=0,others=0,changedDates=0;const taskIds=[];db.exec('BEGIN IMMEDIATE');try{if(options.file&&db.prepare('SELECT 1 FROM file_imports WHERE id=?').get(options.file.id)){db.exec('COMMIT');return 0;}const ids=new Set();
 const previousTasks=db.prepare('SELECT * FROM tasks WHERE group_name=?').all(input.group).map(task);
 for(const old of previousTasks)db.prepare('INSERT OR IGNORE INTO extraction_keys VALUES(?,?)').run(extractionIdentity(input.group,old),old.id);
 for(const m of input.messages){const id=m.id||idFor(input.group,m.sender||'',m.sentAt||'',m.text);const existing=db.prepare('SELECT group_name,text FROM messages WHERE id=?').get(id);if(existing&&(existing.group_name!==input.group||existing.text!==m.text))throw new Error('原始消息 ID 与已保存来源不一致');ids.add(id);db.prepare('INSERT OR IGNORE INTO messages VALUES (?,?,?,?,?,?)').run(id,input.group,m.sender||'未识别',m.text,m.sentAt||null,m.capturedAt||new Date().toISOString());}
 const validSources=list=>Array.isArray(list)&&list.length>0&&list.every(id=>ids.has(id));
 for(const t of input.tasks||[]){if(!validSources(t.sourceIds))throw new Error('待办必须关联本次读取的原始消息');if(t.audience==='others'){others++;continue;}const signature=extractionIdentity(input.group,t);if(db.prepare('SELECT 1 FROM extraction_keys WHERE signature=?').get(signature)){duplicates++;continue;}
 const changed=previousTasks.some(old=>old.title===t.title&&old.dueAt!==t.dueAt&&old.sourceIds.some(id=>t.sourceIds.includes(id)));if(changed)changedDates++;
 const status=!changed&&options.file&&t.dueAt&&['date','minute'].includes(t.precision)?'pending':'inbox';const result=addTask({...t,id:idFor('extracted',signature),group:input.group,status,...(changed?{audience:'unclear',reason:'同一来源已有同名事务，日期发生变化，请核对后安排。 '+(t.reason||'')}:{}) ,...(options.file?{remindMinutes:options.file.remindMinutes}:{})});db.prepare('INSERT OR IGNORE INTO extraction_keys VALUES(?,?)').run(signature,result.id);if(result.inserted){added++;taskIds.push(result.id);}else duplicates++;}
 for(const s of input.summaries||[]){if(!validSources(s.sourceIds))throw new Error('摘要必须关联原始消息');const old=db.prepare('SELECT text,category,source_ids FROM summaries WHERE group_name=?').all(input.group);if(old.some(r=>extractionIdentity(input.group,{text:r.text,category:r.category,sourceIds:JSON.parse(r.source_ids)})===extractionIdentity(input.group,s)))continue;const id=idFor(input.group,s.category,...s.sourceIds,s.text);db.prepare('INSERT OR IGNORE INTO summaries VALUES(?,?,?,?,?,?)').run(id,input.group,s.category||'其他',s.text,JSON.stringify(s.sourceIds),new Date().toISOString());}
 if(options.file){const f=options.file;db.prepare('INSERT INTO file_imports VALUES(?,?,?,?,?,?)').run(f.id,f.name,f.referenceDate,f.textChars,JSON.stringify(taskIds),new Date().toISOString());}
 recordRun({source:input.group,messages:input.messages.length,candidates:(input.tasks||[]).length,added,duplicates,others,changedDates,state:'completed',reason:added?'已新增事务，请在事务箱核对':duplicates?'相同事项已存在，保留已有修改':others?'事项指向其他人，未加入个人事务箱':'本批消息没有可执行事项'});
 db.exec('COMMIT');return added;}catch(e){db.exec('ROLLBACK');throw e;}}
 function batchTasks(ids,action,options={}){
  if(!Array.isArray(ids)||!ids.length||ids.length>5000||ids.some(id=>typeof id!=='string'||!id||id.length>200)||!['done','dismissed','inbox','delete','restore','reschedule','classify'].includes(action))throw new Error('请选择有效事务和批量操作（每次最多 5000 条）');
  if(action==='reschedule'&&(!options.dueAt||!validTaskDue(options.dueAt)))throw new Error('请选择有效的安排日期和时间');
  const unique=[...new Set(ids)],now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
  try{
   const rows=unique.map(id=>db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
   if(rows.some(row=>!row))throw new Error('部分事务已不存在，请刷新后重新选择');
   if(rows.some(row=>action==='restore'?row.status!=='deleted':action!=='delete'&&row.status==='deleted'))throw new Error('事务状态已改变，请刷新后重新选择');
   let changed=0;
   for(const row of rows){
    if(action==='delete'&&row.status==='deleted')continue;
    if(action==='reschedule'||action==='classify'){
     if(!['inbox','pending'].includes(row.status))throw new Error('仅待确认或已安排事务可批量改期和分类');
     if(action==='reschedule'){const dueAt=options.dueAt;db.prepare('UPDATE tasks SET due_at=?,precision=?,status=?,updated_at=? WHERE id=?').run(dueAt,dueAt.length===10?'date':'minute','pending',now,row.id);}
     else{const d=taskDetails(options,details(row.id));if(options.category){validateTaskFields({title:row.title,category:options.category});db.prepare('UPDATE tasks SET category=?,updated_at=? WHERE id=?').run(options.category,now,row.id);}setDetails(row.id,d);db.prepare('UPDATE tasks SET updated_at=? WHERE id=?').run(now,row.id);}
     changed++;continue;
    }
    const status=action==='delete'?'deleted':action==='restore'?(db.prepare('SELECT previous_status FROM task_trash WHERE task_id=?').get(row.id)?.previous_status||'inbox'):action;
    if(!['inbox','pending','done','dismissed','deleted'].includes(status))throw new Error('恢复状态不正确');
    if(action==='delete')db.prepare('INSERT INTO task_trash VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET previous_status=excluded.previous_status,deleted_at=excluded.deleted_at').run(row.id,row.status,now);
    if(action==='restore')db.prepare('DELETE FROM task_trash WHERE task_id=?').run(row.id);
    db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run(status,now,row.id);if(status==='done'&&row.status!=='done'&&action!=='restore')repeatNext(row.id);changed++;
   }
   db.exec('COMMIT');return {ok:true,count:changed,ids:unique};
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {db,setting,setSetting,addTask,updateTask,setStatus,ingest,task,batchTasks,recordRun,repeatNext,listRuns:()=>db.prepare('SELECT * FROM ingestion_runs ORDER BY created_at DESC,rowid DESC LIMIT 30').all().map(r=>({id:r.id,...JSON.parse(r.body),createdAt:r.created_at})),listTasks:()=>db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all().map(task),getTask:id=>task(db.prepare('SELECT * FROM tasks WHERE id=?').get(id))};
}
