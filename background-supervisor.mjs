import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

export function startBackgroundCollector(root){
 const python=path.join(root,'.wechat-venv','Scripts','python.exe');
 const script=path.join(root,'scripts','background_worker.py');
 if(process.platform!=='win32'||!fs.existsSync(python))return ()=>{};
 let child=null,stopped=false,timer=null;
 const record=path.join(root,'data','background-worker.pid');
 function start(){
  if(stopped)return;
  child=spawn(python,['-X','utf8',script],{cwd:root,windowsHide:true,stdio:'ignore'});
  if(child.pid)fs.writeFileSync(record,String(child.pid));
  const retry=()=>{child=null;if(!stopped)timer=setTimeout(start,10000);};
  child.once('error',retry);
  child.once('exit',()=>{if(child)retry();});
 }
 start();
 return ()=>{stopped=true;clearTimeout(timer);if(child?.pid){
  // Terminate only the exact child tree created by this service.
  spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
 }};
}
