// The reference contributes the navigation and card rhythm; task data stays local.
let inboxType='全部',inboxPresentation='cards';
try{if(localStorage.getItem('shishi.inbox.presentation')==='list')inboxPresentation='list';}catch{}
function renderInboxCard(t){
 const tone=categoryTone(t.category),status={inbox:'待确认',pending:'已安排',done:'已完成',dismissed:'已忽略'}[t.status]||'待确认';
 const date=t.dueAt?.slice(0,10),stamp=date?`${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日`:'日期待确认';
 const time=date?(t.precision==='minute'?t.dueAt.slice(11,16):'全天事务'):'核对后再安排';
 const glyph={公告:'message',会议:'calendar',文件:'plans',费用:'inbox',日程:'calendar',其他:'inbox'}[t.category]||'inbox';
 return `<article class="task-feed-card ${t.status==='done'?'is-complete':''}" data-tone="${tone}"><div class="task-card-cover"><div class="task-card-label"><span class="chip tone-${tone}">${esc(t.category)}</span><span class="task-card-status">${status}</span></div><div class="task-card-date"><div><strong>${stamp}</strong><span>${time}</span></div><span class="task-card-symbol" aria-hidden="true">${icon(glyph)}</span></div>${t.priority==='high'?'<span class="task-card-important">重要事项</span>':''}</div><div class="task-card-body"><h3 title="${esc(t.title)}">${esc(t.title)}</h3><p class="task-card-source" title="${esc(t.group||'手动添加')}">${esc(t.group||'手动添加')}</p><p class="task-card-note">${esc(t.reason||'暂时没有备注，可以在详情中补充。')}</p></div><div class="task-card-actions"><button class="text-button" data-edit="${esc(t.id)}">${t.status==='inbox'?'核对与安排':'查看详情'}</button>${t.sourceIds?.length?`<button class="text-button" data-sources="${esc(t.sourceIds.join(','))}">原文</button>`:''}${t.status==='pending'?`<button class="text-button" data-status="done" data-id="${esc(t.id)}">完成</button>`:t.status==='inbox'?`<button class="text-button task-card-dismiss" data-status="dismissed" data-id="${esc(t.id)}">忽略</button>`:''}</div></article>`;
}
function inboxTypeFilters(){return `<div class="inbox-type-filter" role="group" aria-label="事务类型筛选">${['全部','公告','会议','文件','费用','日程','其他'].map(type=>`<button type="button" data-inbox-type="${type}" aria-pressed="${inboxType===type}">${type}</button>`).join('')}</div>`;}
function inboxPresentationControls(){return `<div class="feed-view-switch" role="group" aria-label="事务排版"><button type="button" data-inbox-presentation="cards" aria-pressed="${inboxPresentation==='cards'}">卡片</button><button type="button" data-inbox-presentation="list" aria-pressed="${inboxPresentation==='list'}">列表</button></div>`;}
document.addEventListener('click',e=>{
 const type=e.target.closest('[data-inbox-type]'),presentation=e.target.closest('[data-inbox-presentation]');
 if(type){inboxType=type.dataset.inboxType;draw();}
 else if(presentation){inboxPresentation=presentation.dataset.inboxPresentation;try{localStorage.setItem('shishi.inbox.presentation',inboxPresentation);}catch{}draw();}
});
