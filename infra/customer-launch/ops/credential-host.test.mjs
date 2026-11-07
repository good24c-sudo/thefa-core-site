import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCredentialMethods,requireClaimBinding,requireCoherentEnvironment,credentialSql} from './credential-host.mjs';
import {TARGET,create4060IO} from './credential-io.mjs';

function fixture(){
  const reserved={decision:'NEW_EXCLUSIVE_ATTEMPT',attempt_id:randomUUID(),action_id:randomUUID(),claim_id:randomUUID(),
    receipt_id:randomUUID(),work_unit_id:'dcjob-'+ 'a'.repeat(24),provider_request_hash:'sha256:'+'1'.repeat(64),
    request_binding_hash:'sha256:'+'2'.repeat(64),admission_receipt_hash:'sha256:'+'3'.repeat(64),provider_operation_id:'supabase:'+TARGET.project+':stage2',
    expires_at:new Date(Date.now()+120000).toISOString()};
  const claim={...reserved,decision:'WORKER_CLAIMED',
    manifest:{supabase_project_ref:TARGET.project,vercel_project_id:TARGET.vercel,environment:'PRODUCTION',origin:'https://thefacore.com',
      operations:['CONFIGURE_CUSTOMER_AUTH_ENV'],preserve_data:true,reset_usage_epoch:false,replay_original_job:false,
      protected_session_id:'111c339990e7926f4e8b226e'}};
  const values={CUSTOMER_ENVIRONMENT:'production',CUSTOMER_SUPABASE_URL:'https://'+TARGET.project+'.supabase.co',CUSTOMER_ORIGIN:'https://thefacore.com',
    CUSTOMER_ACCOUNT_MODE:'legacy-preserved',CUSTOMER_REDIRECTS_READY:'true',NODEJS_HELPERS:'0'};
  let env={envs:Object.entries(values).map(([key,value])=>({id:key,key,value,type:'encrypted',target:['production']}))};
  let configured=false,probeCalls=0,mutations=0,reads=0;
  const vault=new Map(),events=[];
  const io={
    async vault(name,op,value){events.push(op);if(op==='Read')return vault.get(name);if(vault.has(name))throw Error('EXCLUSIVE_VAULT_WRITE');vault.set(name,value);return '{"stored":true}';},
    async query(sql){if(sql.startsWith('SELECT'))return [{role:{name:TARGET.role,login:true,superuser:false,bypass_rls:false,create_db:false,create_role:false,replication:false,password_null:!configured,scram:configured}}];
      events.push('DB_WRITE');mutations++;configured=true;return [];},
    async vercel(endpoint,method,body){if(endpoint.startsWith('/v9/projects/'))return {id:TARGET.vercel,accountId:TARGET.team};
      if(method==='POST'){events.push('ENV_WRITE');mutations++;env.envs.push({id:'database',...body});}return structuredClone(env);}
  };
  const options={io,readLiveClaim:async()=>{reads++;return structuredClone(claim);},assertPreservation:async()=>{},
    probe:async()=>{probeCalls++;if(probeCalls%2===0)throw Object.assign(Error('REJECTED'),{code:'28P01'});}};
  const host=createCredentialMethods(options);
  return {host,reserved,claim,io,options,vault,events,get env(){return env;},get mutations(){return mutations;},get reads(){return reads;}};
}
async function toLogin(f){const h=await f.host.stageDpapiSecretHandle(f.reserved);await f.host.setRuntimeRolePasswordUsingHandle(f.reserved,h);await f.host.verifyRuntimeLoginUsingHandle(f.reserved,h);return h;}

test('isolated full method sequence returns no credential, records no fake terminal',async()=>{
  const f=fixture(),handle=await toLogin(f);
  const result=await f.host.setVercelDatabaseUrlFromHandle(f.reserved,handle);
  assert.equal(result.decision,'VERCEL_DATABASE_SECRET_APPLIED_ENCRYPTED');
  assert.equal((await f.host.readbackVercelServerSide(f.reserved,handle)).decision,'APP_DATABASE_SECRET_MATCHED_WITHOUT_DISCLOSURE');
  assert.equal(f.mutations,2);assert.ok(f.reads>=7);
  assert.deepEqual(Object.keys(handle).sort(),['handle_id','kind']);
  assert.equal(Object.hasOwn(f.host,'recordTerminalReceipt'),false);
  assert.ok(f.events.indexOf('WriteNew')<f.events.indexOf('DB_WRITE'));
});
test('staging configuration blocks before credential creation or provider mutation',async()=>{
  const f=fixture();f.env.envs[0].value='staging';await assert.rejects(f.host.stageDpapiSecretHandle(f.reserved),/ATOMIC_PRODUCTION_ENV_RELEASE_REQUIRED/);
  assert.equal(f.vault.size,0);assert.equal(f.mutations,0);
});
test('existing sensitive values block before DB change and cannot be downgraded',async()=>{
  for(const type of ['sensitive','secret']){
    const f=fixture();f.env.envs.push({id:'existing-sensitive-db',key:'CUSTOMER_AUTH_DATABASE_URL',type,target:['production']});
    await assert.rejects(f.host.stageDpapiSecretHandle(f.reserved),/SENSITIVE_ENV_RUNTIME_PROOF_AND_COHERENT_RELEASE_REQUIRED/);
    assert.equal(f.mutations,0);assert.equal(f.vault.size,0);assert.ok(!f.events.includes('ENV_WRITE'));
  }
});
test('fresh-launch and duplicate/shared environment keys are rejected',()=>{
  const f=fixture();f.env.envs.find(e=>e.key==='CUSTOMER_ACCOUNT_MODE').value='fresh-launch';
  assert.throws(()=>requireCoherentEnvironment(f.env),/ATOMIC_PRODUCTION/);
  const g=fixture();g.env.envs.push(g.env.envs[0]);assert.throws(()=>requireCoherentEnvironment(g.env),/AMBIGUOUS/);
  const h=fixture();h.env.envs.push({key:'CUSTOMER_AUTH_DATABASE_URL',value:'test',type:'encrypted',target:['production','preview']});
  assert.throws(()=>requireCoherentEnvironment(h.env),/SCOPE_OR_TYPE/);
});
test('expired and mismatched claims reject before effects',async()=>{
  const f=fixture();f.claim.expires_at=new Date(0).toISOString();await assert.rejects(f.host.stageDpapiSecretHandle(f.reserved),/LIVE_STAGE2/);assert.equal(f.vault.size,0);
  const g=fixture();g.claim.claim_id=randomUUID();await assert.rejects(g.host.stageDpapiSecretHandle(g.reserved),/BINDING_MISMATCH/);
});
test('completed schema job and unsafe manifest cannot enter stage2',()=>{
  const f=fixture();f.reserved.work_unit_id='dcjob-69194412b00b2b45a2d50c91';assert.throws(()=>requireClaimBinding(f.reserved,f.claim),/LIVE_STAGE2/);
  const g=fixture();g.claim.manifest.reset_usage_epoch=true;assert.throws(()=>requireClaimBinding(g.reserved,g.claim),/LIVE_STAGE2/);
});
test('preservation validator failure blocks all effects',async()=>{
  const f=fixture();const host=createCredentialMethods({...f.options,assertPreservation:async()=>{throw Error('BACKUP_NOT_VERIFIED');}});
  await assert.rejects(host.stageDpapiSecretHandle(f.reserved),/BACKUP_NOT_VERIFIED/);assert.equal(f.mutations,0);assert.equal(f.vault.size,0);
});
test('durable intent prevents restart from creating another credential',async()=>{
  const f=fixture();await f.host.stageDpapiSecretHandle(f.reserved);
  await assert.rejects(createCredentialMethods(f.options).stageDpapiSecretHandle(f.reserved),/EXCLUSIVE/);assert.equal(f.mutations,0);
});
test('uncertain SQL is never retried',async()=>{
  const f=fixture(),h=await f.host.stageDpapiSecretHandle(f.reserved);let calls=0;
  f.io.query=async()=>{calls++;throw Error('CONNECTION_LOST');};
  await assert.rejects(f.host.setRuntimeRolePasswordUsingHandle(f.reserved,h),/CONNECTION_LOST/);
  await assert.rejects(f.host.setRuntimeRolePasswordUsingHandle(f.reserved,h),/RECONCILE_ONLY/);assert.equal(calls,1);
});
test('concurrent calls cannot perform the same password change twice',async()=>{
  const f=fixture(),h=await f.host.stageDpapiSecretHandle(f.reserved);
  const results=await Promise.allSettled([f.host.setRuntimeRolePasswordUsingHandle(f.reserved,h),f.host.setRuntimeRolePasswordUsingHandle(f.reserved,h)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.mutations,1);
});
test('changed environment blocks Vercel write',async()=>{
  const f=fixture(),h=await toLogin(f);f.env.envs.push({key:'NEW_VAR',value:'changed',target:['production']});
  await assert.rejects(f.host.setVercelDatabaseUrlFromHandle(f.reserved,h),/ENV_CHANGED/);assert.equal(f.mutations,1);
});
test('forged opaque handle cannot access vault or mutation',async()=>{
  const f=fixture(),h=await f.host.stageDpapiSecretHandle(f.reserved);
  await assert.rejects(f.host.setRuntimeRolePasswordUsingHandle(f.reserved,{...h,handle_id:randomUUID()}),/RECONCILE_ONLY/);assert.equal(f.mutations,0);
});
test('metadata-only and mismatched Vercel secret readback cannot pass',async()=>{
  const f=fixture(),h=await toLogin(f);const original=f.io.vercel;
  f.io.vercel=async(...args)=>{const r=await original(...args);if(args[1]==='POST')f.env.envs.find(e=>e.key==='CUSTOMER_AUTH_DATABASE_URL').value='[encrypted]';return r;};
  await assert.rejects(f.host.setVercelDatabaseUrlFromHandle(f.reserved,h),/WRITE_READBACK/);
});
test('wrong-password must actually be rejected by PostgreSQL',async()=>{
  const f=fixture();const host=createCredentialMethods({...f.options,probe:async()=>{}}),h=await host.stageDpapiSecretHandle(f.reserved);
  await host.setRuntimeRolePasswordUsingHandle(f.reserved,h);await assert.rejects(host.verifyRuntimeLoginUsingHandle(f.reserved,h),/WRONG_PASSWORD/);
});
test('SQL refuses injectable passwords and never edits permissions or data',()=>{
  assert.throws(()=>credentialSql("a'; DROP TABLE test;--"),/INVALID/);
  const sql=credentialSql('a'.repeat(64));assert.match(sql,/rolpassword IS NULL/);assert.match(sql,/scram-sha-256/);
  assert.doesNotMatch(sql,/\b(GRANT|REVOKE|DELETE|UPDATE|CREATE ROLE|TRUNCATE)\b/);
});
test('physical factory does not fall back to another host',()=>{
  if(process.env.COMPUTERNAME!==TARGET.host)assert.throws(()=>create4060IO(),/EXACT_4060/);
  else assert.equal(typeof create4060IO().query,'function');
});
