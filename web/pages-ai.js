/* Visitor credentials stay in this closure and are sent only to DeepSeek. */
(() => {
 const provider=window.ShishiProvider,jobs=provider.createAIJobs();
 let credential='',model=provider.DEFAULT_MODEL,lastTestedAt=null,connecting=false;
 function status(){return {configured:!!credential,enabled:!!credential,model,lastTestedAt};}
 async function connect(input){
  if(connecting)throw new Error('正在验证连接，请稍候');
  if(input.removeKey){jobs.dispose();credential='';lastTestedAt=null;return {ok:true};}
  const candidate=String(input.apiKey||'').trim(),nextModel=input.model||provider.DEFAULT_MODEL;
  if(!candidate||candidate.length>200||/\s/.test(candidate))throw new Error('请填写有效的 DeepSeek API Key');
  if(!provider.MODELS.includes(nextModel))throw new Error('请选择支持的模型');
  connecting=true;
  try{await provider.testDeepSeek({apiKey:candidate,model:nextModel});jobs.dispose();credential=candidate;model=nextModel;lastTestedAt=new Date().toISOString();return {ok:true};}
  finally{connecting=false;}
 }
 async function test(){if(!credential)throw new Error('请先输入 API Key 并连接 DeepSeek');await provider.testDeepSeek({apiKey:credential,model});lastTestedAt=new Date().toISOString();return {ok:true};}
 function start(input,save,planJob){
  if(!credential)throw new Error('请先在连接设置中输入 API Key 并连接 DeepSeek');
  if(['problem','suggest','generate'].includes(input.kind)){
   const apiKey=credential,selectedModel=model;
   return jobs.start('page',control=>planJob(input.kind,input.input,{...control,apiKey,model:selectedModel}),'DeepSeek 正在整理方案…');
  }
  if(input.kind!=='chat')throw new Error('这项文件整理请使用桌面版');
  const value=input.input,group=String(value?.group||'').trim();
  if(!group||group.length>120||!Array.isArray(value.messages)||!value.messages.length||value.messages.length>300)throw new Error('请填写来源名称和最多 300 条文字');
  let size=0;
  const messages=value.messages.map(m=>{
   const text=String(m.text||'').trim(),date=String(m.sentAt||'');size+=text.length;
   if(!text||text.length>24000||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new Error('请填写有效的消息日期和文字');
   const sender=String(m.sender||'未识别').slice(0,80);return {id:window.ShishiPlannerCore.stableBrowserId(group,sender,date,text),text,sender,sentAt:date};
  });
  if(size>60000)throw new Error('文字超过 60000 字，请分批整理');
  const apiKey=credential,selectedModel=model;
  return jobs.start('page',async control=>{
   const result=await provider.extractDeepSeek(messages,{group,categories:['公告','会议','文件','费用','日程','其他'],apiKey,model:selectedModel,signal:control.signal});
   await control.beforeCommit();control.signal.throwIfAborted();
   return save(result,messages,group);
  },'DeepSeek 正在整理你提交的文字…');
 }
 function action(action,id){if(!['status','pause','resume','cancel','commit'].includes(action))throw new Error('整理操作不正确');return jobs[action](id,'page');}
 window.ShishiPagesAI=Object.freeze({status,connect,test,start,action});
})();
