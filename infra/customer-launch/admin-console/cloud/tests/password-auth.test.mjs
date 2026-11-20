import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createManagedPasswordVerifier} from '../password-auth.mjs';
import {createAuthService,createRestDatabase,COOKIE_NAME} from '../auth.mjs';
const url='https://cgrppxfdurpzzfvkmfte.supabase.co',email='ceo@thefa.kr';
const user={id:'11111111-1111-4111-8111-111111111111',email,email_confirmed_at:'2026-11-19T00:00:00.000Z',is_anonymous:false};
const token='synthetic-provider-token-never-production';
function fixture({profile=user,grant,tokenStatus=200,userStatus=200,dbFailure=false,malformed=false}={}){
 let calls=[],rows=new Map(),mail=0;
 const verify=createManagedPasswordVerifier({url,key:'synthetic-service-role-not-a-secret',allowedEmails:new Set([email]),clock:()=>Date.parse('2026-11-20T12:00:00Z'),fetchImpl:async (path,init)=>{
  calls.push({path,init});
  if(path.endsWith('token?grant_type=password'))return Response.json(grant??{access_token:token,token_type:'bearer',expires_in:3600,user}, {status:tokenStatus,headers:{'retry-after':'9'}});
  assert.equal(path,url+'/auth/v1/user');assert.equal(init.headers.Authorization,'Bearer '+token);
  return malformed?new Response('{broken',{status:200}):Response.json(profile,{status:userStatus});
 }});
 const auth=createAuthService({origin:'https://app.thefacore.com',otpSecret:'synthetic-otp-secret-long-enough-not-real',allowedEmails:new Set([email]),passwordVerifier:verify,clock:()=>Date.parse('2026-11-20T12:00:00Z'),sendEmail:async()=>{mail++;},database:{
  createSession:async row=>{if(dbFailure)throw Error('synthetic unacknowledged save');rows.set(row.token_hash,row);},
  getSession:async hash=>rows.get(hash),deleteSession:async hash=>rows.delete(hash)
 }});
 return {auth,rows,calls,mail:()=>mail};
}
test('verified password login uses two provider checks and one opaque admin session without sending mail',async()=>{
 const f=fixture(),result=await f.auth.verifyPassword({email:' CEO@THEFA.KR ',password:'synthetic-password-0001'});
 assert.equal(f.calls.length,2);assert.equal(f.rows.size,1);assert.equal(f.mail(),0);
 assert.equal(result.email,email);assert.match(result.cookie,/HttpOnly; Secure; SameSite=Lax/);
 assert.match(result.cookie,/Max-Age=28800/);assert.doesNotMatch(JSON.stringify(result),/synthetic-password|provider-token/);
 const row=[...f.rows.values()][0];assert.match(row.token_hash,/^[a-f0-9]{64}$/);
 assert.deepEqual(Object.keys(row).sort(),['email','expires_at','token_hash']);
 assert.equal((await f.auth.getSession(result.cookie.split(';')[0])).email,email);
 await f.auth.logout(result.cookie);assert.equal(await f.auth.getSession(result.cookie),null);
});
test('external addresses and administrator role claims never reach provider or create sessions',async()=>{
 for(const input of ['outsider@thefa.kr','ceo+test@thefa.kr','ceo@thefa.kr.evil','']){
  const f=fixture();await assert.rejects(f.auth.verifyPassword({email:input,password:'synthetic-password',role:'admin'}),e=>e.status===401);
  assert.equal(f.calls.length,0);assert.equal(f.rows.size,0);
 }
});
test('unverified, malformed and mismatched provider identity never gets an admin cookie',async()=>{
 for(const override of [
  {email:'other@thefa.kr'},{id:'22222222-2222-4222-8222-222222222222'},{is_anonymous:true},
  {email_confirmed_at:null},{email_confirmed_at:0},{email_confirmed_at:false},{email_confirmed_at:''},{email_confirmed_at:'2027-01-01T00:00:00Z'}
 ]){
  const f=fixture({profile:{...user,...override}});
  await assert.rejects(f.auth.verifyPassword({email,password:'synthetic-password'}));
  assert.equal(f.rows.size,0);
 }
 for(const options of [{grant:{access_token:token,token_type:'bearer',expires_in:0,user}},{malformed:true},{tokenStatus:400},{userStatus:401},{tokenStatus:500}]){
  const f=fixture(options);await assert.rejects(f.auth.verifyPassword({email,password:'synthetic-password'}));assert.equal(f.rows.size,0);
 }
});
test('provider rate limit is surfaced without automatic retry, session insert failure issues no cookie',async()=>{
 const limited=fixture({tokenStatus:429});
 await assert.rejects(limited.auth.verifyPassword({email,password:'synthetic-password'}),e=>e.status===429&&e.retryAfter===9);
 assert.equal(limited.calls.length,1);assert.equal(limited.rows.size,0);
 const missing=fixture({dbFailure:true});await assert.rejects(missing.auth.verifyPassword({email,password:'synthetic-password'}));assert.equal(missing.rows.size,0);
});
test('database accepts a successful empty 201 insert and never sends raw password or provider token',async()=>{
 let sent;
 const db=createRestDatabase({url,key:'synthetic-service-role-not-a-secret',fetchImpl:async (path,init)=>{sent={path,init};return new Response(null,{status:201});}});
 const row={token_hash:'a'.repeat(64),email,expires_at:'2026-11-21T00:00:00Z'};
 assert.equal(await db.createSession(row),null);
 assert.equal(sent.path,url+'/rest/v1/core_console_sessions_v2');
 assert.deepEqual(JSON.parse(sent.init.body),row);
});
test('native form fallback never puts password or OTP into a GET URL; setup links preserve admin tab',async()=>{
 const html=await readFile(new URL('../login.html',import.meta.url),'utf8');
 for(const id of ['passwordForm','emailForm','codeForm']){
  const form=html.match(new RegExp('<form[^>]*id=\"'+id+'\"[^>]*>'))?.[0];
  assert.match(form,/method=\"post\"/);assert.match(form,/action=\"\/auth\//);
 }
 assert.match(html,/href=\"https:\/\/thefacore\.com\/signup#email-login-form\" target=\"_blank\" rel=\"noopener noreferrer\"/);
 assert.match(html,/autocomplete=\"current-password\"/);
 assert.match(html,/id=\"otpFallback\"/);
});
test('old provider/customer/recovery cookies cannot be treated as admin sessions',async()=>{
 const f=fixture();for(const cookie of ['access_token='+token,'__Host-thefa_email=synthetic','__Host-thefa_recovery=synthetic',COOKIE_NAME+'='+email])assert.equal(await f.auth.getSession(cookie),null);
 assert.equal(f.calls.length,0);
});
