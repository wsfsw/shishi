import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../store.mjs';
import {createPlanner} from '../planning.mjs';
import {exportBackup,previewBackup,importBackup} from '../backup.mjs';
import {nextOccurrence} from '../task-tools.mjs';

test('同源多事项补提取、重试、编辑、回收站与改期建议均不误吞或复活',()=>{
 const s=createStore(':memory:'),group='合成测试来源',messages=[{id:'m',sender:'测试',text:'明天下午开会，晚上交报告',sentAt:'2099-10-08'}];
 const item=title=>({title,category:'日程',sourceIds:['m'],audience:'me'});
 assert.equal(s.ingest({group,messages,tasks:[item('开会')]}),1);
 assert.equal(s.ingest({group,messages,tasks:[item('交报告')]}),1);
 assert.equal(s.ingest({group,messages,tasks:[item('开会'),item('交报告')]}),0);
 const report=s.listTasks().find(t=>t.title==='交报告');s.updateTask({...report,title:'用户修改的标题'});s.batchTasks([report.id],'delete');
 assert.equal(s.ingest({group,messages,tasks:[item('交报告')]}),0);assert.equal(s.getTask(report.id).status,'deleted');
 assert.equal(s.ingest({group,messages,tasks:[{...item('开会'),dueAt:'2099-10-09T15:00:00+08:00',precision:'minute'}]}),1);
 const changed=s.listTasks().find(t=>t.dueAt);assert.equal(changed.status,'inbox');assert(changed.reason.includes('日期发生变化'));
 assert.equal(s.listRuns()[0].changedDates,1);s.db.close();
});

test('完整备份保留原文、方案、时长、回收站；拒绝凭据表和损坏引用，合并保留当前修改',()=>{
 const a=createStore(':memory:'),b=createStore(':memory:');createPlanner(a);createPlanner(b);
 a.setSetting('deepseekModel','private-model');a.setSetting('nickname','private-identity');
 a.ingest({group:'合成来源',messages:[{id:'src',text:'原文',sender:'测试',sentAt:'2099-01-01'}],tasks:[{title:'报告',category:'文件',sourceIds:['src']}]});
 const original=a.listTasks()[0];a.updateTask({...original,dueAt:'2099-01-03T15:00:00+08:00',deadlineAt:'2099-01-05',durationMinutes:45,project:'课题',tags:['重要'],checklist:[{text:'查资料',done:false}]});
 a.batchTasks([original.id],'delete');
 a.db.prepare('INSERT INTO problems VALUES(?,?,?,?)').run('p',JSON.stringify({title:'合成问题',status:'open',constraints:{},tags:[],sourceIds:['src']}),'2099-01-01','2099-01-01');
 const backup=exportBackup(a);assert(!JSON.stringify(backup).includes('private-model'));assert(!JSON.stringify(backup).includes('private-identity'));
 assert.equal(previewBackup(b,backup).tasks,1);assert.equal(importBackup(b,backup).tasks,1);assert.equal(b.getTask(original.id).status,'deleted');
 b.batchTasks([original.id],'restore');assert.equal(b.getTask(original.id).durationMinutes,45);assert.equal(b.getTask(original.id).deadlineAt,'2099-01-05');assert.equal(b.db.prepare('SELECT text FROM messages WHERE id=?').get('src').text,'原文');
 b.updateTask({...b.getTask(original.id),title:'保留本地修改'});assert.equal(importBackup(b,backup).tasks,0);assert.equal(b.getTask(original.id).title,'保留本地修改');
 const bad=structuredClone(backup);bad.tables.settings=[{key:'apiKey',value:'forbidden'}];assert.throws(()=>importBackup(b,bad),/不支持/);
 const missing=structuredClone(backup);missing.tables.messages=[];const empty=createStore(':memory:');createPlanner(empty);assert.throws(()=>importBackup(empty,missing),/原文/);assert.equal(empty.listTasks().length,0);
 const rollback=createStore(':memory:');createPlanner(rollback);rollback.db.exec("CREATE TRIGGER fail_task BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'rollback'); END;");assert.throws(()=>importBackup(rollback,backup),/rollback/);assert.equal(rollback.db.prepare('SELECT COUNT(*) n FROM messages').get().n,0);
 for(const s of [a,b,empty,rollback])s.db.close();
});

test('重复任务完成生成一次，月底和闰年正确，批量改期不改截止且失败整批回滚',()=>{
 assert.equal(nextOccurrence('2028-01-31','monthly'),'2028-02-29');assert.equal(nextOccurrence('2028-02-29','monthly','2028-01-31'),'2028-03-31');
 const s=createStore(':memory:');s.addTask({id:'a',title:'每月报告',status:'pending',dueAt:'2099-01-31',precision:'date',repeat:'monthly',deadlineAt:'2099-02-01',durationMinutes:30,checklist:[{text:'核对',done:true}]});
 s.setStatus('a','done');s.setStatus('a','done');let next=s.listTasks().find(t=>t.id!=='a');assert.equal(s.listTasks().length,2);assert.equal(next.dueAt,'2099-02-28');assert.equal(next.deadlineAt,null);assert.equal(next.checklist[0].done,false);
 s.setStatus('a','inbox');s.setStatus('a','done');assert.equal(s.listTasks().length,2);
 s.addTask({id:'b',title:'保留截止',deadlineAt:'2099-03-01',durationMinutes:45});
 assert.throws(()=>s.batchTasks(['b','missing'],'reschedule',{dueAt:'2099-02-20'}),/不存在/);assert.equal(s.getTask('b').dueAt,null);
 s.batchTasks(['b'],'reschedule',{dueAt:'2099-02-20T09:00:00+08:00'});assert.equal(s.getTask('b').deadlineAt,'2099-03-01');assert.equal(s.getTask('b').durationMinutes,45);
 s.batchTasks(['b'],'classify',{category:'文件',project:'课程',tags:['学习']});assert.equal(s.getTask('b').project,'课程');assert.deepEqual(s.getTask('b').tags,['学习']);
 const before=s.getTask('b');assert.throws(()=>s.batchTasks(['b',next.id],'classify',{tags:['x'.repeat(31)]}),/标签/);assert.deepEqual(s.getTask('b'),before);s.db.close();
});
