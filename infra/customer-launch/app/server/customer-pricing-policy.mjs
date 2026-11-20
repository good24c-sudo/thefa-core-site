import {createHash,randomUUID} from 'node:crypto';

export const PRICING_CONTRACT='THEFA_COST_BASED_CREDITS_V1';
// Fixed server-owned namespace, never accepted from an administrator/browser payload.
export const PRICING_WORKSPACE='tenant_'+createHash('sha256').update('THEFA_CORE_PRICING_POLICY_V1').digest('hex');
const fail=(code,status=503)=>Object.assign(Error(code),{code,status});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const int=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const REQUEST=/^[A-Za-z0-9._:-]{8,128}$/;
const CONFIG_KEYS=['markupBps','minimumChargeCredits','fxKrwPerUsd','standardMonthlyCredits','proMonthlyCredits'];
const DEFAULT_CONFIG=Object.freeze({markupBps:20000,minimumChargeCredits:1,fxKrwPerUsd:1600,standardMonthlyCredits:19000,proMonthlyCredits:49000});
function configOf(input){
 if(!plain(input)||Object.keys(input).length!==CONFIG_KEYS.length||CONFIG_KEYS.some(k=>!Object.hasOwn(input,k))||
  !int(input.markupBps,10000,100000)||!int(input.minimumChargeCredits,1,1000)||
  !int(input.fxKrwPerUsd,500,5000)||!int(input.standardMonthlyCredits,1,1000000)||
  !int(input.proMonthlyCredits,1,1000000))throw fail('PRICING_CONFIGURATION_INVALID',400);
 return Object.fromEntries(CONFIG_KEYS.map(k=>[k,input[k]]));
}
export function createPricingPolicy(config=DEFAULT_CONFIG,{revision=0,effectiveAt='2026-11-20T00:00:00.000Z'}={}){
 const values=configOf(config);
 if(!int(revision,0,100000)||new Date(effectiveAt).toISOString()!==effectiveAt)throw fail('PRICING_VERSION_INVALID',400);
 const payload={contract:PRICING_CONTRACT,revision,effectiveAt,creditValueKrw:1,rounding:'CEIL_FINAL_WON',
  taxTreatment:'CUSTOMER_CHARGE_INCLUDES_VAT',freeTrialAnswers:10,costBasis:'OBSERVED_USAGE_VERSIONED_API_RATE_NOT_VENDOR_INVOICE',...values};
 return Object.freeze({...payload,version:'pricing_'+digest(payload)});
}
export const DEFAULT_PRICING_POLICY=createPricingPolicy();
export function verifyPricingPolicy(policy){
 if(!plain(policy))throw fail('PRICING_POLICY_INVALID');
 let expected;
 try{expected=createPricingPolicy(Object.fromEntries(CONFIG_KEYS.map(k=>[k,policy[k]])),policy);}
 catch{throw fail('PRICING_POLICY_INVALID');}
 if(Object.keys(expected).length!==Object.keys(policy).length||Object.entries(expected).some(([k,v])=>policy[k]!==v))throw fail('PRICING_POLICY_INVALID');
 return expected;
}
export function retailCreditsForCostMicros(krwMicros,policy=DEFAULT_PRICING_POLICY){
 const p=verifyPricingPolicy(policy);
 if(!int(krwMicros,0,Number.MAX_SAFE_INTEGER))throw fail('PRICING_COST_INVALID');
 const raw=(BigInt(krwMicros)*BigInt(p.markupBps)+9999999999n)/10000000000n;
 const amount=Math.max(p.minimumChargeCredits,Number(raw));
 if(!Number.isSafeInteger(amount))throw fail('PRICING_AMOUNT_INVALID');
 return amount;
}
export function retailQuoteForNanoUsd(nanoUsd,policy=DEFAULT_PRICING_POLICY){
 const p=verifyPricingPolicy(policy);
 if(typeof nanoUsd!=='string'||!/^(0|[1-9][0-9]{0,20})$/.test(nanoUsd))throw fail('PRICING_COST_INVALID');
 const costMicros=Number((BigInt(nanoUsd)*BigInt(p.fxKrwPerUsd)+999n)/1000n);
 // Round the final customer amount once; do not round the supplier cost to whole KRW.
 const final=Number((BigInt(nanoUsd)*BigInt(p.fxKrwPerUsd)*BigInt(p.markupBps)+9999999999999n)/10000000000000n);
 if(!Number.isSafeInteger(costMicros)||!Number.isSafeInteger(final))throw fail('PRICING_AMOUNT_INVALID');
 return Object.freeze({estimatedSupplierCostKrwMicros:costMicros,retailCredits:Math.max(p.minimumChargeCredits,final),policyVersion:p.version,creditValueKrw:1});
}
function blank(){return {version:2,tasks:[],artifacts:[],receipts:[],memory:[],idempotency:{}};}
function historyOf(state){
 if(!state)return {current:DEFAULT_PRICING_POLICY,history:[],requests:{}};
 if(state.version!==2||['tasks','artifacts','receipts','memory'].some(k=>!Array.isArray(state[k])||state[k].length)||!plain(state.idempotency)||Object.keys(state.idempotency).length||Object.keys(state).some(k=>!['version','tasks','artifacts','receipts','memory','idempotency','customerPricingPolicy'].includes(k)))throw fail('PRICING_NAMESPACE_CONFLICT');
 const ledger=state.customerPricingPolicy;
 if(ledger===undefined)return {current:DEFAULT_PRICING_POLICY,history:[],requests:{}};
 if(!plain(ledger)||ledger.contract!==PRICING_CONTRACT||!Array.isArray(ledger.history)||ledger.history.length>512||!plain(ledger.requests))throw fail('PRICING_HISTORY_INVALID');
 const current=verifyPricingPolicy(ledger.current);let previous=DEFAULT_PRICING_POLICY;
 for(const item of ledger.history){
  const next=verifyPricingPolicy(item.policy);
  if(item.previousVersion!==previous.version||next.revision!==previous.revision+1||!/^[a-f0-9]{64}$/.test(item.actorRef??'')||!REQUEST.test(item.requestId??'')||ledger.requests[item.requestId]!==next.version)throw fail('PRICING_HISTORY_INVALID');
  previous=next;
 }
 if(previous.version!==current.version)throw fail('PRICING_HISTORY_INVALID');
 return {current,history:ledger.history,requests:ledger.requests};
}
export function createPricingPolicyService({rest,clock=()=>new Date().toISOString()}={}){
 if(typeof rest?.request!=='function'||typeof rest?.rpc!=='function')throw fail('PRICING_STORAGE_UNAVAILABLE');
 async function read(){
  const rows=await rest.request('/core_console_state_v3?workspace_id=eq.'+PRICING_WORKSPACE+'&select=state,version&limit=1');
  if(!Array.isArray(rows)||rows.length>1)throw fail('PRICING_READ_UNVERIFIED');
  const ledger=historyOf(rows[0]?.state);
  return {policy:ledger.current,history:structuredClone(ledger.history).reverse(),persisted:!!rows[0]?.state?.customerPricingPolicy,paymentConnected:false};
 }
 async function update({expectedVersion,requestId,config},actorRef){
  if(typeof expectedVersion!=='string'||!REQUEST.test(requestId??'')||!/^[a-f0-9]{64}$/.test(actorRef??''))throw fail('PRICING_UPDATE_INVALID',400);
  const values=configOf(config),owner=randomUUID();let acquired=false;
  try{
   const lease=await rest.rpc('core_console_acquire_lease_v3',{p_workspace:PRICING_WORKSPACE,p_owner:owner,p_seconds:120});
   if(lease?.granted===false)throw fail('PRICING_BUSY',409);
   if(lease?.granted!==true||lease.lease_owner!==owner||!int(Number(lease.version),0,Number.MAX_SAFE_INTEGER))throw fail('PRICING_LEASE_UNVERIFIED');
   acquired=true;
   const state=lease.state==null?blank():structuredClone(lease.state),ledger=historyOf(state);
   if(Object.hasOwn(ledger.requests,requestId)){
    const prior=ledger.history.find(row=>row.requestId===requestId);
    if(!prior||prior.actorRef!==actorRef||prior.previousVersion!==expectedVersion||CONFIG_KEYS.some(k=>prior.policy[k]!==values[k]))throw fail('PRICING_IDEMPOTENCY_CONFLICT',409);
    return {policy:ledger.current,savedPolicyVersion:prior.policy.version,reused:true};
   }
   if(expectedVersion!==ledger.current.version)throw fail('PRICING_VERSION_CONFLICT',409);
   if(ledger.history.length>=512)throw fail('PRICING_HISTORY_ARCHIVE_REQUIRED',409);
   const next=createPricingPolicy(values,{revision:ledger.current.revision+1,effectiveAt:clock()});
   const audit={requestId,actorRef,previousVersion:ledger.current.version,policy:next};
   state.customerPricingPolicy={contract:PRICING_CONTRACT,current:next,history:[...ledger.history,audit],requests:{...ledger.requests,[requestId]:next.version}};
   const saved=await rest.rpc('core_console_save_state_v3',{p_workspace:PRICING_WORKSPACE,p_owner:owner,p_expected_version:Number(lease.version),p_state:state});
   if(saved?.version!==Number(lease.version)+1)throw fail('PRICING_SAVE_ACK_UNVERIFIED');
   return {policy:next,savedPolicyVersion:next.version,reused:false};
  }finally{
   if(acquired)try{await rest.rpc('core_console_release_lease_v3',{p_workspace:PRICING_WORKSPACE,p_owner:owner});}catch{/* Outcome is read back by requestId; never replay automatically. */}
  }
 }
 return Object.freeze({read,update});
}
// Same fixed database transport for both deployments. No admin-provided URL/workspace.
export function createPricingRest({url,key,fetchImpl=globalThis.fetch}={}){
 if(url!=='https://cgrppxfdurpzzfvkmfte.supabase.co'||typeof key!=='string'||key.length<20)throw fail('PRICING_STORAGE_CONFIGURATION_INVALID');
 async function request(route,method='GET',body){
  const get=route==='/core_console_state_v3?workspace_id=eq.'+PRICING_WORKSPACE+'&select=state,version&limit=1';
  const rpc=/^\/rpc\/core_console_(acquire_lease|save_state|release_lease)_v3$/.test(route);
  if(!(get&&method==='GET')&&!(rpc&&method==='POST'&&body?.p_workspace===PRICING_WORKSPACE))throw fail('PRICING_STORAGE_SCOPE_INVALID');
  let response;
  try{response=await fetchImpl(url+'/rest/v1'+route,{method,headers:{apikey:key,authorization:'Bearer '+key,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});}
  catch{throw fail(method==='POST'?'PRICING_WRITE_OUTCOME_UNKNOWN':'PRICING_READ_UNAVAILABLE');}
  if(!response.ok)throw fail(response.status===409?'PRICING_VERSION_CONFLICT':'PRICING_STORAGE_FAILED',response.status===409?409:503);
  if(response.status===204)return null;
  try{return await response.json();}catch{throw fail('PRICING_RESPONSE_INVALID');}
 }
 return {request,rpc:(name,body)=>request('/rpc/'+name,'POST',body)};
}
