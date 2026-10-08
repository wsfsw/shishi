import {taskDetails,validTaskDue,validTaskDate,TASK_CATEGORIES} from './task-tools.mjs';

// Deliberately excludes credentials, account bindings, groups and service settings.
const TABLES={
 messages:['id','group_name','sender','text','sent_at','captured_at'],
 tasks:['id','title','category','group_name','status','priority','due_at','precision','audience','reason','source_ids','remind_minutes','created_at','updated_at'],
 task_details:['task_id','body'],task_trash:['task_id','previous_status','deleted_at'],
 summaries:['id','group_name','category','text','source_ids','created_at'],
 notifications:['id','task_id','title','body','scheduled_at','created_at','read','desktop_status'],
 snoozes:['task_id','scheduled_at'],file_imports:['id','name','reference_date','text_chars','task_ids','created_at'],
 problems:['id','body','created_at','updated_at'],solutions:['id','problem_id','body','created_at'],
 plan_tasks:['task_id','problem_id','solution_id','step_id','minutes','actual_minutes','progress','difficulty'],
 extraction_keys:['signature','task_id'],ingestion_runs:['id','body','created_at']
};
const PRIMARY={extraction_keys:'signature'};
const primary=(table)=>PRIMARY[table]||TABLES[table][0];
const exists=(db,table)=>!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
export function exportBackup(store){
 const tables={};for(const [name,columns] of Object.entries(TABLES))tables[name]=exists(store.db,name)?store.db.prepare('SELECT '+columns.join(',')+' FROM '+name).all():[];
 return {format:'shishi-backup',version:1,createdAt:new Date().toISOString(),tables};
}
function validateBackup(value){
 if(!value||value.format!=='shishi-backup'||value.version!==1||!value.tables||typeof value.tables!=='object'||Array.isArray(value.tables))throw new Error('请选择拾事备份文件（版本 1）');
 if(JSON.stringify(value).length>40_000_000)throw new Error('备份超过 40MB，请使用较小的备份');
 const tables={};let count=0;
 for(const name of Object.keys(value.tables))if(!Object.hasOwn(TABLES,name))throw new Error('备份包含不支持的数据表');
 for(const [name,columns] of Object.entries(TABLES)){
  const rows=value.tables[name]||[];if(!Array.isArray(rows))throw new Error('备份数据表格式不正确');count+=rows.length;if(count>100000)throw new Error('备份记录过多');const keys=new Set();
  tables[name]=rows.map(row=>{
   if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!columns.includes(k))||columns.some(k=>!Object.hasOwn(row,k)))throw new Error('备份记录字段不正确');
   const k=row[primary(name)];if(typeof k!=='string'||!k||k.length>(name==='extraction_keys'?100000:200)||keys.has(k))throw new Error('备份记录编号重复或无效');keys.add(k);
   if(columns.some(k=>row[k]!==null&&!['string','number'].includes(typeof row[k])||typeof row[k]==='number'&&!Number.isFinite(row[k])))throw new Error('备份记录值不正确');
   for(const k of ['body','source_ids','task_ids'])if(columns.includes(k)&&!(name==='notifications'&&k==='body')){try{JSON.parse(row[k]);}catch{throw new Error('备份中的结构化内容损坏');}}
   if(name==='tasks'){
    if(!row.title||row.title.length>200||!TASK_CATEGORIES.includes(row.category)||!['inbox','pending','done','dismissed','deleted'].includes(row.status)||!validTaskDue(row.due_at)||row.status==='pending'&&!row.due_at||!Array.isArray(JSON.parse(row.source_ids))||!Number.isInteger(row.remind_minutes)||row.remind_minutes<0||row.remind_minutes>10080)throw new Error('备份事务格式不正确');
   }
   if(name==='task_details')taskDetails(JSON.parse(row.body));
   if(['problems','solutions','ingestion_runs'].includes(name)){
    const body=JSON.parse(row.body);
    if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('备份中的方案或整理记录格式不正确');
    if(name==='problems'){
     if(typeof body.title!=='string'||!body.title||body.title.length>200||!body.constraints||typeof body.constraints!=='object'||Array.isArray(body.constraints))throw new Error('备份问题格式不正确');
     for(const key of ['tags','sourceIds','materialNames'])if(body[key]!==undefined&&(!Array.isArray(body[key])||body[key].some(v=>typeof v!=='string')))throw new Error('备份问题列表损坏');
     for(const key of ['suggestions','feedback'])if(body[key]!==undefined&&(!Array.isArray(body[key])||body[key].some(v=>!v||typeof v!=='object'||Array.isArray(v))))throw new Error('备份问题建议损坏');
     if(body.constraints.weekdays!==undefined&&(!Array.isArray(body.constraints.weekdays)||body.constraints.weekdays.some(v=>!Number.isInteger(v)||v<0||v>6)))throw new Error('备份空闲时间损坏');
    }
    if(name==='solutions'){
     for(const key of ['steps','assignments'])if(!Array.isArray(body[key])||body[key].some(v=>!v||typeof v!=='object'||Array.isArray(v)))throw new Error('备份方案步骤损坏');
     if(body.steps.some(v=>typeof v.title!=='string'||!Number.isInteger(v.minutes)||v.minutes<5||v.minutes>240))throw new Error('备份方案用时损坏');
    }
   }
   if(name==='task_trash'&&!['inbox','pending','done','dismissed'].includes(row.previous_status))throw new Error('备份回收站状态不正确');
   if(name==='file_imports'&&!validTaskDate(row.reference_date))throw new Error('备份文件日期不正确');
   return Object.fromEntries(columns.map(k=>[k,row[k]]));
  });
 }
 return tables;
}
function inspect(store,value){
 const tables=validateBackup(value),available={};const counts={tasks:0,messages:0,problems:0,existingTasks:0,conflicts:0};
 for(const [name,rows] of Object.entries(tables)){const existing=exists(store.db,name)?store.db.prepare('SELECT '+TABLES[name].join(',')+' FROM '+name).all():[];available[name]=new Map(existing.map(r=>[r[primary(name)],r]));for(const row of rows){const key=row[primary(name)],old=available[name].get(key);if(old){if(name==='tasks'){counts.existingTasks++;if(TABLES[name].some(k=>row[k]!==old[k]))counts.conflicts++;}if(name==='messages'&&(old.text!==row.text||old.group_name!==row.group_name))throw new Error('来源编号与当前数据冲突，已停止导入');}else if(name in counts)counts[name]++;}}
 const known=(table,id)=>available[table].has(id)||tables[table].some(r=>r[primary(table)]===id);
 for(const t of tables.tasks){const ids=JSON.parse(t.source_ids);if(ids.some(id=>typeof id!=='string'||!known('messages',id)))throw new Error('备份缺少事务关联的原文');}
 for(const name of ['task_details','task_trash','plan_tasks','snoozes','extraction_keys'])for(const r of tables[name])if(!known('tasks',r.task_id))throw new Error('备份含有无对应事务的记录');
 for(const r of tables.solutions)if(!known('problems',r.problem_id))throw new Error('备份缺少对应问题');
 for(const r of tables.problems){const p=JSON.parse(r.body);if((p.sourceIds||[]).some(id=>!known('messages',id)))throw new Error('备份缺少问题关联的原文');for(const key of ['draftId','activeSolutionId'])if(p[key]&&!known('solutions',p[key]))throw new Error('备份缺少问题关联的方案');}
 for(const r of tables.plan_tasks)if(!known('problems',r.problem_id)||!known('solutions',r.solution_id))throw new Error('备份缺少对应方案');
 for(const r of tables.summaries){const ids=JSON.parse(r.source_ids);if(!Array.isArray(ids)||ids.some(id=>!known('messages',id)))throw new Error('备份摘要来源不完整');}
 return {tables,available,counts};
}
export function previewBackup(store,value){return {ok:true,...inspect(store,value).counts,policy:'合并导入；相同编号保留当前版本，不覆盖已有修改。备份不包含 API Key 或微信连接凭据。'};}
export function importBackup(store,value){
 const {tables,available,counts}=inspect(store,value);const retainedTasks=new Set(available.tasks.keys()),retainedProblems=new Set(available.problems.keys());
 store.db.exec('BEGIN IMMEDIATE');try{
  for(const [name,rows] of Object.entries(tables)){
   if(!exists(store.db,name)&&rows.length)throw new Error('当前版本不支持备份中的数据表');
   for(const r of rows){if(available[name].has(r[primary(name)]))continue;
    if(['task_details','task_trash','plan_tasks','snoozes'].includes(name)&&retainedTasks.has(r.task_id))continue;
    if(name==='solutions'&&retainedProblems.has(r.problem_id)||name==='plan_tasks'&&retainedProblems.has(r.problem_id))continue;
    const cols=TABLES[name],record=name==='notifications'&&r.desktop_status==='sending'?{...r,desktop_status:'restored'}:r;store.db.prepare('INSERT INTO '+name+' ('+cols.join(',')+') VALUES('+cols.map(()=>'?').join(',')+')').run(...cols.map(k=>record[k]));
   }
  }
  store.db.exec('COMMIT');return {ok:true,...counts};
 }catch(error){store.db.exec('ROLLBACK');throw error;}
}
