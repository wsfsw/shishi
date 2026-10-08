/* SQLite runs inside this browser. No WeChat or local-service connection. */
(() => {
 let sqlite;
 const ready=()=>sqlite||(sqlite=initSqlJs({locateFile:()=>new URL('./sql-wasm.wasm',document.baseURI).href}).catch(error=>{sqlite=null;throw new Error('方案模块加载失败，请刷新后重试');}));
 const decode=value=>value?Uint8Array.from(atob(value),c=>c.charCodeAt(0)):undefined;
 const encode=bytes=>{let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out);};
 function adapter(raw){return {exec:sql=>raw.exec(sql),prepare(sql){return {all(...args){const statement=raw.prepare(sql);try{statement.bind(args);const rows=[];while(statement.step())rows.push(statement.getAsObject());return rows;}finally{statement.free();}},get(...args){return this.all(...args)[0];},run(...args){raw.run(sql,args);return {changes:raw.getRowsModified()};}};}};}
 function sync(store,saved){
  store.db.exec('DELETE FROM tasks; DELETE FROM task_details; DELETE FROM messages; DELETE FROM task_trash; DELETE FROM summaries; DELETE FROM notifications;');
  for(const t of saved.tasks){store.addTask(t);store.db.prepare('UPDATE tasks SET created_at=?,updated_at=? WHERE id=?').run(t.createdAt||new Date().toISOString(),t.updatedAt||t.createdAt||'',t.id);if(t.status==='deleted')store.db.prepare('INSERT INTO task_trash VALUES(?,?,?)').run(t.id,t.deletedFromStatus||'inbox',t.updatedAt||t.createdAt||'');}
  for(const m of saved.messages)store.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(m.id,m.group_name,m.sender,m.text,m.sent_at||null,m.captured_at||new Date().toISOString());
  for(const s of saved.summaries||[])store.db.prepare('INSERT INTO summaries VALUES(?,?,?,?,?,?)').run(s.id,s.group_name,s.category,s.text,JSON.stringify(s.sourceIds||[]),s.created_at||new Date().toISOString());
  for(const n of saved.notifications||[]){const [due,lead]=(saved.reminded?.[n.task_id]||'').split('|'),at=due?Date.parse(due.length===10?due+'T09:00:00+08:00':due)-(due.length===10?0:Number(lead||0)*60000):NaN;store.db.prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?)').run(n.id,n.task_id,n.title,n.body,n.scheduled_at||(Number.isFinite(at)?new Date(at).toISOString():n.created_at),n.created_at,n.read||0,n.desktop_status||'disabled');}
 }
 async function open(saved){const SQL=await ready(),raw=new SQL.Database(decode(saved.planning));const store=window.ShishiPlannerCore.createStore(adapter(raw));sync(store,saved);const planner=window.ShishiPlannerCore.createPlanner(store);for(const task of saved.tasks)planner.onTaskStatus(task.id,task.status);return {raw,store,planner};}
 function savedResult(context,saved){return {...saved,planning:encode(context.raw.export()),tasks:context.store.listTasks().map(t=>({...t,durationMinutes:t.durationMinutes||context.store.db.prepare('SELECT minutes FROM plan_tasks WHERE task_id=?').get(t.id)?.minutes||null})),messages:context.store.db.prepare('SELECT * FROM messages').all(),summaries:context.store.db.prepare('SELECT * FROM summaries').all().map(s=>({...s,sourceIds:JSON.parse(s.source_ids)})),notifications:context.store.db.prepare('SELECT * FROM notifications').all(),runs:context.store.listRuns()};}
 async function state(saved){if(!saved.planning)return [];const c=await open(saved);try{return c.planner.state();}finally{c.raw.close();}}
 async function job(kind,input,options,getSaved,persist){
  const baseline=getSaved().planning,c=await open(getSaved());
  const beforeCommit=async()=>{await options.beforeCommit();options.signal.throwIfAborted();if(getSaved().planning!==baseline)throw new Error('方案或反馈已改变，请重新整理');sync(c.store,getSaved());};
  try{let result;
   if(kind==='problem')result={ok:true,id:await c.planner.create(input,{...options,beforeCommit,withSuggestions:true})};
   else if(kind==='suggest')result={ok:true,suggestions:await c.planner.suggest(input.problemId,{...options,beforeCommit})};
   else if(kind==='generate')result={ok:true,solution:await c.planner.generate(input,{...options,beforeCommit})};
   else throw new Error('不支持的方案操作');
   persist(savedResult(c,getSaved()));return result;
  }finally{c.raw.close();}
 }
 async function request(action,input,getSaved,persist){
  const baseline=getSaved(),c=await open(baseline);try{let result;if(!['export','previewBackup','experience'].includes(action)&&getSaved()!==baseline)throw new Error('事务已改变，请重新选择后操作');
   if(action==='bulk'){result=c.store.batchTasks(input.ids,input.action,input.options);for(const id of result.ids)c.planner.onTaskStatus(id,c.store.getTask(id).status);}
   else if(action==='save'){const fields=window.ShishiPlannerCore.validateTaskFields(input);result=input.id?c.store.updateTask({...input,...fields}):c.store.addTask({...input,...fields,id:crypto.randomUUID()});c.planner.onTaskStatus(result.id,fields.status);}
   else if(action==='status'){if(!['done','dismissed','inbox'].includes(input.status))throw new Error('事务状态不正确');result=c.store.setStatus(input.id,input.status);c.planner.onTaskStatus(input.id,input.status);}
   else if(action==='ingest'){const added=c.store.ingest(input);result={ok:true,added,message:'已整理 '+input.messages.length+' 条消息，新增 '+added+' 条事务。详见整理记录。'};}
   else if(action==='export')return window.ShishiPlannerCore.exportBackup(c.store);
   else if(action==='previewBackup')return window.ShishiPlannerCore.previewBackup(c.store,input.backup);
   else if(action==='importBackup'){window.ShishiPlannerCore.previewBackup(c.store,input.backup);const previous=window.ShishiPlannerCore.exportBackup(c.store);result=window.ShishiPlannerCore.importBackup(c.store,input.backup);try{localStorage.setItem('shishi.pages.before-import.v1',JSON.stringify(previous));}catch{throw new Error('无法保留导入前备份，请先导出数据并检查浏览器存储空间');}}
   else if(action==='preview')result=c.planner.preview(input.solutionId,input.overrides||[],input.constraints);
   else if(action==='confirm')result=c.planner.confirm(input);
   else if(action==='feedback')result=c.planner.feedback(input);
   else if(action==='share')result=c.planner.share(input.problemId);
   else if(action==='experience')return c.planner.experience(input.problemId);
   else throw new Error('没有这个方案操作');
   persist(savedResult(c,getSaved()));return ['bulk','save','status','ingest','importBackup'].includes(action)?{ok:true,...result}:{ok:true,solution:result};
  }finally{c.raw.close();}
 }
 window.ShishiPagesPlans={state,job,request};
})();
