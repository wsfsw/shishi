import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/calendar-ui.js',import.meta.url),'utf8');
function context(tasks=[]){const c=vm.createContext({Date,localStorage:{getItem:()=>null},document:{addEventListener(){}},today:()=> '2026-10-06',fmt:d=>d,esc:v=>String(v??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c])),categoryTone:()=> 'sky',header:()=>'',state:{tasks},taskRow:()=>'',month:'2026-10',day:'2026-10-06'});vm.runInContext(source,c);return c;}
test('周范围以周一开始，支持跨月、跨年和闰年',()=>{const c=context();assert.equal(vm.runInContext('calendarDates.monday("2026-10-06")',c),'2026-10-05');assert.equal(vm.runInContext('calendarDates.week("2027-01-01").join(",")',c),'2026-12-28,2026-12-29,2026-12-30,2026-12-31,2027-01-01,2027-01-02,2027-01-03');assert.equal(vm.runInContext('calendarDates.add("2028-02-28",1)',c),'2028-02-29');});
test('周视图显示当天全部事务与完整备注，排除周外事项并转义来源文本',()=>{
 const tasks=Array.from({length:5},(_,i)=>({id:String(i),title:'完整标题'+i,reason:'完整备注'+i+'\n地点与材料要求',category:'会议',group:'来源<script>',status:i?'pending':'inbox',dueAt:'2026-10-07T14:00:00+08:00',precision:'minute',sourceIds:['m'+i],durationMinutes:i===1?30:null}));tasks.push({...tasks[0],id:'outside',title:'周外不可见',dueAt:'2026-10-12'});
 const c=context(tasks),html=vm.runInContext('calendarMode="week";weekAnchor="2026-10-06";renderCalendarView()',c);for(let i=0;i<5;i++){assert(html.includes('完整标题'+i));assert(html.includes('完整备注'+i));}assert.equal((html.match(/class="week-task"/g)||[]).length,5);assert(!html.includes('周外不可见'));assert(html.includes('14:00–14:30'));assert(html.includes('来源&lt;script&gt;'));assert(html.includes('查看原文'));assert.equal((html.match(/aria-labelledby="week-heading-/g)||[]).length,7);
});
test('月历当天详情完整显示五条事务，全天优先，保留来源和操作',()=>{
 const tasks=Array.from({length:5},(_,i)=>({id:'day-'+i,title:'当天事项'+i,reason:'完整备注'+i+'\n第二行材料要求',category:'会议',group:'来源<群聊>',status:i?'pending':'inbox',dueAt:'2026-10-07T'+String(16-i).padStart(2,'0')+':00:00+08:00',precision:'minute',sourceIds:['source'+i]}));
 tasks[3].dueAt='2026-10-07';tasks[3].precision='date';
 tasks.push({...tasks[0],id:'other',title:'其他日期',dueAt:'2026-10-08'});
 tasks.push({...tasks[0],id:'unknown',title:'未知日期',dueAt:null});
 tasks.push({...tasks[0],id:'dismissed',title:'已忽略',status:'dismissed'});
 const c=context(tasks),html=vm.runInContext('day="2026-10-07";renderCalendarDayContent(calendarTasks(),day)',c);
 assert.equal((html.match(/class="week-task"/g)||[]).length,5);
 for(let i=0;i<5;i++){assert(html.includes('当天事项'+i));assert(html.includes('完整备注'+i+'\n第二行材料要求'));}
 assert(html.indexOf('当天事项3')<html.indexOf('当天事项4'));
 assert(html.includes('已安排 4 · 待确认 1'));
 assert(html.includes('来源&lt;群聊&gt;'));assert(html.includes('查看原文'));assert(html.includes('标记完成'));
 assert(!html.includes('其他日期'));assert(!html.includes('未知日期'));assert(!html.includes('已忽略'));
 const monthHtml=vm.runInContext('renderMonthCalendar(calendarTasks())',c);
 assert(monthHtml.includes('data-calendar-date="2026-10-07"'));
 assert(monthHtml.includes('查看 2026-10-07 的完整事务，共 5 条'));
 assert(monthHtml.includes('查看全部 5 条'));
 assert(monthHtml.includes('当天事项4'));
});
test('选择空日期显示空状态，打开详情会更新选中日期并显示对话框',()=>{
 const c=context();let shown=0,redrawn=0;
 const dialog={open:false,showModal(){this.open=true;shown++;}},title={},content={};
 c.document.querySelector=selector=>({'#calendar-day-dialog':dialog,'#calendar-day-title':title,'#calendar-day-content':content})[selector];
 c.draw=()=>redrawn++;
 vm.runInContext('openCalendarDay("2026-09-30")',c);
 assert.equal(shown,1);assert.equal(redrawn,1);assert.equal(vm.runInContext('day',c),'2026-09-30');
 assert.equal(title.textContent,'2026 / 09 / 30 的事务');assert(content.innerHTML.includes('这一天还没有安排'));
 vm.runInContext('openCalendarDay(calendarDates.add(day,1))',c);
 assert.equal(shown,1);assert.equal(title.textContent,'2026 / 10 / 01 的事务');
});
