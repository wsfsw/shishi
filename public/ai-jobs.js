document.body.insertAdjacentHTML('beforeend',`<dialog id="ai-job-dialog" aria-labelledby="ai-job-title" aria-describedby="ai-job-help"><div class="ai-job-heading"><span class="ai-job-orbit" aria-hidden="true"></span><div><p class="eyebrow">整理进行中</p><h2 id="ai-job-title">AI 正在整理</h2></div></div><p id="ai-job-progress" class="ai-job-progress" role="status" aria-live="polite">正在准备…</p><p id="ai-job-help" class="hint">结果完整后才保存。可以暂停，或结束这轮整理并保留之前的数据与输入。</p><p id="ai-job-error" class="error" role="alert"></p><div class="ai-job-controls"><button type="button" class="button secondary" id="ai-job-pause">暂停整理</button><button type="button" class="button secondary ai-job-stop" id="ai-job-stop">结束并恢复之前状态</button></div></dialog>`);
let activeAIJob=null;
const aiJobDelay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class AIJobCancelled extends Error{constructor(){super('本轮整理已结束，之前的数据和输入已保留');this.code='AI_CANCELLED';}}
function paintAIJob(job){const active=activeAIJob;if(!active)return;active.state=job.state;if(job.restartOnResume!==undefined)active.restartOnResume=job.restartOnResume;$('#ai-job-dialog').dataset.state=job.state;$('#ai-job-progress').textContent=job.progress||'正在整理…';const paused=job.state==='paused';$('#ai-job-pause').textContent=paused?'继续整理':'暂停整理';$('#ai-job-pause').disabled=active.actionPending||['committing','completed','cancelled','failed'].includes(job.state);$('#ai-job-stop').disabled=active.actionPending||['committing','completed','cancelled'].includes(job.state);$('#ai-job-help').textContent=paused?(job.restartOnResume?'已暂停当前请求；继续时重新处理本轮未完成内容。日历和事务箱尚未改变。':'已暂停保存，完整结果暂存中。继续会保存结果，结束会丢弃这轮结果。'):'结果完整后才保存。结束会丢弃本轮未保存的结果，并保留整理前的数据与输入。';}
async function controlAIJob(action){const active=activeAIJob;if(!active||active.actionPending)return;active.actionPending=true;if(action==='pause')active.paused=true;if(action==='resume')active.paused=false;if(action==='cancel')active.cancelled=true;$('#ai-job-error').textContent='';$('#ai-job-pause').disabled=true;$('#ai-job-stop').disabled=true;try{if(active.id)paintAIJob(await api('/api/ai/jobs/'+action,{id:active.id}));else $('#ai-job-progress').textContent=action==='cancel'?'正在结束这轮整理…':'正在暂停…';}catch(error){active.cancelled=false;active.paused=active.state==='paused';$('#ai-job-error').textContent=error.message;}finally{active.actionPending=false;paintAIJob({state:active.state||'running',progress:$('#ai-job-progress').textContent,restartOnResume:active.restartOnResume});}}
$('#ai-job-pause').addEventListener('click',()=>controlAIJob(activeAIJob?.paused?'resume':'pause'));
$('#ai-job-stop').addEventListener('click',()=>controlAIJob('cancel'));
$('#ai-job-dialog').addEventListener('cancel',e=>{e.preventDefault();if(activeAIJob&&!activeAIJob.paused)controlAIJob('pause');});
async function runAIJob(kind,input,{title='AI 正在整理'}={}){
 if(activeAIJob)throw new Error('请先继续或结束当前整理');
 const active={id:null,state:'running',paused:false,cancelled:false,actionPending:false};activeAIJob=active;$('#ai-job-title').textContent=title;$('#ai-job-error').textContent='';paintAIJob({state:'running',progress:'正在准备所选内容…'});$('#ai-job-dialog').showModal();
 try{
  let job=await api('/api/ai/jobs/start',{kind,input});active.id=job.id;
  if(active.cancelled)job=await api('/api/ai/jobs/cancel',{id:active.id});else if(active.paused)job=await api('/api/ai/jobs/pause',{id:active.id});
  while(true){
   if(active.actionPending){await aiJobDelay(100);continue;}
   job=await api('/api/ai/jobs/status?id='+encodeURIComponent(active.id));
   if(active.actionPending)continue;
   paintAIJob(job);
   if(job.state==='cancelled')throw new AIJobCancelled();
   if(job.state==='failed')throw new Error(job.error||'整理失败，本轮结果尚未保存');
   if(job.state==='completed')return job.result;
   if(job.state==='ready'&&!active.paused&&!active.cancelled){paintAIJob(await api('/api/ai/jobs/commit',{id:active.id}));}
   await aiJobDelay(350);
  }
 }finally{activeAIJob=null;$('#ai-job-dialog').close();}
}
