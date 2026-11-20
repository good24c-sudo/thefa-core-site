import {createHash} from 'node:crypto';
import {commitCustomerChatTurn} from './customer-chat-turn.mjs';
import {tenantWorkspaceForEmail} from './customer-tenant-storage.mjs';
import {COST_POLICY,createUsageReceipt,aggregateReceipts,priceDeepSeekFlash} from './customer-cost-meter.mjs';
import {MODEL_COST_VERSION,modelRate,priceModelUsage} from './customer-model-costs.mjs';
import {summarizeCustomerCostRecords} from './customer-cost-summary.mjs';
import {resolveCustomerAiMode} from './customer-ai-modes.mjs';

/**
 * P1B tenant-v3 CAS adapter: save one chat reply AND one cost-evidence record
 * in the SAME versioned state mutation. Pure code; no live DB or PG calls.
 * Cost "settlement" here is only estimated evidence, NOT vendor invoicing,
 * customer credit charging, or PortOne payment/entitlement.
 */
export const COST_LEDGER_P1B = Object.freeze({
 contract:'THEFA_CORE_AI_COST_LEDGER_P1B_V1',
 version:1,maxEntries:256,
 paymentProcessorFuture:'PORTONE_V2',
 productionEnabled:false
});
const HEX=/^[a-f0-9]{64}$/;
const REQ=/^[A-Za-z0-9._:-]{8,128}$/;
const code=(name,status=409)=>Object.assign(new Error(name),{code:name,status});
const validObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const digest=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
const ref=(principalId,requestId)=>digest('THEFA_COST_P1B_REQ_V1\0'+principalId+'\0'+requestId);
function validIdentity({session,store,tenantKey}) {
 if(!validObj(session)||session.sessionVerified!==true||
    !HEX.test(session.principalId??'')||
    typeof session.workspaceEmail!=='string'||
    !['NEW_ACCOUNT_CONFIRMED','LAUNCH_ACCOUNT_CONFIRMED','LEGACY_R9_EXACTLY_RECONCILED']
      .includes(session.accountProvenance))
  throw code('P1B_TRUSTED_IDENTITY_REQUIRED',401);
 let workspace;
 try{workspace=tenantWorkspaceForEmail(session.workspaceEmail,tenantKey);}
 catch{throw code('P1B_TENANT_BINDING_INVALID',403);}
 if(!store||typeof store.mutate!=='function'||store.workspaceId!==workspace)
  throw code('P1B_TENANT_BINDING_INVALID',403);
 return Object.freeze({principalId:session.principalId,workspaceId:workspace});
}
function verifiedLedger(state,principalId,{create=false}={}) {
 if(!validObj(state)||state.version!==2)throw code('P1B_STATE_INVALID',503);
 if(state.customerAiCostLedger===undefined && create)
  state.customerAiCostLedger={contract:COST_LEDGER_P1B.contract,version:1,
    entries:Object.create(null)};
 const ledger=state.customerAiCostLedger;
 if(ledger===undefined)return null;
 if(!validObj(ledger)||ledger.version!==1||ledger.contract!==COST_LEDGER_P1B.contract||
    !validObj(ledger.entries))
  throw code('P1B_LEDGER_INVALID',503);
 const keys=Object.keys(ledger.entries);
 if(keys.length>COST_LEDGER_P1B.maxEntries)
  throw code('P1B_LEDGER_CAPACITY_EXCEEDED',503);
 for(const k of keys) {
  const entry=ledger.entries[k];
  if(!HEX.test(k)||!validObj(entry)||entry.requestRef!==k||
     entry.principalRef!==principalId||![1,2].includes(entry.version)||
     !(HEX.test(entry.answerHash??'')||(entry.version===2&&entry.answerHash===null))||
     !['COST_ESTIMATE_PENDING_VENDOR_INVOICE','COST_EVIDENCE_GAP_REQUIRES_RECONCILIATION','PROVIDER_OUTCOME_RECONCILIATION_REQUIRED','PROVIDER_REPLY_RECEIVED_PENDING_CHAT']
       .includes(entry.status)||
     entry.customerCreditCharged!==false||entry.paymentEntitlementGranted!==false||
     entry.actualVendorChargeKrw!==null)
   throw code('P1B_LEDGER_CORRUPTED',503);
  if(entry.version===2){
   if(entry.priceVersion!==MODEL_COST_VERSION||entry.provider!==modelRate(entry.modelId).provider)throw code('P1B_LEDGER_CORRUPTED',503);
   if(entry.cost!==null){
    let calculated;try{calculated=priceModelUsage(entry.modelId,entry.usage);}catch{throw code('P1B_LEDGER_CORRUPTED',503);}
    if(Object.keys(calculated).length!==Object.keys(entry.cost).length||Object.entries(calculated).some(([key,value])=>entry.cost[key]!==value))throw code('P1B_LEDGER_CORRUPTED',503);
   }else if(entry.usage!==null)throw code('P1B_LEDGER_CORRUPTED',503);
  }else if(entry.status==='COST_ESTIMATE_PENDING_VENDOR_INVOICE') {
    try{
     if(entry.usage?.promptTokens<=0||
        !entry.cost||entry.cost.invoiceReconciled!==false||
        entry.cost.actualVendorChargeKrw!==null||
        entry.cost.priceVersion!==COST_POLICY.rateVersion||
        !HEX.test(entry.evidenceId??''))
      throw Error('UNVERIFIED');
    }catch{throw code('P1B_LEDGER_CORRUPTED',503);}
  }else if(entry.cost!==null||entry.usage!==null){
   throw code('P1B_LEDGER_CORRUPTED',503);
  }
 }
 return ledger;
}
function recordFrom({principalId,requestId,result,observedAt}) {
 const requestRef=ref(principalId,requestId);
 if(result.normalizedUsage){
  const rate=modelRate(result.modelId);
  if(result.provider!==rate.provider||!HEX.test(result.sha256??'')||typeof result.content!=='string'||
   digest(result.content.trim())!==result.sha256||result.promptTokens!==result.normalizedUsage.promptTokens||
   result.outputTokens!==result.normalizedUsage.completionTokens)throw code('P1B_PROVIDER_RESULT_INVALID',502);
  const cost=priceModelUsage(result.modelId,result.normalizedUsage);
  return Object.freeze({version:2,requestRef,principalRef:principalId,answerHash:result.sha256,observedAt,
   model:result.model,modelId:result.modelId,provider:rate.provider,priceVersion:MODEL_COST_VERSION,
   status:'COST_ESTIMATE_PENDING_VENDOR_INVOICE',usage:result.normalizedUsage,cost,
   evidenceId:digest([requestRef,result.sha256,canonical(result.normalizedUsage),observedAt].join('|')),
   customerCreditCharged:false,paymentEntitlementGranted:false,actualVendorChargeKrw:null});
 }
 if(result.provider!=='DEEPSEEK_API'||result.model!=='deepseek-flash'||
    !HEX.test(result.sha256??'')||typeof result.content!=='string'||
    digest(result.content.trim())!==result.sha256)
  throw code('P1B_PROVIDER_RESULT_INVALID',502);
 const common={version:1,requestRef,principalRef:principalId,
   answerHash:result.sha256,observedAt,model:'deepseek-flash',
   provider:'DEEPSEEK_API',priceVersion:COST_POLICY.rateVersion,
   customerCreditCharged:false,paymentEntitlementGranted:false,
   actualVendorChargeKrw:null};
 if(result.providerUsage===undefined||result.providerUsage===null||
    result.providerUsage.total_tokens===undefined) {
  // A missing supplier receipt must not block saving the actual answer.
  // Never invent zero usage, an invoice, or an automatic model retry.
  const evidenceId=digest(['P1B_EVIDENCE_GAP',requestRef,result.sha256,observedAt].join('|'));
  return Object.freeze({...common,evidenceId,
    status:'COST_EVIDENCE_GAP_REQUIRES_RECONCILIATION',
    usage:null,cost:null});
 }
 let usageReceipt;
 try {
  usageReceipt=createUsageReceipt({principalRef:principalId,requestRef,
    observedAt,usage:result.providerUsage,persistedAnswerHash:result.sha256});
 }catch{
  throw code('P1B_SUPPLIER_USAGE_INVALID_NO_REPLAY',503);
 }
 if(result.promptTokens!==usageReceipt.usage.promptTokens||
    result.outputTokens!==usageReceipt.usage.completionTokens)
  throw code('P1B_PROVIDER_USAGE_MISMATCH_NO_REPLAY',503);
 return Object.freeze({...common,evidenceId:usageReceipt.evidenceId,
   status:'COST_ESTIMATE_PENDING_VENDOR_INVOICE',
   usage:usageReceipt.usage,cost:usageReceipt.cost});
}
function canonicalCompare(existing,next) {
 return existing.requestRef===next.requestRef&&
   existing.principalRef===next.principalRef&&
   existing.answerHash===next.answerHash&&
   existing.evidenceId===next.evidenceId&&
   existing.status===next.status&&
   existing.priceVersion===next.priceVersion;
}
export function commitChatWithCostEvidence(state,
  {principalId,requestId,userMessageId,result,observedAt}={}) {
 if(!HEX.test(principalId??'')||!REQ.test(requestId??'')||
    !/^msg_[0-9a-f-]{36}$/.test(userMessageId??'')||
    !validObj(result)||!Number.isFinite(Date.parse(observedAt||''))||
    new Date(observedAt).toISOString()!==observedAt)
  throw code('P1B_COMMIT_INPUT_INVALID',400);
 const ledger=verifiedLedger(state,principalId,{create:false});
 const key=ref(principalId,requestId);
 const existing=ledger?.entries[key];
 if(existing&&existing.status!=='PROVIDER_REPLY_RECEIVED_PENDING_CHAT'){
   const next=recordFrom({principalId,requestId,result,observedAt:existing.observedAt});
   if(!canonicalCompare(existing,next))
    throw code('P1B_EXISTING_RECEIPT_CONFLICT_NO_REPLAY',409);
   const chatTurn=state.customerChat?.turnRequests?.[requestId];
   if(chatTurn?.phase!=='MODEL_RESPONSE_RECEIVED_UNVERIFIED'||
      chatTurn.userMessageId!==userMessageId)
    throw code('P1B_CHAT_COST_BINDING_INVALID',409);
   return Object.freeze({reused:true,costRecord:structuredClone(existing),
     assistantMessage:null,chatAlreadyCommitted:true});
 }
 if(!existing&&ledger&&Object.keys(ledger.entries).length>=COST_LEDGER_P1B.maxEntries)
  throw code('P1B_LEDGER_FULL_ARCHIVE_REQUIRED',429);
 const turn=state.customerChat?.turnRequests?.[requestId];
 if(!turn||turn.phase!=='MODEL_REQUEST_PENDING'||turn.userMessageId!==userMessageId)
  throw code('P1B_HISTORICAL_OR_PENDING_REQUEST_NO_BACKFILL',409);
 const record=recordFrom({principalId,requestId,result,observedAt:existing?.observedAt??observedAt});
 if(existing&&(existing.modelId!==record.modelId||existing.provider!==record.provider||existing.priceVersion!==record.priceVersion||
    canonical(existing.usage)!==canonical(record.usage)||canonical(existing.cost)!==canonical(record.cost)))
   throw code('P1B_PENDING_RECEIPT_CONFLICT_NO_REPLAY',409);
 // Perform both changes to the same in-memory CAS draft before ONE database save.
 // If lease/save fails, the caller must reconcile; model must never replay.
 const written=commitCustomerChatTurn(state,{requestId,userMessageId,result});
 if(written.reused||written.assistantMessage?.contentSha256!==record.answerHash||
    written.assistantMessage?.state!=='MODEL_RESPONSE_RECEIVED_UNVERIFIED')
  throw code('P1B_CHAT_COMMIT_NOT_VERIFIED',503);
 const writable=verifiedLedger(state,principalId,{create:true});
 if(Object.hasOwn(writable.entries,key)&&writable.entries[key].status!=='PROVIDER_REPLY_RECEIVED_PENDING_CHAT')
  throw code('P1B_COLLISION_REQUIRES_RECONCILIATION',409);
 writable.entries[key]=structuredClone(record);
 return Object.freeze({reused:false,costRecord:structuredClone(record),
   assistantMessage:structuredClone(written.assistantMessage),
   chatAlreadyCommitted:true});
}
export function preflightBoundTenantCostCapacity({store,session,tenantKey}={}) {
 const identity=validIdentity({store,session,tenantKey});
 if(!validObj(store.state))throw code('P1B_READBACK_REQUIRED',503);
 const ledger=verifiedLedger(store.state,identity.principalId,{create:false});
 const used=ledger?Object.keys(ledger.entries).length:0;
 if(used>=COST_LEDGER_P1B.maxEntries)
  throw code('P1B_LEDGER_FULL_ARCHIVE_REQUIRED',429);
 return Object.freeze({admitted:true,remainingCapacity:COST_LEDGER_P1B.maxEntries-used,
  providerNotInvoked:true});
}

export function createBoundP1BCostWriter({store,session,tenantKey,clock=()=>new Date()}={}) {
 const identity=validIdentity({store,session,tenantKey});
 if(typeof clock!=='function')throw code('P1B_CLOCK_INVALID',503);
 async function commit({requestId,userMessageId,result}={}) {
  const at=clock();
  if(!(at instanceof Date)||!Number.isFinite(at.valueOf()))
   throw code('P1B_CLOCK_INVALID',503);
  try{
   return await store.mutate(state=>commitChatWithCostEvidence(state,{
    principalId:identity.principalId,requestId,userMessageId,result,
    observedAt:at.toISOString()
   }));
  }catch(e){
   const known=e?.code&&/^(P1B_|CHAT_|MODEL_)/.test(e.code);
   if(known)throw e;
   // CAS ACK can be lost after a durable commit. Never blind retry.
   throw code('P1B_CAS_WRITE_OUTCOME_UNCERTAIN_NO_REPLAY',503);
  }
 }
 return Object.freeze({commit});
}
export function summarizeBoundTenantCost({store,session,tenantKey}={}) {
 const identity=validIdentity({store,session,tenantKey});
 if(!store.state)throw code('P1B_READBACK_REQUIRED',503);
 const ledger=verifiedLedger(store.state,identity.principalId);
 if(!ledger)return Object.freeze({status:'NO_LEDGER_EVIDENCE',requests:null,
   estimatedKrwMicros:null,reason:'UNKNOWN_NOT_ZERO'});
 const rows=Object.values(ledger.entries);
 if(rows.some(r=>r.version===2))return summarizeCustomerCostRecords(rows);
 if(rows.length===0)return Object.freeze({status:'EMPTY_VERIFIED_LEDGER',requests:0,
   estimatedKrwMicros:0,costEvidenceGaps:0});
 const verified=rows.filter(r=>r.status==='COST_ESTIMATE_PENDING_VENDOR_INVOICE');
 const gaps=rows.length-verified.length;
 const p1a=aggregateReceipts(verified.map(r=>({
   contract:COST_POLICY.contract,evidenceId:r.evidenceId,
   principalRef:r.principalRef,requestRef:r.requestRef,
   provider:r.provider,model:r.model,observedAt:r.observedAt,
   answerHash:r.answerHash,usage:r.usage,cost:r.cost,
   state:'ANSWER_PERSISTED_COST_ESTIMATED_INVOICE_PENDING',
   noPaymentEntitlementGranted:true,noModelRetryPermitted:true
 })));
 return Object.freeze({
  status:gaps?'INCOMPLETE_COST_EVIDENCE_RECONCILIATION_REQUIRED':'ESTIMATE_ONLY_VENDOR_INVOICE_PENDING',
  requests:rows.length,estimatedKrwMicros:gaps?null:p1a.estimatedKrwMicros,
  verifiedSubsetKrwMicros:p1a.estimatedKrwMicros,
  costEvidenceGaps:gaps,vendorInvoiceMatched:false,
  paymentEntitlementGranted:false
 });
}

/** Preserve an observed provider failure independently of whether a reply exists. */
export function recordProviderOutcome(state,{principalId,requestId,modelId,meteringReceipt=null,observedAt,outcome='FAILED_OR_UNKNOWN'}={}){
 if(!HEX.test(principalId??'')||!REQ.test(requestId??'')||!Number.isFinite(Date.parse(observedAt??'')))throw code('P1B_OUTCOME_INPUT_INVALID',400);
 const turn=state.customerChat?.turnRequests?.[requestId];
 if(!turn||turn.phase!=='MODEL_REQUEST_PENDING'||resolveCustomerAiMode(turn.aiMode??'balanced').modelId!==modelId)throw code('P1B_OUTCOME_TURN_BINDING_INVALID',409);
 if(!['FAILED_OR_UNKNOWN','REPLY_RECEIVED'].includes(outcome))throw code('P1B_OUTCOME_INVALID',400);
 const rate=modelRate(modelId),key=ref(principalId,requestId);
 const ledger=verifiedLedger(state,principalId,{create:true});
 if(ledger.entries[key])return {reused:true};
 if(Object.keys(ledger.entries).length>=COST_LEDGER_P1B.maxEntries)throw code('P1B_LEDGER_FULL_ARCHIVE_REQUIRED',429);
 const observed=meteringReceipt?.modelId===modelId&&meteringReceipt.provider===rate.provider?meteringReceipt.normalizedUsage:null;
 let usage=null,cost=null;
 if(observed){try{cost=priceModelUsage(modelId,observed);usage=observed;}catch{}}
 ledger.entries[key]={version:2,requestRef:key,principalRef:principalId,answerHash:null,observedAt,
  modelId,model:modelId,provider:rate.provider,priceVersion:MODEL_COST_VERSION,
  status:outcome==='REPLY_RECEIVED'?'PROVIDER_REPLY_RECEIVED_PENDING_CHAT':'PROVIDER_OUTCOME_RECONCILIATION_REQUIRED',usage,cost,
  evidenceId:digest(JSON.stringify({key,modelId,usage,observedAt})),
  customerCreditCharged:false,paymentEntitlementGranted:false,actualVendorChargeKrw:null};
 return {recorded:true,costKnown:!!cost};
}

export {summarizeCustomerCostRecords} from './customer-cost-summary.mjs';
