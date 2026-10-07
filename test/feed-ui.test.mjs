import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const feed=fs.readFileSync(new URL('../public/feed-ui.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function context(tasks=[]){const c=vm.createContext({localStorage:{getItem:()=>null},document:{addEventListener(){}},esc:v=>String(v??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c])),categoryTone:()=> 'sky',icon:()=>'<svg aria-hidden="true"></svg>',state:{tasks},filter:'inbox',taskQuery:''});vm.runInContext(feed,c);vm.runInContext(app.slice(app.indexOf('function filteredInboxTasks()'),app.indexOf('function inboxListMarkup()')),c);return c;}
test('类型、状态和关键词同时筛选，不改变原始事务',()=>{
 const tasks=[{id:'a',status:'inbox',category:'会议',title:'准备项目',group:'学习群',reason:'带上材料'},{id:'b',status:'pending',category:'会议',title:'项目评审',group:'学习群',reason:'已安排'},{id:'c',status:'inbox',category:'文件',title:'交报告',group:'课程群',reason:'准备材料'}];
 const c=context(tasks);
 assert.deepEqual(Array.from(vm.runInContext('filteredInboxTasks().map(t=>t.id)',c)),['a','c']);
 assert.deepEqual(Array.from(vm.runInContext('inboxType="会议";taskQuery="材料";filteredInboxTasks().map(t=>t.id)',c)),['a']);
 assert.equal(vm.runInContext('taskQuery="找不到的词";filteredInboxTasks().length',c),0);
 assert.deepEqual(tasks.map(t=>t.status),['inbox','pending','inbox']);
});
test('卡片保留完整内容和原文入口，转义标题、备注及来源',()=>{
 const c=context();c.item={id:'task1',status:'inbox',category:'文件',priority:'high',title:'报告<script>alert(1)</script>',reason:'完整备注\n第二行<script>',group:'来源"群',dueAt:'2026-10-08T14:30:00+08:00',precision:'minute',sourceIds:['source"1']};
 const html=vm.runInContext('renderInboxCard(item)',c);
 assert(html.includes('报告&lt;script&gt;'));assert(html.includes('完整备注\n第二行&lt;script&gt;'));assert(html.includes('来源&quot;群'));assert(!html.includes('<script>'));
 assert(html.includes('10月8日'));assert(html.includes('14:30'));assert(html.includes('核对与安排'));assert(html.includes('data-sources="source&quot;1"'));assert(html.includes('重要事项'));
});
test('未知日期明确待确认，已完成卡片不提供再次完成操作',()=>{
 const c=context();c.item={id:'task2',status:'done',category:'其他',title:'完成事项',reason:'',dueAt:null,sourceIds:[]};
 const html=vm.runInContext('renderInboxCard(item)',c);
 assert(html.includes('日期待确认'));assert(html.includes('已完成'));assert(html.includes('查看详情'));assert(!html.includes('data-status="done"'));
});
test('多选仅保留当前筛选结果，切换条件不残留隐藏选择，回收站只提供恢复',()=>{
 const c=context([{id:'a',status:'inbox',category:'会议',title:'合成会议'},{id:'b',status:'inbox',category:'文件',title:'合成文件'},{id:'c',status:'deleted',deletedFromStatus:'pending',category:'会议',title:'合成删除事务'}]);
 vm.runInContext("inboxSelecting=true;inboxSelected=new Set(['a','b','c']);syncInboxSelection()",c);assert.deepEqual(Array.from(vm.runInContext('[...inboxSelected]',c)),['a','b']);
 vm.runInContext('inboxType="会议";syncInboxSelection()',c);assert.deepEqual(Array.from(vm.runInContext('[...inboxSelected]',c)),['a']);
 const markup=vm.runInContext('inboxSelectable(state.tasks[0],renderInboxCard(state.tasks[0]))',c);assert(markup.includes('data-task-select="a"'));assert(markup.includes('is-selected'));assert(markup.includes('aria-label="选择事务：合成会议"'));
 const trash=vm.runInContext('filter="deleted";inboxBatchToolbar()',c);assert(trash.includes('恢复所选'));assert(!trash.includes('删除所选'));
 const card=vm.runInContext('renderInboxCard(state.tasks[2])',c);assert(card.includes('恢复事务'));assert(!card.includes('data-edit='));
});
