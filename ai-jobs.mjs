import {randomBytes} from 'node:crypto';

// Work stays read-only until the browser commits a ready job. Stale attempts
// cannot write after pause/cancel, even if the provider ignores cancellation.
export function createAIJobs({idleMs=5*60_000,now=Date.now}={}){
 const jobs=new Map();
 const stopped=()=>Object.assign(new Error('本轮整理已停止，尚未保存结果'),{code:'AI_STOPPED'});
 function get(id,owner){const j=jobs.get(id);if(!j||j.owner!==owner)throw new Error('这轮整理已失效，请重新开始；未完成的结果没有保存');j.seen=now();return j;}
 const state=j=>({id:j.id,state:j.state,progress:j.progress,error:j.error||null,result:j.state==='completed'?j.result:undefined,restartOnResume:j.state==='paused'&&!j.gate});
 function run(j){const attempt=++j.attempt,controller=new AbortController();j.controller=controller;j.state='running';j.progress=j.initialProgress;
  const current=()=>{controller.signal.throwIfAborted();if(j.attempt!==attempt||!['running','ready','committing','paused'].includes(j.state))throw stopped();};
  const control={signal:controller.signal,onProgress(message){current();if(j.state==='running')j.progress=message;},beforeCommit(){current();if(j.state!=='running')throw stopped();j.state='ready';j.progress='整理已完成，正在准备保存';return new Promise((resolve,reject)=>{j.gate={resolve:()=>{current();resolve();},reject};});}};
  Promise.resolve().then(()=>j.runner(control)).then(result=>{if(j.attempt!==attempt)return;current();if(j.state!=='committing')throw new Error('整理结果未经过保存确认');j.state='completed';j.result=result;j.runner=null;j.gate=null;j.controller=null;j.progress='整理完成，结果已保存';}).catch(error=>{if(j.attempt!==attempt||['paused','cancelled'].includes(j.state))return;j.state='failed';j.error=error.message;j.runner=null;j.gate=null;j.controller=null;});
 }
 function start(owner,runner,progress='正在整理…'){cleanup();if([...jobs.values()].some(j=>j.owner===owner&&['running','ready','paused','committing'].includes(j.state)))throw new Error('请先继续或结束正在进行的整理');if([...jobs.values()].filter(j=>j.runner).length>=8)throw new Error('当前整理任务较多，请稍后再试');const j={id:randomBytes(16).toString('hex'),owner,runner,initialProgress:progress,seen:now(),attempt:0};jobs.set(j.id,j);run(j);return state(j);}
 function pause(id,owner){const j=get(id,owner);if(j.state==='paused')return state(j);if(!['running','ready'].includes(j.state))throw new Error('结果已保存或整理已结束，无法暂停');const hadResult=j.state==='ready';j.state='paused';j.progress=hadResult?'已暂停保存，结果暂存中':'已暂停；继续时重新整理本轮未完成内容';if(!hadResult){++j.attempt;j.controller.abort(stopped());j.controller=null;}return state(j);}
 function resume(id,owner){const j=get(id,owner);if(j.state!=='paused')throw new Error('这轮整理未处于暂停状态');if(j.gate){j.state='ready';j.progress='整理已完成，正在准备保存';}else run(j);return state(j);}
 function cancel(id,owner){const j=get(id,owner);if(j.state==='cancelled')return state(j);if(['completed','committing'].includes(j.state))throw new Error('这轮结果已经保存，不能作为未完成整理撤回');j.state='cancelled';++j.attempt;j.controller?.abort(stopped());j.gate?.reject(stopped());j.runner=null;j.gate=null;j.controller=null;j.progress='已结束，保留整理前的数据和输入';return state(j);}
 function commit(id,owner){const j=get(id,owner);if(j.state!=='ready')throw new Error('请先完成或继续本轮整理');j.state='committing';j.progress='正在保存完整结果';const gate=j.gate;j.gate=null;gate.resolve();return state(j);}
 function cleanup(){for(const [id,j] of jobs){if(now()-j.seen<idleMs)continue;if(!['completed','cancelled','failed','committing'].includes(j.state))cancel(id,j.owner);if(j.state!=='committing')jobs.delete(id);}}
 function dispose(){for(const j of jobs.values())if(!['completed','committing'].includes(j.state))cancel(j.id,j.owner);jobs.clear();}
 return {start,pause,resume,cancel,commit,status:(id,owner)=>state(get(id,owner)),cleanup,dispose};
}
