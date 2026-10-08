import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import initSqlJs from 'sql.js';
import {browserShared,browserPlanner} from '../scripts/browser-shared.mjs';
import {createStore} from '../store.mjs';
import {createPlanner} from '../planning.mjs';
import {exportBackup,importBackup} from '../backup.mjs';
function browser(fetchImpl,storage=new Map()){const context=vm.createContext({window:{},initSqlJs:()=>initSqlJs(),document:{baseURI:'https://example.test/'},URL,TextDecoder,atob,btoa,Uint8Array,crypto:{randomUUID},URLSearchParams,AbortController,AbortSignal,fetch:fetchImpl||(()=>{throw new Error('Unexpected network call');}),localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});vm.runInContext(browserShared(),context);vm.runInContext(browserPlanner(),context);for(const file of ['pages-planner.js','pages-ai.js','pages-runtime.js'])vm.runInContext(fs.readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),context);return {runtime:context.window.ShishiPages,storage};}
test('网页从空数据开始，拒绝自动微信读取；没有预置账号和密钥',async()=>{
 const {runtime,storage}=browser();const state=await runtime.request('/api/state');assert.equal(state.tasks.length,0);assert.equal(state.settings.groups.length,0);assert.equal(state.settings.ai.configured,false);assert.equal(state.settings.syncEnabled,false);assert.equal(storage.size,0);
 await assert.rejects(runtime.request('/api/sync/request',{}),/本机版/);
 await assert.rejects(runtime.request('/api/ai/jobs/start',{kind:'chat',input:{}}),/API Key/);
 assert.equal(storage.size,0);
});
function response(content){return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]})};}
test('网页与桌面完整备份双向迁移；恢复原文、方案和提醒，不保存凭据，不覆盖修改',async()=>{
 const source=createStore(':memory:');createPlanner(source);source.setSetting('deepseekSecret','never-export-this');
 source.ingest({group:'合成迁移来源',messages:[{id:'transfer-source',text:'保留来源',sender:'测试',sentAt:'2099-10-08'}],tasks:[{title:'迁移事务',category:'文件',sourceIds:['transfer-source']}]});
 const t=source.listTasks()[0];source.updateTask({...t,dueAt:'2099-10-09T15:00:00+08:00',status:'pending',deadlineAt:'2099-10-10',durationMinutes:45,project:'课题',tags:['重要'],repeat:'weekly'});
 const {runtime,storage}=browser();const snapshot=exportBackup(source);
 const preview=await runtime.request('/api/data/preview',{backup:snapshot});assert.equal(preview.tasks,1);
 await runtime.request('/api/data/import',{backup:snapshot});let state=await runtime.request('/api/state');assert.equal(state.tasks[0].durationMinutes,45);assert.equal(state.tasks[0].deadlineAt,'2099-10-10');assert.equal(state.tasks[0].repeat,'weekly');assert.equal(state.runs.length,1);assert.equal(state.settings.ai.configured,false);
 await runtime.request('/api/tasks/save',{...state.tasks[0],title:'网页修改'});
 await runtime.request('/api/data/import',{backup:snapshot});state=await runtime.request('/api/state');assert.equal(state.tasks[0].title,'网页修改');
 const restored=browser(undefined,storage).runtime;assert.equal((await restored.request('/api/state')).tasks[0].durationMinutes,45);
 const value=await restored.request('/api/data/export');assert(!JSON.stringify(value).includes('never-export-this'));const target=createStore(':memory:');createPlanner(target);importBackup(target,value);assert.equal(target.getTask(t.id).title,'网页修改');assert.equal(target.getTask(t.id).durationMinutes,45);assert.equal(target.db.prepare('SELECT text FROM messages WHERE id=?').get('transfer-source').text,'保留来源');
 assert((await runtime.request('/api/data/backups')).files.includes('before-import'));source.db.close();target.db.close();
});
test('网页完成重复任务只生成一次，保留时长，批量改期不改截止',async()=>{
 const {runtime}=browser(),a=await runtime.request('/api/tasks/save',{title:'重复练习',status:'pending',dueAt:'2099-01-31',deadlineAt:'2099-02-01',repeat:'monthly',durationMinutes:35});
 await runtime.request('/api/tasks/status',{id:a.id,status:'done'});await runtime.request('/api/tasks/status',{id:a.id,status:'done'});let tasks=(await runtime.request('/api/state')).tasks;assert.equal(tasks.length,2);const next=tasks.find(t=>t.id!==a.id);assert.equal(next.dueAt,'2099-02-28');assert.equal(next.durationMinutes,35);
 await runtime.request('/api/tasks/bulk',{ids:[next.id],action:'reschedule',options:{dueAt:'2099-03-02'}});tasks=(await runtime.request('/api/state')).tasks;assert.equal(tasks.find(t=>t.id===a.id).deadlineAt,'2099-02-01');assert.equal(tasks.find(t=>t.id===next.id).durationMinutes,35);
});
const jobInput={kind:'chat',input:{group:'合成测试资料',messages:[{sender:'测试',text:'2099年10月8日14:30开会',sentAt:'2099-10-07'}]}};
function extracted(options){const source=JSON.parse(options.body).messages[1].content,ids=JSON.parse(source).messages.map(m=>m.id);return response({tasks:[{title:'合成测试会议',category:'会议',dueAt:'2099-10-08T14:30:00+08:00',precision:'minute',audience:'all',priority:'normal',sourceIds:ids,reason:'合成测试'}],summaries:[{category:'会议',text:'合成摘要',sourceIds:ids}]});}
async function settle(){await new Promise(resolve=>setImmediate(resolve));}
async function finishJob(runtime,kind,input){const j=await runtime.request('/api/ai/jobs/start',{kind,input});for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,10));const s=await runtime.request('/api/ai/jobs/status?id='+j.id);if(s.state==='failed')throw new Error(s.error);if(s.state==='ready')await runtime.request('/api/ai/jobs/commit',{id:j.id});if(s.state==='completed')return s.result;}throw new Error('Job timed out');}
test('无需微信：浏览器独立完成建议、方案、日历确认、反馈及经验导出',async()=>{
 const {runtime,storage}=browser(async(url,options)=>{const b=JSON.parse(options.body);if(b.messages[1].content==='拾事连接测试。')return response({ok:true});if(b.messages[0].content.includes('比较 2 到 3'))return response({suggestions:[{title:'分步练习',method:'先学习再练习',conditions:'每天有空闲',estimatedMinutes:60,resources:['练习资料']}]});return response({goal:'完成练习',resources:['练习资料'],criteria:['完成两部分'],steps:[{title:'学习第一部分',description:'记录重点',minutes:30},{title:'完成练习',description:'检查答案',minutes:30}]});});
 await runtime.request('/api/ai/config',{apiKey:'visitor-test-key'});
 const input={title:'独立方案测试',description:'按两个步骤完成练习',board:'学习',constraints:{startDate:'2099-10-07',startTime:'18:00',endTime:'21:00',dailyMinutes:90,weekdays:[0,1,2,3,4,5,6]}};
 const created=await finishJob(runtime,'problem',input);let state=await runtime.request('/api/state');assert.equal(state.settings.groups.length,0);assert.equal(state.problems[0].suggestions.length,1);
 await finishJob(runtime,'generate',{problemId:created.id,suggestionIds:[state.problems[0].suggestions[0].id]});state=await runtime.request('/api/state');assert.equal(state.tasks.length,0);const draft=state.problems[0].draft;assert.equal(draft.comparison.conflicts.length,0);
 await runtime.request('/api/plans/confirm',{solutionId:draft.id,baseFingerprint:draft.baseFingerprint});state=await runtime.request('/api/state');assert.equal(state.tasks.length,2);const restored=await browser(undefined,storage).runtime.request('/api/state');assert.equal(restored.problems.length,1);assert.equal(restored.tasks.length,2);assert.equal(restored.settings.ai.configured,false);assert(state.tasks.every(t=>t.status==='pending'));assert(state.tasks.every(t=>t.durationMinutes===30));
 await runtime.request('/api/plans/feedback',{problemId:created.id,note:'练习完成',outcome:'resolved',progress:state.tasks.map(t=>({taskId:t.id,progress:'done',actualMinutes:25,difficulty:''}))});
 await runtime.request('/api/plans/share',{problemId:created.id});const experience=await runtime.request('/api/plans/experience',{problemId:created.id});assert.equal(experience.steps.length,2);assert.equal((await runtime.request('/api/state')).problems[0].status,'resolved');assert(![...storage.values()].join('').includes('visitor-test-key'));
});
test('自己的密钥只发给官方接口，不进入存储；刷新和断开后清除',async()=>{
 const calls=[];const {runtime,storage}=browser(async(url,options)=>{calls.push({url,options});return response({ok:true});});
 await runtime.request('/api/ai/config',{apiKey:'visitor-test-key',model:'deepseek-flash'});
 assert.equal(calls[0].url,'https://api.deepseek.com/chat/completions');assert.equal(calls[0].options.headers.Authorization,'Bearer visitor-test-key');assert.equal(calls[0].options.redirect,'error');assert.equal(storage.size,0);
 const state=await runtime.request('/api/state');assert.equal(state.settings.ai.configured,true);assert(!JSON.stringify(state).includes('visitor-test-key'));
 await runtime.request('/api/tasks/save',{title:'独立记录',category:'其他'});assert(![...storage.values()].join('').includes('visitor-test-key'));
 assert.equal((await browser().runtime.request('/api/state')).settings.ai.configured,false);
 await runtime.request('/api/ai/config',{removeKey:true});assert.equal((await runtime.request('/api/state')).settings.ai.configured,false);
});
test('网页批量操作无需 AI，回收站刷新后可恢复，删除停止日历和提醒且不误改其他事务',async()=>{
 const {runtime,storage}=browser();const a=await runtime.request('/api/tasks/save',{title:'合成已安排',status:'pending',dueAt:'2099-10-08T14:30:00+08:00'}),b=await runtime.request('/api/tasks/save',{title:'合成待确认'}),c=await runtime.request('/api/tasks/save',{title:'合成未选事务'});
 await assert.rejects(runtime.request('/api/tasks/bulk',{ids:[a.id,'missing'],action:'delete'}),/不存在/);assert(runtime.calendar().includes('合成已安排'));
 await runtime.request('/api/tasks/bulk',{ids:[a.id,b.id],action:'delete'});assert(!runtime.calendar().includes('合成已安排'));runtime.tick(Date.parse('2099-10-09'));
 assert.equal((await runtime.request('/api/state')).notifications.length,0);const reloaded=browser(undefined,storage).runtime;
 let state=await reloaded.request('/api/state');assert.equal(state.tasks.find(t=>t.id===c.id).status,'inbox');assert.equal(state.tasks.filter(t=>t.status==='deleted').length,2);
 await assert.rejects(reloaded.request('/api/tasks/status',{id:a.id,status:'inbox'}),/状态/);
 await reloaded.request('/api/tasks/bulk',{ids:[a.id,b.id],action:'restore'});state=await reloaded.request('/api/state');assert.equal(state.tasks.find(t=>t.id===a.id).status,'pending');assert.equal(state.tasks.find(t=>t.id===b.id).status,'inbox');assert(reloaded.calendar().includes('合成已安排'));
 await reloaded.request('/api/tasks/bulk',{ids:[b.id],action:'done'});await reloaded.request('/api/tasks/bulk',{ids:[c.id],action:'dismissed'});state=await reloaded.request('/api/state');assert.equal(state.tasks.find(t=>t.id===b.id).status,'done');assert.equal(state.tasks.find(t=>t.id===c.id).status,'dismissed');assert.equal(state.settings.ai.configured,false);
});
test('浏览器方案暂停后取消，迟到的建议不能写入问题或覆盖已有事务',async()=>{
 let finish;
 const {runtime,storage}=browser(async(url,opt)=>JSON.parse(opt.body).messages[1].content==='拾事连接测试。'?response({ok:true}):new Promise(resolve=>finish=resolve));
 await runtime.request('/api/ai/config',{apiKey:'visitor-test-key'});
 await runtime.request('/api/tasks/save',{title:'保留的事务',category:'其他'});
 const before=[...storage.values()].join('');
 const j=await runtime.request('/api/ai/jobs/start',{kind:'problem',input:{title:'取消验收',description:'不会保存的合成问题',board:'学习'}});
 for(let i=0;i<100&&!finish;i++)await new Promise(r=>setTimeout(r,5));
 assert(finish);await runtime.request('/api/ai/jobs/pause',{id:j.id});
 finish(response({suggestions:[{title:'测试方法',method:'测试',conditions:'测试',estimatedMinutes:30,resources:[]}]}));await settle();
 await runtime.request('/api/ai/jobs/cancel',{id:j.id});await settle();
 assert.equal((await runtime.request('/api/state')).problems.length,0);assert.equal([...storage.values()].join(''),before);
});
test('错误密钥不会连接，不回显服务返回的敏感错误正文',async()=>{
 const {runtime,storage}=browser(async()=>({ok:false,status:401,json:async()=>({error:'sensitive-provider-body'})}));
 await assert.rejects(runtime.request('/api/ai/config',{apiKey:'invalid-test-key'}),error=>/API Key 无效/.test(error.message)&&!error.message.includes('sensitive-provider-body'));
 assert.equal((await runtime.request('/api/state')).settings.ai.configured,false);assert.equal(storage.size,0);
});
test('完整结果确认保存后才进入事务箱，来源可回查；未直接改动日历',async()=>{
 const {runtime}=browser(async(url,options)=>JSON.parse(options.body).messages[1].content==='拾事连接测试。'?response({ok:true}):extracted(options));
 await runtime.request('/api/ai/config',{apiKey:'visitor-test-key'});
 const j=await runtime.request('/api/ai/jobs/start',jobInput);await settle();assert.equal((await runtime.request('/api/ai/jobs/status?id='+j.id)).state,'ready');assert.equal((await runtime.request('/api/state')).tasks.length,0);
 await runtime.request('/api/ai/jobs/commit',{id:j.id});await settle();const state=await runtime.request('/api/state');assert.equal(state.tasks[0].status,'inbox');assert.equal(state.summaries.length,1);assert(!runtime.calendar().includes('BEGIN:VEVENT'));
 const sources=await runtime.request('/api/sources?ids='+state.tasks[0].sourceIds[0]);assert.equal(sources[0].text,jobInput.input.messages[0].text);
});
test('暂停和取消丢弃迟到响应，继续保留整理前的记录',async()=>{
 let finish,options;const {runtime}=browser(async(url,opt)=>{if(JSON.parse(opt.body).messages[1].content==='拾事连接测试。')return response({ok:true});options=opt;return new Promise(resolve=>finish=resolve);});
 await runtime.request('/api/ai/config',{apiKey:'visitor-test-key'});await runtime.request('/api/tasks/save',{title:'整理前记录',category:'其他'});
 const j=await runtime.request('/api/ai/jobs/start',jobInput);await settle();await runtime.request('/api/ai/jobs/pause',{id:j.id});finish(extracted(options));await settle();assert.equal((await runtime.request('/api/ai/jobs/status?id='+j.id)).state,'paused');
 await runtime.request('/api/ai/jobs/cancel',{id:j.id});assert.equal((await runtime.request('/api/state')).tasks.length,1);assert.equal((await runtime.request('/api/state')).summaries.length,0);
});
test('网页事务持久化、状态修改及日历导出；日期未知不能直接安排',async()=>{
 const {runtime,storage}=browser();await assert.rejects(runtime.request('/api/tasks/save',{title:'测试',status:'pending'}),/确定日期/);
 const result=await runtime.request('/api/tasks/save',{title:'网页测试,第二行',category:'日程',status:'pending',dueAt:'2099-10-08T14:30:00+08:00',remindMinutes:15,reason:'测试\n备注'});
 assert.equal(storage.size,1);assert.equal((await runtime.request('/api/state')).tasks[0].sourceIds.length,0);assert.match(runtime.calendar(),/DTSTART:20991008T063000Z/);assert.match(runtime.calendar(),/SUMMARY:网页测试\\,第二行/);
 await runtime.request('/api/tasks/status',{id:result.id,status:'done'});assert.equal((await runtime.request('/api/state')).tasks[0].status,'done');assert(!runtime.calendar().includes('BEGIN:VEVENT'));
});
test('网页提醒仅针对本浏览器已安排事务，同一提醒只生成一次',async()=>{
 const {runtime}=browser();await runtime.request('/api/tasks/save',{title:'测试提醒',category:'日程',status:'pending',dueAt:'2099-10-08T14:30:00+08:00',remindMinutes:15});
 runtime.tick(Date.parse('2099-10-08T14:15:00+08:00'));runtime.tick(Date.parse('2099-10-08T14:16:00+08:00'));
 const state=await runtime.request('/api/state');assert.equal(state.notifications.length,1);assert.equal(state.notifications[0].desktop_status,'disabled');await runtime.request('/api/notifications/read',{id:state.notifications[0].id});assert.equal((await runtime.request('/api/state')).notifications[0].read,1);
});


test('跨端恢复后重新完成旧重复事务，不再生成第二份下一次事务',async()=>{
 const {runtime}=browser(),a=await runtime.request('/api/tasks/save',{title:'跨端重复验收',status:'pending',dueAt:'2099-01-31',repeat:'monthly'});
 await runtime.request('/api/tasks/status',{id:a.id,status:'done'});
 const next=(await runtime.request('/api/state')).tasks.find(t=>t.id!==a.id);await runtime.request('/api/tasks/bulk',{ids:[next.id],action:'reschedule',options:{dueAt:'2099-03-02'}});
 const target=createStore(':memory:');createPlanner(target);importBackup(target,await runtime.request('/api/data/export'));
 target.setStatus(a.id,'inbox');target.setStatus(a.id,'done');assert.equal(target.listTasks().length,2);
 target.db.close();
});
