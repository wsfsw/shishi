import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
if(!files.length)throw new Error('Git index is empty; stage reviewed source files first.');
const issues=[];
for(const file of files){
 if(/(?:^|\/)(?:data|\.wechat-venv|node_modules|__pycache__|wxauto_logs|dist|desktop-build|runtime)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:log|pid|sqlite(?:-.*)?|db|dpapi|pem|key|pyc|exe|zip)$/i.test(file)||/^[^/]+\.(?:png|jpe?g|webp)$/i.test(file))issues.push(file+': excluded runtime or private artifact');
 const content=fs.readFileSync(path.join(root,file));
 if(/\.(?:mjs|js|json|md|txt|py|cs|ps1|cmd|html|css|ya?ml)$/.test(file)){
  const text=content.toString('utf8');
  if(/\b(?:sk-[a-zA-Z0-9]{20,}|gh[pousr]_[a-zA-Z0-9]{25,}|github_pat_[a-zA-Z0-9_]{25,})\b/.test(text)||/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)||/\bwxid_[A-Za-z0-9]{6,}\b/.test(text))issues.push(file+': potential credential or WeChat account identifier');
 }
}
if(issues.length){for(const issue of issues)console.error(issue);process.exit(1);}
console.log(`Publish audit passed: ${files.length} reviewed files; no forbidden paths or recognized credential formats.`);
