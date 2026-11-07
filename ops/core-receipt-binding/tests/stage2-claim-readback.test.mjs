import test from 'node:test';
import assert from 'node:assert/strict';
import {createStage2ClaimReadback} from '../runtime/stage2-claim-readback.mjs';
const id='11111111-1111-4111-8111-111111111111',hash='sha256:'+'a'.repeat(64),t=Date.parse('2026-11-07T06:00:00Z');
const reserved={decision:'NEW_EXCLUSIVE_ATTEMPT',action_id:id,claim_id:id,attempt_id:id,receipt_id:id,
 work_unit_id:'dcjob-'+'a'.repeat(24),provider_request_hash:hash,request_binding_hash:hash,admission_receipt_hash:hash,
 provider_operation_id:'supabase:cgrppxfdurpzzfvkmfte:'+id,expires_at:new Date(t+60000).toISOString()};
const row=()=>({...reserved,decision:'WORKER_CLAIM_VERIFIED',policy_state:'CONSUMED',consumer_role:'thefa_core_receipt_consumer_v1',
 observed_at:new Date(t).toISOString(),consumed_at:new Date(t-1000).toISOString(),core_binding:{head_sha:'a'.repeat(40)},
 manifest:{operations:['CONFIGURE_CUSTOMER_AUTH_ENV'],supabase_project_ref:'cgrppxfdurpzzfvkmfte',vercel_project_id:'prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo',
 environment:'PRODUCTION',origin:'https://thefacore.com',protected_session_id:'111c339990e7926f4e8b226e',
 preserve_data:true,reset_usage_epoch:false,replay_original_job:false,expected_head:'a'.repeat(40)}});
test('existing authenticated claim is read once and never reserved again',async()=>{
 const calls=[],read=createStage2ClaimReadback({now:()=>t,callServer:async(...args)=>{calls.push(args);return row();}});
 const result=await read(reserved);
 assert.equal(result.decision,'WORKER_CLAIMED');
 assert.deepEqual(calls,[['WORKER_VALIDATE',{action_id:id,claim_id:id}]]);
});
for(const [name,patch] of Object.entries({claim:{claim_id:'22222222-2222-4222-8222-222222222222'},
 attempt:{attempt_id:'22222222-2222-4222-8222-222222222222'},receipt:{receipt_id:'22222222-2222-4222-8222-222222222222'},
 hash:{request_binding_hash:'sha256:'+'b'.repeat(64)},unconsumed:{policy_state:'ISSUED'},
 expired:{expires_at:new Date(t-1).toISOString()},stale:{observed_at:new Date(t-31000).toISOString()},
 changedHead:{core_binding:{head_sha:'b'.repeat(40)}},wrongOperation:{manifest:{...row().manifest,operations:['INSTALL_AUTH_SCHEMA']}}})){
 test('rejects '+name+' before host credential effects',async()=>{
  const read=createStage2ClaimReadback({now:()=>t,callServer:async()=>({...row(),...patch})});
  await assert.rejects(read(reserved),/BROKER_CLAIM_READBACK_FAILED/);
 });
}
test('upstream credential-bearing errors are sanitized',async()=>{
 const read=createStage2ClaimReadback({callServer:async()=>{throw Error('TEST_ONLY_PRIVATE_VALUE');}});
 await assert.rejects(read(reserved),e=>e.message==='BROKER_CLAIM_READBACK_FAILED'&&!String(e).includes('PRIVATE_VALUE'));
});
