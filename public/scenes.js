/* Decorative scenes are local appearance preferences. They never touch task data. */
(() => {
 const storageKey='shishi.scene.v1';
 const scenes={sky:{name:'晴空流云',note:'蓝天 · 慢慢飘过的云'},aurora:{name:'极光星海',note:'极光 · 星光与湖面'},sunset:{name:'落日微光',note:'晚霞 · 海面与萤火'}};
 let scene='aurora',motion=true;
 try {
  const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(saved&&Object.hasOwn(scenes,saved.scene))scene=saved.scene;
  if(typeof saved?.motion==='boolean')motion=saved.motion;
 } catch { /* Private browsing or malformed preferences use the default scene. */ }
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const pauseIcon='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10M13 5v10"/></svg>';
 const playIcon='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 9 6-9 6Z"/></svg>';
 function save(){try{localStorage.setItem(storageKey,JSON.stringify({scene,motion}));}catch{}}
 function apply(){
  const stopped=!motion||reduced.matches;
  document.body.dataset.scene=scene;
  document.body.dataset.sceneMotion=stopped||document.hidden?'paused':'running';
  document.querySelectorAll('[data-scene-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.sceneChoice===scene)));
  document.querySelectorAll('[data-scene-name]').forEach(el=>el.textContent=scenes[scene].name);
  document.querySelectorAll('[data-scene-state]').forEach(el=>el.textContent=stopped?'已暂停':'播放中');
  document.querySelectorAll('[data-motion-toggle]').forEach(button=>{
   button.disabled=reduced.matches;
   button.innerHTML=(stopped?playIcon:pauseIcon)+`<span>${reduced.matches?'系统已减弱动态':motion?'动态播放中 · 暂停':'动态已暂停 · 播放'}</span>`;
   button.setAttribute('aria-pressed',String(!stopped));
   button.setAttribute('aria-label',reduced.matches?'系统已减弱动态效果':motion?'暂停动态背景':'播放动态背景');
  });
 }
 function art(){
  const stars=Array.from({length:18},()=>'<i class="scene-star scene-animated"></i>').join('');
  const motes=Array.from({length:8},()=>'<i class="scene-mote scene-animated"></i>').join('');
  return `<div class="scene-art" aria-hidden="true"><div class="scene-image scene-animated"></div><div class="scene-aurora"><i class="aurora-band band-one scene-animated"></i><i class="aurora-band band-two scene-animated"></i></div><div class="scene-cloud cloud-one scene-animated"></div><div class="scene-cloud cloud-two scene-animated"></div><div class="scene-stars">${stars}<i class="scene-meteor scene-animated"></i></div><div class="scene-motes">${motes}</div><div class="scene-water scene-animated"></div></div>`;
 }
 function controls(){
  return `<div class="scene-picker"><div class="scene-choices" role="group" aria-label="选择背景场景">${Object.entries(scenes).map(([key,value])=>`<button type="button" data-scene-choice="${key}" aria-pressed="${key===scene}" title="${value.note}"><span class="scene-swatch swatch-${key}" aria-hidden="true"></span><span>${value.name}</span></button>`).join('')}</div><button type="button" class="scene-motion-button" data-motion-toggle></button></div>`;
 }
 document.addEventListener('click',event=>{
  const choice=event.target.closest('[data-scene-choice]'),toggle=event.target.closest('[data-motion-toggle]');
  if(choice&&Object.hasOwn(scenes,choice.dataset.sceneChoice)){scene=choice.dataset.sceneChoice;save();apply();}
  else if(toggle&&!reduced.matches){motion=!motion;save();apply();}
 });
 document.addEventListener('visibilitychange',apply);
 reduced.addEventListener('change',apply);
 window.addEventListener('storage',event=>{
  if(event.key!==storageKey)return;
  try{const value=JSON.parse(event.newValue||'null');if(value&&Object.hasOwn(scenes,value.scene))scene=value.scene;if(typeof value?.motion==='boolean')motion=value.motion;apply();}catch{}
 });
 document.querySelector('.workspace-scenery').innerHTML=art()+'<div class="workspace-shade"></div>';
 window.ShishiScenes=Object.freeze({controls,sync:apply});
 apply();
})();
