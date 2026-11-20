import test from 'node:test';import assert from 'node:assert/strict';
import {FakeLeaseDatabase} from './fake-lease-database.mjs';
import {createIsolatedCloudAllowance} from '../server/inherited/cloud-allowance.mjs';
import {createIsolatedDailyAiBudget} from '../server/inherited/daily-ai-budget.mjs';
import {createCustomerAiModes} from '../server/inherited/customer-ai-modes.mjs';
import {createVerifiedCustomerApi} from '../server/inherited/customer-api-gateway.mjs';
import {tenantWorkspaceForEmail} from '../server/inherited/customer-tenant-storage.mjs';
import {mutateCustomerChat} from '../server/inherited/customer-chat-domain.mjs';
import {summarizeCustomerCostRecords} from '../server/inherited/customer-cost-summary.mjs';
import {normalizeSupplierUsage,priceModelUsage} from '../server/inherited/customer-model-costs.mjs';
import {customerPlanCatalog} from '../server/customer-plans.mjs';
import {createPricingPolicyService,DEFAULT_PRICING_POLICY} from '../server/customer-pricing-policy.mjs';
import {BILLING_CONTRACT,customerCreditView} from '../server/inherited/customer-credit-wallet.mjs';
const rekey=x=>Array.isArray(x)?x.map(rekey):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,rekey(x[k])])):x;
class JsonbLikeDb extends FakeLeaseDatabase{async request(...a){return rekey(await super.request(...a));}async rpc(...a){return rekey(await super.rpc(...a));}}
function fixture({empty=false,completionFailure=false,creditPolicy=false,fundedCredits=0,invalidWallet=false,onProvider=null}={}){
 const db=new JsonbLikeDb(),tenantKey='review-only-tenant-binding-key-'.repeat(2),principalId='a'.repeat(64),workspaceEmail='review@example.test';
 const allowance=createIsolatedCloudAllowance({rest:db,secret:Buffer.alloc(32,17)}),budget=createIsolatedDailyAiBudget({rest:db,secret:Buffer.alloc(32,18)});
 const state={version:2,tasks:[],artifacts:[],receipts:[],memory:[],idempotency:{}},conversationId=mutateCustomerChat(state,'conversation.create',{title:'Synthetic review'},'create-review-0001').conversation.id,workspaceId=tenantWorkspaceForEmail(workspaceEmail,tenantKey);if(fundedCredits||invalidWallet){const key='e'.repeat(64);state.customerBillingV1=invalidWallet?{contract:'CORRUPTED'}:{contract:BILLING_CONTRACT,principalRef:principalId,creditValueKrw:1,requests:{},funding:{[key]:{receiptRef:key,status:'VERIFIED_SETTLED_PAYMENT',provider:'PORTONE_V2',evidenceSha256:'f'.repeat(64),paymentId:'synthetic-payment-only',credits:fundedCredits}}};}db.prime(workspaceId,state);const pricingPolicyService=creditPolicy?createPricingPolicyService({rest:db}):null;
 const calls=[],fetchImpl=async(url,init)=>{
  const body=JSON.parse(init.body),model=body.model,text=empty?'':'Synthetic response';let data;
  if(url==='https://api.deepseek.com/chat/completions'){assert.equal(body.thinking.type,'disabled');data={model,choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:20}};}
  else if(url==='https://api.openai.com/v1/responses'){assert.equal(body.store,false);assert.equal(body.service_tier,'default');assert.equal(body.reasoning.effort,'none');data={model,service_tier:'default',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}],usage:{input_tokens:20,output_tokens:10,total_tokens:30,input_tokens_details:{cached_tokens:0,cache_write_tokens:0,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:0}},output_tokens_details:{reasoning_tokens:0}}};}
  else if(url==='https://api.anthropic.com/v1/messages'){assert.equal(init.headers['anthropic-version'],'2026-10-21');data={model,type:'message',stop_reason:'end_turn',content:[{type:'text',text}],usage:{input_tokens:20,output_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0,service_tier:'standard',inference_geo:'global'}};}
  else if(url==='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent'){assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'MINIMAL');data={modelVersion:'gemini-3.1-flash-lite',candidates:[{finishReason:'STOP',content:{parts:[{text}]}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:5,thoughtsTokenCount:5,totalTokenCount:30,serviceTier:'standard'}};}
  else throw Error('UNEXPECTED_OUTBOUND_REQUEST');calls.push(url);if(onProvider)await onProvider(pricingPolicyService);return Response.json(data);
 };
 const env=Object.fromEntries(['CUSTOMER_DEEPSEEK_API_KEY','CUSTOMER_OPENAI_API_KEY','CUSTOMER_ANTHROPIC_API_KEY','CUSTOMER_GEMINI_API_KEY'].map(k=>[k,'synthetic-review-key-not-real-00000']));
 const aiModes=createCustomerAiModes({env,budget,fetchImpl}),origin='https://thefacore.com',cookie='synthetic-session-only';
 const handler=createVerifiedCustomerApi({sessionVerifier:async()=>({sessionVerified:true,principalId,workspaceEmail,provider:'email',accountProvenance:'LAUNCH_ACCOUNT_CONFIRMED'}),rest:db,tenantKey,allowance:completionFailure?{...allowance,recordCompletion:async()=>{throw Error('SYNTHETIC_SAVE_FAILURE');}}:allowance,budget,aiModes,membershipTracking:true,pricingPolicyService,provider:{mode:'DEEPSEEK_CUSTOMER_CHAT',model:'deepseek-flash',maxOutputTokens:1024,ask(){throw Error('LEGACY_FALLBACK_CALLED');}}},{customerOrigin:origin,environment:'production'});
 const call=(path,body)=>handler({url:origin+path,method:body?'POST':'GET',headers:{host:'thefacore.com',origin,cookie,'content-type':'application/json'},...(body?{body}:{})});
 const send=(i,aiMode='balanced')=>call('/api/customer/chat/send',{conversationId,content:'Synthetic prompt '+i,requestId:'review-request-'+String(i).padStart(4,'0'),aiMode});
 const entries=()=>Object.values(db.snapshot(workspaceId).state.customerAiCostLedger?.entries??{});
 return {db,call,send,calls,entries,allowance,budget,principalId,workspaceId,pricingPolicyService};
}
test('four native providers share exactly ten saved answers across JSONB readbacks; no replay or supplier disclosure',async()=>{const x=fixture();assert.equal((await x.call('/api/customer/workspace')).status,200);assert.equal(x.db.snapshot(x.workspaceId).state.customerMembership.contract,'THEFA_CORE_CUSTOMER_MEMBERSHIP_V1');
 for(let i=0;i<10;i++){const r=await x.send(i,['balanced','quick','writing','research'][i%4]);assert.equal(r.status,200,r.body);const message=JSON.parse(r.body).assistantMessage;assert.equal(message.provider,undefined);assert.equal(message.model,undefined);assert.equal(message.modelId,undefined);}
 assert.equal((await x.send(10)).status,402);assert.equal(x.calls.length,10);assert.equal((await x.allowance.view(x.principalId)).used,10);const b=await x.budget.status();assert.equal(b.spentKrw,10);assert.equal(b.reservedKrw,0);assert.equal((await x.call('/api/customer/usage')).status,200);const s=summarizeCustomerCostRecords(x.entries());assert.equal(s.requests,10);assert.equal(s.successfulRequests,10);assert.equal(s.pendingRequests,0);assert.equal(s.byProvider.length,4);assert.equal((await x.send(0)).status,409);assert.equal(x.calls.length,10);
});
test('empty paid provider response preserves cost and pending allowance without automatic retry',async()=>{const x=fixture({empty:true});const r=await x.send(0,'quick');assert.equal(r.status,503);assert.equal(x.calls.length,1);const s=summarizeCustomerCostRecords(x.entries());assert.equal(s.requests,1);assert.equal(s.failedRequests,1);assert.ok(s.estimatedKrwMicros>0);assert.equal((await x.allowance.view(x.principalId)).used,0);assert.equal((await x.allowance.view(x.principalId)).pending,1);assert.equal((await x.send(0,'quick')).status,409);assert.equal(x.calls.length,1);});
test('supplier usage remains durable if allowance completion cannot be saved',async()=>{const x=fixture({completionFailure:true});assert.equal((await x.send(0,'writing')).status,503);assert.equal(x.calls.length,1);const s=summarizeCustomerCostRecords(x.entries());assert.equal(s.pendingRequests,1);assert.ok(s.estimatedKrwMicros>0);assert.equal(s.successfulRequests,0);assert.equal((await x.send(0,'writing')).status,409);assert.equal(x.calls.length,1);});
test('cache, thinking and unknown tiers cannot silently underprice usage',()=>{const u=normalizeSupplierUsage('gemini-3-1-flash-lite',{promptTokenCount:100,cachedContentTokenCount:20,candidatesTokenCount:10,thoughtsTokenCount:5,totalTokenCount:115,serviceTier:'standard'});assert.equal(u.completionTokens,15);assert.equal(u.uncachedInputTokens,80);assert.ok(priceModelUsage(u.modelId,u).estimatedKrwMicros>0);assert.throws(()=>normalizeSupplierUsage(u.modelId,{promptTokenCount:100,candidatesTokenCount:10,serviceTier:'priority'}));assert.throws(()=>priceModelUsage('deepseek-flash',u));const catalog=customerPlanCatalog();assert.equal(catalog.plans[1].priceGrossKrw,19000);assert.equal(catalog.paymentReady,false);assert.equal(catalog.supportEmail,'thefa@thefa.kr');});



test('new credits preserve ten free saves, then debit funded money only; replay never charges again',async()=>{
 const x=fixture({creditPolicy:true,fundedCredits:1000});
 for(let i=0;i<10;i++){const r=await x.send(i);assert.equal(r.status,200,r.body);assert.equal(JSON.parse(r.body).billing.mode,'FREE_TRIAL');assert.equal(JSON.parse(r.body).billing.chargedCredits,0);}
 const paid=await x.send(10);assert.equal(paid.status,200,paid.body);assert.equal(JSON.parse(paid.body).billing.mode,'PAID_CREDITS');assert.equal(JSON.parse(paid.body).billing.chargedCredits,1);
 assert.equal((await x.allowance.view(x.principalId)).used,10);
 let state=x.db.snapshot(x.workspaceId).state;assert.equal(customerCreditView(state,x.principalId).availableCredits,999);
 assert.equal(x.entries().length,11);assert.ok(x.entries().every(e=>e.customerCreditCharged===false));
 assert.equal((await x.send(10)).status,409);assert.equal(x.calls.length,11);
 assert.equal(customerCreditView(x.db.snapshot(x.workspaceId).state,x.principalId).chargedCredits,1);
 const workspace=JSON.parse((await x.call('/api/customer/workspace')).body);assert.equal(workspace.credits.availableCredits,999);
});
test('new policy grants no money; unpaid eleventh request never reaches a model',async()=>{
 const x=fixture({creditPolicy:true});for(let i=0;i<10;i++)assert.equal((await x.send(i)).status,200);
 const r=await x.send(10);assert.equal(r.status,402,r.body);assert.equal(JSON.parse(r.body).code,'CREDITS_REQUIRED');assert.equal(x.calls.length,10);
 assert.equal(customerCreditView(x.db.snapshot(x.workspaceId).state,x.principalId).fundedCredits,0);
});
test('ten pending free reservations cannot silently fall back to a funded wallet',async()=>{
 const x=fixture({creditPolicy:true,fundedCredits:1000});for(let i=0;i<10;i++)await x.allowance.reserve(x.principalId,'synthetic-pending-'+i);
 assert.equal((await x.send(0)).status,409);assert.equal(x.calls.length,0);
 assert.equal(customerCreditView(x.db.snapshot(x.workspaceId).state,x.principalId).reservedCredits,0);
 assert.equal((await x.allowance.view(x.principalId)).pending,10);
});
test('invalid billing state is rejected before a free answer or provider budget is reserved',async()=>{
 const x=fixture({creditPolicy:true,invalidWallet:true});assert.equal((await x.send(0)).status,503);assert.equal(x.calls.length,0);
 assert.equal((await x.allowance.view(x.principalId)).pending,0);assert.equal((await x.budget.status()).reservedKrw,0);
});
test('policy changed while provider runs cannot reprice an existing request snapshot',async()=>{
 let changed=false;
 const x=fixture({creditPolicy:true,onProvider:async service=>{if(changed)return;changed=true;const p=(await service.read()).policy;await service.update({expectedVersion:p.version,requestId:'mid-flight-policy-01',config:{markupBps:30000,minimumChargeCredits:1,fxKrwPerUsd:1600,standardMonthlyCredits:19000,proMonthlyCredits:49000}},'b'.repeat(64));}});
 assert.equal((await x.send(0)).status,200);assert.equal((await x.send(1)).status,200);
 const rows=Object.values(x.db.snapshot(x.workspaceId).state.customerBillingV1.requests).sort((a,b)=>a.requestId.localeCompare(b.requestId));
 assert.equal(rows[0].policy.version,DEFAULT_PRICING_POLICY.version);assert.equal(rows[0].policy.markupBps,20000);assert.equal(rows[1].policy.markupBps,30000);
});
test('paid answer/cost/debit are atomic across real gateway save failures and ACK loss',async()=>{
 for(const phase of ['before','after']){
  const x=fixture({creditPolicy:true,fundedCredits:1000});for(let i=0;i<10;i++)assert.equal((await x.send(i)).status,200);
  const original=x.db.rpc.bind(x.db);let injected=false;
  x.db.rpc=async(name,args)=>{if(!injected&&name==='core_console_save_state_v3'&&args.p_workspace===x.workspaceId&&args.p_state.customerChat?.turnRequests?.['review-request-0010']?.phase==='MODEL_RESPONSE_RECEIVED_UNVERIFIED'){injected=true;x.db.failNextSave=phase;}return original(name,args);};
  assert.equal((await x.send(10)).status,503);assert.equal(x.calls.length,11);
  const state=x.db.snapshot(x.workspaceId).state,entry=Object.values(state.customerBillingV1.requests).find(r=>r.requestId==='review-request-0010');
  assert.equal(entry.chargedCredits,phase==='after'?1:0);
  assert.equal(state.customerChat.turnRequests['review-request-0010'].phase==='MODEL_RESPONSE_RECEIVED_UNVERIFIED',phase==='after');
  if(phase==='before')assert.ok(entry.completion?.content);
  assert.equal((await x.send(10)).status,409);assert.equal(x.calls.length,11);
 }
});
