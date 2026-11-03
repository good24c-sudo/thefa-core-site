import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {readCustomerServerConfiguration} from '../server/bootstrap.mjs';
import {setup,config,origin,issuer,blank} from './launch-fixture.mjs';

test('fresh launch bootstrap explicitly avoids legacy inventory/public-key dependencies',()=>{
 const c=config(),env={CUSTOMER_ACCOUNT_MODE:'fresh-launch',CUSTOMER_USAGE_EPOCH:c.usageEpoch,CUSTOMER_LAUNCH_STARTED_AT:c.launchStartedAt,CUSTOMER_ENVIRONMENT:'staging',CUSTOMER_ORIGIN:origin,NODEJS_HELPERS:'0',VERCEL:'1',CUSTOMER_SUPABASE_URL:c.supabaseUrl,CUSTOMER_SERVICE_ROLE_KEY:c.serviceRoleKey,CUSTOMER_TENANT_KEY:c.tenantKey,CUSTOMER_ACCOUNT_SECRET_BASE64:c.accountSecret.toString('base64'),CUSTOMER_ALLOWANCE_SECRET_BASE64:c.allowanceSecret.toString('base64'),CUSTOMER_BUDGET_SECRET_BASE64:c.budgetSecret.toString('base64'),CUSTOMER_DEEPSEEK_API_KEY:c.deepseekApiKey,CUSTOMER_AUTH_DATABASE_URL:'synthetic-launch-database-url-not-live',CUSTOMER_AUTH_SECRET:'synthetic-launch-auth-secret-00000000',CUSTOMER_AUTH_PROXY_SECRET:'synthetic-launch-proxy-secret-0000000',CUSTOMER_GOOGLE_CLIENT_ID:'fixture-google',CUSTOMER_GOOGLE_CLIENT_SECRET:'fixture-google-secret',CUSTOMER_REDIRECTS_READY:'true'};
 const s=readCustomerServerConfiguration(env);assert.equal(s.config.accountMode,'fresh-launch');assert.equal(s.verificationKey,null);assert.equal(s.receiptDirectory,null);assert.equal(s.config.usageEpoch,c.usageEpoch);
 assert.throws(()=>readCustomerServerConfiguration({...env,CUSTOMER_USAGE_EPOCH:''}),/CUSTOMER_SERVER_CONFIGURATION_INVALID/);
});
test('real composition: new verified email -> session -> durable chat -> reload -> logout',async()=>{
 const x=await setup(),login=await x.login('customer@example.test');assert.equal(login.response.status,200,await login.response.clone().text());assert.ok(login.cookie.includes('session_token='));assert.doesNotMatch(await login.response.text(),new RegExp(login.code));
 const s=await (await x.call('/api/auth/session',undefined,login.cookie)).json();assert.equal(s.authenticated,true);assert.equal(s.user.provider,'email');
 const create=await x.call('/api/customer/action',{action:'conversation.create',payload:{title:'Launch QA'},requestId:'launch-create-00001'},login.cookie);assert.equal(create.status,201,await create.clone().text());const id=(await create.json()).conversation.id;
 for(let n=1;n<=10;n++){const r=await x.call('/api/customer/chat/send',{conversationId:id,content:'bounded synthetic message '+n,requestId:'launch-answer-'+String(n).padStart(4,'0')},login.cookie);assert.equal(r.status,200,await r.clone().text());}
 const blocked=await x.call('/api/customer/chat/send',{conversationId:id,content:'eleventh',requestId:'launch-answer-0011'},login.cookie);assert.equal(blocked.status,402);assert.equal(x.counter.ai,10);
 const detail=await (await x.call('/api/customer/conversations/'+id,undefined,login.cookie)).json();assert.equal(detail.conversation.messages.filter(m=>m.role==='assistant').length,10);
 assert.equal((await x.call('/auth/logout',{},login.cookie)).status,200);assert.equal((await (await x.call('/api/auth/session',undefined,login.cookie)).json()).authenticated,false);assert.equal((await x.call('/api/customer/workspace',undefined,login.cookie)).status,401);
});
test('verified company email is employee in actual composition and twelve answers do not consume free quota',async()=>{
 const x=await setup(),login=await x.login('staff@thefa.kr');assert.equal(login.response.status,200,await login.response.clone().text());
 const a=await (await x.call('/api/customer/allowance',undefined,login.cookie)).json();assert.equal(a.allowance.unlimited,true);
 const create=await x.call('/api/customer/action',{action:'conversation.create',payload:{},requestId:'employee-create-0001'},login.cookie);assert.equal(create.status,201);const id=(await create.json()).conversation.id;
 for(let n=1;n<=12;n++){const r=await x.call('/api/customer/chat/send',{conversationId:id,content:'staff message '+n,requestId:'employee-answer-'+String(n).padStart(4,'0')},login.cookie);assert.equal(r.status,200,await r.clone().text());}
 assert.equal(x.counter.ai,12);assert.equal([...x.db.rows.values()].some(r=>r.state?.customerAllowance?.used>0),false);
});
test('old unmapped auth identity cannot silently get a replacement workspace',async()=>{const x=await setup({old:true});const before=structuredClone([...x.db.rows]);const login=await x.login('earlier@example.test');assert.equal(login.response.status,503);assert.equal(login.cookie,'');assert.equal(x.counter.ai,0);assert.equal([...x.db.rows.values()].some(r=>Object.keys(r.state?.launchAccounts?.accounts??{}).length>0),false);});
test('preserved old account binding is reused without requiring old usage migration',async()=>{const x=await setup({old:true,oldMapping:true}),old=structuredClone([...x.db.rows][0]);const login=await x.login('earlier@example.test');assert.equal(login.response.status,200,await login.response.clone().text());assert.deepEqual(x.db.snapshot(old[0]),old[1]);const a=await (await x.call('/api/customer/allowance',undefined,login.cookie)).json();assert.equal(a.allowance.remaining,10);});
test('email requests enforce CSRF, exact payload, delivery failure, and repeated-send throttle',async()=>{
 const x=await setup();const cross=await x.app.application(new Request(origin+'/auth/email/send',{method:'POST',headers:{host:new URL(origin).host,origin:'https://attacker.example','content-type':'application/json'},body:JSON.stringify({email:'x@example.test'})}));assert.equal(cross.status,403);assert.equal(x.sent.length,0);
 assert.equal((await x.call('/auth/email/send',{email:'x@example.test',role:'EMPLOYEE'})).status,400);
 for(let n=0;n<5;n++)assert.equal((await x.call('/auth/email/send',{email:'limited@example.test'})).status,200);
 assert.equal((await x.call('/auth/email/send',{email:'limited@example.test'})).status,429);assert.equal(x.sent.length,5);
 const broken=await setup({emailError:true});assert.equal((await broken.call('/auth/email/send',{email:'x@example.test'})).status,503);
 const missing=await setup({mail:false});assert.equal((await missing.call('/auth/email/send',{email:'x@example.test'})).status,503);
});

test('re-login keeps the same customer, conversation ownership and consumed allowance',async()=>{
 const x=await setup(),first=await x.login('return@example.test');assert.equal(first.response.status,200);const c=await x.call('/api/customer/action',{action:'conversation.create',payload:{},requestId:'return-create-0001'},first.cookie);const id=(await c.json()).conversation.id;
 const sent=await x.call('/api/customer/chat/send',{conversationId:id,content:'once',requestId:'return-send-00001'},first.cookie);assert.equal(sent.status,200);assert.equal((await x.call('/api/customer/chat/send',{conversationId:id,content:'once',requestId:'return-send-00001'},first.cookie)).status,409);assert.equal(x.counter.ai,1);
 const second=await x.login('return@example.test');assert.equal(second.response.status,200);const balance=await (await x.call('/api/customer/allowance',undefined,second.cookie)).json();assert.equal(balance.allowance.remaining,9);
 const again=await x.call('/api/customer/conversations/'+id,undefined,second.cookie);assert.equal(again.status,200);assert.equal([...x.db.rows.values()].reduce((n,r)=>n+Object.keys(r.state?.launchAccounts?.accounts??{}).length,0),1);
});
test('different verified users cannot read or append to each other conversation',async()=>{
 const x=await setup(),a=await x.login('alice@example.test'),b=await x.login('bob@example.test');assert.equal(a.response.status,200);assert.equal(b.response.status,200);
 const c=await x.call('/api/customer/action',{action:'conversation.create',payload:{},requestId:'tenant-create-0001'},a.cookie);const id=(await c.json()).conversation.id;
 assert.notEqual((await x.call('/api/customer/conversations/'+id,undefined,b.cookie)).status,200);assert.notEqual((await x.call('/api/customer/chat/send',{conversationId:id,content:'forged tenant',requestId:'tenant-forged-001'},b.cookie)).status,200);assert.equal(x.counter.ai,0);
});
test('a lookalike company domain stays ordinary and browser flags cannot make it employee',async()=>{
 const x=await setup(),login=await x.login('staff@thefa.kr.attacker.test');assert.equal(login.response.status,200);const view=await (await x.call('/api/customer/allowance',undefined,login.cookie)).json();assert.notEqual(view.allowance.unlimited,true);assert.equal(view.allowance.remaining,10);
 assert.equal((await x.call('/auth/email/verify',{email:'staff@thefa.kr',otp:login.code,role:'EMPLOYEE'},login.cookie)).status,400);
});
test('corrupt launch binding fails closed rather than resetting remaining quota',async()=>{
 const x=await setup(),login=await x.login('policy@example.test');assert.equal(login.response.status,200);const row=[...x.db.rows.values()].find(r=>r.state?.launchAccounts);row.state.launchAccounts.binding.usageEpoch='unauthorized-new-epoch';const before=structuredClone(row.state);
 assert.equal((await x.call('/api/customer/allowance',undefined,login.cookie)).status,503);assert.deepEqual(row.state,before);assert.equal(x.counter.ai,0);
});
test('duplicate OTP never issues another customer cookie',async()=>{
 const x=await setup(),login=await x.login('otp@example.test');assert.equal(login.response.status,200);const repeat=await x.call('/auth/email/verify',{email:'otp@example.test',otp:login.code});assert.equal(repeat.status,400);assert.equal(repeat.headers.getSetCookie().length,0);
});

import {createFreshLaunchAccounts} from '../server/fresh-launch-accounts.mjs';
test('corrupt legacy account presence cannot be treated as a new account even with recent auth creation time',async()=>{
 const x=await setup(),ctx=await x.authService.auth.$context,u=await ctx.internalAdapter.createUser({name:'Corrupt binding fixture',email:'corrupt-old@example.test',emailVerified:true,createdAt:new Date(),updatedAt:new Date()});
 const id=createHmac('sha256',x.cfg.accountSecret).update(issuer+'|'+u.id).digest('hex');x.db.prime('tenant_'+createHash('sha256').update('THEFA_CUSTOMER_ACCOUNT_REGISTRY_V1').digest('hex'),{...blank(),customerAccounts:{accounts:{[id]:null},claims:{}}});
 const login=await x.login(u.email);assert.equal(login.response.status,503);assert.equal(login.cookie,'');assert.equal([...x.db.rows.values()].some(r=>Object.hasOwn(r.state?.launchAccounts?.accounts??{},id)),false);
});
test('legacy orphan claim blocks creation instead of assigning a different workspace',async()=>{
 const x=await setup(),ctx=await x.authService.auth.$context,u=await ctx.internalAdapter.createUser({name:'Orphan binding fixture',email:'orphan@example.test',emailVerified:true,createdAt:new Date(),updatedAt:new Date()});
 const id=createHmac('sha256',x.cfg.accountSecret).update(issuer+'|'+u.id).digest('hex');x.db.prime('tenant_'+createHash('sha256').update('THEFA_CUSTOMER_ACCOUNT_REGISTRY_V1').digest('hex'),{...blank(),customerAccounts:{accounts:{},claims:{['c'.repeat(64)]:id}}});
 const login=await x.login(u.email);assert.equal(login.response.status,503);assert.equal(login.cookie,'');
});
test('corrupt limiter records produce an explicit fail-closed code and remain unchanged for recovery',async()=>{
 const x=await setup();assert.equal((await x.call('/auth/email/send',{email:'rate@example.test'})).status,200);
 const row=[...x.db.rows.values()].find(r=>r.state?.launchAccounts);row.state.launchAccounts.attempts['e'.repeat(64)]=null;const before=structuredClone(row.state);
 const manager=createFreshLaunchAccounts({authService:x.authService,rest:x.db,config:x.cfg});await assert.rejects(()=>manager.limit({email:'next@example.test',peer:'127.0.0.1',operation:'send'}),e=>e.code==='EMAIL_RATE_STATE_INVALID');assert.deepEqual(row.state,before);
});
