import { DatabaseSync } from 'node:sqlite';
import { idFor } from './extract.mjs';
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
 CREATE INDEX IF NOT EXISTS tasks_due ON tasks(status,due_at);`);
 const setting=(key,fallback)=>{const row=db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(row.value):fallback;};
 const setSetting=(key,value)=>db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
 const task=row=>row?{id:row.id,title:row.title,category:row.category,group:row.group_name,status:row.status,priority:row.priority,dueAt:row.due_at,precision:row.precision,audience:row.audience,reason:row.reason,sourceIds:JSON.parse(row.source_ids),remindMinutes:row.remind_minutes,createdAt:row.created_at,updatedAt:row.updated_at,...(row.status==='deleted'?{deletedFromStatus:db.prepare('SELECT previous_status FROM task_trash WHERE task_id=?').get(row.id)?.previous_status||'inbox'}:{})}:null;
 function addTask(input){const now=new Date().toISOString();const id=input.id||idFor(input.group||'',...(input.sourceIds||[]),input.title);const status=input.status||'inbox';const result=db.prepare('INSERT OR IGNORE INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.title,input.category||'其他',input.group||null,status,input.priority||'normal',input.dueAt||null,input.precision||'uncertain',input.audience||'me',input.reason||'',JSON.stringify(input.sourceIds||[]),input.remindMinutes??15,now,now);return {id,inserted:Number(result.changes)>0};}
 function ingest(input,options={}){let added=0;const taskIds=[];db.exec('BEGIN IMMEDIATE');try{if(options.file&&db.prepare('SELECT 1 FROM file_imports WHERE id=?').get(options.file.id)){db.exec('COMMIT');return 0;}const ids=new Set();const previousTasks=db.prepare('SELECT category,source_ids FROM tasks WHERE group_name=?').all(input.group);const previousSummaries=db.prepare('SELECT category,source_ids FROM summaries WHERE group_name=?').all(input.group);const covered=(rows,item)=>{const coveredIds=new Set(rows.filter(r=>r.category===(item.category||'其他')).flatMap(r=>JSON.parse(r.source_ids)));return item.sourceIds.every(id=>coveredIds.has(id));};for(const m of input.messages){const id=m.id||idFor(input.group,m.sender||'',m.sentAt||'',m.text);const existing=db.prepare('SELECT group_name,text FROM messages WHERE id=?').get(id);if(existing&&(existing.group_name!==input.group||existing.text!==m.text))throw new Error('原始消息 ID 与已保存来源不一致');ids.add(id);db.prepare('INSERT OR IGNORE INTO messages VALUES (?,?,?,?,?,?)').run(id,input.group,m.sender||'未识别',m.text,m.sentAt||null,m.capturedAt||new Date().toISOString());}
 const validSources=list=>Array.isArray(list)&&list.length>0&&list.every(id=>ids.has(id));
 for(const t of input.tasks||[]){if(!validSources(t.sourceIds))throw new Error('待办必须关联本次读取的原始消息');if(t.audience==='others'||covered(previousTasks,t))continue;const status=options.file&&t.dueAt&&['date','minute'].includes(t.precision)?'pending':'inbox';const result=addTask({...t,group:input.group,status,...(options.file?{remindMinutes:options.file.remindMinutes}:{})});if(result.inserted){added++;taskIds.push(result.id);}}
 for(const s of input.summaries||[]){if(!validSources(s.sourceIds))throw new Error('摘要必须关联原始消息');if(covered(previousSummaries,s))continue;const id=idFor(input.group,s.category,...s.sourceIds,s.text);db.prepare('INSERT OR IGNORE INTO summaries VALUES(?,?,?,?,?,?)').run(id,input.group,s.category||'其他',s.text,JSON.stringify(s.sourceIds),new Date().toISOString());}
 if(options.file){const f=options.file;db.prepare('INSERT INTO file_imports VALUES(?,?,?,?,?,?)').run(f.id,f.name,f.referenceDate,f.textChars,JSON.stringify(taskIds),new Date().toISOString());}
 db.exec('COMMIT');return added;}catch(e){db.exec('ROLLBACK');throw e;}}
 function batchTasks(ids,action){
  if(!Array.isArray(ids)||!ids.length||ids.length>5000||ids.some(id=>typeof id!=='string'||!id||id.length>200)||!['done','dismissed','delete','restore'].includes(action))throw new Error('请选择有效事务和批量操作（每次最多 5000 条）');
  const unique=[...new Set(ids)],now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
  try{
   const rows=unique.map(id=>db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
   if(rows.some(row=>!row))throw new Error('部分事务已不存在，请刷新后重新选择');
   if(rows.some(row=>action==='restore'?row.status!=='deleted':action!=='delete'&&row.status==='deleted'))throw new Error('事务状态已改变，请刷新后重新选择');
   let changed=0;
   for(const row of rows){
    if(action==='delete'&&row.status==='deleted')continue;
    const status=action==='delete'?'deleted':action==='restore'?(db.prepare('SELECT previous_status FROM task_trash WHERE task_id=?').get(row.id)?.previous_status||'inbox'):action;
    if(!['inbox','pending','done','dismissed','deleted'].includes(status))throw new Error('恢复状态不正确');
    if(action==='delete')db.prepare('INSERT INTO task_trash VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET previous_status=excluded.previous_status,deleted_at=excluded.deleted_at').run(row.id,row.status,now);
    if(action==='restore')db.prepare('DELETE FROM task_trash WHERE task_id=?').run(row.id);
    db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run(status,now,row.id);changed++;
   }
   db.exec('COMMIT');return {ok:true,count:changed,ids:unique};
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {db,setting,setSetting,addTask,ingest,task,batchTasks,listTasks:()=>db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all().map(task),getTask:id=>task(db.prepare('SELECT * FROM tasks WHERE id=?').get(id))};
}
