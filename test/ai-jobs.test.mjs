import test from 'node:test';
import assert from 'node:assert/strict';
import {createAIJobs} from '../ai-jobs.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(jobs,id,state){for(let i=0;i<100;i++){const result=jobs.status(id,'browser');if(result.state===state)return result;await tick();}throw new Error('Job did not reach '+state);}

test('暂停已算完的结果仍不写入，继续并提交后只保存一次',async()=>{
 const jobs=createAIJobs();let writes=0,runs=0;
 const job=jobs.start('browser',async control=>{runs++;await control.beforeCommit();writes++;return {added:1};});
 await until(jobs,job.id,'ready');assert.equal(writes,0);jobs.pause(job.id,'browser');await tick();assert.equal(writes,0);assert.equal(jobs.status(job.id,'browser').restartOnResume,false);
 assert.throws(()=>jobs.commit(job.id,'browser'),/继续/);jobs.resume(job.id,'browser');jobs.commit(job.id,'browser');assert.deepEqual((await until(jobs,job.id,'completed')).result,{added:1});assert.equal(writes,1);assert.equal(runs,1);assert.throws(()=>jobs.cancel(job.id,'browser'),/已经保存/);
});

test('请求进行中暂停会中断；供应商迟到的回复不能越过停止保护',async()=>{
 const jobs=createAIJobs(),replies=[];let writes=0,attempts=0,signals=[];
 const job=jobs.start('browser',async control=>{attempts++;signals.push(control.signal);await new Promise(resolve=>replies.push(resolve));await control.beforeCommit();writes++;return {ok:true};});
 await tick();jobs.pause(job.id,'browser');assert(signals[0].aborted);assert.equal(jobs.status(job.id,'browser').restartOnResume,true);jobs.resume(job.id,'browser');await tick();replies[0]();await tick();assert.equal(jobs.status(job.id,'browser').state,'running');assert.equal(writes,0);
 replies[1]();await until(jobs,job.id,'ready');jobs.commit(job.id,'browser');await until(jobs,job.id,'completed');assert.equal(writes,1);assert.equal(attempts,2);
});

test('结束进行中或暂存中的整理，永不提交结果，也不影响其他会话',async()=>{
 const jobs=createAIJobs();let writes=0;
 const job=jobs.start('browser',async control=>{await control.beforeCommit();writes++;});await until(jobs,job.id,'ready');assert.throws(()=>jobs.cancel(job.id,'other'),/失效/);assert.throws(()=>jobs.status(job.id,'other'),/失效/);jobs.cancel(job.id,'browser');await tick();assert.equal(jobs.status(job.id,'browser').state,'cancelled');assert.equal(writes,0);assert.throws(()=>jobs.commit(job.id,'browser'),/完成/);
 let reply;const running=jobs.start('browser',async control=>{await new Promise(resolve=>reply=resolve);await control.beforeCommit();writes++;});await tick();jobs.cancel(running.id,'browser');reply();await tick();assert.equal(writes,0);
});

test('浏览器离开后过期未保存任务会结束；拒绝重复启动',async()=>{
 let clock=0;const jobs=createAIJobs({idleMs:100,now:()=>clock});let writes=0;const job=jobs.start('browser',async control=>{await control.beforeCommit();writes++;});await until(jobs,job.id,'ready');assert.throws(()=>jobs.start('browser',async()=>{}),/先继续/);clock=101;jobs.cleanup();await tick();assert.equal(writes,0);assert.throws(()=>jobs.status(job.id,'browser'),/失效/);
});
