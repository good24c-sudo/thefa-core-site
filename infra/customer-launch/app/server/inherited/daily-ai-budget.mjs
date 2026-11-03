/**
 * P02 R30: isolated cross-account, cross-worker daily AI model-cost admission.
 * A conservative INTERNAL spending gate, NOT a vendor billing-card hard cap.
 * Reuses the existing tenant-v3 lease/CAS RPC. Not connected to a live DB.
 */
import {createHmac} from 'node:crypto';
import {TenantStateStore} from './customer-tenant-storage.mjs';

export const BUDGET_POLICY=Object.freeze({
 contract:'THEFA_AI_DAILY_BUDGET_KST_R30',
 dailyKrw:10000,
 conservativeUsdKrw:1600, // risk-control assumption, NOT live FX.
 surgeMarginBps:12500, // 25% buffer above USD-quoted peak input-miss/output prices.
 flashInputUsdPer1m:0.30, // official 2026-10-28 deepseek-flash PEAK, no caching assumed.
 flashOutputUsdPer1m:1.20,
 maxInputTokens:48000,
 maxOutputTokens:2048,
 maxRecordsPerDay:4000,
 timeZone:'Asia/Seoul',
 provider:'deepseek-flash'
});
const HASH=/^[a-f0-9]{64}$/;
const REQ=/^[A-Za-z0-9._:-]{8,160}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const fault=(status,code)=>Object.assign(new Error(code),{status,code});
const safeObj=x=>x&&typeof x==='object'&&!Array.isArray(x)&&
 (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
const keys=new Set(['RESERVED','SETTLED','CANCELLED']);
const sign=(secret,value)=>createHmac('sha256',secret).update(value).digest('hex');
const validSecret=key=>Buffer.isBuffer(key)&&key.length===32;

function nowDay(now){
 const value=now();
 if(!Number.isFinite(value))throw fault(503,'BUDGET_CLOCK_UNAVAILABLE');
 const str=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
 if(!DAY.test(str))throw fault(503,'BUDGET_CLOCK_INVALID');
 return str;
}
export function budgetWorkspaceForDay(day,secret){
 if(!DAY.test(day??'')||!validSecret(secret))throw fault(503,'BUDGET_GLOBAL_BINDING_INVALID');
 return 'tenant_'+sign(secret,'THEFA_CORE_AI_BUDGET_KST_V1\0'+day);
}
export function budgetRequestHash(accountId,requestId,secret){
 if(!HASH.test(accountId??'')||!REQ.test(requestId??'')||!validSecret(secret))
  throw fault(400,'BUDGET_REQUEST_INVALID');
 return sign(secret,'THEFA_MODEL_BUDGET_REQUEST_V1\0'+accountId+'\0'+requestId);
}
function integer(x,small,big){
 return Number.isSafeInteger(x)&&x>=small&&x<=big;
}
const big=(n)=>BigInt(n);
// 0.30 USD/1M input, 1.20 USD/1M output, USD/KRW 1600 and 1.25 margin:
// ceil((in*3 + out*12)*1600*125/(10*1,000,000*100)).
export function conservativeFlashQuoteKrw(inputTokens,outputTokens){
 if(!integer(inputTokens,1,BUDGET_POLICY.maxInputTokens)||
    !integer(outputTokens,1,BUDGET_POLICY.maxOutputTokens))
  throw fault(400,'BUDGET_TOKEN_LIMIT_INVALID');
 const numerator=(big(inputTokens)*3n+big(outputTokens)*12n)*
  big(BUDGET_POLICY.conservativeUsdKrw)*125n;
 const denominator=1000000000n;
 const won=(numerator+denominator-1n)/denominator;
 const num=Number(won);
 if(!Number.isSafeInteger(num)||num<1||num>BUDGET_POLICY.dailyKrw)
  throw fault(503,'BUDGET_QUOTE_NOT_SAFE');
 return num;
}
export function budgetReadout(ledger,{day,allowMissing=true}={}){
 if(ledger==null){
  if(!allowMissing)throw fault(503,'BUDGET_LEDGER_MISSING');
  return Object.freeze({day,capKrw:10000,spentKrw:0,reservedKrw:0,remainingKrw:10000,records:0});
 }
 if(!safeObj(ledger)||ledger.contract!==BUDGET_POLICY.contract||ledger.day!==day||
  ledger.capKrw!==BUDGET_POLICY.dailyKrw||!safeObj(ledger.requests)||
  !integer(ledger.spentKrw,0,10000)||!integer(ledger.reservedKrw,0,10000))
  throw fault(503,'BUDGET_LEDGER_INVALID');
 const records=Object.entries(ledger.requests);
 if(records.length>BUDGET_POLICY.maxRecordsPerDay)throw fault(503,'BUDGET_LEDGER_CAPACITY_INVALID');
 let spent=0,reserved=0;
 for(const [key,entry] of records){
  if(!HASH.test(key)||!safeObj(entry)||!keys.has(entry.state)||!integer(entry.reservedKrw,1,10000))
   throw fault(503,'BUDGET_RECORD_PROVENANCE_INVALID');
  if(entry.state==='RESERVED'){
   if(Object.hasOwn(entry,'chargedKrw'))throw fault(503,'BUDGET_PENDING_HAS_CHARGE');
   reserved+=entry.reservedKrw;
  }else if(entry.state==='SETTLED'){
   if(!integer(entry.chargedKrw,1,entry.reservedKrw))throw fault(503,'BUDGET_SETTLEMENT_OUT_OF_RANGE');
   spent+=entry.chargedKrw;
  }else if(Object.hasOwn(entry,'chargedKrw')){
   throw fault(503,'BUDGET_CANCELLED_HAS_CHARGE');
  }
 }
 if(spent!==ledger.spentKrw||reserved!==ledger.reservedKrw||
  spent+reserved>BUDGET_POLICY.dailyKrw)
  throw fault(503,'BUDGET_COUNTERS_DIVERGED');
 return Object.freeze({day,capKrw:10000,spentKrw:spent,reservedKrw:reserved,
  remainingKrw:10000-spent-reserved,records:records.length});
}
function newLedger(day){
 return {contract:BUDGET_POLICY.contract,day,capKrw:BUDGET_POLICY.dailyKrw,
  spentKrw:0,reservedKrw:0,requests:{}};
}
export function createIsolatedDailyAiBudget({rest,secret,clock=Date.now}={}){
 if(!rest||typeof rest.request!=='function'||typeof rest.rpc!=='function')
  throw fault(503,'BUDGET_VERIFIED_DATABASE_TRANSPORT_REQUIRED');
 if(!validSecret(secret)||typeof clock!=='function')
  throw fault(503,'BUDGET_STABLE_KEY_REQUIRED');

 async function scoped(day,operation,{write=false}={}){
  const store=new TenantStateStore(rest,{workspaceId:budgetWorkspaceForDay(day,secret)});
  let outcome,problem=null;
  try{
   await store.init();
   outcome=await operation(store);
  }catch(error){
   // Reducer validation is deterministic and happens before the state RPC.
   // Transport errors can indicate a committed write even without an ACK.
   const preflightErrors=new Set([
    'BUDGET_REQUEST_ALREADY_EXISTS_NO_REPLAY','BUDGET_RECORD_LIMIT',
    'DAILY_AI_BUDGET_EXHAUSTED','BUDGET_RESERVATION_MISSING',
    'BUDGET_RESERVATION_NOT_ACTIVE','BUDGET_USAGE_EXCEEDED_RESERVED_HOLD',
    'BUDGET_CANNOT_CANCEL_NON_PENDING','BUDGET_LEDGER_INVALID',
    'BUDGET_RECORD_PROVENANCE_INVALID','BUDGET_PENDING_HAS_CHARGE',
    'BUDGET_SETTLEMENT_OUT_OF_RANGE','BUDGET_CANCELLED_HAS_CHARGE',
    'BUDGET_COUNTERS_DIVERGED','BUDGET_LEDGER_CAPACITY_INVALID'
   ]);
   problem=write&&!preflightErrors.has(error?.code)
    ?fault(503,'BUDGET_WRITE_OUTCOME_UNCERTAIN_NO_REPLAY'):error;
  }
  try{await store.close()}catch{
   if(!problem)problem=fault(503,'BUDGET_LEASE_CLEANUP_UNCERTAIN');
  }
  if(problem)throw problem;
  return outcome;
 }
 async function status({day=nowDay(clock)}={}){
  if(!DAY.test(day))throw fault(400,'BUDGET_DAY_INVALID');
  return scoped(day,s=>budgetReadout(s.state.dailyAiCostBudget,{day}));
 }
 async function reserve(accountId,requestId,{maxInputTokens,maxOutputTokens}={}){
  const key=budgetRequestHash(accountId,requestId,secret);
  const day=nowDay(clock);
  const quoted=conservativeFlashQuoteKrw(maxInputTokens,maxOutputTokens);
  return scoped(day,store=>store.mutate(state=>{
   let ledger=state.dailyAiCostBudget??=newLedger(day);
   const info=budgetReadout(ledger,{day,allowMissing:false});
   if(Object.hasOwn(ledger.requests,key))throw fault(409,'BUDGET_REQUEST_ALREADY_EXISTS_NO_REPLAY');
   if(info.records>=BUDGET_POLICY.maxRecordsPerDay)throw fault(429,'BUDGET_RECORD_LIMIT');
   if(info.remainingKrw<quoted)throw fault(429,'DAILY_AI_BUDGET_EXHAUSTED');
   ledger.requests[key]={state:'RESERVED',reservedKrw:quoted};
   ledger.reservedKrw+=quoted;
   budgetReadout(ledger,{day,allowMissing:false});
   return {day,reservedKrw:quoted,requestFingerprint:key,admitted:true,
    automaticReplayAllowed:false};
  }),{write:true});
 }
 async function settle(accountId,requestId,{day,inputTokens,outputTokens}={}){
  const key=budgetRequestHash(accountId,requestId,secret);
  if(!DAY.test(day??''))throw fault(400,'BUDGET_DAY_INVALID');
  const actual=conservativeFlashQuoteKrw(inputTokens,outputTokens);
  return scoped(day,store=>store.mutate(state=>{
   const ledger=state.dailyAiCostBudget;
   const report=budgetReadout(ledger,{day,allowMissing:false});
   const entry=ledger.requests[key];
   if(!entry)throw fault(409,'BUDGET_RESERVATION_MISSING');
   if(entry.state==='SETTLED')return {alreadySettled:true,chargedKrw:entry.chargedKrw};
   if(entry.state!=='RESERVED')throw fault(409,'BUDGET_RESERVATION_NOT_ACTIVE');
   if(actual>entry.reservedKrw)throw fault(503,'BUDGET_USAGE_EXCEEDED_RESERVED_HOLD');
   entry.state='SETTLED';entry.chargedKrw=actual;
   ledger.spentKrw+=actual;ledger.reservedKrw-=entry.reservedKrw;
   budgetReadout(ledger,{day,allowMissing:false});
   return {alreadySettled:false,chargedKrw:actual,
    remainingKrw:10000-ledger.spentKrw-ledger.reservedKrw};
  }),{write:true});
 }
 async function cancelWithoutDispatch(accountId,requestId,{day,modelNotInvoked}={}){
  const key=budgetRequestHash(accountId,requestId,secret);
  if(!DAY.test(day??'')||modelNotInvoked!==true)
   throw fault(403,'BUDGET_CANCELLATION_DISPATCH_PROOF_REQUIRED');
  return scoped(day,store=>store.mutate(state=>{
   const ledger=state.dailyAiCostBudget;
   budgetReadout(ledger,{day,allowMissing:false});
   const entry=ledger.requests[key];
   if(!entry||entry.state!=='RESERVED')throw fault(409,'BUDGET_CANNOT_CANCEL_NON_PENDING');
   ledger.reservedKrw-=entry.reservedKrw;
   entry.state='CANCELLED';
   budgetReadout(ledger,{day,allowMissing:false});
   return {cancelled:true};
  }),{write:true});
 }
 return Object.freeze({status,reserve,settle,cancelWithoutDispatch});
}
