import test from 'node:test';
import assert from 'node:assert/strict';
import oidcFallback from '../server/oidc-preview-fallback.mjs';
const saved={};
const entries={VERCEL_ENV:'preview',THEFA_CORE_OIDC_ISSUER:'https://furfjhymxqsbhvuyeqpx.supabase.co/auth/v1',
 THEFA_CORE_OIDC_ORIGIN:'https://thefa-core-customer-git-chatgpt-p04-core-oidc-inte-10e5aa-thefa.vercel.app'};
for(const[k,v]of Object.entries(entries)){saved[k]=process.env[k];process.env[k]=v}
test.after(()=>{for(const[k,v]of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v}});
function make(path,method='GET',headers={}){
 const req={url:path,method,headers:{host:new URL(entries.THEFA_CORE_OIDC_ORIGIN).host,...headers}};
 const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},end(b){this.body=b}};
 return {req,res};
}
async function call(path,method='GET',headers={}){
 const {req,res}=make(path,method,headers);await oidcFallback(req,res);
 return {status:res.statusCode,data:JSON.parse(res.body),headers:res.headers};
}
test('only registered unified Supabase Auth is offered, legacy false',async()=>{
 const r=await call('/api/auth/providers');
 assert.equal(r.status,200);assert.equal(r.data.unified.enabled,true);
 assert.deepEqual(r.data.providers.map(x=>x.enabled),[false,false]);
 assert.equal(r.data.email.enabled,false);
});
test('anonymous Core session is truthful 200, no account',async()=>{
 const r=await call('/api/auth/session');
 assert.equal(r.status,200);assert.equal(r.data.authenticated,false);
 assert.equal(r.data.accountLinked,false);
});
test('workspace before OAuth is protected 401, not internal init 503',async()=>{
 const r=await call('/api/customer/workspace');
 assert.equal(r.status,401);assert.equal(r.data.code,'AUTH_REQUIRED');
});
test('unconfigured production environment is refused',async()=>{
 process.env.VERCEL_ENV='production';
 try{const r=await call('/api/auth/providers');assert.equal(r.status,503);}
 finally{process.env.VERCEL_ENV='preview'}
});
test('canonical host mismatch denied before any login state',async()=>{
 const r=await call('/api/auth/providers','GET',{host:'attacker.example'});
 assert.equal(r.status,403);
});
test('legacy login returns explicit unified instruction only',async()=>{
 const r=await call('/auth/start','POST',{origin:entries.THEFA_CORE_OIDC_ORIGIN});
 assert.equal(r.status,503);assert.equal(r.data.code,'USE_THEFA_UNIFIED_ID_LOGIN');
});
test('Core local logout requires same-origin',async()=>{
 const invalid=await call('/auth/logout','POST',{origin:'https://attacker.example','content-type':'application/json'});
 assert.equal(invalid.status,403);
 const result=await call('/auth/logout','POST',{origin:entries.THEFA_CORE_OIDC_ORIGIN,'content-type':'application/json'});
 assert.equal(result.status,200);assert.equal(result.data.scope,'CORE_LOCAL_ONLY');
 assert.equal(result.headers['set-cookie'].length,2);
});
