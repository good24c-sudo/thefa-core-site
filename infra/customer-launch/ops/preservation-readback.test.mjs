import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PRESERVED_TABLES,PRESERVATION_SQL,readCustomerPreservation,assertCustomerPreserved} from './preservation-readback.mjs';
import {TARGET} from './credential-io.mjs';

function fixture(){
  const baseline={project_ref:TARGET.project,database:'postgres',primary:true,security_sha256:'1'.repeat(64),
    tables:PRESERVED_TABLES.map(table_name=>({table_name,row_count:table_name.endsWith('_v2')?1:0,rowset_sha256:'2'.repeat(64)}))};
  const plan={contract:'P04_CUSTOMER_CREDENTIAL_PRESERVATION_V1',project_ref:TARGET.project,account_mode:'legacy-preserved',
    preserve_v2:true,reset_usage_epoch:false,baseline};
  const artifactBytes=Buffer.from(JSON.stringify(plan));
  const claim={decision:'WORKER_CLAIMED',manifest:{artifacts:[{operation:'CONFIGURE_CUSTOMER_AUTH_ENV',
    sha256:createHash('sha256').update(artifactBytes).digest('hex')}]}};
  const current=structuredClone(baseline);let queries=0;
  const io={query:async sql=>{assert.equal(sql,PRESERVATION_SQL);queries++;return [{preservation:current}];}};
  return {io,claim,artifactBytes,current,get queries(){return queries;}};
}
test('exact signed-input bytes plus actual readback prove only data/security, never admission',async()=>{
  const f=fixture(),r=await assertCustomerPreserved(f);
  assert.equal(r.data_and_security_unchanged,true);assert.equal(r.authority_granted,false);
  assert.equal(r.backup_verified,false);assert.equal(r.production_cutover,false);assert.equal(f.queries,1);
});
test('external filename or changed bytes cannot substitute for the bound plan',async()=>{
  const f=fixture();await assert.rejects(assertCustomerPreserved({...f,artifactBytes:'external.json'}),/SIGNED_PRESERVATION/);
  await assert.rejects(assertCustomerPreserved({...f,artifactBytes:Buffer.concat([f.artifactBytes,Buffer.from(' ')])}),/SIGNED_PRESERVATION/);
  assert.equal(f.queries,0);
});
test('same row count with changed allowance/customer contents blocks',async()=>{
  const f=fixture();f.current.tables.find(r=>r.table_name==='public.core_console_state_v2').rowset_sha256='3'.repeat(64);
  await assert.rejects(assertCustomerPreserved(f),/DATA_OR_ALLOWANCE_CHANGED/);
});
test('removed artifacts and security changes independently block',async()=>{
  const f=fixture();f.current.tables[4].row_count=0;await assert.rejects(assertCustomerPreserved(f),/DATA_OR_ALLOWANCE_CHANGED/);
  const g=fixture();g.current.security_sha256='4'.repeat(64);await assert.rejects(assertCustomerPreserved(g),/SECURITY_CHANGED/);
});
test('missing, duplicated, truncated or replica readbacks fail closed',async()=>{
  for(const mutate of [s=>s.tables.pop(),s=>s.tables[1]=s.tables[0],s=>s.primary=false,s=>s.tables[0].row_count='1',s=>s.security_sha256='']){
    const f=fixture();mutate(f.current);await assert.rejects(readCustomerPreservation(f.io),/COMPLETE_PRIMARY/);
  }
});
test('fresh-launch, reset and V2 deletion plans cannot pass even with matching hashes',async()=>{
  for(const change of [{account_mode:'fresh-launch'},{reset_usage_epoch:true},{preserve_v2:false}]){
    const f=fixture();f.artifactBytes=Buffer.from(JSON.stringify({...JSON.parse(f.artifactBytes),...change}));
    f.claim.manifest.artifacts[0].sha256=createHash('sha256').update(f.artifactBytes).digest('hex');
    await assert.rejects(assertCustomerPreserved(f),/PLAN_INVALID/);assert.equal(f.queries,0);
  }
});
