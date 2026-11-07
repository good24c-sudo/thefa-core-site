import {createHash} from 'node:crypto';
import {lstat, readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {withDedicatedRole} from './dedicated-pg.mjs';
import {canonicalJson} from './vendor/edge/thefa-founder-live-ingress-v1/contract.mjs';

const HASH=/^sha256:[0-9a-f]{64}$/;
const HEX=/^[0-9a-f]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const OPS=new Set(['INSTALL_AUTH_SCHEMA','PRESERVE_CUSTOMER_MIGRATION','CONFIGURE_GOOGLE_CALLBACK','CONFIGURE_CUSTOMER_AUTH_ENV']);
const fields=['contract','action','environment','supabase_project_ref','vercel_project_id','origin','operations','preserve_data','reset_usage_epoch','replay_original_job','protected_session_id','expected_head','idempotency_key','artifacts'];
const fail=code=>{throw new Error(code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');

export function validateProductionManifest(manifest,binding){
 if(binding?.operation_kind!=='CUSTOMER_PRODUCTION_AUTH')fail('TYPED_PRODUCTION_OPERATION_REQUIRED');
 if(!exactKeys(manifest,fields)||manifest.contract!=='THE_FA_CUSTOMER_PRODUCTION_AUTH_V1'||manifest.action!=='CUSTOMER_AUTH_PRODUCTION_CUTOVER'||manifest.environment!=='PRODUCTION'||manifest.supabase_project_ref!=='cgrppxfdurpzzfvkmfte'||manifest.vercel_project_id!=='prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo'||manifest.origin!=='https://thefacore.com')fail('EXACT_CUSTOMER_PRODUCTION_TARGET_REQUIRED');
 if(manifest.preserve_data!==true||manifest.reset_usage_epoch!==false||manifest.replay_original_job!==false||manifest.protected_session_id!=='111c339990e7926f4e8b226e')fail('CUSTOMER_DATA_AND_ORIGINAL_JOB_PRESERVATION_REQUIRED');
 if(!/^[0-9a-f]{40}$/.test(manifest.expected_head??'')||typeof manifest.idempotency_key!=='string'||!/^[A-Za-z0-9:_-]{8,160}$/.test(manifest.idempotency_key)||manifest.expected_head!==binding?.head_sha||manifest.idempotency_key!==binding?.idempotency_key||binding?.target_environment!=='PRODUCTION'||binding?.project_key!=='P04'||binding?.room_family!=='00'||binding?.room_instance!=='00_v25'||binding?.workstream_key!=='THE_FA_CORE_CUSTOMER_LAUNCH_V1'||binding?.repository!=='good24c-sudo/thefa-core-site'||binding?.branch!=='codex/core-customer-launch-v1-20261029')fail('EXACT_CURRENT_CUSTOMER_BINDING_REQUIRED');
 if(!Array.isArray(manifest.operations)||manifest.operations.length<1||manifest.operations.length>4||new Set(manifest.operations).size!==manifest.operations.length||manifest.operations.some(op=>!OPS.has(op)))fail('APPROVED_AUTH_OPERATIONS_REQUIRED');
 if(!Array.isArray(manifest.artifacts)||manifest.artifacts.length<1||manifest.artifacts.length>256)fail('EXACT_ARTIFACTS_REQUIRED');
 const seen=new Set(),covered=new Set();
 for(const item of manifest.artifacts){
  if(!exactKeys(item,['operation','path','sha256'])||!manifest.operations.includes(item.operation)||!HEX.test(item.sha256??'')||item.sha256==='0'.repeat(64)||typeof item.path!=='string'||!/^[A-Za-z0-9_-][A-Za-z0-9._/-]{0,499}$/.test(item.path)||item.path.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))||seen.has(item.path.toLowerCase()))fail('EXACT_RELATIVE_ARTIFACT_BINDING_REQUIRED');
  seen.add(item.path.toLowerCase());covered.add(item.operation);
 }
 if(manifest.operations.some(op=>!covered.has(op)))fail('EVERY_OPERATION_REQUIRES_FIXED_ARTIFACT');
 const canonical=canonicalJson(manifest);
 return {canonical,payloadHash:'sha256:'+hash(canonical)};
}

export async function verifyProductionArtifacts(root,manifest,binding){
 const result=validateProductionManifest(manifest,binding),absolute=await realpath(root);
 for(const item of manifest.artifacts){
  let current=absolute;
  for(const segment of item.path.split('/')){
   current=path.join(current,segment);
   const stat=await lstat(current);
   if(stat.isSymbolicLink())fail('ARTIFACT_LINK_FORBIDDEN');
  }
  const resolved=await realpath(current),relative=path.relative(absolute,resolved);
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!(await lstat(resolved)).isFile())fail('ARTIFACT_ROOT_ESCAPE');
  if(hash(await readFile(resolved))!==item.sha256)fail('ARTIFACT_BYTES_CHANGED');
 }
 return result;
}

// The caller supplies already authenticated NativeHost and server-owned bindings.
// This prepares a policy for the existing NativeAdmin installation path, never
// inventing a server enrollment, writer identity, approval flag or Work Unit.
export async function prepareProductionPolicy({host,readNativeContext,manifest,binding,artifactRoot}){
 const frozenManifest=structuredClone(manifest),frozenBinding=structuredClone(binding);
 const {canonical,payloadHash}=await verifyProductionArtifacts(artifactRoot,frozenManifest,frozenBinding);
 const packet=await host.prepareReceipt(),verification=await host.verifyReceipt(packet),context=await readNativeContext();
 const p=packet.receipt;
 if(p?.payload_hash!==payloadHash||p?.scope!=='P04:00_v25:THE_FA_CORE_CUSTOMER_LAUNCH_V1'||verification?.signature_verified!==true||verification?.verified_receipt_hash!==p.receipt_hash||verification?.write_allowed!==false||verification?.mutation_authority_granted!==false||!HASH.test(context?.contextHash??'')||context?.session?.id!==verification.native_session_id||context?.grant?.id!==verification.grant_id||context?.grant?.payloadHash!==payloadHash)fail('AUTHENTICATED_NATIVE_MANIFEST_BINDING_REQUIRED');
 if(frozenBinding.session_ref!=='NATIVE_HOST_SESSION:'+verification.native_session_id||frozenBinding.writer_grant_ref!=='NATIVE_HOST_GRANT:'+verification.grant_id||frozenBinding.source_message_hash!==verification.approval_hash||frozenBinding.key_id!==verification.key_id||frozenBinding.key_fingerprint!==verification.public_key_fingerprint||frozenBinding.actor_ref!==packet.proof.actor_ref)fail('NATIVE_CONTEXT_POLICY_BINDING_MISMATCH');
 return {packet,policy:{receipt_id:p.receipt_id,nonce_hash:hash(p.nonce),receipt_hash:p.receipt_hash,representative_person_id:p.representative_person_id,scope:p.scope,payload_hash:payloadHash,source_ref:p.source_ref,issued_at:p.issued_at,expires_at:p.expires_at,session_id:verification.native_session_id,grant_id:verification.grant_id,context_hash:context.contextHash,binding:frozenBinding,manifest_canonical:canonical,proof:packet.proof,verification}};
}

export function createCustomerProductionTransport({issuerPool,consumerPool}){
 if(typeof issuerPool?.connect!=='function'||typeof consumerPool?.connect!=='function')fail('DEDICATED_POOLS_REQUIRED');
 const check=(id,payload,key)=>{if(!UUID.test(id??'')||!HASH.test(payload??'')||typeof key!=='string'||!/^[A-Za-z0-9:_-]{8,160}$/.test(key))fail('EXACT_PRODUCTION_RECEIPT_PARAMETERS_REQUIRED');};
 return Object.freeze({
  register:async({receiptId,nonce})=>{
   if(!UUID.test(receiptId??'')||!HEX.test(nonce??''))fail('EXACT_PRODUCTION_RECEIPT_PARAMETERS_REQUIRED');
   return withDedicatedRole(issuerPool,'thefa_core_receipt_issuer_v1','SELECT thefa_customer_production_v1.register_v1($1::uuid,$2::text) AS result',[receiptId,nonce]);
  },
  consume:async({receiptId,nonce,payloadHash,idempotencyKey})=>{
   check(receiptId,payloadHash,idempotencyKey);if(!HEX.test(nonce??''))fail('EXACT_PRODUCTION_RECEIPT_PARAMETERS_REQUIRED');
   return withDedicatedRole(consumerPool,'thefa_core_receipt_consumer_v1','SELECT thefa_customer_production_v1.consume_v1($1::uuid,$2::text,$3::text,$4::text) AS result',[receiptId,nonce,payloadHash,idempotencyKey]);
  },
  readback:async({receiptId,payloadHash,idempotencyKey})=>{
   check(receiptId,payloadHash,idempotencyKey);
   return withDedicatedRole(consumerPool,'thefa_core_receipt_consumer_v1','SELECT thefa_customer_production_v1.readback_v1($1::uuid,$2::text,$3::text) AS result',[receiptId,payloadHash,idempotencyKey]);
  },
 });
}
