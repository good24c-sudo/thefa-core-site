import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {executeProviderOnce,buildSchemaSql,SQL_SHA,CATALOG_QUERY} from '../runtime/provider-host.mjs';
import {canonicalJson} from '../vendor/edge/thefa-founder-live-ingress-v1/contract.mjs';

// TEST_ONLY transport/catalog/claim fixtures. No network, DB, CLI or real grants.
// These compressed nonsecret reviewed DDL bytes make the artifact hash test
// self-contained. Their presence is not an approval or live installation receipt.
const reviewedDdl=[{"path":"create-customer-runtime-role.sql","gzip":"H4sIAAAAAAAC/3WQQWvjMBSE7/4Vcyhk95BAz2EPiv3aCBQpSDJtTkI4Igk4lpGd3fbfV0p3e1jobRBvZr7Rcgl6890MP44p/g5HdLdpjteQkG7DfLkGpNgHxKF/X0FGjH6a/sR0REzofN/nw1Pyw4xzSGFVLZdg49i/3w2YzyneTmf423wOOa3zc27g0lgmhGOt3TpTb2nH4I/XyzRd4rCqGoWHfxCulD9UG3rmsgL4E+iVG2vww5Cg2uIRT1rtMJ5czvZ9PK2yLKYJL1vSVOgHfw2/Fl1MwX3lFiL3d+HiJ+yWSj6gGTeUS2raW64kFnVrrNqRdrqVlu/IaSXIMaGJNQf3SeM01UrWXNBinVNINpm0qDpfWUKx4Pt+CJXnQSrT7km3hnTWn9Zm8yVLyB1RKk17wWt2B5Rqc9gzY7QwWXOZR3OL8vKidAPZCrGuMtG6+u9T19UH8xshdPwBAAA="},{"path":"supabase/migrations/20261106060123_customer_auth_production_preserved.sql","gzip":"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"}];
const sha=s=>createHash('sha256').update(s).digest('hex'),h=v=>'sha256:'+sha(canonicalJson(v));
const action='11111111-1111-4111-8111-111111111111',claimId='22222222-2222-4222-8222-222222222222';
const HEAD='a'.repeat(40),T=Date.parse('2026-11-06T06:00:00Z');
const tables=[['core_customer_auth','user'],['core_customer_auth','account'],['core_customer_auth','session'],['core_customer_auth','verification'],
 ['public','core_console_state_v3'],['public','core_console_artifacts_v3']].map(([schema,name])=>({schema,name,rls_enabled:true,force_rls:true}));
async function fixture(t,options={}){
 const stage=await mkdtemp(path.join(tmpdir(),'thefa-provider-fixture-'));
 t.after(async()=>{assert.equal(path.dirname(path.resolve(stage)),path.resolve(tmpdir()));
  assert.ok(path.basename(stage).startsWith('thefa-provider-fixture-'));await rm(stage,{recursive:true,force:true});});
 const artifactRoot=path.join(stage,'artifacts'),evidenceRoot=path.join(stage,'evidence');await mkdir(artifactRoot);
 const artifacts=[];
 for(const f of reviewedDdl){const bytes=gunzipSync(Buffer.from(f.gzip,'base64')),dest=path.join(artifactRoot,f.path);
  await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,bytes);artifacts.push({operation:'INSTALL_AUTH_SCHEMA',path:f.path,sha256:sha(bytes)});}
 const binding={operation_kind:'CUSTOMER_PRODUCTION_AUTH',target_environment:'PRODUCTION',project_key:'P04',room_family:'00',room_instance:'00_v25',
  workstream_key:'THE_FA_CORE_CUSTOMER_LAUNCH_V1',repository:'good24c-sudo/thefa-core-site',branch:'codex/core-customer-launch-v1-20261029',
  head_sha:HEAD,idempotency_key:'TEST_ONLY_SCHEMA_STAGE',fencing_generation:1};
 const manifest={contract:'THE_FA_CUSTOMER_PRODUCTION_AUTH_V1',action:'CUSTOMER_AUTH_PRODUCTION_CUTOVER',environment:'PRODUCTION',
  supabase_project_ref:'cgrppxfdurpzzfvkmfte',vercel_project_id:'prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo',origin:'https://thefacore.com',
  operations:['INSTALL_AUTH_SCHEMA'],preserve_data:true,reset_usage_epoch:false,replay_original_job:false,
  protected_session_id:'111c339990e7926f4e8b226e',expected_head:HEAD,idempotency_key:binding.idempotency_key,artifacts};
 const packet={manifest,core_binding:binding};
 const claim={decision:'WORKER_CLAIMED',action_id:action,claim_id:claimId,manifest:structuredClone(manifest),core_binding:structuredClone(binding),
  work_unit_id:'dcjob-'+'a'.repeat(24),receipt_id:'33333333-3333-4333-8333-333333333333',admission_receipt_hash:'sha256:'+'b'.repeat(64),
  request_binding_hash:'sha256:'+'c'.repeat(64),provider_request_hash:'sha256:'+'d'.repeat(64),authority_receipt_hash:'sha256:'+'e'.repeat(64),
  provider_operation_id:'supabase:cgrppxfdurpzzfvkmfte:'+action,expires_at:new Date(T+120000).toISOString(),...options.claimPatch};
 const catalog={project_ref:'cgrppxfdurpzzfvkmfte',tables,runtime_role:{name:'core_customer_auth_runtime',can_login:true,superuser:false,
  bypass_rls:false,create_db:false,create_role:false,replication:false,password_is_null:true}};
 const calls=[],queries=[];
 const callServer=async(mode,payload)=>{
  calls.push({mode,payload});
  if(mode==='WORKER_CLAIM'){
   if(options.claimThrow)throw Error('TEST_ERROR_WITH_SECRET=never_print');
   if(options.onClaim)await options.onClaim({artifactRoot,manifest,binding});return claim;
  }
  assert.equal(mode,'WORKER_RESULT');
  if(options.resultBlocked)return {decision:'BLOCKED_PROVIDER_READBACK'};
  if(options.resultThrow)throw Error('SIMULATED_RESULT_TIMEOUT');
  const receiptBody={kind:'VERIFIED_RECEIPT',provider:'SUPABASE',action_id:action,claim_id:claimId,work_unit_id:claim.work_unit_id,
   admission_receipt_hash:claim.admission_receipt_hash,provider_operation_id:claim.provider_operation_id,
   provider_request_hash:claim.provider_request_hash,authority_receipt_hash:claim.authority_receipt_hash,fencing_generation:binding.fencing_generation,
   receipt_metadata:{sql_sha256:SQL_SHA,payload_hash:h(manifest),catalog_hash:h(payload.readback),observed_at:payload.observed_at,work_unit_id:claim.work_unit_id}};
  const provider_receipt_hash=h(receiptBody),result_binding_hash=h({action_id:action,work_unit_id:claim.work_unit_id,
   provider_receipt_hash,request_binding_hash:claim.request_binding_hash});
  return {decision:'PROVIDER_RESULT_RECORDED',...receiptBody,provider_receipt_hash,result_binding_hash,...options.recordedPatch};
 };
 const query=async(sql,meta)=>{
  queries.push({sql,kind:meta.kind});
  if(meta.kind==='mutation'){assert.equal(sha(sql),SQL_SHA);if(options.queryThrow)throw Error('TEST_PROVIDER_UNKNOWN');return null;}
  assert.equal(sql,CATALOG_QUERY);if(options.readbackThrow)throw Error('TEST_READBACK_UNKNOWN');
  return options.missingReadback?[]:[{readback:catalog}];
 };
 const args={actionId:action,packet,artifactRoot,evidenceRoot,callServer,query,now:options.now??(()=>new Date(T))};
 return {args,packet,claim,calls,queries,stage,artifactRoot,evidenceRoot};
}

test('reviewed nonsecret DDL builds the exact approved transaction SHA',async t=>{
 const f=await fixture(t);assert.equal(sha(buildSchemaSql(f.artifactRoot)),SQL_SHA);
 assert.equal(SQL_SHA,'c99cfb73d997a82e44819cd048513acc112ee5e359a5ceb830ed139291f4cab3');
});
test('TEST_ONLY success performs one mutation and a separate catalog query',async t=>{
 const f=await fixture(t),r=await executeProviderOnce(f.args);
 assert.equal(r.decision,'PROVIDER_RESULT_RECORDED');assert.equal(r.development_complete,false);assert.equal(r.original_job_replayed,false);
 assert.deepEqual(f.queries.map(x=>x.kind),['mutation','readback']);assert.deepEqual(f.calls.map(x=>x.mode),['WORKER_CLAIM','WORKER_RESULT']);
 const intent=JSON.parse(await readFile(path.join(f.evidenceRoot,action,'execute-intent.json'),'utf8'));assert.equal(intent.sql_sha256,SQL_SHA);
});
test('changed artifact is rejected before claim',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.artifactRoot,'create-customer-runtime-role.sql'),'-- changed');
 await assert.rejects(executeProviderOnce(f.args),/ARTIFACT/);assert.equal(f.calls.length,0);assert.equal(f.queries.length,0);
});
test('different production target is rejected before claim',async t=>{
 const f=await fixture(t);f.packet.manifest.supabase_project_ref='different';
 await assert.rejects(executeProviderOnce(f.args),/EXACT_CUSTOMER_SCHEMA_STAGE_REQUIRED/);assert.equal(f.calls.length,0);
});
test('unsupported stage and unsafe action id cannot dispatch',async t=>{
 const f=await fixture(t);f.packet.manifest.operations=['CONFIGURE_CUSTOMER_AUTH_ENV'];
 await assert.rejects(executeProviderOnce(f.args),/EXACT_CUSTOMER_SCHEMA_STAGE_REQUIRED/);
 await assert.rejects(executeProviderOnce({...f.args,actionId:'../elsewhere'}),/EXACT_PROVIDER_INPUT_REQUIRED/);assert.equal(f.calls.length,0);
});
for(const patch of [{expires_at:new Date(T-1).toISOString()},{action_id:'44444444-4444-4444-8444-444444444444'},
 {provider_operation_id:'supabase:wrong:'+action},{decision:'BLOCKED_WORKER_ALREADY_CLAIMED'}]){
 test('inexact or expired server claim prevents provider effect '+JSON.stringify(patch),async t=>{
  const f=await fixture(t,{claimPatch:patch}),r=await executeProviderOnce(f.args);
  assert.equal(r.decision,'PROVIDER_RECONCILIATION_REQUIRED');assert.equal(r.mutation_attempted,false);assert.equal(f.queries.length,0);
 });
}
test('artifact changing after server claim never executes',async t=>{
 const f=await fixture(t,{onClaim:async({artifactRoot})=>writeFile(path.join(artifactRoot,'create-customer-runtime-role.sql'),'-- race')}),r=await executeProviderOnce(f.args);
 assert.equal(r.decision,'PROVIDER_RECONCILIATION_REQUIRED');assert.equal(r.mutation_attempted,false);assert.equal(f.queries.length,0);
});
test('expiry at the last pre-effect check prevents mutation',async t=>{
 let times=0;const f=await fixture(t,{now:()=>new Date(++times>=3?T+150000:T)}),r=await executeProviderOnce(f.args);
 assert.equal(r.decision,'PROVIDER_RECONCILIATION_REQUIRED');assert.equal(r.mutation_attempted,false);assert.equal(f.queries.length,0);
});
test('lost claim response is durable and never automatically retried',async t=>{
 const f=await fixture(t,{claimThrow:true}),r=await executeProviderOnce(f.args);
 assert.equal(r.mutation_attempted,false);assert.equal(r.retry_allowed,false);assert.ok(!JSON.stringify(r).includes('SECRET'));
 await assert.rejects(executeProviderOnce(f.args),/EXISTING_CLAIM_READBACK_ONLY/);assert.equal(f.calls.length,1);
});
test('uncertain SQL effect never reruns mutation or reports completion',async t=>{
 const f=await fixture(t,{queryThrow:true}),r=await executeProviderOnce(f.args);
 assert.equal(r.decision,'PROVIDER_RECONCILIATION_REQUIRED');assert.equal(r.mutation_attempted,true);assert.equal(r.retry_allowed,false);
 assert.deepEqual(f.queries.map(x=>x.kind),['mutation']);await assert.rejects(executeProviderOnce(f.args),/EXISTING_CLAIM_READBACK_ONLY/);
 assert.equal(f.queries.length,1);
});
for(const option of [{readbackThrow:true},{missingReadback:true},{resultBlocked:true},{resultThrow:true},
 {recordedPatch:{provider_receipt_hash:'sha256:'+'f'.repeat(64)}},{recordedPatch:{action_id:'44444444-4444-4444-8444-444444444444'}}]){
 test('unverified provider result remains reconciliation required '+JSON.stringify(option),async t=>{
  const f=await fixture(t,option),r=await executeProviderOnce(f.args);
  assert.equal(r.decision,'PROVIDER_RECONCILIATION_REQUIRED');assert.equal(r.mutation_attempted,true);assert.equal(r.retry_allowed,false);
  assert.equal(f.queries.filter(x=>x.kind==='mutation').length,1);
 });
}
test('two concurrent local invocations cannot repeat the provider mutation',async t=>{
 const f=await fixture(t),r=await Promise.allSettled([executeProviderOnce(f.args),executeProviderOnce(f.args)]);
 assert.equal(r.filter(x=>x.status==='fulfilled'&&x.value.decision==='PROVIDER_RESULT_RECORDED').length,1);
 assert.equal(f.calls.filter(x=>x.mode==='WORKER_CLAIM').length,1);assert.equal(f.queries.filter(x=>x.kind==='mutation').length,1);
});
