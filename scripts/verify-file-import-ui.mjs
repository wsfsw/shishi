// Isolated UI acceptance server: only the synthetic fixture is sent to DeepSeek.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createStore} from '../store.mjs';
import {createSecrets} from '../secrets.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testDir=process.env.SHISHI_ACCEPTANCE_DATA_DIR||fs.mkdtempSync(path.join(root,'data','file-import-check-'));
if(!path.resolve(testDir).startsWith(path.join(root,'data','file-import-check-')))throw new Error('验收目录必须是本项目独立测试目录');
const store=createStore(path.join(testDir,'shishi.sqlite'));
store.setSetting('desktopEnabled',false);store.setSetting('syncEnabled',false);store.db.close();
if(process.env.SHISHI_ACCEPTANCE_CALENDAR_FIXTURES==='1'){
 const fixture=createStore(path.join(testDir,'shishi.sqlite'));
 const rows=[['一页学习总结','日程','2026-10-07T09:00:00+08:00','pending','将已有笔记整理为五个要点和一个例子。完成后检查是否控制在一页内。'],['整理课程资料','文件','2026-10-07T10:00:00+08:00','pending','下载课程资料并按章节归档。\n需要准备：课程讲义、课堂笔记和上周的练习。'],['课程项目评审','会议','2026-10-07T14:30:00+08:00','pending','地点：教学楼 302。带上项目演示、说明文档和待讨论的问题。\n本周视图完整展示这些材料要求，不使用省略号隐藏内容。'],['提交课程报告','文件','2026-10-07','inbox','截止日期需要核对，确认后再启用提醒。报告中应包含项目目标、完成过程和结果。'],['领取活动材料','其他','2026-10-07T16:00:00+08:00','inbox','请核对领取地点及本人是否需要参加，原始资料可点击查看。']];
 for(const [i,row] of rows.entries()){const [title,category,dueAt,status,reason]=row,id='week-fixture-'+i,source='week-source-'+i;if(fixture.getTask(id))continue;fixture.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(source,'验收资料 · 本周样例','验收资料',title+'\n'+reason,null,new Date().toISOString());fixture.addTask({id,title:'验收样例：'+title,category,dueAt,status,precision:dueAt.length===10?'date':'minute',reason,sourceIds:[source],priority:i===2?'high':'normal'});}
 fixture.db.close();
}
const key=await createSecrets(path.join(root,'data')).get();
if(!key)throw new Error('DeepSeek 尚未配置');
const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,windowsHide:true,env:{...process.env,PORT:'14319',SHISHI_DATA_DIR:testDir,SHISHI_DEEPSEEK_API_KEY:key},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',data=>process.stdout.write(data));child.stderr.on('data',data=>process.stderr.write(data));
child.on('exit',code=>process.exit(code||0));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill());
