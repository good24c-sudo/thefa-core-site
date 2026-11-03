import {createHash,createHmac,randomInt} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {TenantStateStore} from './inherited/customer-tenant-storage.mjs';
import {assertTenantEnvelope} from './inherited/cloud-allowance.mjs';
import {getConfiguredCustomerAuthBinding} from './inherited/server/auth/service.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=(code,status=503)=>Object.assign(new Error(code),{code,status});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash=/^[a-f0-9]{64}$/;
export const launchRegistryId='tenant_'+sha('THEFA_CUSTOMER_FRESH_LAUNCH_REGISTRY_V1');
const oldRegistryId='tenant_'+sha('THEFA_CUSTOMER_ACCOUNT_REGISTRY_V1');
const proofs=new WeakMap();
export function normalizeLaunchEmail(value){
 if(typeof value!=='string'||value.length>254||value!==value.trim()||! /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(value))throw fail('EMAIL_INVALID',400);
 return value.toLowerCase();
}
export function readFreshLaunchProof(proof){const x=proofs.get(proof);if(!x||!Number.isFinite(x.clock())||x.clock()>=x.expiresAt)throw fail('FRESH_LAUNCH_PROOF_REQUIRED');return {identity:structuredClone(x.identity),principal:structuredClone(x.principal)};}
/** Existing signed BetterAuth session is authoritative. A new launch never
 * invents a legacy inventory or matches accounts by a browser-supplied email.
 * This registry and epoch are fixed server configuration, not client choices. */
export function createFreshLaunchAccounts({authService,rest,config,clock=Date.now}={}){
 const binding=getConfiguredCustomerAuthBinding(authService);
 const start=Date.parse(config?.launchStartedAt);
 if(!binding||binding.mode!=='https'||binding.customerOrigin!==config?.customerOrigin||binding.environment!==config.environment||config.accountMode!=='fresh-launch'||
  !Number.isFinite(start)||new Date(start).toISOString()!==config.launchStartedAt||start>clock()||
  typeof config.usageEpoch!=='string'||! /^[a-zA-Z0-9_-]{8,64}$/.test(config.usageEpoch)||
  !Buffer.isBuffer(config.accountSecret)||config.accountSecret.length!==32||!Buffer.isBuffer(config.allowanceSecret)||config.allowanceSecret.length!==32||
  typeof config.tenantKey!=='string'||config.tenantKey.length<32||typeof rest?.request!=='function'||typeof rest?.rpc!=='function'||typeof clock!=='function')throw fail('FRESH_LAUNCH_CONFIGURATION_INVALID');
 const secret=Buffer.from(config.accountSecret),sign=s=>createHmac('sha256',secret).update(s).digest('hex');
 const policy={contract:'THEFA_FRESH_LAUNCH_V1',identityRealm:binding.legacyIdentityRealm,usageEpoch:config.usageEpoch,startedAt:config.launchStartedAt,
  accountKeySha256:sha(secret),allowanceKeySha256:sha(config.allowanceSecret),tenantKeySha256:sha(config.tenantKey)};
 function validate(state){assertTenantEnvelope(state);const r=state.launchAccounts;
  if(!plain(r)||!plain(r.binding)||Object.keys(r.binding).length!==Object.keys(policy).length||Object.entries(policy).some(([k,v])=>r.binding[k]!==v)||!plain(r.accounts)||!plain(r.attempts))throw fail('FRESH_LAUNCH_POLICY_OR_REGISTRY_MISMATCH');return r;}
 async function load(id=launchRegistryId){const rows=await rest.request('/core_console_state_v3?workspace_id=eq.'+id+'&select=state,version&limit=1');if(!Array.isArray(rows)||rows.length>1)throw fail('FRESH_LAUNCH_REGISTRY_UNAVAILABLE');if(!rows.length)return null;
  // An abandoned first lease may have created only this new registry placeholder.
  // Admission still needs the atomic owner lease before any initialization.
  if(id===launchRegistryId&&rows[0]?.version===0&&rows[0].state===null)return null;
  if(!Number.isSafeInteger(rows[0]?.version)||rows[0].version<1)throw fail('FRESH_LAUNCH_REGISTRY_UNAVAILABLE');assertTenantEnvelope(rows[0].state);return rows[0].state;}
 async function mutate(fn){const store=new TenantStateStore(rest,{workspaceId:launchRegistryId}),acquire=store.acquire.bind(store);let mayInitialize=false;
  store.acquire=async()=>{let lease;
   for(let attempt=0;attempt<8;attempt++){
    try{lease=await acquire();break;}catch(error){
     // Retry only an explicit atomic lease denial. Transport/ACK/schema errors
     // and every state-save operation are never replayed.
     if(error?.code!=='LEASE_BUSY'||error?.status!==409||attempt===7)throw error;
     await pause(25*2**Math.min(attempt,3)+randomInt(26));
    }
   }
   mayInitialize=lease.version===0&&lease.state===null;if(!mayInitialize)validate(lease.state);return lease;
  };
  try{await store.init();return await store.mutate(state=>{if(mayInitialize){if(Object.hasOwn(state,'launchAccounts'))throw fail('FRESH_LAUNCH_REGISTRY_UNAVAILABLE');state.launchAccounts={binding:structuredClone(policy),accounts:{},attempts:{}};}const r=validate(state);return fn(r);});}
  finally{await store.close();}}
 async function identity(cookie){
  if(typeof cookie!=='string'||!cookie||cookie.length>8192)return null;
  const names=new Set();for(const item of cookie.split(';')){const m=/^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=([^\x00-\x20\x7f;,]*)$/.exec(item.trim());if(!m||names.has(m[1]))return null;names.add(m[1]);}
  let value;try{value=await authService.auth.api.getSession({headers:new Headers({cookie}),query:{disableCookieCache:true}});}catch{throw fail('FRESH_LAUNCH_SESSION_UNAVAILABLE');}
  const s=value?.session,u=value?.user,expires=new Date(s?.expiresAt).getTime(),created=new Date(u?.createdAt).getTime(),now=clock();
  if(!plain(s)||!plain(u)||!uuid.test(u.id??'')||s.userId!==u.id||!['google','email'].includes(s.coreProviderId)||u.emailVerified!==true||
    !Number.isFinite(expires)||expires<=now||!Number.isFinite(created)||created>now+5000)return null;
  let email;try{email=normalizeLaunchEmail(u.email)}catch{return null;}
  return {userId:u.id,provider:s.coreProviderId,email,emailVerified:true,expiresAt:expires,createdAt:created,
   displayName:typeof u.name==='string'?u.name.slice(0,80):email};
 }
 function principal(i,record){return {principalId:sign(binding.legacyIdentityRealm+'|'+i.userId),workspaceEmail:record.workspaceEmail,provider:i.provider,sessionVerified:true,accountProvenance:'LAUNCH_ACCOUNT_CONFIRMED',user:{id:i.userId,displayName:i.displayName,provider:i.provider}};}
 function verifyRecord(r,id,i){const rec=r.accounts[id];if(!Object.hasOwn(r.accounts,id))return null;
  if(!plain(rec)||rec.userId!==i.userId||rec.principalId!==id||typeof rec.workspaceEmail!=='string'||rec.workspaceEmail!==normalizeLaunchEmail(rec.workspaceEmail)||rec.bindingContract!=='THEFA_FRESH_ACCOUNT_BINDING_V1')throw fail('FRESH_LAUNCH_ACCOUNT_BINDING_INVALID');return rec;}
 async function resolve(cookie,{admit=false}={}){
  const i=await identity(cookie);if(!i)return null;const id=sign(binding.legacyIdentityRealm+'|'+i.userId),state=await load();let record=state?verifyRecord(validate(state),id,i):null;
  if(!record&&!admit)return null;
  if(!record){
   const old=await load(oldRegistryId);let target;
   if(old){const r=old.customerAccounts;if(!plain(r)||!plain(r.accounts)||!plain(r.claims))throw fail('LEGACY_ACCOUNT_BINDING_REQUIRED');const previous=r.accounts[id];
    if(Object.hasOwn(r.accounts,id)){if(!plain(previous))throw fail('LEGACY_ACCOUNT_BINDING_REQUIRED');target=previous.workspaceEmail;if(typeof target!=='string'||target!==normalizeLaunchEmail(target)||r.claims[sign(target)]!==id)throw fail('LEGACY_ACCOUNT_BINDING_REQUIRED');}
    else if(Object.values(r.claims).some(value=>value===id))throw fail('LEGACY_ACCOUNT_BINDING_REQUIRED');}
   if(!target){if(i.createdAt<start)throw fail('LEGACY_ACCOUNT_BINDING_REQUIRED');target='account_'+id+'@accounts.thefa.invalid';}
   record=await mutate(r=>{const existing=verifyRecord(r,id,i);if(existing){if(existing.workspaceEmail!==target)throw fail('FRESH_LAUNCH_ACCOUNT_BINDING_CONFLICT');return existing;}
    if(Object.keys(r.accounts).length>=10000)throw fail('FRESH_LAUNCH_CAPACITY');const entry={principalId:id,userId:i.userId,workspaceEmail:target,bindingContract:'THEFA_FRESH_ACCOUNT_BINDING_V1'};r.accounts[id]=entry;return entry;});
  }
  return principal(i,record);
 }
 async function proof(cookie){const p=await resolve(cookie);if(!p)return null;const i=await identity(cookie);if(!i||sign(binding.legacyIdentityRealm+'|'+i.userId)!==p.principalId)return null;const opaque=Object.freeze({});proofs.set(opaque,{identity:i,principal:p,expiresAt:Math.min(i.expiresAt,clock()+10000),clock});return opaque;}
 async function limit({email,peer,operation}){
  email=normalizeLaunchEmail(email);if(typeof peer!=='string'||!peer||peer.length>100||!['send','verify'].includes(operation))throw fail('EMAIL_REQUEST_CONTEXT_REQUIRED');
  const now=clock();if(!Number.isFinite(now))throw fail('EMAIL_REQUEST_CONTEXT_REQUIRED');
  return mutate(r=>{for(const[k,v]of Object.entries(r.attempts)){if(!hash.test(k)||!plain(v)||!Number.isSafeInteger(v.count)||v.count<1||!Number.isFinite(v.until))throw fail('EMAIL_RATE_STATE_INVALID');if(v.until<=now)delete r.attempts[k];}
   const buckets=[[sign('EMAIL_'+operation+':'+email),operation==='send'?5:20],[sign('PEER_'+operation+':'+peer),operation==='send'?30:60]];
   for(const[k,max]of buckets){const v=r.attempts[k];if(v&&(!Number.isSafeInteger(v.count)||v.count<1||!Number.isFinite(v.until)))throw fail('EMAIL_RATE_STATE_INVALID');if(v?.count>=max)throw fail('EMAIL_RATE_LIMIT',429);}
   if(Object.keys(r.attempts).length+buckets.filter(([k])=>!Object.hasOwn(r.attempts,k)).length>10000)throw fail('EMAIL_RATE_CAPACITY',429);
   for(const[k]of buckets){r.attempts[k]??={count:0,until:now+600000};r.attempts[k].count++;}return {admitted:true};});
 }
 return Object.freeze({resolve,proof,limit});
}
