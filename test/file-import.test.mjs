import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../store.mjs';
import {uploadedFile,organizeFile,documentSources} from '../file-import.mjs';
import {extractDocumentDeepSeek} from '../deepseek.mjs';
import {dueReminders} from '../reminders.mjs';
import {createAIJobs} from '../ai-jobs.mjs';

const file=()=>uploadedFile({name:'活动安排.txt',content:Buffer.from('2026年10月8日14:30 参加项目评审；10月9日前提交材料；整理参考资料，时间待定。').toString('base64')});
const model=tasks=>async(url,options)=>{
 const request=JSON.parse(options.body),data=JSON.parse(request.messages[1].content),sourceIds=[data.sources[0].id];
 assert.equal(data.referenceDate,'2026-10-06');assert.equal(data.filename,'活动安排.txt');assert(!('sentAt' in data.sources[0]));
 return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({tasks:tasks.map(t=>({title:'事项',category:'日程',dueAt:null,precision:'uncertain',audience:'me',priority:'normal',reason:'',...t,sourceIds})),summaries:[]})}}]})};
};

test('结束文件整理会丢弃暂存结果，原事务、来源及导入记录都保持不变',async()=>{
 const store=createStore(':memory:'),jobs=createAIJobs();try{
  store.addTask({id:'preserved',title:'原有日历',dueAt:'2026-10-08',precision:'date',status:'pending'});const baseline=store.listTasks();
  const job=jobs.start('ui',control=>organizeFile(store,file(),{referenceDate:'2026-10-06'},{apiKey:'test',fetchImpl:model([{title:'不应写入的会议',dueAt:'2026-10-08T14:30:00+08:00',precision:'minute'}]),...control}));
  for(let i=0;i<200&&jobs.status(job.id,'ui').state!=='ready';i++)await new Promise(r=>setTimeout(r,5));assert.equal(jobs.status(job.id,'ui').state,'ready');assert.deepEqual(store.listTasks(),baseline);jobs.cancel(job.id,'ui');await new Promise(r=>setImmediate(r));assert.deepEqual(store.listTasks(),baseline);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,0);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM file_imports').get().n,0);
 }finally{jobs.dispose();store.db.close();}
});

test('文件排期：可靠日期自动确认，未知日期进事务箱，保留原文与提醒',async()=>{
 const store=createStore(':memory:');
 try{
  const existing=store.addTask({id:'existing',title:'原有日历',dueAt:'2026-10-08T14:30:00+08:00',precision:'minute',status:'pending'});const before=store.getTask(existing.id);
  const result=await organizeFile(store,file(),{referenceDate:'2026-10-06',remindMinutes:30},{apiKey:'test',fetchImpl:model([
   {title:'参加项目评审',category:'会议',dueAt:'2026-10-08T14:30:00+08:00',precision:'minute'},
   {title:'提交材料',category:'文件',dueAt:'2026-10-09',precision:'date'},
   {title:'整理参考资料'},
   {title:'他人事项',audience:'others'}
  ])});
  assert.equal(result.scheduled,2);assert.equal(result.inbox,1);assert.equal(result.added,3);assert.deepEqual(store.getTask(existing.id),before);
  const tasks=result.taskIds.map(id=>store.getTask(id));assert.equal(tasks[0].status,'pending');assert.equal(tasks[0].remindMinutes,30);assert.equal(tasks[2].dueAt,null);
  const source=store.db.prepare('SELECT * FROM messages WHERE id=?').get(tasks[0].sourceIds[0]);assert.equal(source.sent_at,null);assert(source.text.includes('项目评审'));assert.equal(source.group_name,'文件 · 活动安排.txt');
  assert(dueReminders(store,Date.parse('2026-10-08T14:00:00+08:00')).some(n=>n.task.id===tasks[0].id));
  assert(!dueReminders(store,Date.parse('2026-10-08T13:59:59+08:00')).some(n=>n.task.id===tasks[0].id));
 }finally{store.db.close();}
});

test('重复文件不再调用 AI，不覆盖修改和忽略状态；失败不留部分数据',async()=>{
 const store=createStore(':memory:');
 try{
  const options={apiKey:'test',fetchImpl:model([{title:'提交材料',dueAt:'2026-10-09',precision:'date'}])},input={referenceDate:'2026-10-06',remindMinutes:15};
  const result=await organizeFile(store,file(),input,options);
  store.db.prepare("UPDATE tasks SET title='用户已修改',status='dismissed' WHERE id=?").run(result.taskIds[0]);
  const duplicate=await organizeFile(store,{...file(),name:'重命名.txt'},input,{apiKey:'test',fetchImpl:()=>assert.fail('重复文件不可再请求 AI')});
  assert(duplicate.duplicate);assert.equal(store.listTasks().length,1);assert.equal(store.getTask(result.taskIds[0]).title,'用户已修改');assert.equal(store.getTask(result.taskIds[0]).status,'dismissed');
  const bad=uploadedFile({name:'坏结果.txt',content:Buffer.from('没有时间的事项').toString('base64')});
  await assert.rejects(organizeFile(store,bad,input,{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({tasks:[{title:'虚假',sourceIds:['invented']}],summaries:[]})}}]})})}),/来源/);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM file_imports').get().n,1);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,1);
 }finally{store.db.close();}
});

test('上传限制、非法日期和事务回滚，群聊仍只进入待确认',async()=>{
 assert.throws(()=>uploadedFile({name:'../bad.txt',content:'eA=='}),/名称/);assert.throws(()=>uploadedFile({name:'程序.exe',content:'eA=='}),/请选择/);assert.throws(()=>uploadedFile({name:'内容.txt',content:'!!!='}),/内容/);
 const large=uploadedFile({name:'大文本.txt',content:Buffer.alloc(3_000_000,65).toString('base64')});assert.equal(large.size,3_000_000);
 assert.throws(()=>uploadedFile({name:'超大.txt',content:Buffer.alloc(10*1024*1024+1,65).toString('base64')}),/10MB/);
 const store=createStore(':memory:');
 try{
  await assert.rejects(organizeFile(store,file(),{referenceDate:'2026-02-30'},{apiKey:'test'}),/日期/);
  const messages=documentSources('真实原文',file()),tasks=[{title:'应该回滚',sourceIds:[messages[0].id],dueAt:'2026-10-09',precision:'date'},{title:'错误来源',sourceIds:['bad']}];
  assert.throws(()=>store.ingest({group:'文件测试',messages,tasks},{file:{id:'rollback',name:'测试.txt',referenceDate:'2026-10-06',textChars:4,remindMinutes:15}}),/原始消息/);
  assert.equal(store.listTasks().length,0);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,0);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM file_imports').get().n,0);
  store.ingest({group:'微信群',messages,tasks:[tasks[0]]});assert.equal(store.listTasks()[0].status,'inbox');
 }finally{store.db.close();}
});

test('文件 AI 严格验证日期与来源，忽略模型提供的状态字段',async()=>{
 const messages=documentSources('会议：2026年10月8日14:30',file());
 const result=await extractDocumentDeepSeek(messages,{name:'活动安排.txt',referenceDate:'2026-10-06',apiKey:'test',fetchImpl:model([{title:'会议',status:'done',dueAt:'2026-10-08T14:30:00+08:00',precision:'minute'}])});
 assert.equal(result.tasks[0].status,undefined);assert.equal(messages[0].sentAt,null);
 await assert.rejects(extractDocumentDeepSeek(messages,{name:'活动安排.txt',referenceDate:'2026-10-06',apiKey:'test',fetchImpl:model([{dueAt:'2026-02-30',precision:'date'}])}),/日期/);
});
