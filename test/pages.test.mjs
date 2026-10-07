import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {browserShared} from '../scripts/browser-shared.mjs';
function browser(fetchImpl){const storage=new Map();const context=vm.createContext({window:{},crypto:{randomUUID},URLSearchParams,AbortController,AbortSignal,fetch:fetchImpl||(()=>{throw new Error('Unexpected network call');}),localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});vm.runInContext(browserShared(),context);for(const file of ['pages-ai.js','pages-runtime.js'])vm.runInContext(fs.readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),context);return {runtime:context.window.ShishiPages,storage};}
test('网页从空数据开始，拒绝自动微信读取；没有预置账号和密钥',async()=>{
 const {runtime,storage}=browser();const state=await runtime.request('/api/state');assert.equal(state.tasks.length,0);assert.equal(state.settings.groups.length,0);assert.equal(state.settings.ai.configured,false);assert.equal(state.settings.syncEnabled,false);assert.equal(storage.size,0);
 await assert.rejects(runtime.request('/api/sync/request',{}),/本机版/);
 await assert.rejects(runtime.request('/api/ai/jobs/start',{kind:'chat',input:{}}),/API Key/);
 assert.equal(storage.size,0);
});
function response(content){return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]})};}
const jobInput={kind:'chat',input:{group:'合成测试资料',messages:[{sender:'测试',text:'2099年10月8日14:30开会',sentAt:'2099-10-07'}]}};
function extracted(options){const source=JSON.parse(options.body).messages[1].content,ids=JSON.parse(source).messages.map(m=>m.id);return response({tasks:[{title:'合成测试会议',category:'会议',dueAt:'2099-10-08T14:30:00+08:00',precision:'minute',audience:'all',priority:'normal',sourceIds:ids,reason:'合成测试'}],summaries:[{category:'会议',text:'合成摘要',sourceIds:ids}]});}
async function settle(){await new Promise(resolve=>setImmediate(resolve));}
test('自己的密钥只发给官方接口，不进入存储；刷新和断开后清除',async()=>{
 const calls=[];const {runtime,storage}=browser(async(url,options)=>{calls.push({url,options});return response({ok:true});});
 await runtime.request('/api/ai/config',{apiKey:'visitor-test-key',model:'deepseek-flash'});
 assert.equal(calls[0].url,'https://api.deepseek.com/chat/completions');assert.equal(calls[0].options.headers.Authorization,'Bearer visitor-test-key');assert.equal(calls[0].options.redirect,'error');assert.equal(storage.size,0);
 const state=await runtime.request('/api/state');assert.equal(state.settings.ai.configured,true);assert(!JSON.stringify(state).includes('visitor-test-key'));
 await runtime.request('/api/tasks/save',{title:'独立记录',category:'其他'});assert(![...storage.values()].join('').includes('visitor-test-key'));
 assert.equal((await browser().runtime.request('/api/state')).settings.ai.configured,false);
 await runtime.request('/api/ai/config',{removeKey:true});assert.equal((await runtime.request('/api/state')).settings.ai.configured,false);
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
