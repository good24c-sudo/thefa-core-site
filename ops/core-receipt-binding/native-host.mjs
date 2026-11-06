/** Server-owned one-shot NativeHost admission. No listener, token capture or authority fabrication. */
import { createHash, createPublicKey, KeyObject, randomBytes, randomUUID, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalJson } from './vendor/edge/thefa-founder-live-ingress-v1/contract.mjs';
import { verifyNativeHostReceiptSignature, PROOF_SCHEMA, HOST_ISSUER, DOMAIN } from './vendor/native_host_ed25519_receipt_signature_candidate_v1.mjs';

const execFileDefault=promisify(nodeExecFile);
const HASH=/^sha256:[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KID=/^[A-Za-z0-9][A-Za-z0-9_.-]{2,95}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw new Error(code);};
const string=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
const date=value=>typeof value==='string'?Date.parse(value):NaN;
function windowCurrent(row,now,max=300000){
  const a=date(row?.notBefore),b=date(row?.expiresAt);
  return row?.revokedAt===null&&Number.isFinite(a)&&Number.isFinite(b)&&a<=now&&now<b&&b>a&&b-a<=max;
}
function publicFingerprint(key){return 'sha256:'+sha(key.export({type:'spki',format:'der'}));}

/** The CLI is hash pinned and invokes GitHub's credential-validating /user endpoint each time.
 * No token is read from gh, and stdout/stderr are never included in errors or evidence.
 * execFile is a trusted process dependency supplied at construction only (test fixtures use it).
 */
export function createGitHubCliIdentityVerifier({ghExecutable,executableSha256,expectedSubject,expectedLogin,execFile=execFileDefault}={}){
  if(!isAbsolute(ghExecutable??'')||!/^[a-f0-9]{64}$/.test(executableSha256??'')||!/^\d+$/.test(expectedSubject??'')||!string(expectedLogin,100)||typeof execFile!=='function')fail('PINNED_GITHUB_CLI_CONFIG_REQUIRED');
  return async function verifyGitHubCredential(){
    let actual;try{actual=sha(await readFile(ghExecutable));}catch{fail('PINNED_GITHUB_CLI_UNAVAILABLE');}
    if(actual!==executableSha256)fail('PINNED_GITHUB_CLI_CHANGED');
    let response;try{response=await execFile(ghExecutable,['api','--hostname','github.com','user','--method','GET'],{shell:false,windowsHide:true,timeout:15000,maxBuffer:262144,encoding:'utf8'});}catch{fail('GITHUB_CREDENTIAL_AUTHENTICATION_FAILED');}
    let user;try{user=JSON.parse(response.stdout);}catch{fail('GITHUB_IDENTITY_RESPONSE_INVALID');}
    if(!Number.isSafeInteger(user.id)||user.id<=0||String(user.id)!==expectedSubject||user.login!==expectedLogin||user.type!=='User')fail('GITHUB_PRINCIPAL_MISMATCH');
    return Object.freeze({provider:'github',subject:String(user.id),login:user.login,verification:'GITHUB_API_CREDENTIAL_VALIDATED'});
  };
}

/** All constructor inputs are trusted host configuration, never request fields.
 * readContext must return current server-owned DB records, including the native
 * approval source that the operator explicitly enrolled. An AI JSON flag is not
 * an implementation of verifyIdentity/readContext.
 */
export function createNativeHost({binding,privateKey,publicKey,keyId,verifyApproval,verifyIdentity,readContext,consumeChallenge,now=()=>new Date()}={}){
  if(!(privateKey instanceof KeyObject)||privateKey.type!=='private'||privateKey.asymmetricKeyType!=='ed25519'||!(publicKey instanceof KeyObject)||publicKey.type!=='public'||publicKey.asymmetricKeyType!=='ed25519')fail('ED25519_HOST_KEY_OBJECTS_REQUIRED');
  const fingerprint=publicFingerprint(publicKey);
  if(publicFingerprint(createPublicKey(privateKey))!==fingerprint)fail('HOST_PRIVATE_PUBLIC_KEY_MISMATCH');
  if(!KID.test(keyId??'')||typeof verifyApproval!=='function'||typeof verifyIdentity!=='function'||typeof readContext!=='function'||typeof now!=='function')fail('SERVER_OWNED_AUTH_CONTEXT_REQUIRED');
  if(!string(binding?.scope,500)||!HASH.test(binding?.payloadHash??'')||!string(binding?.sourceRef,600)||!string(binding?.approvalRef,600)||!HASH.test(binding?.approvalHash??'')||!['INITIAL_AUTHENTICATION_CHALLENGE','NORMAL_WRITE'].includes(binding?.operationKind))fail('EXACT_SERVER_BINDING_REQUIRED');
  const expected=Object.freeze({...binding});

  async function authenticate(){
    const clock=now();if(!(clock instanceof Date)||!Number.isFinite(clock.getTime()))fail('TRUSTED_NATIVE_TIME_REQUIRED');
    let approval;try{approval=await verifyApproval();}catch{fail('NATIVE_APPROVAL_SOURCE_NOT_VERIFIED');}
    if(approval?.sourceKind!=='CODEX_NATIVE_USER_MESSAGE'||approval?.approvalRef!==expected.approvalRef||approval?.approvalHash!==expected.approvalHash||approval?.recordsMatched!==1)fail('NATIVE_APPROVAL_SOURCE_BINDING_MISMATCH');
    let identity;try{identity=await verifyIdentity();}catch{fail('CREDENTIAL_AUTHENTICATION_FAILED');}
    if(identity?.provider!=='github'||identity?.verification!=='GITHUB_API_CREDENTIAL_VALIDATED'||!/^\d+$/.test(identity?.subject??'')||!string(identity?.login,100))fail('CREDENTIAL_IDENTITY_REQUIRED');
    let c;try{c=await readContext({provider:identity.provider,subject:identity.subject,keyId,scope:expected.scope,sourceRef:expected.sourceRef,payloadHash:expected.payloadHash,operationKind:expected.operationKind,approvalRef:expected.approvalRef,approvalHash:expected.approvalHash});}catch{fail('TRUSTED_CONTEXT_LOOKUP_FAILED');}
    const t=clock.getTime(),dbt=date(c?.databaseTime);
    if(!Number.isFinite(dbt)||Math.abs(dbt-t)>10000)fail('TRUSTED_CONTEXT_TIME_INVALID');
    if(c?.person?.status!=='ACTIVE'||!UUID.test(c?.person?.id??''))fail('ACTIVE_ENROLLED_PERSON_REQUIRED');
    if(c.person.provider!==identity.provider||c.person.subject!==identity.subject||c.person.login!==identity.login)fail('IDENTITY_PERSON_MISMATCH');
    const session=c.session;
    if(!UUID.test(session?.id??'')||session?.kind!=='NATIVE_HOST_SESSION'||session?.authMethod!=='GITHUB_API_CURRENT_USER'||session?.provider!==identity.provider||session?.subject!==identity.subject)fail('NATIVE_SESSION_PRINCIPAL_MISMATCH');
    if(!windowCurrent(session,t))fail('NATIVE_SESSION_NOT_CURRENT');
    const grant=c.grant;
    if(!UUID.test(grant?.id??'')||grant?.kind!=='REPRESENTATIVE_WRITER')fail('REPRESENTATIVE_WRITER_GRANT_REQUIRED');
    if(grant.personId!==c.person.id||grant.sessionId!==session.id)fail('GRANT_PERSON_OR_SESSION_MISMATCH');
    if(grant.scope!==expected.scope||grant.sourceRef!==expected.sourceRef||grant.payloadHash!==expected.payloadHash||grant.operationKind!==expected.operationKind)fail('GRANT_EXACT_BINDING_MISMATCH');
    if(grant.approvalRef!==expected.approvalRef||grant.approvalHash!==expected.approvalHash)fail('SOURCE_APPROVAL_BINDING_REQUIRED');
    if(!windowCurrent(grant,t))fail('WRITER_GRANT_NOT_CURRENT');
    const key=c.key;
    if(key?.id!==keyId||key?.fingerprint!==fingerprint||key?.personId!==c.person.id||key?.grantId!==grant.id||!/^actor_sha256:[a-f0-9]{64}$/.test(key?.actorRef??''))fail('HOST_KEY_BINDING_MISMATCH');
    if(!windowCurrent(key,t))fail('HOST_KEY_NOT_CURRENT');
    return {clock,identity,context:c};
  }

  async function prepareReceipt(){
    const {clock,context:c}=await authenticate();
    const expiry=Math.min(clock.getTime()+120000,date(c.session.expiresAt),date(c.grant.expiresAt),date(c.key.expiresAt));
    if(expiry-clock.getTime()<1000)fail('AUTHORIZATION_WINDOW_TOO_SHORT');
    const receipt={representative_person_id:c.person.id,scope:expected.scope,payload_hash:expected.payloadHash,source_ref:expected.sourceRef,receipt_id:randomUUID(),nonce:randomBytes(32).toString('hex'),issued_at:clock.toISOString(),expires_at:new Date(expiry).toISOString()};
    receipt.receipt_hash='sha256:'+sha(canonicalJson(receipt));
    const unsigned={schema:PROOF_SCHEMA,issuer:HOST_ISSUER,algorithm:'Ed25519',key_id:keyId,receipt_id:receipt.receipt_id,receipt_hash:receipt.receipt_hash,scope:receipt.scope,payload_hash:receipt.payload_hash,source_ref:receipt.source_ref,representative_person_id:receipt.representative_person_id,nonce_hash:sha(receipt.nonce),issued_at:receipt.issued_at,expires_at:receipt.expires_at,actor_ref:c.key.actorRef};
    const proof={...unsigned,signature:sign(null,Buffer.from(DOMAIN+canonicalJson(unsigned)),privateKey).toString('base64url')};
    return {receipt,proof};
  }

  async function verifyReceipt({receipt,proof}={}){
    const {clock,context:c}=await authenticate();
    if(receipt?.representative_person_id!==c.person.id)fail('RECEIPT_PERSON_BINDING_MISMATCH');
    const trustedKeyring=new Map([[keyId,{publicKey,revoked:false,allowedScopes:[expected.scope],notBefore:c.key.notBefore,notAfter:c.key.expiresAt}]]);
    const signature=verifyNativeHostReceiptSignature({receipt,proof,expectedActorRef:c.key.actorRef,expectedScope:expected.scope,expectedPayloadHash:expected.payloadHash,expectedSourceRef:expected.sourceRef,trustedKeyring,now:clock});
    if(signature.cryptographic_signature_verified!==true)fail(signature.reason??'HOST_SIGNATURE_NOT_VERIFIED');
    if(date(receipt.expires_at)>Math.min(date(c.session.expiresAt),date(c.grant.expiresAt),date(c.key.expiresAt)))fail('RECEIPT_EXCEEDS_ENROLLED_AUTHORIZATION');
    return {issuer:HOST_ISSUER,issuer_authenticated:true,signature_verified:true,host_key_trust_verified:true,native_session_verified:true,representative_writer_grant_verified:true,reader_grant_used:false,verified_receipt_hash:receipt.receipt_hash,representative_person_id:c.person.id,scope:expected.scope,payload_hash:expected.payloadHash,source_ref:expected.sourceRef,native_session_id:c.session.id,grant_id:c.grant.id,key_id:keyId,public_key_fingerprint:fingerprint,approval_ref:c.grant.approvalRef,approval_hash:c.grant.approvalHash,verified_at:clock.toISOString(),nonce_consumed:false,write_allowed:false,mutation_authority_granted:false};
  }

  async function consumeInitialChallenge(packet){
    if(expected.operationKind!=='INITIAL_AUTHENTICATION_CHALLENGE')fail('INITIAL_AUTH_CHALLENGE_SCOPE_REQUIRED');
    if(typeof consumeChallenge!=='function')fail('DURABLE_INITIAL_CHALLENGE_CONSUMER_REQUIRED');
    const verification=await verifyReceipt(packet);
    let result;try{result=await consumeChallenge({receipt:structuredClone(packet.receipt),proof:structuredClone(packet.proof),verification});}catch{fail('CHALLENGE_CONSUMPTION_OUTCOME_UNKNOWN');}
    if(result?.decision==='INITIAL_AUTH_CHALLENGE_REPLAY_REJECTED')fail('INITIAL_AUTH_CHALLENGE_REPLAY_REJECTED');
    if(result?.decision!=='INITIAL_AUTH_CHALLENGE_CONSUMED'||result?.consumed!==true||result?.receiptId!==packet.receipt.receipt_id||result?.receiptHash!==packet.receipt.receipt_hash||result?.scope!==expected.scope||result?.payloadHash!==expected.payloadHash||result?.sourceRef!==expected.sourceRef)fail('DURABLE_CHALLENGE_RESULT_BINDING_MISMATCH');
    return {decision:'NATIVE_HOST_INITIAL_AUTHENTICATION_CHALLENGE_VERIFIED',authenticated:true,challenge_consumed:true,receipt_id:packet.receipt.receipt_id,receipt_hash:packet.receipt.receipt_hash,native_session_id:verification.native_session_id,grant_id:verification.grant_id,key_id:keyId,public_key_fingerprint:fingerprint,mutation_authority_granted:false,writer_registered:false,work_unit_dispatched:false,replay_allowed:false};
  }
  return Object.freeze({prepareReceipt,verifyReceipt,consumeInitialChallenge});
}
