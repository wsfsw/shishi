/* SQLite runs inside this browser. No WeChat or local-service connection. */
(() => {
 let sqlite;
 const ready=()=>sqlite||(sqlite=initSqlJs({locateFile:()=>new URL('./sql-wasm.wasm',document.baseURI).href}).catch(error=>{sqlite=null;throw new Error('方案模块加载失败，请刷新后重试');}));
 const decode=value=>value?Uint8Array.from(atob(value),c=>c.charCodeAt(0)):undefined;
 const encode=bytes=>{let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out);};
 function adapter(raw){return {exec:sql=>raw.exec(sql),prepare(sql){return {all(...args){const statement=raw.prepare(sql);try{statement.bind(args);const rows=[];while(statement.step())rows.push(statement.getAsObject());return rows;}finally{statement.free();}},get(...args){return this.all(...args)[0];},run(...args){raw.run(sql,args);return {changes:raw.getRowsModified()};}};}};}
 function sync(store,saved){
  store.db.exec('DELETE FROM tasks; DELETE FROM messages; DELETE FROM task_trash;');
  for(const t of saved.tasks){store.addTask(t);store.db.prepare('UPDATE tasks SET created_at=?,updated_at=? WHERE id=?').run(t.createdAt||new Date().toISOString(),t.updatedAt||t.createdAt||'',t.id);if(t.status==='deleted')store.db.prepare('INSERT INTO task_trash VALUES(?,?,?)').run(t.id,t.deletedFromStatus||'inbox',t.updatedAt||t.createdAt||'');}
  for(const m of saved.messages)store.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(m.id,m.group_name,m.sender,m.text,m.sent_at||null,m.captured_at||new Date().toISOString());
 }
 async function open(saved){const SQL=await ready(),raw=new SQL.Database(decode(saved.planning));const store=window.ShishiPlannerCore.createStore(adapter(raw));sync(store,saved);const planner=window.ShishiPlannerCore.createPlanner(store);for(const task of saved.tasks)planner.onTaskStatus(task.id,task.status);return {raw,store,planner};}
 function savedResult(context,saved){return {...saved,planning:encode(context.raw.export()),tasks:context.store.listTasks().map(t=>({...t,durationMinutes:context.store.db.prepare('SELECT minutes FROM plan_tasks WHERE task_id=?').get(t.id)?.minutes||null})),messages:context.store.db.prepare('SELECT * FROM messages').all()};}
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
  const baseline=getSaved(),c=await open(baseline);try{let result;if(action==='bulk'&&getSaved()!==baseline)throw new Error('事务已改变，请重新选择后操作');
   if(action==='bulk'){result=c.store.batchTasks(input.ids,input.action);for(const id of result.ids)c.planner.onTaskStatus(id,c.store.getTask(id).status);}
   else if(action==='preview')result=c.planner.preview(input.solutionId,input.overrides||[],input.constraints);
   else if(action==='confirm')result=c.planner.confirm(input);
   else if(action==='feedback')result=c.planner.feedback(input);
   else if(action==='share')result=c.planner.share(input.problemId);
   else if(action==='experience')return c.planner.experience(input.problemId);
   else throw new Error('没有这个方案操作');
   persist(savedResult(c,getSaved()));return action==='bulk'?result:{ok:true,solution:result};
  }finally{c.raw.close();}
 }
 window.ShishiPagesPlans={state,job,request};
})();
