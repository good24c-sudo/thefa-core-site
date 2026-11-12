import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {admitVerifiedStageOidcSubject,readStageOidcAccountConfig} from '../server/oidc-stage-account.mjs';

const issuer='https://furfjhymxqsbhvuyeqpx.supabase.co/auth/v1';
const client='6b70d657-b1fa-4174-a3f2-29d475f4e3c0';
const env={
 VERCEL_ENV:'preview',
 THEFA_CORE_STAGE_BRIDGE_ENABLED:'true',
 THEFA_CORE_OIDC_ISSUER:issuer,
 THEFA_CORE_OIDC_ORIGIN:'https://thefa-core-customer-git-chatgpt-p04-core-oidc-inte-10e5aa-thefa.vercel.app',
 THEFA_CORE_OIDC_CLIENT_ID:client,
 THEFA_CORE_STAGE_SERVICE_ROLE_KEY:'sb_secret_'+randomBytes(55).toString('base64url'),
 THEFA_CORE_STAGE_ACCOUNT_KEY_BASE64URL:randomBytes(32).toString('base64url'),
 THEFA_CORE_STAGE_ALLOWANCE_KEY_BASE64URL:randomBytes(32).toString('base64url'),
 THEFA_CORE_STAGE_TENANT_KEY:randomBytes(32).toString('base64url'),
 THEFA_CORE_OIDC_COOKIE_SECRET_BASE64URL:randomBytes(32).toString('base64url'),
};
const subjectA='11111111-1111-4111-8111-111111111111';
const subjectB='22222222-2222-4222-8222-222222222222';
const identity=sub=>({issuer,subject:sub,audience:client});
const originalFetch=globalThis.fetch;
const originalState={version:2,tasks:[],artifacts:[],receipts:[],memory:[],idempotency:{}};
const rows=new Map();
const counts={get:0,acquire:0,save:0,release:0,foreign:0};
let persistThenLoseAck=false;
const deep=v=>structuredClone(v);
globalThis.fetch=async(raw,options={})=>{
 const url=new URL(raw);
 if(url.origin!=='https://furfjhymxqsbhvuyeqpx.supabase.co'||!url.pathname.startsWith('/rest/v1/')){
  counts.foreign++;return Response.json({error:'FOREIGN_NETWORK_BLOCKED'},{status:503});
 }
 if(!options.headers?.authorization?.startsWith('Bearer sb_secret_'))throw Error('UNAUTHENTICATED_FIXTURE_REQUEST');
 if(url.pathname==='/rest/v1/core_console_state_v3'){
  counts.get++;
  const key=url.searchParams.get('workspace_id')||'';
  assert.match(key,/^eq\.tenant_[a-f0-9]{64}$/);
  const existing=rows.get(key.slice(3));
  return Response.json(existing?[{state:deep(existing.state),version:existing.version}]:[]);
 }
 let input;try{input=JSON.parse(options.body||'null')}catch{return Response.json({error:'BAD_RPC_JSON'},{status:400})}
 if(url.pathname==='/rest/v1/rpc/core_console_acquire_lease_v3'){
  counts.acquire++;
  let r=rows.get(input.p_workspace);
  if(!r){r={version:0,state:deep(originalState),leaseOwner:null};rows.set(input.p_workspace,r)}
  if(r.leaseOwner&&r.leaseOwner!==input.p_owner)return Response.json({granted:false});
  r.leaseOwner=input.p_owner;
  return Response.json({granted:true,state:deep(r.state),version:r.version,lease_owner:input.p_owner,recovered:false});
 }
 if(url.pathname==='/rest/v1/rpc/core_console_save_state_v3'){
  counts.save++;
  const r=rows.get(input.p_workspace);
  if(!r||r.leaseOwner!==input.p_owner||r.version!==input.p_expected_version)return Response.json({error:'LEASE_LOST'},{status:409});
  if(input.p_state?.version!==2||!Array.isArray(input.p_state.tasks)||!Array.isArray(input.p_state.artifacts))return Response.json({error:'INVALID_STATE'},{status:400});
  r.state=deep(input.p_state);r.version++;
  if(persistThenLoseAck){persistThenLoseAck=false;return Response.json({error:'SIMULATED_LOST_ACK'},{status:503})}
  return Response.json({version:r.version});
 }
 if(url.pathname==='/rest/v1/rpc/core_console_release_lease_v3'){
  counts.release++;
  const r=rows.get(input.p_workspace);
  if(!r||r.leaseOwner!==input.p_owner)return Response.json({released:false});
  r.leaseOwner=null;
  return Response.json({released:true});
 }
 counts.foreign++;return Response.json({error:'UNEXPECTED_FIXTURE_ROUTE'},{status:500});
};

test.after(()=>{globalThis.fetch=originalFetch});
test('Staging account registry is bound to an isolated 64-character workspace',()=>{
 const c=readStageOidcAccountConfig(env);
 assert.match(c.registryId,/^tenant_[0-9a-f]{64}$/);
 assert.equal(c.issuer,issuer);
});
test('Verified new Supabase subject is admitted once with non-email-based identity',async()=>{
 const result=await admitVerifiedStageOidcSubject(identity(subjectA),{env});
 assert.equal(result.sessionVerified,true);
 assert.equal(result.subject,subjectA);
 assert.equal(result.provider,'oidc');
 assert.equal(result.accountProvenance,'LAUNCH_ACCOUNT_CONFIRMED');
 assert.match(result.principalId,/^[a-f0-9]{64}$/);
 assert.match(result.workspaceEmail,/^oidc_[a-f0-9]{64}@accounts\.thefa\.invalid$/);
 assert.equal(counts.save,1);
});
test('Re-admitting same subject returns canonical immutable mapping without new writes',async()=>{
 const before=counts.save;
 const first=await admitVerifiedStageOidcSubject(identity(subjectA),{env});
 const second=await admitVerifiedStageOidcSubject(identity(subjectA),{env});
 assert.deepEqual(first,second);
 assert.equal(counts.save,before);
});
test('A second verified subject has a separate identity and does not overwrite the first',async()=>{
 const a=await admitVerifiedStageOidcSubject(identity(subjectA),{env});
 const b=await admitVerifiedStageOidcSubject(identity(subjectB),{env});
 assert.notEqual(a.principalId,b.principalId);
 assert.notEqual(a.workspaceEmail,b.workspaceEmail);
 assert.equal(counts.save,2);
});
test('Forged issuer or audience and malformed subject cannot mutate registry',async()=>{
 const before=counts.save;
 await assert.rejects(admitVerifiedStageOidcSubject({...identity(subjectA),issuer:'https://attacker.example'}, {env}),/ISSUER_AUDIENCE_MISMATCH/);
 await assert.rejects(admitVerifiedStageOidcSubject({...identity(subjectA),audience:'other'}, {env}),/ISSUER_AUDIENCE_MISMATCH/);
 await assert.rejects(admitVerifiedStageOidcSubject(identity('not-a-uuid'),{env}),/OIDC_SUBJECT_INVALID/);
 assert.equal(counts.save,before);
});
test('A lost save acknowledgement must not trigger a second write automatically',async()=>{
 const subject='33333333-3333-4333-8333-333333333333';
 persistThenLoseAck=true;
 const before=counts.save;
 await assert.rejects(admitVerifiedStageOidcSubject(identity(subject),{env}),/ADMISSION_UNCERTAIN_NO_AUTOREPLAY/);
 assert.equal(counts.save,before+1);
 const recovered=await admitVerifiedStageOidcSubject(identity(subject),{env});
 assert.equal(recovered.subject,subject);
 assert.equal(counts.save,before+1);
});
test('Production cannot enable staging-only account admissions',()=>{
 assert.throws(()=>readStageOidcAccountConfig({...env,VERCEL_ENV:'production'}),/CONFIGURATION_REQUIRED/);
 assert.throws(()=>readStageOidcAccountConfig({...env,THEFA_CORE_STAGE_BRIDGE_ENABLED:'false'}),/CONFIGURATION_REQUIRED/);
 assert.equal(counts.foreign,0);
});
