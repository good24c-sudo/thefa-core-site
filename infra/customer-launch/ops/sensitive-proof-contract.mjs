import {createHash,createHmac,timingSafeEqual} from 'node:crypto';

export const PROOF_PREFIX='THEFA_CUSTOMER_DB_PROOF_V1 ';
export const PROOF_TARGET=Object.freeze({project:'prj_FEJ9dUhjDAYspZsfcDjKwp4euMFo',team:'team_ukptkCxVKSjdlRwBtymwPtSd',
  databaseProject:'cgrppxfdurpzzfvkmfte',role:'core_customer_auth_runtime',pooler:'aws-0-ap-northeast-2.pooler.supabase.com'});
const SHA=/^[a-f0-9]{64}$/,HEAD=/^[a-f0-9]{40}$/,UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const PROBE_SOURCE_PATHS=Object.freeze(['app/package.json','app/server/inherited/server/auth/database-ca.mjs',
  'ops/sensitive-build-probe.mjs','ops/sensitive-proof-contract.mjs','package-lock.json','package.json','vercel.json']);
export const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?
  '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const challengeKeys=['contract','project_id','team_id','database_project','source_head','artifact_sha256','env_metadata_sha256',
  'action_id','claim_id','work_unit_id','native_receipt_id','request_binding_hash','nonce','issued_at','expires_at'];

export function validateChallenge(value,now=Date.now()){
  if(!exact(value,challengeKeys)||value.contract!=='THEFA_CUSTOMER_DB_CHALLENGE_V1'||
     value.project_id!==PROOF_TARGET.project||value.team_id!==PROOF_TARGET.team||value.database_project!==PROOF_TARGET.databaseProject||
     !HEAD.test(value.source_head)||![value.artifact_sha256,value.env_metadata_sha256,value.nonce].every(x=>SHA.test(x))||
     ![value.action_id,value.claim_id,value.native_receipt_id].every(x=>UUID.test(x))||!/^sha256:[a-f0-9]{64}$/.test(value.request_binding_hash)||
     !/^dcjob-[a-f0-9]{24}$/.test(value.work_unit_id)||['dcjob-69194412b00b2b45a2d50c91','dcjob-a92e72854d7d65923a06e33c'].includes(value.work_unit_id))
    fail('EXACT_SENSITIVE_PROOF_CHALLENGE_REQUIRED');
  const issued=Date.parse(value.issued_at),expires=Date.parse(value.expires_at);
  if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>now+5000||expires<=now||expires-issued>600000||expires<=issued)
    fail('SENSITIVE_PROOF_CHALLENGE_EXPIRED');
  return value;
}

// Only the newly generated high-entropy runtime credential is eligible for this
// challenge response. Never output the URL or an unkeyed hash of a secret.
export function validateProofDatabaseUrl(value){
  let url;try{url=new URL(value);}catch{fail('SENSITIVE_PROOF_DATABASE_BINDING_INVALID');}
  if(typeof value!=='string'||url.protocol!=='postgresql:'||url.hostname!==PROOF_TARGET.pooler||url.port!=='5432'||
     url.username!==PROOF_TARGET.role+'.'+PROOF_TARGET.databaseProject||url.pathname!=='/postgres'||url.hash||
     !/^[A-Za-z0-9_-]{64}$/.test(url.password)||url.search!=='?sslmode=verify-full'||/[\x00-\x20\x7f]/.test(value))
    fail('SENSITIVE_PROOF_DATABASE_BINDING_INVALID');
  return url;
}
export function makeValueProof({challenge,deploymentId,observedAt,databaseUrl}){
  validateChallenge(challenge,Date.parse(observedAt));validateProofDatabaseUrl(databaseUrl);
  if(!/^dpl_[A-Za-z0-9]+$/.test(deploymentId)||!Number.isFinite(Date.parse(observedAt)))fail('SENSITIVE_PROOF_DEPLOYMENT_REQUIRED');
  const payload={contract:'THEFA_CUSTOMER_DB_PROOF_V1',challenge,deployment_id:deploymentId,observed_at:observedAt,
    result:{database:'postgres',role:PROOF_TARGET.role,scram:true,tls_authorized:true}};
  return {...payload,mac:createHmac('sha256',databaseUrl).update(PROOF_PREFIX+canonical(payload)).digest('base64url')};
}
export function validateProofEnvelope(proof,expected,now=Date.now()){
  if(!exact(proof,['contract','challenge','deployment_id','observed_at','result','mac'])||proof.contract!=='THEFA_CUSTOMER_DB_PROOF_V1'||
     proof.deployment_id!==expected.deployment_id||!/^dpl_[A-Za-z0-9]+$/.test(proof.deployment_id)||
     !exact(proof.result,['database','role','scram','tls_authorized'])||proof.result.database!=='postgres'||
     proof.result.role!==PROOF_TARGET.role||proof.result.scram!==true||proof.result.tls_authorized!==true||
     typeof proof.mac!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(proof.mac))fail('EXACT_SENSITIVE_PROOF_REQUIRED');
  validateChallenge(proof.challenge,now);
  if(canonical(proof.challenge)!==canonical(expected.challenge))fail('SENSITIVE_PROOF_BINDING_MISMATCH');
  const observed=Date.parse(proof.observed_at),issued=Date.parse(proof.challenge.issued_at),expires=Date.parse(proof.challenge.expires_at);
  if(!Number.isFinite(observed)||observed<issued||observed>now+5000||observed>=expires||now-observed>60000)
    fail('SENSITIVE_PROOF_OBSERVATION_STALE');
  return proof;
}
export function verifyValueProof(proof,expected,databaseUrl,now=Date.now()){
  validateProofEnvelope(proof,expected,now);validateProofDatabaseUrl(databaseUrl);
  const {mac,...payload}=proof,actual=Buffer.from(mac,'base64url');
  const wanted=createHmac('sha256',databaseUrl).update(PROOF_PREFIX+canonical(payload)).digest();
  if(actual.length!==wanted.length||!timingSafeEqual(actual,wanted))fail('SENSITIVE_SECRET_VALUE_MISMATCH');
  return {value_matched:true,authority_granted:false};
}

/** Independent evidence reader for the EXISTING trusted worker/server.
 * api is constructed from its authenticated Vercel transport, never caller JSON.
 * It must read actual deployment, project, exact uploaded files, current env
 * metadata and build events. This function neither creates a deployment nor
 * consumes a claim nor grants permissions. The host separately checks the MAC
 * against its DPAPI credential; the Broker binds both results in its terminal.
 */
export async function readVerifiedBuildProof({api,expected,plan,now=Date.now()}){
  validateChallenge(expected.challenge,now);
  if(!api||!exact(plan,['files','protection','build_command','install_command','output_directory'])||
     !Array.isArray(plan.files)||canonical(plan.files.map(f=>f.path).sort())!==canonical(PROBE_SOURCE_PATHS)||
     plan.install_command!=='npm ci --ignore-scripts --omit=dev'||plan.output_directory!=='proof-public'||
     plan.build_command!=='node ops/sensitive-build-probe.mjs '+Buffer.from(canonical(expected.challenge)).toString('base64url')||
     new Set(plan.files.map(f=>f.path)).size!==plan.files.length||plan.files.some(f=>!exact(f,['path','sha256'])||!SHA.test(f.sha256)||
       !/^[A-Za-z0-9_./-]+$/.test(f.path)||f.path.split('/').some(s=>!s||s==='.'||s==='..')))
    fail('EXACT_APPROVED_PROBE_PLAN_REQUIRED');
  const deployment=await api.getDeployment(expected.deployment_id);
  const project=await api.getProject(PROOF_TARGET.project);
  if(deployment.id!==expected.deployment_id||deployment.projectId!==PROOF_TARGET.project||deployment.ownerId!==PROOF_TARGET.team||
     project.id!==PROOF_TARGET.project||project.accountId!==PROOF_TARGET.team||deployment.target!=='production'||deployment.readyState!=='READY'||
     !Array.isArray(deployment.alias)||deployment.alias.length||!Array.isArray(deployment.automaticAliases)||deployment.automaticAliases.length||
     !Array.isArray(deployment.lambdas)||deployment.lambdas.length||
     (deployment.functions!==null&&deployment.functions!==undefined&&Object.keys(deployment.functions).length)||
     canonical(project.ssoProtection)!==canonical(plan.protection)||deployment.meta?.githubCommitSha!==expected.challenge.source_head||
     deployment.projectSettings?.buildCommand!==plan.build_command||deployment.projectSettings?.installCommand!==plan.install_command||
     deployment.projectSettings?.outputDirectory!==plan.output_directory||deployment.createdAt<Date.parse(expected.challenge.issued_at))
    fail('DEPLOYMENT_SCOPE_PROTECTION_OR_SOURCE_MISMATCH');
  // Enumeration must be complete; unreadable/truncated file lists fail closed.
  const files=await api.getSourceFiles(expected.deployment_id);
  if(!Array.isArray(files)||files.length!==plan.files.length||new Set(files.map(f=>f.path)).size!==files.length)
    fail('COMPLETE_DEPLOYED_PROBE_SOURCE_REQUIRED');
  for(const allowed of plan.files){
    const file=files.find(f=>f.path===allowed.path);
    if(!file||!Buffer.isBuffer(file.bytes)||sha256(file.bytes)!==allowed.sha256)fail('DEPLOYED_PROBE_SOURCE_MISMATCH');
  }
  const metadata=await api.getEnvironmentMetadata(PROOF_TARGET.project);
  if(environmentMetadataHash(metadata)!==expected.challenge.env_metadata_sha256)fail('VERCEL_ENV_CHANGED_RECONCILE_REQUIRED');
  const events=await api.getBuildEvents(expected.deployment_id);
  if(!Array.isArray(events))fail('COMPLETE_AUTHENTICATED_BUILD_EVENTS_REQUIRED');
  const matching=events.filter(e=>e?.type==='stdout'&&typeof e.text==='string'&&e.text.startsWith(PROOF_PREFIX));
  if(matching.length!==1)fail('UNIQUE_ACTUAL_BUILD_PROOF_REQUIRED');
  let proof;try{proof=JSON.parse(matching[0].text.slice(PROOF_PREFIX.length));}catch{fail('ACTUAL_BUILD_PROOF_INVALID');}
  validateProofEnvelope(proof,expected,now);
  // A second provider read catches alias/protection/env changes during proof read.
  const latest=await api.getDeployment(expected.deployment_id),latestProject=await api.getProject(PROOF_TARGET.project);
  if(latest.id!==deployment.id||latest.projectId!==deployment.projectId||latest.ownerId!==deployment.ownerId||latest.readyState!=='READY'||
     !Array.isArray(latest.alias)||latest.alias.length||!Array.isArray(latest.automaticAliases)||latest.automaticAliases.length||
     canonical(latestProject.ssoProtection)!==canonical(plan.protection)||
     environmentMetadataHash(await api.getEnvironmentMetadata(PROOF_TARGET.project))!==expected.challenge.env_metadata_sha256)
    fail('VERIFICATION_DEPLOYMENT_CHANGED_RECONCILE_REQUIRED');
  return proof;
}

export function environmentMetadataHash(entries){
  if(!Array.isArray(entries)||!entries.length||new Set(entries.map(e=>e.key)).size!==entries.length||
     new Set(entries.map(e=>e.id)).size!==entries.length||entries.some(e=>!exact(e,['id','key','type','target','updatedAt'])||
       !/^[A-Za-z0-9_-]+$/.test(e.id??'')||!/^CUSTOMER_[A-Z0-9_]+$|^NODEJS_HELPERS$/.test(e.key??'')||
       !['encrypted','sensitive','secret','plain'].includes(e.type)||canonical(e.target)!=='["production"]'||
       !Number.isSafeInteger(e.updatedAt)||e.updatedAt<=0))fail('NONSECRET_COMPLETE_ENV_METADATA_REQUIRED');
  return sha256(Buffer.from(canonical([...entries].sort((a,b)=>a.key.localeCompare(b.key,'en')))));
}
