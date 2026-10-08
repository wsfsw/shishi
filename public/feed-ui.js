// The reference contributes the navigation and card rhythm; task data stays local.
let inboxType='全部',inboxPresentation='cards';
let inboxSelecting=false,inboxSelected=new Set(),inboxBatchBusy=false,lastDeletedIds=[];
let inboxSort='newest',inboxProject='全部';
function taskMatchesFilter(t,f,reference=new Date(Date.now()+28800000).toISOString().slice(0,10)){
 if(['inbox','pending','done','dismissed','deleted'].includes(f))return t.status===f;
 if(!['inbox','pending'].includes(t.status))return false;
 const date=t.dueAt?.slice(0,10),deadline=t.deadlineAt;
 if(f==='today')return date===reference;
 if(f==='overdue')return !!((deadline&&deadline<reference)||(date&&date<reference));
 if(f==='unscheduled')return !t.dueAt;
 if(f==='week'){const d=new Date(reference+'T00:00:00Z'),weekday=(d.getUTCDay()+6)%7,start=new Date(d.getTime()-weekday*86400000).toISOString().slice(0,10),end=new Date(d.getTime()+(6-weekday)*86400000).toISOString().slice(0,10);return !!date&&date>=start&&date<=end;}
 return false;
}
function sortInboxTasks(tasks){return [...tasks].sort((a,b)=>inboxSort==='deadline'?(a.deadlineAt||'9999').localeCompare(b.deadlineAt||'9999'):inboxSort==='schedule'?(a.dueAt||'9999').localeCompare(b.dueAt||'9999'):inboxSort==='priority'?Number(b.priority==='high')-Number(a.priority==='high'):0);}
function syncInboxSelection(){const visible=new Set(filteredInboxTasks().map(t=>t.id));inboxSelected=new Set([...inboxSelected].filter(id=>visible.has(id)));lastDeletedIds=lastDeletedIds.filter(id=>state.tasks.some(t=>t.id===id&&t.status==='deleted'));}
function inboxBatchToolbar(){
 syncInboxSelection();const count=inboxSelected.size,total=filteredInboxTasks().length,disabled=inboxBatchBusy?'disabled':'';
 return `<div class="inbox-bulk-bar" role="group" aria-label="事务批量操作"><div class="inbox-bulk-selection">${inboxSelecting?`<label class="inbox-select-all"><input type="checkbox" data-task-select-all ${count&&count===total?'checked':''} ${disabled} ${!total?'disabled':''}><span>全选当前列表</span></label><span role="status" aria-live="polite">已选 ${count} / ${total} 条</span>`:`<button class="button secondary small" data-bulk-mode ${disabled}>多选</button><button class="text-button" data-bulk-select-all ${disabled} ${!total?'disabled':''}>全选当前列表</button>`}</div><div class="inbox-bulk-actions">${inboxSelecting?`${filter==='deleted'?`<button class="button secondary small" data-bulk-action="restore" ${!count?'disabled':''} ${disabled}>恢复所选</button>`:`<button class="button secondary small" data-bulk-action="done" ${!count?'disabled':''} ${disabled}>批量完成</button><button class="button secondary small" data-bulk-action="dismissed" ${!count?'disabled':''} ${disabled}>批量忽略</button><button class="button secondary small" data-bulk-edit ${!count?'disabled':''} ${disabled}>改期 / 分类</button><button class="button secondary small bulk-delete" data-bulk-action="delete" ${!count?'disabled':''} ${disabled}>删除所选</button>`}<button class="text-button" data-bulk-exit ${disabled}>退出多选</button>`:''}${lastDeletedIds.length?`<button class="text-button" data-bulk-undo ${disabled}>撤销删除（${lastDeletedIds.length}）</button>`:''}</div></div>${filter==='deleted'?'<p class="inbox-bulk-hint">删除的事务保留在这里，恢复后回到删除前的状态。回收站中的事务不参与日历和提醒。</p>':inboxSelecting?'<p class="inbox-bulk-hint">仅操作当前状态、类型和搜索条件下的所选事务。删除后进入回收站，可以恢复。</p>':''}`;
}
function inboxSelectable(t,markup){return `<div class="task-selectable ${inboxSelecting?'is-selecting':''} ${inboxSelected.has(t.id)?'is-selected':''}">${inboxSelecting?`<label class="task-select-control"><input type="checkbox" data-task-select="${esc(t.id)}" aria-label="选择事务：${esc(t.title)}" ${inboxSelected.has(t.id)?'checked':''} ${inboxBatchBusy?'disabled':''}></label>`:''}${markup}</div>`;}
function redrawInboxSelection(){const focused=document.activeElement,taskId=focused?.dataset?.taskSelect,all=focused?.hasAttribute('data-task-select-all');syncInboxSelection();$('#inbox-batch-toolbar').innerHTML=inboxBatchToolbar();$('#inbox-task-list').innerHTML=inboxListMarkup();syncInboxSelectAll();if(taskId)[...document.querySelectorAll('[data-task-select]')].find(e=>e.dataset.taskSelect===taskId)?.focus({preventScroll:true});else if(all)document.querySelector('[data-task-select-all]')?.focus({preventScroll:true});}
function syncInboxSelectAll(){const input=document.querySelector('[data-task-select-all]');if(input)input.indeterminate=inboxSelected.size>0&&inboxSelected.size<filteredInboxTasks().length;}
async function applyInboxBulk(action,ids=[...inboxSelected]){
 if(inboxBatchBusy||!ids.length)return;inboxBatchBusy=true;redrawInboxSelection();
 try{const result=await api('/api/tasks/bulk',{ids,action});if(action==='delete')lastDeletedIds=ids;inboxSelected.clear();await refresh();toast(({delete:'已移入回收站',restore:'已恢复',done:'已完成',dismissed:'已忽略'})[action]+' '+result.count+' 条事务');}
 catch(error){toast(error.message,true);}finally{inboxBatchBusy=false;if(view==='inbox')redrawInboxSelection();}
}
try{if(localStorage.getItem('shishi.inbox.presentation')==='list')inboxPresentation='list';}catch{}
function renderInboxCard(t){
 const tone=categoryTone(t.category),status={inbox:'待确认',pending:'已安排',done:'已完成',dismissed:'已忽略',deleted:'回收站'}[t.status]||'待确认';
 const date=t.dueAt?.slice(0,10),stamp=date?`${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日`:'日期待确认';
 const time=date?(t.precision==='minute'?t.dueAt.slice(11,16):'全天事务'):'核对后再安排';
 const glyph={公告:'message',会议:'calendar',文件:'plans',费用:'inbox',日程:'calendar',其他:'inbox'}[t.category]||'inbox';
 return `<article class="task-feed-card ${t.status==='done'?'is-complete':''}" data-tone="${tone}"><div class="task-card-cover"><div class="task-card-label"><span class="chip tone-${tone}">${esc(t.category)}</span><span class="task-card-status">${status}</span></div><div class="task-card-date"><div><strong>${stamp}</strong><span>${time}</span></div><span class="task-card-symbol" aria-hidden="true">${icon(glyph)}</span></div>${t.priority==='high'?'<span class="task-card-important">重要事项</span>':''}</div><div class="task-card-body"><h3 title="${esc(t.title)}">${esc(t.title)}</h3><p class="task-card-source" title="${esc(t.group||'手动添加')}">${esc(t.group||'手动添加')}</p><p class="task-card-note">${esc(t.reason||'暂时没有备注，可以在详情中补充。')}</p></div><div class="task-card-actions">${t.status==='deleted'?`<button class="text-button" data-restore-task="${esc(t.id)}">恢复事务</button>`:`<button class="text-button" data-edit="${esc(t.id)}">${t.status==='inbox'?'核对与安排':'查看详情'}</button>${t.sourceIds?.length?`<button class="text-button" data-sources="${esc(t.sourceIds.join(','))}">原文</button>`:''}${t.status==='pending'?`<button class="text-button" data-status="done" data-id="${esc(t.id)}">完成</button>`:t.status==='inbox'?`<button class="text-button task-card-dismiss" data-status="dismissed" data-id="${esc(t.id)}">忽略</button>`:''}`}</div></article>`;
}
function inboxTypeFilters(){return `<div class="inbox-type-filter" role="group" aria-label="事务类型筛选">${['全部','公告','会议','文件','费用','日程','其他'].map(type=>`<button type="button" data-inbox-type="${type}" aria-pressed="${inboxType===type}">${type}</button>`).join('')}</div>`;}
function inboxPresentationControls(){return `<div class="feed-view-switch" role="group" aria-label="事务排版"><button type="button" data-inbox-presentation="cards" aria-pressed="${inboxPresentation==='cards'}">卡片</button><button type="button" data-inbox-presentation="list" aria-pressed="${inboxPresentation==='list'}">列表</button></div>`;}
document.addEventListener('click',e=>{
 const type=e.target.closest('[data-inbox-type]'),presentation=e.target.closest('[data-inbox-presentation]');
 if(type){inboxType=type.dataset.inboxType;draw();}
 else if(presentation){inboxPresentation=presentation.dataset.inboxPresentation;try{localStorage.setItem('shishi.inbox.presentation',inboxPresentation);}catch{}draw();}
});
document.addEventListener('change',e=>{
 if(e.target.matches('[data-task-select]')){if(e.target.checked)inboxSelected.add(e.target.dataset.taskSelect);else inboxSelected.delete(e.target.dataset.taskSelect);redrawInboxSelection();}
 else if(e.target.matches('[data-task-select-all]')){inboxSelected=e.target.checked?new Set(filteredInboxTasks().map(t=>t.id)):new Set();redrawInboxSelection();}
});
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b||inboxBatchBusy)return;
 if(b.hasAttribute('data-bulk-mode')){inboxSelecting=true;redrawInboxSelection();}
 else if(b.hasAttribute('data-bulk-select-all')){inboxSelecting=true;inboxSelected=new Set(filteredInboxTasks().map(t=>t.id));redrawInboxSelection();}
 else if(b.hasAttribute('data-bulk-exit')){inboxSelecting=false;inboxSelected.clear();redrawInboxSelection();}
 else if(b.dataset.bulkAction)applyInboxBulk(b.dataset.bulkAction);
 else if(b.hasAttribute('data-bulk-undo'))applyInboxBulk('restore',lastDeletedIds);
 else if(b.dataset.restoreTask)applyInboxBulk('restore',[b.dataset.restoreTask]);
});
