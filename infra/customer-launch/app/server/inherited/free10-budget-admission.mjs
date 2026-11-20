/**
 * P02 R30 isolated server-side admission pipeline, NOT a public API and NOT deployed.
 *
 * Required order:
 * trusted session identity + legacy account provenance
 * => global daily budget hold => lifetime free-10 reservation
 * => one provider call => durable completion => durable chat save
 * => free-10 settle => budget cost settle.
 *
 * Any uncertain post-dispatch state keeps holds for manual reconciliation.
 */
import {isEmployeeEntitlement} from '../employee-entitlement.mjs';
const ACCOUNT=/^[a-f0-9]{64}$/;
const REQUEST=/^[A-Za-z0-9._:-]{8,160}$/;
const stop=(status,code)=>Object.assign(new Error(code),{status,code});
export function createProtectedFree10AiPipeline({
 allowance,budget,provider,persistAnswer,persistProviderOutcome=null,creditBilling=null,
 maxInputTokens=48000,maxOutputTokens=1024
}={}){
 if((creditBilling!==null&&['preflight','reserve','recordCompletion','settleInDraft'].some(k=>typeof creditBilling[k]!=='function'))||!allowance||typeof allowance.reserve!=='function'||typeof allowance.view!=='function'||
   typeof allowance.recordCompletion!=='function'||typeof allowance.settle!=='function'||
   !budget||typeof budget.reserve!=='function'||typeof budget.settle!=='function'||
   typeof budget.cancelWithoutDispatch!=='function'||
   !['DEEPSEEK_CUSTOMER_CHAT','THEFA_CUSTOMER_MULTI_AI'].includes(provider?.mode)||
   (provider.mode==='DEEPSEEK_CUSTOMER_CHAT'&&provider.model!=='deepseek-flash')||
   typeof provider.ask!=='function'||typeof persistAnswer!=='function'||
   maxInputTokens!==48000||maxOutputTokens!==1024)
  throw stop(503,'LIVE_AI_PIPELINE_DEPENDENCIES_NOT_VERIFIED');
 async function execute({
   principalId,requestId,messages,
   sessionVerified,accountProvenance,employeeEntitlement=null
 }={}){
  // Not supplied by browser. Session and identity migration attestation originate server-side.
  if(!ACCOUNT.test(principalId??'')||!REQUEST.test(requestId??'')||
    sessionVerified!==true||
    !['NEW_ACCOUNT_CONFIRMED','LEGACY_R9_EXACTLY_RECONCILED','LAUNCH_ACCOUNT_CONFIRMED'].includes(accountProvenance))
   throw stop(401,'SERVER_VERIFIED_CUSTOMER_IDENTITY_REQUIRED');
  if(!Array.isArray(messages)||messages.length<1||messages.length>22)
   throw stop(400,'AI_CONTEXT_INVALID');
  let bytes=0;
  for(const x of messages){
   if(!x||!['system','user','assistant'].includes(x.role)||typeof x.content!=='string'||
    !x.content.trim())throw stop(400,'AI_CONTEXT_INVALID');
   bytes+=Buffer.byteLength(x.content,'utf8');
  }
  if(bytes>24000||messages.at(-1).role!=='user')
   throw stop(400,'AI_CONTEXT_LIMIT');
  const employeeUnlimited=isEmployeeEntitlement(employeeEntitlement,principalId);
  let quota=null;
  if(!employeeUnlimited){
  quota=await allowance.view(principalId);
  if(quota?.freeLimit!==10||!Number.isSafeInteger(quota.used)||
     !Number.isSafeInteger(quota.pending)||!Number.isSafeInteger(quota.remaining)||
     quota.used<0||quota.pending<0||quota.used+quota.pending+quota.remaining!==10)
   throw stop(503,'FREE10_LEDGER_NOT_VERIFIED');
  if(quota.remaining===0&&!(creditBilling&&quota.used===10&&quota.pending===0))
   throw stop(quota.pending>0?409:402,quota.pending>0?'FREE10_REQUEST_ALREADY_RESERVED':'FREE10_EXHAUSTED_UPGRADE_REQUIRED');
  }
  const fundingMode=employeeUnlimited?'EMPLOYEE':quota.used===10?'PAID_CREDITS':'FREE_TRIAL';
  const modelId=provider.modelId??'deepseek-flash';
  if(creditBilling)creditBilling.preflight({requestId,modelId,mode:fundingMode});
  let held;
  try{held=await budget.reserve(principalId,requestId,{maxInputTokens,maxOutputTokens,modelId});}
  catch(e){
   if(e?.code==='DAILY_AI_BUDGET_EXHAUSTED')throw stop(429,'TODAY_AI_BUDGET_EXHAUSTED');
   throw e;
  }
  if(!held?.admitted||!held.day)throw stop(503,'BUDGET_ADMISSION_RECEIPT_MISSING');
  try{
   if(employeeUnlimited){isEmployeeEntitlement(employeeEntitlement,principalId);}
   else if(fundingMode==='FREE_TRIAL'){
    const saved=await allowance.reserve(principalId,requestId);
    if(saved?.alreadySaved)throw stop(409,'FREE10_REQUEST_ALREADY_SAVED_NO_MODEL_REPLAY');
   }
   if(creditBilling)await creditBilling.reserve({requestId,modelId,mode:fundingMode});
  }catch(err){
   // We have not dispatched any model call. The budget hold may be cancelled
   // but an uncertain allowance RPC remains protected and must be reconciled.
   try{
    await budget.cancelWithoutDispatch(principalId,requestId,{
     day:held.day,modelNotInvoked:true});
   }catch{throw stop(503,'PRE_DISPATCH_BUDGET_RECONCILIATION_REQUIRED')}
   if(/^(CREDIT_|PAID_CREDITS_)/.test(err?.code??''))throw err;
   if(err?.status===402)throw stop(402,'FREE10_EXHAUSTED_UPGRADE_REQUIRED');
   if(err?.status===409)throw stop(409,'FREE10_REQUEST_ALREADY_RESERVED');
   throw stop(503,'FREE10_ADMISSION_RECONCILIATION_REQUIRED');
  }
  // From here onwards, the provider may have accepted a billable request:
  // never call it a second time or automatically refund outstanding holds.
  let answer;
  try{
   const permit=provider.mode==='THEFA_CUSTOMER_MULTI_AI'?budget.issueProviderPermit(held,{modelId}):undefined;
   answer=await provider.ask({messages,permit});
  }catch(error){
   if(typeof persistProviderOutcome==='function'){
    try{await persistProviderOutcome({principalId,requestId,modelId,meteringReceipt:error?.meteringReceipt??null});}
    catch{throw stop(503,'AI_OUTCOME_PERSISTENCE_UNCERTAIN_NO_AUTOREPLAY');}
   }
   if(error?.meteringReceipt?.normalizedUsage){
    try{await budget.settle(principalId,requestId,{day:held.day,modelId,normalizedUsage:error.meteringReceipt.normalizedUsage});}
    catch{throw stop(503,'AI_BUDGET_SETTLEMENT_RECONCILIATION_REQUIRED');}
   }
   throw stop(503,'AI_DISPATCH_OUTCOME_UNKNOWN_NO_AUTOREPLAY');
  }
  if(!answer||answer.model!==provider.model||typeof answer.content!=='string'||
     !answer.content.trim()||
     !Number.isSafeInteger(answer.promptTokens)||answer.promptTokens<1||
     !Number.isSafeInteger(answer.outputTokens)||answer.outputTokens<1)
   throw stop(503,'MODEL_USAGE_OR_CONTENT_RECEIPT_INVALID_NO_REPLAY');
  try{
   if(typeof persistProviderOutcome==='function')await persistProviderOutcome({principalId,requestId,modelId,outcome:'REPLY_RECEIVED',meteringReceipt:{modelId,provider:answer.provider,normalizedUsage:answer.normalizedUsage}});
   if(fundingMode==='FREE_TRIAL')await allowance.recordCompletion(principalId,requestId,answer);
   if(creditBilling)await creditBilling.recordCompletion(requestId,answer);
   const persisted=await persistAnswer({
    principalId,requestId,messages,answer
   });
   if(persisted?.durable!==true)
    throw stop(503,'CUSTOMER_CHAT_PERSISTENCE_NOT_PROVEN');
  }catch{
   throw stop(503,'CHAT_WRITE_OUTCOME_UNCERTAIN_NO_AUTOREPLAY');
  }
  try{if(fundingMode==='FREE_TRIAL')await allowance.settle(principalId,requestId,{saved:true});}
  catch{throw stop(503,'FREE10_SETTLEMENT_RECONCILIATION_REQUIRED');}
  let charge;
  try{charge=await budget.settle(principalId,requestId,{
   day:held.day,inputTokens:answer.promptTokens,
   outputTokens:answer.outputTokens,modelId,normalizedUsage:answer.normalizedUsage??null
  });}
  catch{throw stop(503,'AI_BUDGET_SETTLEMENT_RECONCILIATION_REQUIRED');}
  return Object.freeze({
   status:'SAVED_REAL_AI_RESPONSE',
   provider:answer.provider,
   model:answer.model,
   requestId,
   assistantMessageSaved:true,
   freeAnswerCharged:fundingMode==='FREE_TRIAL',
   usagePolicy:employeeUnlimited?'EMPLOYEE_UNLIMITED':fundingMode==='PAID_CREDITS'?'CUSTOMER_COST_CREDITS':'CUSTOMER_FREE10',
   budgetChargedKrw:charge.chargedKrw,
   automaticReplayAllowed:false,
   receiptClass:'CUSTOMER_CHAT_AND_BUDGET_STATE_ONLY_NOT_CORE_WORKUNIT'
  });
 }
 return Object.freeze({execute});
}

