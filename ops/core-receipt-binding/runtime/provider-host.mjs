import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyProductionArtifacts} from '../customer-production.mjs';
import {canonicalJson} from '../vendor/edge/thefa-founder-live-ingress-v1/contract.mjs';

export const SQL_SHA='c99cfb73d997a82e44819cd048513acc112ee5e359a5ceb830ed139291f4cab3';
const ENDPOINT='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/thefa-customer-broker-authority/worker';
const TARGET='cgrppxfdurpzzfvkmfte';
const sha=s=>createHash('sha256').update(s).digest('hex');
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(s);
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const q=s=>"'"+s.replaceAll("'","''")+"'";
const failure=code=>{throw Error(code);};
export function windowsPowerShellEnvironment(source=process.env){
 const env=Object.fromEntries(Object.entries(source).filter(([key])=>key.toLowerCase()!=='psmodulepath'));
 env.PSModulePath=path.win32.join(source.SystemRoot??source.SYSTEMROOT??'C:\\Windows','System32','WindowsPowerShell','v1.0','Modules');
 return env;
}
export function buildSchemaSql(root){
 const role=readFileSync(path.join(root,'create-customer-runtime-role.sql'),'utf8').replace(/^\uFEFF/,'').replaceAll('\r\n','\n');
 let migration=readFileSync(path.join(root,'supabase/migrations/20261106060123_customer_auth_production_preserved.sql'),'utf8')
  .replace(/^\uFEFF/,'').replaceAll('\r\n','\n');
 if((migration.match(/^BEGIN;$/gm)??[]).length!==1||(migration.match(/^COMMIT;$/gm)??[]).length!==1)failure('EXACT_TRANSACTION_SOURCE_REQUIRED');
 migration=migration.replace(/^(?:BEGIN|COMMIT);\n?/gm,'');
 const sql='BEGIN;\n'+role+'\n'+migration+'\nCOMMIT;\n';
 if(sha(sql)!==SQL_SHA)failure('REVIEWED_SCHEMA_SQL_HASH_MISMATCH');
 return sql;
}
export const CATALOG_QUERY=`SELECT jsonb_build_object(
 'project_ref','cgrppxfdurpzzfvkmfte',
 'tables',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'rls_enabled',c.relrowsecurity,'force_rls',c.relforcerowsecurity) ORDER BY n.nspname,c.relname)
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE (n.nspname='core_customer_auth' AND c.relname IN ('user','account','session','verification'))
   OR (n.nspname='public' AND c.relname IN ('core_console_state_v3','core_console_artifacts_v3'))),
 'runtime_role',(SELECT jsonb_build_object('name',rolname,'can_login',rolcanlogin,'superuser',rolsuper,'bypass_rls',rolbypassrls,
  'create_db',rolcreatedb,'create_role',rolcreaterole,'replication',rolreplication,'password_is_null',rolpassword IS NULL)
  FROM pg_catalog.pg_authid WHERE rolname='core_customer_auth_runtime')
) AS readback;`;

// All injected dependencies are operator-owned implementation boundaries for local QA.
// Production CLI below fixes the project and uses only this PC's Supabase login.
export async function executeProviderOnce({actionId,packet,artifactRoot,evidenceRoot,callServer,query,now=()=>new Date()}){
 if(!uuid(actionId)||!packet?.manifest||!packet?.core_binding)failure('EXACT_PROVIDER_INPUT_REQUIRED');
 const manifest=packet.manifest,binding=packet.core_binding;
 if(manifest.supabase_project_ref!==TARGET||!same(manifest.operations,['INSTALL_AUTH_SCHEMA']))failure('EXACT_CUSTOMER_SCHEMA_STAGE_REQUIRED');
 await verifyProductionArtifacts(artifactRoot,manifest,binding);
 const sql=buildSchemaSql(artifactRoot),directory=path.resolve(evidenceRoot,actionId);
 if(path.dirname(directory)!==path.resolve(evidenceRoot))failure('EVIDENCE_PATH_ESCAPE');
 mkdirSync(directory,{recursive:true});
 const write=(name,value)=>writeFileSync(path.join(directory,name),typeof value==='string'?value:JSON.stringify(value,null,2),{flag:'wx'});
 // Exclusive durable intent precedes the network claim. Even an uncertain claim
 // cannot be repeated automatically by another local invocation.
 if(existsSync(path.join(directory,'claim-intent.json')))failure('EXISTING_CLAIM_READBACK_ONLY');
 write('claim-intent.json',{action_id:actionId,sql_sha256:SQL_SHA,created_at:now().toISOString()});
 let mutationAttempted=false;
 try{
  const claim=await callServer('WORKER_CLAIM',{action_id:actionId});
  if(claim?.decision!=='WORKER_CLAIMED'||!uuid(claim.claim_id)||claim.action_id!==actionId||
   !same(claim.manifest,manifest)||!same(claim.core_binding,binding)||
   !/^sha256:[a-f0-9]{64}$/.test(claim.provider_request_hash??'')||
   claim.provider_operation_id!=='supabase:'+TARGET+':'+actionId||
   !(Date.parse(claim.expires_at)>now().getTime()))failure('EXACT_UNEXPIRED_PROVIDER_CLAIM_REQUIRED');
  write('claim.json',claim);
  await verifyProductionArtifacts(artifactRoot,manifest,binding);
  if(buildSchemaSql(artifactRoot)!==sql||!(Date.parse(claim.expires_at)>now().getTime()))failure('CLAIM_OR_ARTIFACT_CHANGED');
  write('execute-intent.json',{action_id:actionId,claim_id:claim.claim_id,sql_sha256:SQL_SHA,at:now().toISOString()});
  mutationAttempted=true;
  await query(sql,{kind:'mutation',directory});
  // This is a separate real provider query, not an echo of the requested DDL.
  const rows=await query(CATALOG_QUERY,{kind:'readback',directory});
  if(!Array.isArray(rows)||rows.length!==1||!rows[0]?.readback)failure('PROVIDER_CATALOG_READBACK_REQUIRED');
  const result={action_id:actionId,claim_id:claim.claim_id,provider_request_hash:claim.provider_request_hash,
   provider_operation_id:claim.provider_operation_id,artifact_hashes:manifest.artifacts,sql_sha256:SQL_SHA,
   readback:rows[0].readback,observed_at:now().toISOString()};
  write('provider-readback.json',result);
  const recorded=await callServer('WORKER_RESULT',result);
  const {decision,provider_receipt_hash,result_binding_hash,...receiptBody}=recorded??{};
  const metadata=recorded?.receipt_metadata;
  if(!['PROVIDER_RESULT_RECORDED','DUPLICATE_PROVIDER_RESULT_NOOP'].includes(decision)||
   recorded.kind!=='VERIFIED_RECEIPT'||recorded.provider!=='SUPABASE'||recorded.action_id!==actionId||
   recorded.claim_id!==claim.claim_id||recorded.work_unit_id!==claim.work_unit_id||
   recorded.admission_receipt_hash!==claim.admission_receipt_hash||
   recorded.provider_operation_id!==claim.provider_operation_id||recorded.provider_request_hash!==claim.provider_request_hash||
   recorded.authority_receipt_hash!==claim.authority_receipt_hash||recorded.fencing_generation!==binding.fencing_generation||
   metadata?.sql_sha256!==SQL_SHA||metadata?.payload_hash!=='sha256:'+sha(canonicalJson(manifest))||
   metadata?.catalog_hash!=='sha256:'+sha(canonicalJson(result.readback))||metadata?.observed_at!==result.observed_at||
   metadata?.work_unit_id!==claim.work_unit_id||provider_receipt_hash!=='sha256:'+sha(canonicalJson(receiptBody))||
   result_binding_hash!=='sha256:'+sha(canonicalJson({action_id:actionId,work_unit_id:claim.work_unit_id,
    provider_receipt_hash,request_binding_hash:claim.request_binding_hash})))failure('EXACT_RECORDED_PROVIDER_RECEIPT_REQUIRED');
  write('provider-result.json',recorded);
  return {decision:recorded.decision,action_id:actionId,provider_operation_id:claim.provider_operation_id,
   mutation_attempted:true,original_job_replayed:false,development_complete:false};
 }catch(error){
  const result={decision:'PROVIDER_RECONCILIATION_REQUIRED',action_id:actionId,mutation_attempted:mutationAttempted,
   retry_allowed:false,reason:/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'SANITIZED_PROVIDER_FAILURE'};
  write('uncertain.json',result);return result;
 }
}

function readBearer(file){
 const script='$s=Get-Content -Raw -LiteralPath '+q(file)+' | ConvertTo-SecureString; '+
  '$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }';
 const value=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,env:windowsPowerShellEnvironment()}).trim();
 if(!/^[a-f0-9]{64}$/.test(value))failure('PROTECTED_PROVIDER_CREDENTIAL_INVALID');
 return value;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.platform!=='win32'||process.env.COMPUTERNAME!=='DESKTOP-0MRB113')failure('APPROVED_PROVIDER_HOST_REQUIRED');
  const [actionId,packetFile,artifactRoot,evidenceRoot]=process.argv.slice(2);
  if(![actionId,packetFile,artifactRoot,evidenceRoot].every(Boolean))failure('EXACT_ARGUMENTS_REQUIRED');
  const bearer=readBearer('D:/THE_FA/SECRETS/provider-broker-v1/provider-internal-bearer.dpapi');
  const callServer=async(mode,payload)=>{
   const r=await fetch(ENDPOINT,{method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json'},
    body:JSON.stringify({mode,...payload}),redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!r.ok)failure('BROKER_PROVIDER_REQUEST_REQUIRES_READBACK');return r.json();
  };
  const query=async(sql,{kind,directory})=>{
   const file=path.join(directory,kind+'.sql');writeFileSync(file,sql,{flag:'wx'});
   const command='& (Get-Command supabase -ErrorAction Stop).Source db query --linked --project-ref '+q(TARGET)+' --file '+q(file)+' --output json; exit $LASTEXITCODE';
   try{
    const raw=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{
     encoding:'utf8',windowsHide:true,env:windowsPowerShellEnvironment(),timeout:150000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});
    return kind==='readback'?JSON.parse(raw):null;
   }catch{failure('PROVIDER_QUERY_OUTCOME_REQUIRES_READBACK');}
  };
  const result=await executeProviderOnce({actionId,packet:JSON.parse(readFileSync(packetFile,'utf8').replace(/^\uFEFF/,'')),
   artifactRoot,evidenceRoot,callServer,query});
  console.log(JSON.stringify(result));
  if(result.decision==='PROVIDER_RECONCILIATION_REQUIRED')process.exitCode=2;
 }catch(error){console.log(JSON.stringify({error:/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'PROVIDER_HOST_FAILED'}));process.exitCode=1;}
}
