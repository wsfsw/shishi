import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStore} from '../store.mjs';
import {tickReminders} from '../reminders.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const store=createStore(path.join(root,'data','shishi.sqlite'));
const queue=new (await import('node:sqlite')).DatabaseSync(path.join(root,'data','background-queue.sqlite'));
const report={checkedAt:new Date().toISOString(),
 messages:store.db.prepare('SELECT count(*) n FROM messages').get().n,
 inboxTasks:store.db.prepare("SELECT count(*) n FROM tasks WHERE status='inbox'").get().n,
 confirmedTasks:store.db.prepare("SELECT count(*) n FROM tasks WHERE status='pending'").get().n,
 summaries:store.db.prepare('SELECT count(*) n FROM summaries').get().n,
 unselectedGroupMessages:store.db.prepare('SELECT count(*) n FROM messages m LEFT JOIN groups g ON m.group_name=g.name WHERE g.enabled IS NOT 1').get().n,
 queue:queue.prepare('SELECT status,count(*) count FROM jobs GROUP BY status').all(),
 sourceGroups:store.db.prepare('SELECT group_name,count(*) count FROM messages GROUP BY group_name').all(),
 bridge:store.setting('bridgeStatus',{})};
if(process.argv.includes('--reminder')){
 const test=createStore(':memory:');
 test.addTask({id:'background-reminder-test',title:'[验收测试] 拾事后台提醒',status:'pending',
 dueAt:new Date(Date.now()-2000).toISOString(),precision:'minute',remindMinutes:0});
 report.reminderTest={created:await tickReminders(test),
  repeat:await tickReminders(test),notification:test.db.prepare('SELECT desktop_status FROM notifications').get()};
 test.db.close();
}
fs.writeFileSync(path.join(root,'data','background-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
store.db.close();queue.close();
