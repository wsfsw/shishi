/* The published site contains no preset credentials or desktop data. */
(() => {
 const key='shishi.pages.data.v1',categories=['公告','会议','文件','费用','日程','其他'];
 const clone=value=>JSON.parse(JSON.stringify(value));
 let saved={tasks:[],notifications:[],reminded:{},messages:[],summaries:[],planning:null};
 try{const value=JSON.parse(localStorage.getItem(key)||'null');if(value&&Array.isArray(value.tasks)&&Array.isArray(value.notifications))saved={tasks:value.tasks,notifications:value.notifications,reminded:value.reminded||{},planning:value.planning||null,messages:Array.isArray(value.messages)?value.messages:[],summaries:Array.isArray(value.summaries)?value.summaries:[]};}catch{}
 function persist(next){try{localStorage.setItem(key,JSON.stringify(next));}catch{throw new Error('浏览器无法保存事务，请检查存储权限或空间。');}saved=next;}
 function tick(now=Date.now()){
  const next=clone(saved);let changed=false;
  for(const t of next.tasks){
   if(t.status!=='pending'||!t.dueAt)continue;
   const at=Date.parse(t.precision==='date'?t.dueAt+'T09:00:00+08:00':t.dueAt)-t.remindMinutes*60000;
   const signature=t.dueAt+'|'+t.remindMinutes;
   if(!Number.isFinite(at)||at>now||next.reminded[t.id]===signature)continue;
   next.notifications.unshift({id:crypto.randomUUID(),task_id:t.id,title:t.title,body:'网页事务提醒：'+t.title,created_at:new Date(now).toISOString(),read:0,desktop_status:'disabled'});
   next.reminded[t.id]=signature;changed=true;
  }
  if(changed)persist(next);
 }
 function validate(input){
  const title=String(input.title||'').trim();if(!title||title.length>200)throw new Error('请填写 200 字以内的事项标题');
  const status=input.status||'inbox';if(!['inbox','pending','done','dismissed'].includes(status))throw new Error('事务状态不正确');
  const dueAt=input.dueAt||null,precision=dueAt?(dueAt.length===10?'date':'minute'):'uncertain';
  if(dueAt){const date=dueAt.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||(precision==='minute'&&!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:00\+08:00$/.test(dueAt)))throw new Error('日期格式不正确');}
  if(status==='pending'&&!dueAt)throw new Error('加入日历前请确定日期');
  const remindMinutes=input.remindMinutes??15;if(!Number.isInteger(remindMinutes)||remindMinutes<0||remindMinutes>10080)throw new Error('提醒间隔不正确');
  if(!categories.includes(input.category||'其他'))throw new Error('分类不正确');
  return {title,status,dueAt,precision,remindMinutes,category:input.category||'其他',priority:input.priority==='high'?'high':'normal',reason:String(input.reason||'').slice(0,2000)};
 }
 async function request(url,input){
  if(input===undefined&&url==='/api/state'){
   tick();return clone({tasks:saved.tasks,summaries:saved.summaries,problems:await window.ShishiPagesPlans.state(saved),notifications:saved.notifications,settings:{groups:[],categories,nickname:'',messageDateRange:{start:null,end:null},desktopEnabled:false,syncEnabled:false,allDayReminderTime:'09:00',ai:window.ShishiPagesAI.status(),bridgeStatus:{state:'blocked',provider:'pages',message:'点击连接本机微信，在 Windows 本机页选择群聊。'},lastSync:null}});
  }
  if(input===undefined&&url.startsWith('/api/sources?')){const ids=new URLSearchParams(url.split('?')[1]).get('ids')?.split(',')||[];return clone(saved.messages.filter(m=>ids.includes(m.id)));}
  if(url==='/api/ai/config')return window.ShishiPagesAI.connect(input);
  if(url==='/api/ai/test')return window.ShishiPagesAI.test();
  if(url==='/api/ai/jobs/start')return window.ShishiPagesAI.start(input,(result,messages,group)=>{
   const next=clone(saved),createdAt=new Date().toISOString();
   const tasks=result.tasks.map(t=>({id:crypto.randomUUID(),...validate({...t,status:'inbox',remindMinutes:15}),audience:t.audience,sourceIds:t.sourceIds,group,createdAt}));
   next.tasks.unshift(...tasks);
   next.messages.push(...messages.map(m=>({id:m.id,text:m.text,sender:m.sender,sent_at:m.sentAt,group_name:group})));
   next.summaries.unshift(...result.summaries.map(s=>({...s,id:crypto.randomUUID(),group_name:group,created_at:createdAt})));
   persist(next);return {ok:true,message:'已整理 '+tasks.length+' 条事务，请核对后加入日历'};
  },(kind,input,options)=>window.ShishiPagesPlans.job(kind,input,options,()=>saved,persist));
  if(url.startsWith('/api/ai/jobs/')){const action=url.slice('/api/ai/jobs/'.length).split('?')[0],id=input?.id||new URLSearchParams(url.split('?')[1]).get('id');return window.ShishiPagesAI.action(action,id);}
  if(url.startsWith('/api/plans/'))return window.ShishiPagesPlans.request(url.slice('/api/plans/'.length),input,()=>saved,persist);
  if(url==='/api/tasks/bulk')return window.ShishiPagesPlans.request('bulk',input,()=>saved,persist);
  const next=clone(saved);
  if(url==='/api/tasks/save'){
   const fields=validate(input),id=input.id||crypto.randomUUID(),existing=next.tasks.find(t=>t.id===id);
   if(input.id&&(!existing||existing.status==='deleted'))throw new Error('事务不存在或已在回收站，请先恢复');
   if(existing)Object.assign(existing,fields);else next.tasks.unshift({id,...fields,group:'手动添加',sourceIds:[],audience:'self',createdAt:new Date().toISOString()});
   persist(next);return {ok:true,id};
  }
  if(url==='/api/tasks/status'){
   const task=next.tasks.find(t=>t.id===input.id);if(!task||task.status==='deleted'||!['done','dismissed','inbox'].includes(input.status))throw new Error('事务状态不正确');
   task.status=input.status;persist(next);return {ok:true};
  }
  if(url==='/api/notifications/read'){
   const notification=next.notifications.find(n=>n.id===input.id);if(!notification)throw new Error('提醒不存在');
   notification.read=1;persist(next);return {ok:true};
  }
  if(url==='/api/notifications/snooze')throw new Error('网页版暂不支持延后提醒，请修改事务时间。');
  throw new Error('这项功能需要 Windows 本机版；请点击连接本机微信。');
 }
 function calendar(){
  const escape=v=>String(v||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Shishi//Browser Tasks//ZH','CALSCALE:GREGORIAN'];
  for(const t of saved.tasks.filter(t=>t.status==='pending'&&t.dueAt)){
   lines.push('BEGIN:VEVENT','UID:'+t.id+'@shishi.pages','DTSTAMP:'+stamp,t.precision==='date'?'DTSTART;VALUE=DATE:'+t.dueAt.replaceAll('-',''):'DTSTART:'+new Date(t.dueAt).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''));
   if(t.precision==='minute'&&t.durationMinutes)lines.push('DTEND:'+new Date(Date.parse(t.dueAt)+t.durationMinutes*60000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''));
   lines.push('SUMMARY:'+escape(t.title),'DESCRIPTION:'+escape(t.reason),'END:VEVENT');
  }
  return lines.concat('END:VCALENDAR','').join('\r\n');
 }
 window.ShishiPages=Object.freeze({request,calendar,tick});
})();
