// Construct only in the trusted 4060 provider process with its existing
// authenticated /worker transport. This adapter never claims or mutates.
const ID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const HASH=/^sha256:[a-f0-9]{64}$/;
const fail=()=>{throw Object.assign(new Error('BROKER_CLAIM_READBACK_FAILED'),{code:'BROKER_CLAIM_READBACK_FAILED'});};
export function createStage2ClaimReadback({callServer,now=()=>Date.now()}){
 if(typeof callServer!=='function'||typeof now!=='function')fail();
 return async reserved=>{
  try{
   if(reserved?.decision!=='NEW_EXCLUSIVE_ATTEMPT'||!ID.test(reserved.action_id??'')||
    !ID.test(reserved.claim_id??'')||!ID.test(reserved.attempt_id??'')||!ID.test(reserved.receipt_id??'')||
    !/^dcjob-[a-f0-9]{24}$/.test(reserved.work_unit_id??''))fail();
   const row=await callServer('WORKER_VALIDATE',{action_id:reserved.action_id,claim_id:reserved.claim_id});
   if(row?.decision!=='WORKER_CLAIM_VERIFIED'||row.policy_state!=='CONSUMED'||
    row.consumer_role!=='thefa_core_receipt_consumer_v1')fail();
   for(const key of ['action_id','claim_id','attempt_id','receipt_id','work_unit_id',
    'provider_request_hash','provider_operation_id','request_binding_hash','admission_receipt_hash'])
    if(row[key]!==reserved[key])fail();
   for(const key of ['provider_request_hash','request_binding_hash','admission_receipt_hash'])
    if(!HASH.test(row[key]??''))fail();
   const expires=Date.parse(row.expires_at),observed=Date.parse(row.observed_at),consumed=Date.parse(row.consumed_at),t=now();
   if(![expires,observed,consumed,t].every(Number.isFinite)||expires<=t+5000||
    expires!==Date.parse(reserved.expires_at)||observed>t+1000||observed<t-30000||consumed>observed||consumed>=expires||
    row.provider_operation_id!=='supabase:cgrppxfdurpzzfvkmfte:'+row.action_id||
    JSON.stringify(row.manifest?.operations)!=='["CONFIGURE_CUSTOMER_AUTH_ENV"]'||
    row.manifest?.supabase_project_ref!=='cgrppxfdurpzzfvkmfte'||
    row.manifest?.vercel_project_id!=='prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo'||
    row.manifest?.environment!=='PRODUCTION'||row.manifest?.origin!=='https://thefacore.com'||
    row.manifest?.protected_session_id!=='111c339990e7926f4e8b226e'||
    row.manifest?.preserve_data!==true||row.manifest?.reset_usage_epoch!==false||row.manifest?.replay_original_job!==false||
    !/^[a-f0-9]{40}$/.test(row.manifest?.expected_head??'')||
    row.manifest?.expected_head!==row.core_binding?.head_sha)fail();
   // P04's five-method contract calls a validated existing-claim snapshot
   // WORKER_CLAIMED. This does not call WORKER_CLAIM or create another attempt.
   return {...row,decision:'WORKER_CLAIMED'};
  }catch{fail();}
 };
}
