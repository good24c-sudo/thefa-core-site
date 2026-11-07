import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PROOF_PREFIX,PROOF_TARGET,PROBE_SOURCE_PATHS,canonical,validateChallenge,makeValueProof,
  verifyValueProof,readVerifiedBuildProof,environmentMetadataHash} from './sensitive-proof-contract.mjs';
import {runSensitiveBuildProbe} from './sensitive-build-probe.mjs';
import {sourceTreeFiles} from './vercel-proof-reader.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function fixture(){
  const now=Date.now(),metadata=[{id:'dbid',key:'CUSTOMER_AUTH_DATABASE_URL',type:'sensitive',target:['production'],updatedAt:now}];
  const challenge={contract:'THEFA_CUSTOMER_DB_CHALLENGE_V1',project_id:PROOF_TARGET.project,team_id:PROOF_TARGET.team,
    database_project:PROOF_TARGET.databaseProject,source_head:'a'.repeat(40),artifact_sha256:'b'.repeat(64),env_metadata_sha256:environmentMetadataHash(metadata),
    action_id:randomUUID(),claim_id:randomUUID(),work_unit_id:'dcjob-'+'c'.repeat(24),native_receipt_id:randomUUID(),
    request_binding_hash:'sha256:'+'d'.repeat(64),nonce:randomBytes(32).toString('hex'),issued_at:new Date(now-1000).toISOString(),expires_at:new Date(now+120000).toISOString()};
  const expected={deployment_id:'dpl_IsolatedFixture',challenge};
  const databaseUrl='postgresql://'+PROOF_TARGET.role+'.'+PROOF_TARGET.databaseProject+':'+randomBytes(48).toString('base64url')+'@'+PROOF_TARGET.pooler+':5432/postgres?sslmode=verify-full';
  const proof=makeValueProof({challenge,deploymentId:expected.deployment_id,observedAt:new Date(now).toISOString(),databaseUrl});
  const source=PROBE_SOURCE_PATHS.map(path=>({path,bytes:Buffer.from('ISOLATED_FIXTURE_ONLY '+path)}));
  const plan={files:source.map(f=>({path:f.path,sha256:sha(f.bytes)})),protection:{deploymentType:'preview'},
    build_command:'node ops/sensitive-build-probe.mjs '+Buffer.from(canonical(challenge)).toString('base64url'),
    install_command:'npm ci --ignore-scripts --omit=dev',output_directory:'proof-public'};
  const deployment={id:expected.deployment_id,projectId:PROOF_TARGET.project,ownerId:PROOF_TARGET.team,target:'production',readyState:'READY',
    alias:[],automaticAliases:[],lambdas:[],functions:null,meta:{githubCommitSha:challenge.source_head},createdAt:now,
    projectSettings:{buildCommand:plan.build_command,installCommand:plan.install_command,outputDirectory:plan.output_directory}};
  const project={id:PROOF_TARGET.project,accountId:PROOF_TARGET.team,ssoProtection:plan.protection};
  const events=[{type:'stdout',text:PROOF_PREFIX+JSON.stringify(proof)}];
  const api={getDeployment:async()=>structuredClone(deployment),getProject:async()=>structuredClone(project),
    getSourceFiles:async()=>source,getEnvironmentMetadata:async()=>metadata,getBuildEvents:async()=>events};
  return {now,expected,challenge,databaseUrl,proof,plan,source,deployment,project,events,metadata,api};
}
test('private high-entropy value matches actual evidence shape without disclosing it',async()=>{
  const f=fixture(),proof=await readVerifiedBuildProof(f);
  assert.deepEqual(verifyValueProof(proof,f.expected,f.databaseUrl,f.now),{value_matched:true,authority_granted:false});
  const serialized=JSON.stringify(proof);assert.ok(!serialized.includes(f.databaseUrl));assert.ok(!serialized.includes(new URL(f.databaseUrl).password));
  assert.ok(!serialized.includes(sha(f.databaseUrl)));assert.equal(Object.hasOwn(proof,'secret_hash'),false);
});
test('wrong secret, edited results and extra secret fields cannot pass',()=>{
  const f=fixture();assert.throws(()=>verifyValueProof(f.proof,f.expected,f.databaseUrl.replace(new URL(f.databaseUrl).password,'z'.repeat(64)),f.now),/VALUE_MISMATCH/);
  assert.throws(()=>verifyValueProof({...f.proof,secret:f.databaseUrl},f.expected,f.databaseUrl,f.now),/EXACT_SENSITIVE/);
  assert.throws(()=>verifyValueProof({...f.proof,result:{...f.proof.result,tls_authorized:false}},f.expected,f.databaseUrl,f.now),/EXACT_SENSITIVE/);
});
test('expired, excessive lifetime and protected old WorkUnits are rejected',()=>{
  const f=fixture();for(const change of [{expires_at:new Date(f.now-1).toISOString()},
    {expires_at:new Date(f.now+700000).toISOString()},{work_unit_id:'dcjob-69194412b00b2b45a2d50c91'},
    {work_unit_id:'dcjob-a92e72854d7d65923a06e33c'}])assert.throws(()=>validateChallenge({...f.challenge,...change},f.now),/CHALLENGE/);
});
test('a proof for another claim, receipt, nonce, deployment or source is rejected',()=>{
  for(const change of [{claim_id:randomUUID()},{native_receipt_id:randomUUID()},{nonce:'e'.repeat(64)},{source_head:'f'.repeat(40)}]){
    const f=fixture();assert.throws(()=>verifyValueProof(f.proof,{...f.expected,challenge:{...f.challenge,...change}},f.databaseUrl,f.now),/BINDING/);
  }
  const f=fixture();assert.throws(()=>verifyValueProof(f.proof,{...f.expected,deployment_id:'dpl_Other'},f.databaseUrl,f.now),/EXACT_SENSITIVE/);
});
test('actual provider reads reject wrong project/head/aliases/protection',async()=>{
  for(const mutate of [f=>f.deployment.projectId='prj_other',f=>f.deployment.meta.githubCommitSha='0'.repeat(40),
    f=>f.deployment.alias.push('thefacore.com'),f=>f.deployment.automaticAliases.push('other.vercel.app'),f=>f.project.ssoProtection=null]){
    const f=fixture();mutate(f);await assert.rejects(readVerifiedBuildProof(f),/SCOPE_PROTECTION_OR_SOURCE/);
  }
});
test('uploaded source must be complete and exact, not a caller-provided proof object',async()=>{
  const f=fixture();f.source[0].bytes=Buffer.from('altered');await assert.rejects(readVerifiedBuildProof(f),/SOURCE_MISMATCH/);
  const g=fixture();g.source.pop();await assert.rejects(readVerifiedBuildProof(g),/COMPLETE_DEPLOYED/);
  const h=fixture();h.events.length=0;await assert.rejects(readVerifiedBuildProof(h),/UNIQUE_ACTUAL/);
});
test('missing, duplicate, stale logs and environment changes are not completion',async()=>{
  const f=fixture();f.events.push(f.events[0]);await assert.rejects(readVerifiedBuildProof(f),/UNIQUE_ACTUAL/);
  const g=fixture();g.metadata[0].updatedAt++;await assert.rejects(readVerifiedBuildProof(g),/ENV_CHANGED/);
  const h=fixture();await assert.rejects(readVerifiedBuildProof({...h,now:h.now+61000}),/OBSERVATION_STALE/);
});
test('alias or protection changes between independent reads are detected',async()=>{
  const f=fixture();let calls=0;f.api.getDeployment=async()=>{calls++;return {...f.deployment,alias:calls===1?[]:['thefacore.com']};};
  await assert.rejects(readVerifiedBuildProof(f),/DEPLOYMENT_CHANGED/);
});
test('environment snapshot rejects actual values, duplicates and cross-target scope',()=>{
  const f=fixture();assert.throws(()=>environmentMetadataHash([{...f.metadata[0],value:'NEVER_ALLOWED'}]),/NONSECRET/);
  assert.throws(()=>environmentMetadataHash([...f.metadata,...f.metadata]),/NONSECRET/);
  assert.throws(()=>environmentMetadataHash([{...f.metadata[0],target:['production','preview']}]),/NONSECRET/);
});
test('source reader rejects extra routes, unreadable trees and traversal before downloading content',()=>{
  for(const tree of [[],[{name:'src',type:'directory',children:[]},{name:'out',type:'directory',children:[]}],
    [{name:'src',type:'directory',children:[{name:'..',type:'file',uid:'a'.repeat(40)}]},{name:'out',type:'directory',children:[]}]])
    assert.throws(()=>sourceTreeFiles(tree),/SOURCE/);
});
test('probe emits only after read-only SCRAM/TLS; failures close client and omit secrets',async()=>{
  const f=fixture();let closed=0;class Client{
    constructor(options){assert.equal(options.ssl.rejectUnauthorized,true);assert.match(options.options,/default_transaction_read_only=on/);
      this.connection=new EventEmitter();this.connection.stream={encrypted:true,authorized:true};}
    async connect(){this.connection.emit('authenticationSASL',{mechanisms:['SCRAM-SHA-256']});}
    async query(sql){assert.match(sql,/^SELECT current_user/);return {rows:[{role:PROOF_TARGET.role,database:'postgres',read_only:'on'}]};}
    async end(){closed++;}
  }
  const env={VERCEL:'1',VERCEL_PROJECT_ID:PROOF_TARGET.project,VERCEL_TARGET_ENV:'production',VERCEL_DEPLOYMENT_ID:f.expected.deployment_id,CUSTOMER_AUTH_DATABASE_URL:f.databaseUrl};
  const proof=await runSensitiveBuildProbe({challenge:f.challenge,env,Client,now:()=>f.now});assert.equal(closed,1);
  verifyValueProof(proof,f.expected,f.databaseUrl,f.now);
  class UnsafeClient extends Client{async connect(){this.connection.stream.authorized=false;}}
  await assert.rejects(runSensitiveBuildProbe({challenge:f.challenge,env,Client:UnsafeClient,now:()=>f.now}),/ACTUAL_READ_ONLY/);assert.equal(closed,2);
});
