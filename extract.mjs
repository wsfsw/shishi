import { createHash } from 'node:crypto';
export const idFor = (...values) => createHash('sha256').update(values.join('\n')).digest('hex').slice(0, 24);
export const cnDate = date => new Date(new Date(date).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
const clock = /(?:上午|早上|下午|晚上|中午)?\s*(\d{1,2})(?:[:：](\d{2})|[点时](半|\d{1,2}分?)?)/;
export function inferDate(text, reference) {
  const hasReference = reference && Number.isFinite(new Date(reference).getTime());
  if (!hasReference && !/20\d{2}[年/.-]\d{1,2}[月/.-]\d{1,2}/.test(text)) return {dueAt:null,precision:'uncertain'};
  reference = hasReference ? reference : '2000-01-01T00:00:00+08:00';
  const local = new Date(new Date(reference).getTime() + 8 * 3600_000);
  let year = local.getUTCFullYear(), month = local.getUTCMonth() + 1, day = local.getUTCDate(), found = false;
  const explicit = text.match(/(?:(20\d{2})[年/.-])?(\d{1,2})[月/.-](\d{1,2})(?:日|号)?/);
  if (explicit) { year = Number(explicit[1] || year); month = Number(explicit[2]); day = Number(explicit[3]); found = true; }
  else if (/今天|明天|后天/.test(text)) { local.setUTCDate(day + (/后天/.test(text) ? 2 : /明天/.test(text) ? 1 : 0)); year=local.getUTCFullYear();month=local.getUTCMonth()+1;day=local.getUTCDate();found=true; }
  else {
    const week=text.match(/(下周|本周|这周|周|星期)([一二三四五六日天])/);
    if(week){const target='一二三四五六日'.indexOf(week[2]==='天'?'日':week[2])+1;const current=local.getUTCDay()||7;let delta=target-current;if(week[1]==='下周')delta+=7;else if(delta<0 && !/本周|这周/.test(week[1]))delta+=7;local.setUTCDate(day+delta);year=local.getUTCFullYear();month=local.getUTCMonth()+1;day=local.getUTCDate();found=true;}
  }
  if(!found || /下个月|月底|近期|有空|稍后|尽快/.test(text))return { dueAt:null, precision:'uncertain' };
  const base=new Date(Date.UTC(year,month-1,day));
  if(base.getUTCFullYear()!==year||base.getUTCMonth()+1!==month||base.getUTCDate()!==day)return {dueAt:null,precision:'uncertain'};
  const date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const time=text.match(clock);
  if(!time)return { dueAt:date,precision:'date' };
  let hour=Number(time[1]),minute=time[2]?Number(time[2]):time[3]==='半'?30:parseInt(time[3]||'0',10);
  if(/下午|晚上/.test(time[0])&&hour<12)hour+=12;
  if(/中午/.test(time[0])&&hour<11)hour+=12;
  if(hour>23||minute>59)return {dueAt:null,precision:'uncertain'};
  // 没有上午/下午的 1-11 点可能有两种含义，需要用户确认。
  if(hour>0&&hour<12&&!/上午|早上|下午|晚上|中午/.test(time[0])&&!/[:：]/.test(time[0]))return {dueAt:date,precision:'date'};
  return {dueAt:`${date}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+08:00`,precision:'minute'};
}
export function categoryOf(text){return /缴费|费用|付款|转账|报销|发票/.test(text)?'费用':/会议|开会|讨论|腾讯会议/.test(text)?'会议':/文件|资料|附件|文档|表格|提交|作业/.test(text)?'文件':/通知|公告|放假|安排/.test(text)?'公告':/报名|活动|出发|集合|考试/.test(text)?'日程':'其他';}
export function extractMessages(messages, {nickname='',group='',categories=['公告','会议','文件','费用','日程','其他']}={}) {
  const tasks=[],buckets=new Map();
  for(const message of messages){const text=message.text.trim();const category=categoryOf(text);if(!categories.includes(category))continue;if(!buckets.has(category))buckets.set(category,[]);buckets.get(category).push({text,sourceIds:[message.id]});
    if(!/请|需要|记得|提交|报名|缴费|开会|会议|集合|截止|务必|完成|带上|通知/.test(text)||/取消|不用|无需|已完成|已经提交/.test(text))continue;
    const mentions=[...text.matchAll(/@([^\s，,：:]+)/g)].map(m=>m[1]);
    if(mentions.length&&nickname&&!mentions.some(m=>m===nickname||/所有人|全体成员/.test(m)))continue;
    const audience=/@所有人|全体|大家|各位/.test(text)?'all':nickname&&text.includes('@'+nickname)?'me':'unclear';
    const parsed=inferDate(text,message.sentAt);
    tasks.push({title:text.replace(/@所有人|@全体成员/g,'').trim().slice(0,100),category,dueAt:parsed.dueAt,precision:parsed.precision,audience,priority:/务必|紧急|重要/.test(text)?'high':'normal',sourceIds:[message.id],reason:parsed.precision!=='minute'?'请核对具体时间':audience==='unclear'?'请核对是否与你有关':''});
  }
  return {group,tasks,summaries:[...buckets.entries()].map(([category,items])=>({category,text:items.slice(0,8).map(x=>x.text).join('\n'),sourceIds:items.slice(0,8).flatMap(x=>x.sourceIds)}))};
}
