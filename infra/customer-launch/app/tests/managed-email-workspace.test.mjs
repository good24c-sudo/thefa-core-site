import test from 'node:test';import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createManagedEmailCustomerServer} from '../server/managed-email-composition.mjs';import {FakeLeaseDatabase} from './fake-lease-database.mjs';
const origin='https://thefacore.com',base='https://cgrppxfdurpzzfvkmfte.supabase.co';
async function setup(){const db=new FakeLeaseDatabase(),users=new Map(),revoked=new Set(),codes=new Map();let seq=1,modelCalls=0;
 const config={accountMode:'fresh-launch',usageEpoch:'fresh-email-20261117',launchStartedAt:new Date(Date.now()-60000).toISOString(),customerOrigin:origin,environment:'production',supabaseUrl:base,serviceRoleKey:'synthetic-service-not-real-1234',tenantKey:'synthetic-stable-tenant-key-at-least-32',accountSecret:Buffer.alloc(32,41),allowanceSecret:Buffer.alloc(32,42),budgetSecret:Buffer.alloc(32,43),deepseekApiKey:'sk-synthetic-only-provider-api-key',redirectReady:true};
 const fetcher=async(url,options={})=>{const u=new URL(url);
  if(u.origin==='https://api.deepseek.com'){modelCalls++;return Response.json({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{role:'assistant',content:'Synthetic isolated answer'}}],usage:{prompt_tokens:12,completion_tokens:8}});}
  assert.equal(u.origin,base);
  if(u.pathname==='/auth/v1/token'){const b=JSON.parse(options.body);let email=b.email;
   if(u.searchParams.get('grant_type')==='pkce'){const flow=codes.get(b.auth_code);codes.delete(b.auth_code);assert.ok(flow);assert.equal(createHash('sha256').update(b.code_verifier).digest('base64url'),flow.challenge);email=flow.email;}
   if(!users.has(email)){const id=`00000000-0000-4000-8000-${String(seq++).padStart(12,'0')}`;users.set(email,{id,email,email_confirmed_at:new Date().toISOString(),user_metadata:{name:'QA'},identities:[{user_id:id,provider:'custom:google'}]});}const usr=users.get(email);return Response.json({access_token:'verified-test-'+usr.id,token_type:'bearer',expires_in:3600,user:usr});}
  if(u.pathname==='/auth/v1/user'){const token=options.headers.authorization?.slice(7);const usr=[...users.values()].find(x=>'verified-test-'+x.id===token);return usr&&!revoked.has(token)?Response.json(usr):Response.json({code:'unauthorized'},{status:401});}
  if(u.pathname==='/auth/v1/logout'){revoked.add(options.headers.authorization.slice(7));return new Response(null,{status:204});}
  if(u.pathname.startsWith('/rest/v1/rpc/'))return Response.json(await db.rpc(u.pathname.split('/').at(-1),JSON.parse(options.body)));
  if(u.pathname==='/rest/v1/core_console_state_v3')return Response.json(await db.request('/core_console_state_v3'+u.search));
  throw Error('UNEXPECTED_URL');};
 const app=createManagedEmailCustomerServer({settings:{authEngine:'managed-email-v1',googleProvider:'custom:google',config,secret:'synthetic-long-private-cookie-secret',publishableKey:'sb_publishable_synthetic_12345678901234567890'},fetchImpl:fetcher});
 const call=(path,body,cookie='')=>app.application(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{host:'thefacore.com',origin,...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 const login=async email=>{const r=await call('/auth/email/login',{email,password:'synthetic-password'});assert.equal(r.status,200,await r.clone().text());return r.headers.get('set-cookie').split(';')[0];};
 const google=async email=>{const start=await call('/auth/start',{provider:'google'});assert.equal(start.status,200);const target=new URL((await start.json()).location),code=randomUUID();codes.set(code,{email,challenge:target.searchParams.get('code_challenge')});const r=await call('/auth/google/callback?code='+code,undefined,start.headers.getSetCookie()[0].split(';')[0]);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/');return r.headers.getSetCookie().find(c=>c.startsWith('__Host-thefa_customer_email=')).split(';')[0];};
 return {app,call,login,google,db,modelCount:()=>modelCalls};}
test('managed verified account creates durable customer workspace and re-login keeps usage',async()=>{const x=await setup();assert.equal((await x.call('/api/customer/workspace')).status,401);const cookie=await x.login('alice@example.test');const w=await x.call('/api/customer/workspace',undefined,cookie);assert.equal(w.status,200,await w.clone().text());
 const c=await x.call('/api/customer/action',{action:'conversation.create',payload:{title:'new account'},requestId:'managed-create-0001'},cookie);assert.equal(c.status,201,await c.clone().text());const id=(await c.json()).conversation.id;
 const send=await x.call('/api/customer/chat/send',{conversationId:id,content:'hello',requestId:'managed-send-0001'},cookie);assert.equal(send.status,200,await send.clone().text());assert.equal(x.modelCount(),1);
 const second=await x.login('alice@example.test');const allowance=await (await x.call('/api/customer/allowance',undefined,second)).json();assert.equal(allowance.allowance.remaining,9);assert.equal((await x.call('/api/customer/conversations/'+id,undefined,second)).status,200);
});
test('two managed accounts cannot read or modify each others conversation',async()=>{const x=await setup(),a=await x.login('alice@example.test'),b=await x.login('bob@example.test');const c=await x.call('/api/customer/action',{action:'conversation.create',payload:{},requestId:'managed-isolation-0001'},a);assert.equal(c.status,201);const id=(await c.json()).conversation.id;
 assert.notEqual((await x.call('/api/customer/conversations/'+id,undefined,b)).status,200);assert.notEqual((await x.call('/api/customer/chat/send',{conversationId:id,content:'cross tenant',requestId:'managed-forged-0001'},b)).status,200);assert.equal(x.modelCount(),0);
});
test('managed logout clears service session and anonymous requests remain unauthorized',async()=>{const x=await setup(),c=await x.login('logout@example.test');assert.equal((await x.call('/auth/logout',{},c)).status,200);assert.equal((await (await x.call('/api/auth/session',undefined,c)).json()).authenticated,false);assert.equal((await x.call('/api/customer/workspace',undefined,c)).status,401);});
test('Google start through application callback opens workspace and preserves conversations and usage across login methods',async()=>{
 const x=await setup(),c=await x.google('google-a@example.test');
 assert.equal((await x.call('/api/customer/workspace',undefined,c)).status,200);
 const made=await x.call('/api/customer/action',{action:'conversation.create',payload:{title:'Google customer'},requestId:'google-create-0001'},c);assert.equal(made.status,201);const id=(await made.json()).conversation.id;
 assert.equal((await x.call('/api/customer/chat/send',{conversationId:id,content:'hello',requestId:'google-chat-0001'},c)).status,200);
 for(const next of [await x.google('google-a@example.test'),await x.login('google-a@example.test')]){
  assert.equal((await x.call('/api/customer/conversations/'+id,undefined,next)).status,200);
  assert.equal((await (await x.call('/api/customer/allowance',undefined,next)).json()).allowance.remaining,9);
 }
 assert.equal((await x.call('/api/customer/workspace?code=forged',undefined,c)).status,404);
});
test('Google customers remain isolated and logout removes workspace access',async()=>{
 const x=await setup(),a=await x.google('google-a@example.test'),b=await x.google('google-b@example.test');
 const made=await x.call('/api/customer/action',{action:'conversation.create',payload:{},requestId:'google-isolation-0001'},a),id=(await made.json()).conversation.id;
 assert.notEqual((await x.call('/api/customer/conversations/'+id,undefined,b)).status,200);
 assert.notEqual((await x.call('/api/customer/chat/send',{conversationId:id,content:'cross tenant',requestId:'google-isolation-0002'},b)).status,200);
 assert.equal(x.modelCount(),0);assert.equal((await x.call('/auth/logout',{},a)).status,200);assert.equal((await x.call('/api/customer/workspace',undefined,a)).status,401);
});
