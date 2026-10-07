import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper=fileURLToPath(new URL('./scripts/protect-secret.ps1',import.meta.url));
function protect(mode,value){
 if(process.platform!=='win32')throw new Error('此密钥保存方式需要 Windows');
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Mode',mode],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';
  const timer=setTimeout(()=>{child.kill();reject(new Error('密钥保护操作超时'));},10000);
  child.stdout.on('data',d=>out+=d);child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(new Error('无法运行 Windows 密钥保护'));});
  child.on('exit',code=>{clearTimeout(timer);if(code!==0||!out.trim())reject(new Error('Windows 密钥保护失败'));else resolve(out.trim());});
  child.stdin.on('error',()=>{});child.stdin.end(value);
 });
}
export function createSecrets(dir){
 const file=path.join(dir,'deepseek-key.dpapi');let cached;
 return {
  configured:()=>!!process.env.SHISHI_DEEPSEEK_API_KEY||fs.existsSync(file),
  async get(){if(process.env.SHISHI_DEEPSEEK_API_KEY)return process.env.SHISHI_DEEPSEEK_API_KEY;if(cached)return cached;if(!fs.existsSync(file))return '';cached=Buffer.from(await protect('Decrypt',fs.readFileSync(file,'utf8')),'base64').toString('utf8');return cached;},
  async set(key){if(typeof key!=='string'||key.trim().length<12||key.trim().length>512||/[\s\x00-\x1f]/.test(key.trim()))throw new Error('API Key 格式不正确');const value=key.trim();const sealed=await protect('Encrypt',Buffer.from(value).toString('base64'));fs.writeFileSync(file+'.tmp',sealed,{mode:0o600});fs.renameSync(file+'.tmp',file);cached=value;},
  remove(){if(process.env.SHISHI_DEEPSEEK_API_KEY)throw new Error('当前使用环境变量配置，请从启动环境移除');fs.rmSync(file,{force:true});cached=undefined;}
 };
}
