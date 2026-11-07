import {createHash} from 'node:crypto';
const PRIOR_STAGE1_JOB='dcjob-69194412b00b2b45a2d50c91';
const VALID_NEW_WORK_UNIT=/^dcjob-[a-f0-9]{24}$/;
const NATIVE_MANIFEST_KEYS=[
 'action','artifacts','contract','environment','expected_head',
 'idempotency_key','operations','origin','preserve_data',
 'protected_session_id','replay_original_job','reset_usage_epoch',
 'supabase_project_ref','vercel_project_id'
];
const PREVIOUS_RECEIPT='b7dfe80c-4b92-43d8-847c-c07d6e1fc3d4';
function canonical(value) {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
function manifestDigest(x){
 return 'sha256:'+createHash('sha256').update(canonical(x)).digest('hex');
}
function allowedNativeManifest(request){
 const m=request?.native_manifest;
 if(!m||typeof m!=='object'||Array.isArray(m)||
    JSON.stringify(Object.keys(m).sort())!==JSON.stringify(NATIVE_MANIFEST_KEYS))
   return false;
 if(m.contract!=='THE_FA_CUSTOMER_PRODUCTION_AUTH_V1'||
    m.action!=='CUSTOMER_AUTH_PRODUCTION_CUTOVER'||
    m.environment!=='PRODUCTION'||
    m.supabase_project_ref!=='cgrppxfdurpzzfvkmfte'||
    m.vercel_project_id!=='prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo'||
    m.origin!=='https://thefacore.com'||
    JSON.stringify(m.operations)!=='["CONFIGURE_CUSTOMER_AUTH_ENV"]'||
    m.preserve_data!==true||m.reset_usage_epoch!==false||
    m.replay_original_job!==false||
    m.protected_session_id!=='111c339990e7926f4e8b226e'||
    m.expected_head!==request.fresh_source_head||
    m.idempotency_key!==request.idempotency_key||
    !Array.isArray(m.artifacts)||m.artifacts.length!==1)return false;
 const artifact=m.artifacts[0];
 if(!artifact||artifact.operation!=='CONFIGURE_CUSTOMER_AUTH_ENV'||
    !/^(infra\/customer-launch\/|customer-public\/|docs\/customer-launch\/)[A-Za-z0-9_.\/-]+$/.test(artifact.path)||
    artifact.path.includes('..')||artifact.path.includes('//')||
    !/^[a-f0-9]{64}$/.test(artifact.sha256))return false;
 return true;
}
/**
 * THE FA Customer Stage 2 — scoped existing-Broker consumer.
 *
 * Purpose: extend the EXISTING 4060 Work Unit -> Broker -> provider with a
 * runtime-credential operation, not spawn another scheduler or bypass authority.
 * Pure preservation classification plus strictly injected official host actions.
 * No secrets, OAuth tokens, passwords, SQL passwords or native grants cross
 * this API. The host's DPAPI-backed secret handle remains on its own PC.
 * This is a review candidate; it does NOT register the new operation on the
 * live Broker/provider. Official owner must adopt on fresh HEAD and fence.
 */
const HEAD=/^[a-f0-9]{40}$/;
const SHA=/^sha256:[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SCOPE='THE_FA_CORE_CUSTOMER_LAUNCH_V1';
const PROJECT='P04';
const ROOM='00_v25';
const OP='CONFIGURE_CUSTOMER_AUTH_ENV';
const LEGACY='PRESERVE_ONLY_REQUIRES_VERIFIED_CUSTOMER_MAPPING';

function reject(reason){throw Object.assign(new Error(reason),{code:reason});}
function text(x){return typeof x==='string'&&x.length>0&&x.length<=300&&x.trim()===x&&/^[\x20-\x7e]+$/.test(x);}
function safeId(x){return text(x)&&/^[A-Za-z0-9_:-]{8,160}$/.test(x);}
const safeResult=(status,extra={})=>({
 contract:'THEFA_CUSTOMER_STAGE2_NATIVE_ALLOWED_V2',status,
 operation:OP,canonical_project:PROJECT,
 original_jobs_replayed:false,customer_v2_deleted:false,
 staging_data_migrated:false,production_alias_switched:false,
 secrets_disclosed:false,provider_attempts:0,...extra
});

/**
 * Source readback of 2 legacy tables. This is an eligibility decision and
 * NEVER copies data or converts an untrusted workspace id to a tenant ID.
 */
export function classifyLegacyData(readback) {
 if(!readback||readback.source_authority!=='PRODUCTION_READ_ONLY_SQL_CATALOG'||
    readback.project_ref!=='cgrppxfdurpzzfvkmfte'||
    readback.observed_from_primary!==true||
    !Number.isInteger(readback.v2_states)||
    !Number.isInteger(readback.v2_artifacts)||
    !Number.isInteger(readback.valid_tenant_states)||
    !Number.isInteger(readback.valid_tenant_artifacts)||
    [readback.v2_states,readback.v2_artifacts,
     readback.valid_tenant_states,readback.valid_tenant_artifacts].some(x=>x<0)||
    readback.valid_tenant_states>readback.v2_states||
    readback.valid_tenant_artifacts>readback.v2_artifacts)
    return safeResult('PRESERVATION_EVIDENCE_GAP');
 const total=readback.v2_states+readback.v2_artifacts;
 const incompatible=total-readback.valid_tenant_states-readback.valid_tenant_artifacts;
 if(total===0)return safeResult('NO_LEGACY_ROWS', {legacy_rows:0,migration_allowed:false});
 return safeResult(LEGACY,{legacy_rows:total,incompatible_workspace_rows:incompatible,
    migration_allowed:false,requires_customer_identity_mapping:true,
    old_tables_kept:'core_console_state_v2 / core_console_artifacts_v2'});
}
function validateRequest(request) {
 if(!request||request.project_key!==PROJECT||request.room_instance!==ROOM||
    request.workstream_key!==SCOPE||request.operation!==OP||
    !allowedNativeManifest(request)||
    !HEAD.test(request.fresh_source_head??'')||
    !safeId(request.idempotency_key)||
    !VALID_NEW_WORK_UNIT.test(request.work_unit_id??'')||
    request.work_unit_id===PRIOR_STAGE1_JOB||
    request.original_job_policy!=='RECEIPT_FIRST_NO_REPLAY'||
    request.reset_usage_epoch!==false||request.overwrite_customer_v2!==false||
    request.use_old_native_grant!==false||request.allow_schema_reinstall!==false)
      reject('EXACT_P04_STAGE2_REQUEST_REQUIRED');
 return true;
}
function requireMethods(host) {
 if(!host || typeof host!=='object')reject('AUTHENTICATED_EXISTING_HOST_REQUIRED');
 for(const method of [
   'verifyCanonicalAuthority','verifyExistingWorkUnitTerminal',
   'verifyFreshGitHubHead','verifyOriginalJobProtection',
   'verifyNativeReceiptFresh','reserveOnce',
   'stageDpapiSecretHandle','setRuntimeRolePasswordUsingHandle',
   'verifyRuntimeLoginUsingHandle','setVercelDatabaseUrlFromHandle',
   'readbackVercelServerSide','recordTerminalReceipt','recordUncertainResult'
 ])if(typeof host[method]!=='function')reject('EXISTING_OFFICIAL_HOST_METHOD_MISSING');
}
function isVerified(x) {
 return x?.source_authority==='THE_FA_CORE_SERVER' &&
        x?.decision==='CURRENT_LEASE_FENCE_AND_OWNERSHIP_VERIFIED' &&
        x?.project_key===PROJECT&&x?.room_instance===ROOM&&
        x?.workstream_key===SCOPE&&
        Number.isInteger(x?.fencing_generation)&&x.fencing_generation>=1 &&
        SHA.test(x?.lease_binding_hash??'');
}
function verifiedNative(x,request) {
 const issued=Date.parse(x?.issued_at??''),expires=Date.parse(x?.expires_at??'');
 const now=Date.now();
 if(!Number.isFinite(issued)||!Number.isFinite(expires)||
    issued>now+30000||expires<=now+30000||
    expires-issued>600000||expires<=issued)return false;
 return x?.manifest_hash===manifestDigest(request.native_manifest)&&
        x?.operation===OP&&x?.receipt_id!==PREVIOUS_RECEIPT&&
        x?.room_instance===ROOM&&
        x?.repository==='good24c-sudo/thefa-core-site'&&
        x?.head_sha===request.fresh_source_head&&
        x?.decision==='NATIVE_RECEIPT_VERIFIED_FRESH_CONSUMED'&&
        x?.source_authority==='THE_FA_NATIVEHOST_SERVER'&&
        UUID.test(x?.receipt_id??'')&&
        x?.work_unit_id===request.work_unit_id&&
        x?.idempotency_key===request.idempotency_key;
}
/**
 * No caller-side admin SQL or credential value. All methods are already
 * authenticated, server-owned operations. This code cannot elevate a caller
 * and refuses before the first effect unless fresh server readbacks match.
 */
export async function provisionRuntimeCredentialOnce({request,host}) {
 validateRequest(request);
 requireMethods(host);
 const authority=await host.verifyCanonicalAuthority(request);
 if(!isVerified(authority))return safeResult('BLOCKED_CORE_WRITER_FENCE_UNVERIFIED');
 const [terminal,github,protectedJobs,native]=await Promise.all([
   host.verifyExistingWorkUnitTerminal(request),
   host.verifyFreshGitHubHead(request),
   host.verifyOriginalJobProtection(request),
   host.verifyNativeReceiptFresh(request)
 ]);
 if(terminal?.decision!=='PRIOR_INSTALL_AUTH_SCHEMA_COMPLETED'||
    terminal?.action_complete!==true||
    terminal?.work_unit_id!==PRIOR_STAGE1_JOB||terminal?.receipt_id!==PREVIOUS_RECEIPT||
    github?.decision!=='EXACT_FRESH_HEAD_MATCH'||
    github?.sha!==request.fresh_source_head||
    github?.artifact_hashes_verified!==true||
    github?.artifact_sha256!==request.native_manifest.artifacts[0].sha256||
    protectedJobs?.decision!=='NO_CONFLICT_AND_NO_REPLAY'||
    !verifiedNative(native,request))
     return safeResult('BLOCKED_OFFICIAL_ADMISSION_OR_PRIOR_RECEIPT');
 // The server owns reservation/idempotency and supports reconciliation of
 // uncertain results. An existing intent can ONLY read back, never re-execute.
 const reserved=await host.reserveOnce({request,native,authority});
 if(reserved?.decision==='EXISTING_ATTEMPT')
    return safeResult('EXISTING_ATTEMPT_RECONCILE_ONLY');
 if(reserved?.decision!=='NEW_EXCLUSIVE_ATTEMPT'||
    !UUID.test(reserved?.attempt_id??'')||!UUID.test(reserved?.action_id??'')||
    !UUID.test(reserved?.claim_id??'')||reserved?.work_unit_id!==request.work_unit_id||
    reserved?.receipt_id!==native.receipt_id||
    !SHA.test(reserved?.provider_request_hash??'')||
    !SHA.test(reserved?.request_binding_hash??'')||!SHA.test(reserved?.admission_receipt_hash??'')||
    reserved?.provider_operation_id!=='supabase:cgrppxfdurpzzfvkmfte:'+reserved.action_id||
    !Number.isFinite(Date.parse(reserved?.expires_at??''))||
    Date.parse(reserved.expires_at)>Date.parse(native.expires_at)||Date.parse(reserved.expires_at)<=Date.now())
    return safeResult('BLOCKED_EXCLUSIVE_BROKER_RESERVATION');
 let attempted=false,step='CREDENTIAL_STAGE';
 try {
   // Returns opaque DPAPI handle, never plaintext; stored only on 4060.
   const opaque=await host.stageDpapiSecretHandle(reserved);
   if(opaque?.kind!=='HOST_DPAPI_SECRET_HANDLE'||
      !safeId(opaque.handle_id)||Object.keys(opaque).sort().join('|')!=='handle_id|kind')reject('UNSAFE_SECRET_HANDLE');
   if(Date.parse(reserved.expires_at)<=Date.now())reject('EXCLUSIVE_CLAIM_EXPIRED');
   attempted=true;step='DB_RUNTIME_PASSWORD';
   const provision=await host.setRuntimeRolePasswordUsingHandle(reserved,opaque);
   if(provision?.decision!=='PRODUCTION_ROLE_PASSWORD_SET')
      reject('PROVIDER_RUNTIME_ROLE_RESULT_UNVERIFIED');
   step='DB_SCRAM_LOGIN';
   const login=await host.verifyRuntimeLoginUsingHandle(reserved,opaque);
   if(login?.decision!=='RUNTIME_LOGIN_VERIFIED_CUSTOM_ROLE')
      reject('RUNTIME_LOGIN_UNVERIFIED');
   if(Date.parse(reserved.expires_at)<=Date.now())reject('EXCLUSIVE_CLAIM_EXPIRED');
   step='VERCEL_ENCRYPTED_SECRET';
   const app=await host.setVercelDatabaseUrlFromHandle(reserved,opaque);
   if(app?.decision!=='VERCEL_DATABASE_SECRET_APPLIED_ENCRYPTED')
      reject('APP_DATABASE_SECRET_RESULT_UNVERIFIED');
   step='VERCEL_SERVER_READBACK';
   const readback=await host.readbackVercelServerSide(reserved,opaque);
   if(readback?.decision!=='APP_DATABASE_SECRET_MATCHED_WITHOUT_DISCLOSURE')
      reject('APP_DATABASE_SECRET_READBACK_UNVERIFIED');
   step='OFFICIAL_TERMINAL';
   const receipt=await host.recordTerminalReceipt({request,reserved,step:'CREDENTIAL_ONLY'});
   if(receipt?.decision!=='SIGNED_COMPLETED_RECEIPT'||
      receipt?.source_authority!=='THE_FA_ACTION_BROKER'||
      receipt?.state!=='COMPLETED'||receipt?.provider_terminal_verified!==true||
      receipt?.attempt_id!==reserved.attempt_id||receipt?.action_id!==reserved.action_id||
      receipt?.work_unit_id!==request.work_unit_id||
      receipt?.provider_operation_id!==reserved.provider_operation_id||
      receipt?.request_binding_hash!==reserved.request_binding_hash||
      receipt?.admission_receipt_hash!==reserved.admission_receipt_hash||
      !UUID.test(receipt?.receipt_id??'')||!SHA.test(receipt?.provider_receipt_hash??'')||
      !SHA.test(receipt?.result_binding_hash??''))return safeResult('TERMINAL_RESULT_UNCERTAIN',
        {provider_attempts:1,blind_retry_allowed:false});
   return safeResult('CREDENTIAL_LINK_COMPLETED',{provider_attempts:1,
      terminal_receipt_id:receipt.receipt_id,
      next_action:'PREVIEW_EDGE_AND_GOOGLE_CALLBACK_QA_NO_PRODUCTION_ALIAS'});
 }catch(e){
   const reason=['UNSAFE_SECRET_HANDLE','EXCLUSIVE_CLAIM_EXPIRED',
    'PROVIDER_RUNTIME_ROLE_RESULT_UNVERIFIED','RUNTIME_LOGIN_UNVERIFIED',
    'APP_DATABASE_SECRET_RESULT_UNVERIFIED','APP_DATABASE_SECRET_READBACK_UNVERIFIED'].includes(e?.code)?e.code:'HOST_ACTION_FAILED';
   // Never repeat a privileged action on an uncertain external response.
   if(attempted){
      try{await host.recordUncertainResult({request,reserved,step,reason_code:reason})}
      catch{/* evidence gap must be separately reported; still no retry */}
      return safeResult('UNCERTAIN_WRITE_RECONCILE_REQUIRED',
         {failed_step:step,blind_retry_allowed:false,provider_attempts:1});
   }
   return safeResult('BLOCKED_BEFORE_EXTERNAL_ACTION',{reason});
 }
}
export const CUSTOMER_STAGE2_OPERATION=OP;
export const CUSTOMER_LEGACY_PRESERVATION=LEGACY;
