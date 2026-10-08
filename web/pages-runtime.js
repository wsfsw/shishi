/* The published site contains no preset credentials or desktop data. */
(() => {
 const key='shishi.pages.data.v1',categories=['公告','会议','文件','费用','日程','其他'];
 const clone=value=>JSON.parse(JSON.stringify(value));
 let saved={tasks:[],notifications:[],reminded:{},messages:[],summaries:[],planning:null};
 try{const value=JSON.parse(localStorage.getItem(key)||'null');if(value&&Array.isArray(value.tasks)&&Array.isArray(value.notifications))saved={tasks:value.tasks,notifications:value.notifications,reminded:value.reminded||{},planning:value.planning||null,messages:Array.isArray(value.messages)?value.messages:[],summaries:Array.isArray(value.summaries)?value.summaries:[],runs:value.runs||[]};}catch{}
 function persist(next){try{localStorage.setItem(key,JSON.stringify(next));}catch{throw new Error('浏览器无法保存事务，请检查存储权限或空间。');}saved=next;}
 function tick(now=Date.now()){
  const next=clone(saved);let changed=false;
  for(const t of next.tasks){
   if(t.status!=='pending'||!t.dueAt)continue;
   const at=Date.parse(t.precision==='date'?t.dueAt+'T09:00:00+08:00':t.dueAt)-(t.precision==='date'?0:t.remindMinutes*60000);
   const signature=t.dueAt+'|'+t.remindMinutes;
   if(!Number.isFinite(at)||at>now||next.reminded[t.id]===signature)continue;
   if(next.notifications.some(n=>n.task_id===t.id&&Date.parse(n.scheduled_at)===at)){next.reminded[t.id]=signature;changed=true;continue;}
   next.notifications.unshift({id:crypto.randomUUID(),task_id:t.id,title:t.title,body:'网页事务提醒：'+t.title,scheduled_at:new Date(at).toISOString(),created_at:new Date(now).toISOString(),read:0,desktop_status:'disabled'});
   next.reminded[t.id]=signature;changed=true;
  }
  if(changed)persist(next);
 }
 async function request(url,input){
  if(input===undefined&&url==='/api/state'){
   tick();return clone({tasks:saved.tasks,runs:saved.runs||[],summaries:saved.summaries,problems:await window.ShishiPagesPlans.state(saved),notifications:saved.notifications,settings:{groups:[],categories,nickname:'',messageDateRange:{start:null,end:null},desktopEnabled:false,syncEnabled:false,allDayReminderTime:'09:00',ai:window.ShishiPagesAI.status(),bridgeStatus:{state:'blocked',provider:'pages',message:'点击连接本机微信，在 Windows 本机页选择群聊。'},lastSync:null}});
  }
  if(input===undefined&&url.startsWith('/api/sources?')){const ids=new URLSearchParams(url.split('?')[1]).get('ids')?.split(',')||[];return clone(saved.messages.filter(m=>ids.includes(m.id)));}
  if(url==='/api/ai/config')return window.ShishiPagesAI.connect(input);
  if(url==='/api/ai/test')return window.ShishiPagesAI.test();
  if(url==='/api/ai/jobs/start')return window.ShishiPagesAI.start(input,(result,messages,group)=>window.ShishiPagesPlans.request('ingest',{...result,messages,group},()=>saved,persist),(kind,input,options)=>window.ShishiPagesPlans.job(kind,input,options,()=>saved,persist));
  if(url.startsWith('/api/ai/jobs/')){const action=url.slice('/api/ai/jobs/'.length).split('?')[0],id=input?.id||new URLSearchParams(url.split('?')[1]).get('id');return window.ShishiPagesAI.action(action,id);}
  if(url.startsWith('/api/plans/'))return window.ShishiPagesPlans.request(url.slice('/api/plans/'.length),input,()=>saved,persist);
  if(url==='/api/tasks/bulk')return window.ShishiPagesPlans.request('bulk',input,()=>saved,persist);
  if(url==='/api/tasks/save')return window.ShishiPagesPlans.request('save',input,()=>saved,persist);
  if(url==='/api/tasks/status')return window.ShishiPagesPlans.request('status',input,()=>saved,persist);
  if(url==='/api/data/export')return window.ShishiPagesPlans.request('export',{},()=>saved,persist);
  if(url==='/api/data/preview')return window.ShishiPagesPlans.request('previewBackup',input,()=>saved,persist);
  if(url==='/api/data/import')return window.ShishiPagesPlans.request('importBackup',input,()=>saved,persist);
  if(url==='/api/data/backups')return {files:localStorage.getItem('shishi.pages.before-import.v1')?['before-import']:[]};
  if(url==='/api/data/automatic-export'){const value=localStorage.getItem('shishi.pages.before-import.v1');if(input.name!=='before-import'||!value)throw new Error('没有导入前备份');return JSON.parse(value);}
  const next=clone(saved);
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
