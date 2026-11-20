import {createHash} from 'node:crypto';
import {resolveModel} from './model-catalog.mjs';
import {createServerMultiAiAdapter,validatePromptMessages} from './provider-adapters.mjs';

const ID=/^[a-f0-9]{64}$/;
const REQUEST=/^[A-Za-z0-9._:-]{8,128}$/;
const fail=(code,status=503)=>Object.assign(new Error(code),{code,status});
const hash=v=>createHash('sha256').update(v).digest('hex');
const safe=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);

export const MULTI_AI_CONTROL_POLICY=Object.freeze({
 contract:'THEFA_MULTI_AI_R1_PREMIUM_GATE',
 defaultCustomerModel:'deepseek-flash',
 existingFree10PipelinePreserved:true,
 paidModelApiDisabledUntilVerifiedEntitlement:true,
 maxOutputTokens:1024,
 automaticFallback:false,
 automaticRetry:false,
 vendorInvoiceMatched:false,
 portOnePaymentConnected:false
});

/**
 * Dedicated premium-model gate, deliberately separate from the production
 * DeepSeek FREE10 pipeline. No executable paid models unless session,
 * paid entitlement, per-call cost quote and budget hold are all verified.
 * No browser controls, SDK keys or client-provided prices can bypass it.
 */
export function createMultiAiServerGate({env,fetchImpl,verifySession,verifyPaidEntitlement,
  reserveBudget,persistResponse,markPendingForReconciliation,
  clock=()=>new Date()}={}){
 if(!env||typeof env!=='object'||Array.isArray(env)||
    ![verifySession,verifyPaidEntitlement,reserveBudget,persistResponse,
      markPendingForReconciliation,clock].every(f=>typeof f==='function'))
  throw fail('MULTI_AI_GATE_DEPENDENCIES_REQUIRED');
 const consumedRequests=new Set(),livePermits=new WeakMap();
 function verifyPermit(permit,{modelId}={}){
  const info=livePermits.get(permit);
  if(!info||info.modelId!==modelId||info.used)return false;
  info.used=true;
  return true;
 }
 async function execute({cookie,requestId,modelId,messages}={}){
  const model=resolveModel(modelId);
  if(model.entitlement==='free')throw fail('USE_VERIFIED_EXISTING_FREE10_PIPELINE',409);
  if(model.entitlement==='local')throw fail('LOCAL_BROKER_IDENTITY_NOT_VERIFIED',503);
  if(model.entitlement!=='premium'||!['direct','gateway'].includes(model.transport))
   throw fail('MODEL_NOT_BILLABLE_OR_ROUTABLE',403);
  if(typeof cookie!=='string'||cookie.length<12||
    cookie.length>8192||!REQUEST.test(requestId??''))
   throw fail('MULTI_AI_SESSION_REQUIRED',401);
  const clean=validatePromptMessages(messages);
  let session;
  try{session=await verifySession(cookie)}catch{throw fail('MULTI_AI_SESSION_UNVERIFIED',401)}
  if(!safe(session)||session.verified!==true||!ID.test(session.principalRef??''))
   throw fail('MULTI_AI_SESSION_UNVERIFIED',401);
  const key=hash(session.principalRef+'|'+requestId);
  if(consumedRequests.has(key))throw fail('MULTI_AI_REQUEST_OUTCOME_UNCERTAIN_NO_REPLAY',409);
  let entitlement;
  try{entitlement=await verifyPaidEntitlement({principalRef:session.principalRef,modelId:model.id})}
  catch{throw fail('MULTI_AI_ENTITLEMENT_UNVERIFIED',403)}
  if(!safe(entitlement)||entitlement.verified!==true||
    entitlement.modelId!==model.id||entitlement.paymentCaptured!==true||
    entitlement.creditBalanceVerified!==true||
    typeof entitlement.receiptRef!=='string'||!ID.test(entitlement.receiptRef))
   throw fail('MULTI_AI_ENTITLEMENT_UNVERIFIED',403);
  // Validate provider configuration BEFORE reserving any customer budget.
  const provider=createServerMultiAiAdapter({env,fetchImpl,modelId:model.id,
    maxOutputTokens:MULTI_AI_CONTROL_POLICY.maxOutputTokens,verifyPermit});
  let reserved;
  consumedRequests.add(key); // local fail-closed idempotency even if reserve ACK is lost
  try{reserved=await reserveBudget({principalRef:session.principalRef,
    requestId,modelId:model.id,maxOutputTokens:MULTI_AI_CONTROL_POLICY.maxOutputTokens})}
  catch{throw fail('MULTI_AI_BUDGET_GATE_UNCERTAIN_NO_REPLAY')}
  if(!safe(reserved)||reserved.admitted!==true||
    reserved.modelId!==model.id||reserved.principalRef!==session.principalRef||
    reserved.requestId!==requestId||!ID.test(reserved.reservationRef??'')||
    !Number.isSafeInteger(reserved.maxEstimatedKrw)||
    reserved.maxEstimatedKrw<=0||reserved.maxEstimatedKrw>10000)
   throw fail('MULTI_AI_COST_RESERVATION_NOT_VERIFIED');
  // From here the provider may bill even if the network, payment or DB ACK
  // is lost. Never automatically retry with any model.
  consumedRequests.add(key);
  const permit=Object.freeze({});
  livePermits.set(permit,{modelId:model.id,used:false});
  let answer;
  try{answer=await provider.ask({messages:clean,permit})}
  catch{
   try{await markPendingForReconciliation({principalRef:session.principalRef,
     requestId,modelId:model.id,reservationRef:reserved.reservationRef,
     status:'UNKNOWN_PROVIDER_DISPATCH_NO_RETRY'});}
   catch{}
   throw fail('MULTI_AI_DISPATCH_RECONCILIATION_REQUIRED');
  }
  let saved;
  try{saved=await persistResponse({principalRef:session.principalRef,
    requestId,modelId:model.id,answer,reservationRef:reserved.reservationRef,
    invoiceReconciled:false,customerCreditCharged:false})}
  catch{
   throw fail('MULTI_AI_PERSISTENCE_UNCERTAIN_NO_REPLAY');
  }
  if(!safe(saved)||saved.durable!==true||saved.answerHash!==answer.sha256||
    saved.reservationRef!==reserved.reservationRef)
   throw fail('MULTI_AI_PERSISTENCE_UNCERTAIN_NO_REPLAY');
  const observed=clock();
  if(!(observed instanceof Date)||!Number.isFinite(observed.valueOf()))
   throw fail('MULTI_AI_CLOCK_NOT_VERIFIED');
  return Object.freeze({
   contract:'THEFA_MULTI_AI_PREMIUM_RESPONSE_R1',
   provider:answer.provider,modelId:model.id,content:answer.content,
   evidenceHash:answer.sha256,requestRef:key,observedAt:observed.toISOString(),
   usage:{inputTokens:answer.promptTokens,outputTokens:answer.outputTokens},
   vendorInvoiceMatched:false,
   customerCreditCharged:false,
   portOnePaymentVerifiedAtThisStep:false,
   responseOnly:true,
   noAutomaticRetry:true
  });
 }
 return Object.freeze({execute,policy:MULTI_AI_CONTROL_POLICY});
}
