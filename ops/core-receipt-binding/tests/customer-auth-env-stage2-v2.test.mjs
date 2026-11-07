import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLegacyData,provisionRuntimeCredentialOnce,
  CUSTOMER_STAGE2_OPERATION,CUSTOMER_LEGACY_PRESERVATION
} from '../runtime/customer-auth-env-stage2-v2.mjs';
const H='sha256:'+'a'.repeat(64);
const ID='11111111-1111-4111-8111-111111111111';
const NATIVE_MANIFEST={
 contract:'THE_FA_CUSTOMER_PRODUCTION_AUTH_V1',
 action:'CUSTOMER_AUTH_PRODUCTION_CUTOVER',environment:'PRODUCTION',
 supabase_project_ref:'cgrppxfdurpzzfvkmfte',
 vercel_project_id:'prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo',
 origin:'https://thefacore.com',
 operations:['CONFIGURE_CUSTOMER_AUTH_ENV'],
 preserve_data:true,reset_usage_epoch:false,replay_original_job:false,
 protected_session_id:'111c339990e7926f4e8b226e',
 expected_head:'ce262fece887a7372202809d7911e6a911b9be3b',
 idempotency_key:'P04_CUSTOMER_RUNTIME_ROLE_20261106_V1',
 artifacts:[{operation:'CONFIGURE_CUSTOMER_AUTH_ENV',
   path:'infra/customer-launch/runtime/customer-auth-env-v1.mjs',
   sha256:'a'.repeat(64)}]
};
const rec=x=>Array.isArray(x)?'['+x.map(rec).join(',')+']':x&&typeof x==='object'?
 '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+rec(x[k])).join(',')+'}':JSON.stringify(x);
const NATIVE_HASH='sha256:'+(await import('node:crypto')).createHash('sha256')
 .update(rec(NATIVE_MANIFEST)).digest('hex');
const REQ={
 project_key:'P04',room_instance:'00_v25',
 workstream_key:'THE_FA_CORE_CUSTOMER_LAUNCH_V1',
 operation:CUSTOMER_STAGE2_OPERATION,
 fresh_source_head:'ce262fece887a7372202809d7911e6a911b9be3b',
 native_manifest:NATIVE_MANIFEST,
 idempotency_key:'P04_CUSTOMER_RUNTIME_ROLE_20261106_V1',
 work_unit_id:'dcjob-aaaaaaaaaaaaaaaaaaaaaaaa',
 original_job_policy:'RECEIPT_FIRST_NO_REPLAY',
 reset_usage_epoch:false,overwrite_customer_v2:false,
 use_old_native_grant:false,allow_schema_reinstall:false
};
const LEGACY={
 source_authority:'PRODUCTION_READ_ONLY_SQL_CATALOG',
 project_ref:'cgrppxfdurpzzfvkmfte',observed_from_primary:true,
 v2_states:1,v2_artifacts:10,valid_tenant_states:0,valid_tenant_artifacts:0
};
function fixture(overrides={},request=REQ) {
 const counter={};
 const mark=k=>(counter[k]=(counter[k]??0)+1);
 const host={
  verifyCanonicalAuthority:async()=>{mark('core');return {
    source_authority:'THE_FA_CORE_SERVER',
    decision:'CURRENT_LEASE_FENCE_AND_OWNERSHIP_VERIFIED',
    project_key:'P04',room_instance:'00_v25',workstream_key:request.workstream_key,
    lease_binding_hash:H,fencing_generation:1};},
  verifyExistingWorkUnitTerminal:async()=>{mark('prior');return {decision:'PRIOR_INSTALL_AUTH_SCHEMA_COMPLETED',action_complete:true,work_unit_id:'dcjob-69194412b00b2b45a2d50c91',receipt_id:'b7dfe80c-4b92-43d8-847c-c07d6e1fc3d4'};},
  verifyFreshGitHubHead:async()=>{mark('git');return {decision:'EXACT_FRESH_HEAD_MATCH',sha:request.fresh_source_head,
    artifact_hashes_verified:true,artifact_sha256:request.native_manifest.artifacts[0].sha256};},
  verifyOriginalJobProtection:async()=>{mark('original');return {decision:'NO_CONFLICT_AND_NO_REPLAY'};},
  verifyNativeReceiptFresh:async()=>{mark('native');return {
    source_authority:'THE_FA_NATIVEHOST_SERVER',
    decision:'NATIVE_RECEIPT_VERIFIED_FRESH_CONSUMED',
    receipt_id:ID,work_unit_id:request.work_unit_id,
    idempotency_key:request.idempotency_key,
    issued_at:new Date(Date.now()-1000).toISOString(),
    expires_at:new Date(Date.now()+300000).toISOString(),
    manifest_hash:'sha256:'+createHash('sha256').update(rec(request.native_manifest)).digest('hex'),operation:'CONFIGURE_CUSTOMER_AUTH_ENV',
    room_instance:request.room_instance,
    repository:'good24c-sudo/thefa-core-site',head_sha:request.fresh_source_head};},
  reserveOnce:async()=>{mark('reserve');return {decision:'NEW_EXCLUSIVE_ATTEMPT',attempt_id:ID,action_id:ID,claim_id:ID,work_unit_id:request.work_unit_id,receipt_id:ID,provider_request_hash:H,request_binding_hash:H,admission_receipt_hash:H,provider_operation_id:'supabase:cgrppxfdurpzzfvkmfte:'+ID,expires_at:new Date(Date.now()+120000).toISOString()};},
  stageDpapiSecretHandle:async()=>{mark('secureStore');return {kind:'HOST_DPAPI_SECRET_HANDLE',handle_id:'HOSTSECRET_A123456789'};},
  setRuntimeRolePasswordUsingHandle:async()=>{mark('db');return {decision:'PRODUCTION_ROLE_PASSWORD_SET'};},
  verifyRuntimeLoginUsingHandle:async()=>{mark('login');return {decision:'RUNTIME_LOGIN_VERIFIED_CUSTOM_ROLE'};},
  setVercelDatabaseUrlFromHandle:async()=>{mark('vercel');return {decision:'VERCEL_DATABASE_SECRET_APPLIED_ENCRYPTED'};},
  readbackVercelServerSide:async()=>{mark('vread');return {decision:'APP_DATABASE_SECRET_MATCHED_WITHOUT_DISCLOSURE'};},
  recordTerminalReceipt:async()=>{mark('receipt');return {
    decision:'SIGNED_COMPLETED_RECEIPT',receipt_id:ID,attempt_id:ID,source_authority:'THE_FA_ACTION_BROKER',state:'COMPLETED',provider_terminal_verified:true,action_id:ID,work_unit_id:request.work_unit_id,provider_operation_id:'supabase:cgrppxfdurpzzfvkmfte:'+ID,request_binding_hash:H,admission_receipt_hash:H,provider_receipt_hash:H,result_binding_hash:H};},
  recordUncertainResult:async()=>{mark('uncertain');return {decision:'RECORDED'};}
 };
 return {host:Object.assign(host,overrides),counter};
}
test('new exact P04 head is accepted only with matching manifest, Native receipt and fresh server evidence',async()=>{
 const request=structuredClone(REQ);request.fresh_source_head='b'.repeat(40);request.native_manifest.expected_head=request.fresh_source_head;
 const {host}=fixture({},request);
 assert.equal((await provisionRuntimeCredentialOnce({request,host})).status,'CREDENTIAL_LINK_COMPLETED');
});
test('unconsumed Native receipt cannot reach Broker claim or credentials',async()=>{
 const {host,counter}=fixture();const verify=host.verifyNativeReceiptFresh;
 host.verifyNativeReceiptFresh=async()=>({...await verify(),decision:'NATIVE_RECEIPT_VERIFIED_FRESH_UNCONSUMED'});
 assert.equal((await provisionRuntimeCredentialOnce({request:REQ,host})).status,'BLOCKED_OFFICIAL_ADMISSION_OR_PRIOR_RECEIPT');
 assert.equal(counter.reserve,undefined);assert.equal(counter.db,undefined);
});
test('another prior terminal does not substitute for the completed schema job',async()=>{
 const {host,counter}=fixture({verifyExistingWorkUnitTerminal:async()=>({decision:'PRIOR_INSTALL_AUTH_SCHEMA_COMPLETED',action_complete:true,work_unit_id:REQ.work_unit_id,receipt_id:ID})});
 assert.equal((await provisionRuntimeCredentialOnce({request:REQ,host})).status,'BLOCKED_OFFICIAL_ADMISSION_OR_PRIOR_RECEIPT');
 assert.equal(counter.db,undefined);
});
test('claim for another WorkUnit cannot provision a credential',async()=>{
 const {host,counter}=fixture();const reserve=host.reserveOnce;
 host.reserveOnce=async()=>({...await reserve(),work_unit_id:'dcjob-'+'b'.repeat(24)});
 assert.equal((await provisionRuntimeCredentialOnce({request:REQ,host})).status,'BLOCKED_EXCLUSIVE_BROKER_RESERVATION');
 assert.equal(counter.db,undefined);
});
test('arbitrary secret fields cannot escape the opaque handle boundary',async()=>{
 const {host,counter}=fixture({stageDpapiSecretHandle:async()=>({kind:'HOST_DPAPI_SECRET_HANDLE',handle_id:'HOSTSECRET_A123456789',token:'TEST_ONLY_SECRET'})});
 assert.equal((await provisionRuntimeCredentialOnce({request:REQ,host})).status,'BLOCKED_BEFORE_EXTERNAL_ACTION');
 assert.equal(counter.db,undefined);
});
test('terminal must match existing Broker action and hashes',async()=>{
 const {host,counter}=fixture();const record=host.recordTerminalReceipt;
 host.recordTerminalReceipt=async()=>({...await record(),action_id:'22222222-2222-4222-8222-222222222222'});
 assert.equal((await provisionRuntimeCredentialOnce({request:REQ,host})).status,'TERMINAL_RESULT_UNCERTAIN');
 assert.equal(counter.db,1);
});
test('credential service error details cannot leak through result or uncertainty logs',async()=>{
 const secret='TEST_ONLY_PRIVATE_PROVIDER_DETAIL',logged=[];
 const {host}=fixture({setRuntimeRolePasswordUsingHandle:async()=>{throw Object.assign(new Error(secret),{code:secret});},
  recordUncertainResult:async value=>{logged.push(value);}});
 const result=await provisionRuntimeCredentialOnce({request:REQ,host});
 assert.equal(result.status,'UNCERTAIN_WRITE_RECONCILE_REQUIRED');
 assert.equal(logged[0].reason_code,'HOST_ACTION_FAILED');
 assert.equal(JSON.stringify({result,logged}).includes(secret),false);
});
test('Production V2 legacy rows kept without implicit tenant rewrite',()=>{
 const result=classifyLegacyData(LEGACY);
 assert.equal(result.status,CUSTOMER_LEGACY_PRESERVATION);
 assert.equal(result.legacy_rows,11);
 assert.equal(result.incompatible_workspace_rows,11);
 assert.equal(result.migration_allowed,false);
 assert.equal(result.customer_v2_deleted,false);
});
test('No legacy rows means no migration instead of synthetic copy',()=>{
 const result=classifyLegacyData({...LEGACY,v2_states:0,v2_artifacts:0});
 assert.equal(result.status,'NO_LEGACY_ROWS');assert.equal(result.migration_allowed,false);
});
test('Staging readback rejected for production migration',()=>{
 assert.equal(classifyLegacyData({...LEGACY,project_ref:'furfjhymxqsbhvuyeqpx'}).status,'PRESERVATION_EVIDENCE_GAP');
});
test('Self-asserted source not accepted',()=>{
 assert.equal(classifyLegacyData({...LEGACY,observed_from_primary:false}).status,'PRESERVATION_EVIDENCE_GAP');
});
test('Invalid count rejected rather than truncated to zero',()=>{
 assert.equal(classifyLegacyData({...LEGACY,v2_states:-1}).status,'PRESERVATION_EVIDENCE_GAP');
});
test('Unknown eligibility count rejected',()=>{
 assert.equal(classifyLegacyData({...LEGACY,valid_tenant_states:null}).status,'PRESERVATION_EVIDENCE_GAP');
});
test('Strict runtime credentials stage only after authentic server authorization',async()=>{
 const {host,counter}=fixture();
 const result=await provisionRuntimeCredentialOnce({request:REQ,host});
 assert.equal(result.status,'CREDENTIAL_LINK_COMPLETED');
 assert.equal(result.terminal_receipt_id,ID);
 assert.equal(counter.db,1);assert.equal(counter.vercel,1);assert.equal(counter.receipt,1);
 assert.equal(result.production_alias_switched,false);
 assert.equal(result.provider_attempts,1);
 assert.equal(JSON.stringify(result).includes('HOSTSECRET'),false);
});
test('Unauthorized caller never provisions',async()=>{
 const {host,counter}=fixture({verifyCanonicalAuthority:async()=>({decision:'APPROVED'})});
 const result=await provisionRuntimeCredentialOnce({request:REQ,host});
 assert.equal(result.status,'BLOCKED_CORE_WRITER_FENCE_UNVERIFIED');
 assert.equal(counter.db??0,0);assert.equal(counter.reserve??0,0);
});
test('Wrong product/room fails before all external effects',async()=>{
 const {host,counter}=fixture();
 await assert.rejects(()=>provisionRuntimeCredentialOnce({request:{...REQ,project_key:'P02'},host}),/EXACT_P04_STAGE2_REQUEST_REQUIRED/);
 assert.equal(Object.keys(counter).length,0);
});
test('Reset usage is forbidden',async()=>{
 const {host}=fixture();
 await assert.rejects(()=>provisionRuntimeCredentialOnce({request:{...REQ,reset_usage_epoch:true},host}),/EXACT_P04_STAGE2_REQUEST_REQUIRED/);
});
test('Original job replay is forbidden',async()=>{
 const {host}=fixture();
 await assert.rejects(()=>provisionRuntimeCredentialOnce({request:{...REQ,original_job_policy:'REPLAY'},host}),/EXACT_P04_STAGE2_REQUEST_REQUIRED/);
});
test('Past Native receipt is explicitly rejected',async()=>{
 const {host}=fixture();
 await assert.rejects(()=>provisionRuntimeCredentialOnce({request:{...REQ,use_old_native_grant:true},host}),/EXACT_P04_STAGE2_REQUEST_REQUIRED/);
});
test('Prior schema must be formally terminal before credential stage',async()=>{
 const {host,counter}=fixture({verifyExistingWorkUnitTerminal:async()=>({decision:'PENDING'})});
 const result=await provisionRuntimeCredentialOnce({request:REQ,host});
 assert.equal(result.status,'BLOCKED_OFFICIAL_ADMISSION_OR_PRIOR_RECEIPT');
 assert.equal(counter.reserve??0,0);
});
test('GitHub changed after Core read blocks',async()=>{
 const {host,counter}=fixture({verifyFreshGitHubHead:async()=>({decision:'EXACT_FRESH_HEAD_MATCH',sha:'d'.repeat(40)})});
 const result=await provisionRuntimeCredentialOnce({request:REQ,host});
 assert.equal(result.status,'BLOCKED_OFFICIAL_ADMISSION_OR_PRIOR_RECEIPT');
 assert.equal(counter.db??0,0);
});
test('Original session conflict blocks',async()=>{
 const {host,counter}=fixture({verifyOriginalJobProtection:async()=>({decision:'RECONCILE_REQUIRED'})});
 const result=await provisionRuntimeCredentialOnce({request:REQ,host});
 assert.equal(result.status,'BLOCKED_OFFICIAL_ADMISSION_OR_PRIOR_RECEIPT');
 assert.equal(counter.reserve??0,0);
});
test('NativeHost signing requirement cannot be replaced by user boolean',async()=>{
 const {host,counter}=fixture({verifyNativeReceiptFresh:async()=>({decision:'NATIVE_RECEIPT_VERIFIED_FRESH_CONSUMED',verified:true})});
 const result=await provisionRuntimeCredentialOnce({request:REQ,host});
 assert.equal(result.status,'BLOCKED_OFFICIAL_ADMISSION_OR_PRIOR_RECEIPT');
 assert.equal(counter.reserve??0,0);
});
test('Existing attempt never executes again',async()=>{
 const {host,counter}=fixture({reserveOnce:async()=>({decision:'EXISTING_ATTEMPT'})});
 const result=await provisionRuntimeCredentialOnce({request:REQ,host});
 assert.equal(result.status,'EXISTING_ATTEMPT_RECONCILE_ONLY');
 assert.equal(counter.db??0,0);
});
test('Opaque handle containing raw password is refused before DB call',async()=>{
 const {host,counter}=fixture({stageDpapiSecretHandle:async()=>({kind:'HOST_DPAPI_SECRET_HANDLE',handle_id:'HOSTSECRET_A123456789',password:'UNSAFE'})});
 const result=await provisionRuntimeCredentialOnce({request:REQ,host});
 assert.equal(result.status,'BLOCKED_BEFORE_EXTERNAL_ACTION');
 assert.equal(counter.db??0,0);
});
test('Ambiguous DB role result never retries and is reconciled',async()=>{
 const {host,counter}=fixture({setRuntimeRolePasswordUsingHandle:async()=>{counter.db=(counter.db??0)+1;throw Error('NETWORK_TIMEOUT')}});
 const result=await provisionRuntimeCredentialOnce({request:REQ,host});
 assert.equal(result.status,'UNCERTAIN_WRITE_RECONCILE_REQUIRED');
 assert.equal(result.blind_retry_allowed,false);
 assert.equal(counter.db,1);assert.equal(counter.uncertain,1);assert.equal(counter.vercel??0,0);
});
test('Ambiguous Vercel result never retries DB or Vercel',async()=>{
 const {host,counter}=fixture({setVercelDatabaseUrlFromHandle:async()=>{counter.vercel=(counter.vercel??0)+1;throw Error('TIMEOUT')}});
 const result=await provisionRuntimeCredentialOnce({request:REQ,host});
 assert.equal(result.status,'UNCERTAIN_WRITE_RECONCILE_REQUIRED');
 assert.equal(counter.db,1);assert.equal(counter.vercel,1);assert.equal(counter.uncertain,1);
});
test('No official readback means no successful terminal',async()=>{
 const {host,counter}=fixture({readbackVercelServerSide:async()=>({decision:'WRONG_SECRET'})});
 const result=await provisionRuntimeCredentialOnce({request:REQ,host});
 assert.equal(result.status,'UNCERTAIN_WRITE_RECONCILE_REQUIRED');
 assert.equal(counter.receipt??0,0);
});
test('Wrong terminal attempt stays uncertain',async()=>{
 const {host}=fixture({recordTerminalReceipt:async()=>({decision:'SIGNED_COMPLETED_RECEIPT',attempt_id:'22222222-2222-4222-8222-222222222222'})});
 const result=await provisionRuntimeCredentialOnce({request:REQ,host});
 assert.equal(result.status,'TERMINAL_RESULT_UNCERTAIN');
});

test('Original Stage1 completed workunit cannot be reused as new Stage2',async()=>{
 const {host,counter}=fixture();
 await assert.rejects(()=>provisionRuntimeCredentialOnce({
  request:{...REQ,work_unit_id:'dcjob-69194412b00b2b45a2d50c91'},host
 }),/EXACT_P04_STAGE2_REQUEST_REQUIRED/);
 assert.equal(Object.keys(counter).length,0);
});
test('Native authorized operation whitelist excludes old invalid R70 operation',async()=>{
 const {host,counter}=fixture();
 await assert.rejects(()=>provisionRuntimeCredentialOnce({
  request:{...REQ,native_manifest:{...NATIVE_MANIFEST,
   operations:['PROVISION_CUSTOMER_RUNTIME_CREDENTIAL']}},host
 }),/EXACT_P04_STAGE2_REQUEST_REQUIRED/);
 assert.equal(Object.keys(counter).length,0);
});
test('Native manifest must include one owned-path artifact',async()=>{
 const {host,counter}=fixture();
 await assert.rejects(()=>provisionRuntimeCredentialOnce({
  request:{...REQ,native_manifest:{...NATIVE_MANIFEST,artifacts:[]}},host
 }),/EXACT_P04_STAGE2_REQUEST_REQUIRED/);
 assert.equal(Object.keys(counter).length,0);
});
test('Native receipt without matching digest blocks before provider reservation',async()=>{
 const {host,counter}=fixture({verifyNativeReceiptFresh:async()=>({
  source_authority:'THE_FA_NATIVEHOST_SERVER',
  decision:'NATIVE_RECEIPT_VERIFIED_FRESH_CONSUMED',
  receipt_id:ID,work_unit_id:REQ.work_unit_id,idempotency_key:REQ.idempotency_key,
  issued_at:new Date(Date.now()-1000).toISOString(),
  expires_at:new Date(Date.now()+300000).toISOString(),
  manifest_hash:'sha256:'+'0'.repeat(64),operation:'CONFIGURE_CUSTOMER_AUTH_ENV',
  room_instance:REQ.room_instance,repository:'good24c-sudo/thefa-core-site',
  head_sha:REQ.fresh_source_head
 })});
 const result=await provisionRuntimeCredentialOnce({request:REQ,host});
 assert.equal(result.status,'BLOCKED_OFFICIAL_ADMISSION_OR_PRIOR_RECEIPT');
 assert.equal(counter.reserve??0,0);
});
test('Missing official host method fails closed',async()=>{
 const {host}=fixture();delete host.reserveOnce;
 await assert.rejects(()=>provisionRuntimeCredentialOnce({request:REQ,host}),/EXISTING_OFFICIAL_HOST_METHOD_MISSING/);
});
