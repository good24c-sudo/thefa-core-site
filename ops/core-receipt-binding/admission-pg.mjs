/** Non-authorizing initial authentication challenge transport; separate from NORMAL_WRITE. */
import {createHash} from 'node:crypto';
import {withDedicatedRole} from './dedicated-pg.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^sha256:[a-f0-9]{64}$/;
const fail=code=>{throw new Error(code);};
export function createNativeAdmissionPgTransport({issuerPool,consumerPool,sessionId,grantId}={}){
 if(!UUID.test(sessionId??'')||!UUID.test(grantId??'')||typeof issuerPool?.connect!=='function'||typeof consumerPool?.connect!=='function')fail('EXACT_NATIVE_ADMISSION_CONFIG_REQUIRED');
 async function readRaw(){
  const r=await withDedicatedRole(issuerPool,'thefa_core_receipt_issuer_v1','SELECT thefa_native_host_v1.read_context_v1($1::uuid,$2::uuid) AS result',[sessionId,grantId]);
  if(r?.decision!=='TRUSTED_NATIVE_HOST_CONTEXT'||r?.session_id!==sessionId||r?.grant_id!==grantId||r?.write_allowed!==false||!HASH.test(r?.context_hash??'')||!r?.context||r.context.session?.id!==sessionId||r.context.grant?.id!==grantId||!Number.isFinite(Date.parse(r?.db_time)))fail('TRUSTED_NATIVE_CONTEXT_NOT_AVAILABLE');
  return r;
 }
 async function readContext(){const r=await readRaw();return {...r.context,databaseTime:r.db_time,contextHash:r.context_hash};}
 function exactPacket(packet,r){
  const p=packet?.receipt,g=r.context.grant;
  if(g.operationKind!=='INITIAL_AUTHENTICATION_CHALLENGE'||!UUID.test(p?.receipt_id??'')||!/^[a-f0-9]{64}$/.test(p?.nonce??'')||!HASH.test(p?.receipt_hash??'')||p?.scope!==g.scope||p?.payload_hash!==g.payloadHash||p?.source_ref!==g.sourceRef||!Number.isFinite(Date.parse(p?.issued_at))||!Number.isFinite(Date.parse(p?.expires_at)))fail('EXACT_ADMISSION_RECEIPT_BINDING_REQUIRED');
  return p;
 }
 function exactDbResult(result,p,r){
  return result?.challenge_id===p.receipt_id&&result?.session_id===sessionId&&result?.grant_id===grantId&&result?.context_hash===r.context_hash&&result?.write_allowed===false;
 }
 async function registerChallenge(packet){
  const r=await readRaw(),p=exactPacket(packet,r);
  const nonceHash=createHash('sha256').update(p.nonce).digest('hex');
  const result=await withDedicatedRole(issuerPool,'thefa_core_receipt_issuer_v1','SELECT thefa_native_host_v1.register_admission_challenge_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::timestamptz,$7::timestamptz) AS result',[p.receipt_id,sessionId,grantId,nonceHash,r.context_hash,p.issued_at,p.expires_at]);
  if(result?.decision!=='INITIAL_ADMISSION_CHALLENGE_REGISTERED'||!exactDbResult(result,p,r))fail('DURABLE_ADMISSION_BINDING_MISMATCH');
  return result;
 }
 async function consumeChallenge(packet){
  const r=await readRaw(),p=exactPacket(packet,r);
  const result=await withDedicatedRole(consumerPool,'thefa_core_receipt_consumer_v1','SELECT thefa_native_host_v1.consume_admission_challenge_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text) AS result',[p.receipt_id,sessionId,grantId,p.nonce,r.context_hash]);
  if(result?.decision==='INITIAL_ADMISSION_CHALLENGE_REPLAY_REJECTED'&&result?.verified===false&&result?.write_allowed===false)return {decision:'INITIAL_AUTH_CHALLENGE_REPLAY_REJECTED',consumed:false};
  if(result?.verified!==true)return {decision:'INITIAL_AUTH_CHALLENGE_REJECTED',consumed:false,reason:/^[A-Z0-9_]+$/.test(result?.reason??'')?result.reason:'DATABASE_REJECTED'};
  if(result?.decision!=='INITIAL_ADMISSION_CHALLENGE_CONSUMED'||!exactDbResult(result,p,r))fail('DURABLE_ADMISSION_BINDING_MISMATCH');
  return {decision:'INITIAL_AUTH_CHALLENGE_CONSUMED',consumed:true,receiptId:p.receipt_id,receiptHash:p.receipt_hash,scope:r.context.grant.scope,payloadHash:r.context.grant.payloadHash,sourceRef:r.context.grant.sourceRef};
 }
 return Object.freeze({readContext,registerChallenge,consumeChallenge});
}
