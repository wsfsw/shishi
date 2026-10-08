import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {idFor} from './extract.mjs';
const script=fileURLToPath(new URL('./scripts/notify.ps1',import.meta.url));
export function desktopNotify(title,body){return new Promise((resolve,reject)=>{if(process.platform!=='win32')return reject(new Error('桌面通知需要 Windows'));const p=spawn('powershell.exe',['-NoProfile','-STA','-WindowStyle','Hidden','-File',script,Buffer.from(JSON.stringify({title,body})).toString('base64')],{windowsHide:true,stdio:'ignore'});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(new Error('通知组件退出码 '+code)));});}
export function dueReminders(store,now=Date.now()){
 const result=[];
 for(const task of store.listTasks()){if(task.status!=='pending'||!['minute','date'].includes(task.precision)||!task.dueAt)continue;const scheduled=task.precision==='date'?new Date(`${task.dueAt}T${store.setting('allDayReminderTime','09:00')}:00+08:00`).getTime():new Date(task.dueAt).getTime()-task.remindMinutes*60_000;if(scheduled>now||!Number.isFinite(scheduled))continue;const id=idFor(task.id,String(scheduled));if(store.db.prepare('SELECT 1 FROM notifications WHERE id=? OR (task_id=? AND scheduled_at=?)').get(id,task.id,new Date(scheduled).toISOString()))continue;result.push({id,task,scheduled});}
 for(const row of store.db.prepare('SELECT * FROM snoozes WHERE scheduled_at<=?').all(now)){const task=store.getTask(row.task_id);if(task?.status!=='pending'){store.db.prepare('DELETE FROM snoozes WHERE task_id=?').run(row.task_id);continue;}result.push({id:idFor(task.id,'snooze',String(row.scheduled_at)),task,scheduled:row.scheduled_at,snoozed:true});}
 return result;
}
export async function tickReminders(store,notify=desktopNotify,now=Date.now()){
 const due=dueReminders(store,now);
 for(const {id,task,scheduled,snoozed} of due){const title='拾事提醒 · '+task.title;const when=task.precision==='date'?`日期：${task.dueAt}（全天）\n提醒设置：当天 ${store.setting('allDayReminderTime','09:00')}（北京时间）`:'时间：'+new Date(task.dueAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});const body=(task.group?'来自 '+task.group+'\n':'')+when;store.db.prepare('INSERT OR IGNORE INTO notifications VALUES(?,?,?,?,?,?,?,?)').run(id,task.id,title,body,new Date(scheduled).toISOString(),new Date(now).toISOString(),0,store.setting('desktopEnabled',true)?'sending':'disabled');
 if(snoozed)store.db.prepare('DELETE FROM snoozes WHERE task_id=?').run(task.id);
 if(store.setting('desktopEnabled',true)){try{await notify(title,body);store.db.prepare('UPDATE notifications SET desktop_status=? WHERE id=?').run('sent',id);}catch(e){store.db.prepare('UPDATE notifications SET desktop_status=? WHERE id=?').run('failed',id);console.error('desktop notification failed:',e.message);}}
 }
 return due.length;
}
export function snoozeNotification(store,id,now=Date.now()){
 const n=store.db.prepare('SELECT * FROM notifications WHERE id=?').get(id);
 if(!n)throw new Error('提醒不存在');
 if(store.getTask(n.task_id)?.status!=='pending')throw new Error('这项事务已结束或尚未安排');
 store.db.prepare('INSERT INTO snoozes VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET scheduled_at=excluded.scheduled_at').run(n.task_id,now+10*60_000);
 store.db.prepare('UPDATE notifications SET read=1 WHERE id=?').run(id);
}
