import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fixture,realm,providerSnapshot,authenticatedIdentity} from './identity-fixture.mjs';
import * as inventoryAPI from '../server/migration-inventory.mjs';
import {createSignupClassifier,readSignupClassification,readVerifiedProviderIdentity} from '../server/signup-classifier.mjs';
import {FakeLeaseDatabase} from './fake-lease-database.mjs';
import {createCustomerRuntime} from '../server/inherited/customer-runtime-composition.mjs';
import {createCustomerHttpAdapter} from '../server/inherited/customer-http-adapter.mjs';
import {createIsolatedCloudAllowance,allowanceWorkspaceForAccount,allowanceRequestKey} from '../server/inherited/cloud-allowance.mjs';
import {createIsolatedDailyAiBudget,budgetWorkspaceForDay} from '../server/inherited/daily-ai-budget.mjs';
import {tenantWorkspaceForEmail} from '../server/inherited/customer-tenant-storage.mjs';
import {mutateCustomerChat} from '../server/inherited/customer-chat-domain.mjs';
let employee={};try{employee=await import('../server/employee-entitlement.mjs')}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const origin='https://thefa-core-customer-r39.vercel.app';
const sha=x=>createHash('sha256').update(x).digest('hex');
const blank=()=>({version:2,tasks:[],artifacts:[],receipts:[],memory:[],idempotency:{}});
const companyRow={userId:'33333333-3333-4333-8333-333333333333',accountRowId:'55555555-5555-4555-8555-555555555555',provider:'google',subject:'employee-subject-fixture',email:'staff@thefa.kr',emailVerified:true};
async function identityFixture(overrides={}){
 const f=fixture(),row={...companyRow,...overrides},auth=await authenticatedIdentity(f,row,{keepOpen:true});
 const {snapshot}=await providerSnapshot(f.identities,inventoryAPI);
 const signed=inventoryAPI.produceSignedLegacyInventory({sourceFiles:f.files,backupFiles:f.backup,providerInventory:snapshot,stableKeys:f.keys,keyProvenance:f.provenance,identityRealm:realm,migrationId:'employee-runtime-fixture',signingKey:f.privateKey});
 const inventory=inventoryAPI.verifySignedLegacyInventory({envelope:signed.envelope,verificationKey:f.publicKey,stableKeys:f.keys});
 const classify=createSignupClassifier({inventory,stableKeys:f.keys});
 const principal={...readSignupClassification(classify(await auth.readIdentity(auth.cookie))),provider:row.provider,sessionVerified:true,accountProvenance:'NEW_ACCOUNT_CONFIRMED'};
 const io={calls:0,tokenCalls:0,profile:{sub:row.subject,email:row.email,email_verified:row.emailVerified,hd:'thefa.kr'},error:null};
 auth.service.auth.api.getAccessToken=async input=>{io.tokenCalls++;assert.deepEqual(input.body,{accountId:row.accountRowId});assert.equal(input.headers.get('cookie'),auth.cookie);return {accessToken:'isolated-fixture-access-token',accessTokenExpiresAt:new Date(Date.now()+60000)};};
 const fetchProfile=async(url,options)=>{io.calls++;assert.equal(url,'https://openidconnect.googleapis.com/v1/userinfo');assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer isolated-fixture-access-token');if(io.error)throw io.error;return Response.json(io.profile);};
 return {f,row,auth,inventory,classify,principal,io,fetchProfile};
}
function makeResolver(x){assert.equal(typeof employee.createGoogleEmployeeEntitlementResolver,'function','actual employee resolver is not integrated');return employee.createGoogleEmployeeEntitlementResolver({authService:x.auth.service,readProviderIdentity:x.auth.readIdentity,classify:x.classify,accountSecret:x.f.keys.accountSecret,identityRealm:realm,fetchImpl:x.fetchProfile});}
async function appFixture(t,{employeeEnabled=true,used=10,row={},modelError=false,saveLoss=false}={}){
 const x=await identityFixture(row);t.after(x.auth.close);
 const db=new FakeLeaseDatabase(),allowance=createIsolatedCloudAllowance({rest:db,secret:x.f.keys.allowanceSecret}),budgetSecret=Buffer.alloc(32,61),budget=createIsolatedDailyAiBudget({rest:db,secret:budgetSecret});
 const workspaceId=tenantWorkspaceForEmail(x.principal.workspaceEmail,x.f.keys.tenantKey),state=blank();
 const conversationId=mutateCustomerChat(state,'conversation.create',{title:'Integration verification'},'create-conversation-0001').conversation.id;db.prime(workspaceId,state);
 const ledger={version:1,used,requests:{},completions:{}};for(let i=0;i<used;i++)ledger.requests[allowanceRequestKey('already-used-'+i,x.f.keys.allowanceSecret)]='SUCCEEDED';
 const allowanceId=allowanceWorkspaceForAccount(x.principal.principalId,x.f.keys.allowanceSecret);db.prime(allowanceId,{...blank(),customerAllowance:ledger});
 const counter={provider:0};const provider={mode:'DEEPSEEK_CUSTOMER_CHAT',model:'deepseek-flash',maxOutputTokens:1024,async ask(){counter.provider++;if(modelError)throw Error('fixture lost provider response');if(saveLoss)db.failNextSave='after';const content='Fixture response '+counter.provider;return {content,sha256:sha(content),provider:'DEEPSEEK_API',model:'deepseek-flash',promptTokens:80,outputTokens:20};}};
 const resolveEmployeeEntitlement=employeeEnabled?makeResolver(x):undefined;
 const dependencies={sessionVerifier:async cookie=>cookie===x.auth.cookie?x.principal:null,rest:db,tenantKey:x.f.keys.tenantKey,allowance,budget,provider,resolveEmployeeEntitlement};
 const handler=createCustomerHttpAdapter(dependencies,{customerOrigin:origin,environment:'staging'});
 const request=(route,body)=>handler(new Request(origin+route,{method:body===undefined?'GET':'POST',headers:{host:new URL(origin).host,origin,cookie:x.auth.cookie,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 const send=(i,extra={})=>request('/api/customer/chat/send',{conversationId,content:'Request '+i,requestId:'employee-chat-request-'+i,...extra});
 return {...x,db,allowance,budget,budgetSecret,workspaceId,allowanceId,conversationId,counter,handler,dependencies,request,send};
}

test('actual provider identity retains verified real email and account row, not synthetic workspace address',async t=>{
 const x=await identityFixture();t.after(x.auth.close);const proof=readVerifiedProviderIdentity(await x.auth.readIdentity(x.auth.cookie));
 assert.equal(proof.authenticatedEmail,'staff@thefa.kr');assert.equal(proof.emailVerified,true);assert.equal(proof.providerAccountId,companyRow.accountRowId);
 assert.match(x.principal.workspaceEmail,/@accounts\.thefa\.invalid$/);assert.notEqual(x.principal.workspaceEmail,proof.authenticatedEmail);
});
test('verified Google subject + email + Workspace hd grants a principal-bound opaque entitlement',async t=>{
 const x=await identityFixture();t.after(x.auth.close);const proof=await makeResolver(x)(x.auth.cookie,x.principal);
 assert.equal(employee.isEmployeeEntitlement(proof,x.principal.principalId),true);
 assert.throws(()=>employee.isEmployeeEntitlement({...proof,unlimited:true},x.principal.principalId),/EMPLOYEE_ENTITLEMENT_INVALID/);
 assert.throws(()=>employee.isEmployeeEntitlement(proof,'f'.repeat(64)),/EMPLOYEE_ENTITLEMENT_INVALID/);
 assert.equal(JSON.stringify(proof),'{}');
});
test('email suffix alone, unverified mail and similar domain never grant company usage',async t=>{
 for(const row of [{email:'staff@thefa.kr.evil.test'},{email:'staff@sub.thefa.kr'},{emailVerified:false}]){
  const x=await identityFixture(row);t.after(x.auth.close);assert.equal(await makeResolver(x)(x.auth.cookie,x.principal),null);assert.equal(x.io.calls,0);
 }
});
test('Google hosted domain, subject and real email must all match the fresh verified identity',async t=>{
 for(const patch of [{hd:undefined},{hd:'evil.test'},{sub:'other-person'},{email:'other@thefa.kr'},{email_verified:false}]){
  const x=await identityFixture();t.after(x.auth.close);Object.assign(x.io.profile,patch);assert.equal(await makeResolver(x)(x.auth.cookie,x.principal),null);
 }
});
test('Google lookup failure cannot create a free-usage bypass or expose bearer contents',async t=>{
 const x=await identityFixture();t.after(x.auth.close);x.io.error=Error('isolated-fixture-access-token');
 await assert.rejects(()=>makeResolver(x)(x.auth.cookie,x.principal),e=>e.code==='EMPLOYEE_VERIFICATION_UNAVAILABLE'&&!e.message.includes('isolated-fixture'));
});
test('actual HTTP chat pipeline saves twelve employee answers while preserving the exhausted free ledger',async t=>{
 const x=await appFixture(t),before=x.db.snapshot(x.allowanceId);
 for(let i=1;i<=12;i++){const r=await x.send(i);assert.equal(r.status,200,JSON.stringify(await r.clone().json()));}
 assert.equal(x.counter.provider,12);assert.deepEqual(x.db.snapshot(x.allowanceId),before);
 const saved=x.db.snapshot(x.workspaceId).state.customerChat;assert.equal(saved.conversations[0].messages.filter(m=>m.role==='assistant').length,12);
 const daily=await x.budget.status();assert.equal(daily.spentKrw>0,true);assert.equal(daily.reservedKrw,0);
});
test('same actual HTTP pipeline keeps ordinary ten-answer limit and blocks eleventh before provider',async t=>{
 const x=await appFixture(t,{employeeEnabled:false,used:0,row:{email:'user@example.test'}});
 for(let i=1;i<=10;i++)assert.equal((await x.send(i)).status,200);
 const last=await x.send(11);assert.equal(last.status,402);assert.equal((await last.json()).code,'PLAN_REQUIRED');assert.equal(x.counter.provider,10);assert.equal((await x.allowance.view(x.principal.principalId)).used,10);
});
test('employee allowance and workspace use employee label but do not fabricate a paid subscription',async t=>{
 const x=await appFixture(t);const allowance=await(await x.request('/api/customer/allowance')).json();assert.equal(allowance.allowance.unlimited,true);assert.equal(allowance.allowance.remaining,null);
 const workspace=await(await x.request('/api/customer/workspace')).json();assert.equal(workspace.account.memberType,'EMPLOYEE');assert.equal(workspace.allowance.unlimited,true);
 const billing=await(await x.request('/api/customer/billing')).json();assert.equal(billing.paymentReady,false);assert.equal(billing.subscription.planId,null);
});
test('client employee flags and real-email claims never bypass trusted resolver',async t=>{
 const x=await appFixture(t,{employeeEnabled:false});const r=await x.send(1,{employee:true,email:'staff@thefa.kr',unlimited:true});assert.equal(r.status,400);assert.equal(x.counter.provider,0);
});
test('fresh hosted-domain removal immediately returns to ordinary quota',async t=>{
 const x=await appFixture(t);assert.equal((await x.send(1)).status,200);delete x.io.profile.hd;assert.equal((await x.send(2)).status,402);assert.equal(x.counter.provider,1);
});
test('saved employee request cannot dispatch again even with unlimited entitlement',async t=>{
 const x=await appFixture(t);assert.equal((await x.send(1)).status,200);assert.equal((await x.send(1)).status,409);assert.equal(x.counter.provider,1);
});
test('employee provider uncertainty keeps budget hold and prevents automatic replay',async t=>{
 const x=await appFixture(t,{modelError:true});assert.equal((await x.send(1)).status,503);assert.equal((await x.send(1)).status,409);assert.equal(x.counter.provider,1);assert.equal((await x.budget.status()).reservedKrw>0,true);
});
test('employee lost durable-save acknowledgement keeps existing conversation and holds without replay',async t=>{
 const x=await appFixture(t,{saveLoss:true});assert.equal((await x.send(1)).status,503);assert.equal((await x.send(1)).status,409);assert.equal(x.counter.provider,1);assert.equal(x.db.snapshot(x.workspaceId).state.customerChat.conversations[0].messages.filter(m=>m.role==='assistant').length,1);assert.equal((await x.budget.status()).reservedKrw>0,true);
});
test('global daily cost limit still blocks employee before model dispatch',async t=>{
 const x=await appFixture(t),status=await x.budget.status(),id=budgetWorkspaceForDay(status.day,x.budgetSecret);
 x.db.prime(id,{...blank(),dailyAiCostBudget:{contract:'THEFA_AI_DAILY_BUDGET_KST_R30',day:status.day,capKrw:10000,spentKrw:10000,reservedKrw:0,requests:{['a'.repeat(64)]:{state:'SETTLED',reservedKrw:10000,chargedKrw:10000}}}});
 const r=await x.send(1);assert.equal(r.status,429);assert.equal(x.counter.provider,0);
});
test('real runtime composition forwards employee verifier rather than leaving it as a disconnected helper',async t=>{
 const x=await appFixture(t),config={customerOrigin:origin,environment:'staging',supabaseUrl:'https://furfjhymxqsbhvuyeqpx.supabase.co',serviceRoleKey:'fixture-service-key-not-real-0000',tenantKey:x.f.keys.tenantKey,deepseekApiKey:'sk-fixture-deepseek-not-real-0000',allowanceSecret:x.f.keys.allowanceSecret,budgetSecret:x.budgetSecret};
 const fetchImpl=async(url,options={})=>{const u=new URL(url);if(u.pathname.startsWith('/rest/v1/rpc/'))return Response.json(await x.db.rpc(u.pathname.split('/').at(-1),JSON.parse(options.body)));if(u.pathname==='/rest/v1/core_console_state_v3')return Response.json(await x.db.request('/core_console_state_v3'+u.search));throw Error('external fetch forbidden in integration QA');};
 const runtime=createCustomerRuntime({config,sessionVerifier:x.dependencies.sessionVerifier,resolveEmployeeEntitlement:x.dependencies.resolveEmployeeEntitlement,fetchImpl});
 const response=await runtime.handler(new Request(origin+'/api/customer/allowance',{headers:{host:new URL(origin).host,cookie:x.auth.cookie}}));
 assert.equal(response.status,200);assert.equal((await response.json()).allowance.unlimited,true);
});
