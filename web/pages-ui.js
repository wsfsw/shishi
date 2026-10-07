/* Only included in the static build; the Windows application remains unchanged. */
(() => {
 const localLink='<a class="button primary" href="http://127.0.0.1:4317/#settings" target="_blank" rel="noopener noreferrer">连接本机微信 ↗</a>';
 const repoLink='<a class="text-button" href="https://github.com/wsfsw/shishi" target="_blank" rel="noopener noreferrer">查看仓库与运行说明 ↗</a>';
 const notice=document.createElement('aside');notice.className='pages-notice';notice.setAttribute('aria-label','网页版功能范围');
 notice.innerHTML='<div><strong>你的事务工作台</strong><p>记录保存在当前浏览器。连接自己的 DeepSeek 后可整理文字；微信后台读取由本机版完成。关闭页面后停止提醒。</p></div><button class="button secondary" data-go="settings">连接微信 / DeepSeek</button>';
 document.querySelector('#content').before(notice);
 labels.settings='连接设置';
 const settingsNav=document.querySelector('[data-view="settings"]');settingsNav.setAttribute('aria-label','连接设置');settingsNav.title='连接设置';settingsNav.querySelector('.rail-label').textContent='连接设置';
 renderSettings=()=>{
  const ai=state.settings.ai;
  return header('把工具连接到你的工作台','连接设置','微信在自己的电脑上读取，DeepSeek 使用你自己的 API Key。')+`<div class="pages-connections"><section class="panel pages-local-panel"><div class="pages-connection-heading"><span class="chip tone-mint">微信</span><span class="muted">Windows 本机连接</span></div><h2>连接本机微信</h2><p>先在 Windows 上启动拾事本机版，再点击下面的按钮。进入本机连接页后，选择群聊、日期和信息类型并保存，采集器才会整理。</p><div class="head-actions">${localLink}</div><p class="hint">按钮打开 127.0.0.1 的本机页面。若无法打开，请从仓库下载并启动项目。网页不会自动读取群聊，微信连接状态和群聊事务在本机页查看。</p>${repoLink}</section><section class="panel pages-local-panel"><div class="pages-connection-heading"><span class="chip tone-sky">DeepSeek</span><span class="pages-connection-state ${ai.configured?'connected':''}">${ai.configured?'已验证连接':'尚未连接'}</span></div><h2>用自己的 AI 整理</h2><p>输入 API Key，点击连接即可验证。密钥只保留在当前页面内存中；刷新或关闭页面后需要重新输入。</p><form id="pages-ai-form"><label for="pages-api-key">DeepSeek API Key<input id="pages-api-key" name="apiKey" type="password" autocomplete="off" spellcheck="false" maxlength="200" required placeholder="粘贴自己的 API Key" aria-describedby="pages-key-help pages-ai-error"></label><label for="pages-model">整理模型<select id="pages-model" name="model"><option value="deepseek-flash" ${ai.model==='deepseek-flash'?'selected':''}>DeepSeek V4.1 Flash</option><option value="deepseek-v4-pro" ${ai.model==='deepseek-v4-pro'?'selected':''}>DeepSeek V4 Pro</option></select></label><p id="pages-key-help" class="hint">连接会向 DeepSeek 发送一条测试请求，可能产生少量 API 费用。整理时只发送你主动提交的文字；不会把密钥发给 GitHub 或写入事务记录。</p><div class="head-actions"><button class="button primary" type="submit">${ai.configured?'更换并验证连接':'连接 DeepSeek'}</button>${ai.configured?'<button class="button secondary" type="button" data-pages-ai-disconnect>断开连接</button><button class="button secondary" type="button" data-import>开始整理文字</button>':''}</div><p id="pages-ai-error" class="error" role="alert"></p></form>${ai.configured?'<p class="hint">当前模型：'+esc(ai.model)+' · 连接已通过验证</p>':''}</section></div>`;
 };
 renderPlans=()=>header('比较方法，安排步骤','方案与复盘','AI 生成方案、文件整理和反馈调整在本机版中使用。')+'<div class="panel pages-local-panel"><h2>在本机版规划与复盘</h2><p>本机服务能调用你配置的 DeepSeek，展示安排前后对比，并在你确认后写入日历。</p><div class="head-actions">'+localLink+repoLink+'</div></div>';
 renderNotifications=()=>header('页面打开时，及时想起','提醒','这里只记录当前浏览器的事务提醒；关闭页面不再检查，全天事项按北京时间 09:00 提醒。')+'<div class="panel">'+(state.notifications.length?state.notifications.map(n=>'<div class="notification-row"><div class="task-main"><h3>'+esc(n.title)+'</h3><p>'+esc(n.body)+'</p><div class="task-meta">'+fmt(n.created_at)+(n.read?'':' · 未读')+'</div></div>'+(n.read?'':'<button class="text-button" data-read="'+esc(n.id)+'">已读</button>')+'</div>').join(''):empty('目前没有网页提醒','新增带日期的事务并确认加入日历，保持页面打开即可检查提醒。'))+'</div>';
 const originalDraw=draw;
 draw=()=>{
  originalDraw();
  for(const b of document.querySelectorAll('[data-file-import],[data-test],[data-problem-new]')){b.disabled=true;b.title='需要 Windows 本机版';}
  for(const b of document.querySelectorAll('[data-import]')){b.disabled=!state.settings.ai.configured;b.title=b.disabled?'先在连接设置中连接 DeepSeek':'只整理你主动提交的文字';if(b.textContent==='整理聊天')b.textContent='AI 整理文字';}
  const message=document.querySelector('.inbox-collection .empty p');if(message&&!taskQuery.trim()&&inboxType==='全部'&&filter==='inbox')message.textContent='点击“新增事务”开始记录；数据只保存在当前浏览器。';
 };
 document.querySelector('.sidebar-foot').innerHTML='<span class="local-dot"></span><span>网页本地</span>';
 document.querySelector('#task-file-entry').hidden=true;
 document.querySelector('#import-form .hint').textContent='点击整理会将这里的文字发送给你连接的 DeepSeek，可能产生 API 费用。全部结果先进入事务箱，核对后再加入日历。可以暂停或结束未完成整理。';
 document.querySelector('#import-form button[type="submit"]').textContent='发送给 DeepSeek 并整理';
 document.addEventListener('input',event=>{if(event.target.closest('#pages-ai-form'))settingsDirty=true;});
 document.addEventListener('submit',async event=>{
  if(event.target.id!=='pages-ai-form')return;event.preventDefault();const form=event.target,button=form.querySelector('[type="submit"]'),error=form.querySelector('[role="alert"]');
  settingsDirty=true;button.disabled=true;button.textContent='正在验证连接…';error.textContent='';
  try{await api('/api/ai/config',{apiKey:form.elements.apiKey.value,model:form.elements.model.value});form.elements.apiKey.value='';settingsDirty=false;await refresh();toast('DeepSeek 连接验证通过，可以开始整理文字');}
  catch(err){error.textContent=err.message;button.disabled=false;button.textContent='连接 DeepSeek';}
 });
 document.addEventListener('click',async event=>{const b=event.target.closest('[data-pages-ai-disconnect]');if(!b)return;b.disabled=true;try{await api('/api/ai/config',{removeKey:true});settingsDirty=false;await refresh();toast('已断开 DeepSeek，页面内密钥已移除');}catch(err){toast(err.message,true);b.disabled=false;}});
 document.addEventListener('click',event=>{
  const link=event.target.closest('a[href="/api/calendar.ics"]');if(!link)return;event.preventDefault();
  const url=URL.createObjectURL(new Blob([ShishiPages.calendar()],{type:'text/calendar;charset=utf-8'}));
  const download=document.createElement('a');download.href=url;download.download='拾事-网页日历.ics';document.body.append(download);download.click();download.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 window.addEventListener('storage',event=>{if(event.key==='shishi.pages.data.v1')location.reload();});
 if(state)draw();
})();
