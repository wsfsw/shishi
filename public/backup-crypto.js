/* Portable encrypted downloads. Passwords never enter app storage or requests. */
const ShishiBackupCrypto=(()=>{
 const encode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
 const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 async function key(password,salt){if(typeof password!=='string'||password.length<8||password.length>200)throw new Error('备份密码应为 8 至 200 个字符');const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
 async function encrypt(value,password){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),secret=await key(password,salt),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},secret,new TextEncoder().encode(JSON.stringify(value)));return {format:'shishi-encrypted-backup',version:1,salt:encode(salt),iv:encode(iv),content:encode(new Uint8Array(cipher))};}
 async function decrypt(value,password){if(value?.format!=='shishi-encrypted-backup')return value;if(value.version!==1||typeof value.content!=='string'||value.content.length>60_000_000)throw new Error('加密备份格式不正确');try{const salt=decode(value.salt),iv=decode(value.iv);if(salt.length!==16||iv.length!==12)throw new Error();const secret=await key(password,salt),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},secret,decode(value.content));return JSON.parse(new TextDecoder().decode(plain));}catch{throw new Error('密码不正确或加密备份已损坏');}}
 return {encrypt,decrypt};
})();
