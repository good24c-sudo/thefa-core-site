import {createHash,createHmac} from 'node:crypto';
import {getConfiguredCustomerAuthBinding} from './inherited/server/auth/service.mjs';
import {getConfiguredCoreAuthPoolBinding} from './inherited/server/auth/database.mjs';
import {allowanceWorkspaceForAccount} from './inherited/cloud-allowance.mjs';
import {tenantWorkspaceForEmail} from './inherited/customer-tenant-storage.mjs';
import {readVerifiedLegacyInventory,providerSubjectHash} from './migration-inventory.mjs';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identities=new WeakMap(),classifications=new WeakMap();
const bad=code=>{throw Object.assign(new Error(code),{code,status:503})};
const sha=value=>createHash('sha256').update(value).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest('hex');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
function cookiePairs(header){if(typeof header!=='string'||!header||header.length>8192)return null;const pairs=new Map();for(const part of header.split(';')){const pair=/^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=([^\x00-\x20\x7f;,]*)$/.exec(part.trim());if(!pair||pairs.has(pair[1]))return null;pairs.set(pair[1],pair[2]);}return pairs}

/** Actual BetterAuth cookie/session verification plus a dedicated READ ONLY
 * session/account join. No email/user_metadata/browser UUID can create proof. */
export function createVerifiedProviderIdentityReader({authService,database,accountSecret,identityRealm,clock=Date.now}={}){
 const service=getConfiguredCustomerAuthBinding(authService),db=getConfiguredCoreAuthPoolBinding(database);
 if(!service||service.mode!=='https'||!db||db.projectRef!==service.projectRef||db.environment!==service.environment||identityRealm!==service.legacyIdentityRealm||!Buffer.isBuffer(accountSecret)||accountSecret.length!==32||typeof clock!=='function')bad('PROVIDER_IDENTITY_CONFIGURATION_INVALID');
 const key=Buffer.from(accountSecret);
 return async header=>{
  const pairs=cookiePairs(header);if(!pairs)return null;let current,cookieName;
  try{cookieName=(await authService.auth.$context)?.authCookies?.sessionToken?.name;if(typeof cookieName!=='string'||!pairs.has(cookieName))return null;current=await authService.auth.api.getSession({headers:new Headers({cookie:header})});}catch{bad('PROVIDER_IDENTITY_VERIFICATION_UNAVAILABLE')}
  const session=current?.session,user=current?.user,now=clock(),expiry=new Date(session?.expiresAt).getTime();
  if(!plain(session)||!plain(user)||!UUID.test(user.id??'')||session.userId!==user.id||!['google','kakao'].includes(session.coreProviderId)||typeof session.id!=='string'||session.id.length<1||session.id.length>256||/[\x00-\x20\x7f]/.test(session.id)||!Number.isFinite(now)||!Number.isFinite(expiry)||expiry<=now)return null;
  let client,started=false;
  try{client=await database.connect();await client.query('begin isolation level repeatable read read only');started=true;
   const role=(await client.query('select current_user as role,current_schema() as schema')).rows;if(role.length!==1||role[0].role!=='core_customer_auth_runtime'||role[0].schema!=='core_customer_auth')bad('PROVIDER_IDENTITY_VERIFICATION_UNAVAILABLE');
   const rows=(await client.query('select a.id as "accountRowId",a."accountId" as subject from core_customer_auth."account" a join core_customer_auth."session" s on s."userId"=a."userId" where a."userId"=$1 and a."providerId"=$2 and s.id=$3 and s."coreProviderId"=a."providerId" and s."expiresAt">clock_timestamp() limit 2',[user.id,session.coreProviderId,session.id])).rows;
   if(rows.length!==1||typeof rows[0].subject!=='string'||rows[0].subject.length<1||rows[0].subject.length>512||/[\x00-\x20\x7f]/.test(rows[0].subject))bad('PROVIDER_IDENTITY_VERIFICATION_UNAVAILABLE');
   await client.query('commit');started=false;const proof=Object.freeze({});
   identities.set(proof,{userId:user.id,provider:session.coreProviderId,subjectHash:providerSubjectHash(key,identityRealm,session.coreProviderId,rows[0].subject),sessionId:session.id,expiresAt:expiry,cookieName,cookieSha256:sha(header),authenticatedEmail:typeof user.email==='string'&&user.email.length<=254&&user.email===user.email.trim()&&!/[\x00-\x20\x7f]/.test(user.email)?user.email.toLowerCase():null,emailVerified:user.emailVerified===true,providerAccountId:typeof rows[0].accountRowId==='string'&&UUID.test(rows[0].accountRowId)?rows[0].accountRowId:null});return proof;
  }catch{if(started)try{await client.query('rollback')}catch{}bad('PROVIDER_IDENTITY_VERIFICATION_UNAVAILABLE')}
  finally{client?.release()}
 };
}
export function readVerifiedProviderIdentity(proof){const record=identities.get(proof);if(!record)bad('VERIFIED_PROVIDER_IDENTITY_REQUIRED');return structuredClone(record)}

export function createSignupClassifier({inventory,stableKeys,clock=Date.now}={}){
 const {payload:p,digest}=readVerifiedLegacyInventory(inventory),key=stableKeys?.accountSecret;
 if(!Buffer.isBuffer(key)||key.length!==32||p.keyHashes.accountSecret!==sha(key)||p.keyHashes.allowanceSecret!==sha(stableKeys.allowanceSecret)||p.keyHashes.tenantKey!==sha(Buffer.from(stableKeys.tenantKey))||typeof clock!=='function')bad('SIGNUP_CLASSIFIER_CONFIGURATION_INVALID');
 const subjects=new Map(Object.entries(p.accounts).map(([id,account])=>[account.subjectHash,{id,account}]));
 return proof=>{
  const identity=identities.get(proof);if(!identity||identity.expiresAt<=clock())bad('VERIFIED_PROVIDER_IDENTITY_REQUIRED');
  const found=subjects.get(identity.subjectHash);let record;
  if(found){if(found.account.userId!==identity.userId||found.account.provider!==identity.provider)bad('ACCOUNT_IDENTITY_REBIND_REQUIRES_RECONCILIATION');record={kind:'LEGACY',principalId:found.id,workspaceEmail:found.account.workspaceEmail,inventoryDigest:digest,userId:identity.userId,provider:identity.provider,subjectHash:identity.subjectHash,allowanceStatus:found.account.allowance.status};}
  else{const account=hmac(key,p.identityRealm+'|'+identity.userId),workspaceEmail='account_'+account+'@accounts.thefa.invalid';
   if(Object.hasOwn(p.accounts,account)||Object.values(p.claims).includes(account))bad('LEGACY_PROVIDER_SUBJECT_REQUIRES_RECONCILIATION');
   if(Object.hasOwn(p.sourceTenantRows,allowanceWorkspaceForAccount(account,stableKeys.allowanceSecret))||Object.hasOwn(p.sourceTenantRows,tenantWorkspaceForEmail(workspaceEmail,stableKeys.tenantKey)))bad('UNCLASSIFIED_SOURCE_RECORD_REQUIRES_RECONCILIATION');
   record={kind:'NEW_REQUIRES_ATOMIC_REGISTRATION',principalId:account,workspaceEmail,inventoryDigest:digest,userId:identity.userId,provider:identity.provider,subjectHash:identity.subjectHash};
  }
  const classification=Object.freeze({});classifications.set(classification,record);return classification;
 };
}
export function readSignupClassification(classification){const record=classifications.get(classification);if(!record)bad('VERIFIED_SIGNUP_CLASSIFICATION_REQUIRED');return structuredClone(record)}

export function assertLegacyRegistryPreserved(registry,inventory){
 const {payload:p}=readVerifiedLegacyInventory(inventory);if(!plain(registry)||!plain(registry.accounts)||!plain(registry.claims))bad('ACCOUNT_REGISTRY_IMPORT_REQUIRED');
 for(const[id,old]of Object.entries(p.accounts))if(registry.accounts[id]?.workspaceEmail!==old.workspaceEmail)bad('LEGACY_REGISTRY_NOT_PRESERVED');
 for(const[claim,id]of Object.entries(p.claims))if(registry.claims[claim]!==id)bad('LEGACY_REGISTRY_NOT_PRESERVED');
}
export function createSignupAccountAdmission({inventory,persistence,accountSecret,clock=Date.now}={}){
 const {payload:p,digest}=readVerifiedLegacyInventory(inventory),registryId='tenant_'+sha('THEFA_CUSTOMER_ACCOUNT_REGISTRY_V1');
 if(typeof persistence?.registry!=='function'||!Buffer.isBuffer(accountSecret)||accountSecret.length!==32||p.keyHashes.accountSecret!==sha(accountSecret)||typeof clock!=='function')bad('SIGNUP_ADMISSION_CONFIGURATION_INVALID');
 return async classification=>{
  const record=classifications.get(classification);if(!record||record.inventoryDigest!==digest||record.kind!=='NEW_REQUIRES_ATOMIC_REGISTRATION')bad('VERIFIED_NEW_CLASSIFICATION_REQUIRED');
  const store=persistence.registry(registryId);let result;
  try{await store.init();result=await store.mutate(state=>{
   const r=state.customerAccounts;assertLegacyRegistryPreserved(r,inventory);if(!plain(r.oauthSubjects??{}))bad('ACCOUNT_REGISTRY_PROVENANCE_INVALID');r.oauthSubjects??={};
   const bound=r.oauthSubjects[record.subjectHash];if(bound&&bound!==record.principalId)bad('ACCOUNT_IDENTITY_REBIND_REQUIRES_RECONCILIATION');
   const existing=r.accounts[record.principalId],admission={contract:'THEFA_NEW_CUSTOMER_ADMISSION_V1',inventoryDigest:digest,providerSubjectHash:record.subjectHash,provider:record.provider,userId:record.userId};
   if(existing){if(existing.workspaceEmail!==record.workspaceEmail||!plain(existing.signupAdmission)||Object.entries(admission).some(([k,v])=>existing.signupAdmission[k]!==v)||bound!==record.principalId)bad('ACCOUNT_REGISTRY_PROVENANCE_INVALID');}
   else{const claim=hmac(accountSecret,record.workspaceEmail);if(r.claims[claim]&&r.claims[claim]!==record.principalId)bad('ACCOUNT_CLAIM_CONFLICT');r.accounts[record.principalId]={workspaceEmail:record.workspaceEmail,signupAdmission:{...admission,createdAt:new Date(clock()).toISOString()}};r.claims[claim]=record.principalId;r.oauthSubjects[record.subjectHash]=record.principalId;}
   return {principalId:record.principalId,workspaceEmail:record.workspaceEmail,provider:record.provider,accountProvenance:'NEW_ACCOUNT_CONFIRMED'};
  });}finally{await store.close()}
  return Object.freeze(result);
 };
}
