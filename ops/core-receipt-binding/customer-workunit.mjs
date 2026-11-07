import {createHash} from 'node:crypto';
import {verifyProductionArtifacts} from './customer-production.mjs';
import {canonicalJson} from './vendor/edge/thefa-founder-live-ingress-v1/contract.mjs';

// Candidate coordinator only. Adapters are trusted host dependencies, never
// request JSON. Their installation/authentication is outside this module.
// No scheduler authority, Work Unit ID, provider executor or approval is created.
const HASH=/^sha256:[0-9a-f]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const INPUT=['receiptId','manifest','binding','artifactRoot'];
const CORE=['project_key','room_family','room_instance','workstream_key','repository','branch','head_sha','writer_id',
 'fencing_generation','owned_paths','work_identity_binding_hash','writer_lease_idempotency_key','writer_lease_work_key'];
const BROKER_READ_METHODS=['readDispatch','readback','readProviderReceipt'];
const fail=code=>{throw new Error(code);};
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>record(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
const validText=v=>typeof v==='string'&&v.length>0&&v.length<=600&&!/[\x00-\x1f\x7f]/.test(v);
const stamp=v=>typeof v==='string'?Date.parse(v):NaN;
export const productionRequestHash=value=>'sha256:'+createHash('sha256').update(canonicalJson(value)).digest('hex');

/**
 * Read-only candidate for an eventual official Work Unit admission producer.
 * Construct only in trusted host code: receiptTransport must use the dedicated
 * consumer DB connection, readFreshAuthority must read current server authority,
 * and broker read methods must use authenticated official server readbacks.
 * Never construct these dependencies from request JSON or trust verified flags.
 * No prepare/execute method exists here. A ready binding grants no write right;
 * the official Work Unit gate and provider executor remain required elsewhere.
 */
export function createCustomerWorkUnitCoordinator({receiptTransport,broker,readFreshAuthority,
 contextLeaseId,runtimeIdentity,adapterProvider,route,mode='live',now=()=>new Date()}={}){
 if(!['live','fixture'].includes(mode)||typeof now!=='function')fail('EXPLICIT_COORDINATOR_MODE_REQUIRED');
 // Clone trusted configuration so a caller cannot change targets during awaits.
 const config=structuredClone({contextLeaseId,runtimeIdentity,adapterProvider,route});
 const base={contract:'THE_FA_CUSTOMER_PRODUCTION_COORDINATOR_CANDIDATE_V1',fixture_only:mode==='fixture',
  work_unit_accepted:false,development_complete:false,write_allowed:false,original_job_replayed:false,blind_redispatch_allowed:false};
 const output=(decision,extra={})=>({...base,decision,...extra});
 const clock=()=>{const t=now();if(!(t instanceof Date)||!Number.isFinite(t.getTime()))fail('TRUSTED_TIME_REQUIRED');return t.getTime();};
 function connected(){
  return typeof receiptTransport?.readback==='function'&&typeof readFreshAuthority==='function'&&
   validText(config.contextLeaseId)&&
   validText(config.adapterProvider)&&validText(config.runtimeIdentity?.adapter_instance_id)&&
   config.runtimeIdentity.adapter_instance_id.length>=8&&Number.isSafeInteger(config.runtimeIdentity.adapter_epoch)&&
   config.runtimeIdentity.adapter_epoch>0&&record(config.route);
 }
 async function evidence(raw,{historical=false}={}){
  if(!exact(raw,INPUT)||!UUID.test(raw.receiptId??'')||!validText(raw.artifactRoot))fail('EXACT_COORDINATOR_INPUT_REQUIRED');
  const input=structuredClone(raw),{manifest,binding}=input;
  const {payloadHash}=await verifyProductionArtifacts(input.artifactRoot,manifest,binding);
  if(!Number.isSafeInteger(binding.fencing_generation)||binding.fencing_generation<1||!validText(binding.writer_id)||
   !HASH.test(binding.work_identity_binding_hash??'')||!validText(binding.writer_lease_idempotency_key)||
   !validText(binding.writer_lease_work_key)||!Array.isArray(binding.owned_paths)||!binding.owned_paths.length)
   fail('EXACT_CURRENT_WRITER_BINDING_REQUIRED');
  const key={receiptId:input.receiptId,payloadHash,idempotencyKey:manifest.idempotency_key};
  const db=await receiptTransport.readback(key),t=clock();
  const registered=stamp(db?.registered_at),consumed=stamp(db?.consumed_at),expires=stamp(db?.expires_at);
  if(db?.decision!=='CUSTOMER_PRODUCTION_RECEIPT_DATABASE_EVIDENCE'||db.state!=='CONSUMED'||
   db.receipt_id!==input.receiptId||db.payload_hash!==payloadHash||db.manifest_hash!==payloadHash||
   db.idempotency_key!==manifest.idempotency_key||!HASH.test(db.receipt_hash??'')||!HASH.test(db.context_hash??'')||
   !same(db.binding,binding)||!same(db.target,manifest)||db.consumer_role!=='thefa_core_receipt_consumer_v1'||
   db.write_allowed!==false||db.authority_boundary!=='DATABASE_EVIDENCE_ONLY_NOT_EXECUTION_OR_TERMINAL_RECEIPT'||
   ![registered,consumed,expires].every(Number.isFinite)||registered>consumed||consumed>=expires||consumed>t||
   (!historical&&t>=expires))fail('EXACT_UNEXPIRED_CONSUMED_DATABASE_RECEIPT_REQUIRED');
  const intent={contract:'THE_FA_CUSTOMER_PRODUCTION_BROKER_INTENT_V1',manifest,
   production_admission:{receipt_id:db.receipt_id,receipt_hash:db.receipt_hash,payload_hash:payloadHash,
    context_hash:db.context_hash,consumed_at:db.consumed_at,expires_at:db.expires_at},core_binding:binding};
  return {input,db,intent,payloadHash};
 }
 async function fresh(e){
  const observed=await readFreshAuthority({binding:structuredClone(e.input.binding)}),t=clock();
  if(!record(observed?.binding)||observed.write_sealed!==false||!Number.isFinite(stamp(observed.observed_at))||
   t-stamp(observed.observed_at)<0||t-stamp(observed.observed_at)>30000||
   CORE.some(k=>!same(observed.binding[k],e.input.binding[k])))fail('FRESH_SERVER_AUTHORITY_BINDING_REQUIRED');
 }
 function preparedRequest(e){
  const r=config.route,ops=e.input.manifest.operations;
  // This candidate implements no Vercel-through-CORE shortcut. A route must be
  // explicitly installed by the official server; these labels cannot grant it.
  const supported={INSTALL_AUTH_SCHEMA:'RISKY_OPERATIONAL_DATA_CHANGE',
   PRESERVE_CUSTOMER_MIGRATION:'RISKY_OPERATIONAL_DATA_CHANGE',CONFIGURE_GOOGLE_CALLBACK:'LOGIN_PERMISSION_CHANGE'};
  if(!exact(r,['operation','target_provider','action_type'])||ops.length!==1||ops[0]!==r.operation||
   r.target_provider!=='SUPABASE'||supported[r.operation]!==r.action_type)fail('OFFICIAL_CUSTOMER_STAGE_ROUTE_NOT_CONNECTED');
  return {action:'prepare_guarded_action',adapter_provider:config.adapterProvider,
   runtime_identity:config.runtimeIdentity,context_lease_id:config.contextLeaseId,action_type:r.action_type,
   risk_class:'RED',target_provider:r.target_provider,intent:e.intent,idempotency_key:e.input.manifest.idempotency_key};
 }
 function verifyDispatch(d,e,req,prepared){
  if(!UUID.test(d?.action_id??'')||d.action_id!==prepared.action_id||!HASH.test(d.prepared_action_hash??'')||
   d.prepared_action_hash!==prepared.prepared_action_hash||!HASH.test(d.intent_hash??'')||
   d.context_lease_id!==req.context_lease_id||d.work_identity_binding_hash!==e.input.binding.work_identity_binding_hash||
   d.adapter_instance_id!==config.runtimeIdentity.adapter_instance_id||d.adapter_epoch!==config.runtimeIdentity.adapter_epoch||
   d.action_type!==req.action_type||d.target_provider!==req.target_provider||d.risk_class!=='RED'||
   d.idempotency_key!==req.idempotency_key||d.expected_parent_head!==null||
   !same(d.owned_paths,e.input.binding.owned_paths)||!same(d.intent,req.intent))fail('BROKER_DISPATCH_BINDING_MISMATCH');
 }
 async function terminal(e,req,prepared){
  const dispatch=await broker.readDispatch({actionId:prepared.action_id});
  verifyDispatch(dispatch,e,req,prepared);
  const status=await broker.readback({action:'get_action_status',action_id:prepared.action_id});
  if(status?.action_id!==prepared.action_id||status.prepared_action_hash!==prepared.prepared_action_hash||
   status.work_identity_binding_hash!==e.input.binding.work_identity_binding_hash||status.action_type!==req.action_type||
   status.target_provider!==req.target_provider||status.risk_class!=='RED'||status.blind_redispatch_allowed!==false||
   status.state!==dispatch.state||status.verified_receipt_required_for_completion!==true)
   fail('BROKER_STATUS_BINDING_MISMATCH');
  if(status.state!=='COMPLETED')return output('PROVIDER_TERMINAL_PENDING',{action_id:prepared.action_id,
   provider_state:typeof status.state==='string'?status.state:'UNKNOWN',reconciliation_required:true,provider_terminal_verified:false});
  const p=await broker.readProviderReceipt({actionId:prepared.action_id});
  if(!HASH.test(status.authority_receipt_hash??'')||!HASH.test(status.result_binding_hash??'')||
   !HASH.test(status.fresh_source_binding_hash??'')||status.fencing_generation!==e.input.binding.fencing_generation||
   !Number.isFinite(stamp(status.completed_at))||stamp(status.completed_at)>clock()||
   p?.action_id!==prepared.action_id||!UUID.test(p.receipt_id??'')||!UUID.test(p.attempt_id??'')||
   p.provider!==req.target_provider||!validText(p.provider_operation_id)||!HASH.test(p.provider_request_hash??'')||
   !HASH.test(p.provider_receipt_hash??'')||p.result_binding_hash!==status.result_binding_hash||
   p.authority_receipt_hash!==status.authority_receipt_hash||p.fencing_generation!==status.fencing_generation)
   fail('ACTUAL_PROVIDER_TERMINAL_RECEIPT_REQUIRED');
  return output(mode==='fixture'?'FIXTURE_PROVIDER_TERMINAL_CHECKS_PASSED':'PROVIDER_TERMINAL_VERIFIED',{
   action_id:prepared.action_id,provider_terminal_verified:mode==='live',fixture_terminal_checks_passed:mode==='fixture',
   provider_receipt_id:p.receipt_id,result_binding_hash:p.result_binding_hash,request_binding_hash:productionRequestHash(req)});
 }
 async function prepareBinding(raw){
  if(!connected())return output('BLOCKED_OFFICIAL_ADAPTER_NOT_CONNECTED');
  try{
   const e=await evidence(raw);await fresh(e);const req=preparedRequest(e);
   const rechecked=await evidence(raw);await fresh(rechecked);
   if(!same(rechecked.intent,e.intent))fail('ADMISSION_CHANGED_DURING_BINDING');
   if(clock()>=stamp(rechecked.db.expires_at))fail('ADMISSION_EXPIRED_DURING_BINDING');
   return output('ADMISSION_BINDING_READY_WORK_UNIT_REQUIRED',{
    broker_prepare_request:structuredClone(req),request_binding_hash:productionRequestHash(req),
    admission_expires_at:e.db.expires_at,provider_terminal_verified:false});
  }catch(error){
   return output('BLOCKED_EVIDENCE_NOT_VERIFIED',{
    provider_terminal_verified:false,
    reason:/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'SANITIZED_COORDINATOR_FAILURE'});
  }
 }
 // Reconnect is observation only, including after admission expiry. It cannot
 // call prepare/execute or create a replacement Job/action.
 async function inspect(raw,actionId){
  if(!connected()||!BROKER_READ_METHODS.every(k=>typeof broker?.[k]==='function'))return output('BLOCKED_OFFICIAL_ADAPTER_NOT_CONNECTED');
  try{
   if(!UUID.test(actionId??''))fail('EXACT_BROKER_ACTION_ID_REQUIRED');
   const e=await evidence(raw,{historical:true}),req=preparedRequest(e),d=await broker.readDispatch({actionId});
   return await terminal(e,req,{action_id:actionId,prepared_action_hash:d?.prepared_action_hash});
  }catch(error){return output('BLOCKED_TERMINAL_EVIDENCE_NOT_VERIFIED',{action_id:actionId,
   reason:/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'SANITIZED_COORDINATOR_FAILURE'});}
 }
 return Object.freeze({prepareBinding,inspect});
}
