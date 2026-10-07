import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../store.mjs';
import {createPlanner} from '../planning.mjs';
import {createAIJobs} from '../ai-jobs.mjs';

const constraints={startDate:'2099-10-08',deadline:'2099-10-08',startTime:'18:00',endTime:'21:00',dailyMinutes:90,weekdays:[0,1,2,3,4,5,6]};
const setup=async(c=constraints)=>{const store=createStore(':memory:'),planner=createPlanner(store),id=await planner.create({title:'完成学习项目',description:'希望比较方法，再安排学习任务',goal:'完成可演示项目',board:'学习',visibility:'private',constraints:c});return {store,planner,id};};
function mock(steps=[{title:'准备材料',description:'收集资料并列提纲',minutes:30},{title:'完成初稿',description:'输出可演示初稿',minutes:60}],inspect=()=>{}){
 return {apiKey:'test',fetchImpl:async(url,options)=>{const request=JSON.parse(options.body),input=JSON.parse(request.messages[1].content);inspect(input);const result=input.selected?{goal:'完成可演示项目',resources:['课程资料'],criteria:['初稿可运行'],steps}:{suggestions:[{title:'先做原型',method:'先验证核心流程再补充细节',conditions:'适合截止日期紧张时',estimatedMinutes:90,resources:['课程资料']},{title:'先列提纲',method:'梳理任务再逐步完成',conditions:'适合需求尚未明确时',estimatedMinutes:120,resources:['任务清单']}]};return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]})};}};
}
async function generate(planner,id,options=mock(),extra={}){const suggestions=await planner.suggest(id,options);return planner.generate({problemId:id,suggestionIds:[suggestions[0].id],...extra},options);}

test('结束问题整理不留问题或来源；结束方案生成保留之前的方案与已安排事项',async()=>{
 const store=createStore(':memory:'),planner=createPlanner(store),jobs=createAIJobs();
 const ready=async id=>{for(let i=0;i<100;i++){if(jobs.status(id,'ui').state==='ready')return;await new Promise(r=>setImmediate(r));}throw new Error('未暂存');};
 try{
  const creating=jobs.start('ui',control=>planner.create({title:'未保存的问题',description:'这些需求不应在结束后保存',constraints},{...mock(),...control,withSuggestions:true}));await ready(creating.id);assert.equal(planner.state().length,0);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,0);jobs.cancel(creating.id,'ui');await new Promise(r=>setImmediate(r));assert.equal(planner.state().length,0);
  const id=await planner.create({title:'已保存的问题',description:'保留原方案',constraints}),original=await generate(planner,id);planner.confirm({solutionId:original.id,baseFingerprint:original.baseFingerprint});const baseline=planner.state(),tasks=store.listTasks();
  const generating=jobs.start('ui',control=>planner.generate({problemId:id,suggestionIds:[planner.problem(id).suggestions[0].id],supplement:'取消时不应保存的新输入'},{...mock(),...control}));await ready(generating.id);assert.deepEqual(planner.state(),baseline);jobs.pause(generating.id,'ui');jobs.cancel(generating.id,'ui');await new Promise(r=>setImmediate(r));assert.deepEqual(planner.state(),baseline);assert.deepEqual(store.listTasks(),tasks);
 }finally{jobs.dispose();store.db.close();}
});

test('方案只在确认后入日历，自动避开已有安排且按真实任务时长避让',async()=>{
 const {store,planner,id}=await setup();try{
  store.addTask({id:'existing',title:'原有会议',dueAt:'2099-10-08T18:00:00+08:00',precision:'minute',status:'pending'});const before=store.getTask('existing');
  const draft=await generate(planner,id);assert.equal(store.listTasks().length,1);assert.equal(draft.assignments[0].dueAt,'2099-10-08T19:00:00+08:00');assert.equal(draft.assignments[1].dueAt,'2099-10-08T19:30:00+08:00');assert.equal(draft.comparison.conflicts.length,0);
  planner.confirm({solutionId:draft.id,baseFingerprint:draft.baseFingerprint});assert.equal(store.listTasks().length,3);assert.deepEqual(store.getTask('existing'),before);
  assert(store.listTasks().filter(t=>t.id!=='existing').every(t=>t.status==='pending'&&t.sourceIds.length));
  const scheduled=store.listTasks().find(t=>t.id!=='existing');planner.onTaskStatus(scheduled.id,'done');assert.equal(planner.state()[0].progress.find(r=>r.task_id===scheduled.id).progress,'done');
  assert.throws(()=>planner.confirm({solutionId:draft.id,baseFingerprint:draft.baseFingerprint}),/失效/);
 }finally{store.db.close();}
});

test('手动安排冲突、过去时间及日历变化均阻止旧对比直接确认',async()=>{
 const {store,planner,id}=await setup();try{
  store.addTask({id:'busy',title:'已有课程',dueAt:'2099-10-08T18:00:00+08:00',precision:'minute',status:'pending'});
  let draft=await generate(planner,id);draft=planner.preview(draft.id,[{stepId:draft.steps[0].id,dueAt:'2099-10-08T18:30:00+08:00'}]);assert(draft.comparison.conflicts.some(c=>c.reason.includes('已有课程')));assert.throws(()=>planner.confirm({solutionId:draft.id,baseFingerprint:draft.baseFingerprint}),/冲突/);
  draft=planner.preview(draft.id,[]);store.addTask({id:'new',title:'新约会',dueAt:'2099-10-08T20:30:00+08:00',precision:'minute',status:'pending'});assert.throws(()=>planner.confirm({solutionId:draft.id,baseFingerprint:draft.baseFingerprint}),/日历已发生变化/);assert.equal(store.listTasks().length,2);
 }finally{store.db.close();}
});

test('截止日期与预算不足显示缺口，确认后未排入任务留在事务箱',async()=>{
 const {store,planner,id}=await setup({...constraints,dailyMinutes:30});try{
  const draft=await generate(planner,id);assert.equal(draft.comparison.gaps.length,1);planner.confirm({solutionId:draft.id,baseFingerprint:draft.baseFingerprint});assert.equal(store.listTasks().filter(t=>t.status==='pending').length,1);assert.equal(store.listTasks().filter(t=>t.status==='inbox').length,1);
 }finally{store.db.close();}
});

test('反馈调整保留已完成任务、比较时间变化，只替换原方案未完成安排',async()=>{
 const {store,planner,id}=await setup();try{
  let draft=await generate(planner,id);planner.confirm({solutionId:draft.id,baseFingerprint:draft.baseFingerprint});
  const first=store.listTasks().find(t=>t.title==='准备材料'),second=store.listTasks().find(t=>t.title==='完成初稿');
  planner.feedback({problemId:id,note:'材料准备耗时偏长，初稿尚未完成',outcome:'unresolved',progress:[{taskId:first.id,progress:'done',actualMinutes:50,difficulty:'资料分散'},{taskId:second.id,progress:'blocked',actualMinutes:20,difficulty:'需求不清'}]});assert.equal(store.getTask(first.id).status,'done');
  let receivedFeedback=false;const options=mock([{title:'完成初稿',description:'先缩小范围，再完成原型',minutes:45}],input=>{if(input.feedback?.length)receivedFeedback=true;});draft=await generate(planner,id,options);assert(receivedFeedback);assert.equal(draft.comparison.changed,1);assert.equal(draft.assignments[0].before,second.dueAt);planner.confirm({solutionId:draft.id,baseFingerprint:draft.baseFingerprint});
  assert.equal(store.getTask(first.id).status,'done');assert.equal(store.getTask(second.id).status,'dismissed');assert.equal(store.listTasks().filter(t=>t.status==='pending').length,1);
  planner.feedback({problemId:id,note:'现在已经完成演示',outcome:'resolved'});assert.throws(()=>planner.experience(id),/自愿导出/);const exportCard=planner.share(id);assert.equal(planner.problem(id).status,'resolved');assert.equal(planner.problem(id).visibility,'share');assert(!('description' in exportCard));assert(!('feedback' in exportCard));assert.deepEqual(planner.experience(id),exportCard);
 }finally{store.db.close();}
});

test('无需排期直接采纳，不创建事务；无效 AI 结果不保存方案',async()=>{
 const {store,planner,id}=await setup();try{
  const draft=await generate(planner,id,mock(),{needsSchedule:false});assert.equal(draft.comparison.added,0);planner.confirm({solutionId:draft.id,baseFingerprint:draft.baseFingerprint});assert.equal(store.listTasks().length,0);
  const bad=mock([{title:'无效步骤',description:'错误用时',minutes:-1}]);await assert.rejects(generate(planner,id,bad),/用时/);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM solutions').get().n,1);assert.throws(()=>planner.share(id),/已解决/);
 }finally{store.db.close();}
});

test('更新空闲时段后重新计算；新增反馈使未确认方案失效',async()=>{
 const {store,planner,id}=await setup();try{
  let draft=await generate(planner,id);draft=planner.preview(draft.id,[],{...constraints,startTime:'19:00',endTime:'22:00'});assert.equal(draft.assignments[0].dueAt,'2099-10-08T19:00:00+08:00');assert.equal(planner.problem(id).constraints.startTime,'19:00');
  planner.feedback({problemId:id,note:'我改变了实际需求',outcome:'unresolved'});assert.equal(planner.problem(id).draftId,null);assert.throws(()=>planner.confirm({solutionId:draft.id,baseFingerprint:draft.baseFingerprint}),/失效/);
 }finally{store.db.close();}
});
test('自动排期保持步骤顺序，不将后续步骤塞到前一步之前',async()=>{
 const {store,planner,id}=await setup({...constraints,deadline:'2099-10-10',startTime:'18:00',endTime:'19:00',dailyMinutes:60});try{
  store.addTask({id:'busy',title:'半小时会议',dueAt:'2099-10-08T18:00:00+08:00',precision:'minute',status:'pending'});
  const draft=await generate(planner,id,mock([{title:'先做完整准备',description:'准备后才能执行',minutes:60},{title:'再执行',description:'按准备结果执行',minutes:30}]));
  assert.equal(draft.assignments[0].dueAt,'2099-10-09T18:00:00+08:00');assert.equal(draft.assignments[1].dueAt,'2099-10-10T18:00:00+08:00');
 }finally{store.db.close();}
});
