import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {FakeLeaseDatabase} from './fake-lease-database.mjs';
import {DEFAULT_PRICING_POLICY,createPricingPolicy,createPricingPolicyService,PRICING_WORKSPACE,retailCreditsForCostMicros,retailQuoteForNanoUsd,verifyPricingPolicy} from '../server/customer-pricing-policy.mjs';
import {BILLING_CONTRACT,customerCreditView,maximumRetailReservation,reserveCustomerCredits,recordCreditCompletion,settleCustomerCredits} from '../server/inherited/customer-credit-wallet.mjs';
import {MODEL_COST_VERSION,normalizeSupplierUsage,priceModelUsage} from '../server/inherited/customer-model-costs.mjs';
import {TenantStateStore} from '../server/inherited/customer-tenant-storage.mjs';
const principalId='a'.repeat(64),requestId='credit-test-0001',actorRef='b'.repeat(64),otherActor='c'.repeat(64);
const config=p=>Object.fromEntries(['markupBps','minimumChargeCredits','fxKrwPerUsd','standardMonthlyCredits','proMonthlyCredits'].map(k=>[k,p[k]]));
const envelope=()=>({version:2,tasks:[],artifacts:[],receipts:[],memory:[],idempotency:{}});
function fixture({funded=1000,policy=DEFAULT_PRICING_POLICY,mode='PAID_CREDITS',unknown=false}={}){
 const state=envelope(),fund='d'.repeat(64);
 state.customerBillingV1={contract:BILLING_CONTRACT,principalRef:principalId,creditValueKrw:1,funding:funded?{[fund]:{receiptRef:fund,status:'VERIFIED_SETTLED_PAYMENT',provider:'PORTONE_V2',evidenceSha256:'e'.repeat(64),paymentId:'synthetic-settled-payment',credits:funded}}:{},requests:{}};
 state.customerChat={turnRequests:{[requestId]:{phase:'MODEL_REQUEST_PENDING',pricingPolicy:structuredClone(policy),userMessageId:'msg_synthetic'}}};
 reserveCustomerCredits(state,{principalId,requestId,modelId:'deepseek-flash',mode,policy});
 const content='Synthetic saved reply',sha256=createHash('sha256').update(content).digest('hex');
 const usage=normalizeSupplierUsage('deepseek-flash',{prompt_tokens:2000,completion_tokens:1000,total_tokens:3000,...(unknown?{}:{prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:2000})});
 const answer={content,sha256,modelId:'deepseek-flash',model:'deepseek-flash',provider:'DEEPSEEK_API',normalizedUsage:usage,promptTokens:2000,outputTokens:1000};
 const costRecord={principalRef:principalId,answerHash:sha256,modelId:answer.modelId,cost:priceModelUsage(answer.modelId,usage)};
 const assistantMessage={id:'msg_saved_synthetic',contentSha256:sha256};
 const markSaved=s=>{s.customerChat.turnRequests[requestId].phase='MODEL_RESPONSE_RECEIVED_UNVERIFIED';s.customerChat.turnRequests[requestId].assistantMessageId=assistantMessage.id;s.syntheticAnswer=answer.content;};
 return {state,answer,costRecord,assistantMessage,markSaved};
}
test('500 KRW supplier cost becomes 1000 credits; final integer rounding and minimum are explicit',()=>{
 assert.equal(retailCreditsForCostMicros(500e6),1000);
 assert.equal(retailCreditsForCostMicros(500.01e6),1001);
 assert.equal(retailCreditsForCostMicros(0),1);
 assert.equal(retailQuoteForNanoUsd('312500000').retailCredits,1000);
 const changed=createPricingPolicy({...config(DEFAULT_PRICING_POLICY),markupBps:25000},{revision:1});
 assert.equal(retailCreditsForCostMicros(500e6,changed),1250);
 for(const bad of [NaN,-1,0.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>retailCreditsForCostMicros(bad));
 for(const update of [{markupBps:9999},{markupBps:100001},{fxKrwPerUsd:0},{standardMonthlyCredits:-1},{minimumChargeCredits:0}])assert.throws(()=>createPricingPolicy({...config(DEFAULT_PRICING_POLICY),...update}));
 assert.throws(()=>verifyPricingPolicy({...DEFAULT_PRICING_POLICY,markupBps:30000}));
});
test('policy CAS prevents stale edits and same operation never creates a second revision',async()=>{
 const db=new FakeLeaseDatabase(),service=createPricingPolicyService({rest:db});
 assert.equal((await service.read()).persisted,false);
 const update={expectedVersion:DEFAULT_PRICING_POLICY.version,requestId:'policy-update-0001',config:{...config(DEFAULT_PRICING_POLICY),markupBps:25000}};
 const result=await service.update(update,actorRef);assert.equal(result.policy.revision,1);
 assert.equal((await service.update(update,actorRef)).reused,true);
 await assert.rejects(service.update({...update,requestId:'policy-update-0002'},actorRef),e=>e.code==='PRICING_VERSION_CONFLICT');
 await assert.rejects(service.update(update,otherActor),e=>e.code==='PRICING_IDEMPOTENCY_CONFLICT');
 assert.equal((await service.read()).history.length,1);
 assert.equal(db.snapshot(PRICING_WORKSPACE).state.customerPricingPolicy.current.markupBps,25000);
});
test('ambiguous policy save is recovered by its original ID, not duplicated',async()=>{
 const db=new FakeLeaseDatabase(),service=createPricingPolicyService({rest:db});
 const update={expectedVersion:DEFAULT_PRICING_POLICY.version,requestId:'policy-ackloss-0001',config:config(DEFAULT_PRICING_POLICY)};
 db.failNextSave='after';await assert.rejects(service.update(update,actorRef));
 assert.equal((await service.read()).history[0].requestId,update.requestId);
 assert.equal((await service.update(update,actorRef)).reused,true);
 assert.equal((await service.read()).policy.revision,1);
});
test('existing unrelated state in policy namespace is rejected, never overwritten',async()=>{
 const db=new FakeLeaseDatabase();db.prime(PRICING_WORKSPACE,{...envelope(),customerChat:{version:1}});
 const service=createPricingPolicyService({rest:db});
 await assert.rejects(service.read(),e=>e.code==='PRICING_NAMESPACE_CONFLICT');
 await assert.rejects(service.update({expectedVersion:DEFAULT_PRICING_POLICY.version,requestId:'policy-collision-0001',config:config(DEFAULT_PRICING_POLICY)},actorRef));
 assert.deepEqual(db.snapshot(PRICING_WORKSPACE).state.customerChat,{version:1});
});
test('unfunded balance stays zero and a plan name is never spendable money',()=>{
 assert.equal(customerCreditView(envelope(),principalId).availableCredits,0);
 assert.throws(()=>fixture({funded:0}),e=>e.code==='PAID_CREDITS_INSUFFICIENT');
 const f=fixture({funded:0,mode:'FREE_TRIAL'});assert.equal(customerCreditView(f.state,principalId).fundedCredits,0);
});
test('paid reply, immutable request price and debit share the same final draft',()=>{
 const f=fixture(),before=customerCreditView(f.state,principalId),copy=structuredClone(f.state);
 assert.ok(before.reservedCredits>0);assert.equal(before.chargedCredits,0);
 assert.throws(()=>settleCustomerCredits(copy,{principalId,requestId,...f}),/CREDIT_SAVE_BINDING/);
 recordCreditCompletion(f.state,{principalId,requestId,answer:f.answer});
 f.markSaved(f.state);
 const receipt=settleCustomerCredits(f.state,{principalId,requestId,...f});
 assert.equal(receipt.chargedCredits,6);assert.equal(receipt.status,'SETTLED');
 assert.equal(customerCreditView(f.state,principalId).reservedCredits,0);
 assert.equal(customerCreditView(f.state,principalId).availableCredits,994);
 assert.deepEqual(settleCustomerCredits(f.state,{principalId,requestId,...f}),receipt);
 assert.equal(customerCreditView(f.state,principalId).chargedCredits,6);
 assert.throws(()=>reserveCustomerCredits(f.state,{principalId,requestId,modelId:f.answer.modelId,mode:'PAID_CREDITS',policy:DEFAULT_PRICING_POLICY}));
});
test('wallet reservation and final charge use the same policy FX, independent of old cost FX',()=>{
 const policy=createPricingPolicy({...config(DEFAULT_PRICING_POLICY),fxKrwPerUsd:4000,markupBps:35000},{revision:1});
 const f=fixture({policy});recordCreditCompletion(f.state,{principalId,requestId,answer:f.answer});f.markSaved(f.state);
 const receipt=settleCustomerCredits(f.state,{principalId,requestId,...f});
 assert.equal(receipt.chargedCredits,26);
 assert.ok(receipt.chargedCredits<=maximumRetailReservation(f.answer.modelId,policy));
 assert.equal(f.costRecord.cost.fxKrwPerUsd,1600);
 const entry=Object.values(f.state.customerBillingV1.requests)[0];
 assert.equal(entry.chargeBasisFxKrwPerUsd,4000);assert.equal(entry.policy.version,policy.version);
});
test('incomplete supplier cost keeps a paid hold and saved reply without a final charge',()=>{
 const f=fixture({unknown:true});recordCreditCompletion(f.state,{principalId,requestId,answer:f.answer});f.markSaved(f.state);
 const receipt=settleCustomerCredits(f.state,{principalId,requestId,...f});
 assert.equal(receipt.status,'COST_RECONCILIATION_REQUIRED');assert.equal(receipt.chargedCredits,0);
 assert.ok(customerCreditView(f.state,principalId).reservedCredits>0);
 assert.equal(Object.values(f.state.customerBillingV1.requests)[0].completion.content,f.answer.content);
 assert.equal(f.state.syntheticAnswer,f.answer.content);
});
test('free and employee requests record retail basis but debit no customer money',()=>{
 for(const mode of ['FREE_TRIAL','EMPLOYEE']){
  const f=fixture({funded:0,mode});recordCreditCompletion(f.state,{principalId,requestId,answer:f.answer});f.markSaved(f.state);
  assert.equal(settleCustomerCredits(f.state,{principalId,requestId,...f}).chargedCredits,0);
  assert.equal(customerCreditView(f.state,principalId).availableCredits,0);
 }
});
test('lost save ACK leaves both answer and debit durable once; failed save leaves both absent',async()=>{
 for(const stage of ['before','after']){
  const f=fixture();recordCreditCompletion(f.state,{principalId,requestId,answer:f.answer});
  const db=new FakeLeaseDatabase(),workspaceId='tenant_'+'f'.repeat(64);db.prime(workspaceId,f.state);
  const store=new TenantStateStore(db,{workspaceId});await store.init();db.failNextSave=stage;
  await assert.rejects(store.mutate(state=>{f.markSaved(state);return settleCustomerCredits(state,{principalId,requestId,...f});}));
  const persisted=db.snapshot(workspaceId).state;
  assert.equal(Boolean(persisted.syntheticAnswer),stage==='after');
  assert.equal(customerCreditView(persisted,principalId).chargedCredits,stage==='after'?6:0);
  assert.equal(Object.values(persisted.customerBillingV1.requests)[0].supplierRateVersion,MODEL_COST_VERSION);
  await store.close();
 }
});
test('missing, stale, future or string save ACK cannot be called durable',async()=>{
 for(const ack of [{},{version:7},{version:9},{version:'8'}]){
  const db=new FakeLeaseDatabase(),workspaceId='tenant_'+'f'.repeat(64);db.prime(workspaceId,envelope(),{version:7});
  const rpc=db.rpc.bind(db);db.rpc=async(name,args)=>name==='core_console_save_state_v3'?ack:rpc(name,args);
  const store=new TenantStateStore(db,{workspaceId});await store.init();
  await assert.rejects(store.mutate(state=>{state.synthetic='not-durable';return {durable:true};}),e=>e.code==='TENANT_SAVE_ACK_UNVERIFIED_NO_REPLAY');
  assert.equal(store.state.synthetic,undefined);assert.equal(db.snapshot(workspaceId).state.synthetic,undefined);await store.close();
 }
});
