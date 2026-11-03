/**
 * P02 R26 isolated server-side cloud allowance candidate.
 * Uses existing tenant-v3 state/lease RPC contract; never carries database credentials.
 * INTEGRATION GATE: target PG17 migration not deployed; actual auth + official writer unverified.
 */
import {createHmac} from 'node:crypto';
import {TenantStateStore} from './customer-tenant-storage.mjs';

const CODE_ACCOUNT=/^[a-f0-9]{64}$/;
const CODE_REQUEST=/^[A-Za-z0-9._:-]{8,160}$/;
const CODE_HASH=/^[a-f0-9]{64}$/;
const CAP=10;
const MAX_REQUESTS=4000;
const MAX_STATE_BYTES=4*1024*1024;
const fail=(status,code)=>Object.assign(new Error(code),{status,code});
const owned={has:(obj,key)=>Object.hasOwn(obj,key)};
const safeObject=value=>value&&typeof value==='object'&&!Array.isArray(value)&&
 (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest('hex');
export function allowanceWorkspaceForAccount(account,secret,usageEpoch=null){
 if(!CODE_ACCOUNT.test(account??'')||!Buffer.isBuffer(secret)||secret.length!==32)
   throw fail(503,'ACCOUNT_ALLOWANCE_BINDING_UNAVAILABLE');
 // Keep exact R9 path identity; don't replace the stable 32-byte secret or change this label.
 if(usageEpoch!==null&&(typeof usageEpoch!=='string'||! /^[a-zA-Z0-9_-]{8,64}$/.test(usageEpoch)))throw fail(503,'USAGE_EPOCH_INVALID');
 return 'tenant_'+hmac(secret,usageEpoch===null?'CORE_FREE_ALLOWANCE_V1:'+account:'CORE_FREE_ALLOWANCE_LAUNCH_V1:'+usageEpoch+':'+account);
}
export function allowanceRequestKey(requestId,secret){
 if(!CODE_REQUEST.test(requestId??'')||!Buffer.isBuffer(secret)||secret.length!==32)
   throw fail(400,'ALLOWANCE_REQUEST_ID_INVALID');
 return hmac(secret,'REQUEST:'+requestId);
}
export const freshAllowance=()=>({version:1,used:0,requests:{},completions:{}});
export function inspectAllowance(ledger,{allowMissing=false,secret=null}={}){
 if(ledger==null){
  if(!allowMissing)throw fail(503,'EXISTING_ALLOWANCE_PROOF_REQUIRED');
  ledger=freshAllowance();
 }
 if(!safeObject(ledger)||ledger.version!==1||!Number.isSafeInteger(ledger.used)||
  ledger.used<0||ledger.used>CAP||!safeObject(ledger.requests)||
  !safeObject(ledger.completions??{}))throw fail(503,'ALLOWANCE_LEDGER_INVALID');
 const requests=Object.entries(ledger.requests);
 if(requests.length>MAX_REQUESTS)throw fail(503,'ALLOWANCE_REQUEST_CAPACITY_INVALID');
 let succeeded=0,pending=0;
 for(const [key,status] of requests){
  if(!CODE_HASH.test(key)||!['RESERVED','SUCCEEDED'].includes(status))
   throw fail(503,'ALLOWANCE_REQUEST_PROVENANCE_INVALID');
  if(status==='SUCCEEDED')succeeded++;else pending++;
 }
 if(succeeded!==ledger.used||succeeded+pending>CAP)
  throw fail(503,'ALLOWANCE_USAGE_DISAGREEMENT');
 for(const [key,result] of Object.entries(ledger.completions??{})){
  if(!CODE_HASH.test(key)||!owned.has(ledger.requests,key)||
   ledger.requests[key]!=='RESERVED'||!safeObject(result)||
   !CODE_REQUEST.test(result.requestId??'')||
   (secret!==null&&allowanceRequestKey(result.requestId,secret)!==key)||
   !owned.has(result,'result'))
   throw fail(503,'ALLOWANCE_COMPLETION_PROVENANCE_INVALID');
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>102400)
   throw fail(503,'ALLOWANCE_COMPLETION_OVERSIZED');
 }
 if(Buffer.byteLength(JSON.stringify(ledger),'utf8')>MAX_STATE_BYTES)
  throw fail(503,'ALLOWANCE_LEDGER_OVERSIZED');
 return Object.freeze({
  freeLimit:CAP,used:ledger.used,pending,remaining:CAP-ledger.used-pending,
  planRequired:ledger.used===CAP
 });
}
export function assertTenantEnvelope(state){
 if(!safeObject(state)||state.version!==2||
  !Array.isArray(state.tasks)||!Array.isArray(state.artifacts)||
  !Array.isArray(state.receipts)||!Array.isArray(state.memory)||
  !safeObject(state.idempotency))
  throw fail(503,'TENANT_STATE_ENVELOPE_INVALID');
 if(Buffer.byteLength(JSON.stringify(state),'utf8')>MAX_STATE_BYTES)
  throw fail(503,'TENANT_STATE_OVERSIZED');
}
// All operations require an injected transport. This module cannot directly call live Supabase.
export function createIsolatedCloudAllowance({rest,secret,usageEpoch=null}={}){
 if(!rest||typeof rest.request!=='function'||typeof rest.rpc!=='function')
  throw fail(503,'VERIFIED_TENANT_REST_REQUIRED');
 if(!Buffer.isBuffer(secret)||secret.length!==32)
  throw fail(503,'DEDICATED_ALLOWANCE_KEY_REQUIRED');
 const digest=requestId=>allowanceRequestKey(requestId,secret);
 async function scoped(account,action,{mutates=false}={}){
  const workspaceId=allowanceWorkspaceForAccount(account,secret,usageEpoch);
  const store=new TenantStateStore(rest,{workspaceId});
  let result,error=null;
  try{
   await store.init();
   assertTenantEnvelope(store.state);
   result=await action(store);
  }catch(e){
   // A write that may have reached RPC must not be automatically repeated.
   error=(!mutates||['ALLOWANCE_REQUEST_ID_INVALID','PLAN_REQUIRED',
     'ALLOWANCE_REQUEST_PENDING','ALLOWANCE_LEDGER_INVALID',
     'ALLOWANCE_REQUEST_PROVENANCE_INVALID','ALLOWANCE_USAGE_DISAGREEMENT',
     'ALLOWANCE_COMPLETION_PROVENANCE_INVALID','COMPLETION_INVALID',
     'ALLOWANCE_RESERVATION_REQUIRED','ALLOWANCE_REQUEST_CAPACITY_INVALID'].includes(e.code))
    ?e:fail(503,'ALLOWANCE_WRITE_OUTCOME_UNCERTAIN');
  }
  try{await store.close();}catch{
   if(!error)error=fail(503,'ALLOWANCE_LEASE_CLEANUP_UNCERTAIN');
  }
  if(error)throw error;
  return result;
 }
 async function view(account){
  return scoped(account,store=>inspectAllowance(store.state.customerAllowance,{allowMissing:true,secret}));
 }
 async function reserve(account,requestId){
  const key=digest(requestId);
  return scoped(account,store=>store.mutate(state=>{
   assertTenantEnvelope(state);
   const ledger=state.customerAllowance??=freshAllowance();
   const current=inspectAllowance(ledger,{secret});
   if(ledger.requests[key]==='SUCCEEDED')return {alreadySaved:true};
   if(ledger.requests[key]==='RESERVED')throw fail(409,'ALLOWANCE_REQUEST_PENDING');
   if(current.remaining===0)throw fail(402,'PLAN_REQUIRED');
   if(Object.keys(ledger.requests).length>=MAX_REQUESTS)throw fail(503,'ALLOWANCE_REQUEST_CAPACITY_INVALID');
   ledger.requests[key]='RESERVED';
   return {alreadySaved:false};
  }),{mutates:true});
 }
 async function settle(account,requestId,{saved}={}){
  const key=digest(requestId);
  if(typeof saved!=='boolean')throw fail(400,'ALLOWANCE_SETTLEMENT_REQUIRED');
  return scoped(account,store=>store.mutate(state=>{
   assertTenantEnvelope(state);
   const ledger=state.customerAllowance;
   if(!ledger)throw fail(409,'ALLOWANCE_RESERVATION_REQUIRED');
   inspectAllowance(ledger,{secret});
   if(ledger.requests[key]==='SUCCEEDED')return {alreadySaved:true};
   if(ledger.requests[key]!=='RESERVED')throw fail(409,'ALLOWANCE_RESERVATION_REQUIRED');
   if(saved){ledger.used++;ledger.requests[key]='SUCCEEDED'}
   else delete ledger.requests[key];
   if(ledger.completions)delete ledger.completions[key];
   inspectAllowance(ledger,{secret});
   return {alreadySaved:false,saved};
  }),{mutates:true});
 }
 async function recordCompletion(account,requestId,result){
  const key=digest(requestId);
  if(!safeObject(result)||Buffer.byteLength(JSON.stringify(result),'utf8')>100000)
   throw fail(400,'COMPLETION_INVALID');
  return scoped(account,store=>store.mutate(state=>{
   assertTenantEnvelope(state);
   const ledger=state.customerAllowance;
   if(!ledger||ledger.requests?.[key]!=='RESERVED')
    throw fail(409,'ALLOWANCE_RESERVATION_REQUIRED');
   ledger.completions??={};
   if(owned.has(ledger.completions,key))throw fail(409,'ALLOWANCE_REQUEST_PENDING');
   ledger.completions[key]={requestId,result:structuredClone(result)};
   inspectAllowance(ledger,{secret});
   return {recorded:true};
  }),{mutates:true});
 }
 async function pendingCompletions(account){
  return scoped(account,store=>{
   const ledger=store.state.customerAllowance;
   if(!ledger)return [];
   inspectAllowance(ledger,{secret});
   return structuredClone(Object.values(ledger.completions??{}));
  });
 }
 return Object.freeze({view,reserve,settle,recordCompletion,pendingCompletions});
}
