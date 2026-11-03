import {createHash,createHmac,createPublicKey,sign,verify,KeyObject} from 'node:crypto';
import {readdir,lstat,realpath,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {getConfiguredCoreAuthPoolBinding} from './inherited/server/auth/database.mjs';
import {assertTenantEnvelope,inspectAllowance,allowanceWorkspaceForAccount} from './inherited/cloud-allowance.mjs';
import {tenantWorkspaceForEmail} from './inherited/customer-tenant-storage.mjs';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REALM='https://furfjhymxqsbhvuyeqpx.supabase.co/functions/v1/core-customer-auth';
const snapshots=new WeakMap(),inventories=new WeakMap();
const bad=code=>{throw Object.assign(new Error(code),{code})};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const sha=x=>createHash('sha256').update(x).digest('hex');
export function canonical(value){if(value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(!plain(value))bad('INVENTORY_VALUE_INVALID');return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}'}
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest('hex');
export const providerSubjectHash=(secret,realm,provider,subject)=>hmac(secret,'THEFA_CUSTOMER_PROVIDER_SUBJECT_V1\0'+canonical([realm,provider,subject]));
function keys(stable){if(!plain(stable)||!Buffer.isBuffer(stable.accountSecret)||stable.accountSecret.length!==32||!Buffer.isBuffer(stable.allowanceSecret)||stable.allowanceSecret.length!==32||typeof stable.tenantKey!=='string'||stable.tenantKey.length<32)bad('STABLE_KEYS_REQUIRED');return {accountSecret:sha(stable.accountSecret),allowanceSecret:sha(stable.allowanceSecret),tenantKey:sha(Buffer.from(stable.tenantKey))}}
function rowsValid(rows){if(!Array.isArray(rows)||rows.length>100000)bad('PROVIDER_INVENTORY_INVALID');const seen=new Set();return rows.map(row=>{if(!plain(row)||!UUID.test(row.userId??'')||!['google','kakao'].includes(row.provider)||typeof row.subject!=='string'||row.subject.length<1||row.subject.length>512||row.subject!==row.subject.trim()||/[\x00-\x20\x7f]/.test(row.subject))bad('PROVIDER_INVENTORY_INVALID');const unique=canonical([row.provider,row.subject]);if(seen.has(unique))bad('PROVIDER_INVENTORY_AMBIGUOUS');seen.add(unique);return {userId:row.userId,provider:row.provider,subject:row.subject}})}

/** A complete READ ONLY server DB snapshot, not a caller-supplied complete=true flag. */
export async function readCompleteProviderIdentityInventory({database}={}){
 const binding=getConfiguredCoreAuthPoolBinding(database);if(!binding)bad('DEDICATED_PROVIDER_DATABASE_REQUIRED');
 const client=await database.connect();let started=false;
 try{await client.query('begin isolation level repeatable read read only');started=true;
  const role=(await client.query('select current_user as role,current_schema() as schema')).rows;
  if(role.length!==1||role[0].role!=='core_customer_auth_runtime'||role[0].schema!=='core_customer_auth')bad('PROVIDER_DATABASE_ROLE_MISMATCH');
  const rows=rowsValid((await client.query('select "userId", "providerId" as provider, "accountId" as subject from core_customer_auth."account" order by "userId", "providerId", "accountId" limit 100001')).rows);
  await client.query('commit');started=false;const snapshot=Object.freeze({});snapshots.set(snapshot,{rows,binding,capturedAt:new Date().toISOString()});return snapshot;
 }catch(error){if(started)try{await client.query('rollback')}catch{}throw Object.assign(new Error(error?.code==='PROVIDER_DATABASE_ROLE_MISMATCH'?error.code:'PROVIDER_INVENTORY_READ_UNAVAILABLE'),{code:error?.code==='PROVIDER_DATABASE_ROLE_MISMATCH'?error.code:'PROVIDER_INVENTORY_READ_UNAVAILABLE'});}
 finally{client.release()}
}

function sourceMap(value){if(!(value instanceof Map)||value.size<1||value.size>256)bad('SOURCE_SNAPSHOT_INVALID');for(const[name,bytes]of value)if(typeof name!=='string'||!/^[-A-Za-z0-9_.]+$/.test(name)||['.','..'].includes(name)||!Buffer.isBuffer(bytes)||bytes.length>4*1024*1024)bad('SOURCE_SNAPSHOT_INVALID');return value}
function keyProof(source,stable,provenance){if(!plain(provenance))bad('STABLE_KEY_PROVENANCE_REQUIRED');for(const name of ['accountSecret','allowanceSecret','tenantKey']){const proof=provenance[name],expected=name==='tenantKey'?Buffer.from(stable[name]):stable[name];if(!plain(proof)||!source.has(proof.file)||!['raw','utf8','base64','raw-to-lowercase-hex-utf8'].includes(proof.encoding))bad('STABLE_KEY_PROVENANCE_REQUIRED');const raw=source.get(proof.file);let actual;if(proof.encoding==='raw')actual=raw;else if(proof.encoding==='utf8')actual=Buffer.from(raw.toString('utf8').trim(),'utf8');else if(proof.encoding==='raw-to-lowercase-hex-utf8'){if(name!=='tenantKey'||raw.length!==32)bad('STABLE_KEY_PROVENANCE_MISMATCH');actual=Buffer.from(raw.toString('hex'),'utf8')}else{const text=raw.toString('utf8').trim();actual=Buffer.from(text,'base64');if(actual.toString('base64')!==text)bad('STABLE_KEY_PROVENANCE_MISMATCH')}if(!actual.equals(expected))bad('STABLE_KEY_PROVENANCE_MISMATCH')}}
function parseState(bytes){let state;try{state=JSON.parse(bytes.toString('utf8'));assertTenantEnvelope(state)}catch{bad('SOURCE_STATE_INVALID')}return state}
const summary=p=>({legacyAccounts:Object.keys(p.accounts).length,claims:Object.keys(p.claims).length,reconciledAccounts:p.coverage.reconciledAccounts,missingAllowances:Object.values(p.accounts).filter(a=>a.allowance.status==='ABSENT_IN_COMPLETE_SOURCE').length,sourceFiles:p.coverage.sourceFiles,tenantRows:p.coverage.tenantRows,providerRows:p.coverage.providerRows});

/** Only the trusted operator calls this with actual complete read-only snapshots.
 * No UUID/email inference, source edits, DB writes, decryption or key generation. */
export function produceSignedLegacyInventory({sourceFiles,backupFiles,providerInventory,stableKeys,keyProvenance,identityRealm,migrationId,signingKey}={}){
 const snapshot=snapshots.get(providerInventory);if(!snapshot)bad('PROVIDER_INVENTORY_REQUIRED');
 const hashes=keys(stableKeys),source=sourceMap(sourceFiles),backup=sourceMap(backupFiles);
 if(identityRealm!==REALM||typeof migrationId!=='string'||!/^[A-Za-z0-9._:-]{8,160}$/.test(migrationId)||!(signingKey instanceof KeyObject)||signingKey.type!=='private'||signingKey.asymmetricKeyType!=='ed25519')bad('MIGRATION_OPERATOR_CONFIGURATION_INVALID');
 if(source.size!==backup.size||[...source].some(([name,bytes])=>!backup.get(name)?.equals(bytes)))bad('SOURCE_BACKUP_MISMATCH');keyProof(source,stableKeys,keyProvenance);
 const registryName='tenant_'+sha('THEFA_CUSTOMER_ACCOUNT_REGISTRY_V1')+'.json',registryBytes=source.get(registryName);if(!registryBytes)bad('LEGACY_REGISTRY_REQUIRED');
 const registry=parseState(registryBytes).customerAccounts;if(!plain(registry)||!plain(registry.accounts)||!plain(registry.claims))bad('LEGACY_REGISTRY_INVALID');
 const accounts=Object.create(null),claimedSubjects=new Set();
 for(const[account,record]of Object.entries(registry.accounts)){
  if(!HASH.test(account)||!plain(record)||typeof record.workspaceEmail!=='string')bad('LEGACY_REGISTRY_INVALID');
  const matches=snapshot.rows.filter(row=>hmac(stableKeys.accountSecret,identityRealm+'|'+row.userId)===account);
  if(matches.length!==1)bad(matches.length?'LEGACY_PROVIDER_AMBIGUOUS':'LEGACY_IDENTITY_UNRESOLVED');const identity=matches[0],subjectHash=providerSubjectHash(stableKeys.accountSecret,identityRealm,identity.provider,identity.subject);
  if(claimedSubjects.has(subjectHash))bad('LEGACY_PROVIDER_AMBIGUOUS');claimedSubjects.add(subjectHash);
  const workspaceId=tenantWorkspaceForEmail(record.workspaceEmail,stableKeys.tenantKey),workspaceBytes=source.get(workspaceId+'.json');if(!workspaceBytes)bad('LEGACY_WORKSPACE_SOURCE_REQUIRED');parseState(workspaceBytes);
  const allowanceId=allowanceWorkspaceForAccount(account,stableKeys.allowanceSecret),allowanceBytes=source.get(allowanceId+'.json');let allowance={status:'ABSENT_IN_COMPLETE_SOURCE'};
  if(allowanceBytes){const state=parseState(allowanceBytes),value=inspectAllowance(state.customerAllowance,{secret:stableKeys.allowanceSecret});allowance={status:'EXACT_LEDGER_PRESENT',workspaceId:allowanceId,sourceSha256:sha(allowanceBytes),used:value.used,pending:value.pending};}
  if(/^guest_[a-f0-9]{48}@temporary\.thefa\.invalid$/.test(record.workspaceEmail)&&registry.claims[hmac(stableKeys.accountSecret,record.workspaceEmail)]!==account)bad('LEGACY_CLAIM_MISMATCH');
  accounts[account]={userId:identity.userId,provider:identity.provider,subjectHash,workspaceEmail:record.workspaceEmail,workspaceId,workspaceSha256:sha(workspaceBytes),allowance};
 }
 for(const[claim,account]of Object.entries(registry.claims))if(!HASH.test(claim)||!HASH.test(account)||!Object.hasOwn(accounts,account))bad('LEGACY_CLAIM_MISMATCH');
 const tenantRows=[...source.keys()].filter(name=>/^tenant_[a-f0-9]{64}\.json$/.test(name));for(const name of tenantRows)parseState(source.get(name));
 const payload={contract:'THEFA_VERIFIED_LEGACY_IDENTITY_INVENTORY_V1',migrationId,identityRealm,capturedAt:snapshot.capturedAt,projectRef:snapshot.binding.projectRef,sourceSetSha256:sha([...source].sort(([a],[b])=>a.localeCompare(b)).map(([name,b])=>name+'\0'+sha(b)+'\n').join('')),registrySha256:sha(registryBytes),keyHashes:hashes,accounts,claims:structuredClone(registry.claims),sourceTenantRows:Object.fromEntries(tenantRows.map(name=>[name.slice(0,-5),sha(source.get(name))])),coverage:{sourceFiles:source.size,tenantRows:tenantRows.length,providerRows:snapshot.rows.length,legacyAccounts:Object.keys(accounts).length,reconciledAccounts:Object.keys(accounts).length,unresolvedAccounts:0}};
 return {envelope:{payload,signature:sign(null,Buffer.from(canonical(payload)),signingKey).toString('base64')},summary:summary(payload)};
}

export function verifySignedLegacyInventory({envelope,verificationKey,stableKeys}={}){
 try{const key=verificationKey instanceof KeyObject?verificationKey:createPublicKey(verificationKey),p=envelope?.payload,hashes=keys(stableKeys);
  if(key.type!=='public'||key.asymmetricKeyType!=='ed25519'||!plain(p)||p.contract!=='THEFA_VERIFIED_LEGACY_IDENTITY_INVENTORY_V1'||p.identityRealm!==REALM||!HASH.test(p.registrySha256??'')||!HASH.test(p.sourceSetSha256??'')||!plain(p.accounts)||!plain(p.claims)||!plain(p.sourceTenantRows)||!plain(p.coverage)||p.coverage.tenantRows!==Object.keys(p.sourceTenantRows).length||Object.entries(p.sourceTenantRows).some(([id,digest])=>!/^tenant_[a-f0-9]{64}$/.test(id)||!HASH.test(digest))||p.coverage.unresolvedAccounts!==0||p.coverage.legacyAccounts!==Object.keys(p.accounts).length||p.coverage.reconciledAccounts!==Object.keys(p.accounts).length||Object.entries(hashes).some(([k,v])=>p.keyHashes?.[k]!==v)||typeof envelope.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature))bad('SIGNED_LEGACY_INVENTORY_INVALID');
  const signature=Buffer.from(envelope.signature,'base64');if(!verify(null,Buffer.from(canonical(p)),key,signature))bad('SIGNED_LEGACY_INVENTORY_INVALID');
  const seen=new Set();for(const[id,account]of Object.entries(p.accounts)){if(!HASH.test(id)||!UUID.test(account?.userId??'')||!['google','kakao'].includes(account.provider)||!HASH.test(account.subjectHash??'')||seen.has(account.subjectHash)||tenantWorkspaceForEmail(account.workspaceEmail,stableKeys.tenantKey)!==account.workspaceId||!HASH.test(account.workspaceSha256??'')||hmac(stableKeys.accountSecret,REALM+'|'+account.userId)!==id||!['EXACT_LEDGER_PRESENT','ABSENT_IN_COMPLETE_SOURCE'].includes(account.allowance?.status))bad('SIGNED_LEGACY_INVENTORY_INVALID');seen.add(account.subjectHash);if(account.allowance.status==='EXACT_LEDGER_PRESENT'&&(account.allowance.workspaceId!==allowanceWorkspaceForAccount(id,stableKeys.allowanceSecret)||!HASH.test(account.allowance.sourceSha256??'')||!Number.isSafeInteger(account.allowance.used)||account.allowance.used<0||account.allowance.used>10||!Number.isSafeInteger(account.allowance.pending)||account.allowance.pending<0||account.allowance.used+account.allowance.pending>10))bad('SIGNED_LEGACY_INVENTORY_INVALID')}
  for(const[claim,id]of Object.entries(p.claims))if(!HASH.test(claim)||!Object.hasOwn(p.accounts,id))bad('SIGNED_LEGACY_INVENTORY_INVALID');
  const inventory=Object.freeze({});inventories.set(inventory,{payload:structuredClone(p),digest:sha(Buffer.from(canonical(p))),publicKeySha256:sha(key.export({type:'spki',format:'der'}))});return inventory;
 }catch{bad('SIGNED_LEGACY_INVENTORY_INVALID')}
}
export function describeVerifiedLegacyInventory(inventory){const record=inventories.get(inventory);if(!record)bad('VERIFIED_LEGACY_INVENTORY_REQUIRED');return {...summary(record.payload),digest:record.digest}}
export function readVerifiedLegacyInventory(inventory){const record=inventories.get(inventory);if(!record)bad('VERIFIED_LEGACY_INVENTORY_REQUIRED');return structuredClone(record)}

/** Actual operator entry: enumerate every immediate original file, including
 * hidden stable key files, with no aliases/links or writes. Caller logs summary only. */
export async function readActualR9SnapshotDirectory(directory){
 try{
  if(typeof directory!=='string'||!path.isAbsolute(directory)||path.resolve(directory)!==directory||await realpath(directory)!==directory)bad('SOURCE_DIRECTORY_INVALID');
  const rootStat=await lstat(directory);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())bad('SOURCE_DIRECTORY_INVALID');
  const names=(await readdir(directory)).sort();if(!names.length||names.length>256)bad('SOURCE_DIRECTORY_INVALID');const files=new Map();
  for(const name of names){if(!/^[-A-Za-z0-9_.]+$/.test(name)||['.','..'].includes(name))bad('SOURCE_DIRECTORY_INVALID');const file=path.join(directory,name),before=await lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.size>4*1024*1024)bad('SOURCE_DIRECTORY_INVALID');
   const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
   try{const stat=await handle.stat();if(stat.dev!==before.dev||stat.ino!==before.ino||stat.size!==before.size||stat.mtimeMs!==before.mtimeMs)bad('SOURCE_SNAPSHOT_CHANGED');const bytes=await handle.readFile(),after=await handle.stat();if(bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)bad('SOURCE_SNAPSHOT_CHANGED');files.set(name,bytes)}finally{await handle.close()}
  }
  if(canonical((await readdir(directory)).sort())!==canonical(names))bad('SOURCE_SNAPSHOT_CHANGED');return files;
 }catch(error){bad(['SOURCE_DIRECTORY_INVALID','SOURCE_SNAPSHOT_CHANGED'].includes(error?.code)?error.code:'SOURCE_DIRECTORY_READ_UNAVAILABLE')}
}
export async function prepareActualSignedLegacyInventory({sourceDirectory,backupDirectory,database,stableKeys,keyProvenance,identityRealm,migrationId,signingKey}={}){
 const sourceFiles=await readActualR9SnapshotDirectory(sourceDirectory),backupFiles=await readActualR9SnapshotDirectory(backupDirectory),providerInventory=await readCompleteProviderIdentityInventory({database});
 const produced=produceSignedLegacyInventory({sourceFiles,backupFiles,providerInventory,stableKeys,keyProvenance,identityRealm,migrationId,signingKey});
 return {...produced,sourceFiles,backupFiles};
}
