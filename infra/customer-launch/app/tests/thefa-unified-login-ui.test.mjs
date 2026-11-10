import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const txt=async p=>readFile(path.join(root,p),'utf8');
test('login and signup expose one hidden THE FA unified identity action',async()=>{
 for(const n of ['login.html','signup.html']){
  const t=await txt('public-source/'+n);
  assert.match(t,/<button id="thefa-id-login"[^>]*hidden disabled>/);
  assert.equal((t.match(/id="thefa-id-login"/g)||[]).length,1);
 }
});
test('public source and deployment browser copies match exactly',async()=>{
 for(const n of ['login.html','signup.html','customer-login.js','customer-login.css']){
  const source=await readFile(path.join(root,'public-source',n));
  const live=await readFile(path.join(root,'customer-public',n));
  assert.deepEqual(source,live);
 }
});
test('reviewed public file manifest pins edited source bytes',async()=>{
 const manifest=JSON.parse(await txt('public-files.json'));
 for(const name of ['login.html','signup.html','customer-login.js','customer-login.css']){
  const entry=manifest.find(x=>x.path===name);
  assert.ok(entry);
  const hash=createHash('sha256').update(await readFile(path.join(root,'public-source',name))).digest('hex');
  assert.equal(entry.sha256,hash);
 }
});
test('unified login is gated by verified server status and exposes no AI entitlement',async()=>{
 const t=await txt('public-source/customer-login.js'),css=await txt('public-source/customer-login.css');
 assert.match(t,/fetch\('\/api\/oidc\/status'/);
 assert.match(t,/capability\?\.configured!==true/);
 assert.match(t,/location\.assign\('\/api\/oidc\/start'\)/);
 assert.match(t,/request\('\/api\/oidc\/session'\)/);
 assert.match(t,/Core 고객 계정 연결은 준비 중입니다/);
 assert.match(css,/\.providers \[hidden\]\{display:none!important\}/);
 assert.doesNotMatch(t,/canUseAi\s*=\s*true/);
});
