import {createHash,createPublicKey,sign,KeyObject} from 'node:crypto';
import {SupabaseRest} from './inherited/store.mjs';
import {assertTenantEnvelope} from './inherited/cloud-allowance.mjs';
import {canonical,readVerifiedLegacyInventory} from './migration-inventory.mjs';
const baselines=new WeakMap(),sha=value=>createHash('sha256').update(value).digest('hex');
const bad=code=>{throw Object.assign(new Error(code),{code,status:503})};
const sourceDigest=files=>sha([...files].sort(([a],[b])=>a.localeCompare(b)).map(([name,b])=>name+'\0'+sha(b)+'\n').join(''));
function sourceStates(files){if(!(files instanceof Map)||files.size>256)bad('MIGRATION_SOURCE_INVALID');const out=new Map();for(const[name,bytes]of files){if(!Buffer.isBuffer(bytes))bad('MIGRATION_SOURCE_INVALID');if(/^tenant_[a-f0-9]{64}\.json$/.test(name)){let state;try{state=JSON.parse(bytes.toString('utf8'));assertTenantEnvelope(state)}catch{bad('MIGRATION_SOURCE_INVALID')}out.set(name.slice(0,-5),{bytes,state});}}if(!out.size)bad('MIGRATION_SOURCE_INVALID');return out}

/** Independently re-read actual imported tenant rows through the server REST
 * transport. No import, lease acquisition, writes, retries or baseline invention. */
export async function readMigrationTargetBaselines({rest,sourceFiles,environment}={}){
 const refs={staging:'furfjhymxqsbhvuyeqpx',production:'cgrppxfdurpzzfvkmfte'};
 if(!(rest instanceof SupabaseRest)||!Object.hasOwn(refs,environment)||rest.url!=='https://'+refs[environment]+'.supabase.co')bad('MIGRATION_TARGET_CONFIGURATION_INVALID');
 const source=sourceStates(sourceFiles),rows=new Map();
 for(const[id,entry]of source){
  let values;try{values=await rest.request('/core_console_state_v3?workspace_id=eq.'+id+'&select=workspace_id,state,version&limit=1')}catch{bad('MIGRATION_TARGET_READ_UNAVAILABLE')}
  if(!Array.isArray(values)||values.length!==1||values[0]?.workspace_id!==id||!Number.isSafeInteger(values[0].version)||values[0].version<1)bad('MIGRATION_TARGET_ROW_REQUIRED');
  try{assertTenantEnvelope(values[0].state)}catch{bad('MIGRATION_TARGET_STATE_MISMATCH')}
  if(canonical(values[0].state)!==canonical(entry.state))bad('MIGRATION_TARGET_STATE_MISMATCH');rows.set(id,{version:values[0].version,stateSha256:sha(Buffer.from(canonical(values[0].state)))});
 }
 const result=Object.freeze({});baselines.set(result,{environment,projectRef:refs[environment],rows,sourceDigest:sourceDigest(sourceFiles)});return result;
}

/** Produces private signed files only after actual imported target readback.
 * The operator owns private output persistence and must verify its ACL first.
 * Stable secret files and private signing keys never enter the returned package. */
export function produceSignedLegacyMigrationPackage({inventory,inventoryEnvelope,sourceFiles,backupFiles,targetBaselines,signingKey}={}){
 const target=baselines.get(targetBaselines);if(!target)bad('VERIFIED_TARGET_BASELINES_REQUIRED');
 const record=readVerifiedLegacyInventory(inventory),p=record.payload;
 if(!(signingKey instanceof KeyObject)||signingKey.type!=='private'||signingKey.asymmetricKeyType!=='ed25519'||sha(createPublicKey(signingKey).export({type:'spki',format:'der'}))!==record.publicKeySha256)bad('MIGRATION_SIGNING_KEY_MISMATCH');
 if(!(sourceFiles instanceof Map)||!(backupFiles instanceof Map)||sourceFiles.size!==backupFiles.size||[...sourceFiles].some(([name,b])=>!Buffer.isBuffer(b)||!backupFiles.get(name)?.equals(b))||sourceDigest(sourceFiles)!==p.sourceSetSha256||target.sourceDigest!==p.sourceSetSha256||sha(Buffer.from(canonical(inventoryEnvelope?.payload)))!==record.digest)bad('MIGRATION_SOURCE_PROVENANCE_MISMATCH');
 const source=sourceStates(sourceFiles),files=new Map();
 for(const[id,entry]of source){if(target.rows.get(id)?.stateSha256!==sha(Buffer.from(canonical(entry.state))))bad('MIGRATION_TARGET_STATE_MISMATCH');for(const sub of ['source','backup','target-baseline'])files.set(sub+'/'+id+'.json',Buffer.from(entry.bytes));}
 const registryName='tenant_'+sha('THEFA_CUSTOMER_ACCOUNT_REGISTRY_V1')+'.json',registry=sourceFiles.get(registryName);if(sha(registry)!==p.registrySha256)bad('MIGRATION_SOURCE_PROVENANCE_MISMATCH');files.set('identity-snapshot/'+registryName,Buffer.from(registry));
 let ready=0,missing=0;
 for(const[accountId,account]of Object.entries(p.accounts)){
  if(account.allowance.status!=='EXACT_LEDGER_PRESENT'){missing++;continue;}
  const workspace=source.get(account.workspaceId),allowance=source.get(account.allowance.workspaceId);
  if(!workspace||!allowance||sha(workspace.bytes)!==account.workspaceSha256||sha(allowance.bytes)!==account.allowance.sourceSha256)bad('MIGRATION_SOURCE_PROVENANCE_MISMATCH');
  const payload={contract:'THEFA_LEGACY_MIGRATION_RECEIPT_V1',migrationId:p.migrationId,accountId,
   identity:{userId:account.userId,provider:account.provider,backendUrl:p.identityRealm,workspaceEmail:account.workspaceEmail,registrySha256:p.registrySha256},keyHashes:p.keyHashes,
   workspace:{workspaceId:account.workspaceId,sourceSha256:account.workspaceSha256,baselineSha256:account.workspaceSha256,targetVersion:target.rows.get(account.workspaceId).version},
   allowance:{workspaceId:account.allowance.workspaceId,sourceSha256:account.allowance.sourceSha256,baselineSha256:account.allowance.sourceSha256,targetVersion:target.rows.get(account.allowance.workspaceId).version}};
  files.set('receipts/'+accountId+'.json',Buffer.from(JSON.stringify({payload,signature:sign(null,Buffer.from(canonical(payload)),signingKey).toString('base64')})+'\n'));ready++;
 }
 files.set('inventory.json',Buffer.from(JSON.stringify(inventoryEnvelope)+'\n'));
 return {files,summary:{contract:'R39_PRIVATE_LEGACY_MIGRATION_PACKAGE_V1',receipts:ready,missingAllowances:missing,preservedTenantRows:source.size,preservedClaims:Object.keys(p.claims).length,sourceSetSha256:p.sourceSetSha256,targetProjectRef:target.projectRef,actualImportPerformed:false,secretFilesIncluded:0}};
}
