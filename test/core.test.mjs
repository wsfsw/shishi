import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../store.mjs';
import {inferDate,extractMessages,idFor} from '../extract.mjs';
import {tickReminders,dueReminders,snoozeNotification} from '../reminders.mjs';
const reference='2026-10-06T23:30:00+08:00';

test('批量删除可恢复原状态和来源，回收站停止日历提醒，失败整批回滚',()=>{
 const s=createStore(':memory:');
 for(const [id,status] of [['a','inbox'],['b','pending'],['c','done'],['d','dismissed']])s.addTask({id,title:'合成事务 '+id,status,dueAt:'2099-10-08T14:30:00+08:00',precision:'minute',group:'合成来源',sourceIds:['source-'+id],reason:'保留备注'});
 const before=s.listTasks();assert.throws(()=>s.batchTasks(['a','missing'],'delete'),/不存在/);assert.equal(s.getTask('a').status,'inbox');
 s.db.exec("CREATE TRIGGER block_delete BEFORE UPDATE ON tasks WHEN NEW.id='b' AND NEW.status='deleted' BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
 assert.throws(()=>s.batchTasks(['a','b'],'delete'),/rollback/);assert.equal(s.getTask('a').status,'inbox');assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM task_trash').get().n,0);s.db.exec('DROP TRIGGER block_delete');
 assert.equal(s.batchTasks(['a','b','c','d','a'],'delete').count,4);assert(s.listTasks().every(t=>t.status==='deleted'));assert.equal(dueReminders(s,Date.parse('2099-10-09')).length,0);
 assert.throws(()=>s.batchTasks(['a'],'done'),/状态/);assert.equal(s.batchTasks(['a','b','c','d'],'restore').count,4);
 for(const old of before){const restored=s.getTask(old.id);for(const field of ['status','title','dueAt','precision','group','reason','createdAt','sourceIds'])assert.deepEqual(restored[field],old[field]);}
 s.batchTasks(['a','b'],'done');assert.equal(s.getTask('a').status,'done');assert.equal(s.getTask('b').status,'done');assert.equal(s.getTask('d').status,'dismissed');
 s.db.close();
});
test('相对日期以原消息日期为准，跨月与北京时间均正确',()=>{
 assert.deepEqual(inferDate('请明天下午3点开会',reference),{dueAt:'2026-10-07T15:00:00+08:00',precision:'minute'});
 assert.equal(inferDate('明天上午9点提交','2026-10-31T23:59:00+08:00').dueAt,'2026-11-01T09:00:00+08:00');
 assert.equal(inferDate('下周一14:20开会',reference).dueAt,'2026-10-12T14:20:00+08:00');
});
test('缺少时段、含糊期限及无效日期不会伪造精确时间',()=>{
 assert.deepEqual(inferDate('明天3点开会',reference),{dueAt:'2026-10-07',precision:'date'});
 assert.equal(inferDate('尽快提交',reference).precision,'uncertain');
 assert.equal(inferDate('2026年2月30日上午9点提交',reference).dueAt,null);
 assert.equal(inferDate('明天25:20开会',reference).dueAt,null);
});
test('消息发送时间未知时不将历史消息的明天推算成采集日的明天',()=>{
 const out=extractMessages([{id:'old',text:'请明天下午3点开会',capturedAt:reference}]);
 assert.equal(out.tasks[0].dueAt,null);
 assert.equal(inferDate('2026年10月8日下午3点开会',null).dueAt,'2026-10-08T15:00:00+08:00');
});
test('指定他人的事项不转成我的待办，取消信息仍留摘要',()=>{
 const messages=['@小张 明天下午3点提交','@小王 明天下午3点提交','会议取消了','请大家明天上午9点集合'].map((text,i)=>({id:String(i),text,sentAt:reference}));
 const r=extractMessages(messages,{nickname:'小王'});
 assert.equal(r.tasks.length,2);assert.deepEqual(r.tasks.map(t=>t.sourceIds[0]),['1','3']);assert(r.summaries.some(s=>s.text.includes('取消')));
});
test('重复同步不重复建立事务，所有事项有原话，错误批次整体回滚',()=>{
 const s=createStore(':memory:');const m={id:'msg1',text:'请大家明天下午3点开会',sentAt:reference};const input={group:'测试群',messages:[m],...extractMessages([m],{group:'测试群'})};
 assert.equal(s.ingest(input),1);assert.equal(s.ingest(input),0);assert.equal(s.listTasks().length,1);assert.equal(s.listTasks()[0].status,'inbox');
 assert.equal(s.ingest({...input,tasks:input.tasks.map(t=>({...t,title:'同一消息换一个标题'}))}),0);
 assert.throws(()=>s.ingest({...input,group:'另一个群'}),/来源不一致/);
 assert.throws(()=>s.ingest({group:'测试群',messages:[{id:'bad',text:'错误批次'}],tasks:[{title:'捏造',sourceIds:['不存在']}]}),/原始消息/);
 assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,1);s.db.close();
});
test('提醒仅对已确认的精确时间触发，并且只触发一次',async()=>{
 const s=createStore(':memory:');const now=Date.parse('2026-10-07T14:46:00+08:00');
 s.addTask({id:'a',title:'开会',status:'pending',dueAt:'2026-10-07T15:00:00+08:00',precision:'minute',remindMinutes:15});
 s.addTask({id:'b',title:'全天',status:'pending',dueAt:'2026-10-08',precision:'date'});
 s.addTask({id:'c',title:'待确认',status:'inbox',dueAt:'2026-10-07T15:00:00+08:00',precision:'minute'});
 let sent=0;assert.equal(await tickReminders(s,async()=>sent++,now),1);assert.equal(await tickReminders(s,async()=>sent++,now),0);assert.equal(sent,1);
 const n=s.db.prepare('SELECT * FROM notifications').get();snoozeNotification(s,n.id,now);
 assert.equal(s.getTask('a').dueAt,'2026-10-07T15:00:00+08:00');assert.equal(dueReminders(s,now+9*60_000).length,0);
 assert.equal(await tickReminders(s,async()=>sent++,now+10*60_000),1);assert.equal(sent,2);s.db.close();
});
test('全天事项按用户设置的提醒时刻触发，不冒充原通知的准确时间',async()=>{
 const s=createStore(':memory:');s.setSetting('allDayReminderTime','09:30');
 s.addTask({id:'date',title:'当天截止',status:'pending',dueAt:'2026-10-21',precision:'date'});
 assert.equal(dueReminders(s,Date.parse('2026-10-21T09:29:59+08:00')).length,0);
 let body='';assert.equal(await tickReminders(s,async(_title,b)=>body=b,Date.parse('2026-10-21T09:30:00+08:00')),1);
 assert(body.includes('全天'));assert(body.includes('提醒设置：当天 09:30'));
 assert.equal(s.getTask('date').precision,'date');s.db.close();
});
test('关闭电脑通知后仍有应用内提醒',async()=>{
 const s=createStore(':memory:');s.setSetting('desktopEnabled',false);s.addTask({id:'a',title:'提醒',status:'pending',dueAt:'2026-10-07T15:00:00+08:00',precision:'minute'});
 await tickReminders(s,async()=>assert.fail('不应弹出'),Date.parse('2026-10-07T15:00:00+08:00'));
 assert.equal(s.db.prepare('SELECT desktop_status FROM notifications').get().desktop_status,'disabled');s.db.close();
});
test('仅将用户选择的信息类型转为摘要和待办',()=>{
 const messages=['请明天上午9点开会','请明天提交文件','通知大家明天放假'].map((text,i)=>({id:idFor(text),text,sentAt:reference}));
 const out=extractMessages(messages,{categories:['会议']});assert.equal(out.tasks.length,1);assert.equal(out.summaries.length,1);assert.equal(out.tasks[0].category,'会议');
 assert.equal(extractMessages(messages,{categories:[]}).tasks.length,0);
});
