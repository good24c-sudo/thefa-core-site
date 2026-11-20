import {createHash} from 'node:crypto';
import {MODEL_COST_VERSION,modelRate,priceModelUsage} from './customer-model-costs.mjs';
import {verifyPricingPolicy,retailQuoteForNanoUsd} from '../customer-pricing-policy.mjs';
import {tenantWorkspaceForEmail} from './customer-tenant-storage.mjs';

export const BILLING_CONTRACT='THEFA_CUSTOMER_COST_CREDITS_V1';
const HASH=/^[a-f0-9]{64}$/,REQ=/^[A-Za-z0-9._:-]{8,128}$/;
const fail=(code,status=503)=>Object.assign(Error(code),{code,status});
const sha=value=>createHash('sha256').update(value).digest('hex');
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const requestRef=(principalId,requestId)=>sha('THEFA_CUSTOMER_BILLING_V1\0'+principalId+'\0'+requestId);
const sum=values=>{const total=values.reduce((a,b)=>a+b,0);if(!integer(total))throw fail('CREDIT_TOTAL_INVALID');return total;};
function ledgerOf(state,principalId,{create=false}={}){
 if(!HASH.test(principalId??'')||state?.version!==2)throw fail('CREDIT_IDENTITY_REQUIRED');
 if(state.customerBillingV1===undefined){
  if(!create)return null;
  state.customerBillingV1={contract:BILLING_CONTRACT,principalRef:principalId,creditValueKrw:1,funding:{},requests:{}};
 }
 const ledger=state.customerBillingV1;
 if(!plain(ledger)||ledger.contract!==BILLING_CONTRACT||ledger.principalRef!==principalId||ledger.creditValueKrw!==1||!plain(ledger.funding)||!plain(ledger.requests)||Object.keys(ledger.requests).length>256)throw fail('CREDIT_LEDGER_INVALID');
 // A catalog/subscription name is never funding. No top-up endpoint is exposed here.
 for(const [id,fund]of Object.entries(ledger.funding)){
  if(!HASH.test(id)||fund.receiptRef!==id||fund.status!=='VERIFIED_SETTLED_PAYMENT'||fund.provider!=='PORTONE_V2'||!HASH.test(fund.evidenceSha256??'')||typeof fund.paymentId!=='string'||!fund.paymentId||!integer(fund.credits)||fund.credits<1)throw fail('CREDIT_FUNDING_UNVERIFIED');
 }
 for(const [id,row]of Object.entries(ledger.requests)){
  if(!HASH.test(id)||row.requestRef!==id||!REQ.test(row.requestId??'')||id!==requestRef(principalId,row.requestId)||!['FREE_TRIAL','PAID_CREDITS','EMPLOYEE'].includes(row.mode)||!['RESERVED','COMPLETION_RECORDED','SETTLED','COST_RECONCILIATION_REQUIRED','CANCELLED_BEFORE_DISPATCH'].includes(row.status)||!integer(row.reservedCredits)||!integer(row.chargedCredits))throw fail('CREDIT_LEDGER_INVALID');
  verifyPricingPolicy(row.policy);
  if(row.supplierRateVersion!==MODEL_COST_VERSION||row.chargedCredits>row.reservedCredits||(row.mode!=='PAID_CREDITS'&&(row.reservedCredits!==0||row.chargedCredits!==0))||(row.status!=='SETTLED'&&row.chargedCredits!==0))throw fail('CREDIT_LEDGER_INVALID');
 }
 return ledger;
}
export function customerCreditView(state,principalId){
 const ledger=ledgerOf(state,principalId),requests=Object.values(ledger?.requests??{});
 const fundedCredits=sum(Object.values(ledger?.funding??{}).map(f=>f.credits));
 const chargedCredits=sum(requests.map(r=>r.chargedCredits));
 const reservedCredits=sum(requests.filter(r=>['RESERVED','COMPLETION_RECORDED','COST_RECONCILIATION_REQUIRED'].includes(r.status)).map(r=>r.reservedCredits));
 if(chargedCredits+reservedCredits>fundedCredits)throw fail('CREDIT_BALANCE_INVALID');
 return Object.freeze({contract:BILLING_CONTRACT,creditValueKrw:1,fundedCredits,chargedCredits,
  balanceCredits:fundedCredits-chargedCredits,reservedCredits,availableCredits:fundedCredits-chargedCredits-reservedCredits,
  pendingRequests:requests.filter(r=>['RESERVED','COMPLETION_RECORDED','COST_RECONCILIATION_REQUIRED'].includes(r.status)).length,
  paymentConnected:false});
}
export function maximumRetailReservation(modelId,policy){
 const r=modelRate(modelId);
 const nano=48000n*BigInt(Math.max(r.input,r.read,r.short,r.long))+2048n*BigInt(r.output);
 return retailQuoteForNanoUsd(nano.toString(),policy).retailCredits;
}
export function reserveCustomerCredits(state,{principalId,requestId,modelId,mode,policy}){
 if(!REQ.test(requestId??'')||!['FREE_TRIAL','PAID_CREDITS','EMPLOYEE'].includes(mode))throw fail('CREDIT_RESERVATION_INVALID',400);
 const p=verifyPricingPolicy(policy),turn=state.customerChat?.turnRequests?.[requestId];
 if(turn?.phase!=='MODEL_REQUEST_PENDING'||turn.pricingPolicy?.version!==p.version)throw fail('CREDIT_TURN_BINDING_REQUIRED',409);
 const existing=ledgerOf(state,principalId),key=requestRef(principalId,requestId);
 if(existing&&Object.hasOwn(existing.requests,key))throw fail('CREDIT_REQUEST_ALREADY_EXISTS_NO_REPLAY',409);
 if(Object.keys(existing?.requests??{}).length>=256)throw fail('CREDIT_LEDGER_ARCHIVE_REQUIRED',429);
 const reservedCredits=mode==='PAID_CREDITS'?maximumRetailReservation(modelId,p):0;
 if(mode==='PAID_CREDITS'&&customerCreditView(state,principalId).availableCredits<reservedCredits)throw fail('PAID_CREDITS_INSUFFICIENT',402);
 const ledger=ledgerOf(state,principalId,{create:true});
 ledger.requests[key]={requestRef:key,requestId,mode,modelId,policy:structuredClone(p),supplierRateVersion:MODEL_COST_VERSION,
  status:'RESERVED',reservedCredits,chargedCredits:0,answerHash:null,createdAt:new Date().toISOString(),completion:null};
 return {mode,reservedCredits,policyVersion:p.version};
}
export function recordCreditCompletion(state,{principalId,requestId,answer}){
 const ledger=ledgerOf(state,principalId),entry=ledger?.requests[requestRef(principalId,requestId)];
 if(entry?.status!=='RESERVED'||answer?.modelId!==entry.modelId||typeof answer.content!=='string'||!answer.content.trim()||answer.content.length>15000||sha(answer.content.trim())!==answer.sha256||!answer.normalizedUsage)throw fail('CREDIT_COMPLETION_BINDING_INVALID');
 // Full original reply is recoverable before final save; never call the model to recover it.
 priceModelUsage(answer.modelId,answer.normalizedUsage);
 entry.completion=structuredClone(answer);entry.answerHash=answer.sha256;entry.status='COMPLETION_RECORDED';
 return {recorded:true,answerHash:entry.answerHash};
}
export function settleCustomerCredits(state,{principalId,requestId,costRecord,assistantMessage}){
 const ledger=ledgerOf(state,principalId),entry=ledger?.requests[requestRef(principalId,requestId)];
 const turn=state.customerChat?.turnRequests?.[requestId];
 if(!entry||!['COMPLETION_RECORDED','SETTLED','COST_RECONCILIATION_REQUIRED'].includes(entry.status)||turn?.phase!=='MODEL_RESPONSE_RECEIVED_UNVERIFIED'||turn.pricingPolicy?.version!==entry.policy.version||costRecord?.answerHash!==entry.answerHash||costRecord.principalRef!==principalId||costRecord.modelId!==entry.modelId)throw fail('CREDIT_SAVE_BINDING_INVALID');
 if(entry.status==='SETTLED'||entry.status==='COST_RECONCILIATION_REQUIRED')return publicBillingReceipt(entry);
 if(assistantMessage?.contentSha256!==entry.answerHash||turn.assistantMessageId!==assistantMessage.id||entry.completion?.sha256!==entry.answerHash)throw fail('CREDIT_SAVE_BINDING_INVALID');
 const cost=priceModelUsage(entry.modelId,entry.completion.normalizedUsage),quoted=retailQuoteForNanoUsd(cost.quotedNanoUsd,entry.policy);
 entry.estimatedSupplierCostKrwMicros=quoted.estimatedSupplierCostKrwMicros;
 entry.retailQuoteCredits=quoted.retailCredits;entry.supplierNanoUsd=cost.quotedNanoUsd;
 entry.chargeBasisFxKrwPerUsd=entry.policy.fxKrwPerUsd;
 entry.invoiceReconciled=false;entry.answerSaved=true;
 const unknownCache=String(entry.completion.normalizedUsage.cacheStatus).includes('UNKNOWN');
 if(entry.mode==='PAID_CREDITS'&&(unknownCache||quoted.retailCredits>entry.reservedCredits)){
  entry.status='COST_RECONCILIATION_REQUIRED';entry.reason=unknownCache?'SUPPLIER_COST_BREAKDOWN_INCOMPLETE':'RESERVATION_BOUND_EXCEEDED';
 }else{
  entry.status='SETTLED';entry.chargedCredits=entry.mode==='PAID_CREDITS'?quoted.retailCredits:0;
  entry.settledAt=new Date().toISOString();entry.completion=null;
 }
 customerCreditView(state,principalId);
 return publicBillingReceipt(entry);
}
export function publicBillingReceipt(entry){
 return {mode:entry.mode,status:entry.status,chargedCredits:entry.chargedCredits,creditValueKrw:1,policyVersion:entry.policy.version,
  ...(entry.status==='COST_RECONCILIATION_REQUIRED'?{message:'답변은 저장됐으며 사용 금액은 확인 중입니다. 같은 요청을 다시 실행하지 마세요.'}:{})};
}
export function createBoundCreditBilling({store,session,tenantKey,policy}){
 if(session?.sessionVerified!==true||!HASH.test(session.principalId??'')||store?.workspaceId!==tenantWorkspaceForEmail(session.workspaceEmail,tenantKey))throw fail('CREDIT_TENANT_BINDING_REQUIRED',403);
 const principalId=session.principalId,p=verifyPricingPolicy(policy);
 return Object.freeze({
  preflight({requestId,modelId,mode}){return reserveCustomerCredits(structuredClone(store.state),{principalId,requestId,modelId,mode,policy:p});},
  async reserve({requestId,modelId,mode}){return store.mutate(state=>reserveCustomerCredits(state,{principalId,requestId,modelId,mode,policy:p}));},
  async recordCompletion(requestId,answer){return store.mutate(state=>recordCreditCompletion(state,{principalId,requestId,answer}));},
  settleInDraft:(state,{requestId,costRecord,assistantMessage})=>settleCustomerCredits(state,{principalId,requestId,costRecord,assistantMessage})
 });
}
