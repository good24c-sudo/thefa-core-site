import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import oidcStageNode from '../server/oidc-stage-node.mjs';
import {readStageOidcAccountConfig} from '../server/oidc-stage-account.mjs';
const issuer='https://furfjhymxqsbhvuyeqpx.supabase.co/auth/v1';
const origin='https://thefa-core-customer-git-chatgpt-p04-core-oidc-inte-10e5aa-thefa.vercel.app';
const env={
 VERCEL_ENV:'preview',THEFA_CORE_STAGE_BRIDGE_ENABLED:'true',
 THEFA_CORE_OIDC_ISSUER:issuer,
 THEFA_CORE_OIDC_ORIGIN:origin,
 THEFA_CORE_OIDC_CLIENT_ID:'6b70d657-b1fa-4174-a3f2-29d475f4e3c0',
 THEFA_CORE_STAGE_SERVICE_ROLE_KEY:'sb_secret_'+'x'.repeat(65),
 THEFA_CORE_STAGE_ACCOUNT_KEY_BASE64URL:randomBytes(32).toString('base64url'),
 THEFA_CORE_STAGE_ALLOWANCE_KEY_BASE64URL:randomBytes(32).toString('base64url'),
 THEFA_CORE_STAGE_TENANT_KEY:randomBytes(32).toString('base64url'),
 THEFA_CORE_OIDC_COOKIE_SECRET_BASE64URL:randomBytes(32).toString('base64url'),
};
test('stage-only configuration and unique account secrets accepted',()=>{
 const c=readStageOidcAccountConfig(env);
 assert.match(c.registryId,/^tenant_[a-f0-9]{64}$/);
 assert.equal(c.issuer,issuer);
});
test('production environment never accepts staging credential bridge',()=>{
 assert.throws(()=>readStageOidcAccountConfig({...env,VERCEL_ENV:'production'}),/STAGE_ACCOUNT_CONFIGURATION/);
});
test('issuer mismatch blocks runtime even if keys exist',()=>{
 assert.throws(()=>readStageOidcAccountConfig({...env,THEFA_CORE_OIDC_ISSUER:'https://other.example/auth/v1'}));
});
const backup={};
for(const key of Object.keys(env)){backup[key]=process.env[key];process.env[key]=env[key];}
test.after(()=>{for(const[key,value]of Object.entries(backup)){if(value===undefined)delete process.env[key];else process.env[key]=value}});
function nodeRequest(path,method='GET',headers={},data=null){
 const req=Readable.from(data===null?[]:[Buffer.from(JSON.stringify(data))]);
 Object.assign(req,{url:path,method,headers:{host:new URL(origin).host,...headers}});
 return req;
}
function response(){return {statusCode:200,headers:{},headersSent:false,writableEnded:false,
 setHeader(k,v){this.headers[k.toLowerCase()]=v},
 end(x){this.body=x;this.writableEnded=true}
};}
async function send(path,method='GET',headers={},data=null){
 const res=response();await oidcStageNode(nodeRequest(path,method,headers,data),res);
 return {status:res.statusCode,body:JSON.parse(res.body)};
}
test('preview catalog advertises valid single THE FA ID provider only',async()=>{
 const o=await send('/api/auth/providers');
 assert.equal(o.status,200);
 assert.equal(o.body.unified.enabled,true);
 assert.equal(o.body.providers.length,2);
 assert.ok(o.body.providers.every(v=>v.enabled===false));
 assert.equal(o.body.email.enabled,false);
});
test('unauthenticated workspace is 401, not a spurious server 503',async()=>{
 const o=await send('/api/customer/workspace');
 assert.equal(o.status,401);assert.equal(o.body.code,'AUTH_REQUIRED');
});
test('anonymous auth session is not a forged signed account',async()=>{
 const o=await send('/api/auth/session');
 assert.equal(o.status,200);assert.equal(o.body.authenticated,false);
});
test('host spoof is rejected before Supabase read',async()=>{
 const o=await send('/api/customer/workspace','GET',{host:'attacker.example'});
 assert.equal(o.status,403);
});
test('stage auth cannot be started using unverified legacy provider',async()=>{
 const o=await send('/auth/start','POST',{origin,'content-type':'application/json'},{});
 assert.equal(o.status,503);assert.equal(o.body.code,'USE_THEFA_UNIFIED_ID_LOGIN');
});
test('logout needs same-origin POST with expected JSON shape',async()=>{
 const a=await send('/auth/logout','POST',{origin:'https://evil.example'},{});assert.equal(a.status,403);
 const b=await send('/auth/logout','POST',{origin,'content-type':'application/json'},{});assert.equal(b.status,200);assert.equal(b.body.success,true);
});
