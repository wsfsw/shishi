const fileDialog=$('#file-dialog'),fileForm=$('#file-form');
let fileImportBusy=false,fileImportResult;

const fileEntry=document.createElement('section');
fileEntry.id='task-file-entry';fileEntry.className='file-entry';
fileEntry.innerHTML=`<div><strong>文件里的安排，也可以一起拾起</strong><p>导入通知、活动安排或表格，让 DeepSeek 帮你排入日历。</p></div><button type="button" class="button secondary" data-file-import>导入文件，让 AI 安排 <span aria-hidden="true">↗</span></button>`;
$('#task-form input[type="hidden"]').after(fileEntry);

function resetFileImport(){
 fileForm.reset();fileImportResult=null;fileForm.elements.referenceDate.value=today();
 $('#file-fields').hidden=false;$('#file-result').hidden=true;$('#file-result').innerHTML='';
 $('#file-progress').textContent='';$('#file-error').textContent='';$('#file-selection').textContent='';
 $('#file-submit').hidden=false;$('#file-submit').disabled=!state.settings.ai.configured;
 $('#file-ai-note').textContent=state.settings.ai.configured?'提取的文件文字将发送给 DeepSeek 整理，文件原文保存在本机供你回看。':'请先在“微信连接”中配置 DeepSeek API Key，再导入文件。';
 document.querySelector('[data-file-again]').hidden=true;document.querySelector('[data-file-calendar]').hidden=true;
}

document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-file-import],[data-file-again],[data-file-calendar]');if(!b)return;
 if(b.hasAttribute('data-file-calendar')){
  fileDialog.close();view='calendar';const dates=(fileImportResult?.taskIds||[]).map(id=>state.tasks.find(t=>t.id===id)).filter(t=>t?.dueAt).map(t=>t.dueAt.slice(0,10)).sort();
  day=dates.find(date=>date>=today())||dates[0]||today();month=day.slice(0,7);draw();return;
 }
 resetFileImport();if(!fileDialog.open){$('#task-dialog').close();fileDialog.showModal();}
});

$('#schedule-file').addEventListener('change',()=>{
 const file=fileForm.elements.file.files[0];$('#file-error').textContent='';
 $('#file-selection').textContent=file?`${file.name} · ${file.size<1024*1024?(file.size/1024).toFixed(1)+' KB':(file.size/1024/1024).toFixed(1)+' MB'}`:'';
});
fileDialog.addEventListener('cancel',e=>{if(fileImportBusy)e.preventDefault();});

function fileAsBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('文件读取失败，请重新选择'));reader.readAsDataURL(file);});}

fileForm.addEventListener('submit',async e=>{
 e.preventDefault();if(fileImportBusy)return;const file=fileForm.elements.file.files[0];
 $('#file-error').textContent='';if(!file){$('#file-error').textContent='请先选择文件';return;}
 if(!/\.(pdf|docx|xlsx|txt|md|csv|png|jpg|jpeg)$/i.test(file.name)){ $('#file-error').textContent='请选择 PDF、DOCX、XLSX、TXT、MD、CSV、PNG 或 JPG 文件';return;}
 if(file.size>10*1024*1024){$('#file-error').textContent='文件超过 10MB，请拆分后导入';return;}
 const referenceDate=fileForm.elements.referenceDate.value,remindMinutes=Number(fileForm.elements.remindMinutes.value);
 fileImportBusy=true;fileDialog.setAttribute('aria-busy','true');$('#file-fields').disabled=true;$('#file-submit').disabled=true;$('#file-dialog [data-close]').disabled=true;
 try{
  $('#file-progress').textContent='正在读取所选文件…';const content=await fileAsBase64(file);
  $('#file-progress').textContent='正在解析文件，由 DeepSeek 提取事项和日期…';
  const result=await runAIJob('file',{file:{name:file.name,content},referenceDate,remindMinutes},{title:'整理文件里的事务'});fileImportResult=result;await refresh();
  $('#file-progress').textContent='';$('#file-fields').hidden=true;$('#file-submit').hidden=true;
  const tasks=result.taskIds.map(id=>state.tasks.find(t=>t.id===id)).filter(Boolean);
  $('#file-result').innerHTML=`<div class="file-result-head"><p class="eyebrow">${result.duplicate?'这个文件已整理':'整理完成'}</p><h3>${esc(result.name)}</h3><p>${esc(result.message)}</p></div>${tasks.length?`<div class="file-result-list">${tasks.map(t=>`<article class="file-result-item"><div class="badge-line"><span class="chip tone-${t.status==='pending'?'mint':'butter'}">${t.status==='pending'?'已加入日历':t.status==='inbox'?'日期待确认':t.status==='done'?'已完成':'已忽略'}</span><span>${fmt(t.dueAt)}${t.precision==='date'?' · 全天':''}</span></div><strong>${esc(t.title)}</strong>${t.reason?`<p>${esc(t.reason)}</p>`:''}<button type="button" class="text-button" data-sources="${esc(t.sourceIds.join(','))}">查看文件原文</button></article>`).join('')}</div>`:'<p class="hint">文件已读取，AI 没有找到可执行事项。可补充具体事项和日期后重新导入。</p>'}`;
  $('#file-result').hidden=false;document.querySelector('[data-file-again]').hidden=false;document.querySelector('[data-file-calendar]').hidden=!tasks.some(t=>t.dueAt);
 }catch(error){$('#file-progress').textContent='';if(error.code==='AI_CANCELLED')toast(error.message);else $('#file-error').textContent=error.message+'。可调整文件或设置后重试。';}
 finally{fileImportBusy=false;fileDialog.removeAttribute('aria-busy');$('#file-fields').disabled=false;$('#file-submit').disabled=false;$('#file-dialog [data-close]').disabled=false;}
});
