import path from 'node:path';
import {createHash,createHmac,createDecipheriv} from 'node:crypto';
import {readVerifiedLegacyBinding,readLegacyRegistrySnapshot} from './customer-migration-receipts.mjs';
import {isReadOnlyCustomerAccountRegistry,readCustomerAccountRegistrySnapshot} from './customer-account-persistence.mjs';

const HASH=/^[a-f0-9]{64}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const resolved=new WeakMap(),renewalChecks=new WeakMap();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const invalid=()=>{throw Object.assign(new Error('CUSTOMER_SESSION_CONFIGURATION_INVALID'),{code:'CUSTOMER_SESSION_CONFIGURATION_INVALID'})};
const unavailable=()=>Object.assign(new Error('CUSTOMER_SESSION_VERIFICATION_UNAVAILABLE'),{code:'CUSTOMER_SESSION_VERIFICATION_UNAVAILABLE'});
function cookies(text){
 if(typeof text!=='string'||!text||text.length>8192)return null;
 const pairs=new Map();for(const part of text.split(';')){
  const pair=/^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=([^\x00-\x20\x7f;,]*)$/.exec(part.trim());
  if(!pair||pairs.has(pair[1]))return null;pairs.set(pair[1],pair[2]);
 }return pairs;
}

/** Read the existing R13 opaque account registry. Never initializes/mutates a store,
 * issues cookies, refreshes leases or creates/classifies a new account.
 * The existing start->finish->session lifecycle must already have created this binding.
 */
export function createReadOnlyLegacyAccountResolver({directory,registryReader,backendUrl,accountSecret,readTrustedReceipt,clock=Date.now}={}){
 const local=typeof directory==='string'&&path.isAbsolute(directory)&&registryReader===undefined;
 const hosted=directory===undefined&&isReadOnlyCustomerAccountRegistry(registryReader);
 if((!local&&!hosted)||typeof backendUrl!=='string'||!/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/core-customer-auth$/.test(backendUrl)||
  !Buffer.isBuffer(accountSecret)||accountSecret.length!==32||typeof readTrustedReceipt!=='function'||typeof clock!=='function')invalid();
 const secret=Buffer.from(accountSecret),opaque=value=>createHmac('sha256',secret).update(value).digest('hex');
 const encryptionKey=createHash('sha256').update(secret).update('ACCOUNT_SESSION_ENCRYPTION_V1').digest();
 const inspect=async ({userId,provider,cookieHeader,sessionCookieName}={},renewalOnly=false)=>{
  try{
   const pairs=cookies(cookieHeader),token=pairs?.get('thefa_customer_auth_v1');
   if(!UUID.test(userId??'')||!['google','kakao'].includes(provider)||!/^[A-Za-z0-9_-]{43}$/.test(token??'')||typeof sessionCookieName!=='string'||!pairs.has(sessionCookieName))return null;
   const now=clock();if(!Number.isFinite(now))return null;
   const accountId=opaque(backendUrl+'|'+userId),binding=await readVerifiedLegacyBinding(readTrustedReceipt,accountId);
   if(!binding||binding.userId!==userId||binding.provider!==provider||binding.backendUrl!==backendUrl||binding.keyHashes.accountSecret!==sha(secret))return null;
   const snapshot=local?await readLegacyRegistrySnapshot(directory):await readCustomerAccountRegistrySnapshot(registryReader);
   const registry=snapshot.state.customerAccounts,account=registry.accounts[accountId],record=registry.sessions[opaque('SESSION:'+token)];
   if(!plain(registry.claims)||binding.claimKeys.some(key=>registry.claims[key]!==accountId)||
    (/^guest_[a-f0-9]{48}@temporary\.thefa\.invalid$/.test(binding.workspaceEmail)&&(!binding.claimKeys.includes(opaque(binding.workspaceEmail))||registry.claims[opaque(binding.workspaceEmail)]!==accountId)))return null;
   if(!plain(account)||account.workspaceEmail!==binding.workspaceEmail||!plain(record)||!Number.isFinite(record.expiresAt)||record.expiresAt<=now||typeof record.payload!=='string'||record.payload.length>30000||!/^[A-Za-z0-9_-]+$/.test(record.payload))return null;
   const raw=Buffer.from(record.payload,'base64url');if(raw.length<29||raw.toString('base64url')!==record.payload)return null;
   const decipher=createDecipheriv('aes-256-gcm',encryptionKey,raw.subarray(0,12));decipher.setAuthTag(raw.subarray(12,28));
   const entry=JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8'));
   if(!plain(entry)||entry.account!==accountId||entry.userId!==userId||entry.provider!==provider||entry.workspaceEmail!==binding.workspaceEmail||
    !Number.isFinite(entry.accessExpiresAt)||entry.access!==sessionCookieName+'='+pairs.get(sessionCookieName))return null;
   // This private eligibility check never returns an authorization proof. Every
   // other current identity, signed mapping and exact cookie-pair check above is
   // still mandatory before the existing lifecycle may renew its short lease.
   if(renewalOnly)return entry.accessExpiresAt<=now;
   if(entry.accessExpiresAt<=now)return null;
   const result=Object.freeze({principalId:accountId,workspaceEmail:binding.workspaceEmail,provider,sessionVerified:true,accountProvenance:'LEGACY_R9_EXACTLY_RECONCILED'});
   resolved.set(result,{userId,provider,cookieHeader,sessionCookieName});return result;
  }catch{return null}
 };
 const resolveAccount=context=>inspect(context,false);
 renewalChecks.set(resolveAccount,context=>inspect(context,true));
 return resolveAccount;
}

/** Verify BetterAuth first, then require independently resolved legacy registry proof.
 * UI session projection and request-supplied identity fields cannot authorize this path.
 */
export function createCustomerSessionVerifier({authService,resolveAccount,renewAccountSession,clock=Date.now}={}){
 if(typeof authService?.auth?.api?.getSession!=='function'||!authService.auth.$context||typeof resolveAccount!=='function'||typeof clock!=='function'||
   (renewAccountSession!==undefined&&(typeof renewAccountSession!=='function'||!renewalChecks.has(resolveAccount))))invalid();
 const verify=async (cookieHeader,canRenew)=>{
  const pairs=cookies(cookieHeader);if(!pairs)return null;
  let value,name,now;
  try{
   name=(await authService.auth.$context)?.authCookies?.sessionToken?.name;
   if(typeof name!=='string'||!pairs.has(name))return null;
   value=await authService.auth.api.getSession({headers:new Headers({cookie:cookieHeader})});now=clock();
  }catch{throw unavailable()}
  const session=value?.session,user=value?.user;
  const expires=session?.expiresAt instanceof Date?session.expiresAt.getTime():typeof session?.expiresAt==='string'?Date.parse(session.expiresAt):NaN;
  if(!plain(session)||!plain(user)||typeof session.id!=='string'||session.id.length<1||session.id.length>256||/[\x00-\x20\x7f]/.test(session.id)||
   !UUID.test(user.id??'')||session.userId!==user.id||!['google','kakao'].includes(session.coreProviderId)||!Number.isFinite(now)||!Number.isFinite(expires)||expires<=now)return null;
  const context={userId:user.id,provider:session.coreProviderId,cookieHeader,sessionCookieName:name};
  let result;try{result=await resolveAccount(context)}catch{throw unavailable()}
  if(!result&&canRenew&&renewAccountSession&&await renewalChecks.get(resolveAccount)(context)){
   try{await renewAccountSession(cookieHeader)}catch(error){if(error?.code==='ACCOUNT_REFRESH_BUSY')throw unavailable();if(error?.status===401)return null;throw unavailable()}
   // Ignore callback output. Re-read the current engine session and full registry
   // proof once after maintenance. Never recursively renew or execute/retry an API.
   return verify(cookieHeader,false);
  }
  const proof=resolved.get(result);
  if(!proof||proof.userId!==user.id||proof.provider!==session.coreProviderId||proof.cookieHeader!==cookieHeader||proof.sessionCookieName!==name||!HASH.test(result.principalId))return null;
  return result;
 };
 return cookieHeader=>verify(cookieHeader,true);
}
