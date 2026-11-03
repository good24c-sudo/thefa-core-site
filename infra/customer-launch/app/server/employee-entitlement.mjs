import {getConfiguredCustomerAuthBinding} from './inherited/server/auth/service.mjs';
import {readVerifiedProviderIdentity,readSignupClassification} from './signup-classifier.mjs';
import {providerSubjectHash} from './migration-inventory.mjs';
import {readFreshLaunchProof} from './fresh-launch-accounts.mjs';

// Opaque, short-lived capabilities. Browser fields, copied JSON and internal
// workspace aliases cannot manufacture employee authorization.
const capabilities=new WeakMap();
const HASH=/^[a-f0-9]{64}$/;
const fail=code=>Object.assign(new Error(code),{code,status:503});
const mailbox=value=>typeof value==='string'&&value.length<=254&&value===value.trim()&&
 /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/.test(value)?value.toLowerCase():null;
const company=email=>email!==null&&email.split('@')[1]==='thefa.kr';
export function isEmployeeEntitlement(proof,principalId){
 if(proof===null||proof===undefined)return false;
 const record=capabilities.get(proof),now=record?.clock();
 if(!record||!HASH.test(principalId??'')||record.principalId!==principalId||
   !Number.isFinite(now)||now>=record.expiresAt)
  throw fail('EMPLOYEE_ENTITLEMENT_INVALID');
 return true;
}
export function employeeAllowanceView(proof,principalId){
 if(!isEmployeeEntitlement(proof,principalId))throw fail('EMPLOYEE_ENTITLEMENT_REQUIRED');
 return Object.freeze({unlimited:true,usagePolicy:'EMPLOYEE_UNLIMITED',freeLimit:null,
  used:null,pending:0,remaining:null,planRequired:false});
}
async function boundedProfile(response){
 if(!(response instanceof Response)||response.status!==200||
  !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw Error();
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>16384))throw Error();
 if(!response.body)throw Error();
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>16384){await reader.cancel();throw Error();}chunks.push(Buffer.from(value));}}
 finally{reader.releaseLock();}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}

/** Uses the existing authenticated BetterAuth session and exact provider-account
 * row. No employee roster, mutable profile role, new authentication engine or
 * database column is introduced. Google Workspace ownership is rechecked for
 * each privileged request; non-company customers never fetch a provider token.
 */
export function createGoogleEmployeeEntitlementResolver({authService,readProviderIdentity,
 classify,accountSecret,identityRealm,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 const binding=getConfiguredCustomerAuthBinding(authService);
 if(!binding||binding.mode!=='https'||binding.legacyIdentityRealm!==identityRealm||
  typeof readProviderIdentity!=='function'||typeof classify!=='function'||
  typeof authService.auth?.api?.getAccessToken!=='function'||
  !Buffer.isBuffer(accountSecret)||accountSecret.length!==32||
  typeof fetchImpl!=='function'||typeof clock!=='function')throw fail('EMPLOYEE_RESOLVER_CONFIGURATION_INVALID');
 const key=Buffer.from(accountSecret);
 return async(cookie,principal)=>{
  try{
   if(typeof cookie!=='string'||principal?.sessionVerified!==true||!HASH.test(principal.principalId??''))throw Error();
   const opaque=await readProviderIdentity(cookie);if(!opaque)throw Error();
   const identity=readVerifiedProviderIdentity(opaque),classified=readSignupClassification(classify(opaque));
   if(classified.principalId!==principal.principalId||classified.workspaceEmail!==principal.workspaceEmail||identity.expiresAt<=clock())throw Error();
   const email=mailbox(identity.authenticatedEmail);
   if(identity.provider!=='google'||identity.emailVerified!==true||!company(email))return null;
   if(typeof identity.providerAccountId!=='string'||!identity.providerAccountId||identity.providerAccountId.length>256)throw Error();
   // Pinned BetterAuth 1.7.13 selects a real database account by internal row ID.
   // The original Google subject is separately checked against the signed identity.
   const token=await authService.auth.api.getAccessToken({headers:new Headers({cookie}),body:{accountId:identity.providerAccountId}});
   if(typeof token?.accessToken!=='string'||!token.accessToken||token.accessToken.length>8192||/[^\x21-\x7e]/.test(token.accessToken))throw Error();
   const expiry=token.accessTokenExpiresAt==null?Infinity:new Date(token.accessTokenExpiresAt).getTime();
   if((expiry!==Infinity&&!Number.isFinite(expiry))||expiry<=clock())throw Error();
   const profile=await boundedProfile(await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo',{
    method:'GET',headers:{authorization:'Bearer '+token.accessToken,accept:'application/json'},
    redirect:'error',signal:AbortSignal.timeout(5000)}));
   if(typeof profile?.sub!=='string'||!profile.sub||profile.sub.length>512||/[\x00-\x20\x7f]/.test(profile.sub)||
    profile.email_verified!==true||mailbox(profile.email)!==email||profile.hd!=='thefa.kr'||
    providerSubjectHash(key,identityRealm,'google',profile.sub)!==identity.subjectHash)return null;
   const now=clock(),expiresAt=Math.min(identity.expiresAt,expiry,now+10000);
   if(!Number.isFinite(now)||expiresAt<=now)throw Error();
   const proof=Object.freeze({});capabilities.set(proof,{principalId:principal.principalId,expiresAt,clock});return proof;
  }catch{
   // Never attach provider error, headers, token or profile to error/log output.
   throw fail('EMPLOYEE_VERIFICATION_UNAVAILABLE');
  }
 };
}

/** Fresh-launch privileges accept only this process's branded current account proof.
 * Email sign-in is issued only by the pinned OTP plugin after mailbox verification;
 * it has a bounded 12-hour non-refreshing session and remains revocable server-side. */
export function createLaunchEmployeeEntitlementResolver({authService,launchAccounts,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 const binding=getConfiguredCustomerAuthBinding(authService);
 if(!binding||binding.mode!=='https'||typeof launchAccounts?.proof!=='function'||typeof fetchImpl!=='function'||typeof clock!=='function')throw fail('EMPLOYEE_RESOLVER_CONFIGURATION_INVALID');
 return async(cookie,principal)=>{
  try{
   const opaque=await launchAccounts.proof(cookie);if(!opaque)throw Error();
   const {identity:i,principal:p}=readFreshLaunchProof(opaque);
   if(principal?.sessionVerified!==true||p.principalId!==principal.principalId||p.workspaceEmail!==principal.workspaceEmail)throw Error();
   if(i.emailVerified!==true||!company(mailbox(i.email)))return null;
   let tokenExpiry=Infinity;
   if(i.provider==='google'){
    const ctx=await authService.auth.$context,rows=await ctx.internalAdapter.findAccounts(i.userId),google=rows.filter(a=>a.providerId==='google'&&a.userId===i.userId);
    if(google.length!==1)throw Error();const account=google[0];
    const token=await authService.auth.api.getAccessToken({headers:new Headers({cookie}),body:{accountId:account.id}});
    if(typeof token?.accessToken!=='string'||!token.accessToken||token.accessToken.length>8192||/[^\x21-\x7e]/.test(token.accessToken))throw Error();
    tokenExpiry=token.accessTokenExpiresAt==null?Infinity:new Date(token.accessTokenExpiresAt).getTime();
    if(tokenExpiry!==Infinity&&!Number.isFinite(tokenExpiry)||tokenExpiry<=clock())throw Error();
    const profile=await boundedProfile(await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:'Bearer '+token.accessToken,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)}));
    if(profile?.sub!==account.accountId||profile.email_verified!==true||mailbox(profile.email)!==i.email||profile.hd!=='thefa.kr')return null;
   }else if(i.provider!=='email')return null;
   const now=clock(),expiresAt=Math.min(i.expiresAt,tokenExpiry,now+10000);if(!Number.isFinite(now)||expiresAt<=now)throw Error();
   const proof=Object.freeze({});capabilities.set(proof,{principalId:p.principalId,expiresAt,clock});return proof;
  }catch{throw fail('EMPLOYEE_VERIFICATION_UNAVAILABLE');}
 };
}
