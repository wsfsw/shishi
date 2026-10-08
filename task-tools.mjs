// Shared by the desktop store and the browser build.
export const TASK_CATEGORIES=['公告','会议','文件','费用','日程','其他'];
export function validTaskDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export function validTaskDue(value){return !value||validTaskDate(value)||typeof value==='string'&&validTaskDate(value.slice(0,10))&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\+08:00$/.test(value);}
export function taskDetails(input={},previous={}){
 const d={deadlineAt:null,durationMinutes:null,project:'',tags:[],checklist:[],repeat:'none',repeatSeriesId:null,repeatAnchor:null,repeatParentId:null};
 for(const k of Object.keys(d)){if(Object.hasOwn(previous,k))d[k]=previous[k];if(Object.hasOwn(input,k))d[k]=input[k];}
 if(d.deadlineAt&&!validTaskDate(d.deadlineAt))throw new Error('截止日期不正确');
 if(d.durationMinutes!==null&&(!Number.isInteger(d.durationMinutes)||d.durationMinutes<5||d.durationMinutes>1440))throw new Error('预计用时应为 5 至 1440 分钟');
 if(typeof d.project!=='string'||d.project.length>80)throw new Error('项目名称最多 80 字');d.project=d.project.trim();
 if(!Array.isArray(d.tags)||d.tags.length>20||d.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>30))throw new Error('最多 20 个标签，每个最多 30 字');d.tags=[...new Set(d.tags.map(t=>t.trim()))];
 if(!Array.isArray(d.checklist)||d.checklist.length>50||d.checklist.some(t=>!t||typeof t.text!=='string'||!t.text.trim()||t.text.length>200||typeof t.done!=='boolean'))throw new Error('检查清单格式不正确');d.checklist=d.checklist.map(t=>({text:t.text.trim(),done:t.done}));
 if(!['none','daily','weekly','monthly'].includes(d.repeat))throw new Error('重复规则不正确');
 for(const k of ['repeatSeriesId','repeatAnchor','repeatParentId'])if(d[k]!==null&&(typeof d[k]!=='string'||d[k].length>200))throw new Error('重复系列不正确');
 return d;
}
export function validateTaskFields(input){
 const title=String(input.title||'').trim(),status=input.status||'inbox',dueAt=input.dueAt||null;
 if(!title||title.length>200)throw new Error('请填写 200 字以内的事项标题');
 if(!['inbox','pending','done','dismissed'].includes(status))throw new Error('事务状态不正确');
 if(!validTaskDue(dueAt))throw new Error('日期格式不正确');
 if(status==='pending'&&!dueAt)throw new Error('加入日历前请确定日期');
 const remindMinutes=input.remindMinutes??15;if(!Number.isInteger(remindMinutes)||remindMinutes<0||remindMinutes>10080)throw new Error('提醒间隔不正确');
 const category=input.category||'其他';if(!TASK_CATEGORIES.includes(category))throw new Error('分类不正确');
 return {title,status,dueAt,precision:dueAt?(dueAt.length===10?'date':'minute'):'uncertain',remindMinutes,category,priority:input.priority==='high'?'high':'normal',reason:String(input.reason||'').slice(0,2000)};
}
export function nextOccurrence(dueAt,repeat,anchor=dueAt){
 if(!dueAt||repeat==='none')return null;const day=dueAt.slice(0,10);if(!validTaskDate(day))throw new Error('重复事务需要有效日期');
 let next;
 if(repeat==='monthly'){
  const [y,m]=day.split('-').map(Number),desired=Number((anchor||day).slice(8,10));
  const last=new Date(Date.UTC(y,m+1,0)).getUTCDate();next=new Date(Date.UTC(y,m,Math.min(desired,last))).toISOString().slice(0,10);
 }else next=new Date(Date.parse(day+'T00:00:00Z')+(repeat==='weekly'?7:1)*86400000).toISOString().slice(0,10);
 return next+dueAt.slice(10);
}
export function extractionIdentity(group,item){return JSON.stringify([group,item.category||'其他',String(item.title||item.text||'').normalize('NFKC').replace(/[\s，。；：:、！!？?]/g,'').toLowerCase(),item.dueAt||'', [...(item.sourceIds||[])].sort()]);}
export function stableBrowserId(...parts){const value=JSON.stringify(parts);let a=2166136261,b=5381;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b,33)^value.charCodeAt(i);}return 'web-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0')+'-'+value.length;}
