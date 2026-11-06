import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

// Explicit TEST_ONLY adapters. No network, DB connections, real grants or Jobs.
// Stage dependencies from this exact checkout; never substitute another HEAD.
const here=path.dirname(fileURLToPath(import.meta.url)),candidate=path.dirname(here);
const dependency=candidate;
const stage=await mkdtemp(path.join(tmpdir(),'thefa-coordinator-test-'));
await mkdir(path.join(stage,'vendor/edge/thefa-founder-live-ingress-v1'),{recursive:true});
await copyFile(path.join(candidate,'customer-workunit.mjs'),path.join(stage,'customer-workunit.mjs'));
for(const name of ['customer-production.mjs','dedicated-pg.mjs','vendor/edge/thefa-founder-live-ingress-v1/contract.mjs'])
 await copyFile(path.join(dependency,name),path.join(stage,name));
const {createCustomerWorkUnitCoordinator,productionRequestHash}=await import(pathToFileURL(path.join(stage,'customer-workunit.mjs')).href);
after(async()=>{
 assert.equal(path.dirname(path.resolve(stage)),path.resolve(tmpdir()));
 assert.ok(path.basename(stage).startsWith('thefa-coordinator-test-'));
 await rm(stage,{recursive:true,force:true});
});
const id='11111111-1111-4111-8111-111111111111',action='22222222-2222-4222-8222-222222222222';
const receipt='33333333-3333-4333-8333-333333333333',attempt='44444444-4444-4444-8444-444444444444';
const h=n=>'sha256:'+String(n).repeat(64),head='a'.repeat(40),T=Date.parse('2026-11-06T06:00:00.000Z');
const sha=v=>createHash('sha256').update(v).digest('hex');
let counter=0;
async function fixture(){
 const artifactRoot=path.join(stage,'artifacts-'+(++counter));await mkdir(path.join(artifactRoot,'sql'),{recursive:true});
 await writeFile(path.join(artifactRoot,'sql/auth.sql'),'-- fixture\n');
 const binding={operation_kind:'CUSTOMER_PRODUCTION_AUTH',target_environment:'PRODUCTION',project_key:'P04',room_family:'00',
  room_instance:'00_v25',workstream_key:'THE_FA_CORE_CUSTOMER_LAUNCH_V1',repository:'good24c-sudo/thefa-core-site',
  branch:'codex/core-customer-launch-v1-20261029',head_sha:head,idempotency_key:'TEST_STAGE_123',writer_id:'TEST_ONLY_WRITER',
  fencing_generation:1,owned_paths:['customer-public/**','infra/customer-launch/**','docs/customer-launch/**'],
  work_identity_binding_hash:h('b'),writer_lease_idempotency_key:'TEST_LEASE',writer_lease_work_key:'TEST_WORK'};
 const manifest={contract:'THE_FA_CUSTOMER_PRODUCTION_AUTH_V1',action:'CUSTOMER_AUTH_PRODUCTION_CUTOVER',environment:'PRODUCTION',
  supabase_project_ref:'cgrppxfdurpzzfvkmfte',vercel_project_id:'prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo',origin:'https://thefacore.com',
  operations:['INSTALL_AUTH_SCHEMA'],preserve_data:true,reset_usage_epoch:false,replay_original_job:false,
  protected_session_id:'111c339990e7926f4e8b226e',expected_head:head,idempotency_key:'TEST_STAGE_123',
  artifacts:[{operation:'INSTALL_AUTH_SCHEMA',path:'sql/auth.sql',sha256:sha('-- fixture\n')}]};
 const input={receiptId:id,manifest,binding,artifactRoot},events=[];
 const db={decision:'CUSTOMER_PRODUCTION_RECEIPT_DATABASE_EVIDENCE',state:'CONSUMED',receipt_id:id,receipt_hash:h('c'),
  payload_hash:productionRequestHash(manifest),manifest_hash:productionRequestHash(manifest),context_hash:h('d'),
  idempotency_key:manifest.idempotency_key,binding:structuredClone(binding),target:structuredClone(manifest),
  registered_at:new Date(T-2000).toISOString(),consumed_at:new Date(T-1000).toISOString(),expires_at:new Date(T+90000).toISOString(),
  consumer_role:'thefa_core_receipt_consumer_v1',write_allowed:false,
  authority_boundary:'DATABASE_EVIDENCE_ONLY_NOT_EXECUTION_OR_TERMINAL_RECEIPT'};
 let request,state='PREPARED';
 const mutable={time:T,dispatchEdit:null,statusEdit:null,receiptEdit:null,afterPrepare:null,executeError:null,
  fakeExecuteSuccess:false,authorityEdit:null,readbackError:null};
 const broker={
  readDispatch:async()=>{events.push('dispatch');const d={action_id:action,prepared_action_hash:h('e'),intent_hash:h('f'),state,
   context_lease_id:'test-context-lease',work_identity_binding_hash:binding.work_identity_binding_hash,
   adapter_instance_id:'test-adapter-123',adapter_epoch:1,action_type:request?.action_type??'RISKY_OPERATIONAL_DATA_CHANGE',
   risk_class:'RED',target_provider:'SUPABASE',idempotency_key:manifest.idempotency_key,expected_parent_head:null,
   owned_paths:structuredClone(binding.owned_paths),intent:structuredClone(request?.intent)};
   mutable.dispatchEdit?.(d);return d;},
  readback:async()=>{events.push('status');const s={action_id:action,prepared_action_hash:h('e'),work_identity_binding_hash:binding.work_identity_binding_hash,
   action_type:'RISKY_OPERATIONAL_DATA_CHANGE',target_provider:'SUPABASE',risk_class:'RED',state,blind_redispatch_allowed:false,
   verified_receipt_required_for_completion:true,
   authority_receipt_hash:h('1'),fencing_generation:1,fresh_source_binding_hash:h('2'),result_binding_hash:h('3'),
   completed_at:new Date(T).toISOString()};mutable.statusEdit?.(s);return s;},
  readProviderReceipt:async()=>{events.push('provider-receipt');const r={action_id:action,receipt_id:receipt,attempt_id:attempt,
   provider:'SUPABASE',provider_operation_id:'TEST_ONLY_OPERATION',provider_request_hash:h('4'),provider_receipt_hash:h('5'),
   result_binding_hash:h('3'),authority_receipt_hash:h('1'),fencing_generation:1};mutable.receiptEdit?.(r);return r;},
 };
 const config={receiptTransport:{readback:async()=>{events.push('database');if(mutable.readbackError)throw mutable.readbackError;return structuredClone(db);}},
  broker,readFreshAuthority:async()=>{events.push('authority');const r={binding:structuredClone(binding),write_sealed:false,
   observed_at:new Date(mutable.time).toISOString()};mutable.authorityEdit?.(r);return r;},
  contextLeaseId:'test-context-lease',runtimeIdentity:{adapter_instance_id:'test-adapter-123',adapter_epoch:1},adapterProvider:'CODEX',
  route:{operation:'INSTALL_AUTH_SCHEMA',target_provider:'SUPABASE',action_type:'RISKY_OPERATIONAL_DATA_CHANGE'},mode:'fixture',now:()=>new Date(mutable.time)};
 return {input,db,config,events,mutable,broker,make:()=>createCustomerWorkUnitCoordinator(config),setReadback:(r,s='COMPLETED')=>{request=structuredClone(r);state=s;}};
}

test('missing trusted evidence adapters blocks without a Work Unit',async()=>{
 const r=await createCustomerWorkUnitCoordinator().prepareBinding({verified:true});
 assert.equal(r.decision,'BLOCKED_OFFICIAL_ADAPTER_NOT_CONNECTED');assert.equal(r.write_allowed,false);
});
test('public API has only read-only binding and inspect, external mutations remain zero',async()=>{
 const f=await fixture();let mutations=0;
 f.config.broker.prepare=f.config.broker.execute=async()=>{mutations++;throw Error('MUTATION_FORBIDDEN');};
 const api=f.make();assert.deepEqual(Object.keys(api).sort(),['inspect','prepareBinding']);
 const r=await api.prepareBinding(f.input);
 assert.equal(r.decision,'ADMISSION_BINDING_READY_WORK_UNIT_REQUIRED');assert.equal(mutations,0);
 assert.equal(r.write_allowed,false);assert.equal(r.work_unit_accepted,false);assert.equal(r.development_complete,false);
 assert.equal(r.provider_terminal_verified,false);assert.equal('work_unit_id' in r,false);
 assert.deepEqual(f.events,['database','authority','database','authority']);
 assert.equal(r.broker_prepare_request.intent.production_admission.receipt_id,id);
 assert.equal(r.request_binding_hash,productionRequestHash(r.broker_prepare_request));
});
test('builder requires no mutation or broker adapter',async()=>{
 const f=await fixture();delete f.config.broker;
 assert.equal((await f.make().prepareBinding(f.input)).decision,'ADMISSION_BINDING_READY_WORK_UNIT_REQUIRED');
});
test('request commitment binds target, artifact, receipt and fence',async()=>{
 const f=await fixture(),r=await f.make().prepareBinding(f.input),req=r.broker_prepare_request;
 for(const mutate of [r=>r.intent.manifest.supabase_project_ref='other',r=>r.intent.manifest.artifacts[0].sha256='0'.repeat(64),
  r=>r.intent.production_admission.receipt_hash=h('0'),r=>r.intent.core_binding.fencing_generation=2]){
  const changed=structuredClone(req);mutate(changed);assert.notEqual(productionRequestHash(changed),r.request_binding_hash);
 }
});
test('supplied verified is rejected',async()=>{
 const f=await fixture(),r=await f.make().prepareBinding({...f.input,verified:true});
 assert.equal(r.decision,'BLOCKED_EVIDENCE_NOT_VERIFIED');assert.equal(f.events.length,0);
});
for(const [name,mutate] of [
 ['not-consumed',d=>d.state='ISSUED'],['writer',d=>d.binding.writer_id='other'],['fence',d=>d.binding.fencing_generation=2],
 ['HEAD',d=>d.binding.head_sha='b'.repeat(40)],['target',d=>d.target.supabase_project_ref='other'],['hash',d=>d.payload_hash=h('0')],
 ['consumer-role',d=>d.consumer_role='postgres'],['write-allowed',d=>d.write_allowed=true],
 ['expired',d=>d.expires_at=new Date(T-1).toISOString()],['bad-time',d=>d.consumed_at='bad'],
 ['consumed-after-expiry',d=>d.consumed_at=d.expires_at],['boundary',d=>d.authority_boundary='verified']]){
 test('database evidence rejects '+name,async()=>{const f=await fixture();mutate(f.db);
  const r=await f.make().prepareBinding(f.input);assert.equal(r.decision,'BLOCKED_EVIDENCE_NOT_VERIFIED');assert.equal(r.write_allowed,false);});
}
for(const [name,mutate] of [
 ['manifest',f=>{f.input.manifest.origin='https://other.example';}],
 ['artifact',async f=>{await writeFile(path.join(f.input.artifactRoot,'sql/auth.sql'),'tampered');}]]){
 test('actual '+name+' tamper blocks binding',async()=>{const f=await fixture();await mutate(f);
  assert.equal((await f.make().prepareBinding(f.input)).decision,'BLOCKED_EVIDENCE_NOT_VERIFIED');});
}
for(const [name,mutate] of [
 ['artifact',async f=>writeFile(path.join(f.input.artifactRoot,'sql/auth.sql'),'changed')],
 ['expired',async f=>{f.mutable.time=T+100000;}],
 ['receipt',async f=>{f.db.receipt_hash=h('8');}]]){
 test('recheck rejects changed '+name,async()=>{
  const f=await fixture(),original=f.config.readFreshAuthority;let calls=0;
  f.config.readFreshAuthority=async x=>{const r=await original(x);if(++calls===1)await mutate(f);return r;};
  assert.equal((await f.make().prepareBinding(f.input)).decision,'BLOCKED_EVIDENCE_NOT_VERIFIED');
 });
}
for(const [name,mutate] of [
 ['sealed',a=>a.write_sealed=true],['head',a=>a.binding.head_sha='b'.repeat(40)],
 ['fence',a=>a.binding.fencing_generation=99],['stale',a=>a.observed_at=new Date(T-31000).toISOString()]]){
 test('fresh authority rejects '+name,async()=>{const f=await fixture();f.mutable.authorityEdit=mutate;
  assert.equal((await f.make().prepareBinding(f.input)).decision,'BLOCKED_EVIDENCE_NOT_VERIFIED');});
}
test('ambiguous readback is sanitized, never retries or writes',async()=>{
 const f=await fixture();f.mutable.readbackError=Error('sensitive internal error');
 const r=await f.make().prepareBinding(f.input);assert.equal(r.reason,'SANITIZED_COORDINATOR_FAILURE');
 assert.deepEqual(f.events,['database']);assert.equal(r.write_allowed,false);
});
test('repeated builder is read-only and never claims duplicate execution',async()=>{
 const f=await fixture(),api=f.make(),a=await api.prepareBinding(f.input),b=await api.prepareBinding(f.input);
 assert.equal(a.request_binding_hash,b.request_binding_hash);assert.equal(b.work_unit_accepted,false);
 assert.ok(f.events.every(e=>['database','authority'].includes(e)));
});
test('historical inspect after expiry reads existing exact terminal evidence only',async()=>{
 const f=await fixture(),api=f.make(),b=await api.prepareBinding(f.input);f.setReadback(b.broker_prepare_request);f.mutable.time=T+100000;
 f.events.length=0;const r=await api.inspect(f.input,action);
 assert.equal(r.decision,'FIXTURE_PROVIDER_TERMINAL_CHECKS_PASSED');assert.equal(r.provider_terminal_verified,false);
 assert.equal(r.work_unit_accepted,false);assert.equal(r.write_allowed,false);
 assert.deepEqual(f.events,['database','dispatch','dispatch','status','provider-receipt']);
});
for(const [name,edit] of [
 ['dispatch-target',f=>f.mutable.dispatchEdit=d=>{d.target_provider='CORE';}],
 ['dispatch-intent',f=>f.mutable.dispatchEdit=d=>{d.intent.manifest.origin='https://other.example';}],
 ['status-action',f=>f.mutable.statusEdit=s=>{s.action_id=id;}],
 ['status-state',f=>f.mutable.statusEdit=s=>{s.state='PREPARED';}],
 ['terminal-required',f=>f.mutable.statusEdit=s=>{s.verified_receipt_required_for_completion=false;}],
 ['result',f=>f.mutable.receiptEdit=r=>{r.result_binding_hash=h('9');}],
 ['fence',f=>f.mutable.receiptEdit=r=>{r.fencing_generation=2;}],
 ['provider',f=>f.mutable.receiptEdit=r=>{r.provider='CORE';}]]){
 test('inspect rejects mismatched '+name,async()=>{
  const f=await fixture(),api=f.make(),b=await api.prepareBinding(f.input);f.setReadback(b.broker_prepare_request);edit(f);
  assert.equal((await api.inspect(f.input,action)).decision,'BLOCKED_TERMINAL_EVIDENCE_NOT_VERIFIED');
 });
}
test('pending provider cannot become completion',async()=>{
 const f=await fixture(),api=f.make(),b=await api.prepareBinding(f.input);f.setReadback(b.broker_prepare_request,'PREPARED');
 const r=await api.inspect(f.input,action);assert.equal(r.decision,'PROVIDER_TERMINAL_PENDING');assert.equal(r.provider_terminal_verified,false);
});
test('unsupported Vercel/CORE route is blocked',async()=>{
 const f=await fixture();f.config.route.target_provider='CORE';
 assert.equal((await f.make().prepareBinding(f.input)).decision,'BLOCKED_EVIDENCE_NOT_VERIFIED');
});
