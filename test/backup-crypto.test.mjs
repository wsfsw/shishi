import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
test('备份加密可跨运行恢复，错误密码与篡改被拒绝，文件不包含明文任务或密码',async()=>{
 const create=()=>{const c=vm.createContext({crypto:webcrypto,Uint8Array,TextEncoder,TextDecoder,btoa,atob});vm.runInContext(fs.readFileSync(new URL('../public/backup-crypto.js',import.meta.url),'utf8')+'\nthis.helper=ShishiBackupCrypto;',c);return c.helper;};
 const value={format:'shishi-backup',version:1,tables:{tasks:[{title:'合成私密任务'}]}},password='synthetic-password-for-test';const encrypted=await create().encrypt(value,password);
 assert(!JSON.stringify(encrypted).includes(value.tables.tasks[0].title));assert(!JSON.stringify(encrypted).includes(password));
 assert.equal(JSON.stringify(await create().decrypt(encrypted,password)),JSON.stringify(value));await assert.rejects(create().decrypt(encrypted,'wrong-password'),/密码/);
 const tampered={...encrypted,content:encrypted.content.slice(0,-8)+'AAAAAAAA'};await assert.rejects(create().decrypt(tampered,password),/损坏/);
});
