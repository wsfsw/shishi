import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {createStore} from './store.mjs';
import {extractMessages,idFor} from './extract.mjs';
import {tickReminders,desktopNotify,snoozeNotification} from './reminders.mjs';
import {createSecrets} from './secrets.mjs';
import {extractDeepSeek,testDeepSeek,DEFAULT_MODEL,MODELS} from './deepseek.mjs';
import {startBackgroundCollector} from './background-supervisor.mjs';
import {normalizeDateRange,messageInDateRange,sameDateRange} from './message-date-range.mjs';
import {uploadedFile,organizeFile} from './file-import.mjs';
import {createPlanner} from './planning.mjs';
import {createAIJobs} from './ai-jobs.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.SHISHI_DATA_DIR||path.join(root,'data');fs.mkdirSync(dataDir,{recursive:true});
const tokenFile=path.join(dataDir,'agent-token');if(!fs.existsSync(tokenFile))fs.writeFileSync(tokenFile,randomBytes(32).toString('hex'),{mode:0o600});
const agentToken=fs.readFileSync(tokenFile,'utf8').trim();const store=createStore(path.join(dataDir,'shishi.sqlite'));
const secrets=createSecrets(dataDir);
const planner=createPlanner(store);
const aiJobs=createAIJobs();
function aiSettings(){return {enabled:store.setting('deepseekEnabled',true),model:store.setting('deepseekModel',DEFAULT_MODEL),configured:secrets.configured(),...store.setting('deepseekStatus',{})};}
const port=Number(process.env.PORT||4317);const origin=`http://127.0.0.1:${port}`;const sessions=new Set();const sessionCookie=`shishi_session_${port}`;
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function validToken(value){return typeof value==='string'&&value.length===agentToken.length&&timingSafeEqual(Buffer.from(value),Buffer.from(agentToken));}
async function body(req,maxBytes=2_000_000){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw new Error(maxBytes>2_000_000?'单个文件不能超过 10MB':'内容超过 2MB，请分批整理');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
const activeFileImports=new Set();
function settings(){return {messageDateRange:store.setting('messageDateRange',{start:null,end:null}),ai:aiSettings(),nickname:store.setting('nickname',''),categories:store.setting('categories',['公告','会议','文件','费用','日程','其他']),allDayReminderTime:store.setting('allDayReminderTime','09:00'),desktopEnabled:store.setting('desktopEnabled',true),syncEnabled:store.setting('syncEnabled',true),groups:store.db.prepare('SELECT * FROM groups ORDER BY name').all(),lastSync:store.setting('lastSync',null),bridgeStatus:store.setting('bridgeStatus',{state:'waiting',message:'群聊列表正在等待桌面发现'}),discoveryRequestedAt:store.setting('discoveryRequestedAt',null),syncRequestedAt:store.setting('syncRequestedAt',null),pollMinutes:30};}
function validText(v,max=200){return typeof v==='string'&&v.trim().length>0&&v.length<=max;}
function validateDue(due,precision){if(!due)return precision==='uncertain';if(typeof due!=='string')return false;const date=due.slice(0,10),validDate=/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(new Date(date).getTime())&&new Date(date).toISOString().slice(0,10)===date;if(!validDate)return false;if(precision==='date')return due===date;return precision==='minute'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\+08:00$/.test(due);}
async function api(req,res,url,agent,owner){const pathname=url.pathname;
 if(req.method==='GET'&&pathname==='/api/ai/jobs/status'){if(agent)throw new Error('请在项目页面操作整理');return json(res,200,aiJobs.status(url.searchParams.get('id'),owner));}
 if(req.method==='GET'&&pathname==='/api/plans/experience.json'){if(agent)throw new Error('请在方案与复盘页面导出');const experience=planner.experience(url.searchParams.get('problemId'));res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="shishi-experience.json"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(JSON.stringify(experience,null,2));}
 if(req.method==='GET'&&pathname==='/api/state')return json(res,200,{tasks:store.listTasks().map(t=>({...t,durationMinutes:store.db.prepare('SELECT minutes FROM plan_tasks WHERE task_id=?').get(t.id)?.minutes||null})),problems:planner.state(),summaries:store.db.prepare('SELECT * FROM summaries ORDER BY created_at DESC LIMIT 200').all().map(s=>({...s,sourceIds:JSON.parse(s.source_ids)})),notifications:store.db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100').all(),settings:settings()});
 if(req.method==='GET'&&pathname==='/api/bridge/context')return json(res,200,{...settings(),tasks:store.listTasks().filter(t=>t.status!=='done'),recentMessages:store.db.prepare('SELECT id,group_name,sender,text,sent_at FROM messages ORDER BY captured_at DESC LIMIT 300').all()});
 if(req.method==='GET'&&pathname==='/api/sources'){const ids=(url.searchParams.get('ids')||'').split(',').filter(Boolean).slice(0,100);return json(res,200,ids.map(id=>store.db.prepare('SELECT * FROM messages WHERE id=?').get(id)).filter(Boolean));}
 if(req.method==='GET'&&pathname==='/api/calendar.ics'){const escape=v=>String(v||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Shishi//WeChat Inbox//ZH','CALSCALE:GREGORIAN','X-WR-TIMEZONE:Asia/Shanghai'];for(const t of store.listTasks().filter(t=>t.status==='pending'&&t.dueAt)){lines.push('BEGIN:VEVENT',`UID:${t.id}@shishi.local`,`DTSTAMP:${stamp}`);if(t.precision==='date')lines.push(`DTSTART;VALUE=DATE:${t.dueAt.replaceAll('-','')}`);else lines.push('DTSTART:'+new Date(t.dueAt).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''));const duration=store.db.prepare('SELECT minutes FROM plan_tasks WHERE task_id=?').get(t.id)?.minutes;if(t.precision==='minute'&&duration)lines.push('DTEND:'+new Date(Date.parse(t.dueAt)+duration*60000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''));lines.push('SUMMARY:'+escape(t.title),'DESCRIPTION:'+escape((t.group?'来自 '+t.group+'\n':'')+t.reason));if(t.precision==='minute')lines.push('BEGIN:VALARM',`TRIGGER:-PT${t.remindMinutes}M`,'ACTION:DISPLAY','DESCRIPTION:'+escape(t.title),'END:VALARM');lines.push('END:VEVENT');}lines.push('END:VCALENDAR');res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="shishi-calendar.ics"'});return res.end(lines.join('\r\n')+'\r\n');}
 if(req.method!=='POST')return json(res,404,{error:'没有这个接口'});const input=await body(req,['/api/files/import','/api/plans/create','/api/ai/jobs/start'].includes(pathname)?15_000_000:2_000_000);
 if(pathname.startsWith('/api/ai/jobs/')){
  if(agent)throw new Error('请在项目页面操作整理');
  if(pathname==='/api/ai/jobs/start'){
   if(!['file','chat','problem','suggest','generate'].includes(input.kind)||!input.input||typeof input.input!=='object')throw new Error('整理类型不正确');
   const kind=input.kind,payload=input.input;
   if(['file','problem'].includes(kind)&&payload.file)uploadedFile(payload.file);
   const job=aiJobs.start(owner,async control=>{
    if(kind==='chat')return importMessages(payload,false,control);
    if(!secrets.configured())throw new Error('请先配置 DeepSeek API Key');
    const options={apiKey:await secrets.get(),model:aiSettings().model,...control};
    if(kind==='file'){const result=await organizeFile(store,uploadedFile(payload.file),{referenceDate:payload.referenceDate,remindMinutes:payload.remindMinutes??15},options);if(!result.duplicate)store.setSetting('deepseekStatus',{...store.setting('deepseekStatus',{}),lastError:null,lastOrganizedAt:new Date().toISOString()});return result;}
    if(kind==='problem')return {ok:true,id:await planner.create(payload,{...options,withSuggestions:true})};
    if(kind==='suggest')return {ok:true,suggestions:await planner.suggest(payload.problemId,options)};
    return {ok:true,solution:await planner.generate(payload,options)};
   },kind==='file'?'正在准备文件…':kind==='chat'?'正在整理聊天文字…':'DeepSeek 正在整理方案…');return json(res,200,job);
  }
  const action=pathname.slice('/api/ai/jobs/'.length);if(['pause','resume','cancel','commit'].includes(action))return json(res,200,aiJobs[action](input.id,owner));
  return json(res,404,{error:'没有这个整理操作'});
 }
 if(pathname.startsWith('/api/plans/')){
  if(agent)throw new Error('请在方案与复盘页面操作');
  const options=async()=>{if(!secrets.configured())throw new Error('请先配置 DeepSeek API Key');return {apiKey:await secrets.get(),model:aiSettings().model};};
  if(pathname==='/api/plans/create')return json(res,200,{ok:true,id:await planner.create(input)});
  if(pathname==='/api/plans/suggest')return json(res,200,{ok:true,suggestions:await planner.suggest(input.problemId,await options())});
  if(pathname==='/api/plans/generate')return json(res,200,{ok:true,solution:await planner.generate(input,await options())});
  if(pathname==='/api/plans/preview')return json(res,200,{ok:true,solution:planner.preview(input.solutionId,input.overrides||[],input.constraints)});
  if(pathname==='/api/plans/confirm')return json(res,200,{ok:true,solution:planner.confirm(input)});
  if(pathname==='/api/plans/feedback')return json(res,200,{ok:true,problem:planner.feedback(input)});
  if(pathname==='/api/plans/share')return json(res,200,{ok:true,experience:planner.share(input.problemId)});
 }
 if(pathname==='/api/files/import'){
  if(agent)throw new Error('请在新增事务中选择要导入的文件');
  const file=uploadedFile(input.file);
  if(!secrets.configured())throw new Error('请先在微信连接中配置 DeepSeek API Key，再导入文件');
  if(activeFileImports.has(file.id))throw new Error('这个文件正在整理，请等待当前导入完成');
  activeFileImports.add(file.id);
  try{
   const result=await organizeFile(store,file,{referenceDate:input.referenceDate,remindMinutes:input.remindMinutes??15},{apiKey:await secrets.get(),model:aiSettings().model});
   if(!result.duplicate)store.setSetting('deepseekStatus',{...store.setting('deepseekStatus',{}),lastError:null,lastOrganizedAt:new Date().toISOString()});
   return json(res,200,result);
  }finally{activeFileImports.delete(file.id);}
 }
 if(pathname==='/api/settings'&&'messageDateRange' in input){const range=normalizeDateRange(input.messageDateRange);store.setSetting('messageDateRange',range);}
 if(pathname==='/api/ai/config'){
  if(agent)throw new Error('请在项目页面配置 DeepSeek');
  if('model' in input&&!MODELS.includes(input.model))throw new Error('请选择支持的 DeepSeek 模型');
  if('enabled' in input&&typeof input.enabled!=='boolean')throw new Error('整理开关不正确');
  const modelChanged='model' in input&&input.model!==aiSettings().model;
  if(input.apiKey)await secrets.set(input.apiKey);
  if(input.removeKey===true)secrets.remove();
  if('model' in input)store.setSetting('deepseekModel',input.model);
  if('enabled' in input)store.setSetting('deepseekEnabled',input.enabled);
  if(input.apiKey||input.removeKey||modelChanged)store.setSetting('deepseekStatus',{});
  return json(res,200,aiSettings());
 }
 if(pathname==='/api/ai/test'){
  if(agent)throw new Error('请在项目页面测试 DeepSeek');
  try{await testDeepSeek({apiKey:await secrets.get(),model:aiSettings().model});store.setSetting('deepseekStatus',{...store.setting('deepseekStatus',{}),lastTestAt:new Date().toISOString(),lastError:null});return json(res,200,{ok:true});}
  catch(error){store.setSetting('deepseekStatus',{...store.setting('deepseekStatus',{}),lastError:error.message});throw error;}
 }
 if(pathname==='/api/discovery/request'){store.setSetting('discoveryRequestedAt',new Date().toISOString());return json(res,200,{ok:true});}
 if(pathname==='/api/sync/request'){store.setSetting('syncRequestedAt',new Date().toISOString());return json(res,200,{ok:true});}
 if(pathname==='/api/settings'&&'allDayReminderTime' in input){if(typeof input.allDayReminderTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.allDayReminderTime))throw new Error('全天提醒时刻不正确');store.setSetting('allDayReminderTime',input.allDayReminderTime);}
 if(pathname==='/api/settings'&&'categories' in input){const allowed=new Set(['公告','会议','文件','费用','日程','其他']);if(!Array.isArray(input.categories)||input.categories.some(c=>!allowed.has(c)))throw new Error('信息类型不正确');store.setSetting('categories',[...new Set(input.categories)]);}
 if(pathname==='/api/settings'){for(const key of ['nickname','desktopEnabled','syncEnabled'])if(key in input){if(key==='nickname'&&(typeof input[key]!=='string'||input[key].length>80))throw new Error('昵称不合法');if(key!=='nickname'&&typeof input[key]!=='boolean')throw new Error('设置不合法');store.setSetting(key,input[key]);}if(Array.isArray(input.enabledGroups)){const available=new Set(store.db.prepare('SELECT name FROM groups').all().map(g=>g.name));if(input.enabledGroups.some(g=>!available.has(g)))throw new Error('包含未发现的群聊');store.db.exec('BEGIN');try{store.db.prepare('UPDATE groups SET enabled=0').run();for(const name of input.enabledGroups)store.db.prepare('UPDATE groups SET enabled=1 WHERE name=?').run(name);store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}}return json(res,200,settings());}
 if(pathname==='/api/bridge/discover'){if(!agent)throw new Error('发现群聊需要桌面连接身份');if(!Array.isArray(input.groups)||input.groups.length>1000||input.groups.some(g=>!validText(g,120)))throw new Error('群聊名单格式不正确');for(const name of input.groups)store.db.prepare('INSERT OR IGNORE INTO groups(id,name,enabled) VALUES(?,?,0)').run(idFor(name),name);store.setSetting('bridgeStatus',{state:'ready',message:input.message||'微信已登录，请勾选要整理的群聊',discoveredAt:new Date().toISOString(),discoveryComplete:!!input.complete});return json(res,200,settings());}
 if(pathname==='/api/bridge/status'){if(!agent)throw new Error('需要桌面连接身份');store.setSetting('bridgeStatus',{...store.setting('bridgeStatus',{}),...input,updatedAt:new Date().toISOString()});return json(res,200,{ok:true});}
 if(pathname==='/api/import')return json(res,200,await importMessages(input,agent));
 if(pathname==='/api/tasks/save'){if(!validText(input.title,200))throw new Error('请填写事项标题');const precision=input.dueAt?(input.dueAt.length===10?'date':'minute'):'uncertain';if(!validateDue(input.dueAt,precision))throw new Error('日期格式不正确');const statuses=new Set(['inbox','pending','done','dismissed']);if(!statuses.has(input.status||'inbox'))throw new Error('事务状态不正确');if(input.status==='pending'&&!input.dueAt)throw new Error('加入日历前请确定日期');if(!Number.isInteger(input.remindMinutes??15)||(input.remindMinutes??15)<0||(input.remindMinutes??15)>10080)throw new Error('提醒间隔不正确');
  if(input.id){const existing=store.getTask(input.id);if(!existing)throw new Error('事务不存在');store.db.prepare('UPDATE tasks SET title=?,category=?,status=?,priority=?,due_at=?,precision=?,remind_minutes=?,reason=?,updated_at=? WHERE id=?').run(input.title,input.category||'其他',input.status||'inbox',input.priority||'normal',input.dueAt||null,precision,input.remindMinutes??15,input.reason||'',new Date().toISOString(),input.id);planner.onTaskStatus(input.id,input.status||'inbox');return json(res,200,{ok:true,id:input.id});}
  const result=store.addTask({...input,id:randomBytes(12).toString('hex'),precision});return json(res,200,{ok:true,id:result.id});
 }
 if(pathname==='/api/tasks/status'){if(!['done','dismissed','inbox'].includes(input.status)||!store.getTask(input.id))throw new Error('状态不正确');store.db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run(input.status,new Date().toISOString(),input.id);planner.onTaskStatus(input.id,input.status);return json(res,200,{ok:true});}
 if(pathname==='/api/notifications/read'){store.db.prepare('UPDATE notifications SET read=1 WHERE id=?').run(input.id);return json(res,200,{ok:true});}
 if(pathname==='/api/notifications/snooze'){snoozeNotification(store,input.id);return json(res,200,{ok:true});}
 if(pathname==='/api/notifications/test'){await desktopNotify('拾事已就绪','这是一条测试通知。已确认的事务会按设置时间提醒你。');return json(res,200,{ok:true});}
 return json(res,404,{error:'没有这个接口'});
}
async function importMessages(input,agent,control={}){
  if(!validText(input.group,120))throw new Error('请选择或填写群名称');const enabled=store.db.prepare('SELECT enabled FROM groups WHERE name=?').get(input.group);if(agent&&(!enabled?.enabled||!store.setting('syncEnabled',true)))throw new Error('这个群尚未被选中，或同步已暂停');
  if(!Array.isArray(input.messages)||input.messages.length>300||input.messages.some(m=>!validText(m.text,20000)))throw new Error('消息格式不正确');
  const importRange=store.setting('messageDateRange',{start:null,end:null});
  if(agent&&!sameDateRange(normalizeDateRange(input.messageDateRange),importRange))throw new Error('整理日期范围已改变，请重新读取消息');
  if(input.messages.some(m=>!messageInDateRange(!agent&&validateDue(m.sentAt,'date')?m.sentAt+'T00:00:00+08:00':m.sentAt,importRange)))throw new Error('消息不在整理日期范围内，或发送日期未知');
  const messages=input.messages.map(m=>({...m,id:m.id||idFor(input.group,m.sender||'',m.sentAt||'',m.text),capturedAt:new Date().toISOString()}));
  let result,aiOrganized=false;const categories=store.setting('categories',['公告','会议','文件','费用','日程','其他']);if(agent&&input.extraction!=='local'){result={tasks:(input.tasks||[]).filter(t=>categories.includes(t.category||'其他')),summaries:(input.summaries||[]).filter(s=>categories.includes(s.category||'其他'))};}else {
   const fresh=messages.filter(m=>{const existing=store.db.prepare('SELECT group_name,text FROM messages WHERE id=?').get(m.id);if(existing&&(existing.group_name!==input.group||existing.text!==m.text))throw new Error('原始消息 ID 与已保存来源不一致');return !existing;});
   const options={nickname:store.setting('nickname',''),group:input.group,categories};
   if(aiSettings().enabled&&secrets.configured()&&fresh.length){
    try{control.onProgress?.('DeepSeek 正在提取聊天事项…');result=await extractDeepSeek(fresh,{...options,apiKey:await secrets.get(),model:aiSettings().model,signal:control.signal});aiOrganized=true;}
    catch(error){if(!control.beforeCommit)store.setSetting('deepseekStatus',{...store.setting('deepseekStatus',{}),lastError:error.message});throw error;}
   }else result=extractMessages(fresh,options);
  }
  await control.beforeCommit?.();control.signal?.throwIfAborted();
  if(agent&&(!store.db.prepare('SELECT enabled FROM groups WHERE name=?').get(input.group)?.enabled||!store.setting('syncEnabled',true)))throw new Error('选择已改变，本批消息尚未写入');
  if(!sameDateRange(importRange,store.setting('messageDateRange',{start:null,end:null})))throw new Error('整理日期范围已改变，本批消息尚未写入');
  result.tasks=result.tasks.filter(t=>store.setting('categories',categories).includes(t.category||'其他'));result.summaries=result.summaries.filter(s=>store.setting('categories',categories).includes(s.category||'其他'));
  if(!Array.isArray(result.tasks)||result.tasks.length>300||result.tasks.some(t=>!validText(t.title,200)||!validateDue(t.dueAt,t.precision||'uncertain')))throw new Error('待办日期或标题格式不正确');
  if(!Array.isArray(result.summaries)||result.summaries.some(s=>!validText(s.text,30000)))throw new Error('摘要格式不正确');
  const added=store.ingest({group:input.group,messages,...result});if(agent)store.setSetting('lastSync',new Date().toISOString());if(aiOrganized)store.setSetting('deepseekStatus',{...store.setting('deepseekStatus',{}),lastError:null,lastOrganizedAt:new Date().toISOString()});return {ok:true,added,message:`已整理 ${messages.length} 条消息，新增 ${added} 项待确认事务`};
 }

const server=http.createServer(async(req,res)=>{try{
 if(req.headers.host!==`127.0.0.1:${port}`)return json(res,403,{error:'只允许本机访问'});
 const url=new URL(req.url,origin);const agent=validToken(req.headers['x-agent-token']);const sid=req.headers.cookie?.match(new RegExp('(?:^|; )'+sessionCookie+'=([a-f0-9]+)'))?.[1];
 if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{app:'shishi',ready:true});
 if(url.pathname.startsWith('/api/')){if(!agent&&!sessions.has(sid))return json(res,401,{error:'请先打开应用页面'});if(req.method!=='GET'&&!agent&&(req.headers.origin!==origin||req.headers['x-requested-with']!=='shishi'))return json(res,403,{error:'请求来源不正确'});return await api(req,res,url,agent,sid);}
 if(req.method!=='GET')return json(res,405,{error:'不支持此操作'});
 const target=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));const filepath=path.resolve(root,'public',target);if(!filepath.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(filepath)||!fs.statSync(filepath).isFile())return json(res,404,{error:'页面不存在'});
 const headers={'Content-Type':{'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp'}[path.extname(filepath)]||'application/octet-stream','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'};
 if(!sessions.has(sid)){const fresh=randomBytes(24).toString('hex');sessions.add(fresh);headers['Set-Cookie']=`${sessionCookie}=${fresh}; HttpOnly; SameSite=Strict; Path=/`;}
 res.writeHead(200,headers);fs.createReadStream(filepath).pipe(res);
 }catch(e){if(!res.headersSent)json(res,400,{error:e.message});else res.end();}});
let ticking=false;const timer=setInterval(async()=>{if(ticking)return;ticking=true;try{aiJobs.cleanup();await tickReminders(store);}catch(e){console.error('提醒调度失败:',e.message);}finally{ticking=false;}},15000);
let stopCollector=()=>{};
server.listen(port,'127.0.0.1',()=>{console.log(`拾事运行于 ${origin} · 数据保存在 ${dataDir}`);if(dataDir===path.join(root,'data'))stopCollector=startBackgroundCollector(root);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopCollector();aiJobs.dispose();clearInterval(timer);server.close(()=>{store.db.close();process.exit(0);});});
