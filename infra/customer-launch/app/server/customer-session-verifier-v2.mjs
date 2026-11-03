import {createHash,createHmac,createDecipheriv} from 'node:crypto';
import {readCustomerAccountRegistrySnapshot,isReadOnlyCustomerAccountRegistry} from './inherited/customer-account-persistence.mjs';
import {readVerifiedLegacyInventory} from './migration-inventory.mjs';
import {readSignupClassification,readVerifiedProviderIdentity,assertLegacyRegistryPreserved} from './signup-classifier.mjs';
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const sha=x=>createHash('sha256').update(x).digest('hex');
const unavailable=()=>{throw Object.assign(new Error('CUSTOMER_SESSION_VERIFICATION_UNAVAILABLE'),{code:'CUSTOMER_SESSION_VERIFICATION_UNAVAILABLE'})};
function pairs(header){if(typeof header!=='string'||!header||header.length>8192)return null;const out=new Map();for(const part of header.split(';')){const p=/^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=([^\x00-\x20\x7f;,]*)$/.exec(part.trim());if(!p||out.has(p[1]))return null;out.set(p[1],p[2]);}return out}

/** Legacy first. New customers require a fresh actual provider/session proof and
 * exact encrypted registry cookie pair plus the atomic admission record. */
export function createUnifiedCustomerSessionVerifier({legacyVerifier,registryReader,accountSecret,inventory,readProviderIdentity,classify,renewAccountSession,clock=Date.now}={}){
 const {payload,digest}=readVerifiedLegacyInventory(inventory);
 if(typeof legacyVerifier!=='function'||!isReadOnlyCustomerAccountRegistry(registryReader)||!Buffer.isBuffer(accountSecret)||accountSecret.length!==32||payload.keyHashes.accountSecret!==sha(accountSecret)||typeof readProviderIdentity!=='function'||typeof classify!=='function'||typeof renewAccountSession!=='function'||typeof clock!=='function')throw new Error('CUSTOMER_SESSION_CONFIGURATION_INVALID');
 const key=Buffer.from(accountSecret),opaque=x=>createHmac('sha256',key).update(x).digest('hex'),encryptionKey=createHash('sha256').update(key).update('ACCOUNT_SESSION_ENCRYPTION_V1').digest();
 const verify=async(header,canRenew)=>{
  const parsed=pairs(header),token=parsed?.get('thefa_customer_auth_v1');if(!parsed||!/^[A-Za-z0-9_-]{43}$/.test(token??''))return null;
  let legacy;try{legacy=await legacyVerifier(header)}catch{unavailable()}if(legacy)return legacy;
  let proof,identity,classified,snapshot;
  try{proof=await readProviderIdentity(header);if(!proof)return null;identity=readVerifiedProviderIdentity(proof);classified=readSignupClassification(classify(proof));snapshot=await readCustomerAccountRegistrySnapshot(registryReader);assertLegacyRegistryPreserved(snapshot.state.customerAccounts,inventory)}catch{unavailable()}
  if(classified.kind!=='NEW_REQUIRES_ATOMIC_REGISTRATION'||identity.cookieSha256!==sha(header)||!parsed.has(identity.cookieName)||identity.expiresAt<=clock())return null;
  const registry=snapshot.state.customerAccounts,account=registry.accounts[classified.principalId],session=registry.sessions?.[opaque('SESSION:'+token)],admission=account?.signupAdmission;
  if(!plain(admission)||account.workspaceEmail!==classified.workspaceEmail||admission.contract!=='THEFA_NEW_CUSTOMER_ADMISSION_V1'||admission.inventoryDigest!==digest||admission.providerSubjectHash!==identity.subjectHash||admission.provider!==identity.provider||admission.userId!==identity.userId||registry.oauthSubjects?.[identity.subjectHash]!==classified.principalId||registry.claims[opaque(classified.workspaceEmail)]!==classified.principalId||!plain(session)||!Number.isFinite(session.expiresAt)||session.expiresAt<=clock()||typeof session.payload!=='string'||session.payload.length>30000||!/^[A-Za-z0-9_-]+$/.test(session.payload))return null;
  let entry;
  try{const raw=Buffer.from(session.payload,'base64url');if(raw.length<29||raw.toString('base64url')!==session.payload)return null;const decipher=createDecipheriv('aes-256-gcm',encryptionKey,raw.subarray(0,12));decipher.setAuthTag(raw.subarray(12,28));entry=JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8'))}catch{return null}
  if(!plain(entry)||entry.account!==classified.principalId||entry.userId!==identity.userId||entry.provider!==identity.provider||entry.workspaceEmail!==classified.workspaceEmail||entry.accountProvenance!=='NEW_ACCOUNT_CONFIRMED'||entry.providerSubjectHash!==identity.subjectHash||entry.inventoryDigest!==digest||entry.access!==identity.cookieName+'='+parsed.get(identity.cookieName)||!Number.isFinite(entry.accessExpiresAt))return null;
  if(entry.accessExpiresAt<=clock()){
   if(!canRenew)return null;
   try{await renewAccountSession(header)}catch(error){if(error?.status===401)return null;unavailable()}
   return verify(header,false);
  }
  return Object.freeze({principalId:classified.principalId,workspaceEmail:classified.workspaceEmail,provider:identity.provider,sessionVerified:true,accountProvenance:'NEW_ACCOUNT_CONFIRMED'});
 };
 return header=>verify(header,true);
}
